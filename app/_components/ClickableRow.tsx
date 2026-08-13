'use client'

interface Props {
  leadId: string
  children: React.ReactNode
  style?: React.CSSProperties
}

export default function ClickableRow({ leadId, children, style }: Props) {
  return (
    <tr
      onClick={(e) => {
        // Cliques em links, checkboxes e botões dentro da linha NÃO abrem o
        // drawer (ex.: /registros tem "Abrir form ↗" e o check "Enviado").
        const alvo = (e.target as HTMLElement).closest('a, input, button, label')
        if (alvo) return
        window.dispatchEvent(new CustomEvent('open-lead', { detail: leadId }))
      }}
      style={{ cursor: 'pointer', ...style }}
      className="clickable-row"
    >
      {children}
    </tr>
  )
}
