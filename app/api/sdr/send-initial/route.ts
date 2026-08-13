import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, saveMensagem } from '@/lib/supabase'
import { sendTemplate, createOpportunity, linkChatToOpportunity, getOpenChatId, STAGES, checkUserExists, addOpportunityTags, TAG_IDS } from '@/lib/evotalks'
import { isDiaUtil, rotuloHorario } from '@/lib/business-time'

interface LeadInput {
  nome: string
  telefone: string
  cidade?: string
}

// Template HSM "AIVA Dia 1" — disparo inicial D+0.
// Atualizado 2026-05-15: número WhatsApp trocado → templates re-aprovados
// pela Meta com IDs novos (era 9, agora 41).
const HSM_TEMPLATE_ID = 41

// ─── Pré-validação anti-bot / anti-duplicata ──────────────────────────────────
// Telefones com status nesta lista NÃO recebem novo HSM no disparo inicial.
// Evita: (a) queimar HSM em bot já detectado, (b) violar OPT_OUT, (c) duplicar
// lead em cadência ativa.
// Pra forçar disparo em algum desses (raro, manual), passe `force: true` no body.
const STATUS_BLOQUEADOS: Record<string, string> = {
  BOT_DETECTADO: 'já marcado como bot/atendimento automatizado em disparo anterior',
  OPT_OUT: 'lead pediu para não ser contatado',
  NAO_QUALIFICADO: 'lead já descartado por não se encaixar no perfil',
  INTERESSADO: 'conversa ativa em andamento (não interromper)',
  PRE_APROVACAO: 'em pré-aprovação (7 dados coletados)',
  CADASTRO_RECEBIDO: 'já qualificado — humano assumiu',
  EM_ANALISE_AIVA: 'em análise CAF/biometria pela AIVA',
  TREINAR: 'loja em treinamento',
  LOGIN: 'login pendente',
  LOJA_FINALIZADA_E_VENDENDO: 'loja ativa vendendo',
  INICIO: 'já disparado, em cadência ativa',
  SEM_RESPOSTA: 'em cadência de followup (cron cuida)',
  AGUARDANDO: 'lead pediu pra retomar depois (cron de reativação cuida)',
  DESCARTADO: 'já saiu do funil (descartado por inatividade)',
}

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
  const force: boolean = body.force === true

  if (!leads.length) {
    return NextResponse.json({ error: 'Nenhum lead informado' }, { status: 400 })
  }

  const resultados: { telefone: string; ok: boolean; lead_id?: string; erro?: string; info?: string }[] = []
  let sucesso = 0
  let falha = 0
  let invalidos = 0
  let bloqueados = 0

  for (const lead of leads) {
    try {
      // 0a. PRÉ-VALIDAÇÃO BLACKLIST — bloqueia telefones já presentes no funil
      // em status que NÃO deveriam receber novo HSM (bot, opt-out, ativo, etc).
      // Bypass via `force: true` no body.
      if (!force) {
        const { data: existente } = await supabaseAdmin
          .from('sdr_leads')
          .select('id, status, nome')
          .eq('telefone', lead.telefone)
          .maybeSingle()

        if (existente && STATUS_BLOQUEADOS[existente.status]) {
          resultados.push({
            telefone: lead.telefone,
            ok: false,
            erro: `bloqueado_${existente.status.toLowerCase()}`,
            info: STATUS_BLOQUEADOS[existente.status],
          })
          bloqueados++
          continue
        }
      }

      // 0b. Valida que o numero existe no WhatsApp antes de gastar HSM
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
      // NOME: da lista de disparo usamos SÓ o telefone (decisão do Aldo 2026-07-09).
      // O nome da lista costuma estar errado/desalinhado — a VictorIA qualifica o
      // nome_varejo na conversa e o webhook grava esse nome no painel E na opp do Evo.
      // Semeia genérico "Loja" (igual leads inbound) até a qualificação chegar.
      const { data: leadData, error: upsertError } = await supabaseAdmin
        .from('sdr_leads')
        .upsert(
          {
            nome: 'Loja',
            telefone: lead.telefone,
            cidade: lead.cidade ?? null,
            produto: 'AIVA',
            status: 'INICIO',
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
          // Título placeholder até a VictorIA qualificar o nome_varejo (que substitui
          // isso via updateOpportunityTitle no webhook). Cidade ajuda a distinguir no funil.
          title: `Loja${lead.cidade ? ' - ' + lead.cidade : ''} — AIVA`,
          number: lead.telefone,
          city: lead.cidade,
          stageId: STAGES.INICIO,
        })
        await supabaseAdmin
          .from('sdr_leads')
          .update({ evotalks_opportunity_id: String(oppId) })
          .eq('id', leadId)
        // Etiqueta AIVA já na criação — 1.239 opps ficaram sem tag por falta
        // disso (backfill 2026-08-03). Best-effort: falha não trava o disparo.
        try {
          await addOpportunityTags(oppId, [TAG_IDS.AIVA])
        } catch (tagErr) {
          console.error(`CRM: falha ao etiquetar opp #${oppId}:`, tagErr)
        }
        console.log(`CRM: Oportunidade #${oppId} criada em "Início" para ${lead.telefone}`)
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
      // O sendWaTemplate abre o chat (openNewChat=true) e devolve chatId/clientId.
      // ANTES esse retorno era DESCARTADO: o lead ficava com evotalks_chat_id null
      // até responder, e a opp nunca era amarrada ao chat (aba Atendimento vazia).
      // Agora persistimos os ids e pedimos o vínculo explícito no CRM.
      const tpl = await sendTemplate(lead.telefone, HSM_TEMPLATE_ID, vars)
      // O retorno do sendWaTemplate nem sempre traz o chatId (só ~27% no lote
      // de 29/07). Fallback: busca o chat aberto pelo número — o template
      // acabou de abrir um, então quase sempre acha.
      if (!tpl.chatId) {
        try {
          const chatAberto = await getOpenChatId(lead.telefone)
          if (chatAberto) tpl.chatId = chatAberto
        } catch { /* best-effort */ }
      }
      if (tpl.chatId || tpl.clientId) {
        try {
          const upd: Record<string, unknown> = {}
          if (tpl.chatId) upd.evotalks_chat_id = String(tpl.chatId)
          if (tpl.clientId) upd.evotalks_client_id = String(tpl.clientId)
          await supabaseAdmin.from('sdr_leads').update(upd).eq('id', leadId)
        } catch (err) {
          console.error(`Erro ao salvar chatId/clientId de ${lead.telefone}:`, err)
        }
      }
      if (oppId && tpl.chatId) {
        try {
          await linkChatToOpportunity(oppId, Number(tpl.chatId))
        } catch (err) {
          console.error(`Erro ao vincular chat #${tpl.chatId} à opp #${oppId}:`, err)
        }
      }

      // 4. Salva mensagem no histórico
      const mensagemTemplate = `[Template AIVA enviado para ${lead.telefone}]`
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

  return NextResponse.json({
    ok: true,
    total: leads.length,
    sucesso,
    falha,
    invalidos,
    bloqueados,
    resultados,
  })
}
