/**
 * senhas-pendentes-pro-nei.mjs — manda pro Nei (WhatsApp) a lista de senhas do SÓCIO
 * pedidas à AIVA e ainda não enviadas (login_sends: permission_requested_at preenchido,
 * credentials_sent_at nulo). Pedido do Aldo, 28/09/2026.
 * Uso: node --env-file=.env.local scripts/senhas-pendentes-pro-nei.mjs [--enviar]
 */
import { createClient } from '@supabase/supabase-js'
const ENVIAR = process.argv.includes('--enviar')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const fmtCnpj = (d) => (d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d)
const fmtData = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
function diasUteis(deIso) {
  let n = 0; const d = new Date(deIso); const fim = new Date()
  d.setUTCHours(12, 0, 0, 0)
  while (d < fim) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6 && d <= fim) n++ }
  return n
}

const U = process.env.AIVA_PORTAL_URL.replace(/\/$/, ''), A = process.env.AIVA_PORTAL_ANON_KEY
const tok = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: A }, body: JSON.stringify({ email: process.env.AIVA_PORTAL_EMAIL, password: process.env.AIVA_PORTAL_SENHA }) })).json()
const H = { apikey: A, Authorization: `Bearer ${tok.access_token}` }
const ls = await (await fetch(`${U}/rest/v1/login_sends?select=retailer_id,store_id,permission_requested_at,credentials_sent_at`, { headers: H })).json()
const enviadas = new Set(ls.filter((x) => x.credentials_sent_at).map((x) => String(x.retailer_id)))
// pendente = pedido feito, nenhum envio registrado pra esse RID
const porRid = new Map()
for (const x of ls) {
  const rid = String(x.retailer_id)
  if (!x.permission_requested_at || x.credentials_sent_at || enviadas.has(rid)) continue
  if (!porRid.has(rid) || x.permission_requested_at < porRid.get(rid)) porRid.set(rid, x.permission_requested_at)
}
const onbs = []; let cursor = null
do { const q = new URLSearchParams({ limit: '500' }); if (cursor) q.set('cursor', cursor); const d = await (await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, { headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY } })).json(); onbs.push(...(d.records ?? [])); cursor = d.next_cursor ?? null } while (cursor)
const onbRid = new Map(onbs.filter((o) => o.retailer_id).map((o) => [String(o.retailer_id), o]))
const perf = await (await fetch(`${U}/rest/v1/retailer_performance?select=retailer_id,cnpj,retailer_name,n_vendas,n_consultas`, { headers: H })).json()
const perfRid = new Map(); for (const p of perf) { const k = String(p.retailer_id); const a = perfRid.get(k) ?? { ...p, v: 0, c: 0 }; a.v += p.n_vendas ?? 0; a.c += p.n_consultas ?? 0; perfRid.set(k, a) }

const linhas = []
for (const [rid, pedido] of porRid) {
  const o = onbRid.get(rid), p = perfRid.get(rid)
  const cnpj = dig(o?.cnpj ?? p?.cnpj)
  const nome = (o?.legal_name ?? '').trim() || String(p?.retailer_name ?? '').replace(/-?\d{14}$/, '').replace(/[-_]+/g, ' ').trim().toUpperCase() || `RID ${rid}`
  const { data: reg } = cnpj ? await sb.from('sdr_registros_cnpj').select('lead_id').eq('cnpj', cnpj).not('lead_id', 'is', null).limit(1) : { data: [] }
  const { data: lead } = reg?.[0]?.lead_id ? await sb.from('sdr_leads').select('nome,telefone').eq('id', reg[0].lead_id).maybeSingle() : { data: null }
  linhas.push({ rid, nome, cnpj, pedido, du: diasUteis(pedido), operando: (p?.v ?? 0) + (p?.c ?? 0) > 0, tel: lead?.telefone ?? dig(o?.phone_number) })
}
linhas.sort((a, b) => a.pedido.localeCompare(b.pedido))

const partes = [
  `🔑 *Senhas do sócio pendentes na AIVA* — ${linhas.length} lojas`,
  `Pedido feito no portal e a AIVA ainda não enviou a senha (login_sends sem envio). Da mais antiga pra mais nova:`,
  '',
  ...linhas.map((l, i) => `${i + 1}. *${l.nome}* — CNPJ ${fmtCnpj(l.cnpj)} · RID ${l.rid}\n   pedida em ${fmtData(l.pedido)} (${l.du} dias úteis)${l.tel ? ` · 📞 ${l.tel}` : ''}${l.operando ? ' · ⚠️ já consulta/vende' : ''}`),
  '',
  `➡️ Cobrar a AIVA pelo envio. Quando a senha sair, o sistema tira a loja da lista sozinho.`,
]
const msg = partes.join('\n')
console.log(msg)
console.log(`\n(${msg.length} caracteres)`)

if (ENVIAR) {
  const BASE = process.env.EVO_TALKS_BASE_URL
  const Q = { queueId: Number(process.env.EVO_TALKS_QUEUE_ID ?? 10), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY }
  const evo = async (path, body) => { const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Q, ...body }) }); if (!r.ok) throw new Error(`${path} ${r.status} ${(await r.text()).slice(0, 120)}`); return r.json().catch(() => ({})) }
  const nei = process.env.NEI_WHATSAPP
  const abertos = await evo('/int/getClientOpenChats', { number: nei }).catch(() => null)
  const chatId = abertos?.chats?.[0]?.chatId
  if (chatId) await evo('/int/sendMessageToChat', { chatId, text: msg })
  else await evo('/int/openChat', { number: nei, message: msg })
  await sb.from('sdr_alertas').insert({ tipo: '🔑', mensagem: msg, entregue: true })
  console.log(`\n✅ enviado pro Nei (${chatId ? 'chat aberto ' + chatId : 'chat novo'})`)
}
