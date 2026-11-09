#!/usr/bin/env node
/**
 * Conferência da apuração de comissão da Ume de OUTUBRO/2026.
 *
 * Mesma pergunta de sempre (ver scripts/conferencia-ampla-ume-2026-09.mjs):
 *   1. o valor que a Ume vai pagar fecha com o detalhamento da planilha?
 *   2. alguma loja NOSSA vendeu em outubro e ficou fora do relatório?
 *
 * A segunda é a que importa. Ela cruza o relatório com TODAS as fontes onde a
 * Track registra loja fechada, não só o funil 11:
 *   1. Evo funil 11  — Contas fechadas MRR (tags 7/69), com UME_RID e CNPJ
 *   2. Evo funil 15  — etapas 70/98/71/99/51 (loja criada em diante)
 *   3. sdr_registros_cnpj — CNPJ com rid ou ativa_em preenchido
 *   4. sdr_leads — status TREINAR / LOGIN / LOJA_FINALIZADA_E_VENDENDO
 *   5. Portal AIVA (API de onboardings) — todo cadastro com retailer_id
 *   6. aiva_desempenho — quem o portal diz que consultou/vendeu
 *
 * Prova de venda: aiva_desempenho (deriva de retailer_performance, já filtrada
 * pelo partner_id da Track — é o universo AIVA da Track).
 *
 * Os dois anexos do e-mail ficam em scripts/ume-out2026/. Sem eles o script
 * roda só a parte das NOSSAS lojas (serve pra ter o universo pronto).
 *
 * Uso: node --env-file=.env.local scripts/conferencia-ume-2026-10.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import XLSX from 'xlsx'

const require = createRequire(import.meta.url)
const MES = '2026-10'
const MES_SEG = '2026-11'
const DIR = 'scripts/ume-out2026'
const ANEXOS = [
  { planilha: 'Outros Varejos', arq: `${DIR}/Comissao Track - Outros Varejos - Outubro 2026.xlsx` },
  { planilha: 'FCDL', arq: `${DIR}/Comissao Track - FCDL - Outubro 2026.xlsx` },
]

// Valores anunciados no corpo do e-mail (Ume BackOffice, 05/11/2026 10:01).
const EMAIL = {
  total: 44622.55,
  contratos: 13146, originacao: 5494246.43, mdr: 327848.10,
  outros: { contratos: 11010, originacao: 4899928.93, mdr: 261702.36, comissao: 41963.45 },
  fcdl: { contratos: 2136, originacao: 594317.50, mdr: 66145.74, comissao: 2659.10 },
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const cnpj14 = (v) => { const d = dig(v); return d ? d.padStart(14, '0').slice(-14) : null }
const TOL = 0.02
const problemas = []
const checa = (rotulo, calc, esperado, inteiro = false) => {
  const bate = Math.abs(calc - esperado) <= (inteiro ? 0 : TOL)
  const f = inteiro ? ((v) => String(Math.round(v))) : brl
  console.log('   %s %s | %s  %s', rotulo.padEnd(34), f(calc).padStart(16), f(esperado).padStart(16),
    bate ? 'OK' : `DIVERGE (${(calc - esperado).toFixed(2)})`)
  if (!bate) problemas.push(`${rotulo}: ${calc} x ${esperado}`)
  return bate
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

const pipe = async (pipelineId) => {
  const r = await fetch(`${BASE}/int/getPipeOpportunities`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QID, apiKey: process.env.EVO_TALKS_API_KEY, pipelineId }),
  })
  if (!r.ok) throw new Error(`funil ${pipelineId}: HTTP ${r.status}`)
  return r.json()
}

// ─────────────────────────── 1. o relatório da Ume ───────────────────────────
/**
 * Cada planilha pode ter DUAS tabelas: detalhamento por varejo e
 * "DETALHAMENTO POR ISSUER" (retailer x issuer). As duas fecham no mesmo TOTAL
 * GERAL — somar as duas junto dobra tudo. Por isso a aba por issuer é marcada
 * e excluída das somas.
 */
function lerRelatorio() {
  const linhas = []
  const faltando = []
  for (const { planilha, arq } of ANEXOS) {
    if (!existsSync(arq)) { faltando.push(arq); continue }
    const wb = XLSX.readFile(arq)
    for (const aba of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null })
      const iH = rows.findIndex((r) => String(r?.[0] ?? '').trim().toUpperCase() === 'RETAILER ID')
      if (iH < 0) continue
      const cab = rows[iH].map((c) => String(c ?? '').trim().toUpperCase())
      const temIssuer = cab[4] === 'ISSUER'
      const porIssuer = temIssuer || /ISSUER/.test(aba.toUpperCase())
      for (const r of rows.slice(iH + 1)) {
        // ⚠️ Number(null) é 0 e passa no isFinite — sem esta guarda as linhas de
        // subtotal e TOTAL GERAL (retailer id vazio) entram como se fossem loja.
        if (r?.[0] == null || r[0] === '') continue
        const rid = Number(r[0])
        if (!Number.isFinite(rid)) continue
        const d = temIssuer ? r.slice(5) : r.slice(4)
        linhas.push({
          planilha, aba, porIssuer, rid: String(rid), cnpj: cnpj14(r?.[1]),
          varejo: String(r?.[2] ?? '').trim(), grupo: String(r?.[3] ?? '').trim(),
          issuer: temIssuer ? String(r?.[4] ?? '').trim() : null,
          contratos: Number(d[0]) || 0, originacao: Number(d[1]) || 0,
          mdr: Number(d[2]) || 0, comissao: Number(d[3]) || 0,
        })
      }
    }
  }
  return { linhas, faltando }
}

const { linhas: rel, faltando } = lerRelatorio()
const temRelatorio = rel.length > 0
const relVarejo = rel.filter((l) => !l.porIssuer)

if (faltando.length) {
  console.log('⚠️  anexo(s) ausente(s) — baixar do e-mail para %s/:', DIR)
  for (const f of faltando) console.log('     %s', f)
  console.log('')
}

// ─────────────── 2. o relatório fecha com o que o e-mail anuncia? ───────────────
if (temRelatorio) {
  console.log('=============== 1. O RELATÓRIO FECHA COM O E-MAIL? ===============')
  const soma = (ls, c) => ls.reduce((s, l) => s + (l[c] || 0), 0)
  for (const [nome, chave] of [['Outros Varejos + IVS', 'Outros Varejos'], ['FCDL', 'FCDL']]) {
    const ls = relVarejo.filter((l) => l.planilha === chave)
    if (!ls.length) continue
    const esp = chave === 'FCDL' ? EMAIL.fcdl : EMAIL.outros
    console.log('\n%s — %d linhas de varejo', nome, ls.length)
    checa('contratos', soma(ls, 'contratos'), esp.contratos, true)
    checa('originação', soma(ls, 'originacao'), esp.originacao)
    checa('MDR', soma(ls, 'mdr'), esp.mdr)
    checa('comissão', soma(ls, 'comissao'), esp.comissao)
    // a aba por issuer, quando existe, tem de fechar no mesmo total
    const iss = rel.filter((l) => l.planilha === chave && l.porIssuer)
    if (iss.length) {
      console.log('   (aba por issuer: %d linhas)', iss.length)
      checa('  issuer x varejo · comissão', soma(iss, 'comissao'), soma(ls, 'comissao'))
      checa('  issuer x varejo · contratos', soma(iss, 'contratos'), soma(ls, 'contratos'), true)
    }
  }
  console.log('\nCONSOLIDADO')
  checa('contratos', soma(relVarejo, 'contratos'), EMAIL.contratos, true)
  checa('originação', soma(relVarejo, 'originacao'), EMAIL.originacao)
  checa('MDR', soma(relVarejo, 'mdr'), EMAIL.mdr)
  checa('comissão total', soma(relVarejo, 'comissao'), EMAIL.total)
  checa('soma das duas apurações', EMAIL.outros.comissao + EMAIL.fcdl.comissao, EMAIL.total)
}

const ridRel = new Set(relVarejo.map((l) => String(l.rid)))
const cnpjRel = new Set(relVarejo.map((l) => l.cnpj).filter(Boolean))
const comissaoPorRid = new Map()
for (const l of relVarejo) comissaoPorRid.set(String(l.rid), (comissaoPorRid.get(String(l.rid)) ?? 0) + l.comissao)
if (temRelatorio) {
  console.log('\nrelatório out/26: %d linhas de varejo (%d Outros Varejos + %d FCDL), %d retailer IDs, %d CNPJs legíveis',
    relVarejo.length, relVarejo.filter((l) => l.planilha === 'Outros Varejos').length,
    relVarejo.filter((l) => l.planilha === 'FCDL').length, ridRel.size, cnpjRel.size)
}

// ─────────────────────── 3. todas as fontes de loja nossa ───────────────────────
const ETAPAS_LOJA_CRIADA = { 70: 'Cadastro finalizado', 98: 'Treinamento agendado', 71: 'Pronto para operar', 99: 'Primeiro acesso', 51: 'Vendendo' }
const STATUS_LOJA = ['TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']

// parseDescricaoOpp é a mesma do painel — reusa em vez de reescrever
rmSync('.tsc-tmp', { recursive: true, force: true })
execSync('npx tsc lib/comissoes.ts --outDir .tsc-tmp --module commonjs --target es2020 --esModuleInterop --skipLibCheck', { stdio: 'pipe' })
const { parseDescricaoOpp } = require(process.cwd() + '/.tsc-tmp/comissoes.js')

const [f11, f15, registros, leads, desempMes, desempSeg] = await Promise.all([
  pipe(11),
  pipe(15),
  todos('sdr_registros_cnpj', 'cnpj,loja,rid,ativa_em,status,lead_id'),
  todos('sdr_leads', 'id,nome,telefone,status,observacoes', (q) => q.in('status', STATUS_LOJA)),
  todos('aiva_desempenho', 'cnpj,nome_varejo,rid,consultas,aprovados,vendas,valor_vendas,status_portal,cadastro_em', (q) => q.eq('mes', MES)),
  todos('aiva_desempenho', 'cnpj,rid,vendas,valor_vendas', (q) => q.eq('mes', MES_SEG)),
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

console.log('\nfontes: funil 11 = %d cards | funil 15 = %d cards | registros_cnpj = %d | leads loja = %d | desempenho out = %d | onboardings = %d',
  f11.length, f15.length, registros.length, leads.length, desempMes.length, onboardings.length)

// ─────────────────────── 4. consolida num mapa por loja ───────────────────────
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
  for (const c of [...regs.map((r) => r.cnpj), ...cnpjObs]) {
    const l = pegar(c, null, ld.nome)
    if (l) { l.fontes.add(`sdr_leads · ${ld.status}`); l.statusLead = ld.status; l.telefone = ld.telefone }
  }
}
for (const o of onboardings) {
  if (!o.retailer_id) continue
  const l = pegar(o.cnpj, o.retailer_id, o.legal_name ?? o.retailer_name)
  if (l) l.fontes.add('portal AIVA (cadastro com loja criada)')
}
for (const d of desempMes) {
  const l = pegar(d.cnpj, d.rid, d.nome_varejo)
  if (!l) continue
  l.fontes.add(`portal AIVA (desempenho ${MES})`)
  l.consultas = Number(d.consultas) || 0
  l.aprovados = Number(d.aprovados) || 0
  l.vendas = Number(d.vendas) || 0
  l.valorVendas = Number(d.valor_vendas) || 0
  l.statusPortal = d.status_portal
  l.cadastroEm = d.cadastro_em
}
for (const d of desempSeg) {
  const l = lojas.get(cnpj14(d.cnpj) ?? `rid:${d.rid}`)
  if (l) { l.vendasSeg = Number(d.vendas) || 0; l.valorSeg = Number(d.valor_vendas) || 0 }
}

// ─────────────────────── 5. cruza com o relatório ───────────────────────
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

console.log('\n==================== 2. ALGUMA LOJA NOSSA FICOU FORA? ====================')
console.log('lojas distintas reunidas de todas as fontes: %d', arr.length)
console.log('  com retailer ID conhecido ............... %d', arr.length - semRid.length)
console.log('  SEM retailer ID em lugar nenhum ......... %d  (não dá pra casar com o relatório)', semRid.length)
console.log('  que o portal diz que venderam em out/26 . %d', vendeu.length)
if (temRelatorio) console.log('  DESSAS, fora do relatório ............... %d', vendeuFora.length)

if (temRelatorio) {
  console.log('\n--- 🔴 VENDERAM EM OUTUBRO E NÃO ESTÃO NO RELATÓRIO ---')
  if (!vendeuFora.length) console.log('  nenhuma')
  for (const l of vendeuFora.sort((a, b) => (b.valorVendas ?? 0) - (a.valorVendas ?? 0))) {
    console.log('  CNPJ %s  RID %s  %s', String(l.cnpj ?? '—').padEnd(14), [...l.rids].join('/').padEnd(6), [...l.nomes][0] ?? '?')
    console.log('     portal out: %d consultas, %d aprovados, %d vendas, %s | nov: %s vendas',
      l.consultas, l.aprovados, l.vendas, brl(l.valorVendas), l.vendasSeg ?? '—')
    console.log('     fontes: %s', [...l.fontes].join(' · '))
  }

  console.log('\n--- ⚠️ loja com RID, sem venda no portal e fora do relatório: %d ---', criadaSemVenda.length)
  console.log('  (esperado: loja criada que ainda não vendeu. Só vira problema se a venda existir em outro canal.)')

  // linhas do relatório que não batem com nenhuma loja nossa
  const nossosRids = new Set(arr.flatMap((l) => [...l.rids]))
  const soRelatorio = relVarejo.filter((l) => !nossosRids.has(String(l.rid)))
  console.log('\n--- linhas do relatório sem loja nossa correspondente: %d (comissão %s) ---',
    soRelatorio.length, brl(soRelatorio.reduce((s, l) => s + l.comissao, 0)))
  console.log('  (são varejos da Ume fora da nossa carteira AIVA: óticas, moda, FCDL etc.)')

  // lojas nossas pagas: quanto da comissão do mês é da nossa carteira
  const pagas = arr.filter((l) => l.noRelatorio)
  console.log('\n--- nossas lojas DENTRO do relatório: %d | comissão somada %s ---',
    pagas.length, brl(pagas.reduce((s, l) => s + (l.comissao ?? 0), 0)))

  writeFileSync('scripts/out-conferencia-ume-2026-10.json', JSON.stringify({
    mes: MES,
    email: EMAIL,
    relatorio: { linhas: relVarejo.length, rids: ridRel.size, porIssuer: rel.length - relVarejo.length },
    problemas,
    lojas: arr.map((l) => ({
      cnpj: l.cnpj, rids: [...l.rids], nomes: [...l.nomes], fontes: [...l.fontes],
      etapa15: l.etapa15 ?? null, statusLead: l.statusLead ?? null, telefone: l.telefone ?? null,
      statusPortal: l.statusPortal ?? null, cadastroEm: l.cadastroEm ?? null, ativaEm: l.ativaEm ?? null,
      consultas: l.consultas ?? 0, aprovados: l.aprovados ?? 0, vendas: l.vendas ?? 0,
      valorVendas: l.valorVendas ?? 0, vendasSeg: l.vendasSeg ?? 0,
      noRelatorio: l.noRelatorio, comoCasou: l.comoCasou, comissao: l.comissao ?? 0,
    })),
    relatorioLinhas: relVarejo,
    soRelatorio,
  }, null, 1))
  console.log('\ndump: scripts/out-conferencia-ume-2026-10.json')
}

console.log('\n%s', problemas.length ? `⚠️  ${problemas.length} divergência(s): ${problemas.join(' | ')}` : '✅ sem divergência nas somas')
rmSync('.tsc-tmp', { recursive: true, force: true })
setTimeout(() => process.exit(0), 800).unref()
