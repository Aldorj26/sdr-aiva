// 20/10/2026 — reativa um lead DESCARTADO cujo card do Evo foi apagado (o botão Reativar do painel
// consulta a opp e falha com "evo_indisponivel" quando ela não existe mais). Cria um card novo no
// funil 15 em Interessado (47), religa o lead a ele e volta o status pra INTERESSADO.
// Uso: npx tsx --env-file=.env.local scripts/reativar-lead-sem-opp-2026-10-20.mts <lead_id>
import { createOpportunity, getOpportunity } from '../lib/evotalks'
import { supabaseAdmin } from '../lib/supabase'

const leadId = process.argv[2]
if (!leadId) { console.error('uso: <lead_id>'); process.exit(1) }
const { data: lead } = await supabaseAdmin.from('sdr_leads').select('id,nome,telefone,cidade,status,evotalks_opportunity_id,observacoes').eq('id', leadId).single()
if (!lead) throw new Error('lead não encontrado')
console.log('lead:', lead.nome, lead.telefone, lead.status, 'opp atual', lead.evotalks_opportunity_id)

let oppAntigaExiste = false
if (lead.evotalks_opportunity_id) {
  try { await getOpportunity(Number(lead.evotalks_opportunity_id)); oppAntigaExiste = true } catch (e) { console.log('opp antiga não existe mais:', String(e).slice(0, 80)) }
}
if (oppAntigaExiste) throw new Error('a opp antiga ainda existe — use o botão Reativar do painel')

const novaOpp = await createOpportunity({ title: `${lead.nome} — AIVA`, number: lead.telefone, city: lead.cidade ?? undefined })
console.log('opp nova criada no funil 15 / Interessado (47):', novaOpp)

const obs = `${(lead.observacoes ?? '').replace(/\s*\[DESCARTADO_MANUAL:[^\]]+\]/g, '').trim()} [REATIVADO_SEM_OPP:${lead.evotalks_opportunity_id ?? '-'}>${novaOpp}:${new Date().toISOString()}]`.trim()
const { error } = await supabaseAdmin.from('sdr_leads')
  .update({ status: 'INTERESSADO', evotalks_opportunity_id: String(novaOpp), observacoes: obs, status_alterado_em: new Date().toISOString() })
  .eq('id', lead.id)
if (error) throw new Error(error.message)
console.log('lead reativado: INTERESSADO, opp', novaOpp)
