import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/registros — marca/desmarca "enviado" num CNPJ da aba
 * "CNPJs registrados na base" do painel (/registros).
 * Protegida pelo middleware (cookie do painel).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string; enviado?: boolean } | null
  if (!body?.id || typeof body.enviado !== 'boolean') {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('sdr_registros_cnpj')
    .update({ enviado: body.enviado })
    .eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
