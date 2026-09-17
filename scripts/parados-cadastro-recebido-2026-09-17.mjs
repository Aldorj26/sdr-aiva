#!/usr/bin/env node
/**
 * Levantamento dos cards parados em "Cadastro Recebido" (etapa 49).
 *
 * A pergunta que interessa não é "quantos são", é "o que está segurando cada um".
 * Um card sai da 49 quando: (1) o lojista fecha a Fase 3 dando o e-mail, (2) o
 * Nei lança o CNPJ no form de pré-cadastro da AIVA, (3) a AIVA aprova e o CNPJ
 * aparece no portal — aí o espelho move pra 50 sozinho. Então "parado" pode ser
 * culpa de três lados diferentes, e a ação é diferente em cada um.
 *
 * Só LÊ. Gera docs/Parados-Cadastro-Recebido-2026-09-17.xlsx.
 *
 * Uso: node --env-file=.env.local scripts/parados-cadastro-recebido-2026-09-17.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const so = (c) => String(c ?? '').replace(/\D/g, '')
const dias = (ms) => (ms ? Math.floor((Date.now() - ms) / 86400000) : null)

// ─── 1) cards na etapa 49 do funil 15 ────────────────────────────────────────
const res = await fetch(`${process.env.EVO_TALKS_BASE_URL}/int/getPipeOpportunities`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ queueId: Number(process.env.EVO_TALKS_QUEUE_ID ?? 10), apiKey: process.env.EVO_TALKS_API_KEY, pipelineId: 15 }),
})
if (!res.ok) { console.error('Evo:', res.status, (await res.text()).slice(0, 200)); process.exit(1) }
const todas = await res.json()
const cards = todas.filter((o) => Number(o.fkStage) === 49)
console.log(`funil 15: ${todas.length} oportunidades · ${cards.length} em Cadastro Recebido (49)\n`)

// ─── 2) nossos leads ─────────────────────────────────────────────────────────
const opps = cards.map((c) => String(c.id))
// ⚠️ PAGINAR: sem range o PostgREST devolve só as primeiras 1.000 linhas, e a
// base tem ~7.800 leads. Sem isto o levantamento diz "sem lead nosso" pra quem
// tem lead — foi o que aconteceu na primeira rodada deste script (17/09).
const leads = []
for (let de = 0; ; de += 1000) {
  const { data } = await sb.from('sdr_leads')
    .select('id,nome,telefone,status,observacoes,evotalks_opportunity_id,data_ultimo_contato')
    .order('criado_em', { ascending: true }).range(de, de + 999)
  leads.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
console.log(`leads lidos: ${leads.length}`)
const leadPorOpp = new Map(leads.filter((l) => l.evotalks_opportunity_id).map((l) => [String(l.evotalks_opportunity_id), l]))
const leadPorTel = new Map(leads.map((l) => [so(l.telefone), l]))

// ─── 3) registros (o CNPJ foi lançado no form da AIVA?) ──────────────────────
const regs = []
for (let de = 0; ; de += 1000) {
  const { data } = await sb.from('sdr_registros_cnpj').select('lead_id,cnpj,tipo,status,enviado').order('id').range(de, de + 999)
  regs.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
const regsPorLead = new Map()
for (const r of regs) {
  if (!r.lead_id) continue
  const g = regsPorLead.get(r.lead_id) ?? []
  g.push(r); regsPorLead.set(r.lead_id, g)
}

// ─── 4) etapa no portal da AIVA ──────────────────────────────────────────────
let cursor = null, onb = []
do {
  const q = new URLSearchParams({ limit: '500' }); if (cursor) q.set('cursor', cursor)
  const r = await fetch(`https://parceiro-aiva.lovable.app/api/public/partner/onboardings?${q}`, { headers: { 'x-api-key': process.env.AIVA_PORTAL_API_KEY } })
  const j = await r.json(); onb.push(...(j.records ?? [])); cursor = j.next_cursor ?? null
} while (cursor)
const portal = new Map(onb.map((o) => [so(o.cnpj), o]))

// ─── 5) diagnóstico por card ─────────────────────────────────────────────────
const linhas = []
for (const c of cards) {
  const lead = leadPorOpp.get(String(c.id)) ?? leadPorTel.get(so(c.mainphone))
  const forms = c.formsdata ?? {}
  const email = String(forms['dafa40f0'] ?? '').trim()
  const cnpj = so(forms['dd2ab580'] ?? '')
  const meus = lead ? (regsPorLead.get(lead.id) ?? []) : []
  const lancado = meus.some((r) => r.enviado)
  const noPortal = meus.map((r) => portal.get(so(r.cnpj))).find(Boolean) ?? (cnpj ? portal.get(cnpj) : null)
  const paradoDias = dias(Number(c.stagebegintime) * 1000)

  let trava, acao
  if (!lead) {
    trava = '1. Sem lead nosso'
    acao = 'Card criado fora do fluxo (ou lead apagado pelo sync). Conferir no Evo.'
  } else if (!email) {
    trava = '2. Falta o e-mail (Fase 3 aberta)'
    acao = 'A VictorIA ainda está coletando. Se parou de responder, é caso de contato humano.'
  } else if (!meus.length) {
    trava = '3. Sem CNPJ no painel'
    acao = 'Nenhum registro em /registros — conferir o CNPJ do lead e lançar.'
  } else if (!lancado) {
    trava = '4. CNPJ não lançado na AIVA'
    acao = 'NEI: lançar no form de pré-cadastro pelo /registros.'
  } else if (!noPortal) {
    trava = '5. Lançado, não apareceu no portal'
    acao = 'Foi lançado mas a AIVA não registrou. Conferir com a AIVA.'
  } else if (noPortal.stage === 'not_approved') {
    trava = '6. Reprovado pela AIVA'
    acao = 'O espelho deveria ter movido pra 95. Conferir.'
  } else {
    trava = '7. No portal, aguardando a AIVA'
    acao = `Portal em "${noPortal.stage}". Quando avançar, o espelho move sozinho.`
  }

  linhas.push({
    opp: c.id,
    loja: lead?.nome ?? c.title ?? '',
    telefone: lead?.telefone ?? c.mainphone ?? '',
    statusLead: lead?.status ?? '—',
    paradoDias,
    email: email ? 'sim' : 'NÃO',
    cnpj: cnpj || (meus[0] ? so(meus[0].cnpj) : ''),
    lancado: meus.length ? (lancado ? 'sim' : 'NÃO') : '—',
    etapaPortal: noPortal?.stage ?? '—',
    cnpjCheck: noPortal?.cnpj_check_status ?? '—',
    ultimoContato: lead?.data_ultimo_contato ? dias(Date.parse(lead.data_ultimo_contato)) : null,
    trava, acao,
  })
}
linhas.sort((a, b) => (b.paradoDias ?? 0) - (a.paradoDias ?? 0))

const porTrava = {}
for (const l of linhas) porTrava[l.trava] = (porTrava[l.trava] ?? 0) + 1
console.log('=== O QUE ESTÁ SEGURANDO ===')
Object.entries(porTrava).sort().forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`))
const p = (n) => linhas.filter((l) => (l.paradoDias ?? 0) >= n).length
console.log(`\n=== TEMPO PARADO ===\n  mais de 30 dias: ${p(30)}\n  mais de 14 dias: ${p(14)}\n  mais de 7 dias:  ${p(7)}\n  total: ${linhas.length}`)
console.log('\n=== OS 15 MAIS ANTIGOS ===')
linhas.slice(0, 15).forEach((l) => console.log(`  ${String(l.paradoDias).padStart(3)}d  ${String(l.loja).slice(0, 30).padEnd(31)} ${l.trava}`))

writeFileSync('docs/parados-49.json', JSON.stringify(linhas, null, 1))
console.log(`\n${linhas.length} linhas em docs/parados-49.json (a planilha é gerada pelo script python)`)
