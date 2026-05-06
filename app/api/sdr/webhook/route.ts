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
  type Lead,
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
import { processarMensagem, transcreverAudio, FALLBACK_MENSAGEM_OVERLOADED } from '@/lib/claude'
import { isAdmin, isCommand, handleCommand, respondToAdmin } from '@/lib/admin-commands'

// Status que bloqueiam processamento (silenciosamente — sem alerta).
// Lead chegou no fim do funil (terminal positivo OU descartado/bot/opt-out).
const STATUS_IGNORAR: LeadStatus[] = ['OPT_OUT', 'NAO_QUALIFICADO', 'DESCARTADO', 'BOT_DETECTADO']

// Status terminais positivos que disparam ALERTA pro Nei e encerram.
// FORMULARIO_ENVIADO é legacy (fluxo antigo). CADASTRO_COMPLETO é o atual.
// Lead respondeu depois de já ter completado cadastro — humano precisa intervir.
const STATUS_ALERTA_E_ENCERRA: LeadStatus[] = ['FORMULARIO_ENVIADO', 'CADASTRO_COMPLETO']

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

/**
 * Remove mensagens 'out' que são apenas marcadores internos (ex: "[Template X
 * enviado — Fulano]"). Esses logs poluem o histórico passado pra VictorIA e
 * confundem a fase — ela pode interpretar como uma mensagem dela mesma e ficar
 * ambígua sobre o estado da conversa. Só mensagens conversacionais reais devem
 * chegar no Claude.
 */
function stripInternalMarkers(msgs: Mensagem[]): Mensagem[] {
  return msgs.filter((m) => {
    if (m.direcao !== 'out') return true
    return !/^\[.*\]$/.test(m.conteudo.trim())
  })
}

/**
 * Extrai dados acumulados do campo observacoes do lead.
 * Formato armazenado: [DADOS_COLETADOS:chave=valor|chave2=valor2]
 * Retorna objeto vazio se não houver dados.
 */
function parseDadosAcumulados(obs: string | null): Record<string, string> {
  if (!obs) return {}
  const match = obs.match(/\[DADOS_COLETADOS:([^\]]+)\]/)
  if (!match) return {}
  const result: Record<string, string> = {}
  for (const pair of match[1].split('|')) {
    const eqIdx = pair.indexOf('=')
    if (eqIdx > 0) {
      const key = pair.slice(0, eqIdx).trim()
      const val = pair.slice(eqIdx + 1).trim()
      if (key && val && val !== 'null') result[key] = val
    }
  }
  return result
}

/**
 * Serializa dados coletados para a flag [DADOS_COLETADOS:...] em observacoes.
 * Ignora valores null/undefined/vazios.
 */
function serializeDadosAcumulados(dados: Record<string, string>): string | null {
  const pairs = Object.entries(dados)
    .filter(([, v]) => v && v !== 'null' && v !== 'undefined')
    .map(([k, v]) => `${k}=${v}`)
  if (pairs.length === 0) return null
  return `[DADOS_COLETADOS:${pairs.join('|')}]`
}

export async function POST(req: NextRequest) {
  // 1. Valida autenticação
  const secret = req.headers.get('x-internal-secret') ?? ''
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Parse JSON com guarda — payload malformado nunca passa pra logica abaixo.
  let payload: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'payload deve ser objeto JSON' }, { status: 400 })
    }
    payload = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  // DEBUG: Log payload completo para mapear formato do Evo Talks
  console.log('WEBHOOK PAYLOAD:', JSON.stringify(payload).substring(0, 2000))

  // Helpers seguros pra extrair campos de objetos aninhados sem crashar
  // quando algum nivel é null/undefined ou tipo errado.
  const asObj = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
  const asNum = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : 0
  }
  const asBool = (v: unknown): boolean => v === true || v === 'true'

  // 2. Extrai dados do payload Evo Talks (msgreceivedhook)
  // O payload pode vir em diferentes formatos dependendo da configuração do hook
  const payloadMessageObj = asObj(payload.message)
  const payloadDataObj = asObj(payload.data)
  const dataMessageObj = payloadDataObj ? asObj(payloadDataObj.message) : null
  const message = payloadMessageObj ?? dataMessageObj ?? payload
  const direction = asStr((message as Record<string, unknown>).direction ?? payload.direction ?? 'in')
  const text: string = asStr((message as Record<string, unknown>).text ?? (message as Record<string, unknown>).conversation ?? '')
  const chatId: string = asStr((message as Record<string, unknown>).chatId ?? payload.chatId ?? '')
  const clientId: string = asStr((message as Record<string, unknown>).clientId ?? payload.clientId ?? '')
  const queueId: number = asNum((message as Record<string, unknown>).queueId ?? payload.queueId ?? 0)
  // mId = WhatsApp messageid (wamid.HBg...) — único por mensagem real do lead.
  // Usado pra idempotência: se Evo Talks reentregar o mesmo webhook, ignoramos.
  const mId: string = asStr((message as Record<string, unknown>).mId ?? payload.mId ?? '')

  // Extrai dados de áudio/arquivo (se houver)
  // fileId pode vir em diferentes lugares dependendo do formato do payload
  const messageObj = message as Record<string, unknown>
  const messageFileObj = asObj(messageObj.file)
  const payloadMessageFileObj = payloadMessageObj ? asObj(payloadMessageObj.file) : null
  const payloadFileObj = asObj(payload.file)

  const fileIdRaw =
    messageObj.fileId ?? messageObj.fk_file ?? messageFileObj?.fileId ?? messageFileObj?.fkFile ??
    payloadMessageObj?.fileId ?? payloadMessageObj?.fk_file ?? payloadMessageFileObj?.fkFile ??
    payload.fileId ?? payload.fk_file ?? payloadFileObj?.fkFile ?? null
  const fileId: number | null = fileIdRaw == null ? null : asNum(fileIdRaw) || null

  const mimeType: string = asStr(
    messageObj.mimeType ?? messageObj.file_mimetype ?? messageFileObj?.mimeType ??
    payloadMessageObj?.mimeType ?? payloadMessageObj?.file_mimetype ??
    payload.mimeType ?? '',
  )
  const isAudio = !!fileId && fileId > 0 && (
    mimeType.startsWith('audio/') ||
    mimeType === 'application/ogg' ||
    mimeType.includes('opus')
  )

  // Também suporta formato antigo (Evo Talks v1 - remoteJid)
  const dataKeyObj = payloadDataObj ? asObj(payloadDataObj.key) : null
  const remoteJid: string = asStr(dataKeyObj?.remoteJid ?? '')
  const fromMe: boolean = asBool(dataKeyObj?.fromMe ?? false)
  const legacyText: string = asStr(dataMessageObj?.conversation ?? '')
  // Áudio no formato legado (v1)
  const legacyAudio = dataMessageObj?.audioMessage ?? null

  console.log(`Webhook: text="${text.substring(0,30)}" fileId=${fileId} mimeType="${mimeType}" isAudio=${isAudio}`)

  // 3. Mensagens com fromMe=true são saídas do nosso WhatsApp.
  //    Podem ser:
  //    a) Eco da própria VictorIA (Evo Talks às vezes devolve nossa msg como webhook)
  //    b) Resposta MANUAL do Nei via painel Evo Talks ou WhatsApp Business
  //
  //    Caso (b) é importante: se a gente ignora silenciosamente, a VictorIA
  //    perde contexto na próxima vez que o lead responder e fica perdida
  //    (responde como se o Nei não tivesse falado nada).
  //
  //    Estratégia: salva como direcao='out' com template_hsm='manual_humano'
  //    SE for diferente da última msg 'out' nos últimos 30s (dedup do eco).
  if (fromMe || direction === 'out') {
    const textoOut = (text || legacyText).trim()
    if (textoOut) {
      try {
        const phone = remoteJid?.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '') ?? ''
        if (phone) {
          const { data: lead } = await supabaseAdmin
            .from('sdr_leads')
            .select('id, telefone')
            .eq('telefone', phone)
            .maybeSingle()
          if (lead?.id) {
            const { data: ultimaOut } = await supabaseAdmin
              .from('sdr_mensagens')
              .select('conteudo, enviado_em')
              .eq('lead_id', lead.id)
              .eq('direcao', 'out')
              .order('enviado_em', { ascending: false })
              .limit(1)
              .maybeSingle()
            const ehEcoRecente =
              ultimaOut &&
              ultimaOut.conteudo?.trim() === textoOut &&
              Date.now() - new Date(ultimaOut.enviado_em).getTime() < 30_000
            if (ehEcoRecente) {
              console.log(`Webhook fromMe: eco de msg própria pra ${phone}, pulando dedup`)
            } else {
              await supabaseAdmin.from('sdr_mensagens').insert({
                lead_id: lead.id,
                direcao: 'out',
                conteudo: textoOut,
                template_hsm: 'manual_humano',
              })
              console.log(`Webhook fromMe: msg manual humana salva pra ${phone} — VictorIA terá contexto na próxima resposta`)
            }
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error('Falha ao salvar msg manual humana (fromMe):', errMsg)
      }
    }
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

  // ─── Admin bot: intercepta comandos de números admin ───────────────────────
  const adminTelefone = remoteJid
    ? remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '')
    : clientId.startsWith('55') ? clientId : `55${clientId}`

  if (isAdmin(adminTelefone) && isCommand(conteudo)) {
    console.log(`Admin command from ${adminTelefone}: ${conteudo}`)
    const response = await handleCommand(adminTelefone, conteudo)
    await respondToAdmin(adminTelefone, response)
    return NextResponse.json({ ok: true, admin: true, comando: conteudo.split(/\s+/)[0] })
  }

  // Admin mandando mensagem comum (não comando) — apenas reabre a janela 24h
  // pro alertHuman funcionar. Responde algo simples e não cria lead.
  if (isAdmin(adminTelefone)) {
    console.log(`Admin ${adminTelefone} mandou mensagem comum: ${conteudo.slice(0, 50)}`)
    try {
      await respondToAdmin(
        adminTelefone,
        'Oi! Sou o agente SDR da Track. Janela 24h reaberta — vou conseguir te enviar alertas de novos leads por aqui. Use /ajuda pra ver os comandos.'
      )
    } catch (err) {
      console.error(`Falha ao responder admin ${adminTelefone}:`, err)
    }
    return NextResponse.json({ ok: true, admin: true, ignorado: 'admin_msg_comum' })
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
  const userExtId: string = asStr(payload.userExtId ?? messageObj.userExtId ?? '')
  if (!lead && userExtId) {
    lead = await getLeadByTelefone('55' + userExtId)
  }

  if (!lead) {
    // Lead desconhecido mandou mensagem → cria automaticamente e processa.
    // Isso captura leads orgânicos (indicação, busca, etc.) que mandam msg
    // pro número do WhatsApp direto, sem ter passado por uma campanha.
    const telNormalizado =
      remoteJid?.replace('@s.whatsapp.net', '').replace('@c.us', '') ||
      (clientId?.startsWith('55') ? clientId : `55${clientId}`) ||
      `55${userExtId}`

    if (!telNormalizado || telNormalizado.length < 12) {
      console.log(`Lead desconhecido com telefone inválido: ${telNormalizado}`)
      return NextResponse.json({ ok: true, ignorado: 'telefone_invalido' })
    }

    console.log(`Lead desconhecido ${telNormalizado} — criando como TRIAGEM (inbound puro)`)

    // Lead totalmente novo (não existe em nenhum produto) → TRIAGEM.
    // VictorIA usa prompt de triagem pra identificar produto desejado e
    // tirar dúvidas básicas. Aldo + Nei recebem alerta WhatsApp pra fazer
    // contato direto.
    const { data: novoLead, error: insertErr } = await supabaseAdmin
      .from('sdr_leads')
      .insert({
        nome: 'Loja',
        telefone: telNormalizado,
        produto: 'TRIAGEM',
        status: 'INTERESSADO',
        etapa_cadencia: 1,
        acionar_humano: true,
        observacoes: '[INBOUND_TRIAGEM] Lead chegou sem prospeccao previa — Aldo/Nei vao fazer contato direto',
        data_disparo_inicial: new Date().toISOString(),
        data_ultimo_contato: new Date().toISOString(),
        evotalks_chat_id: chatId || null,
        evotalks_client_id: clientId || null,
      })
      .select('*')
      .single()

    let leadEhInboundNovo = false
    if (insertErr || !novoLead) {
      // Se falhou por UNIQUE constraint, o lead já existe mas não encontramos
      // (pode ser formato de telefone diferente). Tenta buscar mais uma vez.
      if (insertErr?.code === '23505') {
        lead = await getLeadByTelefone(telNormalizado)
      }
      if (!lead) {
        console.error(`Erro ao criar lead automático ${telNormalizado}:`, insertErr?.message)
        return NextResponse.json({ ok: true, ignorado: 'erro_criar_lead', erro: insertErr?.message })
      }
    } else {
      lead = novoLead as Lead
      leadEhInboundNovo = true
      console.log(`Lead TRIAGEM criado: ${lead.id} (${telNormalizado})`)
    }

    // Cria oportunidade na Evo Talks IMEDIATAMENTE pra todo lead inbound novo.
    // Isso garante que o lead entre no funil AIVA (pipeline 15, stage INTERESSADO)
    // mesmo que a VictorIA retorne BOT_DETECTADO/NAO_QUALIFICADO depois — assim o
    // lead aparece no painel da Evo Talks e o time pode acompanhar/intervir.
    // O fluxo dos triggers de stages (49, 50, 70) só dispara pra opps existentes,
    // então sem essa criação inicial o lead inbound ficava órfão fora do funil.
    if (leadEhInboundNovo && lead) {
      try {
        const oppId = await createOpportunity({
          title: `${lead.nome} — AIVA (inbound)`,
          number: lead.telefone,
          stageId: STAGES.INTERESSADO,
          chatId: chatId || lead.evotalks_chat_id || undefined,
          clientId: clientId || lead.evotalks_client_id || undefined,
        })
        await supabaseAdmin
          .from('sdr_leads')
          .update({ evotalks_opportunity_id: String(oppId) })
          .eq('id', lead.id)
        lead.evotalks_opportunity_id = String(oppId)
        console.log(`[INBOUND] Oportunidade #${oppId} criada em "Interessado" pra ${lead.telefone}`)

        // Aplica tag AIVA pra distinção visual no painel CRM
        try {
          await addOpportunityTags(oppId, [TAG_IDS.AIVA])
        } catch (err) {
          console.error(`[INBOUND] Erro ao adicionar tag AIVA na oportunidade #${oppId}:`, err)
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[INBOUND] Erro ao criar oportunidade pra ${lead.telefone}: ${errMsg}`)
        // Não interrompe o fluxo — VictorIA continua respondendo e a opp pode
        // ser criada mais tarde via fallback na seção 13 (handler do novo_status).
      }
    }

    // Alerta WhatsApp pra Aldo + Nei na PRIMEIRA mensagem inbound de lead novo TRIAGEM.
    if (leadEhInboundNovo) {
      try {
        const msgPreview = (conteudo || '').slice(0, 200) || '(mensagem vazia ou só audio/midia)'
        const alerta =
          `🆕 *NOVO LEAD INBOUND*\n\n` +
          `📞 ${telNormalizado}\n` +
          `📩 Primeira msg:\n"${msgPreview}"\n\n` +
          `A VictorIA já se apresentou e vai conversando enquanto vocês não assumem.\n` +
          `→ Acessa o painel pra ver/responder direto: sdr-agente.vercel.app`
        if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, alerta)
        if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, alerta)
      } catch (err) {
        console.error('[TRIAGEM] Erro ao alertar Aldo/Nei sobre lead inbound novo:', err)
      }
    }
  }

  // Guard: TypeScript não consegue inferir que lead é non-null depois de todos
  // os branches acima (cada um retorna ou atribui). Assert pra silenciar.
  if (!lead) {
    return NextResponse.json({ ok: true, ignorado: 'lead_null_inesperado' })
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

  // 5c. Atendimento automático detectado — limite de 10 respostas.
  // Flag setado pela VictorIA quando ela identifica bot/auto-reply do outro lado
  // (ver /prompts/aiva.ts, seção "REGRA SOBRE ATENDIMENTO AUTOMÁTICO").
  // Depois do flag, contamos quantas respostas já foram enviadas. Se >= 10,
  // paramos silenciosamente pra não gastar tokens em loop com outro bot.
  if (lead.observacoes?.includes('[AUTO_DETECTED')) {
    const { count: outCount } = await supabaseAdmin
      .from('sdr_mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', lead.id)
      .eq('direcao', 'out')
    if ((outCount ?? 0) >= 10) {
      console.log(`Lead ${lead.telefone}: atendimento auto detectado e >=10 respostas, ignorando`)
      return NextResponse.json({
        ok: true,
        ignorado: 'atendimento_automatico_cap_10',
        out_count: outCount ?? 0,
      })
    }
    console.log(
      `Lead ${lead.telefone}: atendimento auto detectado, ${outCount ?? 0}/10 respostas`
    )
  }

  // 6. Lead com cadastro finalizado — avisa Nei e encerra.
  if (STATUS_ALERTA_E_ENCERRA.includes(lead.status)) {
    const alerta =
      `⚠️ *${lead.nome}* (${lead.telefone}) respondeu após cadastro completo.\n` +
      `Mensagem: "${conteudo}"\n\nAcompanhe no Evo Talks.`
    await alertHuman(process.env.NEI_WHATSAPP!, alerta)
    return NextResponse.json({ ok: true, ignorado: 'cadastro_ja_completo' })
  }

  // 7. Idempotência — se o mesmo mId (messageid do WhatsApp) já foi salvo,
  // é retry do Evo Talks de um webhook que já processamos. Ignoramos.
  if (mId && (await mensagemMidExiste(mId))) {
    console.log(`Lead ${lead.telefone}: mId ${mId} já processado, ignorando retry`)
    return NextResponse.json({ ok: true, ignorado: 'mid_duplicado' })
  }

  // Auto-reprocess (interno) ja salvou a msg em sdr_mensagens antes de chamar
  // este webhook — pular o save abaixo evita linha duplicada com mesmo conteudo
  // e mId=null. O processamento Claude segue normal.
  const isAutoReprocess = req.headers.get('x-auto-reprocess') === 'true'

  if (!isAutoReprocess) {
    // Salva mensagem recebida imediatamente (antes do lock), já com o mId
    // pra travar futuros retries via índice UNIQUE.
    await saveMensagem(lead.id, 'in', conteudo, undefined, mId || null)
  }

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
    // 7c. RE-FETCH do lead pos-lock — defesa contra race conditions.
    // O lead foi lido inicialmente la na linha ~167 (antes do lock). Se um
    // webhook paralelo processou uma rajada antes deste, ele ja pode ter:
    //  - Criado a oportunidade no Evo (evotalks_opportunity_id setado)
    //  - Atualizado status (INTERESSADO -> AGUARDANDO_APROVACAO)
    //  - Mudado nome via nome_varejo coletado
    // Sem o re-fetch, criariamos opp duplicada porque o local `lead` ta stale.
    const leadFresh = await getLeadByTelefone(lead.telefone)
    if (leadFresh) {
      lead = leadFresh
    }

    // 7d. Debounce — espera 7s pra capturar qualquer mensagem adicional da rajada.
    // Leads frequentemente mandam 2-3 msgs em sequência rápida (<5s entre elas).
    // Com 7s de espera, a maioria dos bursts já chegou ao DB antes de chamar o Claude.
    await new Promise((r) => setTimeout(r, 7000))

    // Loop de reprocessamento: se novas mensagens 'in' chegarem durante o
    // processamento (após o debounce), roda outra volta pra não deixar órfãs.
    let iteracao = 0
    const MAX_ITERACOES = 3
    while (iteracao < MAX_ITERACOES) {
      iteracao++
      const loopStart = new Date().toISOString()

    // 8. Busca histórico (inclui as msgs que chegaram durante o debounce),
    // remove marcadores internos ([Template X enviado]) que confundem a VictorIA,
    // e deduplica rajadas de 'in' consecutivas idênticas.
    // Janela ampliada para 30 msgs (era 20) — reduz perda de contexto em
    // conversas longas de qualificação sem custo significativo de tokens.
    const historicoRaw = await getMensagens(lead.id, 30)
    const historico = dedupConsecutiveIn(stripInternalMarkers(historicoRaw))

    // Usa a última mensagem 'in' como conteúdo efetivo (pode ser diferente da que
    // chegou neste request se o burst trouxe algo mais recente)
    const ultimaInNoHistorico = [...historico].reverse().find((m) => m.direcao === 'in')
    const conteudoEfetivo = ultimaInNoHistorico?.conteudo ?? conteudo

    // Extrai dados já coletados de turns anteriores (podem não estar mais no
    // histórico se a conversa passou de 30 msgs). Injetados no prompt pra
    // evitar que a VictorIA re-pergunte o que o lead já respondeu.
    const dadosAcumulados = parseDadosAcumulados(lead.observacoes ?? null)

    // 9. Processa com Claude (VictorIA)
    // Passa o status atual pra Claude saber em qual fase do fluxo está
    // (Fase 1 = INTERESSADO, Fase 2 = AGUARDANDO_APROVACAO, Fase 3 = COLETANDO_COMPLEMENTO).
    // O produto determina o prompt: AIVA (default) ou TRIAGEM (lead inbound puro).
    let resposta
    try {
      resposta = await processarMensagem(conteudoEfetivo, historico, lead.nome, lead.status, lead.produto, dadosAcumulados)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errStack = err instanceof Error ? err.stack : undefined
      console.error('Erro ao processar com Claude:', errMsg, errStack)

      // Envia mensagem amigável de fallback pro lead (NUNCA o erro bruto).
      // Wrapped em try/catch porque se o sendText também falhar, a gente
      // não quer derrubar o webhook todo — o alerta pro humano abaixo cobre.
      try {
        await sendText(lead.telefone, FALLBACK_MENSAGEM_OVERLOADED, lead.evotalks_chat_id)
        await saveMensagem(lead.id, 'out', FALLBACK_MENSAGEM_OVERLOADED)
      } catch (sendErr) {
        const sendErrMsg = sendErr instanceof Error ? sendErr.message : String(sendErr)
        console.error('Falha ao enviar fallback message ao lead:', sendErrMsg)
      }

      // Aciona humano em paralelo
      await alertHuman(
        process.env.NEI_WHATSAPP!,
        `🚨 Erro ao processar mensagem de *${lead.nome}* (${lead.telefone}).\nMensagem: "${conteudoEfetivo}"\nLead recebeu fallback amigável.`
      )
      // Salva marcador OUT pra balancear IN/OUT — assim o auto-reprocess
      // não vai re-disparar este webhook em loop ate Claude voltar a funcionar.
      // O marcador fica todo entre [] (formato pegado por stripInternalMarkers
      // via regex /^\[.*\]$/) então é filtrado antes de ir pro prompt da IA.
      // Humano foi alertado e vai intervir manualmente.
      const errResumo = errMsg.substring(0, 150).replace(/[\[\]]/g, '')
      await saveMensagem(lead.id, 'out', `[CLAUDE_ERR:${new Date().toISOString()}:${errResumo}]`)
      // Marca lead com flag em observacoes pra debug e auditoria
      const flagErr = `[CLAUDE_ERR:${new Date().toISOString()}]`
      const obsAtual = lead.observacoes ?? ''
      const obsLimpa = obsAtual.replace(/\[CLAUDE_ERR:[^\]]+\]\s*/g, '').trim()
      await supabaseAdmin
        .from('sdr_leads')
        .update({ observacoes: `${flagErr} ${obsLimpa}`.trim() })
        .eq('id', lead.id)
      return NextResponse.json({ ok: false, erro: 'claude_error', detail: errMsg }, { status: 500 })
    }

  // 9b. Defesa em profundidade — bloqueia transição CADASTRO_COMPLETO indevida.
  // VictorIA só pode marcar CADASTRO_COMPLETO quando o lead JÁ ESTÁ em
  // COLETANDO_COMPLEMENTO (Fase 3 ativada pelo operador via stage CADASTRO_RECEBIDO).
  // Se a IA tentar pular direto da Fase 1 (INTERESSADO) ou Fase 2 pra CADASTRO_COMPLETO,
  // reescreve a mensagem e mantém o status atual antes de enviar qualquer coisa pro lead.
  if (
    resposta.novo_status === 'CADASTRO_COMPLETO' &&
    lead.status !== 'COLETANDO_COMPLEMENTO'
  ) {
    console.warn(
      `[guard] Lead ${lead.telefone}: VictorIA tentou CADASTRO_COMPLETO com status atual = ${lead.status}. Bloqueado.`,
    )
    // Fallback seguro: mantém lead na Fase 1 (INTERESSADO). Se já estava em
    // AGUARDANDO_APROVACAO ou outro estado válido pra IA, preserva.
    const STATUS_VALIDOS_IA = ['INTERESSADO', 'AGUARDANDO', 'AGUARDANDO_APROVACAO', 'COLETANDO_COMPLEMENTO']
    resposta.novo_status = (STATUS_VALIDOS_IA.includes(lead.status) ? lead.status : 'INTERESSADO') as typeof resposta.novo_status
    resposta.mensagem = 'Posso te tirar mais alguma dúvida sobre como a AIVA funciona?'
    try {
      const msg = `⚠️ *${lead.nome}* (${lead.telefone}) — VictorIA tentou pular direto pra CADASTRO_COMPLETO sem passar pela Fase 1/2 (status atual: ${lead.status}). Mensagem reescrita e status mantido.`
      if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
      if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
    } catch (err) {
      console.error('[guard] falha ao alertar humanos:', err)
    }
  }

  // 9c. Defesa em profundidade — bloqueia transição AGUARDANDO_APROVACAO indevida.
  // AGUARDANDO_APROVACAO só pode vir de estados de Fase 1 (INTERESSADO, DISPARO_REALIZADO,
  // SEM_RESPOSTA) ou de uma re-mensagem espontânea quando já está AGUARDANDO_APROVACAO/AGUARDANDO.
  // Se a IA tentar promover lead de Fase 3 (COLETANDO_COMPLEMENTO/CADASTRO_COMPLETO) ou de
  // estado terminal (NAO_QUALIFICADO/OPT_OUT/etc) pra AGUARDANDO_APROVACAO, bloqueia.
  const ESTADOS_VALIDOS_AGUARDANDO_APROVACAO = [
    'INTERESSADO', 'DISPARO_REALIZADO', 'SEM_RESPOSTA', 'AGUARDANDO_APROVACAO', 'AGUARDANDO',
  ]
  if (
    resposta.novo_status === 'AGUARDANDO_APROVACAO' &&
    !ESTADOS_VALIDOS_AGUARDANDO_APROVACAO.includes(lead.status)
  ) {
    console.warn(
      `[guard] Lead ${lead.telefone}: VictorIA tentou AGUARDANDO_APROVACAO com status atual = ${lead.status}. Bloqueado.`,
    )
    const STATUS_FALLBACK = ['INTERESSADO', 'AGUARDANDO', 'COLETANDO_COMPLEMENTO']
    resposta.novo_status = (STATUS_FALLBACK.includes(lead.status) ? lead.status : 'INTERESSADO') as typeof resposta.novo_status
    resposta.mensagem = 'Tô seguindo aqui com você, qualquer dúvida me chama 👍'
    try {
      const msg = `⚠️ *${lead.nome}* (${lead.telefone}) — VictorIA tentou voltar pra AGUARDANDO_APROVACAO de um status inválido (atual: ${lead.status}). Mensagem reescrita e status mantido.`
      if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
      if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
    } catch (err) {
      console.error('[guard] falha ao alertar humanos:', err)
    }
  }

  // 9d. Check pré-envio: se nova mensagem 'in' chegou DURANTE o processamento do
  // Claude (ex.: lead mandou 2 msgs com >7s de intervalo), não envia a resposta
  // gerada agora — reprocessa na próxima iteração com contexto completo.
  // Isso evita o cenário "VictorIA pergunta a mesma coisa duas vezes".
  if (iteracao < MAX_ITERACOES) {
    const { data: orfasPre } = await supabaseAdmin
      .from('sdr_mensagens')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('direcao', 'in')
      .gt('enviado_em', loopStart)
      .limit(1)

    if (orfasPre && orfasPre.length > 0) {
      console.log(
        `Lead ${lead.telefone}: nova msg durante Claude (iter ${iteracao}) — reprocessando sem enviar`,
      )
      continue
    }
  }

  // 10. Envia resposta ao lead (se tiver mensagem pra enviar)
  // VictorIA pode retornar mensagem vazia quando detecta atendimento automático
  // — nesse caso só marcamos o lead e não desperdiçamos envio.
  const autoDetected = resposta.motivo_humano === 'atendimento_automatico_detectado'
  const telefoneParaEnvio = lead.telefone
  if (resposta.mensagem?.trim() && !autoDetected) {
    try {
      await sendText(telefoneParaEnvio, resposta.mensagem, lead.evotalks_chat_id)
    } catch (err) {
      console.error('Erro ao enviar mensagem via Evo Talks:', err)
    }

    // 11. Salva resposta no histórico
    await saveMensagem(lead.id, 'out', resposta.mensagem)
  } else if (autoDetected) {
    console.log(`Lead ${lead.telefone}: atendimento automático detectado pela VictorIA, flag setado`)
  }

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

  // Monta observações preservando flags importantes ([PAUSA_ATE:], [AUTO_DETECTED:],
  // [DADOS_COLETADOS:]) e sobrescrevendo o texto "solto" com o motivo mais recente.
  // Sempre atualiza observacoes para manter [DADOS_COLETADOS:...] acumulado.
  {
    const pausaMatch = lead.observacoes?.match(/\[PAUSA_ATE:[^\]]+\]/)
    const jaTemAutoFlag = lead.observacoes?.includes('[AUTO_DETECTED')
    const partes: string[] = []

    if (autoDetected && !jaTemAutoFlag) {
      partes.push(`[AUTO_DETECTED:${new Date().toISOString()}]`)
    } else if (jaTemAutoFlag) {
      const m = lead.observacoes?.match(/\[AUTO_DETECTED[^\]]*\]/)
      if (m) partes.push(m[0])
    }
    if (pausaMatch) partes.push(pausaMatch[0])
    if (resposta.motivo_humano) partes.push(resposta.motivo_humano)

    // Merge dados novos com dados já acumulados e serializa como flag
    if (resposta.dados_coletados) {
      const novosDados = Object.fromEntries(
        Object.entries(resposta.dados_coletados as Record<string, string | null>)
          .filter(([, v]) => v && v !== 'null')
          .map(([k, v]) => [k, v as string])
      )
      const dadosMerged = { ...dadosAcumulados, ...novosDados }
      const dadosFlag = serializeDadosAcumulados(dadosMerged)
      if (dadosFlag) partes.push(dadosFlag)
    } else {
      // Nenhum dado novo, mas preserva os que já estavam acumulados
      const dadosFlag = serializeDadosAcumulados(dadosAcumulados)
      if (dadosFlag) partes.push(dadosFlag)
    }

    updates.observacoes = partes.join(' ').trim() || null
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
    if (!oppId && (resposta.novo_status === 'INTERESSADO' || resposta.novo_status === 'AGUARDANDO_APROVACAO')) {
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

      // Tag "Atendimento Humano" (laranja) — lead precisa ação humana nesta mensagem.
      // Auto-detectado (bot do outro lado) não conta — já vai pra BOT_DETECTADO.
      // addOpportunityTags sobrescreve; reincluímos AIVA e IMPORTANTE (se aplicável)
      // pra não apagá-las.
      if (resposta.acionar_humano && !autoDetected) {
        try {
          const numRaw = resposta.dados_coletados?.numero_lojas
          const numLojas = numRaw ? Number(String(numRaw).replace(/\D/g, '')) : NaN
          const temImportante = lead.importante || (!Number.isNaN(numLojas) && numLojas >= 3)
          const tags: number[] = [TAG_IDS.AIVA]
          if (temImportante) tags.push(TAG_IDS.IMPORTANTE)
          tags.push(TAG_IDS.ATENDIMENTO_HUMANO)
          await addOpportunityTags(oppId, tags)
          console.log(`CRM: Tag "Atendimento Humano" aplicada na oportunidade #${oppId}`)
        } catch (err) {
          console.log(`CRM: Erro ao adicionar tag Atendimento Humano na oportunidade #${oppId}:`, err)
        }
      }

      // FASE 1 completa (7 dados) → move pra Pré Aprovação + envia Google Sheets
      // Só dispara na TRANSIÇÃO (lead estava em outro status antes). Se já estava
      // AGUARDANDO_APROVACAO e só mandou uma msg espontânea, não re-executa.
      if (resposta.novo_status === 'AGUARDANDO_APROVACAO' && lead.status !== 'AGUARDANDO_APROVACAO') {
        // Validação dos 7 campos obrigatórios da Fase 1 ANTES de mover stage e
        // mandar Google Sheets. Defesa contra IA marcando completude prematura
        // (espelho da validação dos 12 campos pro CADASTRO_COMPLETO).
        const oppPreCheck = await getOpportunity(oppId)
        const formsPreCheck = (oppPreCheck.formsdata ?? {}) as Record<string, string | null>
        const camposFase1 = {
          nome_socio: 'da6ddf70',
          telefone: 'db8569f0',
          nome_varejo: 'dcacfa00',
          cnpj_matriz: 'dd2ab580',
          regiao_varejo: 'dede58f0',
          numero_lojas: 'df6f9c70',
          possui_outra_financeira: 'e07d62f0',
        }
        const faltantesFase1 = Object.entries(camposFase1)
          .filter(([, fieldId]) => !formsPreCheck[fieldId]?.toString().trim())
          .map(([label]) => label)

        if (faltantesFase1.length > 0) {
          console.warn(`Pré Aprovação bloqueada — opp #${oppId} incompleto: ${faltantesFase1.join(', ')}`)
          await addOpportunityNote(oppId, `⚠️ VictorIA marcou AGUARDANDO_APROVACAO mas faltam: ${faltantesFase1.join(', ')}. Stage NÃO movido, Google Sheets NÃO enviado. Status revertido pra INTERESSADO.`)

          await supabaseAdmin
            .from('sdr_leads')
            .update({ status: 'INTERESSADO' })
            .eq('id', lead.id)

          const msg =
            `⚠️ *${lead.nome}* (${lead.telefone}) — VictorIA marcou Fase 1 completa mas faltam dados: ${faltantesFase1.join(', ')}.\n` +
            `Pré Aprovação bloqueada. Status revertido pra INTERESSADO — VictorIA vai continuar coletando.`
          if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
          if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)

          // Pula o resto do bloco de transição (não move stage, não envia Sheets)
          return NextResponse.json({ ok: true, bloqueado: 'fase1_incompleta', faltantes: faltantesFase1 })
        }

        await changeOpportunityStage(oppId, STAGES.PRE_APROVACAO)
        await addOpportunityNote(oppId, `Qualificação inicial (7 dados) coletada pela VictorIA via WhatsApp. Aguardando análise AIVA.`)
        console.log(`CRM: Oportunidade #${oppId} → Pré Aprovação`)

        // Envia os 7 dados pra planilha Google Sheets direto daqui.
        // (o trigger do Evo Talks pro stage 54 está desabilitado)
        const opp = await getOpportunity(oppId)
        const forms = (opp.formsdata ?? {}) as Record<string, string | null>
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
      }
      // FASE 3 completa (12 dados) → envia HubSpot.
      // Lead em CADASTRO_COMPLETO já retornou no passo 6, então se chegou aqui
      // é transição de verdade (COLETANDO_COMPLEMENTO → CADASTRO_COMPLETO).
      else if (resposta.novo_status === 'CADASTRO_COMPLETO') {
        const opp = await getOpportunity(oppId)
        const forms = (opp.formsdata ?? {}) as Record<string, string | null>

        // Valida os 12 campos ANTES de disparar HubSpot — defesa contra erro
        // da VictorIA marcando CADASTRO_COMPLETO prematuramente. Os 12 campos
        // obrigatórios são os do formulário Qualificação Varejo do Evo Talks.
        const camposObrigatorios = {
          nome_socio: 'da6ddf70',
          email_socio: 'dafa40f0',
          telefone: 'db8569f0',
          nome_varejo: 'dcacfa00',
          cnpj_matriz: 'dd2ab580',
          faturamento_anual: 'ddb960f0',
          valor_boleto_mensal: 'de2cbc30',
          regiao_varejo: 'dede58f0',
          numero_lojas: 'df6f9c70',
          localizacao_lojas: 'e0099280',
          possui_outra_financeira: 'e07d62f0',
          cnpjs_adicionais: 'e0f66380',
        }
        const faltantes = Object.entries(camposObrigatorios)
          .filter(([, fieldId]) => !forms[fieldId]?.toString().trim())
          .map(([label]) => label)

        if (faltantes.length > 0) {
          // Bloqueia HubSpot e alerta humanos — VictorIA marcou completo mas
          // tá faltando dado. Reverte status pra COLETANDO_COMPLEMENTO pro
          // lead continuar na Fase 3.
          console.warn(`HubSpot bloqueado — opp #${oppId} incompleto: ${faltantes.join(', ')}`)
          await addOpportunityNote(oppId, `⚠️ VictorIA marcou CADASTRO_COMPLETO mas faltam: ${faltantes.join(', ')}. HubSpot bloqueado. Status revertido pra COLETANDO_COMPLEMENTO.`)

          await supabaseAdmin
            .from('sdr_leads')
            .update({ status: 'COLETANDO_COMPLEMENTO' })
            .eq('id', lead.id)

          const msg =
            `⚠️ *${lead.nome}* (${lead.telefone}) — VictorIA marcou cadastro completo mas faltam dados: ${faltantes.join(', ')}.\n` +
            `HubSpot bloqueado. Status revertido pra COLETANDO_COMPLEMENTO — VictorIA vai continuar coletando.`
          await alertHuman(process.env.NEI_WHATSAPP!, msg)
          await alertHuman(process.env.ALDO_WHATSAPP!, msg)

          // Sobrescreve a resposta pra quem ler depois saber que não foi transição real
          resposta.novo_status = 'COLETANDO_COMPLEMENTO'
        } else {
          await addOpportunityNote(oppId, `Cadastro completo (12 dados) coletado pela VictorIA. Enviado pro HubSpot.`)
          console.log(`CRM: Oportunidade #${oppId} → Cadastro Completo → HubSpot`)
          try {
            await sendToHubSpot({
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
            })
          } catch (err) {
            console.error(`Erro ao enviar pro HubSpot — opp #${oppId}:`, err)
          }

          // Complementa planilha AIVA APROVAÇÃO com os 5 campos da Fase 3
          // (email, faturamento, valor_boleto_mensal, localizacao_lojas, cnpjs_adicionais).
          // O Apps Script faz upsert por opportunity_id: se a linha já existe (foi
          // criada na Fase 1), só preenche as células vazias — preserva o que já está
          // lá. Se não existe, cria linha nova.
          try {
            await sendToGoogleSheets({
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
              status: 'CADASTRO_COMPLETO',
              opportunity_id: String(oppId),
            })
          } catch (err) {
            console.error(`Erro ao complementar Google Sheets — opp #${oppId}:`, err)
          }
        }
      } else if (resposta.novo_status === 'NAO_QUALIFICADO') {
        await addOpportunityNote(oppId, `Lead não qualificado: ${resposta.motivo_humano ?? 'sem perfil'}`)
      } else if (resposta.novo_status === 'BOT_DETECTADO') {
        // Chatbot/atendimento automático detectado pela VictorIA em qualquer fase.
        // Move opp pro stage 69 (Bot Detectado) no pipeline AIVA, fora do funil ativo.
        try {
          await changeOpportunityStage(oppId, STAGES.BOT_DETECTADO)
          await addOpportunityNote(oppId, `Bot/atendimento automático detectado pela VictorIA. Sem acesso ao decisor humano.`)
          console.log(`CRM: Oportunidade #${oppId} → Bot Detectado (stage ${STAGES.BOT_DETECTADO})`)
        } catch (err) {
          console.log(`CRM: Erro ao mover para Bot Detectado #${oppId}:`, err)
        }
      }
    }
  } catch (err) {
    console.error('Erro ao atualizar CRM:', err)
  }

  // 14. Alertas para humanos — só disparam na TRANSIÇÃO de status, não em cada msg
  if (resposta.novo_status === 'AGUARDANDO_APROVACAO' && lead.status !== 'AGUARDANDO_APROVACAO') {
    const msg =
      `🟡 *${lead.nome}* (${lead.telefone} — ${lead.cidade ?? 'cidade n/d'}) qualificado p/ pré-aprovação.\n` +
      `7 dados coletados pela VictorIA. Mover pra Cadastro Recebido no Evo Talks quando aprovar.`
    await alertHuman(process.env.NEI_WHATSAPP!, msg)
    await alertHuman(process.env.ALDO_WHATSAPP!, msg)
  } else if (resposta.novo_status === 'CADASTRO_COMPLETO') {
    const msg =
      `✅ *${lead.nome}* (${lead.telefone} — ${lead.cidade ?? 'cidade n/d'}) completou o cadastro!\n` +
      `12 dados enviados pro HubSpot. Pronto pra mover pra Análise AIVA.`
    await alertHuman(process.env.NEI_WHATSAPP!, msg)
    await alertHuman(process.env.ALDO_WHATSAPP!, msg)
  } else if (resposta.acionar_humano && !autoDetected) {
    // Auto-detectado não alerta o Nei (seria spam a cada msg do bot do outro lado).
    // O lead fica visível no filtro /?aguardando_humano=true do painel se ele quiser revisar.
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
