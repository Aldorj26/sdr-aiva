#!/usr/bin/env node
/**
 * Reenvio dos templates que a Meta recusou entre 21/09 13h e 22/09 14h30 (BRT)
 * por falha de cobrança (erro 131042 — cartão recusado em 21/09). A Evo devolvia
 * "success" e a Meta gerava wamid, mas o recibo (clientrcvtime) nunca chegava.
 *
 * Fonte: scripts/out-nao-entregues-2026-09-22.json (levantado pelo recibo do Evo).
 *  - D+0 (aiva_campanha, INICIO): reenvia o template 41 com as mesmas vars do send-initial.
 *  - Lembretes do template 48 (cobrança de formulário / biometria / check de treinamento):
 *    reenvia o MESMO texto, só pra EM_ANALISE_AIVA e TREINAR. OPT_OUT/DESCARTADO/placeholders ficam fora.
 *  - "Sem template visível no Evo": procura o chat aberto pelo número; reenvia só se achar o
 *    template sem recibo. Se não achar, lista pra conferência manual (não arrisca duplicar).
 * Uso: node --env-file=.env.local scripts/reenvio-nao-entregues-2026-09-22.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL, KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY, QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const DRY = process.argv.includes('--dry')
const INI = '2026-09-21T15:55:00Z'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function post(p, b) {
  const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...b }) })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { raw: t.slice(0, 200) } }
}
const VARS41 = ['Vender mais celulares sem risco de calote', 'vi que vocês trabalham com venda de celular e queria apresentar uma parceria rapida:', 'A *AIVA* ajuda lojas como a sua a venderem mais — sem dor de cabeça:', '*Aprovação do cliente em 2 minutos*', '*Você recebe em 2 dias úteis*', '*Zero risco de inadimplência (o risco é nosso)*', '*Parcelamento em até 12x pro cliente*']
const src = JSON.parse(readFileSync('scripts/out-nao-entregues-2026-09-22.json', 'utf8'))
const limpa = (v) => String(v).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()

// texto do 48 gravado como `Oi ${nome}, tudo bem?\n${miolo} É só responder essa mensagem. 😊`
function desmontar48(conteudo) {
  const m = conteudo.match(/^Oi (.+?), tudo bem\?\n([\s\S]+?) É só responder essa mensagem\. 😊\s*$/)
  return m ? { saud: m[1], miolo: m[2] } : null
}
async function ultimoOut48(leadId) {
  const { data } = await sb.from('sdr_mensagens').select('conteudo,enviado_em').eq('lead_id', leadId).eq('direcao', 'out').eq('template_hsm', 'aiva_reativacao_48h').gte('enviado_em', INI).order('enviado_em', { ascending: false }).limit(1)
  return data?.[0] ?? null
}
async function jaReenviado(leadId) {
  const { count } = await sb.from('sdr_mensagens').select('id', { count: 'exact', head: true }).eq('lead_id', leadId).eq('direcao', 'out').ilike('conteudo', '%pós-pagamento%')
  return (count ?? 0) > 0
}

const plano = { d0: [], t48: [], pular: [], conferir: [] }
for (const x of src.naoEntregues) {
  if (await jaReenviado(x.lead_id)) { plano.pular.push(`${x.nome} ${x.telefone}: já reenviado (teste)`); continue }
  const soD0 = x.templates.every((t) => t === 'aiva_campanha')
  if (soD0) {
    if (x.status === 'INICIO') plano.d0.push(x)
    else plano.pular.push(`${x.nome} ${x.telefone}: D+0 mas status ${x.status}`)
    continue
  }
  if (!['EM_ANALISE_AIVA', 'TREINAR'].includes(x.status)) { plano.pular.push(`${x.nome} ${x.telefone}: status ${x.status}`); continue }
  const ult = await ultimoOut48(x.lead_id)
  const d = ult ? desmontar48(ult.conteudo) : null
  if (!d) { plano.pular.push(`${x.nome} ${x.telefone}: texto não é lembrete (${(ult?.conteudo ?? '').slice(0, 50)})`); continue }
  plano.t48.push({ ...x, ...d })
}
// os "sem template visível": procura o chat aberto pelo número
for (const x of src.semTemplateNoEvo) {
  const { data: l } = await sb.from('sdr_leads').select('id,nome,telefone,status,evotalks_chat_id').eq('telefone', x.telefone).maybeSingle()
  if (!l) { plano.conferir.push(`${x.nome} ${x.telefone}: lead não achado`); continue }
  const oc = await post('/int/getClientOpenChats', { number: l.telefone })
  const chatId = oc?.chats?.[0]?.chatId ?? null
  if (!chatId) { plano.conferir.push(`${l.nome} ${l.telefone} ${l.status}: sem chat aberto no Evo (templates: ${x.templates.join(',')})`); continue }
  const d = await post('/int/getChatMessages', { chatId: Number(chatId), limit: 20 })
  const tpls = (d.messages ?? []).filter((m) => m.direction === 2 && m.srvrcvtime >= INI)
  if (!tpls.length) { plano.conferir.push(`${l.nome} ${l.telefone} ${l.status}: chat ${chatId} sem template desde 21/09 (templates: ${x.templates.join(',')})`); continue }
  if (tpls.some((m) => m.clientrcvtime)) continue   // entregou por outro chat — nada a fazer
  if (!['EM_ANALISE_AIVA', 'TREINAR'].includes(l.status)) { plano.pular.push(`${l.nome} ${l.telefone}: status ${l.status} (chat ${chatId})`); continue }
  const ult = await ultimoOut48(l.id)
  const dd = ult ? desmontar48(ult.conteudo) : null
  if (!dd) { plano.pular.push(`${l.nome} ${l.telefone}: texto não é lembrete`); continue }
  if (String(chatId) !== String(l.evotalks_chat_id) && !DRY) await sb.from('sdr_leads').update({ evotalks_chat_id: String(chatId) }).eq('id', l.id)
  plano.t48.push({ lead_id: l.id, nome: l.nome, telefone: l.telefone, status: l.status, chat: chatId, ...dd })
}
console.log(`PLANO: D+0=${plano.d0.length} | lembretes 48=${plano.t48.length} | pular=${plano.pular.length} | conferir=${plano.conferir.length}`)
console.log('PULAR:'); plano.pular.forEach((s) => console.log('  - ' + s))
console.log('CONFERIR:'); plano.conferir.forEach((s) => console.log('  - ' + s))
console.log('LEMBRETES 48:'); plano.t48.forEach((x) => console.log(`  - ${x.nome} ${x.telefone} ${x.status} | Oi ${x.saud}: "${x.miolo.slice(0, 70)}"`))
writeFileSync('scripts/out-reenvio-plano-2026-09-22.json', JSON.stringify(plano, null, 1))
if (DRY) { console.log('[DRY] nada enviado'); process.exit(0) }

let ok = 0, falha = 0
const enviados = []
for (const x of plano.d0) {
  const r = await post('/int/sendWaTemplate', { number: x.telefone, templateId: 41, data: VARS41, openNewChat: true })
  if (r?.message === 'success') {
    ok++; enviados.push(x)
    await sb.from('sdr_mensagens').insert({ lead_id: x.lead_id, direcao: 'out', conteudo: `[Template AIVA reenviado para ${x.telefone} — reenvio pós-pagamento Meta 22/09]`, template_hsm: 'aiva_campanha' })
  } else { falha++; console.log(`  ❌ D+0 ${x.telefone}: ${JSON.stringify(r).slice(0, 120)}`) }
  if ((ok + falha) % 50 === 0) console.log(`  D+0 ${ok + falha}/${plano.d0.length} (ok=${ok} falha=${falha})`)
  await sleep(700)
}
for (const x of plano.t48) {
  const r = await post('/int/sendWaTemplate', { number: x.telefone, templateId: 48, data: [limpa(x.saud), limpa(x.miolo)], openNewChat: true })
  if (r?.message === 'success') {
    ok++; enviados.push(x)
    await sb.from('sdr_mensagens').insert({ lead_id: x.lead_id, direcao: 'out', conteudo: `Oi ${x.saud}, tudo bem?\n${x.miolo} É só responder essa mensagem. 😊\n[reenvio pós-pagamento Meta 22/09]`, template_hsm: 'aiva_reativacao_48h' })
  } else { falha++; console.log(`  ❌ 48 ${x.telefone}: ${JSON.stringify(r).slice(0, 120)}`) }
  await sleep(700)
}
console.log(`\nENVIADOS: ${ok} | falhas: ${falha}`)
// verificação: amostra de 40 — recibo da Meta
await sleep(60000)
let ent = 0, tot = 0
const passo = Math.max(1, Math.floor(enviados.length / 40))
for (const x of enviados.filter((_, i) => i % passo === 0).slice(0, 40)) {
  const chatId = x.chat ?? (await post('/int/getClientOpenChats', { number: x.telefone }))?.chats?.[0]?.chatId
  if (!chatId) continue
  const d = await post('/int/getChatMessages', { chatId: Number(chatId), limit: 5 })
  const m = (d.messages ?? []).filter((mm) => mm.direction === 2).sort((a, b) => b.id - a.id)[0]
  if (!m) continue
  tot++; if (m.clientrcvtime) ent++
}
console.log(`VERIFICAÇÃO (amostra ${tot}): entregues=${ent}`)
