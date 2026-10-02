/**
 * desempenho-loja-calc.ts — os números da loja no portal da AIVA, resumidos pra VictorIA
 * (conversa) e pra rotina de dicas (Aldo 02/10/2026). Parte PURA; IO em lib/desempenho-loja.ts.
 *
 * Fontes: aiva_desempenho_semanal (semana = segunda, fecha toda segunda pelo cron portal-aiva;
 * semana SEM linha = semana sem atividade, a derivação só grava quem consultou/aprovou/vendeu)
 * e aiva_desempenho (mês corrente, com consultas — a semanal não tem consultas).
 * Lead com vários CNPJs: tudo é SOMADO (o lojista pensa na operação dele, não no CNPJ).
 */

export type LinhaSemana = { semana: string; aprovados: number; vendas: number; valor_vendas: number }
export type LinhaMes = { mes: string; consultas: number; aprovados: number; vendas: number; valor_vendas: number }

export type Segmento = 'vende_firme' | 'vende_pouco' | 'aprova_nao_vende' | 'parou' | 'sem_uso'

export type Resumo = {
  segmento: Segmento
  semanas: LinhaSemana[]          // últimas semanas fechadas, mais recente primeiro (com zeros preenchidos)
  vendas2: number                 // vendas das 2 últimas semanas fechadas
  aprovados2: number
  vendasTotal: number             // tudo que temos (semanas + meses)
  mes: LinhaMes | null            // mês corrente (parcial)
  mesAnterior: LinhaMes | null
}

/** Quantas semanas fechadas a VictorIA enxerga. */
export const SEMANAS_JANELA = 4

const num = (v: unknown) => Number(v ?? 0) || 0

export function somarSemanas(linhas: LinhaSemana[]): LinhaSemana[] {
  const m = new Map<string, LinhaSemana>()
  for (const l of linhas) {
    const a = m.get(l.semana) ?? { semana: l.semana, aprovados: 0, vendas: 0, valor_vendas: 0 }
    a.aprovados += num(l.aprovados); a.vendas += num(l.vendas); a.valor_vendas += num(l.valor_vendas)
    m.set(l.semana, a)
  }
  return [...m.values()]
}

export function somarMeses(linhas: LinhaMes[]): LinhaMes[] {
  const m = new Map<string, LinhaMes>()
  for (const l of linhas) {
    const a = m.get(l.mes) ?? { mes: l.mes, consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 }
    a.consultas += num(l.consultas); a.aprovados += num(l.aprovados); a.vendas += num(l.vendas); a.valor_vendas += num(l.valor_vendas)
    m.set(l.mes, a)
  }
  return [...m.values()]
}

function menosDias(isoDia: string, dias: number): string {
  const d = new Date(isoDia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

/**
 * @param ultimaSemanaFechada segunda-feira da última semana fechada NA TABELA (não a da loja):
 *        é ela que diz "semana sem linha = zero". Sem isso, loja parada há 3 semanas pareceria
 *        estar vendendo (a linha mais recente dela seria a última).
 * @param mesCorrente YYYY-MM de hoje (BRT)
 */
export function resumir(
  semanasBrutas: LinhaSemana[],
  mesesBrutos: LinhaMes[],
  ultimaSemanaFechada: string,
  mesCorrente: string,
): Resumo {
  const porSemana = new Map(somarSemanas(semanasBrutas).map((s) => [s.semana, s]))
  const semanas: LinhaSemana[] = []
  for (let i = 0; i < SEMANAS_JANELA; i++) {
    const s = menosDias(ultimaSemanaFechada, 7 * i)
    semanas.push(porSemana.get(s) ?? { semana: s, aprovados: 0, vendas: 0, valor_vendas: 0 })
  }
  const meses = somarMeses(mesesBrutos)
  const mes = meses.find((m) => m.mes === mesCorrente) ?? null
  const [a, mm] = mesCorrente.split('-').map(Number)
  const ant = mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, '0')}`
  const mesAnterior = meses.find((m) => m.mes === ant) ?? null

  const vendas2 = semanas[0].vendas + semanas[1].vendas
  const aprovados2 = semanas[0].aprovados + semanas[1].aprovados
  const vendasTotal = Math.max(
    [...porSemana.values()].reduce((t, s) => t + s.vendas, 0),
    meses.reduce((t, m) => t + m.vendas, 0),
  )
  // o mês corrente conta também: venda feita nesta semana (ainda não fechada) não pode
  // deixar a loja como "parou"/"sem uso"
  const vendasRecentes = vendas2 + (mes?.vendas ?? 0)
  const aprovRecentes = aprovados2 + (mes?.aprovados ?? 0)

  let segmento: Segmento
  if (vendas2 >= 4) segmento = 'vende_firme'
  else if (vendasRecentes > 0) segmento = 'vende_pouco'
  else if (aprovRecentes > 0) segmento = 'aprova_nao_vende'
  else if (vendasTotal > 0) segmento = 'parou'
  else segmento = 'sem_uso'

  return { segmento, semanas, vendas2, aprovados2, vendasTotal, mes, mesAnterior }
}

/** Quem vende recebe dica toda semana; quem está parado, a cada 15 dias (Aldo 02/10). */
export function intervaloDias(seg: Segmento): number {
  return seg === 'parou' || seg === 'sem_uso' ? 14 : 7
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '—')

const LEITURA: Record<Segmento, string> = {
  vende_firme: 'loja vendendo com constância (4+ vendas nas 2 últimas semanas)',
  vende_pouco: 'loja vende, mas pouco',
  aprova_nao_vende: 'tem cliente APROVADO e não está fechando a venda — o gargalo é conversão no balcão',
  parou: 'já vendeu antes e parou (nada aprovado nem vendido nas 2 últimas semanas)',
  sem_uso: 'ainda não registrou venda nenhuma pela AIVA — o número NÃO mostra o que travou: pergunte uma vez o que travou (acesso? treinamento? cliente reprovando?), seção 2️⃣b LOJA QUE NUNCA OPEROU, em vez de mandar dica de venda',
}

/** Bloco dinâmico pro prompt (fora do cache). Números do PORTAL da AIVA, por semana fechada. */
export function blocoPrompt(r: Resumo): string {
  const consultasSemAprovacao = (r.mes?.consultas ?? 0) + (r.mesAnterior?.consultas ?? 0) > 0 &&
    (r.mes?.aprovados ?? 0) + (r.mesAnterior?.aprovados ?? 0) === 0
  const leitura = consultasSemAprovacao
    ? 'a loja CONSULTA mas nenhum cliente foi aprovado — o gargalo é aprovação: siga a OBJEÇÃO Nº1 (reprovação), não dica de conversão'
    : LEITURA[r.segmento]
  const linhasSem = r.semanas
    .map((s) => `  - semana de ${ddmm(s.semana)}: ${s.aprovados} aprovados · ${s.vendas} vendas · ${brl(s.valor_vendas)}`)
    .join('\n')
  const mesTxt = (m: LinhaMes | null, rot: string) =>
    m ? `- ${rot} (${m.mes}): ${m.consultas} consultas · ${m.aprovados} aprovados · ${m.vendas} vendas (${pct(m.vendas, m.aprovados)} dos aprovados) · ${brl(m.valor_vendas)}` : `- ${rot}: sem registro`
  return `
[INSTRUÇÃO DO SISTEMA — NÚMEROS DA LOJA NO PORTAL DA AIVA]
Leitura: ${leitura}.
Últimas semanas fechadas (segunda a domingo), somando todos os CNPJs do lojista:
${linhasSem}
${mesTxt(r.mesAnterior, 'Mês anterior')}
${mesTxt(r.mes, 'Mês atual até agora')}
Como usar:
- Use pra DIAGNOSTICAR e dar dica concreta quando o assunto for vendas, desempenho, "não está vendendo", aprovação ou consultas. Cite no máximo 1 ou 2 números, nunca a tabela inteira, e cite exatamente como estão aqui (sem arredondar pra faixa).
- Se a leitura acima já mostra o gargalo, diga isso e já dê a dica pra ele — não pergunte o que o número já responde.
- A dica segue as regras do produto: entrada de 25% na loja, AIVA em 6x, 9x ou 12x (parcelas da Odres seguem o bloco ODRES — não negue o que ele viu na tela), e é PROIBIDO escrever qualquer valor de parcela em reais, nem como exemplo. Nunca diga "sem entrada".
- Não invente meta nem média de mercado ("o normal é 50%", "a régua é X"): compare a loja só com ela mesma (semana fechada contra semana fechada). O mês atual é parcial: não diga que o ritmo caiu comparando poucos dias com o mês cheio.
- Os números vêm do portal da AIVA: as semanas fecham na segunda (a semana atual ainda não aparece nelas); a linha do mês atual vai até ontem.
- Se o lojista disser algo diferente, ACREDITE nele e não discuta número. Nunca invente número que não está aqui.
- Não abra a conversa com os números se ele falou de outro assunto.
`
}
