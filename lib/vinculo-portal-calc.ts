/**
 * vinculo-portal-calc.ts — liga ao lead o CNPJ que o lojista usou no cadastro da AIVA quando ele
 * é DIFERENTE do que a gente tinha anotado (Aldo 05/10/2026). Parte pura; quem grava é o espelho.
 *
 * Caso que motivou: Gfourr deu o CNPJ 33.363.773 na conversa e fez o cadastro com o 61.255.811
 * (outra empresa do mesmo sócio). A AIVA criou a loja (RID 6798), ela já consultava crédito — e o
 * card seguia em Em Análise, levando cobrança de formulário, porque o espelho só enxerga CNPJ que
 * está em sdr_registros_cnpj. Mesmo defeito na Francell Celulares (RID 5488).
 * O que liga os dois é o TELEFONE do sócio no cadastro da AIVA = WhatsApp do lead.
 */

export type OnbVinculo = { cnpj: string; phone_number?: string | null; stage?: string | null; retailer_id?: string | number | null; legal_name?: string | null }
export type LeadVinculo = { id: string; telefone: string; status: string }
export type Vinculo = { leadId: string; telefone: string; cnpj: string; rid: string | null; loja: string | null }

const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const FORA = ['DESCARTADO', 'OPT_OUT', 'NAO_QUALIFICADO']

/** DDD + últimos 8 dígitos: ignora o 55 e o nono dígito, que variam entre o portal e o WhatsApp. */
export function chaveTelefone(t: unknown): string | null {
  let d = dig(t)
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length < 10 || d.length > 11 || /^0+$/.test(d)) return null
  return d.slice(0, 2) + d.slice(-8)
}

/** Todas as grafias do telefone que podem estar em sdr_leads.telefone (com 55; com e sem o 9). */
export function variantesTelefone(t: unknown): string[] {
  const k = chaveTelefone(t)
  if (!k) return []
  const ddd = k.slice(0, 2), fim = k.slice(2)
  return [`55${ddd}${fim}`, `55${ddd}9${fim}`]
}

/**
 * Só vale cadastro que ANDOU (loja criada, cadastro finalizado ou biometria): `dados_varejo` é
 * criado pelo nosso próprio pré-cadastro e não prova que o lojista usou aquele CNPJ.
 */
export function candidatos(onbs: OnbVinculo[], cnpjsRegistrados: Set<string>): OnbVinculo[] {
  return onbs.filter((o) => {
    const c = dig(o.cnpj)
    if (c.length !== 14 || cnpjsRegistrados.has(c)) return false
    if (!chaveTelefone(o.phone_number)) return false
    return !!o.retailer_id || o.stage === 'cadastro_finalizado' || o.stage === 'biometria'
  })
}

/** Telefone que casa com MAIS de um lead é ambíguo — não vincula (melhor faltar que errar a loja). */
export function vinculos(cands: OnbVinculo[], leads: LeadVinculo[]): Vinculo[] {
  const porChave = new Map<string, LeadVinculo[]>()
  for (const l of leads) {
    const k = chaveTelefone(l.telefone)
    if (k) porChave.set(k, [...(porChave.get(k) ?? []), l])
  }
  const out: Vinculo[] = []
  const vistos = new Set<string>()
  for (const o of cands) {
    const c = dig(o.cnpj)
    const achados = porChave.get(chaveTelefone(o.phone_number) ?? '') ?? []
    if (achados.length !== 1 || vistos.has(c)) continue
    const l = achados[0]
    if (FORA.includes(l.status)) continue
    vistos.add(c)
    out.push({ leadId: l.id, telefone: l.telefone, cnpj: c, rid: o.retailer_id != null ? String(o.retailer_id) : null, loja: o.legal_name ?? null })
  }
  return out
}
