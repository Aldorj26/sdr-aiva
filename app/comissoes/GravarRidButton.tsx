'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Botão "gravar Retailer ID": aparece nas linhas ⚠️ que casaram por CNPJ.
 * Escreve "UME_RID: n" na descrição da opp do funil 11 e recarrega.
 */
export default function GravarRidButton({ opportunityId, retailerId }: { opportunityId: number; retailerId: number }) {
  const router = useRouter()
  const [estado, setEstado] = useState<'idle' | 'salvando' | 'ok' | 'erro'>('idle')
  const [erro, setErro] = useState('')

  async function gravar() {
    setEstado('salvando')
    try {
      const res = await fetch('/api/comissoes/gravar-rid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId, retailerId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setEstado('ok')
      router.refresh()
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err))
      setEstado('erro')
    }
  }

  if (estado === 'ok') return <span style={{ color: '#16a34a', fontSize: '0.75rem' }}>✓ gravado</span>
  if (estado === 'erro') return <span title={erro} style={{ color: '#dc2626', fontSize: '0.75rem', cursor: 'help' }}>✗ falhou</span>
  return (
    <button
      onClick={gravar}
      disabled={estado === 'salvando'}
      title={`Gravar UME_RID: ${retailerId} na descrição da oportunidade #${opportunityId}`}
      style={{
        padding: '0.2rem 0.55rem', borderRadius: 5, border: '1px solid var(--accent)',
        background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.72rem', whiteSpace: 'nowrap',
      }}
    >
      {estado === 'salvando' ? '…' : `gravar RID ${retailerId}`}
    </button>
  )
}
