#!/usr/bin/env node
/**
 * Lembrete do treinamento AIVA ao vivo de qui 20/08/2026 9h30 — disparo 19/08.
 *
 * Público: leads na etapa TREINAR (stage 70 do Evo, lista congelada em
 * scratchpad/treinar-lista.json no momento do levantamento — 33 lojas).
 *
 * 1. HSM 48 (coringa "Olá {{1}}, {{2}}") — chega mesmo com janela fechada.
 *    Link de agenda NÃO vai no HSM (link em parâmetro não fica clicável).
 * 2. Texto livre na sequência com o link do Google Calendar + Meet — entrega
 *    depende de janela/chat aberto; quem não receber já tem o essencial no HSM.
 *
 * Idempotente por [LEMBRETE_TREINO_2026-08-20] em observacoes.
 * Texto real salvo em sdr_mensagens (a VictorIA precisa do contexto se o
 * lojista responder).
 *
 * Uso: node --env-file=.env.local scripts/lembrete-treinamento-2026-08-20.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const TEMPLATE = 48
const MARCADOR = '[LEMBRETE_TREINO_2026-08-20]'

const horaBrt = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()))
if (horaBrt < 8 || horaBrt >= 20) { console.error(`ABORTADO: ${horaBrt}h BRT fora do horário comercial.`); process.exit(1) }

const sanitize = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`)
  return res.json()
}

// Qui 20/08/2026 09:30–10:30 BRT = 12:30–13:30 UTC (mesmo formato do lib/text.ts)
const CAL =
  'https://calendar.google.com/calendar/render?action=TEMPLATE' +
  `&text=${encodeURIComponent('Treinamento AIVA')}` +
  '&dates=20260820T123000Z/20260820T133000Z' +
  `&details=${encodeURIComponent('Link da reunião: https://meet.google.com/hqn-vcrr-dxo')}` +
  `&location=${encodeURIComponent('https://meet.google.com/hqn-vcrr-dxo')}`

const corpoHsm = (nome) => sanitize(
  'passando pra lembrar: amanhã, quinta-feira às 9h30, tem treinamento AIVA ao vivo. ' +
  'É a melhor forma de destravar a operação — entra direto por meet.google.com/hqn-vcrr-dxo ' +
  'e chama sua equipe pra assistir junto. Na sequência te mando o link pra salvar na sua agenda. Até amanhã!'
)
const MSG_AGENDA =
  `📲 *Adicionar na sua agenda:*\n👉 ${CAL}\n\n` +
  '🔗 Link da reunião: meet.google.com/hqn-vcrr-dxo\n' +
  'Amanhã, 9h30 — te espero lá! 🎓'

const lista = JSON.parse(readFileSync(
  'C:/Users/rocha/AppData/Local/Temp/claude/C--projetos-claude-sdr-aiva/6fed26f2-b6d8-4bd9-a126-63f22d3b40bb/scratchpad/treinar-lista.json', 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = 0, comAgenda = 0, pulados = 0, falhas = 0
console.log(`${DRY ? '[DRY-RUN] ' : ''}Lembrete treinamento — ${lista.length} lojas\n`)

for (const l of lista) {
  const { data: lead } = await sb.from('sdr_leads')
    .select('id, nome, status, observacoes, evotalks_chat_id')
    .eq('telefone', l.tel).maybeSingle()
  if (!lead) { console.log(`  SKIP  ${l.tel} — lead não encontrado`); pulados++; continue }
  if (lead.status !== 'TREINAR') { console.log(`  SKIP  ${l.tel} ${l.loja} — status mudou (${lead.status})`); pulados++; continue }
  if ((lead.observacoes ?? '').includes(MARCADOR)) { console.log(`  SKIP  ${l.tel} ${l.loja} — já recebeu`); pulados++; continue }

  // Capitaliza nomes que vieram em CAIXA ALTA do cadastro ("RENAN" → "Renan")
  const bruto = sanitize(l.socio || l.loja)
  const nome = bruto === bruto.toUpperCase() && bruto.length > 2
    ? bruto.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
    : bruto
  if (DRY) { console.log(`  DRY   ${l.tel} "Olá ${nome}, ${corpoHsm(nome).slice(0, 70)}..."`); ok++; continue }

  try {
    const tpl = await post('/int/sendWaTemplate', { number: l.tel, templateId: TEMPLATE, data: [nome, corpoHsm(nome)], openNewChat: true })
    await sb.from('sdr_mensagens').insert({
      lead_id: lead.id, direcao: 'out', template_hsm: 'aiva_coringa_48',
      conteudo: `Olá ${nome}, ${corpoHsm(nome)}`,
    })
    // Texto livre com a agenda — melhor esforço (janela pode estar fechada)
    let agendaOk = false
    try {
      const chatId = tpl.chatId ?? tpl.fkChat ?? (lead.evotalks_chat_id ? Number(lead.evotalks_chat_id) : null)
      if (chatId) { await post('/int/sendMessageToChat', { chatId: Number(chatId), text: MSG_AGENDA }); agendaOk = true }
    } catch { /* sem chat aberto — fica só o HSM */ }
    if (agendaOk) {
      await sb.from('sdr_mensagens').insert({ lead_id: lead.id, direcao: 'out', conteudo: MSG_AGENDA })
      comAgenda++
    }
    await sb.from('sdr_leads').update({
      data_ultimo_contato: new Date().toISOString(),
      observacoes: `${lead.observacoes ?? ''} ${MARCADOR}`.trim(),
    }).eq('id', lead.id)
    console.log(`  OK    ${l.tel} ${l.loja}${agendaOk ? ' (+agenda)' : ''}`)
    ok++
  } catch (err) {
    console.log(`  FALHA ${l.tel} ${l.loja} — ${err.message}`)
    falhas++
  }
  await sleep(1500)
}
console.log(`\nenviados: ${ok} | com link de agenda: ${comAgenda} | pulados: ${pulados} | falhas: ${falhas}`)
