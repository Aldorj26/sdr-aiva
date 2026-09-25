/**
 * lib/resposta-automatica.ts — reconhece a mensagem AUTOMÁTICA do WhatsApp Business
 * da loja ("agradece seu contato", "seja bem-vindo", menu de opções, horário de
 * atendimento). Parte PURA, usada pela retomada e pelo webhook.
 * Testes: `npm run test:auto`.
 *
 * POR QUE (Aldo, 25/09/2026): dos 157 que "responderam" à retomada em 23-24/09,
 * 129 eram essa mensagem automática. E um terço dos destinatários NUNCA tinha
 * falado com uma pessoa — só o robô da loja respondeu ao disparo D+0, e isso
 * bastou pra virar INTERESSADO. Na fila da retomada de 25/09 eram 695 assim.
 *
 * ⚠️ Erra pro lado conservador: uma pessoa que escreve "em que posso ajudar?" pode
 * cair aqui. Nos dois usos o custo disso é pequeno (a retomada não manda; o webhook
 * não promove — e promove na mensagem seguinte da pessoa).
 */
export const RESPOSTA_AUTOMATICA = /agradece (o |seu )?contato|agradecemos (o |seu |sua )?(contato|mensagem)|bem[ -]?vind|como (podemos|posso) (te |lhe )?ajudar|em que (podemos|posso)|hor[aá]rio de (atendimento|funcionamento)|digite (a |o )?(op|n[uú]mero)|op[cç][aã]o desejada|mensagem autom|retornaremos|responderemos|em breve (retorn|respond|te atend)|salv[ae] nosso contato|nosso cat[aá]logo|visualizar nosso|n[aã]o foi recebida|estamos (fechad|ausent|indispon)|fora do hor[aá]rio|j[aá],? j[aá] (iremos|vamos)|um minuto e j[aá]|feliz em (t[eê]-lo|lhe ver|ter voc)|prazer (em )?(atend|ter voc)|canal de atendimento/i

export function ehRespostaAutomatica(texto: string | null | undefined): boolean {
  return RESPOSTA_AUTOMATICA.test(String(texto ?? ''))
}

/** true quando TUDO que o lojista mandou foi resposta automática (ou vazio).
 *  Sem mensagem nenhuma devolve false — "nunca falou" é outro caso. */
export function soRespostaAutomatica(textos: ReadonlyArray<string | null | undefined>): boolean {
  const reais = textos.map((t) => String(t ?? '').trim()).filter(Boolean)
  return reais.length > 0 && reais.every(ehRespostaAutomatica)
}

/** Status de ANTES do interesse: o lead ainda não conversou com a gente. */
export const STATUS_ANTES_DO_INTERESSE: ReadonlySet<string> = new Set(['INICIO', 'SEM_RESPOSTA'])

/**
 * Webhook: a VictorIA quer promover pra INTERESSADO um lead que ainda está antes do
 * interesse, mas até agora só o robô da loja respondeu → mantém o status atual.
 *
 * A conversa segue igual: a VictorIA continua tentando chegar numa pessoa ("furar o
 * bot", com o contador de 10 tentativas que leva a BOT_DETECTADO). O que muda é só o
 * STATUS — e com ele o card no Evo, o funil, o painel e a fila da retomada, que
 * contavam como interessado quem nunca falou com a gente. Na primeira mensagem de
 * pessoa, a promoção acontece normalmente.
 *
 * Nunca segura quem já passou dados (passar dado é prova de que há uma pessoa).
 */
export function manterAntesDoInteresse(p: {
  statusAtual: string
  novoStatus: string
  textosIn: ReadonlyArray<string | null | undefined>
  temDados: boolean
}): boolean {
  if (p.novoStatus !== 'INTERESSADO') return false
  if (!STATUS_ANTES_DO_INTERESSE.has(p.statusAtual)) return false
  if (p.temDados) return false
  return soRespostaAutomatica(p.textosIn)
}
