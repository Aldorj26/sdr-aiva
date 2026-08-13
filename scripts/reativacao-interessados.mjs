// Resgate único dos INTERESSADO parados (pedido do Aldo 2026-08-03).
// Leads que engajaram na qualificação e sumiram +24h — nenhuma automação os
// cobria. Envia HSM 48 reabridor ("Olá {{1}}, {{2}}") com abertura calibrada
// pela idade da pausa. Quando o lead responde, a VictorIA retoma a coleta do
// ponto exato (dados acumulados no lead).
//
// Travas: só status INTERESSADO, último contato antes de hoje, sem pausa
// vigente, sem acionar_humano, e marcador [REATIVACAO_INT:] (nunca repete).
// Uso: node scripts/reativacao-interessados.mjs [--dry] [--max N]
import { readFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry')
const maxArg = process.argv.indexOf('--max')
const MAX = maxArg > -1 ? Number(process.argv[maxArg + 1]) : Infinity

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const TEMPLATE_ID = Number(env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const DIA_MS = 24 * 60 * 60 * 1000

// {{2}} do HSM — UMA linha, sem \n (regra da Meta)
const MIOLOS = {
  quente: 'tudo bem? A gente ficou no meio da conversa sobre o crediário AIVA pra sua loja — posso continuar de onde paramos? 😊 Faltava bem pouco pra fechar seu cadastro!',
  morno: 'tudo bem? Sua loja ficou com o cadastro do crediário AIVA pela metade — e faltava pouco! As lojas parceiras estão vendendo bem no parcelado. Quer retomar de onde paramos? 😊',
  frio: 'tudo bem? Faz um tempinho que começamos seu cadastro no crediário AIVA e ficou pela metade. Ainda faz sentido pra sua loja? Se sim, seguimos de onde paramos; se não, me avisa que encerro por aqui, sem problema 😊',
}

const sanitize = (s) => s.replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
function normalizaNome(n) {
  if (!n) return null
  const s = n.trim().split(/\s+/)[0]
  return s && s.length >= 3 ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null
}
const post = (p, b) =>
  fetch(env.EVO_TALKS_BASE_URL + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: Number(env.EVO_TALKS_QUEUE_ID), apiKey: env.EVO_TALKS_QUEUE_API_KEY, ...b }),
  }).then(async (r) => {
    const t = await r.text()
    if (!r.ok) throw new Error(`${p} → ${r.status}: ${t.slice(0, 100)}`)
    try { return JSON.parse(t) } catch { return {} }
  })

const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
let all = [], from = 0
while (true) {
  const { data, error } = await sb.from('sdr_leads')
    .select('id, nome, telefone, data_ultimo_contato, criado_em, observacoes, acionar_humano')
    .eq('status', 'INTERESSADO').eq('produto', 'AIVA')
    .range(from, from + 999)
  if (error) { console.error(error.message); process.exit(1) }
  all.push(...(data ?? []))
  if (!data || data.length < 1000) break
  from += 1000
}

const agora = Date.now()
const alvo = all.filter((l) => {
  const ult = new Date(l.data_ultimo_contato ?? l.criado_em)
  if (ult >= hoje) return false
  if (l.acionar_humano) return false
  const obs = l.observacoes ?? ''
  if (obs.includes('[REATIVACAO_INT')) return false
  const pausa = obs.match(/\[PAUSA_ATE:([^\]]+)\]/)
  if (pausa && Date.parse(pausa[1]) > agora) return false
  return true
})

const faixa = (l) => {
  const d = (agora - new Date(l.data_ultimo_contato ?? l.criado_em).getTime()) / DIA_MS
  return d <= 14 ? 'quente' : d <= 30 ? 'morno' : 'frio'
}
const porFaixa = { quente: 0, morno: 0, frio: 0 }
alvo.forEach((l) => porFaixa[faixa(l)]++)
console.log(`Alvo: ${alvo.length} leads | quente(≤14d): ${porFaixa.quente} | morno(15-30d): ${porFaixa.morno} | frio(+30d): ${porFaixa.frio}${DRY ? ' [DRY]' : ''}`)
if (DRY) process.exit(0)
if (!TEMPLATE_ID) { console.error('AIVA_REATIVACAO_TEMPLATE_ID ausente'); process.exit(1) }

let ok = 0, falha = 0
const falhas = []
for (const lead of alvo.slice(0, MAX)) {
  const obs = lead.observacoes ?? ''
  const nome = normalizaNome(obs.match(/nome_socio=([^|\]]+)/)?.[1]) || normalizaNome(lead.nome) || 'Lojista'
  const miolo = MIOLOS[faixa(lead)]
  try {
    await post('/int/sendWaTemplate', { number: lead.telefone, templateId: TEMPLATE_ID, data: [sanitize(nome), sanitize(miolo)], openNewChat: true })
    await sb.from('sdr_leads').update({
      observacoes: `${obs.trim()} [REATIVACAO_INT:${new Date().toISOString()}]`.trim(),
      data_ultimo_contato: new Date().toISOString(),
    }).eq('id', lead.id)
    await sb.from('sdr_mensagens').insert({ lead_id: lead.id, direcao: 'out', conteudo: `Olá ${nome}, ${miolo}`, template_hsm: 'aiva_reativacao_48h' })
    ok++
    if (ok % 50 === 0) console.log(`  ${ok} enviados...`)
  } catch (e) {
    falha++
    falhas.push(`${lead.telefone}: ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 400))
}
console.log(`\n===== RESUMO =====\nEnviados: ${ok} | Falhas: ${falha}`)
falhas.slice(0, 15).forEach((f) => console.log(' ✗', f))
