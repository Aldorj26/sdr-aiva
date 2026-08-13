/**
 * vincular-chats-disparo.mjs — repara leads disparados sem evotalks_chat_id.
 *
 * O send-initial antigo descartava o chatId devolvido pelo sendWaTemplate: o
 * lead ficava sem chat_id e a opp sem vínculo (aba Atendimento). Este script
 * busca o chat aberto de cada lead na Evo, grava no Supabase e amarra na opp.
 *
 * Uso: node scripts/vincular-chats-disparo.mjs [--dry] [--horas N]
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const DRY = process.argv.includes('--dry')
const hIdx = process.argv.indexOf('--horas')
const HORAS = hIdx > -1 ? Number(process.argv[hIdx + 1]) : 3
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const post = (p, b) =>
  fetch(env.EVO_TALKS_BASE_URL + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: Number(env.EVO_TALKS_QUEUE_ID), apiKey: env.EVO_TALKS_QUEUE_API_KEY, ...b }),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${p} HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`)
    return r.json()
  })

const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}
// --todos: repara todo o histórico de leads ATIVOS no funil (paginado).
// Sem a flag: só os disparados nas últimas N horas.
const TODOS = process.argv.includes('--todos')
const FORA_DO_FUNIL = '("OPT_OUT","NAO_QUALIFICADO","DESCARTADO","BOT_DETECTADO","ODRES","UME")'
const base =
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sdr_leads` +
  `?select=id,nome,telefone,evotalks_opportunity_id,evotalks_chat_id` +
  `&produto=eq.AIVA&evotalks_chat_id=is.null&evotalks_opportunity_id=not.is.null`

let leads = []
if (TODOS) {
  let off = 0
  for (;;) {
    const page = await (await fetch(`${base}&status=not.in.${FORA_DO_FUNIL}&order=id&offset=${off}&limit=1000`, { headers: H })).json()
    if (!Array.isArray(page)) { console.error('Erro:', page); process.exit(1) }
    leads = leads.concat(page)
    if (page.length < 1000) break
    off += 1000
  }
} else {
  const desde = new Date(Date.now() - HORAS * 3600_000).toISOString()
  leads = await (await fetch(`${base}&data_disparo_inicial=gte.${desde}&limit=500`, { headers: H })).json()
  if (!Array.isArray(leads)) { console.error('Erro:', leads); process.exit(1) }
}
console.log(`Leads ${TODOS ? 'ativos no funil' : `disparados nas últimas ${HORAS}h`} sem chat_id: ${leads.length}${DRY ? ' (DRY)' : ''}`)

let ok = 0, semChat = 0, falhas = 0
for (const l of leads) {
  try {
    const r = await post('/int/getClientOpenChats', { number: l.telefone })
    const chatId = r?.chats?.[0]?.chatId ?? null
    if (!chatId) { semChat++; continue }
    if (!DRY) {
      await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sdr_leads?id=eq.${l.id}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ evotalks_chat_id: String(chatId) }),
      })
      await post('/int/updateOpportunity', { id: Number(l.evotalks_opportunity_id), fkChat: chatId })
    }
    ok++
    if (ok <= 5) console.log(`  ✓ ${l.telefone} → chat ${chatId} ↔ opp ${l.evotalks_opportunity_id}`)
  } catch (err) {
    falhas++
    console.log(`  ✗ ${l.telefone}: ${err.message.slice(0, 90)}`)
  }
  await sleep(250)
}
console.log(`\nVinculados: ${ok} | Sem chat aberto: ${semChat} | Falhas: ${falhas}`)
