import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Atalhos de texto pronto do "Enviar info" (LeadDrawer) — editáveis pelo
// painel (pedido do Aldo 2026-07-31: Nei pode ajustar os textos, criar novos
// com links e excluir). Protegido pelo cookie do painel via middleware.

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('sdr_atalhos_info')
    .select('id, rotulo, texto, ordem')
    .order('ordem', { ascending: true })
    .order('criado_em', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ atalhos: data ?? [] })
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { id?: string; rotulo?: string; texto?: string; ordem?: number }
  const rotulo = body.rotulo?.trim()
  const texto = body.texto?.trim()
  if (!rotulo || !texto) {
    return NextResponse.json({ error: 'rotulo e texto são obrigatórios' }, { status: 400 })
  }

  if (body.id) {
    const { error } = await supabaseAdmin
      .from('sdr_atalhos_info')
      .update({ rotulo, texto, atualizado_em: new Date().toISOString(), ...(body.ordem != null ? { ordem: body.ordem } : {}) })
      .eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: body.id })
  }

  // novo atalho entra no fim da lista
  const { data: max } = await supabaseAdmin
    .from('sdr_atalhos_info')
    .select('ordem')
    .order('ordem', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data, error } = await supabaseAdmin
    .from('sdr_atalhos_info')
    .insert({ rotulo, texto, ordem: (max?.ordem ?? 0) + 1 })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  const { error } = await supabaseAdmin.from('sdr_atalhos_info').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
