/**
 * Turmas de treinamento ao vivo da AIVA.
 *
 * ⚠️ FONTE MUDOU EM 26/10/2026: a AIVA desligou o login no banco do portal, então `training_sessions`
 * e `training_bookings` (agenda completa + link do Meet, lidos com senha) não existem mais pra gente.
 * Agora a agenda vem da API pública de onboardings (campo `training_at` por loja): datas REAIS das
 * turmas marcadas, mas SEM o link do Meet (a API só traz um training_id interno). O link sai da sala
 * fixa conhecida (`REGRA_FALLBACK.inviteId`, regime de link único que a AIVA publicou em 16/09/2026).
 * ⚠️ Se a AIVA voltar a usar um link por turma, isto fica errado e NÃO há como saber pela API — avisar
 * o Nei/Mauricio. Derivação pura e dedupe em lib/turmas-treinamento-calc.ts.
 *
 * Tudo que fala de treinamento (HSM 69, bloco dinâmico do prompt, check de
 * treinamento, kit de reforço) lê daqui. Cache de 1h por instância; se a API
 * falhar, usa o cache velho e, sem cache, gera pela REGRA_FALLBACK (última
 * agenda conhecida) — nunca deixa a VictorIA sem turma pra citar.
 *
 * Parte pura (formatação, fallback, bloco do prompt): lib/turmas-treinamento-calc.ts.
 */
import { listarTreinamentosApi } from '@/lib/portal-aiva'
import { futuras, gerarFallback, inscricoesDeTreinamentos, REGRA_FALLBACK, TOLERANCIA_MS, turmasDeTreinamentos, type Fonte, type Inscricao, type Turma } from '@/lib/turmas-treinamento-calc'

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
    // ⚠️ A API pública NÃO traz a agenda FUTURA: `training_at` é retrospectivo (a turma mais recente de
    // cada loja), então quase sempre todas as datas já passaram e `futuras` devolve vazio → cai no
    // fallback da regra. Mantemos a tentativa porque, se a AIVA um dia pré-agendar turmas à frente, elas
    // aparecem aqui sozinhas. O link, de qualquer forma, é o da sala fixa conhecida (a API não traz o do
    // Meet). O login que lia training_sessions (agenda completa) morreu em 26/10/2026.
    const turmas = futuras(turmasDeTreinamentos(await listarTreinamentosApi()), agora, 99)
    if (turmas.length) {
      cache = { turmas, em: agora.getTime() }
      return { turmas: futuras(turmas, agora, n), fonte: 'portal' }
    }
  } catch (e) {
    console.warn('[turmas] API de onboardings indisponível, usando cache/fallback:', String(e).slice(0, 120))
  }
  if (cache) { const t = futuras(cache.turmas, agora, n); if (t.length) return { turmas: t, fonte: 'cache' } }
  return { turmas: gerarFallback(agora, n), fonte: 'fallback' }
}

/**
 * Inscrições em turmas (training_bookings) por CNPJ do lojista. A AIVA importa a
 * lista de inscritos pra lá (source=external) e o painel do parceiro também grava.
 * Serve pra NÃO perguntar "já fez o treinamento?" a quem tem turma marcada e pra
 * perguntar certo a quem já passou pela turma.
 *
 * Mapa devolvido: CNPJ (só dígitos) → inscrições daquele onboarding.
 */
export async function inscricoesPorCnpj(cnpjs: string[]): Promise<Map<string, Inscricao[]>> {
  const alvo = new Set(cnpjs.map((c) => c.replace(/\D/g, '')).filter((c) => c.length === 14))
  if (!alvo.size) return new Map()
  // A inscrição de cada loja É o training_at do onboarding dela, na API pública (training_bookings,
  // que vinha pelo login, morreu em 26/10). firstName não vem na API — fica nulo.
  return inscricoesDeTreinamentos(await listarTreinamentosApi(), alvo)
}

/**
 * Houve turma HOJE (Brasília)? Usado pelo check de treinamento: a pergunta "já conseguiu participar?"
 * só faz sentido num dia de turma. ⚠️ A agenda que lia isso pelo login (training_sessions) morreu em
 * 26/10/2026, e o `training_at` da API é retrospectivo e laggy — confiar nele poderia dizer "não teve
 * turma" numa manhã de turma real e segurar o check. Então vale a cadência oficial da REGRA_FALLBACK
 * (seg/qua/sex), que é o calendário publicado pela AIVA.
 */
export async function houveTurmaHoje(agora = new Date()): Promise<boolean> {
  const brt = new Date(agora.getTime() - 3 * 60 * 60 * 1000)
  return (REGRA_FALLBACK.diasSemana as readonly number[]).includes(brt.getUTCDay())
}
