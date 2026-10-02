/**
 * desempenho-loja.ts — IO dos números da loja (portal da AIVA) por lead. Regras em
 * lib/desempenho-loja-calc.ts (`npm run test:desempenho`).
 * CNPJs do lead = sdr_registros_cnpj + cnpj_matriz das observações/dados coletados.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { resumir, type LinhaMes, type LinhaSemana, type Resumo } from '@/lib/desempenho-loja-calc'

const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export function mesBrt(agora = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 7)
}

/** Última semana fechada NA TABELA (cache curto — muda só às segundas). */
let cacheUlt: { v: string | null; em: number } | null = null
export async function ultimaSemanaFechada(): Promise<string | null> {
  if (cacheUlt && Date.now() - cacheUlt.em < 30 * 60_000) return cacheUlt.v
  const { data } = await supabaseAdmin.from('aiva_desempenho_semanal').select('semana').order('semana', { ascending: false }).limit(1)
  cacheUlt = { v: data?.[0]?.semana ?? null, em: Date.now() }
  return cacheUlt.v
}

export async function cnpjsDoLead(leadId: string, observacoes?: string | null, extra: (string | null | undefined)[] = []): Promise<string[]> {
  const { data } = await supabaseAdmin.from('sdr_registros_cnpj').select('cnpj').eq('lead_id', leadId)
  const doObs = (observacoes ?? '').match(/cnpj_matriz=([0-9./-]+)/)?.[1]
  return [...new Set([...(data ?? []).map((r) => dig(r.cnpj)), dig(doObs), ...extra.map(dig)].filter((c) => c.length === 14))]
}

/** Resumo de desempenho de um conjunto de CNPJs, ou null se não há semana fechada na tabela. */
export async function desempenhoPorCnpjs(cnpjs: string[], ult?: string | null): Promise<Resumo | null> {
  const semana = ult ?? (await ultimaSemanaFechada())
  if (!semana || !cnpjs.length) return null
  const desde = new Date(Date.parse(semana + 'T12:00:00Z') - 5 * 7 * 86400_000).toISOString().slice(0, 10)
  const mes = mesBrt()
  const [sem, mens] = await Promise.all([
    supabaseAdmin.from('aiva_desempenho_semanal').select('semana,aprovados,vendas,valor_vendas').in('cnpj', cnpjs).gte('semana', desde),
    supabaseAdmin.from('aiva_desempenho').select('mes,consultas,aprovados,vendas,valor_vendas').in('cnpj', cnpjs).order('mes', { ascending: false }).limit(cnpjs.length * 6),
  ])
  if (sem.error) throw new Error(`desempenho semanal: ${sem.error.message}`)
  if (mens.error) throw new Error(`desempenho mensal: ${mens.error.message}`)
  return resumir((sem.data ?? []) as LinhaSemana[], (mens.data ?? []) as LinhaMes[], semana, mes)
}

export async function desempenhoDoLead(leadId: string, observacoes?: string | null, extra: (string | null | undefined)[] = []): Promise<Resumo | null> {
  return desempenhoPorCnpjs(await cnpjsDoLead(leadId, observacoes, extra))
}
