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
 *   - login_sends.credentials_sent_at preenchido             → 71 Login
 *   - alguma venda em retailer_performance                    → 51 Vendendo
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
}
export type RegistroCnpj = { id: string | number; cnpj: string | number; lead_id: string | null; status: string | null; rid?: string | number | null }
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
  /** retailer_ids com n_vendas > 0 em algum mês de retailer_performance */
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

export const ETAPA = { EM_ANALISE: 50, TREINAR: 70, LOGIN: 71, VENDENDO: 51, REPROVADO: 95 } as const
/** Mesma progressão linear do ORDEM_FUNIL de lib/evotalks (duplicada aqui pra manter este módulo sem imports). */
export const ORDEM: Record<number, number> = { 66: 0, 47: 1, 54: 2, 49: 3, 50: 4, 70: 5, 71: 6, 51: 7 }
const SEM_RESPOSTA = 53
const NAO_MEXER = new Set([69, 93, 94, 95])
const STATUS_TERMINAL = new Set(['OPT_OUT', 'NAO_QUALIFICADO', 'DESCARTADO', 'BOT_DETECTADO'])
export const MARCADOR_REPROVADO = 'PORTAL_REPROVADO'
export const MARCADOR_CONFERIR = 'PORTAL_REPROVADO_CONFERIR'

export const soDigitos = (c: unknown): string => String(c ?? '').replace(/\D/g, '')

/** Etapa do Evo que o portal "pede" pra este onboarding; null = ainda no pré-cadastro ou reprovado. */
export function etapaDesejada(onb: OnbApi, loginEnviado: Set<string>, vendeu: Set<string>): number | null {
  const rid = onb.retailer_id != null && String(onb.retailer_id) !== '' ? String(onb.retailer_id) : null
  if (rid && vendeu.has(rid)) return ETAPA.VENDENDO
  if (rid && loginEnviado.has(rid)) return ETAPA.LOGIN
  if (onb.stage === 'cadastro_finalizado' || rid) return ETAPA.TREINAR
  if (onb.stage === 'dados_varejo' || onb.stage === 'biometria') return ETAPA.EM_ANALISE
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
    const podeAvancar = atual === SEM_RESPOSTA || ordem(melhor.para) > ordem(atual)
    if (!podeAvancar) continue   // já está igual ou além — silêncio, é o caso normal

    const via: number[] = []
    if (ordem(melhor.para) >= ORDEM[ETAPA.TREINAR] && ordem(atual) < ORDEM[ETAPA.TREINAR] && melhor.para !== ETAPA.TREINAR) via.push(ETAPA.TREINAR)
    const rid = melhor.onb.retailer_id != null ? String(melhor.onb.retailer_id) : ''
    const motivo =
      melhor.para === ETAPA.VENDENDO ? `venda registrada no portal (RID ${rid})`
      : melhor.para === ETAPA.LOGIN ? `senha enviada pela AIVA (RID ${rid})`
      : melhor.para === ETAPA.TREINAR ? `cadastro finalizado no portal${rid ? ` (RID ${rid})` : ''}`
      : `pré-cadastro aprovado, portal em ${melhor.onb.stage}`
    out.movimentos.push({ lead_id: leadId, nome, opp, de: atual, para: melhor.para, via, motivo })
  }

  return out
}
