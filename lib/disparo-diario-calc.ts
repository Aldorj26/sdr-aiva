/**
 * lib/disparo-diario-calc.ts — decisão PURA do disparo D+0 diário da AIVA.
 *
 * Até aqui o lote de 500 saía só com o PC do Aldo ligado e um script rodado na
 * mão. O cron da Vercel passa a chamar a rota de hora em hora e CADA rodada pergunta
 * aqui: "o que faço agora?". Sem IO — a rota lê o estado (pausa, quanto saiu hoje,
 * fila, entrega da Meta) e executa a decisão.
 *
 * Ordem das guardas (os testes fixam): fim de semana → feriado → janela → pausado →
 * fatia ocupada → entrega em alerta → orçamento → fila.
 *
 * A pausa NÃO expira na virada do dia: "só volta quando alguém destravar" (Aldo).
 * Pausa que se limpa à meia-noite seria retomada automática com outro nome.
 */
import { PISO_TAXA, pct } from './entrega-meta-calc.ts'
import { ehFeriado } from './business-time.ts'
import { diaBrt } from './retomada-interessado-calc.ts'

export const TETO_DIA = 500
export const ROTULO = 'aiva_campanha'
/** Janela em horas BRT: roda de `de` (inclusive) até `ate` (exclusive). */
export const JANELA = { de: 8, ate: 19 }
/** A função morre em 300s; parar aos 240s deixa folga pra gravar o log. */
export const TETO_TEMPO_MS = 240_000
export const LOTE = 5

/** Mesma forma do veredito de `lib/entrega-meta-calc.ts`, achatada pra rota. */
export type Entrega = {
  estado: 'ok' | 'alerta' | 'sem_dados'
  taxa: number | null
  amostra: number
  entregues: number
  motivo: string
}

export type Decisao =
  | { acao: 'disparar'; quantidade: number }
  | { acao: 'pausar'; motivo: string }
  | { acao: 'nada'; motivo: MotivoBarato | 'orcamento_gasto' | 'fila_vazia' }

/** Os motivos de `nada` que se decidem SEM consultar nada além do relógio, da pausa e do lock. */
export type MotivoBarato = 'fim_de_semana' | 'feriado' | 'fora_da_janela' | 'pausado' | 'fatia_ocupada'

/** O que `resumoDoDia()` devolve e `textoResumoDia` formata. */
export type Resumo = {
  saiuHoje: number
  restante: number
  filaPendente: number
  pausado: boolean
  entrega: Entrega
}

/** Hora (0-23) e dia da semana no fuso de São Paulo.
 *  ⚠️ Via Intl, nunca `TZ=`: no Git Bash `TZ=America/Sao_Paulo` devolve UTC. */
function relogioBrt(ms: number): { hora: number; minuto: number; diaSemana: string } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date(ms))
  const pega = (t: string) => partes.find(p => p.type === t)?.value ?? ''
  return { hora: Number(pega('hour')), minuto: Number(pega('minute')), diaSemana: pega('weekday') }
}

/** Chave do lock de fatia: `disparo:<YYYY-MM-DD>T<HH>:<fatia>` com dia e hora em BRT e
 *  `fatia = floor(minuto / 20)`. O cron roda em :07/:27/:47 (uma rodada por fatia de 20 min:
 *  :07 e :19 → 0, :27 → 1, :47 → 2); duas rodadas na mesma fatia geram a MESMA chave.
 *  ⚠️ Acoplado ao cron de vercel.json, como `ehUltimaRodada`. */
export function chaveDaFatia(agoraMs: number): string {
  const { hora, minuto } = relogioBrt(agoraMs)
  return `disparo:${diaBrt(agoraMs)}T${String(hora).padStart(2, '0')}:${Math.floor(minuto / 20)}`
}

/** As cinco guardas BARATAS, na ordem: fim de semana → feriado → janela → pausado → fatia ocupada.
 *  Devolve o primeiro motivo que pega, ou `null`. Pura e sem custo: o IO chama ANTES de contar
 *  o dia e de medir a entrega (Evo, ~20 s), pra rodada que não vai fazer nada não pagar por isso.
 *  `decidirRodada` chama a mesma função, então a ordem existe num lugar só. */
export function guardaBarata(e: { agoraMs: number; pausado: boolean; fatiaOcupada?: boolean }): MotivoBarato | null {
  const { hora, diaSemana } = relogioBrt(e.agoraMs)
  if (diaSemana === 'Sat' || diaSemana === 'Sun') return 'fim_de_semana'
  if (ehFeriado(diaBrt(e.agoraMs))) return 'feriado'
  if (hora < JANELA.de || hora >= JANELA.ate) return 'fora_da_janela'
  if (e.pausado) return 'pausado'
  // Antes do alerta e do orçamento: rodada duplicada (entrega dupla do cron, curl manual durante
  // o cron) não pode pausar de novo nem mandar as mesmas lojas outra vez. Depois de `pausado`
  // porque "pausado" é o motivo que o operador precisa ver.
  if (e.fatiaOcupada) return 'fatia_ocupada'
  return null
}

export function decidirRodada(e: {
  agoraMs: number
  pausado: boolean
  jaSaiuHoje: number
  filaPendente: number
  entrega: Entrega
  /** Outra rodada já reservou esta fatia de 20 min (ver `chaveDaFatia`). Omitido = livre. */
  fatiaOcupada?: boolean
}): Decisao {
  const barata = guardaBarata(e)
  if (barata) return { acao: 'nada', motivo: barata }
  // sem_dados NÃO bloqueia: de manhã não há envio do dia pra medir, e Evo fora
  // do ar não é prova de bloqueio da Meta. Só o alerta (taxa abaixo do piso) pausa.
  if (e.entrega.estado === 'alerta') {
    return { acao: 'pausar', motivo: diagnosticoDaPausa(e.entrega) }
  }
  const orcamento = TETO_DIA - e.jaSaiuHoje
  if (orcamento <= 0) return { acao: 'nada', motivo: 'orcamento_gasto' }
  if (e.filaPendente <= 0) return { acao: 'nada', motivo: 'fila_vazia' }
  return { acao: 'disparar', quantidade: Math.min(orcamento, e.filaPendente) }
}

/** A linha de diagnóstico da pausa — FONTE ÚNICA do `motivo` gravado em `sdr_disparo_estado`
 *  e do texto do alerta. Parte de `entrega.motivo`, que já diz qual dos dois gatilhos disparou:
 *  "3 de 25 entregues (12%)" (dia abaixo do piso) ou "31 de 40 entregues (78%) no dia, MAS os 10
 *  envios mais recentes: NENHUM entregue" (parou agora). O piso só entra quando o DIA está
 *  abaixo dele; "78% — piso é 30%" parecia bug e convidava a um /retomar reflexo. */
export function diagnosticoDaPausa(entrega: Entrega): string {
  const abaixoDoPiso = entrega.taxa != null && entrega.taxa < PISO_TAXA
  return abaixoDoPiso ? `${entrega.motivo} — piso é ${pct(PISO_TAXA)}.` : `${entrega.motivo}.`
}

/** Começo da amostra de entrega: o MAIOR entre a meia-noite BRT de hoje e o `/retomar` de hoje.
 *  Sem isso, depois do /retomar a rodada seguinte mede as MESMAS mensagens da manhã (nenhum D+0
 *  novo saiu durante a pausa), dá alerta de novo e re-pausa em 20 min — com o operador já tendo
 *  pago a fatura. Retomada de dia anterior ou ilegível não encurta nada. Devolve ISO UTC. */
export function inicioEfetivoDaAmostra(agoraMs: number, retomadoEm: string | null): string {
  const brt = new Date(agoraMs - 3 * 3_600_000)
  const inicioDia = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()) + 3 * 3_600_000
  const retomadoMs = retomadoEm ? Date.parse(retomadoEm) : NaN
  return new Date(Number.isFinite(retomadoMs) && retomadoMs > inicioDia ? retomadoMs : inicioDia).toISOString()
}

/** O aviso que sai na hora, pra Aldo e Nei, quando a rodada pausa.
 *  A fatura vem primeiro DE PROPÓSITO: no apagão de 21/09 a investigação levou horas
 *  olhando qualidade, status e modelos (tudo verde) enquanto a causa era cobrança recusada. */
export function textoPausa(entrega: Entrega, jaSaiuHoje: number): string {
  return [
    '🛑 Disparo AIVA pausado',
    `Entrega: ${diagnosticoDaPausa(entrega)}`,
    `Saíram ${jaSaiuHoje} de ${TETO_DIA} hoje. Não vou disparar mais até alguém destravar.`,
    '',
    'Primeiro: confira a fatura da Meta (foi isso em 21/09).',
    'Depois, responda /retomar aqui.',
  ].join('\n')
}

/** A última rodada do dia manda o resumo. ⚠️ Acoplado ao minuto do cron em vercel.json
 *  (`7,27,47 11-21 * * 1-5` = 8h07…18h47 BRT): são 3 rodadas na hora das 18h, e só a das
 *  18h47 (minuto ≥ 40) é a última. Mudar os minutos do cron exige mudar este corte. */
export function ehUltimaRodada(agoraMs: number): boolean {
  const { hora, minuto } = relogioBrt(agoraMs)
  return hora === JANELA.ate - 1 && minuto >= 40
}

export function textoResumoDia(r: Resumo): string {
  const medida = r.entrega.taxa == null
    ? 'Entrega do dia: sem medida confiável ainda.'
    : `Entrega do dia: ${pct(r.entrega.taxa)} (${r.entrega.entregues} de ${r.entrega.amostra} confirmados).`
  return [
    `📊 Disparo AIVA — resumo do dia${r.pausado ? ' (PAUSADO)' : ''}`,
    `Saíram ${r.saiuHoje} de ${TETO_DIA}. Restam ${r.restante} no orçamento de hoje.`,
    `Fila: ${r.filaPendente} pendentes.`,
    medida,
  ].join('\n')
}

/** "12/10 às 11:32" em Brasília. Via Intl (nunca `TZ=`). Vazio/ilegível → "data desconhecida". */
function quandoBrt(iso: string | null): string {
  const ms = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(ms)) return 'data desconhecida'
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const pega = (t: string) => partes.find(p => p.type === t)?.value ?? ''
  return `${pega('day')}/${pega('month')} às ${pega('hour')}:${pega('minute')}`
}

/** Resposta do `/disparo`: onde o dia está e se o robô está solto ou travado. */
export function textoStatusDisparo(r: Resumo & { pausado_em: string | null; motivo: string | null }): string {
  const medida = r.entrega.taxa == null
    ? 'Entrega: ainda não dá pra medir (sem envio confirmado hoje).'
    : `Entrega: ${pct(r.entrega.taxa)} (${r.entrega.entregues} de ${r.entrega.amostra} confirmados).`
  const linhas = [
    r.pausado ? '🛑 Disparo AIVA — PAUSADO' : '✅ Disparo AIVA — ativo',
    `Saíram ${r.saiuHoje} de ${TETO_DIA} hoje. Restam ${r.restante}.`,
    `Fila: ${r.filaPendente} pendentes.`,
    medida,
  ]
  if (r.pausado) {
    linhas.push(`Pausado desde ${quandoBrt(r.pausado_em)}${r.motivo ? ` — ${r.motivo}` : ''}.`)
    linhas.push('Pra voltar a disparar: /retomar')
  }
  return linhas.join('\n')
}

/** `/pausar` quando acabou de pausar. */
export function textoPausadoAgora(): string {
  return [
    '🛑 Disparo AIVA pausado.',
    'Nenhuma rodada vai disparar até alguém responder /retomar.',
  ].join('\n')
}

/** `/pausar` repetido: já estava pausado, então diz o estado real em vez de fingir que pausou agora. */
export function textoJaPausado(e: { pausado_em: string | null; motivo: string | null }): string {
  return [
    '🛑 O disparo já estava pausado — nada mudou.',
    `Desde ${quandoBrt(e.pausado_em)}${e.motivo ? `: ${e.motivo}` : ''}.`,
    'Pra voltar a disparar: /retomar',
  ].join('\n')
}

/** `/retomar`: `estavaPausado` é o retorno de `retomar()`. Repetir o comando cai no `false`. */
export function textoRetomado(estavaPausado: boolean): string {
  return estavaPausado
    ? ['▶️ Disparo AIVA retomado.', 'A próxima rodada agendada volta a disparar.'].join('\n')
    : ['O disparo não estava pausado — nada a retomar.', 'Pra ver o dia: /disparo'].join('\n')
}

/** Evo fora do ar: não dá pra medir, e isso não é bloqueio da Meta → não pausa. */
export function entregaIndisponivel(): Entrega {
  return { estado: 'sem_dados', taxa: null, amostra: 0, entregues: 0, motivo: 'Evo indisponível — entrega não medida' }
}

/** O que o `send-initial` devolve por telefone. */
export type ResultadoEnvio = { telefone: string; ok: boolean; erro?: string }
export type Marca = { id: string; status: 'DISPARADO' | 'DUPLICADO' | 'ERRO' | 'PENDENTE'; detalhe: string | null }

/** Cruza o lote enviado com a resposta do `send-initial` e diz como marcar a fila.
 *  Lead SEM linha na resposta (lote que estourou o tempo, HTTP 5xx, timeout) fica
 *  PENDENTE de propósito: a próxima rodada reprocessa. Se na verdade a mensagem
 *  saiu, o `send-initial` recusa o lead já existente — duplicata não passa. */
export function marcarResultados(lote: Array<{ id: string; telefone: string }>, resultados: ResultadoEnvio[]): Marca[] {
  return lote.map((l): Marca => {
    const r = resultados.find(x => x.telefone === l.telefone)
    if (!r) return { id: l.id, status: 'PENDENTE', detalhe: null }
    if (r.ok) return { id: l.id, status: 'DISPARADO', detalhe: null }
    // `bloqueado_*` = o send-initial recusou porque o telefone JÁ está na base. É também o
    // caminho de recuperação do lote abortado (a mensagem saiu, a resposta se perdeu): o
    // lead não é falha, é DUPLICADO — o mesmo status de scripts/disparar-fila.mjs.
    if (r.erro?.startsWith('bloqueado_')) return { id: l.id, status: 'DUPLICADO', detalhe: r.erro }
    return { id: l.id, status: 'ERRO', detalhe: r.erro ?? 'erro sem detalhe' }
  })
}
