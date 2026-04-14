import { NextRequest, NextResponse } from 'next/server'
import { getOpportunity, sendToHubSpot, sendTemplate, sendText, STAGES } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * Webhook chamado pelo Evo Talks quando uma oportunidade muda de etapa.
 * - Stage CADASTRO_RECEBIDO (49) → envia dados para o HubSpot
 * - Stage EM_ANALISE (50) "Em Análise CAF" → dispara template de aprovação AIVA
 *   com link de onboarding completo (retail-onboarding-hub).
 */
export async function POST(req: NextRequest) {
  // Valida autenticação
  const secret = req.headers.get('x-internal-secret') ?? ''
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const payload = await req.json()

  // Extrai dados do payload do Evo Talks
  const opportunityId = payload.opportunityId ?? payload.id ?? payload.opportunity?.id ?? null
  const destStageId = payload.destStageId ?? payload.stageId ?? payload.fkStage ?? payload.opportunity?.fkStage ?? null

  console.log(`Opportunity stage webhook: oppId=${opportunityId}, stageId=${destStageId}`)

  if (!opportunityId) {
    return NextResponse.json({ ok: false, erro: 'opportunityId não encontrado' }, { status: 400 })
  }

  const stageNum = Number(destStageId)

  // Stage 49 — Cadastro Recebido → HubSpot
  if (stageNum === STAGES.CADASTRO_RECEBIDO) {
    try {
      const opp = await getOpportunity(Number(opportunityId))
      const forms = (opp.formsdata ?? {}) as Record<string, string | null>

      await sendToHubSpot({
        nome_socio: forms['da6ddf70'],
        email_socio: forms['dafa40f0'],
        telefone: forms['db8569f0'],
        nome_varejo: forms['dcacfa00'],
        cnpj_matriz: forms['dd2ab580'],
        faturamento_anual: forms['ddb960f0'],
        valor_boleto_mensal: forms['de2cbc30'],
        regiao_varejo: forms['dede58f0'],
        numero_lojas: forms['df6f9c70'],
        localizacao_lojas: forms['e0099280'],
        possui_outra_financeira: forms['e07d62f0'],
        cnpjs_adicionais: forms['e0f66380'],
      })

      console.log(`HubSpot: dados enviados para oportunidade #${opportunityId}`)
      return NextResponse.json({ ok: true, hubspot: true })
    } catch (err) {
      console.error('Erro ao enviar para HubSpot:', err)
      return NextResponse.json({ ok: false, erro: 'hubspot_error' }, { status: 500 })
    }
  }

  // Stage 50 — Em Análise CAF → dispara template de aprovação AIVA
  if (stageNum === STAGES.EM_ANALISE) {
    try {
      const opp = await getOpportunity(Number(opportunityId))
      const forms = (opp.formsdata ?? {}) as Record<string, string | null>

      // Nome do contato (preferimos nome do sócio; fallback para título da opp)
      const nomeContato =
        forms['da6ddf70'] ||
        (typeof opp.title === 'string' ? opp.title.split('—')[0].trim() : '') ||
        'Lojista'

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
      const varTemplate =
        ', sua loja foi aprovada pela Aiva! Preencha esse seu cadastro atraves do link ' +
        'https://retail-onboarding-hub.vercel.app/onboarding/full'
      await sendTemplate(telefone, templateId, [varTemplate])

      // Aviso complementar sobre CNPJ matriz/filial (não está no template HSM).
      // Enviado como texto livre — janela de 24h já foi aberta pelo template acima.
      const avisoMatrizMsg =
        `${nomeContato}, um aviso importante sobre o cadastro:\n\n` +
        `Se você tem mais de uma loja com CNPJ *matriz* (cada uma com raiz de CNPJ diferente), precisa fazer um cadastro para cada matriz. Filiais (mesma raiz de CNPJ) não precisam de cadastro separado.\n\n` +
        `Qualquer dúvida durante o preenchimento, pode me chamar aqui.`

      try {
        await sendText(telefone, avisoMatrizMsg)
      } catch (err) {
        console.error(`Falha ao enviar aviso CNPJ matriz para ${telefone}:`, err)
      }

      // Registra no histórico do lead
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
            conteudo: `[Template (CAMPANHA) Link de Cadastro enviado — ${nomeContato}]`,
            template_hsm: 'aiva_link_cadastro',
          },
          {
            lead_id: lead.id,
            direcao: 'out',
            conteudo: avisoMatrizMsg,
          },
        ])
      }

      console.log(`Template link cadastro + aviso matriz enviados: opp #${opportunityId} → ${telefone}`)
      return NextResponse.json({ ok: true, template_enviado: true, aviso_matriz_enviado: true, telefone })
    } catch (err) {
      console.error('Erro ao enviar template de aprovação:', err)
      return NextResponse.json({ ok: false, erro: 'template_error' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, ignorado: `stage ${destStageId} sem ação configurada` })
}
