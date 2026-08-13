/**
 * auto-descarte/route.ts
 *
 * Cron dedicado à higiene de funil — move leads estagnados pro próximo estado.
 *
 * Regras:
 *   INICIO + 15d (sem virar INTERESSADO) → SEM_RESPOSTA
 *   SEM_RESPOSTA + 30d                              → DESCARTADO
 *   INTERESSADO + 21d sem mensagem do lead          → AGUARDANDO
 *
 * Resolve o bug observado em 28/05/2026: 1.749 leads parados em
 * INICIO + 322 em SEM_RESPOSTA com mais de 30 dias, sem ciclo
 * de saída automático. Os crons existentes (followup/reativacao/nudge)
 * não tinham o passo final de descarte.
 *
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET
 * Cron: 0 13 * * 1-5  (10h BRT seg-sex — antes dos outros crons da cadência)
 * Tempo: ~2s (só DB, sem chamadas externas)
 *
 * Idempotente: rodar 2x no mesmo dia não causa efeito colateral
 * (na 2ª rodada não tem mais leads pra mover).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isDiaUtil, rotuloHorario } from '@/lib/business-time'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// O Vercel Cron dispara GET. Sem este handler a rota respondia 405 e a higiene
// de funil NUNCA rodou pelo cron (bug encontrado em 10/08/2026, junto com o
// mesmo defeito no /followup) — daí a etapa Início ter inchado até 2.084 leads.
export async function GET(req: NextRequest) {
  return POST(req)
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const okAuth =
    auth === `Bearer ${process.env.WEBHOOK_SECRET}` ||
    auth === `Bearer ${process.env.CRON_SECRET}`
  if (!okAuth) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const ts = new Date().toISOString()

  // Skip silencioso em fim de semana
  if (!isDiaUtil()) {
    return NextResponse.json({
      ok: true,
      ts,
      ignorado: 'fim_de_semana',
      quando: rotuloHorario(),
    })
  }

  const d15ago = new Date(Date.now() - 15 * 86_400_000).toISOString()
  const d30ago = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const d21ago = new Date(Date.now() - 21 * 86_400_000).toISOString()

  try {
    // 1) INICIO + 15d → SEM_RESPOSTA
    //
    // NÃO mexe mais em etapa_cadencia (antes forçava 7). O forçar-7 fazia sentido
    // quando a cadência rodava: aos 15 dias o lead já teria recebido o D+3. Com o
    // cron morto (405) desde sempre, ninguém recebeu D+3 — forçar 7 aqui APAGARIA
    // esse toque de ~2.000 leads. Quem manda na etapa é a régua (/followup).
    const r1 = await supabaseAdmin
      .from('sdr_leads')
      .update({ status: 'SEM_RESPOSTA' })
      .eq('produto', 'AIVA')
      .eq('status', 'INICIO')
      .lt('data_disparo_inicial', d15ago)
      .select('id')

    // 1b) Etapa 1 é inválida pra régua (não existe template D+1): sobe pro D+3
    // pra esses leads não ficarem órfãos rodando em falso todo dia.
    await supabaseAdmin
      .from('sdr_leads')
      .update({ etapa_cadencia: 3 })
      .eq('produto', 'AIVA')
      .eq('status', 'SEM_RESPOSTA')
      .lt('etapa_cadencia', 3)
      .select('id')

    // 2) SEM_RESPOSTA + 30d → DESCARTADO
    //
    // SÓ descarta quem já ESGOTOU a cadência. `data_proximo_followup is null` é a
    // marca de ciclo encerrado: a régua zera esse campo ao mandar o D+14 (e ao
    // achar número sem WhatsApp). Sem essa trava, esta regra descartaria em massa
    // os leads que estão na fila esperando D+3/D+7/D+14 — justamente os que a
    // gente quer reengajar — antes de a régua chegar neles (ela roda 1h depois).
    const r2 = await supabaseAdmin
      .from('sdr_leads')
      .update({ status: 'DESCARTADO' })
      .eq('produto', 'AIVA')
      .eq('status', 'SEM_RESPOSTA')
      .lt('data_disparo_inicial', d30ago)
      .is('data_proximo_followup', null)
      .select('id')

    // 3) INTERESSADO + 21d sem msg do lead → AGUARDANDO
    const r3 = await supabaseAdmin
      .from('sdr_leads')
      .update({ status: 'AGUARDANDO' })
      .eq('produto', 'AIVA')
      .eq('status', 'INTERESSADO')
      .lt('data_ultimo_contato', d21ago)
      .select('id')

    const movidos_1 = r1.data?.length ?? 0
    const movidos_2 = r2.data?.length ?? 0
    const movidos_3 = r3.data?.length ?? 0

    if (r1.error || r2.error || r3.error) {
      console.error('[auto-descarte] erros:', r1.error, r2.error, r3.error)
    }

    console.log(
      `[auto-descarte] ${ts} → ` +
        `disparo→sem_resp=${movidos_1}, sem_resp→descartado=${movidos_2}, ` +
        `interessado→aguardando=${movidos_3}`
    )

    return NextResponse.json({
      ok: true,
      ts,
      quando: rotuloHorario(),
      disparo_to_sem_resposta: movidos_1,
      sem_resposta_to_descartado: movidos_2,
      interessado_to_aguardando: movidos_3,
      erros: [r1.error, r2.error, r3.error]
        .filter(Boolean)
        .map((e) => e!.message),
    })
  } catch (err) {
    console.error('[auto-descarte] erro fatal:', err)
    return NextResponse.json(
      { ok: false, ts, erro: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
