import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { categoriaFila, motivoDeObs, type CategoriaFila } from '@/lib/fila'
import ClickableRow from '../_components/ClickableRow'
import LeadDrawer from '../_components/LeadDrawer'
import ChamadoResolver from '../_components/ChamadoResolver'
import AtendidoButton from '../_components/AtendidoButton'

// 🎧 MESA DE ATENDIMENTO (pedido do Aldo 03/09): tudo que o Nei precisa
// resolver, numa aba só, ordenado por prioridade — a versão viva do digest de
// WhatsApp das 8h. Desde 04/09 o CS (lojas ativas) também mora aqui: a seção
// no /desempenho travava a página (main overflow:hidden + seção crescendo além
// da tela) e o Aldo pediu pra tirar de lá.
export const dynamic = 'force-dynamic'

interface LeadFila {
  id: string
  nome: string
  telefone: string
  status: string
  observacoes: string | null
  data_ultimo_contato: string | null
}

const th: React.CSSProperties = { textAlign: 'left', padding: '0.45rem 0.6rem', fontSize: '0.72rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' }
const td: React.CSSProperties = { padding: '0.45rem 0.6rem', fontSize: '0.83rem', borderBottom: '1px solid var(--border)' }

function fmtQuando(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

// CNPJ da matriz ao lado do telefone (pedido do Aldo 04/09). Vem das
// observações do lead — mesmos marcadores que o /desempenho usa pra casar
// snapshot ↔ lead (cnpj_matriz= dos dados coletados; CNPJ_RECEITA: da validação).
function cnpjDeObs(obs: string | null): string | null {
  const d = (obs ?? '').match(/cnpj_matriz=([0-9]{14})/)?.[1]
    ?? (obs ?? '').match(/CNPJ_RECEITA:cnpj=([0-9]{14})/)?.[1]
  return d ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : null
}

async function getDados() {
  const [fila, chamados, travadosRaw, csFila] = await Promise.all([
    supabaseAdmin
      .from('sdr_leads')
      .select('id, nome, telefone, status, observacoes, data_ultimo_contato')
      .eq('acionar_humano', true)
      .not('status', 'in', '("FORMULARIO_ENVIADO","OPT_OUT","NAO_QUALIFICADO","DESCARTADO","LOJA_FINALIZADA_E_VENDENDO")')
      .order('data_ultimo_contato', { ascending: true, nullsFirst: true }),
    // Chamados abertos de TODAS as etapas (04/09: os de loja ativa vinham no
    // /desempenho; agora a coluna Etapa distingue credenciamento × LFV)
    supabaseAdmin
      .from('sdr_chamados')
      .select('id, lead_id, loja, telefone, problema, status_lead, criado_em')
      .eq('status', 'aberto')
      .order('criado_em', { ascending: false })
      .limit(60),
    // Travados no CAF: esgotaram as 3 cobranças automáticas (fim da linha)
    supabaseAdmin
      .from('sdr_leads')
      .select('id, nome, telefone, status, observacoes, status_alterado_em, data_ultimo_contato')
      .eq('status', 'EM_ANALISE_AIVA')
      .like('observacoes', '%[FOLLOWUP_FASE_COUNT:3%'),
    // 🟣 CS — acionamentos de lojas ATIVAS (veio do /desempenho em 04/09)
    supabaseAdmin
      .from('sdr_leads')
      .select('id, nome, telefone, status, observacoes, data_ultimo_contato')
      .eq('acionar_humano', true)
      .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
      .order('data_ultimo_contato', { ascending: false, nullsFirst: false })
      .limit(40),
  ])

  const grupos: Record<CategoriaFila, LeadFila[]> = { acao: [], docs: [], mover: [], sem_motivo: [] }
  for (const l of (fila.data ?? []) as LeadFila[]) {
    grupos[categoriaFila(motivoDeObs(l.observacoes))].push(l)
  }
  const travados = ((travadosRaw.data ?? []) as Array<LeadFila & { status_alterado_em: string | null }>)
    .sort((a, b) => (a.status_alterado_em ?? '').localeCompare(b.status_alterado_em ?? ''))

  return {
    grupos,
    chamados: (chamados.data ?? []) as Array<{ id: string; lead_id: string | null; loja: string | null; telefone: string; problema: string | null; status_lead: string | null; criado_em: string }>,
    travados,
    cs: (csFila.data ?? []) as LeadFila[],
  }
}

function CardResumo({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <a href={`#${label.replace(/\W/g, '')}`} style={{ display: 'block', textDecoration: 'none', padding: '0.7rem 0.9rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elev)', minWidth: 140 }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: value > 0 ? (color ?? 'var(--text)') : 'var(--text-muted)' }}>{value}</div>
    </a>
  )
}

function Secao({ id, titulo, sub, vazio, children, count }: { id: string; titulo: string; sub: string; vazio: string; count: number; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: '1.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.4rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.02rem' }}>{titulo} {count > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({count})</span>}</h2>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sub}</span>
      </div>
      {count === 0
        ? <p style={{ margin: 0, padding: '0.6rem 0.2rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{vazio}</p>
        : children}
    </section>
  )
}

function LinhaLead({ l, botao }: { l: LeadFila; botao: React.ReactNode }) {
  const motivo = motivoDeObs(l.observacoes)
  const cnpj = cnpjDeObs(l.observacoes)
  return (
    <ClickableRow leadId={l.id}>
      <td style={td}>{l.nome}<div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l.telefone}{cnpj ? ` · ${cnpj}` : ''}</div></td>
      <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.status}</td>
      <td style={{ ...td, color: 'var(--yellow)', fontSize: '0.8rem' }}>{motivo || 'ver conversa'}</td>
      <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '0.76rem', color: 'var(--text-muted)' }}>{fmtQuando(l.data_ultimo_contato)}</td>
      <td style={{ ...td, textAlign: 'right' }}>{botao}</td>
    </ClickableRow>
  )
}

const cab = (
  <thead><tr>
    <th style={th}>Loja</th><th style={th}>Etapa</th><th style={th}>Motivo</th><th style={th}>Último contato</th><th style={th}>Ação</th>
  </tr></thead>
)

export default async function AtendimentoPage() {
  const { grupos, chamados, travados, cs } = await getDados()

  return (
    <main>
      <header style={{ marginBottom: '1.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: '0.85rem', padding: '0.35rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-elev)' }}>← Voltar</Link>
          <h1 style={{ margin: 0 }}>🎧 Atendimento</h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>a fila de trabalho — funil e lojas ativas (CS); números de desempenho ficam no <Link href="/desempenho" style={{ color: 'var(--accent)' }}>Desempenho</Link></span>
        </div>
      </header>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <CardResumo label="🔴 Ação pendente" value={grupos.acao.length} color="var(--red)" />
        <CardResumo label="🟣 CS lojas ativas" value={cs.length} color="#a855f7" />
        <CardResumo label="🛠 Chamados" value={chamados.length} color="var(--red)" />
        <CardResumo label="🟡 Mover card" value={grupos.mover.length} color="var(--yellow)" />
        <CardResumo label="⏱ Travados no CAF" value={travados.length} color="var(--yellow)" />
        <CardResumo label="📄 Docs" value={grupos.docs.length} />
        <CardResumo label="⚪ Sem motivo" value={grupos.sem_motivo.length} />
      </div>

      <Secao id="Aopendente" titulo="🔴 Ação pendente" sub="acionaram humano — resolver hoje" vazio="Fila zerada. 🎉" count={grupos.acao.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>{cab}<tbody>
          {grupos.acao.map((l) => <LinhaLead key={l.id} l={l} botao={<AtendidoButton leadId={l.id} />} />)}
        </tbody></table>
      </Secao>

      <Secao id="CSlojasativas" titulo="🟣 CS — lojas ativas" sub="lojas vendendo que acionaram humano — veio do Desempenho (04/09)" vazio="Nenhuma loja ativa aguardando. ✓" count={cs.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>{cab}<tbody>
          {cs.map((l) => <LinhaLead key={l.id} l={l} botao={<AtendidoButton leadId={l.id} />} />)}
        </tbody></table>
      </Secao>

      <Secao id="Chamados" titulo="🛠 Chamados abertos" sub="erro de portal/sistema — abrir com o Edu se for da AIVA" vazio="Nenhum chamado aberto. ✓" count={chamados.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Loja</th><th style={th}>Problema</th><th style={th}>Etapa</th><th style={th}>Quando</th><th style={th}>Ação</th></tr></thead>
          <tbody>
            {chamados.map((c) => {
              const celulas = (
                <>
                  <td style={td}>{c.loja ?? c.telefone}<div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.telefone}</div></td>
                  <td style={{ ...td, fontSize: '0.8rem', color: 'var(--yellow)' }} title={c.problema ?? ''}>{(c.problema ?? 'ver conversa').slice(0, 110)}</td>
                  <td style={{ ...td, fontSize: '0.76rem', color: 'var(--text-muted)' }}>{c.status_lead ?? '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '0.76rem', color: 'var(--text-muted)' }}>{fmtQuando(c.criado_em)}</td>
                  <td style={{ ...td, textAlign: 'right' }}><ChamadoResolver id={c.id} /></td>
                </>
              )
              return c.lead_id
                ? <ClickableRow key={c.id} leadId={c.lead_id}>{celulas}</ClickableRow>
                : <tr key={c.id}>{celulas}</tr>
            })}
          </tbody>
        </table>
      </Secao>

      <Secao id="Movercard" titulo="🟡 Mover card" sub="cadastro/biometria confirmados — mover no Evo" vazio="Nada pra mover. ✓" count={grupos.mover.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>{cab}<tbody>
          {grupos.mover.map((l) => <LinhaLead key={l.id} l={l} botao={<AtendidoButton leadId={l.id} />} />)}
        </tbody></table>
      </Secao>

      <Secao id="TravadosnoCAF" titulo="⏱ Travados no CAF" sub="esgotaram as 3 cobranças automáticas — lista de ligação" vazio="Ninguém travado. ✓" count={travados.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Loja</th><th style={th}>Na etapa desde</th><th style={th}>Último contato</th></tr></thead>
          <tbody>
            {travados.map((l) => (
              <ClickableRow key={l.id} leadId={l.id}>
                <td style={td}>{l.nome}<div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{l.telefone}{cnpjDeObs(l.observacoes) ? ` · ${cnpjDeObs(l.observacoes)}` : ''}</div></td>
                <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-muted)' }}>{l.status_alterado_em ? new Date(l.status_alterado_em).toLocaleDateString('pt-BR') : '—'}</td>
                <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-muted)' }}>{fmtQuando(l.data_ultimo_contato)}</td>
              </ClickableRow>
            ))}
          </tbody>
        </table>
      </Secao>

      <Secao id="Docs" titulo="📄 Docs / colaboradores" sub="processar com o Edu" vazio="Nada pendente. ✓" count={grupos.docs.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>{cab}<tbody>
          {grupos.docs.map((l) => <LinhaLead key={l.id} l={l} botao={<AtendidoButton leadId={l.id} />} />)}
        </tbody></table>
      </Secao>

      <Secao id="Semmotivo" titulo="⚪ Sem motivo registrado" sub="revisar a conversa e marcar Atendido" vazio="Nenhum. ✓" count={grupos.sem_motivo.length}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>{cab}<tbody>
          {grupos.sem_motivo.map((l) => <LinhaLead key={l.id} l={l} botao={<AtendidoButton leadId={l.id} />} />)}
        </tbody></table>
      </Secao>

      <LeadDrawer />
    </main>
  )
}
