/**
 * arrumar-51-sem-operar-2026-09-28.mjs — leva de volta pra etapa certa os cards que
 * estavam em 51 "Loja Finalizada e Vendendo" SEM a loja operar (Aldo, 28/09/2026):
 *   - loja criada na AIVA, senha não registrada, sem consulta → Treinar (70)
 *   - cadastro ainda aberto no portal (formulário/biometria)  → Em Análise AIVA (50)
 * Fica de fora quem vende ou já consultou (regra 28/09: 51 = loja operando) —
 * inclusive o Zé do Celular, que vende com CNPJ errado no cadastro.
 *
 * SEM MENSAGEM: grava [MOVE_SILENCIOSO:<etapa>:<ISO>] no lead antes de mover; o
 * /api/sdr/opportunity-stage vê a marca e só atualiza o status (nada de HSM 69, link
 * de cadastro nem alerta — todos já receberam isso quando passaram pela etapa).
 *
 * Uso: node --env-file=.env.local scripts/arrumar-51-sem-operar-2026-09-28.mjs [--piloto | --todos]
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const MODO = process.argv.includes('--todos') ? 'todos' : process.argv.includes('--piloto') ? 'piloto' : 'ensaio'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BASE = process.env.EVO_TALKS_BASE_URL
const Q = { queueId: Number(process.env.EVO_TALKS_QUEUE_ID ?? 10), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY }
const evo = async (p, b) => { const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Q, ...b }) }); const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status} ${t.slice(0, 100)}`); try { return JSON.parse(t) } catch { return t } }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const lev = JSON.parse(fs.readFileSync('scripts/out-finalizados-sem-venda-2026-09-28.json', 'utf8'))
const alvo = lev.filter((x) => ['treinar', 'em_analise'].includes(x.sugestao))
  .filter((x) => !/já consultou/.test(x.portal))       // consultou = operando = fica na 51
  .filter((x) => !/^Zé do celular$/i.test(x.nome))     // vende com CNPJ errado no cadastro
const DEST = { treinar: 70, em_analise: 50 }
const lista = MODO === 'piloto' ? alvo.slice(0, 1) : alvo
console.log(`${MODO}: ${lista.length} de ${alvo.length} lojas`)

const res = []
for (const x of lista) {
  const { data: l } = await sb.from('sdr_leads').select('id,nome,status,observacoes,evotalks_opportunity_id').eq('telefone', x.telefone).maybeSingle()
  const opp = Number(l?.evotalks_opportunity_id)
  const card = await evo('/int/getOpportunity', { id: opp })
  const dest = DEST[x.sugestao]
  console.log(`- ${l.nome}: status ${l.status}, card ${card.fkStage} → ${dest}`)
  if (MODO === 'ensaio') continue
  if (l.status !== 'LOJA_FINALIZADA_E_VENDENDO' || card.fkStage !== 51) { console.log('   mudou desde o levantamento — pulei'); continue }
  const antes = new Date().toISOString()
  await sb.from('sdr_leads').update({ observacoes: `${(l.observacoes ?? '').trim()} [MOVE_SILENCIOSO:${dest}:${antes}] [ARRUMADO_51:${antes}]` }).eq('id', l.id)
  await evo('/int/changeOpportunityStage', { id: opp, destStageId: dest })
  await espera(8000)
  const { data: depois } = await sb.from('sdr_leads').select('status,observacoes').eq('id', l.id).single()
  const { count: msgs } = await sb.from('sdr_mensagens').select('id', { count: 'exact', head: true }).eq('lead_id', l.id).eq('direcao', 'out').gte('enviado_em', antes)
  const card2 = await evo('/int/getOpportunity', { id: opp })
  const ok = card2.fkStage === dest && depois.status === (dest === 70 ? 'TREINAR' : 'EM_ANALISE_AIVA') && !msgs && !depois.observacoes.includes('[MOVE_SILENCIOSO:')
  res.push({ nome: l.nome, dest, card: card2.fkStage, status: depois.status, mensagens_saidas: msgs, marca_consumida: !depois.observacoes.includes('[MOVE_SILENCIOSO:'), ok })
  console.log(`   card ${card2.fkStage} · status ${depois.status} · mensagens saídas: ${msgs} · ${ok ? '✅' : '⚠️ conferir'}`)
}
if (res.length) fs.writeFileSync(`scripts/out-arrumar-51-${MODO}.json`, JSON.stringify(res, null, 1))
