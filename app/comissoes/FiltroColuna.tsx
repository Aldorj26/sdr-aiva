'use client'

import { useRouter, useSearchParams } from 'next/navigation'

/** Filtro de uma coluna do painel de Comissões (Aldo 13/10/2026: "clicar e aparecer só as lojas sem ID").
 *  Grava o valor na URL (?param=valor) e mantém os outros filtros; vazio = todas. */
export default function FiltroColuna({ param, opcoes }: { param: string; opcoes: Array<{ valor: string; rotulo: string }> }) {
  const router = useRouter()
  const sp = useSearchParams()
  const atual = sp.get(param) ?? ''
  return (
    <select
      value={atual}
      onChange={(e) => {
        const p = new URLSearchParams(sp.toString())
        if (e.target.value) p.set(param, e.target.value)
        else p.delete(param)
        router.push(`/comissoes?${p.toString()}`)
      }}
      style={{
        width: '100%', minWidth: 88, padding: '0.2rem 0.3rem', fontSize: '0.72rem', borderRadius: 5, fontFamily: 'inherit',
        border: `1px solid ${atual ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-elev)',
        color: atual ? 'var(--accent)' : 'var(--text-muted)', fontWeight: atual ? 700 : 400,
      }}
    >
      <option value="">Todas</option>
      {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
    </select>
  )
}
