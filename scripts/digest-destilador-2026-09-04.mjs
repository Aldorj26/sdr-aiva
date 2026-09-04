/** Digest de auditoria da rodada 2 do destilador (04/09) — Aldo + Nei. */
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
  `🧠 *VictorIA — rodada de aprendizado (04/09)*\n\n` +
  `Janela curta: a rodada 1 rodou ontem à noite, então só 14h de conversa nova. Resultado enxuto e conferido uma a uma.\n\n` +
  `✅ *APRENDEU (1 jogada vencedora na curadoria)*\n` +
  `_Lambari Imports_ — o lojista disse "ainda não temos essa opção de vender pelo boleto". Em vez de tratar como desqualificação, ela respondeu que *a AIVA seria justamente pra começar a oferecer isso*, mandou deixar o campo zerado e seguiu o cadastro. O lead fechou o cadastro na sequência.\n\n` +
  `⏸️ *PENDENTE DE DECISÃO (1 — parquei, não apliquei)*\n` +
  `_Dom Store_ — ela explicou a operação inteira (consulta em 2 min, D+2, taxa de 12%, 6/9/12x) e o lojista destravou na hora. É uma resposta ótima, mas grava *taxa e prazo* no aprendizado. Regra da casa: promessa de prazo/taxa nunca entra sozinha, porque se o número mudar a VictorIA passa a ensinar valor velho. *Quer que eu grave assim mesmo?* Me responde aqui.\n\n` +
  `🗑️ *DESCARTEI (2)*\n` +
  `_Valoriza Cell_ e _Iconnect Cell_ — o robô marcou como jogada, mas quando fui ler a conversa o avanço veio de follow-up automático e coleta padrão, não da resposta. Não vale como aprendizado.\n\n` +
  `📋 *Fonte "Enviar info" do Nei:* 2 registros no período, os dois vazios ("[Info pendente...]" sem texto). Nada a destilar — o texto útil deve ter ficado só no Evo.\n\n` +
  `🚫 *Prompt:* nenhuma regra alterada nesta rodada.\n\n` +
  `🐛 *Achado operacional (fora do aprendizado):* em 03/09 o template "(CAMPANHA) Link de Cadastro" saiu *repetido* pra 2 leads — o Iconnect Cell recebeu 4x em 2 minutos. Vale olhar o disparo da campanha.\n\n` +
  `_Pra reverter qualquer coisa: apague na /curadoria ou me chame aqui._`

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
