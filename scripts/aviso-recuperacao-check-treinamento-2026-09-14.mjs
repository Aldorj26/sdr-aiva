#!/usr/bin/env node
/**
 * Aviso de RECUPERAÇÃO pro Nei (Aldo 14/09/2026).
 *
 * O check de treinamento saiu às 14h53 e o detector que avisa o Nei só entrou
 * no ar às 15h09 — três lojistas responderam nessa janela e o aviso automático
 * não chegou a disparar. Este script manda o aviso das três de uma vez e
 * carimba [CHECK_TREINAMENTO_RESP] nos leads, pra (a) o cron de segunda/quinta
 * não perguntar de novo a quem já respondeu e (b) o webhook não alertar em
 * duplicidade se eles mandarem outra mensagem nos próximos 3 dias.
 *
 * Uso: node --env-file=.env.local scripts/aviso-recuperacao-check-treinamento-2026-09-14.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const AUTH = { queueId: Number(process.env.EVO_TALKS_QUEUE_ID), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY }
const NEI = process.env.NEI_WHATSAPP
const DRY = process.argv.includes('--dry')

const OPPS = ['18708', '18435', '18629'] // L.L Assistência, HS Imports, Hospital do Celular

const MSG = [
  '🎓 *CHECK DE TREINAMENTO — 3 responderam antes do aviso automático entrar no ar*',
  '',
  '_Recuperação manual: o disparo saiu 14h53 e o aviso automático só passou a valer 15h09._',
  '',
  '✅ *L.L Assistência* — 41 99966-6709',
  '💬 "Consegui" (participou do treinamento) e "nenhuma dúvida por enquanto"',
  '👉 Pode mover o card pra *Login*.',
  '⚠️ Ele cobrou o acesso 2× hoje e disse que o login não chegou — já está na sua fila em /atendimento. Vale pedir pra ele conferir o *spam do SMS* também.',
  '',
  '📅 *HS Imports* — 98 8569-2714',
  '💬 "Pode encaixar" → escolheu *quinta*',
  '👉 Ainda NÃO treinou. Fica em Treinar; a VictorIA já mandou o link da quinta.',
  '',
  '❓ *Hospital do Celular Itaim Paulista* — 11 94738-2124',
  '💬 "Já foi aprovado a minha loja?" — ele não sabia que tinha sido aprovado',
  '👉 Ainda NÃO treinou. Fica em Treinar; a VictorIA confirmou a aprovação e mandou os dois links.',
  '',
  '_Rkcell recebeu a pergunta e não respondeu._',
  '',
  'A partir de agora esse aviso sai sozinho, assim que o lojista responder.',
].join('\n')

console.log('─── mensagem ───\n' + MSG + '\n────────────────\n')

if (DRY) {
  console.log('[DRY] nada enviado, nada carimbado.')
  process.exit(0)
}

// 1) Envia pro Nei (mesmo caminho do alertHuman: chat aberto pelo número)
const chatRes = await fetch(`${BASE}/int/getOpenChatByNumber`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...AUTH, number: NEI }),
})
const chatBody = await chatRes.text()
let chatId = null
try { chatId = JSON.parse(chatBody)?.chat?.id ?? JSON.parse(chatBody)?.id ?? null } catch { /* sem chat aberto */ }

let enviado = false
if (chatId) {
  const r = await fetch(`${BASE}/int/sendMessageToChat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...AUTH, chatId: Number(chatId), message: MSG }),
  })
  enviado = r.ok
  console.log(`envio por chatId ${chatId}: ${r.ok ? 'OK' : 'falhou ' + r.status + ' ' + (await r.text()).slice(0, 200)}`)
} else {
  console.log('nenhum chat aberto com o Nei encontrado — tentando sendText por número')
  const r = await fetch(`${BASE}/int/sendText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...AUTH, number: NEI, message: MSG }),
  })
  enviado = r.ok
  console.log(`envio por número: ${r.ok ? 'OK' : 'falhou ' + r.status + ' ' + (await r.text()).slice(0, 200)}`)
}

// registra no painel de alertas, igual ao alertHuman
await supabase.from('sdr_alertas').insert({ tipo: 'treinamento', mensagem: MSG, entregue: enviado })

// 2) Carimba a resposta nos 3 leads
const { data: leads } = await supabase
  .from('sdr_leads')
  .select('id, nome, observacoes')
  .in('evotalks_opportunity_id', OPPS)

for (const l of leads ?? []) {
  const obs = l.observacoes ?? ''
  const carimbo = `[CHECK_TREINAMENTO_RESP:${new Date().toISOString()}]`
  const nova = /\[CHECK_TREINAMENTO_RESP:[^\]]*\]/.test(obs)
    ? obs.replace(/\[CHECK_TREINAMENTO_RESP:[^\]]*\]/, carimbo)
    : `${obs} ${carimbo}`.trim()
  const { error } = await supabase.from('sdr_leads').update({ observacoes: nova }).eq('id', l.id)
  console.log(`${error ? '❌' : '✅'} carimbo em ${l.nome}${error ? ': ' + error.message : ''}`)
}

console.log(`\nAviso ${enviado ? 'enviado' : 'NÃO enviado'} ao Nei | leads carimbados: ${(leads ?? []).length}`)
