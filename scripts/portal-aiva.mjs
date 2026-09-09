#!/usr/bin/env node
// scripts/portal-aiva.mjs — atalho pra rota /api/cron/portal-aiva em produção
// (ou local com --local). Não duplica lógica: só chama a rota com o secret.
//   node --env-file=.env.local scripts/portal-aiva.mjs --dry
//   node --env-file=.env.local scripts/portal-aiva.mjs --tudo          # backfill (todos os meses)
//   node --env-file=.env.local scripts/portal-aiva.mjs --mes 2026-08   # rederiva o mensal
//   node --env-file=.env.local scripts/portal-aiva.mjs --semana 2026-09-14
const args = process.argv.slice(2)
const pega = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
// URL estável (mesma dos outros scripts, ex. disparar-fila.mjs) — a *-projects.vercel.app
// é escopada ao deploy e muda a cada novo deployment (revisão final 09/09)
const base = args.includes('--local') ? 'http://localhost:3000' : (process.env.APP_URL ?? 'https://sdr-aiva.vercel.app')
const p = new URLSearchParams()
if (args.includes('--dry')) p.set('dry', '1')
if (args.includes('--tudo')) p.set('tudo', '1')
if (pega('--mes')) p.set('mes', pega('--mes'))
if (pega('--semana')) p.set('semana', pega('--semana'))
const url = `${base}/api/cron/portal-aiva?${p}`
console.log('GET', url)
const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.WEBHOOK_SECRET}` } })
const j = await res.json().catch(() => ({}))
console.log(res.status, JSON.stringify(j, null, 1))
process.exit(res.ok ? 0 : 1)
