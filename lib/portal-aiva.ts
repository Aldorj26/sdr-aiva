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
import {
  sendText, createOpportunity, updateOpportunityDescription, addOpportunityTags,
  getPipeOpportunities, PIPELINE_MRR, STAGE_MRR_INICIO, TAG_IDS,
} from '@/lib/evotalks'
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
    // função Vercel tem orçamento duro de 120s; portal travado não pode
    // consumir tudo em silêncio (revisão 09/09).
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`login do portal recusado: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const j = (await res.json()) as { access_token: string; user: { id: string } }
  return { token: j.access_token, userId: j.user.id }
}

async function rest<T>(s: Sessao, path: string, range?: [number, number]): Promise<{ data: T; total: number | null }> {
  const headers: Record<string, string> = { apikey: ANON(), Authorization: `Bearer ${s.token}`, Prefer: 'count=exact' }
  if (range) headers.Range = `${range[0]}-${range[1]}`
  // função Vercel tem orçamento duro de 120s; portal travado não pode
  // consumir tudo em silêncio (revisão 09/09).
  const res = await fetch(`${URL_PORTAL()}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(20_000) })
  // PostgREST devolve 416 quando o Range pedido começa depois da última linha —
  // é fim de paginação, não erro (revisão 09/09).
  if (res.status === 416) return { data: [] as unknown as T, total: null }
  if (!res.ok) throw new Error(`portal ${path.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
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
  if (mesMinimo != null && !/^\d{4}-\d{2}-01$/.test(mesMinimo)) throw new Error(`mesMinimo inesperado: ${JSON.stringify(mesMinimo)}`)
  // valores encodados — partnerId/mesMinimo entram na query string do PostgREST (revisão 09/09).
  const filtro = `select=*&partner_id=eq.${encodeURIComponent(partnerId)}&order=mes.desc,retailer_id.asc` + (mesMinimo ? `&mes=gte.${encodeURIComponent(mesMinimo)}` : '')
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
  const retailer_id = String(l.retailer_id)
  const mes = String(l.mes).slice(0, 10)
  if (!/^\d{4}-\d{2}-01$/.test(mes)) throw new Error(`mes inesperado do portal: ${JSON.stringify(l.mes)}`)
  // padStart em string vazia gerava "00000000000000" pra TODA loja sem CNPJ —
  // colapsava lojas diferentes numa única linha por CNPJ (revisão de código
  // 09/09). Sentinela por loja evita o merge fantasma; CNPJ maior que 14
  // dígitos é dado ruim do portal e não deve seguir silenciosamente.
  const digitos = String(l.cnpj ?? '').replace(/\D/g, '')
  let cnpj: string
  if (digitos.length === 0) cnpj = `sem-cnpj-${retailer_id}`
  else if (digitos.length > 14) throw new Error(`CNPJ inválido do portal (${digitos}) na loja ${retailer_id}`)
  else cnpj = digitos.padStart(14, '0')
  return {
    data_ref: dataRef,
    retailer_id,
    mes,
    cnpj,
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
  if (!tel) { console.error('[portal-aiva] ALDO_WHATSAPP não configurado — aviso perdido:', texto); return }
  try { await sendText(tel, texto) } catch (e) { console.error('[portal-aiva] aviso WhatsApp falhou:', e) }
}

/** Grava o retrato do dia (upsert — rodar duas vezes substitui a mesma data_ref). */
export async function gravarDiario(linhas: LinhaDiaria[], brutas: LinhaPortal[]): Promise<void> {
  const brutoPor = new Map(brutas.map((b) => [`${b.retailer_id}|${String(b.mes).slice(0, 10)}`, b]))
  const rows = linhas.map((l) => ({ ...l, bruto: brutoPor.get(`${l.retailer_id}|${l.mes}`) ?? {}, coletado_em: new Date().toISOString() }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from('aiva_portal_diario').upsert(rows.slice(i, i + 500), { onConflict: 'data_ref,retailer_id,mes' })
    if (error) throw new Error(`gravar aiva_portal_diario: ${error.message}`)
  }
}

/** Série diária de um intervalo de meses (mes >= de, mes <= ate) — dados, sem o jsonb. */
export async function lerSerie(mesDe: string, mesAte: string): Promise<LinhaDiaria[]> {
  const cols = 'data_ref,retailer_id,mes,cnpj,nome_varejo,consultas,aprovados,vendas,valor_vendas,inadimplencia_aiva,inadimplencia_odres,foto_fora_pct,status,cadastro_em'
  const tudo: LinhaDiaria[] = []
  for (let de = 0; ; de += 1000) {
    // .order() é obrigatório com .range() — sem ordenação estável a paginação do
    // PostgREST pode repetir/pular linhas entre páginas (revisão de código 09/09/2026).
    const { data, error } = await supabaseAdmin.from('aiva_portal_diario').select(cols).gte('mes', mesDe).lte('mes', mesAte)
      .order('data_ref', { ascending: true }).order('retailer_id', { ascending: true }).order('mes', { ascending: true })
      .range(de, de + 999)
    if (error) throw new Error(`ler aiva_portal_diario: ${error.message}`)
    tudo.push(...((data ?? []) as unknown as LinhaDiaria[]))
    if (!data || data.length < 1000) break
  }
  return tudo.map((l) => ({ ...l, valor_vendas: Number(l.valor_vendas) }))
}

/** retailer_id → primeiro data_ref em que apareceu (cadastro quando o portal não expõe). */
export async function primeiraAparicao(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin.rpc('assistente_sql', {
    q: `select coalesce(jsonb_agg(t), '[]'::jsonb) from (select retailer_id, min(data_ref) as primeiro from aiva_portal_diario group by retailer_id) t`,
  })
  if (error) throw new Error(`primeiraAparicao: ${error.message}`)
  return new Map(((data ?? []) as { retailer_id: string; primeiro: string }[]).map((r) => [r.retailer_id, r.primeiro]))
}

/**
 * Rederiva aiva_desempenho de um mês (YYYY-MM) a partir do último retrato.
 * Apaga e insere — mesma semântica "reimportar substitui" do importador antigo.
 */
export async function salvarMensal(mes: string, hoje = hojeBrt()): Promise<{ lojas: number; aprovados: number; vendas: number; valor: number }> {
  const mesPortal = mes + '-01'
  const mesAnt = mesDe(somarDias(mesPortal, -1))
  const serie = await lerSerie(mesAnt, mesPortal)
  const rows: LinhaMensal[] = agregarMensal(serie, mesPortal, hoje, await primeiraAparicao())
  if (!rows.length) throw new Error(`sem retrato do portal pra ${mes}`)
  const atualizado_em = new Date().toISOString()
  const del = await supabaseAdmin.from('aiva_desempenho').delete().eq('mes', mes)
  if (del.error) throw new Error(`limpar aiva_desempenho ${mes}: ${del.error.message}`)
  const ins = await supabaseAdmin.from('aiva_desempenho').insert(rows.map((r) => ({ ...r, atualizado_em })))
  if (ins.error) throw new Error(`gravar aiva_desempenho ${mes}: ${ins.error.message}`)
  return {
    lojas: rows.length,
    aprovados: rows.reduce((s, r) => s + r.aprovados, 0),
    vendas: rows.reduce((s, r) => s + r.vendas, 0),
    valor: rows.reduce((s, r) => s + r.valor_vendas, 0),
  }
}

/** Rederiva aiva_desempenho_semanal da semana (segunda YYYY-MM-DD). */
export async function salvarSemanal(segunda: string): Promise<{ lojas: number; vendas: number; avisos: string[] }> {
  if (new Date(segunda + 'T12:00:00Z').getUTCDay() !== 1) throw new Error(`${segunda} não é segunda-feira`)
  const domAnt = somarDias(segunda, -1), fim = somarDias(segunda, 7)
  const serie = (await lerSerie(mesDe(domAnt), mesDe(fim))).filter((l) => l.data_ref >= domAnt && l.data_ref <= fim)
  const { data: ant } = await supabaseAdmin.from('aiva_desempenho_semanal').select('cnpj,vendas').eq('semana', somarDias(segunda, -7))
  const vendasAnt = new Map((ant ?? []).map((r) => [r.cnpj as string, Number(r.vendas)]))
  const { linhas, avisos } = derivarSemana(serie, segunda, vendasAnt)
  const rows = linhas.map(({ consultas, ...l }: LinhaSemanal) => ({ ...l, criado_em: new Date().toISOString() }))
  const del = await supabaseAdmin.from('aiva_desempenho_semanal').delete().eq('semana', segunda)
  if (del.error) throw new Error(`limpar semanal ${segunda}: ${del.error.message}`)
  if (rows.length) {
    const ins = await supabaseAdmin.from('aiva_desempenho_semanal').insert(rows)
    if (ins.error) throw new Error(`gravar semanal ${segunda}: ${ins.error.message}`)
  }
  return { lojas: rows.length, vendas: rows.reduce((s, r) => s + r.vendas, 0), avisos }
}

/**
 * CNPJ registrado (sdr_registros_cnpj) que aparece no retrato do dia — decisão
 * do Aldo 09/09: presença no portal = contrato assinado → grava RID; status
 * Ativo = loja ativa. Ou seja:
 *   - QUALQUER CNPJ presente (Ativo OU Inativo) sem RID gravado, ou com RID
 *     diferente do atual, ganha o `rid` atualizado — é o que faz o card do
 *     lead no painel mostrar "✅ RID xxxx".
 *   - SÓ quando o status no portal é 'Ativo' rola o resto: status='ativa',
 *     `ativa_em`, conta espelho no funil 11 (dedupe por UME_RID na descrição)
 *     e linha no digest WhatsApp pro Aldo/Nei.
 * Mesma ação do `scripts/detectar-lojas-ativas.mjs` (que fica intacto como
 * rede de segurança de segunda), agora em TS e disparada todo dia pela rota.
 * Retorna as linhas do digest (só ativações); em `dry` não grava nem envia.
 */
export async function ativarLojasPresentes(retrato: LinhaDiaria[], dry: boolean): Promise<string[]> {
  // Map<cnpj, LinhaDiaria> — quando o CNPJ tem várias lojas, prefere a linha
  // Ativo (uma loja ativa "cobre" o CNPJ mesmo que outra unidade esteja Inativo).
  const porCnpj = new Map<string, LinhaDiaria>()
  for (const l of retrato) {
    const atual = porCnpj.get(l.cnpj)
    if (!atual || (atual.status !== 'Ativo' && l.status === 'Ativo')) porCnpj.set(l.cnpj, l)
  }

  const { data: pendentes, error } = await supabaseAdmin
    .from('sdr_registros_cnpj')
    .select('id,lead_id,loja,telefone,cnpj,status,rid,ativa_em')
    .neq('status', 'ativa')
  if (error) throw new Error(`sdr_registros_cnpj: ${error.message}`)
  const presentes = (pendentes ?? []).filter((r) => porCnpj.has(String(r.cnpj)))
  if (!presentes.length) return []

  const paraAtivar = presentes.filter((r) => porCnpj.get(String(r.cnpj))!.status === 'Ativo')
  // Inativo (ou outro status) mas apareceu com RID novo/ausente — só grava RID.
  const paraGravarRid = presentes.filter((r) => {
    const s = porCnpj.get(String(r.cnpj))!
    return s.status !== 'Ativo' && String(r.rid ?? '') !== s.retailer_id
  })
  if (!paraAtivar.length && !paraGravarRid.length) return []

  if (!dry) {
    for (const r of paraGravarRid) {
      const s = porCnpj.get(String(r.cnpj))!
      await supabaseAdmin.from('sdr_registros_cnpj').update({ rid: s.retailer_id }).eq('id', r.id)
    }
  }

  const opps = dry || !paraAtivar.length ? [] : await getPipeOpportunities(PIPELINE_MRR)
  const linhas: string[] = []
  for (const r of paraAtivar) {
    const s = porCnpj.get(String(r.cnpj))!
    const rid = s.retailer_id
    const fone = String(r.telefone ?? '').replace(/\D/g, '')
    if (dry) { linhas.push(`• ${r.loja} — ${s.nome_varejo ?? r.cnpj} (RID ${rid}) [dry]`); continue }

    await supabaseAdmin.from('sdr_registros_cnpj').update({ status: 'ativa', rid, ativa_em: new Date().toISOString() }).eq('id', r.id)

    const re = new RegExp(`UME_RID:\\s*${rid}\\b`)
    const dup = opps.find((o) => re.test(o.description ?? ''))
    let contaInfo: string
    if (dup) contaInfo = `conta MRR já existia (#${dup.id})`
    else {
      try {
        const id = await createOpportunity({ title: (s.nome_varejo ?? r.loja ?? 'Loja AIVA').trim(), number: fone, pipelineId: PIPELINE_MRR, stageId: STAGE_MRR_INICIO, responsableId: 507 })
        await updateOpportunityDescription(id, `UME_RID: ${rid} | CNPJ: ${r.cnpj} | Loja de ${r.loja} (ativa no portal AIVA em ${s.data_ref}) | Fone lojista: ${fone}`)
        await addOpportunityTags(id, [TAG_IDS.UME])
        // read-after-write (lição 26/08: o Evo pode responder 200 sem persistir)
        const conf = (await getPipeOpportunities(PIPELINE_MRR)).find((o) => o.id === id && re.test(o.description ?? ''))
        contaInfo = conf ? `conta MRR criada (#${id})` : `⚠️ conta #${id} criada mas descrição NÃO confirmou — conferir`
      } catch (e) {
        contaInfo = `⚠️ falha ao criar conta MRR: ${String(e).slice(0, 100)}`
      }
    }
    linhas.push(`• ${r.loja} — ${s.nome_varejo ?? r.cnpj} (RID ${rid}) → ${contaInfo}`)
  }

  if (dry) return linhas

  if (linhas.length || paraGravarRid.length) {
    const rodape = paraGravarRid.length ? `\n(+${paraGravarRid.length} lojas ganharam RID sem ativar ainda)` : ''
    const resumo = `🆕 *Lojas novas ATIVARAM no portal AIVA (${retrato[0]?.data_ref ?? hojeBrt()})*\n${linhas.join('\n') || '(nenhuma ativação nova)'}${rodape}`
    for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean) as string[]) {
      try { await sendText(tel, resumo) } catch (e) { console.error('[portal-aiva] digest de ativação falhou:', e) }
    }
  }
  return linhas
}
