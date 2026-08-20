#!/usr/bin/env node
/**
 * Disparo D+0 — lote DDD 41 (Curitiba) de 19/08/2026.
 *
 * Origem: lista de 34 telefones passada pelo Aldo, cruzada contra sdr_leads e
 * as opps do Evo (funis 15/19/17/20) — planilha
 * scripts/checagem-lista-ddd41-2026-08-19.xlsx. Entram só os 26 CELULARES
 * nunca contatados; os 7 fixos e o 1 já-descartado ficam de fora.
 *
 * Mesmo fluxo do disparar-lote-aiva.mjs: POST /api/sdr/send-initial em lotes
 * de 5 (blacklist + checagem WhatsApp fail-open acontecem na rota).
 *
 * Uso: node scripts/disparar-lote-ddd41-2026-08-19.mjs [--dry]
 */
const PROD = 'https://sdr-aiva.vercel.app/api/sdr/send-initial'
const CHUNK = 5
const DRY = process.argv.includes('--dry')

const RAW = [
  '4192002-5785', '4192004-0442', '4198502-2602', '4199893-1004',
  '4199565-2823', '4199267-8941', '4199826-1212', '4199847-9817',
  '4199857-1640', '4199515-7343', '4199215-7177', '4199938-3226',
  '4199798-9055', '4199758-9418', '4199999-1683', '4198760-3205',
  '4198533-4000', '4199285-1493', '4199156-1331', '4199787-5464',
  '4199245-5616', '4199876-8067', '4199880-8388', '4199609-1048',
  '4198521-2042', '4199547-6261',
]

const vistos = new Set()
const validos = []
for (const r of RAW) {
  const n = r.replace(/\D/g, '')
  if (n.length !== 11) { console.log(`descartado (${n.length} díg): ${r}`); continue }
  if (/^(\d)\1+$/.test(n)) { console.log(`descartado (lixo): ${r}`); continue }
  if (vistos.has(n)) { console.log(`descartado (dup): ${r}`); continue }
  vistos.add(n)
  validos.push(n)
}
console.log(`Lista: ${RAW.length} → ${validos.length} celulares válidos únicos`)

const leads = validos.map((n) => ({ nome: `Lead ${n}`, telefone: `55${n}`, cidade: 'Curitiba/PR' }))
const chunks = []
for (let i = 0; i < leads.length; i += CHUNK) chunks.push(leads.slice(i, i + CHUNK))

if (DRY) { console.log(`\n[DRY] ${leads.length} leads em ${chunks.length} lotes de ${CHUNK}. Nada enviado.`); process.exit(0) }

const totais = { sucesso: 0, invalidos: 0, bloqueados: 0, falha: 0 }
const detalhes = { invalidos: [], bloqueados: [], falha: [] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (let i = 0; i < chunks.length; i++) {
  try {
    const res = await fetch(PROD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: chunks[i] }),
    })
    const json = await res.json()
    totais.sucesso += json.sucesso ?? 0
    totais.invalidos += json.invalidos ?? 0
    totais.bloqueados += json.bloqueados ?? 0
    totais.falha += json.falha ?? 0
    for (const r of json.resultados ?? []) {
      if (r.ok) continue
      if (r.erro === 'numero_sem_whatsapp') detalhes.invalidos.push(r.telefone)
      else if (String(r.erro).startsWith('bloqueado')) detalhes.bloqueados.push(`${r.telefone} (${r.erro})`)
      else detalhes.falha.push(`${r.telefone}: ${r.erro}`)
    }
    console.log(`Lote ${i + 1}/${chunks.length}: HTTP ${res.status} → ok ${json.sucesso ?? 0}, inval ${json.invalidos ?? 0}, bloq ${json.bloqueados ?? 0}, falha ${json.falha ?? 0}`)
  } catch (e) {
    console.log(`Lote ${i + 1}/${chunks.length}: ERRO ${e.message}`)
    detalhes.falha.push(`lote ${i + 1}: ${e.message}`)
  }
  await sleep(1500)
}

console.log(`\n===== RESUMO =====`)
console.log(`Disparados com sucesso: ${totais.sucesso}`)
console.log(`Sem WhatsApp (inválidos): ${totais.invalidos}`)
console.log(`Bloqueados (já no funil): ${totais.bloqueados}`)
console.log(`Falhas: ${totais.falha}`)
if (detalhes.invalidos.length) console.log(`\nSem WhatsApp: ${detalhes.invalidos.join(', ')}`)
if (detalhes.bloqueados.length) console.log(`\nBloqueados: ${detalhes.bloqueados.join(', ')}`)
if (detalhes.falha.length) console.log(`\nFalhas: ${detalhes.falha.join(', ')}`)
