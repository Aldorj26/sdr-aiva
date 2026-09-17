/**
 * Cobrança do formulário do varejo (portal AIVA em `dados_varejo`) — parte PURA.
 *
 * Cadência D+1, D+3, D+7, D+14 contada em VIRADAS DE DIA (fuso de Brasília) a
 * partir do dia em que o lead entrou na fila ([COBRANCA_FORM_INICIO]), um toque
 * por marco, nunca dois no mesmo dia.
 *
 * ⚠️ Por que dia civil e não múltiplo de 24h (corrigido 17/09/2026): o cron roda
 * num horário FIXO (13h BRT). Se o INICIO for carimbado 14h35 — como aconteceu
 * com os 49 primeiros, carimbados numa execução manual —, no dia seguinte às 13h
 * ainda faltam 1h35 pra fechar as 24h e o toque não sai. Como o marco seguinte
 * conta do mesmo INICIO, o atraso não se corrige: a régua vira D+2/D+4/D+8/D+15.
 * Depois do 4º toque sem o formulário preenchido, o lead vira "esgotado": o time
 * é avisado uma vez e a cobrança para (o lead NÃO vai pra fila humana).
 *
 * A cadência morre sozinha quando o portal sai de dados_varejo: quem preencheu
 * o formulário simplesmente deixa de ser elegível (o espelho move o card).
 *
 * Marcadores em observacoes:
 *   [COBRANCA_FORM_INICIO:ISO]  entrou na fila (D0)
 *   [COBRANCA_FORM:n:ISO]       último toque enviado (n = 1..4)
 *   [COBRANCA_FORM_ESGOTADO]    4 toques sem resultado
 *   [COBRANCA_FORM_ESGOTADO_AVISADO]  time já avisado
 *   [COBRANCA_FORM_OPTOUT]      nunca cobrar (manual)
 */

export const DIAS_TOQUE = [1, 3, 7, 14] as const
export const MAX_TOQUES = DIAS_TOQUE.length
const DIA_MS = 24 * 60 * 60 * 1000

/** Data civil em Brasília (AAAA-MM-DD) — a unidade da régua. */
export function diaBrt(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}
/** Quantas viradas de dia (BRT) separam os dois instantes. */
export function diasCorridos(deMs: number, ateMs: number): number {
  return Math.round((Date.parse(diaBrt(ateMs)) - Date.parse(diaBrt(deMs))) / DIA_MS)
}

// {{2}} do HSM 48 — UMA linha, sem \n, sem link (a Meta rejeita \n em variável;
// o link do onboarding a VictorIA manda na conversa quando o lojista pede).
// O corpo já abre com "Oi {nome}, tudo bem?" e fecha com "É só responder essa mensagem. 😊".
export const MIOLOS: readonly string[] = [
  'Seu cadastro na AIVA já foi aprovado e agora só falta preencher o formulário do varejo pra liberar a plataforma na sua loja. Conseguiu abrir o link que a AIVA te enviou? Se precisar, eu te mando de novo.',
  'Passando pra lembrar do formulário da AIVA: é rapidinho e é ele que libera o crediário na sua loja. Travou em algum campo ou ficou alguma dúvida? Me conta que eu te ajudo a concluir.',
  'Vi que o formulário da AIVA ainda está pendente por aí. Sem ele a loja não consegue começar a vender parcelado. Quer que eu reenvie o link? Se travou em alguma tela, me manda um print que eu te ajudo a passar.',
  'Última lembrança por aqui: o cadastro da sua loja na AIVA fica em aberto até o formulário ser preenchido. Se ainda tiver interesse, é só me responder que eu te ajudo a fechar isso em poucos minutos.',
]

export type Marcadores = {
  inicioMs: number | null
  toques: number
  ultimoToqueMs: number | null
  esgotado: boolean
  esgotadoAvisado: boolean
  optout: boolean
  pausaVigente: boolean
}

export function lerMarcadores(obs: string | null | undefined, agora = Date.now()): Marcadores {
  const o = obs ?? ''
  const ms = (re: RegExp) => { const iso = o.match(re)?.[1]; const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null }
  const toque = o.match(/\[COBRANCA_FORM:(\d+):([^\]]+)\]/)
  const pausa = ms(/\[PAUSA_ATE:([^\]]+)\]/)
  return {
    inicioMs: ms(/\[COBRANCA_FORM_INICIO:([^\]]+)\]/),
    toques: toque ? Number(toque[1]) : 0,
    ultimoToqueMs: toque ? (Number.isFinite(Date.parse(toque[2])) ? Date.parse(toque[2]) : null) : null,
    esgotado: o.includes('[COBRANCA_FORM_ESGOTADO]'),
    esgotadoAvisado: o.includes('[COBRANCA_FORM_ESGOTADO_AVISADO]'),
    optout: o.includes('[COBRANCA_FORM_OPTOUT]'),
    pausaVigente: pausa != null && pausa > agora,
  }
}

export type Decisao =
  | { acao: 'iniciar' }                       // sem INICIO ainda: carimba D0, não envia
  | { acao: 'enviar'; toque: number }          // manda o toque n (1..4)
  | { acao: 'esgotou' }                        // 4 toques feitos: marca esgotado, avisa 1×
  | { acao: 'nada'; motivo: string }

/**
 * Decide o que fazer com um lead elegível (status EM_ANALISE_AIVA + portal em
 * dados_varejo + sem bloqueios). `respondeuRecente` = mandou mensagem nas últimas 48h
 * (conversa viva: a VictorIA está cuidando, não interrompe com HSM).
 */
export function decidir(m: Marcadores, respondeuRecente: boolean, agora = Date.now()): Decisao {
  if (m.optout) return { acao: 'nada', motivo: 'optout' }
  if (m.pausaVigente) return { acao: 'nada', motivo: 'pausa' }
  if (m.esgotado) return m.esgotadoAvisado ? { acao: 'nada', motivo: 'esgotado' } : { acao: 'esgotou' }
  if (m.inicioMs == null) return { acao: 'iniciar' }
  if (m.toques >= MAX_TOQUES) return { acao: 'esgotou' }
  if (respondeuRecente) return { acao: 'nada', motivo: 'conversa_recente' }
  const dias = diasCorridos(m.inicioMs, agora)
  const proximo = m.toques + 1
  if (dias < DIAS_TOQUE[proximo - 1]) return { acao: 'nada', motivo: `aguardando D+${DIAS_TOQUE[proximo - 1]}` }
  if (m.ultimoToqueMs != null && diaBrt(m.ultimoToqueMs) === diaBrt(agora)) return { acao: 'nada', motivo: 'toque_hoje' }
  return { acao: 'enviar', toque: proximo }
}

/** Reescreve os marcadores da cobrança sem duplicar. */
export function remontarObs(obs: string | null | undefined, patch: { inicio?: boolean; toque?: number; esgotado?: boolean; esgotadoAvisado?: boolean }, agora = new Date()): string {
  let base = (obs ?? '').trim()
  const iso = agora.toISOString()
  if (patch.inicio) base = `${base.replace(/\s*\[COBRANCA_FORM_INICIO:[^\]]*\]/g, '')} [COBRANCA_FORM_INICIO:${iso}]`.trim()
  if (patch.toque != null) base = `${base.replace(/\s*\[COBRANCA_FORM:\d+:[^\]]*\]/g, '')} [COBRANCA_FORM:${patch.toque}:${iso}]`.trim()
  if (patch.esgotado && !base.includes('[COBRANCA_FORM_ESGOTADO]')) base = `${base} [COBRANCA_FORM_ESGOTADO]`
  if (patch.esgotadoAvisado && !base.includes('[COBRANCA_FORM_ESGOTADO_AVISADO]')) base = `${base} [COBRANCA_FORM_ESGOTADO_AVISADO]`
  return base.trim()
}
