/**
 * Lojista que DESISTE / dá um tempo (Aldo 08/10/2026 — caso Cleyton Barbosa Informática).
 *
 * Em 09/09 a lojista disse "a gente vai dar uma seguradinha… futuramente eu entro em contato" logo
 * depois da pré-aprovação. A VictorIA respondeu bem, mas o lead seguiu no funil e levou 9 mensagens
 * automáticas de cobrança em 3 semanas. Agora a VictorIA devolve novo_status = "DESCARTADO" com
 * motivo_humano "lojista_desistiu: …" e o webhook:
 *   - grava [DESISTIU:<status em que estava>:<ISO>] e [DESCARTADO_MANUAL:<ISO>] (o mesmo carimbo do
 *     botão Descartar — é ele que impede o sync-from-evo e o /opportunity-stage de reviver o lead);
 *   - quando o lojista volta a escrever, o lead REABRE na etapa em que estava (ele disse que voltaria).
 */

export const MOTIVO_DESISTIU = 'lojista_desistiu'

export function ehDesistencia(novoStatus: string | null | undefined, motivo: string | null | undefined): boolean {
  return novoStatus === 'DESCARTADO' && String(motivo ?? '').trim().startsWith(MOTIVO_DESISTIU)
}

/** Status em que o lead estava quando desistiu — DESCARTADO/terminal não vira "volta". */
const NAO_VOLTA = new Set(['DESCARTADO', 'OPT_OUT', 'NAO_QUALIFICADO', 'BOT_DETECTADO', 'ODRES', 'UME'])

export function marcadoresDesistencia(statusAtual: string, agora: Date): string[] {
  const volta = NAO_VOLTA.has(statusAtual) ? 'INTERESSADO' : statusAtual
  const iso = agora.toISOString()
  return [`[DESISTIU:${volta}:${iso}]`, `[DESCARTADO_MANUAL:${iso}]`]
}

/** Status pra onde o lead volta, ou null se ele não foi descartado por desistência. */
export function statusDeVolta(status: string, obs: string | null | undefined): string | null {
  if (status !== 'DESCARTADO') return null
  return (obs ?? '').match(/\[DESISTIU:([A-Z_]+):[^\]]*\]/)?.[1] ?? null
}

/**
 * Lead DESCARTADO que volta a escrever (Aldo 18/11/2026: "o cliente foi descartado, voltou a falar e o Nei
 * não consegue reativar"). Antes ele era ignorado em silêncio — nem a mensagem era guardada.
 *   - 'reabrir': descarte AUTOMÁTICO (limpeza em massa, silêncio, retomada esgotada — não tem o carimbo
 *     [DESCARTADO_MANUAL]). O lojista que volta sozinho é lead quente: reabre em INTERESSADO e a VictorIA
 *     responde na hora.
 *   - 'avisar': descarte MANUAL (botão do painel). Alguém decidiu tirar esse lead: a VictorIA NÃO responde,
 *     mas a mensagem é guardada e o time é avisado pra decidir se clica em ↺ Reativar.
 *   - 'ignorar': aceno ("ok", 👍, "obrigado") ou reprocessamento interno — não é retomada.
 * Desistência ([DESISTIU]) não passa por aqui: tem regra própria (`statusDeVolta`).
 */
export type RetornoDescartado = 'reabrir' | 'avisar' | 'ignorar'
export function retornoDeDescartado(obs: string | null | undefined, ehAceno: boolean, ehReprocesso: boolean): RetornoDescartado {
  if (ehAceno || ehReprocesso) return 'ignorar'
  return (obs ?? '').includes('[DESCARTADO_MANUAL') ? 'avisar' : 'reabrir'
}
/** Marca de quem foi reaberto sozinho (uma só; a mais recente substitui). */
export function obsReabertoAuto(obs: string | null | undefined, agora: Date): string {
  const limpo = (obs ?? '').replace(/\s*\[REABERTO_AUTO:[^\]]*\]/g, '').trim()
  return `${limpo} [REABERTO_AUTO:${agora.toISOString()}]`.trim()
}

/** Tira os carimbos da desistência e deixa o rastro de que ele voltou. */
export function obsDaVolta(obs: string | null | undefined, agora: Date): string {
  const limpo = (obs ?? '').replace(/\s*\[(DESISTIU|DESCARTADO_MANUAL):[^\]]*\]/g, '').trim()
  return `${limpo} [VOLTOU_DESISTENCIA:${agora.toISOString()}]`.trim()
}
