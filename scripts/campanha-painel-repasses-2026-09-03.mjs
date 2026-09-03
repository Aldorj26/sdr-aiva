#!/usr/bin/env node
/**
 * CAMPANHA "PAINEL DE REPASSES" (aprovada pelo Aldo 03/09) — pergunta às lojas
 * em LOJA_FINALIZADA_E_VENDENDO se já têm acesso ao painel de repasses; quem
 * não tiver responde com CNPJ matriz + Gmail e a VictorIA/sistema lança a
 * solicitação (fluxo REPASSE DE VENDA item 1 + captura do webhook).
 *
 * HSM 48 coringa; idempotente por [CAMPANHA_PAINEL_REPASSES:2026-09-03];
 * horário comercial; teto 150/240s; digest Aldo/Nei.
 * Uso: node --env-file=.env.local scripts/campanha-painel-repasses-2026-09-03.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const TEMPLATE = 48
const MARCADOR = '[CAMPANHA_PAINEL_REPASSES:2026-09-03]'

const horaBrt = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()))
if (!DRY && (horaBrt < 8 || horaBrt >= 20)) { console.error(`ABORTADO: ${horaBrt}h BRT fora do horário comercial.`); process.exit(1) }

const sanitize = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
const primeiroNome = (n) => {
  const p = sanitize(n).split(/[\s—-]+/)[0]
  return /^\d+$/.test(p) || !p || p.toLowerCase() === 'loja' ? 'parceiro(a)' : p
}
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`)
  return res.json()
}

// Texto aprovado pelo Aldo (03/09) — sem \n (parâmetro de HSM coringa)
const corpo = (nome) =>
  `Pergunta rápida: você já tem acesso ao painel de repasses da AIVA (onde dá pra ver cada venda, o valor a receber e a data do repasse)? Se ainda NÃO tiver, eu mesma faço a solicitação pra você agora — só me manda o CNPJ da matriz e o seu e-mail Gmail que eu já deixo tudo encaminhado. 😊`

const { data: leads } = await sb.from('sdr_leads')
  .select('id, nome, telefone, observacoes')
  .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
const fila = (leads ?? []).filter((l) => !(l.observacoes ?? '').includes(MARCADOR) && !(l.observacoes ?? '').includes('[REPASSE_SOLICITADO'))
console.log(`LFV: ${leads?.length ?? 0} | a enviar: ${fila.length}${DRY ? ' (DRY)' : ''}`)
if (DRY) { fila.slice(0, 8).forEach((l) => console.log('-', l.nome, l.telefone)); process.exit(0) }

const INICIO = Date.now()
let ok = 0, falha = 0
for (const l of fila) {
  if (Date.now() - INICIO > 240_000 || ok >= 150) { console.warn('TETO — rode de novo pra completar.'); break }
  const nome = primeiroNome(l.nome)
  try {
    await post('/int/sendWaTemplate', { number: l.telefone, templateId: TEMPLATE, data: [nome, corpo(nome)], openNewChat: true })
    await sb.from('sdr_leads').update({ observacoes: `${l.observacoes ?? ''}\n${MARCADOR}`.trim() }).eq('id', l.id)
    await sb.from('sdr_mensagens').insert({ lead_id: l.id, direcao: 'out', conteudo: `Olá ${nome}, ${corpo(nome)}`, template_hsm: 'coringa-48 campanha-painel-repasses' })
    ok++
    console.log('✓', l.nome)
  } catch (e) { falha++; console.error('✗', l.nome, String(e).slice(0, 100)) }
}

const resumo = `📢 *Campanha Painel de Repasses (LFV)*\nEnviadas: ${ok} | falhas: ${falha} | restam: ${fila.length - ok - falha}\nQuem responder sem acesso: a VictorIA coleta CNPJ+Gmail, lança no form e registra na aba Repasses sozinha.`
console.log('\n' + resumo)
for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean)) {
  try {
    const ab = await post('/int/getClientOpenChats', { number: tel }).catch(() => null)
    const cid = ab?.chats?.[0]?.chatId
    if (cid) await post('/int/sendMessageToChat', { chatId: Number(cid), text: resumo })
    else await post('/int/openChat', { number: tel, message: resumo })
  } catch { /* digest melhor-esforço */ }
}
setTimeout(() => process.exit(falha > ok ? 1 : 0), 800).unref()
