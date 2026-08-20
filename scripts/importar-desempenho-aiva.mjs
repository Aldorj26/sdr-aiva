#!/usr/bin/env node
/**
 * importar-desempenho-aiva.mjs — importa os CSVs exportados do Data Studio
 * "Parceiros - AIVA" pra tabela aiva_desempenho (snapshot do mês corrente).
 *
 * Rotina semanal: os exports são gerados pelo Chrome do Aldo (Claude dirige,
 * visões: Por loja / Sem Venda / Sem Consulta / Sem Operador). A visão
 * "Base de Varejos" NÃO é importada (traz dados bancários — decisão de não
 * armazenar, 2026-08-20); a "Checagem CNPJs" tem export truncado (~100 linhas)
 * e a base completa já entra pelo importar-base-aiva.mjs.
 *
 * Uso: node scripts/importar-desempenho-aiva.mjs "C:/pasta/com/os/csvs" [YYYY-MM]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const dir = process.argv[2]
if (!dir) { console.error('Uso: node scripts/importar-desempenho-aiva.mjs <pasta> [YYYY-MM]'); process.exit(1) }
const MES = process.argv[3] ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)

// Parser CSV mínimo com aspas (campos com vírgula) e BOM.
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  const s = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQ = false
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = '' }
      if (c === '\r' && s[i + 1] === '\n') i++
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const header = rows.shift().map((h) => h.trim())
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

// Localiza o arquivo mais completo de cada visão (exports repetidos ganham " (1)")
function achar(padrao) {
  const cands = readdirSync(dir).filter((f) => f.includes(padrao) && f.endsWith('.csv'))
  if (!cands.length) return null
  let melhor = null, melhorLinhas = -1
  for (const f of cands) {
    const n = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).length
    if (n > melhorLinhas) { melhorLinhas = n; melhor = f }
  }
  return join(dir, melhor)
}

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : null }
const numDot = (v) => { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : null } // CSV usa ponto decimal
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '')

// ── 1. Por loja (base) ────────────────────────────────────────────────────────
const fPorLoja = achar('Por loja')
if (!fPorLoja) { console.error('CSV "Por loja" não encontrado na pasta.'); process.exit(1) }
const porLoja = parseCsv(readFileSync(fPorLoja, 'utf8'))
const porCnpj = new Map()
for (const r of porLoja) {
  const cnpj = soDigitos(r.cnpj)
  if (cnpj.length !== 14) continue
  porCnpj.set(cnpj, {
    mes: MES, cnpj,
    nome_varejo: r.Varejo || null, loja: r.Loja || null,
    uf: r.UF || null, cidade: r.Cidade || null,
    status_consulta: r['Status Consulta'] || null,
    aprovados: numDot(r['Total Clientes aprovados']),
    vendas: numDot(r.Vendas),
    conversao: numDot(r['% Conversão'] ?? r[' % Conversão']),
    valor_vendas: numDot(r['Venda (R$)']),
    ticket_medio: numDot(r['Ticket Médio']),
    sem_venda: false, sem_consulta: false, sem_operador: false,
    telefone: null, qtd_operadores: null,
    atualizado_em: new Date().toISOString(),
  })
}
console.log(`Por loja: ${porLoja.length} linhas → ${porCnpj.size} CNPJs válidos`)

// ── 2. Flags das visões específicas ──────────────────────────────────────────
const aplicarFlag = (padrao, flag, extras = () => ({})) => {
  const f = achar(padrao)
  if (!f) { console.log(`(visão "${padrao}" não encontrada — flag ${flag} fica false)`); return }
  const rows = parseCsv(readFileSync(f, 'utf8'))
  let aplicadas = 0, novos = 0
  for (const r of rows) {
    const cnpj = soDigitos(r.cnpj)
    if (cnpj.length !== 14) continue
    let alvo = porCnpj.get(cnpj)
    if (!alvo) {
      // loja que só aparece na visão específica (fora do Por loja) — entra mesmo assim
      alvo = { mes: MES, cnpj, nome_varejo: r.Varejo || null, loja: r.Loja || null, uf: r.UF || null, cidade: r.Cidade || null, status_consulta: r['Status Consulta'] || null, aprovados: numDot(r['Total Clientes aprovados']), vendas: numDot(r.Vendas), conversao: null, valor_vendas: null, ticket_medio: null, sem_venda: false, sem_consulta: false, sem_operador: false, telefone: null, qtd_operadores: null, atualizado_em: new Date().toISOString() }
      porCnpj.set(cnpj, alvo); novos++
    }
    alvo[flag] = true
    Object.assign(alvo, extras(r))
    aplicadas++
  }
  console.log(`${padrao}: ${rows.length} linhas → ${aplicadas} flags ${flag}${novos ? ` (+${novos} lojas novas)` : ''}`)
}

aplicarFlag('Sem Venda', 'sem_venda', (r) => ({ telefone: soDigitos(r.phoneNumber) || null }))
aplicarFlag('Sem Consulta', 'sem_consulta', (r) => ({ telefone: soDigitos(r.phoneNumber) || null }))
aplicarFlag('Sem Operador', 'sem_operador', (r) => ({ telefone: soDigitos(r.Telefone) || null, qtd_operadores: numDot(r.qtd_operadores) ?? 0 }))

// ── 3. Upsert ────────────────────────────────────────────────────────────────
const rows = [...porCnpj.values()]
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
}
let ok = 0
for (let i = 0; i < rows.length; i += 200) {
  const lote = rows.slice(i, i + 200)
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/aiva_desempenho?on_conflict=mes,cnpj`, {
    method: 'POST', headers: H, body: JSON.stringify(lote),
  })
  if (!res.ok) { console.error(`Lote ${i}: HTTP ${res.status}`, (await res.text()).slice(0, 200)); process.exit(1) }
  ok += lote.length
}
console.log(`\nUpsert concluído: ${ok} lojas no snapshot ${MES}`)
