/**
 * POST /api/sdr/lgpd-apagar — exclusão de dados de um lead a pedido (LGPD).
 * Body: { telefone } ou { lead_id }. Auth: Bearer WEBHOOK_SECRET.
 * Uso interno (Aldo/Claude); o caminho automático é a captura no webhook.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { apagarDadosLead, resumoExclusao } from '@/lib/lgpd'
import { alertHuman } from '@/lib/evotalks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as { telefone?: string; lead_id?: string; avisar?: boolean }
  let q = supabaseAdmin.from('sdr_leads').select('id, nome, telefone')
  q = body.lead_id ? q.eq('id', body.lead_id) : q.eq('telefone', String(body.telefone ?? '').replace(/\D/g, ''))
  const { data: lead } = await q.maybeSingle()
  if (!lead) return NextResponse.json({ ok: false, erro: 'lead_nao_encontrado' }, { status: 404 })

  const r = await apagarDadosLead(lead.id)
  const resumo = resumoExclusao(r, lead.nome)
  if (body.avisar !== false) {
    if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, resumo)
    if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, resumo)
  }
  return NextResponse.json({ ok: r.erros.length === 0, resultado: r, resumo })
}
