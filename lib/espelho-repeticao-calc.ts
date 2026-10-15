/**
 * lib/espelho-repeticao-calc.ts — o espelho está repetindo o MESMO movimento sem o card andar?
 *
 * Lacuna 2 da auditoria de 15/10/2026. O defeito do dia (opp #29936 TeamVL, 70 → 51 recusado pelo Evo
 * com HTTP 200) ficou invisível por mais de 24 h: o espelho recalculava o mesmo movimento a cada 15 min
 * e nunca movia o card, e a única trilha era o `console.log` da Vercel. O commit 44f950f passou a
 * detectar a recusa no corpo da resposta (lib/evo-resposta-calc), mas ninguém era avisado — e um
 * movimento pode parar de funcionar por outros motivos (automação do Evo que devolve o card, etapa
 * renomeada, card reaberto em outro funil) sem erro nenhum na nossa ponta.
 *
 * A regra aqui olha a trilha de `sdr_etapa_log` (lacuna 3): o MESMO movimento — mesma opp, mesma etapa
 * de origem e mesmo destino — repetido em N rodadas seguidas (padrão 4 ≈ 1 h) é um card travado.
 * Avisa Aldo e Nei UMA VEZ por opp, com `sdr_avisos_chave` como anti-repetição (mesmo padrão dos avisos
 * `aiva_sem_criar:`): a chave fica viva enquanto o movimento se repete e é solta quando ele para, pra
 * que o próximo travamento volte a avisar.
 *
 * Conservadora de propósito: conta só repetição EXATA (opp+de+para) e exige rodadas seguidas. Movimento
 * que anda de verdade muda o `de` na rodada seguinte (ou desaparece), então nunca entra aqui. Um card
 * que vai e volta entre duas etapas (ex.: Treinamento agendado ↔ Cadastro finalizado, que o espelho
 * segue pra trás de propósito) alterna o par de/para e também não acusa.
 */

/** Rodadas seguidas com o mesmo movimento pra considerar o card travado (15 min por rodada ≈ 1 h). */
export const RODADAS_PADRAO = 4
export const PREFIXO_CHAVE = 'espelho_repete:'
export const chaveRepeticao = (opp: number): string => `${PREFIXO_CHAVE}${opp}`

/** Uma linha de sdr_etapa_log (só o que a regra usa). */
export type LinhaLog = { opp: number; de: number; para: number; criado_em?: string | null }
/** Movimento desta rodada (o que `calcularEspelho` devolveu e o espelho tentou executar). */
export type MovimentoChave = { lead_id: string; nome: string; opp: number; de: number; para: number; motivo: string }
export type Repetido = MovimentoChave & {
  /** rodadas seguidas com este mesmo movimento, contando a de agora */
  rodadas: number
  chave: string
  /** já tinha a chave em sdr_avisos_chave — não avisa de novo */
  jaAvisado: boolean
}
export type SaidaRepeticao = {
  /** todos os movimentos travados (avisados ou não) */
  repetidos: Repetido[]
  /** os que ainda não foram avisados — é o que vira mensagem pro Aldo e pro Nei */
  novos: Repetido[]
  /** chaves que devem continuar em sdr_avisos_chave */
  vivas: string[]
  /** chaves gravadas antes e que não travam mais: soltar, pro próximo travamento voltar a avisar */
  mortas: string[]
}

const quando = (l: LinhaLog): number => {
  const t = Date.parse(String(l.criado_em ?? ''))
  return Number.isFinite(t) ? t : 0
}

/**
 * Quantas rodadas seguidas este movimento vem se repetindo, CONTANDO a de agora.
 * 1 = primeira vez. Olha a trilha da opp do mais recente pro mais antigo e para na primeira
 * linha que não é o mesmo par de/para — só rodadas SEGUIDAS contam.
 */
export function contarRodadas(mov: { opp: number; de: number; para: number }, historico: LinhaLog[]): number {
  const daOpp = historico.filter((l) => Number(l.opp) === mov.opp).sort((a, b) => quando(b) - quando(a))
  let n = 1
  for (const l of daOpp) {
    if (Number(l.de) !== mov.de || Number(l.para) !== mov.para) break
    n++
  }
  return n
}

export function detectarRepeticao(e: {
  movimentos: MovimentoChave[]
  /** linhas recentes de sdr_etapa_log das opps desta rodada (ordem livre) */
  historico: LinhaLog[]
  /** chaves `espelho_repete:*` já gravadas em sdr_avisos_chave */
  chavesExistentes: string[]
  rodadas?: number
}): SaidaRepeticao {
  const limite = e.rodadas ?? RODADAS_PADRAO
  const existentes = new Set(e.chavesExistentes)
  const repetidos: Repetido[] = []
  const vistas = new Set<string>()

  for (const m of e.movimentos) {
    const rodadas = contarRodadas(m, e.historico)
    if (rodadas < limite) continue
    const chave = chaveRepeticao(m.opp)
    if (vistas.has(chave)) continue   // uma linha por opp, mesmo se o lead tiver dois movimentos
    vistas.add(chave)
    repetidos.push({ ...m, rodadas, chave, jaAvisado: existentes.has(chave) })
  }

  const vivas = repetidos.map((r) => r.chave)
  return {
    repetidos,
    novos: repetidos.filter((r) => !r.jaAvisado),
    vivas,
    mortas: [...existentes].filter((k) => !vistas.has(k)),
  }
}

/** Linha do aviso ao Aldo e ao Nei. */
export const linhaRepetido = (r: Repetido): string =>
  `• ${r.nome} — opp #${r.opp} travada em ${r.de} (o espelho tenta ${r.de} → ${r.para} há ${r.rodadas} rodadas) · ${r.motivo}`
