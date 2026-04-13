import { NextRequest, NextResponse } from 'next/server'
import {
  getLeadByTelefone,
  getLeadByChatId,
  updateLeadStatus,
  saveMensagem,
  getMensagens,
  acquireWebhookLock,
  releaseWebhookLock,
  mensagemMidExiste,
  supabaseAdmin,
  type LeadStatus,
  type Mensagem,
} from '@/lib/supabase'
import {
  sendText, alertHuman, downloadAudio,
  createOpportunity, changeOpportunityStage, addOpportunityNote, addOpportunityTags, STAGES, TAG_IDS,
  updateOpportunityForms, updateOpportunityTitle, linkChatToOpportunity,
  getOpportunity, sendToGoogleSheets, sendToHubSpot,
} from '@/lib/evotalks'
import type { DadosColetados } from '@/lib/claude'
import { processarMensagem, transcreverAudio } from '@/lib/claude'

// Status que bloqueiam processamento
const STATUS_IGNORAR: LeadStatus[] = ['OPT_OUT', 'NAO_QUALIFICADO', 'DESCARTADO']

/**
 * Remove mensagens 'in' consecutivas com conteúdo idêntico.
 * Corrige rajadas onde o lead manda a mesma pergunta 3-4 vezes em segundos,
 * que antes confundiam a VictorIA e travavam o processamento.
 */
function dedupConsecutiveIn(msgs: Mensagem[]): Mensagem[] {
  const result: Mensagem[] = []
  for (const curr of msgs) {
    const prev = result[result.length - 1]
    if (
      curr.direcao === 'in' &&
      prev &&
      prev.direcao === 'in' &&
      curr.conteudo.trim() === prev.conteudo.trim()
    ) {
      continue
    }
    result.push(curr)
  }
  return result
}

export async function POST(req: NextRequest) {
  // 1. Valida autenticação
  const secret = req.headers.get('x-internal-secret') ?? ''
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const payload = await req.json()

  // DEBUG: Log payload completo para mapear formato do Evo Talks
  console.log('WEBHOOK PAYLOAD:', JSON.stringify(payload).substring(0, 2000))

  // 2. Extrai dados do payload Evo Talks (msgreceivedhook)
  // O payload pode vir em diferentes formatos dependendo da configuração do hook
  const message = payload.message ?? payload.data?.message ?? payload
  const direction = message.direction ?? payload.direction ?? 'in'
  const text: string = message.text ?? message.conversation ?? ''
  const chatId: string = String(message.chatId ?? payload.chatId ?? '')
  const clientId: string = String(message.clientId ?? payload.clientId ?? '')
  const queueId: number = Number(message.queueId ?? payload.queueId ?? 0)
  // mId = WhatsApp messageid (wamid.HBg...) — único por mensagem real do lead.
  // Usado pra idempotência: se Evo Talks reentregar o mesmo webhook, ignoramos.
  const mId: string = String(message.mId ?? payload.mId ?? '')

  // Extrai dados de áudio/arquivo (se houver)
  // fileId pode vir em diferentes lugares dependendo do formato do payload
  const fileId: number | null =
    message.fileId ?? message.fk_file ?? message.file?.fileId ?? message.file?.fkFile ??
    payload.message?.fileId ?? payload.message?.fk_file ?? payload.message?.file?.fkFile ??
    payload.fileId ?? payload.fk_file ?? payload.file?.fkFile ?? null
  const mimeType: string =
    message.mimeType ?? message.file_mimetype ?? message.file?.mimeType ??
    payload.message?.mimeType ?? payload.message?.file_mimetype ??
    payload.mimeType ?? ''
  const isAudio = fileId && fileId > 0 && (
    mimeType.startsWith('audio/') ||
    mimeType === 'application/ogg' ||
    mimeType.includes('opus')
  )

  // Também suporta formato antigo (Evo Talks v1 - remoteJid)
  const remoteJid: string = payload?.data?.key?.remoteJid ?? ''
  const fromMe: boolean = payload?.data?.key?.fromMe ?? false
  const legacyText: string = payload?.data?.message?.conversation ?? ''
  // Áudio no formato legado (v1)
  const legacyAudio = payload?.data?.message?.audioMessage ?? null

  console.log(`Webhook: text="${text.substring(0,30)}" fileId=${fileId} mimeType="${mimeType}" isAudio=${isAudio}`)

  // 3. Ignora mensagens enviadas pelo próprio sistema ou sem conteúdo
  if (fromMe || direction === 'out') {
    return NextResponse.json({ ok: true, ignorado: 'fromMe' })
  }

  // 4. Processa áudio se houver
  let conteudo = text || legacyText
  if (!conteudo.trim() && (isAudio || legacyAudio)) {
    try {
      console.log(`Áudio recebido — fileId: ${fileId}, mimeType: ${mimeType}`)
      if (fileId) {
        const audio = await downloadAudio(fileId)
        conteudo = await transcreverAudio(audio.buffer, audio.mimeType)
        console.log(`Áudio transcrito: "${conteudo.substring(0, 100)}"`)
      }
    } catch (err) {
      console.error('Erro ao transcrever áudio:', err)
      conteudo = '' // Não conseguiu transcrever
    }
  }

  if (!conteudo.trim()) {
    return NextResponse.json({ ok: true, ignorado: 'sem_conteudo' })
  }

  // 4. Busca o lead — tenta por chatId, telefone do remoteJid, ou clientId
  let lead = chatId ? await getLeadByChatId(chatId) : null

  if (!lead && remoteJid) {
    const telefone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '')
    lead = await getLeadByTelefone(telefone)
  }

  // Tenta pelo clientId (formato Evo Talks: 554796085000 → 5547996085000)
  if (!lead && clientId) {
    lead = await getLeadByTelefone(clientId)
    // Tenta com 55 na frente se não encontrar
    if (!lead && !clientId.startsWith('55')) {
      lead = await getLeadByTelefone('55' + clientId)
    }
    // Tenta formato com 9 extra (celular BR)
    if (!lead) {
      const ddd = clientId.startsWith('55') ? clientId.slice(2, 4) : clientId.slice(0, 2)
      const num = clientId.startsWith('55') ? clientId.slice(4) : clientId.slice(2)
      if (num.length === 8) {
        lead = await getLeadByTelefone('55' + ddd + '9' + num)
      }
    }
  }

  // Tenta pelo userExtId (número sem DDI)
  const userExtId: string = payload.userExtId ?? message.userExtId ?? ''
  if (!lead && userExtId) {
    lead = await getLeadByTelefone('55' + userExtId)
  }

  if (!lead) {
    console.log(`Lead não encontrado: chatId=${chatId}, clientId=${clientId}, remoteJid=${remoteJid}, userExtId=${userExtId}`)
    return NextResponse.json({ ok: true, ignorado: 'lead_nao_encontrado' })
  }

  // 5. Ignora leads em status final
  if (STATUS_IGNORAR.includes(lead.status)) {
    return NextResponse.json({ ok: true, ignorado: `status_${lead.status}` })
  }

  // 5b. Pausa temporária manual via flag nas observações
  // Formato: [PAUSA_ATE:2026-04-13T17:00:00Z] — se now < data, ignora a mensagem
  if (lead.observacoes) {
    const m = lead.observacoes.match(/\[PAUSA_ATE:([^\]]+)\]/)
    if (m) {
      const ate = new Date(m[1])
      if (!Number.isNaN(ate.getTime()) && new Date() < ate) {
        console.log(`Lead ${lead.telefone} em pausa temporária até ${ate.toISOString()}`)
        return NextResponse.json({ ok: true, ignorado: 'pausa_temporaria', ate: ate.toISOString() })
      }
    }
  }

  // 6. Lead com formulário enviado — avisa Nei e encerra
  if (lead.status === 'FORMULARIO_ENVIADO') {
    const alerta =
      `⚠️ *${lead.nome}* (${lead.telefone}) respondeu após qualificação completa.\n` +
      `Mensagem: "${conteudo}"\n\nAcompanhe no Evo Talks.`
    await alertHuman(process.env.NEI_WHATSAPP!, alerta)
    return NextResponse.json({ ok: true, ignorado: 'formulario_ja_enviado' })
  }

  // 7. Idempotência — se o mesmo mId (messageid do WhatsApp) já foi salvo,
  // é retry do Evo Talks de um webhook que já processamos. Ignoramos.
  if (mId && (await mensagemMidExiste(mId))) {
    console.log(`Lead ${lead.telefone}: mId ${mId} já processado, ignorando retry`)
    return NextResponse.json({ ok: true, ignorado: 'mid_duplicado' })
  }

  // Salva mensagem recebida imediatamente (antes do lock), já com o mId
  // pra travar futuros retries via índice UNIQUE.
  await saveMensagem(lead.id, 'in', conteudo, undefined, mId || null)

  // 7b. Tenta adquirir lock de processamento exclusivo deste lead
  // Evita que 4 webhooks paralelos (rajada) rodem Claude simultaneamente e se atropelem.
  const gotLock = await acquireWebhookLock(lead.id, 60)
  if (!gotLock) {
    console.log(`Lead ${lead.telefone}: lock ocupado, mensagem acumulada`)
    return NextResponse.json({ ok: true, ignorado: 'lock_ocupado_msg_salva' })
  }

  // Daqui em diante, qualquer return precisa liberar o lock via finally.
  let respostaFinal: { novo_status: string } | null = null
  try {
    // 7c. Debounce — espera 2s pra capturar qualquer mensagem adicional da rajada
    // (usuário frequentemente envia a mesma pergunta 3-4 vezes em ~15s)
    await new Promise((r) => setTimeout(r, 2000))

    // Loop de reprocessamento: se novas mensagens 'in' chegarem durante o
    // processamento (após o debounce), roda outra volta pra não deixar órfãs.
    let iteracao = 0
    const MAX_ITERACOES = 3
    while (iteracao < MAX_ITERACOES) {
      iteracao++
      const loopStart = new Date().toISOString()

    // 8. Busca histórico (inclui as msgs que chegaram durante o debounce)
    // e deduplica rajadas de 'in' consecutivas idênticas
    const historicoRaw = await getMensagens(lead.id, 20)
    const historico = dedupConsecutiveIn(historicoRaw)

    // Usa a última mensagem 'in' como conteúdo efetivo (pode ser diferente da que
    // chegou neste request se o burst trouxe algo mais recente)
    const ultimaInNoHistorico = [...historico].reverse().find((m) => m.direcao === 'in')
    const conteudoEfetivo = ultimaInNoHistorico?.conteudo ?? conteudo

    // 9. Processa com Claude (VictorIA)
    let resposta
    try {
      resposta = await processarMensagem(conteudoEfetivo, historico, lead.nome)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errStack = err instanceof Error ? err.stack : undefined
      console.error('Erro ao processar com Claude:', errMsg, errStack)
      // Fallback: aciona humano
      await alertHuman(
        process.env.NEI_WHATSAPP!,
        `🚨 Erro ao processar mensagem de *${lead.nome}* (${lead.telefone}).\nMensagem: "${conteudoEfetivo}"`
      )
      return NextResponse.json({ ok: false, erro: 'claude_error', detail: errMsg }, { status: 500 })
    }

  // 10. Envia resposta ao lead
  const telefoneParaEnvio = lead.telefone
  try {
    await sendText(telefoneParaEnvio, resposta.mensagem)
  } catch (err) {
    console.error('Erro ao enviar mensagem via Evo Talks:', err)
  }

  // 11. Salva resposta no histórico
  await saveMensagem(lead.id, 'out', resposta.mensagem)

  // 12. Atualiza status e chatId se ainda não tiver
  const updates: Record<string, unknown> = {
    status: resposta.novo_status,
    data_ultimo_contato: new Date().toISOString(),
    acionar_humano: resposta.acionar_humano,
  }

  if (chatId && !lead.evotalks_chat_id) {
    updates.evotalks_chat_id = chatId
  }
  if (clientId && !lead.evotalks_client_id) {
    updates.evotalks_client_id = clientId
  }
  if (resposta.motivo_humano) {
    updates.observacoes = resposta.motivo_humano
  }

  await supabaseAdmin.from('sdr_leads').update(updates).eq('id', lead.id)

  // 12b. Atualiza nome do lead se nome_varejo foi coletado e nome atual é genérico
  const nomeVarejo = resposta.dados_coletados?.nome_varejo as string | null | undefined
  if (nomeVarejo && (lead.nome === 'Loja' || lead.nome === 'Lead')) {
    await supabaseAdmin.from('sdr_leads').update({ nome: nomeVarejo }).eq('id', lead.id)
    lead.nome = nomeVarejo
    console.log(`Lead ${lead.id}: nome atualizado para "${nomeVarejo}"`)
  }

  // 13. CRM — Criar oportunidade, mover etapa e preencher formulário
  let oppId: number | null = lead.evotalks_opportunity_id ? Number(lead.evotalks_opportunity_id) : null
  try {
    if (!oppId && (resposta.novo_status === 'INTERESSADO' || resposta.novo_status === 'FORMULARIO_ENVIADO')) {
      // Sem oportunidade ainda — cria no pipeline AIVA (etapa Interessado)
      oppId = await createOpportunity({
        title: `${lead.nome} — AIVA`,
        number: lead.telefone,
        city: lead.cidade ?? undefined,
        chatId: chatId || lead.evotalks_chat_id || undefined,
        clientId: clientId || lead.evotalks_client_id || undefined,
      })
      await supabaseAdmin
        .from('sdr_leads')
        .update({ evotalks_opportunity_id: String(oppId) })
        .eq('id', lead.id)
      console.log(`CRM: Oportunidade #${oppId} criada para ${lead.nome}`)

      // Aplica tag AIVA em toda nova oportunidade criada
      try {
        await addOpportunityTags(oppId, [TAG_IDS.AIVA])
      } catch (err) {
        console.log(`CRM: Erro ao adicionar tag AIVA na oportunidade #${oppId}:`, err)
      }
    }

    // Move de "Início" para "Interessado" quando lead responde
    if (oppId && resposta.novo_status === 'INTERESSADO') {
      try {
        await changeOpportunityStage(oppId, STAGES.INTERESSADO)
        console.log(`CRM: Oportunidade #${oppId} → Interessado`)
      } catch (err) {
        console.log(`CRM: Erro ao mover para Interessado #${oppId}:`, err)
      }
    }

    if (oppId) {
      // Vincula chat à oportunidade se ainda não tem (corrige oportunidades antigas)
      if (chatId) {
        try {
          await linkChatToOpportunity(oppId, Number(chatId))
        } catch (err) {
          console.log(`CRM: Não foi possível vincular chat à oportunidade #${oppId}:`, err)
        }
      }

      // Atualiza título da oportunidade se nome_varejo foi coletado agora
      if (nomeVarejo) {
        await updateOpportunityTitle(oppId, `${nomeVarejo} — AIVA`)
      }

      // Preenche dados coletados no formulário do CRM
      if (resposta.dados_coletados) {
        await updateOpportunityForms(oppId, resposta.dados_coletados as Record<string, string | null | undefined>, lead.telefone)
      }

      // Detecta 3+ lojas e aplica tag "Importante" (mantém AIVA)
      const numLojasRaw = resposta.dados_coletados?.numero_lojas
      if (numLojasRaw) {
        const num = Number(String(numLojasRaw).replace(/\D/g, ''))
        if (!Number.isNaN(num) && num >= 3) {
          try {
            await addOpportunityTags(oppId, [TAG_IDS.AIVA, TAG_IDS.IMPORTANTE])
            await supabaseAdmin.from('sdr_leads').update({ importante: true }).eq('id', lead.id)
            console.log(`CRM: Tag "Importante" aplicada na oportunidade #${oppId} (${num} lojas)`)
          } catch (err) {
            console.log(`CRM: Erro ao adicionar tag Importante na oportunidade #${oppId}:`, err)
          }
        }
      }

      if (resposta.novo_status === 'FORMULARIO_ENVIADO') {
        await changeOpportunityStage(oppId, STAGES.PRE_APROVACAO)
        await addOpportunityNote(oppId, `Dados de qualificação coletados pela VictorIA via WhatsApp.`)
        console.log(`CRM: Oportunidade #${oppId} → Pré Aprovação`)

        // Envia dados completos para planilha Google Sheets
        const opp = await getOpportunity(oppId)
        const forms = (opp.formsdata ?? {}) as Record<string, string | null>
        // Envia para HubSpot (UME/AIVA)
        const sheetsData = {
          nome_socio: forms['da6ddf70'],
          email_socio: forms['dafa40f0'],
          telefone: forms['db8569f0'],
          nome_varejo: forms['dcacfa00'],
          cnpj_matriz: forms['dd2ab580'],
          faturamento_anual: forms['ddb960f0'],
          valor_boleto_mensal: forms['de2cbc30'],
          regiao_varejo: forms['dede58f0'],
          numero_lojas: forms['df6f9c70'],
          localizacao_lojas: forms['e0099280'],
          possui_outra_financeira: forms['e07d62f0'],
          cnpjs_adicionais: forms['e0f66380'],
          status: 'PRE_APROVACAO',
          opportunity_id: String(oppId),
        }
        await sendToGoogleSheets(sheetsData)
      } else if (resposta.novo_status === 'NAO_QUALIFICADO') {
        await addOpportunityNote(oppId, `Lead não qualificado: ${resposta.motivo_humano ?? 'sem perfil'}`)
      }
    }
  } catch (err) {
    console.error('Erro ao atualizar CRM:', err)
  }

  // 14. Alertas para humanos
  if (resposta.novo_status === 'FORMULARIO_ENVIADO') {
    const msg =
      `✅ *${lead.nome}* (${lead.telefone} — ${lead.cidade ?? 'cidade n/d'}) qualificado! Dados coletados pela VictorIA.\n` +
      `Acompanhe no Evo Talks.`
    await alertHuman(process.env.NEI_WHATSAPP!, msg)
    await alertHuman(process.env.ALDO_WHATSAPP!, msg)
  } else if (resposta.acionar_humano) {
    const msg =
      `🔔 *${lead.nome}* (${lead.telefone}) precisa de atendimento humano.\n` +
      `Motivo: ${resposta.motivo_humano ?? 'não especificado'}\n` +
      `Última mensagem: "${conteudo}"`
    await alertHuman(process.env.NEI_WHATSAPP!, msg)
  }

      respostaFinal = resposta

      // Checa se novas mensagens 'in' chegaram durante o processamento desta volta
      const { data: orfas } = await supabaseAdmin
        .from('sdr_mensagens')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('direcao', 'in')
        .gt('enviado_em', loopStart)
        .limit(1)

      if (!orfas || orfas.length === 0) break
      console.log(`Lead ${lead.telefone}: reprocessando (iteração ${iteracao + 1}) — mensagem órfã detectada`)
    }

    return NextResponse.json({ ok: true, status: respostaFinal?.novo_status ?? 'unknown' })
  } finally {
    await releaseWebhookLock(lead.id)
  }
}
