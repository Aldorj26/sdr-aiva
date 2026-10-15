'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Os três botões da `/disparos`. Tamanho de dedo: o uso real é o Aldo no celular, em viagem.
 *
 * O “Disparar agora” roda um lote no servidor (50–75 s). O cliente desiste em 90 s, mas a rodada
 * SEGUE no servidor — por isso o aviso de espera em vez de erro, e o número aparece no refresh.
 * A tela se atualiza a cada 30 s (nunca durante um clique, pra não apagar a resposta).
 */
type Acao = 'disparar' | 'pausar' | 'retomar'

const botao: React.CSSProperties = {
  flex: '1 1 140px', minHeight: 52, borderRadius: 12, border: '1px solid var(--border-strong)',
  background: 'var(--card, #fff)', color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer',
}

export default function Acoes({ pausado }: { pausado: boolean }) {
  const [busy, setBusy] = useState<Acao | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState(false)
  const router = useRouter()

  // Refresh de 30 s: o número sobe sozinho enquanto o cron trabalha.
  useEffect(() => {
    const t = setInterval(() => { if (!busy) router.refresh() }, 30_000)
    return () => clearInterval(t)
  }, [busy, router])

  async function agir(acao: Acao) {
    if (busy) return
    if (acao === 'pausar' && !confirm('Pausar o disparo? Nada sai até alguém retomar.')) return
    setBusy(acao); setMsg(null); setErro(false)
    try {
      const res = await fetch('/api/disparos/acao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
        // o lote demora; depois disso a rodada continua no servidor
        signal: AbortSignal.timeout(90_000),
      })
      const j = await res.json().catch(() => ({}))
      setErro(!res.ok)
      setMsg(typeof j.info === 'string' ? j.info : res.ok ? 'Feito.' : 'Não consegui — tente de novo.')
    } catch {
      // timeout/queda de rede: NÃO é falha do disparo, a rodada segue no servidor
      setMsg('Ainda disparando no servidor. Confira os números em alguns segundos.')
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <button
        onClick={() => agir('disparar')}
        disabled={busy !== null}
        style={{
          // `flex: 'none'` porque o pai é coluna: sem isto o `flex: 1 1 140px` do estilo base
          // estica o botão até ocupar meia tela no celular.
          ...botao, flex: 'none', minHeight: 60, fontSize: '1.05rem', border: 'none',
          background: 'var(--accent)', color: '#fff', opacity: busy ? 0.6 : 1,
        }}
      >
        {busy === 'disparar' ? 'Disparando…' : pausado ? '🚀 Destravar e disparar agora' : '🚀 Disparar agora'}
      </button>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button onClick={() => agir('retomar')} disabled={busy !== null || !pausado} style={{ ...botao, opacity: busy || !pausado ? 0.5 : 1 }}>
          {busy === 'retomar' ? 'Retomando…' : 'Retomar'}
        </button>
        <button onClick={() => agir('pausar')} disabled={busy !== null || pausado} style={{ ...botao, opacity: busy || pausado ? 0.5 : 1 }}>
          {busy === 'pausar' ? 'Pausando…' : 'Pausar'}
        </button>
      </div>

      {msg && (
        <div
          role="status"
          style={{
            borderRadius: 10, padding: '0.7rem 0.8rem', fontSize: '0.88rem', lineHeight: 1.45,
            background: erro ? 'rgba(220,38,38,0.1)' : 'var(--bg-soft, rgba(0,0,0,0.04))',
            border: `1px solid ${erro ? 'var(--red, #dc2626)' : 'var(--border)'}`,
          }}
        >
          {msg}
        </div>
      )}
    </div>
  )
}
