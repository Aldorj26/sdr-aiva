/** Digest de auditoria da rodada 3 do destilador (11/09) — Aldo + Nei. */
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
  `🧠 *VictorIA — rodada de aprendizado (11/09)*\n` +
  `Janela: 04/09 → hoje. 40 respostas manuais do Nei + 40 leads que avançaram de etapa, lidas uma a uma.\n\n` +
  `❌ *APRENDEU COM 2 ERROS*\n` +
  `1) _TH Multimarcas (Thiago)_ — ele mandou print da tela "Obrigado pelo interesse!" e ela cravou que o cadastro estava CONCLUÍDO com biometria e tudo. Não estava. O Nei teve que voltar e mandar ele refazer. Lição gravada: *não dar cadastro por concluído a partir de print que ela não reconhece com certeza.*\n` +
  `2) _Eliabe_ — o lojista disse "já tentei de tudo" e ela já decretou "é problema no sistema mesmo" e abriu chamado. O Nei pediu o print. Lição gravada: *pedir o print antes de concluir que a falha é da plataforma.*\n\n` +
  `✅ *APRENDEU COM 4 JOGADAS QUE DERAM CERTO*\n` +
  `• _Hospital do Celular_ — lojista travou no campo "faturamento"; ela desarmou com "o que você fatura hoje, por alto, média aproximada". Cadastro seguiu.\n` +
  `• _Cellshop_ — "e-mail do sócio: NÃO TEMOS" → "pode ser qualquer e-mail seu, Gmail, Hotmail". Destravou.\n` +
  `• _TH Multimarcas_ — "vale a pena colocar a filial?" → explicou vendas/repasses/usuários separados por loja. Ele topou.\n` +
  `• _Prime Cell_ — biometria não abriu: ela deu o roteiro (abre no celular, usa Chrome, permite a câmera) e só aciona o time se nada funcionar.\n\n` +
  `⏸️ *PENDENTE DE DECISÃO — 4 coisas que NÃO apliquei sozinho*\n` +
  `1) 🔴 *O mais importante (Jonas):* o Nei respondeu que a liberação de acesso ao painel é *toda resolvida pela UME*, por e-mail, e que a Track não destrava isso. Só que o prompt de hoje diz o contrário — que ela coleta CNPJ da matriz + Gmail e o sistema lança. E o e-mail que o Nei passou (atendimento*varejo*@ume.com.br) é diferente do que está no prompt (atendimento*ao*varejo@ume.com.br). *Qual dos dois está certo, e a Track lança ou não lança?* Com isso respondido eu corrijo o prompt na próxima rodada.\n` +
  `2) _Rodrigo_ — o Nei prometeu que o erro "não foi possível verificar os dados" normaliza *até hoje (12/09 no texto dele)*. Não gravei: prazo é zona proibida e esse já venceu. *Foi resolvido?*\n` +
  `3) _André (RS)_ — o Nei mandou procurar o *Instagram da AIVA* pro time de parcerias. Contato/canal novo nunca entra sozinho (regra que nasceu do caso JN Multimarcas). Confirmem o canal que eu documento.\n` +
  `4) _Joker Eletrônicos_ — ela venceu a objeção "trabalho com a PayJoy" dizendo que na AIVA *a aceitação é maior e os juros mais competitivos*. Funcionou, mas é afirmação sobre aprovação/juros do concorrente. *Posso ensinar isso como padrão?*\n\n` +
  `🔒 *Mais 8 jogadas boas ficaram de fora automaticamente* por travarem número que muda: 12% + D+2 (Jmcell), "aprova em 2 minutos" (Dragon Cell), "R$ 700 a R$ 2.000" (Clínica do Celular), "análise em 24h" (iHome), "aprova R$ 800" (Importech), links (Assistel, Conserto ld) e cadastro de colaboradores (Zé do celular).\n\n` +
  `🗑️ *Descartei:* 3 repetições do "não vendo parcelado ainda" (já está na fila desde 04/09), 1 biometria duplicada, 2 com data de treinamento já vencida (MSPHONE, TECHSMART), 1 antiga (Mtech, resposta de 06/08) e 1 de coleta de CNPJ.\n\n` +
  `🚫 *Prompt:* nenhuma regra alterada nesta rodada — não apareceu fato novo limpo. O item 1 acima vira regra assim que vocês responderem.\n\n` +
  `👀 *Padrão que apareceu 2x em 2 dias:* ela está *interpretando print* com confiança demais. Nei, se você me disser qual é a tela que realmente confirma o cadastro concluído, eu transformo isso em regra fixa em vez de exemplo.\n\n` +
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
