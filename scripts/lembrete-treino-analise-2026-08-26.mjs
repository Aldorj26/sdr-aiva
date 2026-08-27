#!/usr/bin/env node
/**
 * Convite condicional pro treinamento de qui 27/08/2026 9h30 — etapa EM ANALISE.
 * Disparo 26/08, pedido do Aldo: só participa quem ASSINAR O CONTRATO HOJE;
 * quem assinar deve avisar (o webhook aciona o Nei quando o lead responde).
 *
 * Mesmo fluxo comprovado dos lembretes (20/08 e 26/08 Treinar):
 *   1. HSM 48 coringa via /int/sendWaTemplate (chega com janela fechada)
 *   2. Texto livre via /int/sendMessageToChat no chat devolvido (melhor esforço)
 * Público: etapa 50 do Evo, lista congelada em scratchpad/analise-lista-2026-08-26.json (51).
 * Idempotente por [LEMBRETE_TREINO_ANALISE_2026-08-26].
 * Uso: node --env-file=.env.local scripts/lembrete-treino-analise-2026-08-26.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const TEMPLATE = 48
const MARCADOR = '[LEMBRETE_TREINO_ANALISE_2026-08-26]'

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
  'boa notícia: amanhã, quinta-feira às 9h30, tem treinamento AIVA ao vivo — e sua loja pode participar! ' +
  'Só tem uma condição: você precisa assinar o contrato ainda hoje (aquele link de assinatura com as 7 etapas + biometria). ' +
  'Assinou? Me responde aqui avisando que a gente confirma sua vaga na turma de amanhã e avisa o Nei. ' +
  'Se travar em alguma etapa da assinatura, me chama que eu te ajudo!'
)
const MSG_AGENDA =
  `📲 *Se assinar hoje, salva na agenda:*\n👉 ${CAL}\n\n` +
  '🔗 Treinamento: meet.google.com/hqn-vcrr-dxo\n' +
  '✍️ Primeiro o contrato, depois o treino — me avisa assim que assinar!'

const lista = JSON.parse(readFileSync(
  'C:/Users/rocha/AppData/Local/Temp/claude/C--projetos-claude-sdr-aiva/6fed26f2-b6d8-4bd9-a126-63f22d3b40bb/scratchpad/analise-lista-2026-08-26.json', 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ok = 0, pulados = 0, falhas = 0, comAgenda = 0
const t0 = Date.now()
for (const l of lista) {
  if (Date.now() - t0 > 240_000) { console.log('teto de tempo — parando (rodar de novo pra continuar, é idempotente)'); break }
  try {
    let obsAtual = ''
    if (l.lead_id) {
      const { data } = await sb.from('sdr_leads').select('observacoes').eq('id', l.lead_id).maybeSingle()
      obsAtual = data?.observacoes ?? ''
      if (obsAtual.includes(MARCADOR)) { pulados++; continue }
    }
    const bruto = sanitize(l.nome || l.loja)
    const nome = bruto === bruto.toUpperCase() && bruto.length > 2
      ? bruto.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
      : bruto
    if (DRY) { console.log(`  DRY ${l.loja} → "Olá ${nome}, ${corpoHsm.slice(0, 55)}…"`); ok++; continue }

    const tpl = await post('/int/sendWaTemplate', { number: l.tel, templateId: TEMPLATE, data: [nome, corpoHsm], openNewChat: true })
    let agendaOk = false
    try {
      const chatId = tpl.chatId ?? tpl.fkChat ?? null
      if (chatId) { await post('/int/sendMessageToChat', { chatId: Number(chatId), text: MSG_AGENDA }); agendaOk = true }
    } catch { /* janela fechada — o HSM já leva o essencial */ }

    if (l.lead_id) {
      const inserts = [{ lead_id: l.lead_id, direcao: 'out', conteudo: `Olá ${nome}, ${corpoHsm}`, template_hsm: 'aiva_coringa_48' }]
      if (agendaOk) { inserts.push({ lead_id: l.lead_id, direcao: 'out', conteudo: MSG_AGENDA }); comAgenda++ }
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
console.log(`\n${DRY ? 'DRY — enviaria' : 'Enviados'}: ${ok} | com agenda: ${comAgenda} | pulados: ${pulados} | falhas: ${falhas}`)
