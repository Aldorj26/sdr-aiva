#!/usr/bin/env node
/**
 * As 11 divergências que o painel aponta em set/26 são omissão de verdade da
 * Ume, ou artefato de casamento (a linha existe no relatório mas foi consumida
 * por outra conta do funil 11)?
 *
 * Para cada divergência: procura a loja no relatório por retailer ID e por
 * CNPJ, e diz qual conta do funil 11 ficou com a linha.
 *
 * Uso: node --env-file=.env.local scripts/checar-divergencias-painel-2026-09.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const MES = '2026-09'
rmSync('.tsc-tmp', { recursive: true, force: true })
execSync('npx tsc lib/comissoes.ts --outDir .tsc-tmp --module commonjs --target es2020 --esModuleInterop --skipLibCheck', { stdio: 'pipe' })
const { conferir, parseDescricaoOpp } = require(process.cwd() + '/.tsc-tmp/comissoes.js')

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const todos = async (tabela, select, filtro) => {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(sb.from(tabela).select(select)).range(de, de + 999)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const [linhas, desemp] = await Promise.all([
  todos('ume_comissoes', '*', (q) => q.eq('mes', MES)),
  todos('aiva_desempenho', 'cnpj,rid,aprovados,vendas,valor_vendas', (q) => q.eq('mes', MES)),
])
const r = await fetch(`${BASE}/int/getPipeOpportunities`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ queueId: QID, apiKey: process.env.EVO_TALKS_API_KEY, pipelineId: 11 }),
})
const todasOpps = await r.json()
const contas = todasOpps.filter((o) => (o.tags ?? []).includes(7) || (o.tags ?? []).includes(69))
  .map((o) => ({ id: o.id, title: o.title, mainphone: o.mainphone ?? '', description: o.description ?? '' }))

const conf = conferir(contas, linhas, desemp)
const divs = conf.filter((c) => c.divergencia)
console.log('divergências apontadas pelo painel: %d', divs.length)

// índices do relatório
const porRid = new Map()
const porCnpj = new Map()
for (const l of linhas) {
  if (l.retailer_id != null) {
    if (!porRid.has(String(l.retailer_id))) porRid.set(String(l.retailer_id), [])
    porRid.get(String(l.retailer_id)).push(l)
  }
  if (l.cnpj) {
    if (!porCnpj.has(l.cnpj)) porCnpj.set(l.cnpj, [])
    porCnpj.get(l.cnpj).push(l)
  }
}
// quem ficou com cada linha
const donoDaLinha = new Map()
for (const c of conf) if (c.relatorio && c.opp) donoDaLinha.set(c.relatorio, c.opp)

const saida = []
console.log('')
for (const d of divs) {
  const nome = d.opp?.title ?? '?'
  const porR = d.umeRid != null ? (porRid.get(String(d.umeRid)) ?? []) : []
  const porC = d.cnpj ? (porCnpj.get(d.cnpj) ?? []) : []
  const achadas = [...new Set([...porR, ...porC])]
  const veredito = achadas.length
    ? 'ARTEFATO — a loja ESTÁ no relatório'
    : 'OMISSÃO REAL — não existe linha no relatório'
  console.log('%s  [%s]', nome.slice(0, 46).padEnd(46), veredito)
  console.log('   nosso cadastro: retailer %s · CNPJ %s', d.umeRid ?? '—', d.cnpj ?? '—')
  console.log('   portal set/26 : %d vendas, %s', d.desempenho?.vendas ?? 0, brl(d.desempenho?.valor_vendas))
  for (const l of achadas) {
    const dono = donoDaLinha.get(l)
    console.log('   linha no relatório: retailer %s · CNPJ %s · %s · %s · consumida por: %s',
      l.retailer_id ?? '—', l.cnpj ?? '—', String(l.varejo ?? '').slice(0, 30), brl(l.comissao),
      dono ? `"${dono.title.slice(0, 34)}"` : 'ninguém (ficou como "só no relatório")')
  }
  if (!achadas.length && d.cnpj) {
    // tentativa final: mesma raiz de CNPJ (matriz/filial)
    const raiz = d.cnpj.slice(0, 8)
    const irmas = linhas.filter((l) => l.cnpj && l.cnpj.startsWith(raiz))
    if (irmas.length) {
      console.log('   ⚠️ mas existe linha com a MESMA raiz de CNPJ (mesma empresa, outra inscrição):')
      for (const l of irmas) console.log('      retailer %s · CNPJ %s · %s · %s', l.retailer_id, l.cnpj, String(l.varejo).slice(0, 30), brl(l.comissao))
    }
  }
  console.log('')
  saida.push({ loja: nome, umeRid: d.umeRid, cnpj: d.cnpj, vendas: d.desempenho?.vendas ?? 0,
    valor: d.desempenho?.valor_vendas ?? 0, veredito,
    linhas: achadas.map((l) => ({ rid: l.retailer_id, cnpj: l.cnpj, varejo: l.varejo, comissao: l.comissao,
      dono: donoDaLinha.get(l)?.title ?? null })) })
}

const reais = saida.filter((s) => s.veredito.startsWith('OMISSÃO'))
console.log('================================================')
console.log('ARTEFATO de casamento: %d', saida.length - reais.length)
console.log('OMISSÃO REAL .......: %d', reais.length)
for (const s of reais) console.log('   • %s (retailer %s, %d vendas, %s)', s.loja, s.umeRid ?? '—', s.vendas, brl(s.valor))

writeFileSync('scripts/out-divergencias-painel-2026-09.json', JSON.stringify(saida, null, 1))
rmSync('.tsc-tmp', { recursive: true, force: true })
setTimeout(() => process.exit(0), 800).unref()
