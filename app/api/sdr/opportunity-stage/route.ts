import { NextRequest, NextResponse } from 'next/server'
import { getOpportunity, sendToHubSpot, sendToGoogleSheets, sendTemplate, sendText, STAGES } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'

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

  // Stage 54 — Pré Aprovação → envia dados pra planilha AIVA APROVAÇÃO
  // Usado quando o time preenche manualmente os dados no CRM a partir de um
  // lead INTERESSADO e move pra Pré Aprovação (fluxo manual, sem passar pelo chat).
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
      const varTemplate =
        ', sua loja foi aprovada pela Aiva! Preencha esse seu cadastro atraves do link ' +
        'https://retail-onboarding-hub.vercel.app/onboarding/full'
      await sendTemplate(telefone, templateId, [varTemplate])

      // Aviso complementar sobre CNPJ matriz/filial (não está no template HSM).
      // Enviado como texto livre — janela de 24h já foi aberta pelo template acima.
      const saudacao = nomeContato ? `${nomeContato}, uma` : 'Olá! Uma'
      const avisoMatrizMsg =
        `${saudacao} dica rápida pra agilizar seu cadastro:\n\n` +
        `Quantas lojas você vai cadastrar na AIVA?\n\n` +
        `*Se for só 1 loja*: pode seguir direto no link, é um cadastro só.\n\n` +
        `*Se forem 2 ou mais*: preciso saber se elas têm CNPJs totalmente diferentes (são matrizes independentes) ou se são filiais da mesma empresa (mesmo CNPJ com finais diferentes tipo 0001, 0002).\n\n` +
        `- *Matrizes diferentes*: um cadastro para cada CNPJ raiz\n` +
        `- *Filiais do mesmo CNPJ*: um cadastro só cobre todas\n\n` +
        `Me conta aqui quantas lojas você tem antes de começar, que eu te oriento no caminho certo. Assim evitamos retrabalho.`

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
            conteudo: `[Template (CAMPANHA) Link de Cadastro enviado — ${nomeContato ?? 'Lojista'}]`,
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

/**
 * Normaliza o nome do sócio:
 * - Pega só o primeiro nome
 * - Capitaliza a primeira letra, resto minúsculas
 * - Retorna null se for inválido (vazio, curto, só numeros, repetido, palavra de teste)
 */
function normalizaNome(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length < 2) return null

  // Pega só o primeiro "token" (primeiro nome)
  const primeiro = trimmed.split(/\s+/)[0]
  if (!primeiro || primeiro.length < 2) return null

  // Rejeita se for só números
  if (/^\d+$/.test(primeiro)) return null

  // Rejeita se todas as letras forem iguais (ex: "aaaa", "xxxx")
  if (/^(.)\1+$/i.test(primeiro)) return null

  // Rejeita palavras comuns de teste/genéricas
  const invalidos = new Set([
    'teste', 'test', 'asdf', 'qwerty', 'lojista', 'loja',
    'xxx', 'aaa', 'nome', 'cliente', 'usuario', 'varejo',
  ])
  if (invalidos.has(primeiro.toLowerCase())) return null

  // Capitaliza: primeira letra maiúscula, resto minúsculas
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
}
