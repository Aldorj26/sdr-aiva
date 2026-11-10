/**
 * aquecer-cache/route.ts — mantém quente o cache do prompt da VictorIA (auditoria 10/11/2026).
 *
 * Com cache de 5 min, 7% das chamadas achavam o cache frio e reescreviam ~67 mil tokens (US$ 0,25 cada, 38% do custo).
 * Agora o cache dura 1 h (`montarSystemBlocks`) e este cron o renova a cada 30 min (7h–20h30 BRT, todo dia) com uma
 * chamada de 1 token que custa só a LEITURA do prefixo (~US$ 0,02). O prefixo precisa ser IDÊNTICO ao da VictorIA
 * (prompt + curadoria + bloco diário), por isso vem da mesma função. ?dry mostra o tamanho dos blocos sem chamar o Claude.
 */
import { NextRequest, NextResponse } from 'next/server'
import { montarSystemBlocks, callClaudeWithRetry } from '@/lib/claude'
import { flag } from '@/lib/req-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const t0 = Date.now()
  const system = await montarSystemBlocks('AIVA')
  const tamanhos = system.map((b) => b.text.length)
  if (flag(new URL(req.url).searchParams, 'dry')) {
    return NextResponse.json({ ok: true, dry: true, blocos: system.length, chars: tamanhos, total_chars: tamanhos.reduce((a, b) => a + b, 0) })
  }
  const r = await callClaudeWithRetry({
    model: 'claude-sonnet-4-5',
    max_tokens: 1,
    system,
    messages: [{ role: 'user', content: 'ping' }],
  }, 'aquecer-cache')
  const u = r.usage
  return NextResponse.json({
    ok: true, ms: Date.now() - t0, blocos: system.length, chars: tamanhos,
    cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0, input: u.input_tokens,
    estava_quente: (u.cache_read_input_tokens ?? 0) > 0 && (u.cache_creation_input_tokens ?? 0) === 0,
  })
}
