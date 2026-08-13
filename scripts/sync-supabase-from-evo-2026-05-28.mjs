/**
 * Sync MASTER: Evo Talks → Supabase (Evo é fonte da verdade).
 *
 * Para cada opp no pipeline AIVA (15), busca o lead correspondente no Supabase
 * (via evotalks_opportunity_id) e sobrescreve o status com a tradução da stage.
 *
 * Mapeamento (Evo Stage → Supabase Status):
 *   66 INICIO                 → INICIO
 *   47 INTERESSADO            → INTERESSADO
 *   53 SEM_RESPOSTA           → SEM_RESPOSTA
 *   54 PRE_APROVACAO          → PRE_APROVACAO
 *   49 CADASTRO_RECEBIDO      → CADASTRO_RECEBIDO
 *   50 EM_ANALISE_AIVA        → EM_ANALISE_AIVA
 *   70 TREINAR                → TREINAR
 *   71 LOGIN                  → LOGIN
 *   51 LOJA_FINALIZADA_E_VENDENDO → LOJA_FINALIZADA_E_VENDENDO
 *   69 BOT_DETECTADO          → BOT_DETECTADO
 *
 * Para leads no Supabase SEM opp no Evo (legacy):
 *   DISPARO_REALIZADO    → INICIO
 *   CADASTRO_COMPLETO    → CADASTRO_RECEBIDO
 *   AGUARDANDO_APROVACAO → PRE_APROVACAO
 *   COLETANDO_COMPLEMENTO → INTERESSADO
 *   FORMULARIO_ENVIADO   → CADASTRO_RECEBIDO
 *   ANALISE_AIVA         → EM_ANALISE_AIVA
 *   TREINAMENTO          → TREINAR
 *   (outros: OPT_OUT, NAO_QUALIFICADO, DESCARTADO, AGUARDANDO, INTERESSADO, SEM_RESPOSTA, BOT_DETECTADO mantém)
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://axkrorkhnkfkpbjikwrb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EVO_BASE = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID = 10
const GLOBAL_KEY = '2e8a5e207d7ea31ce4cd4430d3ee7c98'

if (!SUPABASE_KEY) {
  console.error('❌ Defina SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const STAGE_TO_STATUS = {
  66: 'INICIO',
  47: 'INTERESSADO',
  53: 'SEM_RESPOSTA',
  54: 'PRE_APROVACAO',
  49: 'CADASTRO_RECEBIDO',
  50: 'EM_ANALISE_AIVA',
  70: 'TREINAR',
  71: 'LOGIN',
  51: 'LOJA_FINALIZADA_E_VENDENDO',
  69: 'BOT_DETECTADO',
}

const LEGACY_TO_NEW = {
  DISPARO_REALIZADO: 'INICIO',
  CADASTRO_COMPLETO: 'CADASTRO_RECEBIDO',
  AGUARDANDO_APROVACAO: 'PRE_APROVACAO',
  COLETANDO_COMPLEMENTO: 'INTERESSADO',
  FORMULARIO_ENVIADO: 'CADASTRO_RECEBIDO',
  ANALISE_AIVA: 'EM_ANALISE_AIVA',
  TREINAMENTO: 'TREINAR',
}

async function fetchAllOpps() {
  const res = await fetch(`${EVO_BASE}/int/getPipeOpportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: GLOBAL_KEY, pipelineId: 15 }),
  })
  if (!res.ok) throw new Error(`getPipeOpportunities → ${res.status}`)
  return res.json()
}

async function main() {
  console.log('🔍 Buscando opps no funil Evo AIVA (pipeline 15)...')
  const opps = await fetchAllOpps()
  console.log(`  → ${opps.length} opps encontradas`)

  // Stats por stage
  const byStage = {}
  for (const o of opps) byStage[o.fkStage] = (byStage[o.fkStage] || 0) + 1
  console.log('  Distribuição:', byStage)

  console.log('\n🚀 FASE 1: Sync Evo → Supabase (Evo manda)')
  let updated = 0, skipped = 0, unmapped = 0, notInDb = 0
  let i = 0
  for (const opp of opps) {
    i++
    const novoStatus = STAGE_TO_STATUS[opp.fkStage]
    if (!novoStatus) { unmapped++; continue }

    // Busca o lead no Supabase pelo opp_id
    const { data: lead } = await supabase
      .from('sdr_leads')
      .select('id, status')
      .eq('evotalks_opportunity_id', String(opp.id))
      .maybeSingle()

    if (!lead) { notInDb++; continue }
    if (lead.status === novoStatus) { skipped++; continue }

    const { error } = await supabase
      .from('sdr_leads')
      .update({ status: novoStatus })
      .eq('id', lead.id)
    if (error) { console.error(`  erro lead ${lead.id}:`, error.message); continue }
    updated++

    if (i % 200 === 0) console.log(`  ${i}/${opps.length}  upd=${updated} skip=${skipped} notInDb=${notInDb}`)
  }
  console.log(`✅ Fase 1: upd=${updated} skip=${skipped} unmapped=${unmapped} notInDb=${notInDb}`)

  console.log('\n🚀 FASE 2: Migração legacy (leads sem opp no Evo)')
  let legacyUpd = 0
  for (const [oldName, newName] of Object.entries(LEGACY_TO_NEW)) {
    const { data, error } = await supabase
      .from('sdr_leads')
      .update({ status: newName })
      .eq('produto', 'AIVA')
      .eq('status', oldName)
      .select('id')
    if (error) { console.error(`  erro migrando ${oldName}:`, error.message); continue }
    const count = data?.length ?? 0
    console.log(`  ${oldName} → ${newName}: ${count} leads`)
    legacyUpd += count
  }
  console.log(`✅ Fase 2: ${legacyUpd} leads legacy migrados`)

  console.log('\n📊 Estado final dos status:')
  const { data: finalStats } = await supabase
    .from('sdr_leads')
    .select('status')
    .eq('produto', 'AIVA')
  const stats = {}
  for (const l of finalStats || []) stats[l.status] = (stats[l.status] || 0) + 1
  console.log(JSON.stringify(stats, null, 2))
}

main().catch(err => {
  console.error('💥 ERRO FATAL:', err)
  process.exit(1)
})
