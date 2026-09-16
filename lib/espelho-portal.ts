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
  calcularEspelho, soDigitos, MARCADOR_REPROVADO,
  type LeadEspelho, type Movimento, type OnbApi, type RegistroCnpj, type Resultado,
} from '@/lib/espelho-portal-calc'

const PIPELINE_AIVA = 15
/** Teto por rodada: cada movimento dispara automação + HSM do lado do Evo. */
const TETO_MOVIMENTOS = 30
const TETO_MS = 200_000
export const MARCADOR_ESPELHO = 'ESPELHO_PORTAL'

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
      .select('id,cnpj,lead_id,status')
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

export type SaidaEspelho = {
  ok: boolean
  dry: boolean
  avisos: string[]
  onboardings: number
  leads: number
  movidos: Array<Movimento & { erro?: string }>
  sobraram: number
  reprovados: Resultado['reprovados']
  registros_enviados: number
  pulados: Resultado['pulados']
}

export async function executarEspelho(dry: boolean): Promise<SaidaEspelho> {
  const inicio = Date.now()
  const avisos: string[] = []

  // 1) portal
  const onboardings = (await listarOnboardingsApi()).map((o): OnbApi => ({
    cnpj: String(o.cnpj ?? ''), stage: String(o.stage ?? ''), pre_cadastro_status: o.pre_cadastro_status ?? null,
    retailer_id: o.retailer_id ?? null, legal_name: o.legal_name ?? null,
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

  const saida: SaidaEspelho = {
    ok: true, dry, avisos, onboardings: onboardings.length, leads: leads.length,
    movidos: [], sobraram: 0, reprovados: r.reprovados, registros_enviados: r.registrosEnviados.length, pulados: r.pulados,
  }
  if (dry) { saida.movidos = r.movimentos; return saida }

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

  // 6) reprovados pela AIVA: marca o lead e avisa Nei + Aldo (uma vez por lead)
  if (r.reprovados.length) {
    const linhas: string[] = []
    for (const x of r.reprovados) {
      try {
        await marcar(x.lead_id, MARCADOR_REPROVADO, new Date().toISOString())
        linhas.push(`• ${x.nome}${x.loja ? ` — ${x.loja}` : ''} (CNPJ ${soDigitos(x.cnpj)})${x.opp ? ` · opp #${x.opp}` : ''}`)
      } catch (e) {
        avisos.push(`reprovado ${x.nome} não marcado: ${String(e).slice(0, 100)}`)
      }
    }
    if (linhas.length) {
      const texto =
        `⛔ *Pré-cadastro REPROVADO pela AIVA* (${linhas.length})\n${linhas.join('\n')}\n\n` +
        'O lead continua ativo no funil — decidir o que fazer com o card (o espelho não descarta ninguém).'
      for (const tel of [process.env.NEI_WHATSAPP, process.env.ALDO_WHATSAPP].filter(Boolean) as string[]) {
        try { await sendText(tel, texto) } catch (e) { avisos.push(`aviso de reprovado não enviado: ${String(e).slice(0, 100)}`) }
      }
    }
  }

  return saida
}
