#!/usr/bin/env node
/**
 * Compara a apuração de SETEMBRO/2026 (lida das planilhas do e-mail de 08/10)
 * com AGOSTO/2026 (já importado em ume_comissoes) e com o desempenho das lojas
 * AIVA no portal (aiva_desempenho), procurando:
 *   - mudança de taxa de comissão por grupo
 *   - loja que comissionou em agosto e sumiu em setembro
 *   - loja AIVA que vendeu no portal em setembro e não está no relatório
 *
 * Uso: node --env-file=.env.local scripts/comparar-comissao-ume-set-vs-ago.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const brl = (v) => 'R$ ' + (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── setembro, do JSON gerado pelo conferidor
const setTodas = JSON.parse(readFileSync('scripts/out-comissao-ume-2026-09.json', 'utf8'))
const set = setTodas.filter((l) => l.issuer === null) // só o detalhamento por varejo

// ── agosto, do banco
const { data: ago, error } = await sb.from('ume_comissoes').select('*').eq('mes', '2026-08')
if (error) { console.error('erro lendo ume_comissoes:', error.message); process.exit(1) }
if (!ago?.length) { console.error('agosto não está importado em ume_comissoes'); process.exit(1) }

console.log('setembro: %d linhas de varejo | agosto: %d linhas', set.length, ago.length)
console.log('colunas de agosto:', Object.keys(ago[0]).join(', '))

const taxa = (linhas, chaveGrupo = 'grupo') => {
  const m = new Map()
  for (const l of linhas) {
    const g = l[chaveGrupo] || 'SEM GRUPO'
    const d = m.get(g) ?? { mdr: 0, com: 0, n: 0 }
    d.mdr += Number(l.mdr) || 0
    d.com += Number(l.comissao) || 0
    d.n++
    m.set(g, d)
  }
  return m
}

// a planilha FCDL e a "Outros Varejos" têm grupos de MESMO NOME (SEM GRUPO,
// INSIDE_SALES) com taxas diferentes — misturar as duas inventa uma taxa média
// que não existe em contrato nenhum. Separa por origem antes de comparar.
const ridsFcdl = new Set(
  readFileSync('scripts/dados-fcdl-set2026.csv', 'utf8')
    .split('\n').slice(1).filter(Boolean)
    .map((l) => l.split(',')[0] + '|' + l.split(',')[2]),
)
const origemSet = (l) => (ridsFcdl.has(l.rid + '|' + l.varejo) ? 'fcdl' : 'carteira')
for (const l of set) l.origem = origemSet(l)

console.log('\n=== taxa comissão/MDR por grupo (origem + grupo) ===')
const comOrigem = (linhas) => linhas.map((l) => ({ ...l, grupo: `${l.origem} · ${l.grupo || 'SEM GRUPO'}` }))
const tSet = taxa(comOrigem(set)), tAgo = taxa(comOrigem(ago))
const grupos = [...new Set([...tSet.keys(), ...tAgo.keys()])].sort()
for (const g of grupos) {
  const a = tAgo.get(g), s = tSet.get(g)
  const pa = a?.mdr ? (100 * a.com) / a.mdr : null
  const ps = s?.mdr ? (100 * s.com) / s.mdr : null
  const alerta = pa !== null && ps !== null && Math.abs(pa - ps) > 0.05 ? '  <<< MUDOU' : ''
  console.log(
    '  %s ago %s  set %s%s',
    g.padEnd(28),
    (a ? `${String(a.n).padStart(4)} lojas ${(pa ?? 0).toFixed(3)}%` : '        —        ').padEnd(20),
    s ? `${String(s.n).padStart(4)} lojas ${(ps ?? 0).toFixed(3)}%` : '        —',
    alerta,
  )
}

// ── loja que sumiu / apareceu, por retailer id
const ridSet = new Map(set.map((l) => [String(l.rid), l]))
const ridAgo = new Map(ago.map((l) => [String(l.retailer_id ?? l.rid ?? ''), l]))
const sumiram = [...ridAgo.entries()].filter(([r]) => r && !ridSet.has(r))
const novas = [...ridSet.entries()].filter(([r]) => !ridAgo.has(r))

console.log('\n=== lojas que comissionaram em AGOSTO e não aparecem em SETEMBRO: %d ===', sumiram.length)
sumiram
  .sort((a, b) => (Number(b[1].comissao) || 0) - (Number(a[1].comissao) || 0))
  .slice(0, 25)
  .forEach(([r, l]) =>
    console.log('  RID %s  %s  comissão ago %s', r.padEnd(6), String(l.varejo ?? '').slice(0, 38).padEnd(38), brl(Number(l.comissao))),
  )
if (sumiram.length > 25) console.log('  … e mais %d', sumiram.length - 25)
console.log('  soma da comissão de agosto dessas lojas: %s',
  brl(sumiram.reduce((s, [, l]) => s + (Number(l.comissao) || 0), 0)))

console.log('\n=== lojas NOVAS em setembro: %d (comissão %s) ===', novas.length,
  brl(novas.reduce((s, [, l]) => s + (l.comissao || 0), 0)))

// ── loja AIVA que vendeu no portal em setembro e não está no relatório
const { data: desemp, error: eD } = await sb
  .from('aiva_desempenho')
  .select('cnpj,nome_varejo,vendas,valor_vendas,rid,consultas,status_portal')
  .eq('mes', '2026-09')
if (eD) console.log('\nerro lendo aiva_desempenho:', eD.message)
if (!desemp?.length) {
  console.log('\n=== portal AIVA: aiva_desempenho de 2026-09 está vazio — não dá pra cruzar ===')
} else {
  const vendeu = desemp.filter((d) => (Number(d.vendas) || 0) > 0)
  const faltando = vendeu.filter((d) => !ridSet.has(String(d.rid ?? '')))
  console.log('\n=== portal AIVA set/26: %d lojas no portal, %d com venda | SEM linha no relatório: %d ===',
    desemp.length, vendeu.length, faltando.length)
  faltando
    .sort((a, b) => (Number(b.valor_vendas) || 0) - (Number(a.valor_vendas) || 0))
    .slice(0, 30)
    .forEach((d) =>
      console.log('  RID %s  CNPJ %s  %s  %s vendas  %s',
        String(d.rid ?? '?').padEnd(6), String(d.cnpj ?? '').padEnd(16),
        String(d.nome_varejo ?? '').slice(0, 34).padEnd(34), String(d.vendas).padStart(4), brl(Number(d.valor_vendas))),
    )
  if (faltando.length > 30) console.log('  … e mais %d', faltando.length - 30)

  // as que sumiram de agosto pra setembro: venderam em setembro segundo o portal?
  const porRid = new Map(desemp.map((d) => [String(d.rid ?? ''), d]))
  const sumiuMasVendeu = sumiram
    .map(([r, l]) => [r, l, porRid.get(r)])
    .filter(([, , d]) => d && (Number(d.vendas) || 0) > 0)
  console.log('\n=== das %d que sumiram, quantas o portal diz que VENDERAM em setembro: %d ===',
    sumiram.length, sumiuMasVendeu.length)
  sumiuMasVendeu
    .sort((a, b) => (Number(b[2].valor_vendas) || 0) - (Number(a[2].valor_vendas) || 0))
    .forEach(([r, l, d]) =>
      console.log('  RID %s  %s  ago %s | portal set: %s vendas, %s',
        r.padEnd(6), String(l.varejo ?? '').slice(0, 34).padEnd(34),
        brl(Number(l.comissao)), String(d.vendas).padStart(3), brl(Number(d.valor_vendas))),
    )
  const semVenda = sumiram.filter(([r]) => { const d = porRid.get(r); return d && !(Number(d.vendas) > 0) }).length
  const foraPortal = sumiram.filter(([r]) => !porRid.has(r)).length
  console.log('  (sem venda no portal: %d · nem aparecem no portal AIVA: %d — esses são de outros varejos, fora da AIVA)',
    semVenda, foraPortal)
}

// ── dump pro gerador da planilha
{
  const porRid = new Map((desemp ?? []).map((d) => [String(d.rid ?? ''), d]))
  const rotuloPortal = (r) => {
    const d = porRid.get(r)
    if (!d) return 'não é loja AIVA'
    const v = Number(d.vendas) || 0
    return v > 0 ? `SIM — ${v} vendas, ${brl(Number(d.valor_vendas))}` : 'não vendeu em setembro'
  }
  const dump = {
    sumiram: sumiram
      .sort((a, b) => (Number(b[1].comissao) || 0) - (Number(a[1].comissao) || 0))
      .map(([r, l]) => ({ rid: r, varejo: l.varejo ?? '', grupo: l.grupo ?? '', comissao: Number(l.comissao) || 0, portal: rotuloPortal(r) })),
    novas: novas
      .sort((a, b) => (b[1].comissao || 0) - (a[1].comissao || 0))
      .map(([r, l]) => ({ rid: r, varejo: l.varejo, grupo: l.grupo, comissao: l.comissao || 0, portal: rotuloPortal(r) })),
  }
  writeFileSync('scripts/out-comparacao-ume-set-ago.json', JSON.stringify(dump, null, 1))
  console.log('\ndump: scripts/out-comparacao-ume-set-ago.json (%d sumiram, %d novas)', dump.sumiram.length, dump.novas.length)
}

setTimeout(() => process.exit(0), 800).unref()
