// Reativa conversa com Smarting / João (5554999971709) — janela 24h expirada desde 16/04.
// 1) Reenvia template (CAMPANHA) Link de Cadastro (id 15) pra reabrir a janela
// 2) Envia texto livre reforçando a importância de concluir o cadastro no link

const BASE_URL      = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID      = 10
const QUEUE_API_KEY = '5bb6aa653e204c4f9c302b79ef783c1a'
const TEMPLATE_ID   = 15

const lead = {
  id:       'e54890e1-c3b3-4255-a964-5a729ca2d527',
  nome:     'João',
  loja:     'Smarting',
  telefone: '5554999971709',
  chatId:   2312,
}

// Mesmo padrão do action/route.ts → APROVACAO_TEMPLATE_VAR
const TEMPLATE_VAR =
  ', sua loja foi aprovada pela Aiva! Preencha esse seu cadastro atraves do link ' +
  'https://retail-onboarding-hub.vercel.app/onboarding/full'

const REFORCO_MSG =
  `João, passando pra reforçar aqui: seu cadastro da Smarting tá quase lá — ` +
  `falta só você preencher a CAF (documentação do sócio) pelo link:\n\n` +
  `https://retail-onboarding-hub.vercel.app/onboarding/full\n\n` +
  `São uns 5 minutinhos e a gente consegue liberar a AIVA nas 3 lojas de Passo Fundo. ` +
  `Assim que você concluir, a análise da Aiva sai em até 24h e a gente já agenda a ativação. ` +
  `Qualquer dúvida no preenchimento, pode me chamar por aqui mesmo que te oriento. 🚀`

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: QUEUE_API_KEY, ...body }),
  })
  const text = await res.text()
  return { status: res.status, body: text }
}

async function main() {
  // 1) Reenvia template CAF — abre janela 24h
  console.log(`[1/2] Enviando template (CAMPANHA) Link de Cadastro (id 15) pra ${lead.loja}/${lead.nome}...`)
  const r1 = await post('/int/sendWaTemplate', {
    number:      lead.telefone,
    templateId:  TEMPLATE_ID,
    data:        [TEMPLATE_VAR],
    openNewChat: true,
  })
  console.log(`      HTTP ${r1.status}: ${r1.body}`)
  if (r1.status >= 400) {
    console.error('Template falhou, abortando.')
    process.exit(1)
  }

  // 2) Aguarda processamento
  console.log('[...] aguardando 4s pro template sair...')
  await new Promise(r => setTimeout(r, 4000))

  // 3) Envia texto de reforço
  console.log('[2/2] Enviando texto de reforço...')
  let r2 = await post('/int/sendMessageToChat', {
    chatId: lead.chatId,
    text:   REFORCO_MSG,
  })
  console.log(`      HTTP ${r2.status}: ${r2.body}`)

  // Fallback: chat antigo pode estar fechado — busca chat novo aberto pelo template
  if (r2.status >= 400) {
    console.log('[!] chat antigo falhou, buscando chat novo via getClientOpenChats...')
    const chats = await post('/int/getClientOpenChats', { number: lead.telefone })
    console.log(`      getClientOpenChats: HTTP ${chats.status}: ${chats.body}`)
    try {
      const data = JSON.parse(chats.body)
      const novoChatId = data.chats?.[0]?.chatId
      if (novoChatId && Number(novoChatId) !== lead.chatId) {
        console.log(`      retry com chatId=${novoChatId}...`)
        const retry = await post('/int/sendMessageToChat', {
          chatId: Number(novoChatId),
          text:   REFORCO_MSG,
        })
        console.log(`      retry HTTP ${retry.status}: ${retry.body}`)
      }
    } catch (e) {
      console.error('      parse getClientOpenChats falhou:', e.message)
    }
  }

  console.log('\n[✓] Fluxo concluído.')
}

main().catch(err => {
  console.error('ERRO:', err)
  process.exit(1)
})
