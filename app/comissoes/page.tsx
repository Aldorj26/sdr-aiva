import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { getPipeOpportunities, PIPELINE_MRR, TAG_IDS } from '@/lib/evotalks'
import { AIVA_GRUPOS, conferir, type LinhaComissao, type LinhaConferencia, type DesempenhoMes } from '@/lib/comissoes'
import { casaBusca } from '@/lib/text'
import ImportarForm from './ImportarForm'
import GravarRidButton from './GravarRidButton'
import ClickableRow from '../_components/ClickableRow'
import LeadDrawer from '../_components/LeadDrawer'

// Painel de Comissões AIVA/UME — importa as planilhas mensais de apuração da
// UME e confere automaticamente contra o funil 11 (Contas fechadas MRR).
// Spec: docs/superpowers/specs/2026-08-26-painel-comissoes-design.md
export const dynamic = 'force-dynamic'
export const revalidate = 0

type Aba = 'aiva' | 'ume'

const ESTADOS = {
  comissionada: { emoji: '✅', rotulo: 'Comissionada', cor: '#16a34a' },
  sem_venda: { emoji: '💤', rotulo: 'Sem venda no mês', cor: 'var(--text-muted)' },
  sem_rid: { emoji: '⚠️', rotulo: 'Sem Retailer ID', cor: '#d97706' },
  so_relatorio: { emoji: '🆕', rotulo: 'Só no relatório', cor: '#2563eb' },
} as const

const fmtBRL = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
const fmtInt = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('pt-BR'))

// Cabeçalho fixo — mesmo padrão do /desempenho (borda via box-shadow porque
// border-bottom se perde com borderCollapse: collapse quando o th gruda).
const thFixo: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-elev)',
  boxShadow: 'inset 0 -1px 0 var(--border)', whiteSpace: 'nowrap',
  textAlign: 'left', padding: '0.45rem 0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)',
}
const td: React.CSSProperties = { padding: '0.45rem 0.6rem', fontSize: '0.8rem', verticalAlign: 'middle' }

function chaveTel(s: string | null | undefined): string {
  let d = (s ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11) d = d.slice(0, 2) + d.slice(3)
  return d
}

// CNPJ→lead pra abrir a conversa (LeadDrawer) — mesmo mecanismo do /desempenho
// (regex em [0-9], NUNCA \d — o Postgres devolve null pra \d nesse caminho).
async function leadsPorChave(): Promise<{ porCnpj: Map<string, string>; porFone: Map<string, string> }> {
  const porCnpj = new Map<string, string>()
  const porFone = new Map<string, string>()
  try {
    const q =
      `select coalesce(jsonb_agg(t), '[]'::jsonb) from (` +
      `select id, telefone, ` +
      `substring(observacoes from 'cnpj_matriz=([0-9]{14})') as c1, ` +
      `substring(observacoes from 'CNPJ_RECEITA:cnpj=([0-9]{14})') as c2 ` +
      `from sdr_leads where produto = 'AIVA') t`
    const { data, error } = await supabaseAdmin.rpc('assistente_sql', { q })
    if (error) throw error
    for (const l of (data ?? []) as { id: string; telefone: string; c1: string | null; c2: string | null }[]) {
      if (l.c1) porCnpj.set(l.c1, l.id)
      if (l.c2 && !porCnpj.has(l.c2)) porCnpj.set(l.c2, l.id)
      const k = chaveTel(l.telefone)
      if (k && !porFone.has(k)) porFone.set(k, l.id)
    }
  } catch (e) {
    console.warn('[comissoes] mapa de leads indisponível (drawer desabilitado):', e)
  }
  return { porCnpj, porFone }
}

function Card({ label, value, sub, cor, href, ativo }: { label: string; value: string; sub?: string; cor?: string; href?: string; ativo?: boolean }) {
  const corpo = (
    <>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: cor ?? 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </>
  )
  const estilo: React.CSSProperties = {
    display: 'block', textDecoration: 'none', padding: '0.6rem 0.85rem', borderRadius: 8,
    border: `1px solid ${ativo ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-elev)', minWidth: 118,
  }
  return href ? <Link href={href} style={estilo}>{corpo}</Link> : <div style={estilo}>{corpo}</div>
}

export default async function ComissoesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; tab?: string; origem?: string; estado?: string; q?: string }>
}) {
  const sp = await searchParams
  const tab: Aba = sp.tab === 'ume' ? 'ume' : 'aiva'
  const origemUme = sp.origem === 'fcdl' ? 'fcdl' : 'carteira'

  const { data: metasTodas } = await supabaseAdmin
    .from('ume_comissoes_meta')
    .select('*')
    .order('mes', { ascending: false })
  const meses = [...new Set((metasTodas ?? []).map((m) => m.mes as string))]
  const mes = sp.mes && meses.includes(sp.mes) ? sp.mes : (meses[0] ?? '')

  const [{ data: linhasDb }, { data: desempDb }, contasTodas, { porCnpj, porFone }] = await Promise.all([
    supabaseAdmin.from('ume_comissoes').select('*').eq('mes', mes),
    supabaseAdmin.from('aiva_desempenho').select('cnpj, aprovados, vendas, valor_vendas').eq('mes', mes),
    getPipeOpportunities(PIPELINE_MRR).catch((e) => {
      console.error('[comissoes] funil 11 indisponível:', e)
      return []
    }),
    leadsPorChave(),
  ])
  const linhasMes = (linhasDb ?? []) as (LinhaComissao & { origem: string })[]
  const desempenhoMes = (desempDb ?? []) as DesempenhoMes[]
  const funil11Ok = contasTodas.length > 0

  const conf = conferir(
    contasTodas.map((o) => ({ id: o.id, title: o.title, mainphone: o.mainphone, description: o.description })),
    linhasMes,
    desempenhoMes,
  )

  // Aba de cada linha: pelo relatório (fcdl→UME; grupo AIVA→AIVA; senão UME);
  // sem relatório, pela tag da conta no Evo (69 = AIVA).
  const tagsPorOpp = new Map(contasTodas.map((o) => [o.id, o.tags ?? []]))
  const origemDe = (l: LinhaConferencia): string | null =>
    l.relatorio ? ((l.relatorio as LinhaComissao & { origem?: string }).origem ?? 'carteira') : null
  const abaDe = (l: LinhaConferencia): Aba => {
    if (l.relatorio) {
      if (origemDe(l) === 'fcdl') return 'ume'
      return AIVA_GRUPOS.has(l.relatorio.grupo ?? '') ? 'aiva' : 'ume'
    }
    return (tagsPorOpp.get(l.opp!.id) ?? []).includes(TAG_IDS.AIVA) ? 'aiva' : 'ume'
  }

  let rows = conf.filter((l) => abaDe(l) === tab)
  if (tab === 'ume') rows = rows.filter((l) => (origemDe(l) ?? 'carteira') === origemUme)

  // Cards de estado (contam a aba inteira, antes dos filtros de estado/busca)
  const porEstado = {
    comissionada: rows.filter((l) => l.estado === 'comissionada').length,
    sem_venda: rows.filter((l) => l.estado === 'sem_venda').length,
    sem_rid: rows.filter((l) => l.estado === 'sem_rid').length,
    so_relatorio: rows.filter((l) => l.estado === 'so_relatorio').length,
    divergencia: rows.filter((l) => l.divergencia).length,
  }

  if (sp.estado === 'divergencia') rows = rows.filter((l) => l.divergencia)
  else if (sp.estado && sp.estado in ESTADOS) rows = rows.filter((l) => l.estado === sp.estado)
  if (sp.q) {
    rows = rows.filter((l) =>
      casaBusca(sp.q!, [
        l.opp?.title, l.relatorio?.varejo, l.relatorio?.grupo, l.cnpj, l.umeRid, l.opp?.mainphone,
      ]),
    )
  }

  // ordena: divergências primeiro, depois por comissão desc, depois nome
  rows = [...rows].sort((a, b) => {
    if (a.divergencia !== b.divergencia) return a.divergencia ? -1 : 1
    const ca = a.relatorio?.comissao ?? -1, cb = b.relatorio?.comissao ?? -1
    if (ca !== cb) return cb - ca
    return (a.opp?.title ?? a.relatorio?.varejo ?? '').localeCompare(b.opp?.title ?? b.relatorio?.varejo ?? '', 'pt-BR')
  })

  // Totais da visão ativa (linhas do relatório da aba/origem) + NF do mês
  const linhasAba = linhasMes.filter((l) => {
    if (tab === 'ume') return l.origem === origemUme && (l.origem === 'fcdl' || !AIVA_GRUPOS.has(l.grupo ?? ''))
    return l.origem === 'carteira' && AIVA_GRUPOS.has(l.grupo ?? '')
  })
  const tot = {
    contratos: linhasAba.reduce((s, l) => s + (l.contratos ?? 0), 0),
    originacao: linhasAba.reduce((s, l) => s + (l.originacao ?? 0), 0),
    mdr: linhasAba.reduce((s, l) => s + (l.mdr ?? 0), 0),
    comissao: linhasAba.reduce((s, l) => s + (l.comissao ?? 0), 0),
  }
  const metasMes = (metasTodas ?? []).filter((m) => m.mes === mes)
  const valorNF = metasMes.reduce((s, m) => s + (Number(m.total_comissao) || 0), 0)

  // Δ comissão vs mês anterior (mesmo recorte da aba)
  const mesAnterior = meses[meses.indexOf(mes) + 1]
  let deltaPct: number | null = null
  if (mesAnterior) {
    const { data: antDb } = await supabaseAdmin.from('ume_comissoes').select('origem, grupo, comissao').eq('mes', mesAnterior)
    const antAba = ((antDb ?? []) as { origem: string; grupo: string | null; comissao: number | null }[]).filter((l) => {
      if (tab === 'ume') return l.origem === origemUme && (l.origem === 'fcdl' || !AIVA_GRUPOS.has(l.grupo ?? ''))
      return l.origem === 'carteira' && AIVA_GRUPOS.has(l.grupo ?? '')
    })
    const antTotal = antAba.reduce((s, l) => s + (l.comissao ?? 0), 0)
    if (antTotal > 0) deltaPct = ((tot.comissao - antTotal) / antTotal) * 100
  }

  // Aviso de inconsistência interna da planilha (linhas × total declarado)
  const avisos: string[] = []
  for (const m of metasMes) {
    const somaOrigem = linhasMes.filter((l) => l.origem === m.origem).reduce((s, l) => s + (l.comissao ?? 0), 0)
    const delta = somaOrigem - (Number(m.total_comissao) || 0)
    if (Math.abs(delta) > 0.05) {
      avisos.push(`${m.origem}: linhas somam ${fmtBRL(somaOrigem)}, total declarado pela UME ${fmtBRL(Number(m.total_comissao))} (delta ${fmtBRL(delta)})`)
    }
  }

  const grupoNaoClassificado = tab === 'ume' && origemUme === 'carteira'
    ? [...new Set(linhasAba.map((l) => l.grupo).filter((g) => g && g !== 'SEM GRUPO' && !/^INSTITUTO|^IVS|^GRUPO_|^REALME_CAMPO/i.test(g!)))]
    : []

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const base: Record<string, string | undefined> = { mes, tab, origem: tab === 'ume' ? origemUme : undefined, estado: sp.estado, q: sp.q, ...extra }
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v)
    return `/comissoes?${p.toString()}`
  }

  return (
    <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column', paddingBottom: '1.25rem', overflow: 'hidden' }}>
      <header style={{ marginBottom: '1rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: '0.85rem', padding: '0.35rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-elev)' }}>← Voltar</Link>
          <h1 style={{ margin: 0 }}>💰 Comissões</h1>
          {meses.length > 0 && (
            <div style={{ display: 'flex', gap: '0.3rem' }}>
              {meses.map((m) => (
                <Link key={m} href={qs({ mes: m, estado: undefined })} style={{
                  padding: '0.3rem 0.6rem', borderRadius: 6, textDecoration: 'none', fontSize: '0.8rem',
                  border: `1px solid ${m === mes ? 'var(--accent)' : 'var(--border)'}`,
                  color: m === mes ? 'var(--accent)' : 'var(--text-muted)', fontWeight: m === mes ? 700 : 400,
                  background: 'var(--bg-elev)',
                }}>{m}</Link>
              ))}
            </div>
          )}
          <div style={{ marginLeft: 'auto' }}><ImportarForm /></div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.4rem 0 0' }}>
          Conferência automática do relatório mensal da UME contra o funil Contas fechadas MRR.
          Loja fora do relatório = sem venda no mês (regra alinhada com a UME em 19/08).
          {!funil11Ok && <span style={{ color: '#dc2626' }}> ⚠️ Funil 11 indisponível agora — só o relatório está sendo mostrado.</span>}
        </p>
        {avisos.length > 0 && (
          <p style={{ color: '#d97706', fontSize: '0.78rem', margin: '0.3rem 0 0' }}>
            ⚠️ Inconsistência interna do relatório da UME — {avisos.join(' · ')}
          </p>
        )}
      </header>

      {/* Abas */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', flexShrink: 0, alignItems: 'center' }}>
        {(['aiva', 'ume'] as const).map((a) => (
          <Link key={a} href={qs({ tab: a, estado: undefined, origem: undefined })} style={{
            padding: '0.5rem 1rem', borderRadius: 8, textDecoration: 'none', fontSize: '0.88rem', fontWeight: 600,
            border: `1px solid ${tab === a ? 'var(--accent)' : 'var(--border)'}`,
            background: tab === a ? 'var(--accent)' : 'var(--bg-elev)', color: tab === a ? '#fff' : 'var(--text)',
          }}>{a === 'aiva' ? '📱 AIVA' : '🏬 UME'}</Link>
        ))}
        {tab === 'ume' && (
          <div style={{ display: 'flex', gap: '0.3rem', marginLeft: '0.5rem' }}>
            {(['carteira', 'fcdl'] as const).map((o) => (
              <Link key={o} href={qs({ origem: o, estado: undefined })} style={{
                padding: '0.35rem 0.7rem', borderRadius: 6, textDecoration: 'none', fontSize: '0.78rem',
                border: `1px solid ${origemUme === o ? 'var(--accent)' : 'var(--border)'}`,
                color: origemUme === o ? 'var(--accent)' : 'var(--text-muted)', fontWeight: origemUme === o ? 700 : 400,
                background: 'var(--bg-elev)',
              }}>{o === 'carteira' ? 'Carteira' : 'FCDL'}</Link>
            ))}
          </div>
        )}
        {grupoNaoClassificado.length > 0 && (
          <span style={{ fontSize: '0.72rem', color: '#d97706' }}>grupos não classificados: {grupoNaoClassificado.join(', ')}</span>
        )}
      </div>

      {/* Cards do mês */}
      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.7rem', flexShrink: 0 }}>
        <Card label="Contratos" value={fmtInt(tot.contratos)} />
        <Card label="Originação" value={fmtBRL(tot.originacao)} />
        <Card label="MDR" value={fmtBRL(tot.mdr)} />
        <Card
          label={`Comissão ${tab.toUpperCase()}${tab === 'ume' ? ` (${origemUme})` : ''}`}
          value={fmtBRL(tot.comissao)}
          sub={deltaPct != null ? `${deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(1)}% vs ${mesAnterior}` : undefined}
          cor="var(--accent)"
        />
        <Card label="Valor da NF (Carteira + FCDL)" value={fmtBRL(valorNF)} sub="valor a faturar no mês" cor="#16a34a" />
      </section>

      {/* Cards-filtro por estado */}
      <section style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.7rem', flexShrink: 0 }}>
        {(Object.keys(ESTADOS) as (keyof typeof ESTADOS)[]).map((e) => (
          <Card key={e}
            label={`${ESTADOS[e].emoji} ${ESTADOS[e].rotulo}`}
            value={String(porEstado[e])}
            cor={ESTADOS[e].cor}
            href={qs({ estado: sp.estado === e ? undefined : e })}
            ativo={sp.estado === e}
          />
        ))}
        <Card label="🔴 Divergências" value={String(porEstado.divergencia)}
          cor={porEstado.divergencia > 0 ? '#dc2626' : 'var(--text-muted)'}
          href={qs({ estado: sp.estado === 'divergencia' ? undefined : 'divergencia' })}
          ativo={sp.estado === 'divergencia'}
        />
      </section>

      {/* Busca */}
      <form method="get" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap', flexShrink: 0 }}>
        <input type="hidden" name="mes" value={mes} />
        <input type="hidden" name="tab" value={tab} />
        {tab === 'ume' && <input type="hidden" name="origem" value={origemUme} />}
        {sp.estado && <input type="hidden" name="estado" value={sp.estado} />}
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Loja, CNPJ, Retailer ID, grupo, telefone…"
          style={{ padding: '0.45rem 0.7rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)', minWidth: 300 }} />
        <button type="submit" style={{ padding: '0.45rem 0.9rem', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>Buscar</button>
      </form>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thFixo}>Estado</th>
              <th style={thFixo}>Loja</th>
              <th style={thFixo}>Retailer ID</th>
              <th style={thFixo}>CNPJ</th>
              <th style={thFixo}>Grupo</th>
              <th style={{ ...thFixo, textAlign: 'right' }}>Contratos</th>
              <th style={{ ...thFixo, textAlign: 'right' }}>Originação</th>
              <th style={{ ...thFixo, textAlign: 'right' }}>MDR</th>
              <th style={{ ...thFixo, textAlign: 'right' }}>Comissão</th>
              {tab === 'aiva' && <th style={thFixo}>Data Studio</th>}
              <th style={thFixo}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td style={td} colSpan={11}>
                {meses.length === 0 ? 'Nenhum relatório importado ainda — use o botão "Importar relatório".' : 'Nada com esse filtro.'}
              </td></tr>
            )}
            {rows.map((l, i) => {
              const est = ESTADOS[l.estado]
              const leadId = (l.cnpj ? porCnpj.get(l.cnpj) : undefined) ?? (l.opp?.mainphone ? porFone.get(chaveTel(l.opp.mainphone)) : undefined) ?? null
              const celulas = (
                <>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span style={{ color: est.cor, fontWeight: 600, fontSize: '0.76rem' }}>{est.emoji} {est.rotulo}</span>
                    {l.divergencia && <span title="Sem comissão no mês, mas o Data Studio mostra vendas — questionar a UME" style={{ marginLeft: 4 }}>🔴</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 260 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {leadId ? '💬 ' : ''}{l.opp?.title ?? l.relatorio?.varejo ?? '—'}
                    </div>
                    {l.opp && l.relatorio?.varejo && l.opp.title.toLowerCase() !== l.relatorio.varejo.toLowerCase() && (
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>UME: {l.relatorio.varejo}</div>
                    )}
                  </td>
                  <td style={td}>{l.umeRid ?? '—'}</td>
                  <td style={{ ...td, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{l.cnpj ?? '—'}</td>
                  <td style={{ ...td, fontSize: '0.72rem' }}>{l.relatorio?.grupo ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtInt(l.relatorio?.contratos)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBRL(l.relatorio?.originacao)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBRL(l.relatorio?.mdr)}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtBRL(l.relatorio?.comissao)}</td>
                  {tab === 'aiva' && (
                    <td style={{ ...td, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                      {l.desempenho ? `${fmtInt(l.desempenho.vendas)} vendas · ${fmtBRL(l.desempenho.valor_vendas)}` : '—'}
                    </td>
                  )}
                  <td style={td}>
                    {l.estado === 'sem_rid' && l.casouPorCnpj && l.opp && l.relatorio?.retailer_id != null && (
                      <GravarRidButton opportunityId={l.opp.id} retailerId={l.relatorio.retailer_id} />
                    )}
                  </td>
                </>
              )
              const key = `${l.opp?.id ?? 'rel'}-${l.umeRid ?? l.cnpj ?? i}`
              return leadId ? (
                <ClickableRow key={key} leadId={leadId} style={{ borderBottom: '1px solid var(--border)' }}>{celulas}</ClickableRow>
              ) : (
                <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>{celulas}</tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <LeadDrawer />
    </main>
  )
}
