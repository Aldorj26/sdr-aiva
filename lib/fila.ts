/**
 * lib/fila.ts — classificação da fila de atendimento humano (extraído de
 * app/api/sdr/fila-humano/route.ts em 03/09 pra ser compartilhado com a
 * página /atendimento).
 */
export const RE_MOTIVO =
  /(acesso_[a-z_]+|desanimo_[a-z_]+|troca_[a-z_]+|repasse_[^|[]*|desbloqueio_[^|[]*|solicitacao_[^|[]*|painel_[^|[]*|atendimento_automatico[^|[]*|duvida_[^|[]*|pediu[^|[]*|interesse_[^|[]*|loja_[^|[]*|documentos_[^|[]*|dados_colaborador[^|[]*|qualificacao[^|[]*|cadastro[^|[]*|usuario_[^|[]*|alterac[^|[]*)/i

export type CategoriaFila = 'acao' | 'docs' | 'mover' | 'sem_motivo'

export function categoriaFila(motivo: string): CategoriaFila {
  // acesso_* / desanimo_* / troca_*: loja parada ou pedido sensível — sempre ação.
  if (/^(acesso_|desanimo_|troca_)/i.test(motivo.trim())) return 'acao'
  const m = motivo.toLowerCase()
  if (!m.trim()) return 'sem_motivo'
  if (/cadastro_caf_confirmado|cadastro_completo\b/.test(m)) return 'mover'
  if (/documentos_sem_socio_completos|dados_colaborador/.test(m)) return 'docs'
  return 'acao'
}

export function motivoDeObs(obs: string | null): string {
  // Marcadores [ASSIM] saem antes do match: o [CAMPANHA_PAINEL_REPASSES:...]
  // casava com o padrão e vazava na coluna de motivo dos painéis (04/09).
  const semMarcadores = (obs ?? '').replace(/\[[^\]]*\]/g, ' ')
  return (semMarcadores.match(RE_MOTIVO)?.[1] ?? '').trim().slice(0, 70)
}
