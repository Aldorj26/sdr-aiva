/**
 * lib/lgpd.ts — exclusão de dados pessoais a pedido do lead (LGPD).
 *
 * Regra do Aldo 08/09/2026 (caso NanCell — "Apagar meus dados"): quando um
 * lead pede pra apagar os dados, a VictorIA CONFIRMA que vai remover, o
 * sistema remove na hora o que está sob nosso controle e avisa Aldo/Nei do
 * que precisa de conferência manual (planilha, HubSpot, histórico no Evo).
 *
 * O que É apagado/anonimizado:
 *   - sdr_mensagens, sdr_registros_colab, sdr_registros_cnpj, sdr_chamados,
 *     sdr_repasses_solicitados do lead → DELETE
 *   - oportunidade no Evo (funil 15) e conta-espelho MRR (funil 11) → remove
 *   - sdr_leads: nome/cidade/observações anonimizados, status OPT_OUT
 *   - sdr_fila_disparo: nome/cidade anonimizados, status EXCLUIDO_LGPD
 *
 * O que FICA (base legal: legítimo interesse pra honrar o opt-out): só o
 * TELEFONE, como lista de bloqueio — sem ele o lead voltaria a ser disparado
 * na próxima varredura. Nome, e-mail, CNPJ, sócio, conversa: tudo some.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { removeOpportunity } from '@/lib/evotalks'

/** Pedido de exclusão de dados em linguagem natural (pt-BR). */
export const RE_PEDIDO_EXCLUSAO =
  /(apag|exclu|delet|remov)\w*\s+(todos\s+)?(os\s+)?meus\s+dados|meus\s+dados\s+(sejam\s+)?(apagad|exclu[ií]d|removid|deletad)|(exclus[aã]o|remo[cç][aã]o)\s+d[oe]s?\s+(meus\s+)?dados|\blgpd\b/i

export const MARCADOR_DADOS_APAGADOS = '[DADOS_APAGADOS:'

export interface ResultadoExclusao {
  leadId: string
  telefone: string
  mensagens: number
  colaboradores: number
  cnpjs: number
  chamados: number
  repasses: number
  oppEvo: number | null
  oppEvoRemovida: boolean
  oppMrr: number | null
  oppMrrRemovida: boolean
  filaDisparo: number
  erros: string[]
}

export async function apagarDadosLead(leadId: string): Promise<ResultadoExclusao> {
  const { data: lead, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, telefone, observacoes, evotalks_opportunity_id')
    .eq('id', leadId)
    .maybeSingle()
  if (error || !lead) throw new Error(`lead ${leadId} não encontrado${error ? ': ' + error.message : ''}`)

  const r: ResultadoExclusao = {
    leadId, telefone: lead.telefone, mensagens: 0, colaboradores: 0, cnpjs: 0, chamados: 0, repasses: 0,
    oppEvo: lead.evotalks_opportunity_id ? Number(lead.evotalks_opportunity_id) : null, oppEvoRemovida: false,
    oppMrr: null, oppMrrRemovida: false, filaDisparo: 0, erros: [],
  }
  const obs = lead.observacoes ?? ''
  const mrr = obs.match(/\[MRR_OPP:(\d+)\]/)?.[1]
  if (mrr) r.oppMrr = Number(mrr)

  const apagar = async (tabela: string, campo: keyof ResultadoExclusao) => {
    const { data, error: e } = await supabaseAdmin.from(tabela).delete().eq('lead_id', leadId).select('id')
    if (e) r.erros.push(`${tabela}: ${e.message}`)
    else (r as unknown as Record<string, number>)[campo] = data?.length ?? 0
  }
  await apagar('sdr_mensagens', 'mensagens')
  await apagar('sdr_registros_colab', 'colaboradores')
  await apagar('sdr_registros_cnpj', 'cnpjs')
  await apagar('sdr_chamados', 'chamados')
  await apagar('sdr_repasses_solicitados', 'repasses')

  // Evo: oportunidade do funil 15 + conta-espelho MRR (funil 11)
  if (r.oppEvo) {
    try { await removeOpportunity(r.oppEvo); r.oppEvoRemovida = true } catch (e) { r.erros.push(`evo opp ${r.oppEvo}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  if (r.oppMrr) {
    try { await removeOpportunity(r.oppMrr); r.oppMrrRemovida = true } catch (e) { r.erros.push(`evo mrr ${r.oppMrr}: ${e instanceof Error ? e.message : String(e)}`) }
  }

  // Fila de disparo: mantém o telefone como bloqueio, some o resto
  {
    const { data, error: e } = await supabaseAdmin
      .from('sdr_fila_disparo')
      .update({ nome: 'Dados removidos (LGPD)', cidade: null, status: 'EXCLUIDO_LGPD', detalhe: 'pedido do lead' })
      .eq('telefone', lead.telefone)
      .select('id')
    if (e) r.erros.push(`fila: ${e.message}`)
    else r.filaDisparo = data?.length ?? 0
  }

  // Lead: anonimiza e trava como OPT_OUT (o telefone é a lista de bloqueio)
  const { error: eLead } = await supabaseAdmin
    .from('sdr_leads')
    .update({
      nome: 'Dados removidos (LGPD)',
      cidade: null,
      status: 'OPT_OUT',
      acionar_humano: false,
      data_proximo_followup: null,
      instrucao_silvia: null,
      evotalks_opportunity_id: null,
      observacoes: `${MARCADOR_DADOS_APAGADOS}${new Date().toISOString()}] [OPT_OUT_LGPD]`,
    })
    .eq('id', leadId)
  if (eLead) r.erros.push(`lead: ${eLead.message}`)

  return r
}

export function resumoExclusao(r: ResultadoExclusao, nomeOriginal: string): string {
  return (
    `🗑️ *EXCLUSÃO DE DADOS (LGPD)* — ${nomeOriginal} (${r.telefone})\n` +
    `O lead pediu pra apagar os dados. Removido agora:\n` +
    `• ${r.mensagens} mensagens, ${r.cnpjs} CNPJ(s), ${r.colaboradores} colaborador(es), ${r.chamados} chamado(s), ${r.repasses} repasse(s)\n` +
    `• Evo: opp ${r.oppEvo ? `#${r.oppEvo} ${r.oppEvoRemovida ? 'removida' : 'FALHOU'}` : '—'}${r.oppMrr ? ` | MRR #${r.oppMrr} ${r.oppMrrRemovida ? 'removida' : 'FALHOU'}` : ''}\n` +
    `• Painel: nome/e-mail/CNPJ/sócio/conversa apagados; fica SÓ o telefone como bloqueio de recontato.\n` +
    `⚠️ Conferir na mão se existir: linha na planilha AIVA APROVAÇÃO, HubSpot e histórico do chat no Evo.` +
    (r.erros.length ? `\n❌ Erros: ${r.erros.join('; ')}` : '')
  )
}
