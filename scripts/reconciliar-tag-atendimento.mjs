/**
 * reconciliar-tag-atendimento.mjs
 *
 * Sincroniza a etiqueta "Atend Humano" (tag 76) no Evo com o estado real de
 * atendimento no Supabase (acionar_humano).
 *
 * Regra:
 *   acionar_humano = false (já atendido)  → REMOVE tag 76 da opp
 *   acionar_humano = true  (ainda aguarda) → ADICIONA tag 76 (se faltar)
 *
 * Cruza por evotalks_opportunity_id (seguro). Lê tags do getPipeOpportunities
 * (já vêm na resposta — não precisa getOpportunity individual).
 *
 * Uso: SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/reconciliar-tag-atendimento.mjs [--dry]
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://axkrorkhnkfkpbjikwrb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EVO_BASE = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID = 10
const GLOBAL_KEY = '2e8a5e207d7ea31ce4cd4430d3ee7c98'
const PIPELINE_AIVA = 15
const TAG_ATEND = 76

const dryRun = process.argv.includes('--dry')

if (!SUPABASE_KEY) {
  console.error('❌ Defina SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function fetchOpps() {
  const res = await fetch(`${EVO_BASE}/int/getPipeOpportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: GLOBAL_KEY, pipelineId: PIPELINE_AIVA }),
  })
  if (!res.ok) throw new Error(`getPipeOpportunities → ${res.status}`)
  return res.json()
}

async function setTags(oppId, tags) {
  const res = await fetch(`${EVO_BASE}/int/updateOpportunity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: GLOBAL_KEY, id: oppId, tags }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`updateOpportunity ${oppId} → ${res.status}: ${text.slice(0, 100)}`)
}

async function main() {
  console.log(`🔍 Buscando opps do pipeline ${PIPELINE_AIVA}...`)
  const opps = await fetchOpps()
  console.log(`  ${opps.length} opps`)

  // Mapa opp_id → acionar_humano (Supabase)
  console.log('🔍 Buscando acionar_humano do Supabase...')
  const ahMap = new Map()
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('sdr_leads')
      .select('evotalks_opportunity_id, acionar_humano')
      .eq('produto', 'AIVA')
      .not('evotalks_opportunity_id', 'is', null)
      .range(from, from + 999)
    if (error) throw error
    for (const l of data ?? []) ahMap.set(String(l.evotalks_opportunity_id), l.acionar_humano)
    if (!data || data.length < 1000) break
    from += 1000
  }
  console.log(`  ${ahMap.size} leads com opp`)

  const remover = [] // tem tag 76 mas já atendido
  const adicionar = [] // aguarda mas sem tag 76
  let semLead = 0

  for (const o of opps) {
    const tags = o.tags ?? []
    const tem76 = tags.includes(TAG_ATEND)
    const ah = ahMap.get(String(o.id))

    if (ah === undefined) {
      // opp sem lead no Supabase — se tem 76, não sabemos o estado; deixa quieto
      if (tem76) semLead++
      continue
    }
    if (tem76 && ah === false) {
      remover.push({ id: o.id, title: o.title, novasTags: tags.filter((t) => t !== TAG_ATEND) })
    } else if (!tem76 && ah === true) {
      adicionar.push({ id: o.id, title: o.title, novasTags: [...tags, TAG_ATEND] })
    }
  }

  console.log(`\n📊 Plano:`)
  console.log(`  🧹 Remover tag 76 (já atendido): ${remover.length}`)
  console.log(`  ➕ Adicionar tag 76 (aguarda, sem tag): ${adicionar.length}`)
  console.log(`  ⏭️  Tag 76 sem lead Supabase (ignorado): ${semLead}`)

  if (dryRun) {
    console.log('\n🧪 DRY RUN — nada será alterado.')
    console.log('\nAmostra remover:')
    for (const r of remover.slice(0, 8)) console.log(`  #${r.id} ${r.title?.slice(0, 35)} → tags ${JSON.stringify(r.novasTags)}`)
    console.log('\nAmostra adicionar:')
    for (const a of adicionar.slice(0, 8)) console.log(`  #${a.id} ${a.title?.slice(0, 35)} → tags ${JSON.stringify(a.novasTags)}`)
    return
  }

  let okRem = 0, okAdd = 0, falha = 0
  console.log('\n🧹 Removendo tag 76 dos já atendidos...')
  for (const r of remover) {
    try { await setTags(r.id, r.novasTags); okRem++ }
    catch (e) { falha++; console.error(`  falha #${r.id}: ${e.message}`) }
    await new Promise((res) => setTimeout(res, 60))
  }
  console.log('➕ Adicionando tag 76 nos que aguardam...')
  for (const a of adicionar) {
    try { await setTags(a.id, a.novasTags); okAdd++ }
    catch (e) { falha++; console.error(`  falha #${a.id}: ${e.message}`) }
    await new Promise((res) => setTimeout(res, 60))
  }

  console.log(`\n✅ Removidas: ${okRem} | Adicionadas: ${okAdd} | Falhas: ${falha}`)
}

main().catch((err) => { console.error('💥', err); process.exit(1) })
