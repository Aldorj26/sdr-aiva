#!/usr/bin/env node
// Dump da conferência (mesma lógica de conferencia-comissao.mjs) em JSON, pra exportar xlsx.
// Uso: node --env-file=.env.local scripts/exportar-conferencia-json.mjs --mes 2026-08 --out arquivo.json
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const mes = arg('--mes'); const out = arg('--out')
rmSync('.tsc-tmp', { recursive: true, force: true })
execSync('npx tsc lib/comissoes.ts --outDir .tsc-tmp --module commonjs --target es2020 --esModuleInterop --skipLibCheck', { stdio: 'inherit' })
const { conferir } = require(process.cwd() + '/.tsc-tmp/comissoes.js')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL, QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const [{ data: linhas }, { data: desemp }, { data: metas }] = await Promise.all([
  sb.from('ume_comissoes').select('*').eq('mes', mes),
  sb.from('aiva_desempenho').select('cnpj,loja,rid,aprovados,vendas,valor_vendas,cadastro_em,status_portal').eq('mes', mes),
  sb.from('ume_comissoes_meta').select('*').eq('mes', mes),
])
const resPipe = await fetch(`${BASE}/int/getPipeOpportunities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: process.env.EVO_TALKS_API_KEY, pipelineId: 11 }) })
const todas = await resPipe.json()
const contas = todas.filter((o) => (o.tags ?? []).includes(7) || (o.tags ?? []).includes(69))
const conf = conferir(contas.map((o) => ({ id: o.id, title: o.title, mainphone: o.mainphone ?? '', description: o.description ?? '' })), linhas ?? [], desemp ?? [])
const tagsDe = new Map(contas.map((o) => [o.id, o.tags ?? []]))
writeFileSync(out, JSON.stringify({ mes, metas, totalFunil11: todas.length, contasUmeAiva: contas.length, desempenho: desemp, conf: conf.map((c) => ({ ...c, tags: c.opp ? tagsDe.get(c.opp.id) : null })) }, null, 0))
console.log(`ok: ${conf.length} linhas de conferência → ${out}`)
rmSync('.tsc-tmp', { recursive: true, force: true })
setTimeout(() => process.exit(0), 800).unref()
