#!/usr/bin/env node
/**
 * Carrega a lista de varredura (Google Maps) na fila de disparo sdr_fila_disparo,
 * cruzando contra TODO o histórico de contato:
 *   1. sdr_leads (qualquer status)
 *   2. oportunidades Evo dos funis 15 (AIVA), 19 (Odres/UME), 17 e 20
 *      (⚠️ sdr_leads NÃO é histórico completo — o sync apaga transferidos)
 * Comparação por chaveTel (DDD + 8 dígitos, ignora o 9º dígito).
 *
 * Uso: node --env-file=.env.local scripts/importar-fila-varredura.mjs --arquivo <json> --origem varredura-2026-09-01 [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const pega = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const arquivo = pega('--arquivo'), origem = pega('--origem')
if (!arquivo || !origem) { console.error('Uso: --arquivo <json> --origem <tag> [--dry]'); process.exit(1) }

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL, KEY = process.env.EVO_TALKS_API_KEY

const chaveTel = (s) => {
  let d = String(s ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11) d = d.slice(0, 2) + d.slice(3)
  return d
}

// 1) telefones já em sdr_leads
const jaContatado = new Map() // chave → origem do contato
let from = 0
while (true) {
  const { data } = await sb.from('sdr_leads').select('telefone,status').range(from, from + 999)
  for (const l of data) jaContatado.set(chaveTel(l.telefone), `sdr_leads:${l.status}`)
  if (data.length < 1000) break
  from += 1000
}
console.log(`sdr_leads: ${jaContatado.size} chaves`)

// 2) oportunidades Evo (funis 15, 19, 17, 20)
for (const pid of [15, 19, 17, 20]) {
  const res = await fetch(`${BASE}/int/getPipeOpportunities`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: 10, apiKey: KEY, pipelineId: pid }),
  })
  if (!res.ok) { console.error(`funil ${pid}: HTTP ${res.status} — ABORTANDO (dedupe incompleto não pode virar disparo)`); process.exit(1) }
  const opps = await res.json()
  let novos = 0
  for (const o of opps) {
    const k = chaveTel(o.mainphone)
    if (k && !jaContatado.has(k)) { jaContatado.set(k, `evo:funil${pid}`); novos++ }
  }
  console.log(`funil ${pid}: ${opps.length} opps (+${novos} chaves novas)`)
}
console.log(`total de chaves já contatadas: ${jaContatado.size}`)

// 3) lista da varredura
const lista = JSON.parse(readFileSync(arquivo, 'utf-8'))
const vistos = new Set()
const rows = []
let dupInterna = 0, malformado = 0, dupBase = 0
for (const l of lista) {
  const k = chaveTel(l.telefone)
  if (l.telefone.length < 12 || k.length < 10) {
    rows.push({ ...linha(l), status: 'DUPLICADO', detalhe: 'telefone malformado' }); malformado++; continue
  }
  if (vistos.has(k)) { dupInterna++; continue } // repetido dentro da própria lista
  vistos.add(k)
  const contato = jaContatado.get(k)
  if (contato) { rows.push({ ...linha(l), status: 'DUPLICADO', detalhe: contato }); dupBase++; continue }
  rows.push({ ...linha(l), status: 'PENDENTE', detalhe: null })
}
function linha(l) {
  return { nome: l.nome || 'Loja', telefone: l.telefone, cidade: l.cidade || null, origem, nota: l.nota || null, avaliacoes: l.avaliacoes ?? null }
}
const pendentes = rows.filter((r) => r.status === 'PENDENTE').length
console.log(`\nlista: ${lista.length} linhas | ${dupInterna} repetidas na própria lista | ${malformado} malformadas`)
console.log(`já contatados (banco/Evo): ${dupBase} | PENDENTES pra disparo: ${pendentes}`)

if (DRY) { console.log('DRY — nada gravado.'); process.exit(0) }

let ins = 0, err = 0
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await sb.from('sdr_fila_disparo').upsert(rows.slice(i, i + 500), { onConflict: 'telefone', ignoreDuplicates: true })
  if (error) { console.error('lote', i, error.message); err++ } else ins += rows.slice(i, i + 500).length
}
console.log(`gravados/ignorados-existentes: ${ins} | lotes com erro: ${err}`)
setTimeout(() => process.exit(err ? 1 : 0), 800).unref()
