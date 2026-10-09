#!/usr/bin/env node
/**
 * Aprofunda a conferência ampla:
 *  a) qual a COBERTURA real da prova de venda (quantas linhas do relatório o
 *     portal AIVA consegue enxergar);
 *  b) o que são, uma a uma, as lojas nossas sem retailer ID.
 *
 * Uso: node --env-file=.env.local scripts/investigar-sem-rid-2026-09.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const cnpj14 = (v) => { const d = dig(v); return d ? d.padStart(14, '0').slice(-14) : null }
const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const amplo = JSON.parse(readFileSync('scripts/out-conferencia-ampla-2026-09.json', 'utf8'))

// ── relatório, por issuer
const wb = XLSX.readFile('scripts/ume-outros-varejos-set2026.xlsx')
const porIssuer = []
{
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['POR ISSUER'], { header: 1, raw: true, defval: null })
  const iH = rows.findIndex((r) => String(r?.[0] ?? '').trim().toUpperCase() === 'RETAILER ID')
  for (const r of rows.slice(iH + 1)) {
    if (r?.[0] == null || r[0] === '') continue
    porIssuer.push({ rid: String(Number(r[0])), cnpj: cnpj14(r[1]), varejo: String(r[2] ?? '').trim(),
      issuer: String(r[4] ?? '').trim(), contratos: Number(r[5]) || 0, comissao: Number(r[8]) || 0 })
  }
}

const desemp = []
for (let de = 0; ; de += 1000) {
  const { data } = await sb.from('aiva_desempenho').select('cnpj,rid,vendas,valor_vendas,consultas').eq('mes', '2026-09').range(de, de + 999)
  desemp.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
const ridPortal = new Set(desemp.map((d) => String(d.rid)).filter((r) => r && r !== 'null'))

console.log('==== COBERTURA DA PROVA DE VENDA ====')
const porIssuerRid = new Map()
for (const l of porIssuer) {
  const d = porIssuerRid.get(l.issuer) ?? { rids: new Set(), vistos: new Set(), com: 0 }
  d.rids.add(l.rid)
  if (ridPortal.has(l.rid)) d.vistos.add(l.rid)
  d.com += l.comissao
  porIssuerRid.set(l.issuer, d)
}
// console.log do Node não entende %-12s (só %s/%d) — pad na mão.
for (const [issuer, d] of porIssuerRid) {
  console.log('  issuer ' + issuer.padEnd(12) +
    String(d.rids.size).padStart(4) + ' varejos no relatório | ' +
    String(d.vistos.size).padStart(3) + ' visíveis no portal AIVA (' +
    Math.round((100 * d.vistos.size) / d.rids.size) + '%) | comissão ' + brl(d.com))
}
const todosRidRel = new Set(porIssuer.map((l) => l.rid))
console.log('  TOTAL Outros Varejos: ' + todosRidRel.size + ' varejos | ' +
  [...todosRidRel].filter((r) => ridPortal.has(r)).length + ' visíveis no portal')
console.log('  (FCDL é outro canal — 311 varejos, nenhum passa pelo portal AIVA)')

// um varejo pode vender por mais de um issuer: o que importa é se ELE é visível
const ridsUme = new Set(porIssuer.filter((l) => l.issuer === 'UME').map((l) => l.rid))
const ridsAiva = new Set(porIssuer.filter((l) => l.issuer === 'AIVA').map((l) => l.rid))
const ridsOdres = new Set(porIssuer.filter((l) => l.issuer === 'ODRES_CRED').map((l) => l.rid))
const soUme = [...ridsUme].filter((r) => !ridsAiva.has(r) && !ridsOdres.has(r))
const comissaoSoUme = porIssuer.filter((l) => soUme.includes(l.rid)).reduce((s, l) => s + l.comissao, 0)
console.log('\n  varejos que SÓ aparecem no issuer UME (nunca AIVA nem Odres): ' + soUme.length +
  ' | comissão ' + brl(comissaoSoUme))
console.log('  desses, visíveis no portal AIVA: ' + soUme.filter((r) => ridPortal.has(r)).length)
const nossos = new Set(amplo.lojas.flatMap((l) => l.rids))
console.log('  desses, que são loja NOSSA (funil 11/15, registros, leads): ' + soUme.filter((r) => nossos.has(r)).length)

// ── as 47 sem retailer id
const semRid = amplo.lojas.filter((l) => !l.rids.length)
let onb = []
{
  let cursor = null
  do {
    const q = new URLSearchParams({ limit: '500' })
    if (cursor) q.set('cursor', cursor)
    const res = await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, {
      headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY }, signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`onboardings HTTP ${res.status}`)
    const d = await res.json()
    onb.push(...(d.records ?? []))
    cursor = d.next_cursor ?? null
  } while (cursor)
}
const onbPorCnpj = new Map(onb.map((o) => [cnpj14(o.cnpj), o]))
const comRid = new Map(amplo.lojas.filter((l) => l.rids.length).map((l) => [l.cnpj, l]))

// irmãs: mesmo lead OU mesma raiz de CNPJ (8 primeiros dígitos) com RID
const raizComRid = new Map()
for (const l of amplo.lojas) if (l.cnpj && l.rids.length) raizComRid.set(l.cnpj.slice(0, 8), l)

console.log('\n==== %d LOJAS NOSSAS SEM RETAILER ID ====', semRid.length)
const classes = { filial_matriz_tem_rid: [], portal_sem_loja: [], portal_tem_rid: [], fora_do_portal: [] }
for (const l of semRid) {
  const o = l.cnpj ? onbPorCnpj.get(l.cnpj) : null
  const irma = l.cnpj ? raizComRid.get(l.cnpj.slice(0, 8)) : null
  let classe
  if (o && o.retailer_id) classe = 'portal_tem_rid'
  else if (o) classe = 'portal_sem_loja'
  else if (irma) classe = 'filial_matriz_tem_rid'
  else classe = 'fora_do_portal'
  classes[classe].push({ ...l, onb: o ? { stage: o.stage, board: o.board_column, rid: o.retailer_id ?? null, criado: o.created_at } : null,
    irma: irma ? { cnpj: irma.cnpj, rids: irma.rids, nome: irma.nomes[0], vendas: irma.vendas, noRelatorio: irma.noRelatorio } : null })
}

const rot = {
  portal_tem_rid: '🔴 TEM loja criada no portal (com retailer id) e nós não gravamos o RID — pode estar comissionando sem a gente saber',
  portal_sem_loja: '🟡 cadastro existe no portal mas a AIVA ainda NÃO criou a loja — não vende, não comissiona',
  filial_matriz_tem_rid: '🟢 filial de uma matriz que tem RID (mesma raiz de CNPJ) — vende sob o RID da matriz',
  fora_do_portal: '🔴 não existe no portal da AIVA com esse CNPJ — card de conta fechada sem cadastro correspondente',
}
for (const [k, lista] of Object.entries(classes)) {
  console.log('\n--- %s: %d ---', rot[k], lista.length)
  for (const l of lista) {
    console.log('  %s  %s', String(l.cnpj ?? '—').padEnd(14), (l.nomes[0] ?? '?').slice(0, 40))
    if (l.onb) console.log('       portal: stage=%s coluna=%s rid=%s', l.onb.stage, l.onb.board, l.onb.rid ?? '—')
    if (l.irma) console.log('       matriz: %s RID %s %s | relatório: %s',
      l.irma.cnpj, l.irma.rids.join('/'), l.irma.nome, l.irma.noRelatorio ? 'sim' : 'NÃO')
    if (l.statusLead) console.log('       lead: %s | tel %s', l.statusLead, l.telefone ?? '—')
  }
}

writeFileSync('scripts/out-sem-rid-2026-09.json', JSON.stringify({ cobertura: [...porIssuerRid].map(([i, d]) => ({ issuer: i, varejos: d.rids.size, noPortal: d.vistos.size, comissao: d.com })), classes }, null, 1))
console.log('\ndump: scripts/out-sem-rid-2026-09.json')
setTimeout(() => process.exit(0), 800).unref()
