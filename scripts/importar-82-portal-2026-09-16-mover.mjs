#!/usr/bin/env node
/**
 * Parte 3 da importação dos 82: o move pra 50 feito logo após criar o card NÃO
 * persistiu no Evo (200 sem gravar — lição de 26/08). Esta passada relê o funil,
 * move quem não está em 50 com folga entre chamadas, confere de novo (read-after-
 * write), repete uma vez se precisar, reafirma EM_ANALISE_AIVA e completa o
 * registro que faltou.
 *
 *   node --env-file=.env.local scripts/importar-82-portal-2026-09-16-mover.mjs
 */
import { createClient } from '@supabase/supabase-js'

const dorme = (ms) => new Promise((r) => setTimeout(r, ms))
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
const funil = async () => {
  const opps = await evo('/int/getPipeOpportunities', { pipelineId: 15 }, process.env.EVO_TALKS_API_KEY)
  return new Map(opps.map((o) => [Number(o.id), Number(o.fkStage)]))
}

const { data: leads } = await sb.from('sdr_leads').select('id, nome, telefone, evotalks_opportunity_id').like('observacoes', '%[IMPORTADO_PORTAL:%')
const alvo = leads.filter((l) => l.evotalks_opportunity_id).map((l) => ({ ...l, opp: Number(l.evotalks_opportunity_id) }))

for (let passada = 1; passada <= 2; passada++) {
  const st = await funil()
  const pend = alvo.filter((l) => st.get(l.opp) !== 50)
  console.log(`passada ${passada}: ${pend.length} card(s) fora da 50`)
  if (!pend.length) break
  for (const l of pend) {
    try { await evo('/int/changeOpportunityStage', { id: l.opp, destStageId: 50 }) } catch (e) { console.log(`✗ ${l.nome} #${l.opp}: ${String(e).slice(0, 120)}`) }
    await dorme(2500)
  }
  await dorme(10000)
}
const fim = await funil()
const por = {}
for (const l of alvo) { const s = fim.get(l.opp) ?? 'sumiu'; por[s] = (por[s] ?? 0) + 1 }
console.log('etapa final dos 82 no Evo:', por)
for (const l of alvo.filter((l) => fim.get(l.opp) !== 50)) console.log('  fora da 50:', l.nome, '#' + l.opp, fim.get(l.opp))

// status reafirmado + registro que faltou
await dorme(5000)
const { data: st2 } = await sb.from('sdr_leads').select('id, status').like('observacoes', '%[IMPORTADO_PORTAL:%')
const fora = (st2 ?? []).filter((x) => x.status !== 'EM_ANALISE_AIVA')
for (const x of fora) await sb.from('sdr_leads').update({ status: 'EM_ANALISE_AIVA' }).eq('id', x.id)
console.log('status reafirmado em', fora.length)
const { data: regs } = await sb.from('sdr_registros_cnpj').select('lead_id').in('lead_id', leads.map((l) => l.id))
const comReg = new Set((regs ?? []).map((r) => r.lead_id))
for (const l of leads.filter((l) => !comReg.has(l.id))) {
  const cnpj = l.telefone.startsWith('000') ? l.telefone.slice(3) : null
  console.log('lead sem registro:', l.nome, l.telefone, cnpj ? `→ inserindo ${cnpj}` : '→ CNPJ não dedutível do telefone')
  if (cnpj) await sb.from('sdr_registros_cnpj').insert({ lead_id: l.id, loja: l.nome, telefone: l.telefone, cnpj, tipo: cnpj.slice(8, 12) === '0001' ? 'matriz' : 'adicional', status: 'pre_cadastro_enviado', enviado: true, origem: 'portal' })
}
process.exit(0)
