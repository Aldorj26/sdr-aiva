/**
 * SLA DE LIBERAÇÃO — digest de lojas paradas em TREINAR/LOGIN.
 *
 * ⚠️ DESATIVADO em 2026-08-06 a pedido do Aldo ("pode retirar esse relatório,
 * não precisa mais"). O cron do Vercel foi REMOVIDO do vercel.json — ninguém
 * recebe mais esse digest diário. O endpoint continua aqui e funcionando: dá
 * pra chamar sob demanda (use ?dry=true pra ver a lista sem mandar WhatsApp).
 * Pra reativar o envio automático, basta repor a entrada no vercel.json:
 *   { "path": "/api/sdr/sla-liberacao", "schedule": "0 12 * * 1-5" }
 *
 * Origem: curadoria 2026-07-27 — a queixa nº 1 dos leads pós-cadastro é
 * "cadê meu login/acesso?" (74 leads cobrando). O lead fecha, fica dias
 * esperando a liberação e ninguém enxerga isso de forma agregada.
 *
 * O que faz: busca leads AIVA em TREINAR ou LOGIN cujo status não muda há
 * 3+ dias (status_alterado_em — trigger no banco marca toda mudança de
 * status) e manda UM digest por dia pro Nei + Aldo com a lista ordenada
 * do mais parado pro menos parado.
 *
 * Params:
 *   ?dry=true   → devolve o digest no JSON sem enviar WhatsApp
 *   ?dias=N     → limiar em dias (default 3)
 *
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET (cron Vercel: 12h UTC = 9h BRT, seg-sex).
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { alertHuman } from '@/lib/evotalks'

export const maxDuration = 60

const ETAPA_LABEL: Record<string, string> = {
  TREINAR: 'Treinar',
  LOGIN: 'Login',
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === 'true'
  const dias = Math.max(1, Number(url.searchParams.get('dias')) || 3)
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

  const { data: parados, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, status_alterado_em')
    .eq('produto', 'AIVA')
    .in('status', ['TREINAR', 'LOGIN'])
    .lte('status_alterado_em', cutoff)
    .order('status_alterado_em', { ascending: true })

  if (error) {
    console.error('[SLA_LIBERACAO] Erro ao buscar leads:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!parados || parados.length === 0) {
    return NextResponse.json({ ok: true, parados: 0, mensagem: null })
  }

  const agora = Date.now()
  const linhas = parados.map((l) => {
    const d = Math.floor((agora - new Date(l.status_alterado_em as string).getTime()) / 86400000)
    return `• *${l.nome}* — ${ETAPA_LABEL[l.status] ?? l.status} há *${d}d* (${l.telefone})`
  })

  // Teto de 25 linhas pra não estourar o limite de mensagem do WhatsApp.
  const visiveis = linhas.slice(0, 25)
  const resto = linhas.length - visiveis.length

  const digest =
    `⏰ *SLA DE LIBERAÇÃO — ${parados.length} loja(s) parada(s) ${dias}+ dias*\n\n` +
    visiveis.join('\n') +
    (resto > 0 ? `\n… e mais ${resto} loja(s)` : '') +
    `\n\nEssas lojas fecharam e estão esperando acesso/treinamento. ` +
    `Quanto mais tempo paradas, maior o risco de desistência (caso CredCell).`

  if (!dry) {
    if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, digest)
    if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, digest)
    console.log(`[SLA_LIBERACAO] Digest enviado: ${parados.length} lojas paradas ${dias}+ dias`)
  }

  return NextResponse.json({ ok: true, parados: parados.length, dry, mensagem: digest })
}
