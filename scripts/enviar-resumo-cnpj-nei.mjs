/** Envia o resumo do backfill de CNPJs pro WhatsApp do Nei + registra em sdr_alertas. */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const BASE = env.EVO_TALKS_BASE_URL
// Endpoints /int/* usam a chave DA FILA + queueId (igual lib/evotalks.ts)
const API_KEY = env.EVO_TALKS_QUEUE_API_KEY
const QUEUE_ID = Number(env.EVO_TALKS_QUEUE_ID)
const NEI = env.NEI_WHATSAPP

const MSG =
  `🧾 *RAIO-X DOS CNPJs — consulta na Receita (199 lojas do funil)*\n\n` +
  `Consultamos o CNPJ de todas as lojas ativas na base da Receita Federal. Resumo:\n\n` +
  `• *86 lojas (43%)* são empresário individual *SEM SÓCIO* → a VictorIA agora já pede automaticamente os 5 documentos (contrato social, e-mail, selfie, RG/CNH, dados bancários) quando detecta\n` +
  `• *25 lojas* com CNPJ de *menos de 1 ano*\n` +
  `• *3 lojas* com situação *IRREGULAR* na Receita\n\n` +
  `🚨 *URGENTE — situação irregular:*\n` +
  `• Smart (etapa Login) — CNPJ *BAIXADO* — 5531989760168\n` +
  `• Gordinho e Luiz H (Loja Finalizada) — *INAPTA* — 5522988188472\n` +
  `• Lu & Clara Celulares (Interessado) — *INAPTA* — 5571987338789\n\n` +
  `⚠️ *CNPJ < 1 ano em EM ANÁLISE (ver caso a caso com o Eduardo):*\n` +
  `• VK Premium Cell (0 anos) — 554187045572\n` +
  `• Conecta Cell (0,1 ano) — 556392603294\n` +
  `• Trokei Cell (0,3) — 558594367038\n` +
  `• Ultracell Imports (0,7) — 556792873662\n` +
  `• RN Imports (0,8) — 556599483202\n` +
  `• CPD Informática (0,8) — 556696347844\n\n` +
  `Os dados de cada loja (abertura, situação, sócios) estão gravados no painel — busca por "CNPJ_RECEITA".`

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: API_KEY, ...body }),
  })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

// Envia pro Nei (chat aberto ou abre novo)
let entregue = false
try {
  const chats = await post('/int/getClientOpenChats', { number: NEI }).catch(() => null)
  const chatId = chats?.chats?.[0]?.chatId ?? null
  if (chatId) {
    await post('/int/sendMessageToChat', { chatId, text: MSG })
  } else {
    await post('/int/openChat', { number: NEI, message: MSG })
  }
  entregue = true
  console.log('Resumo enviado pro Nei ✓')
} catch (err) {
  console.error('Falha ao enviar pro Nei:', err.message)
}

// Registra na página /alertas
const sup = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sdr_alertas`, {
  method: 'POST',
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ tipo: '🧾', mensagem: MSG, entregue }),
})
console.log(`Registro em sdr_alertas: ${sup.ok ? 'ok' : `HTTP ${sup.status}`}`)
