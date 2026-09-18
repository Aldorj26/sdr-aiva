/**
 * Cruza a lista de CNPJs que a AIVA tirou do pipe (Aldo, 18/09/2026) com a NOSSA base:
 * registro → lead → card no funil 15 do Evo → situação atual no portal da AIVA.
 *
 * Só LÊ. Não move card, não marca lead, não fala com ninguém.
 * Uso: npx tsx --env-file=.env.local scripts/cnpjs-fora-do-pipe-2026-09-18.mts
 */
import { listarOnboardingsApi } from '../lib/portal-aiva'
import { supabaseAdmin } from '../lib/supabase'
import { getPipeOpportunities } from '../lib/evotalks'
import fs from 'node:fs'

const LISTA = fs.readFileSync('scripts/cnpjs-fora-2026-09-18.txt', 'utf8')
const so = (c: string) => c.replace(/\D/g, '')
const dvOk = (c: string) => {
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false
  const calc = (base: string, pesos: number[]) => {
    const s = base.split('').reduce((a, d, i) => a + Number(d) * pesos[i], 0)
    const r = s % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return c[12] === String(d1) && c[13] === String(d2)
}
const cnpjs = [...new Set(LISTA.split('\n').map((l) => so(l)).filter((c) => c.length === 14))]

const ETAPA_NOME: Record<number, string> = {
  66: 'Início', 47: 'Interessado', 53: 'Sem resposta', 54: 'Pré Aprovação', 49: 'Cadastro Recebido',
  50: 'Em Análise AIVA', 70: 'Treinar', 71: 'Login', 51: 'Vendendo', 69: 'Bot',
  93: 'Menos de 1 Ano', 94: 'CNPJ Irregular', 95: 'Descartada pela Aiva',
}

// portal
const onbs = await listarOnboardingsApi()
const noPortal = new Map(onbs.map((o) => [so(String(o.cnpj ?? '')), o]))

// nossos registros (paginado — PostgREST corta em 1.000)
type Reg = { cnpj: string; lead_id: string | null; rid: string | null; status: string | null; loja: string | null; telefone: string | null; tipo: string | null }
const regs: Reg[] = []
for (let de = 0; ; de += 1000) {
  const { data } = await supabaseAdmin.from('sdr_registros_cnpj')
    .select('cnpj,lead_id,rid,status,loja,telefone,tipo').range(de, de + 999)
  regs.push(...((data ?? []) as Reg[]))
  if (!data || data.length < 1000) break
}
const regPorCnpj = new Map<string, Reg[]>()
for (const r of regs) {
  const c = so(r.cnpj)
  if (!regPorCnpj.has(c)) regPorCnpj.set(c, [])
  regPorCnpj.get(c)!.push(r)
}

// leads
const leadIds = [...new Set(regs.filter((r) => r.lead_id).map((r) => r.lead_id!))]
type Lead = { id: string; nome: string | null; telefone: string; status: string; evotalks_opportunity_id: string | number | null; observacoes: string | null; cidade: string | null }
const leads = new Map<string, Lead>()
for (let i = 0; i < leadIds.length; i += 200) {
  const { data } = await supabaseAdmin.from('sdr_leads')
    .select('id,nome,telefone,status,evotalks_opportunity_id,observacoes,cidade').in('id', leadIds.slice(i, i + 200))
  for (const l of (data ?? []) as Lead[]) leads.set(l.id, l)
}

// cards no Evo (funil 15)
const opps = await getPipeOpportunities(15)
const stagePorOpp = new Map<number, number>()
for (const o of opps) stagePorOpp.set(Number(o.id), Number(o.fkStage))

const linhas = cnpjs.map((c) => {
  const rs = regPorCnpj.get(c) ?? []
  const r = rs.find((x) => x.lead_id) ?? rs[0] ?? null
  const lead = r?.lead_id ? leads.get(r.lead_id) ?? null : null
  const opp = lead?.evotalks_opportunity_id ? Number(lead.evotalks_opportunity_id) : null
  const etapa = opp ? stagePorOpp.get(opp) ?? null : null
  const o = noPortal.get(c)
  const obs = lead?.observacoes ?? ''
  return {
    cnpj: c,
    dv_valido: dvOk(c),
    nossa_loja: lead?.nome ?? r?.loja ?? null,
    telefone: lead?.telefone ?? r?.telefone ?? null,
    cidade: lead?.cidade ?? null,
    temos_registro: rs.length > 0,
    temos_lead: !!lead,
    status_lead: lead?.status ?? null,
    card_opp: opp,
    etapa_card: etapa ? ETAPA_NOME[etapa] ?? String(etapa) : null,
    etapa_id: etapa,
    rid: r?.rid ?? null,
    status_registro: r?.status ?? null,
    ainda_no_portal: !!o,
    stage_portal: o?.stage ?? null,
    pre_cadastro: o?.pre_cadastro_status ?? null,
    nome_portal: o?.legal_name ?? null,
    lead_id: lead?.id ?? null,
    cobranca_toque: Number(obs.match(/\[COBRANCA_FORM:(\d+):/)?.[1] ?? 0),
    ultimo_contato_nosso: obs.match(/\[COBRANCA_FORM:\d+:([^\]]+)\]/)?.[1] ?? null,
    tipo_registro: r?.tipo ?? null,
    lead_tem_loja_ativa: !!(r?.lead_id && regs.some((x) => x.lead_id === r!.lead_id && (x.rid || x.status === 'ativa'))),
    criado_portal: o?.created_at ?? null,
    atualizado_portal: o?.updated_at ?? null,
    formulario: (o as { formulario_status?: string | null } | undefined)?.formulario_status ?? null,
    biometria: (o as { biometry_status?: string | null } | undefined)?.biometry_status ?? null,
    cobranca_esgotada: obs.includes('[COBRANCA_FORM_ESGOTADO]'),
    marcadores: [
      obs.includes('[PORTAL_REPROVADO') ? 'PORTAL_REPROVADO' : '',
      obs.includes('[CNPJ_IRREGULAR_AIVA:') ? 'CNPJ_IRREGULAR' : '',
      obs.includes('[IMPORTADO_PORTAL:') ? 'IMPORTADO_PORTAL' : '',
      obs.includes('[SENHA_ENVIADA:') ? 'SENHA_ENVIADA' : '',
    ].filter(Boolean).join(' '),
  }
})

fs.writeFileSync('scripts/out-cnpjs-fora.json', JSON.stringify(linhas, null, 1), 'utf8')
const n = (f: (l: typeof linhas[0]) => boolean) => linhas.filter(f).length
console.log(`CNPJs na lista: ${cnpjs.length} (únicos, DV inválido: ${n((l) => !l.dv_valido)})`)
console.log(`com registro nosso: ${n((l) => l.temos_registro)} · com lead: ${n((l) => l.temos_lead)} · sem nada: ${n((l) => !l.temos_registro)}`)
console.log(`ainda aparecem no portal da AIVA: ${n((l) => l.ainda_no_portal)}`)
console.log(`com card no funil 15: ${n((l) => !!l.card_opp && !!l.etapa_card)}`)
const porEtapa = new Map<string, number>()
for (const l of linhas) if (l.etapa_card) porEtapa.set(l.etapa_card, (porEtapa.get(l.etapa_card) ?? 0) + 1)
console.log('cards por etapa:', [...porEtapa].sort((a, b) => b[1] - a[1]).map(([e, q]) => `${e}=${q}`).join(' · '))
