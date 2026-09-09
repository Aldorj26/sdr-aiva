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
  sendText, criarContaMrrLoja, getPipeOpportunities, PIPELINE_MRR, escaparRegex,
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
  // formato real do portal 09/09: categoria de TEXTO ("BOM"/"RUIM"), não número.
  // `inadimplencia_odres` veio 100% null até agora — assumimos o mesmo formato.
  inadimplencia_aiva: string | null
  inadimplencia_odres: string | null
  out_of_store_photo_pct: number | null   // formato real do portal 09/09: número 0–100 (33.3, 50, 100)
  status: string | null                   // formato real do portal 09/09: "active" / "inactive"
  registered_at?: string | null           // formato real do portal 09/09: data do cadastro YYYY-MM-DD (100% das linhas)
  phone_number?: string | null            // formato real do portal 09/09: "5567999278475" (100% das linhas)
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
  // Cadastro — formato real do portal 09/09: a coluna é `registered_at` (data YYYY-MM-DD,
  // presente em 100% das linhas). `cadastro_em` fica só como fallback histórico e
  // `retailer_created_at` saiu da cadeia (não existe na tabela).
  // `created_at`/`updated_at` continuam FORA de propósito: são timestamps da linha
  // (retailer_performance é regravada/atualizada com frequência), não a data de cadastro do
  // lojista — um cadastro errado alimenta `atencao` direto (classificarAtencao usa dias
  // desde o cadastro).
  const dataCad = typeof l.registered_at === 'string' ? l.registered_at.slice(0, 10)
    : typeof l.cadastro_em === 'string' ? l.cadastro_em.slice(0, 10)
    : null
  // Status — formato real do portal 09/09: a API devolve "active"/"inactive" (a UI é que
  // rotula Ativo/Inativo). Todo o resto do código compara com 'Ativo' (ativação de loja,
  // filtro do painel), então a normalização acontece AQUI, na fronteira. Valor desconhecido
  // passa cru: melhor aparecer estranho no painel do que virar "Inativo" em silêncio.
  const statusCru = (l.status == null ? '' : String(l.status).trim()) || null // '' vira null (revisão 09/09)
  const status = statusCru?.toLowerCase() === 'active' ? 'Ativo'
    : statusCru?.toLowerCase() === 'inactive' ? 'Inativo'
    : statusCru
  // Telefone — formato real do portal 09/09: "5567999278475" (100% das linhas). Só dígitos.
  const telefone = String(l.phone_number ?? '').replace(/\D/g, '') || null
  // Inadimplência — formato real do portal 09/09: categoria de TEXTO ("BOM"/"RUIM"),
  // não percentual. Normaliza caixa/espaço; qualquer coisa que não seja texto vira null.
  const inad = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : typeof v === 'number' ? String(v) : '') || null
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
    inadimplencia_aiva: inad(l.inadimplencia_aiva),
    inadimplencia_odres: inad(l.inadimplencia_odres),
    // escala 0–100 confirmada no retrato real 09/09 (33.3, 50, 100) — guardado como vem,
    // sem ×100 nem ÷100; quem exibe formata.
    foto_fora_pct: l.out_of_store_photo_pct ?? null,
    status,
    telefone,
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

/**
 * Grava o retrato do dia (upsert — rodar duas vezes substitui a mesma data_ref).
 * O `...l` carrega TODAS as colunas de LinhaDiaria, inclusive `telefone` (coluna
 * nova em aiva_portal_diario — formato real do portal 09/09).
 */
export async function gravarDiario(linhas: LinhaDiaria[], brutas: LinhaPortal[]): Promise<void> {
  const brutoPor = new Map(brutas.map((b) => [`${b.retailer_id}|${String(b.mes).slice(0, 10)}`, b]))
  const rows = linhas.map((l) => ({ ...l, bruto: brutoPor.get(`${l.retailer_id}|${l.mes}`) ?? {}, coletado_em: new Date().toISOString() }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from('aiva_portal_diario').upsert(rows.slice(i, i + 500), { onConflict: 'data_ref,retailer_id,mes' })
    if (error) throw new Error(`gravar aiva_portal_diario: ${error.message}`)
  }
}

/**
 * Série diária de um intervalo de meses (mes >= mesIni, mes <= mesFim) — dados,
 * sem o jsonb. Parâmetros renomeados: `mesDe` fazia sombra na função importada
 * de mesmo nome do derivar (revisão 09/09).
 */
export async function lerSerie(mesIni: string, mesFim: string): Promise<LinhaDiaria[]> {
  // `telefone` entra na lista (coluna nova — formato real do portal 09/09): sem ela o
  // agregado mensal perderia o telefone da loja que a série já guardou.
  const cols = 'data_ref,retailer_id,mes,cnpj,nome_varejo,consultas,aprovados,vendas,valor_vendas,inadimplencia_aiva,inadimplencia_odres,foto_fora_pct,status,telefone,cadastro_em'
  const tudo: LinhaDiaria[] = []
  for (let de = 0; ; de += 1000) {
    // .order() é obrigatório com .range() — sem ordenação estável a paginação do
    // PostgREST pode repetir/pular linhas entre páginas (revisão de código 09/09/2026).
    const { data, error } = await supabaseAdmin.from('aiva_portal_diario').select(cols).gte('mes', mesIni).lte('mes', mesFim)
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
 *
 * `primeira` é opcional: o cron roda vários meses no mesmo request e calcula o
 * mapa UMA vez antes do laço (era um agregado no banco por mês — revisão 09/09).
 * Sem ele, cada chamada calcula o seu (uso avulso / reprocesso ?mes=).
 */
export async function salvarMensal(mes: string, hoje = hojeBrt(), primeira?: Map<string, string>): Promise<{ lojas: number; aprovados: number; vendas: number; valor: number }> {
  const mesPortal = mes + '-01'
  const mesAnt = mesDe(somarDias(mesPortal, -1))
  const serie = await lerSerie(mesAnt, mesPortal)
  const rows: LinhaMensal[] = agregarMensal(serie, mesPortal, hoje, primeira ?? await primeiraAparicao())
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
  // erro aqui não pode passar batido: sem a semana anterior o delta de vendas
  // sai igual ao absoluto e a semana fecha com número errado (revisão 09/09).
  const { data: ant, error: eAnt } = await supabaseAdmin.from('aiva_desempenho_semanal').select('cnpj,vendas').eq('semana', somarDias(segunda, -7))
  if (eAnt) throw new Error(`ler semana anterior (${somarDias(segunda, -7)}): ${eAnt.message}`)
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

type RegistroCnpj = {
  id: string | number
  lead_id: string | null
  loja: string | null
  telefone: string | null
  cnpj: string | number
  status: string | null
  rid: string | null
  ativa_em: string | null
}

/**
 * CNPJ registrado (sdr_registros_cnpj) que aparece no retrato do dia — decisão
 * do Aldo 09/09: presença no portal = contrato assinado → grava RID; status
 * Ativo = loja ativa. Cada registro presente cai em UM de três baldes:
 *
 *   1. ATIVAR — registro AINDA NÃO 'ativa' no banco E status 'Ativo' no portal:
 *      conta espelho no funil 11 (dedupe por UME_RID na descrição via
 *      `criarContaMrrLoja`), depois status='ativa' + `rid` + `ativa_em`, e linha
 *      no digest WhatsApp pro Aldo/Nei. O CRM vem ANTES do banco de propósito:
 *      se a conta falhar, o registro fica como está e a ativação é tentada de
 *      novo amanhã — o inverso deixava a loja "ativa" sem conta nenhuma.
 *   2. SÓ RID — todo o resto cujo `rid` no banco difere do `retailer_id` do
 *      portal: grava APENAS `{ rid }` e reporta no rodapé 🔖. Cobre (a) quem já
 *      está 'ativa' mas sem RID (loja ativada antes da coluna existir — por isso
 *      a busca traz `rid is null`) em QUALQUER status do portal, e (b) quem
 *      ainda não ativou mas aparece Inativo no portal.
 *   3. NADA — já 'ativa' e com o mesmo RID: não toca.
 *
 * A trava do balde 1 (`status !== 'ativa'`) é o que impede REATIVAR registro já
 * ativo (revisão 09/09): sem ela a linha legada 'ativa' + rid null voltava pela
 * consulta, reescrevia `ativa_em`, era anunciada como ativação nova e ia parar
 * no `criarContaMrrLoja` — cujo dedupe é o `UME_RID:` na descrição, que as
 * contas MRR antigas não têm → duplicaria conta em massa na primeira rodada.
 *
 * Teto por rodada na ativação: 25 grupos ou 60s (cada `criarContaMrrLoja` fala
 * com o Evo). O que sobrar continua não-'ativa' e é repescado amanhã, por design.
 * Relógio próprio (`INICIO_ATIVACAO`), não o relógio da função inteira: o balde
 * 2 (só RID) roda ANTES e, sem clock próprio, sozinho já podia consumir os 60s
 * da ativação sem que nenhum grupo do balde 1 fosse tentado (revisão 09/09). O
 * teto NÃO se aplica em `dry` — a prévia precisa mostrar tudo que uma rodada
 * real faria (revisão 09/09).
 *
 * Balde 2 (só RID) também ganhou teto próprio (200/rodada, self-drena): sem
 * ele um retrato com milhares de registros sem RID travava a rodada inteira
 * nesse balde antes de a ativação sequer começar (revisão 09/09).
 *
 * Mesma ação do `scripts/detectar-lojas-ativas.mjs` (que fica intacto como
 * rede de segurança de segunda), agora em TS e disparada todo dia pela rota.
 * Retorna as linhas do digest (ativações + as que só ganharam RID); em `dry`
 * não lê o Evo, não grava e não envia — só devolve a prévia marcada com [dry].
 */
/** Teto da rodada de ativação — ver docstring de `ativarLojasPresentes`. */
const TETO_ATIVACOES = 25
const TETO_MS = 60_000
/** Teto do balde "só RID" — ver docstring de `ativarLojasPresentes`. */
const TETO_SO_RID = 200
/** Digest no WhatsApp: no máximo 20 linhas de detalhe por seção. */
const MAX_DIGEST = 20
const cortarDigest = (ls: string[]) =>
  ls.length > MAX_DIGEST ? [...ls.slice(0, MAX_DIGEST), `… +${ls.length - MAX_DIGEST} mais`] : ls

export async function ativarLojasPresentes(retrato: LinhaDiaria[], dry: boolean): Promise<string[]> {
  // Map<cnpj, LinhaDiaria> — quando o CNPJ tem várias lojas, prefere a linha
  // Ativo (uma loja ativa "cobre" o CNPJ mesmo que outra unidade esteja Inativo).
  const porCnpj = new Map<string, LinhaDiaria>()
  for (const l of retrato) {
    const atual = porCnpj.get(l.cnpj)
    if (!atual || (atual.status !== 'Ativo' && l.status === 'Ativo')) porCnpj.set(l.cnpj, l)
  }

  // Paginado: o PostgREST corta em 1.000 linhas e a tabela já passa disso —
  // sem o laço, os registros do fim da fila nunca ativariam (revisão 09/09).
  const candidatos: RegistroCnpj[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin
      .from('sdr_registros_cnpj')
      .select('id,lead_id,loja,telefone,cnpj,status,rid,ativa_em')
      // `status.is.null` explícito: no PostgREST `neq` NÃO casa NULL, e registro
      // sem status nenhum precisa entrar na fila de ativação (revisão 09/09).
      .or('status.neq.ativa,status.is.null,rid.is.null')
      .order('id', { ascending: true })
      .range(de, de + 999)
    if (error) throw new Error(`sdr_registros_cnpj: ${error.message}`)
    candidatos.push(...((data ?? []) as unknown as RegistroCnpj[]))
    if (!data || data.length < 1000) break
  }
  const presentes = candidatos.filter((r) => porCnpj.has(String(r.cnpj)))
  if (!presentes.length) return []

  // Balde 1 — ainda não ativa no banco E Ativo no portal. A trava `!== 'ativa'`
  // é o que impede reativar (e reduplicar conta MRR de) registro legado que a
  // consulta trouxe só por causa do `rid is null` (revisão 09/09).
  const paraAtivar = presentes.filter(
    (r) => r.status !== 'ativa' && porCnpj.get(String(r.cnpj))!.status === 'Ativo',
  )
  // Balde 2 — todo o resto cujo RID está ausente/desatualizado: só grava `rid`.
  const soRidTodos = presentes.filter((r) => {
    const s = porCnpj.get(String(r.cnpj))!
    const vaiAtivar = r.status !== 'ativa' && s.status === 'Ativo'
    return !vaiAtivar && String(r.rid ?? '') !== s.retailer_id
  })
  // Teto de 200/rodada — self-drena: quem sobrar tem `rid` desatualizado ainda,
  // então volta a aparecer na consulta de amanhã sem precisar de nenhum marcador
  // extra (revisão 09/09).
  const soRid = soRidTodos.slice(0, TETO_SO_RID)
  const soRidSobraram = soRidTodos.length - soRid.length
  // linha do teto do balde 2, pra aparecer tanto no retorno de `dry` quanto no digest
  // (revisão final 09/09) — antes só ia pro digest via `avisoSoRid`, e `dry` nunca manda
  // digest, então a prévia escondia que o teto de 200 tinha cortado a lista.
  const linhaSoRidTeto = soRidSobraram > 0 ? `⏳ +${soRidSobraram} RIDs ficaram pra amanhã (teto do balde 2)` : null
  // Balde 3 (já ativa e com o mesmo RID) não aparece em lugar nenhum: nada a fazer.
  if (!paraAtivar.length && !soRid.length) return []

  // --- só RID (balde 2) — update barato, um por vez, teto de 200 ------------
  const ridLinhas: string[] = []
  for (const r of soRid) {
    const s = porCnpj.get(String(r.cnpj))!
    let aviso = dry ? ' [dry]' : ''
    if (!dry) {
      // erro do update não pode sumir: o digest é a única evidência de que
      // gravou — sem isso o Aldo lê "RID gravado" sem RID no banco (revisão 09/09).
      const { error } = await supabaseAdmin.from('sdr_registros_cnpj').update({ rid: s.retailer_id }).eq('id', r.id)
      if (error) aviso = ` ⚠️ status/RID não gravou: ${error.message.slice(0, 100)}`
    }
    ridLinhas.push(`• ${r.loja} — ${s.nome_varejo ?? r.cnpj} (RID ${s.retailer_id})${aviso}`)
  }

  // --- ativação (portal = Ativo) -------------------------------------------
  // Mesmo CNPJ registrado por dois leads = UMA conta no CRM (dedupe por
  // retailer_id), mas TODOS os registros daquele CNPJ recebem status='ativa'
  // (revisão 09/09 — antes criava conta duplicada por lead).
  const porRid = new Map<string, RegistroCnpj[]>()
  for (const r of paraAtivar) {
    const rid = porCnpj.get(String(r.cnpj))!.retailer_id
    const grupo = porRid.get(rid)
    if (grupo) grupo.push(r)
    else porRid.set(rid, [r])
  }

  const linhas: string[] = []
  const criadas: { id: number; rid: string; linha: number }[] = []
  // Teto por rodada: cada grupo fala com o Evo (~2 chamadas) e a função morre em
  // 300s. Quem não couber continua não-'ativa' e volta amanhã (revisão 09/09).
  // Relógio próprio da ativação — o balde 2 (só RID) roda antes e não pode
  // comer o orçamento de tempo do balde 1 (revisão 09/09). Em `dry` o teto não
  // vale: a prévia tem que mostrar tudo que uma rodada real faria (revisão 09/09).
  const INICIO_ATIVACAO = Date.now()
  const grupos = [...porRid.entries()]
  let i = 0
  for (; i < grupos.length; i++) {
    if (!dry && (i >= TETO_ATIVACOES || Date.now() - INICIO_ATIVACAO > TETO_MS)) break
    const [rid, grupo] = grupos[i]
    const r = grupo[0]
    const s = porCnpj.get(String(r.cnpj))!
    const nomes = grupo.map((g) => g.loja).join(' / ')
    const fone = String(r.telefone ?? '').replace(/\D/g, '')
    if (dry) { linhas.push(`• ${nomes} — ${s.nome_varejo ?? r.cnpj} (RID ${rid}) [dry]`); continue }

    // L1 (revisão 09/09): irmã do MESMO CNPJ já 'ativa' → não chama o Evo de
    // novo. A lista paginada de `candidatos` não serve pra essa checagem (o
    // `.or()` pode não trazer a linha irmã de volta), então é uma query extra
    // e pontual. Existe porque contas MRR legadas do funil 11 (criadas antes
    // do registro-por-loja) não têm `UME_RID:` na descrição — o dedupe do
    // `criarContaMrrLoja` não as enxerga e duplicaria a conta.
    const { data: irmaAtiva, error: erroIrma } = await supabaseAdmin
      .from('sdr_registros_cnpj')
      .select('id')
      .eq('cnpj', String(r.cnpj))
      .eq('status', 'ativa')
      .limit(1)
    if (erroIrma) {
      linhas.push(`• ${nomes} — ${s.nome_varejo ?? r.cnpj} (RID ${rid}) → ⚠️ checagem de irmã ativa falhou, status NÃO gravado (tenta amanhã): ${erroIrma.message.slice(0, 100)}`)
      continue
    }
    const jaTemIrmaAtiva = !!irmaAtiva?.length

    let conta: { id: number; jaExistia: boolean } | null = null
    if (!jaTemIrmaAtiva) {
      try {
        conta = await criarContaMrrLoja({
          titulo: (s.nome_varejo ?? r.loja ?? 'Loja AIVA').trim(),
          telefone: fone,
          rid,
          cnpj: String(r.cnpj),
          leadNome: `${r.loja ?? 'lojista'} (ativa no portal AIVA em ${s.data_ref})`,
        })
      } catch (e) {
        linhas.push(`• ${nomes} — ${s.nome_varejo ?? r.cnpj} (RID ${rid}) → ⚠️ conta MRR falhou, status NÃO gravado (tenta amanhã): ${String(e).slice(0, 100)}`)
        continue
      }
      if (!conta) {
        linhas.push(`• ${nomes} — ${s.nome_varejo ?? r.cnpj} (RID ${rid}) → ⚠️ RID vazio, conta MRR não criada e status NÃO gravado`)
        continue
      }
    }

    // CRM ok (criada, já existia, ou presumida por irmã) → agora sim o banco,
    // em todos os registros do CNPJ. TODOS os erros do grupo entram no aviso —
    // antes o último sobrescrevia os anteriores e um grupo com 3 falhas
    // reportava só 1 (revisão 09/09).
    const erros: string[] = []
    for (const reg of grupo) {
      const { error } = await supabaseAdmin.from('sdr_registros_cnpj')
        .update({ status: 'ativa', rid, ativa_em: new Date().toISOString() }).eq('id', reg.id)
      if (error) erros.push(`#${reg.id}: ${error.message.slice(0, 100)}`)
    }
    const aviso = erros.length
      ? ` ⚠️ status/RID não gravou em ${erros.length}/${grupo.length} registro(s): ${erros.join('; ')}`
      : ''
    if (conta && !conta.jaExistia) criadas.push({ id: conta.id, rid, linha: linhas.length })
    const statusConta = jaTemIrmaAtiva
      ? 'conta MRR presumida existente (irmã já ativa)'
      : conta!.jaExistia ? `conta MRR já existia (#${conta!.id})` : `conta MRR criada (#${conta!.id})`
    linhas.push(`• ${nomes} — ${s.nome_varejo ?? r.cnpj} (RID ${rid}) → ${statusConta}${aviso}`)
  }
  const sobraram = grupos.length - i
  const linhaTeto = sobraram > 0 ? `⏳ +${sobraram} grupo(s)/CNPJ(s) ficaram pra amanhã (teto da rodada)` : null

  // read-after-write UMA vez no fim (lição 26/08: o Evo responde 200 sem
  // persistir). `criarContaMrrLoja` não confere — uma leitura do funil por
  // loja criada era desperdício (revisão 09/09).
  if (!dry && criadas.length) {
    try {
      const opps = await getPipeOpportunities(PIPELINE_MRR)
      for (const c of criadas) {
        const re = new RegExp(`UME_RID:\\s*${escaparRegex(c.rid)}\\b`)
        if (!opps.some((o) => o.id === c.id && re.test(o.description ?? ''))) {
          linhas[c.linha] += ' ⚠️ descrição NÃO confirmou — conferir'
        }
      }
    } catch (e) {
      linhas.push(`⚠️ não deu pra confirmar as contas MRR criadas: ${String(e).slice(0, 100)}`)
    }
  }

  const tetoLinhas = [linhaTeto, linhaSoRidTeto].filter((l): l is string => l != null)
  if (dry) return [...linhas, ...tetoLinhas, ...ridLinhas]

  const dataRef = retrato[0]?.data_ref ?? hojeBrt()
  // Digest: com ativação, cabeçalho de ativação + rodapé dos que só ganharam
  // RID; sem ativação nenhuma, mensagem própria — "ATIVARAM" com a lista vazia
  // fazia o Aldo procurar loja que não existia (revisão 09/09).
  // Cada seção vai cortada em MAX_DIGEST linhas (o retorno da função continua
  // completo): 300 lojas numa mensagem só o WhatsApp trunca no meio.
  const avisoTeto = linhaTeto ? `\n${linhaTeto}` : ''
  // Teto do balde 2 (só RID) também precisa aparecer no digest — sem isso o
  // Aldo não sabia que sobraram RIDs pra amanhã (revisão 09/09).
  const avisoSoRid = soRidSobraram > 0 ? ` — +${soRidSobraram} RIDs ficaram pra amanhã` : ''
  let resumo: string | null = null
  if (linhas.length) {
    const rodape = ridLinhas.length ? `\n🔖 +${ridLinhas.length} loja(s) ganharam RID sem ativar ainda${avisoSoRid}:\n${cortarDigest(ridLinhas).join('\n')}` : ''
    resumo = `🆕 *Lojas novas ATIVARAM no portal AIVA (${dataRef})*\n${cortarDigest(linhas).join('\n')}${avisoTeto}${rodape}`
  } else if (ridLinhas.length) {
    resumo = `🔖 *RID gravado pra ${ridLinhas.length} loja(s) do portal AIVA (${dataRef})* — sem ativação nova${avisoSoRid}\n${cortarDigest(ridLinhas).join('\n')}${avisoTeto}`
  }
  // L2 (revisão 09/09): o ⏳ do teto de ativação precisa sair mesmo quando não
  // há nem ativação nem RID novo — senão o Aldo nunca fica sabendo que grupos
  // ficaram pra amanhã.
  if (!resumo && linhaTeto) resumo = linhaTeto
  if (resumo) {
    for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean) as string[]) {
      try { await sendText(tel, resumo) } catch (e) { console.error('[portal-aiva] digest de ativação falhou:', e) }
    }
  }
  return [...linhas, ...tetoLinhas, ...ridLinhas]
}
