/** Sugestão de comando quando o admin erra a digitação ("/retonar" → "/retomar").
 *  Pura. Nunca EXECUTA o comando sugerido: "/pausar" e "/retomar" têm efeito real, então a
 *  resposta é sempre "quis dizer X? manda de novo" — o custo de um falso positivo seria pausar
 *  ou retomar o disparo por um dedo errado. Caso real: 13/10/2026, "/retonar" deixou a AIVA
 *  pausada mais 4 min até alguém ler a lista de comandos. */

/** Distância de Levenshtein clássica (inserção, remoção, troca). */
export function distancia(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + custo)
    }
    prev = cur
  }
  return prev[b.length]
}

/** Normaliza o que o admin digitou: minúsculas, sem acento, sem espaço em volta, uma barra só. */
export function normalizarComando(texto: string): string {
  const t = (texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  const primeiro = t.split(/\s+/)[0] ?? ''
  return '/' + primeiro.replace(/^\/+/, '')
}

/** Devolve o comando conhecido mais parecido (distância ≤ 2, ou ≤ 1 em comandos curtos),
 *  ou `null` quando nada parece. Empate: o primeiro da lista. */
export function sugerirComando(digitado: string, conhecidos: readonly string[]): string | null {
  const cmd = normalizarComando(digitado)
  if (conhecidos.includes(cmd)) return cmd
  let melhor: { cmd: string; d: number } | null = null
  for (const c of conhecidos) {
    const d = distancia(cmd, c)
    const limite = c.length <= 5 ? 1 : 2
    if (d <= limite && (!melhor || d < melhor.d)) melhor = { cmd: c, d }
  }
  return melhor?.cmd ?? null
}

/** Texto da resposta quando o comando não existe. */
export function textoComandoDesconhecido(digitado: string, conhecidos: readonly string[]): string {
  const sug = sugerirComando(digitado, conhecidos)
  const cmd = normalizarComando(digitado)
  if (sug && sug !== cmd) return `Não conheço ${cmd}. Quis dizer *${sug}*? Manda de novo que eu executo.`
  return `Comando desconhecido: ${cmd}\n\nDigite /ajuda pra ver os comandos disponíveis.`
}
