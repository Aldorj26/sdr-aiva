/**
 * Bolsão dos interessados que esgotaram a régua da retomada (22/10/2026) — parte PURA.
 * A contagem (IO) mora em lib/pipeline-briefing.ts (contarEsgotados); aqui só o texto e a data.
 */
export type Esgotados = { total: number; comOferta: number; descartadosOntem: number }

/**
 * Dia UTC anterior em YYYY-MM-DD — o prefixo do marcador [DESCARTE_RETOMADA:ISO]. O briefing
 * sai às 5h BRT e a retomada só roda das 10h às 16h, então "hoje" seria sempre 0 (revisão
 * de 22/10): o número que informa é o de ONTEM.
 */
export function diaUtcAnterior(agoraMs: number): string {
  return new Date(agoraMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** Linha do briefing diário. null = contagem falhou → a linha é omitida, o briefing sai. */
export function linhaEsgotados(e: Esgotados | null): string | null {
  if (!e) return null
  return `♻️ *Esgotaram a régua: ${e.total}* (oferta enviada ${e.comOferta} · descartados ontem ${e.descartadosOntem})`
}
