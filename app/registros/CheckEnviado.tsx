'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Checkbox "enviado no formulário" da aba CNPJs (/registros).
 * O Nei marca depois de lançar o CNPJ no form de pré-cadastro da AIVA.
 */
export default function CheckEnviado({
  id,
  enviado,
  origem,
}: {
  id: string
  enviado: boolean
  origem?: string | null
}) {
  // Marcado ao abrir o form (otimista) ainda não foi confirmado por ninguém.
  const automatico = enviado && origem === 'abriu-form'
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
      style={{
        width: 18, height: 18, cursor: busy ? 'wait' : 'pointer',
        // opaco = automático (abriu o form, ninguém confirmou ainda)
        accentColor: automatico ? 'var(--text-dim)' : 'var(--accent)',
        opacity: automatico ? 0.65 : 1,
      }}
      title={
        automatico
          ? 'Marcado ao abrir o form — se não chegou a enviar, clique pra desmarcar'
          : enviado
            ? 'Enviado no formulário — clique pra desmarcar'
            : 'Marcar como enviado no formulário'
      }
    />
  )
}
