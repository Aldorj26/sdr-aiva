import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { changeStageSeAvanco, STAGES } from '@/lib/evotalks'

/**
 * POST /api/registros — marca/desmarca "enviado" num CNPJ da aba
 * "CNPJs registrados na base" do painel (/registros).
 * Protegida pelo middleware (cookie do painel).
 *
 * Desde 17/09/2026 (Aldo) marcar o CNPJ MATRIZ como enviado também AVANÇA o card
 * no Evo pra "Cadastro Recebido" (49) — antes o Nei lançava o CNPJ aqui e depois
 * tinha que ir no Evo arrastar o card na mão. Quem faz o resto (HSM, alerta, início da
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
    .select('enviado, lead_id, cnpj, tipo')
    .eq('id', body.id)
    .maybeSingle()

  // `enviado_em` é a hora do CLIQUE, e é dela que o passo 11 do espelho conta as 24h do aviso
  // "pré-cadastro não chegou à AIVA" (15/10/2026). Antes a conta saía de `criado_em`, a captura do
  // CNPJ: CNPJ de uma semana atrás clicado hoje disparava o aviso na primeira rodada, dizendo
  // "marcado há mais de 24h". Só carimba na transição não → sim; desmarcar limpa.
  // A coluna pode ainda não existir (docs/sql/2026-10-15-pre-cadastro-enviado-em.sql): nesse caso
  // grava sem ela, porque marcar o CNPJ não pode falhar por causa do carimbo.
  const virou = body.enviado && !antes?.enviado
  const patch = { enviado: body.enviado, origem }
  let { error } = await supabaseAdmin
    .from('sdr_registros_cnpj')
    .update(virou ? { ...patch, enviado_em: new Date().toISOString() } : body.enviado ? patch : { ...patch, enviado_em: null })
    .eq('id', body.id)
  if (error && (error.code === '42703' || /enviado_em/.test(error.message))) {
    console.warn('[registros] sdr_registros_cnpj sem a coluna enviado_em — aplicar docs/sql/2026-10-15-pre-cadastro-enviado-em.sql')
    ;({ error } = await supabaseAdmin.from('sdr_registros_cnpj').update(patch).eq('id', body.id))
  }
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
  // de volta — a etapa é do time, e o HSM de loja pré-aprovada já saiu.
  //
  // Só a MATRIZ move (17/09): o card só está em Pré Aprovação quando existe
  // exatamente um registro, o da matriz — os CNPJs das filiais só nascem na
  // conclusão da Fase 3, com o card já em 49. Então marcar filial nunca deveria
  // mover nada, e restringir aqui evita que abrir o form de uma filial pra
  // conferir um CNPJ dispare HSM por engano.
  let card: { movido: boolean; motivo?: string; opp?: number } = { movido: false, motivo: 'nao_aplicavel' }
  if (body.enviado && !antes?.enviado && antes?.lead_id && antes?.tipo === 'matriz') {
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
