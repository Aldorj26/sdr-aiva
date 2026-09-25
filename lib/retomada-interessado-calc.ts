/**
 * Retomada do lead INTERESSADO que esfriou — parte PURA (sem rede, sem banco).
 *
 * POR QUE EXISTE (levantamento de 18/09/2026): o funil tem 1.489 leads em
 * INTERESSADO, 1.164 deles sem falar com a gente há 7 a 30 dias, e 591 já tinham
 * entregado dados. É o maior vazamento do funil — 3,5× todo o histórico de quem
 * chegou à pré-aprovação — e desde 10/09 NENHUMA automação toca neles: as rotinas
 * da etapa Interessado foram removidas pro redesenho, e a régua D+3/D+7/D+14 só
 * pega INICIO e SEM_RESPOSTA.
 *
 * DESENHO (deliberado, pra não criar outro bolsão eterno):
 *   - Só entra quem está em silêncio há SILENCIO_DIAS; conversa viva não é tocada.
 *   - DOIS toques, e acabou. Sem resposta depois disso, o lead sai da régua com
 *     [RETOM_INT_FIM] e vira decisão humana — não fica sendo cutucado pra sempre.
 *   - O texto muda conforme ele JÁ tenha dado dados ou não: quem parou no meio da
 *     coleta merece "retomo de onde paramos", não a abordagem do começo.
 *
 * Marcadores em observacoes:
 *   [RETOM_INT:n:ISO]  último toque enviado (n = 1..2)
 *   [RETOM_INT_FIM]    2 toques sem resposta — a régua parou
 */

/** Dias de silêncio do LOJISTA pra entrar na régua. */
export const SILENCIO_DIAS = 7

/**
 * AGUARDANDO entrou na régua em 23/09/2026 (Aldo). O auto-descarte manda o
 * INTERESSADO pra lá depois de 21 dias sem contato e, até esta data, nenhuma
 * automação olhava pra etapa — eram 992 leads, o dobro do próprio INTERESSADO.
 */
export const STATUS_RETOMADA = ['INTERESSADO', 'AGUARDANDO'] as const

/**
 * Teto de silêncio: acima disso NÃO manda. Protege a nota do número, que é o
 * mesmo do disparo.
 * ⚠️ Não é zelo abstrato: em 23/09, 917 dos 992 em AGUARDANDO já tinham levado
 * o reengajamento, 874 a reativação e 840 a novidade Flexfone das rotinas antigas.
 * Mais uma mensagem pra quem ignora a gente há 4 meses rende quase nada e é o
 * perfil que denuncia como spam — e denúncia derruba a entrega de TODO mundo,
 * inclusive do disparo novo. Na data eram 183 acima de 90 dias.
 */
export const SILENCIO_MAX_DIAS = 90

/**
 * ORÇAMENTO DIÁRIO, por etapa, gasto ao longo de VÁRIAS rodadas (Aldo 23/09/2026).
 *
 * Por que várias rodadas e não uma rodada maior: a função morre em 300s e o envio
 * real é LENTO — a rodada de teste de 23/09 mediu **6 s por envio em média, subindo
 * de 3 s até 12 s** ao longo de 10 envios. Com o corte de segurança em 240s cabem
 * ~40 envios por rodada. Os 90 que a rota tentava mandar numa rodada só já seriam
 * cortados no meio, em silêncio. Então a rota roda de hora em hora e cada rodada
 * gasta só o que SOBROU do orçamento do dia — contando o que já saiu hoje pelo
 * rótulo próprio da mensagem (RÓTULO abaixo).
 *
 * Espalhar também é melhor pro resto da operação: as respostas chegam aos poucos
 * pra VictorIA em vez de 90 de uma vez, e o número não dispara um lote concentrado.
 *
 * INTERESSADO: 60 → 150 (Aldo, "60 é muito pouco"). Com 499 elegíveis no dia,
 *   o acumulado sai em ~4 dias úteis; depois disso o orçamento sobra, porque
 *   entram ~40 novos por dia.
 * AGUARDANDO: 30 → 60 (Aldo, 23/09, mesmo dia). Continua sendo o público parecido
 *   com o da régua D+3 (já abordado 3-4 vezes pelas rotinas antigas), que rendeu
 *   0,2% — a medição de uma semana pelo rótulo segue valendo pra decidir se fica.
 *
 * ⚠️ Pra DESLIGAR uma etapa: ponha o orçamento dela em 0 aqui e faça deploy. O
 * `?max_aguardando=0` da URL só vale pra rodada MANUAL — o cron chama o caminho
 * sem parâmetro. (Estava documentado errado em 23/09 como "desliga sem deploy".)
 */
export const ORCAMENTO_DIA: Readonly<Record<'INTERESSADO' | 'AGUARDANDO', number>> = {
  INTERESSADO: 150,
  AGUARDANDO: 60,
}

/** Rótulo gravado em sdr_mensagens.template_hsm. PRÓPRIO da retomada: até 23/09
 *  ela saía como 'aiva_reativacao_48h', igual à cobrança, à biometria e a mais
 *  seis rotinas — era impossível contar quanto a retomada mandou no dia (pro
 *  orçamento) ou medir quanto ela rende (pra decidir se fica). */
export const ROTULO: Readonly<Record<'INTERESSADO' | 'AGUARDANDO', string>> = {
  INTERESSADO: 'aiva_retomada_interessado',
  AGUARDANDO: 'aiva_retomada_aguardando',
}

/** Quanto ainda cabe hoje, dado o que já saiu. Nunca negativo. */
export function restanteHoje(orcamento: number, jaEnviadosHoje: number): number {
  return Math.max(0, orcamento - Math.max(0, jaEnviadosHoje))
}
/** Espera entre o 1º e o 2º toque, contada em viradas de dia civil (BRT). */
export const DIAS_ENTRE_TOQUES = 8
export const MAX_TOQUES = 2

const DIA_MS = 24 * 60 * 60 * 1000

/** Data civil em Brasília — mesma unidade da cobrança do formulário (lição de 17/09:
 *  cron em hora fixa + múltiplo exato de 24h faz a régua escorregar um dia). */
export function diaBrt(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}
export function diasCorridos(deMs: number, ateMs: number): number {
  return Math.round((Date.parse(diaBrt(ateMs)) - Date.parse(diaBrt(deMs))) / DIA_MS)
}

/** {{2}} do HSM 48. UMA linha, sem \n e sem link (a Meta rejeita \n em variável).
 *  O corpo já abre com "Oi {nome}, tudo bem?" e fecha com "É só responder essa mensagem. 😊". */
export const MIOLOS_COM_DADOS: readonly string[] = [
  'A gente tinha começado o cadastro da sua loja na AIVA e parou no meio do caminho. Seus dados estão guardados aqui — dá pra retomar de onde paramos, sem começar do zero. Quer seguir?',
  'Passando uma última vez sobre o cadastro da sua loja na AIVA: falta pouco pra concluir e eu retomo exatamente de onde paramos. Se ainda fizer sentido pra você, me responde que eu sigo daqui.',
]
export const MIOLOS_SEM_DADOS: readonly string[] = [
  'A gente conversou sobre o crediário da AIVA pra sua loja e acabou ficando por isso mesmo. Se ainda fizer sentido, eu te explico em 2 minutos como funciona e o que precisa pra ativar. Quer que eu siga?',
  'Última vez que eu chamo por aqui sobre a AIVA: se quiser saber como fica pra sua loja, é só me responder. Se não for o momento, sem problema — não te incomodo mais.',
]

export type Marcadores = {
  toques: number
  ultimoToqueMs: number | null
  encerrado: boolean
  optout: boolean
  pausaVigente: boolean
}

export function lerMarcadores(obs: string | null | undefined, agora = Date.now()): Marcadores {
  const o = obs ?? ''
  const toque = o.match(/\[RETOM_INT:(\d+):([^\]]+)\]/)
  const pausaIso = o.match(/\[PAUSA_ATE:([^\]]+)\]/)?.[1]
  const pausa = pausaIso ? Date.parse(pausaIso) : NaN
  return {
    toques: toque ? Number(toque[1]) : 0,
    ultimoToqueMs: toque && Number.isFinite(Date.parse(toque[2])) ? Date.parse(toque[2]) : null,
    encerrado: o.includes('[RETOM_INT_FIM]'),
    optout: o.includes('[COBRANCA_FORM_OPTOUT]') || o.includes('[CONSULTORIA_OPTOUT]'),
    pausaVigente: Number.isFinite(pausa) && pausa > agora,
  }
}

export type Decisao =
  | { acao: 'enviar'; toque: number }
  | { acao: 'encerrar' }
  | { acao: 'nada'; motivo: string }

/**
 * @param diasSilencio dias desde a ÚLTIMA mensagem DO LOJISTA (não do nosso envio —
 *        senão a própria régua zeraria o contador e ela nunca avançaria).
 */
export function decidir(m: Marcadores, diasSilencio: number, agora = Date.now()): Decisao {
  if (m.optout) return { acao: 'nada', motivo: 'optout' }
  if (m.pausaVigente) return { acao: 'nada', motivo: 'pausa' }
  if (m.encerrado) return { acao: 'nada', motivo: 'encerrado' }
  if (diasSilencio < SILENCIO_DIAS) return { acao: 'nada', motivo: 'conversa_viva' }
  if (diasSilencio > SILENCIO_MAX_DIAS) return { acao: 'nada', motivo: 'frio_demais' }
  if (m.toques >= MAX_TOQUES) return { acao: 'encerrar' }
  if (m.toques > 0 && m.ultimoToqueMs != null) {
    if (diasCorridos(m.ultimoToqueMs, agora) < DIAS_ENTRE_TOQUES) return { acao: 'nada', motivo: `aguardando D+${DIAS_ENTRE_TOQUES}` }
  }
  return { acao: 'enviar', toque: m.toques + 1 }
}

export function miolo(toque: number, temDados: boolean): string {
  const lista = temDados ? MIOLOS_COM_DADOS : MIOLOS_SEM_DADOS
  return lista[Math.min(toque, lista.length) - 1]
}

/** Reescreve os marcadores da retomada sem duplicar. */
export function remontarObs(obs: string | null | undefined, patch: { toque?: number; encerrar?: boolean }, agora = new Date()): string {
  let base = (obs ?? '').trim()
  if (patch.toque != null) {
    base = `${base.replace(/\s*\[RETOM_INT:\d+:[^\]]*\]/g, '')} [RETOM_INT:${patch.toque}:${agora.toISOString()}]`.trim()
  }
  if (patch.encerrar && !base.includes('[RETOM_INT_FIM]')) base = `${base} [RETOM_INT_FIM]`.trim()
  return base.trim()
}

/** O mínimo que a fila precisa saber de cada candidato. */
export type ItemFila = { status: string; dias: number; temDados: boolean }

/**
 * Monta a fila do dia com DOIS orçamentos.
 *  - INTERESSADO: quem já deu dados primeiro (25/09), e dentro disso o mais frio
 *    primeiro (ordem aprovada em 23/09), até `maxInteressado`.
 *  - AGUARDANDO: quem já deu dados primeiro, e dentro disso o MENOS frio primeiro
 *    — 22 dias de silêncio se recupera, 85 quase nunca. Até `maxAguardando`.
 * O INTERESSADO vem antes na lista porque, se a rota bater o teto de tempo, é
 * ele que precisa ter saído (é o público mais quente).
 */
export function montarFila<T extends ItemFila>(itens: T[], maxInteressado: number, maxAguardando: number): T[] {
  // 25/09 (Aldo): quem JÁ deu dados vem primeiro também no INTERESSADO. Medido nos
  // 326 envios de 23-24/09: 18% de resposta de pessoa com dados × 9% sem dados.
  // Dentro de cada grupo segue a ordem aprovada em 23/09 (mais frio primeiro).
  const interessados = itens.filter((i) => i.status === 'INTERESSADO')
    .sort((a, b) => (Number(b.temDados) - Number(a.temDados)) || (b.dias - a.dias))
  const aguardando = itens.filter((i) => i.status === 'AGUARDANDO')
    .sort((a, b) => (Number(b.temDados) - Number(a.temDados)) || (a.dias - b.dias))
  return [...interessados.slice(0, Math.max(0, maxInteressado)), ...aguardando.slice(0, Math.max(0, maxAguardando))]
}

/**
 * Resposta automática do WhatsApp Business da loja ("agradece seu contato",
 * "seja bem-vindo", menu de opções, horário de atendimento).
 *
 * POR QUE (Aldo, 25/09/2026): dos 157 que "responderam" à retomada em 23-24/09,
 * 129 eram essa mensagem automática. E um terço dos 326 destinatários NUNCA tinha
 * falado com uma pessoa — só o robô da loja respondeu ao disparo D+0, e isso bastou
 * pra virar INTERESSADO. Resposta de pessoa nesse grupo: 6% (contra 18% de quem já
 * deu dados). Mandar pra eles gasta HSM pago e é o perfil que denuncia como spam.
 *
 * ⚠️ Erra pro lado conservador: uma pessoa que escreve "em que posso ajudar?"
 * pode cair aqui. O custo disso é NÃO mandar a retomada — nunca mandar errado.
 */
export const RESPOSTA_AUTOMATICA = /agradece (o |seu )?contato|agradecemos (o |seu |sua )?(contato|mensagem)|bem[ -]?vind|como (podemos|posso) (te |lhe )?ajudar|em que (podemos|posso)|hor[aá]rio de (atendimento|funcionamento)|digite (a |o )?(op|n[uú]mero)|op[cç][aã]o desejada|mensagem autom|retornaremos|responderemos|em breve (retorn|respond|te atend)|salv[ae] nosso contato|nosso cat[aá]logo|visualizar nosso|n[aã]o foi recebida|estamos (fechad|ausent|indispon)|fora do hor[aá]rio|j[aá],? j[aá] (iremos|vamos)|um minuto e j[aá]|feliz em (t[eê]-lo|lhe ver|ter voc)|prazer (em )?(atend|ter voc)|canal de atendimento/i

export function ehRespostaAutomatica(texto: string | null | undefined): boolean {
  return RESPOSTA_AUTOMATICA.test(String(texto ?? ''))
}

/** true quando TUDO que o lojista mandou foi resposta automática (ou vazio).
 *  Sem mensagem nenhuma devolve false — esse caso já é o `nunca_falou`. */
export function soRespostaAutomatica(textos: ReadonlyArray<string | null | undefined>): boolean {
  const reais = textos.map((t) => String(t ?? '').trim()).filter(Boolean)
  return reais.length > 0 && reais.every(ehRespostaAutomatica)
}

/**
 * Nome da saudação do HSM 48 ("Oi {nome}, tudo bem?" — o texto é fixo no template,
 * então não dá pra tirar o nome).
 *
 * POR QUE (25/09/2026): 26 de 326 retomadas saíram como "Oi Jf", "Oi Hr", "Oi 3d":
 * sem nome de sócio, o primeiro nome vem do nome da LOJA, e em "JF Celulares" ele é
 * uma sigla. Quando o nome curto tem 2 caracteres ou menos, usa a sigla + a palavra
 * seguinte da loja ("Oi JF Celulares"). Se não houver palavra que ajude, cai no
 * "lojista", o mesmo fallback do resto do sistema.
 */
export function saudacaoRetomada(nomeCurto: string, nomeLoja: string | null | undefined): string {
  const sinais = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').length
  if (sinais(nomeCurto) > 2) return nomeCurto
  const palavras = String(nomeLoja ?? '').trim().split(/\s+/).filter(Boolean)
  if (palavras.length < 2 || sinais(palavras[1]) < 3) return 'lojista'
  const segunda = palavras[1] === palavras[1].toLowerCase() ? palavras[1][0].toUpperCase() + palavras[1].slice(1) : palavras[1]
  return `${palavras[0].toUpperCase()} ${segunda}`
}
