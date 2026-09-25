/**
 * rebaixar-so-robo-2026-09-25.mts — devolve pra INICIO os leads que viraram
 * INTERESSADO/AGUARDANDO só porque o WhatsApp Business da loja respondeu sozinho
 * ao disparo (Aldo, 25/09/2026). Mesmo critério da retomada (`so_resposta_automatica`)
 * e do webhook (bloco 9a2): sem dados coletados e TODA mensagem recebida é resposta
 * automática (lib/resposta-automatica.ts).
 *
 * Ordem por lead: move o card no Evo pra 66 (Início) primeiro; só quem moveu ganha o
 * status INICIO (mesma lição do auto-descarte de 08/09: se só o painel muda, o sync
 * do Evo desfaz). Card fora de 47/53 não é tocado (lead em outra etapa real).
 * Mover pra 66 dispara a automação 97, que SÓ avisa o /opportunity-stage (espelha o
 * status) — nenhuma mensagem vai pro lojista.
 *
 * Marca [REBAIXADO_SO_ROBO:ISO] no lead. Backup em scripts/out-rebaixados-so-robo-2026-09-25.json.
 *
 * Uso: node --env-file=.env.local scripts/rebaixar-so-robo-2026-09-25.mts [--executar]
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { soRespostaAutomatica } from '../lib/resposta-automatica.ts'

const EXECUTAR = process.argv.includes('--executar')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const BASE = process.env.EVO_TALKS_BASE_URL!
const QID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const QKEY = process.env.EVO_TALKS_QUEUE_API_KEY ?? ''
const GKEY = process.env.EVO_TALKS_API_KEY ?? ''
const BACKUP = 'scripts/out-rebaixados-so-robo-2026-09-25.json'
const CARD_MOVE = new Set([47, 53])

type Lead = { id: string; nome: string | null; telefone: string; status: string; observacoes: string | null; evotalks_opportunity_id: number | string | null }

// 1) mesmos elegíveis da retomada
const todos: Lead[] = []
for (let de = 0; ; de += 1000) {
  const { data, error } = await sb.from('sdr_leads')
    .select('id, nome, telefone, status, observacoes, evotalks_opportunity_id')
    .eq('produto', 'AIVA').in('status', ['INTERESSADO', 'AGUARDANDO']).eq('acionar_humano', false)
    .not('nome', 'ilike', '%teste%').order('criado_em', { ascending: true }).range(de, de + 999)
  if (error) throw error
  todos.push(...(data as Lead[])); if (data!.length < 1000) break
}
const elegiveis = todos.filter((l) =>
  !(l.observacoes ?? '').includes('[IMPORTADO_PORTAL') &&
  !(l.observacoes ?? '').includes('[CNPJ_IRREGULAR_AIVA:') &&
  !(l.observacoes ?? '').includes('[DADOS_COLETADOS:') &&
  !l.telefone.startsWith('000'))
const textos = new Map<string, string[]>()
for (let i = 0; i < elegiveis.length; i += 200) {
  const ids = elegiveis.slice(i, i + 200).map((l) => l.id)
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from('sdr_mensagens').select('lead_id, conteudo').in('lead_id', ids).eq('direcao', 'in').range(de, de + 999)
    if (error) throw error
    for (const m of data!) { const a = textos.get(m.lead_id) ?? []; a.push(m.conteudo); textos.set(m.lead_id, a) }
    if (data!.length < 1000) break
  }
}
const alvo = elegiveis.filter((l) => soRespostaAutomatica(textos.get(l.id) ?? []))

// 2) etapa atual de cada card no funil 15
const r = await fetch(`${BASE}/int/getPipeOpportunities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: GKEY, pipelineId: 15 }) })
const cards = (await r.json()) as Array<{ id: number; fkStage: number }>
const etapa = new Map(cards.map((c) => [Number(c.id), Number(c.fkStage)]))

const plano = alvo.map((l) => {
  const opp = Number(l.evotalks_opportunity_id) || null
  const st = opp ? etapa.get(opp) ?? null : null
  const acao = !opp ? 'so_status (sem card)' : st == null ? 'pular (card fora do funil 15)' : CARD_MOVE.has(st) ? 'mover card + status' : `pular (card na etapa ${st})`
  return { id: l.id, nome: l.nome, telefone: l.telefone, status_antes: l.status, opp, etapa_antes: st, acao, mensagens: textos.get(l.id) ?? [] }
})
const cont: Record<string, number> = {}; for (const p of plano) cont[p.acao] = (cont[p.acao] ?? 0) + 1
const porStatus: Record<string, number> = {}; for (const p of plano) porStatus[p.status_antes] = (porStatus[p.status_antes] ?? 0) + 1
console.log(`alvo: ${plano.length}`, porStatus); console.log(cont)
if (!EXECUTAR) {
  console.log('\nENSAIO — nada foi alterado. Rode com --executar.')
  plano.filter((p) => p.acao.startsWith('pular')).slice(0, 10).forEach((p) => console.log('  pular:', p.nome, p.acao))
  process.exit(0)
}

// 3) execução
fs.writeFileSync(BACKUP, JSON.stringify({ geradoEm: new Date().toISOString(), plano }, null, 1))
console.log(`backup: ${BACKUP}`)
const t0 = Date.now()
let movidos = 0, soStatus = 0, falhas = 0
for (const p of plano) {
  if (p.acao.startsWith('pular')) continue
  if (p.opp) {
    const res = await fetch(`${BASE}/int/changeOpportunityStage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queueId: QID, apiKey: QKEY, id: p.opp, destStageId: 66 }) })
    if (!res.ok) { falhas++; console.error(`  falhou card #${p.opp} (${p.nome}): HTTP ${res.status} ${(await res.text()).slice(0, 120)}`); continue }
  }
  const { data: fresco } = await sb.from('sdr_leads').select('observacoes, status').eq('id', p.id).maybeSingle()
  if (!fresco || !['INTERESSADO', 'AGUARDANDO', 'INICIO'].includes(fresco.status)) { console.warn(`  ${p.nome}: status mudou pra ${fresco?.status} no meio — não toquei`); continue }
  const obs = `${(fresco.observacoes ?? '').trim()} [REBAIXADO_SO_ROBO:${new Date().toISOString()}]`.trim()
  const { error } = await sb.from('sdr_leads').update({ status: 'INICIO', observacoes: obs }).eq('id', p.id)
  if (error) { falhas++; console.error(`  status falhou ${p.nome}: ${error.message}`); continue }
  if (p.opp) movidos++; else soStatus++
  if ((movidos + soStatus) % 50 === 0) console.log(`  ${movidos + soStatus} feitos (${Math.round((Date.now() - t0) / 1000)}s)`)
}
console.log(`\nFEITO: ${movidos} com card movido pra Início · ${soStatus} só status (sem card) · ${falhas} falhas`)
