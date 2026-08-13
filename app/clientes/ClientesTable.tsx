'use client'

import { useMemo, useState } from 'react'
import type { ClienteRow } from '@/lib/clientes'

function abrirLead(leadId: string | null) {
  if (!leadId) return
  window.dispatchEvent(new CustomEvent('open-lead', { detail: leadId }))
}

// Faixas de nº de lojas (n já normalizado por lib/clientes)
const FAIXAS_LOJAS: Record<string, (n: number) => boolean> = {
  '1': (n) => n === 1,
  '2-5': (n) => n >= 2 && n <= 5,
  '6-10': (n) => n >= 6 && n <= 10,
  '+10': (n) => n > 10,
}

// Colunas exibidas, NESTA ordem. `num` = ordenação numérica.
type SortKey = 'cnpj' | 'empresa' | 'telefone' | 'cidade' | 'lojas'
const COLS: { key: SortKey; label: string; num: boolean }[] = [
  { key: 'cnpj', label: 'CNPJ', num: false },
  { key: 'empresa', label: 'Empresa', num: false },
  { key: 'telefone', label: 'Telefone', num: false },
  { key: 'cidade', label: 'Cidade', num: false },
  { key: 'lojas', label: 'Nº de filiais', num: true },
]

const texto = (c: ClienteRow, k: SortKey): string =>
  k === 'cnpj' ? c.cnpj : k === 'empresa' ? c.empresa : k === 'telefone' ? c.telefone : k === 'cidade' ? c.cidade : c.numeroLojas

const sel: React.CSSProperties = {
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '0.4rem 0.5rem',
  fontSize: '0.8rem',
  fontFamily: 'inherit',
}
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.6rem',
  fontSize: '0.72rem',
  fontWeight: 700,
  color: 'var(--text-dim)',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
  position: 'sticky',
  top: 0,
  background: 'var(--bg-elev-2)',
  cursor: 'pointer',
  userSelect: 'none',
}
const td: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  fontSize: '0.8rem',
  color: 'var(--text)',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
}

export default function ClientesTable({ clientes }: { clientes: ClienteRow[] }) {
  const [busca, setBusca] = useState('')
  const [lojas, setLojas] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('empresa')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function ordenarPor(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('asc') }
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return clientes.filter((c) => {
      if (q && !`${c.cnpj} ${c.empresa} ${c.telefone} ${c.cidade}`.toLowerCase().includes(q)) return false
      if (lojas) {
        if (c.numeroLojasN == null || !FAIXAS_LOJAS[lojas](c.numeroLojasN)) return false
      }
      return true
    })
  }, [clientes, busca, lojas])

  const ordenados = useMemo(() => {
    const arr = [...filtrados]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      if (sortKey === 'lojas') {
        const x = a.numeroLojasN, y = b.numeroLojasN
        if (x == null && y == null) return 0
        if (x == null) return 1 // sem nº vai pro fim
        if (y == null) return -1
        return (x - y) * dir
      }
      return texto(a, sortKey).localeCompare(texto(b, sortKey), 'pt-BR', { numeric: true, sensitivity: 'base' }) * dir
    })
    return arr
  }, [filtrados, sortKey, sortDir])

  function exportarCSV() {
    const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`
    const linhas = ordenados.map((c) => [c.cnpj, c.empresa, c.telefone, c.cidade, c.numeroLojas].map(esc).join(','))
    const csv = '﻿' + [COLS.map((col) => esc(col.label)).join(','), ...linhas].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientes-aiva-${ordenados.length}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.9rem' }}>
        <input
          placeholder="🔎 CNPJ, empresa, telefone ou cidade"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ ...sel, minWidth: 260, flex: '1 1 260px' }}
        />
        <select style={sel} value={lojas} onChange={(e) => setLojas(e.target.value)}>
          <option value="">Nº de filiais (todos)</option>
          {Object.keys(FAIXAS_LOJAS).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {(busca || lojas) && (
          <button onClick={() => { setBusca(''); setLojas('') }} style={{ ...sel, cursor: 'pointer' }}>Limpar</button>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {ordenados.length.toLocaleString('pt-BR')} de {clientes.length.toLocaleString('pt-BR')} clientes · clique no cabeçalho pra ordenar
        </span>
        <button
          onClick={exportarCSV}
          style={{ background: 'var(--accent)', color: '#06121a', border: 0, borderRadius: 8, padding: '0.45rem 0.8rem', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ⬇ Exportar CSV
        </button>
      </div>

      {/* Tabela */}
      <div style={{ overflow: 'auto', maxHeight: '74vh', border: '1px solid var(--border)', borderRadius: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
          <thead>
            <tr>
              {COLS.map((col) => (
                <th key={col.key} style={th} onClick={() => ordenarPor(col.key)} title="Ordenar">
                  {col.label}
                  <span style={{ color: 'var(--accent)', marginLeft: 4 }}>
                    {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenados.map((c) => (
              <tr
                key={c.oppId}
                onClick={() => abrirLead(c.leadId)}
                style={{ cursor: c.leadId ? 'pointer' : 'default' }}
                title={c.leadId ? 'Abrir lead' : 'Lead não encontrado no Supabase'}
              >
                <td style={td}>{c.cnpj || '—'}</td>
                <td style={{ ...td, fontWeight: 600 }}>{c.empresa}</td>
                <td style={td}>{c.telefone || '—'}</td>
                <td style={td}>{c.cidade || '—'}</td>
                <td style={td}>{c.numeroLojas || '—'}</td>
              </tr>
            ))}
            {ordenados.length === 0 && (
              <tr><td style={{ ...td, color: 'var(--text-muted)' }} colSpan={COLS.length}>Nenhum cliente com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
