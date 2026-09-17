/**
 * "Isso é só um aceno de cabeça?" — parte PURA, sem rede.
 *
 * Existe por causa do achado do Aldo em 17/09/2026: a VictorIA perguntava se o
 * lojista tinha preenchido o formulário / recebido a senha / feito o treinamento,
 * ele respondia "ok", e tanto ela quanto o CÓDIGO tratavam isso como resposta —
 * o webhook carimbava [CHECK_TREINAMENTO_RESP] e a cadência morria ali.
 *
 * ⚠️ FORA da lista de propósito (cada uma delas RESPONDE "já fez o treinamento?"):
 * "isso", "isso mesmo", "exato", "certinho", "confere", "tudo certo", "tudo ok",
 * "vou ver", "nada". Falso positivo aqui é o erro CARO — cala o lojista que
 * respondeu de verdade e a cadência segue batendo nele (foi o caso de 14/09,
 * 12 lojas cobradas indevidamente).
 *
 * ⚠️ "sim", "já fiz", "fiz sim" NÃO entram aqui: depois de uma pergunta fechada
 * eles são resposta de verdade (regra "OK" NÃO É CONFIRMAÇÃO DE FATO, em
 * prompts/aiva.ts, e blocos de fase em lib/claude.ts).
 */

const RECONHECIMENTO = new Set([
  'ok', 'okay', 'okey', 'oki', 'okk', 'k',
  'ta', 'tah', 'tabom', 'taok',
  'blz', 'beleza', 'certo', 'combinado', 'fechado',
  'entendi', 'entendido', 'endendi', 'compreendi',
  'tranquilo', 'tranquila', 'suave',
  'show', 'perfeito', 'otimo', 'legal', 'bacana', 'massa', 'maravilha',
  'bom', 'boa',
  'uhum', 'aham', 'ata', 'ah',
  'obrigado', 'obrigada', 'obg', 'brigado', 'brigada', 'valeu', 'vlw', 'agradecido',
])

/** Palavras de ligação que não mudam o sentido de um aceno ("ok então", "ta bom vlw"). */
const RUIDO = new Set(['e', 'entao', 'ento', 'ai', 'ja', 'so', 'mas', 'ne'])

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * true quando a mensagem é SÓ reconhecimento ("ok", "blz vlw", "👍") e não
 * responde nada. Mensagem vazia ou só emoji também conta como aceno.
 */
export function ehSoReconhecimento(texto: string | null | undefined): boolean {
  const cru = String(texto ?? '').trim()
  if (!cru) return false                      // sem texto não é aceno: é outra coisa (áudio, imagem)
  if (cru.length > 40) return false           // frase longa sempre diz alguma coisa
  const limpo = semAcento(cru.toLowerCase())
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .trim()
  // Só é aceno se o que sobrou vazio era MESMO emoji/pontuação. "3" ou "ok?" viram
  // vazio na limpeza de letras, mas "3" é resposta ("quantas lojas?").
  if (!limpo) return !/[\p{L}\p{N}]/u.test(cru)
  const tokens = limpo.split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  return tokens.every((t) => RECONHECIMENTO.has(t) || RUIDO.has(t))
}
