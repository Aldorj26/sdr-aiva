'use client'

import Copiavel from '@/app/_components/Copiavel'

import { useCallback, useEffect, useState } from 'react'

interface Item {
  mensagem_id: string
  lead_id: string
  lead_nome: string
  lead_telefone: string
  pergunta: string | null
  resposta: string
  enviado_em: string
  avaliacao: 'boa' | 'ruim' | null
  correcao: string | null
}

interface Stats {
  total: number
  sem_correcao: number
  ruins: number
}

type Filtro = 'todas' | 'sem_correcao' | 'ruins'

const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'sem_correcao', label: 'Sem correção' },
  { id: 'ruins', label: 'Marcadas ruins' },
]

function fmtData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function CuradoriaList() {
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [itens, setItens] = useState<Item[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, sem_correcao: 0, ruins: 0 })
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const res = await fetch(`/api/curadoria?filtro=${filtro}`, { cache: 'no-store' })
      const data = await res.json()
      setItens(data.itens ?? [])
      setStats(data.stats ?? { total: 0, sem_correcao: 0, ruins: 0 })
    } finally {
      setCarregando(false)
    }
  }, [filtro])

  useEffect(() => {
    carregar()
  }, [carregar])

  return (
    <>
      {/* Stats */}
      <div className="cards-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="card">
          <div className="card-label">Respostas avaliadas</div>
          <div className="card-value">{stats.total}</div>
        </div>
        <div className="card">
          <div className="card-label">Sem correção</div>
          <div className="card-value">{stats.sem_correcao}</div>
          <div className="card-hint">pendentes de ajuste</div>
        </div>
        <div className="card">
          <div className="card-label">Marcadas ruins</div>
          <div className="card-value" style={{ color: stats.ruins > 0 ? 'var(--red)' : 'var(--text)' }}>
            {stats.ruins}
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            style={{
              padding: '0.45rem 0.9rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: filtro === f.id ? 'var(--accent)' : 'var(--bg-elev)',
              color: filtro === f.id ? '#fff' : 'var(--text-dim)',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {carregando ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Carregando…</p>
      ) : itens.length === 0 ? (
        <div
          style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 12,
          }}
        >
          {filtro === 'todas'
            ? 'Nenhuma resposta avaliada ainda. Abra uma conversa no painel e use os botões 👍 / 👎 nas respostas da VictorIA — elas aparecem aqui pra você ajustar a correção.'
            : filtro === 'sem_correcao'
              ? 'Nenhuma resposta sem correção — tudo ajustado. ✓'
              : 'Nenhuma resposta marcada como ruim.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {itens.map((item) => (
            <CuradoriaCard key={item.mensagem_id} item={item} onSalvo={carregar} />
          ))}
        </div>
      )}
    </>
  )
}

function CuradoriaCard({ item, onSalvo }: { item: Item; onSalvo: () => void }) {
  const [avaliacao, setAvaliacao] = useState<'boa' | 'ruim' | null>(item.avaliacao)
  const [correcao, setCorrecao] = useState(item.correcao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)

  async function salvar(novaAvaliacao: 'boa' | 'ruim') {
    setSalvando(true)
    setSalvo(false)
    try {
      const res = await fetch('/api/curadoria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensagem_id: item.mensagem_id,
          lead_id: item.lead_id,
          avaliacao: novaAvaliacao,
          correcao,
        }),
      })
      if (res.ok) {
        setAvaliacao(novaAvaliacao)
        setSalvo(true)
        onSalvo()
      }
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="card" style={{ padding: '1.1rem 1.25rem' }}>
      {/* Cabeçalho */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '0.75rem',
        }}
      >
        <strong style={{ fontSize: '0.9rem' }}>
          {item.lead_nome}{' '}
          <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}>
            {item.lead_telefone ? <Copiavel valor={item.lead_telefone} /> : null}
          </span>
        </strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
          {fmtData(item.enviado_em)}
        </span>
      </div>

      {/* Pergunta do lead */}
      {item.pergunta && (
        <div
          style={{
            background: 'var(--bg-elev-2)',
            borderRadius: 8,
            padding: '0.55rem 0.75rem',
            fontSize: '0.84rem',
            color: 'var(--text-dim)',
            marginBottom: '0.5rem',
          }}
        >
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700 }}>
            LEAD
          </span>
          <div style={{ marginTop: '0.2rem', whiteSpace: 'pre-wrap' }}>{item.pergunta}</div>
        </div>
      )}

      {/* Resposta da VictorIA */}
      <div
        style={{
          background: '#fff7ed',
          border: '1px solid #fed7aa',
          borderRadius: 8,
          padding: '0.55rem 0.75rem',
          fontSize: '0.86rem',
          color: 'var(--text)',
          marginBottom: '0.85rem',
        }}
      >
        <span style={{ color: 'var(--accent)', fontSize: '0.7rem', fontWeight: 700 }}>
          VICTORIA
        </span>
        <div style={{ marginTop: '0.2rem', whiteSpace: 'pre-wrap' }}>{item.resposta}</div>
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => salvar('boa')}
          disabled={salvando}
          style={{
            padding: '0.4rem 0.85rem',
            borderRadius: 8,
            border: `1px solid ${avaliacao === 'boa' ? 'var(--green)' : 'var(--border)'}`,
            background: avaliacao === 'boa' ? 'var(--green)' : 'var(--bg-elev)',
            color: avaliacao === 'boa' ? '#fff' : 'var(--text-dim)',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: salvando ? 'wait' : 'pointer',
          }}
        >
          👍 Boa
        </button>
        <button
          onClick={() => salvar('ruim')}
          disabled={salvando}
          style={{
            padding: '0.4rem 0.85rem',
            borderRadius: 8,
            border: `1px solid ${avaliacao === 'ruim' ? 'var(--red)' : 'var(--border)'}`,
            background: avaliacao === 'ruim' ? 'var(--red)' : 'var(--bg-elev)',
            color: avaliacao === 'ruim' ? '#fff' : 'var(--text-dim)',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: salvando ? 'wait' : 'pointer',
          }}
        >
          👎 Ruim
        </button>
        {salvo && (
          <span style={{ color: 'var(--green)', fontSize: '0.78rem', alignSelf: 'center' }}>
            ✓ salvo
          </span>
        )}
      </div>

      {/* Correção */}
      <textarea
        value={correcao}
        onChange={(e) => setCorrecao(e.target.value)}
        onBlur={() => {
          if (avaliacao) salvar(avaliacao)
        }}
        placeholder="Como a resposta deveria ter sido? (anotação de correção)"
        rows={2}
        style={{
          width: '100%',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '0.5rem 0.7rem',
          fontSize: '0.82rem',
          color: 'var(--text)',
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
    </div>
  )
}
