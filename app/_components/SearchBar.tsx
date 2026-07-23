'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

// Status da conversa conduzida pela VictorIA (campo `status` no banco)
const STATUS_CONVERSA = [
  'DISPARO_REALIZADO',
  'INTERESSADO',
  'AGUARDANDO',
  'FORMULARIO_ENVIADO',
  'SEM_RESPOSTA',
  'NAO_QUALIFICADO',
  'OPT_OUT',
  'BOT_DETECTADO',
  'DESCARTADO',
]

// Etapas do funil AIVA no Evo Talks (id da etapa → rótulo).
// IDs confirmados com Aldo em 2026-05-18. Ordem = ordem do funil.
const ETAPAS_EVO: { id: number; label: string }[] = [
  { id: 66, label: 'Início' },
  { id: 47, label: 'Interessado' },
  { id: 53, label: 'Interessado sem resposta' },
  { id: 54, label: 'Pré-aprovação' },
  { id: 49, label: 'Cadastro recebido' },
  { id: 50, label: 'Em análise AIVA' },
  { id: 70, label: 'Treinar' },
  { id: 71, label: 'Login' },
  { id: 51, label: 'Loja finalizada e vendendo' },
  { id: 69, label: 'Bot detectado' },
]

export default function SearchBar() {
  const router = useRouter()
  const sp = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [status, setStatus] = useState(sp.get('status') ?? '')
  const [etapa, setEtapa] = useState(sp.get('etapa') ?? '')
  const [importante, setImportante] = useState(sp.get('importante') === 'true')
  const [atendimentoHumano, setAtendimentoHumano] = useState(sp.get('aguardando_humano') === 'true')
  const [inbound, setInbound] = useState(sp.get('inbound') === 'true')

  function apply(
    nextQ: string,
    nextStatus: string,
    nextEtapa: string,
    nextImportante: boolean,
    nextAH: boolean,
    nextInbound: boolean,
  ) {
    const params = new URLSearchParams()
    if (nextQ.trim()) params.set('q', nextQ.trim())
    if (nextStatus) params.set('status', nextStatus)
    if (nextEtapa) params.set('etapa', nextEtapa)
    if (nextImportante) params.set('importante', 'true')
    if (nextAH) params.set('aguardando_humano', 'true')
    if (nextInbound) params.set('inbound', 'true')
    router.push(params.toString() ? `/?${params.toString()}` : '/')
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-elev)',
    border: '1px solid var(--border-strong)',
    color: 'var(--text)',
    padding: '0.5rem 0.75rem',
    borderRadius: '8px',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '0.5rem 0 0' }}>
      {/* Linha 1: input de busca */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          apply(q, status, etapa, importante, atendimentoHumano, inbound)
        }}
      >
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, telefone, cidade, sócio, email, CNPJ, faturamento…"
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
        />
      </form>
      {/* Linha 2: filtros */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            apply(q, e.target.value, etapa, importante, atendimentoHumano, inbound)
          }}
          style={inputStyle}
        >
          <option value="">Status da conversa</option>
          {STATUS_CONVERSA.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={etapa}
          onChange={(e) => {
            setEtapa(e.target.value)
            apply(q, status, e.target.value, importante, atendimentoHumano, inbound)
          }}
          style={inputStyle}
        >
          <option value="">Etapa do funil (Evo)</option>
          {ETAPAS_EVO.map((et) => (
            <option key={et.id} value={et.id}>
              {et.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const next = !atendimentoHumano
            setAtendimentoHumano(next)
            apply(q, status, etapa, importante, next, inbound)
          }}
          style={{
            background: atendimentoHumano ? '#fef3c7' : 'var(--bg-elev)',
            border: atendimentoHumano ? '1px solid #d97706' : '1px solid var(--border-strong)',
            color: atendimentoHumano ? '#b45309' : 'var(--text-muted)',
            padding: '0.5rem 0.75rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
            fontWeight: atendimentoHumano ? 600 : 400,
            whiteSpace: 'nowrap',
          }}
        >
          🔔 Atendimento humano
        </button>
        <button
          onClick={() => {
            const next = !importante
            setImportante(next)
            apply(q, status, etapa, next, atendimentoHumano, inbound)
          }}
          style={{
            background: importante ? '#fff3e9' : 'var(--bg-elev)',
            border: importante ? '1px solid #f97316' : '1px solid var(--border-strong)',
            color: importante ? '#c2410c' : 'var(--text-muted)',
            padding: '0.5rem 0.75rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
            fontWeight: importante ? 600 : 400,
            whiteSpace: 'nowrap',
          }}
        >
          ★ Importante
        </button>
        <button
          onClick={() => {
            const next = !inbound
            setInbound(next)
            apply(q, status, etapa, importante, atendimentoHumano, next)
          }}
          style={{
            background: inbound ? '#e0f2fe' : 'var(--bg-elev)',
            border: inbound ? '1px solid #0284c7' : '1px solid var(--border-strong)',
            color: inbound ? '#075985' : 'var(--text-muted)',
            padding: '0.5rem 0.75rem',
            borderRadius: '8px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
            fontWeight: inbound ? 600 : 400,
            whiteSpace: 'nowrap',
          }}
        >
          📥 Inbound
        </button>
        {(q || status || etapa || importante || atendimentoHumano || inbound) && (
          <button
            onClick={() => {
              setQ('')
              setStatus('')
              setEtapa('')
              setImportante(false)
              setAtendimentoHumano(false)
              setInbound(false)
              router.push('/')
            }}
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-muted)',
              padding: '0.5rem 0.75rem',
              borderRadius: '8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '0.8rem',
            }}
          >
            ✕ Limpar
          </button>
        )}
      </div>
    </div>
  )
}
