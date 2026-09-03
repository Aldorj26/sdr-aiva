import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/chamados — marca/desmarca um chamado como resolvido.
 * Protegida pelo middleware (cookie do painel), igual /api/registros.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string; resolvido?: boolean } | null
  if (!body?.id || typeof body.resolvido !== 'boolean') {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('sdr_chamados')
    .update({
      status: body.resolvido ? 'resolvido' : 'aberto',
      resolvido_em: body.resolvido ? new Date().toISOString() : null,
    })
    .eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
