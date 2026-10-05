import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Avisos do robô no /atendimento (Aldo 05/10/2026). Protegida pelo middleware (cookie do painel).
 * GET  → { abertos } — o número que o menu lateral mostra ao lado de "Atendimento".
 * POST { id } → marca o aviso como resolvido (some da lista).
 */
export async function GET() {
  const { count, error } = await supabaseAdmin.from('sdr_avisos_painel').select('id', { count: 'exact', head: true }).is('resolvido_em', null)
  if (error) return NextResponse.json({ abertos: 0, erro: error.message })
  return NextResponse.json({ abertos: count ?? 0 })
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string } | null
  if (!body?.id) return NextResponse.json({ error: 'payload_invalido' }, { status: 400 })
  const { error } = await supabaseAdmin.from('sdr_avisos_painel')
    .update({ resolvido_em: new Date().toISOString(), resolvido_como: 'painel' })
    .eq('id', body.id).is('resolvido_em', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
