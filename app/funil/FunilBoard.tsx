'use client'

export interface LeadCard {
  id: string
  nome: string
  telefone: string
  cidade: string | null
  status: string
  data_ultimo_contato: string | null
  importante: boolean
  acionar_humano: boolean
}

// Etapas REAIS do pipeline 15 da Evo, na ordem de progressão (mesma fonte do
// briefing das 5h). As chaves batem com STAGE_TO_STATUS de lib/evotalks.
const ETAPAS: { status: string; label: string; cor: string }[] = [
  { status: 'INICIO', label: 'Início', cor: '#64748b' },
  { status: 'INTERESSADO', label: 'Interessado', cor: '#16a34a' },
  { status: 'SEM_RESPOSTA', label: 'Sem resposta', cor: '#d97706' },
  { status: 'PRE_APROVACAO', label: 'Pré Aprovação', cor: '#0891b2' },
  { status: 'CADASTRO_RECEBIDO', label: 'Cadastro Recebido', cor: '#2563eb' },
  { status: 'EM_ANALISE_AIVA', label: 'Em Análise AIVA', cor: '#c026d3' },
  { status: 'TREINAR', label: 'Treinar', cor: '#059669' },
  { status: 'LOGIN', label: 'Login', cor: '#7c3aed' },
  { status: 'LOJA_FINALIZADA_E_VENDENDO', label: 'Loja Finalizada e Vendendo', cor: '#15803d' },
]

// Fora do fluxo ativo (etapa da Evo, mas não é progressão de venda).
const ETAPAS_FORA: { status: string; label: string; cor: string }[] = [
  { status: 'BOT_DETECTADO', label: 'Bot detectado', cor: '#94a3b8' },
]

const CARDS_POR_COLUNA = 40

function tempoAtras(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'agora há pouco'
  if (h < 24) return `${h}h atrás`
  const d = Math.floor(h / 24)
  return `${d}d atrás`
}

function abrirLead(id: string) {
  window.dispatchEvent(new CustomEvent('open-lead', { detail: id }))
}

export default function FunilBoard({
  counts,
  leads,
}: {
  counts: Record<string, number>
  leads: LeadCard[]
}) {
  const porStatus: Record<string, LeadCard[]> = {}
  for (const l of leads) {
    ;(porStatus[l.status] ??= []).push(l)
  }

  return (
    <>
      <Board etapas={ETAPAS} counts={counts} porStatus={porStatus} />

      <h2 style={{ marginTop: '2rem' }}>Fora do fluxo ativo</h2>
      <Board etapas={ETAPAS_FORA} counts={counts} porStatus={porStatus} />
    </>
  )
}

function Board({
  etapas,
  counts,
  porStatus,
}: {
  etapas: { status: string; label: string; cor: string }[]
  counts: Record<string, number>
  porStatus: Record<string, LeadCard[]>
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.85rem',
        overflowX: 'auto',
        paddingBottom: '0.75rem',
      }}
    >
      {etapas.map((etapa) => {
        const cards = porStatus[etapa.status] ?? []
        const total = counts[etapa.status] ?? 0
        const mostrados = Math.min(cards.length, CARDS_POR_COLUNA)
        const escondidos = Math.max(0, total - mostrados)
        return (
          <div
            key={etapa.status}
            style={{
              flex: '0 0 250px',
              background: 'var(--bg-elev-2)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '0.6rem',
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Cabeçalho da coluna */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.2rem 0.35rem 0.6rem',
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: 'var(--text)',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: etapa.cor,
                    flexShrink: 0,
                  }}
                />
                {etapa.label}
              </span>
              <span
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: 'var(--text-dim)',
                  padding: '0.05rem 0.45rem',
                }}
              >
                {total.toLocaleString('pt-BR')}
              </span>
            </div>

            {/* Cards */}
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {cards.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '0.5rem 0.35rem' }}>
                  Sem leads recentes.
                </div>
              )}
              {cards.slice(0, CARDS_POR_COLUNA).map((lead) => (
                <div
                  key={lead.id}
                  onClick={() => abrirLead(lead.id)}
                  style={{
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '0.5rem 0.6rem',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {lead.importante && <span title="Importante">⭐ </span>}
                    {lead.acionar_humano && <span title="Acionar humano">🔔 </span>}
                    {lead.nome}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    {lead.telefone}
                    {lead.cidade ? ` · ${lead.cidade}` : ''}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    {tempoAtras(lead.data_ultimo_contato)}
                  </div>
                </div>
              ))}
              {escondidos > 0 && (
                <a
                  href={`/?status=${encodeURIComponent(etapa.status)}`}
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    fontWeight: 600,
                    padding: '0.35rem',
                    textAlign: 'center',
                  }}
                >
                  + {escondidos.toLocaleString('pt-BR')} leads → ver todos
                </a>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
