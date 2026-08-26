'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Botão "Importar relatório" do painel de comissões: manda os .xlsx do email
 * da UME (Carteira e/ou FCDL, pode selecionar os dois juntos) pra
 * /api/comissoes/importar e recarrega a tela.
 */
export default function ImportarForm() {
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  async function enviar(files: FileList | null) {
    if (!files?.length) return
    setEnviando(true)
    setMsg(null)
    try {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append('arquivos', f)
      const res = await fetch('/api/comissoes/importar', { method: 'POST', body: fd })
      const data = await res.json()
      const linhas = (data.resultados ?? []).map((r: { arquivo: string; ok: boolean; mes?: string; origem?: string; linhas?: number; aviso?: string | null; erro?: string }) =>
        r.ok
          ? `✓ ${r.origem} ${r.mes}: ${r.linhas} lojas${r.aviso ? ` — ⚠️ ${r.aviso}` : ''}`
          : `✗ ${r.arquivo}: ${r.erro}`,
      )
      setMsg({ ok: Boolean(data.ok), texto: linhas.join('\n') })
      if (data.ok) router.refresh()
    } catch (err) {
      setMsg({ ok: false, texto: err instanceof Error ? err.message : String(err) })
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => enviar(e.target.files)}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={enviando}
        style={{
          padding: '0.45rem 0.9rem', borderRadius: 6, border: '1px solid var(--accent)',
          background: 'var(--accent)', color: '#fff', cursor: enviando ? 'wait' : 'pointer', fontSize: '0.85rem',
        }}
      >
        {enviando ? 'Importando…' : '⬆️ Importar relatório (.xlsx)'}
      </button>
      {msg && (
        <pre style={{
          margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.75rem', fontFamily: 'inherit',
          color: msg.ok ? '#16a34a' : '#dc2626', maxWidth: 420,
        }}>{msg.texto}</pre>
      )}
    </div>
  )
}
