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
import { listarOnboardingsApi, loginPortal, partnerIdTrack, rest, type Sessao } from '@/lib/portal-aiva'
import {
  calcularEspelho, soDigitos, ETAPA, MARCADOR_REPROVADO, MARCADOR_CONFERIR,
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
      const { data } = await rest<Array<{ retailer_id: string | number }>>(
        s, `retailer_performance?select=retailer_id&partner_id=eq.${encodeURIComponent(partner)}&n_vendas=gt.0`, [de, de + 999],
      )
      for (const l of data) vendeu.add(String(l.retailer_id))
      if (data.length < 1000) break
    }
    return { loginEnviado, vendeu, aviso: null }
  } catch (e) {
    return { loginEnviado: new Set(), vendeu: new Set(), aviso: `leitura do banco do portal falhou (${String(e).slice(0, 120)}) — Login/Vendendo não avaliados nesta rodada` }
  }
}

async function registrosComLead(): Promise<RegistroCnpj[]> {
  const out: RegistroCnpj[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin
      .from('sdr_registros_cnpj')
      .select('id,cnpj,lead_id,status,rid')
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
async function desmarcar(leadId: string, marcador: string): Promise<void> {
  const { data } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', leadId).maybeSingle()
  const obs = (data?.observacoes ?? '')
  const limpo = obs.replace(new RegExp(`\s*\[${marcador}:[^\]]*\]`, 'g'), '').trim()
  if (limpo !== obs.trim()) await supabaseAdmin.from('sdr_leads').update({ observacoes: limpo }).eq('id', leadId)
}

export type SaidaEspelho = {
  ok: boolean
  dry: boolean
  avisos: string[]
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
}

export async function executarEspelho(dry: boolean): Promise<SaidaEspelho> {
  const inicio = Date.now()
  const avisos: string[] = []

  // 1) portal
  const onboardings = (await listarOnboardingsApi()).map((o): OnbApi => ({
    cnpj: String(o.cnpj ?? ''), stage: String(o.stage ?? ''), pre_cadastro_status: o.pre_cadastro_status ?? null,
    retailer_id: o.retailer_id ?? null, legal_name: o.legal_name ?? null,
    cnpj_check_status: o.cnpj_check_status ?? null, cnpj_situacao: o.cnpj_situacao ?? null, cnpj_check_reason: o.cnpj_check_reason ?? null,
  }))
  const sinais = await sinaisPortal()
  if (sinais.aviso) avisos.push(sinais.aviso)

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
    ok: true, dry, avisos, onboardings: onboardings.length, leads: leads.length,
    movidos: [], sobraram: 0, reprovados: r.reprovados, conferir: r.conferir, registros_enviados: r.registrosEnviados.length, pulados: r.pulados,
    cnpj: { irregular: 0, invalido: 0, novos: [], regularizados: 0 },
  }
  if (dry) {
    saida.movidos = r.movimentos
    // preview da checagem de CNPJ: o dry antes devolvia zero porque retornava
    // aqui, ANTES do passo 8 — e "?dry=1" existe justamente pra ver o que faria.
    const leadPorIdDry = new Map(leads.map((l) => [l.id, l]))
    const vistosDry = new Set<string>()
    for (const reg of registros) {
      const info = irregulares.get(soDigitos(reg.cnpj))
      const lead = reg.lead_id ? leadPorIdDry.get(reg.lead_id) : null
      if (!info || !lead || vistosDry.has(lead.id)) continue
      vistosDry.add(lead.id)
      if (SITUACAO_REAL.has(info.status)) saida.cnpj.irregular++
      else saida.cnpj.invalido++
      const marcador = SITUACAO_REAL.has(info.status) ? MARCADOR_CNPJ_IRREGULAR : MARCADOR_CNPJ_INVALIDO
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
    const vistos = new Set<string>()
    for (const reg of registros) {
      const info = irregulares.get(soDigitos(reg.cnpj))
      const lead = reg.lead_id ? leadPorId.get(reg.lead_id) : null
      if (!info || !lead || vistos.has(lead.id)) continue
      vistos.add(lead.id)
      const real = SITUACAO_REAL.has(info.status)
      const marcador = real ? MARCADOR_CNPJ_IRREGULAR : MARCADOR_CNPJ_INVALIDO
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
        const aindaRuim = registros.some((reg) => reg.lead_id === lead.id && irregulares.has(soDigitos(reg.cnpj)))
        if (!aindaRuim) { await desmarcar(lead.id, m); saida.cnpj.regularizados++ }
      }
    }
  }
  saida.cnpj.novos = cnpjNovos

  const blocos: string[] = []
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
  for (const texto of blocos) {
    for (const tel of [process.env.NEI_WHATSAPP, process.env.ALDO_WHATSAPP].filter(Boolean) as string[]) {
      try { await sendText(tel, texto) } catch (e) { avisos.push(`aviso de reprovado não enviado: ${String(e).slice(0, 100)}`) }
    }
  }

  return saida
}
