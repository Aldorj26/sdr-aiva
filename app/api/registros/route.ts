import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/registros — marca/desmarca "enviado" num CNPJ da aba
 * "CNPJs registrados na base" do painel (/registros).
 * Protegida pelo middleware (cookie do painel).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { id?: string; enviado?: boolean; origem?: string }
    | null
  if (!body?.id || typeof body.enviado !== 'boolean') {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 })
  }
  // origem: 'abriu-form' quando veio do clique no link (marcação otimista);
  // null quando o operador marcou/desmarcou na mão — inclusive ao CONFIRMAR
  // um que estava automático, o que "promove" o registro a conferido.
  const origem = body.enviado && body.origem === 'abriu-form' ? 'abriu-form' : null
  const { error } = await supabaseAdmin
    .from('sdr_registros_cnpj')
    .update({ enviado: body.enviado, origem })
    .eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Status por loja (regra 01/09): marcar "enviado" promove informada →
  // pre_cadastro_enviado; desmarcar volta. NUNCA mexe em quem já está 'ativa'
  // (ativação é detectada pelo cruzamento semanal com o Data Studio).
  await supabaseAdmin
    .from('sdr_registros_cnpj')
    .update({ status: body.enviado ? 'pre_cadastro_enviado' : 'informada' })
    .eq('id', body.id)
    .neq('status', 'ativa')
  return NextResponse.json({ ok: true })
}
