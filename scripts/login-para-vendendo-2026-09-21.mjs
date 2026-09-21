#!/usr/bin/env node
/**
 * Move os cards em Login (71) cuja senha do sócio a AIVA JÁ ENVIOU → Loja
 * Finalizada e Vendendo (51). Decisão do Aldo, 21/09/2026, em cima do
 * levantamento scripts/login-conferencia-2026-09-21.mts (31 lojas).
 *
 * --dry : só analisa. Sem flag: move e confere card a card.
 *
 * Mover pela API dispara a automação do Evo → /opportunity-stage 51 faz o resto
 * (status LOJA_FINALIZADA_E_VENDENDO, relógio da consultoria, conta MRR no
 * funil 11). Nenhuma mensagem sai pro lojista nesse handler.
 *
 * Fica de fora quem NÃO tem senha enviada (os 2 sem RID) e quem já saiu de 71.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.EVO_TALKS_BASE_URL
const QUEUE_ID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const QUEUE_KEY = process.env.EVO_TALKS_QUEUE_API_KEY
const DRY = process.argv.includes('--dry')
const STAGE_LOGIN = 71
const STAGE_VENDENDO = 51
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function evoPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: QUEUE_KEY, ...body }),
  })
  const txt = await res.text()
  let json = null
  try { json = JSON.parse(txt) } catch { /* não-JSON */ }
  return { status: res.status, json, txt: txt.slice(0, 200) }
}
async function etapaAtual(oppId) {
  const { json } = await evoPost('/int/getOpportunity', { id: Number(oppId) })
  const opp = json?.opportunity ?? json?.data ?? json
  return Number(opp?.fkStage ?? opp?.fk_stage)
}

// fonte: o levantamento de hoje (RID + senha enviada + opp)
const levant = JSON.parse(readFileSync('scripts/out-login-conferencia.json', 'utf8'))
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const alvo = levant.linhas.filter((x) => x['Situação na AIVA'] === 'SENHA ENVIADA')
const fora = levant.linhas.filter((x) => x['Situação na AIVA'] !== 'SENHA ENVIADA')
console.log(`Senha enviada: ${alvo.length} · fora (sem RID/sem senha): ${fora.length} → ${fora.map((x) => x.Loja).join(', ')}`)

const linhas = []
for (const x of alvo) {
  const { data: lead } = await sb.from('sdr_leads').select('id,nome,evotalks_opportunity_id,status').eq('telefone', x.Telefone).maybeSingle()
  const opp = lead?.evotalks_opportunity_id ? Number(lead.evotalks_opportunity_id) : null
  const linha = { loja: x.Loja, telefone: x.Telefone, rid: x.RID, opp, etapa: null, apto: false, motivo: '' }
  if (!opp) linha.motivo = 'sem opp'
  else {
    linha.etapa = await etapaAtual(opp)
    await sleep(120)
    if (linha.etapa === STAGE_VENDENDO) linha.motivo = 'já está em 51'
    else if (linha.etapa !== STAGE_LOGIN) linha.motivo = `card não está em Login (etapa ${linha.etapa})`
    else { linha.apto = true; linha.motivo = 'ok' }
  }
  linhas.push(linha)
  console.log(`${linha.apto ? '✅' : '⛔'} ${String(x.Loja).slice(0, 30).padEnd(31)} opp=${String(opp ?? '—').padEnd(6)} etapa=${String(linha.etapa ?? '—').padEnd(3)} ${linha.motivo}`)
}
const aptos = linhas.filter((l) => l.apto)
console.log(`\nAptos: ${aptos.length}/${alvo.length}`)
if (DRY) { console.log('[DRY] nada movido.'); process.exit(0) }

console.log('\nMovendo 71 → 51...')
let ok = 0
const falhas = []
for (const l of aptos) {
  const r = await evoPost('/int/changeOpportunityStage', { id: l.opp, destStageId: STAGE_VENDENDO })
  await sleep(400)
  const agora = await etapaAtual(l.opp)
  if (agora === STAGE_VENDENDO) { ok++; l.movido = true; console.log(`  ✅ ${l.loja} → 51`) }
  else { l.movido = false; falhas.push({ ...l, http: r.status, resposta: r.txt, etapa_apos: agora }); console.log(`  ⛔ ${l.loja} ficou na etapa ${agora} (HTTP ${r.status}) ${r.txt}`) }
  await sleep(500)
}
console.log(`\nMovidos: ${ok}/${aptos.length} | falhas: ${falhas.length}`)
writeFileSync('scripts/out-login-para-vendendo-resultado.json', JSON.stringify({ linhas, falhas }, null, 1))
