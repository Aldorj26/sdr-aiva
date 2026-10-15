/**
 * avisos-painel.ts — IO dos avisos do robô no /atendimento (tabela sdr_avisos_painel).
 * Regras e catálogo em lib/avisos-painel-calc.ts.
 * ⚠️ Nada aqui lança erro: o painel é um ESPELHO do aviso de WhatsApp — se a gravação falhar,
 * o cron que chamou segue o trabalho dele (cobrança, marcador, digest).
 */
import { supabaseAdmin } from '@/lib/supabase'
import type { TipoAviso } from '@/lib/avisos-painel-calc'

export type ItemAviso = { leadId: string; loja: string | null; telefone?: string | null; detalhe?: string | null; status?: string | null }

/** Abre um aviso por loja. Quem já tem aviso ABERTO do mesmo tipo não duplica. */
export async function registrarAvisos(tipo: TipoAviso, itens: ItemAviso[]): Promise<number> {
  try {
    const validos = itens.filter((i) => i.leadId)
    if (!validos.length) return 0
    const ids = validos.map((i) => i.leadId)
    const { data: abertos } = await supabaseAdmin.from('sdr_avisos_painel').select('lead_id').eq('tipo', tipo).is('resolvido_em', null).in('lead_id', ids)
    const ja = new Set((abertos ?? []).map((a) => a.lead_id))
    const novos = validos.filter((i) => !ja.has(i.leadId))
    if (!novos.length) return 0
    // status na hora do aviso: é ele que diz depois se a etapa andou (avisoVelho)
    const semStatus = novos.filter((i) => !i.status).map((i) => i.leadId)
    const statusPorId = new Map<string, string>()
    if (semStatus.length) {
      const { data } = await supabaseAdmin.from('sdr_leads').select('id,status').in('id', semStatus)
      for (const l of data ?? []) statusPorId.set(l.id, l.status)
    }
    const { error } = await supabaseAdmin.from('sdr_avisos_painel').insert(novos.map((i) => ({
      tipo, lead_id: i.leadId, loja: i.loja || i.telefone || '—', telefone: i.telefone ?? null, detalhe: i.detalhe ?? null,
      status_lead: i.status ?? statusPorId.get(i.leadId) ?? null,
    })))
    if (error) { console.error('[avisos-painel] gravar:', error.message); return 0 }
    return novos.length
  } catch (e) {
    console.error('[avisos-painel] registrar falhou:', e instanceof Error ? e.message : e)
    return 0
  }
}

/** Fecha os avisos abertos de um tipo pra esses leads (a situação se resolveu sozinha). */
export async function resolverAvisos(tipo: TipoAviso, leadIds: string[], como: string): Promise<void> {
  try {
    if (!leadIds.length) return
    await supabaseAdmin.from('sdr_avisos_painel')
      .update({ resolvido_em: new Date().toISOString(), resolvido_como: como })
      .eq('tipo', tipo).is('resolvido_em', null).in('lead_id', leadIds)
  } catch (e) {
    console.error('[avisos-painel] resolver falhou:', e instanceof Error ? e.message : e)
  }
}

/**
 * Leads que NÃO devem receber aviso NOVO deste tipo agora: ou já têm um aviso ABERTO,
 * ou alguém clicou em "Resolvido" há menos de `silencioMs`.
 *
 * Por que existe (15/10/2026): o "✓ Resolvido" só carimba `resolvido_em` na linha do aviso —
 * ele não muda a situação da loja. Quem chama `registrarAvisos` na transição de um marcador
 * nunca mais reabre o aviso depois de um Resolvido manual, porque o marcador continua lá: o
 * caso some do painel para sempre e ninguém mais sabe que a loja está parada. Com isto, o
 * Resolvido vira uma SONECA — some agora e volta se a situação não andar.
 *
 * Em caso de erro devolve TODOS os ids (silêncio): deixar de avisar uma rodada é melhor do que
 * repetir o aviso a cada 15 min por causa de uma consulta que falhou.
 */
export async function leadsEmSilencio(tipo: TipoAviso, leadIds: string[], silencioMs: number): Promise<Set<string>> {
  if (!leadIds.length) return new Set()
  try {
    const desde = new Date(Date.now() - silencioMs).toISOString()
    const { data, error } = await supabaseAdmin
      .from('sdr_avisos_painel')
      .select('lead_id, resolvido_em')
      .eq('tipo', tipo)
      .in('lead_id', leadIds)
      .or(`resolvido_em.is.null,resolvido_em.gte.${desde}`)
    if (error) { console.error('[avisos-painel] silêncio:', error.message); return new Set(leadIds) }
    const fora = new Set<string>()
    for (const r of data ?? []) if (r.lead_id) fora.add(r.lead_id as string)
    return fora
  } catch (e) {
    console.error('[avisos-painel] silêncio falhou:', e instanceof Error ? e.message : e)
    return new Set(leadIds)
  }
}
