#!/usr/bin/env node
/**
 * Backfill 08/09/2026 — leva pro Evo (etapa 53 "Sem resposta") os cards dos
 * leads que o auto-descarte já marcou SEM_RESPOSTA no painel mas cujo card
 * ficou em "Início" (66). Sem isso, o sync a cada 5 min reverteria todos pra
 * INICIO (ping-pong que durava desde sempre, 1x/dia).
 *
 * Idempotente e resumível: só toca quem está SEM_RESPOSTA × card em 66.
 * Uso: node --env-file=.env.local scripts/backfill-sem-resposta-evo-2026-09-08.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY_GLOBAL = process.env.EVO_TALKS_API_KEY
const KEY_FILA = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)

const r = await fetch(`${BASE}/int/getPipeOpportunities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY_GLOBAL, pipelineId: 15 }) })
const opps = await r.json()
const em66 = new Set(opps.filter((o) => o.fkStage === 66).map((o) => String(o.id)))

const leads = []
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from('sdr_leads').select('id, nome, evotalks_opportunity_id').eq('produto', 'AIVA').eq('status', 'SEM_RESPOSTA').not('evotalks_opportunity_id', 'is', null).range(from, from + 999)
  leads.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
const alvo = leads.filter((l) => em66.has(String(l.evotalks_opportunity_id)))
console.log(`SEM_RESPOSTA no painel: ${leads.length} | com card em Início (66): ${alvo.length}${DRY ? ' (DRY)' : ''}`)
if (DRY) process.exit(0)

let ok = 0, falha = 0
const t0 = Date.now()
for (const l of alvo) {
  if (Date.now() - t0 > 540_000) { console.warn('TETO 9 min — rode de novo pra completar.'); break }
  try {
    const res = await fetch(`${BASE}/int/changeOpportunityStage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY_FILA, id: Number(l.evotalks_opportunity_id), destStageId: 53 }) })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`)
    ok++
    if (ok % 50 === 0) console.log(`  ${ok}/${alvo.length}…`)
  } catch (e) { falha++; console.error('✗', l.nome, String(e).slice(0, 100)) }
}
console.log(`\nMovidos pra "Sem resposta" no Evo: ${ok} | falhas: ${falha} | restam: ${alvo.length - ok - falha}`)
setTimeout(() => process.exit(falha > ok ? 1 : 0), 500).unref()
