import { NextRequest, NextResponse } from 'next/server'
import { getLeadsForFollowup, updateLeadStatus, saveMensagem, supabaseAdmin } from '@/lib/supabase'
import { sendTemplate, changeOpportunityStage, addOpportunityNote, STAGES } from '@/lib/evotalks'
import { isDiaUtil, rotuloHorario } from '@/lib/business-time'

// Templates HSM aprovados pela Meta (Evo Talks)
const TEMPLATES: Record<number, { id: number; texto: (nome: string) => string }> = {
  3: {
    id: 12,
    texto: (nome) =>
      `Olá, ${nome}. Passando para informar que a AIVA já atende mais de 2.000 lojas no Brasil com financiamento rápido e zero risco de inadimplência. A ativação é gratuita. Quer entender como funciona pra sua loja? Só entrar em contato por aqui.`,
  },
  7: {
    id: 11,
    texto: (nome) =>
      `Oi ${nome}. Passando para informar que as lojas que usam a AIVA vendem mais porque atendem clientes que não têm cartão ou limite. Taxa de 12%, você recebe em 2 dias. Faz sentido conversarmos? Aguardamos o seu retorno.`,
  },
  14: {
    id: 10,
    texto: (nome) =>
      `Oi ${nome}, última mensagem pra não te incomodar. Se um dia quiser oferecer financiamento de celulares com 12% e zero inadimplência, é só me chamar. Estamos à disposição.`,
  },
}

const PROXIMA_ETAPA: Record<number, { etapa: number; diasAte: number } | null> = {
  3: { etapa: 7, diasAte: 4 },   // D+3 → próximo em D+7
  7: { etapa: 14, diasAte: 7 },  // D+7 → próximo em D+14
  14: null,                       // D+14 → descarta
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Skip silencioso em fim de semana — cron agendado vai rodar mas não dispara
  // HSM de follow-up. Agendamentos pendentes ficam pra próxima segunda.
  if (!isDiaUtil()) {
    console.log(`[followup] skip: ${rotuloHorario()} (fim de semana)`)
    return NextResponse.json({ ok: true, ignorado: 'fim_de_semana', quando: rotuloHorario() })
  }

  const leads = await getLeadsForFollowup()

  if (!leads.length) {
    return NextResponse.json({ ok: true, processados: 0, mensagem: 'Nenhum lead para follow-up' })
  }

  let sucesso = 0
  let falha = 0

  for (const lead of leads) {
    const etapa = lead.etapa_cadencia
    const template = TEMPLATES[etapa]

    if (!template) {
      console.warn(`Lead ${lead.id} com etapa inválida: ${etapa}`)
      continue
    }

    try {
      // Envia HSM template via Evo Talks (funciona fora da janela de 24h)
      await sendTemplate(lead.telefone, template.id, [lead.nome])

      // Salva o texto do template no histórico para contexto do Claude
      await saveMensagem(lead.id, 'out', template.texto(lead.nome), `aiva_d${etapa}`)

      const proxima = PROXIMA_ETAPA[etapa]

      if (!proxima) {
        // D+14 sem resposta → descarta
        await updateLeadStatus(lead.id, 'DESCARTADO', {
          data_proximo_followup: null,
        } as never)
      } else {
        const proximaData = new Date(Date.now() + proxima.diasAte * 24 * 60 * 60 * 1000)
        await supabaseAdmin
          .from('sdr_leads')
          .update({
            status: 'SEM_RESPOSTA',
            etapa_cadencia: proxima.etapa,
            data_proximo_followup: proximaData.toISOString(),
            data_ultimo_contato: new Date().toISOString(),
          })
          .eq('id', lead.id)
      }

      // CRM: move para "Sem resposta"
      if (lead.evotalks_opportunity_id) {
        try {
          const oppId = Number(lead.evotalks_opportunity_id)
          await changeOpportunityStage(oppId, STAGES.SEM_RESPOSTA)
          await addOpportunityNote(oppId, `Follow-up D+${etapa} enviado via HSM template #${template.id}.`)
        } catch (err) {
          console.error(`Erro ao atualizar CRM para lead ${lead.id}:`, err)
        }
      }

      console.log(`Follow-up D+${etapa} enviado para ${lead.nome} (${lead.telefone}) — template #${template.id}`)
      sucesso++
    } catch (err) {
      console.error(`Erro no follow-up do lead ${lead.id}:`, err)
      falha++
    }
  }

  return NextResponse.json({ ok: true, processados: leads.length, sucesso, falha })
}
