import { NextRequest, NextResponse } from 'next/server'
import { alertHuman, getOpportunity, sendToGoogleSheets, sendTemplate, sendText, STAGES } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome, APROVACAO_TEMPLATE_VAR, buildAvisoMatrizMsg } from '@/lib/text'

/**
 * Webhook chamado pelo Evo Talks quando uma oportunidade muda de etapa.
 * - Stage CADASTRO_RECEBIDO (49) → envia dados para o HubSpot
 * - Stage EM_ANALISE (50) "Em Análise CAF" → dispara template de aprovação AIVA
 *   com link de onboarding completo (retail-onboarding-hub).
 */
export async function POST(req: NextRequest) {
  // Captura headers e body pra debug (SEMPRE loga, mesmo em 401)
  const headersObj: Record<string, string> = {}
  req.headers.forEach((value, key) => { headersObj[key] = value })

  let rawBody = ''
  let payload: Record<string, unknown> = {}
  try {
    rawBody = await req.text()
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    payload = { _raw: rawBody }
  }

  // Valida autenticação
  const secret = req.headers.get('x-internal-secret') ?? ''
  const authOk = secret === process.env.WEBHOOK_SECRET

  // Log do request recebido (pra debug do Evo Talks)
  try {
    await supabaseAdmin.from('webhook_debug').insert({
      endpoint: '/api/sdr/opportunity-stage',
      method: 'POST',
      headers: headersObj,
      body: payload,
      status_code: authOk ? 200 : 401,
      ip: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null,
      user_agent: req.headers.get('user-agent') ?? null,
    })
  } catch (err) {
    console.error('webhook_debug insert falhou:', err)
  }

  if (!authOk) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Extrai dados do payload do Evo Talks
  const opportunityId = payload.opportunityId ?? (payload as Record<string, unknown>).id ?? (payload.opportunity as Record<string, unknown>)?.id ?? null
  const destStageId = payload.destStageId ?? (payload as Record<string, unknown>).stageId ?? (payload as Record<string, unknown>).fkStage ?? (payload.opportunity as Record<string, unknown>)?.fkStage ?? null

  console.log(`Opportunity stage webhook: oppId=${opportunityId}, stageId=${destStageId}`)

  if (!opportunityId) {
    return NextResponse.json({ ok: false, erro: 'opportunityId não encontrado' }, { status: 400 })
  }

  const stageNum = Number(destStageId)

  // Stage 49 — Cadastro Recebido (manual) → dispara HSM "Complete o Cadastro".
  //
  // Fluxo: operador/Eduardo aprovou a pré-análise e move manualmente o card de
  // Pré Aprovação (54) → Cadastro Recebido (49). Isso reabre a janela WhatsApp
  // via HSM template 20 e muda o status do lead pra COLETANDO_COMPLEMENTO, pra
  // VictorIA retomar a conversa e coletar os 5 dados restantes.
  //
  // OBS: o HubSpot NÃO é mais disparado aqui — agora é disparado só quando a
  // VictorIA completa a Fase 3 (12 dados) no /api/sdr/webhook.
  if (stageNum === STAGES.CADASTRO_RECEBIDO) {
    try {
      const opp = await getOpportunity(Number(opportunityId))
      const forms = (opp.formsdata ?? {}) as Record<string, string | null>
      const telefone = (opp.mainphone ?? forms['db8569f0'] ?? '').toString().replace(/\D/g, '')

      if (!telefone) {
        console.error(`Opp #${opportunityId}: telefone não encontrado pra template Complete o Cadastro`)
        return NextResponse.json({ ok: false, erro: 'telefone_nao_encontrado' }, { status: 400 })
      }

      // Busca o lead no Supabase pra pegar nome + id
      const { data: lead } = await supabaseAdmin
        .from('sdr_leads')
        .select('id, nome')
        .eq('telefone', telefone)
        .maybeSingle()

      const nomeSocio = normalizaNome(forms['da6ddf70']) || normalizaNome(lead?.nome ?? null) || 'Lojista'

      // Template HSM "Complete o Cadastro" (id 20)
      // {{1}} = nome do sócio
      // {{2}} = texto (usa valor padrão do Evo Talks)
      const templateId = Number(process.env.AIVA_COMPLETE_CADASTRO_TEMPLATE_ID ?? 0)
      if (!templateId) {
        console.warn(`AIVA_COMPLETE_CADASTRO_TEMPLATE_ID não configurado — template Complete o Cadastro não enviado (opp #${opportunityId})`)
        return NextResponse.json({
          ok: false,
          erro: 'template_complete_cadastro_nao_configurado',
        })
      }

      const textoPadrao = 'sua loja foi pré-aprovada pela AIVA! 🎉'
      await sendTemplate(telefone, templateId, [nomeSocio, textoPadrao])

      // Muda status do lead pra COLETANDO_COMPLEMENTO (se o lead existir no Supabase)
      if (lead?.id) {
        await supabaseAdmin
          .from('sdr_leads')
          .update({
            status: 'COLETANDO_COMPLEMENTO',
            data_ultimo_contato: new Date().toISOString(),
          })
          .eq('id', lead.id)

        await supabaseAdmin.from('sdr_mensagens').insert({
          lead_id: lead.id,
          direcao: 'out',
          conteudo: `[Template Complete o Cadastro enviado — ${nomeSocio}]`,
          template_hsm: 'aiva_complete_cadastro',
        })
      }

      // Alerta Aldo + Nei de que a oportunidade foi aprovada internamente e
      // a VictorIA vai começar a Fase 3 (coleta dos 5 dados complementares).
      try {
        const msg =
          `🟢 *${lead?.nome ?? nomeSocio}* (${telefone}) movido pra Cadastro Recebido.\n` +
          `HSM 20 disparado — VictorIA vai coletar os 5 dados restantes (email, faturamento, valor boleto, localização, CNPJs adicionais).`
        if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
        if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
      } catch (err) {
        console.error('Falha ao alertar humanos sobre stage 49:', err)
      }

      console.log(`Template Complete o Cadastro enviado: opp #${opportunityId} → ${telefone}, status → COLETANDO_COMPLEMENTO`)
      return NextResponse.json({
        ok: true,
        template_enviado: true,
        status_atualizado: 'COLETANDO_COMPLEMENTO',
      })
    } catch (err) {
      console.error('Erro ao disparar template Complete o Cadastro:', err)
      return NextResponse.json({ ok: false, erro: 'template_error' }, { status: 500 })
    }
  }

  // Stage 54 — Pré Aprovação → envia dados pra planilha AIVA APROVAÇÃO
  //
  // Usado quando o time preenche manualmente os dados no CRM a partir de um
  // lead INTERESSADO e move pra Pré Aprovação (fluxo manual, sem passar pelo chat).
  //
  // ATENÇÃO: o trigger desse webhook no Evo Talks foi DESABILITADO pelo Gustavo,
  // então este handler está dormente — só roda se o trigger for reativado.
  // O envio principal pra planilha (quando a VictorIA qualifica via chat) é
  // feito DIRETAMENTE no /api/sdr/webhook. Se reativar o trigger aqui, REMOVA
  // a chamada direta de lá pra evitar duplicação na planilha.
  if (stageNum === STAGES.PRE_APROVACAO) {
    try {
      const opp = await getOpportunity(Number(opportunityId))
      const forms = (opp.formsdata ?? {}) as Record<string, string | null>
      const telefone = (opp.mainphone ?? forms['db8569f0'] ?? '').toString().replace(/\D/g, '')

      await sendToGoogleSheets({
        nome_socio: forms['da6ddf70'],
        email_socio: forms['dafa40f0'],
        telefone: telefone || forms['db8569f0'],
        nome_varejo: forms['dcacfa00'],
        cnpj_matriz: forms['dd2ab580'],
        faturamento_anual: forms['ddb960f0'],
        valor_boleto_mensal: forms['de2cbc30'],
        regiao_varejo: forms['dede58f0'],
        numero_lojas: forms['df6f9c70'],
        localizacao_lojas: forms['e0099280'],
        possui_outra_financeira: forms['e07d62f0'],
        cnpjs_adicionais: forms['e0f66380'],
        status: 'PRE_APROVACAO',
        opportunity_id: String(opportunityId),
      })

      // Registra no histórico do lead (se existir)
      if (telefone) {
        const { data: lead } = await supabaseAdmin
          .from('sdr_leads')
          .select('id')
          .eq('telefone', telefone)
          .maybeSingle()

        if (lead?.id) {
          await supabaseAdmin.from('sdr_mensagens').insert({
            lead_id: lead.id,
            direcao: 'out',
            conteudo: `[Dados enviados pra planilha AIVA APROVAÇÃO via Pré Aprovação manual — opp #${opportunityId}]`,
          })
        }
      }

      console.log(`Google Sheets: dados enviados via Pré Aprovação manual — opp #${opportunityId}`)
      return NextResponse.json({ ok: true, google_sheets: true, opportunity_id: opportunityId })
    } catch (err) {
      console.error('Erro ao enviar dados pra Google Sheets (stage 54):', err)
      return NextResponse.json({ ok: false, erro: 'google_sheets_error' }, { status: 500 })
    }
  }

  // Stage 50 — Em Análise CAF → dispara template de aprovação AIVA
  if (stageNum === STAGES.EM_ANALISE) {
    try {
      const opp = await getOpportunity(Number(opportunityId))
      const forms = (opp.formsdata ?? {}) as Record<string, string | null>

      // Nome do contato (preferimos nome do sócio; fallback para título da opp)
      const nomeRaw =
        forms['da6ddf70'] ||
        (typeof opp.title === 'string' ? opp.title.split('—')[0].trim() : '') ||
        ''
      const nomeContato = normalizaNome(nomeRaw)

      // Telefone da oportunidade
      const telefone = (opp.mainphone ?? forms['db8569f0'] ?? '').toString().replace(/\D/g, '')
      if (!telefone) {
        console.error(`Opp #${opportunityId}: telefone não encontrado para envio de template`)
        return NextResponse.json({ ok: false, erro: 'telefone_nao_encontrado' }, { status: 400 })
      }

      const templateId = Number(process.env.AIVA_APROVACAO_TEMPLATE_ID ?? 0)
      if (!templateId) {
        console.warn(
          `AIVA_APROVACAO_TEMPLATE_ID não configurado — template de aprovação não enviado (opp #${opportunityId})`
        )
        return NextResponse.json({
          ok: false,
          erro: 'template_aprovacao_nao_configurado',
          aviso: 'Aguardando Gustavo criar o template HSM de aprovação AIVA',
        })
      }

      // Dispara HSM de aprovação. Template 15 "(CAMPANHA) Link de Cadastro" tem
      // 1 variável {{1}} que carrega todo o conteúdo do meio (incluindo o link).
      // Corpo do template:
      //   Bem vindo{{1}}
      //   Assim que finalizar, retorne aqui.
      await sendTemplate(telefone, templateId, [APROVACAO_TEMPLATE_VAR])

      // Aviso complementar sobre CNPJ matriz/filial (não está no template HSM).
      // Enviado como texto livre — janela de 24h já foi aberta pelo template acima.
      const avisoMatrizMsg = buildAvisoMatrizMsg(nomeContato)

      try {
        await sendText(telefone, avisoMatrizMsg)
      } catch (err) {
        console.error(`Falha ao enviar aviso CNPJ matriz para ${telefone}:`, err)
      }

      // Registra no histórico do lead e atualiza status para ANALISE_AIVA
      const { data: lead } = await supabaseAdmin
        .from('sdr_leads')
        .select('id')
        .eq('telefone', telefone)
        .maybeSingle()

      if (lead?.id) {
        await supabaseAdmin.from('sdr_mensagens').insert([
          {
            lead_id: lead.id,
            direcao: 'out',
            conteudo: `[Template (CAMPANHA) Link de Cadastro enviado — ${nomeContato ?? 'Lojista'}]`,
            template_hsm: 'aiva_link_cadastro',
          },
          {
            lead_id: lead.id,
            direcao: 'out',
            conteudo: avisoMatrizMsg,
          },
        ])

        // Muda status para ANALISE_AIVA — VictorIA passa a responder nessa fase
        // e o cron followup-fase monitora se o lead concluiu o cadastro CAF.
        await supabaseAdmin
          .from('sdr_leads')
          .update({
            status: 'ANALISE_AIVA',
            data_ultimo_contato: new Date().toISOString(),
          })
          .eq('id', lead.id)

        console.log(`Lead ${telefone}: status atualizado → ANALISE_AIVA (stage 50 EM_ANALISE)`)
      }

      // Complementa planilha AIVA APROVAÇÃO com os dados completos (12 campos).
      // Nei acaba de mover pra Em Análise CAF — neste ponto todos os dados
      // já foram coletados pela VictorIA e estão no formulário da opp.
      // O Apps Script faz upsert por opportunity_id: preenche células vazias
      // da linha criada na Fase 1 sem sobrescrever o que já estava lá.
      try {
        await sendToGoogleSheets({
          nome_socio:            forms['da6ddf70'],
          email_socio:           forms['dafa40f0'],
          telefone:              telefone || forms['db8569f0'],
          nome_varejo:           forms['dcacfa00'],
          cnpj_matriz:           forms['dd2ab580'],
          faturamento_anual:     forms['ddb960f0'],
          valor_boleto_mensal:   forms['de2cbc30'],
          regiao_varejo:         forms['dede58f0'],
          numero_lojas:          forms['df6f9c70'],
          localizacao_lojas:     forms['e0099280'],
          possui_outra_financeira: forms['e07d62f0'],
          cnpjs_adicionais:      forms['e0f66380'],
          status: 'ANALISE_AIVA',
          opportunity_id: String(opportunityId),
        })
        console.log(`Google Sheets complementado: opp #${opportunityId} → stage 50`)
      } catch (err) {
        console.error(`Falha ao complementar Google Sheets no stage 50 (opp #${opportunityId}):`, err)
      }

      console.log(`Template link cadastro + aviso matriz enviados: opp #${opportunityId} → ${telefone}`)
      return NextResponse.json({ ok: true, template_enviado: true, aviso_matriz_enviado: true, google_sheets: true, status_atualizado: 'ANALISE_AIVA', telefone })
    } catch (err) {
      console.error('Erro ao enviar template de aprovação:', err)
      return NextResponse.json({ ok: false, erro: 'template_error' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, ignorado: `stage ${destStageId} sem ação configurada` })
}
