'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Checkbox "enviado no formulário" da aba CNPJs (/registros).
 * O Nei marca depois de lançar o CNPJ no form de pré-cadastro da AIVA.
 */
export default function CheckEnviado({ id, enviado }: { id: string; enviado: boolean }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function toggle() {
    setBusy(true)
    try {
      await fetch('/api/registros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enviado: !enviado }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <input
      type="checkbox"
      checked={enviado}
      disabled={busy}
      onChange={toggle}
      style={{ width: 18, height: 18, cursor: busy ? 'wait' : 'pointer', accentColor: 'var(--accent)' }}
      title={enviado ? 'Enviado no formulário — clique pra desmarcar' : 'Marcar como enviado no formulário'}
    />
  )
}
