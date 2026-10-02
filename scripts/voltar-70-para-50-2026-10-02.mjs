/**
 * voltar-70-para-50-2026-10-02.mjs — cards em Treinar (70) cujo cadastro AINDA está aberto no
 * portal da AIVA (formulário ou biometria) voltam pra Em Análise AIVA (50), SEM mensagem
 * (Aldo, raio-x do funil 02/10/2026). Lead DESCARTADO fica de fora (mover reativaria o status).
 *
 * Mesmo padrão de scripts/arrumar-51-sem-operar-2026-09-28.mjs: grava
 * [MOVE_SILENCIOSO:50:<ISO>] antes de mover — o /opportunity-stage vê a marca e só atualiza
 * o status (nada de link de cadastro, aviso nem planilha).
 * Uso: node --env-file=.env.local scripts/voltar-70-para-50-2026-10-02.mjs [--piloto | --todos]
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const MODO = process.argv.includes('--todos') ? 'todos' : process.argv.includes('--piloto') ? 'piloto' : 'ensaio'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const Q = { queueId: Number(process.env.EVO_TALKS_QUEUE_ID ?? 10), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY }
const evo = async (p, b) => { const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Q, ...b }) }); const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t.slice(0, 100)}`); try { return JSON.parse(t) } catch { return t } }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const dig = (v) => String(v ?? '').replace(/\D/g, '')

// portal: quem está com o cadastro aberto
const onbs = []; let cursor = null
do { const q = new URLSearchParams({ limit: '500' }); if (cursor) q.set('cursor', cursor); const d = await (await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, { headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY } })).json(); onbs.push(...(d.records ?? [])); cursor = d.next_cursor ?? null } while (cursor)
const aberto = new Map(onbs.filter((o) => ['dados_varejo', 'biometria'].includes(o.stage)).map((o) => [dig(o.cnpj), o.stage]))
const finalizado = new Set(onbs.filter((o) => o.stage === 'cadastro_finalizado').map((o) => dig(o.cnpj)))

const cards = await (await fetch(`${BASE}/int/getPipeOpportunities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: 10, apiKey: process.env.EVO_TALKS_API_KEY, pipelineId: 15 }) })).json()
const em70 = cards.filter((c) => Number(c.fkStage) === 70)
const alvo = []
for (const c of em70) {
  const { data: l } = await sb.from('sdr_leads').select('id,nome,status,observacoes').eq('evotalks_opportunity_id', String(c.id)).maybeSingle()
  if (!l || l.status === 'DESCARTADO') continue
  const { data: regs } = await sb.from('sdr_registros_cnpj').select('cnpj').eq('lead_id', l.id)
  const cs = [...new Set([...(regs ?? []).map((r) => dig(r.cnpj)), dig((l.observacoes ?? '').match(/cnpj_matriz=([0-9./-]+)/)?.[1])].filter((x) => x.length === 14))]
  // só volta se NENHUM CNPJ do lead já tem a loja criada e algum está com o cadastro aberto
  if (cs.some((x) => finalizado.has(x))) continue
  const etapa = cs.map((x) => aberto.get(x)).find(Boolean)
  if (etapa) alvo.push({ opp: Number(c.id), lead: l, etapa })
}
const lista = MODO === 'piloto' ? alvo.slice(0, 1) : alvo
console.log(`${MODO}: ${lista.length} de ${alvo.length} cards`)
const res = []
for (const x of lista) {
  console.log(`- ${x.lead.nome} (${x.lead.status}) · portal em ${x.etapa}`)
  if (MODO === 'ensaio') continue
  const card = await evo('/int/getOpportunity', { id: x.opp })
  if (Number(card.fkStage) !== 70) { console.log('   card saiu da 70 desde o levantamento — pulei'); continue }
  const antes = new Date().toISOString()
  await sb.from('sdr_leads').update({ observacoes: `${(x.lead.observacoes ?? '').trim()} [MOVE_SILENCIOSO:50:${antes}] [VOLTOU_70_50:${antes}]` }).eq('id', x.lead.id)
  await evo('/int/changeOpportunityStage', { id: x.opp, destStageId: 50 })
  await espera(8000)
  const { data: depois } = await sb.from('sdr_leads').select('status,observacoes').eq('id', x.lead.id).single()
  const { count: msgs } = await sb.from('sdr_mensagens').select('id', { count: 'exact', head: true }).eq('lead_id', x.lead.id).eq('direcao', 'out').gte('enviado_em', antes)
  const card2 = await evo('/int/getOpportunity', { id: x.opp })
  const ok = Number(card2.fkStage) === 50 && depois.status === 'EM_ANALISE_AIVA' && !msgs && !depois.observacoes.includes('[MOVE_SILENCIOSO:')
  res.push({ nome: x.lead.nome, card: card2.fkStage, status: depois.status, mensagens_saidas: msgs, ok })
  console.log(`   card ${card2.fkStage} · status ${depois.status} · mensagens saídas: ${msgs} · ${ok ? '✅' : '⚠️ conferir'}`)
}
if (res.length) fs.writeFileSync(`scripts/out-voltar-70-50-${MODO}.json`, JSON.stringify(res, null, 1))
