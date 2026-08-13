#!/usr/bin/env node
/**
 * Campanha "está vendendo?" (14/07/2026) — leads TREINAR e LOGIN.
 * HSM 48 (reabrir conversa): "Oi {{1}}, tudo bem?\n{{2}} É só responder essa mensagem. 😊"
 * Quem responder cai na VictorIA, que já conhece o fluxo (prompt: seção CHECK "ESTÁ VENDENDO?").
 *
 * Uso: node scripts/check-vendendo-treinar-login.mjs [--dry]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf-8')
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim()

const supabase = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'))
const BASE = get('EVO_TALKS_BASE_URL')
const AUTH = { queueId: Number(get('EVO_TALKS_QUEUE_ID')), apiKey: get('EVO_TALKS_QUEUE_API_KEY') }
const TEMPLATE_ID = Number(get('AIVA_REATIVACAO_TEMPLATE_ID')) // 48

const MIOLO = 'Passando rapidinho pra saber: sua loja já está vendendo com a AIVA?'
const MARKER = '[CHECK_VENDENDO:2026-07-14]'
const DRY = process.argv.includes('--dry')

const { data: alvos, error } = await supabase
  .from('sdr_leads')
  .select('id, nome, telefone, observacoes')
  .eq('produto', 'AIVA')
  .in('status', ['TREINAR', 'LOGIN'])
  .not('nome', 'ilike', '%teste%')
if (error) throw error

const pendentes = alvos.filter((l) => !(l.observacoes ?? '').includes('[CHECK_VENDENDO:'))
console.log(`Alvos: ${alvos.length} | pendentes (sem marker): ${pendentes.length} ${DRY ? '[DRY]' : ''}`)
if (DRY) {
  console.log(pendentes.slice(0, 5).map((l) => `${l.nome} (${l.telefone})`).join('\n'))
  process.exit(0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = 0
const falhas = []

for (const lead of pendentes) {
  try {
    const res = await fetch(`${BASE}/int/sendWaTemplate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...AUTH, number: lead.telefone, templateId: TEMPLATE_ID, data: [lead.nome, MIOLO], openNewChat: true }),
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`)

    const textoCompleto = `Oi ${lead.nome}, tudo bem?\n${MIOLO} É só responder essa mensagem. 😊`
    await supabase.from('sdr_mensagens').insert({
      lead_id: lead.id, direcao: 'out', conteudo: textoCompleto, template_hsm: 'aiva_reativacao_48h',
    })
    await supabase.from('sdr_leads').update({
      observacoes: `${MARKER} ${(lead.observacoes ?? '').trim()}`.trim(),
      data_ultimo_contato: new Date().toISOString(),
    }).eq('id', lead.id)

    ok++
    console.log(`✅ ${lead.nome} (${lead.telefone})`)
  } catch (e) {
    falhas.push(`${lead.telefone} (${lead.nome}): ${e.message}`)
    console.log(`❌ ${lead.nome} (${lead.telefone}) — ${e.message}`)
  }
  await sleep(1200)
}

console.log(`\n===== RESUMO =====\nEnviados: ${ok} | Falhas: ${falhas.length}`)
if (falhas.length) console.log(falhas.join('\n'))
