'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Botão "✓ Atendido" fora do drawer (página /atendimento): usa a MESMA ação
 * mark-atendido do drawer — tira o lead da fila e devolve pra VictorIA.
 */
export default function AtendidoButton({ leadId }: { leadId: string }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  return (
    <button
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation()
        if (!confirm('Marcar como atendido? O lead sai da fila e volta pra automação da VictorIA.')) return
        setBusy(true)
        try {
          await fetch(`/api/leads/${leadId}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'mark-atendido' }),
          })
          router.refresh()
        } finally {
          setBusy(false)
        }
      }}
      style={{
        fontSize: '0.72rem', padding: '2px 9px', borderRadius: 6, cursor: 'pointer',
        border: '1px solid var(--border-strong)', background: 'var(--bg-elev)', color: 'var(--green, #16a34a)',
        whiteSpace: 'nowrap',
      }}
      title="Marcar como atendido (sai da fila)"
    >
      {busy ? '…' : '✓ Atendido'}
    </button>
  )
}
