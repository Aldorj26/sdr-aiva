#!/usr/bin/env node
/**
 * Disparo em lote da campanha AIVA a partir do lote PayJoy já filtrado
 * (payjoy_lote.json no scratchpad — 150 leads NOVOS, ainda não na base).
 *
 * - Lê {telefone, nome, cidade} do JSON.
 * - POST em chunks pequenos pro endpoint de produção (evita timeout serverless).
 * - O endpoint já: bloqueia por status, valida WhatsApp, força nome='Loja',
 *   cria opp no CRM e envia o HSM. Aqui só orquestramos os chunks.
 *
 * Uso: node scripts/disparar-lote-payjoy.mjs [--dry] [--file <path>]
 */
import { readFileSync } from 'node:fs'

const PROD = 'https://sdr-aiva.vercel.app/api/sdr/send-initial'
const CHUNK = 5
const DRY = process.argv.includes('--dry')
const fileArg = process.argv.indexOf('--file')
const FILE = fileArg > -1
  ? process.argv[fileArg + 1]
  : 'C:/Users/rocha/AppData/Local/Temp/claude/C--projetos-claude/ec1b3a60-d113-4210-ab43-8dfe3d76cc42/scratchpad/payjoy_lote.json'

const leads = JSON.parse(readFileSync(FILE, 'utf-8')).map((x) => ({
  nome: x.nome ?? 'Loja',
  telefone: x.telefone,
  cidade: x.cidade ?? undefined,
}))

const chunks = []
for (let i = 0; i < leads.length; i += CHUNK) chunks.push(leads.slice(i, i + CHUNK))

console.log(`Lote: ${leads.length} leads em ${chunks.length} chunks de ${CHUNK}`)
if (DRY) {
  console.log(`[DRY] Nada enviado. Primeiros 3:`, leads.slice(0, 3))
  process.exit(0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const totais = { sucesso: 0, invalidos: 0, bloqueados: 0, falha: 0 }
const detalhes = { invalidos: [], bloqueados: [], falha: [] }

for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i]
  try {
    const res = await fetch(PROD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: chunk }),
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
    console.log(`Chunk ${i + 1}/${chunks.length}: HTTP ${res.status} → ok ${json.sucesso ?? 0}, inval ${json.invalidos ?? 0}, bloq ${json.bloqueados ?? 0}, falha ${json.falha ?? 0}`)
  } catch (e) {
    console.log(`Chunk ${i + 1}/${chunks.length}: ERRO ${e.message}`)
    detalhes.falha.push(`chunk ${i + 1}: ${e.message}`)
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
