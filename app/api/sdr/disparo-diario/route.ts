/**
 * disparo-diario/route.ts (AIVA) — o disparo D+0 de 500/dia, sem depender do PC do Aldo.
 *
 * Até 11/10/2026 o lote saía de `scripts/disparar-fila.mjs`, rodado na mão. Agora o
 * cron chama esta rota de hora em hora e CADA rodada decide sozinha (lib/disparo-diario-calc):
 * fora da janela/fim de semana/pausado → nada; entrega da Meta abaixo do piso → PAUSA e
 * avisa Aldo+Nei (só /retomar destrava); senão manda o que sobrou do orçamento do dia,
 * em lotes de 5, parando aos 240 s. A rodada seguinte continua de onde parou.
 *
 * Toda a orquestração mora em `lib/disparo-diario.ts` (`rodada`); a rota autentica (segredo ausente
 * nunca autentica) e vigia o relógio: rodada pendurada aos 262 s alerta e devolve 500 `travou`.
 * Params (rodada MANUAL — o cron chama sem parâmetro): ?dry (decisão sem enviar nada,
 * pela MESMA decidirRodada) · ?qtd=N (limita a rodada, nunca acima do restante do dia).
 * Schedule (vercel.json, Task 4): GET obrigatório — cron da Vercel chama por GET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { flag } from '@/lib/req-flags'
import { rodada } from '@/lib/disparo-diario'
import { avisarEquipe } from '@/lib/alerta-equipe'
import { chaveQuebrou, textoQuebrou, teaserQuebrou } from '@/lib/disparo-diario-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Vigia da própria rodada. O teto interno é 240 s (lotes) e o resumo/alerta ainda levam até ~35 s,
 *  mas uma chamada que PENDURA (Supabase/Evo sem timeout) passa direto por todos os tetos e a Vercel
 *  mata a função aos 300 s SEM log, SEM alerta e SEM resposta. Aos 262 s o watchdog ganha a corrida e
 *  ainda sobram ~38 s para o `avisarEquipe` (prazo geral de 35 s) antes do corte. */
const WATCHDOG_MS = 262_000

async function executar(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  // `Bearer undefined` não pode abrir a porta: segredo não configurado (env ausente) NÃO autentica.
  const webhookOk = !!process.env.WEBHOOK_SECRET && auth === `Bearer ${process.env.WEBHOOK_SECRET}`
  const cronOk = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  if (!webhookOk && !cronOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dry = flag(url.searchParams, 'dry')
  const q = url.searchParams.get('qtd')
  const qtd = q === null ? null : Math.max(0, Math.floor(Number(q) || 0))

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const watchdog = new Promise<'travou'>((resolve) => { timer = setTimeout(() => resolve('travou'), WATCHDOG_MS) })
    // Promise.race segue escutando a rodada perdedora: se ela rejeitar depois, não vira rejeição solta.
    const resultado = await Promise.race([rodada({ dry, qtd }), watchdog])
    if (resultado === 'travou') {
      const motivo = `rodada travou: sem resposta em ${WATCHDOG_MS / 1000} s`
      console.error(`[disparo-diario] ${motivo}`)
      // Mesmo alerta e mesma chave (1×/hora) da rodada que lança; `?dry` não alerta. Nunca lança.
      if (!dry) {
        const agora = Date.now()
        await avisarEquipe(textoQuebrou(motivo, agora), teaserQuebrou(motivo), { chaveDedupe: chaveQuebrou(agora), janelaMs: 3_600_000 })
      }
      return NextResponse.json({ ok: false, motivo: 'travou' }, { status: 500 })
    }
    return NextResponse.json({ ...resultado, ...(dry ? { dry: true } : {}) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[disparo-diario] rodada falhou:', msg)
    // Alerta imediato (HSM 48 + texto), no máx. 1×/hora BRT. Rodada MANUAL com ?dry não alerta: quem
    // chamou já está olhando o 500. `avisarEquipe` nunca lança — o 500 abaixo sai de qualquer jeito.
    if (!dry) {
      const agora = Date.now()
      await avisarEquipe(textoQuebrou(msg, agora), teaserQuebrou(msg), { chaveDedupe: chaveQuebrou(agora), janelaMs: 3_600_000 })
    }
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 })
  } finally {
    clearTimeout(timer) // sem isto o timer de 262 s segura a função viva depois da resposta
  }
}

export const GET = executar
export const POST = executar
