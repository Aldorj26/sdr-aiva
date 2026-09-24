/**
 * lib/jornada-aiva-calc.ts — a JORNADA DO LOJISTA no portal da AIVA, fase a fase.
 * Parte PURA (sem rede, sem banco): recebe os dados já buscados e devolve tudo o
 * que o painel /jornada mostra. IO em lib/jornada-aiva.ts.
 *
 * POR QUE EXISTE (Aldo, 24/09/2026): o Nei acompanhava a jornada em três lugares —
 * o portal da AIVA (fase do cadastro), o funil 15 do Evo (card) e a nossa base
 * (conversa). Pra saber "quem eu preciso cobrar hoje" ele abria loja por loja.
 * Aqui as três fontes viram UMA leitura: em que fase cada loja está, há quanto
 * tempo, o que falta e quem tem que agir.
 *
 * ⚠️ REGRAS QUE NÃO SÃO DETALHE (todas aprendidas na marra, ver CLAUDE.md):
 *  - `stage` do portal MENTE sozinho: `biometria` + `biometry_status=aprovado` quer
 *    dizer que o lojista fez tudo e a AIVA é quem deve criar a loja (LT CELL, 18/09).
 *  - VENDA vence qualquer `stage`: o lote importado em 16/09 aparece como
 *    `dados_varejo` no portal e vende há meses. Quem vende está vendendo, ponto.
 *  - O card do Evo NÃO traz data nenhuma (id, título, telefone, etapa, tags) —
 *    toda idade aqui vem do portal.
 */

export type Fase =
  | 'pre_recusado'      // a AIVA recusou o pré-cadastro
  | 'reprovado'         // a AIVA reprovou o cadastro (not_approved)
  | 'formulario'        // falta o formulário do varejo
  | 'biometria'         // falta a selfie
  | 'biometria_negada'  // selfie recusada, precisa refazer
  | 'aguardando_aiva'   // lojista fez tudo; a AIVA não criou a loja
  | 'sem_senha'         // loja criada, a senha do sócio não saiu
  | 'sem_movimento'     // senha saiu, nenhuma consulta de crédito ainda
  | 'consultando'       // já consulta, ainda não vendeu
  | 'vendendo'          // vendeu neste mês ou no anterior
  | 'parou'             // já vendeu, mas nada nos dois últimos meses
  | 'outro'             // estado que o portal não explica (ver `outro` nos testes)

/** Ordem da jornada — é a ordem das estações na tela. */
export const JORNADA: readonly Fase[] = [
  'formulario', 'biometria', 'aguardando_aiva', 'sem_senha', 'sem_movimento', 'consultando', 'vendendo',
]
/** Saídas da jornada (não são etapa, são fim de linha). */
export const SAIDAS: readonly Fase[] = ['biometria_negada', 'parou', 'reprovado', 'pre_recusado', 'outro']

export const ROTULO_FASE: Record<Fase, string> = {
  pre_recusado: 'Pré-cadastro recusado',
  reprovado: 'Reprovado pela AIVA',
  formulario: 'Formulário do varejo',
  biometria: 'Biometria',
  biometria_negada: 'Selfie negada',
  aguardando_aiva: 'Esperando a AIVA',
  sem_senha: 'Loja criada, sem senha',
  sem_movimento: 'Com senha, sem uso',
  consultando: 'Consultando',
  vendendo: 'Vendendo',
  parou: 'Parou de vender',
  outro: 'Sem classificação',
}

/** Quem precisa agir pra loja sair da fase. É a pergunta que o Nei faz. */
export const QUEM_AGE: Record<Fase, 'lojista' | 'aiva' | 'track' | '—'> = {
  pre_recusado: '—', reprovado: '—', outro: 'track',
  formulario: 'lojista', biometria: 'lojista', biometria_negada: 'lojista',
  aguardando_aiva: 'aiva', sem_senha: 'aiva',
  sem_movimento: 'track', consultando: 'track', parou: 'track',
  vendendo: '—',
}

// ─── entradas ─────────────────────────────────────────────────────────────────
export type Onb = {
  id?: string | null
  cnpj?: string | null
  legal_name?: string | null
  partner_owner_name?: string | null
  phone_number?: string | null
  retailer_id?: string | number | null
  stage?: string | null
  pre_cadastro_status?: string | null
  formulario_status?: string | null
  biometry_status?: string | null
  created_at?: string | null
  updated_at?: string | null
  retailer_registered_at?: string | null
  training_at?: string | null
  cnpj_check_status?: string | null
  cnpj_situacao?: string | null
}
export type Perf = {
  retailer_id?: string | number | null
  cnpj?: string | null
  retailer_name?: string | null
  mes: string
  n_consultas?: number | null
  n_aprovados?: number | null
  n_vendas?: number | null
  valor_vendas?: number | string | null
}
export type LeadRef = { id: string; nome: string | null; status: string | null; opp: number | null }

export type Entradas = {
  onbs: Onb[]
  perf: Perf[]
  /** retailer_id → quando a senha do sócio saiu */
  senhaEnviada: Map<string, string>
  /** retailer_id → quando a senha foi PEDIDA e ainda não saiu */
  senhaPedida: Map<string, string>
  /** CNPJ (só dígitos) → lead nosso */
  leadPorCnpj: Map<string, LeadRef>
  /** opp do Evo → etapa atual no funil 15 */
  stagePorOpp: Map<number, number>
  agora: number
}

// ─── utilidades ───────────────────────────────────────────────────────────────
export const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const DIA_MS = 86_400_000
/** Mês civil de Brasília, 'YYYY-MM'. */
export function mesBrt(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date(ms))
}
export function mesAnterior(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}
export function diasDesde(iso: string | null | undefined, agora: number): number | null {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / DIA_MS)) : null
}
/** O desempenho traz o nome como slug do portal ("gotech-45705247000141"). */
export function nomeDoSlug(slug: string | null | undefined): string {
  const t = String(slug ?? '').trim().replace(/-?\d{14}$/, '').replace(/[-_]+/g, ' ').trim()
  return t ? t.toUpperCase() : ''
}
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// ─── desempenho por CNPJ ──────────────────────────────────────────────────────
export type Movimento = { vendasTotal: number; consultasTotal: number; vendasMes: number; vendasMesAnt: number; valorMes: number; ultimoMesComVenda: string | null }

export function movimentoPorCnpj(perf: Perf[], onbs: Onb[], mesAtual: string): Map<string, Movimento> {
  // a linha de desempenho às vezes vem sem CNPJ: o RID do cadastro resolve
  const cnpjDoRid = new Map<string, string>()
  for (const o of onbs) if (o.retailer_id != null && soDigitos(o.cnpj)) cnpjDoRid.set(String(o.retailer_id), soDigitos(o.cnpj))
  const ant = mesAnterior(mesAtual)
  const out = new Map<string, Movimento>()
  for (const p of perf) {
    const c = soDigitos(p.cnpj) || (p.retailer_id != null ? cnpjDoRid.get(String(p.retailer_id)) ?? '' : '')
    if (c.length !== 14) continue
    const m = String(p.mes ?? '').slice(0, 7)
    const acc = out.get(c) ?? { vendasTotal: 0, consultasTotal: 0, vendasMes: 0, vendasMesAnt: 0, valorMes: 0, ultimoMesComVenda: null }
    const v = num(p.n_vendas)
    acc.vendasTotal += v
    acc.consultasTotal += num(p.n_consultas)
    if (m === mesAtual) { acc.vendasMes += v; acc.valorMes += num(p.valor_vendas) }
    if (m === ant) acc.vendasMesAnt += v
    if (v > 0 && (!acc.ultimoMesComVenda || m > acc.ultimoMesComVenda)) acc.ultimoMesComVenda = m
    out.set(c, acc)
  }
  return out
}

// ─── a fase de UM cadastro ────────────────────────────────────────────────────
export function faseDe(o: Onb, mov: Movimento | undefined, senhaEnviada: Map<string, string>): Fase {
  // VENDA vence qualquer stage (o lote importado de 16/09 está em dados_varejo e vende)
  if (mov && mov.vendasTotal > 0) return (mov.vendasMes > 0 || mov.vendasMesAnt > 0) ? 'vendendo' : 'parou'
  if (mov && mov.consultasTotal > 0) return 'consultando'
  const stage = String(o.stage ?? '').toLowerCase()
  if (String(o.pre_cadastro_status ?? '').toLowerCase() === 'declined') return 'pre_recusado'
  if (stage === 'not_approved') return 'reprovado'
  if (o.retailer_id != null && String(o.retailer_id) !== '') {
    return senhaEnviada.has(String(o.retailer_id)) ? 'sem_movimento' : 'sem_senha'
  }
  if (stage === 'dados_varejo') return 'formulario'
  if (stage === 'biometria') {
    const b = String(o.biometry_status ?? '').toLowerCase()
    if (b === 'aprovado') return 'aguardando_aiva'
    if (b === 'negado') return 'biometria_negada'
    return 'biometria'
  }
  // cadastro_finalizado sem ID de loja: a AIVA fechou o cadastro e não criou a loja
  if (stage === 'cadastro_finalizado') return 'aguardando_aiva'
  return 'outro'
}

/** Desde quando a loja está NESTA fase — a data que o portal oferece pra cada uma.
 *  Onde não há data de entrada, usa a melhor aproximação e diz qual é. */
export function desdeQuando(fase: Fase, o: Onb, senhaEnviada: Map<string, string>): { iso: string | null; base: string } {
  const rid = o.retailer_id != null ? String(o.retailer_id) : ''
  switch (fase) {
    case 'formulario': case 'biometria': case 'biometria_negada':
      return { iso: o.created_at ?? null, base: 'desde o pré-cadastro' }
    case 'aguardando_aiva':
      return { iso: o.updated_at ?? o.created_at ?? null, base: 'desde a última atualização no portal' }
    case 'sem_senha':
      return { iso: o.retailer_registered_at ?? o.updated_at ?? null, base: 'desde a criação da loja' }
    case 'sem_movimento':
      return { iso: senhaEnviada.get(rid) ?? o.retailer_registered_at ?? null, base: 'desde o envio da senha' }
    default:
      return { iso: null, base: '' }
  }
}

// ─── saída ────────────────────────────────────────────────────────────────────
export type Loja = {
  cnpj: string
  loja: string
  socio: string | null
  telefone: string | null
  fase: Fase
  dias: number | null
  lead: LeadRef | null
  rid: string | null
  detalhe: string | null
}

export type ResumoFase = { fase: Fase; qtd: number; mediana: number | null; maisAntigo: number | null; base: string }

export type Acao = {
  chave: string
  titulo: string
  oQueFazer: string
  quem: 'lojista' | 'aiva' | 'track'
  gravidade: 'alta' | 'media'
  lojas: Loja[]
}

export type Semana = { inicio: string; preCadastros: number; lojasCriadas: number }

export type Desempenho = {
  mesAtual: string
  mesAnterior: string
  lojasComVendaMes: number
  lojasComVendaMesAnt: number
  vendasMes: number
  vendasMesAnt: number
  valorMes: number
  consultasMes: number
  aprovadosMes: number
  top: Array<{ nome: string; cnpj: string; vendas: number; valor: number }>
}

export type EtapaEvo = { id: number; nome: string; cor: string; qtd: number }

export type Painel = {
  total: number
  fases: ResumoFase[]
  lojas: Loja[]
  acoes: Acao[]
  semanas: Semana[]
  desempenho: Desempenho
  cnpjProblema: Loja[]
  evo: { etapas: EtapaEvo[]; totalCards: number; atrasados: Array<Loja & { etapaCard: number; etapaEsperada: number }> }
}

/** Etapas do funil 15 — nomes, cores e ORDEM tirados do MCP da Evo em 24/09/2026
 *  (pipeline_stages_list + pipelines_get.stageorders). As 4 últimas são laterais. */
export const ETAPAS_EVO: ReadonlyArray<{ id: number; nome: string; cor: string }> = [
  { id: 66, nome: 'Início', cor: '#06c270' },
  { id: 47, nome: 'Interessado', cor: '#0081cf' },
  { id: 53, nome: 'Interessado (sem resposta)', cor: '#ff3b3b' },
  { id: 54, nome: 'Pré Aprovação', cor: '#06c270' },
  { id: 49, nome: 'Cadastro Recebido', cor: '#0081cf' },
  { id: 50, nome: 'Em Análise AIVA', cor: '#ff3b3b' },
  { id: 70, nome: 'Treinar', cor: '#06c270' },
  { id: 71, nome: 'Login', cor: '#06c270' },
  { id: 51, nome: 'Loja Finalizada e Vendendo', cor: '#ff3b3b' },
  { id: 69, nome: 'Bot Detectado', cor: '#06c270' },
  { id: 93, nome: 'Lojas menos de 01 Ano', cor: '#06c270' },
  { id: 94, nome: 'CNPJ Irregular na Receita', cor: '#ff3b3b' },
  { id: 95, nome: 'Loja Descartada pela Aiva', cor: '#06c270' },
]
/** Posição na linha principal do funil. Laterais ficam fora (não se compara). */
const ORDEM_EVO: Record<number, number> = { 66: 0, 47: 1, 53: 1, 54: 2, 49: 3, 50: 4, 70: 5, 71: 6, 51: 7 }
/** Etapa do Evo que corresponde a cada fase do portal (o que o espelho faria). */
const ETAPA_DA_FASE: Partial<Record<Fase, number>> = {
  formulario: 50, biometria: 50, biometria_negada: 50, aguardando_aiva: 50,
  sem_senha: 70, sem_movimento: 71, consultando: 71, vendendo: 51, parou: 51,
}

function mediana(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/** Segunda-feira (BRT) da semana de uma data, 'YYYY-MM-DD'. */
export function segundaDaSemana(ms: number): string {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ms)) + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7   // seg=0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

export function montarPainel(e: Entradas, etapasEvoQtd: Map<number, number>): Painel {
  const mesAtual = mesBrt(e.agora)
  const ant = mesAnterior(mesAtual)
  const mov = movimentoPorCnpj(e.perf, e.onbs, mesAtual)

  // um CNPJ = uma loja. O portal às vezes repete o CNPJ (recadastro): fica o mais recente.
  const porCnpj = new Map<string, Onb>()
  for (const o of e.onbs) {
    const c = soDigitos(o.cnpj)
    if (c.length !== 14) continue
    const atual = porCnpj.get(c)
    if (!atual || String(o.created_at ?? '') > String(atual.created_at ?? '')) porCnpj.set(c, o)
  }

  const lojas: Loja[] = []
  for (const [c, o] of porCnpj) {
    const m = mov.get(c)
    const fase = faseDe(o, m, e.senhaEnviada)
    const { iso } = desdeQuando(fase, o, e.senhaEnviada)
    const rid = o.retailer_id != null && String(o.retailer_id) !== '' ? String(o.retailer_id) : null
    lojas.push({
      cnpj: c,
      loja: (o.legal_name ?? '').trim() || e.leadPorCnpj.get(c)?.nome || `CNPJ ${c}`,
      socio: o.partner_owner_name ?? null,
      telefone: soDigitos(o.phone_number) || null,
      fase,
      dias: diasDesde(iso, e.agora),
      lead: e.leadPorCnpj.get(c) ?? null,
      rid,
      detalhe: null,
    })
  }

  // Loja que só existe no DESEMPENHO (cadastrada antes da API de onboardings, ou por
  // outro caminho): sem ela a estação "Vendendo" mostraria menos lojas que o portal.
  const semCadastro = new Map<string, { nome: string; rid: string | null }>()
  for (const p of e.perf) {
    const c = soDigitos(p.cnpj)
    if (c.length !== 14 || porCnpj.has(c) || semCadastro.has(c)) continue
    semCadastro.set(c, { nome: nomeDoSlug(p.retailer_name), rid: p.retailer_id != null ? String(p.retailer_id) : null })
  }
  for (const [c, x] of semCadastro) {
    const fase = faseDe({ retailer_id: x.rid }, mov.get(c), e.senhaEnviada)
    lojas.push({
      cnpj: c, loja: x.nome || e.leadPorCnpj.get(c)?.nome || `CNPJ ${c}`, socio: null, telefone: null,
      fase, dias: diasDesde(fase === 'sem_movimento' && x.rid ? e.senhaEnviada.get(x.rid) : null, e.agora),
      lead: e.leadPorCnpj.get(c) ?? null, rid: x.rid, detalhe: 'só no desempenho (sem cadastro na API)',
    })
  }

  // resumo por fase
  const fases: ResumoFase[] = ([...JORNADA, ...SAIDAS] as Fase[]).map((f) => {
    const doGrupo = lojas.filter((l) => l.fase === f)
    const idades = doGrupo.map((l) => l.dias).filter((d): d is number => d !== null)
    return {
      fase: f, qtd: doGrupo.length, mediana: mediana(idades),
      maisAntigo: idades.length ? Math.max(...idades) : null,
      base: desdeQuando(f, {}, e.senhaEnviada).base,
    }
  })

  // ── a fila do Nei: o que precisa de alguém AGORA ─────────────────────────────
  const ordenar = (xs: Loja[]) => xs.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))
  const acoes: Acao[] = [
    {
      chave: 'aguardando_aiva', quem: 'aiva', gravidade: 'alta',
      titulo: 'A AIVA não criou a loja',
      oQueFazer: 'O lojista fez tudo, inclusive a selfie. Cobrar o Eduardo pra criar a loja — o lojista não tem nada a fazer.',
      lojas: ordenar(lojas.filter((l) => l.fase === 'aguardando_aiva' && (l.dias ?? 0) >= 1)),
    },
    {
      chave: 'sem_senha', quem: 'aiva', gravidade: 'alta',
      titulo: 'Loja criada e nenhuma senha registrada',
      oQueFazer: 'A loja existe, mas o portal não registra envio da senha do sócio e ela nunca consultou. Com pedido feito: cobrar a AIVA. Sem pedido: pedir o acesso no painel da AIVA.',
      lojas: ordenar(lojas.filter((l) => l.fase === 'sem_senha' && (l.dias ?? 0) >= 2)).map((l) => {
        const pedido = l.rid ? e.senhaPedida.get(l.rid) : null
        return { ...l, detalhe: pedido ? `pedida há ${diasDesde(pedido, e.agora)} dia(s)` : 'sem pedido de senha registrado' }
      }),
    },
    {
      chave: 'biometria_negada', quem: 'lojista', gravidade: 'alta',
      titulo: 'Selfie negada',
      oQueFazer: 'A AIVA recusou a biometria. Orientar o lojista a refazer SÓ a selfie, pelo mesmo link.',
      lojas: ordenar(lojas.filter((l) => l.fase === 'biometria_negada')),
    },
    {
      chave: 'sem_movimento', quem: 'track', gravidade: 'media',
      titulo: 'Tem senha há mais de 7 dias e nunca consultou',
      oQueFazer: 'O acesso chegou e a loja não fez nenhuma consulta de crédito. Ligar: costuma ser falta de treinamento ou senha perdida.',
      lojas: ordenar(lojas.filter((l) => l.fase === 'sem_movimento' && (l.dias ?? 0) >= 7)),
    },
    {
      chave: 'parou', quem: 'track', gravidade: 'media',
      titulo: 'Vendia e parou',
      oQueFazer: `Vendeu antes, mas nada em ${mesAtual.slice(5)}/${mesAtual.slice(0, 4)} nem no mês anterior. Entender o motivo antes que vire perda.`,
      lojas: lojas.filter((l) => l.fase === 'parou').map((l) => {
        const u = mov.get(l.cnpj)?.ultimoMesComVenda
        return { ...l, detalhe: u ? `última venda em ${u.slice(5)}/${u.slice(0, 4)}` : null }
      }).sort((a, b) => String(b.detalhe).localeCompare(String(a.detalhe))),
    },
    {
      chave: 'formulario_parado', quem: 'lojista', gravidade: 'media',
      titulo: 'Formulário do varejo parado há mais de 14 dias',
      oQueFazer: 'A cobrança automática já tocou esses lojistas. Se ainda assim não andou, vale uma ligação ou decidir o descarte.',
      lojas: ordenar(lojas.filter((l) => l.fase === 'formulario' && (l.dias ?? 0) > 14)),
    },
  ]

  // CNPJ com problema na Receita, segundo a checagem da própria AIVA
  const RUINS = new Set(['invalid', 'not_found', 'inapta', 'baixada', 'suspensa'])
  const cnpjProblema: Loja[] = []
  for (const [c, o] of porCnpj) {
    const st = String(o.cnpj_check_status ?? '').toLowerCase()
    if (!RUINS.has(st)) continue
    const l = lojas.find((x) => x.cnpj === c)
    if (l) cnpjProblema.push({ ...l, detalhe: st === 'invalid' ? 'dígito verificador inválido' : st === 'not_found' ? 'não consta na Receita' : `${st.toUpperCase()} na Receita` })
  }
  // quem vende com CNPJ errado vem primeiro: é o que pode travar repasse
  cnpjProblema.sort((a, b) => Number(b.fase === 'vendendo') - Number(a.fase === 'vendendo'))

  // ── ritmo semanal (8 semanas) ──────────────────────────────────────────────
  const semanas: Semana[] = []
  for (let i = 7; i >= 0; i--) semanas.push({ inicio: segundaDaSemana(e.agora - i * 7 * DIA_MS), preCadastros: 0, lojasCriadas: 0 })
  const idx = new Map(semanas.map((s, i) => [s.inicio, i]))
  for (const o of porCnpj.values()) {
    const tC = o.created_at ? Date.parse(o.created_at) : NaN
    if (Number.isFinite(tC)) { const i = idx.get(segundaDaSemana(tC)); if (i !== undefined) semanas[i].preCadastros++ }
    const tR = o.retailer_registered_at ? Date.parse(o.retailer_registered_at) : NaN
    if (Number.isFinite(tR)) { const i = idx.get(segundaDaSemana(tR)); if (i !== undefined) semanas[i].lojasCriadas++ }
  }

  // ── desempenho do mês (todas as lojas da Track no portal, não só as do cadastro) ──
  const doMes = e.perf.filter((p) => String(p.mes).slice(0, 7) === mesAtual)
  const doAnt = e.perf.filter((p) => String(p.mes).slice(0, 7) === ant)
  const topMap = new Map<string, { nome: string; cnpj: string; vendas: number; valor: number }>()
  for (const p of doMes) {
    const v = num(p.n_vendas)
    if (!v) continue
    const k = soDigitos(p.cnpj) || String(p.retailer_id)
    const onb = porCnpj.get(soDigitos(p.cnpj))
    const a = topMap.get(k) ?? { nome: (onb?.legal_name ?? '').trim() || nomeDoSlug(p.retailer_name) || k, cnpj: soDigitos(p.cnpj), vendas: 0, valor: 0 }
    a.vendas += v
    a.valor += num(p.valor_vendas)
    topMap.set(k, a)
  }
  const desempenho: Desempenho = {
    mesAtual, mesAnterior: ant,
    lojasComVendaMes: new Set(doMes.filter((p) => num(p.n_vendas) > 0).map((p) => String(p.retailer_id))).size,
    lojasComVendaMesAnt: new Set(doAnt.filter((p) => num(p.n_vendas) > 0).map((p) => String(p.retailer_id))).size,
    vendasMes: doMes.reduce((a, p) => a + num(p.n_vendas), 0),
    vendasMesAnt: doAnt.reduce((a, p) => a + num(p.n_vendas), 0),
    valorMes: doMes.reduce((a, p) => a + num(p.valor_vendas), 0),
    consultasMes: doMes.reduce((a, p) => a + num(p.n_consultas), 0),
    aprovadosMes: doMes.reduce((a, p) => a + num(p.n_aprovados), 0),
    top: [...topMap.values()].sort((a, b) => b.vendas - a.vendas || b.valor - a.valor).slice(0, 10),
  }

  // ── Evo: retrato do funil 15 e cards atrasados em relação ao portal ────────
  const etapas: EtapaEvo[] = ETAPAS_EVO.map((s) => ({ ...s, qtd: etapasEvoQtd.get(s.id) ?? 0 }))
  const atrasados: Painel['evo']['atrasados'] = []
  for (const l of lojas) {
    const esperada = ETAPA_DA_FASE[l.fase]
    const opp = l.lead?.opp
    if (esperada == null || opp == null) continue
    const atual = e.stagePorOpp.get(opp)
    if (atual == null || ORDEM_EVO[atual] === undefined) continue   // lateral ou fora do funil
    if (ORDEM_EVO[atual] < ORDEM_EVO[esperada]) atrasados.push({ ...l, etapaCard: atual, etapaEsperada: esperada })
  }
  atrasados.sort((a, b) => (ORDEM_EVO[b.etapaEsperada] - ORDEM_EVO[b.etapaCard]) - (ORDEM_EVO[a.etapaEsperada] - ORDEM_EVO[a.etapaCard]))

  return {
    total: lojas.length, fases, lojas, acoes, semanas, desempenho, cnpjProblema,
    evo: { etapas, totalCards: [...etapasEvoQtd.values()].reduce((a, b) => a + b, 0), atrasados },
  }
}
