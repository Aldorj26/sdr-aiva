/** Digest de auditoria da rodada 6 do destilador (02/10) — Aldo + Nei. */
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
  `🧠 *VictorIA: rodada de aprendizado (02/10)*\n` +
  `Janela: 25/09 até hoje. Li 17 mensagens manuais do Nei e 40 leads que avançaram de etapa. Nenhuma mensagem foi disparada pra lojista.\n\n` +
  `✅ *APRENDEU COM 2 JOGADAS QUE DERAM CERTO*\n` +
  `• _Mobile Cell (Lucas)_ perguntou: "aparece que nenhum aparelho está disponível, é reprovação?". Ela respondeu que sim, que é normal nas primeiras consultas, que é pra consultar todo cliente e que AIVA e Odres testam juntas na mesma consulta.\n` +
  `• _MF iPhones (Leonardo)_ estava com a tela branca depois do endereço no cadastro. Ela sugeriu abrir numa *aba anônima* e 8 min depois ele respondeu: "no anônima deu certo, finalizei". Tirei do exemplo a frase "registrei pro time técnico, te retorno", porque é promessa que ninguém cumpre.\n\n` +
  `🔧 *Prompt: nada mudou nesta rodada.*\n\n` +
  `🚨 *PENDENTE DE DECISÃO: acessos de equipe indo pra loja errada?*\n` +
  `Em 25/09 e 28/09 saíram pelo painel mensagens "Segue o acesso da sua equipe" com usuário, e-mail e senha Senha@123. *4 de 5 lojistas disseram que não conhecem a pessoa:*\n` +
  `• _Loja André Cell (Elisangela)_ e _ConnectPro (Caique)_ receberam o *mesmo* "Luiz Fernando Junio Lopes", cada um com um e-mail diferente, 2 vezes cada um\n` +
  `• _WC Celulares (Wellington)_: "não cadastrei nenhum Felipe"\n` +
  `• _Gold Case (Anna)_: "não reconheci esses logins" (Leticia). As funcionárias dela são outras.\n` +
  `Pode ser cadastro trocado na AIVA ou a lista que o painel montou. *Nei, confere de onde vieram esses usuários?* Login com senha caindo em loja errada é sério. A VictorIA ainda inventou causa ("provavelmente você preencheu os dados dele") e prometeu "vou acionar o time pra remover". Como mexe com colaboradores, não aprendi nada disso sozinho.\n\n` +
  `✔️ *Resolvido:* a dúvida sobre ela dizer que a AIVA tem "juros mais competitivos que a PayJoy" (pendente desde 11/09). A frase já está no prompt, na parte de diferencial vs. concorrência, então é regra aprovada e não aprendizado. Saiu da lista.\n\n` +
  `⏳ *Continuam esperando resposta:* (1) My Tech, "o link não vai pros 7 passos": Nei, o que era? (2) travar pergunta de vendas pra quem pede atendimento humano? (3) prazos do Nei ("acesso sai hoje até o fim do dia").\n\n` +
  `🔒 *7 jogadas boas ficaram de fora automaticamente* porque fixam número ou link que pode mudar: 12% + D+2 + 2 min (Infocell, Raidu, Império Cell, L.e smart, Caçula Cell), CNPJ, site e Instagram da Track contra "isso é golpe?" (Luciano Celulares) e link do onboarding (NB Celulares).\n\n` +
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
