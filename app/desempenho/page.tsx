import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import ClickableRow from '../_components/ClickableRow'
import LeadDrawer from '../_components/LeadDrawer'

// Desempenho dos lojistas ativos na AIVA — snapshot mensal importado do
// Data Studio "Parceiros - AIVA" (rotina semanal via Chrome do Aldo +
// scripts/importar-desempenho-aiva.mjs). Uma tela só: as "Visões
// Específicas" do relatório viram filtros aqui.
export const dynamic = 'force-dynamic'
export const revalidate = 0

type Row = {
  mes: string
  cnpj: string
  nome_varejo: string | null
  loja: string | null
  uf: string | null
  cidade: string | null
  status_consulta: string | null
  aprovados: number | null
  vendas: number | null
  conversao: number | null
  valor_vendas: number | null
  ticket_medio: number | null
  sem_venda: boolean
  sem_consulta: boolean
  sem_operador: boolean
  telefone: string | null
  atualizado_em: string
}

// Telefone canônico pra casar desempenho ↔ sdr_leads (tira 55 e o 9º dígito),
// mesmo critério do lib/clientes.ts.
function chaveTel(s: string | null | undefined): string {
  let d = (s ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11) d = d.slice(0, 2) + d.slice(3)
  return d
}

// Mapa CNPJ→lead e telefone→lead pra abrir a conversa (LeadDrawer) ao clicar.
// O CNPJ do lead mora dentro de observacoes (cnpj_matriz=… / [CNPJ_RECEITA:cnpj=…]),
// então a extração é feita no banco via a RPC read-only assistente_sql — trazer
// as observacoes inteiras de ~6 mil leads pra cá seria pesado demais por render.
async function mapasDeLeads(): Promise<{ porCnpj: Map<string, string>; porFone: Map<string, string> }> {
  const porCnpj = new Map<string, string>()
  const porFone = new Map<string, string>()
  try {
    const q =
      `select coalesce(jsonb_agg(t), '[]'::jsonb) from (` +
      `select id, telefone, ` +
      `substring(observacoes from 'cnpj_matriz=(\\d{14})') as c1, ` +
      `substring(observacoes from 'CNPJ_RECEITA:cnpj=(\\d{14})') as c2 ` +
      `from sdr_leads where produto = 'AIVA') t`
    const { data, error } = await supabaseAdmin.rpc('assistente_sql', { q })
    if (error) throw error
    for (const l of (data ?? []) as { id: string; telefone: string; c1: string | null; c2: string | null }[]) {
      if (l.c1) porCnpj.set(l.c1, l.id)
      if (l.c2 && !porCnpj.has(l.c2)) porCnpj.set(l.c2, l.id)
      const k = chaveTel(l.telefone)
      if (k) porFone.set(k, l.id)
    }
  } catch (e) {
    console.warn('[desempenho] mapa de leads indisponível (drawer desabilitado):', e)
  }
  return { porCnpj, porFone }
}

const fmtBRL = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

// Cabeçalho fixo: a linha de títulos acompanha a rolagem da tabela.
// A borda vem de box-shadow (e não border-bottom) porque com
// borderCollapse: 'collapse' a borda do <th> fica pra trás quando ele gruda.
const thFixo: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'var(--bg-elev)',
  boxShadow: 'inset 0 -1px 0 var(--border)',
  whiteSpace: 'nowrap',
}

function Card({ label, value, color, href, ativo }: { label: string; value: string; color?: string; href: string; ativo?: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: 'block', textDecoration: 'none', padding: '0.7rem 0.9rem', borderRadius: 8,
        border: `1px solid ${ativo ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-elev)', minWidth: 130,
      }}
    >
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</div>
    </Link>
  )
}

export default async function DesempenhoPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; filtro?: string; uf?: string; q?: string; sort?: string; dir?: string }>
}) {
  const sp = await searchParams

  const { data: meses } = await supabaseAdmin
    .from('aiva_desempenho')
    .select('mes')
    .order('mes', { ascending: false })
  const mesesDisponiveis = [...new Set((meses ?? []).map((m) => m.mes))]
  const mes = sp.mes && mesesDisponiveis.includes(sp.mes) ? sp.mes : (mesesDisponiveis[0] ?? '')

  const { data } = await supabaseAdmin
    .from('aiva_desempenho')
    .select('*')
    .eq('mes', mes)
    .order('valor_vendas', { ascending: false, nullsFirst: false })
  const todas = (data ?? []) as Row[]

  // Mês anterior pra tendência (seta por loja)
  const mesAnterior = mesesDisponiveis[mesesDisponiveis.indexOf(mes) + 1]
  const anterior = new Map<string, Row>()
  if (mesAnterior) {
    const { data: ant } = await supabaseAdmin.from('aiva_desempenho').select('cnpj, vendas, aprovados').eq('mes', mesAnterior)
    for (const r of (ant ?? []) as Row[]) anterior.set(r.cnpj, r)
  }

  const filtro = sp.filtro ?? ''
  let rows = todas
  if (filtro === 'sem_venda') rows = rows.filter((r) => r.sem_venda)
  if (filtro === 'sem_consulta') rows = rows.filter((r) => r.sem_consulta)
  if (filtro === 'sem_operador') rows = rows.filter((r) => r.sem_operador)
  if (sp.uf) rows = rows.filter((r) => r.uf === sp.uf)
  if (sp.q) {
    const q = sp.q.toLowerCase()
    rows = rows.filter((r) =>
      [r.nome_varejo, r.loja, r.cidade, r.cnpj].some((v) => String(v ?? '').toLowerCase().includes(q)),
    )
  }

  // Ordenação por clique no cabeçalho: 1º clique = maior→menor, 2º inverte.
  const COLUNAS: Record<string, { rotulo: string; campo: keyof Row; numerica: boolean }> = {
    loja: { rotulo: 'Loja', campo: 'loja', numerica: false },
    uf: { rotulo: 'UF', campo: 'uf', numerica: false },
    cidade: { rotulo: 'Cidade', campo: 'cidade', numerica: false },
    status: { rotulo: 'Status', campo: 'status_consulta', numerica: false },
    aprovados: { rotulo: 'Aprovados', campo: 'aprovados', numerica: true },
    vendas: { rotulo: 'Vendas', campo: 'vendas', numerica: true },
    conv: { rotulo: 'Conv.', campo: 'conversao', numerica: true },
    valor: { rotulo: 'Valor', campo: 'valor_vendas', numerica: true },
    ticket: { rotulo: 'Ticket', campo: 'ticket_medio', numerica: true },
  }
  const sort = sp.sort && COLUNAS[sp.sort] ? sp.sort : 'valor'
  const dir = sp.dir === 'asc' ? 'asc' : 'desc'
  {
    const { campo, numerica } = COLUNAS[sort]
    rows = [...rows].sort((a, b) => {
      const va = a[campo], vb = b[campo]
      // nulos sempre por último, independente da direção
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = numerica
        ? Number(va) - Number(vb)
        : String(va).localeCompare(String(vb), 'pt-BR', { sensitivity: 'base' })
      return dir === 'asc' ? cmp : -cmp
    })
  }

  const tot = {
    aprovados: todas.reduce((s, r) => s + (r.aprovados ?? 0), 0),
    vendas: todas.reduce((s, r) => s + (r.vendas ?? 0), 0),
    valor: todas.reduce((s, r) => s + (r.valor_vendas ?? 0), 0),
    semVenda: todas.filter((r) => r.sem_venda).length,
    semConsulta: todas.filter((r) => r.sem_consulta).length,
    semOperador: todas.filter((r) => r.sem_operador).length,
  }
  const convMedia = tot.aprovados > 0 ? tot.vendas / tot.aprovados : null
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams()
    if (mes) p.set('mes', mes)
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
    return `/desempenho?${p.toString()}`
  }
  // Link de ordenação: preserva mês + filtros; clicar na coluna ativa inverte a direção.
  const qsSort = (col: string) => {
    const p = new URLSearchParams()
    if (mes) p.set('mes', mes)
    if (filtro) p.set('filtro', filtro)
    if (sp.uf) p.set('uf', sp.uf)
    if (sp.q) p.set('q', sp.q)
    p.set('sort', col)
    p.set('dir', sort === col && dir === 'desc' ? 'asc' : 'desc')
    return `/desempenho?${p.toString()}`
  }
  const atualizadoEm = todas[0]?.atualizado_em
  const { porCnpj, porFone } = await mapasDeLeads()

  return (
    // Coluna com a altura da tela: cabeçalho/cards/filtros ficam parados e
    // só a tabela rola — é o que permite o <thead> sticky colar de verdade
    // (sticky precisa de um container que role, e o wrapper com overflow
    // auto só rola se tiver altura limitada).
    <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column', paddingBottom: '1.25rem', overflow: 'hidden' }}>
      <header style={{ marginBottom: '1.25rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: '0.85rem', padding: '0.35rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-elev)' }}>← Voltar</Link>
          <h1 style={{ margin: 0 }}>Desempenho AIVA</h1>
          <nav style={{ display: 'flex', gap: '0.4rem' }}>
            {mesesDisponiveis.map((m) => (
              <Link key={m} href={`/desempenho?mes=${m}`} style={{ fontSize: '0.8rem', textDecoration: 'none', padding: '0.25rem 0.55rem', borderRadius: 6, border: `1px solid ${m === mes ? 'var(--accent)' : 'var(--border)'}`, color: m === mes ? 'var(--accent)' : 'var(--text-dim)', background: 'var(--bg-elev)' }}>{m}</Link>
            ))}
          </nav>
        </div>
        <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          {todas.length === 0
            ? 'Nenhum snapshot importado ainda — rode a exportação semanal.'
            : `${todas.length} lojas no snapshot ${mes} · importado ${atualizadoEm ? new Date(atualizadoEm).toLocaleDateString('pt-BR') : ''} do Data Studio Parceiros-AIVA`}
        </p>
      </header>

      <section style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.25rem', flexShrink: 0 }}>
        <Card label="Lojas" value={String(todas.length)} href={qs({})} ativo={!filtro} />
        <Card label="Aprovados" value={tot.aprovados.toLocaleString('pt-BR')} href={qs({})} />
        <Card label="Vendas" value={tot.vendas.toLocaleString('pt-BR')} href={qs({})} />
        <Card label="Valor vendido" value={fmtBRL(tot.valor)} href={qs({})} />
        <Card label="Conversão média" value={fmtPct(convMedia)} color="var(--accent)" href={qs({})} />
        <Card label="Sem venda" value={String(tot.semVenda)} color={tot.semVenda > 0 ? 'var(--red)' : undefined} href={qs({ filtro: 'sem_venda' })} ativo={filtro === 'sem_venda'} />
        <Card label="Sem consulta" value={String(tot.semConsulta)} color={tot.semConsulta > 0 ? 'var(--red)' : undefined} href={qs({ filtro: 'sem_consulta' })} ativo={filtro === 'sem_consulta'} />
        <Card label="Sem operador" value={String(tot.semOperador)} color={tot.semOperador > 0 ? 'var(--red)' : undefined} href={qs({ filtro: 'sem_operador' })} ativo={filtro === 'sem_operador'} />
      </section>

      <form method="get" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.9rem', flexWrap: 'wrap', flexShrink: 0 }}>
        <input type="hidden" name="mes" value={mes} />
        {filtro && <input type="hidden" name="filtro" value={filtro} />}
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Buscar loja, cidade ou CNPJ…" style={{ padding: '0.45rem 0.7rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)', minWidth: 260 }} />
        <select name="uf" defaultValue={sp.uf ?? ''} style={{ padding: '0.45rem 0.7rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)' }}>
          <option value="">Todas as UFs</option>
          {[...new Set(todas.map((r) => r.uf).filter(Boolean))].sort().map((uf) => (
            <option key={uf} value={uf!}>{uf}</option>
          ))}
        </select>
        <button type="submit" style={{ padding: '0.45rem 0.9rem', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>Filtrar</button>
      </form>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              {Object.entries(COLUNAS).map(([col, def]) => (
                <th key={col} style={{ ...thFixo, padding: 0 }}>
                  <Link
                    href={qsSort(col)}
                    title={sort === col && dir === 'desc' ? 'Ordenar do menor pro maior' : 'Ordenar do maior pro menor'}
                    style={{
                      display: 'block', padding: '0.45rem 0.6rem', textDecoration: 'none',
                      color: sort === col ? 'var(--accent)' : 'var(--text-muted)', fontWeight: sort === col ? 700 : 600,
                    }}
                  >
                    {def.rotulo}
                    {sort === col ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </Link>
                </th>
              ))}
              <th style={{ ...thFixo, padding: '0.45rem 0.6rem' }}>Tend.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ant = anterior.get(r.cnpj)
              const tend = ant?.vendas == null || r.vendas == null ? '—' : r.vendas > (ant.vendas ?? 0) ? '▲' : r.vendas < (ant.vendas ?? 0) ? '▼' : '='
              const tendCor = tend === '▲' ? 'var(--green)' : tend === '▼' ? 'var(--red)' : 'var(--text-dim)'
              const leadId = porCnpj.get(r.cnpj) ?? (r.telefone ? porFone.get(chaveTel(r.telefone)) : undefined) ?? null
              const celulas = (
                <>
                  <td style={{ padding: '0.45rem 0.6rem', maxWidth: 280 }} title={leadId ? 'Abrir a conversa do lead' : 'Loja sem lead no painel (veio direto da AIVA)'}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {leadId ? '💬 ' : ''}{r.loja ?? r.nome_varejo ?? r.cnpj}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{r.cnpj}{r.sem_venda ? ' · sem venda' : ''}{r.sem_consulta ? ' · sem consulta' : ''}{r.sem_operador ? ' · sem operador' : ''}</div>
                  </td>
                  <td style={{ padding: '0.45rem 0.6rem' }}>{r.uf ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem' }}>{r.cidade ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem' }}>{r.status_consulta ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{r.aprovados ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{r.vendas ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{fmtPct(r.conversao)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBRL(r.valor_vendas)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBRL(r.ticket_medio)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', color: tendCor, textAlign: 'center' }}>{tend}</td>
                </>
              )
              return leadId ? (
                <ClickableRow key={r.cnpj} leadId={leadId} style={{ borderBottom: '1px solid var(--border)' }}>
                  {celulas}
                </ClickableRow>
              ) : (
                <tr key={r.cnpj} style={{ borderBottom: '1px solid var(--border)' }}>{celulas}</tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && todas.length > 0 && (
        <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Nenhuma loja com esse filtro.</p>
      )}
      <LeadDrawer />
    </main>
  )
}
