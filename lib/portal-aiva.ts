/**
 * Portal Parceiros AIVA (parceiro-aiva.lovable.app) — coleta por API.
 *
 * O portal é um app Lovable com Supabase próprio; a tela "Performance" lê a
 * tabela retailer_performance via PostgREST filtrada pelo partner_id da Track.
 * Aqui fazemos o mesmo, logando com e-mail/senha (grant password) a cada
 * execução — nenhum token fica guardado. Spec: docs/superpowers/specs/2026-09-09-*.
 *
 * Substituiu o Data Studio em 09/09/2026 (coletor-funil-loja.js ficou como legado).
 */
import { supabaseAdmin } from '@/lib/supabase'
import { sendText } from '@/lib/evotalks'
import {
  agregarMensal, derivarSemana, mesDe, somarDias,
  type LinhaDiaria, type LinhaMensal, type LinhaSemanal,
} from '@/lib/portal-aiva-derivar'

const URL_PORTAL = () => (process.env.AIVA_PORTAL_URL ?? '').replace(/\/$/, '')
const ANON = () => process.env.AIVA_PORTAL_ANON_KEY ?? ''

/** Linha crua da tabela retailer_performance do portal (select=*). */
export type LinhaPortal = {
  id: string
  retailer_id: string | number
  partner_id: string
  cnpj: string | null
  retailer_name: string | null
  mes: string
  n_consultas: number | null
  n_aprovados: number | null
  n_vendas: number | null
  valor_vendas: number | string | null
  inadimplencia_aiva: number | null
  inadimplencia_odres: number | null
  out_of_store_photo_pct: number | null
  status: string | null
  [extra: string]: unknown
}

export type Sessao = { token: string; userId: string }

export async function loginPortal(): Promise<Sessao> {
  const email = process.env.AIVA_PORTAL_EMAIL, senha = process.env.AIVA_PORTAL_SENHA
  if (!URL_PORTAL() || !ANON() || !email || !senha) throw new Error('env do portal incompleta (AIVA_PORTAL_URL/ANON_KEY/EMAIL/SENHA)')
  const res = await fetch(`${URL_PORTAL()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON() },
    body: JSON.stringify({ email, password: senha }),
  })
  if (!res.ok) throw new Error(`login do portal recusado: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const j = (await res.json()) as { access_token: string; user: { id: string } }
  return { token: j.access_token, userId: j.user.id }
}

async function rest<T>(s: Sessao, path: string, range?: [number, number]): Promise<{ data: T; total: number | null }> {
  const headers: Record<string, string> = { apikey: ANON(), Authorization: `Bearer ${s.token}`, Prefer: 'count=exact' }
  if (range) headers.Range = `${range[0]}-${range[1]}`
  const res = await fetch(`${URL_PORTAL()}/rest/v1/${path}`, { headers })
  if (!res.ok && res.status !== 206) throw new Error(`portal ${path.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const cr = res.headers.get('content-range') ?? ''   // "0-999/1234"
  const total = cr.includes('/') && cr.split('/')[1] !== '*' ? Number(cr.split('/')[1]) : null
  return { data: (await res.json()) as T, total }
}

/** partner_id da Track: lê do profile do usuário logado; env como fallback. */
export async function partnerIdTrack(s: Sessao): Promise<string> {
  try {
    const { data } = await rest<{ partner_id: string | null }[]>(s, `profiles?select=partner_id&id=eq.${s.userId}`)
    if (data[0]?.partner_id) return data[0].partner_id
  } catch (e) {
    console.warn('[portal-aiva] profile indisponível, usando AIVA_PORTAL_PARTNER_ID:', e)
  }
  const env = process.env.AIVA_PORTAL_PARTNER_ID
  if (!env) throw new Error('sem partner_id: profile não devolveu e AIVA_PORTAL_PARTNER_ID vazio')
  return env
}

/**
 * Busca retailer_performance paginada (PostgREST limita em 1.000 por resposta;
 * o portal já beira isso no total). `mesMinimo` = YYYY-MM-01; null = todos.
 */
export async function buscarPerformance(s: Sessao, partnerId: string, mesMinimo: string | null): Promise<LinhaPortal[]> {
  const filtro = `select=*&partner_id=eq.${partnerId}&order=mes.desc,retailer_id.asc` + (mesMinimo ? `&mes=gte.${mesMinimo}` : '')
  const tudo: LinhaPortal[] = []
  for (let de = 0; ; de += 1000) {
    const { data, total } = await rest<LinhaPortal[]>(s, `retailer_performance?${filtro}`, [de, de + 999])
    tudo.push(...data)
    if (data.length < 1000 || (total != null && tudo.length >= total)) break
  }
  return tudo
}

/** Converte a linha do portal pro formato da nossa série diária. */
export function paraLinhaDiaria(l: LinhaPortal, dataRef: string): LinhaDiaria {
  const dataCad = typeof l.created_at === 'string' ? l.created_at.slice(0, 10)
    : typeof l.cadastro_em === 'string' ? l.cadastro_em.slice(0, 10)
    : typeof l.retailer_created_at === 'string' ? l.retailer_created_at.slice(0, 10)
    : null
  return {
    data_ref: dataRef,
    retailer_id: String(l.retailer_id),
    mes: String(l.mes).slice(0, 10),
    cnpj: String(l.cnpj ?? '').replace(/\D/g, '').padStart(14, '0'),
    nome_varejo: l.retailer_name ?? null,
    consultas: l.n_consultas ?? 0,
    aprovados: l.n_aprovados ?? 0,
    vendas: l.n_vendas ?? 0,
    valor_vendas: Number(l.valor_vendas ?? 0),
    inadimplencia_aiva: l.inadimplencia_aiva ?? null,
    inadimplencia_odres: l.inadimplencia_odres ?? null,
    foto_fora_pct: l.out_of_store_photo_pct ?? null,
    status: l.status ?? null,
    cadastro_em: dataCad,
  }
}

/** Hoje em BRT, YYYY-MM-DD. */
export function hojeBrt(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export async function avisarAldo(texto: string): Promise<void> {
  const tel = process.env.ALDO_WHATSAPP
  if (!tel) return
  try { await sendText(tel, texto) } catch (e) { console.error('[portal-aiva] aviso WhatsApp falhou:', e) }
}
