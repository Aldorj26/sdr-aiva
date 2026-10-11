/**
 * lib/disparo-diario-calc.ts — decisão PURA do disparo D+0 diário da AIVA.
 *
 * Até aqui o lote de 500 saía só com o PC do Aldo ligado e um script rodado na
 * mão. O cron da Vercel passa a chamar a rota de hora em hora e CADA rodada pergunta
 * aqui: "o que faço agora?". Sem IO — a rota lê o estado (pausa, quanto saiu hoje,
 * fila, entrega da Meta) e executa a decisão.
 *
 * Ordem das guardas (os testes fixam): fim de semana → janela → pausado →
 * entrega em alerta → orçamento → fila.
 *
 * A pausa NÃO expira na virada do dia: "só volta quando alguém destravar" (Aldo).
 * Pausa que se limpa à meia-noite seria retomada automática com outro nome.
 */
import { PISO_TAXA, pct } from './entrega-meta-calc.ts'

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
  | { acao: 'nada'; motivo: 'fora_da_janela' | 'fim_de_semana' | 'pausado' | 'orcamento_gasto' | 'fila_vazia' }

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

export function decidirRodada(e: {
  agoraMs: number
  pausado: boolean
  jaSaiuHoje: number
  filaPendente: number
  entrega: Entrega
}): Decisao {
  const { hora, diaSemana } = relogioBrt(e.agoraMs)
  if (diaSemana === 'Sat' || diaSemana === 'Sun') return { acao: 'nada', motivo: 'fim_de_semana' }
  if (hora < JANELA.de || hora >= JANELA.ate) return { acao: 'nada', motivo: 'fora_da_janela' }
  if (e.pausado) return { acao: 'nada', motivo: 'pausado' }
  // sem_dados NÃO bloqueia: de manhã não há envio do dia pra medir, e Evo fora
  // do ar não é prova de bloqueio da Meta. Só o alerta (taxa abaixo do piso) pausa.
  if (e.entrega.estado === 'alerta') {
    return { acao: 'pausar', motivo: `Entrega em ${pct(e.entrega.taxa ?? 0)} (${e.entrega.entregues} de ${e.entrega.amostra} confirmados) — piso é ${pct(PISO_TAXA)}.` }
  }
  const orcamento = TETO_DIA - e.jaSaiuHoje
  if (orcamento <= 0) return { acao: 'nada', motivo: 'orcamento_gasto' }
  if (e.filaPendente <= 0) return { acao: 'nada', motivo: 'fila_vazia' }
  return { acao: 'disparar', quantidade: Math.min(orcamento, e.filaPendente) }
}

/** O aviso que sai na hora, pra Aldo e Nei, quando a rodada pausa.
 *  A fatura vem primeiro DE PROPÓSITO: no apagão de 21/09 a investigação levou horas
 *  olhando qualidade, status e modelos (tudo verde) enquanto a causa era cobrança recusada. */
export function textoPausa(entrega: Entrega, jaSaiuHoje: number): string {
  return [
    '🛑 Disparo AIVA pausado',
    `Entrega em ${pct(entrega.taxa ?? 0)} (${entrega.entregues} de ${entrega.amostra} confirmados) — piso é ${pct(PISO_TAXA)}.`,
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
