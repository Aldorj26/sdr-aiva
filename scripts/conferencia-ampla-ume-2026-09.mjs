#!/usr/bin/env node
/**
 * Conferência AMPLA da comissão Ume de setembro/2026 (pedido do Aldo, 09/10).
 *
 * A conferência do painel (/comissoes, lib/comissoes.ts) cruza o relatório da
 * Ume com UMA fonte: o funil 11 (Contas fechadas MRR). Aqui a pergunta é outra:
 * "em TODOS os lugares onde a Track registra loja fechada, tem alguma vendendo
 * que não apareceu no relatório?"
 *
 * Fontes de loja fechada:
 *   1. Evo funil 11  — Contas fechadas MRR (tags 7/69), com UME_RID e CNPJ
 *   2. Evo funil 15  — etapas 70/98/71/99/51 (loja criada em diante)
 *   3. sdr_registros_cnpj — CNPJ com rid ou ativa_em preenchido
 *   4. sdr_leads — status TREINAR / LOGIN / LOJA_FINALIZADA_E_VENDENDO
 *   5. Portal AIVA (API de onboardings) — todo cadastro com retailer_id
 *   6. aiva_desempenho — quem o portal diz que consultou/vendeu
 *
 * Prova de venda: aiva_desempenho (deriva de retailer_performance, que já vem
 * filtrada pelo partner_id da Track — ou seja, é o universo AIVA da Track).
 *
 * Uso: node --env-file=.env.local scripts/conferencia-ampla-ume-2026-09.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import XLSX from 'xlsx'

const require = createRequire(import.meta.url)
const MES = '2026-09'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const cnpj14 = (v) => { const d = dig(v); return d ? d.padStart(14, '0').slice(-14) : null }

// parseDescricaoOpp é a mesma do painel — reusa em vez de reescrever
rmSync('.tsc-tmp', { recursive: true, force: true })
execSync('npx tsc lib/comissoes.ts --outDir .tsc-tmp --module commonjs --target es2020 --esModuleInterop --skipLibCheck', { stdio: 'pipe' })
const { parseDescricaoOpp } = require(process.cwd() + '/.tsc-tmp/comissoes.js')

const pipe = async (pipelineId) => {
  const r = await fetch(`${BASE}/int/getPipeOpportunities`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QID, apiKey: process.env.EVO_TALKS_API_KEY, pipelineId }),
  })
  if (!r.ok) throw new Error(`funil ${pipelineId}: HTTP ${r.status}`)
  return r.json()
}

// paginação: PostgREST corta em 1000 e isso já mordeu a gente antes
const todos = async (tabela, select, filtro = (q) => q) => {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(sb.from(tabela).select(select)).range(de, de + 999)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ─────────────────────────── 1. o relatório da Ume ───────────────────────────
function lerRelatorio() {
  const linhas = []
  const wb = XLSX.readFile('scripts/ume-outros-varejos-set2026.xlsx')
  for (const aba of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null })
    const iH = rows.findIndex((r) => String(r?.[0] ?? '').trim().toUpperCase() === 'RETAILER ID')
    if (iH < 0) continue
    const temIssuer = String(rows[iH][4] ?? '').trim().toUpperCase() === 'ISSUER'
    for (const r of rows.slice(iH + 1)) {
      // ⚠️ Number(null) é 0 e passa no isFinite — sem esta guarda as linhas de
      // subtotal e TOTAL GERAL (retailer id vazio) entram como se fossem loja.
      if (r?.[0] == null || r[0] === '') continue
      const rid = Number(r[0])
      if (!Number.isFinite(rid)) continue
      const d = temIssuer ? r.slice(5) : r.slice(4)
      linhas.push({
        planilha: 'Outros Varejos', aba, rid: String(rid), cnpj: cnpj14(r?.[1]),
        varejo: String(r?.[2] ?? '').trim(), grupo: String(r?.[3] ?? '').trim(),
        issuer: temIssuer ? String(r?.[4] ?? '').trim() : null,
        contratos: Number(d[0]) || 0, originacao: Number(d[1]) || 0,
        mdr: Number(d[2]) || 0, comissao: Number(d[3]) || 0,
      })
    }
  }
  // FCDL: o .xlsx não pôde ser baixado; o CSV lido do Drive tem RID e nome
  // exatos, mas o CNPJ veio em notação científica (6 dígitos significativos).
  for (const l of readFileSync('scripts/dados-fcdl-set2026.csv', 'utf8').split('\n').slice(1)) {
    if (!l.trim()) continue
    const p = l.split(',')
    linhas.push({
      planilha: 'FCDL', aba: 'RESUMO', rid: p[0], cnpj: null, cnpjAprox: p[1],
      varejo: p[2], grupo: p[3], issuer: null,
      contratos: Number(p[4]), originacao: Number(p[5]), mdr: Number(p[6]), comissao: Number(p[7]),
    })
  }
  return linhas
}

const rel = lerRelatorio()
const relVarejo = rel.filter((l) => l.aba !== 'POR ISSUER')
const ridRel = new Set(relVarejo.map((l) => String(l.rid)))
const cnpjRel = new Set(relVarejo.map((l) => l.cnpj).filter(Boolean))
const comissaoPorRid = new Map()
for (const l of relVarejo) comissaoPorRid.set(String(l.rid), (comissaoPorRid.get(String(l.rid)) ?? 0) + l.comissao)
console.log('relatório set/26: %d linhas de varejo (%d Outros Varejos + %d FCDL), %d retailer IDs, %d CNPJs legíveis',
  relVarejo.length, relVarejo.filter((l) => l.planilha === 'Outros Varejos').length,
  relVarejo.filter((l) => l.planilha === 'FCDL').length, ridRel.size, cnpjRel.size)

// ─────────────────────── 2. todas as fontes de loja nossa ───────────────────────
const ETAPAS_LOJA_CRIADA = { 70: 'Cadastro finalizado', 98: 'Treinamento agendado', 71: 'Pronto para operar', 99: 'Primeiro acesso', 51: 'Vendendo' }
const STATUS_LOJA = ['TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']

const [f11, f15, registros, leads, desemp09, desemp10] = await Promise.all([
  pipe(11),
  pipe(15),
  todos('sdr_registros_cnpj', 'cnpj,loja,rid,ativa_em,status,lead_id'),
  todos('sdr_leads', 'id,nome,telefone,status,observacoes', (q) => q.in('status', STATUS_LOJA)),
  todos('aiva_desempenho', 'cnpj,nome_varejo,rid,consultas,aprovados,vendas,valor_vendas,status_portal,cadastro_em', (q) => q.eq('mes', MES)),
  todos('aiva_desempenho', 'cnpj,rid,vendas,valor_vendas', (q) => q.eq('mes', '2026-10')),
])

// API pública de onboardings do portal AIVA — mesma chamada de
// listarOnboardingsApi() em lib/portal-aiva.ts (paginada por cursor, teto 500).
const onboardings = []
{
  let cursor = null
  do {
    const q = new URLSearchParams({ limit: '500' })
    if (cursor) q.set('cursor', cursor)
    const res = await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, {
      headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`API de onboardings HTTP ${res.status}`)
    const d = await res.json()
    onboardings.push(...(d.records ?? []))
    cursor = d.next_cursor ?? null
  } while (cursor)
}

console.log('fontes: funil 11 = %d cards | funil 15 = %d cards | registros_cnpj = %d | leads loja = %d | desempenho set = %d | onboardings = %d',
  f11.length, f15.length, registros.length, leads.length, desemp09.length, onboardings.length)

// ─────────────────────── 3. consolida num mapa por loja ───────────────────────
/** chave = CNPJ quando existe, senão rid:<n> */
const lojas = new Map()
const pegar = (cnpj, rid, nome) => {
  const c = cnpj14(cnpj)
  const chave = c ?? (rid ? `rid:${rid}` : null)
  if (!chave) return null
  let l = lojas.get(chave)
  if (!l) { l = { chave, cnpj: c, rids: new Set(), nomes: new Set(), fontes: new Set() }; lojas.set(chave, l) }
  if (rid) l.rids.add(String(rid))
  if (nome) l.nomes.add(String(nome).trim())
  return l
}

for (const o of f11) {
  if (!((o.tags ?? []).includes(7) || (o.tags ?? []).includes(69))) continue
  const { umeRid, cnpj } = parseDescricaoOpp(o.description ?? '')
  const l = pegar(cnpj, umeRid, o.title)
  if (l) { l.fontes.add('funil 11 (contas fechadas)'); l.oppF11 = o.id }
}
for (const o of f15) {
  // o campo da etapa no Evo é fkStage (não stageid — isso já custou uma rodada)
  const nome = ETAPAS_LOJA_CRIADA[o.fkStage]
  if (!nome) continue
  const { umeRid, cnpj } = parseDescricaoOpp(o.description ?? '')
  const l = pegar(cnpj, umeRid, o.title)
  if (l) { l.fontes.add(`funil 15 · ${nome}`); l.etapa15 = nome }
}
for (const r of registros) {
  if (!r.rid && !r.ativa_em) continue
  const l = pegar(r.cnpj, r.rid, r.loja)
  if (l) { l.fontes.add('sdr_registros_cnpj (rid/ativa)'); if (r.ativa_em) l.ativaEm = r.ativa_em }
}
const regPorLead = new Map()
for (const r of registros) {
  if (!r.lead_id) continue
  if (!regPorLead.has(r.lead_id)) regPorLead.set(r.lead_id, [])
  regPorLead.get(r.lead_id).push(r)
}
for (const ld of leads) {
  const regs = regPorLead.get(ld.id) ?? []
  const cnpjObs = (ld.observacoes ?? '').match(/\b(\d{14})\b/g) ?? []
  const cands = [...regs.map((r) => r.cnpj), ...cnpjObs]
  for (const c of cands) {
    const l = pegar(c, null, ld.nome)
    if (l) { l.fontes.add(`sdr_leads · ${ld.status}`); l.statusLead = ld.status; l.telefone = ld.telefone }
  }
}
for (const o of onboardings) {
  if (!o.retailer_id) continue
  const l = pegar(o.cnpj, o.retailer_id, o.legal_name ?? o.retailer_name)
  if (l) l.fontes.add('portal AIVA (cadastro com loja criada)')
}
for (const d of desemp09) {
  const l = pegar(d.cnpj, d.rid, d.nome_varejo)
  if (!l) continue
  l.fontes.add('portal AIVA (desempenho set/26)')
  l.consultas = Number(d.consultas) || 0
  l.aprovados = Number(d.aprovados) || 0
  l.vendas = Number(d.vendas) || 0
  l.valorVendas = Number(d.valor_vendas) || 0
  l.statusPortal = d.status_portal
  l.cadastroEm = d.cadastro_em
}
for (const d of desemp10) {
  const l = lojas.get(cnpj14(d.cnpj) ?? `rid:${d.rid}`)
  if (l) { l.vendasOut = Number(d.vendas) || 0; l.valorOut = Number(d.valor_vendas) || 0 }
}

// ─────────────────────── 4. cruza com o relatório ───────────────────────
for (const l of lojas.values()) {
  const porRid = [...l.rids].filter((r) => ridRel.has(r))
  const porCnpj = l.cnpj && cnpjRel.has(l.cnpj)
  l.noRelatorio = porRid.length > 0 || porCnpj
  l.comoCasou = porRid.length ? `retailer ${porRid.join('/')}` : porCnpj ? 'CNPJ' : null
  l.comissao = porRid.reduce((s, r) => s + (comissaoPorRid.get(r) ?? 0), 0)
  if (!porRid.length && porCnpj) {
    l.comissao = relVarejo.filter((x) => x.cnpj === l.cnpj).reduce((s, x) => s + x.comissao, 0)
  }
}

const arr = [...lojas.values()]
const vendeu = arr.filter((l) => (l.vendas ?? 0) > 0)
const vendeuFora = vendeu.filter((l) => !l.noRelatorio)
const semRid = arr.filter((l) => !l.rids.size)
const criadaSemVenda = arr.filter((l) => l.rids.size && !(l.vendas > 0) && !l.noRelatorio)

console.log('\n==================== RESULTADO ====================')
console.log('lojas distintas reunidas de todas as fontes: %d', arr.length)
console.log('  com retailer ID conhecido ............... %d', arr.length - semRid.length)
console.log('  SEM retailer ID em lugar nenhum ......... %d  (não dá pra casar com o relatório)', semRid.length)
console.log('  que o portal diz que venderam em set/26 . %d', vendeu.length)
console.log('  DESSAS, fora do relatório ............... %d', vendeuFora.length)

console.log('\n--- 🔴 VENDERAM EM SETEMBRO E NÃO ESTÃO NO RELATÓRIO ---')
if (!vendeuFora.length) console.log('  nenhuma')
for (const l of vendeuFora.sort((a, b) => (b.valorVendas ?? 0) - (a.valorVendas ?? 0))) {
  console.log('  CNPJ %s  RID %s  %s', String(l.cnpj ?? '—').padEnd(14), [...l.rids].join('/').padEnd(6), [...l.nomes][0] ?? '?')
  console.log('     portal set: %d consultas, %d aprovados, %d vendas, %s | out: %s vendas',
    l.consultas, l.aprovados, l.vendas, brl(l.valorVendas), l.vendasOut ?? '—')
  console.log('     fontes: %s', [...l.fontes].join(' · '))
}

console.log('\n--- ⚠️ loja com RID, sem venda no portal e fora do relatório: %d ---', criadaSemVenda.length)
console.log('  (esperado: loja criada que ainda não vendeu. Só vira problema se a venda existir em outro canal.)')

console.log('\n--- ⚠️ loja nossa SEM retailer ID (não casa com relatório): %d ---', semRid.length)
for (const l of semRid.slice(0, 20)) {
  console.log('  CNPJ %s  %s  | fontes: %s', String(l.cnpj ?? '—').padEnd(14),
    ([...l.nomes][0] ?? '?').slice(0, 34).padEnd(34), [...l.fontes].join(' · '))
}
if (semRid.length > 20) console.log('  … e mais %d', semRid.length - 20)

// linhas do relatório que não batem com nenhuma loja nossa
const nossosRids = new Set(arr.flatMap((l) => [...l.rids]))
const soRelatorio = relVarejo.filter((l) => !nossosRids.has(String(l.rid)))
console.log('\n--- linhas do relatório sem loja nossa correspondente: %d (comissão %s) ---',
  soRelatorio.length, brl(soRelatorio.reduce((s, l) => s + l.comissao, 0)))
console.log('  (são varejos da Ume fora da nossa carteira AIVA: óticas, moda, FCDL etc.)')

writeFileSync('scripts/out-conferencia-ampla-2026-09.json', JSON.stringify({
  mes: MES,
  relatorio: { linhas: relVarejo.length, rids: ridRel.size },
  lojas: arr.map((l) => ({
    cnpj: l.cnpj, rids: [...l.rids], nomes: [...l.nomes], fontes: [...l.fontes],
    etapa15: l.etapa15 ?? null, statusLead: l.statusLead ?? null, telefone: l.telefone ?? null,
    statusPortal: l.statusPortal ?? null, cadastroEm: l.cadastroEm ?? null, ativaEm: l.ativaEm ?? null,
    consultas: l.consultas ?? 0, aprovados: l.aprovados ?? 0, vendas: l.vendas ?? 0,
    valorVendas: l.valorVendas ?? 0, vendasOut: l.vendasOut ?? 0,
    noRelatorio: l.noRelatorio, comoCasou: l.comoCasou, comissao: l.comissao ?? 0,
  })),
  soRelatorio,
}, null, 1))
console.log('\ndump: scripts/out-conferencia-ampla-2026-09.json')
rmSync('.tsc-tmp', { recursive: true, force: true })
setTimeout(() => process.exit(0), 800).unref()
