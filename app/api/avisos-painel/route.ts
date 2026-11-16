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
  const body = (await req.json().catch(() => null)) as { id?: string; reenviouCnpj?: string } | null
  if (!body?.id) return NextResponse.json({ error: 'payload_invalido' }, { status: 400 })
  const agora = new Date().toISOString()
  // "Abrir form" do "📮 Marcado e não chegou à AIVA" (Aldo 16/11/2026): o clique é o reenvio, então o aviso
  // some na hora E o relógio das 24h do espelho recomeça. O espelho conta do `enviado_em` do CNPJ; sem
  // recarimbar, a linha voltava 6h depois (fim da soneca) mesmo com o formulário reenviado, porque o
  // carimbo seguia sendo o do primeiro clique, de dias atrás. Se em 24h o CNPJ não aparecer no portal,
  // o aviso reabre sozinho — é a rede pra quem abriu e não enviou.
  const cnpj = (body.reenviouCnpj ?? '').replace(/\D/g, '')
  if (cnpj.length === 14) {
    // só recarimba o CNPJ do lead DESTE aviso, e só se o aviso ainda está aberto (clique duplo não carimba de novo)
    const { data: aviso } = await supabaseAdmin.from('sdr_avisos_painel').select('lead_id')
      .eq('id', body.id).eq('tipo', 'pre_cadastro_nao_chegou').is('resolvido_em', null).maybeSingle()
    if (aviso?.lead_id) {
      const { error: e1 } = await supabaseAdmin.from('sdr_registros_cnpj').update({ enviado_em: agora })
        .eq('cnpj', cnpj).eq('lead_id', aviso.lead_id).eq('enviado', true)
      if (e1) console.error('[avisos-painel] recarimbar enviado_em:', e1.message)
    }
  }
  const { error } = await supabaseAdmin.from('sdr_avisos_painel')
    .update({ resolvido_em: agora, resolvido_como: cnpj.length === 14 ? 'painel: reenviou o formulário' : 'painel' })
    .eq('id', body.id).is('resolvido_em', null)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
