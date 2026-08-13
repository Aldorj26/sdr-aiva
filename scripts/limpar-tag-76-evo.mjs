/**
 * limpar-tag-76-evo.mjs — ONE-SHOT
 *
 * Remove a etiqueta "Atend Humano" (tag 76) de TODAS as opps dos pipelines
 * AIVA (15 e 19) no Evo. Decisão de Aldo (29/05/2026): atendimento humano
 * passa a ser controlado 100% pelo painel (acionar_humano), sem etiqueta no Evo.
 *
 * Preserva as outras tags de cada opp.
 *
 * Uso: node scripts/limpar-tag-76-evo.mjs [--dry]
 */

const EVO_BASE = 'https://tracktecnologia.evotalks.com.br'
const QUEUE_ID = 10
const GLOBAL_KEY = '2e8a5e207d7ea31ce4cd4430d3ee7c98'
const TAG = 76
const PIPELINES = [15, 19]
const dryRun = process.argv.includes('--dry')

async function fetchOpps(pipelineId) {
  const res = await fetch(`${EVO_BASE}/int/getPipeOpportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: GLOBAL_KEY, pipelineId }),
  })
  if (!res.ok) throw new Error(`getPipeOpportunities(${pipelineId}) → ${res.status}`)
  return res.json()
}

async function setTags(oppId, tags) {
  const res = await fetch(`${EVO_BASE}/int/updateOpportunity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: GLOBAL_KEY, id: oppId, tags }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`updateOpportunity ${oppId} → ${res.status}: ${text.slice(0, 80)}`)
}

async function main() {
  const comTag = []
  for (const p of PIPELINES) {
    const opps = await fetchOpps(p)
    for (const o of opps) {
      if ((o.tags ?? []).includes(TAG)) {
        comTag.push({ id: o.id, title: o.title, novasTags: (o.tags ?? []).filter((t) => t !== TAG) })
      }
    }
    console.log(`Pipeline ${p}: ${opps.length} opps, ${opps.filter((o) => (o.tags ?? []).includes(TAG)).length} com tag ${TAG}`)
  }

  console.log(`\nTotal com tag ${TAG}: ${comTag.length}`)

  if (dryRun) {
    console.log('🧪 DRY RUN — nada será alterado. Amostra:')
    for (const c of comTag.slice(0, 10)) console.log(`  #${c.id} ${c.title?.slice(0, 35)} → ${JSON.stringify(c.novasTags)}`)
    return
  }

  let ok = 0, falha = 0
  for (const c of comTag) {
    try { await setTags(c.id, c.novasTags); ok++ }
    catch (e) { falha++; console.error(`  falha #${c.id}: ${e.message}`) }
    await new Promise((r) => setTimeout(r, 60))
  }
  console.log(`\n✅ Tag ${TAG} removida de ${ok} opps | falhas: ${falha}`)
}

main().catch((e) => { console.error('💥', e); process.exit(1) })
