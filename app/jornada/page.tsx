import Link from 'next/link'
import ClickableRow from '../_components/ClickableRow'
import LeadDrawer from '../_components/LeadDrawer'
import Copiavel from '@/app/_components/Copiavel'
import { carregarJornada } from '@/lib/jornada-aiva'
import { JORNADA, SAIDAS, ROTULO_FASE, QUEM_AGE, ETAPAS_EVO, type Fase, type Loja, type Acao } from '@/lib/jornada-aiva-calc'
import s from './jornada.module.css'

// 🧭 JORNADA AIVA (Aldo 24/09/2026): o portal da AIVA + o funil 15 do Evo + a
// nossa base numa leitura só, pro Nei responder "quem eu preciso cobrar hoje?"
// sem abrir loja por loja. Regras em lib/jornada-aiva-calc.ts; leitura em
// lib/jornada-aiva.ts (cache de 5 min; `?fresco=1` ignora o cache).
export const dynamic = 'force-dynamic'

const COR_QUEM: Record<string, string> = { lojista: 'var(--quem-lojista)', aiva: 'var(--quem-aiva)', track: 'var(--quem-track)', '—': 'var(--quem-nada)' }
const NOME_QUEM: Record<string, string> = { lojista: 'Lojista', aiva: 'AIVA', track: 'Track', '—': 'Ninguém' }
const NOME_ETAPA = new Map(ETAPAS_EVO.map((e) => [e.id, e.nome]))

const fmtCnpj = (d: string) => (d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d)
const fmtTel = (d: string) => { const t = d.replace(/^55/, ''); return t.length >= 10 ? `(${t.slice(0, 2)}) ${t.slice(2, -4)}-${t.slice(-4)}` : d }
const fmtReal = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const fmtInt = (v: number) => v.toLocaleString('pt-BR')
const fmtMes = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' })
const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const fmtDiaHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
const plural = (n: number, um: string, varios: string) => `${fmtInt(n)} ${n === 1 ? um : varios}`

function Delta({ agora, antes }: { agora: number; antes: number }) {
  if (!antes) return null
  const p = Math.round(((agora - antes) / antes) * 100)
  return <span className={`${s.delta} ${p >= 0 ? s.deltaSobe : s.deltaDesce}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}% vs mês anterior inteiro</span>
}

/** Uma linha de loja. Com lead nosso, a linha abre a conversa (LeadDrawer). */
function LinhaLoja({ l, extra }: { l: Loja; extra?: React.ReactNode }) {
  const celulas = (
    <>
      <td>
        <div style={{ fontWeight: 600 }}>{l.loja}</div>
        {l.socio && l.socio.toUpperCase() !== l.loja.toUpperCase() ? <div className={s.fraco}>{l.socio}</div> : null}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <Copiavel valor={l.cnpj} exibir={fmtCnpj(l.cnpj)} />
        {l.rid ? <div className={s.fraco}>RID <Copiavel valor={l.rid} /></div> : null}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>{l.telefone ? <Copiavel valor={l.telefone} exibir={fmtTel(l.telefone)} /> : <span className={s.fraco}>—</span>}</td>
      <td className={`${s.num} ${s.dias} ${(l.dias ?? 0) >= 7 ? s.diasQuente : ''}`}>{l.dias == null ? '—' : `${l.dias}d`}</td>
      <td>
        {extra}
        {l.detalhe ? <div className={s.fraco}>{l.detalhe}</div> : null}
        {l.lead ? <div className={s.fraco}>conversa: {l.lead.status?.toLowerCase().replace(/_/g, ' ')}</div> : <div className={s.semLead}>sem conversa nossa</div>}
      </td>
    </>
  )
  return l.lead ? <ClickableRow leadId={l.lead.id}>{celulas}</ClickableRow> : <tr>{celulas}</tr>
}

function TabelaLojas({ lojas, rotuloDias = 'Parada há', extra }: { lojas: Loja[]; rotuloDias?: string; extra?: (l: Loja) => React.ReactNode }) {
  if (!lojas.length) return <div className={s.vazioTexto}>Nenhuma loja aqui agora.</div>
  return (
    <div className={s.tabelaWrap}>
      <table className={s.tabela}>
        <thead><tr><th>Loja</th><th>CNPJ</th><th>Telefone (AIVA)</th><th className={s.num}>{rotuloDias}</th><th>Situação</th></tr></thead>
        <tbody>{lojas.map((l) => <LinhaLoja key={l.cnpj} l={l} extra={extra?.(l)} />)}</tbody>
      </table>
    </div>
  )
}

function BlocoAcao({ a }: { a: Acao }) {
  const cor = COR_QUEM[a.quem]
  return (
    <details className={`${s.acao} ${a.lojas.length ? '' : s.acaoZero}`} style={{ ['--cor' as string]: cor }}>
      <summary>
        <span className={s.faixa} />
        <span className={s.acaoQtd}>{a.lojas.length}</span>
        <span className={s.acaoTexto}>
          <span className={s.acaoTitulo}>{a.titulo}</span>
          <span className={s.acaoFazer}>{a.oQueFazer}</span>
        </span>
        <span className={s.chip}>quem age: {NOME_QUEM[a.quem]}</span>
      </summary>
      <div className={s.acaoCorpo}><TabelaLojas lojas={a.lojas} /></div>
    </details>
  )
}

function GraficoSemanas({ semanas }: { semanas: Array<{ inicio: string; preCadastros: number; lojasCriadas: number }> }) {
  const W = 560, H = 190, esq = 28, dir = 8, topo = 14, base = 26
  const max = Math.max(4, ...semanas.flatMap((x) => [x.preCadastros, x.lojasCriadas]))
  const passo = Math.ceil(max / 4)
  const teto = passo * 4
  const larg = (W - esq - dir) / semanas.length
  const y = (v: number) => topo + (H - topo - base) * (1 - v / teto)
  const bw = Math.min(16, larg / 3)
  return (
    <svg className={s.grafico} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pré-cadastros e lojas criadas por semana">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={esq} x2={W - dir} y1={y(i * passo)} y2={y(i * passo)} stroke="var(--border)" strokeWidth={1} />
          <text x={esq - 5} y={y(i * passo) + 3} textAnchor="end">{i * passo}</text>
        </g>
      ))}
      {semanas.map((x, i) => {
        const cx = esq + larg * i + larg / 2
        const [d, m] = [x.inicio.slice(8, 10), x.inicio.slice(5, 7)]
        return (
          <g key={x.inicio}>
            <rect x={cx - bw - 1} y={y(x.preCadastros)} width={bw} height={Math.max(0, H - base - y(x.preCadastros))} rx={2} fill="var(--quem-lojista)" />
            <rect x={cx + 1} y={y(x.lojasCriadas)} width={bw} height={Math.max(0, H - base - y(x.lojasCriadas))} rx={2} fill="var(--green)" />
            {x.preCadastros ? <text x={cx - bw / 2 - 1} y={y(x.preCadastros) - 3} textAnchor="middle" style={{ fill: 'var(--text-dim)' }}>{x.preCadastros}</text> : null}
            {x.lojasCriadas ? <text x={cx + bw / 2 + 1} y={y(x.lojasCriadas) - 3} textAnchor="middle" style={{ fill: 'var(--text-dim)' }}>{x.lojasCriadas}</text> : null}
            <text x={cx} y={H - 8} textAnchor="middle">{d}/{m}</text>
          </g>
        )
      })}
    </svg>
  )
}

export default async function JornadaPage({ searchParams }: { searchParams: Promise<{ fresco?: string }> }) {
  const sp = await searchParams
  const { painel: p, geradoEm, avisos, turmas } = await carregarJornada(sp.fresco === '1')
  const porFase = new Map(p.fases.map((f) => [f.fase, f]))
  const lojasDa = (f: Fase) => p.lojas.filter((l) => l.fase === f).sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))
  const d = p.desempenho
  const pendentesTotal = p.acoes.reduce((n, a) => n + a.lojas.length, 0)
  const principal = ETAPAS_EVO.filter((e) => ![69, 93, 94, 95].includes(e.id))
  const laterais = ETAPAS_EVO.filter((e) => [69, 93, 94, 95].includes(e.id))
  const maxEvo = Math.max(1, ...p.evo.etapas.map((e) => e.qtd))
  const qtdEvo = new Map(p.evo.etapas.map((e) => [e.id, e.qtd]))

  return (
    <main className={s.page}>
      <div className={s.topo}>
        <div>
          <h1 className={s.titulo}>Jornada AIVA</h1>
          <p className={s.sub}>
            Cada loja no ponto exato em que está no portal da AIVA, quem precisa agir pra ela andar,
            e onde o card do Evo ficou pra trás. {plural(p.total, 'loja', 'lojas')} no total.
          </p>
        </div>
        <div className={s.carimbo}>
          <span>dados de {fmtHora(geradoEm)} · guardados 5 min</span>
          <Link href="/jornada?fresco=1" prefetch={false}>Atualizar agora</Link>
        </div>
      </div>

      {avisos.length ? (
        <div className={s.aviso}>
          <b>Parte dos dados não carregou.</b> O resto da tela está certo, mas conte com buracos:
          <ul style={{ margin: '0.3rem 0 0 1rem', padding: 0 }}>{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      ) : null}

      {/* ── o trilho ─────────────────────────────────────────── */}
      <section className={s.secao}>
        <div className={s.secaoTopo}>
          <h2 className={s.secaoTitulo}>Onde as lojas estão</h2>
          <div className={s.legenda}>
            {(['lojista', 'aiva', 'track'] as const).map((q) => (
              <span key={q}><i className={s.ponto} style={{ background: COR_QUEM[q] }} /> {{ lojista: 'o lojista', aiva: 'a AIVA', track: 'a Track' }[q]} precisa agir</span>
            ))}
          </div>
        </div>
        <div className={s.trilhoWrap}>
          <div className={s.trilho}>
            {JORNADA.map((f, i) => {
              const r = porFase.get(f)!
              const cor = COR_QUEM[QUEM_AGE[f]]
              return (
                <div key={f} className={`${s.estacao} ${r.qtd ? '' : s.estacaoVazia}`} style={{ ['--cor' as string]: f === 'vendendo' ? 'var(--green)' : cor }}>
                  <span className={s.marco}>{i + 1}</span>
                  <span className={s.qtd}>{fmtInt(r.qtd)}</span>
                  <span className={s.nome}>{ROTULO_FASE[f]}</span>
                  {f !== 'vendendo' ? <span className={s.quem}>falta: {NOME_QUEM[QUEM_AGE[f]]}</span> : <span className={s.quem}>operando</span>}
                  {r.mediana != null ? (
                    <span className={s.meta}>metade há {r.mediana}d ou mais<br />mais antiga: {r.maisAntigo}d</span>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
        <div className={s.saidas}>
          {SAIDAS.filter((f) => (porFase.get(f)?.qtd ?? 0) > 0).map((f) => (
            <span key={f} className={s.saida}><b>{porFase.get(f)!.qtd}</b> {ROTULO_FASE[f].toLowerCase()}</span>
          ))}
        </div>
      </section>

      {/* ── fila do Nei ──────────────────────────────────────── */}
      <section className={s.secao}>
        <div className={s.secaoTopo}>
          <h2 className={s.secaoTitulo}>O que precisa de alguém hoje</h2>
          <p className={s.secaoSub}>{plural(pendentesTotal, 'loja parada', 'lojas paradas')} · abra o grupo; clicar na loja abre a conversa</p>
        </div>
        <div className={s.fila}>{p.acoes.map((a) => <BlocoAcao key={a.chave} a={a} />)}</div>
        {turmas.length ? (
          <p className={s.secaoSub}>
            Próximas turmas de treinamento: {turmas.map((t) => fmtDiaHora(t.startsAt)).join(' · ')}
          </p>
        ) : null}
      </section>

      {/* ── desempenho ───────────────────────────────────────── */}
      <section className={s.secao}>
        <div className={s.secaoTopo}>
          <h2 className={s.secaoTitulo}>Vendas de {fmtMes(d.mesAtual)}</h2>
          <p className={s.secaoSub}>portal de desempenho da AIVA — todas as lojas da Track, mês até hoje</p>
        </div>
        <div className={s.duasCol}>
          <div className={s.painelBloco}>
            <div className={s.kpis}>
              <div className={s.kpi}><span className={s.kpiValor}>{fmtInt(d.lojasComVendaMes)}</span><span className={s.kpiRotulo}>lojas vendendo no mês</span><Delta agora={d.lojasComVendaMes} antes={d.lojasComVendaMesAnt} /></div>
              <div className={s.kpi}><span className={s.kpiValor}>{fmtInt(d.vendasMes)}</span><span className={s.kpiRotulo}>vendas</span><Delta agora={d.vendasMes} antes={d.vendasMesAnt} /></div>
              <div className={s.kpi}><span className={s.kpiValor}>{fmtReal(d.valorMes)}</span><span className={s.kpiRotulo}>financiado</span></div>
              <div className={s.kpi}>
                <span className={s.kpiValor}>{d.consultasMes ? `${Math.round((d.aprovadosMes / d.consultasMes) * 100)}%` : '—'}</span>
                <span className={s.kpiRotulo}>aprovação ({fmtInt(d.aprovadosMes)} de {fmtInt(d.consultasMes)} consultas)</span>
              </div>
            </div>
            <h3 className={s.blocoTitulo}>Quem mais vendeu</h3>
            {d.top.length ? (
              <div className={s.tabelaWrap}>
                <table className={s.tabela}>
                  <thead><tr><th>Loja</th><th className={s.num}>Vendas</th><th className={s.num}>Valor</th></tr></thead>
                  <tbody>
                    {d.top.map((t) => (
                      <tr key={t.cnpj || t.nome}><td>{t.nome}</td><td className={s.num}>{t.vendas}</td><td className={s.num}>{fmtReal(t.valor)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className={s.vazioTexto}>Nenhuma venda registrada ainda neste mês.</div>}
          </div>
          <div className={s.painelBloco}>
            <h3 className={s.blocoTitulo}>Ritmo das últimas 8 semanas</h3>
            <div className={s.legenda}>
              <span><i className={s.ponto} style={{ background: 'var(--quem-lojista)' }} /> pré-cadastros novos</span>
              <span><i className={s.ponto} style={{ background: 'var(--green)' }} /> lojas criadas pela AIVA</span>
            </div>
            <GraficoSemanas semanas={p.semanas} />
            <p className={s.secaoSub}>Semana começando na segunda. Pré-cadastro que não vira loja criada é a fila do formulário e da biometria.</p>
          </div>
        </div>
      </section>

      {/* ── Evo ──────────────────────────────────────────────── */}
      <section className={s.secao}>
        <div className={s.secaoTopo}>
          <h2 className={s.secaoTitulo}>Funil 15 no Evo</h2>
          <p className={s.secaoSub}>{fmtInt(p.evo.totalCards)} cards · o espelho move sozinho a cada 15 min</p>
        </div>
        <div className={s.duasCol}>
          <div className={s.painelBloco}>
            <div className={s.evoLinhas}>
              {principal.map((e) => (
                <div key={e.id} className={s.evoLinha}>
                  <span className={s.evoNome} title={e.nome}>{e.nome}</span>
                  <span className={s.evoBarra}><span style={{ width: `${((qtdEvo.get(e.id) ?? 0) / maxEvo) * 100}%`, background: e.cor }} /></span>
                  <span className={s.evoQtd}>{fmtInt(qtdEvo.get(e.id) ?? 0)}</span>
                </div>
              ))}
              <span className={s.evoSep}>fora da linha principal</span>
              {laterais.map((e) => (
                <div key={e.id} className={s.evoLinha}>
                  <span className={s.evoNome} title={e.nome}>{e.nome}</span>
                  <span className={s.evoBarra}><span style={{ width: `${((qtdEvo.get(e.id) ?? 0) / maxEvo) * 100}%`, background: 'var(--text-muted)' }} /></span>
                  <span className={s.evoQtd}>{fmtInt(qtdEvo.get(e.id) ?? 0)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={s.painelBloco}>
            <h3 className={s.blocoTitulo}>Card atrás do portal · {p.evo.atrasados.length}</h3>
            <p className={s.secaoSub}>
              A loja já andou no portal e o card não acompanhou. O espelho costuma corrigir sozinho; se a loja continuar aqui
              por mais de um dia, algo está travando (etapa 50 sem o formulário de qualificação é o motivo mais comum).
            </p>
            {p.evo.atrasados.length ? (
              <div className={s.tabelaWrap}>
                <table className={s.tabela}>
                  <thead><tr><th>Loja</th><th>Card está em</th><th>Deveria estar em</th></tr></thead>
                  <tbody>
                    {p.evo.atrasados.slice(0, 40).map((l) => (
                      <ClickableRow key={l.cnpj} leadId={l.lead!.id}>
                        <td><div style={{ fontWeight: 600 }}>{l.loja}</div><div className={s.fraco}>{ROTULO_FASE[l.fase].toLowerCase()} no portal</div></td>
                        <td><span className={s.etapaPill}>{NOME_ETAPA.get(l.etapaCard)}</span></td>
                        <td><span className={s.etapaPill}>{NOME_ETAPA.get(l.etapaEsperada)}</span></td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className={s.vazioTexto}>Nenhum card atrasado — Evo e portal batem.</div>}
          </div>
        </div>
      </section>

      {/* ── CNPJ ─────────────────────────────────────────────── */}
      <section className={s.secao}>
        <div className={s.secaoTopo}>
          <h2 className={s.secaoTitulo}>CNPJ com problema na Receita · {p.cnpjProblema.length}</h2>
          <p className={s.secaoSub}>conferência da própria AIVA · lojas vendendo primeiro (podem travar repasse)</p>
        </div>
        <div className={s.painelBloco}>
          <TabelaLojas lojas={p.cnpjProblema} rotuloDias="Na fase há" extra={(l) => <span className={s.etapaPill}>{ROTULO_FASE[l.fase]}</span>} />
        </div>
      </section>

      {/* ── todas ────────────────────────────────────────────── */}
      <section className={s.secao}>
        <div className={s.secaoTopo}>
          <h2 className={s.secaoTitulo}>Todas as lojas, por fase</h2>
          <p className={s.secaoSub}>“há quanto tempo” usa a melhor data que o portal dá pra cada fase</p>
        </div>
        <div className={s.porFase}>
          {[...JORNADA, ...SAIDAS].map((f) => {
            const r = porFase.get(f)!
            if (!r.qtd) return null
            return (
              <details key={f}>
                <summary>
                  <i className={s.ponto} style={{ background: f === 'vendendo' ? 'var(--green)' : COR_QUEM[QUEM_AGE[f]] }} />
                  {ROTULO_FASE[f]}
                  {r.base ? <span className={s.fraco}>{r.base}</span> : null}
                  <b>{r.qtd}</b>
                </summary>
                <div className={s.corpo}><TabelaLojas lojas={lojasDa(f)} rotuloDias="Há" /></div>
              </details>
            )
          })}
        </div>
      </section>

      <LeadDrawer />
    </main>
  )
}
