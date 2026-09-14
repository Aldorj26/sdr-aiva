#!/usr/bin/env node
/**
 * Pergunta aos leads da etapa TREINAR (stage 70) se já fizeram o treinamento.
 * Pedido do Aldo 14/09/2026.
 *
 * Entrega: template coringa HSM 48 (AIVA_REATIVACAO_TEMPLATE_ID), corpo
 *   "Oi {{1}}, tudo bem?\n{{2}} É só responder essa mensagem. 😊"
 * O {{2}} vai em UMA linha (a Meta rejeita \n em variável de template).
 * Como é HSM, entrega mesmo com a janela de 24h fechada — que é o caso da
 * maioria em Treinar. Quem responder cai na VictorIA, que já está no bloco
 * de instrução da fase TREINAR.
 *
 * Idempotente: marca [CHECK_TREINAMENTO:ISO] em observacoes — rodar de novo
 * não duplica (a menos que --force).
 *
 * Uso:
 *   node --env-file=.env.local scripts/check-treinamento-2026-09-14.mjs --dry
 *   node --env-file=.env.local scripts/check-treinamento-2026-09-14.mjs
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const AUTH = { queueId: Number(process.env.EVO_TALKS_QUEUE_ID), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY }
const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID) // 48 — coringa
const DRY = process.argv.includes('--dry')
const FORCE = process.argv.includes('--force')
const MARKER_RE = /\[CHECK_TREINAMENTO:/

// {{2}} do template — UMA linha, sem \n. O corpo já abre com "Oi {nome}, tudo bem?"
// e fecha com "É só responder essa mensagem. 😊", então não repete saudação.
const MIOLO =
  'Passando pra saber se você já conseguiu participar do treinamento da AIVA. Se ainda não deu tempo, eu te encaixo na próxima turma — são segundas e quintas, às 9h30, online.'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Primeiro nome do sócio (das observações) ou o nome da loja. */
function nomeSaudacao(lead) {
  const socio = (lead.observacoes ?? '').match(/nome_socio=([^|\[\n]+)/)?.[1]?.trim()
  if (socio) {
    const primeiro = socio.split(/\s+/)[0]
    if (primeiro.length >= 2) return primeiro[0].toUpperCase() + primeiro.slice(1).toLowerCase()
  }
  return lead.nome
}

const { data: alvos, error } = await supabase
  .from('sdr_leads')
  .select('id, nome, telefone, observacoes')
  .eq('produto', 'AIVA')
  .eq('status', 'TREINAR')
  .not('nome', 'ilike', '%teste%')
if (error) throw error

const pendentes = FORCE ? alvos : alvos.filter((l) => !MARKER_RE.test(l.observacoes ?? ''))
console.log(`Em TREINAR: ${alvos.length} | a enviar: ${pendentes.length}${DRY ? ' [DRY]' : ''}`)

if (DRY) {
  console.log('\n─── mensagem que cada um recebe ───')
  for (const l of pendentes.slice(0, 3)) {
    console.log(`\n[${l.telefone}]`)
    console.log(`Oi ${nomeSaudacao(l)}, tudo bem?`)
    console.log(`${MIOLO} É só responder essa mensagem. 😊`)
  }
  console.log(`\n─── destinatários (${pendentes.length}) ───`)
  console.log(pendentes.map((l) => `${nomeSaudacao(l)} — ${l.nome} (${l.telefone})`).join('\n'))
  process.exit(0)
}

let ok = 0
const falhas = []
for (const lead of pendentes) {
  const nome = nomeSaudacao(lead)
  try {
    const res = await fetch(`${BASE}/int/sendWaTemplate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...AUTH, number: lead.telefone, templateId: TEMPLATE_ID, data: [nome, MIOLO], openNewChat: true }),
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`)

    await supabase.from('sdr_mensagens').insert({
      lead_id: lead.id,
      direcao: 'out',
      conteudo: `Oi ${nome}, tudo bem?\n${MIOLO} É só responder essa mensagem. 😊`,
      template_hsm: 'aiva_reativacao_48h',
    })
    await supabase
      .from('sdr_leads')
      .update({
        observacoes: `${(lead.observacoes ?? '').trim()} [CHECK_TREINAMENTO:${new Date().toISOString()}]`.trim(),
        data_ultimo_contato: new Date().toISOString(),
      })
      .eq('id', lead.id)

    ok++
    console.log(`✅ ${nome} — ${lead.nome} (${lead.telefone})`)
  } catch (e) {
    falhas.push(`${lead.telefone} (${lead.nome}): ${e.message}`)
    console.log(`❌ ${lead.nome} (${lead.telefone}) — ${e.message}`)
  }
  await sleep(1200)
}

console.log(`\n===== RESUMO =====\nEnviados: ${ok} | Falhas: ${falhas.length}`)
if (falhas.length) console.log(falhas.join('\n'))
