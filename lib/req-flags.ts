/**
 * Flags de query string das rotas de cron (?dry, ?force).
 *
 * Por que existe (17/09/2026): o espelho lia `dry === '1'` e as outras quatro
 * rotas da Fase 1 liam `dry === 'true'`. Quem digitasse `?dry=1` na cobrança
 * achava que estava simulando e disparava HSM de verdade no lojista. Aqui
 * qualquer forma óbvia de "sim" liga a flag — inclusive `?dry` sozinho —, e o
 * que importa: nenhuma variação cai no caminho real por engano.
 */
const LIGADO = new Set(['1', 'true', 'sim', 'yes', 'on', 'y', 's'])

export function flag(params: URLSearchParams, nome: string): boolean {
  const v = params.get(nome)
  if (v == null) return false
  const t = v.trim().toLowerCase()
  return t === '' || LIGADO.has(t)
}
