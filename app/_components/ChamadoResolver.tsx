'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Botão "Resolver" de um chamado (regra 03/09). Marca resolvido via
 * POST /api/chamados e recarrega os dados da página (a linha some da lista).
 */
export default function ChamadoResolver({ id }: { id: string }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  return (
    <button
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation()
        setBusy(true)
        try {
          await fetch('/api/chamados', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, resolvido: true }),
          })
          router.refresh()
        } finally {
          setBusy(false)
        }
      }}
      style={{
        fontSize: '0.72rem', padding: '2px 9px', borderRadius: 6, cursor: 'pointer',
        border: '1px solid var(--border-strong)', background: 'var(--bg-elev)', color: 'var(--green, #16a34a)',
      }}
      title="Marcar chamado como resolvido"
    >
      {busy ? '…' : '✓ Resolver'}
    </button>
  )
}
