'use client'

import { useState, useRef, useEffect } from 'react'

interface Msg { role: 'user' | 'assistant'; content: string }
interface Resposta {
  mensagem?: string
  novo_status?: string
  acionar_humano?: boolean
  motivo_humano?: string | null
  dados_coletados?: Record<string, string | null>
  error?: string
}

// Fases da conversa real — o status define qual instrução de fase a VictorIA recebe.
const FASES = [
  { valor: 'INTERESSADO', rotulo: 'Fase 1 — Qualificação (7 dados)' },
  { valor: 'PRE_APROVACAO', rotulo: 'Fase 2 — Pré-aprovação (espera)' },
  { valor: 'CADASTRO_RECEBIDO', rotulo: 'Fase 3 — Cadastro (5 dados)' },
  { valor: 'EM_ANALISE_AIVA', rotulo: 'Em Análise AIVA (onboarding)' },
]

export default function ChatSimuladorPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [nome, setNome] = useState('')
  const [fase, setFase] = useState('INTERESSADO')
  const [loading, setLoading] = useState(false)
  const [ultimoStatus, setUltimoStatus] = useState<string | null>(null)
  const [humano, setHumano] = useState(false)
  const [motivo, setMotivo] = useState<string | null>(null)
  const [dados, setDados] = useState<Record<string, string>>({})
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  async function enviar() {
    if (!input.trim() || loading) return
    const userMsg: Msg = { role: 'user', content: input.trim() }
    const atualizado = [...messages, userMsg]
    setMessages(atualizado)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensagem: userMsg.content,
          historico: messages,
          nome: nome.trim() || undefined,
          status: fase,
          dados,
        }),
      })
      const data = (await res.json()) as Resposta
      setMessages([...atualizado, { role: 'assistant', content: data.mensagem ?? data.error ?? 'Erro ao processar.' }])
      if (data.novo_status) setUltimoStatus(data.novo_status)
      if (typeof data.acionar_humano === 'boolean') setHumano(data.acionar_humano)
      setMotivo(data.motivo_humano ?? null)
      if (data.dados_coletados) {
        const novos = Object.fromEntries(
          Object.entries(data.dados_coletados).filter(([, v]) => v && v !== 'null') as [string, string][],
        )
        if (Object.keys(novos).length) setDados((d) => ({ ...d, ...novos }))
      }
    } catch {
      setMessages([...atualizado, { role: 'assistant', content: 'Erro de rede. Tenta de novo?' }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function reiniciar() {
    setMessages([]); setUltimoStatus(null); setHumano(false); setMotivo(null); setDados({}); setInput('')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  const dadosLista = Object.entries(dados)

  return (
    <div className="sim-wrap">
      <style>{css}</style>
      <div className="sim-card">
        <header className="sim-head">
          <div className="sim-head-left">
            <div className="sim-avatar">V</div>
            <div>
              <div className="sim-title">VictorIA — Simulador</div>
              <div className="sim-sub">Teste a conversa do agente (não toca no banco nem no WhatsApp)</div>
            </div>
          </div>
          <div className="sim-head-right">
            <select className="sim-fase" value={fase} onChange={(e) => { setFase(e.target.value) }} title="Fase da conversa simulada">
              {FASES.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
            </select>
            <input className="sim-nome" placeholder="Nome do lojista (opcional)" value={nome} onChange={(e) => setNome(e.target.value)} />
            <button className="sim-reset" onClick={reiniciar} title="Reiniciar conversa">↺ Reiniciar</button>
            <a className="sim-voltar" href="/">← Painel</a>
          </div>
        </header>

        <div className="sim-body">
          {messages.length === 0 && (
            <div className="sim-empty">
              Comece a conversa como se fosse um lojista. Ex.: <em>&ldquo;oi, vi o anúncio de vocês&rdquo;</em><br />
              A VictorIA vai qualificar, tirar dúvidas e coletar os dados — igual no WhatsApp.<br />
              <span className="sim-empty-dica">Use o seletor de fase pra testar cada etapa do funil.</span>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'sim-msg-user' : 'sim-msg-ia'}>{m.content}</div>
          ))}
          {loading && <div className="sim-msg-ia sim-typing">VictorIA está digitando…</div>}
          <div ref={endRef} />
        </div>

        {(ultimoStatus || humano || dadosLista.length > 0) && (
          <div className="sim-status">
            {ultimoStatus && <span className="sim-badge">status: <b>{ultimoStatus}</b></span>}
            {humano && <span className="sim-badge sim-badge-red">🔔 acionaria humano{motivo ? `: ${motivo}` : ''}</span>}
            {dadosLista.map(([k, v]) => (
              <span key={k} className="sim-badge sim-badge-dado" title={`${k}: ${v}`}>{k}: <b>{v.length > 24 ? v.slice(0, 24) + '…' : v}</b></span>
            ))}
          </div>
        )}

        <div className="sim-input-row">
          <input
            ref={inputRef}
            className="sim-input"
            placeholder="Escreva como o lojista… (Enter envia)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enviar()}
            disabled={loading}
            autoFocus
          />
          <button className="sim-send" onClick={enviar} disabled={loading || !input.trim()}>Enviar</button>
        </div>
      </div>
    </div>
  )
}

const css = `
  .sim-wrap { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; background: var(--bg); }
  .sim-card {
    width: min(820px, 100%); height: min(84dvh, 760px); display: flex; flex-direction: column;
    background: var(--bg-elev); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: var(--shadow-hover);
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; color: var(--text);
  }
  .sim-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
    padding: 12px 16px; background: var(--bg-elev-2); border-bottom: 1px solid var(--border); }
  .sim-head-left { display: flex; align-items: center; gap: 10px; }
  .sim-avatar { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent-2));
    display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; }
  .sim-title { font-size: 14px; font-weight: 700; }
  .sim-sub { font-size: 11px; color: var(--text-muted); }
  .sim-head-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sim-fase, .sim-nome { padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text); font-size: 12.5px; outline: none; }
  .sim-fase:focus, .sim-nome:focus { border-color: var(--accent); }
  .sim-reset, .sim-voltar { font-size: 12px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border-strong);
    background: var(--bg-elev); color: var(--text-dim); cursor: pointer; text-decoration: none; }
  .sim-reset:hover, .sim-voltar:hover { border-color: var(--accent); color: var(--accent); }

  .sim-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: var(--bg); }
  .sim-empty { color: var(--text-muted); font-size: 13px; line-height: 1.7; text-align: center; margin-top: 24px; }
  .sim-empty-dica { font-size: 12px; opacity: .8; }

  .sim-msg-user { align-self: flex-end; max-width: 78%; background: var(--accent); color: #fff;
    border-radius: 14px 14px 4px 14px; padding: 9px 13px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .sim-msg-ia { align-self: flex-start; max-width: 82%; background: var(--bg-elev); border: 1px solid var(--border); color: var(--text);
    border-radius: 14px 14px 14px 4px; padding: 9px 13px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; box-shadow: var(--shadow); }
  .sim-typing { color: var(--text-muted); font-style: italic; }

  .sim-status { display: flex; gap: 8px; padding: 8px 16px; border-top: 1px solid var(--border); background: var(--bg-elev-2); flex-wrap: wrap; max-height: 92px; overflow-y: auto; }
  .sim-badge { font-size: 11.5px; color: var(--text-dim); background: var(--bg-elev); border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px; }
  .sim-badge b { color: var(--accent); }
  .sim-badge-red { color: var(--red, #ef4444); border-color: var(--red, #ef4444); }
  .sim-badge-dado b { color: var(--text); font-weight: 600; }

  .sim-input-row { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--border); background: var(--bg-elev); }
  .sim-input { flex: 1; min-width: 0; padding: 11px 15px; border-radius: 22px; border: 1px solid var(--border-strong);
    background: var(--bg-elev); color: var(--text); font-size: 14px; outline: none; caret-color: var(--accent); }
  .sim-input::placeholder { color: var(--text-muted); }
  .sim-input:focus { border-color: var(--accent); }
  .sim-send { padding: 0 20px; border-radius: 22px; border: none; cursor: pointer; background: var(--accent); color: #fff; font-size: 14px; font-weight: 600; }
  .sim-send:hover:not(:disabled) { background: var(--accent-2); }
  .sim-send:disabled { opacity: .4; cursor: default; }
`
