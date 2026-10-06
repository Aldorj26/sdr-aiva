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
 *   - onboardings: API pública do parceiro (chave) — etapa, pré-cadastro, RID
 *   - login_sends e retailer_performance: banco do portal com o login do site
 *     (mesmo acesso da tela Performance). Se esse login falhar, o espelho segue
 *     só com a API: ninguém sobe pra Login/Vendendo nessa rodada, e nada quebra.
 *
 * Regras de decisão: lib/espelho-portal-calc.ts (puro, testado).
 * Spec: docs/superpowers/specs/2026-09-16-espelho-portal-evo-design.md
 */
import { supabaseAdmin } from '@/lib/supabase'
import { changeOpportunityStage, getPipeOpportunities, sendText } from '@/lib/evotalks'
import { candidatos as candidatosVinculo, variantesTelefone, vinculos } from '@/lib/vinculo-portal-calc'
import { registrarAvisos, resolverAvisos } from '@/lib/avisos-painel'
import { listarOnboardingsApi, loginPortal, partnerIdTrack, rest, type Sessao } from '@/lib/portal-aiva'
import {
  calcularEspelho, soDigitos, ETAPA, MARCADOR_REPROVADO, MARCADOR_CONFERIR, ONB_ORDEM, situacaoOnb, type OnbSituacao,
  type LeadEspelho, type Movimento, type OnbApi, type RegistroCnpj, type Resultado,
} from '@/lib/espelho-portal-calc'

const PIPELINE_AIVA = 15
/** Teto por rodada: cada movimento dispara automação + HSM do lado do Evo. */
const TETO_MOVIMENTOS = 30
const TETO_MS = 200_000
export const MARCADOR_ESPELHO = 'ESPELHO_PORTAL'
/** CNPJ com situação real ruim na Receita (inapta/baixada/suspensa) segundo a AIVA. */
export const MARCADOR_CNPJ_IRREGULAR = 'CNPJ_IRREGULAR_AIVA'
/** CNPJ que não fecha (DV inválido / não consta) — quase sempre erro de digitação no portal. */
export const MARCADOR_CNPJ_INVALIDO = 'CNPJ_PORTAL_INVALIDO'
/** Etapa do onboarding da AIVA quando ele AINDA NÃO fechou: dados_varejo | biometria.
 *  A VictorIA usa isso pra não falar de senha com quem nem terminou o cadastro
 *  (regra do Aldo 18/09/2026 — é a msg que o Nei manda na mão hoje). */
export const MARCADOR_ONB_ETAPA = 'ONB_ETAPA'
/** Situação REAL ruim na Receita — a loja precisa regularizar. */
const SITUACAO_REAL = new Set(['inapta', 'baixada', 'suspensa'])
/** CNPJ que não fecha — quase sempre erro de digitação no portal. */
const CNPJ_NAO_FECHA = new Set(['invalid', 'not_found'])
// ⚠️ 'pending' (a AIVA ainda não conferiu) e 'valid' NÃO entram em nenhum dos dois.
// Sem essa separação, um CNPJ só porque ainda não foi checado apareceria pro Nei
// como "não confere" — achado de 18/09, quando o status pending passou a existir.

async function sinaisPortal(): Promise<{ loginEnviado: Set<string>; vendeu: Set<string>; aviso: string | null }> {
  let s: Sessao
  try {
    s = await loginPortal()
  } catch (e) {
    return { loginEnviado: new Set(), vendeu: new Set(), aviso: `login do portal falhou (${String(e).slice(0, 120)}) — Login/Vendendo não avaliados nesta rodada` }
  }
  try {
    const partner = await partnerIdTrack(s)
    const loginEnviado = new Set<string>()
    const vendeu = new Set<string>()
    for (let de = 0; ; de += 1000) {
      const { data } = await rest<Array<{ retailer_id: string | number }>>(s, 'login_sends?select=retailer_id&credentials_sent_at=not.is.null', [de, de + 999])
      for (const l of data) loginEnviado.add(String(l.retailer_id))
      if (data.length < 1000) break
    }
    for (let de = 0; ; de += 1000) {
      // Loja OPERANDO vai pra 51 (Aldo 28/09/2026): vendeu OU já consultou crédito.
      // Antes era só venda — loja que consultava ficava presa em Em Análise/Treinar/Login.
      const { data } = await rest<Array<{ retailer_id: string | number }>>(
        s, `retailer_performance?select=retailer_id&partner_id=eq.${encodeURIComponent(partner)}&or=(n_vendas.gt.0,n_consultas.gt.0)`, [de, de + 999],
      )
      for (const l of data) vendeu.add(String(l.retailer_id))
      if (data.length < 1000) break
    }
    return { loginEnviado, vendeu, aviso: null }
  } catch (e) {
    return { loginEnviado: new Set(), vendeu: new Set(), aviso: `leitura do banco do portal falhou (${String(e).slice(0, 120)}) — Login/Vendendo não avaliados nesta rodada` }
  }
}

/** Pré-cadastro marcado como enviado há 24h+ e que não chegou ao portal (passo 11 — ver comentário lá). */
function preCadastroNaoChegou(onboardings: OnbApi[], registros: RegistroCnpj[], leads: LeadEspelho[]) {
  const LIMITE_MS = 24 * 3_600_000
  const agoraMs = Date.now()
  const noPortal = new Set(onboardings.map((o) => soDigitos(o.cnpj)))
  const leadPorId = new Map(leads.map((l) => [l.id, l]))
  const porLead = new Map<string, { algumNoPortal: boolean; maisAntigo: number; cnpjs: string[] }>()
  for (const reg of registros) {
    if (!reg.lead_id) continue
    const lead = leadPorId.get(reg.lead_id)
    if (!lead || !['PRE_APROVACAO', 'CADASTRO_RECEBIDO'].includes(String(lead.status))) continue
    const c = soDigitos(reg.cnpj)
    const x = porLead.get(reg.lead_id) ?? { algumNoPortal: false, maisAntigo: Infinity, cnpjs: [] }
    if (noPortal.has(c)) x.algumNoPortal = true
    else if (reg.status === 'pre_cadastro_enviado') {
      const t = Date.parse(String(reg.criado_em ?? ''))
      if (Number.isFinite(t)) { x.maisAntigo = Math.min(x.maisAntigo, t); x.cnpjs.push(c) }
    }
    porLead.set(reg.lead_id, x)
  }
  const travados = new Set<string>()
  for (const [leadId, x] of porLead) if (!x.algumNoPortal && x.cnpjs.length && agoraMs - x.maisAntigo >= LIMITE_MS) travados.add(leadId)
  return { porLead, travados }
}

async function registrosComLead(): Promise<RegistroCnpj[]> {
  const out: RegistroCnpj[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin
      .from('sdr_registros_cnpj')
      .select('id,cnpj,lead_id,status,rid,criado_em')
      .not('lead_id', 'is', null)
      .order('id', { ascending: true })
      .range(de, de + 999)
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
}

export async function executarEspelho(dry: boolean): Promise<SaidaEspelho> {
  const inicio = Date.now()
  const avisos: string[] = []

  // 1) portal
  const brutos = await listarOnboardingsApi()
  const onboardings = brutos.map((o): OnbApi => ({
    cnpj: String(o.cnpj ?? ''), stage: String(o.stage ?? ''), pre_cadastro_status: o.pre_cadastro_status ?? null,
    retailer_id: o.retailer_id ?? null, legal_name: o.legal_name ?? null,
    cnpj_check_status: o.cnpj_check_status ?? null, cnpj_situacao: o.cnpj_situacao ?? null, cnpj_check_reason: o.cnpj_check_reason ?? null,
    biometry_status: o.biometry_status ?? null, updated_at: o.updated_at ?? null,
  }))
  const sinais = await sinaisPortal()
  if (sinais.aviso) avisos.push(sinais.aviso)

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
  const registros = await registrosComLead()
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
    pre_cadastro_nao_chegou: [],
  }

  // Etapa do onboarding por lead. dados_varejo vence biometria quando o lojista tem
  // mais de uma loja: enquanto UM formulário estiver aberto, o cadastro dele não fechou.
  const etapaPorLead = new Map<string, string>()
  {
    const stagePorCnpj = new Map<string, string>()
    for (const o of onboardings) {
      // CNPJ com situação REAL irregular (inapta/baixada/suspensa) nunca fecha o formulário — ele
      // não pode "vencer" a etapa do lead. Smarttech (06/10/2026): matriz com biometria APROVADA
      // esperando a AIVA, e a filial INAPTA prendia o lead em "formulário aberto" — a VictorIA
      // cobraria um formulário que não existe pra fazer. Esse CNPJ já tem marcador próprio.
      if (SITUACAO_REAL.has(String(o.cnpj_check_status ?? '').toLowerCase())) continue
      const sit = situacaoOnb(String(o.stage ?? ''), o.biometry_status)
      if (sit) stagePorCnpj.set(soDigitos(o.cnpj), sit)
    }
    // Fora: quem JÁ OPERA. Duas portas de erro, as duas reais:
    //  - importado do portal (lote de 16/09) que JÁ SAIU da Em Análise: o portal o tem em
    //    dados_varejo, mas vende. ⚠️ Desde 02/10/2026 o importado que CONTINUA em
    //    EM_ANALISE_AIVA não conta como "opera": quem consulta ou vende já foi pra 51, então
    //    o que ficou tem o cadastro aberto de verdade (raio-x do funil, Aldo).
    //  - lojista com matriz vendendo e FILIAL nova em cadastro: o marcador é do LEAD,
    //    a etapa é do CNPJ — sem esta trava, a VictorIA diria "você não tem acesso"
    //    a quem está logado e vendendo.
    const opera = new Set<string>()
    for (const l of leads) if ((l.observacoes ?? '').includes('[IMPORTADO_PORTAL:') && l.status !== 'EM_ANALISE_AIVA') opera.add(l.id)
    for (const reg of registros) if (reg.lead_id && (reg.rid || reg.status === 'ativa')) opera.add(reg.lead_id)
    for (const reg of registros) {
      if (!reg.lead_id || opera.has(reg.lead_id)) continue
      const st = stagePorCnpj.get(soDigitos(reg.cnpj))
      if (!st) continue
      const atual = etapaPorLead.get(reg.lead_id)
      const pior = (a: string, b: string) => (ONB_ORDEM.indexOf(a as OnbSituacao) <= ONB_ORDEM.indexOf(b as OnbSituacao) ? a : b)
      etapaPorLead.set(reg.lead_id, atual ? pior(atual, st) : st)
    }
    for (const st of etapaPorLead.values()) {
      if (st === 'dados_varejo') saida.onboarding_aberto.dados_varejo++
      else if (st === 'aguardando_aiva') saida.onboarding_aberto.aguardando_aiva++
      else saida.onboarding_aberto.biometria++
    }
  }
  if (dry) {
    saida.movidos = r.movimentos
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
  for (; i < r.movimentos.length; i++) {
    if (i >= TETO_MOVIMENTOS || Date.now() - inicio > TETO_MS) break
    const m = r.movimentos[i]
    try {
      for (const etapa of [...m.via, m.para]) {
        await changeOpportunityStage(m.opp, etapa)
        // a automação do Evo + nosso handler rodam do outro lado; um respiro evita
        // dois webhooks do mesmo card se atropelando
        await new Promise((res) => setTimeout(res, 800))
      }
      await marcar(m.lead_id, MARCADOR_ESPELHO, `${m.para}:${new Date().toISOString()}`)
      console.log(`[espelho-portal] opp #${m.opp} ${m.de} → ${m.para}${m.via.length ? ` (via ${m.via.join(',')})` : ''} · ${m.nome} · ${m.motivo}`)
      saida.movidos.push(m)
    } catch (e) {
      const erro = String(e).slice(0, 160)
      console.error(`[espelho-portal] falha ao mover opp #${m.opp} (${m.nome}):`, erro)
      saida.movidos.push({ ...m, erro })
    }
  }
  saida.sobraram = r.movimentos.length - i

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
        if (!aindaRuim && await desmarcar(lead.id, m)) saida.cnpj.regularizados++
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
  const novosPreCad: string[] = []
  {
    const { porLead, travados } = preCadastroNaoChegou(onboardings, registros, leads)
    for (const lead of leads) {
      const tem = (lead.observacoes ?? '').includes('[PRE_CAD_NAO_CHEGOU:')
      const deve = travados.has(lead.id)
      if (deve) saida.pre_cadastro_nao_chegou.push(`${lead.nome} (${porLead.get(lead.id)!.cnpjs.join(', ')})`)
      if (dry || deve === tem) continue
      try {
        if (deve) {
          const x = porLead.get(lead.id)!
          await marcar(lead.id, 'PRE_CAD_NAO_CHEGOU', new Date(x.maisAntigo).toISOString())
          await registrarAvisos('pre_cadastro_nao_chegou', [{ leadId: lead.id, loja: lead.nome, status: String(lead.status), detalhe: `CNPJ ${x.cnpjs.join(', ')} · marcado em ${new Date(x.maisAntigo).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` }])
          novosPreCad.push(`• ${lead.nome} — CNPJ ${x.cnpjs.join(', ')}`)
        } else {
          await desmarcar(lead.id, 'PRE_CAD_NAO_CHEGOU')
          await resolverAvisos('pre_cadastro_nao_chegou', [lead.id], 'auto: o CNPJ apareceu no portal (ou o lead saiu da etapa)')
        }
      } catch (e) {
        avisos.push(`pré-cadastro não chegou (${lead.nome}): ${String(e).slice(0, 100)}`)
      }
    }
  }

  const blocos: string[] = []
  if (novosPreCad.length) {
    blocos.push(
      `📮 *Pré-cadastro não chegou à AIVA* (${novosPreCad.length})\n${novosPreCad.join('\n')}\n\n` +
      'Marcado como enviado em Registros AIVA há mais de 24h e o CNPJ não aparece no portal — o formulário não foi enviado. ' +
      'Reenviar pelo Registros AIVA; o card anda sozinho depois.\n📌 Também está no topo do Atendimento.',
    )
  }
  if (novos.length) {
    blocos.push(
      `⛔ *Pré-cadastro REPROVADO pela AIVA* (${novos.length})\n${novos.join('\n')}\n\n` +
      'Card movido pra "Loja Descartada pela Aiva" e lead travado. Se a AIVA reconsiderar: mover o card pra Interessado e clicar Reativar no painel.',
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
  if (paradosAiva.length) {
    blocos.push(
      `⏳ *Cadastro pronto e a AIVA não criou a loja* (${paradosAiva.length})\n${paradosAiva.join('\n')}\n\n` +
      'O lojista fez tudo: formulário concluído e biometria APROVADA. O portal fica parado em "biometria" até a AIVA ' +
      'criar o ID da loja — sem isso não há treinamento nem acesso. Cobrar a AIVA (Mauricio/Edu).' +
      'A VictorIA já sabe e não cobra mais nada dele.',
    )
  }
  for (const texto of blocos) {
    for (const tel of [process.env.NEI_WHATSAPP, process.env.ALDO_WHATSAPP].filter(Boolean) as string[]) {
      try { await sendText(tel, texto) } catch (e) { avisos.push(`aviso de reprovado não enviado: ${String(e).slice(0, 100)}`) }
    }
  }

  return saida
}
