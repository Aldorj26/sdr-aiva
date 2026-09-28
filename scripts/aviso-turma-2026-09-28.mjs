/**
 * aviso-turma-2026-09-28.mjs — avisa as lojas PRONTAS pra treinar (lead em TREINAR
 * + loja criada na AIVA) da turma de hoje (pedido do Aldo, 28/09/2026).
 * HSM 48 coringa (janela de 24h fechada pra todos). Grava em sdr_mensagens com o
 * rótulo 'aiva_aviso_turma' pra VictorIA ter o contexto se o lojista responder.
 *
 * Uso: node --env-file=.env.local scripts/aviso-turma-2026-09-28.mjs [--enviar]
 */
import { createClient } from '@supabase/supabase-js'

const ENVIAR = process.argv.includes('--enviar')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dig = (v) => String(v ?? '').replace(/\D/g, '')
const BASE = process.env.EVO_TALKS_BASE_URL
const TEMPLATE = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 48)
const fmtBrt = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const hojeBrt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

// portal: turma de hoje + inscrições
const U = process.env.AIVA_PORTAL_URL.replace(/\/$/, ''), A = process.env.AIVA_PORTAL_ANON_KEY
const tok = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: A }, body: JSON.stringify({ email: process.env.AIVA_PORTAL_EMAIL, password: process.env.AIVA_PORTAL_SENHA }) })).json()
const H = { apikey: A, Authorization: `Bearer ${tok.access_token}` }
const get = async (p) => (await fetch(`${U}/rest/v1/${p}`, { headers: H })).json()
const sessoes = await get(`training_sessions?select=*&starts_at=gte.${hojeBrt}T03:00:00Z&starts_at=lt.${hojeBrt}T23:59:00Z&order=starts_at`)
if (!Array.isArray(sessoes) || !sessoes.length) { console.log('SEM turma hoje no portal:', JSON.stringify(sessoes).slice(0, 200)); process.exit(1) }
const turma = sessoes[0]
const invite = turma.invite_id ?? turma.meet_code ?? turma.invite ?? null
console.log('turma de hoje:', fmtBrt(turma.starts_at), '| campos:', Object.keys(turma).join(','), '| invite:', invite)
if (!invite) process.exit(1)
const link = `meet.google.com/${invite}`
const bookings = await get('training_bookings?select=retailer_id,onboarding_id,starts_at')

// alvo: TREINAR com loja criada
const onbs = []; let cursor = null
do { const q = new URLSearchParams({ limit: '500' }); if (cursor) q.set('cursor', cursor); const d = await (await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, { headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY } })).json(); onbs.push(...(d.records ?? [])); cursor = d.next_cursor ?? null } while (cursor)
const onb = new Map(onbs.map((o) => [dig(o.cnpj), o]))
const { data: leads } = await sb.from('sdr_leads').select('id,nome,telefone,observacoes').eq('status', 'TREINAR')
const alvo = []
for (const l of leads) {
  const { data: regs } = await sb.from('sdr_registros_cnpj').select('cnpj').eq('lead_id', l.id)
  const os = (regs ?? []).map((r) => onb.get(dig(r.cnpj))).filter((o) => o?.retailer_id)
  if (!os.length) continue
  const minhas = bookings.filter((b) => os.some((o) => String(o.retailer_id) === String(b.retailer_id) || String(o.id) === String(b.onboarding_id)))
    .map((b) => b.starts_at).sort()
  const futura = minhas.find((s) => Date.parse(s) > Date.now() - 90 * 60000)
  const socio = (l.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1]?.trim().split(/\s+/)[0]
  // sem nome_socio: primeiro nome do lead, se parecer nome de pessoa (Dayane Fernanda…)
  const doLead = (l.nome ?? '').trim().split(/\s+/)[0] ?? ''
  const pessoa = socio ?? (l.nome && l.nome.trim().split(/\s+/).length >= 3 && /^[A-Za-zÀ-ú]{3,}$/.test(doLead) ? doLead : null)
  alvo.push({ ...l, nomeSaud: pessoa ? pessoa[0].toUpperCase() + pessoa.slice(1).toLowerCase() : 'lojista', marcada: futura ?? null })
}

const texto = (a) => {
  const hoje = `hoje, ${fmtBrt(turma.starts_at).split(', ').slice(-1)[0].replace(':', 'h')}`
  if (a.marcada && diaBrt(a.marcada) !== hojeBrt)
    return `Lembrete do treinamento da AIVA: sua turma está marcada pra ${fmtBrt(a.marcada).replace(':', 'h')}, mas se quiser adiantar, tem turma ${hoje}, no link ${link} — é só entrar no horário.`
  return `Passando pra lembrar do treinamento da AIVA ${hoje}, no link ${link}. É lá que você aprende a usar a plataforma pra fazer a primeira venda. Te espero lá!`
}
function diaBrt(iso) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) }

for (const a of alvo) console.log(`- ${a.nome} (${a.telefone}) → Oi ${a.nomeSaud}, tudo bem?\n    ${texto(a)}`)
if (!ENVIAR) { console.log(`\nENSAIO: ${alvo.length} lojas. Rode com --enviar.`); process.exit(0) }

let ok = 0
for (const a of alvo) {
  const miolo = texto(a)
  const r = await fetch(`${BASE}/int/sendWaTemplate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: Number(process.env.EVO_TALKS_QUEUE_ID ?? 10), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY, number: a.telefone, templateId: TEMPLATE, data: [a.nomeSaud, miolo], openNewChat: true }) })
  const body = await r.text()
  if (!r.ok) { console.log(`  FALHOU ${a.nome}: ${r.status} ${body.slice(0, 120)}`); continue }
  await sb.from('sdr_mensagens').insert({ lead_id: a.id, direcao: 'out', conteudo: `Oi ${a.nomeSaud}, tudo bem?\n${miolo} É só responder essa mensagem. 😊`, template_hsm: 'aiva_aviso_turma' })
  ok++; console.log(`  ✅ ${a.nome} ${body.slice(0, 60)}`)
}
console.log(`\nENVIADOS: ${ok}/${alvo.length}`)
