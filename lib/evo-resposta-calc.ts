/**
 * lib/evo-resposta-calc.ts — a resposta do Evo Talks diz "deu certo"?
 *
 * Nasceu de 15/10/2026: o espelho do portal repetia `opp #29936 70 → 51 · TeamVL` em TODA rodada
 * (de 15 em 15 min, pelo menos das 15h às 18h UTC). O card nunca saía da etapa 70 — carimbo de
 * entrada parado em 14/10 13h — e mesmo assim o `changeOpportunityStage` não lançava: o `postRaw`
 * olhava SÓ o status HTTP, e a API do Evo responde 200 com o erro no corpo (o mesmo padrão do
 * "success não prova entrega" dos templates). Resultado: movimento recusado virava sucesso de
 * mentira, o espelho marcava como movido e tentava de novo na rodada seguinte, pra sempre.
 *
 * A regra aqui é de propósito CONSERVADORA: só acusa erro quando o corpo DIZ que falhou
 * (`success: false`, `status: "error"`, campo `error` preenchido). Corpo vazio, texto solto,
 * lista ou objeto sem sinal de falha continuam valendo como sucesso — a API tem endpoint que
 * responde cada uma dessas formas, e um falso positivo aqui derrubaria rodada que hoje funciona.
 */

/** Os valores que, nos campos de estado, significam "falhou". */
const SINAL_DE_ERRO = new Set(['error', 'erro', 'failed', 'failure', 'fail'])

/** Só texto de gente vira mensagem: `{"error":true}` viraria o inútil "true", então cai no corpo
 *  aparado, que ao menos mostra o que o Evo respondeu. */
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Mensagem do erro que o corpo declara, ou `null` quando o corpo não acusa falha nenhuma.
 *  Chame só depois de confirmar que o HTTP foi ok — status ruim já tem tratamento próprio. */
export function erroDaRespostaEvo(corpo: string): string | null {
  const cru = (corpo ?? '').trim()
  if (!cru) return null // 204/corpo vazio: vários endpoints respondem assim quando dá certo

  let j: unknown
  try {
    j = JSON.parse(cru)
  } catch {
    return null // texto solto não é declaração de falha
  }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) return null

  const o = j as Record<string, unknown>
  const declaraFalha =
    o.success === false || o.success === 'false' ||
    o.ok === false || o.ok === 'false' ||
    // 19/10/2026: `/int/changeOpportunityStage` recusa com `{"result":false}` — 16 bytes, HTTP 200.
    // Foi o que travou 14 cards (54 → 50, 47 → 50, 70 → 51) com ok=true na trilha.
    o.result === false || o.result === 'false' ||
    SINAL_DE_ERRO.has(String(o.status ?? '').toLowerCase()) ||
    SINAL_DE_ERRO.has(String(o.result ?? '').toLowerCase()) ||
    (o.error !== undefined && o.error !== null && o.error !== false && o.error !== '' && o.error !== 0)
  if (!declaraFalha) return null

  // A mensagem que vai pro log: a primeira que existir, senão o corpo aparado.
  const msg =
    texto(o.message) ?? texto(o.mensagem) ?? texto(o.msg) ?? texto(o.detail) ??
    (typeof o.error === 'object' && o.error !== null
      ? texto((o.error as Record<string, unknown>).message) ?? JSON.stringify(o.error).slice(0, 200)
      : texto(o.error)) ??
    cru.slice(0, 200)
  return msg
}
