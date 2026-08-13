/**
 * Script one-shot: sincroniza o estado do Evo Talks com a limpeza do Supabase
 * feita em 2026-05-28.
 *
 * Ações:
 *   1. SEM_RESPOSTA  → mover opp para Stage 53 (SEM_RESPOSTA)  — 1.749 leads
 *   2. DESCARTADO    → remover opp do funil                    — 49 leads
 *   3. AGUARDANDO    → não mexe (fica onde está)
 *
 * Uso: SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/sync-evo-cleanup-2026-05-28.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://axkrorkhnkfkpbjikwrb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EVO_BASE = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID = 10
const QUEUE_API_KEY = '5bb6aa653e204c4f9c302b79ef783c1a'
const STAGE_SEM_RESPOSTA = 53

if (!SUPABASE_KEY) {
  console.error('❌ Defina SUPABASE_SERVICE_ROLE_KEY no ambiente')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function changeStage(oppId, destStageId) {
  const res = await fetch(`${EVO_BASE}/int/changeOpportunityStage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queueId: QUEUE_ID,
      apiKey: QUEUE_API_KEY,
      id: oppId,
      destStageId,
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    // OPP_015 = mesma stage (idempotente)
    if (text.includes('OPP_015')) return { ok: true, skipped: true }
    return { ok: false, status: res.status, body: text }
  }
  return { ok: true }
}

async function removeOpp(oppId) {
  const res = await fetch(`${EVO_BASE}/int/removeOpportunity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queueId: QUEUE_ID,
      apiKey: QUEUE_API_KEY,
      id: oppId,
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    // Já removido / não existe
    if (text.includes('OPP_002') || text.includes('OPP_001')) return { ok: true, skipped: true }
    return { ok: false, status: res.status, body: text }
  }
  return { ok: true }
}

async function processBatch(items, fn, label) {
  let sucesso = 0, skipped = 0, falha = 0
  const erros = []
  let i = 0
  for (const item of items) {
    i++
    const oppId = Number(item.evotalks_opportunity_id)
    if (!oppId) { falha++; continue }
    const result = await fn(oppId)
    if (result.ok && result.skipped) skipped++
    else if (result.ok) sucesso++
    else {
      falha++
      erros.push({ oppId, ...result })
    }
    // Progress a cada 100
    if (i % 100 === 0) {
      console.log(`  [${label}] ${i}/${items.length}  ok=${sucesso} skip=${skipped} fail=${falha}`)
    }
    // Pequeno throttle para não sobrecarregar
    await new Promise(r => setTimeout(r, 50))
  }
  console.log(`✅ [${label}] TOTAL  ok=${sucesso} skip=${skipped} fail=${falha}`)
  if (erros.length > 0) {
    console.log(`  primeiros 5 erros:`, erros.slice(0, 5))
  }
  return { sucesso, skipped, falha }
}

async function main() {
  console.log('🔍 Buscando leads SEM_RESPOSTA com opp_id (paginado)...')
  const semResp = []
  let from = 0, page = 1000
  while (true) {
    const { data, error } = await supabase
      .from('sdr_leads')
      .select('evotalks_opportunity_id')
      .eq('produto', 'AIVA')
      .eq('status', 'SEM_RESPOSTA')
      .not('evotalks_opportunity_id', 'is', null)
      .range(from, from + page - 1)
    if (error) throw error
    semResp.push(...data)
    if (data.length < page) break
    from += page
  }
  console.log(`  → ${semResp.length} opps para mover para Stage 53\n`)

  console.log('🔍 Buscando leads DESCARTADO com opp_id...')
  const { data: descartado, error: e2 } = await supabase
    .from('sdr_leads')
    .select('evotalks_opportunity_id')
    .eq('produto', 'AIVA')
    .eq('status', 'DESCARTADO')
    .not('evotalks_opportunity_id', 'is', null)
  if (e2) throw e2
  console.log(`  → ${descartado.length} opps para remover\n`)

  console.log('🚀 Fase 1: movendo SEM_RESPOSTA para Stage 53...')
  const r1 = await processBatch(semResp, (id) => changeStage(id, STAGE_SEM_RESPOSTA), 'sem_resp→53')

  console.log('\n🚀 Fase 2: removendo DESCARTADO do funil...')
  const r2 = await processBatch(descartado, removeOpp, 'descartado→remove')

  console.log('\n📊 RESUMO FINAL:')
  console.log(`  Movidos para Stage 53: ${r1.sucesso} (skipped: ${r1.skipped}, falha: ${r1.falha})`)
  console.log(`  Removidos do funil:    ${r2.sucesso} (skipped: ${r2.skipped}, falha: ${r2.falha})`)
}

main().catch(err => {
  console.error('💥 ERRO FATAL:', err)
  process.exit(1)
})
