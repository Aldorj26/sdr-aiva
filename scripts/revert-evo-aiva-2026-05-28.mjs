/**
 * Reversão das movimentações errôneas feitas em 2026-05-28.
 *
 * Mapeamento baseado em EVIDÊNCIA de templates HSM disparados:
 *
 *   CADASTRO_COMPLETO Supabase + HSM 'aiva_aprovacao'       → Stage 52 VALIDACAO_CONCLUIDA
 *   CADASTRO_COMPLETO Supabase + HSM 'aiva_treinamento'     → Stage 70 TREINA
 *   CADASTRO_COMPLETO Supabase + HSM 'aiva_link_cadastro'   → Stage 51 CAF_PENDENTE
 *   CADASTRO_COMPLETO Supabase + HSM 'aiva_complete_cadastro' → Stage 50 EM_ANALISE
 *   CADASTRO_COMPLETO Supabase (sem outros HSM)             → Stage 49 (mantém)
 *   AGUARDANDO Supabase                                     → Stage 47 INTERESSADO
 *
 * Aldo + Nei + teste idempotência são excluídos.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://axkrorkhnkfkpbjikwrb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EVO_BASE = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID = 10
const QUEUE_API_KEY = '5bb6aa653e204c4f9c302b79ef783c1a'
const EXCLUIDOS = new Set(['5547996085000','5548991555655','5543988208134'])

if (!SUPABASE_KEY) {
  console.error('❌ Defina SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function changeStage(oppId, destStageId) {
  const res = await fetch(`${EVO_BASE}/int/changeOpportunityStage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: QUEUE_API_KEY, id: oppId, destStageId }),
  })
  const text = await res.text()
  if (!res.ok) {
    if (text.includes('OPP_015')) return { ok: true, skipped: 'mesma_stage' }
    if (text.includes('OPP_002') || text.includes('OPP_001')) return { ok: true, skipped: 'opp_inexistente' }
    if (text.includes('OPP_005')) return { ok: false, fechada: true, body: text }
    return { ok: false, status: res.status, body: text.slice(0, 100) }
  }
  return { ok: true }
}

async function buscarPagedSql(query) {
  // Wrapper pra rodar SQL custom via RPC ou via select.range
  // Pra esse script usamos query direta no Supabase client
  return query
}

async function buscarCadastroCompleto() {
  // Busca CADASTRO_COMPLETO com opp_id e identifica templates disparados
  const { data, error } = await supabase
    .from('sdr_leads')
    .select(`
      id,
      nome,
      telefone,
      evotalks_opportunity_id,
      sdr_mensagens(template_hsm)
    `)
    .eq('produto', 'AIVA')
    .eq('status', 'CADASTRO_COMPLETO')
    .not('evotalks_opportunity_id', 'is', null)

  if (error) throw error

  const result = []
  for (const l of data) {
    if (EXCLUIDOS.has(l.telefone)) continue
    const templates = new Set((l.sdr_mensagens ?? []).map(m => m.template_hsm).filter(Boolean))
    let stage = 49
    if (templates.has('aiva_aprovacao')) stage = 52
    else if (templates.has('aiva_treinamento')) stage = 70
    else if (templates.has('aiva_link_cadastro')) stage = 51
    else if (templates.has('aiva_complete_cadastro')) stage = 50
    result.push({
      opp_id: l.evotalks_opportunity_id,
      nome: l.nome,
      telefone: l.telefone,
      stage,
    })
  }
  return result
}

async function buscarAguardando() {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('sdr_leads')
      .select('evotalks_opportunity_id, nome, telefone')
      .eq('produto', 'AIVA')
      .eq('status', 'AGUARDANDO')
      .not('evotalks_opportunity_id', 'is', null)
      .range(from, from + 999)
    if (error) throw error
    all.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return all.filter(l => !EXCLUIDOS.has(l.telefone))
}

async function processBatch(items, getStage, label) {
  let sucesso = 0, skip = 0, falha = 0, fechadas = 0
  let i = 0
  for (const item of items) {
    i++
    const stage = getStage(item)
    const oppId = Number(item.opp_id ?? item.evotalks_opportunity_id)
    if (!oppId) { falha++; continue }
    const r = await changeStage(oppId, stage)
    if (r.ok && r.skipped) skip++
    else if (r.ok) sucesso++
    else if (r.fechada) fechadas++
    else falha++
    if (i % 25 === 0) {
      console.log(`  [${label}] ${i}/${items.length}  ok=${sucesso} skip=${skip} fechadas=${fechadas} fail=${falha}`)
    }
    await new Promise(r => setTimeout(r, 50))
  }
  console.log(`✅ [${label}] ok=${sucesso} skip=${skip} fechadas=${fechadas} fail=${falha}`)
  return { sucesso, skip, fechadas, falha }
}

async function main() {
  console.log('🔍 Buscando CADASTRO_COMPLETO com mapeamento por templates...')
  const cadComp = await buscarCadastroCompleto()
  const distrib = {}
  for (const l of cadComp) distrib[l.stage] = (distrib[l.stage] ?? 0) + 1
  console.log(`  → ${cadComp.length} leads. Distribuição:`, distrib)

  console.log('\n🔍 Buscando AGUARDANDO...')
  const aguard = await buscarAguardando()
  console.log(`  → ${aguard.length} leads, todos → Stage 47 INTERESSADO`)

  console.log('\n🚀 FASE 1: Reverter CADASTRO_COMPLETO para stages corretas')
  const r1 = await processBatch(cadComp, (l) => l.stage, 'cad_completo')

  console.log('\n🚀 FASE 2: Reverter AGUARDANDO → Stage 47 INTERESSADO')
  const r2 = await processBatch(aguard, () => 47, 'aguardando')

  console.log('\n📊 RESUMO:')
  console.log(JSON.stringify({ cadastro_completo: r1, aguardando: r2 }, null, 2))
}

main().catch(err => {
  console.error('💥 ERRO FATAL:', err)
  process.exit(1)
})
