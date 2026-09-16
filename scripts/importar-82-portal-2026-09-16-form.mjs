#!/usr/bin/env node
/**
 * Parte 4 da importação dos 82: a etapa 50 (Em Análise AIVA) tem
 * `requiredforms: [10]` e `cancreate: 0` — o Evo não cria card nela e ignora
 * em silêncio o move de opp sem o formulário "Qualificação Varejo" (form 10).
 * Aqui preenchemos os 7 campos obrigatórios do form com o que a Receita deu
 * (sócio, telefone, nome do varejo, CNPJ, região, nº de lojas, outra operação)
 * e só então movemos pra 50, com read-after-write.
 *
 *   node --env-file=.env.local scripts/importar-82-portal-2026-09-16-form.mjs
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const S = process.env.SAIDA
const receita = JSON.parse(readFileSync(S + '/receita-82.json', 'utf8'))
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))
const titulo = (s) => String(s ?? '').trim().toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase())
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const evo = async (path, body, key = process.env.EVO_TALKS_QUEUE_API_KEY) => {
  const res = await fetch(`${process.env.EVO_TALKS_BASE_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: Number(process.env.EVO_TALKS_QUEUE_ID), apiKey: key, ...body }),
    signal: AbortSignal.timeout(30000),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Evo ${path} ${res.status}: ${txt.slice(0, 160)}`)
  try { return JSON.parse(txt) } catch { return {} }
}
const funil = async () => new Map((await evo('/int/getPipeOpportunities', { pipelineId: 15 }, process.env.EVO_TALKS_API_KEY)).map((o) => [Number(o.id), Number(o.fkStage)]))

const { data: leads } = await sb.from('sdr_leads').select('id, nome, telefone, cidade, evotalks_opportunity_id').like('observacoes', '%[IMPORTADO_PORTAL:%')
const { data: regs } = await sb.from('sdr_registros_cnpj').select('lead_id, cnpj').in('lead_id', leads.map((l) => l.id))
// Cell Store ficou sem registro na parte 1 (telefone da Receita já existia no banco → lead da 1ª execução)
if (!regs.some((r) => r.lead_id === leads.find((l) => l.nome === 'Cell Store')?.id)) {
  const cs = leads.find((l) => l.nome === 'Cell Store')
  if (cs) { await sb.from('sdr_registros_cnpj').insert({ lead_id: cs.id, loja: cs.nome, telefone: cs.telefone, cnpj: '07805356000141', tipo: 'matriz', status: 'pre_cadastro_enviado', enviado: true, origem: 'portal' }); regs.push({ lead_id: cs.id, cnpj: '07805356000141' }); console.log('registro da Cell Store inserido') }
}
const cnpjDe = (l) => String(regs.find((r) => r.lead_id === l.id)?.cnpj ?? (l.telefone.startsWith('000') ? l.telefone.slice(3) : ''))
const raizes = {}
for (const l of leads) { const r = cnpjDe(l).slice(0, 8); raizes[r] = (raizes[r] ?? 0) + 1 }

let preenchidos = 0, erros = []
for (const l of leads) {
  const opp = Number(l.evotalks_opportunity_id)
  const cnpj = cnpjDe(l)
  const r = receita[cnpj]?.ok ? receita[cnpj] : null
  const socio = titulo(r?.socios?.[0]) || (r?.razao && /^\d{2}\.\d{3}\.\d{3} /.test(r.razao) ? titulo(r.razao.replace(/^\d{2}\.\d{3}\.\d{3} /, '')) : '') || 'Não informado (importado do portal AIVA)'
  const formsdata = {
    da6ddf70: socio,
    db8569f0: l.telefone.startsWith('000') ? 'sem WhatsApp conhecido — pedir à AIVA' : l.telefone,
    dcacfa00: l.nome,
    dd2ab580: cnpj,
    dede58f0: l.cidade ?? 'Não informado',
    df6f9c70: String(raizes[cnpj.slice(0, 8)] ?? 1),
    e07d62f0: 'Já opera com a AIVA — cliente Track importado do portal em 16/09/2026',
  }
  try {
    await evo('/int/updateOpportunity', { id: opp, formsdata })
    preenchidos++
  } catch (e) { erros.push(`${l.nome} #${opp}: form ${String(e).slice(0, 120)}`) }
  await dorme(700)
}
console.log(`formulário preenchido em ${preenchidos}/${leads.length}`)

for (let passada = 1; passada <= 2; passada++) {
  const st = await funil()
  const pend = leads.filter((l) => st.get(Number(l.evotalks_opportunity_id)) !== 50)
  console.log(`passada ${passada}: ${pend.length} card(s) fora da 50`)
  if (!pend.length) break
  for (const l of pend) {
    try { await evo('/int/changeOpportunityStage', { id: Number(l.evotalks_opportunity_id), destStageId: 50 }) } catch (e) { erros.push(`${l.nome}: move ${String(e).slice(0, 100)}`) }
    await dorme(2000)
  }
  await dorme(10000)
}
const fim = await funil()
const por = {}
for (const l of leads) { const s = fim.get(Number(l.evotalks_opportunity_id)) ?? 'sumiu'; por[s] = (por[s] ?? 0) + 1 }
console.log('etapa final dos 82 no Evo:', por)
for (const l of leads.filter((l) => fim.get(Number(l.evotalks_opportunity_id)) !== 50)) console.log('  fora da 50:', l.nome, '#' + l.evotalks_opportunity_id, fim.get(Number(l.evotalks_opportunity_id)))

await dorme(6000)
const { data: st2 } = await sb.from('sdr_leads').select('id, status').like('observacoes', '%[IMPORTADO_PORTAL:%')
const fora = (st2 ?? []).filter((x) => x.status !== 'EM_ANALISE_AIVA')
for (const x of fora) await sb.from('sdr_leads').update({ status: 'EM_ANALISE_AIVA' }).eq('id', x.id)
console.log('status reafirmado em', fora.length, '· erros', erros.length)
for (const e of erros) console.log('  ', e)
process.exit(0)
