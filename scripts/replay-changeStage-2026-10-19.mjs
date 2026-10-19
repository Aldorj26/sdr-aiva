// Replay de UM movimento do espelho (mesma chamada que o cron manda a cada 15 min) pra ver o
// corpo CRU da resposta do Evo — 19/10/2026: 14 cards "movidos" com ok=true que nunca saem do lugar.
// Uso: node scripts/replay-changeStage-2026-10-19.mjs <opp> <destStageId>
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const BASE = env.EVO_TALKS_BASE_URL, QID = Number(env.EVO_TALKS_QUEUE_ID), KEY = env.EVO_TALKS_QUEUE_API_KEY
const [opp, dest] = process.argv.slice(2).map(Number)
if (!opp || !dest) { console.error('uso: node scripts/replay-changeStage-2026-10-19.mjs <opp> <destStageId>'); process.exit(1) }

const antes = await fetch(`${BASE}/int/getOpportunity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, id: opp }) }).then((r) => r.text())
console.log('ANTES  fkStage:', (antes.match(/"fkStage":\s*"?(\d+)/) ?? [])[1] ?? antes.slice(0, 200))

const res = await fetch(`${BASE}/int/changeOpportunityStage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ queueId: QID, apiKey: KEY, id: opp, destStageId: dest }),
})
const corpo = (await res.text()).replaceAll(KEY, '***')
console.log(`HTTP ${res.status} ${res.statusText}`)
console.log('headers:', JSON.stringify(Object.fromEntries(res.headers)))
console.log('corpo  :', JSON.stringify(corpo))

await new Promise((r) => setTimeout(r, 1500))
const depois = await fetch(`${BASE}/int/getOpportunity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, id: opp }) }).then((r) => r.text())
console.log('DEPOIS fkStage:', (depois.match(/"fkStage":\s*"?(\d+)/) ?? [])[1] ?? depois.slice(0, 200))
