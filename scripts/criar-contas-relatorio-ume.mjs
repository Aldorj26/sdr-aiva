#!/usr/bin/env node
/**
 * Cria no funil 11 (Contas fechadas MRR) as contas das lojas que aparecem no
 * relatório de comissão da UME mas não têm conta no funil ("so_relatorio",
 * origem carteira) — saída da conferência mensal (exportar-conferencia-json.mjs).
 *
 * Padrão da conta: título = nome do varejo no relatório, etapa Início (32),
 * responsável Nei (507), tag UME (7), descrição "UME_RID: X | CNPJ: Y | Grupo: Z | ...".
 * Dedupe por UME_RID já existente no funil (read-after-write após criar).
 *
 * Uso:
 *   node --env-file=.env.local scripts/criar-contas-relatorio-ume.mjs --conf conf.json [--excluir-rid 727,2866] [--dry]
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const DRY = args.includes('--dry')
const conf = JSON.parse(readFileSync(arg('--conf'), 'utf8'))
const excluir = new Set((arg('--excluir-rid') ?? '').split(',').filter(Boolean).map(Number))

const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const PIPELINE_MRR = 11, STAGE_MRR_INICIO = 32, TAG_UME = 7, RESPONSAVEL_NEI = 507
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...body }) })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`)
  return res.json()
}

const alvo = conf.conf
  .filter((c) => c.estado === 'so_relatorio' && c.relatorio?.origem === 'carteira' && c.relatorio.retailer_id && !excluir.has(c.relatorio.retailer_id))
  .map((c) => c.relatorio)

let opps = await post('/int/getPipeOpportunities', { pipelineId: PIPELINE_MRR, apiKey: process.env.EVO_TALKS_API_KEY })
const temRid = (rid) => opps.find((o) => new RegExp(`UME_RID:\\s*${rid}\\b`).test(o.description ?? ''))
console.log(`${alvo.length} lojas alvo | funil 11 tem ${opps.length} contas${DRY ? ' | DRY RUN' : ''}\n`)

const criadas = [], puladas = [], falhas = []
for (const r of alvo) {
  const dup = temRid(r.retailer_id)
  if (dup) { puladas.push(`${r.retailer_id} ${r.varejo} → já existe #${dup.id}`); continue }
  const titulo = String(r.varejo ?? `RID ${r.retailer_id}`).trim()
  const desc = `UME_RID: ${r.retailer_id} | CNPJ: ${r.cnpj} | Grupo: ${r.grupo} | Cadastrada pela conferência de comissão ${conf.mes} (loja no relatório UME sem conta no funil; sem telefone)`
  if (DRY) { criadas.push(`(dry) ${titulo} — ${desc}`); continue }
  try {
    const nova = await post('/int/createOpportunity', { fkPipeline: PIPELINE_MRR, fkStage: STAGE_MRR_INICIO, responsableid: RESPONSAVEL_NEI, title: titulo, mainphone: '', city: '' })
    await post('/int/updateOpportunity', { id: nova.id, description: desc, tags: [TAG_UME] })
    criadas.push(`#${nova.id} ${titulo} (RID ${r.retailer_id})`)
  } catch (e) {
    falhas.push(`${r.retailer_id} ${titulo}: ${String(e).slice(0, 120)}`)
  }
}

if (!DRY) {
  // read-after-write: o update do Evo pode devolver 200 sem persistir (lição 26/08)
  opps = await post('/int/getPipeOpportunities', { pipelineId: PIPELINE_MRR, apiKey: process.env.EVO_TALKS_API_KEY })
  const naoConfirm = alvo.filter((r) => !temRid(r.retailer_id))
  console.log(`Criadas: ${criadas.length}\n` + criadas.map((s) => '  ' + s).join('\n'))
  console.log(`\nPuladas (já existiam): ${puladas.length}\n` + puladas.map((s) => '  ' + s).join('\n'))
  console.log(`\nFalhas: ${falhas.length}\n` + falhas.map((s) => '  ' + s).join('\n'))
  console.log(`\nConfirmação read-after-write: ${alvo.length - naoConfirm.length}/${alvo.length} com UME_RID persistido no funil 11`)
  if (naoConfirm.length) console.log('  NÃO confirmadas: ' + naoConfirm.map((r) => `${r.retailer_id} ${r.varejo}`).join('; '))
} else {
  console.log(criadas.join('\n')); console.log(`\nPuladas: ${puladas.length}`, puladas.join('; '))
}
setTimeout(() => process.exit(0), 500).unref()
