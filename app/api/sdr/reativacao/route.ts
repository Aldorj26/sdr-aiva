import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, saveMensagem, type Lead } from '@/lib/supabase'
import { sendTemplate } from '@/lib/evotalks'
import { isDiaUtil, isHorarioComercial, rotuloHorario } from '@/lib/business-time'
import { normalizaNome } from '@/lib/text'

export const maxDuration = 60

const MAX_POR_EXECUCAO_DEFAULT = 20

/**
 * Cron de reativação — dispara template HSM pra leads INTERESSADO que
 * ficaram parados entre 48h e 7 dias sem nenhuma mensagem do lojista.
 *
 * Template HSM 21 "AIVA Reativação Interessado 48h":
 *   "Olá {{1}}! Conversamos aqui sobre a AIVA... Posso tirar mais alguma dúvida?"
 *
 * Regras:
 * - Só dias úteis, horário comercial (usa lib/business-time).
 * - Janela 48h–7 dias (não cutuca lead muito antigo — gasta HSM à toa).
 * - Flag [REATIVACAO_ENVIADA:timestamp] nas observações evita reenvio.
 * - Limita 20 por execução pra não estourar rate limit do Evo Talks.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Guarda dia útil + horário comercial
  if (!isDiaUtil()) {
    return NextResponse.json({ ok: true, ignorado: 'fim_de_semana', quando: rotuloHorario() })
  }
  if (!isHorarioComercial()) {
    return NextResponse.json({ ok: true, ignorado: 'fora_horario_comercial', quando: rotuloHorario() })
  }

  const templateId = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
  if (!templateId) {
    return NextResponse.json(
      { error: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' },
      { status: 500 }
    )
  }

  // Query params opcionais pra rodadas manuais/bulk:
  //   ?diasMin=2      (default 2 = 48h)
  //   ?diasMax=30     (default 7)
  //   ?max=100        (default 20)
  const url = new URL(req.url)
  const diasMin = Number(url.searchParams.get('diasMin')) || 2
  const diasMax = Number(url.searchParams.get('diasMax')) || 7
  const MAX_POR_EXECUCAO = Math.min(Number(url.searchParams.get('max')) || MAX_POR_EXECUCAO_DEFAULT, 100)
  const statusesParam = url.searchParams.get('statuses')
  const statuses = statusesParam
    ? statusesParam.split(',').map((s) => s.trim()).filter(Boolean)
    : ['INTERESSADO']
  // Se true, só pega leads que têm pelo menos 1 msg 'in' real no histórico.
  // Útil pra SEM_RESPOSTA — evita mandar "conversamos" pra quem nunca respondeu.
  const exigeMsgReal = url.searchParams.get('exigeMsgReal') === 'true'

  // RPC filtra tudo de uma vez — só volta leads elegíveis (status + janela +
  // sem flag + exigeMsgReal + última msg não é 'in'). Evita loop em 300+ leads.
  const { data: candidatos, error } = await supabaseAdmin.rpc('get_leads_reativacao', {
    p_statuses: statuses,
    p_dias_min: diasMin,
    p_dias_max: diasMax,
    p_exige_msg_real: exigeMsgReal,
    p_limit: MAX_POR_EXECUCAO,
  })

  if (error) {
    console.error('[reativacao] erro ao buscar leads:', error)
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  }

  if (!candidatos?.length) {
    return NextResponse.json({ ok: true, processados: 0, mensagem: 'Nenhum lead elegível' })
  }

  let enviados = 0
  let falha = 0

  for (const lead of candidatos as Lead[]) {
    try {

      // Template 21 "Follow Up Aiva" tem 2 parâmetros:
      //   {{1}} = Nome do Cliente (sem valor padrão)
      //   {{2}} = miolo do texto (com valor padrão configurado no Evo Talks)
      //
      // Meta REJEITA variável vazia (erro 131008 "Parameter of type text is
      // missing text value"), então:
      //   - {{1}}: se não tem nome real, usa fallback "lojista"
      //   - {{2}}: envia o texto padrão explícito (não confia no Evo Talks
      //     aplicar o "Valor padrão" sozinho — segurança em profundidade)
      const nomeNorm = normalizaNome(lead.nome)
      const temNomeReal = nomeNorm && lead.nome !== 'Loja' && lead.nome !== 'Lead'
      const nomeBase = temNomeReal ? (nomeNorm as string) : 'lojista'
      const textoMiolo = 'Conversamos aqui sobre a AIVA, o crediário pra lojas de celular, e você ficou interessado'

      await sendTemplate(lead.telefone, templateId, [nomeBase, textoMiolo])

      // Marca flag nas observações (preserva [PAUSA_ATE] e [AUTO_DETECTED])
      const obsBase = (lead.observacoes ?? '').replace(/\s*\[REATIVACAO_ENVIADA:[^\]]+\]/, '')
      const novaObs = `${obsBase} [REATIVACAO_ENVIADA:${new Date().toISOString()}]`.trim()

      await supabaseAdmin
        .from('sdr_leads')
        .update({
          observacoes: novaObs,
          data_ultimo_contato: new Date().toISOString(),
        })
        .eq('id', lead.id)

      await saveMensagem(
        lead.id,
        'out',
        `[Template Reativação Interessado 48h enviado — ${nomeBase || 'sem nome'}]`,
        'aiva_reativacao_48h'
      )

      console.log(`[reativacao] enviado pra ${lead.nome} (${lead.telefone})`)
      enviados++
    } catch (err) {
      console.error(`[reativacao] erro lead ${lead.telefone}:`, err)
      falha++
    }
  }

  return NextResponse.json({
    ok: true,
    candidatos: candidatos.length,
    enviados,
    falha,
    limite_execucao: MAX_POR_EXECUCAO,
  })
}

// Cron Vercel — aceita GET com Bearer CRON_SECRET também
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  return POST(
    new NextRequest(req.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.WEBHOOK_SECRET}` },
    })
  )
}
