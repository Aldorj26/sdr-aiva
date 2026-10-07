/**
 * Espelho portal → Evo — parte PURA (sem rede, sem banco), pra dar pra testar.
 *
 * Recebe o retrato do Portal Parceiros AIVA (onboardings + sinais de login e
 * venda), o vínculo CNPJ → lead (sdr_registros_cnpj), os leads e a etapa atual
 * de cada oportunidade no Evo, e devolve O QUE FAZER: quais cards avançar, quais
 * registros marcar como pré-cadastro enviado e quais leads a AIVA reprovou.
 *
 * Regras (decisão do Aldo 16/09/2026 — "o portal vira a fonte dos eventos"):
 *   - portal em dados_varejo/biometria (pré-cadastro aprovado) → 50 Em Análise
 *   - cadastro_finalizado (tem retailer_id)                  → 70 Treinar
 *   - biometria APROVADA (falta só a AIVA criar a loja)       → 70 Treinar (Aldo 06/10/2026: o lojista
 *     já fez tudo e pode treinar enquanto a AIVA cria a loja; o acesso chega depois)
 *   - login_sends.credentials_sent_at preenchido             → 71 Login
 *   - alguma venda OU consulta em retailer_performance        → 51 Vendendo
 *     (consulta entrou em 28/09/2026, Aldo: loja que já consulta está operando e a
 *     etapa 51 é "loja operando", não "loja que já vendeu")
 *   - SÓ AVANÇA. Nunca regride (mesma ordem linear do changeStageSeAvanco).
 *   - Sem Resposta (53) pode avançar; Bot (69), Menos de 1 Ano (93) e CNPJ
 *     Irregular (94) nunca são tocados. Status terminais do lead também não.
 *   - Destino ≥ Treinar passa POR 70 (a automação do Evo manda o HSM 69 com o
 *     link do treinamento); nunca passa por 50 quando o destino é além (o HSM
 *     34 pede pra preencher um formulário que já foi preenchido).
 *   - Lead com vários CNPJs: vale o mais avançado.
 *   - not_approved sem nenhum outro CNPJ aprovado → REPROVADO: card vai pra 95
 *     "Loja Descartada pela Aiva" (etapa criada pelo Aldo 16/09), lead trava em
 *     NAO_QUALIFICADO, Nei+Aldo avisados uma vez ([PORTAL_REPROVADO]). Vale de
 *     qualquer etapa (inclusive Sem Resposta/Descartado); só não mexe em 69/93/94/95
 *     nem em OPT_OUT.
 */

export type OnbApi = {
  cnpj: string
  stage: string
  pre_cadastro_status?: string | null
  retailer_id?: string | number | null
  legal_name?: string | null
  /** Checagem da Receita feita pela AIVA. Desde 18/09 vem na API pública
   *  (antes só no banco do portal): valid · invalid · not_found · inapta ·
   *  baixada · suspensa · pending (= ainda não conferido, NÃO é irregular). */
  cnpj_check_status?: string | null
  cnpj_situacao?: string | null
  cnpj_check_reason?: string | null
  updated_at?: string | null
  /** Selfie do lojista: pendente · aprovado · negado. `stage` não conta essa
   *  história sozinho — aprovado com stage=biometria é a loja esperando a AIVA. */
  biometry_status?: string | null
  /** Coluna do quadro Onboarding da AIVA (Mauricio, 07/10/2026): not_approved · pre_cadastro ·
   *  dados_varejo · biometria_pendente · biometria_aprovada · cadastro_finalizado ·
   *  treinamento_agendado · pronto_para_operar. É ela que o funil 15 espelha. */
  board_column?: string | null
  board_column_since?: string | null
  /** Primeiro acesso do lojista à ferramenta (Karol/AIVA, 07/10/2026). null = nunca entrou. */
  primeiro_acesso_em?: string | null
}
export type RegistroCnpj = { id: string | number; cnpj: string | number; lead_id: string | null; status: string | null; rid?: string | number | null; criado_em?: string | null }
export type LeadEspelho = {
  id: string
  nome: string | null
  status: string
  evotalks_opportunity_id: string | number | null
  observacoes: string | null
}
export type Movimento = {
  lead_id: string
  nome: string
  opp: number
  de: number
  para: number
  /** etapas intermediárias por onde o card passa antes de `para` (ex.: [70]) */
  via: number[]
  motivo: string
}
export type Reprovado = {
  lead_id: string
  nome: string
  opp: number
  /** etapa atual do card (de onde sai pra 95) */
  de: number
  cnpj: string
  loja: string | null
  /** já tinha [PORTAL_REPROVADO] — não avisa de novo, só move/trava */
  jaAvisado: boolean
}
export type Pulado = { lead_id: string; nome: string; motivo: string }
/** Reprovado no portal, mas com sinal de loja operando (card em Vendendo, RID ou registro ativo): não move, o time confere. */
export type Conferir = { lead_id: string; nome: string; opp: number; de: number; cnpj: string; loja: string | null; motivo: string; jaAvisado: boolean }
export type Entrada = {
  onboardings: OnbApi[]
  /** retailer_ids com credentials_sent_at preenchido em login_sends */
  loginEnviado: Set<string>
  /** retailer_ids OPERANDO: n_vendas > 0 ou n_consultas > 0 em algum mês de retailer_performance
   *  (o nome ficou `vendeu` por histórico; consulta entrou em 28/09/2026) */
  vendeu: Set<string>
  registros: RegistroCnpj[]
  leads: LeadEspelho[]
  /** opp id → fkStage (todas as opps abertas do funil 15) */
  stageAtual: Map<number, number>
}
export type Resultado = {
  movimentos: Movimento[]
  reprovados: Reprovado[]
  /** ids de sdr_registros_cnpj que ganham status pre_cadastro_enviado */
  registrosEnviados: Array<string | number>
  pulados: Pulado[]
  conferir: Conferir[]
}

/** Funil 15 = quadro Onboarding da AIVA, coluna por coluna, do formulário até "Pronto para operar"
 *  (Aldo 07/10/2026). Nomes no Evo: 50 Formulário do varejo pendente · 96 Biometria pendente ·
 *  97 Biometria aprovada · 70 Cadastro finalizado · 98 Treinamento agendado · 71 Pronto para operar.
 *  Antes e depois disso o funil é nosso (prospecção até Cadastro Recebido; 51 = loja que consulta/vende). */
export const ETAPA = {
  EM_ANALISE: 50, BIO_PENDENTE: 96, BIO_APROVADA: 97, TREINAR: 70, TREINO_AGENDADO: 98, LOGIN: 71, PRIMEIRO_ACESSO: 99, VENDENDO: 51, REPROVADO: 95,
} as const
/** Mesma progressão linear do ORDEM_FUNIL de lib/evotalks (duplicada aqui pra manter este módulo sem imports). */
export const ORDEM: Record<number, number> = { 66: 0, 47: 1, 54: 2, 49: 3, 50: 4, 96: 5, 97: 6, 70: 7, 98: 8, 71: 9, 99: 10, 51: 11 }
/** Etapas que ESPELHAM uma coluna da AIVA: aqui o card segue a coluna mesmo pra trás (ex.: Treinamento
 *  agendado volta pra Cadastro finalizado 4h depois da turma). Fora delas o espelho só avança. */
export const BLOCO_AIVA = new Set<number>([50, 96, 97, 70, 98, 71, 99])
/** Coluna da AIVA → etapa do Evo. not_approved e pre_cadastro ficam fora (reprovação tem trilha própria;
 *  pré-cadastro é o nosso Cadastro Recebido, que anda pelo /registros). */
export const COLUNA_PARA_ETAPA: Record<string, number> = {
  dados_varejo: 50, biometria_pendente: 96, biometria_aprovada: 97,
  cadastro_finalizado: 70, treinamento_agendado: 98, pronto_para_operar: 71, primeiro_acesso: 99,
}
const ROTULO_COLUNA: Record<number, string> = {
  50: 'formulário do varejo pendente', 96: 'biometria pendente', 97: 'biometria aprovada — falta a AIVA criar a loja',
  70: 'cadastro finalizado', 98: 'treinamento agendado', 71: 'pronto para operar', 99: 'primeiro acesso',
}
const SEM_RESPOSTA = 53
const NAO_MEXER = new Set([69, 93, 94, 95])
const STATUS_TERMINAL = new Set(['OPT_OUT', 'NAO_QUALIFICADO', 'DESCARTADO', 'BOT_DETECTADO'])
export const MARCADOR_REPROVADO = 'PORTAL_REPROVADO'
export const MARCADOR_CONFERIR = 'PORTAL_REPROVADO_CONFERIR'
/** Motivo do movimento pra Biometria aprovada (97): o espelho grava [ONB_ETAPA:aguardando_aiva] antes de mover.
 *  (A regra de 06/10 "biometria aprovada → Treinar" foi substituída pela etapa própria em 07/10/2026.) */
export const MOTIVO_BIO_APROVADA = 'biometria aprovada — falta a AIVA criar a loja'

export const soDigitos = (c: unknown): string => String(c ?? '').replace(/\D/g, '')

/** Etapa do Evo que o portal "pede" pra este onboarding; null = ainda no pré-cadastro ou reprovado. */
export function etapaDesejada(onb: OnbApi, loginEnviado: Set<string>, vendeu: Set<string>): number | null {
  const rid = onb.retailer_id != null && String(onb.retailer_id) !== '' ? String(onb.retailer_id) : null
  // consulta/venda é nosso (51) e vence a coluna da AIVA
  if (rid && vendeu.has(rid)) return ETAPA.VENDENDO
  // a coluna do quadro da AIVA manda (07/10/2026)
  if (onb.board_column) return COLUNA_PARA_ETAPA[onb.board_column] ?? null
  // cadastro antigo sem board_column: dedução pelo stage + biometria (regra de antes)
  if (rid && onb.primeiro_acesso_em) return ETAPA.PRIMEIRO_ACESSO
  if (rid && loginEnviado.has(rid)) return ETAPA.LOGIN
  if (onb.stage === 'cadastro_finalizado' || rid) return ETAPA.TREINAR
  if (onb.stage === 'biometria') return String(onb.biometry_status ?? '').toLowerCase() === 'aprovado' ? ETAPA.BIO_APROVADA : ETAPA.BIO_PENDENTE
  if (onb.stage === 'dados_varejo') return ETAPA.EM_ANALISE
  return null
}

const ordem = (stage: number | null | undefined): number => (stage == null ? -1 : ORDEM[stage] ?? -1)

export function calcularEspelho(e: Entrada): Resultado {
  const onbPorCnpj = new Map<string, OnbApi>()
  for (const o of e.onboardings) {
    const c = soDigitos(o.cnpj)
    if (c.length === 14) onbPorCnpj.set(c, o)
  }
  const leadPorId = new Map(e.leads.map((l) => [l.id, l]))
  const registrosPorLead = new Map<string, RegistroCnpj[]>()
  for (const r of e.registros) {
    if (!r.lead_id) continue
    const g = registrosPorLead.get(r.lead_id)
    if (g) g.push(r)
    else registrosPorLead.set(r.lead_id, [r])
  }

  const out: Resultado = { movimentos: [], reprovados: [], registrosEnviados: [], pulados: [], conferir: [] }

  for (const [leadId, regs] of registrosPorLead) {
    const lead = leadPorId.get(leadId)
    if (!lead) continue
    const nome = (lead.nome ?? '').trim() || leadId

    // 1) registros "informada" cujo CNPJ já existe no portal = pré-cadastro foi enviado
    //    (o Nei não precisa mais marcar o checkbox no /registros).
    let melhor: { para: number; onb: OnbApi } | null = null
    let reprovadoEm: OnbApi | null = null
    for (const r of regs) {
      const onb = onbPorCnpj.get(soDigitos(r.cnpj))
      if (!onb) continue
      if (r.status == null || r.status === 'informada') out.registrosEnviados.push(r.id)
      const para = etapaDesejada(onb, e.loginEnviado, e.vendeu)
      if (para != null) {
        if (!melhor || ordem(para) > ordem(melhor.para)) melhor = { para, onb }
      } else if (onb.stage === 'not_approved') {
        reprovadoEm = onb
      }
    }

    const oppId = lead.evotalks_opportunity_id != null ? Number(lead.evotalks_opportunity_id) : NaN
    const opp = Number.isFinite(oppId) && oppId > 0 ? oppId : null

    // 2a) LOJA QUE OPERA E TEM OUTRO CNPJ REPROVADO (achado 24/09/2026).
    //     Quando o lead tem mais de um CNPJ e UM deles avança, `melhor` fica
    //     preenchido e o bloco de reprovação abaixo nunca era alcançado — a
    //     reprovação do outro CNPJ sumia, nem como "conferir".
    //     Caso real: DHtech e Pulse — matriz 47640647000141 vendendo (RID 5643) e
    //     filial 49357065000188 reprovada no portal. A loja opera, então NÃO se
    //     move card nenhum; mas o time precisa saber que a AIVA recusou a filial.
    //     Entra na fila de CONFERIR, que é exatamente o balcão desse caso.
    if (melhor && reprovadoEm && opp != null) {
      const atualOper = e.stageAtual.get(opp)
      if (atualOper != null && !NAO_MEXER.has(atualOper)) {
        out.conferir.push({
          lead_id: leadId, nome, opp, de: atualOper,
          cnpj: soDigitos(reprovadoEm.cnpj), loja: reprovadoEm.legal_name ?? null,
          motivo: 'outro CNPJ do lojista avançou, mas este foi reprovado pela AIVA',
          jaAvisado: (lead.observacoes ?? '').includes(`[${MARCADOR_CONFERIR}:`),
        })
      }
    }

    // 2) reprovado pela AIVA (e nenhum outro CNPJ do lead seguiu adiante) → etapa 95.
    //    Vale de qualquer etapa e de qualquer status que não seja OPT_OUT: reprovado é
    //    reprovado. Quem já está em 95 (ou bot/93/94) não é tocado.
    if (!melhor && reprovadoEm) {
      const jaAvisado = (lead.observacoes ?? '').includes(`[${MARCADOR_REPROVADO}:`)
      if (lead.status === 'OPT_OUT') { out.pulados.push({ lead_id: leadId, nome, motivo: 'reprovado pela AIVA, mas OPT_OUT' }); continue }
      if (!opp) { out.pulados.push({ lead_id: leadId, nome, motivo: 'reprovado pela AIVA, sem oportunidade no Evo' }); continue }
      const atual = e.stageAtual.get(opp)
      if (atual == null) { out.pulados.push({ lead_id: leadId, nome, motivo: `reprovado pela AIVA, opp #${opp} não está aberta no funil 15` }); continue }
      if (NAO_MEXER.has(atual)) continue
      // Sinal de loja operando contradiz o "reprovado" (ex.: Vandertech, reprovado no
      // portal mas com RID e vendas): não descarta sozinho — o time confere.
      const comRid = regs.filter((r) => r.rid != null && String(r.rid) !== '' || r.status === 'ativa')
      const sinal = atual === ETAPA.VENDENDO ? 'card em Loja Finalizada e Vendendo' : comRid.length ? `RID ${comRid.map((r) => r.rid ?? 'ativa').join('/')} no registro` : null
      const base = { lead_id: leadId, nome, opp, de: atual, cnpj: soDigitos(reprovadoEm.cnpj), loja: reprovadoEm.legal_name ?? null }
      if (sinal) {
        out.conferir.push({ ...base, motivo: sinal, jaAvisado: (lead.observacoes ?? '').includes(`[${MARCADOR_CONFERIR}:`) })
        continue
      }
      out.reprovados.push({ ...base, jaAvisado })
      continue
    }
    if (!melhor) continue

    // 3) avanço do card
    if (STATUS_TERMINAL.has(lead.status)) { out.pulados.push({ lead_id: leadId, nome, motivo: `status terminal ${lead.status}` }); continue }
    if (!opp) { out.pulados.push({ lead_id: leadId, nome, motivo: 'lead sem oportunidade no Evo' }); continue }
    const atual = e.stageAtual.get(opp)
    if (atual == null) { out.pulados.push({ lead_id: leadId, nome, motivo: `opp #${opp} não está aberta no funil 15` }); continue }
    if (NAO_MEXER.has(atual)) { out.pulados.push({ lead_id: leadId, nome, motivo: `card em etapa ${atual} (não mexe)` }); continue }
    // Avança sempre; dentro do bloco que espelha a AIVA, SEGUE a coluna também pra trás (07/10/2026).
    // Fora dele (Vendendo, etapas laterais) nunca regride.
    // Card em Vendendo (51) SEM consulta nem venda (as ações em massa de set/2026 punham ali loja só "pronta"):
    // 51 é loja que opera, então ele volta pra coluna real da AIVA (Karol, 07/10/2026 — 30 lojas nunca acessaram).
    const em51SemOperar = atual === ETAPA.VENDENDO && melhor.para !== ETAPA.VENDENDO && BLOCO_AIVA.has(melhor.para)
    const segueColuna = (BLOCO_AIVA.has(atual) || em51SemOperar) && BLOCO_AIVA.has(melhor.para) && melhor.para !== atual
    const podeMover = atual === SEM_RESPOSTA || ordem(melhor.para) > ordem(atual) || segueColuna
    if (!podeMover) continue   // já está igual ou além — silêncio, é o caso normal

    // Pulando Cadastro finalizado (70) pra frente, passa por ela: é a entrada da 70 que manda o treinamento
    // (HSM 69 + kit, uma vez só — o handler não repete). Pra trás nunca passa por nada.
    const via: number[] = []
    if (ordem(melhor.para) > ORDEM[ETAPA.TREINAR] && ordem(atual) < ORDEM[ETAPA.TREINAR]) via.push(ETAPA.TREINAR)
    const rid = melhor.onb.retailer_id != null ? String(melhor.onb.retailer_id) : ''
    const motivo =
      melhor.para === ETAPA.VENDENDO ? `venda ou consulta registrada no portal (RID ${rid})`
      : melhor.para === ETAPA.BIO_APROVADA ? MOTIVO_BIO_APROVADA
      : `portal da AIVA em ${ROTULO_COLUNA[melhor.para] ?? melhor.onb.stage}${rid ? ` (RID ${rid})` : ''}`
    out.movimentos.push({ lead_id: leadId, nome, opp, de: atual, para: melhor.para, via, motivo })
  }

  return out
}

/** Situação do cadastro quando ele ainda NÃO virou loja na AIVA. Vem de `stage`
 *  + `biometry_status`, porque o stage sozinho mente: cadastro com a selfie já
 *  aprovada fica parado em `biometria` enquanto a AIVA não cria o retailer_id.
 *  Ordem = do mais longe do fim pro mais perto (o pior CNPJ do lojista manda). */
export const ONB_ORDEM = ['dados_varejo', 'biometria_negada', 'biometria', 'aguardando_aiva'] as const
export type OnbSituacao = (typeof ONB_ORDEM)[number]

/** null = cadastro fechado (ou etapa que não interessa à conversa). */
export function situacaoOnb(stage: string, bio: string | null | undefined): OnbSituacao | null {
  if (stage === 'dados_varejo') return 'dados_varejo'
  if (stage !== 'biometria') return null
  const b = (bio ?? '').toLowerCase()
  if (b === 'aprovado') return 'aguardando_aiva'   // ele fez tudo; falta a AIVA criar a loja
  if (b === 'negado') return 'biometria_negada'    // precisa REFAZER a selfie
  return 'biometria'
}

