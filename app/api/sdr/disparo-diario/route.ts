/**
 * disparo-diario/route.ts (AIVA) — o disparo D+0 de 500/dia, sem depender do PC do Aldo.
 *
 * Até 11/10/2026 o lote saía de `scripts/disparar-fila.mjs`, rodado na mão. Agora o
 * cron chama esta rota de hora em hora e CADA rodada decide sozinha (lib/disparo-diario-calc):
 * fora da janela/fim de semana/pausado → nada; entrega da Meta abaixo do piso → PAUSA e
 * avisa Aldo+Nei (só /retomar destrava); senão manda o que sobrou do orçamento do dia,
 * em lotes de 5, parando aos 240 s. A rodada seguinte continua de onde parou.
 *
 * Toda a orquestração mora em `lib/disparo-diario.ts` (`rodada`); a rota só autentica.
 * Params (rodada MANUAL — o cron chama sem parâmetro): ?dry (decisão sem enviar nada,
 * pela MESMA decidirRodada) · ?qtd=N (limita a rodada, nunca acima do restante do dia).
 * Schedule (vercel.json, Task 4): GET obrigatório — cron da Vercel chama por GET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { flag } from '@/lib/req-flags'
import { rodada } from '@/lib/disparo-diario'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function executar(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dry = flag(url.searchParams, 'dry')
  const q = url.searchParams.get('qtd')
  const qtd = q === null ? null : Math.max(0, Math.floor(Number(q) || 0))

  try {
    return NextResponse.json({ ...(await rodada({ dry, qtd })), ...(dry ? { dry: true } : {}) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[disparo-diario] rodada falhou:', msg)
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  }
}

export const GET = executar
export const POST = executar
