'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * "Abrir form" do "📮 Marcado e não chegou à AIVA" no /atendimento (Aldo 16/11/2026).
 * Antes era um link puro: o Nei reenviava o formulário e ainda tinha que clicar em "Resolvido" — e
 * esquecer abria espaço pra reenviar o mesmo cadastro duas vezes. Agora o clique fecha o aviso e
 * recomeça as 24h do espelho (ver /api/avisos-painel). Mesmo raciocínio do AbrirFormLink do /registros:
 * o Google Forms não avisa quando alguém envia, então o clique é o sinal disponível. Abriu e não
 * enviou → em 24h o CNPJ não aparece no portal e o aviso volta sozinho.
 */
export default function ReenviarFormLink({ id, href, cnpj }: { id: string; href: string; cnpj: string }) {
  const [sumiu, setSumiu] = useState(false)
  const router = useRouter()
  async function aoClicar() {
    // sem preventDefault: a aba do formulário abre pelo target=_blank; a marcação corre em paralelo
    setSumiu(true)
    try {
      await fetch('/api/avisos-painel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, reenviouCnpj: cnpj }),
      })
      router.refresh()
    } catch {
      setSumiu(false) // falhou: o botão volta e o "Resolvido" continua ali
    }
  }
  if (sumiu) return <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>reenviado ✓</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={aoClicar}
      title="Abre o formulário preenchido e já tira a loja desta lista. Se o CNPJ não chegar ao portal em 24h, ela volta."
      style={{ color: 'var(--accent)', fontSize: '0.8rem', padding: '0.2rem 0.5rem', border: '1px solid var(--accent)', borderRadius: 6, textDecoration: 'none' }}
    >
      Abrir form ↗
    </a>
  )
}
