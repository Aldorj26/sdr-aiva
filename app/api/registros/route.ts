import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { changeStageSeAvanco, STAGES } from '@/lib/evotalks'

/**
 * POST /api/registros — marca/desmarca "enviado" num CNPJ da aba
 * "CNPJs registrados na base" do painel (/registros).
 * Protegida pelo middleware (cookie do painel).
 *
 * Desde 17/09/2026 (Aldo) marcar como enviado também AVANÇA o card no Evo pra
 * "Cadastro Recebido" (49) — antes o Nei lançava o CNPJ aqui e depois tinha que
 * ir no Evo arrastar o card na mão. Quem faz o resto (HSM 20, alerta, início da
 * Fase 3) é a automação do Evo + o handler de /api/sdr/opportunity-stage, como
 * sempre: esta rota só move.
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

  // Estado ANTES da escrita: só avança o card numa transição real (não → sim).
  // Sem isso, reabrir o form de um CNPJ já enviado tentaria mover de novo.
  const { data: antes } = await supabaseAdmin
    .from('sdr_registros_cnpj')
    .select('enviado, lead_id, cnpj')
    .eq('id', body.id)
    .maybeSingle()

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

  // Pré-cadastro lançado → card pra Cadastro Recebido (49).
  // `changeStageSeAvanco` só AVANÇA: card já em 49+ (ou em Bot/93/94/95, que
  // estão fora da progressão linear) fica onde está. Desmarcar NÃO traz o card
  // de volta — a etapa é do time, e o HSM 20 já saiu.
  let card: { movido: boolean; motivo?: string; opp?: number } = { movido: false, motivo: 'nao_aplicavel' }
  if (body.enviado && !antes?.enviado && antes?.lead_id) {
    try {
      const { data: lead } = await supabaseAdmin
        .from('sdr_leads')
        .select('id, nome, telefone, status, evotalks_opportunity_id')
        .eq('id', antes.lead_id)
        .maybeSingle()
      const oppId = Number(lead?.evotalks_opportunity_id ?? NaN)
      if (Number.isFinite(oppId) && oppId > 0) {
        const r = await changeStageSeAvanco(oppId, STAGES.CADASTRO_RECEBIDO)
        card = { movido: r.moved, motivo: r.motivo, opp: oppId }
        console.log(
          `[registros] CNPJ ${antes.cnpj} lançado por ${origem ?? 'marcação manual'} — ` +
          `opp #${oppId} (${lead?.nome}) → Cadastro Recebido: ${r.moved ? 'movido' : r.motivo}`,
        )
      } else {
        card = { movido: false, motivo: 'lead_sem_oportunidade' }
      }
    } catch (err) {
      // Falha ao mover não pode derrubar a marcação: o Nei já lançou o CNPJ, e
      // o registro precisa ficar marcado de qualquer jeito. Ele move na mão.
      card = { movido: false, motivo: 'erro_ao_mover' }
      console.error(`[registros] falha ao mover card do registro ${body.id}:`, err)
    }
  }

  return NextResponse.json({ ok: true, card })
}
