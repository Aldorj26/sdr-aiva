/**
 * Conferência de TODAS as lojas que colocamos pra dentro (pré-aprovação em diante, desde maio/2026)
 * contra o portal da AIVA (onboarding + performance) e os relatórios de comissão (Aldo 06/10/2026).
 * SÓ LEITURA. Saída: scripts/out-conferencia-lojas-2026-10-06.json (a planilha sai do .py irmão).
 * Uso: node --env-file=.env.local scripts/conferencia-lojas-2026-10-06.mjs
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const so = (c) => String(c ?? '').replace(/\D/g, '')
const todas = async (q) => { const out = []; for (let de = 0; ; de += 1000) { const { data, error } = await q().range(de, de + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break } return out }

// ── nosso lado ───────────────────────────────────────────────────────────────
const leads = await todas(() => s.from('sdr_leads').select('id,nome,telefone,status,observacoes,criado_em,status_alterado_em,evotalks_opportunity_id,data_disparo_inicial').order('criado_em'))
const registros = await todas(() => s.from('sdr_registros_cnpj').select('lead_id,cnpj,tipo,status,rid,criado_em,origem'))
const base = await todas(() => s.from('aiva_base_cnpjs').select('cnpj,nome'))
const comissoes = await todas(() => s.from('ume_comissoes').select('mes,origem,retailer_id,cnpj,varejo,grupo,contratos,originacao,comissao'))
const { data: metas } = await s.from('ume_comissoes_meta').select('mes,origem')

// Evo: funil 15 (credenciamento) e funil 11 (Lojas Fechadas MRR)
const evo = async (pipelineId) => {
  const r = await fetch(`${process.env.EVO_TALKS_BASE_URL}/int/getPipeOpportunities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: Number(process.env.EVO_TALKS_QUEUE_ID ?? 10), apiKey: process.env.EVO_TALKS_API_KEY, pipelineId }) })
  return r.json()
}
const f15 = await evo(15)
const f11 = await evo(11)

// ── AIVA ─────────────────────────────────────────────────────────────────────
const onbs = []
for (let cursor = null; ;) {
  const q = new URLSearchParams({ limit: '500' }); if (cursor) q.set('cursor', cursor)
  const j = await (await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, { headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY } })).json()
  onbs.push(...(j.records ?? [])); cursor = j.next_cursor ?? null; if (!cursor) break
}
const U = process.env.AIVA_PORTAL_URL, A = process.env.AIVA_PORTAL_ANON_KEY
const tok = (await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: A }, body: JSON.stringify({ email: process.env.AIVA_PORTAL_EMAIL, password: process.env.AIVA_PORTAL_SENHA }) })).json()).access_token
const portal = async (path) => { const out = []; for (let de = 0; ; de += 1000) { const r = await fetch(`${U}/rest/v1/${path}`, { headers: { apikey: A, Authorization: `Bearer ${tok}`, Range: `${de}-${de + 999}` } }); if (r.status === 416) break; const d = await r.json(); out.push(...d); if (d.length < 1000) break } return out }
const perf = await portal('retailer_performance?select=retailer_id,cnpj,retailer_name,mes,n_consultas,n_aprovados,n_vendas,valor_vendas,status,registered_at')
const bloqueios = await portal('store_origination_limit?select=retailer_id,bloqueado_por_limite,bloqueado_desde')

fs.writeFileSync('scripts/out-conferencia-lojas-2026-10-06.json', JSON.stringify({
  geradoEm: new Date().toISOString(), leads, registros, base, comissoes, metas, f15, f11, onbs, perf, bloqueios,
}))
console.log({ leads: leads.length, registros: registros.length, base: base.length, comissoes: comissoes.length, f15: f15.length, f11: f11.length, onbs: onbs.length, perf: perf.length, bloqueios: bloqueios.length, mesesPerf: [...new Set(perf.map((p) => p.mes))].sort() })
