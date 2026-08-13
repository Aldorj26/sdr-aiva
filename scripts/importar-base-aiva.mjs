/**
 * importar-base-aiva.mjs — importa o CSV do Data Studio pra aiva_base_cnpjs.
 *
 * CSV esperado: colunas name,cnpj (export do relatório "Aldo&Nei - Checagem
 * de Cadastro"). Upsert por CNPJ — rodar de novo com um export mais recente
 * só adiciona/atualiza, nunca perde nada.
 *
 * Uso: node scripts/importar-base-aiva.mjs "C:/caminho/arquivo.csv"
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const csvPath = process.argv[2]
if (!csvPath) { console.error('Uso: node scripts/importar-base-aiva.mjs <arquivo.csv>'); process.exit(1) }

const linhas = readFileSync(csvPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
const header = linhas.shift().toLowerCase()
const idxCnpj = header.split(',').findIndex((c) => c.trim() === 'cnpj')
const idxNome = header.split(',').findIndex((c) => c.trim() === 'name')
if (idxCnpj === -1) { console.error('CSV sem coluna "cnpj". Header:', header); process.exit(1) }

const agora = new Date().toISOString()
const vistos = new Set()
const rows = []
for (const l of linhas) {
  const cols = l.split(',')
  const cnpj = (cols[idxCnpj] ?? '').replace(/\D/g, '')
  if (cnpj.length !== 14 || vistos.has(cnpj)) continue
  vistos.add(cnpj)
  rows.push({ cnpj, nome: (cols[idxNome] ?? '').trim() || null, atualizado_em: agora })
}
console.log(`CSV: ${linhas.length} linhas → ${rows.length} CNPJs válidos únicos`)

const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates',
}

let inseridos = 0
for (let i = 0; i < rows.length; i += 500) {
  const lote = rows.slice(i, i + 500)
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/aiva_base_cnpjs?on_conflict=cnpj`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(lote),
  })
  if (!res.ok) { console.error(`Lote ${i}: HTTP ${res.status}`, await res.text()); process.exit(1) }
  inseridos += lote.length
  process.stdout.write(`\rImportados: ${inseridos}/${rows.length}`)
}
console.log('\nConcluído ✓')
