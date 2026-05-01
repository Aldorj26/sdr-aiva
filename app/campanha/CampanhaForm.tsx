'use client'

import { useMemo, useState } from 'react'

type Resultado =
  | {
      ok: boolean
      total: number
      sucesso: number
      falha: number
      invalidos: number
      resultados: Array<{ telefone: string; ok: boolean; erro?: string; lead_id?: string }>
    }
  | { error: string }

type ParsedLead = { nome?: string; telefone: string; cidade?: string }

// Palavras comuns em linhas de cabeçalho de planilha — quando aparecem na 1a linha,
// trata como header e pula.
const HEADER_KEYWORDS = new Set([
  'nome', 'name', 'cliente', 'lojista',
  'telefone', 'phone', 'whatsapp', 'numero', 'celular',
  'cidade', 'city', 'localidade',
])

/**
 * Parser único do textarea. Retorna leads estruturados.
 *
 * Regras:
 * - Linhas vazias são ignoradas.
 * - Para cada linha, tenta separadores nessa ordem: tab > ; > ,
 * - Linha com 1 coluna → assume telefone puro.
 * - Linha com 2+ colunas SEM letras → assume vários telefones na mesma linha.
 * - Linha com 2+ colunas COM letras → assume CSV. Ordem esperada: nome, telefone, cidade.
 *   Mas o telefone é detectado automaticamente como a coluna que tem 10+ dígitos,
 *   então a ordem real entre colunas é tolerante.
 * - Se a 1a linha for header (palavras tipo "nome", "telefone", "cidade") → pula.
 * - Dedup final por telefone.
 */
function parseInput(input: string): ParsedLead[] {
  const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  const result: ParsedLead[] = []
  const seen = new Set<string>()

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]

    // Detecta separador
    let parts: string[]
    if (line.includes('\t')) parts = line.split('\t')
    else if (line.includes(';')) parts = line.split(';')
    else if (line.includes(',')) parts = line.split(',')
    else parts = [line]

    parts = parts.map((p) => p.trim()).filter(Boolean)
    if (parts.length === 0) continue

    // Caso 1: 1 só coluna → telefone puro
    if (parts.length === 1) {
      const tel = parts[0].replace(/\D/g, '')
      if (tel.length >= 10 && tel.length <= 13 && !seen.has(tel)) {
        seen.add(tel)
        result.push({ telefone: tel })
      }
      continue
    }

    // Caso 2: várias colunas, todas numéricas → vários telefones na mesma linha
    const hasLetters = parts.some((p) => /[a-zA-ZÀ-ÿ]/.test(p))
    if (!hasLetters) {
      for (const p of parts) {
        const tel = p.replace(/\D/g, '')
        if (tel.length >= 10 && tel.length <= 13 && !seen.has(tel)) {
          seen.add(tel)
          result.push({ telefone: tel })
        }
      }
      continue
    }

    // Caso 3: CSV (várias colunas, alguma com letras)
    // Detecta header só na primeira linha
    if (idx === 0) {
      const lowerParts = parts.map((p) => p.toLowerCase())
      const isHeader = lowerParts.some((p) => HEADER_KEYWORDS.has(p))
      if (isHeader) continue
    }

    // Encontra a coluna do telefone (primeira com 10+ dígitos)
    let telefone: string | undefined
    let telefoneIdx = -1
    for (let i = 0; i < parts.length; i++) {
      const digits = parts[i].replace(/\D/g, '')
      if (digits.length >= 10 && digits.length <= 13) {
        telefone = digits
        telefoneIdx = i
        break
      }
    }
    if (!telefone || seen.has(telefone)) continue
    seen.add(telefone)

    // Outras colunas → primeira com letras é o nome, próxima é a cidade.
    // Ignora a coluna do telefone.
    const others = parts.filter((_, i) => i !== telefoneIdx)
    let nome: string | undefined
    let cidade: string | undefined
    for (const p of others) {
      if (!nome && /[a-zA-ZÀ-ÿ]/.test(p)) {
        nome = p
      } else if (nome && !cidade && p) {
        cidade = p
      }
    }

    result.push({ telefone, nome, cidade })
  }

  return result
}

export default function CampanhaForm() {
  const [textoColado, setTextoColado] = useState('')
  const [nome, setNome] = useState('Loja')
  const [cidade, setCidade] = useState('')
  const [produto, setProduto] = useState<'AIVA' | 'SINGLO'>('AIVA')
  const [loading, setLoading] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  // Parsing memoizado: roda só quando o texto muda.
  const leadsParsed = useMemo(() => parseInput(textoColado), [textoColado])

  // Stats pra mostrar no preview
  const stats = useMemo(() => {
    const comNome = leadsParsed.filter((l) => l.nome).length
    const comCidade = leadsParsed.filter((l) => l.cidade).length
    const modoCSV = comNome > 0 || comCidade > 0
    return { total: leadsParsed.length, comNome, comCidade, modoCSV }
  }, [leadsParsed])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (leadsParsed.length === 0) return
    if (leadsParsed.length > 100) {
      if (!confirm(`Voce vai disparar para ${leadsParsed.length} leads. Continuar?`)) return
    }
    setLoading(true)
    setResultado(null)
    try {
      const res = await fetch('/api/leads/send-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads: leadsParsed,
          nome, // default usado se um lead vier sem nome
          cidade, // default usado se um lead vier sem cidade
          produto,
        }),
      })
      const data = await res.json()
      setResultado(data)
    } catch (err) {
      setResultado({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#0f0f0f',
    border: '1px solid #222',
    color: '#eee',
    padding: '0.6rem 0.8rem',
    borderRadius: 6,
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '0.35rem',
    fontWeight: 600,
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label style={labelStyle}>Telefones ou planilha (CSV)</label>
          <textarea
            value={textoColado}
            onChange={(e) => setTextoColado(e.target.value)}
            placeholder={
              'Modo simples (so telefones, um por linha):\n' +
              '5511999998888\n' +
              '5547996085000\n\n' +
              'Modo planilha (nome, telefone, cidade):\n' +
              'Joao da Silva,5511999998888,Sao Paulo\n' +
              'Maria Souza,5547996085000,Brusque/SC\n\n' +
              'Voce pode colar direto do Excel/Sheets (separado por TAB tambem funciona).'
            }
            rows={12}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }}
            required
          />
          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem' }}>
            {stats.total === 0 ? (
              'Cole pelo menos um telefone (min 10 digitos)'
            ) : (
              <>
                <strong style={{ color: '#86efac' }}>
                  {stats.total} telefone{stats.total === 1 ? '' : 's'} unico{stats.total === 1 ? '' : 's'}
                </strong>{' '}
                detectado{stats.total === 1 ? '' : 's'}
                {stats.modoCSV && (
                  <>
                    {' '}— modo planilha ({stats.comNome} com nome
                    {stats.comCidade > 0 ? `, ${stats.comCidade} com cidade` : ''})
                  </>
                )}
              </>
            )}
          </div>

          {/* Preview dos primeiros 3 leads parseados */}
          {stats.total > 0 && stats.modoCSV && (
            <details
              style={{
                marginTop: '0.5rem',
                background: '#0d1117',
                border: '1px solid #1f2937',
                borderRadius: 6,
                padding: '0.5rem 0.7rem',
              }}
              open
            >
              <summary
                style={{
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  fontSize: '0.72rem',
                }}
              >
                Pré-visualização ({Math.min(3, stats.total)} de {stats.total})
              </summary>
              <table
                style={{
                  width: '100%',
                  marginTop: '0.5rem',
                  fontSize: '0.75rem',
                  borderCollapse: 'collapse',
                }}
              >
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid #1f2937' }}>
                      Nome
                    </th>
                    <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid #1f2937' }}>
                      Telefone
                    </th>
                    <th style={{ padding: '0.25rem 0.4rem', borderBottom: '1px solid #1f2937' }}>
                      Cidade
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leadsParsed.slice(0, 3).map((l) => (
                    <tr key={l.telefone} style={{ color: '#e5e7eb' }}>
                      <td style={{ padding: '0.25rem 0.4rem' }}>
                        {l.nome ?? <span style={{ color: '#6b7280' }}>(default)</span>}
                      </td>
                      <td style={{ padding: '0.25rem 0.4rem', fontFamily: 'monospace' }}>
                        {l.telefone}
                      </td>
                      <td style={{ padding: '0.25rem 0.4rem' }}>
                        {l.cidade ?? <span style={{ color: '#6b7280' }}>(default)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <div>
            <label style={labelStyle}>Nome padrao (fallback)</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              style={inputStyle}
              placeholder="Loja"
            />
            <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '0.2rem' }}>
              Usado quando o lead vier sem nome
            </div>
          </div>
          <div>
            <label style={labelStyle}>Cidade padrao (fallback)</label>
            <input
              type="text"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              style={inputStyle}
              placeholder="Curitiba/PR"
            />
            <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '0.2rem' }}>
              Usado quando o lead vier sem cidade
            </div>
          </div>
          <div>
            <label style={labelStyle}>Produto</label>
            <select
              value={produto}
              onChange={(e) => setProduto(e.target.value as 'AIVA' | 'SINGLO')}
              style={inputStyle}
            >
              <option value="AIVA">AIVA</option>
              <option value="SINGLO" disabled>
                Singlo (em breve)
              </option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            type="submit"
            disabled={loading || stats.total === 0}
            style={{
              background: loading ? '#1d2028' : 'linear-gradient(135deg, #60a5fa, #a78bfa)',
              color: '#fff',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: 6,
              cursor: loading || stats.total === 0 ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              fontSize: '0.9rem',
              fontWeight: 600,
              opacity: stats.total === 0 ? 0.5 : 1,
            }}
          >
            {loading ? 'Disparando...' : `Disparar para ${stats.total || 0} leads`}
          </button>
          {loading && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              Isso pode levar alguns minutos (validacao + envio HSM por lead)
            </span>
          )}
        </div>
      </form>

      {resultado && <ResultadoBox resultado={resultado} />}
    </div>
  )
}

function ResultadoBox({ resultado }: { resultado: Resultado }) {
  if ('error' in resultado) {
    return (
      <div
        style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: '#2b1020',
          border: '1px solid #7f1d1d',
          borderRadius: 8,
          color: '#fca5a5',
        }}
      >
        <strong>Erro:</strong> {resultado.error}
      </div>
    )
  }

  const { total, sucesso, falha, invalidos, resultados } = resultado
  const falhas = resultados.filter((r) => !r.ok && r.erro !== 'numero_sem_whatsapp')
  const semWhats = resultados.filter((r) => r.erro === 'numero_sem_whatsapp')

  return (
    <div
      style={{
        marginTop: '1.5rem',
        padding: '1rem 1.25rem',
        background: '#0d1a12',
        border: '1px solid #14532d',
        borderRadius: 8,
      }}
    >
      <div style={{ color: '#86efac', fontWeight: 600, marginBottom: '0.75rem' }}>
        Disparo concluido
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: '0.5rem',
          fontSize: '0.85rem',
        }}
      >
        <div>
          Total: <strong>{total}</strong>
        </div>
        <div style={{ color: '#86efac' }}>
          Sucesso: <strong>{sucesso}</strong>
        </div>
        <div style={{ color: '#fca5a5' }}>
          Falha: <strong>{falha}</strong>
        </div>
        <div style={{ color: '#fbbf24' }}>
          Sem WhatsApp: <strong>{invalidos}</strong>
        </div>
      </div>
      {semWhats.length > 0 && (
        <details style={{ marginTop: '0.75rem' }}>
          <summary style={{ color: '#fbbf24', cursor: 'pointer', fontSize: '0.78rem' }}>
            Numeros sem WhatsApp ({semWhats.length})
          </summary>
          <ul style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {semWhats.map((r) => (
              <li key={r.telefone}>{r.telefone}</li>
            ))}
          </ul>
        </details>
      )}
      {falhas.length > 0 && (
        <details style={{ marginTop: '0.5rem' }}>
          <summary style={{ color: '#fca5a5', cursor: 'pointer', fontSize: '0.78rem' }}>
            Falhas ({falhas.length})
          </summary>
          <ul style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {falhas.map((r) => (
              <li key={r.telefone}>
                {r.telefone}: {r.erro}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
