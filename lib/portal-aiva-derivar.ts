/**
 * Derivações do Portal Parceiros AIVA (spec 2026-09-09) — SÓ funções puras.
 *
 * ⚠️ Sem imports (nem "@/…"): este arquivo roda direto no `node --test` com
 * type stripping, fora do bundler do Next. Tudo que toca banco/rede fica em
 * lib/portal-aiva.ts.
 *
 * Datas são strings YYYY-MM-DD e a aritmética é feita em UTC de propósito —
 * uma data de calendário não tem fuso; converter pra Date local no Windows
 * dava dia errado (lição das rotinas de follow-up).
 */

export type LinhaDiaria = {
  data_ref: string        // YYYY-MM-DD (retrato "até este dia")
  retailer_id: string
  mes: string             // YYYY-MM-01
  cnpj: string
  nome_varejo: string | null
  consultas: number       // acumulados do mês naquele dia
  aprovados: number
  vendas: number
  valor_vendas: number
  inadimplencia_aiva: number | null
  inadimplencia_odres: number | null
  foto_fora_pct: number | null
  status: string | null   // Ativo / Inativo
  cadastro_em: string | null
}

export type Metricas = { consultas: number; aprovados: number; vendas: number; valor_vendas: number }
export const ZERO: Metricas = { consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 }

const utc = (d: string) => new Date(d + 'T00:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)

export function somarDias(data: string, dias: number): string {
  const d = utc(data)
  d.setUTCDate(d.getUTCDate() + dias)
  return iso(d)
}

/** Primeiro dia do mês da data, no formato do portal (YYYY-MM-01). */
export function mesDe(data: string): string {
  return data.slice(0, 7) + '-01'
}

export function ultimoDiaDoMes(data: string): string {
  const d = utc(mesDe(data))
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return iso(d)
}

/** Dias inteiros entre duas datas (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86400e3)
}

/**
 * Acumulado do mês ("month-to-date") de uma loja até a data: o retrato mais
 * recente com data_ref <= data para aquele mês. Sem retrato = zeros (mês ainda
 * não começou, ou a loja não existia).
 */
export function mtdEm(serie: LinhaDiaria[], retailerId: string, mes: string, data: string): Metricas {
  let melhor: LinhaDiaria | null = null
  for (const l of serie) {
    if (l.retailer_id !== retailerId || l.mes !== mes || l.data_ref > data) continue
    if (!melhor || l.data_ref > melhor.data_ref) melhor = l
  }
  if (!melhor) return { ...ZERO }
  return { consultas: melhor.consultas, aprovados: melhor.aprovados, vendas: melhor.vendas, valor_vendas: Number(melhor.valor_vendas) }
}
