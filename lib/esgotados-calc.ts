/**
 * Bolsão dos interessados que esgotaram a régua da retomada (22/10/2026) — parte PURA.
 * A contagem (IO) mora em lib/pipeline-briefing.ts (contarEsgotados); aqui só o texto.
 */
export type Esgotados = { total: number; comOferta: number; descartadosHoje: number }

/** Linha do briefing diário. null = contagem falhou → a linha é omitida, o briefing sai. */
export function linhaEsgotados(e: Esgotados | null): string | null {
  if (!e) return null
  return `♻️ *Esgotaram a régua: ${e.total}* (oferta enviada ${e.comOferta} · descartados hoje ${e.descartadosHoje})`
}
