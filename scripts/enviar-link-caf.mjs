// Envia texto livre com o link da CAF (onboarding) pras lojas aprovadas
// Playcell (Carlos) e Maricell (Marilya) — complemento ao template 15 que não trouxe o link
//
// OBS: ambas as conversas têm trocas recentes (dentro da janela de 24h do WhatsApp),
// então texto livre é permitido.

const BASE_URL = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID = 10
const QUEUE_API_KEY = '5bb6aa653e204c4f9c302b79ef783c1a'

const leads = [
  {
    telefone: '5541998574000',
    loja: 'Playcell',
    mensagem:
      'Carlos, pra finalizar a ativação da AIVA na sua loja, é só completar o cadastro da CAF (documentação do sócio) neste link:\n\nhttps://retail-onboarding-hub.vercel.app/\n\nSão poucos passos e leva uns 5 minutinhos. Qualquer dúvida durante o preenchimento, pode me chamar aqui. 🚀',
  },
  {
    telefone: '5511975759781',
    loja: 'Maricell',
    mensagem:
      'Marilya, pra finalizar a ativação da AIVA nas suas 2 lojas, é só completar o cadastro da CAF (documentação da sócia) neste link:\n\nhttps://retail-onboarding-hub.vercel.app/\n\nSão poucos passos e leva uns 5 minutinhos. Qualquer dúvida durante o preenchimento, pode me chamar aqui. 🚀',
  },
]

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: QUEUE_API_KEY, ...body }),
  })
  const text = await res.text()
  return { status: res.status, body: text }
}

async function getOpenChatId(number) {
  const res = await post('/int/getClientOpenChats', { number })
  try {
    const data = JSON.parse(res.body)
    return data.chats?.[0]?.chatId ?? null
  } catch {
    return null
  }
}

for (const lead of leads) {
  try {
    const chatId = await getOpenChatId(lead.telefone)
    if (!chatId) {
      console.log(`${lead.loja} (${lead.telefone}) → sem chat aberto, tentando openChat`)
      const r = await post('/int/openChat', { number: lead.telefone, message: lead.mensagem })
      console.log(`  → HTTP ${r.status}: ${r.body}`)
      continue
    }
    const r = await post('/int/sendMessageToChat', { chatId, text: lead.mensagem })
    console.log(`${lead.loja} (${lead.telefone}) chat=${chatId} → HTTP ${r.status}: ${r.body}`)
  } catch (err) {
    console.error(`${lead.loja} (${lead.telefone}) → ERRO:`, err.message)
  }
}
