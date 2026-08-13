// Disparo manual do template AIVA aprovação (id 15) + link CAF para Elder Tech
// Telefone: 5545988139336 — nome: Elder

const BASE_URL = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID = 10
const QUEUE_API_KEY = '5bb6aa653e204c4f9c302b79ef783c1a'
const TEMPLATE_ID = 15

const TELEFONE = '5545988139336'
const NOME = 'Elder'
const LINK_MSG =
  `${NOME}, pra finalizar a ativação da AIVA na sua loja, é só completar o cadastro da CAF (documentação do sócio) neste link:\n\n` +
  `https://retail-onboarding-hub.vercel.app/\n\n` +
  `São poucos passos e leva uns 5 minutinhos. Qualquer dúvida durante o preenchimento, pode me chamar aqui. 🚀`

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: QUEUE_API_KEY, ...body }),
  })
  return { status: res.status, body: await res.text() }
}

// 1. Template
const t = await post('/int/sendWaTemplate', {
  number: TELEFONE,
  templateId: TEMPLATE_ID,
  data: [NOME],
  openNewChat: true,
})
console.log(`Template → HTTP ${t.status}: ${t.body}`)

// 2. Texto livre com link CAF (espera 2s pra garantir ordem)
await new Promise(r => setTimeout(r, 2000))

const chatRes = await post('/int/getClientOpenChats', { number: TELEFONE })
const chatId = JSON.parse(chatRes.body).chats?.[0]?.chatId
console.log(`chatId aberto: ${chatId}`)

if (chatId) {
  const m = await post('/int/sendMessageToChat', { chatId, text: LINK_MSG })
  console.log(`Link CAF → HTTP ${m.status}: ${m.body}`)
} else {
  const o = await post('/int/openChat', { number: TELEFONE, message: LINK_MSG })
  console.log(`openChat → HTTP ${o.status}: ${o.body}`)
}
