import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { resolverChamadoPlanilha } from '@/lib/manual-docs'

/**
 * POST /api/chamados — marca/desmarca um chamado como resolvido.
 * Protegida pelo middleware (cookie do painel), igual /api/registros.
 *
 * 08/09/2026 (Aldo): ao resolver, também escreve "sim" na coluna Resolvido da
 * aba Chamados da planilha AIVA APROVAÇÃO (melhor esforço — a planilha nunca
 * segura o painel; se falhar, o chamado some do painel e a planilha fica pro X manual).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: string; resolvido?: boolean } | null
  if (!body?.id || typeof body.resolvido !== 'boolean') {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 })
  }
  const { data: chamado, error } = await supabaseAdmin
    .from('sdr_chamados')
    .update({
      status: body.resolvido ? 'resolvido' : 'aberto',
      resolvido_em: body.resolvido ? new Date().toISOString() : null,
    })
    .eq('id', body.id)
    .select('telefone, problema')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let planilha_ok: boolean | null = null
  if (body.resolvido && chamado?.telefone) {
    planilha_ok = await resolverChamadoPlanilha({
      telefone: chamado.telefone,
      problema: chamado.problema,
      observacao: `Resolvido pelo painel em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    })
  }
  return NextResponse.json({ ok: true, planilha_ok })
}
