/**
 * lib/saude-contas-calc.ts — "a operação parou porque alguma CONTA parou de pagar?"
 *
 * POR QUE EXISTE: em dois dias seguidos a operação parou por cobrança e nas duas
 * vezes quem descobriu foi o Aldo olhando a tela, não um alerta.
 *   21-22/09 — cartão da META recusado: a Evo respondia "success", a Meta gerava o
 *     wamid e não entregava nada (erro 131042). 415 disparos + 84 lembretes pro
 *     vazio, 24 horas sem ninguém ver.
 *   23/09 — crédito da ANTHROPIC zerado às 10h44: a VictorIA parou de responder.
 *     18 falhas, 16 lojistas receberam "estou com um volume alto de atendimentos"
 *     (mentira) e o time levou 18 alertas genéricos de "erro ao processar" que NÃO
 *     diziam a causa — por isso ninguém entendeu que era uma coisa só.
 *
 * ⚠️ LIMITE REAL, pra ninguém esperar o que não existe: **não há API que devolva o
 * saldo restante de crédito da Anthropic**. O Console mostra, a API não (pedido
 * aberto nos repositórios da Anthropic). Então aqui a gente detecta "ACABOU", não
 * "está acabando". Prevenção de verdade é a **recarga automática** ligada na
 * organização certa — código nenhum substitui isso.
 *
 * O ganho é de TEMPO e de NOME: em vez de 18 alertas dizendo "erro ao processar
 * mensagem de Fulano", UM alerta dizendo "a Anthropic está sem crédito, a VictorIA
 * parou, recarregue aqui". Erro de cobrança é diferente de erro qualquer: não
 * adianta retry, não adianta esperar, e a ação é sempre a mesma.
 */

/** O que uma falha da API significa pra quem vai agir. */
export type TipoFalha =
  | 'sem_credito'      // acabou o crédito/saldo — só recarregar resolve
  | 'credencial'       // chave inválida/revogada — trocar a chave
  | 'limite'           // rate limit / sobrecarga — passa sozinho
  | 'outro'            // defeito de verdade, investigar

/**
 * Classifica a mensagem de erro da API. Trabalha em cima do TEXTO porque é o que
 * chega no catch (o SDK embute o corpo do 400 na mensagem).
 */
export function classificarFalha(msg: unknown): TipoFalha {
  const t = String(msg ?? '').toLowerCase()
  if (/credit balance is too low|insufficient (credit|balance|funds)|billing|payment required|quota exceeded/.test(t)) return 'sem_credito'
  if (/invalid x-api-key|authentication_error|invalid api key|unauthorized|permission_error/.test(t)) return 'credencial'
  if (/rate_limit|overloaded|429|529|too many requests/.test(t)) return 'limite'
  return 'outro'
}

/** Erro que NÃO passa sozinho: insistir com retry só gasta tempo e assusta lojista. */
export const exigeAcaoHumana = (t: TipoFalha) => t === 'sem_credito' || t === 'credencial'

/**
 * Texto do alerta. Diz a causa, o efeito e o caminho — nessa ordem, porque o time
 * lê no WhatsApp entre um atendimento e outro.
 */
export function textoAlertaConta(t: TipoFalha, ctx: { erros?: number; lojistas?: number; desde?: string | null } = {}): string {
  const quanto = ctx.erros
    ? `\nJá são *${ctx.erros} mensagens* sem resposta${ctx.lojistas ? `, de ${ctx.lojistas} lojistas` : ''}${ctx.desde ? `, desde ${ctx.desde}` : ''}.`
    : ''
  if (t === 'sem_credito') {
    return (
      `🚨 *A VICTORIA PAROU — A CONTA DA ANTHROPIC ESTÁ SEM CRÉDITO*${quanto}\n\n` +
      `Cada lojista que escrever agora recebe "estou com um volume alto de atendimentos" no lugar de resposta.\n\n` +
      `*Resolver:* console.anthropic.com → Plans & Billing → comprar créditos.\n` +
      `⚠️ Confira a ORGANIZAÇÃO antes de comprar: a chave de produção é a *sdr-agent-2*, ` +
      `que fica na organização pessoal — não na "Track". Em 23/09 o crédito foi comprado na ` +
      `organização errada e a operação seguiu parada.\n\n` +
      `Assim que o crédito entrar, as mensagens perdidas são respondidas sozinhas pelo reprocessamento ` +
      `automático (até 4 tentativas por lojista).\n` +
      `⛔ Não dispare mais nada até voltar.`
    )
  }
  if (t === 'credencial') {
    return (
      `🚨 *A VICTORIA PAROU — A CHAVE DA ANTHROPIC FOI RECUSADA*${quanto}\n\n` +
      `A API respondeu que a chave é inválida ou não tem permissão. Isso não passa sozinho.\n\n` +
      `*Resolver:* console.anthropic.com → API Keys. Se a chave foi revogada, gere outra e troque ` +
      `a ANTHROPIC_API_KEY no Vercel (e no .env.local).\n` +
      `⛔ Não dispare mais nada até voltar.`
    )
  }
  return `⚠️ A API da Anthropic está recusando as chamadas (${t}).${quanto}\nSe for limite de uso, normaliza sozinho; se persistir por mais de alguns minutos, vale olhar o status da Anthropic.`
}

/** Chave de dedupe do alerta: um aviso por tipo a cada janela, não um por lojista.
 *  Foi o excesso de alerta por lead que escondeu a causa em 23/09. */
export const chaveAviso = (t: TipoFalha) => `conta_parada:${t}`
/** Janela de silêncio entre dois avisos do mesmo tipo. */
export const JANELA_AVISO_MS = 6 * 60 * 60 * 1000
