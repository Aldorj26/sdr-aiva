/**
 * Turmas de treinamento ao vivo da AIVA — fonte de verdade: `training_sessions`
 * no banco do Portal Parceiros (a AIVA edita a agenda lá; em 16/09/2026 ela
 * trocou "segunda e quinta, dois links" por "segunda, quarta e sexta, um link
 * só" a partir de 21/09 — e nós tínhamos os dias e os links fixos em 5 lugares).
 *
 * Tudo que fala de treinamento (HSM 69, bloco dinâmico do prompt, check de
 * treinamento, kit de reforço) lê daqui. Cache de 1h por instância; se o portal
 * falhar, usa o cache velho e, sem cache, gera pela REGRA_FALLBACK (última
 * agenda conhecida) — nunca deixa a VictorIA sem turma pra citar.
 *
 * Parte pura (formatação, fallback, bloco do prompt): lib/turmas-treinamento-calc.ts.
 */
import { loginPortal, rest } from '@/lib/portal-aiva'
import { futuras, gerarFallback, linkMeet, REGRA_FALLBACK, TOLERANCIA_MS, type Fonte, type Turma } from '@/lib/turmas-treinamento-calc'

export * from '@/lib/turmas-treinamento-calc'

const CACHE_MS = 60 * 60 * 1000
let cache: { turmas: Turma[]; em: number } | null = null

/** Próximas `n` turmas (a de hoje incluída se ainda não passou de 90 min do início). */
export async function proximasTurmas(n = 4, agora = new Date()): Promise<{ turmas: Turma[]; fonte: Fonte }> {
  if (cache && agora.getTime() - cache.em < CACHE_MS) {
    const t = futuras(cache.turmas, agora, n)
    if (t.length) return { turmas: t, fonte: 'cache' }
  }
  try {
    const s = await loginPortal()
    const desde = new Date(agora.getTime() - TOLERANCIA_MS).toISOString()
    const { data } = await rest<Array<{ invite_id: string; starts_at: string; label: string | null }>>(
      s, `training_sessions?select=invite_id,starts_at,label&starts_at=gte.${encodeURIComponent(desde)}&order=starts_at.asc&limit=${Math.max(n, 8)}`,
    )
    const turmas = data.filter((x) => x.invite_id && x.starts_at).map((x) => ({ startsAt: x.starts_at, inviteId: x.invite_id, link: linkMeet(x.invite_id), label: x.label ?? null }))
    if (turmas.length) {
      cache = { turmas, em: agora.getTime() }
      return { turmas: futuras(turmas, agora, n), fonte: 'portal' }
    }
  } catch (e) {
    console.warn('[turmas] portal indisponível, usando cache/fallback:', String(e).slice(0, 120))
  }
  if (cache) { const t = futuras(cache.turmas, agora, n); if (t.length) return { turmas: t, fonte: 'cache' } }
  return { turmas: gerarFallback(agora, n), fonte: 'fallback' }
}

/**
 * Houve turma HOJE (Brasília) que já começou? Usado pelo check de treinamento:
 * a pergunta "já conseguiu participar?" só faz sentido à tarde de um dia de turma.
 * Falha do portal → cai na REGRA_FALLBACK (dia da semana).
 */
export async function houveTurmaHoje(agora = new Date()): Promise<boolean> {
  const brt = new Date(agora.getTime() - 3 * 60 * 60 * 1000)
  const inicioDia = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), 3, 0)) // 00:00 BRT
  try {
    const s = await loginPortal()
    const { data } = await rest<Array<{ starts_at: string }>>(
      s, `training_sessions?select=starts_at&starts_at=gte.${encodeURIComponent(inicioDia.toISOString())}&starts_at=lte.${encodeURIComponent(agora.toISOString())}&limit=5`,
    )
    return data.length > 0
  } catch {
    return (REGRA_FALLBACK.diasSemana as readonly number[]).includes(brt.getUTCDay())
  }
}
