import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import LeadDrawer from './_components/LeadDrawer'
import ClickableRow from './_components/ClickableRow'
import TimelineRow from './_components/TimelineRow'
import SearchBar from './_components/SearchBar'
import { getPipeOpportunities, PIPELINE_AIVA } from '@/lib/evotalks'

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
) {
  const temFiltro = Boolean(
    q || status || importante || aguardandoHumano || pausados || followupHoje || lockTravado || disparoDia || etapa || inbound,
  )

  // Filtro por etapa do Evo é aplicado em memória (a etapa não está no banco),
  // então busca um lote maior pra não perder leads ao filtrar depois.
  const limite = etapa ? 2000 : temFiltro ? 500 : 10

  let query = supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, cidade, status, data_ultimo_contato, importante, acionar_humano')
    .order('data_ultimo_contato', { ascending: false, nullsFirst: false })
    .limit(limite)

  if (status) query = query.eq('status', status)
  if (importante === 'true') query = query.eq('importante', true)

  if (aguardandoHumano === 'true') {
    query = query
      .eq('acionar_humano', true)
      .not('status', 'in', '("FORMULARIO_ENVIADO","OPT_OUT","NAO_QUALIFICADO","DESCARTADO")')
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

  // Filtro por dia de disparo (formato YYYY-MM-DD em BRT, vem do /campanhas)
  if (disparoDia && /^\d{4}-\d{2}-\d{2}$/.test(disparoDia)) {
    const startBrt = new Date(`${disparoDia}T00:00:00-03:00`)
    const endBrt = new Date(startBrt.getTime() + 24 * 60 * 60 * 1000)
    query = query
      .gte('data_disparo_inicial', startBrt.toISOString())
      .lt('data_disparo_inicial', endBrt.toISOString())
  }

  if (q && q.trim()) {
    const term = q.trim()
    query = query.or(`nome.ilike.%${term}%,telefone.ilike.%${term}%,cidade.ilike.%${term}%`)
  }
  const { data } = await query
  return data ?? []
}

async function getAgora() {
  const now = new Date()
  const duasHorasAtras = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
  const umMinutoAtras = new Date(now.getTime() - 60 * 1000).toISOString()
  const fimDoDia = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()

  const [conversasAtivas, aguardandoHumano, pausados, lockTravado, followupsHoje] = await Promise.all([
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'INTERESSADO')
      .gte('data_ultimo_contato', duasHorasAtras),
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .eq('acionar_humano', true)
      .not('status', 'in', '("FORMULARIO_ENVIADO","OPT_OUT","NAO_QUALIFICADO","DESCARTADO")'),
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .like('observacoes', '%[PAUSA_ATE:%'),
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
  ])

  return {
    conversasAtivas: conversasAtivas.count ?? 0,
    aguardandoHumano: aguardandoHumano.count ?? 0,
    pausados: pausados.count ?? 0,
    lockTravado: lockTravado.count ?? 0,
    followupsHoje: followupsHoje.count ?? 0,
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
async function getPrecisamAtendimento(): Promise<LeadResumo[]> {
  const { data } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, data_ultimo_contato')
    .eq('acionar_humano', true)
    .not('status', 'in', '("OPT_OUT","NAO_QUALIFICADO","DESCARTADO")')
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
}

// Busca as oportunidades abertas do funil AIVA e devolve mapa chaveTel → etapa.
// Falha de rede/API não quebra a página — devolve mapa vazio (mostra "—").
async function getEtapasEvo(): Promise<Record<string, EtapaEvo>> {
  try {
    const opps = await getPipeOpportunities(PIPELINE_AIVA)
    const mapa: Record<string, EtapaEvo> = {}
    for (const o of opps) {
      const k = chaveTel(o.mainphone)
      if (k) mapa[k] = { id: o.fkStage, label: STAGE_LABEL[o.fkStage] ?? `Etapa ${o.fkStage}` }
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
  }>
}) {
  const sp = await searchParams
  const [metricas, leadsRaw, agora, atendimento, quentes, conversasHoje, saude, etapasEvo] = await Promise.all([
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
    ),
    getAgora(),
    getPrecisamAtendimento(),
    getLeadsQuentes(),
    getConversasHoje(),
    getSaude(),
    getEtapasEvo(),
  ])
  // Filtro por etapa do Evo Talks — aplicado em memória (a etapa não está no
  // banco, vem do CRM via getEtapasEvo).
  const leads = sp.etapa
    ? leadsRaw.filter((l) => etapasEvo[chaveTel(l.telefone)]?.id === Number(sp.etapa))
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
      sp.inbound,
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
          hint="acionar_humano = true"
          color={agora.aguardandoHumano > 0 ? 'var(--yellow)' : 'var(--text-muted)'}
          href="/?aguardando_humano=true"
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
          {leads.map((l: { id: string; nome: string; telefone: string; cidade: string | null; status: string; data_ultimo_contato: string | null; importante: boolean; acionar_humano: boolean }) => (
            <ClickableRow key={l.telefone} leadId={l.id}>
              <td>
                {l.importante && <span style={{ color: '#f59e0b', marginRight: 4 }} title="Importante (3+ lojas)">★</span>}
                {l.nome}
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
              </td>
              <td style={{ color: 'var(--text-dim)' }}>{l.telefone}</td>
              <td style={{ color: 'var(--text-dim)' }}>{etapasEvo[chaveTel(l.telefone)]?.label ?? '—'}</td>
              <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {l.data_ultimo_contato
                  ? new Date(l.data_ultimo_contato).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                  : '—'}
              </td>
            </ClickableRow>
          ))}
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
