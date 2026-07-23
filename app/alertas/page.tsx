import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface Alerta {
  id: string
  tipo: string | null
  mensagem: string
  entregue: boolean
  criado_em: string
}

// Rótulo legível por tipo (emoji inicial do alerta).
const ROTULO: Record<string, string> = {
  '🟡': 'Pré-aprovação',
  '✅': 'Cadastro completo',
  '📋': 'Dados de colaborador',
  '🔔': 'Atendimento humano',
  '🆕': 'Novo lead inbound',
  '🎓': 'Treinar',
  '🔎': 'Em Análise AIVA',
  '🔑': 'Login',
  '🏆': 'Loja vendendo',
  '🚨': 'Travado / urgente',
  '🔕': 'Reengajamento esgotado',
  'ℹ️': 'Info',
}

async function getAlertas(tipo?: string, busca?: string): Promise<Alerta[]> {
  let q = supabaseAdmin
    .from('sdr_alertas')
    .select('id, tipo, mensagem, entregue, criado_em')
    .order('criado_em', { ascending: false })
    .limit(200)
  if (tipo) q = q.eq('tipo', tipo)
  if (busca && busca.trim()) {
    // Busca no texto do alerta — cobre sócio, telefone, email, loja, CNPJ, cidade etc.
    // Escapa % e _ pra não virarem curinga do LIKE.
    const termo = busca.trim().replace(/[%_]/g, (m) => `\\${m}`)
    q = q.ilike('mensagem', `%${termo}%`)
  }
  const { data } = await q
  return (data ?? []) as Alerta[]
}

async function getContagens(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin
    .from('sdr_alertas')
    .select('tipo')
    .gte('criado_em', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .limit(5000)
  const c: Record<string, number> = {}
  for (const r of data ?? []) c[(r as { tipo: string }).tipo ?? '•'] = (c[(r as { tipo: string }).tipo ?? '•'] ?? 0) + 1
  return c
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
}

export default async function AlertasPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; q?: string }>
}) {
  const sp = await searchParams
  const [alertas, contagens] = await Promise.all([getAlertas(sp.tipo, sp.q), getContagens()])

  const chip = (label: string, tipo?: string, count?: number) => {
    const ativo = (sp.tipo ?? '') === (tipo ?? '')
    const params = new URLSearchParams()
    if (tipo) params.set('tipo', tipo)
    if (sp.q) params.set('q', sp.q)
    const href = params.toString() ? `/alertas?${params.toString()}` : '/alertas'
    return (
      <Link
        key={tipo ?? 'todos'}
        href={href}
        style={{
          textDecoration: 'none',
          fontSize: '0.8rem',
          padding: '0.35rem 0.7rem',
          borderRadius: 20,
          border: `1px solid ${ativo ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: ativo ? '#fff3e9' : 'var(--bg-elev)',
          color: ativo ? '#c2410c' : 'var(--text-dim)',
          fontWeight: ativo ? 600 : 400,
          whiteSpace: 'nowrap',
        }}
      >
        {label}{typeof count === 'number' ? ` (${count})` : ''}
      </Link>
    )
  }

  return (
    <main>
      <header style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            href="/"
            style={{
              color: 'var(--text-dim)', textDecoration: 'none', fontSize: '0.85rem',
              padding: '0.35rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-elev)',
            }}
          >
            ← Voltar
          </Link>
          <h1 style={{ margin: 0 }}>Alertas</h1>
        </div>
        <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Histórico dos avisos enviados pro WhatsApp do Nei e do Aldo — registrado aqui pra acompanhamento. Últimos 200.
        </p>
      </header>

      {/* Busca no conteúdo do alerta (sócio, telefone, email, loja, CNPJ, cidade...) */}
      <form action="/alertas" method="get" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {sp.tipo && <input type="hidden" name="tipo" value={sp.tipo} />}
        <input
          type="text"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Buscar por sócio, telefone, email, loja, CNPJ, cidade…"
          style={{
            flex: 1, background: 'var(--bg-elev)', border: '1px solid var(--border-strong)',
            color: 'var(--text)', padding: '0.5rem 0.75rem', borderRadius: 8, fontFamily: 'inherit', fontSize: '0.85rem',
          }}
        />
        <button
          type="submit"
          style={{
            background: 'var(--accent)', border: 'none', color: '#fff', padding: '0.5rem 1rem',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
          }}
        >
          Buscar
        </button>
        {sp.q && (
          <Link
            href={sp.tipo ? `/alertas?tipo=${encodeURIComponent(sp.tipo)}` : '/alertas'}
            style={{
              display: 'flex', alignItems: 'center', padding: '0.5rem 0.75rem', borderRadius: 8,
              border: '1px solid var(--border-strong)', background: 'var(--bg-elev)', color: 'var(--text-muted)',
              textDecoration: 'none', fontSize: '0.8rem',
            }}
          >
            ✕ Limpar
          </Link>
        )}
      </form>
      {sp.q && (
        <p style={{ margin: '0 0 0.75rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          {alertas.length} resultado(s) para “{sp.q}”
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {chip('Todos')}
        {Object.entries(contagens)
          .sort((a, b) => b[1] - a[1])
          .map(([tipo, n]) => chip(`${tipo} ${ROTULO[tipo] ?? 'Outro'}`, tipo, n))}
      </div>

      {alertas.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Nenhum alerta ainda.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {alertas.map((a) => (
            <div
              key={a.id}
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--border)',
                borderLeft: `3px solid ${a.entregue ? 'var(--accent)' : 'var(--red)'}`,
                borderRadius: 8,
                padding: '0.75rem 0.9rem',
                boxShadow: 'var(--shadow)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-dim)' }}>
                  {a.tipo} {ROTULO[a.tipo ?? ''] ?? 'Alerta'}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {!a.entregue && <span style={{ color: 'var(--red)', fontWeight: 600 }}>não entregue</span>}
                  {fmt(a.criado_em)}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                {a.mensagem}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
