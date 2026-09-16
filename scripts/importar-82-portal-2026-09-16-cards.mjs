#!/usr/bin/env node
/**
 * Parte 2 da importação dos 82 (ver importar-82-portal-2026-09-16.mjs): os cards no Evo.
 *
 * O Evo NÃO cria oportunidade direto na etapa 50 (403 OPP_017). Caminho que
 * funciona: criar em 66 (Início) SEM telefone → nada dispara (os handlers de
 * /opportunity-stage não acham o lead) → gravar o telefone → mover pra 50.
 * O aviso de etapa 50 ao Nei/Aldo é suprimido pelo marcador [ALERTA_ETAPA:50]
 * — que só funciona se o lead for encontrado pelo telefone da opp. Por isso o
 * marcador de "sem telefone" vira numérico: `000` + CNPJ (17 dígitos), igual no
 * lead, no registro e na opp. Sem isso seriam 47 avisos "telefone n/d".
 *
 * Também: corrige os 4 cards que a primeira execução (cancelada) deixou em 51,
 * apaga a opp de teste 19475, e no fim reafirma EM_ANALISE_AIVA em todos (o
 * handler da etapa 50 pode não conseguir mandar o HSM 34 pra fixo/marcador).
 *
 *   node --env-file=.env.local scripts/importar-82-portal-2026-09-16-cards.mjs --dry
 *   node --env-file=.env.local scripts/importar-82-portal-2026-09-16-cards.mjs
 */
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const OPP_TESTE = 19475
const dorme = (ms) => new Promise((r) => setTimeout(r, ms))
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const evo = async (path, body) => {
  const res = await fetch(`${process.env.EVO_TALKS_BASE_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: Number(process.env.EVO_TALKS_QUEUE_ID), apiKey: process.env.EVO_TALKS_QUEUE_API_KEY, ...body }),
    signal: AbortSignal.timeout(30000),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`Evo ${path} ${res.status}: ${txt.slice(0, 160)}`)
  try { return JSON.parse(txt) } catch { return {} }
}

const { data: leads, error } = await sb.from('sdr_leads')
  .select('id, nome, telefone, cidade, status, evotalks_opportunity_id, observacoes')
  .like('observacoes', '%[IMPORTADO_PORTAL:%').order('criado_em')
if (error) throw error
const { data: regs } = await sb.from('sdr_registros_cnpj').select('id, lead_id, cnpj, telefone').in('lead_id', leads.map((l) => l.id))
const cnpjDe = (l) => String((regs ?? []).find((r) => r.lead_id === l.id)?.cnpj ?? '')
console.log(`leads importados: ${leads.length} · sem telefone: ${leads.filter((l) => l.telefone.startsWith('sem-tel-')).length} · já com card: ${leads.filter((l) => l.evotalks_opportunity_id).length}`)
if (DRY) process.exit(0)

let criados = 0, movidos = 0, erros = []
for (const l of leads) {
  const cnpj = cnpjDe(l)
  let telefone = l.telefone
  try {
    // 1) marcador numérico no lugar de sem-tel-
    if (telefone.startsWith('sem-tel-')) {
      telefone = `000${cnpj}`
      const { error: e1 } = await sb.from('sdr_leads').update({ telefone }).eq('id', l.id)
      if (e1) throw new Error(`telefone lead: ${e1.message}`)
      await sb.from('sdr_registros_cnpj').update({ telefone }).eq('lead_id', l.id)
    }
    // 2) marcadores/status certos (a 1ª execução gravou 51)
    const obs = (l.observacoes ?? '').replace('[ALERTA_ETAPA:51]', '[ALERTA_ETAPA:50]').replace(/\s*\[CONSULTORIA_(INICIO|COUNT|ULTIMA):[^\]]*\]/g, '')
    await sb.from('sdr_leads').update({ observacoes: obs, status: 'EM_ANALISE_AIVA' }).eq('id', l.id)

    // 3) card
    let opp = l.evotalks_opportunity_id ? Number(l.evotalks_opportunity_id) : null
    if (!opp) {
      const r = await evo('/int/createOpportunity', { fkPipeline: 15, fkStage: 66, responsableid: 507, title: `${l.nome} — AIVA`, mainphone: '', city: l.cidade ?? '' })
      opp = Number(r?.id ?? 0) || null
      if (!opp) throw new Error('createOpportunity sem id')
      await sb.from('sdr_leads').update({ evotalks_opportunity_id: String(opp) }).eq('id', l.id)
      criados++
      await dorme(700)
    }
    await evo('/int/updateOpportunity', { id: opp, mainphone: telefone, tags: [69] })
    await dorme(700)
    await evo('/int/changeOpportunityStage', { id: opp, destStageId: 50 })
    movidos++
    console.log(`✓ ${l.nome} · opp #${opp} · ${telefone} → 50`)
  } catch (e) {
    erros.push(`${l.nome}: ${String(e).slice(0, 140)}`)
    console.log(`✗ ${l.nome} · ${String(e).slice(0, 140)}`)
  }
  await dorme(1200)
}

try { await evo('/int/removeOpportunity', { id: OPP_TESTE }); console.log(`opp de teste #${OPP_TESTE} removida`) } catch (e) { console.log(`opp de teste: ${String(e).slice(0, 100)}`) }

// 4) reafirma o status depois que os webhooks da etapa 50 assentaram
await dorme(8000)
const { data: fim } = await sb.from('sdr_leads').select('id, status').like('observacoes', '%[IMPORTADO_PORTAL:%')
const fora = (fim ?? []).filter((x) => x.status !== 'EM_ANALISE_AIVA')
for (const x of fora) await sb.from('sdr_leads').update({ status: 'EM_ANALISE_AIVA' }).eq('id', x.id)
console.log(`\ncards criados ${criados} · movidos pra 50 ${movidos} · erros ${erros.length} · status reafirmado em ${fora.length}`)
for (const e of erros) console.log('  ', e)
process.exit(0)
