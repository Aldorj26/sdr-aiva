'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

export default function AssistenteWidget() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, open])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  // Fora do painel autenticado: /login e /chat (simulador público de lead)
  if (pathname.startsWith('/login') || pathname.startsWith('/chat')) return null

  async function enviar() {
    if (!input.trim() || loading) return
    const userMsg: Msg = { role: 'user', content: input.trim() }
    const atualizado = [...messages, userMsg]
    setMessages(atualizado)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/assistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem: userMsg.content, historico: messages }),
      })
      const data = await res.json()
      setMessages([
        ...atualizado,
        { role: 'assistant', content: data.resposta ?? data.error ?? 'Erro ao processar.' },
      ])
    } catch {
      setMessages([...atualizado, { role: 'assistant', content: 'Erro de rede. Tenta de novo?' }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  return (
    <>
      <style>{css}</style>

      {/* Botão flutuante */}
      {!open && (
        <button className="ast-fab" onClick={() => setOpen(true)} title="VictorIA Analista">
          <span className="ast-fab-icon">V</span>
        </button>
      )}

      {/* Slide-over */}
      {open && (
        <div className="ast-panel">
          <div className="ast-header">
            <div className="ast-header-left">
              <div className="ast-avatar">V</div>
              <div>
                <div className="ast-title">VictorIA Analista</div>
                <div className="ast-sub">Pergunte sobre a operação AIVA</div>
              </div>
            </div>
            <button className="ast-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="ast-body">
            {messages.length === 0 && (
              <div className="ast-empty">
                Ex.: &ldquo;quantos leads em cadastro recebido?&rdquo;<br />
                &ldquo;o que aconteceu na conversa com a Imports Store?&rdquo;<br />
                &ldquo;quais leads estão parados há mais de 2 dias?&rdquo;
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ast-msg-user' : 'ast-msg-ia'}>
                {m.content}
              </div>
            ))}
            {loading && <div className="ast-msg-ia ast-typing">consultando…</div>}
            <div ref={endRef} />
          </div>

          <div className="ast-input-row">
            <input
              ref={inputRef}
              className="ast-input"
              placeholder="Pergunte sobre leads, etapas, conversas…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enviar()}
              disabled={loading}
            />
            <button className="ast-send" onClick={enviar} disabled={loading || !input.trim()}>➤</button>
          </div>
        </div>
      )}
    </>
  )
}

const css = `
  .ast-fab {
    position: fixed; right: 22px; bottom: 22px; z-index: 950;
    width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
    background: linear-gradient(135deg, #16a34a, #059669); color: #fff;
    font-size: 22px; font-weight: 700;
    box-shadow: 0 6px 24px rgba(22,163,74,.45);
    transition: transform .15s;
  }
  .ast-fab:hover { transform: scale(1.07); }

  .ast-panel {
    position: fixed; right: 16px; bottom: 16px; z-index: 960;
    width: 400px; max-width: calc(100vw - 32px);
    height: 560px; max-height: calc(100dvh - 32px);
    display: flex; flex-direction: column;
    background: #101010; border: 1px solid #262626; border-radius: 16px;
    box-shadow: 0 16px 48px rgba(0,0,0,.6);
    overflow: hidden;
    color: #ededed;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  .ast-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; background: #161616; border-bottom: 1px solid #222;
    flex-shrink: 0;
  }
  .ast-header-left { display: flex; align-items: center; gap: 10px; }
  .ast-avatar {
    width: 34px; height: 34px; border-radius: 50%;
    background: linear-gradient(135deg, #16a34a, #059669);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; color: #fff; font-size: 15px;
  }
  .ast-title { font-size: 14px; font-weight: 600; }
  .ast-sub { font-size: 11px; color: #4ade80; }
  .ast-close {
    background: none; border: none; color: #888; font-size: 14px; cursor: pointer;
    padding: 6px; border-radius: 8px;
  }
  .ast-close:hover { background: #222; color: #fff; }

  .ast-body {
    flex: 1; overflow-y: auto; padding: 14px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .ast-empty { color: #555; font-size: 12.5px; line-height: 1.7; margin-top: 16px; text-align: center; }

  .ast-msg-user {
    align-self: flex-end; max-width: 88%;
    background: #14532d; border-radius: 14px 14px 4px 14px;
    padding: 8px 12px; font-size: 13.5px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
  }
  .ast-msg-ia {
    align-self: flex-start; max-width: 92%;
    background: #191919; border: 1px solid #262626;
    border-radius: 14px 14px 14px 4px;
    padding: 8px 12px; font-size: 13.5px; line-height: 1.55;
    white-space: pre-wrap; word-break: break-word;
  }
  .ast-typing { color: #777; font-style: italic; }

  .ast-input-row {
    display: flex; gap: 8px; padding: 10px 12px;
    border-top: 1px solid #222; background: #141414; flex-shrink: 0;
  }
  .ast-input {
    flex: 1; min-width: 0; padding: 10px 14px; border-radius: 20px;
    border: 1px solid #333; background: #1c1c1c; color: #fff;
    font-size: 13.5px; outline: none; caret-color: #16a34a;
  }
  .ast-input:focus { border-color: #16a34a; }
  .ast-send {
    width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
    background: #16a34a; color: #fff; font-size: 15px; flex-shrink: 0;
  }
  .ast-send:disabled { opacity: .35; cursor: default; }

  @media (max-width: 640px) {
    .ast-panel { right: 8px; bottom: 8px; width: calc(100vw - 16px); height: 70dvh; }
    .ast-fab { right: 14px; bottom: 14px; }
  }
`
