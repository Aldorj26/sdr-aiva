#!/usr/bin/env node
/**
 * Varredura do que a AIVA expõe pra gente — 17/09/2026, depois do aviso do
 * Mauricio de que liberou mais dados.
 *
 * Baseline: docs/Portal-AIVA-descobertas-2026-09-16.xlsx (onboardings com 28
 * colunas; API pública com 14 campos e training_at sempre nulo).
 *
 * Só LÊ. Não escreve nada em lugar nenhum.
 *
 * Uso: node --env-file=.env.local scripts/api-aiva-varredura-2026-09-17.mjs
 */
const URL_PORTAL = process.env.AIVA_PORTAL_URL
const ANON = process.env.AIVA_PORTAL_ANON_KEY
const EMAIL = process.env.AIVA_PORTAL_EMAIL
const SENHA = process.env.AIVA_PORTAL_SENHA

// Colunas de onboardings documentadas em 16/09 (as 28 da planilha).
const ONB_16_09 = new Set([
  'id', 'partner_id', 'cnpj', 'legal_name', 'partner_owner_name', 'stage',
  'biometry_status', 'training_at', 'created_at', 'updated_at', 'retailer_id',
  'retailer_registered_at', 'email', 'phone_number', 'whitelist_created_at',
  'stores', 'retailer_name', 'liveness_url', 'pre_cadastro_status',
  'formulario_status', 'person_id', 'unblinded_at', 'unblinded_by',
  'ready_to_operate_at', 'ready_to_operate_by', 'formulario_completed_at',
  'cadastro_completed_at', 'manual_registration',
])

// Tabelas que a planilha de 16/09 registra como legíveis.
const TABELAS_16_09 = [
  'onboardings', 'onboarding_stage_events', 'training_sessions', 'training_bookings',
  'login_sends', 'liveness_sends', 'password_resends', 'retailer_performance',
  'retailer_person', 'tickets', 'ticket_types', 'ticket_messages', 'ticket_attachments',
  'people', 'profiles', 'partners', 'invites', 'retailer_cs_watchlist',
]
// Candidatas: o que pedimos no PDF pro Mauricio + variações plausíveis.
const CANDIDATAS = [
  'rejections', 'rejection_reasons', 'onboarding_rejections', 'stage_events',
  'pre_cadastros', 'sales', 'orders', 'contracts', 'payouts', 'commissions',
  'documents', 'notifications', 'retailers', 'stores', 'settings', 'audit_logs',
  'cnpj_checks', 'receita_checks', 'partner_api_keys', 'webhooks',
]

async function login() {
  const r = await fetch(`${URL_PORTAL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  })
  if (!r.ok) throw new Error(`login recusado: HTTP ${r.status}`)
  return (await r.json()).access_token
}

async function ler(token, path) {
  const r = await fetch(`${URL_PORTAL}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, Prefer: 'count=exact' },
  })
  const cr = r.headers.get('content-range') ?? ''
  const total = cr.includes('/') && cr.split('/')[1] !== '*' ? Number(cr.split('/')[1]) : null
  if (r.status !== 200 && r.status !== 206) return { ok: false, status: r.status }
  return { ok: true, total, linhas: await r.json() }
}

const token = await login()
console.log('login no portal: ok\n')

// ─── 1. onboardings: o que mudou de coluna ────────────────────────────────────
const onb = await ler(token, 'onboardings?select=*&limit=1000')
const colunas = onb.linhas[0] ? Object.keys(onb.linhas[0]) : []
const novas = colunas.filter((c) => !ONB_16_09.has(c))
const sumiram = [...ONB_16_09].filter((c) => !colunas.includes(c))
console.log(`=== onboardings: ${onb.total} linhas · ${colunas.length} colunas (eram 28 em 16/09) ===`)
console.log(`COLUNAS NOVAS (${novas.length}): ${novas.join(', ') || '(nenhuma)'}`)
if (sumiram.length) console.log(`SUMIRAM (${sumiram.length}): ${sumiram.join(', ')}`)

for (const c of novas) {
  const vals = onb.linhas.map((l) => l[c]).filter((v) => v !== null && v !== undefined && v !== '')
  const distintos = [...new Set(vals.map((v) => String(v)))]
  console.log(`\n  ${c} — ${vals.length}/${onb.linhas.length} preenchidos`)
  if (distintos.length <= 12) distintos.forEach((v) => {
    const n = vals.filter((x) => String(x) === v).length
    console.log(`     ${String(n).padStart(4)}×  ${v.slice(0, 90)}`)
  })
  else console.log(`     ${distintos.length} valores distintos · ex: ${distintos.slice(0, 3).map((v) => v.slice(0, 60)).join(' | ')}`)
}

// ─── 2. tabelas: alguma nova? alguma perdida? ─────────────────────────────────
console.log('\n=== TABELAS ===')
for (const t of TABELAS_16_09) {
  const r = await ler(token, `${t}?select=*&limit=1`)
  console.log(`  ${r.ok ? '✓' : '✗'} ${t.padEnd(26)} ${r.ok ? `${String(r.total ?? '?').padStart(6)} linhas · ${r.linhas[0] ? Object.keys(r.linhas[0]).length : 0} campos` : `HTTP ${r.status}`}`)
}
console.log('\n  candidatas novas:')
let achou = 0
for (const t of CANDIDATAS) {
  const r = await ler(token, `${t}?select=*&limit=1`)
  if (!r.ok) continue
  achou++
  console.log(`  ★ ${t.padEnd(26)} ${String(r.total ?? '?').padStart(6)} linhas · campos: ${r.linhas[0] ? Object.keys(r.linhas[0]).join(', ') : '(vazia)'}`)
}
if (!achou) console.log('     (nenhuma respondeu)')
