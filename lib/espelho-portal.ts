/**
 * Espelho portal → Evo — parte de IO (portal, Supabase, Evo, WhatsApp).
 *
 * Lê o estado do Portal Parceiros AIVA e AVANÇA o card do lead no funil 15 do
 * Evo pra etapa que o portal pede. Mover pela API dispara a automação do Evo
 * (comprovado 11/09: 15 movimentos via API = 15 webhooks em /opportunity-stage
 * no mesmo minuto), então HSM de aprovação/treinamento, avisos ao Nei/Aldo e
 * status no painel saem pelos handlers que já existem — este módulo NÃO manda
 * mensagem ao lojista e NÃO chama a rota de etapa.
 *
 * Fontes:
 *   - onboardings: API pública do parceiro (chave) — etapa, pré-cadastro, RID, board_column,
 *     primeiro_acesso_em. Login/Vendendo saem da COLUNA do quadro (board_column), não mais do
 *     banco do portal: a AIVA desligou o login em 26/10/2026 e login_sends/retailer_performance
 *     deixaram de ser legíveis (ver sinaisPortal e docs/Analise-recuperar-dados-portal-pos-login-2026-11-16.md).
 *
 * Regras de decisão: lib/espelho-portal-calc.ts (puro, testado).
 * Spec: docs/superpowers/specs/2026-09-16-espelho-portal-evo-design.md
 */
import { supabaseAdmin } from '@/lib/supabase'
import { changeOpportunityStage, getOpportunity, getPipeOpportunities, sendTemplate, sendText, STAGE_TO_STATUS } from '@/lib/evotalks'
import { candidatos as candidatosVinculo, variantesTelefone, vinculos } from '@/lib/vinculo-portal-calc'
import { leadsEmSilencio, registrarAvisos, resolverAvisos } from '@/lib/avisos-painel'
import { RODAPE_PAINEL } from '@/lib/avisos-painel-calc'
import { listarOnboardingsApi } from '@/lib/portal-aiva'
import {
  calcularEspelho, colunaDesconhecida, soDigitos, ETAPA, MARCADOR_REPROVADO, MARCADOR_CONFERIR, MOTIVO_BIO_APROVADA, situacaoOnb,
  MARCADOR_DERRUBADO, MOTIVO_DERRUBADO,
  preCadastroNaoChegou, PRE_CAD_HORAS, type PreCadastroEstado,
  registrosDoCard, etapaOnbPorLead, SITUACAO_REAL,
  type LeadEspelho, type Movimento, type OnbApi, type RegistroCnpj, type Resultado,
} from '@/lib/espelho-portal-calc'
import { detectarRepeticao, linhaRepetido, PREFIXO_CHAVE, type LinhaLog } from '@/lib/espelho-repeticao-calc'
import { avisarEquipe } from '@/lib/alerta-equipe'
import { enviarUtilidadeOu, TPL_ETAPA } from '@/lib/template-utilidade'
import { montar, type MsgUtilidade } from '@/lib/template-utilidade-calc'
import {
  FLUXO_LOJA_NOVA, LINK_CADASTRO, pendentesLink, pendentesCriada, recusadas, filaParadaLojaNova, textoLinkLojaNova, textoLojaCriada,
  textoRecusadaLojaNova, utilRecusadaLojaNova, chaveRecusaAvisadaLojaNova, rotuloEnvioLojaNova,
  chaveLinkLojaNova, chaveCriadaLojaNova, chaveRecusadaLojaNova, chaveFilaParada, PREFIXO_FILA_PARADA, colunaLojaNovaAusente,
  lojaTemplateLojaNova, utilLojaCriada, utilLinkLojaNova, linhaCuraLojaNova, blocoCuraLojaNova, type OnbLojaNova, type RegLojaNovaFila,
  decidirFalhaEnvio, tentativasDe, chaveTentativaLojaNova, chaveRetidoLojaNova,
} from '@/lib/loja-nova-calc'

const PIPELINE_AIVA = 15
/** Teto por rodada: cada movimento dispara automação + HSM do lado do Evo. */
const TETO_MOVIMENTOS = 30
/** Virada do funil pro quadro da AIVA (Aldo 07/10/2026, decisão 4): até esta hora TODO movimento do espelho é
 *  silencioso — grava [MOVE_SILENCIOSO:<etapa>] antes de mover, e o /opportunity-stage só atualiza o status, sem
 *  HSM, texto ou alerta. Depois dela, só com ?silencioso. Entrada na 51 nunca é silenciosa (cria a conta MRR). */
const VIRADA_SILENCIOSA_ATE = '2026-10-07T21:00:00Z'
const TETO_MS = 200_000
/** Soneca do "Resolvido" no aviso de pré-cadastro que não chegou (15/10/2026). Quem clica está
 *  dizendo "reenviei", e o reenvio aparece no portal na importação seguinte da AIVA (de hora em
 *  hora). Passadas 6h ainda travado, o reenvio não resolveu e o aviso volta — antes ele sumia
 *  para sempre e a VictorIA seguia dizendo ao lojista que o nosso time estava finalizando. */
const SILENCIO_PRE_CAD_MS = 6 * 3_600_000
/** Quanto da trilha a regra de repetição olha. 4 h cobre com folga as 4 rodadas (15 min cada) do limite. */
const JANELA_TRILHA_MS = 4 * 3_600_000
export const MARCADOR_ESPELHO = 'ESPELHO_PORTAL'
/** CNPJ com situação real ruim na Receita (inapta/baixada/suspensa) segundo a AIVA. */
export const MARCADOR_CNPJ_IRREGULAR = 'CNPJ_IRREGULAR_AIVA'
/** CNPJ que não fecha (DV inválido / não consta) — quase sempre erro de digitação no portal. */
export const MARCADOR_CNPJ_INVALIDO = 'CNPJ_PORTAL_INVALIDO'
/** Etapa do onboarding da AIVA quando ele AINDA NÃO fechou: dados_varejo | biometria.
 *  A VictorIA usa isso pra não falar de senha com quem nem terminou o cadastro
 *  (regra do Aldo 18/09/2026 — é a msg que o Nei manda na mão hoje). */
export const MARCADOR_ONB_ETAPA = 'ONB_ETAPA'
/** CNPJ que não fecha — quase sempre erro de digitação no portal. */
const CNPJ_NAO_FECHA = new Set(['invalid', 'not_found'])
// ⚠️ 'pending' (a AIVA ainda não conferiu) e 'valid' NÃO entram em nenhum dos dois.
// Sem essa separação, um CNPJ só porque ainda não foi checado apareceria pro Nei
// como "não confere" — achado de 18/09, quando o status pending passou a existir.

/**
 * Login enviado e loja operando — derivados da COLUNA do quadro da AIVA, que vem na própria API
 * pública de onboardings. ⚠️ 26/10/2026: a AIVA desligou o login no banco do portal, então
 * `login_sends.credentials_sent_at` e `retailer_performance` (que vinham com senha) pararam. A coluna
 * cobre o mesmo sinal: `primeira_venda` = loja operando (→ 51); `pronto_para_operar`/`primeiro_acesso`/
 * `primeira_venda` ou `primeiro_acesso_em` preenchido = acesso liberado (→ Login). `etapaDesejada` já lê
 * `board_column` direto; estes Sets só reforçam e cobrem o caminho antigo de cadastro sem board_column.
 * O que NÃO dá mais pra saber pela API: "pediu a senha e ela não chegou" (contagens e login_sends exatos)
 * — isso depende de a AIVA expor na API (ver docs/Analise-recuperar-dados-portal-pos-login-2026-11-16.md).
 */
function sinaisPortal(onboardings: OnbApi[]): { loginEnviado: Set<string>; vendeu: Set<string> } {
  const loginEnviado = new Set<string>()
  const vendeu = new Set<string>()
  for (const o of onboardings) {
    const rid = o.retailer_id != null && String(o.retailer_id) !== '' ? String(o.retailer_id) : null
    if (!rid) continue
    if (o.board_column === 'primeira_venda') vendeu.add(rid)
    if (o.board_column === 'primeira_venda' || o.board_column === 'primeiro_acesso' || o.board_column === 'pronto_para_operar' || o.primeiro_acesso_em) loginEnviado.add(rid)
  }
  return { loginEnviado, vendeu }
}

/** Colunas do registro. `enviado_em` entrou em 15/10/2026 (docs/sql/2026-10-15-pre-cadastro-enviado-em.sql):
 *  enquanto o SQL não for aplicado, pedi-la derruba o SELECT inteiro — e com ele a rodada do espelho, que
 *  move card. Por isso o primeiro erro de coluna faz a rodada cair pro conjunto antigo (o relógio do passo 11
 *  volta pro `criado_em`, que é o que já acontecia antes). Depois do SQL aplicado, nunca mais cai aqui. */
//  `fluxo` entrou em 19/11/2026 (docs/sql/2026-11-19-loja-nova-empresa.sql), com a mesma tolerância: sem a
//  coluna, nenhuma linha é do fluxo da loja nova e a rodada fica idêntica à de antes.
const COLS_REGISTRO = 'id,cnpj,lead_id,status,rid,criado_em,enviado_em,fluxo'
const COLS_REGISTRO_SEM_FLUXO = 'id,cnpj,lead_id,status,rid,criado_em,enviado_em'
const COLS_REGISTRO_ANTIGO = 'id,cnpj,lead_id,status,rid,criado_em'

async function registrosComLead(): Promise<RegistroCnpj[]> {
  const out: RegistroCnpj[] = []
  let cols = COLS_REGISTRO
  for (let de = 0; ; de += 1000) {
    const ler = () => supabaseAdmin
      .from('sdr_registros_cnpj')
      .select(cols)
      .not('lead_id', 'is', null)
      .order('id', { ascending: true })
      .range(de, de + 999)
    let { data, error } = await ler()
    // 42703 = undefined_column no Postgres; o PostgREST também devolve a coluna no texto do erro.
    // Cai um degrau por vez: sem `fluxo` → sem `enviado_em` também.
    while (error && cols !== COLS_REGISTRO_ANTIGO && (error.code === '42703' || /fluxo|enviado_em/.test(error.message))) {
      if (cols === COLS_REGISTRO) {
        cols = COLS_REGISTRO_SEM_FLUXO
        console.warn('[espelho] sdr_registros_cnpj sem a coluna fluxo — nenhuma linha tratada como loja nova (aplicar docs/sql/2026-11-19-loja-nova-empresa.sql)')
      } else {
        cols = COLS_REGISTRO_ANTIGO
        console.warn('[espelho] sdr_registros_cnpj sem a coluna enviado_em — rodada usando criado_em (aplicar docs/sql/2026-10-15-pre-cadastro-enviado-em.sql)')
      }
      ;({ data, error } = await ler())
    }
    if (error) throw new Error(`sdr_registros_cnpj: ${error.message}`)
    out.push(...((data ?? []) as unknown as RegistroCnpj[]))
    if (!data || data.length < 1000) break
  }
  return out
}

async function leadsPorIds(ids: string[]): Promise<LeadEspelho[]> {
  const out: LeadEspelho[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('sdr_leads')
      .select('id,nome,status,evotalks_opportunity_id,observacoes')
      .in('id', ids.slice(i, i + 200))
    if (error) throw new Error(`sdr_leads: ${error.message}`)
    out.push(...((data ?? []) as unknown as LeadEspelho[]))
  }
  return out
}

/** Troca o marcador [X:...] nas observações (um só por lead) — re-lê antes pra não pisar em escrita concorrente. */
async function marcar(leadId: string, marcador: string, valor: string): Promise<void> {
  const { data } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', leadId).maybeSingle()
  const obs = (data?.observacoes ?? '').replace(new RegExp(`\\s*\\[${marcador}:[^\\]]*\\]`, 'g'), '').trim()
  await supabaseAdmin.from('sdr_leads').update({ observacoes: `${obs} [${marcador}:${valor}]`.trim() }).eq('id', leadId)
}

/** Tira o marcador [X:...] do lead (CNPJ voltou a ficar regular). */
/** Tira o marcador [X:...] do lead. Devolve true se REALMENTE removeu algo.
 *  ⚠️ O escape tem que ser duplo (`\\s`, `\\[`) porque isto é template literal: com
 *  barra simples o JS engole o escape e o regex vira `s*[...` — que não casa com
 *  nada. Foi o que aconteceu em 17/09: a função dizia ter limpado 3 marcadores e
 *  não limpava nenhum. O `marcar` acima sempre teve o escape certo. */
async function desmarcar(leadId: string, marcador: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', leadId).maybeSingle()
  const obs = (data?.observacoes ?? '')
  const limpo = obs.replace(new RegExp(`\\s*\\[${marcador}:[^\\]]*\\]`, 'g'), '').trim()
  if (limpo === obs.trim()) return false
  const { error } = await supabaseAdmin.from('sdr_leads').update({ observacoes: limpo }).eq('id', leadId)
  return !error
}

/** Trilha de cada movimento (docs/sql/2026-10-15-sdr-etapa-log.sql) — lacuna 3 da auditoria de 15/10/2026.
 *  BEST-EFFORT de propósito: antes disso o movimento só existia no `console.log` da Vercel, mas a trilha
 *  não vale derrubar uma rodada que já moveu cards. Falha só vira log de erro. */
async function gravarEtapaLog(linhas: Array<Movimento & { ok: boolean; erro?: string }>): Promise<void> {
  if (!linhas.length) return
  try {
    const { error } = await supabaseAdmin.from('sdr_etapa_log').insert(
      linhas.map((m) => ({
        lead_id: m.lead_id, nome: m.nome, opp: m.opp, de: m.de, para: m.para,
        via: m.via.length ? m.via : null, motivo: m.motivo, ok: m.ok, erro: m.erro ?? null,
      })),
    )
    if (error) throw new Error(error.message)
  } catch (e) {
    console.error('[espelho-portal] trilha sdr_etapa_log não gravada (a rodada segue):', String(e).slice(0, 200))
  }
}

/** Movimentos recentes das opps desta rodada, pra regra de repetição. Falha de leitura devolve trilha
 *  vazia: sem histórico ninguém é acusado de travado (melhor calar que avisar errado). */
async function historicoEtapas(opps: number[]): Promise<LinhaLog[]> {
  if (!opps.length) return []
  const desde = new Date(Date.now() - JANELA_TRILHA_MS).toISOString()
  try {
    const { data, error } = await supabaseAdmin
      .from('sdr_etapa_log')
      .select('opp,de,para,criado_em')
      .in('opp', opps)
      .gte('criado_em', desde)
      .order('criado_em', { ascending: false })
      .limit(1000)
    if (error) throw new Error(error.message)
    return (data ?? []) as LinhaLog[]
  } catch (e) {
    console.error('[espelho-portal] trilha sdr_etapa_log não lida (repetição não avaliada):', String(e).slice(0, 200))
    return []
  }
}

// ─── 12) LOJA NOVA DE OUTRA EMPRESA (cliente ativo, Task 4 de 19/11/2026) ──────────────────────────
// Linhas de sdr_registros_cnpj com fluxo = 'loja_nova_empresa' (mesmo lead, tipo 'adicional'). POR CNPJ:
//   - pré-cadastro em dados_varejo na AIVA → link do cadastro ao lojista (uma vez, para sempre);
//   - AIVA criou a loja (retailer_id) → aviso "loja criada" (uma vez) e o RID na linha;
//   - AIVA recusou → aviso de recusa ao lojista (uma vez, Aldo 23/11/2026); o time só é avisado se não der pra enviar;
//   - na fila há 24h+ sem clique, ou clicado e não chegou → aviso ao time, 1×/dia por CNPJ.
// ⛔ Não move card nem toca marcador do lead: a loja principal dele já vende.
// IDEMPOTÊNCIA (cron de 15 min, mensagem real): duas travas por CNPJ. (1) o carimbo na linha
// (link_enviado_em / criada_avisada_em) — com ele a linha nem é selecionada; (2) a chave em sdr_avisos_chave,
// RESERVADA com insert ANTES do envio (duas rodadas juntas: a segunda bate no unique e não envia), solta se o
// envio não for aceito, e mantida se o carimbo falhar depois do envio — a rodada seguinte vê a chave, NÃO
// reenvia e só regrava o carimbo. Sem as colunas (SQL docs/sql/2026-11-19-loja-nova-empresa.sql não aplicado)
// o passo inteiro é pulado com console.warn e o resto da rodada segue igual.
const TETO_LOJA_NOVA = 10
const SEM_ENVIO_STATUS = new Set(['OPT_OUT', 'DESCARTADO', 'NAO_QUALIFICADO', 'BOT_DETECTADO'])
const ROTULO_LOJA_NOVA = 'aiva_loja_nova'

export type SaidaLojaNova = {
  /** null = passo rodou; 'colunas_ausentes' = SQL não aplicado; 'sem_tempo' = rodada já no teto; 'erro' = ver avisos */
  pulado: string | null
  links: number
  criadas: number
  recusadas: number
  paradas: number
  /** enviado numa rodada anterior cujo carimbo falhou: só regrava o carimbo, sem reenviar */
  curados: number
  /** ficou pra próxima rodada (teto de envios ou de tempo) */
  adiados: number
  /** lead sem telefone ou em status que não recebe mensagem */
  sem_destino: number
  /** envio retido (resposta ambígua do Evo ou 3 rejeições): aviso ao time, nada automático até liberar à mão */
  retidos: number
  falhas: number
}

/** Mesma regra do opportunity-stage: janela de 24 h aberta = última mensagem DO lojista há menos de 24 h. */
async function janela24hAberta(leadId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('sdr_mensagens').select('enviado_em')
    .eq('lead_id', leadId).eq('direcao', 'in').order('enviado_em', { ascending: false }).limit(1).maybeSingle()
  return !!data && Date.now() - new Date(data.enviado_em).getTime() < 24 * 3_600_000
}

type LeadDestino = { id: string; nome: string | null; status: string; telefone: string | null; observacoes: string | null }

/** Texto livre com a janela aberta; senão o template 86 (utilidade). Lança se o envio não for aceito.
 *  Devolve o texto como o lojista leu, pra gravar em sdr_mensagens. */
async function enviarLojaNova(lead: LeadDestino, texto: string, util: MsgUtilidade, loja: string): Promise<string> {
  const tel = lead.telefone!
  if (await janela24hAberta(lead.id)) {
    await sendText(tel, texto)
    return texto
  }
  const nome = ((lead.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1] ?? lead.nome ?? '').trim() || 'lojista'
  const m = montar(nome, loja, util)
  // sem template antigo pra este fluxo: com a chave de utilidade desligada (volta de emergência do 48),
  // sai pelo mesmo 86 — nada deste fluxo passa pelo coringa 48
  const env = await enviarUtilidadeOu(tel, { nome, loja, util }, () => sendTemplate(tel, TPL_ETAPA, m.vars))
  return env.conteudo ?? m.texto
}

async function passoLojaNova(
  dry: boolean,
  ctx: { onboardings: OnbApi[]; registros: RegistroCnpj[]; inicio: number; avisos: string[] },
): Promise<{ saida: SaidaLojaNova; blocos: string[] }> {
  const s: SaidaLojaNova = { pulado: null, links: 0, criadas: 0, recusadas: 0, paradas: 0, curados: 0, adiados: 0, sem_destino: 0, retidos: 0, falhas: 0 }
  const blocos: string[] = []
  if (!dry && Date.now() - ctx.inicio > TETO_MS) {
    s.pulado = 'sem_tempo'
    ctx.avisos.push('loja nova: rodada sem tempo — passo fica pra próxima')
    return { saida: s, blocos }
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('sdr_registros_cnpj')
      .select('id,lead_id,cnpj,fluxo,link_enviado_em,criada_avisada_em,enviado,criado_em')
      .eq('fluxo', FLUXO_LOJA_NOVA)
      .not('lead_id', 'is', null)
      .order('id', { ascending: true })
      .limit(1000)
    if (error) {
      if (colunaLojaNovaAusente(error)) {
        console.warn('[espelho-portal] loja nova: colunas fluxo/link_enviado_em/criada_avisada_em ausentes em sdr_registros_cnpj — passo pulado (aplicar docs/sql/2026-11-19-loja-nova-empresa.sql)')
        s.pulado = 'colunas_ausentes'
        return { saida: s, blocos }
      }
      throw new Error(`sdr_registros_cnpj (loja nova): ${error.message}`)
    }
    // enviado_em já veio no select da rodada (que tolera a coluna ausente) — não pedir de novo aqui
    const enviadoEm = new Map(ctx.registros.map((r) => [String(r.id), r.enviado_em ?? null]))
    const regs: RegLojaNovaFila[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string | number, lead_id: String(r.lead_id ?? ''), cnpj: soDigitos(r.cnpj), fluxo: (r.fluxo as string | null) ?? null,
      link_enviado_em: (r.link_enviado_em as string | null) ?? null, criada_avisada_em: (r.criada_avisada_em as string | null) ?? null,
      enviado: (r.enviado as boolean | null) ?? null, criado_em: (r.criado_em as string | null) ?? null, enviado_em: enviadoEm.get(String(r.id)) ?? null,
    }))
    if (!regs.length) return { saida: s, blocos }

    const onbs: OnbLojaNova[] = ctx.onboardings.map((o) => ({ cnpj: o.cnpj, stage: o.stage, retailer_id: o.retailer_id ?? null, legal_name: o.legal_name ?? null, pre_cadastro_status: o.pre_cadastro_status ?? null }))
    const agora = Date.now()
    const tarefas = [
      ...pendentesLink(regs, onbs).map((p) => ({ tipo: 'link' as const, ...p })),
      ...pendentesCriada(regs, onbs).map((p) => ({ tipo: 'criada' as const, ...p })),
      ...recusadas(regs, onbs).map((p) => ({ tipo: 'recusada' as const, ...p })),
    ]
    const paradas = filaParadaLojaNova(regs, onbs, agora)
    if (!tarefas.length && !paradas.length) return { saida: s, blocos }

    // sem conseguir ler as chaves não há como garantir "uma vez só": o passo inteiro espera a próxima rodada
    const { data: chRows, error: eCh } = await supabaseAdmin.from('sdr_avisos_chave').select('chave').like('chave', 'loja_nova_%')
    if (eCh) throw new Error(`sdr_avisos_chave (loja nova): ${eCh.message}`)
    const chaves = new Set((chRows ?? []).map((c) => c.chave as string))

    const ids = [...new Set([...tarefas, ...paradas].map((x) => x.reg.lead_id))]
    const { data: lds, error: eLd } = await supabaseAdmin.from('sdr_leads').select('id,nome,status,telefone,observacoes').in('id', ids)
    if (eLd) throw new Error(`sdr_leads (loja nova): ${eLd.message}`)
    const leadPorId = new Map(((lds ?? []) as LeadDestino[]).map((l) => [l.id, l]))
    const nomeLead = (id: string) => (leadPorId.get(id)?.nome ?? '').trim() || id

    // a) link, loja criada e recusa da AIVA ao lojista (recusa: Aldo 23/11/2026 — o lojista é avisado, o time não)
    let envios = 0
    const vistosRodada = new Set<string>()
    const linhasRet: string[] = []
    const linhasCura: string[] = []
    const linhasRec: string[] = []
    for (const t of tarefas) {
      const cnpj = t.reg.cnpj
      const chave = t.tipo === 'link' ? chaveLinkLojaNova(cnpj) : t.tipo === 'criada' ? chaveCriadaLojaNova(cnpj) : chaveRecusadaLojaNova(cnpj)
      const retido = chaveRetidoLojaNova(t.tipo, cnpj)
      // linha duplicada do mesmo CNPJ: uma tentativa por CNPJ e tipo por rodada; a outra linha se cura na próxima
      if (vistosRodada.has(chave)) continue
      vistosRodada.add(chave)
      // recusa já dita ao lojista: a linha não tem coluna de carimbo pra recusa, a chave "avisada" faz esse papel
      const avisada = chaveRecusaAvisadaLojaNova(cnpj)
      if (t.tipo === 'recusada' && chaves.has(avisada)) continue
      // envio retido (resposta ambígua do Evo ou 3 rejeições): nada automático — o time confere e reenvia à mão
      if (chaves.has(retido)) { s.retidos++; continue }
      const conta = () => { if (t.tipo === 'link') s.links++; else if (t.tipo === 'criada') s.criadas++; else s.recusadas++ }
      const carimbar = async (): Promise<{ code?: string; message: string } | null> => {
        if (t.tipo === 'recusada') {
          const { error } = await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: avisada, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
          if (!error) chaves.add(avisada)
          return error
        }
        const carimbo = t.tipo === 'link'
          ? { link_enviado_em: new Date().toISOString() }
          : { criada_avisada_em: new Date().toISOString(), rid: String(t.onb.retailer_id) }
        const { error } = await supabaseAdmin.from('sdr_registros_cnpj').update(carimbo).eq('id', t.reg.id)
        return error
      }
      if (chaves.has(chave)) {
        // já saiu numa rodada anterior e o carimbo não gravou: NÃO reenvia, só regrava o carimbo
        s.curados++
        if (dry) continue
        const eCur = await carimbar()
        if (eCur) { ctx.avisos.push(`loja nova ${cnpj}: carimbo de ${t.tipo} ainda não gravado (${eCur.message.slice(0, 80)}) — a chave ${chave} segura o reenvio`); continue }
        // cura nunca é calada (revisão final, item 5): a rodada pode ter morrido entre reservar e enviar
        const linha = linhaCuraLojaNova(nomeLead(t.reg.lead_id), cnpj, t.tipo)
        linhasCura.push(linha)
        ctx.avisos.push(`loja nova ${linha.slice(2)}`)
        continue
      }
      if (dry) { conta(); continue }
      if (envios >= TETO_LOJA_NOVA || Date.now() - ctx.inicio > TETO_MS) { s.adiados++; continue }
      const lead = leadPorId.get(t.reg.lead_id)
      if (!lead?.telefone || SEM_ENVIO_STATUS.has(String(lead.status))) {
        s.sem_destino++
        const porque = lead ? `em ${lead.status}${lead.telefone ? '' : ', sem telefone'}` : 'não encontrado'
        ctx.avisos.push(`loja nova ${cnpj}: ${t.tipo} não enviado — lead ${porque}`)
        // recusa que o robô não pode dizer ao lojista: o time fica sabendo, uma vez por CNPJ
        if (t.tipo === 'recusada') {
          const quando = new Date().toISOString()
          const { error: eK } = await supabaseAdmin.from('sdr_avisos_chave')
            .upsert([{ chave, ultimo_aviso: quando }, { chave: avisada, ultimo_aviso: quando }], { onConflict: 'chave' })
          if (eK) ctx.avisos.push(`loja nova ${cnpj}: chave da recusa não gravada — aviso ao time fica pra próxima rodada`)
          else { chaves.add(chave); chaves.add(avisada); linhasRec.push(`• ${nomeLead(t.reg.lead_id)} — CNPJ ${cnpj} · lead ${porque}`) }
        }
        continue
      }
      // trava 2: reserva ANTES de enviar. Falhou a reserva (outra rodada pegou, ou o banco recusou) = não envia.
      const { error: eRes } = await supabaseAdmin.from('sdr_avisos_chave').insert({ chave, ultimo_aviso: new Date().toISOString() })
      // 23505 = unique: outra rodada já reservou — não é falha, só não envia
      if (eRes?.code === '23505') { chaves.add(chave); continue }
      if (eRes) {
        s.falhas++
        ctx.avisos.push(`loja nova ${cnpj}: chave ${chave} não reservada (${eRes.code ?? ''} ${eRes.message.slice(0, 60)}) — ${t.tipo} NÃO enviado`)
        continue
      }
      envios++
      const razao = t.onb.legal_name ?? null
      const loja = lojaTemplateLojaNova(cnpj, razao)
      let conteudo: string
      try {
        conteudo = t.tipo === 'link'
          ? await enviarLojaNova(lead, textoLinkLojaNova(cnpj, razao), utilLinkLojaNova(LINK_CADASTRO), loja)
          : t.tipo === 'criada'
            ? await enviarLojaNova(lead, textoLojaCriada(razao), utilLojaCriada(), loja)
            : await enviarLojaNova(lead, textoRecusadaLojaNova(cnpj, razao), utilRecusadaLojaNova(), loja)
      } catch (e) {
        // Só a rejeição CLARA do Evo (4xx) solta a chave: timeout/5xx/rede podem ter saído — reenviar duplicaria.
        // Regra em decidirFalhaEnvio (lib/loja-nova-calc.ts).
        s.falhas++
        const erro = String(e)
        const anteriores = tentativasDe(chaves, t.tipo, cnpj)
        const d = decidirFalhaEnvio(erro, anteriores)
        if (d.conta) {
          const kT = chaveTentativaLojaNova(t.tipo, cnpj, anteriores + 1)
          const { error: eT } = await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: kT, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
          if (eT) console.error(`[espelho-portal] loja nova ${cnpj}: tentativa ${kT} não gravada:`, eT.message)
          chaves.add(kT)
        }
        let solta = d.acao === 'tentar_de_novo'
        if (solta) {
          const { error: eSolta } = await supabaseAdmin.from('sdr_avisos_chave').delete().eq('chave', chave)
          // não soltou: com a reserva presa a próxima rodada "curaria" o carimbo de algo que não saiu — retém
          if (eSolta) { console.error(`[espelho-portal] ⚠️ loja nova ${cnpj}: chave ${chave} não solta (${eSolta.message}) — envio retido`); solta = false }
          else chaves.delete(chave)
        }
        if (solta) {
          ctx.avisos.push(`loja nova ${cnpj}: ${t.tipo} recusado pelo Evo (${erro.slice(0, 100)}) — tenta de novo na próxima rodada`)
          continue
        }
        const { error: eRet } = await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: retido, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
        if (eRet) console.error(`[espelho-portal] ⚠️⚠️ loja nova ${cnpj}: chave ${retido} não gravada (${eRet.message}) — a próxima rodada vai carimbar ${t.tipo} como enviado sem ter certeza`)
        chaves.add(retido)
        s.retidos++
        const porque = d.acao === 'desistir' ? `recusado pelo Evo ${anteriores + 1}×`
          : d.acao === 'tentar_de_novo' ? 'recusado pelo Evo e a reserva não foi solta (não saiu)'
          : 'resposta ambígua do Evo (pode ter saído)'
        console.error(`[espelho-portal] ⚠️ loja nova ${cnpj}: ${t.tipo} RETIDO — ${porque}: ${erro.slice(0, 160)}`)
        ctx.avisos.push(`loja nova ${cnpj}: ${t.tipo} retido — ${porque}`)
        linhasRet.push(`• ${nomeLead(t.reg.lead_id)} — CNPJ ${cnpj} · ${rotuloEnvioLojaNova(t.tipo)} · ${porque}`)
        continue
      }
      // aceito → carimbo. Se falhar, a chave reservada fica e segura o reenvio.
      const eCar = await carimbar()
      if (eCar) {
        console.error(`[espelho-portal] ⚠️⚠️ loja nova ${cnpj}: ${t.tipo} ENVIADO ao lojista mas o carimbo NÃO gravou (${eCar.code ?? ''} ${eCar.message}) — a chave ${chave} em sdr_avisos_chave segura o reenvio; a próxima rodada regrava o carimbo`)
        ctx.avisos.push(`loja nova ${cnpj}: ${t.tipo} enviado, carimbo não gravado (chave ${chave} segura o reenvio)`)
      }
      const { error: eMsg } = await supabaseAdmin.from('sdr_mensagens').insert({ lead_id: lead.id, direcao: 'out', conteudo, template_hsm: ROTULO_LOJA_NOVA })
      if (eMsg) console.error(`[espelho-portal] loja nova ${cnpj}: sdr_mensagens não gravada:`, eMsg.message)
      console.log(`[espelho-portal] loja nova ${cnpj}: ${t.tipo} enviado → lead ${lead.id}`)
      conta()
    }
    if (linhasCura.length) blocos.push(blocoCuraLojaNova(linhasCura))
    if (linhasRet.length) {
      blocos.push(
        `⚠️ *Loja nova de cliente ativo: mensagem ao lojista pode não ter saído* (${linhasRet.length})\n${linhasRet.join('\n')}\n\n` +
        'O link da loja nova (ou o aviso de loja criada, ou o aviso de recusa da AIVA) pode não ter saído — conferir na conversa e reenviar à mão. ' +
        'O robô NÃO tenta de novo sozinho pra não mandar em dobro (pra liberar: apagar em sdr_avisos_chave as chaves loja_nova_<link|criada|recusada>:<cnpj> e loja_nova_retido:<tipo>:<cnpj>).',
      )
    }

    // b) recusa que o robô NÃO pôde dizer ao lojista (lead sem telefone ou em status que não recebe mensagem):
    //    só aí o time é avisado. Recusa dita ao lojista não gera aviso ao time (Aldo 23/11/2026).
    if (linhasRec.length) {
      blocos.push(
        `⛔ *Loja nova de cliente ativo RECUSADA pela AIVA — lojista NÃO avisado* (${linhasRec.length})\n${linhasRec.join('\n')}\n\n` +
        'A AIVA recusou o pré-cadastro da loja nova (outra empresa) e o robô não pôde avisar o lojista (lead sem telefone ou em status que não recebe mensagem). ' +
        'O card da loja principal não foi mexido.',
      )
    }

    // c) fila parada: aviso ao time 1×/dia por CNPJ (mesmo aviso do painel do passo 11)
    const linhasPar: string[] = []
    const vivasHoje = new Set<string>()
    for (const p of paradas) {
      const chave = chaveFilaParada(p.reg.cnpj, agora)
      vivasHoje.add(chave)
      if (chaves.has(chave)) continue
      chaves.add(chave) // linha duplicada do mesmo CNPJ: uma linha só no aviso
      s.paradas++
      if (dry) continue
      const { error: eK } = await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
      if (eK) { ctx.avisos.push(`loja nova ${p.reg.cnpj}: chave da fila parada não gravada — aviso fica pra próxima rodada`); s.paradas--; continue }
      const oque = p.motivo === 'sem_clique' ? `na fila há ${p.horas}h sem o "Abrir form"` : `"Abrir form" clicado há ${p.horas}h e não chegou à AIVA`
      const lead = leadPorId.get(p.reg.lead_id)
      await registrarAvisos('pre_cadastro_nao_chegou', [{ leadId: p.reg.lead_id, loja: lead?.nome ?? null, status: lead?.status ?? null, detalhe: `LOJA NOVA (outra empresa) CNPJ ${p.reg.cnpj} · ${oque}` }])
      linhasPar.push(`• ${nomeLead(p.reg.lead_id)} — CNPJ ${p.reg.cnpj} · ${oque}`)
    }
    if (!dry) {
      // chaves de dias anteriores saem: o aviso é diário, a chave só serve pro dia de hoje
      const velhas = [...chaves].filter((k) => k.startsWith(PREFIXO_FILA_PARADA) && !vivasHoje.has(k))
      if (velhas.length) await supabaseAdmin.from('sdr_avisos_chave').delete().in('chave', velhas)
    }
    if (linhasPar.length) {
      blocos.push(
        `📮 *Loja nova de cliente ativo parada no pré-cadastro* (${linhasPar.length})\n${linhasPar.join('\n')}\n\n` +
        'Pedido de loja nova (outra empresa) em Registros AIVA que não chegou à AIVA. Enviar o pré-cadastro pelo "Abrir form"; ' +
        'o link sai sozinho pro lojista quando a AIVA abrir o cadastro.' + RODAPE_PAINEL,
      )
    }
  } catch (e) {
    s.pulado = 'erro'
    ctx.avisos.push(`loja nova: passo falhou (${String(e).slice(0, 120)}) — o resto da rodada seguiu`)
    console.error('[espelho-portal] loja nova: passo falhou:', e)
  }
  return { saida: s, blocos }
}

export type SaidaEspelho = {
  ok: boolean
  dry: boolean
  avisos: string[]
  /** CNPJs do portal ligados a um lead pelo telefone nesta rodada (no dry: os que seriam) */
  vinculados: string[]
  onboardings: number
  leads: number
  movidos: Array<Movimento & { erro?: string }>
  sobraram: number
  reprovados: Resultado['reprovados']
  conferir: Resultado['conferir']
  registros_enviados: number
  pulados: Resultado['pulados']
  /** CNPJ reprovado na checagem da AIVA (colunas de 17/09): irregular = situação real; invalido = não fecha */
  cnpj: { irregular: number; invalido: number; novos: string[]; regularizados: number }
  /** cadastro do lojista ainda aberto no portal (form ou biometria) — contexto pra VictorIA */
  onboarding_aberto: { dados_varejo: number; biometria: number; aguardando_aiva: number; marcados: number; limpos: number }
  /** leads com pré-cadastro marcado como enviado há 24h+ que não chegou ao portal (no dry: os que seriam) */
  pre_cadastro_nao_chegou: string[]
  /** a AIVA tirou o cadastro do quadro (30+ dias em formulário pendente): card voltou pra Pré-aprovação (no dry: os que voltariam) */
  derrubados: string[]
  /** mesmo movimento (opp+de+para) repetido em 4 rodadas seguidas = card travado (no dry: os que avisariam) */
  repetidos: string[]
  /** coluna do quadro da AIVA que ninguém mapeou — a loja cai na dedução pelo stage, mas o mapa precisa crescer */
  colunas_desconhecidas: string[]
  /** passo 12 — loja nova de outra empresa, por CNPJ (no dry: o que faria; zeros quando não há nada) */
  loja_nova: SaidaLojaNova
}

export async function executarEspelho(dry: boolean, opts: { silencioso?: boolean } = {}): Promise<SaidaEspelho> {
  const silencioso = !!opts.silencioso || Date.now() < Date.parse(VIRADA_SILENCIOSA_ATE)
  const inicio = Date.now()
  const avisos: string[] = []

  // 1) portal
  const brutos = await listarOnboardingsApi()
  const onboardings = brutos.map((o): OnbApi => ({
    cnpj: String(o.cnpj ?? ''), stage: String(o.stage ?? ''), pre_cadastro_status: o.pre_cadastro_status ?? null,
    retailer_id: o.retailer_id ?? null, legal_name: o.legal_name ?? null,
    cnpj_check_status: o.cnpj_check_status ?? null, cnpj_situacao: o.cnpj_situacao ?? null, cnpj_check_reason: o.cnpj_check_reason ?? null,
    biometry_status: o.biometry_status ?? null, updated_at: o.updated_at ?? null,
    board_column: (o.board_column as string | null | undefined) ?? null, board_column_since: (o.board_column_since as string | null | undefined) ?? null,
    primeiro_acesso_em: (o.primeiro_acesso_em as string | null | undefined) ?? null,
  }))
  const sinais = sinaisPortal(onboardings)

  // 1b) CNPJ que o lojista usou no cadastro da AIVA e a gente NÃO tinha anotado → vincula ao
  //     lead pelo telefone do sócio (Gfourr e Francell, 05/10/2026: loja criada, RID, e o card
  //     preso em Em Análise levando cobrança de formulário). Regras em lib/vinculo-portal-calc.ts.
  //     Falha aqui não derruba o espelho: o resto da rodada segue com o que já está registrado.
  const vinculados: string[] = []
  try {
    const registrados = new Set<string>()
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabaseAdmin.from('sdr_registros_cnpj').select('cnpj').order('id', { ascending: true }).range(de, de + 999)
      if (error) throw new Error(error.message)
      for (const r of data ?? []) registrados.add(soDigitos(r.cnpj))
      if (!data || data.length < 1000) break
    }
    const cands = candidatosVinculo(brutos.map((o) => ({ cnpj: String(o.cnpj ?? ''), phone_number: (o.phone_number as string | null) ?? null, stage: String(o.stage ?? ''), retailer_id: o.retailer_id ?? null, legal_name: o.legal_name ?? null })), registrados)
    if (cands.length) {
      const tels = [...new Set(cands.flatMap((c) => variantesTelefone(c.phone_number)))]
      const { data: possiveis, error } = await supabaseAdmin.from('sdr_leads').select('id,telefone,status').in('telefone', tels)
      if (error) throw new Error(error.message)
      for (const v of vinculos(cands, (possiveis ?? []) as Array<{ id: string; telefone: string; status: string }>)) {
        vinculados.push(`• ${v.loja ?? v.cnpj} — CNPJ ${v.cnpj}${v.rid ? ` · RID ${v.rid}` : ''} · lead ${v.telefone}`)
        if (dry) continue
        const { error: eIns } = await supabaseAdmin.from('sdr_registros_cnpj').insert({
          lead_id: v.leadId, loja: v.loja, telefone: v.telefone, cnpj: v.cnpj, tipo: 'adicional', enviado: true,
          origem: 'portal-telefone', status: 'pre_cadastro_enviado', rid: v.rid,
        })
        if (eIns) { avisos.push(`vínculo do CNPJ ${v.cnpj} não gravado: ${eIns.message.slice(0, 100)}`); vinculados.pop() }
      }
    }
  } catch (e) {
    avisos.push(`vínculo de CNPJ pelo telefone falhou: ${String(e).slice(0, 120)}`)
  }

  // 2) nossa base + Evo
  // `registros` = só o que alimenta card e marcadores de etapa (calc, ONB_ETAPA, reprovados, CNPJ irregular,
  // pré-cadastro não chegou, aiva_sem_criar). A loja nova de outra empresa fica em `todosRegistros` e só o
  // passo 12 a usa (revisão Task 4, item 1).
  const todosRegistros = await registrosComLead()
  const registros = registrosDoCard(todosRegistros)
  const leads = await leadsPorIds([...new Set(registros.map((r) => r.lead_id!).filter(Boolean))])
  const stageAtual = new Map<number, number>()
  for (const o of await getPipeOpportunities(PIPELINE_AIVA)) stageAtual.set(Number(o.id), Number(o.fkStage))

  // 3) decisão (puro)
  const r = calcularEspelho({ onboardings, loginEnviado: sinais.loginEnviado, vendeu: sinais.vendeu, registros, leads, stageAtual })

  // CNPJ reprovado na checagem da AIVA. Os campos vêm na PRÓPRIA API pública de
  // onboardings desde 18/09 (antes era só no banco do portal, via senha) — então
  // isto não depende mais do login: se o portal recusar, a checagem segue valendo.
  const irregulares = new Map<string, { status: string; situacao: string | null; motivo: string | null }>()
  for (const o of onboardings) {
    const st = (o.cnpj_check_status ?? '').toLowerCase()
    // ⚠️ 'pending' = a AIVA ainda não conferiu; 'valid' = passou. Nenhum dos dois é
    // irregular. Sem esta linha, loja recém-cadastrada aparecia pro Nei como "CNPJ
    // não confere" — foi o que aconteceu com M2 Cell, SK Cell e NuBoleto Cell em 17/09.
    if (!SITUACAO_REAL.has(st) && !CNPJ_NAO_FECHA.has(st)) continue
    const c = soDigitos(o.cnpj)
    if (c.length === 14) irregulares.set(c, { status: st, situacao: o.cnpj_situacao ?? null, motivo: o.cnpj_check_reason ?? null })
  }

  const saida: SaidaEspelho = {
    ok: true, dry, avisos, vinculados, onboardings: onboardings.length, leads: leads.length,
    movidos: [], sobraram: 0, reprovados: r.reprovados, conferir: r.conferir, registros_enviados: r.registrosEnviados.length, pulados: r.pulados,
    cnpj: { irregular: 0, invalido: 0, novos: [], regularizados: 0 },
    onboarding_aberto: { dados_varejo: 0, biometria: 0, aguardando_aiva: 0, marcados: 0, limpos: 0 },
    pre_cadastro_nao_chegou: [], derrubados: [], repetidos: [], colunas_desconhecidas: [],
    loja_nova: { pulado: null, links: 0, criadas: 0, recusadas: 0, paradas: 0, curados: 0, adiados: 0, sem_destino: 0, retidos: 0, falhas: 0 },
  }

  // coluna nova no quadro da AIVA: `etapaDesejada` cai na dedução pelo stage em vez de congelar o card,
  // mas o mapa COLUNA_PARA_ETAPA precisa crescer — então a rodada acusa (lacuna 1, 15/10/2026).
  {
    const novas = new Map<string, number>()
    for (const o of onboardings) {
      const c = colunaDesconhecida(o.board_column)
      if (c) novas.set(c, (novas.get(c) ?? 0) + 1)
    }
    for (const [c, n] of novas) {
      saida.colunas_desconhecidas.push(`${c} (${n})`)
      avisos.push(`coluna "${c}" do quadro da AIVA não está em COLUNA_PARA_ETAPA (${n} loja(s)) — mapear em lib/espelho-portal-calc.ts`)
    }
  }

  // Etapa do onboarding por lead. dados_varejo vence biometria quando o lojista tem
  // mais de uma loja: enquanto UM formulário estiver aberto, o cadastro dele não fechou.
  // (regra pura em etapaOnbPorLead — recebe só os registros do card, sem a loja nova de outra empresa)
  const etapaPorLead = etapaOnbPorLead(onboardings, registros, leads)
  {
    for (const st of etapaPorLead.values()) {
      if (st === 'dados_varejo') saida.onboarding_aberto.dados_varejo++
      else if (st === 'aguardando_aiva') saida.onboarding_aberto.aguardando_aiva++
      else saida.onboarding_aberto.biometria++
    }
  }
  // trilha das opps desta rodada: alimenta a regra de "mesmo movimento repetido" (lacuna 2, 15/10/2026).
  // Lida ANTES de mover/gravar, então nunca inclui a rodada de agora — `contarRodadas` já a conta.
  const trilha = await historicoEtapas([...new Set(r.movimentos.map((m) => m.opp))])

  if (dry) {
    saida.movidos = r.movimentos
    {
      // preview do aviso de card travado: sem gravar chave e sem enviar nada
      const { data: chaves } = await supabaseAdmin.from('sdr_avisos_chave').select('chave').like('chave', `${PREFIXO_CHAVE}%`)
      const rep = detectarRepeticao({ movimentos: r.movimentos, historico: trilha, chavesExistentes: (chaves ?? []).map((c) => c.chave) })
      saida.repetidos = rep.repetidos.map((x) => `${linhaRepetido(x)}${x.jaAvisado ? ' · já avisado' : ''}`)
    }
    {
      const { porLead, travados } = preCadastroNaoChegou(onboardings, registros, leads)
      for (const l of leads) if (travados.has(l.id)) saida.pre_cadastro_nao_chegou.push(`${l.nome} (${porLead.get(l.id)!.cnpjs.join(', ')})`)
    }
    // preview da checagem de CNPJ: o dry antes devolvia zero porque retornava
    // aqui, ANTES do passo 8 — e "?dry=1" existe justamente pra ver o que faria.
    const leadPorIdDry = new Map(leads.map((l) => [l.id, l]))
    // mesma chave lead+marcador do bloco real — se divergir, o ?dry mente
    const vistosDry = new Set<string>()
    for (const reg of registros) {
      const info = irregulares.get(soDigitos(reg.cnpj))
      const lead = reg.lead_id ? leadPorIdDry.get(reg.lead_id) : null
      if (!info || !lead) continue
      const marcador = SITUACAO_REAL.has(info.status) ? MARCADOR_CNPJ_IRREGULAR : MARCADOR_CNPJ_INVALIDO
      const chaveDry = `${lead.id}:${marcador}`
      if (vistosDry.has(chaveDry)) continue
      vistosDry.add(chaveDry)
      if (SITUACAO_REAL.has(info.status)) saida.cnpj.irregular++
      else saida.cnpj.invalido++
      if (!(lead.observacoes ?? '').includes(`[${marcador}:`)) {
        saida.cnpj.novos.push(`• ${(lead.nome ?? '').trim() || lead.id} — CNPJ ${soDigitos(reg.cnpj)} · ${info.situacao ?? info.status}`)
      }
    }
    // passo 12 no dry: só conta (sem envio, sem chave, sem carimbo)
    saida.loja_nova = (await passoLojaNova(true, { onboardings, registros: todosRegistros, inicio, avisos })).saida
    return saida
  }

  // 4) registros: CNPJ já no portal = pré-cadastro enviado (o Nei não marca mais na mão)
  for (let i = 0; i < r.registrosEnviados.length; i += 200) {
    const { error } = await supabaseAdmin
      .from('sdr_registros_cnpj')
      .update({ status: 'pre_cadastro_enviado', enviado: true, origem: 'portal' })
      .in('id', r.registrosEnviados.slice(i, i + 200))
      .neq('status', 'ativa')
    if (error) avisos.push(`registros não marcados como enviados: ${error.message.slice(0, 120)}`)
  }

  // 5) movimentos no Evo — teto por rodada; o que sobrar volta na próxima (15 min)
  let i = 0
  const reconsiderados: string[] = []
  for (; i < r.movimentos.length; i++) {
    if (i >= TETO_MOVIMENTOS || Date.now() - inicio > TETO_MS) break
    const m = r.movimentos[i]
    try {
      // AIVA reconsiderou um reprovado (calc 2b): destrava ANTES de mover. O /opportunity-stage não troca
      // status de lead NAO_QUALIFICADO (terminal) e o webhook 4c seguiria silenciando o lojista pelo
      // [PORTAL_REPROVADO]. O [RETORNO_CNPJ_ALERTA] sai junto pra um próximo travamento avisar de novo.
      if (m.reconsiderado) {
        await desmarcar(m.lead_id, MARCADOR_REPROVADO)
        await desmarcar(m.lead_id, 'RETORNO_CNPJ_ALERTA')
        await supabaseAdmin.from('sdr_leads')
          .update({ status: STAGE_TO_STATUS[m.para] ?? 'EM_ANALISE_AIVA', acionar_humano: false })
          .eq('id', m.lead_id)
      }
      // biometria aprovada sem loja criada: o marcador vai ANTES do move — o handler da 70 (HSM 69 + kit)
      // lê ele pra não prometer login nem formulário de vendedor a quem ainda não tem loja (revisor 06/10)
      if (m.motivo === MOTIVO_BIO_APROVADA) await marcar(m.lead_id, MARCADOR_ONB_ETAPA, `aguardando_aiva:${new Date().toISOString()}`)
      // silencioso: vai direto pro destino (sem a passagem pela 70 — o marcador é um por vez e o handler
      // da etapa intermediária leria o da seguinte) e marca antes de mover
      const etapas = silencioso ? [m.para] : [...m.via, m.para]
      if (silencioso && m.para !== ETAPA.VENDENDO) await marcar(m.lead_id, 'MOVE_SILENCIOSO', `${m.para}:${new Date().toISOString()}`)
      for (const etapa of etapas) {
        const corpo = await changeOpportunityStage(m.opp, etapa)
        // a automação do Evo + nosso handler rodam do outro lado; um respiro evita
        // dois webhooks do mesmo card se atropelando
        await new Promise((res) => setTimeout(res, 800))
        // 19/10/2026: o 200 do Evo não prova nada — 14 cards ficaram com ok=true na trilha e nunca
        // saíram do lugar (`{"result":false}`). A prova é a etapa relida; o corpo vai pro `erro`.
        const relida = Number((await getOpportunity(m.opp)).fkStage)
        if (relida !== etapa) throw new Error(`Evo respondeu 200 mas a opp ficou na etapa ${relida} (corpo: ${corpo.slice(0, 80)})`)
      }
      await marcar(m.lead_id, MARCADOR_ESPELHO, `${m.para}:${new Date().toISOString()}`)
      console.log(`[espelho-portal] opp #${m.opp} ${m.de} → ${m.para}${m.via.length ? ` (via ${m.via.join(',')})` : ''} · ${m.nome} · ${m.motivo}`)
      saida.movidos.push(m)
      if (m.reconsiderado) reconsiderados.push(`• ${m.nome} · opp #${m.opp} → etapa ${m.para} · ${m.motivo}`)
    } catch (e) {
      const erro = String(e).slice(0, 160)
      console.error(`[espelho-portal] falha ao mover opp #${m.opp} (${m.nome}):`, erro)
      saida.movidos.push({ ...m, erro })
    }
  }
  saida.sobraram = r.movimentos.length - i

  // 5b) DERRUBADOS PELA AIVA (calc 1c): card 50 → 54 Pré-aprovação, lead PRE_APROVACAO (a VictorIA responde
  //     "em análise"), CNPJs do lead voltam a PENDENTE no /registros pro pré-cadastro ser refeito pelo
  //     "Abrir form". Move silencioso: o handler da 54 só troca o status (não grava "dados enviados pra
  //     planilha"). Quando a AIVA aceitar o pré-cadastro de novo, o card anda sozinho pela coluna real.
  const derrubadosFeitos: string[] = []
  for (const x of r.derrubados) {
    const linha = `• ${x.nome} · opp #${x.opp} · CNPJ ${x.cnpjs.join('/')} · ${x.dias} dias na etapa`
    if (dry) { derrubadosFeitos.push(linha); continue }
    if (Date.now() - inicio > TETO_MS) { saida.sobraram += 1; continue }
    try {
      await desmarcar(x.lead_id, MARCADOR_ONB_ETAPA)
      await desmarcar(x.lead_id, MARCADOR_ESPELHO)
      await marcar(x.lead_id, MARCADOR_DERRUBADO, new Date().toISOString())
      await marcar(x.lead_id, 'MOVE_SILENCIOSO', `${ETAPA.PRE_APROVACAO}:${new Date().toISOString()}`)
      await supabaseAdmin.from('sdr_leads').update({ status: 'PRE_APROVACAO', acionar_humano: false }).eq('id', x.lead_id)
      await supabaseAdmin.from('sdr_registros_cnpj').update({ enviado: false, origem: null, enviado_em: null, status: 'informada' }).in('id', registros.filter((rg) => rg.lead_id === x.lead_id).map((rg) => rg.id)).neq('status', 'ativa') // por id: a loja nova de outra empresa (fora de `registros`) não volta pra pendente
      const corpo = await changeOpportunityStage(x.opp, ETAPA.PRE_APROVACAO)
      await new Promise((res) => setTimeout(res, 800))
      const relida = Number((await getOpportunity(x.opp)).fkStage)
      if (relida !== ETAPA.PRE_APROVACAO) throw new Error(`Evo respondeu 200 mas a opp ficou na etapa ${relida} (corpo: ${corpo.slice(0, 80)})`)
      await gravarEtapaLog([{ lead_id: x.lead_id, nome: x.nome, opp: x.opp, de: ETAPA.EM_ANALISE, para: ETAPA.PRE_APROVACAO, via: [], motivo: MOTIVO_DERRUBADO, ok: true }])
      console.log(`[espelho-portal] opp #${x.opp} 50 → 54 (derrubado pela AIVA) · ${x.nome}`)
      derrubadosFeitos.push(linha)
    } catch (e) {
      avisos.push(`derrubado ${x.nome} (opp #${x.opp}) não movido: ${String(e).slice(0, 100)}`)
      await gravarEtapaLog([{ lead_id: x.lead_id, nome: x.nome, opp: x.opp, de: ETAPA.EM_ANALISE, para: ETAPA.PRE_APROVACAO, via: [], motivo: MOTIVO_DERRUBADO, ok: false, erro: String(e).slice(0, 160) }])
    }
  }
  saida.derrubados = derrubadosFeitos

  // 5b) trilha dos movimentos tentados nesta rodada (best-effort) e aviso de card travado.
  //     O defeito de 15/10 (opp #29936, 70 → 51 recusado pelo Evo com HTTP 200) ficou mais de 24 h
  //     invisível porque o espelho repetia o movimento em silêncio. Agora o mesmo movimento em 4
  //     rodadas seguidas (≈1 h) avisa Aldo e Nei UMA vez por opp; a chave em sdr_avisos_chave é solta
  //     quando o movimento para de se repetir, pro próximo travamento voltar a avisar.
  const tentados = saida.movidos.slice()
  await gravarEtapaLog(tentados.map((m) => ({ ...m, ok: !m.erro, erro: m.erro })))
  try {
    const { data: chaves } = await supabaseAdmin.from('sdr_avisos_chave').select('chave').like('chave', `${PREFIXO_CHAVE}%`)
    const rep = detectarRepeticao({ movimentos: tentados, historico: trilha, chavesExistentes: (chaves ?? []).map((c) => c.chave) })
    saida.repetidos = rep.repetidos.map((x) => `${linhaRepetido(x)}${x.jaAvisado ? ' · já avisado' : ''}`)
    for (const x of rep.novos) {
      await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: x.chave, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
    }
    if (rep.mortas.length) await supabaseAdmin.from('sdr_avisos_chave').delete().in('chave', rep.mortas)
    if (rep.novos.length) {
      const detalhe = [
        '🔁 *Espelho do portal: card que não sai do lugar*',
        '',
        ...rep.novos.map(linhaRepetido),
        '',
        'O espelho manda o mesmo movimento a cada 15 min e o card não anda — quase sempre o Evo recusa a troca de etapa (ou a automação devolve o card).',
        'Conferir a etapa no funil 15 na mão; a trilha de cada tentativa está em sdr_etapa_log (coluna `erro`).',
      ].join('\n')
      const r1 = rep.novos[0]
      const teaser = rep.novos.length === 1
        ? `Card travado: opp #${r1.opp} (${r1.nome}) não sai da etapa ${r1.de} há ${r1.rodadas} rodadas`
        : `${rep.novos.length} cards travados no espelho do portal (ex.: opp #${r1.opp}, etapa ${r1.de})`
      const env = await avisarEquipe(detalhe, teaser)
      if (!env.enviados) avisos.push(`aviso de card travado não entregue (${rep.novos.length} opp(s))`)
    }
  } catch (e) {
    // conferência interna: nunca derruba a rodada
    avisos.push(`repetição de movimento não avaliada: ${String(e).slice(0, 120)}`)
  }

  // 6) reprovados pela AIVA → card pra 95 "Loja Descartada pela Aiva" + lead travado
  //    (NAO_QUALIFICADO; o webhook 4c avisa se ele voltar a falar). Aviso ao Nei/Aldo
  //    só pra quem ainda não tinha o marcador. Mesmo teto de tempo da rodada.
  const novos: string[] = []
  const reprovadosFeitos: Resultado['reprovados'] = []
  for (const x of r.reprovados) {
    if (Date.now() - inicio > TETO_MS) { saida.sobraram += 1; continue }
    try {
      await changeOpportunityStage(x.opp, ETAPA.REPROVADO)
      await supabaseAdmin.from('sdr_leads').update({ status: 'NAO_QUALIFICADO', acionar_humano: false }).eq('id', x.lead_id)
      if (!x.jaAvisado) await marcar(x.lead_id, MARCADOR_REPROVADO, new Date().toISOString())
      console.log(`[espelho-portal] opp #${x.opp} ${x.de} → 95 (reprovado pela AIVA) · ${x.nome}`)
      reprovadosFeitos.push(x)
      if (!x.jaAvisado) novos.push(`• ${x.nome}${x.loja ? ` — ${x.loja}` : ''} (CNPJ ${soDigitos(x.cnpj)}) · opp #${x.opp}`)
      await new Promise((res) => setTimeout(res, 800))
    } catch (e) {
      avisos.push(`reprovado ${x.nome} (opp #${x.opp}) não movido: ${String(e).slice(0, 100)}`)
    }
  }
  saida.reprovados = reprovadosFeitos

  // 7) reprovado no portal mas com sinal de loja operando: não mexe, avisa uma vez
  const conferirNovos: string[] = []
  for (const x of r.conferir) {
    if (x.jaAvisado) continue
    try {
      await marcar(x.lead_id, MARCADOR_CONFERIR, new Date().toISOString())
      await registrarAvisos('portal_reprovado_conferir', [{ leadId: x.lead_id, loja: x.nome, detalhe: `CNPJ ${soDigitos(x.cnpj)} · ${x.motivo}` }])
      conferirNovos.push(`• ${x.nome}${x.loja ? ` — ${x.loja}` : ''} (CNPJ ${soDigitos(x.cnpj)}) · opp #${x.opp} · ${x.motivo}`)
    } catch (e) {
      avisos.push(`conferir ${x.nome} não marcado: ${String(e).slice(0, 100)}`)
    }
  }

  // 8) checagem de CNPJ da AIVA. Desde 18/09 os campos vêm na PRÓPRIA API pública
  //    de onboardings (que já buscamos acima), então isto não depende mais do login
  //    com senha: se o portal recusar o login, a checagem continua valendo.
  //    A gente só MARCA e avisa — quem decide descartar loja é o time.
  const cnpjNovos: string[] = []
  if (irregulares.size) {
    const leadPorId = new Map(leads.map((l) => [l.id, l]))
    // ⚠️ A chave é lead+MARCADOR, não o lead sozinho (achado 24/09/2026).
    // Com `vistos` por lead, quem tinha DOIS CNPJs problemáticos só recebia o
    // marcador do primeiro e o outro sumia — foi o caso da Smarttech Celulares,
    // com 62555956000108 inválido e 13222874000135 INAPTA: ficou só o de inválido
    // e a situação real na Receita, que é a mais grave, não apareceu em lugar
    // nenhum. Os dois marcadores são independentes e podem coexistir.
    const vistos = new Set<string>()
    for (const reg of registros) {
      const info = irregulares.get(soDigitos(reg.cnpj))
      const lead = reg.lead_id ? leadPorId.get(reg.lead_id) : null
      if (!info || !lead) continue
      const real = SITUACAO_REAL.has(info.status)
      const marcador = real ? MARCADOR_CNPJ_IRREGULAR : MARCADOR_CNPJ_INVALIDO
      const chave = `${lead.id}:${marcador}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      if (real) saida.cnpj.irregular++
      else saida.cnpj.invalido++
      if ((lead.observacoes ?? '').includes(`[${marcador}:`)) continue
      try {
        await marcar(lead.id, marcador, `${info.status}:${new Date().toISOString()}`)
        const nome = (lead.nome ?? '').trim() || lead.id
        await registrarAvisos(real ? 'cnpj_irregular' : 'cnpj_invalido', [{ leadId: lead.id, loja: nome, status: String(lead.status), detalhe: `CNPJ ${soDigitos(reg.cnpj)} · ${info.situacao ?? info.status}${info.motivo ? ` (${info.motivo})` : ''}` }])
        cnpjNovos.push(`• ${nome} — CNPJ ${soDigitos(reg.cnpj)} · ${info.situacao ?? info.status}${info.motivo ? ` (${info.motivo})` : ''}`)
      } catch (e) {
        avisos.push(`cnpj de ${lead.nome} não marcado: ${String(e).slice(0, 100)}`)
      }
    }
    // Voltou a ficar regular (o lojista regularizou, a AIVA corrigiu o CNPJ, ou o
    // status saiu de pending) → o marcador some e a cobrança do formulário volta.
    for (const lead of leads) {
      const obs = lead.observacoes ?? ''
      for (const m of [MARCADOR_CNPJ_IRREGULAR, MARCADOR_CNPJ_INVALIDO]) {
        if (!obs.includes(`[${m}:`)) continue
        // ⚠️ Confere se ainda há CNPJ ruim DAQUELE TIPO. Antes bastava existir
        // qualquer CNPJ problemático pra segurar os DOIS marcadores: o lojista que
        // regularizasse a inaptidão mas seguisse com um CNPJ de dígito inválido
        // (ou o contrário) ficava com o marcador errado pra sempre.
        const aindaRuim = registros.some((reg) => {
          if (reg.lead_id !== lead.id) return false
          const info = irregulares.get(soDigitos(reg.cnpj))
          if (!info) return false
          return (SITUACAO_REAL.has(info.status) ? MARCADOR_CNPJ_IRREGULAR : MARCADOR_CNPJ_INVALIDO) === m
        })
        if (!aindaRuim && await desmarcar(lead.id, m)) {
          saida.cnpj.regularizados++
          await resolverAvisos(m === MARCADOR_CNPJ_IRREGULAR ? 'cnpj_irregular' : 'cnpj_invalido', [lead.id], 'auto: CNPJ regularizado no portal')
        }
      }
    }
  }
  saida.cnpj.novos = cnpjNovos

  // 9) etapa do onboarding em aberto → marcador pro contexto da VictorIA.
  //    POR QUE (Aldo 18/09/2026): muita loja pede a senha sem ter concluído o termo
  //    de adesão / o cadastro / a biometria. Hoje é o Nei que percebe e explica na
  //    mão. Sem esse marcador a VictorIA responde sobre senha — e senha não existe
  //    antes do cadastro fechar (é o cadastro que cria o ID da loja).
  //    Só escreve quando MUDA de etapa: o cron roda a cada 15 min.
  for (const lead of leads) {
    const obs = lead.observacoes ?? ''
    const alvo = etapaPorLead.get(lead.id) ?? null
    const atual = obs.match(/\[ONB_ETAPA:([^:\]]+)/)?.[1] ?? null
    if (alvo === atual) continue
    try {
      if (atual) await desmarcar(lead.id, MARCADOR_ONB_ETAPA)
      // Biometria NEGADA entra no painel do Nei no MESMO ciclo em que o portal muda (05/10/2026)
      // — e sai sozinha quando o lojista refaz e a etapa anda. Só na TROCA de etapa: se o Nei
      // clicar em Resolvido com a selfie ainda negada, o aviso não reabre a cada 15 min.
      if (alvo === 'biometria_negada') await registrarAvisos('biometria_negada', [{ leadId: lead.id, loja: lead.nome, status: lead.status }])
      if (atual === 'biometria_negada') await resolverAvisos('biometria_negada', [lead.id], `auto: portal saiu de negada (${alvo ?? 'sem etapa aberta'})`)
      if (alvo) { await marcar(lead.id, MARCADOR_ONB_ETAPA, `${alvo}:${new Date().toISOString()}`); saida.onboarding_aberto.marcados++ }
      else saida.onboarding_aberto.limpos++
    } catch (e) {
      avisos.push(`etapa de ${lead.nome} não marcada: ${String(e).slice(0, 100)}`)
    }
  }

  // 10) cadastro pronto do lado do lojista e a AIVA ainda não criou a loja.
  //     É o único ponto do fluxo em que não existe ação nossa nem dele: quem trava
  //     é a AIVA. Sem aviso, a loja fica esperando em silêncio (LT CELL IMPORTS,
  //     18/09: biometria aprovada em 17/09 e ninguém sabia). Aviso ÚNICO por CNPJ,
  //     só depois de 24h — que é o prazo que a própria AIVA dá e que a VictorIA diz.
  const paradosAiva: string[] = []
  {
    const HORAS = 24
    const agora = Date.now()
    const onbPorCnpj = new Map(onboardings.map((o) => [soDigitos(o.cnpj), o]))
    const leadPorId = new Map(leads.map((l) => [l.id, l]))
    const vivas = new Set<string>()
    const pendentesAviso: Array<{ chave: string; linha: string }> = []
    for (const reg of registros) {
      if (!reg.lead_id || etapaPorLead.get(reg.lead_id) !== 'aguardando_aiva') continue
      const cnpj = soDigitos(reg.cnpj)
      const o = onbPorCnpj.get(cnpj)
      if (!o || situacaoOnb(String(o.stage ?? ''), o.biometry_status) !== 'aguardando_aiva') continue
      vivas.add(`aiva_sem_criar:${cnpj}`)
      const desde = Date.parse(String(o.updated_at ?? ''))
      const horas = Number.isFinite(desde) ? Math.floor((agora - desde) / 3_600_000) : 0
      if (horas < HORAS) continue
      const lead = leadPorId.get(reg.lead_id)
      pendentesAviso.push({
        chave: `aiva_sem_criar:${cnpj}`,
        linha: `• ${lead?.nome ?? o.legal_name ?? cnpj} — CNPJ ${cnpj} · biometria aprovada há ${horas}h`,
      })
    }
    if (!dry) {
      const { data: jaAvisados } = await supabaseAdmin.from('sdr_avisos_chave').select('chave').like('chave', 'aiva_sem_criar:%')
      const avisadas = new Set((jaAvisados ?? []).map((r) => r.chave))
      for (const x of pendentesAviso) {
        if (avisadas.has(x.chave)) continue
        await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: x.chave, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
        paradosAiva.push(x.linha)
      }
      // a AIVA criou a loja (ou o cadastro mudou de estado) → a chave some e o
      // próximo travamento volta a avisar
      const mortas = [...avisadas].filter((k) => !vivas.has(k))
      if (mortas.length) await supabaseAdmin.from('sdr_avisos_chave').delete().in('chave', mortas)
    }
  }

  // 11) PRÉ-CADASTRO QUE NÃO CHEGOU (Aldo 06/10/2026). O "Abrir form" do /registros marca o CNPJ
  //     como enviado no CLIQUE; se o formulário não é enviado, o lead fica parado em Cadastro
  //     Recebido sem ninguém saber — e a VictorIA dizia que "dependia da análise da AIVA" (Minas
  //     Celulares, 02→06/10). Medido em 06/10: 106 de 111 pré-cadastros aparecem no portal com
  //     mediana de 1h30 e máximo de 30h — passou de 24h sem aparecer, o formulário não foi.
  //     Vale só pra PRE_APROVACAO/CADASTRO_RECEBIDO e só quando NENHUM CNPJ do lead está no portal.
  //     O relógio das 24h corre do CLIQUE (`enviado_em`), não da captura do CNPJ — ver marcadoEmMs.
  //     ⚠️ O marcador do lead e o aviso do painel são COISAS SEPARADAS (15/10/2026). O marcador é a
  //     verdade que a VictorIA conta ao lojista ("a pendência é nossa") e só sai quando o CNPJ aparece
  //     no portal; o aviso é a fila do Nei, e o "Resolvido" dele é só uma soneca. Por isso o aviso é
  //     reaberto enquanto a loja segue travada, em vez de depender da transição do marcador: antes,
  //     um Resolvido manual com o lead ainda marcado calava o caso para sempre.
  const novosPreCad: string[] = []
  {
    const { porLead, travados } = preCadastroNaoChegou(onboardings, registros, leads)
    const candidatos: Array<{ lead: LeadEspelho; x: PreCadastroEstado }> = []
    for (const lead of leads) {
      const tem = (lead.observacoes ?? '').includes('[PRE_CAD_NAO_CHEGOU:')
      const deve = travados.has(lead.id)
      if (deve) saida.pre_cadastro_nao_chegou.push(`${lead.nome} (${porLead.get(lead.id)!.cnpjs.join(', ')})`)
      if (dry) continue
      try {
        if (deve) {
          const x = porLead.get(lead.id)!
          if (!tem) await marcar(lead.id, 'PRE_CAD_NAO_CHEGOU', new Date(x.maisAntigo).toISOString())
          candidatos.push({ lead, x })
        } else if (tem) {
          await desmarcar(lead.id, 'PRE_CAD_NAO_CHEGOU')
          await resolverAvisos('pre_cadastro_nao_chegou', [lead.id], 'auto: o CNPJ apareceu no portal (ou o lead saiu da etapa)')
        }
      } catch (e) {
        avisos.push(`pré-cadastro não chegou (${lead.nome}): ${String(e).slice(0, 100)}`)
      }
    }
    // quem está travado e não está em silêncio (aviso aberto, ou Resolvido há menos de 6h) entra
    // na fila do painel e no digest — inclusive de novo, se a soneca venceu e nada andou
    if (candidatos.length) {
      try {
        const silencio = await leadsEmSilencio('pre_cadastro_nao_chegou', candidatos.map((c) => c.lead.id), SILENCIO_PRE_CAD_MS)
        const avisar = candidatos.filter((c) => !silencio.has(c.lead.id))
        if (avisar.length) {
          await registrarAvisos('pre_cadastro_nao_chegou', avisar.map(({ lead, x }) => ({
            leadId: lead.id, loja: lead.nome, status: String(lead.status),
            detalhe: `CNPJ ${x.cnpjs.join(', ')} · marcado em ${new Date(x.maisAntigo).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
          })))
          for (const { lead, x } of avisar) novosPreCad.push(`• ${lead.nome} — CNPJ ${x.cnpjs.join(', ')}`)
        }
      } catch (e) {
        avisos.push(`avisos de pré-cadastro não chegado: ${String(e).slice(0, 100)}`)
      }
    }
  }

  // 12) loja nova de outra empresa (por CNPJ) — link, loja criada, recusa, fila parada. Não mexe em card.
  const lojaNova = await passoLojaNova(false, { onboardings, registros: todosRegistros, inicio, avisos })
  saida.loja_nova = lojaNova.saida

  const blocos: string[] = []
  if (novosPreCad.length) {
    blocos.push(
      `📮 *Pré-cadastro não chegou à AIVA* (${novosPreCad.length})\n${novosPreCad.join('\n')}\n\n` +
      `Marcado como enviado em Registros AIVA há mais de ${PRE_CAD_HORAS}h e o CNPJ não aparece no portal — o formulário não foi enviado. ` +
      'Reenviar pelo Registros AIVA; o card anda sozinho depois.\n📌 Também está no topo do Atendimento.',
    )
  }
  if (novos.length) {
    blocos.push(
      `⛔ *Pré-cadastro REPROVADO pela AIVA* (${novos.length})\n${novos.join('\n')}\n\n` +
      'Card movido pra "Loja Descartada pela Aiva" e lead travado. Se a AIVA reconsiderar (o CNPJ voltar aprovado no portal), o espelho destrava sozinho e avisa aqui.',
    )
  }
  if (reconsiderados.length) {
    blocos.push(
      `✅ *AIVA reconsiderou um reprovado* (${reconsiderados.length})\n${reconsiderados.join('\n')}\n\n` +
      'O portal passou a mostrar o CNPJ aprovado: o card saiu de "Loja Descartada pela Aiva" pra etapa que o portal pede e o lead foi destravado (a VictorIA volta a responder; o link/cobrança da etapa saem sozinhos).',
    )
  }
  if (conferirNovos.length) {
    blocos.push(
      `🔎 *Reprovado no portal, mas parece que a loja opera* (${conferirNovos.length}) — o espelho NÃO mexeu:\n${conferirNovos.join('\n')}\n\n` +
      'Conferir com a AIVA: se for reprovado mesmo, mover o card pra "Loja Descartada pela Aiva" na mão; se a loja opera, o portal é que está errado.',
    )
  }
  if (cnpjNovos.length) {
    blocos.push(
      `🧾 *CNPJ reprovado na checagem da AIVA* (${cnpjNovos.length} loja(s) nova(s))\n${cnpjNovos.slice(0, 25).join('\n')}` +
      (cnpjNovos.length > 25 ? `\n… +${cnpjNovos.length - 25}` : '') +
      '\n\nINAPTA/BAIXADA/SUSPENSA = situação real: a cobrança do formulário parou sozinha, a loja precisa regularizar na Receita.' +
      '\nDÍGITO INVÁLIDO / NÃO ENCONTRADO = o CNPJ digitado no portal não fecha (tem loja vendendo assim) — conferir com a AIVA, não é problema da loja.' +
      '\nA lista completa fica em https://sdr-aiva.vercel.app/excecoes',
    )
  }
  if (vinculados.length && !dry) {
    blocos.push(
      `🔗 *CNPJ diferente no cadastro da AIVA — vinculei ao lead* (${vinculados.length})\n${vinculados.join('\n')}\n\n` +
      'O lojista fez o cadastro na AIVA com um CNPJ que não era o que estava anotado com a gente. ' +
      'Achei pelo telefone do cadastro e registrei em Registros AIVA; o card passa a andar pela etapa real desse CNPJ.',
    )
  }
  if (derrubadosFeitos.length && !dry) {
    blocos.push(
      `🪂 *Derrubados pela AIVA — voltaram pra Pré-aprovação* (${derrubadosFeitos.length})\n${derrubadosFeitos.slice(0, 30).join('\n')}` +
      (derrubadosFeitos.length > 30 ? `\n… +${derrubadosFeitos.length - 30}` : '') +
      '\n\nA AIVA tirou do quadro quem ficou 30+ dias em "Formulário do varejo pendente". O card voltou pra Pré-aprovação, ' +
      'o lead está em PRE_APROVACAO (a VictorIA responde "em análise") e o CNPJ voltou a PENDENTE em Registros AIVA: ' +
      'refazer o pré-cadastro pelo "Abrir form". Quando a AIVA aceitar, o card anda sozinho pela coluna real.' + RODAPE_PAINEL,
    )
  }
  if (paradosAiva.length) {
    blocos.push(
      `⏳ *Cadastro pronto e a AIVA não criou a loja* (${paradosAiva.length})\n${paradosAiva.join('\n')}\n\n` +
      'O lojista fez tudo: formulário concluído e biometria APROVADA. O portal fica parado em "biometria" até a AIVA ' +
      'criar o ID da loja — sem isso não há treinamento nem acesso. Cobrar a AIVA (Mauricio/Edu).' +
      'A VictorIA já sabe e não cobra mais nada dele.',
    )
  }
  blocos.push(...lojaNova.blocos)
  for (const texto of blocos) {
    for (const tel of [process.env.NEI_WHATSAPP, process.env.ALDO_WHATSAPP].filter(Boolean) as string[]) {
      try { await sendText(tel, texto) } catch (e) { avisos.push(`aviso de reprovado não enviado: ${String(e).slice(0, 100)}`) }
    }
  }

  return saida
}
