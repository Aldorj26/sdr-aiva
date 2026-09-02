import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { casaBusca } from '@/lib/text'
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

// Dados do lead casados por CNPJ e por telefone. Servem pra duas coisas:
// abrir a conversa ao clicar na linha (LeadDrawer) e alimentar a busca com o
// que NÃO existe no snapshot do Data Studio — e-mail, nome do sócio e o
// telefone das lojas que vieram sem ele (58 das 108 em 2026-08).
// A extração acontece no banco (RPC read-only assistente_sql) porque o CNPJ e o
// e-mail moram dentro de observacoes; trazer as observacoes inteiras de ~6 mil
// leads pra cá seria pesado demais por render.
//
// ⚠️ Regex em [0-9] e NÃO \d: nesse caminho o Postgres não reconhece \d e
// devolve null pra tudo — foi o que deixou o mapa de CNPJ vazio desde que a
// tela nasceu (só abria a conversa quem tinha telefone no snapshot).
// Corrigido em 25/08/2026.
type InfoLead = { id: string; telefone: string | null; email: string | null; socio: string | null }

async function mapasDeLeads(): Promise<{ porCnpj: Map<string, InfoLead>; porFone: Map<string, InfoLead> }> {
  const porCnpj = new Map<string, InfoLead>()
  const porFone = new Map<string, InfoLead>()
  try {
    const q =
      `select coalesce(jsonb_agg(t), '[]'::jsonb) from (` +
      `select id, telefone, ` +
      `substring(observacoes from 'cnpj_matriz=([0-9]{14})') as c1, ` +
      `substring(observacoes from 'CNPJ_RECEITA:cnpj=([0-9]{14})') as c2, ` +
      `substring(observacoes from 'email_socio=([^|]+)') as email, ` +
      `substring(observacoes from 'nome_socio=([^|]+)') as socio ` +
      `from sdr_leads where produto = 'AIVA') t`
    const { data, error } = await supabaseAdmin.rpc('assistente_sql', { q })
    if (error) throw error
    type LinhaSql = { id: string; telefone: string; c1: string | null; c2: string | null; email: string | null; socio: string | null }
    for (const l of (data ?? []) as LinhaSql[]) {
      const info: InfoLead = { id: l.id, telefone: l.telefone, email: l.email, socio: l.socio }
      if (l.c1) porCnpj.set(l.c1, info)
      if (l.c2 && !porCnpj.has(l.c2)) porCnpj.set(l.c2, info)
      const k = chaveTel(l.telefone)
      if (k) porFone.set(k, info)
    }
  } catch (e) {
    console.warn('[desempenho] mapa de leads indisponível (drawer e busca por e-mail desabilitados):', e)
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

// ─── CS — a carteira de lojas ativas (pedido do Aldo 02/09) ──────────────────
// O /desempenho é o cockpit de CS do Nei: acionamentos de humano de lojas em
// LOJA_FINALIZADA_E_VENDENDO aparecem AQUI (e saíram do painel pipeline, que
// mantém só um contador com link). Radar de churn vem do snapshot semanal.
const RE_MOTIVO_CS =
  /(acesso_[a-z_]+|desanimo_[a-z_]+|troca_[a-z_]+|duvida_[^|[\n]*|pediu[^|[\n]*|interesse_[^|[\n]*|loja_[^|[\n]*|usuario_[^|[\n]*|alterac[^|[\n]*|campanha[^|[\n]*)/i

function motivoDe(obs: string | null): string {
  return ((obs ?? '').match(RE_MOTIVO_CS)?.[1] ?? '').trim().slice(0, 70)
}

async function getCsData() {
  const h24 = new Date(Date.now() - 24 * 3600e3).toISOString()
  const d7 = new Date(Date.now() - 7 * 86400e3).toISOString()
  const [humano, conversas, ativacoes, semanas] = await Promise.all([
    supabaseAdmin
      .from('sdr_leads')
      .select('id, nome, telefone, data_ultimo_contato, observacoes')
      .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
      .eq('acionar_humano', true)
      .order('data_ultimo_contato', { ascending: false, nullsFirst: false })
      .limit(30),
    supabaseAdmin
      .from('sdr_leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
      .gte('data_ultimo_contato', h24),
    supabaseAdmin
      .from('sdr_registros_cnpj')
      .select('loja, cnpj, rid, ativa_em')
      .eq('status', 'ativa')
      .gte('ativa_em', d7)
      .order('ativa_em', { ascending: false })
      .limit(12),
    supabaseAdmin.from('aiva_desempenho_semanal').select('semana').order('semana', { ascending: false }).limit(60),
  ])

  // Radar de churn: última semana coletada vs a anterior (mesma segmentação do
  // pulso de segunda — A zerou / B aprovou-não-vendeu / C queda).
  const semanasDisp = [...new Set((semanas.data ?? []).map((s) => s.semana as string))]
  const radar: { loja: string; cnpj: string; tag: string }[] = []
  if (semanasDisp[0]) {
    const { data: sw } = await supabaseAdmin
      .from('aiva_desempenho_semanal')
      .select('cnpj, loja, nome_varejo, aprovados, vendas')
      .eq('semana', semanasDisp[0])
    const ant = new Map<string, number>()
    if (semanasDisp[1]) {
      const { data: swAnt } = await supabaseAdmin
        .from('aiva_desempenho_semanal')
        .select('cnpj, vendas')
        .eq('semana', semanasDisp[1])
      for (const r of swAnt ?? []) ant.set(r.cnpj, r.vendas ?? 0)
    }
    for (const r of sw ?? []) {
      const va = ant.get(r.cnpj)
      const nome = (r.loja ?? r.nome_varejo ?? r.cnpj) as string
      if ((r.vendas ?? 0) > 0 && va !== undefined && (r.vendas ?? 0) < va && va >= 2) {
        radar.push({ loja: nome, cnpj: r.cnpj, tag: `📉 caiu ${va}→${r.vendas}` })
      } else if ((r.vendas ?? 0) === 0 && (r.aprovados ?? 0) > 0) {
        radar.push({ loja: nome, cnpj: r.cnpj, tag: `⚠️ ${r.aprovados} aprovado(s), 0 venda` })
      } else if ((r.vendas ?? 0) === 0 && (r.aprovados ?? 0) === 0) {
        radar.push({ loja: nome, cnpj: r.cnpj, tag: '🛑 zerou a semana' })
      }
    }
  }
  return {
    humano: humano.data ?? [],
    conversas24h: conversas.count ?? 0,
    ativacoes: ativacoes.data ?? [],
    radar,
    semanaRadar: semanasDisp[0] ?? null,
  }
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

  const { porCnpj, porFone } = await mapasDeLeads()
  const cs = await getCsData()
  // Dados do lead pra uma linha do snapshot: casa por CNPJ e, se não achar,
  // pelo telefone que veio do Data Studio.
  const infoDe = (r: Row) => porCnpj.get(r.cnpj) ?? (r.telefone ? porFone.get(chaveTel(r.telefone)) : undefined)

  const filtro = sp.filtro ?? ''
  let rows = todas
  if (filtro === 'sem_venda') rows = rows.filter((r) => r.sem_venda)
  if (filtro === 'sem_consulta') rows = rows.filter((r) => r.sem_consulta)
  if (filtro === 'sem_operador') rows = rows.filter((r) => r.sem_operador)
  if (sp.uf) rows = rows.filter((r) => r.uf === sp.uf)
  if (sp.q) {
    // Mesma busca do /registros (lib/text.ts): ignora acento/caixa e, pra
    // número, compara só os dígitos — então "52.618.643/0001-05" e
    // "(47) 99608-5000" acham a linha do mesmo jeito que a versão sem máscara.
    // Campos do lead (e-mail, sócio, telefone) entram junto: o snapshot do Data
    // Studio não traz e-mail e deixa 58 das 108 lojas sem telefone.
    rows = rows.filter((r) => {
      const info = infoDe(r)
      return casaBusca(sp.q!, [
        r.loja, r.nome_varejo, r.cidade, r.uf, r.cnpj, r.status_consulta,
        r.telefone, info?.telefone, info?.email, info?.socio,
      ])
    })
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

      {/* ─── CS — atendimento das lojas ativas ─────────────────────────────── */}
      <section style={{ marginBottom: '1.1rem', flexShrink: 0, border: '1px solid var(--border)', borderLeft: '3px solid #a855f7', borderRadius: 8, background: 'var(--bg-elev)', padding: '0.7rem 0.9rem' }}>
        <div style={{ display: 'flex', gap: '1.4rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <strong style={{ color: '#a855f7', fontSize: '0.85rem' }}>🟣 CS — carteira de lojas ativas</strong>
          <span style={{ fontSize: '0.8rem', color: cs.humano.length > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
            🔔 Atendimento humano: <b>{cs.humano.length}</b>
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>💬 Conversas 24h: <b>{cs.conversas24h}</b></span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>🆕 Ativações 7d: <b>{cs.ativacoes.length}</b></span>
          <span style={{ fontSize: '0.8rem', color: cs.radar.length > 0 ? 'var(--yellow)' : 'var(--text-muted)' }}>
            📡 Radar de churn{cs.semanaRadar ? ` (semana ${cs.semanaRadar})` : ''}: <b>{cs.radar.length}</b>
          </span>
        </div>
        {cs.humano.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.55rem' }}>
            <tbody>
              {cs.humano.map((l) => (
                <ClickableRow key={l.id} leadId={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.32rem 0.4rem', fontSize: '0.82rem' }}>🔔 {l.nome}</td>
                  <td style={{ padding: '0.32rem 0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{l.telefone}</td>
                  <td style={{ padding: '0.32rem 0.4rem', fontSize: '0.78rem', color: 'var(--yellow)' }}>{motivoDe(l.observacoes) || 'motivo não identificado'}</td>
                  <td style={{ padding: '0.32rem 0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {l.data_ultimo_contato ? new Date(l.data_ultimo_contato).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        )}
        {(cs.radar.length > 0 || cs.ativacoes.length > 0) && (
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem 1rem', flexWrap: 'wrap', fontSize: '0.76rem', color: 'var(--text-dim)' }}>
            {cs.radar.slice(0, 10).map((r) => (
              <span key={r.cnpj} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.15rem 0.45rem' }}>{r.tag} · {r.loja}</span>
            ))}
            {cs.radar.length > 10 && <span>+{cs.radar.length - 10} no radar</span>}
            {cs.ativacoes.map((a) => (
              <span key={a.cnpj} style={{ border: '1px solid var(--green, #16a34a)', borderRadius: 6, padding: '0.15rem 0.45rem', color: 'var(--green, #16a34a)' }}>🆕 {a.loja}{a.rid ? ` · RID ${a.rid}` : ''}</span>
            ))}
          </div>
        )}
      </section>

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
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Loja, CNPJ, cidade, UF, telefone, e-mail, sócio, status…" style={{ padding: '0.45rem 0.7rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)', minWidth: 330 }} />
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
              const leadId = infoDe(r)?.id ?? null
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
