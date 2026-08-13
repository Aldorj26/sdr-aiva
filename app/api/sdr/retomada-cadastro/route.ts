/**
 * retomada-cadastro/route.ts
 *
 * Correção pontual: leads que estavam no stage 49 (Cadastro Recebido) com a Fase 3
 * INCOMPLETA ouviram da VictorIA "seu cadastro está completo" por causa do bug de
 * mapeamento stage→status (corrigido em 19/06/2026). Esta rota dispara uma mensagem
 * de RETOMADA via HSM de reativação (template AIVA_REATIVACAO_TEMPLATE_ID), reabrindo
 * a janela e a coleta. Quando o lead responde, o webhook + VictorIA retomam de onde
 * parou (agora com o status correto = INTERESSADO).
 *
 * Idempotente: marca [RETOMADA_CADASTRO:ISO] em observacoes — nunca dispara 2x.
 *
 * Params: ?dry=true → preview sem enviar.
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const REOPEN_TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)

// As 15 oportunidades no stage 49 com Fase 3 incompleta (auditoria 19/06/2026).
const OPP_IDS = ['2619','4553','5250','5275','5306','5417','5475','5816','5952','6041','6159','6165','6217','6277','6505']

// Miolo do template ({{2}}). O template 48 já adiciona "Oi {{1}}, tudo bem?" antes
// e "É só responder essa mensagem. 😊" depois.
const MIOLO =
  'Voltei aqui rapidinho sobre o cadastro da sua loja na AIVA. Pra liberar a análise final ainda faltam só alguns dados rápidos — então ele ainda não está 100% concluído. É coisa de 2 minutinhos: te pergunto um por um. Posso começar?'

function nomeDoLead(obs: string | null, nome: string): string {
  const m = (obs ?? '').match(/nome_socio=([^|\]]+)/)
  return normalizaNome(m?.[1] ?? null) || normalizaNome(nome) || 'tudo bem'
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === 'true'

  if (!REOPEN_TEMPLATE_ID) {
    return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })
  }

  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, observacoes, evotalks_opportunity_id')
    .in('evotalks_opportunity_id', OPP_IDS)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  const previews: Array<{ nome: string; telefone: string; mensagem: string }> = []
  let enviados = 0, pulados = 0, falhas = 0
  const detalhes: Array<{ telefone: string; resultado: string }> = []

  for (const lead of leads ?? []) {
    if ((lead.observacoes ?? '').includes('[RETOMADA_CADASTRO:')) { pulados++; continue }
    const nome = nomeDoLead(lead.observacoes, lead.nome)
    const textoCompleto = `Oi ${nome}, tudo bem?\n${MIOLO} É só responder essa mensagem. 😊`

    if (dry) {
      previews.push({ nome, telefone: lead.telefone, mensagem: textoCompleto })
      continue
    }

    try {
      await sendTemplate(lead.telefone, REOPEN_TEMPLATE_ID, [nome, MIOLO])
      const novaObs = `${(lead.observacoes ?? '').trim()} [RETOMADA_CADASTRO:${new Date().toISOString()}]`.trim()
      await supabaseAdmin
        .from('sdr_leads')
        .update({ observacoes: novaObs, data_ultimo_contato: new Date().toISOString() })
        .eq('id', lead.id)
      await supabaseAdmin.from('sdr_mensagens').insert([
        { lead_id: lead.id, direcao: 'out', conteudo: '[Retomada de cadastro enviada]', template_hsm: 'aiva_reativacao_48h' },
        { lead_id: lead.id, direcao: 'out', conteudo: textoCompleto },
      ])
      enviados++
      detalhes.push({ telefone: lead.telefone, resultado: 'enviado' })
    } catch (err) {
      falhas++
      detalhes.push({ telefone: lead.telefone, resultado: `falha: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  return NextResponse.json({
    ok: true,
    dry,
    encontrados: (leads ?? []).length,
    enviados: dry ? 0 : enviados,
    pulados,
    falhas,
    previews: dry ? previews : undefined,
    detalhes: dry ? undefined : detalhes,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
