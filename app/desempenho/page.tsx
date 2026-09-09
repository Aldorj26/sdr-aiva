import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { casaBusca } from '@/lib/text'
import ClickableRow from '../_components/ClickableRow'
import LeadDrawer from '../_components/LeadDrawer'

// Desempenho dos lojistas na AIVA — retrato diário do Portal Parceiros AIVA
// (rota /api/cron/portal-aiva, 6h BRT; spec docs/superpowers/specs/2026-09-09-*).
// Até 09/09/2026 vinha do Data Studio; UF/cidade/status-consulta/sem-operador
// eram dele e não existem mais no portal — as colunas continuam no banco pros
// meses antigos, mas esta página não os exibe mais (não sobraram em Row).
export const dynamic = 'force-dynamic'
export const revalidate = 0

type Row = {
  mes: string
  cnpj: string
  nome_varejo: string | null
  loja: string | null
  aprovados: number | null
  vendas: number | null
  conversao: number | null
  valor_vendas: number | null
  ticket_medio: number | null
  sem_venda: boolean
  sem_consulta: boolean
  telefone: string | null
  atualizado_em: string
  consultas: number | null
  rid: string | null
  status_portal: string | null
  inadimplencia_aiva: number | null
  inadimplencia_odres: number | null
  foto_fora_pct: number | null
  cadastro_em: string | null
  atencao: 'novo_sem_engajamento' | 'baixa_performance' | null
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

async function mapasDeLeads(): Promise<{ porCnpj: Map<string, InfoLead>; porFone: Map<string, InfoLead>; blobPorLead: Map<string, string> }> {
  const porCnpj = new Map<string, InfoLead>()
  const porFone = new Map<string, InfoLead>()
  // Texto pesquisável dos VÍNCULOS de cada lead (02/09): funcionários
  // (sdr_registros_colab) e todas as lojas (sdr_registros_cnpj) — é o que faz
  // "Ana Paula" ou o CNPJ da filial acharem a linha do lojista dono.
  const blobPorLead = new Map<string, string>()
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
    const porId = new Map<string, InfoLead>()
    for (const l of (data ?? []) as LinhaSql[]) {
      const info: InfoLead = { id: l.id, telefone: l.telefone, email: l.email, socio: l.socio }
      porId.set(l.id, info)
      if (l.c1) porCnpj.set(l.c1, info)
      if (l.c2 && !porCnpj.has(l.c2)) porCnpj.set(l.c2, info)
      const k = chaveTel(l.telefone)
      if (k) porFone.set(k, info)
    }
    // Vínculos: lojas por CNPJ (matriz + filiais) e funcionários conhecidos.
    const [cnpjs, colabs] = await Promise.all([
      supabaseAdmin.from('sdr_registros_cnpj').select('lead_id, cnpj, rid, loja'),
      supabaseAdmin.from('sdr_registros_colab').select('lead_id, nome, cpf, telefone, email'),
    ])
    const add = (id: string | null, txt: string) => {
      if (!id) return
      blobPorLead.set(id, `${blobPorLead.get(id) ?? ''} ${txt}`)
    }
    for (const r of cnpjs.data ?? []) {
      add(r.lead_id, `${r.cnpj} ${r.rid ?? ''} ${r.loja ?? ''}`)
      // CNPJ de filial também casa a linha do snapshot com o lead dono
      const info = porId.get(r.lead_id ?? '')
      if (info && r.cnpj && !porCnpj.has(r.cnpj)) porCnpj.set(r.cnpj, info)
    }
    for (const c of colabs.data ?? []) add(c.lead_id, `${c.nome ?? ''} ${c.cpf ?? ''} ${c.telefone ?? ''} ${c.email ?? ''}`)
  } catch (e) {
    console.warn('[desempenho] mapa de leads indisponível (drawer e busca por e-mail desabilitados):', e)
  }
  return { porCnpj, porFone, blobPorLead }
}

const fmtBRL = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
// Destaca em âmbar quando há inadimplência/foto fora — mesma cor de atenção
// dos cards ⚠️ (var(--yellow) do app/globals.css).
const ambar = (v: number | null): React.CSSProperties => (v != null && v > 0 ? { color: 'var(--yellow)', fontWeight: 600 } : {})
function rotuloAtencao(a: Row['atencao']): string {
  return a === 'novo_sem_engajamento' ? ' · ⚠️ novo sem engajamento' : a === 'baixa_performance' ? ' · ⚠️ baixa performance' : ''
}

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
  searchParams: Promise<{ mes?: string; filtro?: string; status?: string; q?: string; sort?: string; dir?: string }>
}) {
  const sp = await searchParams

  const { data: meses } = await supabaseAdmin
    .from('aiva_desempenho')
    .select('mes')
    .order('mes', { ascending: false })
  const mesesDisponiveis = [...new Set((meses ?? []).map((m) => m.mes))]
  const mes = sp.mes && mesesDisponiveis.includes(sp.mes) ? sp.mes : (mesesDisponiveis[0] ?? '')

  // Mês anterior pra tendência (seta por loja) — precisa vir antes do
  // Promise.all abaixo pra decidir se a query de "ant" roda ou não.
  const mesAnterior = mesesDisponiveis[mesesDisponiveis.indexOf(mes) + 1]

  // As 4 leituras a seguir são independentes entre si — rodam em paralelo.
  // Data do retrato do portal pro mês exibido — `atualizado_em` é a hora da
  // derivação, não a data dos dados. Mês sem linha em aiva_portal_diario
  // (ainda não passou pelo backfill) = snapshot antigo do Data Studio.
  const [drRes, dataRes, antRes, mapas] = await Promise.all([
    mes
      ? supabaseAdmin
          .from('aiva_portal_diario')
          .select('data_ref')
          .eq('mes', mes + '-01')
          .order('data_ref', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from('aiva_desempenho')
      .select('*')
      .eq('mes', mes)
      .order('valor_vendas', { ascending: false, nullsFirst: false }),
    mesAnterior
      ? supabaseAdmin.from('aiva_desempenho').select('cnpj, vendas, aprovados').eq('mes', mesAnterior)
      : Promise.resolve({ data: null }),
    mapasDeLeads(),
  ])
  const dataRetrato = drRes.data?.[0]?.data_ref as string | undefined
  const todas = (dataRes.data ?? []) as Row[]
  const anterior = new Map<string, Row>()
  for (const r of (antRes.data ?? []) as Row[]) anterior.set(r.cnpj, r)
  const { porCnpj, porFone, blobPorLead } = mapas
  // Dados do lead pra uma linha do snapshot: casa por CNPJ e, se não achar,
  // pelo telefone que veio do Data Studio.
  const infoDe = (r: Row) => porCnpj.get(r.cnpj) ?? (r.telefone ? porFone.get(chaveTel(r.telefone)) : undefined)

  const filtro = sp.filtro ?? ''
  let rows = todas
  if (filtro === 'sem_venda') rows = rows.filter((r) => r.sem_venda)
  if (filtro === 'sem_consulta') rows = rows.filter((r) => r.sem_consulta)
  if (filtro === 'novo_sem_engajamento') rows = rows.filter((r) => r.atencao === 'novo_sem_engajamento')
  if (filtro === 'baixa_performance') rows = rows.filter((r) => r.atencao === 'baixa_performance')
  if (sp.status === 'ativas') rows = rows.filter((r) => r.status_portal === 'Ativo')
  if (sp.status === 'inativas') rows = rows.filter((r) => r.status_portal && r.status_portal !== 'Ativo')
  if (sp.q) {
    // Mesma busca do /registros (lib/text.ts): ignora acento/caixa e, pra
    // número, compara só os dígitos — então "52.618.643/0001-05" e
    // "(47) 99608-5000" acham a linha do mesmo jeito que a versão sem máscara.
    // Campos do lead (e-mail, sócio, telefone) entram junto: o retrato do
    // portal não traz e-mail nem sócio.
    rows = rows.filter((r) => {
      const info = infoDe(r)
      return casaBusca(sp.q!, [
        r.loja, r.nome_varejo, r.cnpj, r.rid, r.status_portal,
        r.telefone, info?.telefone, info?.email, info?.socio,
        // vínculos (02/09): funcionários + CNPJs/RIDs de todas as lojas do dono
        info?.id ? blobPorLead.get(info.id) : undefined,
      ])
    })
  }

  // Ordenação por clique no cabeçalho: 1º clique = maior→menor, 2º inverte.
  const COLUNAS: Record<string, { rotulo: string; campo: keyof Row; numerica: boolean }> = {
    loja: { rotulo: 'Loja', campo: 'loja', numerica: false },
    status: { rotulo: 'Status', campo: 'status_portal', numerica: false },
    consultas: { rotulo: 'Consultas', campo: 'consultas', numerica: true },
    aprovados: { rotulo: 'Aprovados', campo: 'aprovados', numerica: true },
    vendas: { rotulo: 'Vendas', campo: 'vendas', numerica: true },
    conv: { rotulo: 'Conv.', campo: 'conversao', numerica: true },
    valor: { rotulo: 'Valor', campo: 'valor_vendas', numerica: true },
    ticket: { rotulo: 'Ticket', campo: 'ticket_medio', numerica: true },
    inad_aiva: { rotulo: 'Inad. AIVA', campo: 'inadimplencia_aiva', numerica: true },
    inad_odres: { rotulo: 'Inad. Odres', campo: 'inadimplencia_odres', numerica: true },
    foto: { rotulo: 'Foto fora', campo: 'foto_fora_pct', numerica: true },
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
    ativas: todas.filter((r) => r.status_portal === 'Ativo').length,
    consultas: todas.reduce((s, r) => s + (r.consultas ?? 0), 0),
    novos: todas.filter((r) => r.atencao === 'novo_sem_engajamento').length,
    baixa: todas.filter((r) => r.atencao === 'baixa_performance').length,
  }
  const convMedia = tot.aprovados > 0 ? tot.vendas / tot.aprovados : null
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams()
    if (mes) p.set('mes', mes)
    if (sp.q) p.set('q', sp.q)
    if (sp.status) p.set('status', sp.status)
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
    return `/desempenho?${p.toString()}`
  }
  // Link de ordenação: preserva mês + filtros; clicar na coluna ativa inverte a direção.
  const qsSort = (col: string) => {
    const p = new URLSearchParams()
    if (mes) p.set('mes', mes)
    if (filtro) p.set('filtro', filtro)
    if (sp.status) p.set('status', sp.status)
    if (sp.q) p.set('q', sp.q)
    p.set('sort', col)
    p.set('dir', sort === col && dir === 'desc' ? 'asc' : 'desc')
    return `/desempenho?${p.toString()}`
  }
  const atualizadoEm = todas[0]?.atualizado_em
  // dataRetrato não pode ser mais novo que a data de atualizado_em (hora da
  // derivação) — se for, a derivação falhou depois da coleta; não afirme a
  // data do retrato, mostre atualizado_em com um aviso.
  const retratoConfiavel = !!dataRetrato && (!atualizadoEm || dataRetrato <= atualizadoEm.slice(0, 10))

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
            : retratoConfiavel
              ? `${todas.length} lojas no retrato de ${new Date(dataRetrato! + 'T12:00:00Z').toLocaleDateString('pt-BR')} · Portal Parceiros AIVA`
              : dataRetrato
                ? `${todas.length} lojas · atualizado ${atualizadoEm ? new Date(atualizadoEm).toLocaleDateString('pt-BR') : ''} · Portal Parceiros AIVA (derivação pendente)`
                : `${todas.length} lojas no snapshot ${mes} · importado ${atualizadoEm ? new Date(atualizadoEm).toLocaleDateString('pt-BR') : ''} do Data Studio (legado)`}
        </p>
      </header>

      {/* Seção CS saiu daqui em 04/09 (pedido do Aldo): a página travava — o
          main tem overflow:hidden (só a tabela rola) e a seção CS crescia além
          da tela, zerando a altura da tabela. Acionamentos e chamados de lojas
          ativas agora moram no /atendimento (seção 🟣 CS). */}
      <section style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.25rem', flexShrink: 0 }}>
        <Card label="Lojas" value={String(todas.length)} href={qs({})} ativo={!filtro && !sp.status} />
        {/* meses do Data Studio não têm esses campos — mostrar 0 seria mentira */}
        {dataRetrato && (
          <>
            <Card label="Ativas" value={String(tot.ativas)} href={qs({ status: 'ativas' })} ativo={sp.status === 'ativas'} />
            <Card label="Consultas" value={tot.consultas.toLocaleString('pt-BR')} href={qs({})} />
          </>
        )}
        <Card label="Aprovados" value={tot.aprovados.toLocaleString('pt-BR')} href={qs({})} />
        <Card label="Vendas" value={tot.vendas.toLocaleString('pt-BR')} href={qs({})} />
        <Card label="Valor vendido" value={fmtBRL(tot.valor)} href={qs({})} />
        <Card label="Conversão média" value={fmtPct(convMedia)} color="var(--accent)" href={qs({})} />
        <Card label="Sem venda" value={String(tot.semVenda)} color={tot.semVenda > 0 ? 'var(--red)' : undefined} href={qs({ filtro: 'sem_venda' })} ativo={filtro === 'sem_venda'} />
        <Card label="Sem consulta" value={String(tot.semConsulta)} color={tot.semConsulta > 0 ? 'var(--red)' : undefined} href={qs({ filtro: 'sem_consulta' })} ativo={filtro === 'sem_consulta'} />
        {dataRetrato && (
          <>
            <Card label="⚠️ Novos sem engajamento" value={String(tot.novos)} color={tot.novos > 0 ? 'var(--yellow)' : undefined} href={qs({ filtro: 'novo_sem_engajamento' })} ativo={filtro === 'novo_sem_engajamento'} />
            <Card label="⚠️ Baixa performance" value={String(tot.baixa)} color={tot.baixa > 0 ? 'var(--yellow)' : undefined} href={qs({ filtro: 'baixa_performance' })} ativo={filtro === 'baixa_performance'} />
          </>
        )}
      </section>

      <form method="get" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.9rem', flexWrap: 'wrap', flexShrink: 0 }}>
        <input type="hidden" name="mes" value={mes} />
        {filtro && <input type="hidden" name="filtro" value={filtro} />}
        <input type="hidden" name="sort" value={sort} />
        <input type="hidden" name="dir" value={dir} />
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Loja, CNPJ, RID, e-mail, sócio, telefone…" style={{ padding: '0.45rem 0.7rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)', minWidth: 330 }} />
        {/* status_portal só existe no retrato do portal — meses do Data Studio não têm esse campo */}
        {dataRetrato && (
          <select name="status" defaultValue={sp.status ?? ''} style={{ padding: '0.45rem 0.7rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)' }}>
            <option value="">Todas</option>
            <option value="ativas">Ativas</option>
            <option value="inativas">Inativas</option>
          </select>
        )}
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
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{r.cnpj}{r.rid ? ` · RID ${r.rid}` : ''}{r.sem_venda ? ' · sem venda' : ''}{r.sem_consulta ? ' · sem consulta' : ''}{rotuloAtencao(r.atencao)}</div>
                  </td>
                  <td style={{ padding: '0.45rem 0.6rem', color: r.status_portal === 'Ativo' ? 'var(--green)' : 'var(--text-dim)' }}>{r.status_portal ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{r.consultas ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{r.aprovados ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{r.vendas ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{fmtPct(r.conversao)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBRL(r.valor_vendas)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBRL(r.ticket_medio)}</td>
                  {/* inadimplência/foto: escala assumida 0–1; conferir no 1º retrato real (Task 9 Step 4) */}
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', ...ambar(r.inadimplencia_aiva) }}>{fmtPct(r.inadimplencia_aiva)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', ...ambar(r.inadimplencia_odres) }}>{fmtPct(r.inadimplencia_odres)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{fmtPct(r.foto_fora_pct)}</td>
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
