/**
 * tag-sem-socio-backfill.mjs — aplica a tag "Sem Socio" (80) nas oportunidades
 * dos leads que o backfill da Receita marcou com socios=0.
 *
 * Preserva as tags existentes (updateOpportunity substitui o array inteiro —
 * busca as atuais e mescla). Fail-soft por lead.
 *
 * Uso: node scripts/tag-sem-socio-backfill.mjs [--dry]
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const DRY = process.argv.includes('--dry')
const TAG_SEM_SOCIO = 80
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const post = (p, b) =>
  fetch(env.EVO_TALKS_BASE_URL + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: Number(env.EVO_TALKS_QUEUE_ID), apiKey: env.EVO_TALKS_QUEUE_API_KEY, ...b }),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${p} HTTP ${r.status}: ${await r.text()}`)
    return r.json()
  })

// Leads com socios=0 no marcador da Receita e oportunidade no Evo
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
const res = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sdr_leads?select=nome,telefone,status,evotalks_opportunity_id,observacoes` +
    `&produto=eq.AIVA&observacoes=like.*socios%3D0*&evotalks_opportunity_id=not.is.null`,
  { headers: H }
)
const leads = await res.json()
if (!Array.isArray(leads)) { console.error('Erro:', leads); process.exit(1) }

// Confere que o socios=0 está mesmo no marcador CNPJ_RECEITA (não em outro texto)
const alvo = leads.filter((l) => /\[CNPJ_RECEITA:[^\]]*socios=0\]/.test(l.observacoes ?? ''))
console.log(`Leads sem sócio com oportunidade: ${alvo.length}${DRY ? ' (DRY RUN)' : ''}`)

let ok = 0, jaTinha = 0, falhas = 0
for (const lead of alvo) {
  const oppId = Number(lead.evotalks_opportunity_id)
  try {
    const opp = await post('/int/getOpportunity', { id: oppId })
    const atuais = opp.tags ?? []
    if (atuais.includes(TAG_SEM_SOCIO)) { jaTinha++; continue }
    if (!DRY) {
      await post('/int/updateOpportunity', { id: oppId, tags: [...atuais, TAG_SEM_SOCIO] })
    }
    ok++
    console.log(`  ✓ #${oppId} ${lead.nome} [${lead.status}] → tags ${JSON.stringify([...atuais, TAG_SEM_SOCIO])}`)
  } catch (err) {
    falhas++
    console.log(`  ✗ #${oppId} ${lead.nome}: ${err.message.slice(0, 100)}`)
  }
  await sleep(300)
}
console.log(`\nAplicadas: ${ok} | Já tinham: ${jaTinha} | Falhas: ${falhas}`)
