/**
 * regua-alerta.ts — leitura do alerta da AIVA (IO). Regra pura em lib/regua-alerta-calc.ts.
 *
 * GET /api/public/partner/retailers/attention (liberado pelo Maurício em 17/11/2026): devolve só os
 * varejos da Track cujo mês mais recente tem alerta — `retailer_id`, `attention_status`, `mes`.
 * Varejo sem alerta NÃO aparece. Somente leitura.
 */
import { ehAlerta, type Alerta } from '@/lib/regua-alerta-calc'

export type LinhaAlerta = { retailerId: string; alerta: Alerta; mes: string | null }

const URL_ALERTA = 'https://parceiro-aiva.lovable.app/api/public/partner/retailers/attention'
const PAGINA = 1000

/** Lê TODOS os varejos em alerta (paginado por offset). Lança se a chave faltar ou a API falhar. */
export async function listarAlertasApi(): Promise<LinhaAlerta[]> {
  const chave = process.env.AIVA_PORTAL_API_KEY
  if (!chave) throw new Error('AIVA_PORTAL_API_KEY não configurada')
  const out: LinhaAlerta[] = []
  for (let offset = 0; offset < 20_000; offset += PAGINA) {
    const res = await fetch(`${URL_ALERTA}?limit=${PAGINA}&offset=${offset}`, { headers: { 'x-api-key': chave }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`API de alertas HTTP ${res.status}`)
    const d = (await res.json()) as { items?: Array<{ retailer_id?: unknown; attention_status?: unknown; mes?: unknown }> }
    const items = d.items ?? []
    for (const i of items) {
      const rid = i.retailer_id != null ? String(i.retailer_id) : ''
      if (!rid || !ehAlerta(i.attention_status)) continue // status novo que a gente não conhece: ignora, não chuta trilha
      out.push({ retailerId: rid, alerta: i.attention_status, mes: typeof i.mes === 'string' ? i.mes : null })
    }
    if (items.length < PAGINA) break
  }
  return out
}
