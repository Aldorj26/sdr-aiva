'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

const STATUSES = [
  'DISPARO_REALIZADO',
  'INTERESSADO',
  'AGUARDANDO',
  'FORMULARIO_ENVIADO',
  'SEM_RESPOSTA',
  'NAO_QUALIFICADO',
  'OPT_OUT',
  'DESCARTADO',
]

export default function SearchBar() {
  const router = useRouter()
  const sp = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [status, setStatus] = useState(sp.get('status') ?? '')
  const [importante, setImportante] = useState(sp.get('importante') === 'true')

  function apply(nextQ: string, nextStatus: string, nextImportante: boolean) {
    const params = new URLSearchParams()
    if (nextQ.trim()) params.set('q', nextQ.trim())
    if (nextStatus) params.set('status', nextStatus)
    if (nextImportante) params.set('importante', 'true')
    router.push(params.toString() ? `/?${params.toString()}` : '/')
  }

  const inputStyle: React.CSSProperties = {
    background: '#0f0f0f',
    border: '1px solid #222',
    color: '#eee',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.25rem',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '0.5rem 0 0' }}>
      {/* Linha 1: input de busca */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          apply(q, status, importante)
        }}
      >
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, telefone ou cidade…"
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
        />
      </form>
      {/* Linha 2: filtros */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            apply(q, e.target.value, importante)
          }}
          style={inputStyle}
        >
          <option value="">Todos os status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const next = !importante
            setImportante(next)
            apply(q, status, next)
          }}
          style={{
            background: importante ? '#f59e0b22' : 'transparent',
            border: importante ? '1px solid #f59e0b55' : '1px solid #333',
            color: importante ? '#f59e0b' : '#888',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.25rem',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: '0.85rem',
            fontWeight: importante ? 600 : 400,
            whiteSpace: 'nowrap',
          }}
        >
          ★ Importante
        </button>
        {(q || status || importante) && (
          <button
            onClick={() => {
              setQ('')
              setStatus('')
              setImportante(false)
              router.push('/')
            }}
            style={{
              background: 'transparent',
              border: '1px solid #333',
              color: '#888',
              padding: '0.5rem 0.75rem',
              borderRadius: '0.25rem',
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
