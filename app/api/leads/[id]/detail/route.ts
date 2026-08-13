import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getOpportunity, getTagCatalog } from '@/lib/evotalks'

// Etapa do funil AIVA (pipeline 15) → rótulo. Mesmo mapa da listagem — exibido
// no drawer pra não parecer divergência com o status da conversa (pedido do
// Aldo 2026-07-29, caso ML Cell: card em Cadastro Recebido + conversa
// INTERESSADO é o desenho da Fase 3, mas sem a etapa visível parecia erro).
const ETAPA_LABEL: Record<number, string> = {
  66: 'Início',
  47: 'Interessado',
  53: 'Interessado sem resposta',
  54: 'Pré-aprovação',
  49: 'Cadastro recebido',
  50: 'Em análise AIVA',
  70: 'Treinar',
  71: 'Login',
  51: 'Loja finalizada e vendendo',
  69: 'Bot detectado',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('sdr_leads')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (leadErr || !lead) {
    return NextResponse.json({ error: 'lead_nao_encontrado' }, { status: 404 })
  }

  // Últimas N mensagens (não as primeiras!): ordena DESC, corta e reinverte pra
  // ordem cronológica. ANTES usava ascending+limit, então numa conversa longa o
  // painel mostrava só o começo e escondia o que acabou de acontecer — divergindo
  // do que o time via no Evo (bug reportado pelo Aldo em 28/07, lead Tudo Celular).
  const LIMITE_MSGS = 200
  const { count: totalMensagens } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', id)

  const { data: mensagensRaw } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('*')
    .eq('lead_id', id)
    .order('enviado_em', { ascending: false })
    .limit(LIMITE_MSGS)

  const mensagens = (mensagensRaw ?? []).reverse()

  // Anexa a avaliação de curadoria (joia/não joia) em cada mensagem
  const { data: curRaw } = await supabaseAdmin
    .from('sdr_curadoria')
    .select('mensagem_id, avaliacao')
    .in('mensagem_id', mensagens.map((m) => m.id))

  const curMap = new Map(
    (curRaw ?? []).map((c) => [c.mensagem_id as string, c.avaliacao as 'boa' | 'ruim']),
  )
  const mensagensComAvaliacao = mensagens.map((m) => ({
    ...m,
    avaliacao: curMap.get(m.id) ?? null,
  }))

  // Etapa atual do funil no Evo (fonte da verdade do card). Fail-soft: se a
  // API do Evo falhar ou a opp não existir mais, o drawer mostra "—".
  //
  // As etiquetas do card saem da MESMA chamada (vêm como IDs numéricos) — só o
  // catálogo de nomes/cores é lido à parte, e ele é cacheado por 10 min.
  let etapaEvo: string | null = null
  let tagsEvo: Array<{ id: number; name: string; bgcolor: string; fgcolor: string }> = []
  if (lead.evotalks_opportunity_id) {
    try {
      const opp = await getOpportunity(Number(lead.evotalks_opportunity_id))
      const stageId = Number(opp.fkStage ?? 0)
      if (stageId) etapaEvo = ETAPA_LABEL[stageId] ?? `etapa ${stageId}`

      const ids = Array.isArray(opp.tags) ? (opp.tags as unknown[]).map(Number).filter(Boolean) : []
      if (ids.length > 0) {
        const catalogo = await getTagCatalog()
        tagsEvo = ids
          .map((tid) => catalogo.get(tid))
          .filter((t): t is NonNullable<typeof t> => !!t)
          .map((t) => ({ id: t.id, name: t.name, bgcolor: t.bgcolor, fgcolor: t.fgcolor }))
      }
    } catch {
      /* opp removida/transferida ou Evo fora — segue sem etapa */
    }
  }

  return NextResponse.json({
    lead,
    mensagens: mensagensComAvaliacao,
    totalMensagens: totalMensagens ?? mensagens.length,
    etapaEvo,
    tagsEvo,
  })
}
