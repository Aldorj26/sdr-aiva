#!/usr/bin/env node
/**
 * AVISO FERIADO 07/09 (Aldo 04/09) — segunda 07/09/2026 é feriado da Independência:
 * o treinamento da semana vai pra TERÇA 08/09, mesmo horário (9h30–10h30) e MESMO
 * link das segundas (meet.google.com/gdh-ppvw-nmp). Troca única — depois volta ao
 * normal (segundas e quintas). Aproveita e fixa o número oficial de avisos da AIVA
 * (+55 21 4020-2024).
 *
 * Público: sdr_leads status TREINAR (em treinamento — são os convidados das turmas).
 * Formato comprovado dos lembretes de 20/08 e 26/08:
 *   1. HSM 48 (coringa "Olá {{1}}, {{2}}") — chega com janela fechada
 *   2. Texto livre com Google Calendar + Meet (melhor esforço, depende de chat)
 * Idempotente por [AVISO_FERIADO_TREINO_2026-09-04] em observacoes.
 * Uso: node --env-file=.env.local scripts/aviso-feriado-treinamento-2026-09-04.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const TEMPLATE = 48
const MARCADOR = '[AVISO_FERIADO_TREINO_2026-09-04]'
const MEET = 'https://meet.google.com/gdh-ppvw-nmp' // sala das segundas — mesma da terça 08/09

const horaBrt = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()))
if (!DRY && (horaBrt < 8 || horaBrt >= 20)) { console.error(`ABORTADO: ${horaBrt}h BRT fora do horário comercial.`); process.exit(1) }

const sanitize = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`)
  return res.json()
}

// Terça 08/09/2026 09:30–10:30 BRT = 12:30–13:30 UTC
const CAL =
  'https://calendar.google.com/calendar/render?action=TEMPLATE' +
  `&text=${encodeURIComponent('Treinamento AIVA')}` +
  '&dates=20260908T123000Z/20260908T133000Z' +
  `&details=${encodeURIComponent(`Link da reunião: ${MEET}`)}` +
  `&location=${encodeURIComponent(MEET)}`

const corpoHsm = sanitize(
  'passando um aviso importante sobre o treinamento AIVA: segunda-feira (07/09) é feriado ' +
  'da Independência, então NÃO teremos a turma de segunda. Nessa semana o treinamento será ' +
  'na TERÇA-FEIRA, 08/09, no mesmo horário (9h30 às 10h30) e no mesmo link: ' +
  'meet.google.com/gdh-ppvw-nmp. Essa troca é só por causa do feriado — depois voltamos ao ' +
  'normal, com turmas às segundas e quintas. E anota aí: o número +55 21 4020-2024 é o ' +
  'WhatsApp oficial da AIVA para avisos (Comunicados Aiva Pay) — é por ele que chegam seu ' +
  'login e os comunicados. 😊'
)
const MSG_AGENDA =
  `📲 *Adicionar o treinamento de TERÇA (08/09) na sua agenda:*\n👉 ${CAL}\n\n` +
  `🔗 Link da reunião: meet.google.com/gdh-ppvw-nmp\n` +
  'Terça, 9h30 — te espero lá! 🎓'

const { data: leads, error } = await sb.from('sdr_leads')
  .select('id, nome, telefone, observacoes')
  .eq('status', 'TREINAR')
if (error) { console.error(error); process.exit(1) }
const fila = (leads ?? []).filter((l) => !(l.observacoes ?? '').includes(MARCADOR))
console.log(`TREINAR: ${leads?.length ?? 0} | a enviar: ${fila.length}${DRY ? ' (DRY)' : ''}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let ok = 0, falhas = 0
const t0 = Date.now()
for (const l of fila) {
  if (Date.now() - t0 > 240_000 || ok >= 150) { console.warn('TETO — rode de novo pra completar.'); break }
  // capitaliza nomes em CAIXA ALTA ("RENAN" → "Renan"), padrão dos lembretes
  const bruto = sanitize(l.nome)
  const nome = bruto === bruto.toUpperCase() && bruto.length > 2
    ? bruto.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
    : bruto
  if (DRY) { console.log(`  DRY ${l.nome} (${l.telefone}) → "Olá ${nome}, ${corpoHsm.slice(0, 70)}…"`); ok++; continue }
  try {
    const tpl = await post('/int/sendWaTemplate', { number: l.telefone, templateId: TEMPLATE, data: [nome, corpoHsm], openNewChat: true })
    let agendaOk = false
    try {
      const chatId = tpl.chatId ?? tpl.fkChat ?? null
      if (chatId) { await post('/int/sendMessageToChat', { chatId: Number(chatId), text: MSG_AGENDA }); agendaOk = true }
    } catch { /* janela fechada — o HSM já leva o essencial */ }

    const inserts = [{ lead_id: l.id, direcao: 'out', conteudo: `Olá ${nome}, ${corpoHsm}`, template_hsm: 'aiva_coringa_48 aviso-feriado-treino' }]
    if (agendaOk) inserts.push({ lead_id: l.id, direcao: 'out', conteudo: MSG_AGENDA })
    await sb.from('sdr_mensagens').insert(inserts)
    await sb.from('sdr_leads').update({
      data_ultimo_contato: new Date().toISOString(),
      observacoes: `${(l.observacoes ?? '').trim()} ${MARCADOR}`.trim(),
    }).eq('id', l.id)
    console.log(`  ✓ ${l.nome} (${l.telefone})${agendaOk ? ' (+agenda)' : ''}`)
    ok++
    await sleep(1500)
  } catch (err) {
    console.error(`  ✗ ${l.nome}:`, err.message)
    falhas++
  }
}

const resumo = `📢 *Aviso feriado → treinamento na TERÇA 08/09*\nEnviados: ${ok} | falhas: ${falhas} (público: etapa TREINAR)\nMsg: sem turma segunda 07/09 (feriado); terça 08/09 9h30–10h30, mesmo link das segundas; número oficial de avisos +55 21 4020-2024. Semana seguinte volta ao normal (seg e qui).`
console.log('\n' + resumo)
if (!DRY) {
  for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean)) {
    try {
      const ab = await post('/int/getClientOpenChats', { number: tel }).catch(() => null)
      const cid = ab?.chats?.[0]?.chatId
      if (cid) await post('/int/sendMessageToChat', { chatId: Number(cid), text: resumo })
      else await post('/int/openChat', { number: tel, message: resumo })
    } catch { /* digest melhor-esforço */ }
  }
}
setTimeout(() => process.exit(falhas > ok ? 1 : 0), 800).unref()
