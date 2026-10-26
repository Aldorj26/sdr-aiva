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
 *   [BIOMETRIA_FEITA_LOJISTA:ISO]  o lojista DISSE na conversa que já fez (ou mandou o print da tela
 *                            "Tudo certo") enquanto o portal ainda mostrava pendente — gravado pelo
 *                            webhook (Aldo 26/10/2026, caso Obattacell: 3 lembretes depois do "já fiz",
 *                            a AIVA levou 5 dias pra registrar a aprovação). Para os lembretes; o time
 *                            é avisado UMA vez pra conferir com a AIVA ([BIOMETRIA_FEITA_AVISADO]).
 *                            O cron apaga os dois quando a loja sai de `biometria` no portal.
 *   [BIO_NEGADA:n:ISO]       aviso de selfie REPROVADA pela AIVA (n = 1..2) — trilha própria, abaixo
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

/**
 * BIOMETRIA NEGADA (Aldo 05/10/2026). A AIVA analisa a selfie DEPOIS: o lojista sai do link
 * com a tela de concluído e só mais tarde o portal vira `negado`. Até aqui ele nunca era
 * avisado — levava os lembretes genéricos acima ("falta só o reconhecimento facial"), como
 * se não tivesse feito (TevCell: negada em 29/09, 3 lembretes errados até 05/10).
 * Trilha própria: aviso na hora em que o cron vê a negativa, um reforço em 2 dias e fim —
 * a loja já está no painel do Nei desde o primeiro dia (aviso `biometria_negada`).
 * ⛔ Enquanto ENVIO_NEGADA_ATIVO for false, nada é enviado ao lojista; os lembretes genéricos
 * param do mesmo jeito. Os textos abaixo foram APROVADOS pelo Aldo em 05/10/2026 — a flag só
 * espera o Mauricio (AIVA) dizer se o link reabre depois da negativa: se precisar de link novo,
 * ligar como está mandaria link morto.
 */
// ⚠️ 19/10/2026: a regra da CONVERSA mudou (Aldo) — na biometria reprovada a VictorIA não manda
// mais refazer pelo link: pede um documento com foto e uma selfie na própria conversa, e o time
// encaminha à AIVA (ver o bloco "BIOMETRIA REPROVADA PELA AIVA" em lib/claude.ts). Os textos
// automáticos abaixo ficaram para trás: ainda mandam o link. ⛔ NÃO ligue esta flag sem reescrever
// `mioloNegada` pra pedir as duas fotos — ligada como está, o robô diria uma coisa e a VictorIA
// outra na mesma conversa. Em compensação, a dúvida que segurava a flag (o link reabre depois da
// negativa?) deixou de importar: o caminho novo não usa link.
export const ENVIO_NEGADA_ATIVO = false
export const MAX_TOQUES_NEGADA = 2
export const DIAS_REFORCO_NEGADA = 2

/** {{2}} do HSM 48 — UMA linha, com o link dentro. */
export function mioloNegada(toque: number, url: string): string {
  const u = url.trim()
  return toque <= 1
    ? `A AIVA analisou o seu reconhecimento facial e ele não foi aprovado. Isso acontece quando a foto do documento ou do rosto não fica legível. É só refazer, em lugar bem iluminado, sem boné nem óculos e com o documento original em mãos: ${u}`
    : `Passando pra lembrar: o reconhecimento facial do seu cadastro na AIVA não foi aprovado e precisa ser refeito pra loja ser liberada. Lugar claro, sem boné nem óculos, documento original: ${u}`
}

export function decidirNegada(m: Marcadores, respondeuRecente: boolean, agora = Date.now(), ativo: boolean = ENVIO_NEGADA_ATIVO): Decisao {
  if (m.optout) return { acao: 'nada', motivo: 'optout' }
  if (m.pausaVigente) return { acao: 'nada', motivo: 'pausa' }
  if (!ativo) return { acao: 'nada', motivo: 'negada_envio_desligado' }
  if (m.negadaToques >= MAX_TOQUES_NEGADA) return { acao: 'nada', motivo: 'negada_avisada' }
  // o 1º aviso sai mesmo com conversa viva: é notícia que ele não tem como saber sozinho
  if (m.negadaToques === 0) return { acao: 'enviar', toque: 1 }
  if (respondeuRecente) return { acao: 'nada', motivo: 'conversa_recente' }
  if (m.negadaUltimoMs != null && agora - m.negadaUltimoMs < DIAS_REFORCO_NEGADA * DIA_MS - 12 * 3_600_000) return { acao: 'nada', motivo: 'negada_aguardando_reforco' }
  return { acao: 'enviar', toque: m.negadaToques + 1 }
}

export type Marcadores = {
  negadaToques: number
  negadaUltimoMs: number | null
  inicioMs: number | null
  toques: number
  ultimoMs: number | null
  link: string | null
  esgotado: boolean
  esgotadoAvisado: boolean
  optout: boolean
  pausaVigente: boolean
  /** lojista disse que já fez (webhook) — null = nunca disse */
  feitaLojistaMs: number | null
  feitaAvisado: boolean
}

export function lerMarcadores(obs: string | null | undefined, agora = Date.now()): Marcadores {
  const o = obs ?? ''
  const ms = (re: RegExp) => { const iso = o.match(re)?.[1]; const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : null }
  const toque = o.match(/\[BIOMETRIA:(\d+):([^\]]+)\]/)
  const pausa = ms(/\[PAUSA_ATE:([^\]]+)\]/)
  const neg = o.match(/\[BIO_NEGADA:(\d+):([^\]]+)\]/)
  return {
    negadaToques: neg ? Number(neg[1]) : 0,
    negadaUltimoMs: neg && Number.isFinite(Date.parse(neg[2])) ? Date.parse(neg[2]) : null,
    inicioMs: ms(/\[BIOMETRIA_INICIO:([^\]]+)\]/),
    toques: toque ? Number(toque[1]) : 0,
    ultimoMs: toque && Number.isFinite(Date.parse(toque[2])) ? Date.parse(toque[2]) : null,
    link: o.match(/\[BIOMETRIA_LINK:([^\]\s]+)\]/)?.[1] ?? null,
    esgotado: o.includes('[BIOMETRIA_ESGOTADO]'),
    esgotadoAvisado: o.includes('[BIOMETRIA_ESGOTADO_AVISADO]'),
    optout: o.includes('[BIOMETRIA_OPTOUT]'),
    pausaVigente: pausa != null && pausa > agora,
    feitaLojistaMs: ms(/\[BIOMETRIA_FEITA_LOJISTA:([^\]]+)\]/),
    feitaAvisado: o.includes('[BIOMETRIA_FEITA_AVISADO]'),
  }
}

export type Decisao =
  | { acao: 'enviar'; toque: number }
  | { acao: 'esgotou' }
  /** lojista disse que já fez e o portal segue pendente: avisar o time UMA vez e parar de cobrar */
  | { acao: 'conferir' }
  | { acao: 'nada'; motivo: string }

/**
 * `respondeuRecente` = lead mandou mensagem nas últimas 48h. No toque 1 isso NÃO
 * segura o envio (o link é a próxima ação natural e a VictorIA também o tem na
 * conversa); nos reforços, conversa viva segura.
 */
export function decidir(m: Marcadores, respondeuRecente: boolean, agora = Date.now()): Decisao {
  if (m.optout) return { acao: 'nada', motivo: 'optout' }
  if (m.pausaVigente) return { acao: 'nada', motivo: 'pausa' }
  // Ele disse que já fez: cobrar de novo é chamá-lo de mentiroso. Quem confere é o time, com a AIVA.
  if (m.feitaLojistaMs != null) return m.feitaAvisado ? { acao: 'nada', motivo: 'lojista_diz_que_fez' } : { acao: 'conferir' }
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
  patch: { inicio?: boolean; toque?: number; link?: string; esgotado?: boolean; esgotadoAvisado?: boolean; negada?: number; feitaAvisado?: boolean },
  agora = new Date(),
): string {
  let base = (obs ?? '').trim()
  const iso = agora.toISOString()
  if (patch.inicio && !base.includes('[BIOMETRIA_INICIO:')) base = `${base} [BIOMETRIA_INICIO:${iso}]`.trim()
  if (patch.link) base = `${base.replace(/\s*\[BIOMETRIA_LINK:[^\]]*\]/g, '')} [BIOMETRIA_LINK:${patch.link.trim()}]`.trim()
  if (patch.toque != null) base = `${base.replace(/\s*\[BIOMETRIA:\d+:[^\]]*\]/g, '')} [BIOMETRIA:${patch.toque}:${iso}]`.trim()
  if (patch.negada != null) base = `${base.replace(/\s*\[BIO_NEGADA:\d+:[^\]]*\]/g, '')} [BIO_NEGADA:${patch.negada}:${iso}]`.trim()
  if (patch.esgotado && !base.includes('[BIOMETRIA_ESGOTADO]')) base = `${base} [BIOMETRIA_ESGOTADO]`
  if (patch.esgotadoAvisado && !base.includes('[BIOMETRIA_ESGOTADO_AVISADO]')) base = `${base} [BIOMETRIA_ESGOTADO_AVISADO]`
  if (patch.feitaAvisado && !base.includes('[BIOMETRIA_FEITA_AVISADO]')) base = `${base} [BIOMETRIA_FEITA_AVISADO]`
  return base.trim()
}
