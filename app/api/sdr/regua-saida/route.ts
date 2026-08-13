/**
 * regua-saida/route.ts (AIVA — saída do INTERESSADO esgotado)
 *
 * Pedido do Aldo 2026-08-03: lead INTERESSADO que esgotou TODA a régua de
 * recuperação (reativação 48h + 3 reengajamentos personalizados) e continua
 * mudo há 15+ dias não fica mais parado inflando a etapa — volta pra
 * SEM_RESPOSTA e re-entra na cadência de HSM (D+7 / D+14; sem resposta → o
 * fluxo normal descarta).
 *
 * Critérios (todos obrigatórios):
 *   - status INTERESSADO, produto AIVA
 *   - 3+ marcadores [REENGAJAMENTO:] (régua esgotada)
 *   - sem atividade há 15+ dias (data_ultimo_contato)
 *   - última mensagem é NOSSA (bola com o lead) — se a última for dele,
 *     quem falhou fomos nós; não rebaixa
 *   - sem pausa vigente, sem acionar_humano, sem [REGUA_SAIDA:] anterior
 *
 * IMPORTANTE: move o card no Evo pra etapa 53 (Interessado Sem resposta)
 * ANTES de mudar o status local — o sync-from-evo trata o Evo como fonte da
 * verdade e desfaria a mudança se o card ficasse em Interessado (47).
 *
 * Params: ?dry=true (preview) | ?max=N (default 40)
 * Schedule: 30 13 * * 1-5 (10h30 BRT, dias úteis)
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { changeOpportunityStage, STAGES } from '@/lib/evotalks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DIA_MS = 24 * 60 * 60 * 1000
const DIAS_MUDO = 15
const REENG_MIN = 3

export async function GET(req: NextRequest) {
  return POST(req)
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === 'true'
  const max = Math.min(Number(url.searchParams.get('max')) || 40, 100)

  const agora = Date.now()
  const corte = new Date(agora - DIAS_MUDO * DIA_MS).toISOString()

  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, observacoes, data_ultimo_contato, evotalks_opportunity_id')
    .eq('status', 'INTERESSADO')
    .eq('produto', 'AIVA')
    .eq('acionar_humano', false)
    .lt('data_ultimo_contato', corte)
    .order('data_ultimo_contato', { ascending: true })
    .limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const candidatos = (leads ?? []).filter((l) => {
    const obs = l.observacoes ?? ''
    if (obs.includes('[REGUA_SAIDA')) return false
    const pausa = obs.match(/\[PAUSA_ATE:([^\]]+)\]/)
    if (pausa && Date.parse(pausa[1]) > agora) return false
    const reeng = (obs.match(/\[REENGAJAMENTO:/g) ?? []).length
    return reeng >= REENG_MIN
  }).slice(0, max)

  let movidos = 0
  let semOpp = 0
  let bolaConosco = 0
  let falhas = 0
  const preview: Array<{ nome: string; telefone: string }> = []

  for (const lead of candidatos) {
    // Última mensagem precisa ser nossa (o lead é quem sumiu)
    const { data: ultMsg } = await supabaseAdmin
      .from('sdr_mensagens')
      .select('direcao')
      .eq('lead_id', lead.id)
      .order('enviado_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ultMsg?.direcao === 'in') { bolaConosco++; continue }

    if (dry) { preview.push({ nome: lead.nome, telefone: lead.telefone }); continue }

    try {
      // 1. Move o card no Evo primeiro — se falhar, não rebaixa (o sync reverteria)
      if (lead.evotalks_opportunity_id) {
        await changeOpportunityStage(Number(lead.evotalks_opportunity_id), STAGES.SEM_RESPOSTA)
      } else {
        semOpp++
      }
      // 2. Rebaixa local + re-entra na cadência (D+7 daqui a 7 dias)
      await supabaseAdmin
        .from('sdr_leads')
        .update({
          status: 'SEM_RESPOSTA',
          etapa_cadencia: 7,
          data_proximo_followup: new Date(agora + 7 * DIA_MS).toISOString(),
          observacoes: `${(lead.observacoes ?? '').trim()} [REGUA_SAIDA:${new Date().toISOString()}]`.trim(),
        })
        .eq('id', lead.id)
      movidos++
    } catch (err) {
      falhas++
      console.error(`[REGUA_SAIDA] Falha pra ${lead.telefone}:`, err)
    }
  }

  return NextResponse.json({
    ok: true,
    dry,
    candidatos: candidatos.length,
    movidos,
    pulados_bola_conosco: bolaConosco,
    sem_opp: semOpp,
    falhas,
    ...(dry ? { preview: preview.slice(0, 20) } : {}),
  })
}
