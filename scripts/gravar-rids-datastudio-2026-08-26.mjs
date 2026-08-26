/**
 * 26/08/2026 — grava UME_RID (Retailer ID) nas contas do funil 11 a partir do
 * relatório Data Studio "Parceiros - AIVA" (o Eduardo adicionou o ID de todos
 * os clientes hoje). Extração feita via Chrome (Looker não tem API pública).
 *
 * Casamento por CNPJ (descrição da opp "CNPJ: xxx" vs coluna cnpj do
 * relatório). Só preenche quem NÃO tem UME_RID; conflito (RID existente
 * diferente) é reportado, nunca sobrescrito.
 *
 * Uso: node --env-file=.env.local scripts/gravar-rids-datastudio-2026-08-26.mjs [--dry]
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const KEY = process.env.EVO_TALKS_API_KEY
const mapa = JSON.parse(fs.readFileSync('C:/Users/rocha/Downloads/retailer-ids-datastudio.json', 'utf-8'))
const porCnpj = new Map()
for (const m of mapa) porCnpj.set(String(m.cnpj).trim(), { rid: Number(m.id), nome: m.nome })

// telefone → CNPJ via sdr_leads (pras contas sem CNPJ na descrição — as
// criadas manualmente pelo Nei nascem com descrição vazia)
const chaveTel = (s) => { let d = String(s ?? '').replace(/\D/g, ''); if (d.startsWith('55') && d.length >= 12) d = d.slice(2); if (d.length === 11) d = d.slice(0, 2) + d.slice(3); return d }
const cnpjPorFone = new Map()
{
  let from = 0
  while (true) {
    const { data } = await sb.from('sdr_leads').select('telefone, observacoes').eq('produto', 'AIVA').range(from, from + 999)
    for (const l of data ?? []) {
      const c = (l.observacoes ?? '').match(/cnpj_matriz=([\d.\/-]{14,18})/)?.[1]?.replace(/\D/g, '')
        ?? (l.observacoes ?? '').match(/CNPJ_RECEITA:cnpj=(\d{14})/)?.[1]
      const k = chaveTel(l.telefone)
      if (c && c.length === 14 && k && !cnpjPorFone.has(k)) cnpjPorFone.set(k, c)
    }
    if (!data || data.length < 1000) break
    from += 1000
  }
}

const res = await fetch(`${BASE}/int/getPipeOpportunities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: 10, apiKey: KEY, pipelineId: 11 }) })
const contas = await res.json()

let jaTem = 0, gravadas = 0, semCnpj = 0, cnpjForaDoMapa = 0, conflitos = [], falhas = 0
for (const o of contas) {
  const desc = String(o.description ?? '')
  const ridAtual = desc.match(/UME_RID:\s*(\d+)/i)?.[1]
  let cnpj = desc.match(/CNPJ:\s*(\d{14})/i)?.[1] ?? null
  let cnpjVeioDoLead = false
  if (!cnpj) {
    const k = chaveTel(o.mainphone)
    if (k && cnpjPorFone.has(k)) { cnpj = cnpjPorFone.get(k); cnpjVeioDoLead = true }
  }
  const doMapa = cnpj ? porCnpj.get(cnpj) : null
  if (ridAtual) {
    jaTem++
    if (doMapa && Number(ridAtual) !== doMapa.rid) conflitos.push(`#${o.id} "${o.title}": tem UME_RID ${ridAtual}, Data Studio diz ${doMapa.rid}`)
    continue
  }
  if (!cnpj) { semCnpj++; continue }
  if (!doMapa) { cnpjForaDoMapa++; continue }
  if (DRY) { console.log(`  + gravaria UME_RID ${doMapa.rid} em #${o.id} "${o.title}" (${cnpj})`); gravadas++; continue }
  try {
    // se o CNPJ veio do lead, grava junto — enriquece a conta pro futuro
    const pedacos = [desc.trim() || null, cnpjVeioDoLead ? `CNPJ: ${cnpj}` : null, `UME_RID: ${doMapa.rid}`].filter(Boolean)
    const nova = pedacos.join(' | ')
    const up = await fetch(`${BASE}/int/updateOpportunity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: 10, apiKey: KEY, id: o.id, description: nova }) })
    if (!up.ok) throw new Error(`${up.status}: ${await up.text()}`)
    console.log(`  ✓ UME_RID ${doMapa.rid} → #${o.id} "${o.title}"`)
    gravadas++
    await new Promise((r) => setTimeout(r, 250))
  } catch (err) { console.error(`  ✗ #${o.id}:`, err.message); falhas++ }
}
console.log(`\n${DRY ? 'DRY — gravaria' : 'Gravadas'}: ${gravadas} | já tinham RID: ${jaTem} | sem CNPJ na descrição: ${semCnpj} | CNPJ fora do Data Studio: ${cnpjForaDoMapa} | falhas: ${falhas}`)
if (conflitos.length) { console.log('\nCONFLITOS (não tocados):'); conflitos.forEach((c) => console.log('  ⚠️', c)) }
