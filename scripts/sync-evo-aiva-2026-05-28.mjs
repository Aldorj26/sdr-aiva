/**
 * Sync completa AIVA: Supabase → Evo Talks pipeline 15.
 *
 * Pra cada lead no Supabase, garante que o opp no Evo está no stage certo
 * (ou removido do funil quando aplicável).
 *
 * Mapeamento Supabase status → Evo Stage:
 *   DISPARO_REALIZADO       → 66 (INICIO)
 *   INTERESSADO             → 47 (INTERESSADO)
 *   COLETANDO_COMPLEMENTO   → 47 (INTERESSADO, ainda em conversa)
 *   SEM_RESPOSTA            → 53 (SEM_RESPOSTA)
 *   AGUARDANDO              → 53 (SEM_RESPOSTA, lead pediu depois)
 *   CADASTRO_COMPLETO       → 49 (CADASTRO_RECEBIDO) — KEY pra Nei mover
 *   AGUARDANDO_APROVACAO    → 50 (EM_ANALISE)
 *   BOT_DETECTADO           → 69 (BOT_DETECTADO)
 *   NAO_QUALIFICADO         → REMOVE do funil
 *   OPT_OUT                 → REMOVE do funil
 *   DESCARTADO              → REMOVE do funil
 *
 * Idempotente: rodar 2x não causa efeito (changeOpportunityStage retorna
 * OPP_015 quando já está no destino, removeOpportunity retorna OPP_002
 * quando opp já não existe).
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://axkrorkhnkfkpbjikwrb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EVO_BASE = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID = 10
const QUEUE_API_KEY = '5bb6aa653e204c4f9c302b79ef783c1a'

if (!SUPABASE_KEY) {
  console.error('❌ Defina SUPABASE_SERVICE_ROLE_KEY no ambiente')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Status que devem mover para uma stage específica
const STATUS_TO_STAGE = {
  DISPARO_REALIZADO: 66,
  INTERESSADO: 47,
  COLETANDO_COMPLEMENTO: 47,
  SEM_RESPOSTA: 53,
  AGUARDANDO: 53,
  CADASTRO_COMPLETO: 49,
  AGUARDANDO_APROVACAO: 50,
  BOT_DETECTADO: 69,
}

// Status cujas opps devem ser REMOVIDAS do funil
const STATUS_REMOVE = new Set(['NAO_QUALIFICADO', 'OPT_OUT', 'DESCARTADO'])

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
    if (text.includes('OPP_015')) return { ok: true, skipped: 'mesma_stage' }
    if (text.includes('OPP_002') || text.includes('OPP_001')) return { ok: true, skipped: 'opp_inexistente' }
    return { ok: false, status: res.status, body: text }
  }
  return { ok: true }
}

async function removeOpp(oppId) {
  const res = await fetch(`${EVO_BASE}/int/removeOpportunity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: QUEUE_API_KEY, id: oppId }),
  })
  const text = await res.text()
  if (!res.ok) {
    if (text.includes('OPP_002') || text.includes('OPP_001')) return { ok: true, skipped: 'ja_removida' }
    return { ok: false, status: res.status, body: text }
  }
  return { ok: true }
}

async function buscarLeads(status) {
  const all = []
  let from = 0
  const page = 1000
  while (true) {
    const { data, error } = await supabase
      .from('sdr_leads')
      .select('evotalks_opportunity_id')
      .eq('produto', 'AIVA')
      .eq('status', status)
      .not('evotalks_opportunity_id', 'is', null)
      .range(from, from + page - 1)
    if (error) throw error
    all.push(...data)
    if (data.length < page) break
    from += page
  }
  return all
}

async function processBatch(items, fn, label) {
  let sucesso = 0, skipped = 0, falha = 0
  const erros = []
  let i = 0
  for (const item of items) {
    i++
    const oppId = Number(item.evotalks_opportunity_id)
    if (!oppId) { falha++; continue }
    const r = await fn(oppId)
    if (r.ok && r.skipped) skipped++
    else if (r.ok) sucesso++
    else { falha++; erros.push({ oppId, ...r }) }
    if (i % 100 === 0) {
      console.log(`  [${label}] ${i}/${items.length}  ok=${sucesso} skip=${skipped} fail=${falha}`)
    }
    await new Promise(r => setTimeout(r, 50))
  }
  console.log(`✅ [${label}] ok=${sucesso} skip=${skipped} fail=${falha}`)
  if (erros.length > 0) console.log(`  erros sample:`, erros.slice(0, 3))
  return { sucesso, skipped, falha }
}

async function main() {
  const stats = {}

  // 1. CADASTRO_COMPLETO primeiro (mais crítico — visibilidade pra Nei)
  console.log('\n🚀 1/5 — CADASTRO_COMPLETO → Stage 49 (CADASTRO_RECEBIDO)')
  const cc = await buscarLeads('CADASTRO_COMPLETO')
  stats.cadastro_completo = await processBatch(cc, (id) => changeStage(id, 49), 'cad_completo→49')

  // 2. AGUARDANDO_APROVACAO → 50
  console.log('\n🚀 2/5 — AGUARDANDO_APROVACAO → Stage 50 (EM_ANALISE)')
  const ap = await buscarLeads('AGUARDANDO_APROVACAO')
  stats.aguard_aprov = await processBatch(ap, (id) => changeStage(id, 50), 'ag_aprov→50')

  // 3. AGUARDANDO → 53
  console.log('\n🚀 3/5 — AGUARDANDO → Stage 53 (SEM_RESPOSTA)')
  const ag = await buscarLeads('AGUARDANDO')
  stats.aguardando = await processBatch(ag, (id) => changeStage(id, 53), 'aguard→53')

  // 4. DESCARTADO + NAO_QUALIFICADO + OPT_OUT — REMOVE
  console.log('\n🚀 4/5 — DESCARTADO + NAO_QUALIFICADO + OPT_OUT → REMOVE')
  const remList = []
  for (const s of STATUS_REMOVE) {
    const xs = await buscarLeads(s)
    console.log(`  ${s}: ${xs.length} opps a remover`)
    remList.push(...xs)
  }
  stats.removidos = await processBatch(remList, removeOpp, 'remove')

  // 5. Outros status (idempotente — só garante stage certo)
  console.log('\n🚀 5/5 — outros status (idempotente)')
  const outros = []
  for (const [status, stage] of Object.entries(STATUS_TO_STAGE)) {
    if (['CADASTRO_COMPLETO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO'].includes(status)) continue
    const xs = await buscarLeads(status)
    console.log(`  ${status} → ${stage}: ${xs.length} opps`)
    for (const x of xs) outros.push({ ...x, stage })
  }
  let okOutros = 0, skipOutros = 0, failOutros = 0
  let i = 0
  for (const item of outros) {
    i++
    const oppId = Number(item.evotalks_opportunity_id)
    const r = await changeStage(oppId, item.stage)
    if (r.ok && r.skipped) skipOutros++
    else if (r.ok) okOutros++
    else failOutros++
    if (i % 200 === 0) console.log(`  outros ${i}/${outros.length} ok=${okOutros} skip=${skipOutros}`)
    await new Promise(r => setTimeout(r, 50))
  }
  console.log(`✅ outros: ok=${okOutros} skip=${skipOutros} fail=${failOutros}`)
  stats.outros = { sucesso: okOutros, skipped: skipOutros, falha: failOutros }

  console.log('\n📊 RESUMO:')
  console.log(JSON.stringify(stats, null, 2))
}

main().catch(err => {
  console.error('💥 ERRO FATAL:', err)
  process.exit(1)
})
