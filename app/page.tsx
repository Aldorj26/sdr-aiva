import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import LeadDrawer from './_components/LeadDrawer'
import ClickableRow from './_components/ClickableRow'
import TimelineRow from './_components/TimelineRow'
import SearchBar from './_components/SearchBar'
import { getPipeOpportunities, getTagCatalog, PIPELINE_AIVA } from '@/lib/evotalks'
import TagChips, { type TagChip } from './_components/TagChips'

// Dinâmico pra suportar ?q= e ?status= sem cache
export const dynamic = 'force-dynamic'
export const revalidate = 0

// ─── Queries ──────────────────────────────────────────────────────────────────

async function getMetricas() {
  const { data } = await supabaseAdmin.from('sdr_metricas').select('*')
  return data ?? []
}

async function getRecentLeads(
  q?: string,
  status?: string,
  importante?: string,
  aguardandoHumano?: string,
  pausados?: string,
  followupHoje?: string,
  lockTravado?: string,
  disparoDia?: string,
  etapa?: string,
  inbound?: string,
  cadastroCompleto?: string,
  cafPreenchido?: string,
  descartadosPipeline?: string,
) {
  const temFiltro = Boolean(
    q || status || importante || aguardandoHumano || pausados || followupHoje || lockTravado || disparoDia || etapa || inbound || cadastroCompleto || cafPreenchido || descartadosPipeline,
  )

  // Filtro por etapa do Evo é aplicado em memória (a etapa não está no banco),
  // então busca um lote maior pra não perder leads ao filtrar depois.
  // descartadosPipeline usa o mesmo mecanismo: o cruzamento com o CRM só existe
  // em memória, e são ~1.1k descartados, então o lote precisa cobrir todos.
  const limite = etapa || descartadosPipeline === 'true' ? 2000 : temFiltro ? 500 : 10

  let query = supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, cidade, status, data_ultimo_contato, importante, acionar_humano, status_alterado_em')
    .order('data_ultimo_contato', { ascending: false, nullsFirst: false })
    .limit(limite)

  if (status) query = query.eq('status', status)
  if (importante === 'true') query = query.eq('importante', true)

  if (aguardandoHumano === 'true') {
    // LFV fora: atendimento de loja ativa é CS e mora no /desempenho (02/09)
    query = query
      .eq('acionar_humano', true)
      .not('status', 'in', '("FORMULARIO_ENVIADO","OPT_OUT","NAO_QUALIFICADO","DESCARTADO","LOJA_FINALIZADA_E_VENDENDO")')
  }

  if (pausados === 'true') {
    query = query.like('observacoes', '%[PAUSA_ATE:%')
  }

  // Inbound: leads que chegaram organicamente (marcador [INBOUND] ou o antigo
  // [INBOUND_TRIAGEM]) — ambos começam com "[INBOUND".
  if (inbound === 'true') {
    query = query.like('observacoes', '%[INBOUND%')
  }

  if (followupHoje === 'true') {
    const fimDoDia = new Date()
    fimDoDia.setHours(23, 59, 59, 999)
    query = query
      .lte('data_proximo_followup', fimDoDia.toISOString())
      .not('status', 'in', '("OPT_OUT","NAO_QUALIFICADO","DESCARTADO","FORMULARIO_ENVIADO")')
  }

  if (lockTravado === 'true') {
    const umMinutoAtras = new Date(Date.now() - 60 * 1000).toISOString()
    query = query
      .not('webhook_lock_at', 'is', null)
      .lt('webhook_lock_at', umMinutoAtras)
  }

  // Drill-down dos cards novos — mesmos critérios do getAgora().
  if (cadastroCompleto === 'true') {
    query = query.eq('status', 'CADASTRO_RECEBIDO').like('observacoes', '%[CAD_ALERTADO]%')
  }
  if (cafPreenchido === 'true') {
    query = query.eq('status', 'EM_ANALISE_AIVA').like('observacoes', '%[CAF_OK%')
  }
  // Só o recorte por status aqui; o cruzamento com o pipeline do Evo é feito
  // em memória na Page (mesmo motivo do filtro por etapa).
  if (descartadosPipeline === 'true') {
    query = query.eq('status', 'DESCARTADO').eq('produto', 'AIVA')
  }

  // Filtro por dia de disparo (formato YYYY-MM-DD em BRT, vem do /campanhas)
  if (disparoDia && /^\d{4}-\d{2}-\d{2}$/.test(disparoDia)) {
    const startBrt = new Date(`${disparoDia}T00:00:00-03:00`)
    const endBrt = new Date(startBrt.getTime() + 24 * 60 * 60 * 1000)
    query = query
      .gte('data_disparo_inicial', startBrt.toISOString())
      .lt('data_disparo_inicial', endBrt.toISOString())
  }

  let idsVinculo = new Set<string>()
  if (q && q.trim()) {
    // Remove vírgula/parênteses: quebrariam a sintaxe do .or() do PostgREST.
    const term = q.trim().replace(/[(),]/g, ' ').trim()
    const soDigitos = term.replace(/\D/g, '')

    // ── VÍNCULOS (pedido do Aldo 02/09): funcionário ou CNPJ/RID de QUALQUER
    // loja do lojista (matriz/filial) também acham o lead dono — o funcionário
    // da filial liga pro Nei e a busca resolve pra conversa certa.
    try {
      const digitosOuTermo = soDigitos.length >= 6 ? soDigitos : term
      const [colabs, cnpjs] = await Promise.all([
        supabaseAdmin
          .from('sdr_registros_colab')
          .select('lead_id')
          .or([
            `nome.ilike.%${term}%`,
            `email.ilike.%${term}%`,
            `cpf.ilike.%${digitosOuTermo}%`,
            `telefone.ilike.%${digitosOuTermo}%`,
          ].join(','))
          .limit(30),
        supabaseAdmin
          .from('sdr_registros_cnpj')
          .select('lead_id')
          .or([`cnpj.ilike.%${digitosOuTermo}%`, `rid.ilike.%${term}%`, `loja.ilike.%${term}%`].join(','))
          .limit(30),
      ])
      idsVinculo = new Set(
        [...(colabs.data ?? []), ...(cnpjs.data ?? [])].map((r) => r.lead_id as string).filter(Boolean),
      )
    } catch (e) {
      console.warn('[busca] vínculos falharam:', e)
    }

    // Busca em nome/telefone/cidade E nas observacoes — que guardam todos os dados
    // coletados ([DADOS_COLETADOS:nome_socio=…|email_socio=…|cnpj_matriz=…|…]),
    // então cobre sócio, email, CNPJ, faturamento, região, nº lojas etc.
    const condicoes = [
      `nome.ilike.%${term}%`,
      `telefone.ilike.%${term}%`,
      `cidade.ilike.%${term}%`,
      `observacoes.ilike.%${term}%`,
    ]
    // CNPJ/CPF/telefone colado COM pontuação (00.000.000/0001-00): no banco
    // esses valores vivem só com dígitos — busca também a versão limpa.
    if (soDigitos.length >= 8 && soDigitos !== term) {
      condicoes.push(`telefone.ilike.%${soDigitos}%`, `observacoes.ilike.%${soDigitos}%`)
    }
    if (idsVinculo.size > 0) {
      condicoes.push(`id.in.(${[...idsVinculo].slice(0, 40).join(',')})`)
    }
    query = query.or(condicoes.join(','))
  }
  const { data } = await query
  // Marca quem foi achado por vínculo (funcionário/loja) pro selo 🔗 na linha
  return (data ?? []).map((l) => ({ ...l, achado_por_vinculo: idsVinculo.has(l.id) }))
}

/**
 * Telefones dos leads DESCARTADO do funil AIVA.
 *
 * Serve pro card "Descartados no pipeline": o cruzamento com o CRM é feito na
 * Page, contra o mapa que getEtapasEvo() já carregou — então o card não custa
 * nenhuma chamada extra ao Evo. O que sobra do cruzamento são cards mortos
 * ocupando o kanban: o lead foi descartado aqui mas a oportunidade continua
 * aberta lá.
 *
 * PAGINADO de propósito: o PostgREST corta em 1000 linhas por request mesmo com
 * .range() maior — um range(0, 4999) devolve 1000 e o card conta sobre uma base
 * truncada, silenciosamente (eram 1.144 descartados em 18/08/2026). Mesmo
 * padrão do loop em sync-from-evo.
 */
async function getDescartadosTels(): Promise<string[]> {
  const tels: string[] = []
  const page = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('sdr_leads')
      .select('telefone')
      .eq('status', 'DESCARTADO')
      .eq('produto', 'AIVA')
      .range(from, from + page - 1)
    if (error) break
    tels.push(...(data ?? []).map((l) => l.telefone))
    if (!data || data.length < page) break
    from += page
  }
  return tels
}

async function getAgora() {
  const now = new Date()
  const duasHorasAtras = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
  const umMinutoAtras = new Date(now.getTime() - 60 * 1000).toISOString()
  const fimDoDia = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()

  const [conversasAtivas, aguardandoHumano, pausados, lockTravado, followupsHoje, cadastroCompleto, cafPreenchido, csAguardando] = await Promise.all([
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'INTERESSADO')
      .gte('data_ultimo_contato', duasHorasAtras),
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .eq('acionar_humano', true)
      // LFV fora: atendimento de loja ativa é CS e mora no /desempenho (02/09)
      .not('status', 'in', '("FORMULARIO_ENVIADO","OPT_OUT","NAO_QUALIFICADO","DESCARTADO","LOJA_FINALIZADA_E_VENDENDO")'),
    // Pausados: só conta pausa AINDA VIGENTE de lead ativo. Marcadores
    // [PAUSA_ATE:] vencidos ficavam pra sempre (bug Smarting/Clinicell
    // 2026-07-29: descartados em maio ainda contavam como pausados).
    supabaseAdmin
      .from('sdr_leads')
      .select('observacoes')
      .like('observacoes', '%[PAUSA_ATE:%')
      .not('status', 'in', '("OPT_OUT","NAO_QUALIFICADO","DESCARTADO","BOT_DETECTADO","ODRES","UME")')
      .then((res) => {
        const agora = Date.now()
        const vigentes = (res.data ?? []).filter((r) => {
          const ate = (r.observacoes ?? '').match(/\[PAUSA_ATE:([^\]]+)\]/)?.[1]
          const t = ate ? Date.parse(ate) : NaN
          return !Number.isNaN(t) && t > agora
        })
        return { count: vigentes.length }
      }),
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .not('webhook_lock_at', 'is', null)
      .lt('webhook_lock_at', umMinutoAtras),
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .lte('data_proximo_followup', fimDoDia)
      .not('status', 'in', '("OPT_OUT","NAO_QUALIFICADO","DESCARTADO","FORMULARIO_ENVIADO")'),
    // Cadastro completo AGUARDANDO o Nei mover pra Em Análise AIVA.
    // [CAD_ALERTADO] é gravado no exato momento em que os 12 dados fecham
    // (webhook §13, trava atômica) — é o sinal de "cadastro concluído".
    // Filtra por status pra mostrar só quem ainda espera ação, não o acumulado.
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .eq('produto', 'AIVA')
      .eq('status', 'CADASTRO_RECEBIDO')
      .like('observacoes', '%[CAD_ALERTADO]%'),
    // CAF preenchido AGUARDANDO aprovação da AIVA (Eduardo).
    // [CAF_OK:] é gravado quando o lojista confirma a biometria. Não usar o
    // motivo_humano "cadastro_caf_confirmado": ele é texto solto e o webhook o
    // substitui a cada turno (sobrevivia em 7 de 47 casos reais).
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .eq('produto', 'AIVA')
      .eq('status', 'EM_ANALISE_AIVA')
      .like('observacoes', '%[CAF_OK%'),
    // Acionamentos de lojas ATIVAS (CS) — tratados no /desempenho (02/09).
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .eq('acionar_humano', true)
      .eq('status', 'LOJA_FINALIZADA_E_VENDENDO'),
  ])

  return {
    conversasAtivas: conversasAtivas.count ?? 0,
    aguardandoHumano: aguardandoHumano.count ?? 0,
    pausados: pausados.count ?? 0,
    lockTravado: lockTravado.count ?? 0,
    followupsHoje: followupsHoje.count ?? 0,
    cadastroCompleto: cadastroCompleto.count ?? 0,
    cafPreenchido: cafPreenchido.count ?? 0,
    csAguardando: csAguardando.count ?? 0,
  }
}

interface LeadResumo {
  id: string
  nome: string
  telefone: string
  status: string
  data_ultimo_contato: string | null
}

// Leads que pediram atendimento humano e ainda não foram resolvidos.
// LFV fora: atendimento de loja ativa é CS e mora no /desempenho (02/09).
async function getPrecisamAtendimento(): Promise<LeadResumo[]> {
  const { data } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, data_ultimo_contato')
    .eq('acionar_humano', true)
    .not('status', 'in', '("OPT_OUT","NAO_QUALIFICADO","DESCARTADO","LOJA_FINALIZADA_E_VENDENDO")')
    .order('data_ultimo_contato', { ascending: false, nullsFirst: false })
    .limit(12)
  return (data ?? []) as LeadResumo[]
}

// Leads nas etapas finais do funil — os mais perto de fechar.
async function getLeadsQuentes(): Promise<LeadResumo[]> {
  const { data } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, data_ultimo_contato')
    .in('status', [
      'AGUARDANDO_APROVACAO',
      'COLETANDO_COMPLEMENTO',
      'CADASTRO_COMPLETO',
      'ANALISE_AIVA',
      'TREINAMENTO',
    ])
    .order('data_ultimo_contato', { ascending: false, nullsFirst: false })
    .limit(12)
  return (data ?? []) as LeadResumo[]
}

// Leads INTERESSADO com conversa ativa nas últimas 24h.
async function getConversasHoje(): Promise<LeadResumo[]> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, data_ultimo_contato')
    .eq('status', 'INTERESSADO')
    .gte('data_ultimo_contato', desde)
    .order('data_ultimo_contato', { ascending: false })
    .limit(12)
  return (data ?? []) as LeadResumo[]
}

async function getSaude() {
  const [ultimaIn, ultimaOut, ultimoHsm, locksTravados] = await Promise.all([
    supabaseAdmin
      .from('sdr_mensagens')
      .select('enviado_em')
      .eq('direcao', 'in')
      .order('enviado_em', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('sdr_mensagens')
      .select('enviado_em')
      .eq('direcao', 'out')
      .order('enviado_em', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('sdr_mensagens')
      .select('enviado_em, template_hsm')
      .not('template_hsm', 'is', null)
      .order('enviado_em', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .not('webhook_lock_at', 'is', null),
  ])

  return {
    ultimaMensagemRecebida: ultimaIn.data?.enviado_em ?? null,
    ultimaRespostaVictorIA: ultimaOut.data?.enviado_em ?? null,
    ultimoHsmDisparado: ultimoHsm.data?.enviado_em ?? null,
    nomeUltimoHsm: ultimoHsm.data?.template_hsm ?? null,
    locksAtivos: locksTravados.count ?? 0,
  }
}

// ─── Etapa do funil Evo Talks ───────────────────────────────────────────────

// ID da etapa do funil AIVA (pipeline 15) → rótulo. IDs confirmados com Aldo
// em 2026-05-18 (a API do Evo Talks não expõe o nome das etapas).
const STAGE_LABEL: Record<number, string> = {
  66: 'Início',
  47: 'Interessado',
  53: 'Interessado sem resposta',
  54: 'Pré-aprovação',
  49: 'Cadastro recebido',
  50: 'Em análise AIVA',
  70: 'Treinar',
  71: 'Login',
  51: 'Loja finalizada e vendendo',
  69: 'Bot detectado',
}

// Normaliza telefone para uma chave de comparação estável: descarta o 55 e o
// 9º dígito do celular, deixando DDD + 8 dígitos. Casa o telefone do lead
// (Supabase) com o mainphone da oportunidade (Evo Talks), que vêm em formatos
// variados.
function chaveTel(s: string | null | undefined): string {
  let d = (s ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11) d = d.slice(0, 2) + d.slice(3)
  return d
}

interface EtapaEvo {
  id: number
  label: string
  /** Etiquetas da oportunidade no Evo, já resolvidas (nome + cores). */
  tags: TagChip[]
}

// Busca as oportunidades abertas do funil AIVA e devolve mapa chaveTel → etapa.
// Falha de rede/API não quebra a página — devolve mapa vazio (mostra "—").
//
// As etiquetas vêm na MESMA resposta (só como IDs numéricos), então resolver os
// nomes/cores custa só a leitura do catálogo — que é cacheada por 10 min.
async function getEtapasEvo(): Promise<Record<string, EtapaEvo>> {
  try {
    const [opps, catalogo] = await Promise.all([
      getPipeOpportunities(PIPELINE_AIVA),
      getTagCatalog(),
    ])
    // Ordem de progressão do funil — usada só pra desempate quando DUAS opps
    // colidem na mesma chaveTel (ex.: Cell Maxx 27/08 — opp real em Loja
    // Finalizada #12064 com fone sem 9º dígito + duplicata "Loja — AIVA" #12526
    // em Início com o 9º dígito; a duplicata sobrescrevia e o painel mostrava
    // "Início"). Em colisão, fica a etapa mais avançada.
    const STAGE_RANK: Record<number, number> = { 66: 0, 69: 0, 53: 1, 47: 2, 54: 3, 49: 4, 50: 5, 70: 6, 71: 7, 51: 8 }
    const mapa: Record<string, EtapaEvo> = {}
    for (const o of opps) {
      const k = chaveTel(o.mainphone)
      if (!k) continue
      const atual = mapa[k]
      if (atual && (STAGE_RANK[atual.id] ?? -1) >= (STAGE_RANK[o.fkStage] ?? -1)) continue
      mapa[k] = {
        id: o.fkStage,
        label: STAGE_LABEL[o.fkStage] ?? `Etapa ${o.fkStage}`,
        tags: o.tags
          .map((id) => catalogo.get(id))
          .filter((t): t is NonNullable<typeof t> => !!t)
          .map((t) => ({ id: t.id, name: t.name, bgcolor: t.bgcolor, fgcolor: t.fgcolor })),
      }
    }
    return mapa
  } catch (e) {
    console.warn('[getEtapasEvo] falhou:', e instanceof Error ? e.message : e)
    return {}
  }
}

// ─── Helpers visuais ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  DISPARO_REALIZADO: '#6b7280',
  INTERESSADO: '#34d399',
  FORMULARIO_ENVIADO: '#60a5fa',
  SEM_RESPOSTA: '#fbbf24',
  OPT_OUT: '#f87171',
  NAO_QUALIFICADO: '#f87171',
  AGUARDANDO: '#a78bfa',
  DESCARTADO: '#4b5563',
  TREINAMENTO: '#f97316',
}

function fmtRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}


function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? '#6b7280'
  return (
    <span
      className="pill"
      style={{
        background: `${color}1a`,
        color,
        border: `1px solid ${color}33`,
      }}
    >
      {status}
    </span>
  )
}

// Painel de lista de leads acionável (usado na seção de 3 colunas do dashboard).
function PainelLeads({
  titulo,
  sub,
  leads,
  vazio,
  verTodosHref,
}: {
  titulo: string
  sub: string
  leads: LeadResumo[]
  vazio: string
  verTodosHref: string
}) {
  return (
    <div>
      <div className="section-header">
        <h2 style={{ margin: 0 }}>{titulo}</h2>
        <span className="section-sub">{sub}</span>
      </div>
      <div className="timeline">
        {leads.length === 0 ? (
          <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {vazio}
          </div>
        ) : (
          <>
            {leads.map((l) => {
              const generico = l.nome === 'Loja' || l.nome === 'Lead'
              const nomeExibido = generico
                ? `${l.nome} (${l.telefone.slice(-4)})`
                : l.nome
              return (
                <TimelineRow key={l.id} leadId={l.id}>
                  <span className="timeline-time">
                    {l.data_ultimo_contato ? fmtRelativo(l.data_ultimo_contato) : '—'}
                  </span>
                  <span
                    className="timeline-actor"
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {nomeExibido}
                  </span>
                  <StatusPill status={l.status} />
                </TimelineRow>
              )
            })}
            <a
              href={verTodosHref}
              style={{
                display: 'block',
                padding: '0.6rem 1rem',
                fontSize: '0.75rem',
                color: 'var(--accent)',
                textDecoration: 'none',
                fontWeight: 600,
                borderTop: '1px solid var(--border)',
              }}
            >
              Ver todos →
            </a>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    status?: string
    importante?: string
    aguardando_humano?: string
    pausados?: string
    followup_hoje?: string
    lock_travado?: string
    disparo_dia?: string
    etapa?: string
    inbound?: string
    cadastro_completo?: string
    caf_preenchido?: string
    descartados_pipeline?: string
  }>
}) {
  const sp = await searchParams
  const [metricas, leadsRaw, agora, atendimento, quentes, conversasHoje, saude, etapasEvo, descartadosTels] = await Promise.all([
    getMetricas(),
    getRecentLeads(
      sp.q,
      sp.status,
      sp.importante,
      sp.aguardando_humano,
      sp.pausados,
      sp.followup_hoje,
      sp.lock_travado,
      sp.disparo_dia,
      sp.etapa,
      sp.inbound,
      sp.cadastro_completo,
      sp.caf_preenchido,
      sp.descartados_pipeline,
    ),
    getAgora(),
    getPrecisamAtendimento(),
    getLeadsQuentes(),
    getConversasHoje(),
    getSaude(),
    getEtapasEvo(),
    getDescartadosTels(),
  ])
  // Descartados que AINDA ocupam uma oportunidade aberta no pipeline AIVA.
  // Cruzamento em memória contra o mapa do Evo — zero chamada extra.
  // Se o Evo falhar, getEtapasEvo devolve {} e o card mostra 0 (não quebra a página).
  const descartadosNoPipe = descartadosTels.filter((t) => etapasEvo[chaveTel(t)]).length

  // Filtro por etapa do Evo Talks — aplicado em memória (a etapa não está no
  // banco, vem do CRM via getEtapasEvo).
  const leads = sp.etapa
    ? leadsRaw.filter((l) => etapasEvo[chaveTel(l.telefone)]?.id === Number(sp.etapa))
    : sp.descartados_pipeline === 'true'
      ? leadsRaw.filter((l) => etapasEvo[chaveTel(l.telefone)])
      : leadsRaw

  const filtroAtivo = Boolean(
    sp.q ||
      sp.status ||
      sp.importante ||
      sp.aguardando_humano ||
      sp.pausados ||
      sp.followup_hoje ||
      sp.lock_travado ||
      sp.disparo_dia ||
      sp.etapa ||
      sp.inbound ||
      sp.cadastro_completo ||
      sp.caf_preenchido ||
      sp.descartados_pipeline,
  )
  const total = metricas.reduce((s: number, m: { total: number }) => s + Number(m.total), 0)

  return (
    <main>
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <header style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <h1>Pipeline AIVA</h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              Track Tecnologia · VictorIA · {new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
            </p>
          </div>
          <Link
            href="/campanhas"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--text-dim)',
              textDecoration: 'none',
              padding: '0.55rem 0.9rem',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: '0.85rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            📊 Campanhas
          </Link>
          <Link
            href="/campanha"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              textDecoration: 'none',
              padding: '0.55rem 1rem',
              borderRadius: 8,
              fontSize: '0.85rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            + Disparar campanha
          </Link>
        </div>
      </header>

      {/* ─── Bloco AGORA ───────────────────────────────────────────────── */}
      <h2>Agora</h2>
      <div className="cards-grid">
        <Card
          label="Conversas ativas"
          value={agora.conversasAtivas}
          hint="INTERESSADO nas últimas 2h"
          color="var(--green)"
          href="/?status=INTERESSADO"
        />
        <Card
          label="Aguardando humano"
          value={agora.aguardandoHumano}
          hint="funil (lojas ativas → CS)"
          color={agora.aguardandoHumano > 0 ? 'var(--yellow)' : 'var(--text-muted)'}
          href="/?aguardando_humano=true"
        />
        <Card
          label="🟣 No CS"
          value={agora.csAguardando}
          hint="lojas ativas — painel Desempenho"
          color={agora.csAguardando > 0 ? '#a855f7' : 'var(--text-muted)'}
          href="/desempenho"
        />
        <Card
          label="Pausados"
          value={agora.pausados}
          hint="flag [PAUSA_ATE:]"
          color="var(--purple)"
          href="/?pausados=true"
        />
        <Card
          label="Follow-ups hoje"
          value={agora.followupsHoje}
          hint="próximo_followup ≤ hoje"
          color="var(--accent)"
          href="/?followup_hoje=true"
        />
        <Card
          label="Cadastro completo"
          value={agora.cadastroCompleto}
          hint="12 dados — mover p/ Em Análise"
          color={agora.cadastroCompleto > 0 ? 'var(--green)' : 'var(--text-muted)'}
          href="/?cadastro_completo=true"
        />
        <Card
          label="CAF preenchido"
          value={agora.cafPreenchido}
          hint="biometria ok — aguarda AIVA"
          color={agora.cafPreenchido > 0 ? 'var(--accent)' : 'var(--text-muted)'}
          href="/?caf_preenchido=true"
        />
        <Card
          label="Descartados no pipeline"
          value={descartadosNoPipe}
          hint="card morto no funil do Evo"
          color={descartadosNoPipe > 0 ? 'var(--red)' : 'var(--text-muted)'}
          href="/?descartados_pipeline=true"
        />
        <Card
          label="Lock travado"
          value={agora.lockTravado}
          hint="webhook_lock_at > 60s"
          color={agora.lockTravado > 0 ? 'var(--red)' : 'var(--text-muted)'}
          href="/?lock_travado=true"
        />
      </div>

      {/* ─── Leads / Busca ────────────────────────────────────────────── */}
      <div className="section-header">
        <h2 style={{ margin: 0 }}>
          {sp.disparo_dia
            ? `Lote de ${sp.disparo_dia.split('-').reverse().join('/')} (${leads.length})`
            : filtroAtivo
              ? `Leads encontrados (${leads.length})`
              : 'Últimas interações'}
        </h2>
        <span className="section-sub">total: {total}</span>
      </div>
      <SearchBar />
      <table className="tbl">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Status</th>
            <th>Telefone</th>
            <th>Etapa Evo</th>
            <th>Último contato</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l: { id: string; nome: string; telefone: string; cidade: string | null; status: string; data_ultimo_contato: string | null; importante: boolean; acionar_humano: boolean; status_alterado_em: string | null; achado_por_vinculo?: boolean }) => {
            // SLA de liberação: lojas em TREINAR/LOGIN paradas 3+ dias ganham
            // badge "⏱ Xd parado" (curadoria 2026-07-27 — queixa nº 1 do funil).
            const diasParado =
              ['TREINAR', 'LOGIN'].includes(l.status) && l.status_alterado_em
                ? Math.floor((Date.now() - new Date(l.status_alterado_em).getTime()) / 86400000)
                : 0
            return (
            <ClickableRow key={l.telefone} leadId={l.id}>
              <td>
                {l.importante && <span style={{ color: '#f59e0b', marginRight: 4 }} title="Importante (3+ lojas)">★</span>}
                {l.nome}
                {l.achado_por_vinculo && (
                  <span style={{ marginLeft: 6, fontSize: '0.68rem', color: '#a855f7', border: '1px solid #a855f744', borderRadius: 4, padding: '1px 5px' }} title="Achado por vínculo: funcionário ou CNPJ de uma das lojas deste lojista">
                    🔗 vínculo
                  </span>
                )}
              </td>
              <td style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                <StatusPill status={l.status} />
                {l.acionar_humano && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      background: '#fbbf2422',
                      color: '#fbbf24',
                      border: '1px solid #fbbf2444',
                      borderRadius: 4,
                      padding: '1px 5px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    🔔 humano
                  </span>
                )}
                {diasParado >= 3 && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      background: '#ef444422',
                      color: '#ef4444',
                      border: '1px solid #ef444444',
                      borderRadius: 4,
                      padding: '1px 5px',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Sem avanço de etapa há ${diasParado} dias — aguardando liberação/treinamento`}
                  >
                    ⏱ {diasParado}d parado
                  </span>
                )}
                {/* Etiquetas da oportunidade no Evo. A tag AIVA (69) está em
                    100% dos cards do funil, então vira ruído na tabela — some
                    aqui e continua visível no drawer. */}
                <TagChips
                  tags={(etapasEvo[chaveTel(l.telefone)]?.tags ?? []).filter((t) => t.id !== 69)}
                  max={3}
                />
              </td>
              <td style={{ color: 'var(--text-dim)' }}>{l.telefone}</td>
              <td style={{ color: 'var(--text-dim)' }}>{etapasEvo[chaveTel(l.telefone)]?.label ?? '—'}</td>
              <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {l.data_ultimo_contato
                  ? new Date(l.data_ultimo_contato).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                  : '—'}
              </td>
            </ClickableRow>
            )
          })}
        </tbody>
      </table>

      {/* ─── Painéis de ação (3 colunas) ──────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))',
          gap: '1rem',
          marginTop: '2.5rem',
        }}
      >
        <PainelLeads
          titulo="🔔 Precisam de atendimento"
          sub="acionar humano"
          leads={atendimento}
          vazio="Ninguém esperando atendimento. ✓"
          verTodosHref="/?aguardando_humano=true"
        />
        <PainelLeads
          titulo="🔥 Leads quentes"
          sub="perto de fechar"
          leads={quentes}
          vazio="Nenhum lead nas etapas finais ainda."
          verTodosHref="/funil"
        />
        <PainelLeads
          titulo="💬 Conversas ativas hoje"
          sub="responderam nas últimas 24h"
          leads={conversasHoje}
          vazio="Nenhuma conversa nas últimas 24h."
          verTodosHref="/?status=INTERESSADO"
        />
      </div>

      {/* ─── Saúde do sistema ─────────────────────────────────────────── */}
      <h2>Saúde do sistema</h2>
      <div className="cards-grid">
        <HealthCard
          label="Última msg recebida"
          iso={saude.ultimaMensagemRecebida}
          thresholdGreen={60}
          thresholdYellow={240}
        />
        <HealthCard
          label="Última resposta VictorIA"
          iso={saude.ultimaRespostaVictorIA}
          thresholdGreen={60}
          thresholdYellow={240}
        />
        <HealthCard
          label={`Último HSM${saude.nomeUltimoHsm ? ` (${saude.nomeUltimoHsm})` : ''}`}
          iso={saude.ultimoHsmDisparado}
          thresholdGreen={1440}
          thresholdYellow={2880}
        />
        <Card
          label="Locks ativos"
          value={saude.locksAtivos}
          hint="webhook_lock_at != null"
          color={saude.locksAtivos > 0 ? 'var(--yellow)' : 'var(--green)'}
        />
      </div>

      <p style={{ marginTop: '3rem', color: 'var(--text-muted)', fontSize: '0.72rem', textAlign: 'center' }}>
        Clique em qualquer linha pra abrir o histórico · dados atualizados ao recarregar
      </p>

      <LeadDrawer />
    </main>
  )
}

// ─── Componentes ──────────────────────────────────────────────────────────────

function HealthCard({
  label,
  iso,
  thresholdGreen,
  thresholdYellow,
}: {
  label: string
  iso: string | null
  thresholdGreen: number
  thresholdYellow: number
}) {
  if (!iso) {
    return (
      <div className="card">
        <div className="card-label">{label}</div>
        <div className="card-value" style={{ color: 'var(--text-muted)' }}>nunca</div>
        <div className="card-hint">sem registro</div>
      </div>
    )
  }
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  const color =
    min < thresholdGreen
      ? 'var(--green)'
      : min < thresholdYellow
        ? 'var(--yellow)'
        : 'var(--red)'
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value" style={{ color }}>{fmtRelativo(iso)}</div>
      <div className="card-hint">{new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>
    </div>
  )
}

function Card({
  label,
  value,
  hint,
  color,
  href,
}: {
  label: string
  value: number
  hint: string
  color: string
  href?: string
}) {
  const inner = (
    <>
      <div className="card-label">{label}</div>
      <div className="card-value" style={{ color }}>{value}</div>
      <div className="card-hint">{hint}</div>
    </>
  )
  if (href) {
    return (
      <Link href={href} className="card card-clickable" style={{ textDecoration: 'none' }}>
        {inner}
      </Link>
    )
  }
  return <div className="card">{inner}</div>
}
