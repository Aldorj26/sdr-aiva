import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import TokenChart from '../../_components/TokenChart'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const USD_BRL = 5.2

interface DiarioRow {
  dia: string
  chamadas: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  tokens_totais: number
  custo_usd: number
}

// 62 dias: os gráficos mostram 30, mas o mês anterior inteiro precisa estar na mão pra comparar
async function getDiario(): Promise<DiarioRow[]> {
  const desde = new Date(Date.now() - 62 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
  const { data } = await supabaseAdmin
    .from('sdr_token_usage_diario')
    .select('*')
    .gte('dia', desde)
    .order('dia', { ascending: true })
  return (data ?? []) as DiarioRow[]
}

interface ContextoRow { dia: string; contexto: string; chamadas: number; tokens_totais: number; custo_usd: number }

async function getPorContexto(desde: string): Promise<ContextoRow[]> {
  const { data } = await supabaseAdmin
    .from('sdr_token_usage_contexto_diario')
    .select('*')
    .gte('dia', desde)
  return (data ?? []) as ContextoRow[]
}

// nome que o Aldo/Nei reconhecem; contexto novo sem entrada aparece com o código mesmo
const ROTULO_CONTEXTO: Record<string, string> = {
  processarMensagem: 'VictorIA — conversa com lojistas',
  'assistente-analista': 'VictorIA Analista (chat do painel)',
  'admin-chat': 'Comandos do WhatsApp (Aldo/Nei)',
  gerarMioloRetomada: 'Texto da retomada',
  resumoChamado: 'Resumo de chamado',
  extrairNomeRealDoHistorico: 'Nome real do lojista',
}

/** YYYY-MM-DD em Brasília (a view agrupa o dia em America/Sao_Paulo) */
function hojeBrt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('pt-BR')
}

function fmtUsd(n: number): string {
  return `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtBrl(n: number): string {
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDiaCurto(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export default async function TokensPage() {
  const tudo = await getDiario()
  const hoje = hojeBrt()
  const corte30 = new Date(Date.parse(`${hoje}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)
  const diario = tudo.filter((d) => d.dia >= corte30)
  const porContextoDias = await getPorContexto(corte30)

  // ─── mês atual × anterior ───
  const custoDe = (f: (d: DiarioRow) => boolean) => tudo.filter(f).reduce((s, d) => s + Number(d.custo_usd), 0)
  const mesAtual = hoje.slice(0, 7)
  const [ano, mes] = mesAtual.split('-').map(Number)
  const mesAnt = mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`
  const diaDoMes = Number(hoje.slice(8, 10))
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  const custoMes = custoDe((d) => d.dia.startsWith(mesAtual))
  const custoMesAnt = custoDe((d) => d.dia.startsWith(mesAnt))
  const projecao = diaDoMes > 0 ? (custoMes / diaDoMes) * diasNoMes : 0
  const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const linhaHoje = tudo.find((d) => d.dia === hoje)
  const linhaOntem = tudo.find((d) => d.dia === ontem)
  const temMesAntInteiro = tudo.some((d) => d.dia <= `${mesAnt}-01`)

  // ─── por uso (30 dias) ───
  const agreg = new Map<string, { chamadas: number; custo: number }>()
  for (const r of porContextoDias) {
    const a = agreg.get(r.contexto) ?? { chamadas: 0, custo: 0 }
    a.chamadas += Number(r.chamadas); a.custo += Number(r.custo_usd)
    agreg.set(r.contexto, a)
  }
  const porUso = [...agreg.entries()].map(([ctx, a]) => ({ ctx, ...a })).sort((x, y) => y.custo - x.custo)

  const custoTotal = diario.reduce((s, d) => s + Number(d.custo_usd), 0)
  const tokensTotais = diario.reduce((s, d) => s + Number(d.tokens_totais), 0)
  const chamadas = diario.reduce((s, d) => s + Number(d.chamadas), 0)
  const inputTotal = diario.reduce((s, d) => s + Number(d.input_tokens), 0)
  const outputTotal = diario.reduce((s, d) => s + Number(d.output_tokens), 0)
  const cacheReadTotal = diario.reduce((s, d) => s + Number(d.cache_read_tokens), 0)
  const cacheCreationTotal = diario.reduce(
    (s, d) => s + Number(d.cache_creation_tokens),
    0,
  )
  const custoMedio = chamadas > 0 ? custoTotal / chamadas : 0

  const chartData = diario.map((d) => ({
    dia: fmtDiaCurto(d.dia),
    custo: Number(d.custo_usd),
  }))

  const breakdown = [
    { label: 'Input', value: inputTotal, color: '#f97316' },
    { label: 'Output', value: outputTotal, color: '#16a34a' },
    { label: 'Cache (leitura)', value: cacheReadTotal, color: '#2563eb' },
    { label: 'Cache (criação)', value: cacheCreationTotal, color: '#7c3aed' },
  ]
  const breakdownTotal =
    inputTotal + outputTotal + cacheReadTotal + cacheCreationTotal

  const semDados = diario.length === 0

  return (
    <main>
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <header style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            href="/"
            style={{
              color: 'var(--text-dim)',
              textDecoration: 'none',
              fontSize: '0.85rem',
              padding: '0.35rem 0.6rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg-elev)',
            }}
          >
            ← Voltar
          </Link>
          <h1 style={{ margin: 0 }}>Consumo de tokens</h1>
        </div>
        <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Uso e custo da API Anthropic (VictorIA, Analista e rotinas) · câmbio estimado US$ 1 ≈ R$ {USD_BRL.toFixed(2)}
        </p>
      </header>

      {semDados ? (
        <div
          style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🪙</div>
          <strong style={{ color: 'var(--text)', display: 'block', marginBottom: '0.35rem' }}>
            Ainda sem dados de consumo
          </strong>
          O registro de tokens começa a partir de agora. Assim que a VictorIA
          processar conversas, os custos aparecerão aqui.
        </div>
      ) : (
        <>
          {/* ─── Mês ───────────────────────────────────────────────────── */}
          <h2>Este mês</h2>
          <div className="cards-grid">
            <Kpi
              label={`Gasto em ${mesAtual.slice(5)}/${mesAtual.slice(0, 4)} até hoje`}
              value={fmtUsd(custoMes)}
              hint={`≈ ${fmtBrl(custoMes * USD_BRL)} · ${diaDoMes} de ${diasNoMes} dias`}
            />
            <Kpi
              label="Projeção do mês"
              value={fmtUsd(projecao)}
              hint={`≈ ${fmtBrl(projecao * USD_BRL)} no ritmo atual`}
            />
            <Kpi
              label="Mês anterior"
              value={fmtUsd(custoMesAnt)}
              hint={temMesAntInteiro ? `≈ ${fmtBrl(custoMesAnt * USD_BRL)}` : 'registro incompleto no período'}
            />
            <Kpi
              label="Hoje"
              value={fmtUsd(Number(linhaHoje?.custo_usd ?? 0))}
              hint={`${fmtNum(Number(linhaHoje?.chamadas ?? 0))} chamadas · ontem ${fmtUsd(Number(linhaOntem?.custo_usd ?? 0))}`}
            />
          </div>

          {/* ─── KPIs ──────────────────────────────────────────────────── */}
          <h2>Últimos 30 dias</h2>
          <div className="cards-grid">
            <Kpi
              label="Custo total"
              value={fmtUsd(custoTotal)}
              hint={`≈ ${fmtBrl(custoTotal * USD_BRL)}`}
            />
            <Kpi
              label="Tokens totais"
              value={fmtNum(tokensTotais)}
              hint="input + output + cache"
            />
            <Kpi
              label="Chamadas IA"
              value={fmtNum(chamadas)}
              hint="requisições à API Claude"
            />
            <Kpi
              label="Custo médio / chamada"
              value={fmtUsd(custoMedio)}
              hint={`≈ ${fmtBrl(custoMedio * USD_BRL)}`}
            />
          </div>

          {/* ─── Gráfico ───────────────────────────────────────────────── */}
          <h2>Custo por dia</h2>
          <TokenChart data={chartData} />

          {/* ─── Por uso ───────────────────────────────────────────────── */}
          <h2>Onde o dinheiro vai (30 dias)</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Uso</th>
                  <th style={{ textAlign: 'right' }}>Chamadas</th>
                  <th style={{ textAlign: 'right' }}>Custo</th>
                  <th style={{ textAlign: 'right' }}>% do total</th>
                  <th style={{ textAlign: 'right' }}>Por chamada</th>
                </tr>
              </thead>
              <tbody>
                {porUso.map((u) => (
                  <tr key={u.ctx}>
                    <td style={{ fontWeight: 600 }}>{ROTULO_CONTEXTO[u.ctx] ?? u.ctx}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(u.chamadas)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>{fmtUsd(u.custo)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{custoTotal > 0 ? `${((u.custo / custoTotal) * 100).toFixed(1)}%` : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{u.chamadas > 0 ? fmtUsd(u.custo / u.chamadas) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ─── Composição ────────────────────────────────────────────── */}
          <h2>Composição dos tokens</h2>
          <div className="funnel">
            {breakdownTotal === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Sem tokens registrados no período.
              </div>
            ) : (
              breakdown.map((b) => {
                const pct = (b.value / breakdownTotal) * 100
                return (
                  <div key={b.label} className="breakdown-row">
                    <div className="breakdown-label">
                      <span>
                        {b.label}{' '}
                        <strong style={{ color: b.color, marginLeft: 6 }}>
                          {fmtNum(b.value)}
                        </strong>
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="breakdown-bar-bg">
                      <div
                        className="breakdown-bar-fill"
                        style={{ width: `${pct}%`, background: b.color }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* ─── Tabela diária ─────────────────────────────────────────── */}
          <h2>Detalhe diário</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Dia</th>
                  <th style={{ textAlign: 'right' }}>Chamadas</th>
                  <th style={{ textAlign: 'right' }}>Input</th>
                  <th style={{ textAlign: 'right' }}>Output</th>
                  <th style={{ textAlign: 'right' }}>Cache</th>
                  <th style={{ textAlign: 'right' }}>Tokens</th>
                  <th style={{ textAlign: 'right' }}>Custo</th>
                </tr>
              </thead>
              <tbody>
                {[...diario].reverse().map((d) => (
                  <tr key={d.dia}>
                    <td style={{ fontWeight: 600 }}>{fmtDiaCurto(d.dia)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(Number(d.chamadas))}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>
                      {fmtNum(Number(d.input_tokens))}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>
                      {fmtNum(Number(d.output_tokens))}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>
                      {fmtNum(
                        Number(d.cache_read_tokens) +
                          Number(d.cache_creation_tokens),
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {fmtNum(Number(d.tokens_totais))}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>
                      {fmtUsd(Number(d.custo_usd))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p style={{ marginTop: '3rem', color: 'var(--text-muted)', fontSize: '0.72rem', textAlign: 'center' }}>
        Dados da tabela sdr_token_usage · atualizados ao recarregar · custo calculado pela tabela de preços em lib/claude.ts (a fatura da Anthropic é a referência final)
      </p>
    </main>
  )
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value" style={{ color: 'var(--accent)' }}>
        {value}
      </div>
      <div className="card-hint">{hint}</div>
    </div>
  )
}
