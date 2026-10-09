/** Digest de auditoria da rodada 7 do destilador (09/10, agendada) — Aldo + Nei. */
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
  `🧠 *VictorIA: rodada de aprendizado (09/10)*\n` +
  `Janela: 02/10 até hoje. Li 74 mensagens manuais do Nei e 40 leads que avançaram de etapa. Nenhuma mensagem foi disparada pra lojista.\n\n` +
  `✅ *APRENDEU 1 CORREÇÃO (Nei refez na mão)*\n` +
  `• _Joelcelularessm (Joel)_, loja vendendo, escreveu "pouca aprovação". Ela respondeu com 8 parágrafos, estatística de outra loja e lista numerada. O Nei refez 4h depois em 5 linhas, com uma sugestão só (oferecer benefício + pedir o CPF na abordagem). Gravei a versão curta. Tirei da correção o "geralmente aprovamos uns 30%" do Nei — número de aprovação ela não aprende sozinha.\n\n` +
  `✅ *APRENDEU 1 JOGADA QUE DEU CERTO*\n` +
  `• _Meu Celular (Ullysses)_: "vamos marcar pessoalmente". Ela disse que o atendimento é por mensagem, que a Track não faz visita, e já pediu o CNPJ. Em 11 minutos ele deu os 5 dados e foi pra pré-aprovação.\n\n` +
  `🔧 *Prompt: nada mudou nesta rodada.*\n\n` +
  `🚨 *PENDENTE DE DECISÃO*\n` +
  `1) *Biometria negada: o link NÃO reabre.* TevCell (05/10) recebeu o link de novo do Nei e "sempre aparece" a tela de concluído. Na Barba Variedades (06/10) o Nei resolveu na mão pedindo *documento com foto + selfie*. Isso responde à pergunta pro Mauricio: o aviso automático de biometria negada NÃO pode ser ligado como está (mandaria link morto). Nei, o doc + selfie é o caminho oficial da AIVA? Se for, vira regra.\n` +
  `2) *Erro "Não foi possível carregar os dados do CNPJ"* no formulário (Novacell, 06/10): a VictorIA chamou de erro do sistema e prometeu que o time destrancava; o Nei achou que é CNPJ com menos de 1 ano. Se esse erro = CNPJ novo / não consta na Receita, vale uma regra no prompt (hoje ela não enxerga o marcador do portal). Aldo decide.\n` +
  `3) _Lucas (Original Importados)_ perguntou "não foi passado valores, não sei como funciona" e ela mandou o link do cadastro em vez de explicar. O Nei retomou em 07/10 oferecendo explicar. Erro dela, mas sem texto do Nei pra ensinar — fica aqui registrado.\n\n` +
  `⚠️ *OPERACIONAL (não é aprendizado)*\n` +
  `• _Lgs Celulares (Lessandro)_: em 06/10 saiu "o Nei vai te chamar"; em 08/10 o lojista: "no mesmo lugar, o rapaz não respondeu mais". Está esperando ligação.\n` +
  `• Negrito com asterisco duplo (**assim**) saiu em 11 respostas desta semana, 9 lojas — ex. "**48 99915-5655**" pro M Tech. No WhatsApp fica asterisco solto. É raro (0,3% das respostas desde 25/09), então o certo é tratar no código (trocar ** por *), não gastar regra de prompt.\n` +
  `• _M Tech (Mateus)_ perguntou se "o número que me chamou" era de vocês; ela pediu o número e confirmou o do Nei como oficial, sem acusar ninguém. Certo.\n\n` +
  `✔️ *Sem ação:* FlexCell ("não trabalho com crédito") já tem exemplo igual na fila (Lambari, 04/09). JR Celulares e Mundo das Capas responderam certo sobre só Android / acessórios no carrinho / nota fiscal não exigida, mas o lojista não respondeu depois — sem prova de que destravou, não gravei.\n\n` +
  `⏳ *Continuam esperando resposta:* My Tech ("link não vai pros 7 passos"), pergunta de vendas pra quem pede humano, prazos do Nei, e os acessos de equipe em loja errada (digest de 02/10).\n\n` +
  `🔒 *9 jogadas boas ficaram de fora automaticamente* por fixar número ou telefone: 12% + D+2 + 6x/9x/12x (Mundo do Celular Imports, Master Cell, Perfect Cell, Mult Cell, Nask Tech, Ponto Cell, GAP informática, RPcell) e +55 21 4020-2024 (MIX.COM).\n\n` +
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
