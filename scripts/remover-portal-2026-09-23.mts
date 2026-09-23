/**
 * Remove do pipeline do portal da AIVA os cadastros que o Aldo marcou como
 * "descartar" na planilha PODE-DESCARTAR (23/09/2026).
 *
 * ⚠️ NÃO TEM VOLTA PELA API: `/onboardings/remove` existe, mas não achei nenhum
 * endpoint de restaurar (restore/unremove/recover/restaurar → todos 404). Por isso
 * o script grava o registro COMPLETO de cada cadastro antes de remover, em
 * scripts/out-removidos-portal-<data>.json — é o que permite recriar na mão se
 * alguém foi removido por engano.
 *
 * Trava de segurança: só remove quem está em `dados_varejo`, SEM retailer_id, SEM
 * venda/consulta e SEM biometria aprovada. Qualquer sinal de loja viva e o CNPJ
 * fica de fora (a conferência roda de novo aqui, não confia no arquivo).
 *
 * Uso: npx tsx --env-file=.env.local scripts/remover-portal-2026-09-23.mts [--dry]
 */
import { listarOnboardingsApi, loginPortal, partnerIdTrack, buscarPerformance } from '../lib/portal-aiva'
import fs from 'node:fs'

const DRY = process.argv.includes('--dry')
const so = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const { descartar, manter } = JSON.parse(fs.readFileSync('scripts/cnpjs-descartar-portal.json', 'utf8'))
const manterSet = new Set<string>(manter)

const onbs = await listarOnboardingsApi()
const porCnpj = new Map(onbs.map((o: Record<string, unknown>) => [so(o.cnpj), o]))
const s = await loginPortal()
const perf = await buscarPerformance(s, await partnerIdTrack(s), null)
const mov = new Map<string, number>()
for (const p of perf) { const c = so(p.cnpj); if (c) mov.set(c, (mov.get(c) ?? 0) + Number(p.n_vendas ?? 0) + Number(p.n_consultas ?? 0)) }

const alvos: Record<string, unknown>[] = []
const fora: string[] = []
for (const c of descartar as string[]) {
  const o = porCnpj.get(c) as Record<string, unknown> | undefined
  if (manterSet.has(c)) { fora.push(`${c}: também está na lista de MANTER`); continue }
  if (!o) { fora.push(`${c}: não existe no portal`); continue }
  if (o.retailer_id) { fora.push(`${c}: TEM ID DE LOJA (${o.retailer_id})`); continue }
  if ((mov.get(c) ?? 0) > 0) { fora.push(`${c}: tem ${mov.get(c)} vendas/consultas`); continue }
  if (o.biometry_status === 'aprovado') { fora.push(`${c}: biometria aprovada`); continue }
  if (o.stage && o.stage !== 'dados_varejo') { fora.push(`${c}: cadastro avançou (${o.stage})`); continue }
  alvos.push(o)
}
console.log(`Alvos: ${alvos.length} | fora: ${fora.length}`)
fora.forEach((f) => console.log('  ⛔ ' + f))

// BACKUP antes de qualquer escrita — é o único caminho de volta que existe
const backup = `scripts/out-removidos-portal-${new Date().toISOString().slice(0, 10)}.json`
fs.writeFileSync(backup, JSON.stringify({ gerado: new Date().toISOString(), fora, cadastros: alvos }, null, 1))
console.log(`Backup completo dos ${alvos.length} cadastros: ${backup}`)
if (DRY) { console.log('[DRY] nada removido.'); process.exit(0) }

const K = process.env.AIVA_PORTAL_API_KEY
let ok = 0
const falhas: string[] = []
for (const o of alvos) {
  const r = await fetch('https://parceiro-aiva.lovable.app/api/public/partner/onboardings/remove', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': K! },
    body: JSON.stringify({ id: o.id }),
  })
  const txt = await r.text()
  if (r.ok) { ok++; console.log(`  ✅ ${so(o.cnpj)} ${String(o.legal_name ?? '').slice(0, 30)}`) }
  else { falhas.push(`${so(o.cnpj)}: HTTP ${r.status} ${txt.slice(0, 120)}`); console.log(`  ❌ ${so(o.cnpj)} → ${r.status} ${txt.slice(0, 120)}`) }
  await new Promise((res) => setTimeout(res, 400))
}
console.log(`\nRemovidos: ${ok}/${alvos.length}`)
if (falhas.length) falhas.forEach((f) => console.log('  ' + f))

// confere no portal: os removidos NÃO podem mais aparecer na listagem
const depois = await listarOnboardingsApi()
const aindaLa = alvos.filter((o) => depois.some((d: Record<string, unknown>) => so(d.cnpj) === so(o.cnpj)))
console.log(`Conferência: ${aindaLa.length === 0 ? 'nenhum aparece mais na listagem ✅' : `⚠️ ${aindaLa.length} ainda aparecem: ${aindaLa.map((o) => so(o.cnpj)).join(', ')}`}`)
