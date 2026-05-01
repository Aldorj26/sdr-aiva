import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, saveMensagem } from '@/lib/supabase'
import { sendTemplate, createOpportunity, STAGES, checkUserExists } from '@/lib/evotalks'
import { isDiaUtil, rotuloHorario } from '@/lib/business-time'

interface LeadInput {
  nome: string
  telefone: string
  cidade?: string
}

const HSM_TEMPLATE_ID = 9

export async function POST(req: NextRequest) {
  // Bloqueio em fim de semana (defesa em profundidade — o send-campaign também bloqueia).
  if (!isDiaUtil()) {
    console.log(`[send-initial] bloqueado: ${rotuloHorario()} (fim de semana)`)
    return NextResponse.json(
      {
        error: 'disparo_bloqueado_fim_de_semana',
        info: `Disparos só acontecem de segunda a sexta. Hoje é ${rotuloHorario()}.`,
      },
      { status: 400 }
    )
  }

  const body = await req.json()
  const leads: LeadInput[] = body.leads ?? []

  if (!leads.length) {
    return NextResponse.json({ error: 'Nenhum lead informado' }, { status: 400 })
  }

  const resultados: { telefone: string; ok: boolean; lead_id?: string; erro?: string }[] = []
  let sucesso = 0
  let falha = 0
  let invalidos = 0

  for (const lead of leads) {
    try {
      // 0. Valida que o numero existe no WhatsApp antes de gastar HSM
      try {
        const check = await checkUserExists(lead.telefone)
        if (!check.exists) {
          resultados.push({ telefone: lead.telefone, ok: false, erro: 'numero_sem_whatsapp' })
          invalidos++
          continue
        }
      } catch (err) {
        // Se o check falhar, seguimos com o disparo (fail-open, nao bloqueia)
        console.warn(`checkUserExists falhou para ${lead.telefone}:`, err)
      }

      // 1. Upsert lead no Supabase
      const { data: leadData, error: upsertError } = await supabaseAdmin
        .from('sdr_leads')
        .upsert(
          {
            nome: lead.nome,
            telefone: lead.telefone,
            cidade: lead.cidade ?? null,
            produto: 'AIVA',
            status: 'DISPARO_REALIZADO',
            etapa_cadencia: 3,
            data_disparo_inicial: new Date().toISOString(),
            data_proximo_followup: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          },
          { onConflict: 'telefone', ignoreDuplicates: false }
        )
        .select('id')
        .single()

      if (upsertError || !leadData) throw new Error(upsertError?.message ?? 'Erro ao criar lead')

      const leadId = leadData.id

      // 2. Cria oportunidade no CRM na etapa "Início"
      let oppId: number | null = null
      try {
        oppId = await createOpportunity({
          title: `${lead.nome} — AIVA`,
          number: lead.telefone,
          city: lead.cidade,
          stageId: STAGES.INICIO,
        })
        await supabaseAdmin
          .from('sdr_leads')
          .update({ evotalks_opportunity_id: String(oppId) })
          .eq('id', leadId)
        console.log(`CRM: Oportunidade #${oppId} criada em "Início" para ${lead.nome} (${lead.telefone})`)
      } catch (err) {
        console.error(`Erro ao criar oportunidade para ${lead.telefone}:`, err)
      }

      // 3. Envia template HSM via Evo Talks
      // Variaveis do template — texto mais direto e conversacional
      // (a estrutura do template HSM e fixa, mas o conteudo das vars e customizavel)
      const vars = [
        'Vender mais celulares sem risco de calote',
        'vi que vocês trabalham com venda de celular e queria apresentar uma parceria rapida:',
        'A *AIVA* ajuda lojas como a sua a venderem mais — sem dor de cabeça:',
        '*Aprovação do cliente em 2 minutos*',
        '*Você recebe em 2 dias úteis*',
        '*Zero risco de inadimplência (o risco é nosso)*',
        '*Parcelamento em até 12x pro cliente*',
      ]
      await sendTemplate(lead.telefone, HSM_TEMPLATE_ID, vars)

      // 4. Salva mensagem no histórico
      const mensagemTemplate = `[Template AIVA enviado para ${lead.nome}]`
      await saveMensagem(leadId, 'out', mensagemTemplate, 'aiva_campanha')

      resultados.push({ telefone: lead.telefone, ok: true, lead_id: leadId })
      sucesso++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Erro ao processar ${lead.telefone}:`, msg)
      resultados.push({ telefone: lead.telefone, ok: false, erro: msg })
      falha++
    }
  }

  return NextResponse.json({ ok: true, total: leads.length, sucesso, falha, invalidos, resultados })
}
