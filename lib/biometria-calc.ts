/**
 * Biometria automática (portal AIVA em `biometria`) — parte PURA.
 *
 * O lojista terminou o formulário do varejo e falta só o reconhecimento facial.
 * O portal guarda o link (onboardings.liveness_url); o Nei mandava na mão. Agora:
 * envio na hora em que o cron vê a loja em `biometria` (toque 1), reforço em D+2
 * (toque 2) e D+5 (toque 3); depois avisa o time uma vez e para. Quem conclui a
 * biometria some da fila sozinho (portal vai pra cadastro_finalizado e o espelho
 * move o card pra Treinar).
 *
 * Marcadores em observacoes:
 *   [BIOMETRIA_INICIO:ISO]   primeira vez que o cron viu a loja em biometria (D0)
 *   [BIOMETRIA:n:ISO]        último envio (n = 1..3)
 *   [BIOMETRIA_LINK:url]     link atual (a VictorIA usa na conversa — FASE 4)
 *   [BIOMETRIA_ESGOTADO] [BIOMETRIA_ESGOTADO_AVISADO] [BIOMETRIA_OPTOUT]
 */

export const DIAS_TOQUE = [0, 2, 5] as const
export const MAX_TOQUES = DIAS_TOQUE.length
const DIA_MS = 24 * 60 * 60 * 1000

/** {{2}} do HSM 48 — UMA linha. O link vai dentro da variável (o HSM 34 já faz isso com o link do onboarding). */
export function miolo(toque: number, url: string): string {
  const u = url.trim()
  switch (toque) {
    case 1:
      return `Vi que você concluiu o formulário da AIVA. Falta só o último passo: o reconhecimento facial, que libera a plataforma na sua loja. É rapidinho, pelo celular, só apontar a câmera pro rosto: ${u}`
    case 2:
      return `Passando pra lembrar do reconhecimento facial da AIVA, o último passo do seu cadastro. Leva menos de 2 minutos pelo celular: ${u}`
    default:
      return `Última lembrança por aqui: seu cadastro na AIVA está quase pronto, falta só o reconhecimento facial. Sem ele a loja não é liberada pra vender parcelado. O link é este: ${u}`
  }
}

export type Marcadores = {
  inicioMs: number | null
  toques: number
  ultimoMs: number | null
  link: string | null
  esgotado: boolean
  esgotadoAvisado: boolean
  optout: boolean
  pausaVigente: boolean
}

export function lerMarcadores(obs: string | null | undefined, agora = Date.now()): Marcadores {
  const o = obs ?? ''
  const ms = (re: RegExp) => { const iso = o.match(re)?.[1]; const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null }
  const toque = o.match(/\[BIOMETRIA:(\d+):([^\]]+)\]/)
  const pausa = ms(/\[PAUSA_ATE:([^\]]+)\]/)
  return {
    inicioMs: ms(/\[BIOMETRIA_INICIO:([^\]]+)\]/),
    toques: toque ? Number(toque[1]) : 0,
    ultimoMs: toque && Number.isFinite(Date.parse(toque[2])) ? Date.parse(toque[2]) : null,
    link: o.match(/\[BIOMETRIA_LINK:([^\]\s]+)\]/)?.[1] ?? null,
    esgotado: o.includes('[BIOMETRIA_ESGOTADO]'),
    esgotadoAvisado: o.includes('[BIOMETRIA_ESGOTADO_AVISADO]'),
    optout: o.includes('[BIOMETRIA_OPTOUT]'),
    pausaVigente: pausa != null && pausa > agora,
  }
}

export type Decisao =
  | { acao: 'enviar'; toque: number }
  | { acao: 'esgotou' }
  | { acao: 'nada'; motivo: string }

/**
 * `respondeuRecente` = lead mandou mensagem nas últimas 48h. No toque 1 isso NÃO
 * segura o envio (o link é a próxima ação natural e a VictorIA também o tem na
 * conversa); nos reforços, conversa viva segura.
 */
export function decidir(m: Marcadores, respondeuRecente: boolean, agora = Date.now()): Decisao {
  if (m.optout) return { acao: 'nada', motivo: 'optout' }
  if (m.pausaVigente) return { acao: 'nada', motivo: 'pausa' }
  if (m.esgotado) return m.esgotadoAvisado ? { acao: 'nada', motivo: 'esgotado' } : { acao: 'esgotou' }
  if (m.toques >= MAX_TOQUES) return { acao: 'esgotou' }
  const proximo = m.toques + 1
  if (proximo === 1) return { acao: 'enviar', toque: 1 }
  if (respondeuRecente) return { acao: 'nada', motivo: 'conversa_recente' }
  const inicio = m.inicioMs ?? m.ultimoMs ?? agora
  if ((agora - inicio) / DIA_MS < DIAS_TOQUE[proximo - 1]) return { acao: 'nada', motivo: `aguardando D+${DIAS_TOQUE[proximo - 1]}` }
  if (m.ultimoMs != null && agora - m.ultimoMs < DIA_MS) return { acao: 'nada', motivo: 'toque_hoje' }
  return { acao: 'enviar', toque: proximo }
}

export function remontarObs(
  obs: string | null | undefined,
  patch: { inicio?: boolean; toque?: number; link?: string; esgotado?: boolean; esgotadoAvisado?: boolean },
  agora = new Date(),
): string {
  let base = (obs ?? '').trim()
  const iso = agora.toISOString()
  if (patch.inicio && !base.includes('[BIOMETRIA_INICIO:')) base = `${base} [BIOMETRIA_INICIO:${iso}]`.trim()
  if (patch.link) base = `${base.replace(/\s*\[BIOMETRIA_LINK:[^\]]*\]/g, '')} [BIOMETRIA_LINK:${patch.link.trim()}]`.trim()
  if (patch.toque != null) base = `${base.replace(/\s*\[BIOMETRIA:\d+:[^\]]*\]/g, '')} [BIOMETRIA:${patch.toque}:${iso}]`.trim()
  if (patch.esgotado && !base.includes('[BIOMETRIA_ESGOTADO]')) base = `${base} [BIOMETRIA_ESGOTADO]`
  if (patch.esgotadoAvisado && !base.includes('[BIOMETRIA_ESGOTADO_AVISADO]')) base = `${base} [BIOMETRIA_ESGOTADO_AVISADO]`
  return base.trim()
}
