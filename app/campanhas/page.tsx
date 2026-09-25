import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface CampanhaDia {
  dia: string
  total_leads: number
  responderam: number
  interessados: number
  formulario_enviado: number
  opt_out: number
  nao_qualificado: number
  descartados: number
  sem_resposta: number
  disparo_realizado: number
  produtos: string[] | null
  /** status LOJA_FINALIZADA_E_VENDENDO — loja finalizada e ativa (25/09/2026) */
  vendendo: number
  /** passou de Interessado e ainda não vende: pré-aprovação, cadastro recebido,
   *  em análise AIVA, treinar, login (25/09/2026) */
  em_andamento: number
}

async function getCampanhasPorDia(): Promise<CampanhaDia[]> {
  const { data } = await supabaseAdmin.rpc('get_campanhas_por_dia')
  return (data ?? []) as CampanhaDia[]
}

function fmtDia(iso: string): string {
  // iso vem como 'YYYY-MM-DD' (já em BRT). Não usar Date pra evitar shift de timezone.
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function pct(num: number, den: number): string {
  if (den === 0) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

function pctColor(pct: number): string {
  if (pct >= 25) return '#34d399'
  if (pct >= 10) return '#fbbf24'
  return '#f87171'
}

export default async function CampanhasPage() {
  const campanhas = await getCampanhasPorDia()

  const totalGeral = campanhas.reduce((s, c) => s + Number(c.total_leads), 0)
  const respondGeral = campanhas.reduce((s, c) => s + Number(c.responderam), 0)
  // "Formulário enviado" saiu (25/09/2026): o status morreu quando a coleta passou
  // pro chat e o card ficava sempre em 0. No lugar, as lojas que chegaram ao fim.
  const vendendoGeral = campanhas.reduce((s, c) => s + Number(c.vendendo ?? 0), 0)

  return (
    <main>
      <header style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            href="/"
            style={{
              color: 'var(--text-muted)',
              textDecoration: 'none',
              fontSize: '0.85rem',
              padding: '0.35rem 0.6rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            ← Voltar
          </Link>
          <h1 style={{ margin: 0 }}>Campanhas por dia</h1>
        </div>
        <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Funil de cada lote disparado · agrupado pelo dia em BRT
        </p>
      </header>

      {/* Resumo geral */}
      <div className="cards-grid" style={{ marginBottom: '2rem' }}>
        <SummaryCard label="Total disparado" value={totalGeral} hint="todos os lotes" color="#6b7280" />
        <SummaryCard
          label="Responderam"
          value={respondGeral}
          hint={pct(respondGeral, totalGeral) + ' de conversão'}
          color="#fb923c"
        />
        <SummaryCard
          label="Lojas vendendo"
          value={vendendoGeral}
          hint={`${pct(vendendoGeral, totalGeral)} do disparado · ${pct(vendendoGeral, respondGeral)} de quem respondeu`}
          color="#16a34a"
        />
        <SummaryCard
          label="Lotes (dias)"
          value={campanhas.length}
          hint="dias com disparo registrado"
          color="#a78bfa"
        />
      </div>

      {/* Tabela por dia */}
      {campanhas.length === 0 ? (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--text-muted)',
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          Nenhuma campanha disparada ainda.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Dia</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Responderam</th>
                <th style={{ textAlign: 'right' }}>Interessados</th>
                <th style={{ textAlign: 'right' }} title="Pré-aprovação, cadastro recebido, em análise AIVA, treinar e login">Em andamento</th>
                <th style={{ textAlign: 'right' }}>Vendendo</th>
                <th style={{ textAlign: 'right' }}>Opt-out</th>
                <th style={{ textAlign: 'right' }}>Não qualif.</th>
                <th style={{ textAlign: 'right' }}>Sem resposta</th>
                <th>Conv.</th>
              </tr>
            </thead>
            <tbody>
              {campanhas.map((c) => {
                const total = Number(c.total_leads)
                const responderam = Number(c.responderam)
                const vendendo = Number(c.vendendo ?? 0)
                const taxaResp = total > 0 ? (responderam / total) * 100 : 0
                const taxaVend = total > 0 ? (vendendo / total) * 100 : 0
                return (
                  <tr key={c.dia}>
                    <td>
                      <Link
                        href={`/?disparo_dia=${c.dia}`}
                        style={{
                          color: 'var(--accent)',
                          textDecoration: 'none',
                          fontWeight: 600,
                          borderBottom: '1px dotted var(--border-strong)',
                        }}
                        title="Ver leads desse lote"
                      >
                        {fmtDia(c.dia)}
                      </Link>
                      {c.produtos && c.produtos.length > 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                          {c.produtos.join(', ')}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{total}</td>
                    <td style={{ textAlign: 'right', color: '#fb923c' }}>{responderam}</td>
                    <td style={{ textAlign: 'right', color: '#34d399' }}>
                      {Number(c.interessados)}
                    </td>
                    <td style={{ textAlign: 'right', color: '#60a5fa', fontWeight: 600 }}>
                      {Number(c.em_andamento ?? 0)}
                    </td>
                    <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>
                      {vendendo}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {Number(c.opt_out)}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {Number(c.nao_qualificado)}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {Number(c.sem_resposta)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        <span
                          style={{
                            color: pctColor(taxaResp),
                            fontSize: '0.78rem',
                            fontWeight: 600,
                          }}
                          title="Taxa de resposta"
                        >
                          {taxaResp.toFixed(1)}%
                        </span>
                        <span
                          style={{
                            // escala própria: 2,5% do lote vendendo já é ótimo
                            color: pctColor(taxaVend * 10),
                            fontSize: '0.68rem',
                          }}
                          title="Lojas vendendo sobre o total disparado no dia"
                        >
                          vend.: {taxaVend.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: '2rem', color: 'var(--text-muted)', fontSize: '0.72rem', textAlign: 'center' }}>
        Clique no dia pra ver os leads daquele lote · taxas calculadas sobre o total disparado naquele dia ·
        “Em andamento” = pré-aprovação, cadastro recebido, em análise AIVA, treinar e login ·
        “Responderam” inclui quem já avançou (pré-aprovação até vendendo) · lote recente ainda não teve tempo de virar loja
      </p>
    </main>
  )
}

function SummaryCard({
  label,
  value,
  hint,
  color,
}: {
  label: string
  value: number
  hint: string
  color: string
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value" style={{ color }}>
        {value}
      </div>
      <div className="card-hint">{hint}</div>
    </div>
  )
}
