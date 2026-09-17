import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import ClickableRow from '../_components/ClickableRow'
import LeadDrawer from '../_components/LeadDrawer'
import Copiavel from '@/app/_components/Copiavel'
import { diasUteisEntre } from '@/lib/senha-pendente-calc'

// 🚨 EXCEÇÕES (passo 7 da Fase 1, pedido do Aldo 16/09): tudo que as automações
// do fluxo novo NÃO conseguiram resolver sozinhas, numa tela só. A regra da Fase 1
// é que o robô cuida do caminho normal e só devolve pra gente o que travou — esta
// é a lista do que travou.
//
// Tudo vem de MARCADOR em sdr_leads (nada de chamada ao portal aqui): a página
// tem que abrir rápido e não pode quebrar se o portal da AIVA estiver fora.
// Quem grava cada marcador: senha-pendente, biometria, cobranca-formulario,
// check-treinamento e espelho-portal.
export const dynamic = 'force-dynamic'

interface Lead {
  id: string
  nome: string
  telefone: string
  status: string
  observacoes: string | null
  data_ultimo_contato: string | null
}

const th: React.CSSProperties = { textAlign: 'left', padding: '0.45rem 0.6rem', fontSize: '0.72rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' }
const td: React.CSSProperties = { padding: '0.45rem 0.6rem', fontSize: '0.83rem', borderBottom: '1px solid var(--border)' }

const marcadorISO = (obs: string | null, tag: string): string | null => {
  const m = (obs ?? '').match(new RegExp(`\\[${tag}:([^\\]]+)\\]`))
  const iso = m?.[1]
  return iso && Number.isFinite(Date.parse(iso)) ? iso : null
}
const cnpjDeObs = (obs: string | null): string | null => {
  const d = (obs ?? '').match(/cnpj_matriz=([0-9]{14})/)?.[1] ?? (obs ?? '').match(/CNPJ_RECEITA:(?:cnpj=)?([0-9]{14})/)?.[1]
  return d ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : null
}
const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—')
const diasCorridos = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : null)

async function busca(like: string, limite = 200): Promise<Lead[]> {
  const { data } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, observacoes, data_ultimo_contato')
    .like('observacoes', like)
    .limit(limite)
  return (data ?? []) as Lead[]
}

async function getDados() {
  const [senha, biometria, formulario, treinamento, conferir, cnpjVoltou, cnpjIrregular, cnpjInvalido] = await Promise.all([
    busca('%[SENHA_PENDENTE_DESDE:%'),
    busca('%[BIOMETRIA_ESGOTADO]%'),
    busca('%[COBRANCA_FORM_ESGOTADO]%'),
    busca('%[CHECK_TREINAMENTO_ESGOTADO]%'),
    busca('%[PORTAL_REPROVADO_CONFERIR:%'),
    busca('%[RETORNO_CNPJ_ALERTA:%'),
    busca('%[CNPJ_IRREGULAR_AIVA:%'),
    busca('%[CNPJ_PORTAL_INVALIDO:%'),
  ])
  const agora = Date.now()
  return {
    senha: senha
      .map((l) => ({ ...l, desde: marcadorISO(l.observacoes, 'SENHA_PENDENTE_DESDE') }))
      .map((l) => ({ ...l, dias: l.desde ? diasUteisEntre(Date.parse(l.desde), agora) : 0 }))
      .sort((a, b) => b.dias - a.dias),
    biometria: biometria
      .map((l) => ({ ...l, ultimo: marcadorISO(l.observacoes, 'BIOMETRIA') ?? marcadorISO(l.observacoes, 'BIOMETRIA_INICIO') }))
      .sort((a, b) => (a.ultimo ?? '').localeCompare(b.ultimo ?? '')),
    formulario: formulario
      .map((l) => ({ ...l, inicio: marcadorISO(l.observacoes, 'COBRANCA_FORM_INICIO') }))
      .sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? '')),
    treinamento: treinamento
      .map((l) => ({ ...l, ultimo: marcadorISO(l.observacoes, 'CHECK_TREINAMENTO') }))
      .sort((a, b) => (a.ultimo ?? '').localeCompare(b.ultimo ?? '')),
    conferir: conferir
      .map((l) => ({ ...l, quando: marcadorISO(l.observacoes, 'PORTAL_REPROVADO_CONFERIR') }))
      .sort((a, b) => (a.quando ?? '').localeCompare(b.quando ?? '')),
    cnpjVoltou: cnpjVoltou
      .filter((l) => l.status === 'NAO_QUALIFICADO')
      .map((l) => ({ ...l, quando: marcadorISO(l.observacoes, 'RETORNO_CNPJ_ALERTA') }))
      .sort((a, b) => (b.quando ?? '').localeCompare(a.quando ?? '')),
    cnpjIrregular: cnpjIrregular
      .map((l) => ({ ...l, situacao: (l.observacoes ?? '').match(/\[CNPJ_IRREGULAR_AIVA:([^:\]]+)/)?.[1] ?? '?' }))
      .sort((a, b) => a.situacao.localeCompare(b.situacao)),
    cnpjInvalido: cnpjInvalido
      .map((l) => ({ ...l, situacao: (l.observacoes ?? '').match(/\[CNPJ_PORTAL_INVALIDO:([^:\]]+)/)?.[1] ?? '?' }))
      .sort((a, b) => a.situacao.localeCompare(b.situacao)),
  }
}

function Card({ label, value, href, cor }: { label: string; value: number; href: string; cor?: string }) {
  return (
    <a href={href} style={{ display: 'block', textDecoration: 'none', padding: '0.7rem 0.9rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elev)', minWidth: 150 }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: value > 0 ? (cor ?? 'var(--text)') : 'var(--text-muted)' }}>{value}</div>
    </a>
  )
}

function Secao({ id, titulo, oque, acao, count, children }: { id: string; titulo: string; oque: string; acao: string; count: number; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: '1.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', marginBottom: '0.15rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.02rem' }}>{titulo} {count > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({count})</span>}</h2>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{oque}</span>
      </div>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>👉 {acao}</p>
      {count === 0
        ? <p style={{ margin: 0, padding: '0.5rem 0.2rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Nada aqui — o robô está dando conta. ✅</p>
        : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table></div>}
    </section>
  )
}

function Ident({ l }: { l: Lead }) {
  const cnpj = cnpjDeObs(l.observacoes)
  return (
    <td style={td}>
      {l.nome}
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        <Copiavel valor={l.telefone} />
        {cnpj ? <> · <Copiavel valor={cnpj.replace(/\D/g, '')} exibir={cnpj} /></> : null}
      </div>
    </td>
  )
}

const cabecalho = (col: string) => (
  <thead><tr><th style={th}>Loja</th><th style={th}>Etapa</th><th style={th}>{col}</th></tr></thead>
)

export default async function ExcecoesPage() {
  const d = await getDados()
  const total = d.senha.length + d.biometria.length + d.formulario.length + d.treinamento.length + d.conferir.length + d.cnpjVoltou.length

  return (
    <main>
      <header style={{ marginBottom: '1.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: '0.85rem', padding: '0.35rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-elev)' }}>← Voltar</Link>
          <h1 style={{ margin: 0 }}>🚨 Exceções</h1>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            o que as automações do fluxo novo não resolveram sozinhas — o resto segue no <Link href="/atendimento" style={{ color: 'var(--accent)' }}>Atendimento</Link>
          </span>
        </div>
        {total === 0 && <p style={{ margin: '0.8rem 0 0', color: 'var(--green, #22c55e)', fontSize: '0.9rem' }}>Nenhuma exceção aberta. Tudo fluindo pelo automático. 🎉</p>}
      </header>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <Card label="🔑 Senha pendente" value={d.senha.length} href="#senha" cor="var(--red)" />
        <Card label="🪪 Biometria parada" value={d.biometria.length} href="#biometria" cor="var(--yellow)" />
        <Card label="📋 Formulário sem resposta" value={d.formulario.length} href="#formulario" cor="var(--yellow)" />
        <Card label="🎓 Treinamento sem resposta" value={d.treinamento.length} href="#treinamento" cor="var(--yellow)" />
        <Card label="🔎 Reprovado a conferir" value={d.conferir.length} href="#conferir" cor="#a855f7" />
        <Card label="🔁 Travado voltou a falar" value={d.cnpjVoltou.length} href="#cnpj" cor="#a855f7" />
        <Card label="🧾 CNPJ irregular" value={d.cnpjIrregular.length} href="#cnpj-irregular" cor="var(--red)" />
        <Card label="🔢 CNPJ não confere" value={d.cnpjInvalido.length} href="#cnpj-invalido" cor="#a855f7" />
      </div>

      <Secao id="senha" titulo="🔑 Senha não enviada pela AIVA" count={d.senha.length}
        oque="acesso do sócio solicitado e a AIVA ainda não mandou"
        acao="Cobrar no Live Chat da AIVA. A VictorIA já sabe e não manda o lojista procurar no spam.">
        {cabecalho('Pedido')}
        <tbody>{d.senha.map((l) => (
          <ClickableRow key={l.id} leadId={l.id}>
            <Ident l={l} />
            <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.status}</td>
            <td style={{ ...td, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              {fmtData(l.desde)} · <b style={{ color: l.dias >= 10 ? 'var(--red)' : 'var(--yellow)' }}>{l.dias} dia(s) útil(eis)</b>
            </td>
          </ClickableRow>
        ))}</tbody>
      </Secao>

      <Secao id="biometria" titulo="🪪 Biometria não concluída" count={d.biometria.length}
        oque="link do reconhecimento facial enviado 3× e a loja não fez"
        acao="Ligar: costuma ser dificuldade com a câmera ou com o documento.">
        {cabecalho('Último envio')}
        <tbody>{d.biometria.map((l) => (
          <ClickableRow key={l.id} leadId={l.id}>
            <Ident l={l} />
            <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.status}</td>
            <td style={{ ...td, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtData(l.ultimo)}{diasCorridos(l.ultimo) != null ? ` · há ${diasCorridos(l.ultimo)} dia(s)` : ''}</td>
          </ClickableRow>
        ))}</tbody>
      </Secao>

      <Secao id="formulario" titulo="📋 Formulário do varejo sem resposta" count={d.formulario.length}
        oque="4 cobranças (D+1/3/7/14) e o formulário segue pendente no portal"
        acao="Contato direto ou descartar o card no Evo — o robô parou de cobrar.">
        {cabecalho('Na fila desde')}
        <tbody>{d.formulario.map((l) => (
          <ClickableRow key={l.id} leadId={l.id}>
            <Ident l={l} />
            <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.status}</td>
            <td style={{ ...td, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtData(l.inicio)}{diasCorridos(l.inicio) != null ? ` · há ${diasCorridos(l.inicio)} dia(s)` : ''}</td>
          </ClickableRow>
        ))}</tbody>
      </Secao>

      <Secao id="treinamento" titulo="🎓 Treinamento sem resposta" count={d.treinamento.length}
        oque="perguntamos 8× se fez o treinamento e não houve resposta"
        acao="Contato direto ou reavaliar a etapa do card.">
        {cabecalho('Última pergunta')}
        <tbody>{d.treinamento.map((l) => (
          <ClickableRow key={l.id} leadId={l.id}>
            <Ident l={l} />
            <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.status}</td>
            <td style={{ ...td, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtData(l.ultimo)}</td>
          </ClickableRow>
        ))}</tbody>
      </Secao>

      <Secao id="conferir" titulo="🔎 Reprovado no portal, mas a loja opera" count={d.conferir.length}
        oque="pré-cadastro reprovado na AIVA com a loja em Vendendo (ou com RID ativo)"
        acao="Conferir com a AIVA: se for reprovado mesmo, mover o card pra 'Loja Descartada pela Aiva'. O espelho não mexe nesses.">
        {cabecalho('Detectado em')}
        <tbody>{d.conferir.map((l) => (
          <ClickableRow key={l.id} leadId={l.id}>
            <Ident l={l} />
            <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.status}</td>
            <td style={{ ...td, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtData(l.quando)}</td>
          </ClickableRow>
        ))}</tbody>
      </Secao>

      <Secao id="cnpj-irregular" titulo="🧾 CNPJ irregular na Receita (checagem da AIVA)" count={d.cnpjIrregular.length}
        oque="a AIVA checou o CNPJ e voltou INAPTA, BAIXADA ou SUSPENSA — preencher o formulário não destrava nada"
        acao="Falar com o lojista pra regularizar com o contador. A cobrança do formulário já parou sozinha; quando o CNPJ voltar a ficar ativo o marcador some e a régua volta.">
        {cabecalho('Situação')}
        <tbody>{d.cnpjIrregular.map((l) => (
          <ClickableRow key={l.id} leadId={l.id}>
            <Ident l={l} />
            <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.status}</td>
            <td style={{ ...td, fontSize: '0.8rem', whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{l.situacao}</td>
          </ClickableRow>
        ))}</tbody>
      </Secao>

      <Secao id="cnpj-invalido" titulo="🔢 CNPJ do portal não confere" count={d.cnpjInvalido.length}
        oque="o CNPJ cadastrado no portal da AIVA tem dígito inválido ou não consta na Receita — quase sempre erro de digitação (tem loja vendendo assim)"
        acao="Conferir o CNPJ certo com o lojista e pedir a correção pra AIVA. NÃO é problema da loja: não trave o lead nem pare de atender.">
        {cabecalho('Retorno')}
        <tbody>{d.cnpjInvalido.map((l) => (
          <ClickableRow key={l.id} leadId={l.id}>
            <Ident l={l} />
            <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.status}</td>
            <td style={{ ...td, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{l.situacao === 'invalid' ? 'dígito inválido' : 'não consta'}</td>
          </ClickableRow>
        ))}</tbody>
      </Secao>

      <Secao id="cnpj" titulo="🔁 Lead travado que voltou a falar" count={d.cnpjVoltou.length}
        oque="travado por CNPJ (menos de 1 ano, irregular ou reprovado) e mandou mensagem"
        acao="Se regularizou: conferir na Receita, mover o card pra Interessado e clicar Reativar.">
        {cabecalho('Voltou a falar')}
        <tbody>{d.cnpjVoltou.map((l) => (
          <ClickableRow key={l.id} leadId={l.id}>
            <Ident l={l} />
            <td style={{ ...td, fontSize: '0.78rem', color: 'var(--text-dim)' }}>{l.status}</td>
            <td style={{ ...td, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{fmtData(l.quando)}</td>
          </ClickableRow>
        ))}</tbody>
      </Secao>

      <LeadDrawer />
    </main>
  )
}
