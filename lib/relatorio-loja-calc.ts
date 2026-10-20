/**
 * relatorio-loja-calc.ts — o RELATÓRIO SEMANAL da loja ativa na AIVA (Aldo 20/10/2026), no
 * formato do Farm Track da Parcelex: funil do mês, o que mudou na semana, quando saiu cada
 * aprovação e venda, onde a loja está travando e o que fazer esta semana. A rotina
 * /api/sdr/dicas-desempenho manda o HSM com a dica + o link /r/<token>; a página mostra isto.
 *
 * Só cálculo, sem banco — roda no `node --test` (npm run test:desempenho). Quem lê o banco e
 * monta o HTML é lib/relatorio-loja.ts.
 *
 * Fonte: aiva_portal_diario — retrato ACUMULADO NO MÊS, um por dia (data_ref = "até ontem").
 *   - "esta semana" = retrato mais recente menos o de ~7 dias antes, no MESMO mês (na virada do
 *     mês o acumulado zera e a conta daria negativa; mês novo compara com zero);
 *   - a data de cada aprovação/venda sai da diferença entre dois retratos seguidos.
 * Lead com vários CNPJs: os retratos do mesmo dia são SOMADOS (o lojista pensa na operação dele).
 *
 * ⚠️ Conteúdo só da AIVA (firewall Parcelex × AIVA): as dicas são as mesmas já aprovadas em
 * lib/dicas-desempenho-calc.ts e na OBJEÇÃO Nº1 do prompt. Fato novo passa pelo Aldo e pelo
 * revisor-prompt-victoria antes de entrar aqui.
 */
import type { Segmento } from './desempenho-loja-calc.ts'

export interface RetratoDia {
  data: string // YYYY-MM-DD (data_ref)
  consultas: number | null
  aprovados: number | null
  vendas: number | null
  valor_vendas: number | null
}

/** Onde a loja trava este mês. 'retomar' = já vendia e parou (segmento `parou`). */
export type Gargalo = 'consultar' | 'retomar' | 'aprovar' | 'fechar' | 'crescer'

export interface Evento { data: string; aprovacoes: number; vendas: number }

export interface MediaRede { aprovacao: number | null; conversao: number | null } // frações

export interface Diagnostico {
  data: string
  mes: string // "outubro"
  consultas: number; aprovados: number; vendas: number; valor: number
  txAprovacao: number | null // aprovados/consultas
  txConversao: number | null // vendas/aprovados
  semana: { desde: string; consultas: number; aprovados: number; vendas: number; valor: number }
  eventos: Evento[] // dias com aprovação ou venda nova, mais recente primeiro (até 6)
  gargalo: Gargalo
  titulo: string
  explicacao: string
  dicas: string[]
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const n = (v: number | null | undefined) => Number(v || 0)
const mesDe = (d: string) => d.slice(0, 7)
const plural = (q: number, um: string, muitos: string) => `${q} ${q === 1 ? um : muitos}`
export const pct = (f: number) => `${(f * 100).toFixed(0)}%`
export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
export const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** Soma os retratos de vários CNPJs do mesmo dia. */
export function somarPorDia(linhas: RetratoDia[]): RetratoDia[] {
  const m = new Map<string, RetratoDia>()
  for (const l of linhas) {
    const a = m.get(l.data) ?? { data: l.data, consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 }
    a.consultas = n(a.consultas) + n(l.consultas); a.aprovados = n(a.aprovados) + n(l.aprovados)
    a.vendas = n(a.vendas) + n(l.vendas); a.valor_vendas = n(a.valor_vendas) + n(l.valor_vendas)
    m.set(l.data, a)
  }
  return [...m.values()].sort((a, b) => a.data.localeCompare(b.data))
}

/** Até aqui a loja é "nova" (poucas consultas): vale o argumento da variância (OBJEÇÃO Nº1, item 0). */
export const POUCAS_CONSULTAS = 10

/**
 * O gargalo da página segue a MESMA leitura do bloco NÚMEROS DA LOJA (segmento das semanas fechadas),
 * refinada pelo mês: loja que vende não vira "nunca consultou" só porque o mês começou ontem, e a que
 * parou só sai de "retomar" quando volta a consultar (revisor 20/10/2026).
 */
export function gargaloDe(atual: RetratoDia, segmento: Segmento | null): Gargalo {
  const c = n(atual.consultas), a = n(atual.aprovados), v = n(atual.vendas)
  if (segmento === 'vende_firme' || segmento === 'vende_pouco') return 'crescer'
  if (segmento === 'aprova_nao_vende') return v > 0 ? 'crescer' : 'fechar'
  if (segmento === 'parou' && c === 0) return 'retomar'
  if (c === 0) return 'consultar'
  if (a === 0) return 'aprovar'
  if (v === 0) return 'fechar'
  return 'crescer'
}

/**
 * @param serie retratos diários da loja (já somados por dia; qualquer ordem, pode ter outros meses)
 * @param segmento leitura das semanas fechadas (desempenho-loja-calc), pra distinguir "nunca" de "parou"
 * @param rede taxas de todas as lojas no retrato mais recente
 */
export function diagnosticar(serie: RetratoDia[], segmento: Segmento | null, rede: MediaRede): Diagnostico | null {
  if (!serie.length) return null
  const ord = somarPorDia(serie)
  const atual = ord[ord.length - 1]
  const doMes = ord.filter((s) => mesDe(s.data) === mesDe(atual.data))

  const consultas = n(atual.consultas), aprovados = n(atual.aprovados), vendas = n(atual.vendas), valor = n(atual.valor_vendas)
  const txAprovacao = consultas > 0 ? aprovados / consultas : null
  const txConversao = aprovados > 0 ? vendas / aprovados : null

  // ~7 dias antes, no mesmo mês; mês que começou há menos de uma semana compara com zero
  const limite = new Date(Date.parse(`${atual.data}T12:00:00Z`) - 6.5 * 864e5).toISOString().slice(0, 10)
  const base = [...doMes].reverse().find((s) => s.data <= limite)
  const b = base ?? ({ data: `${mesDe(atual.data)}-01`, consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 } as RetratoDia)
  const semana = { desde: b.data, consultas: consultas - n(b.consultas), aprovados: aprovados - n(b.aprovados), vendas: vendas - n(b.vendas), valor: valor - n(b.valor_vendas) }

  const eventos: Evento[] = []
  for (let i = 0; i < doMes.length; i++) {
    const ant = i === 0 ? null : doMes[i - 1]
    const a = n(doMes[i].aprovados) - n(ant?.aprovados), v = n(doMes[i].vendas) - n(ant?.vendas)
    if (a > 0 || v > 0) eventos.push({ data: doMes[i].data, aprovacoes: Math.max(0, a), vendas: Math.max(0, v) })
  }
  eventos.reverse()

  const gargalo = gargaloDe(atual, segmento)
  const { titulo, explicacao, dicas } = textos(gargalo, { consultas, aprovados, vendas, txAprovacao, txConversao, rede })
  return { data: atual.data, mes: MESES[Number(atual.data.slice(5, 7)) - 1], consultas, aprovados, vendas, valor, txAprovacao, txConversao, semana, eventos: eventos.slice(0, 6), gargalo, titulo, explicacao, dicas }
}

// Dicas = fatos já aprovados (dicas-desempenho-calc.ts e OBJEÇÃO Nº1 do prompt). Nada novo aqui.
const DICA_CONSULTAR_TODOS = 'Consulte o CPF de TODO cliente que pedir parcelamento, sem pré-julgar — até quem diz que paga à vista. Quem consulta mais, aprova mais.'
const DICA_RISCO = 'O risco é 100% da AIVA: você recebe certinho, sem calote. Por isso ela é mais criteriosa — e o jeito de virar aprovação é volume.'
const DICA_VARIANCIA = 'As primeiras reprovações são normais: o lote de clientes não é previsível e não diz nada sobre a taxa real.'
const DICA_LIMITE = 'Venda DENTRO do limite aprovado: mostre o aparelho que cabe e fale da parcela, não do preço cheio. Dá pra completar com capa, película e fone.'
const DICA_ENTRADA = 'Deixe claro logo no começo que a entrada é de 25% — evita a desistência no final. Pergunte "prefere 9x ou 12x?" em vez de "quer levar?".'
const DICA_CEDO = 'Consulte o CPF logo no começo do atendimento, antes de mostrar aparelho — aí você já oferece o que cabe no limite.'
const DICA_VENDEDOR = 'A AIVA paga R$ 10 por venda pro vendedor, via Pix na chave CPF. Vendedor novo: o sócio pede o login dele no formulário de Login de operadores.'
const DICA_PLACA = 'Uma placa "Parcelamos seu celular" no balcão e na vitrine faz o cliente perguntar sozinho.'

function textos(g: Gargalo, x: { consultas: number; aprovados: number; vendas: number; txAprovacao: number | null; txConversao: number | null; rede: MediaRede }) {
  const mediaApr = x.rede.aprovacao != null ? `média das lojas AIVA: ${pct(x.rede.aprovacao)}` : ''
  const mediaConv = x.rede.conversao != null ? `média das lojas AIVA: ${pct(x.rede.conversao)}` : ''
  switch (g) {
    case 'consultar': return {
      titulo: 'Sua loja ainda não consultou este mês',
      explicacao: 'A loja está liberada na AIVA, mas nenhum CPF foi consultado. Sem consulta não tem aprovação — é o primeiro passo, é grátis e leva 2 minutos.',
      dicas: [
        'Consulte hoje o próximo cliente que pedir preço. Se travar em alguma tela, manda o print no WhatsApp que a gente te guia.',
        DICA_RISCO + ' ' + DICA_VARIANCIA,
        DICA_CONSULTAR_TODOS,
      ],
    }
    case 'retomar': return {
      titulo: 'Sua loja vendia pela AIVA e parou',
      explicacao: 'Nenhuma consulta de CPF este mês. Cada cliente que pergunta "parcela?" e sai sem consulta é venda indo pro concorrente — e retomar é bem mais fácil do que começar do zero.',
      dicas: [
        'Se foi cliente reprovando: ' + DICA_RISCO,
        'Se foi vendedor que saiu ou senha travada: ' + DICA_VENDEDOR + ' Acesso travado tem o canal certo — responda a mensagem no WhatsApp.',
        'Compromisso da semana: consulte os próximos 3 clientes que pedirem preço.',
      ],
    }
    case 'aprovar': return {
      titulo: 'O ponto a melhorar é a APROVAÇÃO',
      explicacao: `Foram ${plural(x.consultas, 'consulta', 'consultas')} e nenhuma aprovação ainda${mediaApr ? ` (${mediaApr})` : ''}.${x.consultas < POUCAS_CONSULTAS ? ' ' + DICA_VARIANCIA : ''}`,
      dicas: [DICA_CONSULTAR_TODOS, DICA_RISCO, 'Oriente o cliente certinho no cadastro: dado errado derruba a análise.'],
    }
    case 'fechar': return {
      titulo: 'O ponto a melhorar é FECHAR A VENDA',
      explicacao: `Você já tem ${plural(x.aprovados, 'cliente aprovado', 'clientes aprovados')} este mês${x.txAprovacao != null ? ` (${pct(x.txAprovacao)} das consultas${mediaApr ? `; ${mediaApr}` : ''})` : ''}, mas nenhum virou venda. O crédito está saindo — o dinheiro está parado no fechamento.`,
      dicas: [DICA_LIMITE, DICA_ENTRADA, DICA_CEDO],
    }
    case 'crescer': return {
      titulo: 'Sua loja já está vendendo — dá pra vender mais',
      explicacao: `${plural(x.vendas, 'venda', 'vendas')} este mês${x.txConversao != null ? `, fechando ${pct(x.txConversao)} dos aprovados${mediaConv ? ` (${mediaConv})` : ''}` : ''}.`,
      dicas: [DICA_CEDO, DICA_LIMITE, DICA_VENDEDOR, DICA_PLACA],
    }
  }
}

/** Acrescenta o link ao {{2}} do HSM 48: uma linha, sem \n (a Meta rejeita quebra em variável). */
export function comLink(texto: string, link: string): string {
  return `${texto} 📊 Seu relatório da semana: ${link}`
}
