/** Digest de auditoria da rodada 4 do destilador (18/09) — Aldo + Nei. */
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
  `🧠 *VictorIA — rodada de aprendizado (18/09)*\n` +
  `Janela: 11/09 → hoje. 55 mensagens manuais do Nei + 40 leads que avançaram de etapa, lidas uma a uma. Nenhuma mensagem foi disparada pra lojista — rodada é só aprendizado.\n\n` +
  `🔧 *MUDEI UMA REGRA DO PROMPT (a primeira em 4 rodadas)*\n` +
  `A tela *"Obrigado pelo interesse!"* do link de cadastro NÃO é a tela de conclusão — ela aparece logo no começo, depois do botão "Enviar Interesse". A VictorIA vinha lendo o print dela como "cadastro concluído".\n` +
  `Aconteceu de novo em 11/09 com a _HS Imports_: ela cravou "você concluiu o cadastro completo", o lojista insistiu, ela repetiu — e 12 minutos depois o Nei entrou na mão: _"seu cadastro está aprovado, só falta finalizar a biometria"_. É o mesmo erro do TH Multimarcas, que eu já tinha gravado como exemplo em 11/09. Exemplo repetido não resolveu, então virou *regra fixa*: print dessa tela não confirma nada, ela orienta a refazer até o fim e aciona o time se ele disser que já tentou.\n\n` +
  `🕵️ *Por que isso quase entrou torto* (vale vocês saberem)\n` +
  `O revisor automático barrou a primeira versão: em outro ponto do sistema ainda estava escrito _"ou mandar print → cadastro confirmado"_, e esse trecho é o ÚLTIMO que ela lê antes de responder — ou seja, ganharia da regra nova justamente nos lojistas que mandam esse print. Corrigi os 3 pontos, rodei o revisor de novo e só aí apliquei. *Regra nova convivendo com texto velho é pior que regra nenhuma.*\n\n` +
  `✅ *APRENDEU COM 1 JOGADA QUE DEU CERTO*\n` +
  `• _Laura Acessórios (Jhonata)_ — "se eu assistir o vídeo da pasta, o login chega?" → ela explicou que não: o vídeo adianta o aprendizado, mas o login sai em leva depois da turma ao vivo. Ele entendeu, esperou e chegou no LOGIN.\n` +
  `⚠️ Gravei esse exemplo *sem os dias* ("segunda ou quinta") e sem o link do Meet que tinham no texto original — a agenda virou dinâmica em 16/09 e exemplo com dia fixo reintroduziria o erro que a gente acabou de corrigir.\n\n` +
  `⏸️ *PENDENTE DE DECISÃO — não apliquei sozinho*\n` +
  `1) 🔴 *Nei, esse é o segundo pedido igual em 2 semanas.* Na Smarttech (14/09) você escreveu que o acesso vai pro _"e-mail de quem assinou o contrato"_ e que _"depois o processo é inserir no webchat"_. O prompt de hoje manda ela procurar o WhatsApp do *+55 21 4020-2024*. Na rodada passada foi a mesma divergência com o Jonas. Canal de contato é a única coisa que eu nunca mudo sozinho (nasceu do caso JN Multimarcas). *Qual é o caminho certo hoje — e-mail, WhatsApp, ou os dois em momentos diferentes?* Com uma frase de vocês eu fecho isso na próxima rodada.\n` +
  `2) _Prazos_ — "seu acesso vai ser enviado hoje até o final do dia" e "geralmente eles liberam todos os dias às 18h". Não gravo prazo (muda e vira promessa). Se "liberam todo dia às 18h" for estável, me confirmem que eu documento.\n` +
  `3) _Reenvio de senha_ — você mandou "estamos reenviando a senha, você precisa aceitar o telefone que envie a senha". Isso bate com a regra de senha já enviada que entrou ontem, então não mexi em nada.\n\n` +
  `🔒 *9 jogadas boas ficaram de fora automaticamente* por travarem número que muda: 12% + D+2 (Ihard, sncell, Mais Case), "aprova em 2 minutos" (iHome), "R$ 700 a R$ 2.000" (YourCase), "só Android" (Pontocel), "recebe em 2 dias" (CH Informática) e links (Conserto ld, Homix).\n\n` +
  `👀 *Uma observação pro Nei:* das suas 55 mensagens manuais na janela, a grande maioria é o *mesmo texto de cobrança de cadastro* ("falta o aceite do termo... link... 7 etapas"). Existe um robô fazendo exatamente essa cobrança desde 16/09 (D+1/D+3/D+7/D+14). Pode ser que você esteja cobrando quem o robô não pega — mas se for sobreposição, dá pra te devolver esse tempo. *Me diz se quer que eu confira lead a lead.*\n\n` +
  `_Pra reverter qualquer coisa: apague na /curadoria ou me chame aqui. A regra do prompt está no commit eb9b051._`

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
