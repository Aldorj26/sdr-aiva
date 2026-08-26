/**
 * Backfill 26/08/2026 — cria no funil "Contas fechadas MRR" (pipeline 11,
 * etapa 32) as contas-espelho das lojas que já estão em Loja Finalizada e
 * Vendendo (etapa 51 do funil 15) e não existem lá.
 *
 * Lista fechada de opp IDs do funil 15 (cruzamento por telefone + título
 * feito em 26/08 — ver docs/lojas-etapa51-sem-conta-mrr-2026-08-26.xlsx,
 * refinado de 29 pra 26 após casar TechFix/Celular Express/Tech World/Lfn
 * por razão social).
 *
 * Idempotente: revarre o funil 11 por telefone antes de cada criação e grava
 * [MRR_OPP:id] no lead. Rodar com --dry pra só listar.
 *
 * Uso:  node --env-file=.env.local scripts/criar-contas-mrr-2026-08-26.mjs [--dry]
 */
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY
const QUEUE = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const OPP_IDS = [6505, 8992, 10845, 10873, 10882, 11052, 11176, 11496, 11552, 11554,
  12025, 12064, 12255, 12307, 12525, 12704, 12818, 12826, 12833, 12892,
  13060, 13174, 13747, 13796, 13858, 14298]

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE, apiKey: KEY, ...body }),
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}
const chave = (s) => { let d = String(s ?? '').replace(/\D/g, ''); if (d.startsWith('55') && d.length >= 12) d = d.slice(2); if (d.length === 11) d = d.slice(0, 2) + d.slice(3); return d }

// funil 11 atual — dedupe por telefone
const p11 = await (async () => {
  const res = await fetch(`${BASE}/int/getPipeOpportunities`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE, apiKey: process.env.EVO_TALKS_API_KEY, pipelineId: 11 }),
  })
  if (!res.ok) throw new Error(`getPipeOpportunities → ${res.status}`)
  return res.json()
})()
const tels11 = new Set(p11.map((o) => chave(o.mainphone)).filter(Boolean))
console.log(`Funil 11 hoje: ${p11.length} contas (${tels11.size} com telefone)\n`)

let criadas = 0, puladas = 0, falhas = 0
for (const oppId of OPP_IDS) {
  try {
    const opp = await post('/int/getOpportunity', { id: oppId })
    const titulo = String(opp.title ?? '').replace(/\uFFFD+/g, ' ').replace(/\s*[—–-]?\s*AIVA\s*$/i, '').trim() || `Loja ${oppId}`
    const tel = String(opp.mainphone ?? '').replace(/\D/g, '')
    if (tel && tels11.has(chave(tel))) { console.log(`  ~ pulada (já existe por telefone): ${titulo}`); puladas++; continue }

    const { data: lead } = await sb.from('sdr_leads').select('id, nome, observacoes').eq('telefone', tel).maybeSingle()
    // titulo generico ("Loja") -> usa o nome do lead, que e o nome real do varejo
    const tituloFinal = titulo.length < 6 && lead?.nome ? lead.nome : titulo
    if (/\[MRR_OPP:\d+\]/.test(lead?.observacoes ?? '')) { console.log(`  ~ pulada (marcador no lead): ${titulo}`); puladas++; continue }
    const cnpj = (lead?.observacoes ?? '').match(/cnpj_matriz=([\d.\/-]{14,18})/)?.[1]?.replace(/\D/g, '')
      ?? (lead?.observacoes ?? '').match(/CNPJ_RECEITA:cnpj=(\d{14})/)?.[1]
      ?? String(opp.formsdata?.['dd2ab580'] ?? '').replace(/\D/g, '') ?? ''
    const desc = [cnpj.length === 14 ? `CNPJ: ${cnpj}` : null, `Espelho do funil AIVA (opp #${oppId}) — backfill 26/08/2026`].filter(Boolean).join(' | ')

    if (DRY) { console.log(`  + criaria: "${tituloFinal}" | tel ${tel} | ${desc}`); criadas++; continue }

    const { id: novoId } = await post('/int/createOpportunity', {
      fkPipeline: 11, fkStage: 32, responsableid: 507, title: tituloFinal, mainphone: tel, city: '',
    })
    await post('/int/updateOpportunity', { id: novoId, description: desc, tags: [69] })
    if (lead?.id) {
      await sb.from('sdr_leads').update({ observacoes: `${(lead.observacoes ?? '').trim()} [MRR_OPP:${novoId}]`.trim() }).eq('id', lead.id)
    }
    tels11.add(chave(tel))
    console.log(`  ✓ criada #${novoId}: "${tituloFinal}" | tel ${tel} | ${desc}`)
    criadas++
    await new Promise((r) => setTimeout(r, 400))
  } catch (err) {
    console.error(`  ✗ falha na opp ${oppId}:`, err.message)
    falhas++
  }
}
console.log(`\n${DRY ? 'DRY — criaria' : 'Criadas'}: ${criadas} | puladas: ${puladas} | falhas: ${falhas}`)
