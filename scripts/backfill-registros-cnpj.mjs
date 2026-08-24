#!/usr/bin/env node
/**
 * backfill-registros-cnpj.mjs — popula sdr_registros_cnpj com os leads que
 * concluíram o cadastro mas nunca foram espelhados no painel /registros.
 *
 * Por que existe (2026-08-24): o espelhamento no webhook estava dentro de um
 * `if (linksForm)`, e linksForm só é montado quando o pacote de dados DAQUELE
 * TURNO traz o cnpj_matriz. Quando o turno de conclusão não trazia (o CNPJ já
 * estava em observacoes, mas não no pacote), o bloco inteiro era pulado — sem
 * retentativa. Resultado: 122 lojas com cadastro completo e CNPJ válido nunca
 * apareceram no painel. Caso que revelou: Solicite Cred (558597418481).
 *
 * A fonte aqui é o [DADOS_COLETADOS:] do lead — durável, ao contrário do pacote
 * do turno. Upsert por (lead_id, cnpj): rodar de novo não duplica nem mexe no
 * checkbox "enviado" que o Nei já marcou.
 *
 * Uso: node --env-file=.env.local scripts/backfill-registros-cnpj.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

/** Mesma extração do lib/pre-cadastro-form.ts */
function extrairCnpjs(texto) {
  if (!texto) return []
  const achados = String(texto).match(/\d[\d./-]{15,}|\d{14}/g) ?? []
  return [...new Set(achados.map((c) => c.replace(/\D/g, '')).filter((c) => c.length === 14))]
}
function parseDados(obs) {
  const m = String(obs ?? '').match(/\[DADOS_COLETADOS:([^\]]*)\]/)
  if (!m) return {}
  const r = {}
  for (const p of m[1].split('|')) {
    const i = p.indexOf('=')
    if (i > 0) { const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (v) r[k] = v }
  }
  return r
}

let leads = [], from = 0
while (true) {
  const { data } = await sb.from('sdr_leads')
    .select('id,nome,telefone,status,observacoes')
    .eq('produto', 'AIVA').like('observacoes', '%[CAD_ALERTADO]%')
    .range(from, from + 999)
  leads.push(...data); if (data.length < 1000) break; from += 1000
}
const { data: regs } = await sb.from('sdr_registros_cnpj').select('lead_id,cnpj')
const jaTem = new Set(regs.map((r) => `${r.lead_id}|${r.cnpj}`))

const linhas = []
let semCnpj = 0
for (const l of leads) {
  const d = parseDados(l.observacoes)
  const matriz = extrairCnpjs(d.cnpj_matriz)
  const adicionais = extrairCnpjs(d.cnpjs_adicionais).filter((c) => !matriz.includes(c))
  if (matriz.length === 0 && adicionais.length === 0) { semCnpj++; continue }
  for (const [cnpj, tipo] of [...matriz.map((c) => [c, 'matriz']), ...adicionais.map((c) => [c, 'adicional'])]) {
    if (jaTem.has(`${l.id}|${cnpj}`)) continue
    linhas.push({ lead_id: l.id, loja: l.nome, telefone: l.telefone, cnpj, tipo })
  }
}
console.log(`leads com cadastro concluído: ${leads.length} | sem CNPJ nos dados: ${semCnpj}`)
console.log(`linhas novas a inserir: ${linhas.length} (${new Set(linhas.map((l) => l.lead_id)).size} lojas)`)
console.log(`  matriz: ${linhas.filter((l) => l.tipo === 'matriz').length} | adicionais: ${linhas.filter((l) => l.tipo === 'adicional').length}`)

if (DRY) { console.log('\n[DRY] nada gravado. Amostra:'); linhas.slice(0, 8).forEach((l) => console.log('  ' + l.cnpj + ' ' + l.tipo.padEnd(10) + l.loja)); process.exit(0) }

let ok = 0
for (let i = 0; i < linhas.length; i += 200) {
  const lote = linhas.slice(i, i + 200)
  const { error } = await sb.from('sdr_registros_cnpj').upsert(lote, { onConflict: 'lead_id,cnpj', ignoreDuplicates: true })
  if (error) { console.error(`Lote ${i}: ${error.message}`); process.exit(1) }
  ok += lote.length
}
console.log(`\nBackfill concluído: ${ok} linhas inseridas.`)
