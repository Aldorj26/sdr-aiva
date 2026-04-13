'use client'

import { useEffect, useState } from 'react'

interface Lead {
  id: string
  nome: string
  telefone: string
  cidade: string | null
  produto: string
  status: string
  etapa_cadencia: number
  evotalks_chat_id: string | null
  evotalks_opportunity_id: string | null
  data_disparo_inicial: string | null
  data_proximo_followup: string | null
  data_ultimo_contato: string | null
  acionar_humano: boolean
  observacoes: string | null
  criado_em: string
  webhook_lock_at: string | null
}

interface Mensagem {
  id: string
  direcao: 'in' | 'out'
  conteudo: string
  template_hsm: string | null
  enviado_em: string
}

const STATUS_COLOR: Record<string, string> = {
  DISPARO_REALIZADO: '#888',
  INTERESSADO: '#4ade80',
  FORMULARIO_ENVIADO: '#60a5fa',
  SEM_RESPOSTA: '#f59e0b',
  OPT_OUT: '#ef4444',
  NAO_QUALIFICADO: '#ef4444',
  AGUARDANDO: '#a78bfa',
  DESCARTADO: '#6b7280',
}

export default function LeadDrawer() {
  const [leadId, setLeadId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ lead: Lead; mensagens: Mensagem[] } | null>(null)
  const [busy, setBusy] = useState(false)

  async function runAction(body: object, confirmMsg?: string) {
    if (!leadId) return
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/leads/${leadId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        window.alert(`Erro: ${json.error ?? 'desconhecido'}`)
        return
      }
      setLeadId(null)
      // força refresh da página pra atualizar contadores
      window.location.reload()
    } catch (err) {
      window.alert(`Erro: ${err}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<string>
      setLeadId(ce.detail)
    }
    window.addEventListener('open-lead', handler)
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLeadId(null)
    }
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('open-lead', handler)
      window.removeEventListener('keydown', esc)
    }
  }, [])

  useEffect(() => {
    if (!leadId) {
      setData(null)
      return
    }
    setLoading(true)
    fetch(`/api/leads/${leadId}/detail`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setData(null)
          return
        }
        setData(json)
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [leadId])

  if (!leadId) return null

  return (
    <div
      onClick={() => setLeadId(null)}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 100,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(700px, 90vw)',
          height: '100%',
          background: '#0a0a0a',
          borderLeft: '1px solid #333',
          overflowY: 'auto',
          padding: '1.5rem',
          color: '#eee',
          fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
            {data?.lead.nome ?? (loading ? 'Carregando…' : 'Lead')}
          </h2>
          <button
            onClick={() => setLeadId(null)}
            style={{
              background: 'transparent',
              border: '1px solid #333',
              color: '#888',
              padding: '0.25rem 0.75rem',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ✕ Fechar
          </button>
        </div>

        {loading && !data && <p style={{ color: '#666' }}>Carregando dados…</p>}

        {data && (
          <>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <ActionBtn
                disabled={busy}
                onClick={() => runAction({ type: 'pause', hours: 24 }, 'Pausar esse lead por 24h?')}
                color="#a78bfa"
              >
                ⏸ Pausar 24h
              </ActionBtn>
              <ActionBtn
                disabled={busy}
                onClick={() => runAction({ type: 'pause', hours: 72 }, 'Pausar esse lead por 3 dias?')}
                color="#a78bfa"
              >
                ⏸ Pausar 3d
              </ActionBtn>
              {data.lead.observacoes?.includes('[PAUSA_ATE:') && (
                <ActionBtn
                  disabled={busy}
                  onClick={() => runAction({ type: 'unpause' })}
                  color="#4ade80"
                >
                  ▶ Despausar
                </ActionBtn>
              )}
              <ActionBtn
                disabled={busy}
                onClick={() => runAction({ type: 'force-followup' }, 'Agendar follow-up imediato?')}
                color="#60a5fa"
              >
                ⏩ Follow-up agora
              </ActionBtn>
              {data.lead.webhook_lock_at && (
                <ActionBtn
                  disabled={busy}
                  onClick={() => runAction({ type: 'unlock' })}
                  color="#f59e0b"
                >
                  🔓 Liberar lock
                </ActionBtn>
              )}
              <ActionBtn
                disabled={busy}
                onClick={() => runAction({ type: 'mark-descartado' }, 'Marcar esse lead como DESCARTADO?')}
                color="#ef4444"
              >
                ✖ Descartar
              </ActionBtn>
            </div>

            <div style={{ marginTop: '1rem', fontSize: '0.85rem', lineHeight: 1.7 }}>
              <Row label="Telefone" value={data.lead.telefone} />
              <Row label="Cidade" value={data.lead.cidade ?? '—'} />
              <Row
                label="Status"
                value={
                  <span style={{ color: STATUS_COLOR[data.lead.status] ?? '#fff' }}>
                    {data.lead.status}
                  </span>
                }
              />
              <Row label="Etapa" value={`D+${data.lead.etapa_cadencia}`} />
              <Row
                label="Último contato"
                value={
                  data.lead.data_ultimo_contato
                    ? new Date(data.lead.data_ultimo_contato).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                    : '—'
                }
              />
              <Row
                label="Próximo follow-up"
                value={
                  data.lead.data_proximo_followup
                    ? new Date(data.lead.data_proximo_followup).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                    : '—'
                }
              />
              <Row
                label="Acionar humano"
                value={
                  data.lead.acionar_humano ? (
                    <span style={{ color: '#f59e0b' }}>SIM</span>
                  ) : (
                    'não'
                  )
                }
              />
              <Row
                label="Oportunidade CRM"
                value={data.lead.evotalks_opportunity_id ?? '—'}
              />
              {data.lead.observacoes && (
                <Row label="Observações" value={data.lead.observacoes} />
              )}
            </div>

            <h3 style={{ marginTop: '1.5rem', fontSize: '1rem', color: '#888' }}>
              Histórico de mensagens ({data.mensagens.length})
            </h3>
            <div style={{ marginTop: '0.5rem' }}>
              {data.mensagens.length === 0 && (
                <p style={{ color: '#666' }}>Sem mensagens ainda.</p>
              )}
              {data.mensagens.map((m) => {
                const mine = m.direcao === 'out'
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: mine ? 'flex-end' : 'flex-start',
                      margin: '0.5rem 0',
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '75%',
                        background: mine ? '#1e3a5f' : '#1a1a1a',
                        border: `1px solid ${mine ? '#2d5a8c' : '#2a2a2a'}`,
                        padding: '0.6rem 0.9rem',
                        borderRadius: '0.75rem',
                        fontSize: '0.85rem',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {m.template_hsm && (
                        <div style={{ color: '#888', fontSize: '0.7rem', marginBottom: '0.25rem' }}>
                          📢 HSM: {m.template_hsm}
                        </div>
                      )}
                      <div>{m.conteudo}</div>
                      <div style={{ color: '#555', fontSize: '0.7rem', marginTop: '0.3rem' }}>
                        {new Date(m.enviado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ActionBtn({
  children,
  onClick,
  color,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  color: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: '#111',
        border: `1px solid ${color}`,
        color,
        padding: '0.35rem 0.7rem',
        borderRadius: '0.25rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        fontSize: '0.8rem',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #151515', padding: '0.35rem 0' }}>
      <span style={{ width: 160, color: '#666' }}>{label}</span>
      <span style={{ flex: 1 }}>{value}</span>
    </div>
  )
}
