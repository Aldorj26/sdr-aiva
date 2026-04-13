import { supabaseAdmin } from '@/lib/supabase'
import LeadDrawer from './_components/LeadDrawer'
import ClickableRow from './_components/ClickableRow'
import TimelineRow from './_components/TimelineRow'
import SearchBar from './_components/SearchBar'
import { MensagensPorDia, DistribuicaoStatus } from './_components/Charts'

// Dinâmico pra suportar ?q= e ?status= sem cache
export const dynamic = 'force-dynamic'
export const revalidate = 0

// ─── Queries ──────────────────────────────────────────────────────────────────

async function getMetricas() {
  const { data } = await supabaseAdmin.from('sdr_metricas').select('*')
  return data ?? []
}

async function getRecentLeads(q?: string, status?: string, importante?: string) {
  let query = supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, cidade, status, data_ultimo_contato, importante')
    .order('data_ultimo_contato', { ascending: false, nullsFirst: false })
    .limit(q || status || importante ? 50 : 10)

  if (status) query = query.eq('status', status)
  if (importante === 'true') query = query.eq('importante', true)
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

async function getTimeline() {
  const { data } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('id, lead_id, direcao, conteudo, template_hsm, enviado_em, sdr_leads(nome, telefone, status)')
    .order('enviado_em', { ascending: false })
    .limit(300)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    lead_id: string
    direcao: 'in' | 'out'
    conteudo: string
    template_hsm: string | null
    enviado_em: string
    sdr_leads: { nome: string; telefone: string; status: string } | null
  }>

  const seen = new Set<string>()
  const unique: typeof rows = []
  for (const r of rows) {
    if (seen.has(r.lead_id)) continue
    seen.add(r.lead_id)
    unique.push(r)
    if (unique.length >= 20) break
  }
  return unique
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

async function getAgenda() {
  const em24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, cidade, status, etapa_cadencia, data_proximo_followup')
    .lte('data_proximo_followup', em24h)
    .not('data_proximo_followup', 'is', null)
    .not('status', 'in', '("OPT_OUT","NAO_QUALIFICADO","DESCARTADO","FORMULARIO_ENVIADO")')
    .order('data_proximo_followup', { ascending: true })
    .limit(20)
  return data ?? []
}

/**
 * Mensagens por dia — últimos 7 dias, dividido em recebidas/enviadas
 */
async function getMensagensPorDia() {
  const sete = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('direcao, enviado_em')
    .gte('enviado_em', sete)
    .limit(5000)

  const buckets: Record<string, { recebidas: number; enviadas: number }> = {}
  // Inicializa os 7 dias (label DD/MM)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets[key] = { recebidas: 0, enviadas: 0 }
  }
  for (const m of (data ?? []) as Array<{ direcao: string; enviado_em: string }>) {
    const d = new Date(m.enviado_em)
    const key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!buckets[key]) continue
    if (m.direcao === 'in') buckets[key].recebidas++
    else buckets[key].enviadas++
  }
  return Object.entries(buckets).map(([dia, v]) => ({ dia, ...v }))
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

function fmtFuturo(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) {
    const min = Math.floor(-diff / 60000)
    if (min < 60) return `atrasado ${min}m`
    const h = Math.floor(min / 60)
    if (h < 24) return `atrasado ${h}h`
    return `atrasado ${Math.floor(h / 24)}d`
  }
  const min = Math.floor(diff / 60000)
  if (min < 60) return `em ${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `em ${h}h`
  return `em ${Math.floor(h / 24)}d`
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
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

// ─── Página ───────────────────────────────────────────────────────────────────

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; importante?: string }>
}) {
  const sp = await searchParams
  const [metricas, leads, agora, timeline, agenda, saude, msgsPorDia] = await Promise.all([
    getMetricas(),
    getRecentLeads(sp.q, sp.status, sp.importante),
    getAgora(),
    getTimeline(),
    getAgenda(),
    getSaude(),
    getMensagensPorDia(),
  ])
  const filtroAtivo = Boolean(sp.q || sp.status || sp.importante)
  const total = metricas.reduce((s: number, m: { total: number }) => s + Number(m.total), 0)

  // Funil
  const porStatus: Record<string, number> = {}
  for (const m of metricas) porStatus[m.status] = Number(m.total)
  const disparados = total
  const responderam =
    (porStatus['INTERESSADO'] ?? 0) +
    (porStatus['AGUARDANDO'] ?? 0) +
    (porStatus['FORMULARIO_ENVIADO'] ?? 0) +
    (porStatus['NAO_QUALIFICADO'] ?? 0) +
    (porStatus['OPT_OUT'] ?? 0)
  const interessados =
    (porStatus['INTERESSADO'] ?? 0) +
    (porStatus['AGUARDANDO'] ?? 0) +
    (porStatus['FORMULARIO_ENVIADO'] ?? 0)
  const qualificados = porStatus['FORMULARIO_ENVIADO'] ?? 0
  const funil = [
    { label: 'Disparados', value: disparados, color: '#6b7280' },
    { label: 'Responderam', value: responderam, color: '#fb923c' },
    { label: 'Interessados', value: interessados, color: '#34d399' },
    { label: 'Qualificados', value: qualificados, color: '#60a5fa' },
  ]
  const funilMax = Math.max(...funil.map((f) => f.value), 1)

  // Dados pro gráfico de pizza (métricas por status)
  const statusChart = metricas.map((m: { status: string; total: number }) => ({
    status: m.status,
    total: Number(m.total),
  }))

  return (
    <main>
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <header style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #60a5fa, #a78bfa)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
            }}
          >
            🤖
          </div>
          <div>
            <h1>SDR Agent AIVA</h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              Track Tecnologia · VictorIA · {new Date().toLocaleString('pt-BR')}
            </p>
          </div>
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
        />
        <Card
          label="Aguardando humano"
          value={agora.aguardandoHumano}
          hint="acionar_humano = true"
          color={agora.aguardandoHumano > 0 ? 'var(--yellow)' : 'var(--text-muted)'}
        />
        <Card
          label="Pausados"
          value={agora.pausados}
          hint="flag [PAUSA_ATE:]"
          color="var(--purple)"
        />
        <Card
          label="Follow-ups hoje"
          value={agora.followupsHoje}
          hint="próximo_followup ≤ hoje"
          color="var(--accent)"
        />
        <Card
          label="Lock travado"
          value={agora.lockTravado}
          hint="webhook_lock_at > 60s"
          color={agora.lockTravado > 0 ? 'var(--red)' : 'var(--text-muted)'}
        />
      </div>

      {/* ─── Gráficos ──────────────────────────────────────────────────── */}
      <h2>Tendências</h2>
      <div className="grid-2">
        <MensagensPorDia data={msgsPorDia} />
        <DistribuicaoStatus data={statusChart} />
      </div>

      {/* ─── Funil ─────────────────────────────────────────────────────── */}
      <h2>Funil de conversão</h2>
      <div className="funnel">
        {funil.map((f, i) => {
          const pct = (f.value / funilMax) * 100
          const conv = i === 0 ? null : funil[i - 1].value > 0 ? (f.value / funil[i - 1].value) * 100 : 0
          return (
            <div key={f.label} className="funnel-row">
              <div className="funnel-label">
                <span style={{ color: 'var(--text-dim)' }}>
                  {f.label} <strong style={{ color: f.color, marginLeft: 6 }}>{f.value}</strong>
                </span>
                {conv !== null && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {conv.toFixed(1)}% da etapa anterior
                  </span>
                )}
              </div>
              <div className="funnel-bar-bg">
                <div
                  className="funnel-bar-fill"
                  style={{ width: `${pct}%`, background: f.color }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* ─── Timeline + Agenda (lado a lado) ──────────────────────────── */}
      <div className="grid-2">
        <div>
          <div className="section-header">
            <h2 style={{ margin: 0 }}>Timeline de atividade</h2>
            <span className="section-sub">última msg por lead</span>
          </div>
          <div className="timeline">
            {timeline.length === 0 && (
              <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>Sem mensagens ainda.</div>
            )}
            {timeline.map((m) => {
              const nomeBase = m.sdr_leads?.nome ?? '?'
              const nomeGenerico = nomeBase === 'Loja' || nomeBase === 'Lead'
              const nomeExibido = nomeGenerico && m.sdr_leads?.telefone
                ? `${nomeBase} (${m.sdr_leads.telefone.slice(-4)})`
                : nomeBase
              const ehIn = m.direcao === 'in'
              return (
                <TimelineRow key={m.id} leadId={m.lead_id}>
                  <span className="timeline-time">{fmtRelativo(m.enviado_em)}</span>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: ehIn ? 'var(--green)' : 'var(--accent)',
                      flexShrink: 0,
                    }}
                  />
                  <span className="timeline-actor">{nomeExibido}</span>
                  <span className="timeline-text">{truncate(m.conteudo, 90)}</span>
                </TimelineRow>
              )
            })}
          </div>
        </div>

        <div>
          <div className="section-header">
            <h2 style={{ margin: 0 }}>Agenda de follow-ups</h2>
            <span className="section-sub">atrasados + próximas 24h</span>
          </div>
          {agenda.length === 0 ? (
            <div
              className="timeline"
              style={{ padding: '1rem', color: 'var(--text-muted)' }}
            >
              Nada agendado nas próximas 24h.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Lead</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {agenda.map((l: { id: string; nome: string; telefone: string; etapa_cadencia: number; status: string; data_proximo_followup: string | null }) => {
                  const atrasado = l.data_proximo_followup && new Date(l.data_proximo_followup).getTime() < Date.now()
                  return (
                    <ClickableRow key={l.telefone} leadId={l.id}>
                      <td style={{ color: atrasado ? 'var(--red)' : 'var(--text-dim)', fontSize: '0.78rem' }}>
                        {l.data_proximo_followup ? fmtFuturo(l.data_proximo_followup) : '—'}
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>D+{l.etapa_cadencia}</div>
                      </td>
                      <td>
                        <div style={{ color: 'var(--text)' }}>{l.nome}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{l.telefone}</div>
                      </td>
                      <td><StatusPill status={l.status} /></td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─── Leads / Busca ────────────────────────────────────────────── */}
      <div className="section-header">
        <h2 style={{ margin: 0 }}>
          {filtroAtivo ? `Leads encontrados (${leads.length})` : 'Últimas interações'}
        </h2>
        <span className="section-sub">total: {total}</span>
      </div>
      <SearchBar />
      <table className="tbl">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Telefone</th>
            <th>Cidade</th>
            <th>Status</th>
            <th>Último contato</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l: { id: string; nome: string; telefone: string; cidade: string | null; status: string; data_ultimo_contato: string | null; importante: boolean }) => (
            <ClickableRow key={l.telefone} leadId={l.id}>
              <td>
                {l.importante && <span style={{ color: '#f59e0b', marginRight: 4 }} title="Importante (3+ lojas)">★</span>}
                {l.nome}
              </td>
              <td style={{ color: 'var(--text-dim)' }}>{l.telefone}</td>
              <td style={{ color: 'var(--text-dim)' }}>{l.cidade ?? '—'}</td>
              <td><StatusPill status={l.status} /></td>
              <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {l.data_ultimo_contato
                  ? new Date(l.data_ultimo_contato).toLocaleString('pt-BR')
                  : '—'}
              </td>
            </ClickableRow>
          ))}
        </tbody>
      </table>

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
      <div className="card-hint">{new Date(iso).toLocaleString('pt-BR')}</div>
    </div>
  )
}

function Card({
  label,
  value,
  hint,
  color,
}: {
  label: string
  value: number
  hint: string
  color: string
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value" style={{ color }}>{value}</div>
      <div className="card-hint">{hint}</div>
    </div>
  )
}
