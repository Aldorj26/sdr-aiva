/**
 * lib/jornada-aiva.ts — IO do painel /jornada. Busca as três fontes e entrega pro
 * calc (lib/jornada-aiva-calc.ts), que é onde moram as regras.
 *
 *   1. API pública da AIVA (onboardings)        — a fase de cada cadastro
 *   2. Banco do portal, via login (desempenho, login_sends) — senha e venda
 *   3. Evo (funil 15) + nossa base              — card e conversa
 *
 * Cada fonte é independente (Promise.allSettled): se o portal cair, o painel abre
 * com o que tiver e diz o que faltou — nunca uma tela branca de erro. Resultado
 * guardado 5 min (unstable_cache): o Nei abre a tela várias vezes por dia e cada
 * leitura completa custa ~5 requisições externas.
 */
import { unstable_cache } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { listarOnboardingsApi, loginPortal, partnerIdTrack, buscarPerformance, listarSenhasEnviadas, listarSenhasPendentes } from '@/lib/portal-aiva'
import { getPipeOpportunities } from '@/lib/evotalks'
import { proximasTurmas } from '@/lib/turmas-treinamento'
import { montarPainel, soDigitos, type Painel, type LeadRef, type Onb, type Perf } from '@/lib/jornada-aiva-calc'

export type Carga = {
  painel: Painel
  geradoEm: string
  avisos: string[]
  turmas: Array<{ startsAt: string; link: string }>
}

async function leadsPorCnpj(): Promise<Map<string, LeadRef>> {
  const regs: Array<{ cnpj: string; lead_id: string }> = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin.from('sdr_registros_cnpj').select('cnpj,lead_id')
      .not('lead_id', 'is', null).order('id', { ascending: true }).range(de, de + 999)
    if (error) throw new Error(`sdr_registros_cnpj: ${error.message}`)
    regs.push(...((data ?? []) as Array<{ cnpj: string; lead_id: string }>))
    if (!data || data.length < 1000) break
  }
  const ids = [...new Set(regs.map((r) => r.lead_id))]
  const leads = new Map<string, LeadRef>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabaseAdmin.from('sdr_leads').select('id,nome,status,evotalks_opportunity_id').in('id', ids.slice(i, i + 200))
    if (error) throw new Error(`sdr_leads: ${error.message}`)
    for (const l of (data ?? []) as Array<{ id: string; nome: string | null; status: string | null; evotalks_opportunity_id: number | string | null }>) {
      const opp = Number(l.evotalks_opportunity_id)
      leads.set(l.id, { id: l.id, nome: l.nome, status: l.status, opp: Number.isFinite(opp) && opp > 0 ? opp : null })
    }
  }
  const out = new Map<string, LeadRef>()
  for (const r of regs) {
    const c = soDigitos(r.cnpj), l = leads.get(r.lead_id)
    if (c.length === 14 && l && !out.has(c)) out.set(c, l)
  }
  return out
}

async function portal(): Promise<{ perf: Perf[]; enviada: Map<string, string>; pedida: Map<string, string> }> {
  const s = await loginPortal()
  const partner = await partnerIdTrack(s)
  const [perf, enviada, pendentes] = await Promise.all([buscarPerformance(s, partner, null), listarSenhasEnviadas(s), listarSenhasPendentes(s)])
  const pedida = new Map<string, string>()
  for (const p of pendentes) if (!pedida.has(p.retailer_id)) pedida.set(String(p.retailer_id), p.permission_requested_at)
  return { perf: perf as Perf[], enviada, pedida }
}

async function carregar(): Promise<Carga> {
  const avisos: string[] = []
  const [rOnb, rPortal, rLeads, rEvo, rTurmas] = await Promise.allSettled([
    listarOnboardingsApi(), portal(), leadsPorCnpj(), getPipeOpportunities(15), proximasTurmas(3),
  ])
  const falhou = (r: PromiseSettledResult<unknown>, oQue: string) => {
    if (r.status === 'rejected') avisos.push(`${oQue}: ${String(r.reason).slice(0, 140)}`)
  }
  falhou(rOnb, 'API de cadastros da AIVA fora — fases do cadastro não carregaram')
  falhou(rPortal, 'Banco do portal fora — senha e vendas não carregaram')
  falhou(rLeads, 'Nossa base fora — vínculo com o lead não carregou')
  falhou(rEvo, 'Evo fora — funil 15 não carregou')

  const stagePorOpp = new Map<number, number>()
  const porEtapa = new Map<number, number>()
  if (rEvo.status === 'fulfilled') {
    for (const c of rEvo.value) {
      stagePorOpp.set(c.id, c.fkStage)
      porEtapa.set(c.fkStage, (porEtapa.get(c.fkStage) ?? 0) + 1)
    }
  }
  const agora = Date.now()
  const painel = montarPainel({
    onbs: rOnb.status === 'fulfilled' ? (rOnb.value as Onb[]) : [],
    perf: rPortal.status === 'fulfilled' ? rPortal.value.perf : [],
    senhaEnviada: rPortal.status === 'fulfilled' ? rPortal.value.enviada : new Map(),
    senhaPedida: rPortal.status === 'fulfilled' ? rPortal.value.pedida : new Map(),
    leadPorCnpj: rLeads.status === 'fulfilled' ? rLeads.value : new Map(),
    stagePorOpp,
    agora,
  }, porEtapa)
  return {
    painel,
    geradoEm: new Date(agora).toISOString(),
    avisos,
    turmas: rTurmas.status === 'fulfilled' ? rTurmas.value.turmas.map((t) => ({ startsAt: t.startsAt, link: t.link })) : [],
  }
}

/** Leitura com 5 min de cache. `fresco` ignora o cache (botão "Atualizar agora"). */
const carregarCache = unstable_cache(carregar, ['jornada-aiva-v1'], { revalidate: 300, tags: ['jornada-aiva'] })
export async function carregarJornada(fresco = false): Promise<Carga> {
  return fresco ? carregar() : carregarCache()
}
