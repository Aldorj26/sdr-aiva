'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Botão "✓ Resolvido" de um aviso do robô no /atendimento (05/10/2026).
 * Só fecha o aviso — não mexe no lead nem na automação.
 */
export default function AvisoResolver({ id }: { id: string }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  return (
    <button
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation()
        setBusy(true)
        try {
          await fetch('/api/avisos-painel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          router.refresh()
        } finally {
          setBusy(false)
        }
      }}
      style={{
        fontSize: '0.72rem', padding: '2px 9px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
        border: '1px solid var(--border-strong)', background: 'var(--bg-elev)', color: 'var(--green, #16a34a)',
      }}
      title="Já falei com a loja / já tratei — tirar da lista"
    >
      {busy ? '…' : '✓ Resolvido'}
    </button>
  )
}
