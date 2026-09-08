/**
 * lib/fila.ts — classificação da fila de atendimento humano (extraído de
 * app/api/sdr/fila-humano/route.ts em 03/09 pra ser compartilhado com a
 * página /atendimento).
 */

// Padrão histórico (1 match, com cauda livre até | ou [). Mantido exportado
// por compatibilidade; a extração do motivo ATUAL é motivoDeObs (abaixo).
export const RE_MOTIVO =
  /(acesso_[a-z_]+|desanimo_[a-z_]+|troca_[a-z_]+|repasse_[^|[]*|desbloqueio_[^|[]*|solicitacao_[^|[]*|painel_[^|[]*|followup_[^|[]*|atendimento_automatico[^|[]*|duvida_[^|[]*|pediu[^|[]*|interesse_[^|[]*|loja_[^|[]*|documentos_[^|[]*|dados_colaborador[^|[]*|qualificacao[^|[]*|cadastro[^|[]*|usuario_[^|[]*|alterac[^|[]*)/i

// INÍCIO de um motivo: qualquer id em snake_case com 2+ segmentos no começo de
// token (a VictorIA inventa o motivo_humano — "celular_travado_urgente",
// "acesso_flexfone_nao_chegou" — então enumerar prefixos sempre deixava algum
// de fora, e ele caía em "sem motivo"). O underscore obrigatório é o que
// separa um motivo de texto livre: "cadastro do vendedor" não é motivo novo.
// Os dados coletados (nome_socio=…) moram dentro de [marcadores], que saem antes.
const RE_INICIO_MOTIVO = /(?:^|\s)([a-z]{3,}(?:_[a-z0-9]+)+|pediu\b|qualificacao[a-z_]*|alterac[a-z_]*)/gi

export type CategoriaFila = 'acao' | 'docs' | 'mover' | 'sem_motivo'

// Etapas em que o card JÁ passou de "Cadastro recebido": um motivo
// cadastro_completo / cadastro_caf_confirmado que sobrou nas observações é
// resíduo de quando o lead completou o cadastro — não é mais "mover card".
const STATUS_POS_CADASTRO = ['EM_ANALISE_AIVA', 'TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']

export function categoriaFila(motivo: string, status?: string): CategoriaFila {
  // acesso_* / desanimo_* / troca_*: loja parada ou pedido sensível — sempre ação.
  if (/^(acesso_|desanimo_|troca_)/i.test(motivo.trim())) return 'acao'
  const m = motivo.toLowerCase()
  if (!m.trim()) return 'sem_motivo'
  if (/cadastro_caf_confirmado|cadastro_completo\b/.test(m)) {
    // 08/09: Limacell/Manucel/MV apareciam em "Mover card" com o card já em
    // Em Análise há 2+ semanas — o motivo era de 22/08. Depois de Em Análise,
    // "cadastro completo" não pede movimento nenhum.
    return status && STATUS_POS_CADASTRO.includes(status) ? 'acao' : 'mover'
  }
  if (/documentos_sem_socio_completos|dados_colaborador/.test(m)) return 'docs'
  return 'acao'
}

/**
 * Motivo ATUAL do acionamento: o ÚLTIMO das observações.
 * As observações são append-only, então o mais recente é o que vale. Antes o
 * primeiro match ganhava e um motivo de semanas atrás mascarava o atual (caso
 * 08/09: "cadastro_completo" de 22/08 escondia "followup_sem_resposta_em_analise"
 * de 03/09 e jogava lead travado no CAF em "Mover card").
 * Cada motivo vai do seu prefixo até o próximo prefixo (ou | ou [), preservando
 * a cauda de texto livre ("repasse_atrasado_urgente: loja parou de vender…").
 * Marcadores [ASSIM] saem antes: o [CAMPANHA_PAINEL_REPASSES:...] casava com o
 * padrão e vazava na coluna de motivo (04/09).
 */
export function motivoDeObs(obs: string | null): string {
  const s = (obs ?? '').replace(/\[[^\]]*\]/g, ' ')
  const inicios: number[] = []
  for (const m of s.matchAll(RE_INICIO_MOTIVO)) inicios.push((m.index ?? 0) + m[0].length - m[1].length)
  if (!inicios.length) return ''
  const ini = inicios[inicios.length - 1]
  return s.slice(ini).split(/[|[]/)[0].trim().slice(0, 70)
}
