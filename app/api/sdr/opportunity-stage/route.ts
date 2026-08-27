import { NextRequest, NextResponse } from 'next/server'
import { alertHuman, criarContaMrr, getOpportunity, getOpenChatId, openChat, sendMessageToChat, sendToGoogleSheets, sendTemplate, sendText, STAGES, MARCADOR_FASE3 } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome, APROVACAO_TEMPLATE_VAR, buildAvisoMatrizMsg, buildAvisoCadastroMsg, buildAvisoColetandoComplementoMsg, buildKitPosFechamentoMsg } from '@/lib/text'

/**
 * Normaliza telefone brasileiro para o formato E.164 (com 55 no início).
 * O Evo Talks indexa chats por esse formato internamente.
 *
 * - "47996085000" (11 dígitos) → "5547996085000"
 * - "5547996085000" (13 dígitos) → "5547996085000" (já normalizado)
 * - "479960850" (10 dígitos) → "55479960850" (legacy, mas tratado)
 */
function normalizePhoneBR(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits
  }
  if (digits.length === 10 || digits.length === 11) {
    return '55' + digits
  }
  return digits
}

/**
 * Verifica se a janela WhatsApp de 24h está aberta pro lead.
 * Retorna true se o lead enviou alguma msg (direcao=in) nas últimas 24h.
 *
 * Importante: textos livres só entregam ao WhatsApp dentro dessa janela.
 * Se a janela estiver fechada no momento de uma transição de stage, os
 * avisos enviados via sendText ficam queued no painel Evo Talks mas o
 * WhatsApp bloqueia silenciosamente — daí precisamos do mecanismo de
 * reforço (Caminho 2): marcar flag de aviso pendente, e quando o lead
 * responder o webhook reenvia.
 */
async function janela24hAberta(leadId: string): Promise<boolean> {
  const { data: ultimaIn } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('enviado_em')
    .eq('lead_id', leadId)
    .eq('direcao', 'in')
    .order('enviado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!ultimaIn) return false
  const idadeMs = Date.now() - new Date(ultimaIn.enviado_em).getTime()
  return idadeMs < 24 * 60 * 60 * 1000
}

/**
 * Marca uma flag de aviso pendente em observacoes do lead.
 * Quando o lead responder, o webhook detecta a flag e reenvia os avisos
 * (que estavam queued sem entregar por causa da janela 24h fechada).
 *
 * Formato: [AVISO_50_PENDENTE:ISO] ou [AVISO_70_PENDENTE:ISO]
 */
async function marcarAvisoPendente(leadId: string, codigo: 'AVISO_49_PENDENTE' | 'AVISO_50_PENDENTE' | 'AVISO_70_PENDENTE' | 'AVISO_70KIT_PENDENTE'): Promise<void> {
  const { data: lead } = await supabaseAdmin
    .from('sdr_leads')
    .select('observacoes')
    .eq('id', leadId)
    .maybeSingle()
  const obsAtual = lead?.observacoes ?? ''
  // Remove flag anterior do mesmo código se houver, e adiciona a nova
  const obsLimpa = obsAtual.replace(new RegExp(`\\[${codigo}:[^\\]]+\\]\\s*`, 'g'), '').trim()
  const novaFlag = `[${codigo}:${new Date().toISOString()}]`
  await supabaseAdmin
    .from('sdr_leads')
    .update({ observacoes: `${novaFlag} ${obsLimpa}`.trim() })
    .eq('id', leadId)
  console.log(`Lead ${leadId}: flag ${codigo} marcada (janela 24h fechada — reforço quando lead responder)`)
}

/**
 * Envia uma lista de textos livres após um template HSM.
 *
 * O template abre o chat no Evo Talks, mas o chat pode não estar
 * imediatamente disponível em /int/getClientOpenChats. Aguarda até
 * 3s tentando obter o chatId; se encontrar, envia via sendMessageToChat
 * (sem abrir novo chat). Se não encontrar, usa sendText como fallback.
 *
 * `telefone` deve estar normalizado (com 55) para o getClientOpenChats encontrar o chat.
 */
async function sendTextsAfterTemplate(
  telefone: string,
  msgs: string[],
  knownChatId?: number | string | null
): Promise<void> {
  const phone = normalizePhoneBR(telefone)

  // Aguarda 1.5s pro Evo Talks processar o template antes de tentar enviar textos
  await new Promise(r => setTimeout(r, 1500))

  // Usa sendText com knownChatId — mesmo padrão do /api/sdr/webhook que funciona
  // (sendText prioriza sendMessageToChat com chatId conhecido, depois fallback)
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    try {
      await sendText(phone, msg, knownChatId ?? null)
      console.log(`sendTextsAfterTemplate: msg ${i + 1}/${msgs.length} enviada para ${phone} (chatId=${knownChatId ?? 'auto'})`)
      if (i < msgs.length - 1) await new Promise(r => setTimeout(r, 500))
    } catch (err) {
      console.error(`sendTextsAfterTemplate: falha ao enviar msg ${i + 1}/${msgs.length} para ${phone}:`, err)
    }
  }
}

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

  // ─── Aviso Aldo + Nei nas etapas pós-aprovação (pedido do Aldo 2026-07-16) ───
  // Roda ANTES dos handlers específicos de propósito: cada bloco abaixo pode
  // retornar cedo (telefone ausente, template não configurado, erro de API) e
  // aí o aviso nunca sairia. Aqui o alerta é o primeiro efeito — se a etapa
  // mudou, vocês ficam sabendo, aconteça o que acontecer depois.
  // Dedupe por marcador [ALERTA_ETAPA:<stage>] nas observações: se o Evo
  // reenviar o webhook da mesma etapa, não repete o aviso.
  const ETAPAS_AVISO: Record<number, { emoji: string; label: string }> = {
    [STAGES.EM_ANALISE_AIVA]: { emoji: '🔎', label: 'Em Análise AIVA' },
    [STAGES.TREINAR]: { emoji: '🎓', label: 'Treinar' },
    [STAGES.LOGIN]: { emoji: '🔑', label: 'Login' },
    [STAGES.LOJA_FINALIZADA_E_VENDENDO]: { emoji: '🏆', label: 'Loja Finalizada e Vendendo' },
  }
  const etapaAviso = ETAPAS_AVISO[stageNum]
  if (etapaAviso) {
    try {
      const oppAviso = await getOpportunity(Number(opportunityId))
      const formsAviso = (oppAviso.formsdata ?? {}) as Record<string, string | null>
      const telAviso = normalizePhoneBR((oppAviso.mainphone ?? formsAviso['db8569f0'] ?? '').toString())
      const tituloOpp = typeof oppAviso.title === 'string' ? oppAviso.title.split('—')[0].trim() : ''

      const { data: leadAviso } = telAviso
        ? await supabaseAdmin
            .from('sdr_leads')
            .select('id, nome, cidade, observacoes')
            .eq('telefone', telAviso)
            .maybeSingle()
        : { data: null }

      const marcador = `[ALERTA_ETAPA:${stageNum}]`
      const jaAvisou = (leadAviso?.observacoes ?? '').includes(marcador)

      if (!jaAvisou) {
        const nomeLoja = leadAviso?.nome && leadAviso.nome !== 'Loja' ? leadAviso.nome : tituloOpp || 'Loja'
        const msg =
          `${etapaAviso.emoji} *${nomeLoja}* (${telAviso || 'telefone n/d'}${leadAviso?.cidade ? ` — ${leadAviso.cidade}` : ''})\n` +
          `Movida para *${etapaAviso.label}* no funil AIVA.`
        if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
        if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)

        if (leadAviso?.id) {
          // Limpa marcadores de etapas anteriores pra permitir novo aviso se o
          // card voltar e avançar de novo, e grava o da etapa atual.
          const obsLimpa = (leadAviso.observacoes ?? '').replace(/\s*\[ALERTA_ETAPA:\d+\]\s*/g, ' ').trim()
          await supabaseAdmin
            .from('sdr_leads')
            .update({ observacoes: `${marcador} ${obsLimpa}`.trim() })
            .eq('id', leadAviso.id)
        }
        console.log(`[aviso-etapa] ${etapaAviso.label} avisado p/ ${telAviso} (opp #${opportunityId})`)
      } else {
        console.log(`[aviso-etapa] ${etapaAviso.label} já avisado p/ ${telAviso} — sem repetir`)
      }
    } catch (err) {
      console.error(`[aviso-etapa] falha ao avisar etapa ${stageNum} (opp #${opportunityId}):`, err)
    }
  }

  // Stage 49 — Cadastro Recebido (manual) → dispara HSM "Complete o Cadastro".
  //
  // Fluxo: operador/Eduardo aprovou a pré-análise e move manualmente o card de
  // Pré Aprovação (54) → Cadastro Recebido (49). Isso reabre a janela WhatsApp
  // via HSM template 20 e muda o status do lead pra INTERESSADO, pra
  // VictorIA retomar a conversa e coletar os 5 dados restantes.
  //
  // OBS: o HubSpot NÃO é mais disparado aqui — agora é disparado só quando a
  // VictorIA completa a Fase 3 (12 dados) no /api/sdr/webhook.
  if (stageNum === STAGES.CADASTRO_RECEBIDO) {
    try {
      const opp = await getOpportunity(Number(opportunityId))
      const forms = (opp.formsdata ?? {}) as Record<string, string | null>
      const telefone = normalizePhoneBR((opp.mainphone ?? forms['db8569f0'] ?? '').toString())

      if (!telefone) {
        console.error(`Opp #${opportunityId}: telefone não encontrado pra template Complete o Cadastro`)
        return NextResponse.json({ ok: false, erro: 'telefone_nao_encontrado' }, { status: 400 })
      }

      // Busca o lead no Supabase pra pegar nome + id + chatId + status
      // (observacoes é necessário pra anexar o marcador de Fase 3 sem apagar
      // os marcadores já existentes — o campo é append-only na prática)
      const { data: lead } = await supabaseAdmin
        .from('sdr_leads')
        .select('id, nome, evotalks_chat_id, status, observacoes')
        .eq('telefone', telefone)
        .maybeSingle()

      // Idempotência: se o lead já passou da Fase 3 (CADASTRO_RECEBIDO/EM_ANALISE_AIVA/
      // TREINAMENTO), NÃO re-dispara o HSM 20 nem volta o status pra INTERESSADO.
      // Bug que isso resolve: Nei moveu o card no Evo Talks → CRM trigger disparou
      // stage 49 de novo → re-enviou HSM "Complete o Cadastro" duplicado pro lead
      // que já completou tudo.
      const STATUS_JA_PASSOU_FASE3 = ['CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR']
      if (lead?.id && STATUS_JA_PASSOU_FASE3.includes(lead.status)) {
        console.log(`Stage 49 ignorado — lead ${telefone} já está em ${lead.status} (passou da Fase 3). Opp #${opportunityId}.`)
        return NextResponse.json({
          ok: true,
          ignorado: 'lead_ja_passou_fase_3',
          status_atual: lead.status,
        })
      }

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
      const tplResult49 = await sendTemplate(telefone, templateId, [nomeSocio, textoPadrao])

      // Texto livre listando os 5 dados que ainda faltam — orienta o lojista
      // pro que vem na Fase 3 (VictorIA vai perguntar um por um).
      const avisoComplementoMsg = buildAvisoColetandoComplementoMsg(nomeSocio)
      const chatId49 = tplResult49.chatId ?? (lead?.evotalks_chat_id ? Number(lead.evotalks_chat_id) : undefined)
      await sendTextsAfterTemplate(telefone, [avisoComplementoMsg], chatId49)

      // Muda status do lead pra INTERESSADO (se o lead existir no Supabase)
      if (lead?.id) {
        // O status volta pra INTERESSADO (o cadastro ainda não está completo),
        // mas isso o torna indistinguível de um lead de Fase 1. O marcador
        // preserva a informação de que ele JÁ FOI APROVADO — é o que faz a
        // VictorIA parar de reoferecer "pré-aprovação" a quem já passou dela.
        const obsAtual = lead.observacoes ?? ''
        const obsComFase3 = obsAtual.includes(MARCADOR_FASE3)
          ? obsAtual
          : `${obsAtual} ${MARCADOR_FASE3}${new Date().toISOString()}]`.trim()

        await supabaseAdmin
          .from('sdr_leads')
          .update({
            status: 'INTERESSADO',
            data_ultimo_contato: new Date().toISOString(),
            observacoes: obsComFase3,
            // Operador moveu o card = atendimento feito → limpa a flag de
            // "aguardando humano" (senão o lead fica eterno na fila do Nei)
            acionar_humano: false,
          })
          .eq('id', lead.id)

        await supabaseAdmin.from('sdr_mensagens').insert([
          {
            lead_id: lead.id,
            direcao: 'out',
            conteudo: `[Template Complete o Cadastro enviado — ${nomeSocio}]`,
            template_hsm: 'aiva_complete_cadastro',
          },
          {
            lead_id: lead.id,
            direcao: 'out',
            conteudo: avisoComplementoMsg,
          },
        ])

        // Caminho 2: se janela 24h fechada, marca flag pra reforço futuro
        const janelaAberta = await janela24hAberta(lead.id)
        if (!janelaAberta) {
          await marcarAvisoPendente(lead.id, 'AVISO_49_PENDENTE')
        }
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

      console.log(`Template Complete o Cadastro enviado: opp #${opportunityId} → ${telefone}, status → INTERESSADO`)
      return NextResponse.json({
        ok: true,
        template_enviado: true,
        status_atualizado: 'INTERESSADO',
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
      const telefone = normalizePhoneBR((opp.mainphone ?? forms['db8569f0'] ?? '').toString())

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
  if (stageNum === STAGES.EM_ANALISE_AIVA) {
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
      const telefone = normalizePhoneBR((opp.mainphone ?? forms['db8569f0'] ?? '').toString())
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

      // Busca o lead ANTES do template pra ter o chatId disponível pros textos seguintes
      const { data: lead } = await supabaseAdmin
        .from('sdr_leads')
        .select('id, nome, evotalks_chat_id, observacoes')
        .eq('telefone', telefone)
        .maybeSingle()

      // (TRAVA DE QSA removida em 2026-08-24 — o Nei resolveu com a AIVA.
      // Este bloco LIA o marcador [TRAVA_QSA] e fazia return ANTES do HSM de
      // aprovação: o lead ficava em Em Análise sem nunca receber o link do CAF.
      // Sem trava, todo mundo segue direto pro fluxo normal abaixo.)

      // Dispara HSM de aprovação. Template 15 "(CAMPANHA) Link de Cadastro" tem
      // 1 variável {{1}} que carrega todo o conteúdo do meio (incluindo o link).
      // Corpo do template:
      //   Bem vindo{{1}}
      //   Assim que finalizar, retorne aqui.
      const tplResult = await sendTemplate(telefone, templateId, [APROVACAO_TEMPLATE_VAR])

      // Texto livre reforçando o preenchimento completo do cadastro CAF —
      // incluindo a biometria facial obrigatória ao final.
      // Entrega no WhatsApp só quando a janela 24h está aberta (lead respondeu
      // nas últimas 24h). Se janela fechada, marcamos flag pra reforço quando
      // o lead responder (Caminho 2 — reforço via webhook).
      const avisoCadastroMsg = buildAvisoCadastroMsg(nomeContato)
      const chatIdParaTextos = tplResult.chatId ?? (lead?.evotalks_chat_id ? Number(lead.evotalks_chat_id) : undefined)
      await sendTextsAfterTemplate(telefone, [avisoCadastroMsg], chatIdParaTextos)

      // Caminho 2: se janela 24h fechada, marca flag pra reforço futuro
      if (lead?.id) {
        const janelaAberta = await janela24hAberta(lead.id)
        if (!janelaAberta) {
          await marcarAvisoPendente(lead.id, 'AVISO_50_PENDENTE')
        }
      }

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
            conteudo: avisoCadastroMsg,
          },
        ])

        // Muda status para EM_ANALISE_AIVA — VictorIA passa a responder nessa fase
        // e o cron followup-fase monitora se o lead concluiu o cadastro CAF.
        await supabaseAdmin
          .from('sdr_leads')
          .update({
            status: 'EM_ANALISE_AIVA',
            data_ultimo_contato: new Date().toISOString(),
            acionar_humano: false, // card avançou = humano já atendeu
          })
          .eq('id', lead.id)

        console.log(`Lead ${telefone}: status atualizado → EM_ANALISE_AIVA (stage 50 EM_ANALISE)`)
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
          status: 'EM_ANALISE_AIVA',
          opportunity_id: String(opportunityId),
        })
        console.log(`Google Sheets complementado: opp #${opportunityId} → stage 50`)
      } catch (err) {
        console.error(`Falha ao complementar Google Sheets no stage 50 (opp #${opportunityId}):`, err)
      }

      console.log(`Template link cadastro + aviso matriz enviados: opp #${opportunityId} → ${telefone}`)
      return NextResponse.json({ ok: true, template_enviado: true, aviso_matriz_enviado: true, google_sheets: true, status_atualizado: 'EM_ANALISE_AIVA', telefone })
    } catch (err) {
      console.error('Erro ao enviar template de aprovação:', err)
      return NextResponse.json({ ok: false, erro: 'template_error' }, { status: 500 })
    }
  }

  // Stage 70 — Treinar → dispara template [AIVA] TREINAMENTO (id 25) + envia
  // links de reunião online, materiais e formulário de cadastro dos funcionários.
  //
  // Fluxo: Nei move o card de EM_ANALISE_AIVA → Treinar após a loja ser aprovada
  // pela AIVA. O template HSM reabre a janela WhatsApp e os textos seguintes
  // entregam os 3 links necessários pro lojista dar início ao treinamento.
  if (stageNum === STAGES.TREINAR) {
    try {
      const opp = await getOpportunity(Number(opportunityId))
      const forms = (opp.formsdata ?? {}) as Record<string, string | null>
      const telefone = normalizePhoneBR((opp.mainphone ?? forms['db8569f0'] ?? '').toString())

      if (!telefone) {
        console.error(`Opp #${opportunityId}: telefone não encontrado para template Treinamento`)
        return NextResponse.json({ ok: false, erro: 'telefone_nao_encontrado' }, { status: 400 })
      }

      // Busca lead no Supabase
      const { data: lead } = await supabaseAdmin
        .from('sdr_leads')
        .select('id, nome')
        .eq('telefone', telefone)
        .maybeSingle()

      const nomeContato = normalizaNome(forms['da6ddf70']) || normalizaNome(lead?.nome ?? null) || 'Lojista'

      // Template HSM 69 — [AIVA] Treinamento Completo (UTILITY, aprovado).
      // Substitui o antigo fluxo "template 28 + 3 textos livres": os links
      // (reunião, materiais e cadastro) agora vão DENTRO do HSM, então entregam
      // mesmo com a janela de 24h FECHADA (lead frio). Não dependemos mais de
      // texto livre nem de reforço na resposta pra entregar os links.
      //
      // O template tem 5 variáveis de corpo ({{1}}..{{5}}):
      //   {{1}} = Nome do Cliente (dinâmico)
      //   {{2}}..{{5}} = texto fixo (treinamento, reunião, materiais, cadastro)
      // Enviar menos que 5 causa #131008 (Meta: "parameter is missing text value").
      const TREINAMENTO_TEMPLATE_ID = 69
      await sendTemplate(telefone, TREINAMENTO_TEMPLATE_ID, [
        nomeContato,
        '🎓 Treinamento: temos turmas ao vivo às segundas e quintas, das 9h30 às 10h30 — participa da próxima! O vídeo Curso_Treinamento na pasta de materiais adianta o aprendizado.',
        '🔗 Reunião — cada dia tem seu link: segundas https://meet.google.com/gdh-ppvw-nmp | quintas https://meet.google.com/hqn-vcrr-dxo',
        '📚 Materiais (documentos e vídeos): https://drive.google.com/drive/folders/1t0WpRYg7b5TIb7Hbbkjg9oyMI1bGXe-w',
        '🔑 Acessos: o SEU login (sócio) chega automático no WhatsApp pelo número +55 21 4020-2024 depois do treinamento. Logins dos vendedores: você solicita no chat dentro da plataforma (opção Cadastrar/Remover Usuário — senha por SMS em até 48h úteis).',
      ])

      // Atualiza status no Supabase e registra histórico
      if (lead?.id) {
        await supabaseAdmin
          .from('sdr_leads')
          .update({
            status: 'TREINAR',
            data_ultimo_contato: new Date().toISOString(),
            acionar_humano: false, // card avançou = humano já atendeu
          })
          .eq('id', lead.id)

        await supabaseAdmin.from('sdr_mensagens').insert({
          lead_id: lead.id,
          direcao: 'out',
          conteudo: `[Template [AIVA] Treinamento Completo enviado — ${nomeContato}]`,
          template_hsm: 'aiva_treinamento_completo',
        })

        // Kit pós-fechamento (curadoria 2026-07-27): resumo comercial (taxa 12%,
        // regra dos 15%, repasse D+2, zero inadimplência) + próximos passos.
        // Texto livre → só entrega com a janela 24h aberta; se fechada, marca
        // flag e o webhook reenvia quando o lead responder (Caminho 2).
        try {
          const kitMsg = buildKitPosFechamentoMsg(nomeContato)
          const janelaAberta = await janela24hAberta(lead.id)
          if (janelaAberta) {
            await sendText(telefone, kitMsg)
            await supabaseAdmin.from('sdr_mensagens').insert({
              lead_id: lead.id,
              direcao: 'out',
              conteudo: kitMsg,
            })
            console.log(`Lead ${lead.id}: kit pós-fechamento enviado (janela aberta)`)
          } else {
            await marcarAvisoPendente(lead.id, 'AVISO_70KIT_PENDENTE')
          }
        } catch (err) {
          console.error(`Lead ${lead.id}: falha ao enviar kit pós-fechamento:`, err)
        }
      }

      // (O aviso 🎓 pro Aldo/Nei já saiu no bloco ETAPAS_AVISO, no topo do handler
      // — antes de qualquer validação que pudesse abortar. Não repetir aqui.)

      console.log(`Template Treinamento + links enviados: opp #${opportunityId} → ${telefone}, status → TREINAMENTO`)
      return NextResponse.json({
        ok: true,
        template_enviado: true,
        links_enviados: true,
        status_atualizado: 'TREINAR',
        telefone,
      })
    } catch (err) {
      console.error('Erro ao disparar template Treinamento:', err)
      return NextResponse.json({ ok: false, erro: 'template_error' }, { status: 500 })
    }
  }

  // Stage 51 — Loja Finalizada e Vendendo → inicia o RELÓGIO da Consultoria de Vendas.
  // NÃO conversa agora: a loja acabou de ativar e ainda não vendeu. Só registra a
  // data de entrada; o cron /api/sdr/consultoria-vendas dispara a 1ª abordagem em
  // D+7 e depois a cada 15 dias (4 toques no total). Marca [CONSULTORIA_INICIO] e
  // [CONSULTORIA_COUNT:0] em observacoes (idempotente — não reinicia se já existe).
  if (stageNum === STAGES.LOJA_FINALIZADA_E_VENDENDO) {
    try {
      const opp = await getOpportunity(Number(opportunityId))
      const forms = (opp.formsdata ?? {}) as Record<string, string | null>
      const telefone = normalizePhoneBR((opp.mainphone ?? forms['db8569f0'] ?? '').toString())

      if (!telefone) {
        return NextResponse.json({ ok: false, erro: 'telefone_nao_encontrado' }, { status: 400 })
      }

      const { data: lead } = await supabaseAdmin
        .from('sdr_leads')
        .select('id, observacoes')
        .eq('telefone', telefone)
        .maybeSingle()

      if (lead?.id) {
        const obsAtual = lead.observacoes ?? ''
        const jaIniciou = /\[CONSULTORIA_INICIO:/.test(obsAtual)
        const novaObs = jaIniciou
          ? obsAtual
          : `${obsAtual.trim()} [CONSULTORIA_INICIO:${new Date().toISOString()}] [CONSULTORIA_COUNT:0]`.trim()
        await supabaseAdmin
          .from('sdr_leads')
          .update({ status: 'LOJA_FINALIZADA_E_VENDENDO', observacoes: novaObs, acionar_humano: false })
          .eq('id', lead.id)
        console.log(`Stage 51: relógio da consultoria ${jaIniciou ? 'já existia' : 'iniciado'} p/ ${telefone} (opp #${opportunityId})`)
      }

      // Conta-espelho no funil Contas fechadas MRR (pedido do Aldo 26/08/2026).
      // Toda loja que chega em Loja Finalizada e Vendendo ganha uma conta no
      // funil 11. Dupla proteção contra duplicata: marcador [MRR_OPP:id] no
      // lead e varredura por telefone dentro do criarContaMrr. Fail-soft — a
      // conta MRR nunca pode derrubar o registro da consultoria acima.
      let contaMrr: number | null = null
      try {
        const jaTemMarcador = /\[MRR_OPP:\d+\]/.test(lead?.observacoes ?? '')
        if (!jaTemMarcador) {
          const cnpj =
            (lead?.observacoes ?? '').match(/cnpj_matriz=([\d.\/-]{14,18})/)?.[1]?.replace(/\D/g, '') ??
            (lead?.observacoes ?? '').match(/CNPJ_RECEITA:cnpj=(\d{14})/)?.[1] ??
            (forms['dd2ab580'] ?? '').replace(/\D/g, '') ??
            null
          const r = await criarContaMrr({
            titulo: (opp.title ?? '').toString() || telefone,
            telefone,
            cnpj: cnpj && cnpj.length === 14 ? cnpj : null,
            origemOppId: Number(opportunityId),
          })
          if (r) {
            contaMrr = r.id
            if (lead?.id) {
              const { data: leadFresco } = await supabaseAdmin
                .from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
              await supabaseAdmin
                .from('sdr_leads')
                .update({ observacoes: `${(leadFresco?.observacoes ?? '').trim()} [MRR_OPP:${r.id}]`.trim() })
                .eq('id', lead.id)
            }
            console.log(`Stage 51: conta MRR ${r.jaExistia ? 'já existia' : 'criada'} — #${r.id} (opp origem #${opportunityId})`)
          }
        }
      } catch (err) {
        console.error(`Stage 51: falha ao criar conta MRR pra opp #${opportunityId} (segue sem):`, err)
      }

      return NextResponse.json({ ok: true, consultoria: 'relogio_registrado', telefone, conta_mrr: contaMrr })
    } catch (err) {
      console.error('Erro ao registrar consultoria (stage 51):', err)
      return NextResponse.json({ ok: false, erro: 'consultoria_error' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, ignorado: `stage ${destStageId} sem ação configurada` })
}
