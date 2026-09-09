/**
 * Derivações do Portal Parceiros AIVA (spec 2026-09-09) — SÓ funções puras.
 *
 * ⚠️ Sem imports (nem "@/…"): este arquivo roda direto no `node --test` com
 * type stripping, fora do bundler do Next. Tudo que toca banco/rede fica em
 * lib/portal-aiva.ts.
 *
 * Datas são strings YYYY-MM-DD e a aritmética é feita em UTC de propósito —
 * uma data de calendário não tem fuso; converter pra Date local no Windows
 * dava dia errado (lição das rotinas de follow-up).
 */

export type LinhaDiaria = {
  data_ref: string        // YYYY-MM-DD (retrato "até este dia")
  retailer_id: string
  mes: string             // YYYY-MM-01
  cnpj: string
  nome_varejo: string | null
  consultas: number       // acumulados do mês naquele dia
  aprovados: number
  vendas: number
  valor_vendas: number
  inadimplencia_aiva: number | null
  inadimplencia_odres: number | null
  foto_fora_pct: number | null
  status: string | null   // Ativo / Inativo
  cadastro_em: string | null
}

export type Metricas = { consultas: number; aprovados: number; vendas: number; valor_vendas: number }
// congelado — é reusado via spread (`{ ...ZERO }`) em vários pontos; um `delta[k] +=`
// acidental direto no objeto exportado corromperia todo mundo que importa ZERO depois (revisão 09/09)
export const ZERO: Metricas = Object.freeze({ consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 })

const utc = (d: string) => new Date(d + 'T00:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)

export function somarDias(data: string, dias: number): string {
  const d = utc(data)
  d.setUTCDate(d.getUTCDate() + dias)
  return iso(d)
}

/** Primeiro dia do mês da data, no formato do portal (YYYY-MM-01). */
export function mesDe(data: string): string {
  return data.slice(0, 7) + '-01'
}

export function ultimoDiaDoMes(data: string): string {
  const d = utc(mesDe(data))
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return iso(d)
}

/** Dias inteiros entre duas datas (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86400e3)
}

/**
 * Acumulado do mês ("month-to-date") de uma loja até a data: o retrato mais
 * recente com data_ref <= data para aquele mês. Sem retrato = zeros (mês ainda
 * não começou, ou a loja não existia).
 */
// perf: varredura linear de propósito — ~250 ms pra 220 lojas × 60 retratos (medido 09/09);
// indexar só se a base passar de ~1.000 lojas.
export function mtdEm(serie: LinhaDiaria[], retailerId: string, mes: string, data: string): Metricas {
  let melhor: LinhaDiaria | null = null
  for (const l of serie) {
    if (l.retailer_id !== retailerId || l.mes !== mes || l.data_ref > data) continue
    if (!melhor || l.data_ref > melhor.data_ref) melhor = l
  }
  if (!melhor) return { ...ZERO }
  return { consultas: melhor.consultas, aprovados: melhor.aprovados, vendas: melhor.vendas, valor_vendas: Number(melhor.valor_vendas) }
}

export type Atencao = 'novo_sem_engajamento' | 'baixa_performance' | null

/**
 * Espelha a aba "Precisam de atenção" do portal, com a nossa série:
 * - novo sem engajamento: cadastrado há 8–29 dias, sem venda e com no máximo 3
 *   aprovados desde o cadastro (o portal fala em "baixíssima atividade" sem dar
 *   o número; 3 é o que a lista dele mostra na prática — decisão 09/09).
 * - baixa performance: cadastrado há 30+ dias (ou data desconhecida) e sem
 *   venda nos últimos 30 dias.
 */
export function classificarAtencao(p: {
  cadastro: string | null
  hoje: string
  vendasDesdeCadastro: number
  aprovadosDesdeCadastro: number
  vendas30d: number
}): Atencao {
  const dias = p.cadastro ? diasEntre(p.cadastro, p.hoje) : Infinity
  if (dias < 8) return null
  if (dias <= 29) {
    return p.vendasDesdeCadastro === 0 && p.aprovadosDesdeCadastro <= 3 ? 'novo_sem_engajamento' : null
  }
  return p.vendas30d === 0 ? 'baixa_performance' : null
}

export type LinhaMensal = {
  mes: string               // YYYY-MM (formato da aiva_desempenho)
  cnpj: string
  nome_varejo: string | null
  loja: string | null
  rid: string | null
  status_portal: string | null
  consultas: number
  aprovados: number
  vendas: number
  valor_vendas: number
  conversao: number
  ticket_medio: number | null
  inadimplencia_aiva: number | null
  inadimplencia_odres: number | null
  foto_fora_pct: number | null
  cadastro_em: string | null
  atencao: Atencao
  sem_venda: boolean
  sem_consulta: boolean
  // colunas do Data Studio que continuam na tabela — sempre nulas/false agora
  uf: null; cidade: null; status_consulta: null; sem_operador: false; telefone: null; qtd_operadores: null
}

const maxNulo = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b))
const minData = (a: string | null, b: string | null) => (a == null ? b : b == null ? a : a < b ? a : b)

/**
 * Vendas de uma loja nos últimos 30 dias até `hoje`, pela série: acumulado do
 * mês corrente + (acumulado final do mês anterior − acumulado do mês anterior
 * em hoje−30). Sem retrato antigo o mês anterior entra inteiro — é a
 * aproximação "mês corrente + anterior" da spec, que some sozinha quando a
 * série tiver 30 dias.
 */
function vendas30d(serie: LinhaDiaria[], retailerId: string, hoje: string): number {
  const mesAtual = mesDe(hoje)
  const mesAnt = mesDe(somarDias(mesAtual, -1))
  const inicioJanela = somarDias(hoje, -30)
  const atual = mtdEm(serie, retailerId, mesAtual, hoje).vendas
  if (inicioJanela >= mesAtual) return atual
  const fimAnt = mtdEm(serie, retailerId, mesAnt, ultimoDiaDoMes(mesAnt)).vendas
  const inicioAnt = mtdEm(serie, retailerId, mesAnt, inicioJanela).vendas
  return atual + Math.max(0, fimAnt - inicioAnt)
}

/**
 * Uma linha por CNPJ pra aiva_desempenho, a partir do ÚLTIMO retrato do mês.
 * Agrega multi-lojas do mesmo CNPJ (Multicell Loja 1/2/3): soma métricas, fica
 * o nome/RID da loja que mais vendeu, Ativo se qualquer loja está ativa,
 * inadimplência = a maior, cadastro = o mais antigo.
 *
 * `primeiraAparicao`: retailer_id → primeiro data_ref na série inteira (quem
 * chama lê do banco). É o cadastro quando o portal não expõe a coluna.
 */
export function agregarMensal(
  serie: LinhaDiaria[],
  mes: string,
  hoje: string,
  primeiraAparicao: Map<string, string>,
): LinhaMensal[] {
  const doMes = serie.filter((l) => l.mes === mes)
  if (!doMes.length) return []
  const ultimo = doMes.reduce((m, l) => (l.data_ref > m ? l.data_ref : m), doMes[0].data_ref)
  const retrato = doMes.filter((l) => l.data_ref === ultimo)
  // `mes` pode ser um mês já fechado sendo rederivado num backfill rodando hoje — nesse caso
  // "hoje" (a data real da chamada) não pode entrar no cálculo de vendas30d/atenção, senão
  // vendas de meses seguintes vazam pra classificação de um mês que já fechou (revisão 09/09)
  const ref = hoje < ultimoDiaDoMes(mes) ? hoje : ultimoDiaDoMes(mes)
  // backfill legado: todo mês antigo carrega o MESMO data_ref (ontem), então o "retrato" do
  // mês pode cair DEPOIS do próprio mês ter terminado. Nesse caso `ref` (travado no fim do
  // mês) fica antes de `ultimo`, mtdEm/vendas30d não enxergam nenhum ponto dentro da janela e
  // todo mundo vira baixa_performance à toa — sem sinal real de inatividade. Não classifica
  // (revisão final 09/09).
  const semAtencao = ultimo > ultimoDiaDoMes(mes)

  type Acc = LinhaMensal & {
    _maisVendas: number; _aprovDesdeCad: number; _vendasDesdeCad: number; _vendas30d: number
    // cadastro real (coluna do portal) e cadastro inferido (primeira aparição na série) ficam
    // separados até o fim: um cadastro real de QUALQUER loja do CNPJ vence a inferência de outra
    // loja do mesmo grupo — senão uma Multicell 2 com cadastro real perdia pra Multicell 1 sem
    // coluna (cuja "primeira aparição" pode ser bem mais antiga que o cadastro de verdade).
    _cadReal: string | null; _cadFallback: string | null
  }
  const porCnpj = new Map<string, Acc>()
  for (const l of retrato) {
    const cadastroReal = l.cadastro_em ?? null
    const cadastroFallback = primeiraAparicao.get(l.retailer_id) ?? null
    // "desde o cadastro" pra lojas novas (≤ 29 dias) cabe em mês atual + anterior
    const mesAnt = mesDe(somarDias(mes, -1))
    const ant = mtdEm(serie, l.retailer_id, mesAnt, ultimoDiaDoMes(mesAnt))
    const acc = porCnpj.get(l.cnpj)
    if (!acc) {
      porCnpj.set(l.cnpj, {
        mes: mes.slice(0, 7), cnpj: l.cnpj, nome_varejo: l.nome_varejo, loja: l.nome_varejo, rid: l.retailer_id,
        status_portal: l.status, consultas: l.consultas, aprovados: l.aprovados, vendas: l.vendas, valor_vendas: Number(l.valor_vendas),
        conversao: 0, ticket_medio: null,
        inadimplencia_aiva: l.inadimplencia_aiva, inadimplencia_odres: l.inadimplencia_odres, foto_fora_pct: l.foto_fora_pct,
        cadastro_em: null, atencao: null, sem_venda: false, sem_consulta: false,
        uf: null, cidade: null, status_consulta: null, sem_operador: false, telefone: null, qtd_operadores: null,
        _maisVendas: l.vendas, _aprovDesdeCad: l.aprovados + ant.aprovados, _vendasDesdeCad: l.vendas + ant.vendas,
        _vendas30d: vendas30d(serie, l.retailer_id, ref), _cadReal: cadastroReal, _cadFallback: cadastroFallback,
      })
      continue
    }
    acc.consultas += l.consultas
    acc.aprovados += l.aprovados
    acc.vendas += l.vendas
    acc.valor_vendas += Number(l.valor_vendas)
    if (l.vendas > acc._maisVendas) { acc._maisVendas = l.vendas; acc.loja = l.nome_varejo; acc.rid = l.retailer_id }
    if (l.status === 'Ativo') acc.status_portal = 'Ativo'
    acc.inadimplencia_aiva = maxNulo(acc.inadimplencia_aiva, l.inadimplencia_aiva)
    acc.inadimplencia_odres = maxNulo(acc.inadimplencia_odres, l.inadimplencia_odres)
    acc.foto_fora_pct = maxNulo(acc.foto_fora_pct, l.foto_fora_pct)
    acc._cadReal = minData(acc._cadReal, cadastroReal)
    acc._cadFallback = minData(acc._cadFallback, cadastroFallback)
    acc._aprovDesdeCad += l.aprovados + ant.aprovados
    acc._vendasDesdeCad += l.vendas + ant.vendas
    acc._vendas30d += vendas30d(serie, l.retailer_id, ref)
  }

  return [...porCnpj.values()].map(({ _maisVendas, _aprovDesdeCad, _vendasDesdeCad, _vendas30d, _cadReal, _cadFallback, ...r }) => {
    const cadastro_em = _cadReal ?? _cadFallback
    return {
      ...r,
      cadastro_em,
      conversao: r.aprovados > 0 ? r.vendas / r.aprovados : 0,
      ticket_medio: r.vendas > 0 ? r.valor_vendas / r.vendas : null,
      sem_venda: r.vendas === 0,
      sem_consulta: r.consultas === 0,
      atencao: semAtencao ? null : classificarAtencao({ cadastro: cadastro_em, hoje: ref, vendasDesdeCadastro: _vendasDesdeCad, aprovadosDesdeCadastro: _aprovDesdeCad, vendas30d: _vendas30d }),
      valor_vendas: Number(r.valor_vendas.toFixed(2)), // acumulação em float — arredonda só no retorno
    }
  })
}

export type LinhaSemanal = {
  semana: string          // segunda-feira YYYY-MM-DD
  cnpj: string
  rid: string | null
  nome_varejo: string | null
  loja: string | null
  uf: null
  cidade: null
  consultas: number       // não existe na tabela semanal — usado só pro filtro de inclusão
  aprovados: number
  vendas: number
  valor_vendas: number
}

const chaves: (keyof Metricas)[] = ['consultas', 'aprovados', 'vendas', 'valor_vendas']

/**
 * Semana fechada (segunda a domingo) a partir dos acumulados do mês:
 *   semana = MTD(domingo) − MTD(domingo − 7)
 * Semana que cruza mês: [MTD(último dia do mês antigo) − MTD(dom−7)] + MTD(dom, mês novo).
 *
 * Ponto final: o retrato de domingo; se a coleta de segunda falhou, aceita o
 * retrato de segunda (aviso — inclui a segunda-feira) ; sem nenhum dos dois,
 * erro — sem ponto final não existe semana.
 *
 * Delta negativo (AIVA cancelou/reprocessou contrato) vira 0 e entra em
 * `avisos` — nunca chega a mensagem pro lojista.
 *
 * Quem entra: loja com consultas/aprovados/vendas > 0 na semana OU vendas > 0
 * na semana anterior (`vendasSemanaAnterior`, por CNPJ, lido de
 * aiva_desempenho_semanal) — preserva o segmento C "queda" do pulso e o
 * comportamento do Data Studio, que só listava quem teve atividade.
 */
export function derivarSemana(
  serie: LinhaDiaria[],
  segunda: string,
  vendasSemanaAnterior: Map<string, number>,
): { linhas: LinhaSemanal[]; avisos: string[] } {
  if (new Date(segunda + 'T12:00:00Z').getUTCDay() !== 1) throw new Error(`${segunda} não é segunda-feira`)
  const avisos: string[] = []
  const domingo = somarDias(segunda, 6)
  const domAnt = somarDias(segunda, -1)
  const temRetrato = (d: string) => serie.some((l) => l.data_ref === d)
  let fim = domingo
  if (!temRetrato(domingo)) {
    if (!temRetrato(somarDias(domingo, 1))) throw new Error(`sem retrato de ${domingo} nem de ${somarDias(domingo, 1)} — não dá pra fechar a semana ${segunda}`)
    fim = somarDias(domingo, 1)
    avisos.push(`sem retrato de domingo ${domingo}; usando o de segunda ${fim} (inclui a segunda-feira)`)
  }
  // a baseline (início da semana) precisa espelhar a MESMA regra de fallback do fim: se o
  // domingo anterior não tem retrato, a semana anterior já fechou usando a segunda seguinte
  // (que é ESTA `segunda`) como ponto final dela — usar `domAnt` aqui de novo faria o trecho
  // sábado→segunda entrar contado nas duas semanas (revisão 09/09)
  const inicio = temRetrato(domAnt) ? domAnt : (temRetrato(segunda) ? segunda : domAnt)
  const meses = [...new Set([mesDe(segunda), mesDe(domingo)])]

  // mantém o retrato MAIS RECENTE por loja (cnpj/nome_varejo atualizados), não o primeiro
  // que aparecer — a ordem de chegada da série (ordem de query) não pode decidir a identidade
  // da loja (revisão 09/09)
  const porRetailer = new Map<string, LinhaDiaria>()
  for (const l of serie) {
    const cur = porRetailer.get(l.retailer_id)
    if (!cur || l.data_ref > cur.data_ref) porRetailer.set(l.retailer_id, l)
  }

  type Acc = LinhaSemanal & { _maisVendas: number }
  const porCnpj = new Map<string, Acc>()
  for (const [rid, info] of porRetailer) {
    const delta: Metricas = { ...ZERO }
    for (const mes of meses) {
      // mês fechado (mes !== mesDe(fim)) tem MTD congelado — usar `fim` (o retrato mais
      // recente que a série tem) em vez de exigir data_ref no último dia exato do mês antigo;
      // um só dia de coleta falha e o rabo do mês fechado se perdia pra sempre (revisão 09/09)
      const a = mtdEm(serie, rid, mes, fim)
      const b = mtdEm(serie, rid, mes, inicio)
      // um único aviso por loja/mês, mesmo que mais de uma métrica tenha caído junto
      // (ex.: AIVA cancela uma venda → vendas E valor_vendas ficam negativos na mesma hora)
      const negativos: string[] = []
      for (const k of chaves) {
        const d = a[k] - b[k]
        if (d < 0) { negativos.push(`${k} (${b[k]} → ${a[k]})`); continue }
        delta[k] += d
      }
      if (negativos.length) avisos.push(`${info.nome_varejo ?? rid} (${rid}): ${negativos.join(', ')} negativo em ${mes}; zerado`)
    }
    const acc = porCnpj.get(info.cnpj)
    if (!acc) {
      porCnpj.set(info.cnpj, { semana: segunda, cnpj: info.cnpj, rid, nome_varejo: info.nome_varejo, loja: info.nome_varejo, uf: null, cidade: null, ...delta, _maisVendas: delta.vendas })
      continue
    }
    for (const k of chaves) acc[k] += delta[k]
    if (delta.vendas > acc._maisVendas) { acc._maisVendas = delta.vendas; acc.rid = rid; acc.loja = info.nome_varejo }
  }

  const linhas = [...porCnpj.values()]
    .filter((l) => l.consultas > 0 || l.aprovados > 0 || l.vendas > 0 || (vendasSemanaAnterior.get(l.cnpj) ?? 0) > 0)
    .map(({ _maisVendas, ...l }) => ({ ...l, valor_vendas: Number(l.valor_vendas.toFixed(2)) })) // acumulação em float — arredonda só no retorno
  return { linhas, avisos }
}
