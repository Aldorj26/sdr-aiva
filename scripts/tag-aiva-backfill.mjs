// Backfill da etiqueta AIVA (id 69) nas opps abertas do funil 15 que estão
// sem ela (pedido do Aldo 2026-08-03). Lê a lista gerada pelo levantamento
// (opps_sem_tag.json: [{id, tags}]) e faz merge — updateOpportunity SUBSTITUI
// o array inteiro, então mandamos as tags atuais + 69.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const FILE = 'C:/Users/rocha/AppData/Local/Temp/claude/C--projetos-claude/ec1b3a60-d113-4210-ab43-8dfe3d76cc42/scratchpad/opps_sem_tag.json'
const alvos = JSON.parse(readFileSync(FILE, 'utf8'))
console.log(`Backfill tag AIVA: ${alvos.length} opps`)

const post = (p, b) =>
  fetch(env.EVO_TALKS_BASE_URL + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: Number(env.EVO_TALKS_QUEUE_ID), apiKey: env.EVO_TALKS_QUEUE_API_KEY, ...b }),
  }).then(async (r) => {
    const t = await r.text()
    if (!r.ok) throw new Error(`${p} → ${r.status}: ${t.slice(0, 80)}`)
    return t
  })

let ok = 0, falha = 0
const falhas = []
for (const o of alvos) {
  try {
    await post('/int/updateOpportunity', { id: o.id, tags: [...new Set([...(o.tags ?? []), 69])] })
    ok++
    if (ok % 100 === 0) console.log(`  ${ok}/${alvos.length}...`)
  } catch (e) {
    falha++
    falhas.push(`#${o.id}: ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 250))
}
console.log(`\n===== RESUMO =====\nEtiquetadas: ${ok} | Falhas: ${falha}`)
falhas.slice(0, 10).forEach((f) => console.log(' ✗', f))
