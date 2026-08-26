#!/usr/bin/env node
/**
 * Lembrete do treinamento AIVA ao vivo de qui 27/08/2026 9h30 — disparo 26/08.
 * Mesmo formato do lembrete de 20/08 (33 enviados, funcionou):
 *   1. HSM 48 (coringa "Olá {{1}}, {{2}}") — chega com janela fechada; link em
 *      parâmetro não fica clicável, então o link de agenda vai na msg 2.
 *   2. Texto livre com Google Calendar + Meet (entrega depende de chat aberto).
 * Público: etapa TREINAR (stage 70 do Evo), lista congelada em
 * scratchpad/treinar-lista-2026-08-26.json (39 lojas, levantada 26/08 ~17h).
 * Idempotente por [LEMBRETE_TREINO_2026-08-26] em observacoes.
 * Uso: node --env-file=.env.local scripts/lembrete-treinamento-2026-08-26.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const TEMPLATE = 48
const MARCADOR = '[LEMBRETE_TREINO_2026-08-26]'

const horaBrt = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()))
if (horaBrt < 8 || horaBrt >= 20) { console.error(`ABORTADO: ${horaBrt}h BRT fora do horário comercial.`); process.exit(1) }

const sanitize = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`)
  return res.json()
}

// Qui 27/08/2026 09:30–10:30 BRT = 12:30–13:30 UTC
const CAL =
  'https://calendar.google.com/calendar/render?action=TEMPLATE' +
  `&text=${encodeURIComponent('Treinamento AIVA')}` +
  '&dates=20260827T123000Z/20260827T133000Z' +
  `&details=${encodeURIComponent('Link da reunião: https://meet.google.com/hqn-vcrr-dxo')}` +
  `&location=${encodeURIComponent('https://meet.google.com/hqn-vcrr-dxo')}`

const corpoHsm = sanitize(
  'passando pra lembrar: amanhã, quinta-feira às 9h30, tem treinamento AIVA ao vivo. ' +
  'É a melhor forma de destravar a operação — entra direto por meet.google.com/hqn-vcrr-dxo ' +
  'e chama sua equipe pra assistir junto. Na sequência te mando o link pra salvar na sua agenda. Até amanhã!'
)
const MSG_AGENDA =
  `📲 *Adicionar na sua agenda:*\n👉 ${CAL}\n\n` +
  '🔗 Link da reunião: meet.google.com/hqn-vcrr-dxo\n' +
  'Amanhã, 9h30 — te espero lá! 🎓'

const lista = JSON.parse(readFileSync(
  'C:/Users/rocha/AppData/Local/Temp/claude/C--projetos-claude-sdr-aiva/6fed26f2-b6d8-4bd9-a126-63f22d3b40bb/scratchpad/treinar-lista-2026-08-26.json', 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ok = 0, pulados = 0, falhas = 0
const t0 = Date.now()
for (const l of lista) {
  if (Date.now() - t0 > 240_000) { console.log('teto de tempo — parando'); break }
  try {
    // revalida o marcador na hora (idempotência mesmo se rodar 2x)
    let obsAtual = ''
    if (l.lead_id) {
      const { data } = await sb.from('sdr_leads').select('observacoes').eq('id', l.lead_id).maybeSingle()
      obsAtual = data?.observacoes ?? ''
      if (obsAtual.includes(MARCADOR)) { pulados++; continue }
    }
    // capitaliza nomes em CAIXA ALTA ("RENAN" -> "Renan"), padrão do disparo 20/08
    const bruto = sanitize(l.nome || l.loja)
    const nome = bruto === bruto.toUpperCase() && bruto.length > 2
      ? bruto.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
      : bruto
    if (DRY) { console.log(`  DRY ${l.loja} → "Olá ${nome}, ${corpoHsm.slice(0, 60)}…"`); ok++; continue }

    // mesmo fluxo comprovado do lembrete de 20/08: sendWaTemplate (data:[...]) e
    // texto livre no chat que o template devolve — melhor esforço
    const tpl = await post('/int/sendWaTemplate', { number: l.tel, templateId: TEMPLATE, data: [nome, corpoHsm], openNewChat: true })
    let agendaOk = false
    try {
      const chatId = tpl.chatId ?? tpl.fkChat ?? null
      if (chatId) { await post('/int/sendMessageToChat', { chatId: Number(chatId), text: MSG_AGENDA }); agendaOk = true }
    } catch { /* janela fechada — o HSM já leva o essencial */ }

    if (l.lead_id) {
      const inserts = [{ lead_id: l.lead_id, direcao: 'out', conteudo: `Olá ${nome}, ${corpoHsm}`, template_hsm: 'aiva_coringa_48' }]
      if (agendaOk) inserts.push({ lead_id: l.lead_id, direcao: 'out', conteudo: MSG_AGENDA })
      await sb.from('sdr_mensagens').insert(inserts)
      await sb.from('sdr_leads').update({
        data_ultimo_contato: new Date().toISOString(),
        observacoes: `${obsAtual.trim()} ${MARCADOR}`.trim(),
      }).eq('id', l.lead_id)
    }
    console.log(`  ✓ ${l.loja} (${l.tel})${agendaOk ? ' (+agenda)' : ''}`)
    ok++
    await sleep(1500)
  } catch (err) {
    console.error(`  ✗ ${l.loja}:`, err.message)
    falhas++
  }
}
console.log(`\n${DRY ? 'DRY — enviaria' : 'Enviados'}: ${ok} | pulados: ${pulados} | falhas: ${falhas}`)
