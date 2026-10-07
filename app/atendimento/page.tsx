import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { categoriaFila, motivoDeObs, type CategoriaFila } from '@/lib/fila'
import ClickableRow from '../_components/ClickableRow'
import LeadDrawer from '../_components/LeadDrawer'
import ChamadoResolver from '../_components/ChamadoResolver'
import AtendidoButton from '../_components/AtendidoButton'
import Copiavel from '@/app/_components/Copiavel'
import AvisoResolver from '../_components/AvisoResolver'
import { CATALOGO, TIPOS, avisoVelho, type TipoAviso } from '@/lib/avisos-painel-calc'
import { orientar, resumirFala, haQuanto } from '@/lib/atendimento-orientacao'
import AbrirFormLink from '@/app/registros/AbrirFormLink'
import { linkFormPreenchido, formatarCnpj } from '@/lib/pre-cadastro-form'

// 🎧 MESA DE ATENDIMENTO (pedido do Aldo 03/09): tudo que o Nei precisa
// resolver, numa aba só, ordenado por prioridade — a versão viva do digest de
// WhatsApp das 8h. Desde 04/09 o CS (lojas ativas) também mora aqui.
//
// 05/10/2026 (Aldo): todas as seções no MESMO formato do painel da Parcelex —
// Loja · O que está acontecendo · O que fazer · Última fala do lojista · Parado há · Ação.
// O "o que está acontecendo / o que fazer" sai do motivo do acionamento
// (lib/atendimento-orientacao.ts); antes a coluna mostrava o código cru
// ("acesso_flexfone_nao_chegou") e o Nei tinha que abrir a conversa pra saber o que fazer.
export const dynamic = 'force-dynamic'

interface LeadFila {
  id: string
  nome: string
  telefone: string
  status: string
  observacoes: string | null
  data_ultimo_contato: string | null
}

/** Uma linha de qualquer seção, já no formato das seis colunas. */
interface Linha {
  key: string
  leadId: string | null
  loja: string
  telefone: string | null
  cnpj: string | null
  etapa?: string | null
  situacao: string
  acao: string
  desde: string | null
  prints?: string[]
  botao: React.ReactNode
  /** Outras pendências da MESMA loja em temas de baixo — mostradas dentro desta linha (ver `semRepetir`). */
  extras?: Array<{ rotulo: string; situacao: string; acao: string; prints?: string[]; botao: React.ReactNode; key: string }>
}

/**
 * Cada loja aparece UMA vez na tela (Aldo 06/10/2026 — "está repetindo tudo"): a Prime estava no CS
 * (pediu humano) e de novo em Chamados (login não chegou). A linha fica no PRIMEIRO tema em que a loja
 * aparece, na ordem da tela, e as pendências dos temas de baixo entram nela como "+ tema: situação",
 * com o botão de cada uma — resolver um não fecha o outro.
 */
function semRepetir(vistos: Map<string, Linha>, linhas: Linha[], rotulo: string): Linha[] {
  const out: Linha[] = []
  for (const l of linhas) {
    const dono = l.leadId ? vistos.get(l.leadId) : undefined
    if (dono) {
      (dono.extras ??= []).push({ rotulo, situacao: l.situacao, acao: l.acao, prints: l.prints, botao: l.botao, key: l.key })
      continue
    }
    if (l.leadId) vistos.set(l.leadId, l)
    out.push(l)
  }
  return out
}

type Falas = Map<string, { texto: string; quando: string }>

const th: React.CSSProperties = { textAlign: 'left', padding: '0.45rem 0.6rem', fontSize: '0.72rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' }
const td: React.CSSProperties = { padding: '0.5rem 0.6rem', fontSize: '0.83rem', borderBottom: '1px solid var(--border)', verticalAlign: 'top' }

function fmtQuando(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

// CNPJ da matriz ao lado do telefone (pedido do Aldo 04/09). Vem das
// observações do lead — mesmos marcadores que o /desempenho usa pra casar
// snapshot ↔ lead (cnpj_matriz= dos dados coletados; CNPJ_RECEITA: da validação).
function cnpjDeObs(obs: string | null): string | null {
  const bruto = (obs ?? '').match(/cnpj_matriz=([0-9./-]{14,18})/)?.[1] ?? (obs ?? '').match(/CNPJ_RECEITA:cnpj=([0-9]{14})/)?.[1]
  const d = (bruto ?? '').replace(/\D/g, '')
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : null
}

const ETAPA: Record<string, string> = {
  INICIO: 'Início', DISPARO_REALIZADO: 'Início', SEM_RESPOSTA: 'Sem resposta', INTERESSADO: 'Interessado', AGUARDANDO: 'Aguardando',
  PRE_APROVACAO: 'Pré-aprovação', CADASTRO_RECEBIDO: 'Cadastro recebido', EM_ANALISE_AIVA: 'Cadastro na AIVA', TREINAR: 'Cadastro finalizado',
  LOGIN: 'Pronto para operar', LOJA_FINALIZADA_E_VENDENDO: 'Loja finalizada', BOT_DETECTADO: 'Bot detectado',
}

const ORDEM_FUNIL = ['INICIO', 'DISPARO_REALIZADO', 'SEM_RESPOSTA', 'INTERESSADO', 'AGUARDANDO', 'PRE_APROVACAO', 'CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']
const FORA_DO_FUNIL = ['NAO_QUALIFICADO', 'DESCARTADO', 'OPT_OUT', 'BOT_DETECTADO']
/** O lead andou pra frente desde que o chamado abriu, ou saiu do funil. */
function chamadoVelho(statusNoChamado: string | null, statusAgora: string | null): boolean {
  if (!statusAgora) return false
  if (FORA_DO_FUNIL.includes(statusAgora)) return true
  const a = ORDEM_FUNIL.indexOf(statusNoChamado ?? ''), b = ORDEM_FUNIL.indexOf(statusAgora)
  return a >= 0 && b > a
}

function linhaDeLead(l: LeadFila, botao: React.ReactNode): Linha {
  // 200 e não os 70 do digest de WhatsApp: aqui o detalhe que a VictorIA escreveu cabe e orienta
  const o = orientar(motivoDeObs(l.observacoes, 200))
  return { key: l.id, leadId: l.id, loja: l.nome, telefone: l.telefone, cnpj: cnpjDeObs(l.observacoes), etapa: l.status, situacao: o.situacao, acao: o.acao, desde: l.data_ultimo_contato, botao }
}

interface AvisoPainel {
  id: string
  tipo: TipoAviso
  lead_id: string | null
  loja: string
  telefone: string | null
  detalhe: string | null
  status_lead: string | null
  criado_em: string
}

// 🚨 Avisos do robô (Aldo 05/10/2026): os digests de WhatsApp ("3 lojas sem concluir a
// biometria…") passavam batido no meio dos outros alertas. Cada loja avisada vira uma linha
// aqui até alguém clicar em Resolvido — ou até a situação andar sozinha (avisoVelho).
/** Pré-cadastro que não chegou: o Nei reenvia o formulário dali mesmo, sem ir ao /registros. */
function botaoAviso(a: AvisoPainel) {
  const cnpj = a.tipo === 'pre_cadastro_nao_chegou' ? (a.detalhe ?? '').match(/\d{14}/)?.[0] : undefined
  const link = cnpj ? linkFormPreenchido(cnpj) : null
  if (!link) return <AvisoResolver id={a.id} />
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
      <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: '0.8rem', padding: '0.2rem 0.5rem', border: '1px solid var(--accent)', borderRadius: 6, textDecoration: 'none' }}>Abrir form ↗</a>
      <AvisoResolver id={a.id} />
    </span>
  )
}

async function getAvisos(): Promise<Array<{ tipo: TipoAviso; linhas: Linha[] }>> {
  const { data, error } = await supabaseAdmin
    .from('sdr_avisos_painel')
    .select('id, tipo, lead_id, loja, telefone, detalhe, status_lead, criado_em')
    .is('resolvido_em', null)
    .order('criado_em', { ascending: false })
    .limit(400)
  if (error || !data?.length) return []
  const lista = (data as AvisoPainel[]).filter((a) => a.tipo in CATALOGO)
  const ids = [...new Set(lista.map((a) => a.lead_id).filter(Boolean))] as string[]
  const { data: leads } = ids.length
    ? await supabaseAdmin.from('sdr_leads').select('id, status, observacoes, telefone').in('id', ids)
    : { data: [] as Array<{ id: string; status: string; observacoes: string | null; telefone: string | null }> }
  const leadPorId = new Map((leads ?? []).map((l) => [l.id, l]))
  const vivos: Array<AvisoPainel & { linha: Linha }> = []
  const velhos = new Map<string, string[]>()
  for (const a of lista) {
    const l = a.lead_id ? leadPorId.get(a.lead_id) : undefined
    const motivo = avisoVelho(a.status_lead, l?.status ?? null, a.tipo, l?.observacoes ?? null)
    if (motivo) { velhos.set(motivo, [...(velhos.get(motivo) ?? []), a.id]); continue }
    const c = CATALOGO[a.tipo]
    vivos.push({
      ...a,
      linha: {
        key: a.id, leadId: a.lead_id, loja: a.loja, telefone: a.telefone || l?.telefone || '', cnpj: cnpjDeObs(l?.observacoes ?? null), etapa: l?.status ?? a.status_lead,
        situacao: (a.detalhe ? `${c.oque} — ${a.detalhe}` : c.oque).replace(/^./, (x) => x.toUpperCase()), acao: c.acao, desde: a.criado_em, botao: botaoAviso(a),
      },
    })
  }
  // fecha os que andaram sozinhos (melhor esforço: se falhar, tentam de novo no próximo carregamento)
  for (const [motivo, idsVelhos] of velhos) {
    await supabaseAdmin.from('sdr_avisos_painel').update({ resolvido_em: new Date().toISOString(), resolvido_como: motivo }).in('id', idsVelhos)
  }
  return TIPOS
    .map((tipo) => ({ tipo, linhas: vivos.filter((a) => a.tipo === tipo).map((a) => a.linha) }))
    .filter((g) => g.linhas.length)
    .sort((a, b) => CATALOGO[a.tipo].ordem - CATALOGO[b.tipo].ordem)
}

// 📋 Registros AIVA dentro do Atendimento (Aldo 06/10/2026): o Nei tinha que trocar de aba pra ver
// se havia CNPJ esperando o pré-cadastro. O quadro mostra os pendentes (enviado = false) com o mesmo
// "Abrir form" do /registros — que marca no clique e avança o card pra 49.
const PLANILHA_ATENDIMENTOS = 'https://docs.google.com/spreadsheets/d/1lTB9LvptQejFd_WLygGAKDE6UDVlzvfLEDGhcdSRmQU/edit?gid=1497480463#gid=1497480463'
interface RegPendente { id: string; loja: string | null; cnpj: string; telefone: string | null; tipo: string | null; criado_em: string; lead_id: string | null }
async function getRegistros() {
  const agora = Date.now()
  const hojeBrt = new Date(new Date(agora - 3 * 3600e3).toISOString().slice(0, 10) + 'T03:00:00Z').toISOString()
  const d7 = new Date(agora - 7 * 864e5).toISOString()
  const [pend, hoje, semana] = await Promise.all([
    supabaseAdmin.from('sdr_registros_cnpj').select('id, loja, cnpj, telefone, tipo, criado_em, lead_id').eq('enviado', false).order('criado_em', { ascending: true }).limit(60),
    supabaseAdmin.from('sdr_registros_cnpj').select('id', { count: 'exact', head: true }).gte('criado_em', hojeBrt),
    supabaseAdmin.from('sdr_registros_cnpj').select('id', { count: 'exact', head: true }).gte('criado_em', d7),
  ])
  return { pendentes: (pend.data ?? []) as RegPendente[], hoje: hoje.count ?? 0, semana: semana.count ?? 0 }
}

function ItemRegistro({ r }: { r: RegPendente }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.loja ?? '—'} <span style={{ fontWeight: 400, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.tipo === 'matriz' ? 'matriz' : 'adicional'}</span>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <Copiavel valor={r.cnpj} exibir={formatarCnpj(r.cnpj)} />{r.telefone ? <> · <Copiavel valor={r.telefone} /></> : null} · há {haQuanto(r.criado_em)}
        </div>
      </div>
      <span style={{ padding: '0.25rem 0.55rem', border: '1px solid var(--accent)', borderRadius: 6 }}>
        <AbrirFormLink id={r.id} href={linkFormPreenchido(r.cnpj) ?? '#'} jaEnviado={false} />
      </span>
    </li>
  )
}

/** Pré-cadastro marcado como enviado e que não chegou à AIVA — mora no quadro de Registros (Aldo 06/10/2026:
 *  o Nei olhava o quadro "nada a enviar" e não via a Minas, que estava lá embaixo nos avisos). */
function ItemNaoChegou({ l }: { l: Linha }) {
  const marcado = l.situacao.match(/marcado em (\d{2}\/\d{2})/)?.[1]
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.84rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.loja}</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {l.cnpj ? <Copiavel valor={l.cnpj.replace(/\D/g, '')} exibir={l.cnpj} /> : null}{l.telefone ? <> · <Copiavel valor={l.telefone} /></> : null}{marcado ? ` · marcado em ${marcado}` : ''}
        </div>
      </div>
      {l.botao}
    </li>
  )
}

function QuadroRegistros({ pendentes, hoje, semana, naoChegou }: { pendentes: RegPendente[]; hoje: number; semana: number; naoChegou: Linha[] }) {
  const resto = pendentes.slice(A_VISTA)
  const restoNC = naoChegou.slice(A_VISTA)
  return (
    <aside style={{ flex: '1 1 340px', maxWidth: 480, padding: '0.7rem 0.9rem', borderRadius: 10, border: `1px solid ${pendentes.length || naoChegou.length ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-elev)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '0.95rem' }}>
          📋 Registros AIVA{' '}
          <span style={{ fontWeight: 400, color: pendentes.length ? 'var(--accent)' : 'var(--text-muted)' }}>
            {pendentes.length ? `${pendentes.length} a enviar` : 'nada a enviar ✓'}
          </span>
        </h2>
        <Link href="/registros" style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>abrir completo →</Link>
      </div>
      <p style={{ margin: '0.2rem 0 0.3rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        CNPJ pronto pro pré-cadastro. <b>Abrir form</b> já vai preenchido e marca como enviado no clique (o card anda pra Cadastro Recebido).
      </p>
      {pendentes.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {pendentes.slice(0, A_VISTA).map((r) => <ItemRegistro key={r.id} r={r} />)}
        </ul>
      )}
      {resto.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--accent)', padding: '0.3rem 0' }}>ver mais {resto.length}</summary>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{resto.map((r) => <ItemRegistro key={r.id} r={r} />)}</ul>
        </details>
      )}
      {naoChegou.length > 0 && (
        <div style={{ marginTop: '0.6rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--red)' }}>📮 Marcado e não chegou à AIVA ({naoChegou.length})</h3>
          <p style={{ margin: '0.15rem 0 0.2rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Marcado como enviado há mais de 24h e o CNPJ não aparece no portal (a AIVA importa de hora em hora) — o formulário não foi. Reenviar e conferir a tela &quot;Sua resposta foi registrada&quot;.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{naoChegou.slice(0, A_VISTA).map((l) => <ItemNaoChegou key={l.key} l={l} />)}</ul>
          {restoNC.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--accent)', padding: '0.3rem 0' }}>ver mais {restoNC.length}</summary>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{restoNC.map((l) => <ItemNaoChegou key={l.key} l={l} />)}</ul>
            </details>
          )}
        </div>
      )}
      <div style={{ marginTop: '0.4rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        {hoje} CNPJ{hoje === 1 ? '' : 's'} registrado{hoje === 1 ? '' : 's'} hoje · {semana} em 7 dias ·{' '}
        <a href={PLANILHA_ATENDIMENTOS} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>planilha ↗</a>
      </div>
    </aside>
  )
}

async function getDados() {
  const [fila, chamados, csFila, avisos] = await Promise.all([
    supabaseAdmin
      .from('sdr_leads')
      .select('id, nome, telefone, status, observacoes, data_ultimo_contato')
      .eq('acionar_humano', true)
      .not('status', 'in', '("FORMULARIO_ENVIADO","OPT_OUT","NAO_QUALIFICADO","DESCARTADO","LOJA_FINALIZADA_E_VENDENDO")')
      .order('data_ultimo_contato', { ascending: true, nullsFirst: true }),
    // Chamados abertos de TODAS as etapas (04/09: os de loja ativa vinham no
    // /desempenho; agora a etapa distingue credenciamento × loja ativa)
    supabaseAdmin
      .from('sdr_chamados')
      .select('id, lead_id, loja, telefone, problema, status_lead, criado_em')
      .eq('status', 'aberto')
      .order('criado_em', { ascending: false })
      .limit(60),
    // 🟣 CS — acionamentos de lojas ATIVAS (veio do /desempenho em 04/09)
    supabaseAdmin
      .from('sdr_leads')
      .select('id, nome, telefone, status, observacoes, data_ultimo_contato')
      .eq('acionar_humano', true)
      .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
      .order('data_ultimo_contato', { ascending: false, nullsFirst: false })
      .limit(40),
    getAvisos(),
  ])
  const registros = await getRegistros()

  // (06/10/2026) a seção "Travados no CAF" saiu: lia o marcador da régua antiga (followup-fase, apagada
  // em 16/09). Quem esgota a cobrança nova aparece em Avisos do robô → "Formulário da AIVA sem preencher".
  const grupos: Record<CategoriaFila, Linha[]> = { acao: [], docs: [], mover: [], sem_motivo: [] }
  for (const l of (fila.data ?? []) as LeadFila[]) {
    grupos[categoriaFila(motivoDeObs(l.observacoes), l.status)].push(linhaDeLead(l, <AtendidoButton leadId={l.id} />))
  }
  const cs = ((csFila.data ?? []) as LeadFila[]).map((l) => linhaDeLead(l, <AtendidoButton leadId={l.id} />))

  // CNPJ dos chamados: sdr_chamados não guarda CNPJ — vem das observações do
  // lead vinculado (mesmos marcadores das outras seções).
  const todosChamados = (chamados.data ?? []) as Array<{ id: string; lead_id: string | null; loja: string | null; telefone: string; problema: string | null; status_lead: string | null; criado_em: string }>
  // Chamado VELHO fecha sozinho (Aldo 06/10/2026 — o painel acumulava resolvido): o lead avançou de
  // etapa desde que o chamado abriu (ex.: formulário travado → loja criada) ou saiu do funil. Problema
  // de loja que continua na MESMA etapa (aprovação baixa, login) segue aberto até alguém resolver.
  const idsLeadCh = [...new Set(todosChamados.map((c) => c.lead_id).filter(Boolean))] as string[]
  const statusAgora = new Map<string, string>()
  if (idsLeadCh.length) {
    const { data } = await supabaseAdmin.from('sdr_leads').select('id, status').in('id', idsLeadCh)
    for (const l of data ?? []) statusAgora.set(l.id, l.status)
  }
  const velhos = todosChamados.filter((c) => c.lead_id && chamadoVelho(c.status_lead, statusAgora.get(c.lead_id) ?? null))
  if (velhos.length) await supabaseAdmin.from('sdr_chamados').update({ status: 'resolvido', resolvido_em: new Date().toISOString() }).in('id', velhos.map((c) => c.id))
  const listaChamados = todosChamados.filter((c) => !velhos.includes(c))
  const idsChamados = [...new Set(listaChamados.map((c) => c.lead_id).filter(Boolean))] as string[]
  const cnpjPorLead = new Map<string, string | null>()
  const printsPorChamado = new Map<string, string[]>()
  if (idsChamados.length) {
    const [{ data: leadsCh }, { data: imgs }] = await Promise.all([
      supabaseAdmin.from('sdr_leads').select('id, observacoes').in('id', idsChamados),
      // 📸 Histórico de erros (Aldo 08/09): prints que o lojista mandou desde
      // 24h antes de abrir o chamado — o print costuma vir junto do relato.
      supabaseAdmin.from('sdr_mensagens').select('lead_id, conteudo, enviado_em').in('lead_id', idsChamados).eq('direcao', 'in').like('conteudo', '[LEAD_ENVIOU_IMAGEM:%').order('enviado_em'),
    ])
    for (const l of leadsCh ?? []) cnpjPorLead.set(l.id, cnpjDeObs(l.observacoes))
    for (const c of listaChamados) {
      const desde = new Date(new Date(c.criado_em).getTime() - 24 * 3600e3).toISOString()
      printsPorChamado.set(c.id, [...new Set((imgs ?? [])
        .filter((m) => m.lead_id === c.lead_id && m.enviado_em >= desde)
        .map((m) => m.conteudo.match(/\[LEAD_ENVIOU_IMAGEM:(\d+)\]/)?.[1] ?? '')
        .filter(Boolean))])
    }
  }
  const linhasChamados: Linha[] = listaChamados.map((c) => ({
    key: c.id, leadId: c.lead_id, loja: c.loja ?? c.telefone, telefone: c.telefone, cnpj: c.lead_id ? cnpjPorLead.get(c.lead_id) ?? null : null, etapa: c.status_lead,
    situacao: (c.problema ?? 'Erro de portal/sistema — ver a conversa').slice(0, 220),
    acao: 'Se o erro for do portal da AIVA, abrir com o Edu; quando resolver, avisar o lojista e clicar em Resolver.',
    desde: c.criado_em, prints: printsPorChamado.get(c.id), botao: <ChamadoResolver id={c.id} />,
  }))

  // uma loja, uma linha — na ordem em que os temas aparecem na tela
  const vistos = new Map<string, Linha>()
  const naoChegou = semRepetir(vistos, avisos.find((g) => g.tipo === 'pre_cadastro_nao_chegou')?.linhas ?? [], '📮 Pré-cadastro não chegou')
  const avisosUnicos = avisos.filter((g) => g.tipo !== 'pre_cadastro_nao_chegou')
    .map((g) => ({ ...g, linhas: semRepetir(vistos, g.linhas, CATALOGO[g.tipo].titulo) }))
    .filter((g) => g.linhas.length)
  grupos.acao = semRepetir(vistos, grupos.acao, '🔴 Ação pendente')
  const csUnicos = semRepetir(vistos, cs, '🟣 CS')
  const chamadosUnicos = semRepetir(vistos, linhasChamados, '🛠 Chamado aberto')
  grupos.sem_motivo = semRepetir(vistos, grupos.sem_motivo, '⚪ Sem motivo')

  // Última fala do lojista de todo mundo que aparece na tela (uma consulta só)
  const todas = [...naoChegou, ...avisosUnicos.flatMap((g) => g.linhas), ...grupos.acao, ...grupos.sem_motivo, ...csUnicos, ...chamadosUnicos]
  const idsFala = [...new Set(todas.map((l) => l.leadId).filter(Boolean))] as string[]
  const falas: Falas = new Map()
  if (idsFala.length) {
    const { data: f } = await supabaseAdmin.rpc('sdr_ultimas_falas', { ids: idsFala })
    for (const x of (f ?? []) as Array<{ lead_id: string; conteudo: string; enviado_em: string }>) falas.set(x.lead_id, { texto: resumirFala(x.conteudo), quando: x.enviado_em })
  }

  return { grupos, chamados: chamadosUnicos, cs: csUnicos, avisos: avisosUnicos, falas, registros: { ...registros, naoChegou } }
}

function CardResumo({ id, label, value, color }: { id: string; label: string; value: number; color?: string }) {
  return (
    <a href={`#${id}`} style={{ display: 'block', textDecoration: 'none', padding: '0.7rem 0.9rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elev)', minWidth: 140 }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: value > 0 ? (color ?? 'var(--text)') : 'var(--text-muted)' }}>{value}</div>
    </a>
  )
}

function Tabela({ linhas, falas }: { linhas: Linha[]; falas: Falas }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Loja</th><th style={th}>O que está acontecendo</th><th style={th}>O que fazer</th><th style={th}>Última fala do lojista</th><th style={th}>Parado há</th><th style={th}>Ação</th>
        </tr></thead>
        <tbody>
          {linhas.map((l) => {
            const fala = l.leadId ? falas.get(l.leadId) : undefined
            const celulas = (
              <>
                <td style={{ ...td, minWidth: 170 }}>
                  <b>{l.loja}</b>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {l.telefone ? <Copiavel valor={l.telefone} /> : null}{l.cnpj ? <> · <Copiavel valor={l.cnpj.replace(/\D/g, '')} exibir={l.cnpj} /></> : null}
                  </div>
                  {l.etapa ? <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{ETAPA[l.etapa] ?? l.etapa}</div> : null}
                </td>
                <td style={{ ...td, color: 'var(--yellow)', fontSize: '0.8rem', maxWidth: 330 }}>
                  {l.situacao}
                  {(l.prints?.length ?? 0) > 0 && (
                    <span style={{ marginLeft: 6, whiteSpace: 'nowrap' }}>
                      {l.prints!.map((id, i) => (
                        <a key={id} href={`/api/leads/media/${id}`} target="_blank" rel="noopener noreferrer" title={`Print ${i + 1} enviado pelo lojista`} style={{ color: 'var(--accent)', textDecoration: 'none', marginRight: 4 }}>📷{l.prints!.length > 1 ? i + 1 : ''}</a>
                      ))}
                    </span>
                  )}
                  {l.extras?.map((x) => (
                    <div key={x.key} style={{ marginTop: '0.45rem' }}>
                      <b>+ {x.rotulo}:</b> {x.situacao}
                      {x.prints?.map((id, i) => <a key={id} href={`/api/leads/media/${id}`} target="_blank" rel="noopener noreferrer" title={`Print ${i + 1} enviado pelo lojista`} style={{ color: 'var(--accent)', textDecoration: 'none', marginLeft: 4 }}>📷</a>)}
                    </div>
                  ))}
                </td>
                <td style={{ ...td, fontSize: '0.8rem', color: 'var(--text-dim)', maxWidth: 270 }}>
                  {l.acao}
                  {l.extras?.map((x) => <div key={x.key} style={{ marginTop: '0.45rem' }}><b style={{ color: 'var(--text)' }}>{x.rotulo}:</b> {x.acao}</div>)}
                </td>
                <td style={{ ...td, fontSize: '0.76rem', color: 'var(--text-muted)', maxWidth: 240 }}>
                  {fala?.texto ? <>“{fala.texto}” <span style={{ whiteSpace: 'nowrap' }}>· {fmtQuando(fala.quando)}</span></> : l.leadId ? 'nunca respondeu' : '—'}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '0.78rem' }} title={fmtQuando(l.desde)}><b>{haQuanto(l.desde)}</b></td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                    {l.botao}
                    {l.extras?.map((x) => <span key={x.key} title={x.rotulo}>{x.botao}</span>)}
                  </div>
                </td>
              </>
            )
            return l.leadId ? <ClickableRow key={l.key} leadId={l.leadId}>{celulas}</ClickableRow> : <tr key={l.key}>{celulas}</tr>
          })}
        </tbody>
      </table>
    </div>
  )
}

function Secao({ id, titulo, sub, vazio, linhas, falas }: { id: string; titulo: string; sub: string; vazio: string; linhas: Linha[]; falas: Falas }) {
  return (
    <section id={id} style={{ marginBottom: '1.7rem', scrollMarginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.02rem' }}>{titulo} {linhas.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({linhas.length})</span>}</h2>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sub}</span>
      </div>
      {linhas.length === 0
        ? <p style={{ margin: 0, padding: '0.6rem 0.2rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{vazio}</p>
        : <TabelaLimitada linhas={linhas} falas={falas} />}
    </section>
  )
}

/** Quantas lojas de cada tema ficam à vista; o resto abre em "ver mais" (Aldo 06/10/2026 — 27 linhas
 *  num tema só deixavam o painel enorme). Vale pra todos os temas, avisos do robô e seções. */
const A_VISTA = 3

function TabelaLimitada({ linhas, falas }: { linhas: Linha[]; falas: Falas }) {
  const resto = linhas.slice(A_VISTA)
  return (
    <>
      <Tabela linhas={linhas.slice(0, A_VISTA)} falas={falas} />
      {resto.length > 0 && (
        <details style={{ marginTop: '0.3rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--accent)' }}>ver mais {resto.length}</summary>
          <Tabela linhas={resto} falas={falas} />
        </details>
      )}
    </>
  )
}

export default async function AtendimentoPage() {
  const { grupos, chamados, cs, avisos, falas, registros } = await getDados()
  const totalAvisos = avisos.reduce((t, g) => t + g.linhas.length, 0)

  return (
    <main>
      <header style={{ marginBottom: '1.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: '0.85rem', padding: '0.35rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-elev)' }}>← Voltar</Link>
          <h1 style={{ margin: 0 }}>🎧 Atendimento</h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>a fila de trabalho — funil e lojas ativas (CS); números de desempenho ficam no <Link href="/desempenho" style={{ color: 'var(--accent)' }}>Desempenho</Link></span>
        </div>
      </header>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', flex: '1 1 520px' }}>
        <CardResumo id="avisos" label="🚨 Avisos do robô" value={totalAvisos} color="var(--red)" />
        <CardResumo id="acao" label="🔴 Ação pendente" value={grupos.acao.length} color="var(--red)" />
        <CardResumo id="cs" label="🟣 CS lojas ativas" value={cs.length} color="#a855f7" />
        <CardResumo id="chamados" label="🛠 Chamados" value={chamados.length} color="var(--red)" />
        <CardResumo id="semmotivo" label="⚪ Sem motivo" value={grupos.sem_motivo.length} />
      </div>
      <QuadroRegistros {...registros} />
      </div>

      {totalAvisos > 0 && (
        <section id="avisos" style={{ marginBottom: '1.8rem', padding: '0.9rem 1rem', border: '1px solid var(--red)', borderRadius: 10, background: 'var(--bg-elev)', scrollMarginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--red)' }}>🚨 Avisos do robô <span style={{ fontWeight: 400 }}>({totalAvisos})</span></h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>o robô parou de insistir nessas lojas e avisou no WhatsApp — ficam aqui até alguém tratar e clicar em Resolvido</span>
          </div>
          {avisos.map((g) => (
            <div key={g.tipo} style={{ marginBottom: '1rem' }}>
              <h3 style={{ margin: '0 0 0.3rem', fontSize: '0.92rem' }}>{CATALOGO[g.tipo].titulo} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({g.linhas.length})</span></h3>
              <TabelaLimitada linhas={g.linhas} falas={falas} />
            </div>
          ))}
        </section>
      )}

      <Secao id="acao" titulo="🔴 Ação pendente" sub="a VictorIA passou pra uma pessoa (o lojista pediu, ou ela não soube resolver) — resolver hoje" vazio="Fila zerada. 🎉" linhas={grupos.acao} falas={falas} />
      <Secao id="cs" titulo="🟣 CS — lojas ativas" sub="lojas já operando que acionaram atendimento" vazio="Nenhuma loja ativa aguardando. ✓" linhas={cs} falas={falas} />
      <Secao id="chamados" titulo="🛠 Chamados abertos" sub="erro de portal/sistema relatado pelo lojista" vazio="Nenhum chamado aberto. ✓" linhas={chamados} falas={falas} />
      {/* (06/10/2026) "Mover card" e "Docs / colaboradores" saíram: o card anda sozinho (Registros AIVA →
          49, espelho do portal) e o colaborador é o próprio lojista que lança no formulário oficial da AIVA. */}
      <Secao id="semmotivo" titulo="⚪ Sem motivo registrado" sub="a VictorIA acionou sem dizer por quê" vazio="Nenhum. ✓" linhas={grupos.sem_motivo} falas={falas} />

      <LeadDrawer />
    </main>
  )
}
