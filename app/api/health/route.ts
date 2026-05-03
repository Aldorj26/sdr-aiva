import { NextResponse } from 'next/server'
import { getQueueStatus, validateTagIds } from '@/lib/evotalks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Health check do SDR AIVA.
 *
 * Pinga a fila Evo Talks (queueId=10) pra detectar antes que o SDR
 * passe a não entregar mensagem porque a fila caiu.
 *
 * Critério de status:
 * - 200 quando fila Evo Talks OK (connected + authenticated + enabled).
 *   Drift de tag NÃO derruba o status — service continua operando, é
 *   só warning pra humano olhar (campo `tags.ok` = false fica visível
 *   no body mas não bate o status).
 * - 503 quando fila Evo Talks fora.
 *
 * Sem auth — endpoint público pra monitor externo (Better Stack, etc).
 */
export async function GET() {
  const ts = new Date().toISOString()

  try {
    const [queue, tagsCheck] = await Promise.all([
      getQueueStatus(),
      validateTagIds().catch((err) => ({
        ok: false,
        drift: [{ id: 0, expected: 'fetch_failed', actual: String(err) }],
      })),
    ])

    // Status overall: SÓ depende da fila. Drift de tag é warning, nao down.
    const queueOk = queue.connected && queue.authenticated && queue.enabled
    const ok = queueOk

    return NextResponse.json(
      {
        ok,
        ts,
        produto: 'AIVA',
        queue: {
          name: queue.name,
          connected: queue.connected,
          authenticated: queue.authenticated,
          enabled: queue.enabled,
          openChats: queue.openChats,
        },
        tags: tagsCheck,
      },
      { status: ok ? 200 : 503 },
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { ok: false, ts, produto: 'AIVA', error: 'evotalks_unreachable', detail: errMsg },
      { status: 503 },
    )
  }
}
