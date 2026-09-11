#!/usr/bin/env node
/**
 * Move os 25 CNPJs indicados pelo Aldo (11/09/2026) de Treinar (70) →
 * Loja Finalizada e Vendendo (51).
 *
 * --dry  : só analisa e imprime (não move nada)
 * sem flag: move de verdade.
 *
 * Cruza 3 fontes antes de agir:
 *   1) sdr_registros_cnpj + sdr_leads  → qual lead/opp corresponde ao CNPJ
 *   2) Evo /int/getOpportunity         → etapa REAL e dias na etapa
 *   3) API pública do portal AIVA      → o onboarding realmente terminou?
 */
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const QUEUE_ID = Number(process.env.EVO_TALKS_QUEUE_ID)
const QUEUE_KEY = process.env.EVO_TALKS_QUEUE_API_KEY
const PORTAL_KEY = process.env.AIVA_PORTAL_API_KEY
const DRY = process.argv.includes('--dry')
const STAGE_TREINAR = 70
const STAGE_VENDENDO = 51

// Lista do Aldo: nome no CRM + CNPJ + dias na etapa informados por ele
const LISTA = [
  ['Gfourr', '33363773000191', 31],
  ['Dany iPhone Store', '63384709000158', 25],
  ['Smarttech Celulares', '62555956000108', 24],
  ['Cezar Mobile', '39581000000168', 24],
  ['Rosa-Rio Shop', '46993680000192', 24],
  ['TITÉCH', '30811536000158', 21],
  ['L a informática ltda', '44519195000156', 17],
  ['Loosetech', '45756121000104', 16],
  ['Joelcelularessm', '18682584000198', 15],
  ['Smart Br', '58615530000124', 15],
  ['TEM TEM celulares', '53678243000140', 14],
  ['Nexus Tech', '63979426000159', 14],
  ['Alex Celular e Eletrônicos', '37816627000125', 14],
  ['X Egames Eletrônicos', '55720846000198', 14],
  ['Porto celulares', '55511062000150', 14],
  ['M Suel Alves Max Mais', '10282579000186', 14],
  ['DL STORE', '58371746000191', 14],
  ['Marcos Camillo', '52565242000126', 13],
  ['Loja iback', '46033483000121', 12],
  ['Augusto Presentes', '22369610000108', 12],
  ['2 Brothers Celulares', '27656572000180', 11],
  ['Movlar', '28803747000105', 11],
  ['Nova Era', '55159812000176', 10],
  ['BC Flash Capital', '32606571000160', 10],
  ['Tech Mundo Tecnologia', '20982902000188', 10],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const norm = (c) => String(c ?? '').replace(/\D/g, '')

async function evoPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: QUEUE_KEY, ...body }),
  })
  const txt = await res.text()
  let json = null
  try { json = JSON.parse(txt) } catch { /* resposta não-JSON */ }
  return { status: res.status, json, txt: txt.slice(0, 300) }
}

// ─── 1) portal: etapa real do onboarding por CNPJ
const portal = new Map()
{
  let cursor = null
  do {
    const q = new URLSearchParams({ limit: '500' })
    if (cursor) q.set('cursor', cursor)
    const r = await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, {
      headers: { 'x-api-key': PORTAL_KEY },
    })
    const d = await r.json()
    for (const rec of d.records ?? []) portal.set(norm(rec.cnpj), rec)
    cursor = d.next_cursor
  } while (cursor)
}
console.log(`Portal: ${portal.size} onboardings carregados.`)

// ─── 2) nossa base: CNPJ → lead → opp
const regs = []
for (let de = 0; ; de += 1000) {
  const { data, error } = await supabase.from('sdr_registros_cnpj').select('cnpj, lead_id, rid, status').range(de, de + 999)
  if (error) throw error
  if (!data?.length) break
  regs.push(...data)
  if (data.length < 1000) break
}
const leads = []
for (let de = 0; ; de += 1000) {
  const { data, error } = await supabase
    .from('sdr_leads')
    .select('id, nome, telefone, status, evotalks_opportunity_id, observacoes')
    .range(de, de + 999)
  if (error) throw error
  if (!data?.length) break
  leads.push(...data)
  if (data.length < 1000) break
}
const leadById = new Map(leads.map((l) => [l.id, l]))
const regPorCnpj = new Map()
for (const r of regs) if (!regPorCnpj.has(norm(r.cnpj))) regPorCnpj.set(norm(r.cnpj), r)
// fallback: CNPJ gravado nas observações do lead
const leadPorCnpjObs = new Map()
for (const l of leads) {
  const m = (l.observacoes ?? '').match(/cnpj_matriz=(\d{14})/)
  if (m && !leadPorCnpjObs.has(m[1])) leadPorCnpjObs.set(m[1], l)
}

// ─── 3) para cada item da lista: achar opp, conferir etapa real e dias
const linhas = []
for (const [nome, cnpj, diasInformados] of LISTA) {
  const reg = regPorCnpj.get(cnpj)
  const lead = reg ? leadById.get(reg.lead_id) : leadPorCnpjObs.get(cnpj)
  const onb = portal.get(cnpj)
  const linha = {
    nome, cnpj, diasInformados,
    lead_nome: lead?.nome ?? null,
    telefone: lead?.telefone ?? null,
    status_painel: lead?.status ?? null,
    opp_id: lead?.evotalks_opportunity_id ?? null,
    stage_evo: null, dias_evo: null,
    portal_stage: onb?.stage ?? null,
    portal_form: onb?.formulario_status ?? null,
    portal_bio: onb?.biometry_status ?? null,
    portal_rid: onb?.retailer_id ?? null,
    apto: false, motivo: '',
  }
  if (linha.opp_id) {
    const { json } = await evoPost('/int/getOpportunity', { id: Number(linha.opp_id) })
    const opp = json?.opportunity ?? json?.data ?? json
    const stage = Number(opp?.fkStage ?? opp?.fk_stage)
    if (Number.isFinite(stage)) linha.stage_evo = stage
    const inicio = opp?.stagebegintime ?? opp?.stageBeginTime
    if (inicio) {
      const ms = typeof inicio === 'number' ? (inicio < 1e12 ? inicio * 1000 : inicio) : Date.parse(inicio)
      if (Number.isFinite(ms)) linha.dias_evo = Math.floor((Date.now() - ms) / 86400000)
    }
    await sleep(120)
  }
  if (!linha.opp_id) linha.motivo = 'sem oportunidade no Evo ligada ao CNPJ'
  else if (linha.stage_evo == null) linha.motivo = 'não consegui ler a etapa da oportunidade'
  else if (linha.stage_evo !== STAGE_TREINAR) linha.motivo = `card não está em Treinar (está na etapa ${linha.stage_evo})`
  else { linha.apto = true; linha.motivo = 'ok' }
  linhas.push(linha)
  console.log(
    `${linha.apto ? '✅' : '⛔'} ${nome.padEnd(28)} opp=${String(linha.opp_id ?? '—').padEnd(7)} etapa=${String(linha.stage_evo ?? '—').padEnd(4)} dias=${String(linha.dias_evo ?? '—').padEnd(4)} portal=${String(linha.portal_stage ?? '—').padEnd(20)} ${linha.motivo}`
  )
}

// Por padrão move só quem o portal AIVA confirma com onboarding FINALIZADO.
// --todos ignora essa trava (move também quem está em dados_varejo/not_approved).
const TODOS = process.argv.includes('--todos')
const aptos = linhas.filter((l) => l.apto && (TODOS || l.portal_stage === 'cadastro_finalizado'))
const segurados = linhas.filter((l) => l.apto && !TODOS && l.portal_stage !== 'cadastro_finalizado')
console.log(`\nAptos a mover: ${aptos.length}/${LISTA.length}`)
if (segurados.length) {
  console.log(`⏸  ${segurados.length} SEGURADOS (onboarding não finalizado no portal AIVA) — use --todos pra mover mesmo assim:`)
  for (const l of segurados) console.log(`    ${l.nome} — portal: ${l.portal_stage} (form ${l.portal_form}, bio ${l.portal_bio})`)
}

writeFileSync(process.env.SAIDA + '/treinar-vendendo-analise.json', JSON.stringify(linhas, null, 1))

if (DRY) {
  console.log('\n[DRY] nada foi movido.')
  process.exit(0)
}

// ─── 4) mover
console.log('\nMovendo cards 70 → 51...')
let ok = 0
const falhas = []
for (const l of aptos) {
  const r = await evoPost('/int/changeOpportunityStage', { id: Number(l.opp_id), destStageId: STAGE_VENDENDO })
  // confere de fato onde o card ficou
  await sleep(400)
  const { json } = await evoPost('/int/getOpportunity', { id: Number(l.opp_id) })
  const opp = json?.opportunity ?? json?.data ?? json
  const agora = Number(opp?.fkStage ?? opp?.fk_stage)
  if (agora === STAGE_VENDENDO) { ok++; l.movido = true; console.log(`  ✅ ${l.nome} → 51`) }
  else { l.movido = false; falhas.push({ ...l, http: r.status, resposta: r.txt, etapa_apos: agora }); console.log(`  ⛔ ${l.nome} continua na etapa ${agora} (HTTP ${r.status}) ${r.txt}`) }
  await sleep(500)
}
console.log(`\nMovidos: ${ok}/${aptos.length} | falhas: ${falhas.length}`)
writeFileSync(process.env.SAIDA + '/treinar-vendendo-resultado.json', JSON.stringify({ linhas, falhas }, null, 1))
