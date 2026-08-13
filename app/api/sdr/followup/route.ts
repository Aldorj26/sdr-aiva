import { NextRequest, NextResponse } from 'next/server'
import { getLeadsForFollowup, updateLeadStatus, saveMensagem, supabaseAdmin } from '@/lib/supabase'
import { sendTemplate, changeOpportunityStage, addOpportunityNote, STAGES, checkUserExists } from '@/lib/evotalks'
import { isDiaUtil, rotuloHorario } from '@/lib/business-time'

// Templates HSM aprovados pela Meta (Evo Talks)
// IDs dos templates HSM de follow-up. Atualizados 2026-05-15: número WhatsApp
// trocado → templates re-aprovados pela Meta com IDs novos.
// D+3: 12→35 | D+7: 11→38 | D+14: 10→39
const TEMPLATES: Record<number, { id: number; texto: (nome: string) => string }> = {
  3: {
    id: 35,
    texto: (nome) =>
      `Olá, ${nome}. Passando para informar que a AIVA já atende mais de 2.000 lojas no Brasil com financiamento rápido e zero risco de inadimplência. A ativação é gratuita. Quer entender como funciona pra sua loja? Só entrar em contato por aqui.`,
  },
  7: {
    id: 38,
    texto: (nome) =>
      `Oi ${nome}. Passando para informar que as lojas que usam a AIVA vendem mais porque atendem clientes que não têm cartão ou limite. Taxa de 12%, você recebe em 2 dias. Faz sentido conversarmos? Aguardamos o seu retorno.`,
  },
  14: {
    id: 39,
    texto: (nome) =>
      `Oi ${nome}, última mensagem pra não te incomodar. Se um dia quiser oferecer financiamento de celulares com 12% e zero inadimplência, é só me chamar. Estamos à disposição.`,
  },
}

const PROXIMA_ETAPA: Record<number, { etapa: number; diasAte: number } | null> = {
  3: { etapa: 7, diasAte: 4 },   // D+3 → próximo em D+7
  7: { etapa: 14, diasAte: 7 },  // D+7 → próximo em D+14
  14: null,                       // D+14 → descarta
}

// Teto de envios por execução. A cadência ficou parada de 21/07 a 10/08 (o cron
// respondia 405 — ver GET abaixo), então acumulou ~2.000 leads com follow-up
// vencido. Sem teto, a primeira rodada tentaria mandar tudo de uma vez: estouraria
// o tempo da função no meio (estado indefinido) e jogaria 2.000 HSM no WhatsApp
// num único minuto — risco de qualidade do número na Meta. Com 150/dia (a meta
// diária da operação) a fila drena em ~2 semanas. Override: ?max=N.
const MAX_POR_RODADA = 150

// A função morre em 300s. Medido em 10/08/2026 na primeira rodada real: 3,9s por
// lead (são ~6 chamadas ao Evo por envio), ou seja 150 leads pediriam ~580s. O lote
// foi cortado no meio aos 77 envios, sem resposta e sem log de quantos faltaram.
// Com esta parada por tempo o lote encerra sozinho antes do limite, devolve o
// balanço e o resto fica pra próxima rodada.
export const maxDuration = 300
const CORTE_TEMPO_MS = 240_000

// O Vercel Cron dispara GET. Sem este handler a rota respondia 405 e a cadência
// D+3/D+7/D+14 NUNCA rodava pelo cron — bug encontrado em 10/08/2026: 2.084 leads
// presos em INICIO só com o disparo inicial, D+7 e D+14 com ZERO envios na história.
// Mesmo defeito que já tinha sido corrigido no sync-from-evo.
export async function GET(req: NextRequest) {
  return POST(req)
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  // CRON_SECRET: é o que o Vercel Cron manda no Authorization. Só WEBHOOK_SECRET
  // não bastava — mesmo com o GET, o cron levaria 401.
  if (
    auth !== `Bearer ${process.env.WEBHOOK_SECRET}` &&
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Skip silencioso em fim de semana — cron agendado vai rodar mas não dispara
  // HSM de follow-up. Agendamentos pendentes ficam pra próxima segunda.
  if (!isDiaUtil()) {
    console.log(`[followup] skip: ${rotuloHorario()} (fim de semana)`)
    return NextResponse.json({ ok: true, ignorado: 'fim_de_semana', quando: rotuloHorario() })
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === 'true'
  const max = Math.max(1, Number(url.searchParams.get('max')) || MAX_POR_RODADA)

  const fila = await getLeadsForFollowup()

  if (!fila.length) {
    return NextResponse.json({ ok: true, processados: 0, mensagem: 'Nenhum lead para follow-up' })
  }

  // Mesma ordem da consulta (ver getLeadsForFollowup): etapa primeiro — D+3 (a leva
  // que veio da etapa Início, sem segundo toque) na frente do D+7 — e, dentro da
  // etapa, o vencido há mais tempo primeiro. Reordenar aqui com outro critério
  // desfaria a prioridade vinda do banco.
  fila.sort((a, b) => {
    if (a.etapa_cadencia !== b.etapa_cadencia) return a.etapa_cadencia - b.etapa_cadencia
    const da = a.data_proximo_followup ? new Date(a.data_proximo_followup).getTime() : 0
    const db = b.data_proximo_followup ? new Date(b.data_proximo_followup).getTime() : 0
    return da - db
  })
  const leads = fila.slice(0, max)
  const restantes = fila.length - leads.length

  if (dry) {
    const porEtapa: Record<number, number> = {}
    for (const l of fila) porEtapa[l.etapa_cadencia] = (porEtapa[l.etapa_cadencia] ?? 0) + 1
    return NextResponse.json({
      ok: true,
      dry: true,
      fila_total: fila.length,
      enviaria_agora: leads.length,
      restariam: restantes,
      por_etapa: porEtapa,
      amostra: leads.slice(0, 5).map((l) => ({
        telefone: l.telefone,
        etapa: `D+${l.etapa_cadencia}`,
        vencido_em: l.data_proximo_followup,
      })),
    })
  }

  let sucesso = 0
  let falha = 0
  let invalidos = 0
  let processados = 0
  let pararPorTempo = false
  const inicio = Date.now()

  for (const lead of leads) {
    // Encerra o lote antes do limite da função (ver CORTE_TEMPO_MS). Sair aqui é
    // seguro: cada lead é enviado E atualizado dentro da mesma volta, então quem
    // não foi processado continua na fila intacto pra próxima rodada.
    if (Date.now() - inicio > CORTE_TEMPO_MS) {
      pararPorTempo = true
      console.warn(`[followup] parando por tempo: ${processados}/${leads.length} processados`)
      break
    }
    processados++

    const etapa = lead.etapa_cadencia
    const template = TEMPLATES[etapa]

    if (!template) {
      console.warn(`Lead ${lead.id} com etapa inválida: ${etapa}`)
      continue
    }

    try {
      // Valida que o numero existe no WhatsApp antes de gastar HSM (fail-open).
      // Se nao existe, marca como NAO_QUALIFICADO e pula — nao gasta HSM em numero invalido.
      try {
        const check = await checkUserExists(lead.telefone)
        if (!check.exists) {
          console.warn(`Followup D+${etapa} pulado: ${lead.telefone} sem WhatsApp`)
          await updateLeadStatus(lead.id, 'NAO_QUALIFICADO', {
            data_proximo_followup: null,
            observacoes: `[NUMERO_SEM_WHATSAPP] detectado em followup D+${etapa}`,
          } as never)
          invalidos++
          continue
        }
      } catch (err) {
        // Fail-open: se o check falhar, segue com disparo (nao bloqueia operacao)
        console.warn(`checkUserExists falhou para ${lead.telefone}:`, err)
      }

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

  const naoProcessados = leads.length - processados
  console.log(
    `[followup] ${sucesso} enviados, ${falha} falhas, ${invalidos} inválidos em ` +
      `${((Date.now() - inicio) / 1000).toFixed(0)}s — ${restantes + naoProcessados} ainda na fila` +
      (pararPorTempo ? ' (lote encerrado por tempo)' : ''),
  )
  return NextResponse.json({
    ok: true,
    processados,
    sucesso,
    falha,
    invalidos,
    parou_por_tempo: pararPorTempo,
    duracao_s: Number(((Date.now() - inicio) / 1000).toFixed(1)),
    fila_total: fila.length,
    restantes: restantes + naoProcessados,
  })
}
