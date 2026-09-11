'use client'

import { useState } from 'react'

/**
 * Valor com botão de copiar ao lado (telefone, CNPJ, RID…).
 * Pedido do Aldo 11/09/2026: "facilita a vida do Nei".
 *
 * - `valor`  = o que vai pra área de transferência (sem máscara: só dígitos, pra
 *              colar direto no portal/planilha/WhatsApp).
 * - `exibir` = como aparece na tela (com máscara). Default: o próprio valor.
 * - O clique NÃO propaga: dentro de ClickableRow não abre o drawer.
 */
export default function Copiavel({
  valor,
  exibir,
  mono,
  style,
}: {
  valor: string
  exibir?: string
  mono?: boolean
  style?: React.CSSProperties
}) {
  const [ok, setOk] = useState(false)

  async function copiar(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(valor)
    } catch {
      // Fallback (http/contextos sem clipboard API): textarea + execCommand.
      const ta = document.createElement('textarea')
      ta.value = valor
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* sem clipboard — nada a fazer */ }
      document.body.removeChild(ta)
    }
    setOk(true)
    setTimeout(() => setOk(false), 1400)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', ...style }}>
      <span style={mono ? { fontFamily: 'monospace' } : undefined}>{exibir ?? valor}</span>
      <button
        type="button"
        onClick={copiar}
        title={ok ? 'Copiado!' : `Copiar ${valor}`}
        aria-label={ok ? 'Copiado' : 'Copiar'}
        style={{
          border: 'none',
          background: 'transparent',
          padding: '0 2px',
          margin: 0,
          cursor: 'pointer',
          color: ok ? '#22c55e' : 'var(--text-muted, #888)',
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          opacity: ok ? 1 : 0.7,
        }}
      >
        {ok ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </span>
  )
}
