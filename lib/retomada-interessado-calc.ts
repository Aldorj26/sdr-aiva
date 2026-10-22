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
 *   [RETOM_INT:n:ISO]       último toque enviado (n = 1..2)
 *   [RETOM_INT_FIM]         2 toques sem resposta — a régua parou
 *   [RETOM_INT3:ISO]        toque 3 (oferta diferente) enviado — 22/10/2026
 *   [DESCARTE_RETOMADA:ISO] descartado pela régua (mudo 60 d+ ou sem resposta à oferta)
 *
 * DEPOIS DO FIM (Aldo, 22/10/2026): em 22/10 eram 1.450 leads com [RETOM_INT_FIM] e
 * ninguém olhava pra eles. Decisão: quem é QUENTE (deu dados ou mandou 3+ mensagens)
 * leva UM terceiro toque com oferta diferente; quem está mudo há mais de 60 dias é
 * descartado (card vai pra 53). Quem levou o toque 3 e ficou 15 dias calado também.
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
 * 02/10/2026 (Aldo, raio-x do funil): a retomada rendeu mais que o disparo frio — de cada 100
 *   envios, 3,5 (AGUARDANDO) e 3,9 (INTERESSADO) leads avançaram, contra ~1,5 do disparo novo.
 *   O AGUARDANDO batia o teto de 60 TODO dia → 120. O INTERESSADO NÃO usava os 150 (33–55 em
 *   vários dias: falta elegível, não orçamento) → 200 só como folga. 320/dia cabe nas 7
 *   rodadas (~49 cada, ~340).
 *
 * ⚠️ Pra DESLIGAR uma etapa: ponha o orçamento dela em 0 aqui e faça deploy. O
 * `?max_aguardando=0` da URL só vale pra rodada MANUAL — o cron chama o caminho
 * sem parâmetro. (Estava documentado errado em 23/09 como "desliga sem deploy".)
 */
export const ORCAMENTO_DIA: Readonly<Record<'INTERESSADO' | 'AGUARDANDO' | 'OFERTA', number>> = {
  INTERESSADO: 200,
  AGUARDANDO: 120,
  /** Toque 3 (oferta). 100/dia: o bolsão de 22/10 (~700 quentes) sai em ~7 dias úteis. */
  OFERTA: 100,
}

/** Silêncio do lojista a partir do qual o lead esgotado é DESCARTADO (Aldo 22/10/2026). */
export const SILENCIO_DESCARTE_DIAS = 60
/** Dias calado depois do toque 3 pra descartar. */
export const DIAS_DESCARTE_POS_T3 = 15
/** Teto de descartes por dia: cada descarte move um card no Evo e dispara as automações da etapa 53;
 *  300/dia espalha o bolsão (223 em 22/10) e deixa margem pra reverter se algo sair errado. */
export const TETO_DESCARTE_DIA = 300

/** Quente = já deu dados OU falou de verdade (3+ mensagens). Só o quente leva o toque 3. */
export function perfilQuente(obs: string | null | undefined, mensagensIn: number): boolean {
  return (obs ?? '').includes('[DADOS_COLETADOS:') || mensagensIn >= 3
}

/** Rótulo gravado em sdr_mensagens.template_hsm. PRÓPRIO da retomada: até 23/09
 *  ela saía como 'aiva_reativacao_48h', igual à cobrança, à biometria e a mais
 *  seis rotinas — era impossível contar quanto a retomada mandou no dia (pro
 *  orçamento) ou medir quanto ela rende (pra decidir se fica). */
export const ROTULO: Readonly<Record<'INTERESSADO' | 'AGUARDANDO' | 'OFERTA', string>> = {
  INTERESSADO: 'aiva_retomada_interessado',
  AGUARDANDO: 'aiva_retomada_aguardando',
  OFERTA: 'aiva_retomada_oferta',
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

/** {{2}} do HSM 48 pro TOQUE 3 — oferta diferente (Aldo 22/10/2026): em vez de explicar de
 *  novo, convida a ver a ferramenta funcionando numa turma ao vivo da AIVA (seg/qua/sex 9h30).
 *  Não depende de fluxo novo da VictorIA. UMA linha, sem link. */
export const MIOLOS_OFERTA: Readonly<{ comDados: string; semDados: string }> = {
  comDados: 'Antes de encerrar por aqui, uma proposta diferente: a AIVA faz turmas ao vivo seg, qua e sex às 9h30 mostrando a ferramenta funcionando numa loja de verdade. Quer que eu te mande o link da próxima pra você assistir, sem compromisso?',
  semDados: 'Antes de encerrar por aqui, uma proposta diferente: em vez de eu explicar, que tal ver a AIVA funcionando ao vivo? Tem turma seg, qua e sex às 9h30. Quer o link da próxima, sem compromisso?',
}

export type Marcadores = {
  toques: number
  ultimoToqueMs: number | null
  encerrado: boolean
  /** [RETOM_INT3:ISO] — quando saiu o toque 3; null se nunca saiu. */
  toque3Ms: number | null
  /** [DESCARTE_RETOMADA:ISO] já gravado — a régua não mexe mais. */
  descartado: boolean
  optout: boolean
  pausaVigente: boolean
}

export function lerMarcadores(obs: string | null | undefined, agora = Date.now()): Marcadores {
  const o = obs ?? ''
  const toque = o.match(/\[RETOM_INT:(\d+):([^\]]+)\]/)
  const toque3 = o.match(/\[RETOM_INT3:([^\]]+)\]/)
  const pausaIso = o.match(/\[PAUSA_ATE:([^\]]+)\]/)?.[1]
  const pausa = pausaIso ? Date.parse(pausaIso) : NaN
  return {
    toques: toque ? Number(toque[1]) : 0,
    ultimoToqueMs: toque && Number.isFinite(Date.parse(toque[2])) ? Date.parse(toque[2]) : null,
    encerrado: o.includes('[RETOM_INT_FIM]'),
    toque3Ms: toque3 && Number.isFinite(Date.parse(toque3[1])) ? Date.parse(toque3[1]) : null,
    descartado: o.includes('[DESCARTE_RETOMADA:'),
    optout: o.includes('[COBRANCA_FORM_OPTOUT]') || o.includes('[CONSULTORIA_OPTOUT]'),
    pausaVigente: Number.isFinite(pausa) && pausa > agora,
  }
}

export type Decisao =
  | { acao: 'enviar'; toque: number }
  | { acao: 'encerrar' }
  | { acao: 'descartar'; motivo: 'mudo_60d' | 'sem_resposta_oferta' }
  | { acao: 'nada'; motivo: string }

/** O que a decisão do lead ESGOTADO precisa saber além dos marcadores. */
export type Contexto = { quente: boolean; ultimaInMs: number | null }

/**
 * @param diasSilencio dias desde a ÚLTIMA mensagem DO LOJISTA (não do nosso envio —
 *        senão a própria régua zeraria o contador e ela nunca avançaria).
 * @param ctx só importa pro lead já encerrado ([RETOM_INT_FIM]): perfil quente e
 *        instante da última mensagem dele (pra saber se respondeu ao toque 3).
 */
export function decidir(m: Marcadores, diasSilencio: number, agora = Date.now(), ctx: Contexto = { quente: false, ultimaInMs: null }): Decisao {
  if (m.optout) return { acao: 'nada', motivo: 'optout' }
  if (m.pausaVigente) return { acao: 'nada', motivo: 'pausa' }
  if (m.encerrado) return decidirEsgotado(m, diasSilencio, agora, ctx)
  if (diasSilencio < SILENCIO_DIAS) return { acao: 'nada', motivo: 'conversa_viva' }
  if (diasSilencio > SILENCIO_MAX_DIAS) return { acao: 'nada', motivo: 'frio_demais' }
  if (m.toques >= MAX_TOQUES) return { acao: 'encerrar' }
  if (m.toques > 0 && m.ultimoToqueMs != null) {
    if (diasCorridos(m.ultimoToqueMs, agora) < DIAS_ENTRE_TOQUES) return { acao: 'nada', motivo: `aguardando D+${DIAS_ENTRE_TOQUES}` }
  }
  return { acao: 'enviar', toque: m.toques + 1 }
}

/**
 * Lead que já esgotou os 2 toques. Ordem: já descartado → nada; mudo 60 d+ → descarta
 * (quente ou não); já levou o toque 3 → respondeu? nada / 15 d calado? descarta / espera;
 * não quente → espera os 60 d; conversa viva → nada; D+8 do toque 2 → toque 3.
 */
function decidirEsgotado(m: Marcadores, diasSilencio: number, agora: number, ctx: Contexto): Decisao {
  if (m.descartado) return { acao: 'nada', motivo: 'descartado' }
  if (diasSilencio > SILENCIO_DESCARTE_DIAS) return { acao: 'descartar', motivo: 'mudo_60d' }
  if (m.toque3Ms != null) {
    if (ctx.ultimaInMs != null && ctx.ultimaInMs > m.toque3Ms) return { acao: 'nada', motivo: 'respondeu_oferta' }
    if (diasCorridos(m.toque3Ms, agora) >= DIAS_DESCARTE_POS_T3) return { acao: 'descartar', motivo: 'sem_resposta_oferta' }
    return { acao: 'nada', motivo: 'aguardando_oferta' }
  }
  if (!ctx.quente) return { acao: 'nada', motivo: 'esperando_60d' }
  if (diasSilencio < SILENCIO_DIAS) return { acao: 'nada', motivo: 'conversa_viva' }
  if (m.ultimoToqueMs != null && diasCorridos(m.ultimoToqueMs, agora) < DIAS_ENTRE_TOQUES) {
    return { acao: 'nada', motivo: `aguardando D+${DIAS_ENTRE_TOQUES}` }
  }
  return { acao: 'enviar', toque: 3 }
}

export function miolo(toque: number, temDados: boolean): string {
  if (toque === 3) return temDados ? MIOLOS_OFERTA.comDados : MIOLOS_OFERTA.semDados
  const lista = temDados ? MIOLOS_COM_DADOS : MIOLOS_SEM_DADOS
  return lista[Math.min(toque, lista.length) - 1]
}

/** Reescreve os marcadores da retomada sem duplicar. */
export function remontarObs(
  obs: string | null | undefined,
  patch: { toque?: number; encerrar?: boolean; toque3?: boolean; descartar?: boolean },
  agora = new Date(),
): string {
  let base = (obs ?? '').trim()
  if (patch.toque != null) {
    base = `${base.replace(/\s*\[RETOM_INT:\d+:[^\]]*\]/g, '')} [RETOM_INT:${patch.toque}:${agora.toISOString()}]`.trim()
  }
  if (patch.encerrar && !base.includes('[RETOM_INT_FIM]')) base = `${base} [RETOM_INT_FIM]`.trim()
  if (patch.toque3) {
    base = `${base.replace(/\s*\[RETOM_INT3:[^\]]*\]/g, '')} [RETOM_INT3:${agora.toISOString()}]`.trim()
  }
  if (patch.descartar && !base.includes('[DESCARTE_RETOMADA:')) base = `${base} [DESCARTE_RETOMADA:${agora.toISOString()}]`.trim()
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
export function montarFila<T extends ItemFila>(itens: T[], maxInteressado: number, maxAguardando: number, maxOferta = 0): T[] {
  // 25/09 (Aldo): quem JÁ deu dados vem primeiro também no INTERESSADO. Medido nos
  // 326 envios de 23-24/09: 18% de resposta de pessoa com dados × 9% sem dados.
  // Dentro de cada grupo segue a ordem aprovada em 23/09 (mais frio primeiro).
  const interessados = itens.filter((i) => i.status === 'INTERESSADO')
    .sort((a, b) => (Number(b.temDados) - Number(a.temDados)) || (b.dias - a.dias))
  const aguardando = itens.filter((i) => i.status === 'AGUARDANDO')
    .sort((a, b) => (Number(b.temDados) - Number(a.temDados)) || (a.dias - b.dias))
  // OFERTA (toque 3, 22/10): por último — é o público mais frio da fila; dados primeiro, depois o mais frio.
  const oferta = itens.filter((i) => i.status === 'OFERTA')
    .sort((a, b) => (Number(b.temDados) - Number(a.temDados)) || (b.dias - a.dias))
  return [
    ...interessados.slice(0, Math.max(0, maxInteressado)),
    ...aguardando.slice(0, Math.max(0, maxAguardando)),
    ...oferta.slice(0, Math.max(0, maxOferta)),
  ]
}

// Reconhecer a mensagem automática da loja mora em lib/resposta-automatica.ts desde
// 25/09 — o webhook usa a MESMA regra pra não promover robô a INTERESSADO.
export { RESPOSTA_AUTOMATICA, ehRespostaAutomatica, soRespostaAutomatica } from './resposta-automatica.ts'

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
