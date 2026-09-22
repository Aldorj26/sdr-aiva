/**
 * lib/claude-json.ts — parse tolerante da resposta JSON da VictorIA.
 *
 * POR QUE EXISTE: a VictorIA responde em JSON (`{"mensagem": "...", ...}`) e a
 * mensagem pro lojista quase sempre tem parágrafo. Quando o modelo escreve uma
 * quebra de linha **crua** dentro da string, em vez de `\n` escapado, o
 * `JSON.parse` estoura com *"Bad control character in string literal in JSON"* —
 * e o turno inteiro é perdido: o lojista recebe "estou com um volume alto de
 * atendimentos" (mentira: o problema é formatação), o Nei e o Aldo levam um
 * alerta 🚨, e o webhook entra em retry.
 *
 * Não é caso raro. Em 22/09/2026 eram **43 dos 166** erros registrados da
 * VictorIA — a causa número 1, acontecendo todo dia útil (4 a 6 por dia).
 * O caso que motivou a correção: MY CASE (5592982741062), 22/09 15:44 — a loja
 * respondeu com uma saudação automática cheia de quebras de linha e a resposta
 * da VictorIA veio com newline cru na posição 81.
 *
 * O CONSERTO É SEGURO porque só mexe no que já é inválido: caractere de controle
 * (< 0x20) **dentro de uma string literal** não tem nenhum significado válido em
 * JSON — a especificação exige que ele venha escapado. Então trocar o byte cru
 * pelo escape correto não muda nenhum JSON que já fosse válido: a primeira
 * tentativa é sempre o `JSON.parse` puro, e isto aqui só roda quando ele falha.
 *
 * ⚠️ NÃO tenta consertar outros defeitos (vírgula sobrando, aspas não fechadas,
 * JSON truncado por limite de tokens). Esses são erro de conteúdo, não de
 * transporte, e mascarar isso esconderia um problema real do prompt.
 */

/**
 * Escapa caracteres de controle CRUS que estejam dentro de string literal.
 * Fora de string eles são irrelevantes (espaço em branco entre tokens).
 */
export function escaparControlesEmStrings(bruto: string): string {
  let saida = ''
  let dentroDeString = false
  let escapando = false

  for (const ch of bruto) {
    if (escapando) { saida += ch; escapando = false; continue }
    if (ch === '\\') { saida += ch; escapando = dentroDeString; continue }
    if (ch === '"') { dentroDeString = !dentroDeString; saida += ch; continue }
    const code = ch.codePointAt(0) ?? 0
    if (dentroDeString && code < 0x20) {
      saida += ch === '\n' ? '\\n'
        : ch === '\r' ? '\\r'
        : ch === '\t' ? '\\t'
        : ch === '\b' ? '\\b'
        : ch === '\f' ? '\\f'
        : `\\u${code.toString(16).padStart(4, '0')}`
      continue
    }
    saida += ch
  }
  return saida
}

export type ResultadoParse<T> = { valor: T; consertado: boolean }

/**
 * `JSON.parse` com uma segunda chance: se falhar, escapa os controles crus e
 * tenta de novo. Se ainda falhar, relança o erro ORIGINAL — o diagnóstico tem
 * que apontar pro defeito de verdade, não pro texto já mexido.
 */
export function parseRespostaJson<T>(bruto: string): ResultadoParse<T> {
  try {
    return { valor: JSON.parse(bruto) as T, consertado: false }
  } catch (erroOriginal) {
    const consertado = escaparControlesEmStrings(bruto)
    if (consertado !== bruto) {
      try {
        return { valor: JSON.parse(consertado) as T, consertado: true }
      } catch {
        // o escape não resolveu: o defeito é outro (truncado, aspas abertas…)
      }
    }
    throw erroOriginal
  }
}
