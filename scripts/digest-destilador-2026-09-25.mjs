/** Digest de auditoria da rodada 5 do destilador (25/09) — Aldo + Nei. */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const BASE = env.EVO_TALKS_BASE_URL
const API_KEY = env.EVO_TALKS_QUEUE_API_KEY
const QUEUE_ID = Number(env.EVO_TALKS_QUEUE_ID)

const MSG =
  `🧠 *VictorIA — rodada de aprendizado (25/09)*\n` +
  `Janela: 18/09 → hoje. 24 mensagens manuais do Nei + 40 leads que avançaram de etapa, lidas uma a uma. Nenhuma mensagem foi disparada pra lojista.\n\n` +
  `✅ *APRENDEU COM 2 JOGADAS QUE DERAM CERTO*\n` +
  `• _moreiratech cell (Celso)_ — "meu CNPJ é MEI, tem problema?" → ela respondeu que não, o que importa é 1 ano de abertura e CNPJ ativo na Receita, e já pediu o CNPJ. Ele mandou na hora e foi pra pré-aprovação.\n` +
  `• _L a informática (Luiz Alberto)_ — "o aplicativo funciona só no meu celular? eu saio da loja" → é pelo navegador, entra de qualquer aparelho. Tirei do exemplo a frase "a biometria é feita uma vez só", porque não consegui confirmar.\n\n` +
  `🔧 *Prompt: nada mudou nesta rodada.*\n\n` +
  `⏸️ *PENDENTE DE DECISÃO — não apliquei sozinho*\n` +
  `1) *Nei, uma pergunta rápida:* na _My Tech (Willian)_, em 21/09, ele disse que o link "não vai pros 7 passos, sempre a mesma tela". A VictorIA tratou como travamento do sistema e prometeu retorno. Você escreveu _"não estava entendendo o porquê falha, mas agora encontrei"_ e mandou o link da biometria. Deu certo na hora. *O que era?* Se for padrão (tipo "o formulário já foi enviado e o link fica parado, falta só a biometria"), vira regra e ela para de chamar isso de erro do sistema.\n` +
  `2) _Lm celulares (Manoella)_, 18/09: ela estava sem acesso ao painel de repasses havia dias, pediu "tem algum atendimento humano?" e a VictorIA escalou, mas emendou "como estão as vendas essa semana?". Isso vem de uma regra do suporte (perguntar das vendas antes de dar dica) aplicada na hora errada. A correção seria texto meu, não de vocês, então não gravei. *Querem que eu trave isso no prompt* (quem reclama ou pede humano não recebe pergunta comercial na mesma mensagem)?\n` +
  `3) _Comparação com a PayJoy_: pela 2ª vez a VictorIA disse que a AIVA tem "juros mais competitivos" (C.tech cell, antes Joker). É afirmação de juros/aprovação, então não gravo. Se for verdade e puder ser dito, me confirmem.\n` +
  `4) _Prazos do Nei_ da rodada passada ("acesso sai hoje até o fim do dia", "liberam todo dia às 18h") continuam sem confirmação.\n\n` +
  `✔️ *Resolvido desde a rodada passada:* a dúvida "acesso vai por e-mail ou pelo WhatsApp 4020-2024" foi fechada em 18/09 com a separação dos dois painéis (vendas = WhatsApp, repasses = e-mail).\n\n` +
  `🔒 *7 jogadas boas ficaram de fora automaticamente* por travarem número ou link que muda: 12% + D+2 (Josécellsalvador, Bellou Cell), 6x/9x/12x (C.tech), telefone 4020-2024 (Topcell), links fixos seg/qui da agenda antiga (HS Imports) e link do onboarding (F5 TECH).\n\n` +
  `👀 *Para o time técnico:* na _Lh Tech_, em 22/09, ela respondeu *duas vezes a mesma frase* a dois "Ok" seguidos do lojista. Parece código, não prompt. Registrei aqui.\n\n` +
  `_Pra reverter: apague na /curadoria ou me chame aqui._`

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: API_KEY, ...body }),
  })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

for (const [quem, numero] of [['Aldo', env.ALDO_WHATSAPP], ['Nei', env.NEI_WHATSAPP]]) {
  try {
    const chats = await post('/int/getClientOpenChats', { number: numero }).catch(() => null)
    const chatId = chats?.chats?.[0]?.chatId ?? null
    if (chatId) await post('/int/sendMessageToChat', { chatId, text: MSG })
    else await post('/int/openChat', { number: numero, message: MSG })
    console.log(`digest enviado pro ${quem} ✓`)
  } catch (err) {
    console.error(`falha ao enviar pro ${quem}:`, err.message)
  }
}
