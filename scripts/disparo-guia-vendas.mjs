// Disparo único do Guia de Vendas no Crediário pra toda a base em
// LOJA_FINALIZADA_E_VENDENDO (pedido do Aldo 2026-07-31).
// Exclui: [CONSULTORIA_OPTOUT], acionar_humano=true, quem ainda vai receber
// o Toque 1 da consultoria (INICIO presente + COUNT:0 — o link já vai nele),
// e quem já tem [GUIA_VENDAS_ENVIADO] (idempotência).
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const env = Object.fromEntries(
  readFileSync('C:/projetos claude/sdr-aiva/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const TEMPLATE_ID = Number(env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)

const MIOLO =
  'preparei um presente pra sua loja: nosso treinamento completo de vendas no crediário 🎓 é só passar pra sua equipe estudar — no final tem prova e certificado pra cada vendedor! Acessa: sdr-aiva.vercel.app/treinamento-vendas.html — depois me conta o que sua equipe achou 😊'

const sanitize = (s) => s.replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
const post = (p, b) =>
  fetch(env.EVO_TALKS_BASE_URL + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: Number(env.EVO_TALKS_QUEUE_ID), apiKey: env.EVO_TALKS_QUEUE_API_KEY, ...b }),
  }).then(async (r) => {
    const t = await r.text()
    if (!r.ok) throw new Error(`${p} → ${r.status}: ${t.slice(0, 120)}`)
    try { return JSON.parse(t) } catch { return {} }
  })

function normalizaNome(n) {
  if (!n) return null
  const s = n.trim().split(/\s+/)[0]
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null
}

const { data: lojas, error } = await sb
  .from('sdr_leads')
  .select('id, nome, telefone, observacoes')
  .eq('produto', 'AIVA')
  .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
  .eq('acionar_humano', false)
if (error) { console.error(error.message); process.exit(1) }

const candidatas = lojas.filter((l) => {
  const obs = l.observacoes ?? ''
  if (obs.includes('[CONSULTORIA_OPTOUT]')) return false
  if (obs.includes('[GUIA_VENDAS_ENVIADO]')) return false
  // vai receber o link no Toque 1 — não duplica
  if (/\[CONSULTORIA_INICIO:/.test(obs) && /\[CONSULTORIA_COUNT:0\]/.test(obs)) return false
  return true
})
console.log(`Etapa: ${lojas.length} lojas | candidatas ao disparo: ${candidatas.length}${DRY ? ' [DRY]' : ''}`)
if (DRY) { candidatas.slice(0, 15).forEach((l) => console.log(' ', l.telefone, l.nome)); process.exit(0) }
if (!TEMPLATE_ID) { console.error('AIVA_REATIVACAO_TEMPLATE_ID ausente'); process.exit(1) }

let ok = 0, falha = 0
const falhasDet = []
for (const loja of candidatas) {
  const obs = loja.observacoes ?? ''
  let nome = normalizaNome(obs.match(/nome_socio=([^|\]]+)/)?.[1]) || normalizaNome(loja.nome) || 'Lojista'
  if (nome.replace(/[^\p{L}]/gu, '').length < 3) nome = 'Lojista'
  try {
    await post('/int/sendWaTemplate', { number: loja.telefone, templateId: TEMPLATE_ID, data: [sanitize(nome), sanitize(MIOLO)], openNewChat: true })
    await sb.from('sdr_leads').update({
      observacoes: `${obs.trim()} [GUIA_VENDAS_ENVIADO:${new Date().toISOString()}]`.trim(),
      data_ultimo_contato: new Date().toISOString(),
    }).eq('id', loja.id)
    await sb.from('sdr_mensagens').insert([
      { lead_id: loja.id, direcao: 'out', conteudo: `Olá ${nome}, ${MIOLO}`, template_hsm: 'aiva_reativacao_48h' },
    ])
    ok++
  } catch (e) {
    falha++; falhasDet.push(`${loja.telefone}: ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 400))
}
console.log(`\nEnviados: ${ok} | Falhas: ${falha}`)
falhasDet.forEach((f) => console.log(' ✗', f))
