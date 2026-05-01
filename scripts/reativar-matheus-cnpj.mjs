// Reativa conversa com Matheus (5551991780868) — janela 24h expirada.
// 1) Reenvia template (CAMPANHA) Link de Cadastro (id 15) pra reabrir a janela
// 2) Envia texto livre com o CNPJ da AIVA (que o Matheus pediu antes da janela fechar)

const BASE_URL      = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID      = 10
const QUEUE_API_KEY = '5bb6aa653e204c4f9c302b79ef783c1a'
const TEMPLATE_ID   = 15

const lead = {
  id:       '2a77a889-0fab-45cd-935c-960c15da39fc',
  nome:     'Matheus',
  telefone: '5551991780868',
  chatId:   2083,
}

// Mesmo padrão do action/route.ts → APROVACAO_TEMPLATE_VAR
const TEMPLATE_VAR =
  ', sua loja foi aprovada pela Aiva! Preencha esse seu cadastro atraves do link ' +
  'https://retail-onboarding-hub.vercel.app/onboarding/full'

const CNPJ_MSG =
  `Claro, Matheus! Compartilho aqui o CNPJ:\n\n` +
  `*Aiva Soluções em Tecnologia LTDA*\n` +
  `CNPJ: *64.438.027/0001-43*\n\n` +
  `Pode conferir e seguir tranquilo pelo link que te mandei. Qualquer dúvida no preenchimento do cadastro, pode me chamar por aqui.`

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
  console.log('[1/2] Enviando template (CAMPANHA) Link de Cadastro (id 15)...')
  const r1 = await post('/int/sendWaTemplate', {
    number:      lead.telefone,
    templateId:  TEMPLATE_ID,
    data:        [TEMPLATE_VAR],
    openNewChat: true,
  })
  console.log(`      HTTP ${r1.status}: ${r1.body}`)
  if (r1.status >= 400) {
    console.error('Template falhou, abortando antes de enviar CNPJ.')
    process.exit(1)
  }

  // 2) Aguarda o template ser entregue e sincroniza com o chat
  console.log('[...] aguardando 4s pro template sair...')
  await new Promise(r => setTimeout(r, 4000))

  // 3) Envia texto livre com o CNPJ
  console.log('[2/2] Enviando texto com CNPJ da AIVA...')
  const r2 = await post('/int/sendMessageToChat', {
    chatId: lead.chatId,
    text:   CNPJ_MSG,
  })
  console.log(`      HTTP ${r2.status}: ${r2.body}`)

  // Se sendMessageToChat falhar (chat velho), tenta abrir/buscar outro
  if (r2.status >= 400) {
    console.log('[!] sendMessageToChat falhou, tentando via getClientOpenChats...')
    const chats = await post('/int/getClientOpenChats', { number: lead.telefone })
    console.log(`      getClientOpenChats: HTTP ${chats.status}: ${chats.body}`)
    try {
      const data = JSON.parse(chats.body)
      const novoChatId = data.chats?.[0]?.chatId
      if (novoChatId && Number(novoChatId) !== lead.chatId) {
        const retry = await post('/int/sendMessageToChat', {
          chatId: Number(novoChatId),
          text:   CNPJ_MSG,
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
