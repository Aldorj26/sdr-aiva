'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Link "Abrir form" da aba CNPJs (/registros).
 *
 * Marca o CNPJ como enviado NO CLIQUE (pedido do Aldo 2026-08-24). O Google
 * Forms não avisa ninguém quando alguém envia, então o clique é o sinal
 * disponível: o CNPJ já vai preenchido no link, e quem abre está indo enviar.
 *
 * Assume o falso positivo de propósito — abriu e não enviou fica marcado
 * errado. A troca é boa: em vez de marcar dezenas na mão, o operador desmarca
 * os poucos que não foram. O checkbox continua editável e o tooltip avisa que
 * a marcação foi automática.
 *
 * Quando a AIVA compartilhar a planilha de respostas do formulário, isso vira
 * conferência real e este comportamento pode ser removido.
 */
export default function AbrirFormLink({
  id,
  href,
  jaEnviado,
}: {
  id: string
  href: string
  jaEnviado: boolean
}) {
  const [marcando, setMarcando] = useState(false)
  const router = useRouter()

  async function aoClicar() {
    // O link abre pelo comportamento nativo (target=_blank) — não damos
    // preventDefault. A marcação acontece em paralelo, sem segurar a aba.
    if (jaEnviado || marcando) return
    setMarcando(true)
    try {
      await fetch('/api/registros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enviado: true, origem: 'abriu-form' }),
      })
      router.refresh()
    } catch {
      /* falha na marcação não pode atrapalhar o envio — o operador marca na mão */
    } finally {
      setMarcando(false)
    }
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={aoClicar}
      style={{ color: 'var(--accent)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
      title={jaEnviado ? 'Abrir o formulário novamente' : 'Abre o form e já marca como enviado aqui'}
    >
      Abrir form ↗
    </a>
  )
}
