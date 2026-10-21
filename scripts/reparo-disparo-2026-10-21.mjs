#!/usr/bin/env node
/**
 * Reparo do disparo D+0 de 21/10/2026 — pane de lentidão do Evo Talks (60–82 s por chamada, 09:21–~11:20 BRT).
 *
 * O send-initial carimba `data_disparo_inicial` ANTES de criar a opp e enviar o template; com o Evo travado o
 * lote estourou o timeout e sobraram leads em INICIO sem opp e/ou sem template — e INICIO está em
 * STATUS_BLOQUEADOS, então a fila (ainda PENDENTE) viraria DUPLICADO. Este script faz, pra cada lead queimado:
 *   1. cria a opp no funil 15 etapa Início + tag AIVA (só se o lead não tem opp);
 *   2. envia o template 41 com as MESMAS vars do send-initial (openNewChat) e guarda chatId/clientId;
 *   3. vincula o chat à opp; grava `aiva_campanha` em sdr_mensagens; marca a fila DISPARADO.
 * Idempotente: pula lead que já tem mensagem. Uso: node --env-file=.env.local scripts/reparo-disparo-2026-10-21.mjs [--dry] [--limite N]
 */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL, KEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? process.env.EVO_TALKS_API_KEY, QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const DRY = process.argv.includes('--dry')
const li = process.argv.indexOf('--limite'); const LIMITE = li >= 0 ? Number(process.argv[li + 1]) : Infinity
const PIPELINE_AIVA = 15, STAGE_INICIO = 66, TAG_AIVA = 69, TEMPLATE = 41, NEI = 507
const VARS41 = ['Vender mais celulares sem risco de calote', 'vi que vocês trabalham com venda de celular e queria apresentar uma parceria rapida:', 'A *AIVA* ajuda lojas como a sua a venderem mais — sem dor de cabeça:', '*Aprovação do cliente em 2 minutos*', '*Você recebe em 2 dias úteis*', '*Zero risco de inadimplência (o risco é nosso)*', '*Parcelamento em até 12x pro cliente*']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function post(p, b) {
  const t0 = Date.now()
  const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: KEY, ...b }), signal: AbortSignal.timeout(40_000) })
  const t = await r.text(); const ms = Date.now() - t0
  if (!r.ok) throw new Error(`${p} → ${r.status} em ${ms}ms: ${t.slice(0, 160)}`)
  try { return { ...JSON.parse(t), _ms: ms } } catch { return { raw: t.slice(0, 200), _ms: ms } }
}

// leads queimados: carimbados hoje, INICIO, sem nenhuma mensagem
const { data: leads, error } = await sb.from('sdr_leads').select('id,nome,telefone,cidade,status,evotalks_opportunity_id,evotalks_chat_id')
  .eq('produto', 'AIVA').eq('status', 'INICIO').gte('data_disparo_inicial', '2026-10-21T03:00:00Z').order('data_disparo_inicial')
if (error) throw new Error(error.message)
const alvo = []
for (const l of leads) {
  const { count } = await sb.from('sdr_mensagens').select('id', { count: 'exact', head: true }).eq('lead_id', l.id)
  if ((count ?? 0) === 0) alvo.push(l)
}
console.log(`leads INICIO carimbados hoje: ${leads.length} | sem mensagem (alvo): ${alvo.length} | sem opp: ${alvo.filter((l) => !l.evotalks_opportunity_id).length}${DRY ? ' | DRY' : ''}`)
for (const l of alvo.slice(0, 8)) console.log(`  - ${l.telefone} opp=${l.evotalks_opportunity_id ?? '-'} ${l.cidade ?? ''}`)
if (DRY) process.exit(0)

let ok = 0, falha = 0, lentas = 0
for (const l of alvo.slice(0, LIMITE)) {
  try {
    let oppId = l.evotalks_opportunity_id ? Number(l.evotalks_opportunity_id) : null
    if (!oppId) {
      const r = await post('/int/createOpportunity', { fkPipeline: PIPELINE_AIVA, fkStage: STAGE_INICIO, responsableid: NEI, title: `Loja${l.cidade ? ' - ' + l.cidade : ''} — AIVA`, mainphone: l.telefone, city: l.cidade ?? '' })
      oppId = r.id
      await sb.from('sdr_leads').update({ evotalks_opportunity_id: String(oppId) }).eq('id', l.id)
      try { await post('/int/updateOpportunity', { id: oppId, tags: [TAG_AIVA] }) } catch (e) { console.log(`  tag falhou opp ${oppId}: ${e.message}`) }
    }
    const tpl = await post('/int/sendWaTemplate', { number: l.telefone, templateId: TEMPLATE, data: VARS41, openNewChat: true })
    if (tpl._ms > 15_000) lentas++
    if (tpl?.message !== 'success') throw new Error(`sendWaTemplate: ${JSON.stringify(tpl).slice(0, 160)}`)
    const upd = {}
    if (tpl.chatId) upd.evotalks_chat_id = String(tpl.chatId)
    if (tpl.clientId) upd.evotalks_client_id = String(tpl.clientId)
    if (Object.keys(upd).length) await sb.from('sdr_leads').update(upd).eq('id', l.id)
    if (tpl.chatId) { try { await post('/int/updateOpportunity', { id: oppId, fkChat: Number(tpl.chatId) }) } catch (e) { console.log(`  vínculo chat falhou opp ${oppId}: ${e.message}`) } }
    await sb.from('sdr_mensagens').insert({ lead_id: l.id, direcao: 'out', conteudo: `[Template AIVA enviado para ${l.telefone}] (reparo pane Evo 21/10)`, template_hsm: 'aiva_campanha' })
    await sb.from('sdr_fila_disparo').update({ status: 'DISPARADO', disparado_em: new Date().toISOString() }).eq('telefone', l.telefone).eq('status', 'PENDENTE')
    ok++
    console.log(`  ✅ ${l.telefone} opp ${oppId} chat ${tpl.chatId ?? '-'} (${tpl._ms} ms)`)
  } catch (e) {
    falha++
    console.log(`  ❌ ${l.telefone}: ${e.message}`)
    if (falha >= 3 && ok === 0) { console.log('3 falhas seguidas sem sucesso — Evo ainda ruim, parando.'); break }
  }
  await sleep(800)
}
console.log(`\nREPARO: ok=${ok} falha=${falha} lentas(>15s)=${lentas} de ${alvo.length}`)
await sleep(500)
