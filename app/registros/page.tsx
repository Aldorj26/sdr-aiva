import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { linkFormPreenchido, formatarCnpj } from '@/lib/pre-cadastro-form'
import { linkColaboradorPreenchido } from '@/lib/colaborador-form'
import CheckEnviado from './CheckEnviado'
import AbrirFormLink from './AbrirFormLink'
import ClickableRow from '@/app/_components/ClickableRow'
import LeadDrawer from '@/app/_components/LeadDrawer'

export const dynamic = 'force-dynamic'

const DRIVE_DOCS_URL = 'https://drive.google.com/drive/folders/1yAtSYdjDISW2SX965f925KjMBTMHD2gp'
const PLANILHA_BASE = 'https://docs.google.com/spreadsheets/d/1lTB9LvptQejFd_WLygGAKDE6UDVlzvfLEDGhcdSRmQU/edit'
// gid da aba da planilha correspondente a cada aba do painel — o link "Abrir
// planilha" cai direto na aba certa (Atendimentos / Senhas / Manual).
const PLANILHA_GID: Record<string, string> = {
  cnpjs: '1497480463',  // Atendimentos
  colabs: '690539536',  // Senhas
  docs: '414597766',    // Manual
}

const ABAS = [
  { id: 'cnpjs', label: '🏢 CNPJs registrados na base' },
  { id: 'colabs', label: '👥 Colaboradores das Lojas' },
  { id: 'docs', label: '📄 Doc sem Sócios' },
] as const

const th: React.CSSProperties = { textAlign: 'left', padding: '0.5rem 0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-strong)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '0.5rem 0.6rem', fontSize: '0.82rem', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }

function dataBr(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Busca: compara sem acento/caixa e, pra número, só os dígitos — assim
// "52.618.643/0001-05", "52618643" e "5516993400269" acham a mesma linha.
const norm = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

function casa(termo: string, campos: unknown[]): boolean {
  const t = norm(termo).trim()
  if (!t) return true
  const tDig = soDigitos(termo)
  return campos.some((c) => {
    if (norm(c).includes(t)) return true
    return tDig.length >= 3 && soDigitos(c).includes(tDig)
  })
}

export default async function RegistrosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>
}) {
  const sp = await searchParams
  const tab = ABAS.some((a) => a.id === sp.tab) ? (sp.tab as string) : 'cnpjs'
  const q = (sp.q ?? '').trim()

  const [cnpjsQ, colabsQ, docsQ] = await Promise.all([
    supabaseAdmin.from('sdr_registros_cnpj').select('*').order('criado_em', { ascending: false }).limit(300),
    supabaseAdmin.from('sdr_registros_colab').select('*').order('criado_em', { ascending: false }).limit(300),
    supabaseAdmin
      .from('sdr_leads')
      .select('id, nome, telefone, status, observacoes, data_ultimo_contato')
      .like('observacoes', '%[DOCS_SEM_SOCIO]%')
      .order('data_ultimo_contato', { ascending: false })
      .limit(200),
  ])
  const cnpjsTodos = cnpjsQ.data ?? []
  const colabsTodos = colabsQ.data ?? []
  const docsTodos = docsQ.data ?? []

  const cnpjs = cnpjsTodos.filter((r) => casa(q, [r.loja, r.cnpj, r.telefone, r.tipo]))
  const colabs = colabsTodos.filter((r) =>
    casa(q, [r.loja, r.nome, r.cpf, r.email, r.telefone, r.cnpj_loja, r.telefone_lead]),
  )
  const docs = docsTodos.filter((r) => casa(q, [r.nome, r.telefone, r.status]))

  // contadores das abas seguem no total (não no filtrado) — são indicadores da
  // operação, não do que está na tela
  const pendentesCnpj = cnpjsTodos.filter((c) => !c.enviado).length
  const falhasColab = colabsTodos.filter((c) => !c.form_ok).length
  const totalAba = tab === 'cnpjs' ? cnpjsTodos.length : tab === 'colabs' ? colabsTodos.length : docsTodos.length
  const visiveisAba = tab === 'cnpjs' ? cnpjs.length : tab === 'colabs' ? colabs.length : docs.length

  return (
    <main style={{ padding: '1.5rem', maxWidth: 1100 }}>
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 0.25rem' }}>📋 Registros AIVA</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 1rem' }}>
        Painel de controle dos registros feitos pela VictorIA — formulários e planilha AIVA APROVAÇÃO.{' '}
        <a
          href={`${PLANILHA_BASE}?gid=${PLANILHA_GID[tab]}#gid=${PLANILHA_GID[tab]}`}
          target="_blank"
          style={{ color: 'var(--accent)' }}
        >
          Abrir planilha ({tab === 'cnpjs' ? 'aba Atendimentos' : tab === 'colabs' ? 'aba Senhas' : 'aba Manual'}) ↗
        </a>
      </p>

      {/* Abas */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {ABAS.map((a) => (
          <Link
            key={a.id}
            href={`/registros?tab=${a.id}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
            style={{
              padding: '0.5rem 0.9rem',
              borderRadius: 8,
              textDecoration: 'none',
              fontSize: '0.85rem',
              fontWeight: tab === a.id ? 700 : 400,
              background: tab === a.id ? 'var(--accent)' : 'var(--bg-elev)',
              color: tab === a.id ? '#fff' : 'var(--text)',
              border: '1px solid ' + (tab === a.id ? 'var(--accent)' : 'var(--border-strong)'),
            }}
          >
            {a.label}
            {a.id === 'cnpjs' && pendentesCnpj > 0 && ` (${pendentesCnpj} pendente${pendentesCnpj > 1 ? 's' : ''})`}
          </Link>
        ))}
      </div>

      {/* Busca — form GET simples: funciona sem JS e filtra os registros todos,
          não só os que estão na tela. A aba atual vai junto no hidden pra não
          voltar pra primeira ao pesquisar. */}
      <form
        method="GET"
        action="/registros"
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0 0 1rem', flexWrap: 'wrap' }}
      >
        <input type="hidden" name="tab" value={tab} />
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Buscar por loja, CNPJ, CPF, nome, e-mail ou telefone…"
          style={{
            flex: '1 1 320px',
            minWidth: 0,
            padding: '0.5rem 0.75rem',
            borderRadius: 8,
            border: '1px solid var(--border-strong)',
            background: 'var(--bg-elev)',
            color: 'var(--text)',
            fontSize: '0.85rem',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid var(--accent)',
            background: 'var(--accent)', color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Buscar
        </button>
        {q && (
          <Link
            href={`/registros?tab=${tab}`}
            style={{
              padding: '0.5rem 0.9rem', borderRadius: 8, border: '1px solid var(--border-strong)',
              background: 'var(--bg-elev)', color: 'var(--text)', fontSize: '0.85rem', textDecoration: 'none',
            }}
          >
            Limpar
          </Link>
        )}
        {q && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {visiveisAba} de {totalAba} nesta aba
          </span>
        )}
      </form>

      {tab === 'cnpjs' && (
        <section>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
            CNPJs (matriz + adicionais) liberados após o cadastro completo. Clique em <b>Abrir form</b> — o CNPJ já vai
            preenchido, é só enviar. O ✓ é marcado <b>automaticamente ao abrir</b>; se não chegou a enviar, é só desmarcar.
            (O form da AIVA exige login, por isso o envio continua manual.)
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Enviado</th><th style={th}>Loja</th><th style={th}>CNPJ</th><th style={th}>Tipo</th><th style={th}>Quando</th><th style={th}>Ação</th>
            </tr></thead>
            <tbody>
              {cnpjs.length === 0 && <tr><td style={td} colSpan={6}>Nenhum CNPJ registrado ainda.</td></tr>}
              {cnpjs.map((r) => {
                const celulas = (
                  <>
                    <td style={td}><CheckEnviado id={r.id} enviado={r.enviado} origem={r.origem} /></td>
                    <td style={td}>{r.loja ?? '—'}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.telefone}</div></td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{formatarCnpj(r.cnpj)}</td>
                    <td style={td}>{r.tipo === 'matriz' ? '🏢 matriz' : '➕ adicional'}</td>
                    <td style={td}>{dataBr(r.criado_em)}</td>
                    <td style={td}>
                      <AbrirFormLink id={r.id} href={linkFormPreenchido(r.cnpj) ?? '#'} jaEnviado={r.enviado} />
                    </td>
                  </>
                )
                return r.lead_id ? (
                  <ClickableRow key={r.id} leadId={r.lead_id} style={{ opacity: r.enviado ? 0.55 : 1 }}>
                    {celulas}
                  </ClickableRow>
                ) : (
                  <tr key={r.id} style={{ opacity: r.enviado ? 0.55 : 1 }}>{celulas}</tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'colabs' && (
        <section>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
            Colaboradores capturados pela VictorIA e lançados automaticamente no formulário de acesso + aba Senhas da planilha.
            {falhasColab > 0 && <b style={{ color: '#ef4444' }}> {falhasColab} com falha no envio automático — use o link pra lançar manualmente.</b>}
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Status</th><th style={th}>Loja</th><th style={th}>Colaborador</th><th style={th}>CPF</th><th style={th}>Contato</th><th style={th}>Quando</th><th style={th}>Ação</th>
            </tr></thead>
            <tbody>
              {colabs.length === 0 && <tr><td style={td} colSpan={7}>Nenhum colaborador registrado ainda.</td></tr>}
              {colabs.map((r) => {
                const celulas = (
                  <>
                  <td style={td}>{r.form_ok
                    ? <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.78rem' }}>✓ lançado</span>
                    : <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '0.78rem' }}>✗ falhou</span>}</td>
                  <td style={td}>{r.loja ?? '—'}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>CNPJ {r.cnpj_loja}</div></td>
                  <td style={td}>{r.nome}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{r.cpf}</td>
                  <td style={td}>{r.email}<div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.telefone}</div></td>
                  <td style={td}>{dataBr(r.criado_em)}</td>
                  <td style={td}>
                    {!r.form_ok && (
                      <a href={linkColaboradorPreenchido(r.loja ?? '', { cnpjMatriz: r.cnpj_loja ?? '', cnpjLoja: r.cnpj_loja ?? '', nome: r.nome ?? '', cpf: r.cpf ?? '', email: r.email ?? '', telefone: r.telefone ?? '' })}
                         target="_blank" style={{ color: 'var(--accent)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        Lançar manual ↗
                      </a>
                    )}
                  </td>
                  </>
                )
                return r.lead_id ? (
                  <ClickableRow key={r.id} leadId={r.lead_id}>{celulas}</ClickableRow>
                ) : (
                  <tr key={r.id}>{celulas}</tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'docs' && (
        <section>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
            Lojas de empresário individual (sem sócio na Receita) no fluxo de documentos. Os arquivos caem automaticamente na{' '}
            <a href={DRIVE_DOCS_URL} target="_blank" style={{ color: 'var(--accent)', fontWeight: 600 }}>
              pasta do Drive ↗
            </a>{' '}
            (subpasta por loja) e, ao completar, a linha entra na aba Manual da planilha.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Status docs</th><th style={th}>Loja</th><th style={th}>Telefone</th><th style={th}>Etapa</th><th style={th}>Último contato</th>
            </tr></thead>
            <tbody>
              {docs.length === 0 && <tr><td style={td} colSpan={5}>Nenhuma loja no fluxo de documentos ainda.</td></tr>}
              {docs.map((l) => {
                const completo = (l.observacoes ?? '').includes('[LINHA_MANUAL_OK]')
                return (
                  <ClickableRow key={l.id} leadId={l.id}>
                    <td style={td}>{completo
                      ? <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '0.78rem' }}>✓ completo (na aba Manual)</span>
                      : <span style={{ color: '#d97706', fontWeight: 600, fontSize: '0.78rem' }}>⏳ aguardando docs</span>}</td>
                    <td style={td}>{l.nome}</td>
                    <td style={td}>{l.telefone}</td>
                    <td style={td}>{l.status}</td>
                    <td style={td}>{dataBr(l.data_ultimo_contato)}</td>
                  </ClickableRow>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Painel de conversa — clicar em qualquer linha abre o lead sem sair
          da tela (Responder, Reprocessar, Enviar info etc.) */}
      <LeadDrawer />
    </main>
  )
}
