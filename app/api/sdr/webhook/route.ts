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
  createOpportunity, changeOpportunityStage, changeStageSeAvanco, addOpportunityNote, addOpportunityTags, mergeOpportunityTag, transferirParaFunil19, STAGES, TAG_IDS,
  PIPELINE_SINGLO, SINGLO_STAGES,
  updateOpportunityForms, updateOpportunityTitle, linkChatToOpportunity,
  getOpportunity, getChatMessages, sendToGoogleSheets, sendToHubSpot, STAGE_TO_STATUS,
  statusFromOpp, emFase3,
  MARCADOR_FASE3,
} from '@/lib/evotalks'
import type { DadosColetados } from '@/lib/claude'
import { processarMensagem, transcreverAudio, resumirProblemaChamado, FALLBACK_MENSAGEM_OVERLOADED } from '@/lib/claude'
import { normalizaNome, buildAvisoCadastroMsg, buildAvisoTreinamentoMsgs, buildAvisoColetandoComplementoMsg, buildKitPosFechamentoMsg, buildMsgTravaQsa, formatarDadosLead } from '@/lib/text'
import { consultarCNPJ, consultarCNPJDetalhado, cnpjInfoMarker } from '@/lib/cnpj'
import { enviarDocParaDrive, enviarLinhaManual, registrarAtendimento, registrarSenhaColab, registrarChamado } from '@/lib/manual-docs'
import { capturarColaborador } from '@/lib/colab-rede-seguranca'
import { extrairCnpjs } from '@/lib/pre-cadastro-form'
import { parseColaboradores, enviarColaboradorAoForm, linkColaboradorPreenchido, type Colaborador } from '@/lib/colaborador-form'
import { isAdmin, isCommand, handleCommand, respondToAdmin, conversarComAdmin } from '@/lib/admin-commands'
import { consumirBriefingFollowup } from '@/lib/pipeline-briefing'

// Status que bloqueiam processamento (silenciosamente — sem alerta).
// Lead chegou no fim do funil (terminal positivo OU descartado/bot/opt-out/odres/ume).
const STATUS_IGNORAR: LeadStatus[] = ['OPT_OUT', 'NAO_QUALIFICADO', 'DESCARTADO', 'BOT_DETECTADO', 'ODRES', 'UME']

// Mensagem oficial da Odres — enviada VERBATIM quando o lojista informa que já
// trabalha com a Odres (novo_status = ODRES). Texto fixo (não parafrasear).
const ODRES_MENSAGEM =
  'Identificamos em nossa base que sua loja já utiliza o crediário da Odres.\n\n' +
  'A UME, empresa proprietária da AIVA, também é parceira da Odres. Por esse motivo, em breve a sua loja também poderá contar com todas as soluções da AIVA.\n\n' +
  'Esse processo de integração deve ser concluído nos próximos 1 a 2 meses. Enquanto isso, pedimos apenas um pouco de paciência para que todos os trâmites comerciais e operacionais sejam finalizados.\n\n' +
  'Em breve entraremos em contato com mais informações. Agradecemos pela compreensão!'

// Mensagem oficial da UME — enviada VERBATIM quando o lojista informa que já
// trabalha com a UME (novo_status = UME). AIVA é a evolução da UME. Texto fixo.
const UME_MENSAGEM =
  'Identificamos que sua loja já trabalha com a UME.\n\n' +
  'A AIVA é justamente a evolução da UME — mesma empresa, mesmo grupo. Ou seja, quem já é parceiro da UME já conta com a AIVA!\n\n' +
  'Em breve nossa equipe entra em contato pra alinhar os detalhes e garantir que você aproveite todas as novidades da AIVA. Qualquer dúvida, estamos à disposição!'

// Status terminais positivos que disparam ALERTA pro Nei e encerram.
//
// REFATORADO 2026-05-28: CADASTRO_RECEBIDO foi colapsado em CADASTRO_RECEBIDO
// (alinhamento com funil Evo). Mas CADASTRO_RECEBIDO ainda processa mensagens
// (comentário histórico: Richard 5534988478275 mandou audio sobre treinamento
// e VictorIA ficou muda — Nei teve que responder manualmente). Por isso este
// array fica VAZIO — nenhum status post-qualificação bloqueia processamento.
// VictorIA trata lead pós-cadastro como cliente ativo (prompt orienta).
const STATUS_ALERTA_E_ENCERRA: LeadStatus[] = []

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
  // Nome do arquivo — exibido no painel junto do link (formato pedido pelo Aldo
  // 23/07, inspirado no painel Parcelex). Tira ']' pra não quebrar o marcador.
  const fileName: string = asStr(
    messageObj.fileName ?? messageObj.file_name ?? messageFileObj?.fileName ??
    payloadMessageObj?.fileName ?? payloadMessageObj?.file_name ??
    payload.fileName ?? '',
  ).replace(/\]/g, '')

  const isAudio = !!fileId && fileId > 0 && (
    mimeType.startsWith('audio/') ||
    mimeType === 'application/ogg' ||
    mimeType.includes('opus')
  )
  // Imagem/foto: detectada pra que VictorIA saiba que recebeu uma mídia.
  // Não há OCR — o conteúdo entra como marcador especial e VictorIA é orientada
  // (via prompt) a pedir o dado em texto, já que ela não consegue ler imagem.
  const isImage = !!fileId && fileId > 0 && mimeType.startsWith('image/')

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

  // 4b. Imagem/foto recebida do lead — baixa e prepara pra envio multimodal pro Claude.
  // Claude Sonnet 4.5 tem visão e lê CNPJ, endereço, comprovantes etc. diretamente.
  // O prompt da VictorIA orienta a SEMPRE confirmar o dado com o lead antes de salvar
  // (evita gravar valores errados por causa de OCR).
  let imagemPraClaude: { base64: string; mimeType: string } | null = null
  if (!conteudo.trim() && isImage && fileId) {
    try {
      const img = await downloadAudio(fileId) // helper genérico — baixa qualquer fileId
      imagemPraClaude = {
        base64: img.buffer.toString('base64'),
        mimeType: img.mimeType || mimeType || 'image/jpeg',
      }
      // Marcador COM o fileId → o painel gera o link do Evo e exibe a imagem
      // (o link tem token que expira, então guardamos só o id e resolvemos na hora).
      conteudo = `[LEAD_ENVIOU_IMAGEM:${fileId}]`
      console.log(`Imagem recebida e baixada — fileId: ${fileId}, mimeType: ${imagemPraClaude.mimeType}, ${img.buffer.byteLength} bytes`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`Erro ao baixar imagem fileId=${fileId}: ${errMsg}`)
      // Fallback: marca a imagem (com id, ainda dá pra ver no painel) — VictorIA
      // pede em texto via prompt já que não conseguiu ler o conteúdo.
      conteudo = `[LEAD_ENVIOU_IMAGEM:${fileId}]`
    }
  }

  // Arquivo não-imagem (PDF, documento) sem legenda. ANTES caía no
  // 'sem_conteudo' abaixo e era DESCARTADO — documentos de aprovação (RG,
  // certificado MEI, extrato bancário) se perdiam. Agora salva um marcador com
  // o fileId e o mimeType, e o painel mostra um link de download.
  if (!conteudo.trim() && fileId && fileId > 0) {
    // Formato: [LEAD_ENVIOU_ARQUIVO:<id>:<mime>:<nome>] — o nome vai por último
    // (pode conter ':') e o painel mostra link + nome, estilo painel Parcelex.
    conteudo = `[LEAD_ENVIOU_ARQUIVO:${fileId}:${mimeType || 'application/octet-stream'}:${fileName}]`
    console.log(`Arquivo recebido — fileId: ${fileId}, mimeType: ${mimeType}, nome: ${fileName}`)
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

  // Briefing das 5h — "responda pra receber o detalhado": se há um briefing
  // detalhado pendente de hoje pra este admin, a resposta dele (que acabou de
  // ABRIR a janela 24h) dispara o pipeline completo. Só na 1ª resposta do dia;
  // depois cai no modo equipe normal abaixo.
  if (isAdmin(adminTelefone)) {
    try {
      const detalhado = await consumirBriefingFollowup(adminTelefone)
      if (detalhado) {
        await respondToAdmin(adminTelefone, detalhado)
        return NextResponse.json({ ok: true, admin: true, modo: 'briefing_detalhado' })
      }
    } catch (err) {
      console.error(`[briefing-followup] falha p/ ${adminTelefone}:`, err instanceof Error ? err.message : err)
    }
  }

  // Admin mandando mensagem comum (não comando) → MODO EQUIPE: a VictorIA conversa
  // naturalmente (sem parede de comandos, sem tratar como cliente) e usa as funções
  // de dados como ferramentas (pipeline, lead, dados, incompletos, status). Os
  // /comandos continuam existindo como atalho, mas não são obrigatórios.
  if (isAdmin(adminTelefone)) {
    console.log(`Admin ${adminTelefone} (modo equipe): ${conteudo.slice(0, 60)}`)
    try {
      const resposta = await conversarComAdmin(conteudo)
      await respondToAdmin(adminTelefone, resposta)
    } catch (err) {
      console.error(`Falha na conversa com admin ${adminTelefone}:`, err)
      try {
        await respondToAdmin(adminTelefone, 'Tive um probleminha aqui agora 😅 tenta de novo? Se preferir um atalho: /pipeline, /dados <telefone>, /incompletos, /ajuda.')
      } catch { /* noop */ }
    }
    return NextResponse.json({ ok: true, admin: true, modo: 'conversa_equipe' })
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

    console.log(`Lead desconhecido ${telNormalizado} — criando como AIVA (inbound)`)

    // Lead inbound novo → produto AIVA direto. A TRIAGEM (AIVA vs Singlo) foi
    // REMOVIDA em 2026-07-14 (decisão do Aldo): este número atende SÓ AIVA.
    // A VictorIA usa o prompt AIVA desde a 1ª mensagem (claude.ts escolhe AIVA
    // pra qualquer produto != TRIAGEM). A oportunidade é aberta LOGO ABAIXO, na
    // chegada, pra o atendimento ficar registrado no funil desde o começo.
    const { data: novoLead, error: insertErr } = await supabaseAdmin
      .from('sdr_leads')
      .insert({
        nome: 'Loja',
        telefone: telNormalizado,
        produto: 'AIVA',
        status: 'INICIO',
        etapa_cadencia: 1,
        acionar_humano: false,
        observacoes: '[INBOUND] Lead organico — chegou sem prospeccao previa',
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
      console.log(`Lead AIVA inbound criado: ${lead.id} (${telNormalizado})`)
    }

    // Abre a oportunidade no funil AIVA JÁ NA CHEGADA (etapa Início), com o chat
    // vinculado (fkChat) — assim o atendimento fica registrado no funil desde a
    // 1ª mensagem. Antes a opp só nascia quando a VictorIA marcava INTERESSADO,
    // então a conversa inicial ficava fora do funil (pedido do Aldo 2026-07-14).
    if (leadEhInboundNovo) {
      try {
        const oppInbound = await createOpportunity({
          title: '(inbound) Loja — AIVA',
          number: lead.telefone,
          stageId: STAGES.INICIO,
          chatId: chatId || lead.evotalks_chat_id || undefined,
          clientId: clientId || lead.evotalks_client_id || undefined,
        })
        await supabaseAdmin
          .from('sdr_leads')
          .update({ evotalks_opportunity_id: String(oppInbound) })
          .eq('id', lead.id)
        lead.evotalks_opportunity_id = String(oppInbound)
        try {
          await addOpportunityTags(oppInbound, [TAG_IDS.AIVA, TAG_IDS.INBOUND])
        } catch (err) {
          console.log(`CRM: erro ao aplicar tags na opp inbound #${oppInbound}:`, err)
        }
        console.log(`CRM: Opp AIVA inbound #${oppInbound} criada na chegada (etapa Início) — ${lead.telefone}`)
      } catch (err) {
        console.error(`CRM: falha ao criar opp inbound pra ${lead.telefone}:`, err)
      }
    }

    // Alerta WhatsApp pra Aldo + Nei na PRIMEIRA mensagem inbound de lead novo.
    if (leadEhInboundNovo) {
      try {
        const msgPreview = (conteudo || '').slice(0, 200) || '(mensagem vazia ou só audio/midia)'
        const alerta =
          `🆕 *NOVO LEAD INBOUND*\n\n` +
          `📞 ${telNormalizado}\n` +
          `📩 Primeira msg:\n"${msgPreview}"\n\n` +
          `A VictorIA já se apresentou e vai conversando enquanto vocês não assumem.\n` +
          `→ Acessa o painel pra ver/responder direto: sdr-aiva.vercel.app`
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

  // 4b. EVO É A FONTE DA VERDADE — sincroniza o status em TEMPO REAL antes de
  // qualquer decisão. O sync diário (10h) deixa o Supabase defasado: o operador
  // move o card no Evo (ex: Treinar → Login) e a VictorIA continuava conversando
  // com a fase antiga. Aqui consultamos a etapa atual da oportunidade no Evo e,
  // se divergir, atualizamos o lead (memória + banco) — guards, prompt e
  // contexto passam a usar a fase certa. Fail-open: se o Evo falhar ou a etapa
  // não for do funil AIVA, mantém o status do Supabase.
  //
  // A FASE 3 sai da MESMA consulta. O stage 49 com cadastro incompleto vira
  // status INTERESSADO — igual ao da Fase 1 —, então o status sozinho não diz
  // se o lead já foi aprovado. Perguntar isso ao Evo aqui (e não ao marcador
  // em observacoes) mantém a fonte da verdade única e dispensa esperar o sync.
  // O marcador continua sendo o fallback pro caso do Evo estar fora do ar.
  let leadEmFase3 = (lead.observacoes ?? '').includes(MARCADOR_FASE3)
  if (lead.evotalks_opportunity_id && lead.produto === 'AIVA') {
    try {
      const oppAtual = (await getOpportunity(Number(lead.evotalks_opportunity_id))) as {
        fkStage?: number
        formsdata?: Record<string, string | null> | null
      }
      leadEmFase3 = emFase3(oppAtual)
      const statusEvo = statusFromOpp(oppAtual)
      if (statusEvo && statusEvo !== lead.status) {
        console.log(
          `[evo-sync-realtime] Lead ${lead.telefone}: status Supabase=${lead.status} → Evo=${statusEvo}. ` +
          `Usando o Evo (fonte da verdade).`,
        )
        await supabaseAdmin
          .from('sdr_leads')
          .update({ status: statusEvo })
          .eq('id', lead.id)
        lead.status = statusEvo as typeof lead.status
      }
    } catch (err) {
      // Fail-open (mesma política de antes): mantém o status do Supabase e cai
      // no marcador pra decidir a Fase 3, em vez de tratar o lead como Fase 1.
      console.warn(`[evo-sync-realtime] Falha ao consultar opp de ${lead.telefone}:`, err)
    }
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

  // 5c. Atendimento automático / bot: o limite de tentativas agora é controlado pelo
  // contador [BOT_TROCAS:n] montado na seção de processamento da resposta (item 10).
  // Enquanto n < 10, a VictorIA segue TENTANDO furar o bot (status INTERESSADO, não
  // é ignorado aqui). Ao atingir 10, o próprio fluxo força BOT_DETECTADO (que entra
  // em STATUS_IGNORAR) e agenda um follow-up de reativação.

  // 6. Lead com cadastro finalizado — avisa Aldo+Nei e encerra.
  if (STATUS_ALERTA_E_ENCERRA.includes(lead.status)) {
    const alerta =
      `⚠️ *${lead.nome}* (${lead.telefone}) respondeu após cadastro completo.\n` +
      `Mensagem: "${conteudo}"\n\nAcompanhe no Evo Talks.`
    if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, alerta)
    if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, alerta)
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
    //
    // NUNCA gravar conteúdo vazio (bug 14/07 — lead Gfourr): mídia/reação sem
    // corpo virava uma linha 'in' vazia; no turno seguinte ela entrava no
    // histórico como user message "" e a Claude API rejeitava com 400
    // ("user messages must have non-empty content") em TODAS as voltas — o lead
    // ficava preso no fallback pra sempre. Marcador legível no lugar do vazio.
    const conteudoSalvar = conteudo?.trim() || '[mídia/anexo sem texto]'
    await saveMensagem(lead.id, 'in', conteudoSalvar, undefined, mId || null)
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
    //  - Atualizado status (INTERESSADO -> PRE_APROVACAO)
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

    // 8a. Sync de mensagens manuais do Nei via Evo Talks API
    //
    // A Evo Talks NÃO dispara webhook fromMe pra mensagens manuais (Nei
    // respondendo via painel ou WhatsApp Business). Resultado: VictorIA
    // não vê o que Nei disse e perde contexto.
    //
    // Solução: antes de buscar o histórico do Supabase, consulta /int/getChatMessages
    // pra trazer as últimas msgs OUT (direction=3) do chat. Insere no Supabase
    // como direcao='out' template_hsm='manual_humano' as que ainda não estão lá.
    if (lead.evotalks_chat_id) {
      try {
        const evoMsgs = await getChatMessages(Number(lead.evotalks_chat_id), 20)
        const evoOuts = evoMsgs
          .filter(m => m.direction === 3 && (m.message?.trim() ?? ''))
          .sort((a, b) => a.messagetimestamp - b.messagetimestamp) // mais antigas primeiro

        if (evoOuts.length > 0) {
          // Pega últimos 20 OUTs do Supabase pra dedup por conteúdo
          const { data: dbOuts } = await supabaseAdmin
            .from('sdr_mensagens')
            .select('conteudo')
            .eq('lead_id', lead.id)
            .eq('direcao', 'out')
            .order('enviado_em', { ascending: false })
            .limit(50)
          const dbContents = new Set((dbOuts ?? []).map(m => (m.conteudo ?? '').trim()))

          // Cutoff: só sincroniza msgs das últimas 48h (evita ressuscitar
          // mensagens muito antigas que já são irrelevantes pro contexto)
          const cutoffSec = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000)

          let sincronizadas = 0
          for (const evoMsg of evoOuts) {
            const content = (evoMsg.message ?? '').trim()
            if (!content) continue
            if (evoMsg.messagetimestamp < cutoffSec) continue
            if (dbContents.has(content)) continue
            await supabaseAdmin.from('sdr_mensagens').insert({
              lead_id: lead.id,
              direcao: 'out',
              conteudo: content,
              template_hsm: 'manual_humano',
              enviado_em: new Date(evoMsg.messagetimestamp * 1000).toISOString(),
            })
            dbContents.add(content)
            sincronizadas++
          }
          if (sincronizadas > 0) {
            console.log(`[sync_evo] Lead ${lead.telefone}: ${sincronizadas} msg(s) manuais sincronizadas da Evo Talks`)
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[sync_evo] Falha ao sincronizar msgs do lead ${lead.telefone}:`, errMsg)
        // Não bloqueia o webhook — segue com o histórico do Supabase mesmo sem sync
      }
    }

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

    // 8b. Caminho 2 — Reforço de avisos pendentes
    // Quando o lead respondeu pela primeira vez após o stage 49/50/70 ter sido
    // movido com a janela 24h fechada, reenvia os avisos que ficaram apenas
    // queued no painel da Evo Talks (não chegaram ao WhatsApp na hora).
    // A janela agora está aberta porque o lead acabou de responder.
    //
    // - AVISO_49_PENDENTE: lista os 5 dados que faltam coletar (Fase 3)
    // - AVISO_50_PENDENTE: reforço cadastro CAF + biometria facial
    // - AVISO_70_PENDENTE: link Meet+calendário, Drive, formulário funcionários
    const obs = lead.observacoes ?? ''
    const aviso49Pendente = obs.includes('[AVISO_49_PENDENTE')
    const aviso50Pendente = obs.includes('[AVISO_50_PENDENTE')
    const aviso70Pendente = obs.includes('[AVISO_70_PENDENTE')
    const aviso70KitPendente = obs.includes('[AVISO_70KIT_PENDENTE')
    if (aviso49Pendente || aviso50Pendente || aviso70Pendente || aviso70KitPendente) {
      try {
        const nomeContato = normalizaNome(lead.nome) || 'Lojista'
        const msgsPraReenviar: string[] = []
        if (aviso49Pendente) {
          msgsPraReenviar.push(buildAvisoColetandoComplementoMsg(nomeContato))
        }
        if (aviso50Pendente) {
          msgsPraReenviar.push(buildAvisoCadastroMsg(nomeContato))
        }
        if (aviso70Pendente) {
          msgsPraReenviar.push(...buildAvisoTreinamentoMsgs())
        }
        if (aviso70KitPendente) {
          msgsPraReenviar.push(buildKitPosFechamentoMsg(nomeContato))
        }
        for (const msg of msgsPraReenviar) {
          try {
            await sendText(lead.telefone, msg, lead.evotalks_chat_id)
            await saveMensagem(lead.id, 'out', msg)
            await new Promise(r => setTimeout(r, 500)) // pequena pausa entre msgs
          } catch (sendErr) {
            console.error(`[Caminho2] Falha ao reenviar aviso pra ${lead.telefone}:`, sendErr)
          }
        }
        // Limpa as flags após o reforço (idempotência)
        const obsLimpa = obs
          .replace(/\[AVISO_49_PENDENTE:[^\]]+\]\s*/g, '')
          .replace(/\[AVISO_50_PENDENTE:[^\]]+\]\s*/g, '')
          .replace(/\[AVISO_70_PENDENTE:[^\]]+\]\s*/g, '')
          .replace(/\[AVISO_70KIT_PENDENTE:[^\]]+\]\s*/g, '')
          .trim()
        await supabaseAdmin
          .from('sdr_leads')
          .update({ observacoes: obsLimpa || null })
          .eq('id', lead.id)
        lead.observacoes = obsLimpa
        console.log(`[Caminho2] Lead ${lead.telefone}: ${msgsPraReenviar.length} aviso(s) reforçado(s) (flags limpas)`)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[Caminho2] Erro ao processar reforço de avisos pra ${lead.telefone}:`, errMsg)
      }
    }

    // 8b². GUIA DE VENDAS — link clicável e encaminhável (pedido do Aldo 2026-07-31)
    // O HSM do guia leva a URL como TEXTO (parâmetro de template não vira link
    // no WhatsApp). Na PRIMEIRA resposta do lojista após receber o aviso
    // ([GUIA_VENDAS_ENVIADO] sem [GUIA_LINK_OK]), manda uma mensagem separada
    // só com o link — clicável e pronta pro dono encaminhar pra equipe.
    {
      const obsGuia = lead.observacoes ?? ''
      if (obsGuia.includes('[GUIA_VENDAS_ENVIADO') && !obsGuia.includes('[GUIA_LINK_OK]')) {
        try {
          const msgGuia =
            `🎓 *Treinamento de Vendas no Crediário — AIVA × Track*\n` +
            `👉 https://sdr-aiva.vercel.app/treinamento-vendas.html\n\n` +
            `Encaminha essa mensagem pra sua equipe estudar — no final tem prova e certificado pra cada vendedor! 😉`
          await sendText(lead.telefone, msgGuia, lead.evotalks_chat_id)
          await saveMensagem(lead.id, 'out', msgGuia)
          const novaObsGuia = `${obsGuia.trim()} [GUIA_LINK_OK]`.trim()
          await supabaseAdmin.from('sdr_leads').update({ observacoes: novaObsGuia }).eq('id', lead.id)
          lead.observacoes = novaObsGuia
          console.log(`[GUIA_VENDAS] Link encaminhável enviado pra ${lead.telefone}`)
        } catch (err) {
          console.error(`[GUIA_VENDAS] Falha ao enviar link pra ${lead.telefone}:`, err)
        }
      }
    }

    // 8b³. TRAVA DE QSA — reforço da orientação + destrava (política 2026-08-03)
    // Lead sem sócio retido em Em Análise:
    //  a) Se a orientação do contador ficou pendente (janela fechada quando o
    //     Nei moveu o card), envia agora que o lead respondeu.
    //  b) Se o lead avisa que REGULARIZOU, re-consulta a Receita na hora:
    //     QSA apareceu → destrava, confirma pro lojista e avisa o Nei;
    //     ainda vazio → a VictorIA explica (nota de sistema injetada no turno).
    let conteudoParaClaude = conteudoEfetivo
    {
      const obsTrava = lead.observacoes ?? ''
      if (obsTrava.includes('[TRAVA_QSA_PENDENTE]')) {
        try {
          const msgTrava = buildMsgTravaQsa(normalizaNome(lead.nome))
          await sendText(lead.telefone, msgTrava, lead.evotalks_chat_id)
          await saveMensagem(lead.id, 'out', msgTrava)
          const obsSemPend = obsTrava.replace(/\s*\[TRAVA_QSA_PENDENTE\]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
          const novaObsTrava = `${obsSemPend} [TRAVA_QSA_MSG:${new Date().toISOString()}]`.trim()
          await supabaseAdmin.from('sdr_leads').update({ observacoes: novaObsTrava }).eq('id', lead.id)
          lead.observacoes = novaObsTrava
          console.log(`[TRAVA_QSA] Orientação do contador reforçada pra ${lead.telefone}`)
        } catch (err) {
          console.error(`[TRAVA_QSA] Falha no reforço da orientação pra ${lead.telefone}:`, err)
        }
      }

      if (
        (lead.observacoes ?? '').includes('[TRAVA_QSA]') &&
        /regulariz|resolvid|resolveu|atualizad|arrumad|arrumou|j[áa]\s*consta|apareceu|contador\s*(fez|resolveu|atualizou|arrumou)/i.test(conteudoEfetivo)
      ) {
        const cnpjTrava = ((lead.observacoes ?? '').match(/\[CNPJ_RECEITA:cnpj=(\d{14})/)?.[1]) ??
          ((lead.observacoes ?? '').match(/cnpj_matriz=(\d{14})/)?.[1] ?? '')
        if (cnpjTrava.length === 14) {
          try {
            const infoRecheck = await consultarCNPJ(cnpjTrava)
            if (infoRecheck && infoRecheck.qsaCount > 0) {
              // ✅ Destravou: atualiza marcadores, confirma pro lojista e encerra o turno
              const obsAtualT = lead.observacoes ?? ''
              const novaObs = obsAtualT
                .replace(/\[CNPJ_RECEITA:[^\]]*\]\s*/g, '')
                .replace(/\s*\[TRAVA_QSA\]\s*/g, ' ')
                .replace(/\s*\[TRAVA_QSA_MSG:[^\]]+\]\s*/g, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim()
              const obsFinal = `${novaObs} ${cnpjInfoMarker(infoRecheck)} [TRAVA_QSA_OK:${new Date().toISOString()}]`.trim()
              await supabaseAdmin.from('sdr_leads').update({ observacoes: obsFinal }).eq('id', lead.id)
              const msgOk =
                `Ótima notícia! 🎉 Acabei de consultar aqui e o quadro societário do seu CNPJ *já está atualizado* na Receita Federal.\n\n` +
                `Pode deixar que já aviso o time pra dar sequência na sua aprovação — qualquer novidade te retorno por aqui!`
              await sendText(lead.telefone, msgOk, lead.evotalks_chat_id)
              await saveMensagem(lead.id, 'out', msgOk)
              const alertaOk =
                `🔓 *QSA REGULARIZADO — ${lead.nome}* (${lead.telefone})\n` +
                `O lojista regularizou o quadro societário (${infoRecheck.qsaCount} sócio${infoRecheck.qsaCount > 1 ? 's' : ''} na Receita agora). ` +
                `A trava foi removida — pode seguir com a aprovação/CAF.`
              if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, alertaOk)
              if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, alertaOk)
              console.log(`[TRAVA_QSA] ${lead.telefone} destravado — QSA com ${infoRecheck.qsaCount} sócio(s)`)
              return NextResponse.json({ ok: true, trava_qsa: 'destravado' })
            }
            // Ainda sem QSA → informa a VictorIA via nota de sistema neste turno
            conteudoParaClaude =
              `${conteudoEfetivo}\n[NOTA DO SISTEMA: o lojista indicou que regularizou, e a Receita foi RE-CONSULTADA agora — o quadro societário AINDA NÃO consta. Informe com gentileza que ainda não aparece na consulta, que a sincronização Junta→Receita pode levar alguns dias, e sugira confirmar com o contador se o processo foi concluído.]`
            console.log(`[TRAVA_QSA] ${lead.telefone} re-checado — QSA ainda vazio`)
          } catch (err) {
            console.error(`[TRAVA_QSA] Falha na re-consulta da Receita pra ${lead.telefone}:`, err)
          }
        }
      }
    }

    // 8c. Detector de ERRO DE PORTAL (curadoria 2026-07-27)
    // Lead pós-cadastro relatando erro/travamento no portal UME (biometria,
    // "sistema pede sócio", senha incorreta, link quebrado...) → alerta 🛠
    // imediato pro time. A VictorIA não resolve erro de sistema — sem esse
    // alerta a queixa morria na conversa. Cooldown de 24h por lead (sdr_alertas).
    const STATUS_POS_CADASTRO = ['CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']
    if (STATUS_POS_CADASTRO.includes(lead.status) && conteudoEfetivo) {
      const txt = conteudoEfetivo
      // "erro"/travou/biometria sozinhos já bastam; "não consigo/funciona" só
      // conta se vier com contexto de portal (evita falso positivo tipo
      // "não consigo nesse horário" falando do treinamento).
      const erroForte = /\berro\b|travou|travando|senha incorreta|biometria|\bbug\b/i.test(txt)
      const naoConsigo = /n[ãa]o (?:consigo|consegui|t[ôo] conseguindo|est(?:ou|á) conseguindo|funciona|deixa)/i.test(txt)
      const contextoPortal = /cadastr|acess|login|senha|entrar|sistema|\bsite\b|\bapp\b|aplicativo|painel|plataforma|foto|finalizar|avan[çc]ar|\blink\b/i.test(txt)

      // ALGO QUE NÃO CHEGA (Carlos Celulares 11/08/2026): "o SMS não está chegando"
      // não tem "erro" nem "não consigo", então passava batido — e é queixa de
      // sistema igual às outras: a biometria não conclui sem o SMS.
      const naoChega =
        /n[ãa]o (?:chegou|chega|est[áa] chegando|recebi|recebo|veio|vem)/i.test(txt) &&
        /\bsms\b|c[óo]digo|\blink\b|e-?mail|acesso|senha|biometria|token/i.test(txt)

      // FINANCEIRO / REPASSE (Conecta Cell 10-11/08/2026): repasse de venda que
      // não caiu é reclamação de sistema pro lojista — some no chat se não virar
      // chamado. Foi o caso que escalou até ameaça de parar de vender.
      // "prazo" sozinho fica de fora: "Qual o prazo de pagamento?" é pergunta, não
      // queixa — precisa de sinal explícito de atraso/não-recebimento.
      const financeiro =
        /repasse|pagamento|transfer[êe]ncia|dep[óo]sito/i.test(txt) &&
        /n[ãa]o (?:caiu|recebi|foi|chegou|pagou|veio)|atras|pendente|ultrapass|sem retorno|n[ãa]o consta/i.test(txt)

      // RECLAMAÇÃO DE APROVAÇÃO (Tech Point 07/08/2026: "Não aprovou nada").
      // Regra deliberadamente estreita — na amostra de 6 semanas, a maioria das
      // frases com "não aprova" era PERGUNTA sobre a política ("não aprova MEI?",
      // "aprova negativado?"), não queixa. Por isso três travas juntas:
      //   1. só loja que JÁ está vendendo (quem ainda nem operou não tem o que reclamar);
      //   2. pergunta não conta (termina em "?");
      //   3. exige resultado ruim explícito — nada/ninguém/nenhum/só reprova.
      const reclamacaoAprovacao =
        lead.status === 'LOJA_FINALIZADA_E_VENDENDO' &&
        !/\?\s*$/.test(txt.trim()) &&
        /n[ãa]o (?:aprov(?:a|ou|aram)|passou|passa) (?:nada|ningu[ée]m|nenhum|nenhuma)|nenhuma aprova|nunca aprova|s[óo] (?:reprova|recusa|nega)|clientes? n[ãa]o (?:aprova|aprovam|aprovou)|aprova[çc][ãa]o (?:muito )?baixa|reprov(?:ou|a) (?:tudo|todos)|recus(?:ou|a) (?:tudo|todos)/i.test(txt)

      if (erroForte || naoChega || financeiro || reclamacaoAprovacao || (naoConsigo && contextoPortal)) {
        try {
          const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
          const { data: jaAlertou } = await supabaseAdmin
            .from('sdr_alertas')
            .select('id')
            .like('mensagem', '%ERRO DE PORTAL%')
            .like('mensagem', `%${lead.telefone}%`)
            .gte('criado_em', cutoff24h)
            .limit(1)
            .maybeSingle()
          if (!jaAlertou) {
            const alerta =
              `🛠 *POSSÍVEL ERRO DE PORTAL/SISTEMA*\n\n` +
              `🏪 ${lead.nome}\n` +
              `📞 ${lead.telefone}\n` +
              `📌 Status: ${lead.status}\n\n` +
              `💬 "${txt.slice(0, 300)}"\n\n` +
              `Se for erro do portal UME, abrir chamado com a AIVA (Eduardo).`
            if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, alerta)
            if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, alerta)
            console.log(`[ERRO_PORTAL] Alerta disparado pra ${lead.telefone} (status ${lead.status})`)
            // Aba "Chamados" da planilha (pedido do Aldo 2026-08-05): registro
            // formal do problema pro Edu/Nei resolverem (coluna Resolvido = X
            // manual). Mesmo dedupe de 24h do alerta — 1 chamado por queixa.
            // O "Problema Relatado" é um RESUMO gerado da conversa (a frase
            // crua do lojista — "tá dando erro" — não diz nada); se o resumo
            // falhar, cai na frase crua.
            try {
              const cnpjChamado =
                String(dadosAcumulados?.cnpj_matriz ?? '').replace(/\D/g, '') ||
                ((lead.observacoes ?? '').match(/cnpj_matriz=(\d{14})/)?.[1] ?? '')
              let problemaResumo = ''
              try {
                problemaResumo = await resumirProblemaChamado(historico, lead.status)
              } catch (errRes) {
                console.error(`[ERRO_PORTAL] Resumo do chamado falhou pra ${lead.telefone}:`, errRes)
              }
              await registrarChamado({
                loja: lead.nome,
                telefone: lead.telefone,
                cnpj: cnpjChamado || null,
                problema: (problemaResumo || txt).slice(0, 400),
              })
              console.log(`[ERRO_PORTAL] Chamado registrado na planilha pra ${lead.telefone}`)
            } catch (errCh) {
              console.error(`[ERRO_PORTAL] Falha ao registrar chamado pra ${lead.telefone}:`, errCh)
            }
          }
        } catch (err) {
          console.error(`[ERRO_PORTAL] Falha no detector pra ${lead.telefone}:`, err)
        }
      }
    }

    // 8d. Detector de LOJA FINALIZADA SEM OPERAR (curadoria 2026-07-27)
    // Loja na etapa final do funil revelando que NUNCA operou ("não tenho
    // login", "ainda não vendemos", "não começamos") → alerta 🚩 pro time
    // reclassificar o card e destravar. Cooldown de 7 dias por lead.
    if (lead.status === 'LOJA_FINALIZADA_E_VENDENDO' && conteudoEfetivo) {
      const semOperar =
        /(?:ainda\s+)?n[ãa]o\s+(?:vendi|vendemos|come[çc](?:ei|amos|ou)|iniciamos|operamos|opero)|nenhuma venda|sem vender|n[ãa]o (?:recebi|tenho|chegou) (?:o |a |meu )?(?:login|acesso|senha|c[óo]digo)|aguardando (?:o |a )?(?:acesso|login|libera[çc][ãa]o)|n[ãa]o (?:fiz|fizemos|participei) (?:o |do )?treinamento/i
          .test(conteudoEfetivo)
      if (semOperar) {
        try {
          const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
          const { data: jaAlertou } = await supabaseAdmin
            .from('sdr_alertas')
            .select('id')
            .like('mensagem', '%LOJA FINALIZADA SEM OPERAR%')
            .like('mensagem', `%${lead.telefone}%`)
            .gte('criado_em', cutoff7d)
            .limit(1)
            .maybeSingle()
          if (!jaAlertou) {
            const alerta =
              `🚩 *LOJA FINALIZADA SEM OPERAR*\n\n` +
              `🏪 ${lead.nome}\n` +
              `📞 ${lead.telefone}\n` +
              `📌 Etapa no funil: Loja Finalizada e Vendendo\n\n` +
              `💬 "${conteudoEfetivo.slice(0, 300)}"\n\n` +
              `A loja está na etapa final mas indica que ainda não opera. ` +
              `Verificar o que travou (acesso/treinamento) e reclassificar o card se preciso.`
            if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, alerta)
            if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, alerta)
            console.log(`[CHECK_VENDA] Loja finalizada sem operar detectada: ${lead.telefone}`)
          }
        } catch (err) {
          console.error(`[CHECK_VENDA] Falha no detector pra ${lead.telefone}:`, err)
        }
      }
    }

    // 8e. FLUXO DE DOCUMENTOS (empresa sem sócio) — encaminha mídias pro Drive.
    // Varre o HISTÓRICO (não só o fileId do request atual): em bursts o turno de
    // uma mídia pode ser absorvido pelo lock e ela ficaria de fora (caso
    // Macinplace: selfie nunca subiu). Idempotência via [DOCS_UP:id1,id2] em
    // observacoes — o mesmo arquivo reenviado pelo lead não sobe de novo (caso
    // Macinplace: CNH 3× no Drive). Best-effort: falha não interrompe o fluxo.
    if ((lead.observacoes ?? '').includes('[DOCS_SEM_SOCIO]')) {
      try {
        const obsDocs = lead.observacoes ?? ''
        const jaEnviados = new Set(
          (obsDocs.match(/\[DOCS_UP:([\d,]+)\]/)?.[1] ?? '').split(',').filter(Boolean),
        )
        // Mídias do lead no histórico + a do request atual (pode ainda não estar lá)
        const pendentes = new Map<string, { mime: string; nome: string }>()
        for (const m of historicoRaw) {
          if (m.direcao !== 'in') continue
          for (const mm of (m.conteudo ?? '').matchAll(/\[LEAD_ENVIOU_IMAGEM:(\d+)\]/g)) {
            if (!jaEnviados.has(mm[1])) pendentes.set(mm[1], { mime: '', nome: '' })
          }
          for (const mm of (m.conteudo ?? '').matchAll(/\[LEAD_ENVIOU_ARQUIVO:(\d+):([^:\]]*):([^\]]*)\]/g)) {
            if (!jaEnviados.has(mm[1])) pendentes.set(mm[1], { mime: mm[2], nome: mm[3] })
          }
        }
        if (fileId && fileId > 0 && !jaEnviados.has(String(fileId))) {
          pendentes.set(String(fileId), {
            mime: mimeType || '',
            nome: fileName && fileName !== 'undefined' ? fileName : '',
          })
        }
        const cnpjLead = obsDocs.match(/cnpj_matriz=(\d{14})/)?.[1] ?? ''
        const enviadosAgora: string[] = []
        for (const [idStr, info] of pendentes) {
          try {
            const arq = await downloadAudio(Number(idStr)) // downloader genérico do Evo
            const mime = arq.mimeType || info.mime || 'application/octet-stream'
            // Áudio é conversa (já transcrito no fluxo normal), não documento
            if (mime.startsWith('audio/')) {
              enviadosAgora.push(idStr)
              continue
            }
            const ext = mime.includes('pdf') ? '.pdf' : mime.includes('png') ? '.png' : mime.includes('jpe') ? '.jpg' : ''
            const nomeArq = info.nome && info.nome !== 'undefined' ? info.nome : `documento-${idStr}${ext}`
            const urlDrive = await enviarDocParaDrive({
              loja: lead.nome,
              cnpj: cnpjLead,
              telefone: lead.telefone,
              nomeArquivo: nomeArq,
              mimeType: mime,
              base64: arq.buffer.toString('base64'),
            })
            if (urlDrive) {
              enviadosAgora.push(idStr)
              console.log(`[MANUAL_DOCS] Doc ${idStr} do lead ${lead.telefone} salvo no Drive: ${urlDrive}`)
            }
          } catch (err) {
            // id fica fora do marcador → nova tentativa no próximo turno do lead
            console.error(`[MANUAL_DOCS] Falha ao encaminhar mídia ${idStr} pro Drive:`, err)
          }
        }
        if (enviadosAgora.length) {
          const todos = [...jaEnviados, ...enviadosAgora]
          const novaObs = obsDocs.includes('[DOCS_UP:')
            ? obsDocs.replace(/\[DOCS_UP:[\d,]*\]/, `[DOCS_UP:${todos.join(',')}]`)
            : `${obsDocs} [DOCS_UP:${todos.join(',')}]`.trim()
          await supabaseAdmin.from('sdr_leads').update({ observacoes: novaObs }).eq('id', lead.id)
          lead.observacoes = novaObs // remonte de observacoes lá embaixo parte daqui
        }
      } catch (err) {
        console.error(`[MANUAL_DOCS] Falha na varredura de docs pro Drive (${lead.telefone}):`, err)
      }
    }

    // 9. Processa com Claude (VictorIA)
    // Passa o status atual pra Claude saber em qual fase do fluxo está
    // (Fase 1 = INTERESSADO, Fase 2 = PRE_APROVACAO, Fase 3 = INTERESSADO).
    // O produto determina o prompt: AIVA (default) ou TRIAGEM (lead inbound puro).
    let resposta
    try {
      // Trava de QSA ativa (sem sócio, política 2026-08-03)? Injeta o bloco de
      // contexto pra VictorIA orientar o contador na fase Em Análise.
      const travaQsa =
        (lead.observacoes ?? '').includes('[TRAVA_QSA]') &&
        lead.status === 'EM_ANALISE_AIVA'
      // leadEmFase3 vem do Evo (item 4b), com o marcador em observacoes como
      // fallback — o status sozinho não distingue Fase 1 de Fase 3.
      resposta = await processarMensagem(conteudoParaClaude, historico, lead.nome, lead.status, lead.produto, dadosAcumulados, imagemPraClaude, lead.instrucao_silvia, travaQsa, leadEmFase3)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const errStack = err instanceof Error ? err.stack : undefined
      console.error('Erro ao processar com Claude:', errMsg, errStack)

      // ── Retry bounded: erro transitório da Claude se recupera sozinho ──
      // Conta tentativas em observacoes. Até MAX_RETRY, marca [REPROCESS_PENDENTE:n]
      // pra estratégia 0 do auto-reprocess re-disparar. Esgotou → para e escala humano.
      const agoraISO = new Date().toISOString()
      const errResumo = errMsg.substring(0, 150).replace(/[\[\]]/g, '')
      const isReprocess = req.headers.get('x-auto-reprocess') === 'true'
      const MAX_RETRY = 4
      const obsAtual = lead.observacoes ?? ''
      const tentativas = parseInt(obsAtual.match(/\[REPROCESS_PENDENTE:(\d+)\]/)?.[1] ?? '0', 10) + 1
      const obsLimpa = obsAtual
        .replace(/\[REPROCESS_PENDENTE:\d+\]\s*/g, '')
        .replace(/\[REPROCESS_ESGOTADO\]\s*/g, '')
        .replace(/\[CLAUDE_ERR:[^\]]+\]\s*/g, '')
        .trim()

      // Marcador OUT (balanceia IN/OUT → estratégias 1/2 do auto-reprocess não tocam;
      // quem cuida é a estratégia 0, guiada pela flag REPROCESS_PENDENTE). É filtrado
      // antes do prompt (stripInternalMarkers via regex /^\[.*\]$/).
      await saveMensagem(lead.id, 'out', `[CLAUDE_ERR:${agoraISO}:${errResumo}]`)

      if (tentativas >= MAX_RETRY) {
        // Esgotou o retry automático (Claude provavelmente fora do ar) → para e escala.
        await supabaseAdmin.from('sdr_leads')
          .update({ observacoes: `[REPROCESS_ESGOTADO] ${obsLimpa}`.trim() })
          .eq('id', lead.id)
        const msg = `🚨 *${lead.nome}* (${lead.telefone}) — a IA falhou ${tentativas}x seguidas processando "${conteudoEfetivo}". A Claude pode estar fora do ar. Precisa de intervenção MANUAL.`
        if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
        if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
        return NextResponse.json({ ok: false, erro: 'claude_error_esgotado', tentativas }, { status: 500 })
      }

      // Dentro do limite → marca pra retry automático.
      await supabaseAdmin.from('sdr_leads')
        .update({ observacoes: `[REPROCESS_PENDENTE:${tentativas}] ${obsLimpa}`.trim() })
        .eq('id', lead.id)

      // Só na PRIMEIRA falha (mensagem orgânica do lojista) manda o fallback amigável
      // e alerta o time. Nas retentativas automáticas não repete (evita spam pro lojista
      // e pros humanos) — o alerta volta só se o retry esgotar (bloco acima).
      if (!isReprocess) {
        try {
          await sendText(lead.telefone, FALLBACK_MENSAGEM_OVERLOADED, lead.evotalks_chat_id)
          await saveMensagem(lead.id, 'out', FALLBACK_MENSAGEM_OVERLOADED)
        } catch (sendErr) {
          console.error('Falha ao enviar fallback message ao lead:', sendErr instanceof Error ? sendErr.message : String(sendErr))
        }
        const msg = `🚨 Erro ao processar mensagem de *${lead.nome}* (${lead.telefone}).\nMensagem: "${conteudoEfetivo}"\nLead recebeu fallback; tentando recuperar automaticamente (até ${MAX_RETRY}x).`
        if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
        if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
      }
      return NextResponse.json({ ok: false, erro: 'claude_error', tentativas, retry: true }, { status: 500 })
    }

    // Sucesso da IA → limpa flags de erro/retry (in-memory + DB) pra não re-disparar.
    if (/\[(REPROCESS_PENDENTE|CLAUDE_ERR|REPROCESS_ESGOTADO)/.test(lead.observacoes ?? '')) {
      lead.observacoes = (lead.observacoes ?? '')
        .replace(/\[REPROCESS_PENDENTE:\d+\]\s*/g, '')
        .replace(/\[REPROCESS_ESGOTADO\]\s*/g, '')
        .replace(/\[CLAUDE_ERR:[^\]]+\]\s*/g, '')
        .trim()
      await supabaseAdmin.from('sdr_leads').update({ observacoes: lead.observacoes }).eq('id', lead.id)
    }

  // 9a. GUARD UNIVERSAL ANTI-REGRESSÃO (raiz do bug "Mundo das Capas", 03/06/2026)
  // ───────────────────────────────────────────────────────────────────────────
  // Sintoma: lead que JÁ avançou no funil (Cadastro Recebido, Em Análise, Treinar)
  // manda uma mensagem, a VictorIA retorna um status de fase ANTERIOR (mais comum:
  // INTERESSADO), e o sistema regredia a opp — tanto o status no Supabase (linha
  // ~858) quanto a stage no Evo (changeOpportunityStage, linhas ~991/1107, que são
  // condicionados a resposta.novo_status).
  //
  // Os guards 9b/9c abaixo cobriam só CADASTRO_RECEBIDO e PRE_APROVACAO como ALVO,
  // mas NÃO cobriam INTERESSADO — que foi exatamente o que regrediu os leads.
  //
  // Este guard é a defesa CENTRAL: se o status retornado representa uma etapa
  // ANTERIOR à etapa atual do lead (na progressão linear do funil), preserva o
  // status atual. Como roda ANTES de tudo, protege Supabase E Evo de uma vez.
  //
  // Stages laterais (SEM_RESPOSTA, OPT_OUT, NAO_QUALIFICADO, AGUARDANDO,
  // DESCARTADO, BOT_DETECTADO) ficam FORA da ordem → nunca bloqueiam (um lead
  // pode legitimamente pedir OPT_OUT ou ser detectado como bot em qualquer fase).
  const ORDEM_STATUS_FUNIL: Record<string, number> = {
    INICIO: 0,
    INTERESSADO: 1,
    PRE_APROVACAO: 2,
    CADASTRO_RECEBIDO: 3,
    EM_ANALISE_AIVA: 4,
    TREINAR: 5,
    LOGIN: 6,
    LOJA_FINALIZADA_E_VENDENDO: 7,
  }
  {
    const ordAtual = ORDEM_STATUS_FUNIL[lead.status]
    const ordNova = ORDEM_STATUS_FUNIL[resposta.novo_status]
    if (ordAtual !== undefined && ordNova !== undefined && ordNova < ordAtual) {
      console.log(
        `[guard-regressao] ${lead.telefone}: VictorIA retornou ${resposta.novo_status} ` +
        `(ordem ${ordNova}) mas lead está em ${lead.status} (ordem ${ordAtual}). ` +
        `REGRESSÃO BLOQUEADA — mantendo ${lead.status}.`,
      )
      resposta.novo_status = lead.status as typeof resposta.novo_status
    }
  }

  // 9b. Defesa em profundidade — bloqueia transição CADASTRO_RECEBIDO indevida.
  // VictorIA só pode marcar CADASTRO_RECEBIDO quando o lead JÁ ESTÁ em
  // INTERESSADO (Fase 3 ativada pelo operador via stage CADASTRO_RECEBIDO).
  // Se a IA tentar pular direto da Fase 1 (INTERESSADO) ou Fase 2 pra CADASTRO_RECEBIDO,
  // reescreve a mensagem e mantém o status atual antes de enviar qualquer coisa pro lead.
  // Pre-guard: se lead já está em fase SUPERIOR a CADASTRO_RECEBIDO
  // (EM_ANALISE_AIVA/TREINAR) e VictorIA retorna CADASTRO_RECEBIDO, isso é
  // REGRESSÃO disfarçada. Forçamos o status atual pra evitar:
  // 1) Disparar alerta "✅ completou o cadastro" repetidamente (race com opp-stage)
  // 2) Re-executar fluxos de Pré Aprovação / Google Sheets
  // 3) Confundir a VictorIA com regressão fantasma
  // Caso real Fone Express (5531972337505, 13/05 14:07): lead chegou em TREINAR
  // (após opp-stage handler stage 70), mas VictorIA continuou retornando
  // CADASTRO_RECEBIDO → alerta duplicado pro Aldo/Nei.
  const FASES_AVANCADAS_CADASTRO = ['EM_ANALISE_AIVA', 'TREINAR']
  if (
    resposta.novo_status === 'CADASTRO_RECEBIDO' &&
    FASES_AVANCADAS_CADASTRO.includes(lead.status)
  ) {
    console.log(
      `[guard] Lead ${lead.telefone}: VictorIA retornou CADASTRO_RECEBIDO mas lead ja em ${lead.status}. Mantendo status atual (sem regressao nem re-alerta).`,
    )
    resposta.novo_status = lead.status as typeof resposta.novo_status
  }

  // Guard só atua em TRANSIÇÕES inválidas. Se lead já está em CADASTRO_RECEBIDO
  // ou status superior (EM_ANALISE_AIVA/TREINAR) e VictorIA retorna CADASTRO_RECEBIDO
  // (mantendo), não é "pulo" — é manutenção idempotente.
  const ESTADOS_VALIDOS_CADASTRO_RECEBIDO = [
    'INTERESSADO', 'CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR',
  ]
  if (
    resposta.novo_status === 'CADASTRO_RECEBIDO' &&
    !ESTADOS_VALIDOS_CADASTRO_RECEBIDO.includes(lead.status)
  ) {
    console.warn(
      `[guard] Lead ${lead.telefone}: VictorIA tentou CADASTRO_RECEBIDO com status atual = ${lead.status}. Bloqueado.`,
    )
    // Fallback seguro: SEMPRE preserva o status atual do lead (nunca regride).
    // Inclui fases avançadas (CADASTRO_RECEBIDO, EM_ANALISE_AIVA, TREINAR) pra
    // evitar o bug onde lead em CADASTRO_RECEBIDO era jogado de volta pra INTERESSADO
    // quando VictorIA retornava status errado. Só usa INTERESSADO como ultimo recurso
    // pra status totalmente inválidos (OPT_OUT/NAO_QUALIFICADO/DESCARTADO).
    const STATUS_VALIDOS_IA = [
      'INTERESSADO', 'AGUARDANDO', 'PRE_APROVACAO',
      'INTERESSADO', 'CADASTRO_RECEBIDO',
      'EM_ANALISE_AIVA', 'TREINAR',
    ]
    resposta.novo_status = (STATUS_VALIDOS_IA.includes(lead.status) ? lead.status : 'INTERESSADO') as typeof resposta.novo_status
    resposta.mensagem = 'Posso te tirar mais alguma dúvida sobre como a AIVA funciona?'
    try {
      const msg = `⚠️ *${lead.nome}* (${lead.telefone}) — VictorIA tentou pular direto pra CADASTRO_RECEBIDO sem passar pela Fase 1/2 (status atual: ${lead.status}). Mensagem reescrita e status mantido.`
      if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
      if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
    } catch (err) {
      console.error('[guard] falha ao alertar humanos:', err)
    }
  }

  // 9c. Defesa em profundidade — bloqueia transição PRE_APROVACAO indevida.
  // PRE_APROVACAO só pode vir de estados de Fase 1 (INTERESSADO, INICIO,
  // SEM_RESPOSTA) ou de uma re-mensagem espontânea quando já está PRE_APROVACAO/AGUARDANDO.
  // Se a IA tentar promover lead de Fase 3 (INTERESSADO/CADASTRO_RECEBIDO) ou de
  // estado terminal (NAO_QUALIFICADO/OPT_OUT/etc) pra PRE_APROVACAO, bloqueia.
  const ESTADOS_VALIDOS_PRE_APROVACAO = [
    'INTERESSADO', 'INICIO', 'SEM_RESPOSTA', 'PRE_APROVACAO', 'AGUARDANDO',
  ]
  if (
    resposta.novo_status === 'PRE_APROVACAO' &&
    !ESTADOS_VALIDOS_PRE_APROVACAO.includes(lead.status)
  ) {
    console.warn(
      `[guard] Lead ${lead.telefone}: VictorIA tentou PRE_APROVACAO com status atual = ${lead.status}. Bloqueado.`,
    )
    // SEMPRE preserva o status atual — nunca regride lead de fase avançada
    // (CADASTRO_RECEBIDO/EM_ANALISE_AIVA/TREINAR) pra INTERESSADO por engano.
    // Bug raiz fixado 2026-05-11: lead JF CELULARES regrediu de CADASTRO_RECEBIDO
    // pra PRE_APROVACAO porque CADASTRO_RECEBIDO não estava no fallback.
    const STATUS_FALLBACK = [
      'INTERESSADO', 'AGUARDANDO', 'INTERESSADO',
      'CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR',
    ]
    resposta.novo_status = (STATUS_FALLBACK.includes(lead.status) ? lead.status : 'INTERESSADO') as typeof resposta.novo_status
    // Mensagem fallback adaptada ao status — não fica fora de contexto
    if (['CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR'].includes(lead.status)) {
      resposta.mensagem = 'Show! Vou acompanhar aqui e te aviso quando tiver novidades. 👍'
    } else {
      resposta.mensagem = 'Tô seguindo aqui com você, qualquer dúvida me chama 👍'
    }
    try {
      const msg = `⚠️ *${lead.nome}* (${lead.telefone}) — VictorIA tentou voltar pra PRE_APROVACAO de um status inválido (atual: ${lead.status}). Mensagem reescrita e status mantido.`
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

  // ═══ VALIDAÇÃO AUTOMÁTICA DO CNPJ (fluxo definido pelo Aldo 2026-07-27) ═══
  // Roda ANTES do envio da resposta, no turno em que o cnpj_matriz chega:
  //   1) Base AIVA/Odres (aiva_base_cnpjs) → já é cliente? mensagem oficial
  //      da Odres + funil 19 + encerra. NÃO consulta Receita (evita conflito).
  //   2) Receita (BrasilAPI):
  //      - idade < 1 ano  → NAO_QUALIFICADO automático + mensagem educada
  //      - situação ≠ ATIVA → alerta pro time (sem mudar status)
  //      - sem sócio → pede os 5 documentos (fluxo Drive + planilha Manual)
  let cnpjInfoNovo: import('@/lib/cnpj').CNPJInfo | null = null
  let pedirDocsSemSocio = false
  {
    const cnpjPraChecar = String(resposta.dados_coletados?.cnpj_matriz ?? '').replace(/\D/g, '')
    const jaConsultado = (lead.observacoes ?? '').includes(`[CNPJ_RECEITA:cnpj=${cnpjPraChecar}`)
    if (cnpjPraChecar.length === 14 && !jaConsultado && resposta.novo_status !== 'ODRES' && resposta.novo_status !== 'UME') {
      // 1) Base AIVA/Odres
      let naBaseAiva = false
      try {
        const { data: naBase } = await supabaseAdmin
          .from('aiva_base_cnpjs')
          .select('cnpj, nome')
          .eq('cnpj', cnpjPraChecar)
          .maybeSingle()
        if (naBase) {
          naBaseAiva = true
          console.log(`[BASE_AIVA] CNPJ ${cnpjPraChecar} já está na base (${naBase.nome ?? '?'}) → fluxo ODRES automático`)
          resposta.novo_status = 'ODRES'
          try {
            // 📇 (e não 📋): o emoji inicial define o TIPO na página /alertas —
            // 📋 é o filtro "Dados de colaborador" e colidia (bug 2026-07-29).
            const alerta =
              `📇 *LEAD JÁ É DA BASE AIVA/ODRES*\n\n` +
              `🏪 ${lead.nome}\n` +
              `📞 ${lead.telefone}\n` +
              `🏢 CNPJ: ${cnpjPraChecar}\n` +
              `📄 Na base como: ${naBase.nome ?? '—'}\n\n` +
              `Barrado automaticamente: a VictorIA já enviou a mensagem oficial da Odres e a oportunidade vai pro funil de integração. Nenhuma ação necessária.`
            if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, alerta)
            if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, alerta)
          } catch (errAlerta) {
            console.error('[BASE_AIVA] Falha no alerta:', errAlerta)
          }
        }
      } catch (err) {
        console.error(`[BASE_AIVA] Falha na checagem do CNPJ ${cnpjPraChecar}:`, err)
      }

      // 2) Receita — só se NÃO for cliente da base
      if (!naBaseAiva) {
        try {
          const consulta = await consultarCNPJDetalhado(cnpjPraChecar)
          cnpjInfoNovo = consulta.info

          // CNPJ que a Receita não conhece NÃO passa (bug ICONNECT 11/08/2026).
          // É recém-aberto (logo, reprovado pela regra de 1 ano) ou digitado
          // errado — nos dois casos, pré-aprovar é o pior desfecho: o lojista
          // avança, empaca no portal da AIVA e volta reclamando. Não desqualifico
          // direto porque pode ser erro de digitação, e NAO_QUALIFICADO faria o
          // webhook ignorar a correção dele. Então: segura, pergunta e chama humano.
          if (!consulta.info && (consulta.status === 'nao_encontrado' || consulta.status === 'invalido')) {
            const ehInvalido = consulta.status === 'invalido'
            resposta.novo_status = 'INTERESSADO'
            resposta.acionar_humano = true
            resposta.motivo_humano =
              `${ehInvalido ? 'cnpj_invalido' : 'cnpj_nao_encontrado_na_receita'} | ${lead.nome} | CNPJ ${cnpjPraChecar}`
            resposta.mensagem = ehInvalido
              ? // DV não fecha: é digitação errada, quase certeza. Pede de novo sem
                // acusar o lojista e sem falar em reprovação — o número pode estar certo no papel.
                `Obrigada! 😊 Tentei validar o CNPJ ${cnpjPraChecar} aqui e ele não passou na verificação — parece que algum dígito ficou trocado ou faltando.\n\n` +
                `Pode conferir no cartão CNPJ e me mandar de novo? São 14 números. Assim que chegar certinho eu valido na hora e seguimos! 🙌`
              : `Obrigada, ${normalizaNome(lead.nome) || 'tudo bem'}! 😊 Consultei o CNPJ ${cnpjPraChecar} na Receita e ele ainda não aparece na base — isso costuma acontecer quando o CNPJ foi aberto há pouco tempo.\n\n` +
                `Só pra eu conferir: o número está certinho? Se tiver algum dígito trocado, me manda de novo que eu valido na hora.\n\n` +
                `Se estiver certo mesmo, é porque a empresa é bem recente — e hoje a AIVA pede CNPJ com pelo menos 1 ano de abertura. Nesse caso eu guardo seu contato e, assim que completar 1 ano, a gente segue o cadastro na hora! 🙌`
            const alerta = ehInvalido
              ? `🧾 *CNPJ INVÁLIDO (não passa no dígito verificador)*\n\n` +
                `🏪 ${lead.nome}\n📞 ${lead.telefone}\n🏢 CNPJ informado: ${cnpjPraChecar}\n\n` +
                `Esse número não é um CNPJ válido — erro de digitação ou inventado.\n` +
                `A VictorIA NÃO pré-aprovou: pediu o número correto. Nada a fazer por ora.`
              : `🧾 *CNPJ NÃO ENCONTRADO NA RECEITA*\n\n` +
                `🏪 ${lead.nome}\n📞 ${lead.telefone}\n🏢 CNPJ: ${cnpjPraChecar}\n\n` +
                `A consulta pública não achou esse CNPJ. Provável empresa recém-aberta (reprovaria pela regra de 1 ano) ou número digitado errado.\n` +
                `A VictorIA NÃO pré-aprovou: pediu confirmação do número e o lead está aguardando. Confiram se cabe exceção.`
            if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, alerta)
            if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, alerta)
            console.log(`[CNPJ] ${cnpjPraChecar} ${consulta.status} — pré-aprovação bloqueada`)
          }

          if (cnpjInfoNovo) {
            const info = cnpjInfoNovo
            const cabecalho =
              `🏪 ${lead.nome}\n` +
              `📞 ${lead.telefone}\n` +
              `🏢 CNPJ: ${info.cnpj}\n` +
              (info.razaoSocial ? `📄 Razão social: ${info.razaoSocial}\n` : '') +
              (info.abertura ? `📅 Abertura: ${info.abertura.split('-').reverse().join('/')}${info.idadeAnos != null ? ` (${info.idadeAnos} anos)` : ''}\n` : '') +
              (info.cnaeDescricao ? `🏷️ Atividade: ${info.cnaeDescricao}\n` : '')

            if (info.idadeAnos != null && info.idadeAnos < 1) {
              // Regra de corte: CNPJ < 1 ano → desqualifica na hora, mensagem educada
              resposta.novo_status = 'NAO_QUALIFICADO'
              resposta.acionar_humano = false
              resposta.motivo_humano = null
              resposta.mensagem =
                `Obrigada pelas informações! 😊 Fiz a verificação aqui e o CNPJ informado tem menos de 1 ano de abertura — e hoje, pra cadastrar na AIVA, precisamos de CNPJ com pelo menos 1 ano.\n\n` +
                `Assim que a loja completar 1 ano de CNPJ, é só me chamar aqui que seguimos com o cadastro na hora, combinado? Vou deixar seu contato guardado! 🙌`
              const alerta =
                `🧾 *CNPJ REPROVADO — MENOS DE 1 ANO*\n\n` + cabecalho +
                `\n🚫 Desqualificado automaticamente (regra de corte). A VictorIA já respondeu com a mensagem educada. Nenhuma ação necessária.`
              if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, alerta)
              if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, alerta)
            } else {
              const atencao: string[] = []
              if (info.situacao && info.situacao !== 'ATIVA') {
                atencao.push(`🚫 Situação cadastral: *${info.situacao}*`)
              }
              if (info.qsaCount === 0) {
                pedirDocsSemSocio = true // política 2026-08-03: marca [TRAVA_QSA] — retido em Em Análise até regularizar QSA
                atencao.push(`⚠️ Empresa *sem quadro societário (QSA)* na Receita — lead marcado com TRAVA: a qualificação segue normal, mas ele fica RETIDO na etapa Em Análise AIVA até regularizar com o contador (a orientação é enviada quando o card entrar em Em Análise).`)
              }
              if (atencao.length > 0) {
                const alerta = `🧾 *CONSULTA CNPJ (Receita) — ATENÇÃO*\n\n` + cabecalho + `\n${atencao.join('\n')}`
                if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, alerta)
                if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, alerta)
              }
            }
            console.log(`[CNPJ] ${cnpjPraChecar}: idade=${info.idadeAnos} situacao=${info.situacao} socios=${info.qsaCount}`)
          }
        } catch (err) {
          console.error(`[CNPJ] Falha na consulta pra ${lead.telefone}:`, err)
        }
      }
    }
  }

  // Leads cujo CNPJ foi consultado FORA do chat (backfill de 27/07) escapavam
  // do fluxo de documentos: o "jaConsultado" pulava o gatilho junto (bug
  // Magnífica 2026-07-29 — socios=0 na Receita e nenhum pedido de docs).
  // Deriva do MARCADOR: Receita diz sem sócio + fase pré/em análise + trava
  // ainda não marcada → marca [TRAVA_QSA] neste turno. Legados que JÁ
  // completaram os docs manuais ([LINHA_MANUAL_OK]) seguem o caminho antigo.
  {
    const FASES_TRAVA = ['INTERESSADO', 'PRE_APROVACAO', 'CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA']
    const obsLead = lead.observacoes ?? ''
    if (
      !pedirDocsSemSocio &&
      FASES_TRAVA.includes(lead.status) &&
      /\[CNPJ_RECEITA:[^\]]*socios=0[^\]]*\]/.test(obsLead) &&
      !obsLead.includes('[TRAVA_QSA') &&
      !obsLead.includes('[LINHA_MANUAL_OK]') &&
      !['ODRES', 'UME', 'NAO_QUALIFICADO', 'OPT_OUT'].includes(resposta.novo_status)
    ) {
      pedirDocsSemSocio = true
      console.log(`[CNPJ] ${lead.telefone}: sem sócio via marcador → [TRAVA_QSA] aplicada`)
    }
  }

  // Lojista já usa Odres/UME → envia a mensagem OFICIAL (texto fixo, verbatim),
  // ignorando o que a IA gerou. A transferência da opp pro funil 19 acontece depois (§13).
  if (resposta.novo_status === 'ODRES') {
    resposta.mensagem = ODRES_MENSAGEM
    resposta.acionar_humano = false
  } else if (resposta.novo_status === 'UME') {
    resposta.mensagem = UME_MENSAGEM
    resposta.acionar_humano = false
  }

  // Cadastro completo é um MILESTONE automático — a partir daqui o lead só aguarda a
  // análise da AIVA (Eduardo). A VictorIA já fechou a conversa; não há nada pro Nei/Aldo
  // "atenderem". O alerta informativo de milestone (✅ "completou o cadastro", §alertas)
  // continua disparando na transição, mas NÃO acionamos humano — assim não vaza pro
  // "🔔 precisa de atendimento humano" nem estaciona o lead no filtro "aguardando humano".
  if (resposta.novo_status === 'CADASTRO_RECEBIDO' || resposta.motivo_humano === 'cadastro_completo') {
    resposta.acionar_humano = false
  }

  // 10. Bot/auto-reply — contador de tentativas de "furar o bot".
  // A VictorIA sinaliza motivo_humano = "atendimento_automatico_detectado" enquanto
  // tenta chegar num humano (pedindo o responsável / navegando menu). Contamos até
  // MAX_TROCAS_BOT: abaixo disso, a mensagem-tentativa dela é enviada normalmente;
  // ao atingir o limite, forçamos BOT_DETECTADO (sem enviar, sem acionar humano) e
  // agendamos um follow-up de reativação (§12).
  const MAX_TROCAS_BOT = 10
  const autoDetected = resposta.motivo_humano === 'atendimento_automatico_detectado'
  let trocasBot = 0
  let forcarBotDetectado = false
  if (autoDetected) {
    const m = lead.observacoes?.match(/\[BOT_TROCAS:(\d+)\]/)
    trocasBot = (m ? parseInt(m[1], 10) : 0) + 1
    forcarBotDetectado = trocasBot >= MAX_TROCAS_BOT
    resposta.acionar_humano = false // bot NUNCA aciona humano
    if (forcarBotDetectado) resposta.novo_status = 'BOT_DETECTADO'
    console.log(
      `Lead ${lead.telefone}: bot/auto-reply, tentativa ${trocasBot}/${MAX_TROCAS_BOT}` +
        (forcarBotDetectado ? ' → BOT_DETECTADO (desiste + agenda follow-up)' : ' (tentando furar)'),
    )
  }

  // Envia a mensagem quando há texto E não é o momento de desistir do bot.
  // Durante as tentativas (trocasBot < 10) a mensagem-tentativa da VictorIA VAI ao lead.
  const telefoneParaEnvio = lead.telefone
  if (resposta.mensagem?.trim() && !forcarBotDetectado) {
    try {
      await sendText(telefoneParaEnvio, resposta.mensagem, lead.evotalks_chat_id)
    } catch (err) {
      console.error('Erro ao enviar mensagem via Evo Talks:', err)
    }

    // 11. Salva resposta no histórico
    await saveMensagem(lead.id, 'out', resposta.mensagem)
  }

  // 11b. (política 2026-08-03) Sem sócio NÃO dispara mais pedido de documentos
  // manuais — o lead segue a qualificação normal e fica RETIDO em Em Análise
  // AIVA ([TRAVA_QSA]); a orientação do contador é enviada quando o Nei mover
  // o card pra Em Análise (opportunity-stage) ou no reforço do Caminho 2.

  // 12. Atualiza status e chatId se ainda não tiver
  const updates: Record<string, unknown> = {
    status: resposta.novo_status,
    data_ultimo_contato: new Date().toISOString(),
    acionar_humano: resposta.acionar_humano,
  }

  // Bot esgotou as 10 tentativas → agenda follow-up de reativação em 5 dias.
  // O cron de followup (que agora inclui BOT_DETECTADO) manda um HSM novo e devolve
  // a conta pra cadência normal — dá uma segunda chance de cair num humano.
  if (forcarBotDetectado) {
    updates.etapa_cadencia = 3
    updates.data_proximo_followup = new Date(
      Date.now() + 5 * 24 * 60 * 60 * 1000,
    ).toISOString()
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
    const obsPrev = lead.observacoes ?? ''
    // Preserva TODOS os marcadores [FLAG...] já existentes (exceto DADOS_COLETADOS,
    // remontado abaixo) — assim flags operacionais como [CONSULTORIA_*],
    // [COBRANCA_CAD:*], [CAD_BLOQUEIO:*], [PAUSA_ATE:*], [AUTO_DETECTED:*],
    // [REATIVACAO_ENVIADA:*] NÃO se perdem quando o lead responde e o obs é remontado.
    const marcadores = (obsPrev.match(/\[[^\]]+\]/g) ?? [])
      .filter(
        (m) =>
          !m.startsWith('[DADOS_COLETADOS:') &&
          !m.startsWith('[BOT_TROCAS:') &&
          m !== '[BOT_REATIVAR]' &&
          // Consulta nova da Receita substitui a antiga (se houver)
          !(cnpjInfoNovo && m.startsWith('[CNPJ_RECEITA:')),
      )
    const partes: string[] = [...marcadores]
    if (cnpjInfoNovo) partes.push(cnpjInfoMarker(cnpjInfoNovo))
    // Trava de QSA (sem sócio, política 2026-08-03) → marcador persistente:
    // lead fica retido em Em Análise AIVA até regularizar o quadro societário.
    if (pedirDocsSemSocio && !obsPrev.includes('[TRAVA_QSA')) partes.push('[TRAVA_QSA]')

    if (autoDetected && !obsPrev.includes('[AUTO_DETECTED')) {
      partes.push(`[AUTO_DETECTED:${new Date().toISOString()}]`)
    }
    // CAF concluído pelo lojista → marcador DURÁVEL. O motivo_humano é texto
    // SOLTO e é substituído a cada turno (só o que está em [colchetes] sobrevive
    // ao remonte acima) — por isso "cadastro_caf_confirmado" só existia nos leads
    // cujo ÚLTIMO motivo tinha sido esse: 7 de 47 confirmações reais. Sem este
    // marcador não dá pra contar quem preencheu a biometria (card do painel).
    if (resposta.motivo_humano === 'cadastro_caf_confirmado' && !obsPrev.includes('[CAF_OK')) {
      partes.push(`[CAF_OK:${new Date().toISOString()}]`)
    }
    // Contador de tentativas de furar o bot. Enquanto tentando, persiste n; ao forçar
    // BOT_DETECTADO, some (não regrava) pra que a reativação comece com contador zerado.
    if (autoDetected && !forcarBotDetectado) {
      partes.push(`[BOT_TROCAS:${trocasBot}]`)
    }
    // Marcador de reativação: só as contas marcadas aqui entram no follow-up de bot
    // (ver getLeadsForFollowup). Contas antigas de bot sem esse marcador ficam paradas.
    if (forcarBotDetectado) {
      partes.push('[BOT_REATIVAR]')
    }
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


  // 12b. Nome do lead SEMPRE reflete o nome_varejo qualificado pela VictorIA —
  // mesmo nome que vai pro título da opp do Evo (linha ~1189). Assim painel e Evo
  // ficam sempre iguais e o nome (às vezes errado) da lista de disparo nunca prevalece.
  // Decisão do Aldo 2026-07-09: a fonte da verdade do nome é a qualificação → Evo.
  const nomeVarejo = resposta.dados_coletados?.nome_varejo as string | null | undefined
  if (nomeVarejo && lead.nome !== nomeVarejo) {
    await supabaseAdmin.from('sdr_leads').update({ nome: nomeVarejo }).eq('id', lead.id)
    lead.nome = nomeVarejo
    console.log(`Lead ${lead.id}: nome atualizado para "${nomeVarejo}" (qualificado)`)
  }

  // 13. CRM — Criar oportunidade, mover etapa e preencher formulário
  let oppId: number | null = lead.evotalks_opportunity_id ? Number(lead.evotalks_opportunity_id) : null
  // Sinal AUTORITATIVO de "cadastro completou AGORA" — vira true só quando os 12
  // campos passam na validação e o HubSpot é disparado (faltantes.length === 0).
  // O alerta ✅ se amarra nisso (não no frágil lead.status !== CADASTRO_RECEBIDO,
  // que pulava o alerta quando o card já estava na etapa Cadastro Recebido do Evo).
  let cadastroCompletoConfirmado = false
  try {
    // Detecta produto pra decidir pipeline:
    // - lead.produto === 'AIVA' (prospecção outbound) → sempre pipeline AIVA
    // - lead.produto === 'TRIAGEM' (lead inbound) → usa produto_interesse retornado
    //   pela TRIAGEM (AIVA ou SINGLO). Se ainda não foi detectado, espera próxima msg.
    const produtoInteresse = (resposta.dados_coletados?.produto_interesse ?? null) as 'AIVA' | 'SINGLO' | null
    const ehTriagem = lead.produto === 'TRIAGEM'
    const usarPipelineSinglo = ehTriagem && produtoInteresse === 'SINGLO'
    const usarPipelineAiva = !ehTriagem || produtoInteresse === 'AIVA'

    if (!oppId && (resposta.novo_status === 'INTERESSADO' || resposta.novo_status === 'PRE_APROVACAO')) {
      if (usarPipelineSinglo) {
        // Pipeline Singlo (17), stage Interessado (62)
        oppId = await createOpportunity({
          title: `${lead.nome} — Singlo (inbound)`,
          number: lead.telefone,
          city: lead.cidade ?? undefined,
          pipelineId: PIPELINE_SINGLO,
          stageId: SINGLO_STAGES.INTERESSADO,
          chatId: chatId || lead.evotalks_chat_id || undefined,
          clientId: clientId || lead.evotalks_client_id || undefined,
        })
        await supabaseAdmin
          .from('sdr_leads')
          .update({ evotalks_opportunity_id: String(oppId) })
          .eq('id', lead.id)
        console.log(`CRM: Oportunidade Singlo #${oppId} criada em "Interessado" pra ${lead.nome}`)

        // Lead inbound Singlo → aplica tag INBOUND
        try {
          await addOpportunityTags(oppId, [TAG_IDS.INBOUND])
        } catch (err) {
          console.log(`CRM: Erro ao adicionar tag INBOUND na opp Singlo #${oppId}:`, err)
        }
      } else if (usarPipelineAiva) {
        // Pipeline AIVA (15), stage Interessado (47) — comportamento padrão
        const tituloPrefixo = ehTriagem ? '(inbound) ' : ''
        oppId = await createOpportunity({
          title: `${tituloPrefixo}${lead.nome} — AIVA`,
          number: lead.telefone,
          city: lead.cidade ?? undefined,
          chatId: chatId || lead.evotalks_chat_id || undefined,
          clientId: clientId || lead.evotalks_client_id || undefined,
        })
        // Lead inbound (TRIAGEM) identificado como AIVA → CONVERTE pra produto AIVA.
        // A partir da próxima mensagem usa o prompt AIVA e segue a jornada completa
        // (coleta de dados → pré-aprovação → cadastro), igual lead disparado.
        // Sem isso o lead ficaria preso no prompt TRIAGEM pra sempre.
        const updateLead: Record<string, unknown> = { evotalks_opportunity_id: String(oppId) }
        if (ehTriagem) updateLead.produto = 'AIVA'
        await supabaseAdmin
          .from('sdr_leads')
          .update(updateLead)
          .eq('id', lead.id)
        console.log(`CRM: Oportunidade AIVA #${oppId} criada para ${lead.nome}${ehTriagem ? ' (inbound→AIVA convertido)' : ''}`)

        // Aplica tag AIVA (sempre) + tag INBOUND se for lead inbound (TRIAGEM)
        const tagsParaAplicar: number[] = [TAG_IDS.AIVA]
        if (ehTriagem) tagsParaAplicar.push(TAG_IDS.INBOUND)
        try {
          await addOpportunityTags(oppId, tagsParaAplicar)
        } catch (err) {
          console.log(`CRM: Erro ao adicionar tags na oportunidade #${oppId}:`, err)
        }
      } else {
        // TRIAGEM ainda sem produto identificado — espera próxima msg da VictorIA
        console.log(`[TRIAGEM] Lead ${lead.telefone}: aguardando produto_interesse antes de criar opp`)
      }
    }

    // Move de "Início" para "Interessado" quando lead responde.
    // changeStageSeAvanco NUNCA regride — se a opp já está em fase avançada
    // (Cadastro Recebido, Treinar, etc), o move é ignorado. Defesa dupla junto
    // com o guard universal de status no início do handler.
    if (oppId && resposta.novo_status === 'INTERESSADO') {
      try {
        const r = await changeStageSeAvanco(oppId, STAGES.INTERESSADO)
        console.log(`CRM: Oportunidade #${oppId} → Interessado (${r.moved ? 'movido' : r.motivo})`)
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

      // Preenche dados coletados no formulário do CRM.
      // Envia TODOS os dados acumulados (não só os novos do turn atual) — bug raiz
      // detectado 2026-05-13 (GR Celulares): VictorIA marcava PRE_APROVACAO
      // mas updateOpportunityForms só atualizava os campos novos do turn, e a
      // validação subsequente da Fase 1 via formsdata via apenas 1-2 campos →
      // revertia status pra INTERESSADO. Mandar dados acumulados resolve isso.
      const dadosCompletos = {
        ...dadosAcumulados,
        ...(resposta.dados_coletados as Record<string, string | null | undefined> ?? {}),
      } as Record<string, string | null | undefined>
      if (Object.keys(dadosCompletos).length > 0) {
        await updateOpportunityForms(oppId, dadosCompletos, lead.telefone)
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

      // Empresa sem sócio detectada na Receita (neste turno) → tag "Sem Socio"
      // (id 80) na oportunidade, pro Nei/Edu enxergarem o fluxo de documentos
      // direto no card do Evo (pedido do Aldo 2026-07-28). mergeOpportunityTag
      // preserva as tags existentes (AIVA/INBOUND) — updateOpportunity substitui
      // o array inteiro, então NUNCA usar addOpportunityTags com uma tag só aqui.
      if (pedirDocsSemSocio) {
        await mergeOpportunityTag(oppId, TAG_IDS.SEM_SOCIO)
      }

      // NOTA (29/05/2026): a etiqueta "Atend Humano" no Evo foi DESCONTINUADA.
      // Atendimento humano agora é controlado 100% pelo painel via acionar_humano
      // (Supabase). A VictorIA detecta na conversa e seta a flag; o Nei vê no
      // filtro "Aguardando humano" e clica "Atendido". Fonte única, sem dessync.

      // ── Detecção de Fase 3 completa PELOS DADOS (não pelo novo_status do modelo) ──
      // Bug raiz 2026-07-10 (Loja Allshopp): o lead mandou os 5 dados da Fase 3 numa
      // mensagem só, a VictorIA confirmou mas AINDA perguntou cnpjs_adicionais (não
      // marcou CADASTRO_RECEBIDO) e o lead nunca respondeu → o "turno de conclusão"
      // nunca veio → HubSpot e alerta ✅ nunca dispararam. O gatilho do bloco abaixo
      // agora é a COMPLETUDE DOS DADOS (determinística), com o novo_status do modelo
      // como caminho alternativo. Idempotência via flag [CAD_ALERTADO] em observacoes
      // (o write geral §12 preserva marcadores [..] entre turnos) — imune ao sync 4b
      // marcar CADASTRO_RECEBIDO antes (que roubava a transição do guard por status).
      const FASE3_CAMPOS_DADOS = ['email_socio', 'faturamento_anual', 'valor_boleto_mensal', 'localizacao_lojas'] as const
      const fase3NosDados = FASE3_CAMPOS_DADOS.every((k) => dadosCompletos[k]?.toString().trim())
      const cadJaAlertado = (lead.observacoes ?? '').includes('[CAD_ALERTADO]')
      const cadEntrouPeloModelo = resposta.novo_status === 'CADASTRO_RECEBIDO'

      // FASE 1 completa (7 dados) → move pra Pré Aprovação + envia Google Sheets
      // Só dispara na TRANSIÇÃO (lead estava em outro status antes). Se já estava
      // PRE_APROVACAO e só mandou uma msg espontânea, não re-executa.
      if (resposta.novo_status === 'PRE_APROVACAO' && lead.status !== 'PRE_APROVACAO') {
        // Validação dos 7 campos obrigatórios da Fase 1 ANTES de mover stage e
        // mandar Google Sheets. Defesa contra IA marcando completude prematura.
        //
        // Validação DUPLA:
        // 1) Evo Talks formsdata (estado oficial após updateOpportunityForms)
        // 2) dadosAcumulados do Supabase (fonte da verdade — VictorIA acumulou
        //    durante a conversa). Cobre o caso onde Evo Talks ainda não sincronizou.
        //
        // Um campo só é considerado "faltante" se ESTIVER VAZIO EM AMBOS os lugares.
        const oppPreCheck = await getOpportunity(oppId)
        const formsPreCheck = (oppPreCheck.formsdata ?? {}) as Record<string, string | null>
        const camposFase1: Record<string, { fieldId: string; dadosKey: string }> = {
          nome_socio:              { fieldId: 'da6ddf70', dadosKey: 'nome_socio' },
          telefone:                { fieldId: 'db8569f0', dadosKey: 'telefone_socio' },
          nome_varejo:             { fieldId: 'dcacfa00', dadosKey: 'nome_varejo' },
          cnpj_matriz:             { fieldId: 'dd2ab580', dadosKey: 'cnpj_matriz' },
          regiao_varejo:           { fieldId: 'dede58f0', dadosKey: 'regiao_varejo' },
          numero_lojas:            { fieldId: 'df6f9c70', dadosKey: 'numero_lojas' },
          possui_outra_financeira: { fieldId: 'e07d62f0', dadosKey: 'possui_outra_financeira' },
        }
        const dadosMergedCheck: Record<string, string | undefined> = {
          ...dadosAcumulados,
          ...(resposta.dados_coletados as Record<string, string | undefined> ?? {}),
        }
        // Telefone do sócio: se VictorIA não preencheu mas o lead respondeu "Este"
        // ou similar, usa o telefone do próprio WhatsApp como fallback
        if (!dadosMergedCheck.telefone_socio?.toString().trim()) {
          dadosMergedCheck.telefone_socio = lead.telefone
        }
        const faltantesFase1 = Object.entries(camposFase1)
          .filter(([, { fieldId, dadosKey }]) => {
            const evoVazio = !formsPreCheck[fieldId]?.toString().trim()
            const supaVazio = !dadosMergedCheck[dadosKey]?.toString().trim()
            return evoVazio && supaVazio
          })
          .map(([label]) => label)

        if (faltantesFase1.length > 0) {
          console.warn(`Pré Aprovação bloqueada — opp #${oppId} incompleto: ${faltantesFase1.join(', ')}`)
          await addOpportunityNote(oppId, `ℹ️ VictorIA marcou PRE_APROVACAO cedo, mas ainda faltam: ${faltantesFase1.join(', ')}. Etapa do Evo inalterada e Google Sheets não enviado — a VictorIA segue coletando esses dados (sem regressão de etapa).`)

          await supabaseAdmin
            .from('sdr_leads')
            .update({ status: 'INTERESSADO' })
            .eq('id', lead.id)

          const msg =
            `ℹ️ *${lead.nome}* (${lead.telefone}) — a VictorIA ainda está coletando a qualificação (faltam: ${faltantesFase1.join(', ')}).\n` +
            `Nada mudou de etapa no Evo — ela continua a conversa normalmente.`
          if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
          if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)

          // Pula o resto do bloco de transição (não move stage, não envia Sheets)
          return NextResponse.json({ ok: true, bloqueado: 'fase1_incompleta', faltantes: faltantesFase1 })
        }

        const rPre = await changeStageSeAvanco(oppId, STAGES.PRE_APROVACAO)
        await addOpportunityNote(oppId, `Qualificação inicial (7 dados) coletada pela VictorIA via WhatsApp. Aguardando análise AIVA.`)
        console.log(`CRM: Oportunidade #${oppId} → Pré Aprovação (${rPre.moved ? 'movido' : rPre.motivo})`)

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
      // GUARD DE TRANSIÇÃO REAL: lead.status é o valor sincronizado com o Evo NO
      // INÍCIO deste request (item 4b), antes da Claude rodar — nunca mutado depois.
      // Conclusão da Fase 3 — entra por DOIS gatilhos:
      //   (a) modelo marcou CADASTRO_RECEBIDO (comportamento original), OU
      //   (b) os 4 dados da Fase 3 estão completos nos dados acumulados, mesmo que o
      //       modelo tenha retornado INTERESSADO (bug Allshopp 2026-07-10 — ver acima).
      //       Restrito a INTERESSADO/CADASTRO_RECEBIDO pra não rodar em fases
      //       posteriores (EM_ANALISE_AIVA+ sempre têm os dados completos).
      // Idempotência: flag [CAD_ALERTADO] substitui o guard por status de 2026-07-09
      // (Imports Store: 9 alertas duplicados). O guard `lead.status !== CADASTRO_RECEBIDO`
      // era frágil: o sync 4b podia gravar CADASTRO_RECEBIDO ANTES desta volta rodar
      // e a transição (HubSpot + alerta ✅) se perdia pra sempre. A flag é gravada no
      // exato momento do ✅ e preservada pelo write geral (§12) — sem re-alerta E sem
      // transição perdida. Backfill 2026-07-10: leads já pós-cadastro receberam a flag.
      else if (
        (cadEntrouPeloModelo ||
          (fase3NosDados && ['INTERESSADO', 'CADASTRO_RECEBIDO'].includes(lead.status))) &&
        !cadJaAlertado
      ) {
        const opp = await getOpportunity(oppId)
        const forms = (opp.formsdata ?? {}) as Record<string, string | null>

        // Valida os 12 campos ANTES de disparar HubSpot — defesa contra erro
        // da VictorIA marcando CADASTRO_RECEBIDO prematuramente. Os 12 campos
        // obrigatórios são os do formulário Qualificação Varejo do Evo Talks.
        // Validação DUPLA (igual Fase 1): um campo só é "faltante" se estiver
        // vazio EM AMBOS — Evo Talks formsdata E Supabase dadosAcumulados.
        // O Supabase é a fonte da verdade (a VictorIA acumula os dados durante
        // a conversa); o Evo Talks pode não ter sincronizado todos ainda.
        // Bug raiz 2026-05-15 (teste Aldo): localização coletada pela VictorIA
        // (estava no Supabase) mas não sincronizada → HubSpot bloqueado à toa.
        const dadosMergedF3: Record<string, string | undefined> = {
          ...dadosAcumulados,
          ...(resposta.dados_coletados as Record<string, string | undefined> ?? {}),
        }
        if (!dadosMergedF3.telefone_socio?.toString().trim()) {
          dadosMergedF3.telefone_socio = lead.telefone
        }
        const camposObrigatorios: Record<string, { fieldId: string; dadosKey: string }> = {
          nome_socio:              { fieldId: 'da6ddf70', dadosKey: 'nome_socio' },
          email_socio:             { fieldId: 'dafa40f0', dadosKey: 'email_socio' },
          telefone:                { fieldId: 'db8569f0', dadosKey: 'telefone_socio' },
          nome_varejo:             { fieldId: 'dcacfa00', dadosKey: 'nome_varejo' },
          cnpj_matriz:             { fieldId: 'dd2ab580', dadosKey: 'cnpj_matriz' },
          faturamento_anual:       { fieldId: 'ddb960f0', dadosKey: 'faturamento_anual' },
          valor_boleto_mensal:     { fieldId: 'de2cbc30', dadosKey: 'valor_boleto_mensal' },
          regiao_varejo:           { fieldId: 'dede58f0', dadosKey: 'regiao_varejo' },
          numero_lojas:            { fieldId: 'df6f9c70', dadosKey: 'numero_lojas' },
          localizacao_lojas:       { fieldId: 'e0099280', dadosKey: 'localizacao_lojas' },
          possui_outra_financeira: { fieldId: 'e07d62f0', dadosKey: 'possui_outra_financeira' },
          cnpjs_adicionais:        { fieldId: 'e0f66380', dadosKey: 'cnpjs_adicionais' },
        }
        // Valor resolvido: Evo Talks formsdata OU Supabase (o que tiver preenchido)
        const valorF3 = (c: { fieldId: string; dadosKey: string }): string =>
          (forms[c.fieldId]?.toString().trim() || dadosMergedF3[c.dadosKey]?.toString().trim() || '')

        // Loja ÚNICA → não existe CNPJ adicional. Marca "não possui" AUTOMATICAMENTE
        // (cnpjs_adicionais só faz sentido com 2+ CNPJs) pra não travar a conclusão.
        const numLojasRaw = valorF3(camposObrigatorios.numero_lojas).toLowerCase()
        const ehLojaUnica = parseInt(numLojasRaw.replace(/\D/g, ''), 10) === 1
          || /\b(uma|[úu]nica|so uma|s[óo] uma)\b/.test(numLojasRaw)
        if (ehLojaUnica && !valorF3(camposObrigatorios.cnpjs_adicionais)) {
          dadosMergedF3.cnpjs_adicionais = 'não possui'
          // Espelha em dados_coletados → dadosAlerta/planilha Atendimentos saem
          // com "não possui" em vez de vazio (bug SpeedCell 2026-07-28).
          resposta.dados_coletados = { ...((resposta.dados_coletados as Record<string, string | null>) ?? {}), cnpjs_adicionais: 'não possui' }
          console.log(`[webhook] loja única → cnpjs_adicionais = "não possui" automaticamente — opp #${oppId}`)
        }

        let faltantes = Object.entries(camposObrigatorios)
          .filter(([, c]) => !valorF3(c))
          .map(([label]) => label)

        // Rede de segurança — cnpjs_adicionais é OBRIGATÓRIO, mas quando o lead
        // responde à pergunta com uma negativa clara ("só esse", "não tenho",
        // "nenhum"...) essa É a resposta → grava "não possui". Só aplica quando
        // é o ÚNICO campo faltando, pra não mascarar outros buracos. Backup do
        // prompt (bug recorrente: VictorIA marcava CADASTRO_RECEBIDO sem registrar
        // o "não possui" e o HubSpot travava à toa).
        const NEG_CNPJ = /(s[óo]\s+(es[ts]e|essa)|apenas\s+es[ts]e|somente\s+es[ts]e|[ée]\s+es[ts]e\s+mesmo|es[ts]e\s+mesmo|n[ãa]o\s+(tenho|possuo|h[áa]|tem)|nenhum|sem\s+outro)/i
        if (faltantes.length === 1 && faltantes[0] === 'cnpjs_adicionais' && NEG_CNPJ.test(conteudo ?? '')) {
          dadosMergedF3.cnpjs_adicionais = 'não possui'
          resposta.dados_coletados = { ...((resposta.dados_coletados as Record<string, string | null>) ?? {}), cnpjs_adicionais: 'não possui' }
          console.log(`[webhook] cnpjs_adicionais auto-preenchido "não possui" (resposta negativa do lead) — opp #${oppId}`)
          faltantes = Object.entries(camposObrigatorios)
            .filter(([, c]) => !valorF3(c))
            .map(([label]) => label)
        }

        if (faltantes.length > 0 && !cadEntrouPeloModelo) {
          // Entrou pela detecção por dados mas a validação completa (12 campos) ainda
          // acha buraco (ex.: 2+ lojas sem cnpjs_adicionais). Não é o modelo marcando
          // cedo — é só a Fase 3 ainda em andamento. Sai em silêncio, sem contador de
          // bloqueio (senão o 🚨 de "travado" dispararia falso a cada turno) e sem
          // mexer em status/observacoes. A VictorIA segue coletando normalmente.
          console.log(`[fase3-dados] opp #${oppId}: 4 campos base ok mas faltam ${faltantes.join(', ')} — aguardando coleta (sem bloqueio).`)
        } else if (faltantes.length > 0) {
          // Bloqueia HubSpot e reverte pra INTERESSADO pro lead continuar na Fase 3.
          // ALERTA HUMANO É CONDICIONAL: só avisa Aldo/Nei se TRAVAR DE VERDADE
          // (LIMITE_BLOQUEIO bloqueios consecutivos). O transitório (a VictorIA marca
          // completo cedo num turno e segue coletando no próximo) fica SILENCIOSO —
          // o write geral de observacoes zera o contador a cada turno de progresso,
          // então o contador só sobe em bloqueios seguidos sem coleta no meio.
          console.warn(`HubSpot bloqueado — opp #${oppId} incompleto: ${faltantes.join(', ')}`)

          // Contador: o valor anterior está no lead.observacoes em memória (início do
          // turno). Releio o obs ATUAL do banco (o write geral acima já gravou os DADOS
          // frescos, mas sem o contador) pra regravar preservando esses dados.
          const LIMITE_BLOQUEIO = 3
          const nBloq = parseInt((lead.observacoes ?? '').match(/\[CAD_BLOQUEIO:(\d+)\]/)?.[1] ?? '0', 10) + 1
          const { data: curObsRow } = await supabaseAdmin
            .from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
          const obsCur = (curObsRow?.observacoes ?? '').replace(/\s*\[CAD_BLOQUEIO:\d+\]\s*/g, ' ').trim()
          const novaObs = `[CAD_BLOQUEIO:${nBloq}] ${obsCur}`.trim()

          await addOpportunityNote(oppId, `ℹ️ VictorIA marcou CADASTRO_RECEBIDO cedo, mas ainda faltam: ${faltantes.join(', ')} (bloqueio nº ${nBloq}). Etapa do Evo inalterada (segue em Cadastro Recebido); VictorIA continua coletando. Não enviado ao HubSpot ainda (sem regressão de etapa).`)

          await supabaseAdmin
            .from('sdr_leads')
            .update({ status: 'INTERESSADO', observacoes: novaObs })
            .eq('id', lead.id)

          // Só alerta no travamento real (exatamente no limite — uma vez, sem spam).
          if (nBloq === LIMITE_BLOQUEIO) {
            const msg =
              `🚨 *${lead.nome}* (${lead.telefone}) — parece TRAVADO: a VictorIA marcou cadastro completo ${nBloq}x seguidas mas seguem faltando: ${faltantes.join(', ')}.\n` +
              `O card segue em Cadastro Recebido no Evo (não regrediu) — só não foi pro HubSpot ainda. Pode precisar de um help manual.`
            if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
            if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
          } else {
            console.log(`HubSpot bloqueado (nº ${nBloq}/${LIMITE_BLOQUEIO} — transitório, sem alerta) — opp #${oppId}`)
          }

          // Sobrescreve a resposta pra quem ler depois saber que não foi transição real
          resposta.novo_status = 'INTERESSADO'
        } else {
          // Monta os 12 dados a partir do valor resolvido (Evo Talks OU Supabase).
          const dados12 = {
            nome_socio:              valorF3(camposObrigatorios.nome_socio),
            email_socio:             valorF3(camposObrigatorios.email_socio),
            telefone:                valorF3(camposObrigatorios.telefone),
            nome_varejo:             valorF3(camposObrigatorios.nome_varejo),
            cnpj_matriz:             valorF3(camposObrigatorios.cnpj_matriz),
            faturamento_anual:       valorF3(camposObrigatorios.faturamento_anual),
            valor_boleto_mensal:     valorF3(camposObrigatorios.valor_boleto_mensal),
            regiao_varejo:           valorF3(camposObrigatorios.regiao_varejo),
            numero_lojas:            valorF3(camposObrigatorios.numero_lojas),
            localizacao_lojas:       valorF3(camposObrigatorios.localizacao_lojas),
            possui_outra_financeira: valorF3(camposObrigatorios.possui_outra_financeira),
            cnpjs_adicionais:        valorF3(camposObrigatorios.cnpjs_adicionais),
          }

          // Sincroniza o Evo Talks com os 12 campos antes de avançar — garante
          // que o formulário Qualificação Varejo fica completo (corrige campos
          // que a VictorIA coletou mas não chegaram a sincronizar).
          try {
            await updateOpportunityForms(oppId, {
              nome_socio: dados12.nome_socio,
              email_socio: dados12.email_socio,
              nome_varejo: dados12.nome_varejo,
              cnpj_matriz: dados12.cnpj_matriz,
              faturamento_anual: dados12.faturamento_anual,
              valor_boleto_mensal: dados12.valor_boleto_mensal,
              regiao_varejo: dados12.regiao_varejo,
              numero_lojas: dados12.numero_lojas,
              localizacao_lojas: dados12.localizacao_lojas,
              possui_outra_financeira: dados12.possui_outra_financeira,
              cnpjs_adicionais: dados12.cnpjs_adicionais,
            }, dados12.telefone)
          } catch (err) {
            console.error(`Erro ao sincronizar formulário Evo Talks — opp #${oppId}:`, err)
          }

          // TRAVA ATÔMICA da conclusão (bug SpeedCell 2026-07-28: dois turnos
          // seguidos completaram — o auto "não possui" da loja única fechou os
          // 12 no turno da cidade E o turno do "somente esse" fechou de novo,
          // duplicando HubSpot/planilha/alerta). A checagem antiga do
          // [CAD_ALERTADO] (leitura no início vs escrita no fim) não era
          // atômica. Agora a flag é gravada com condição NO BANCO: só UM turno
          // consegue — quem perder sai do bloco sem efeitos colaterais.
          const { data: obsRowCad } = await supabaseAdmin
            .from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
          const obsCad = (obsRowCad?.observacoes ?? '').replace(/\s*\[CAD_ALERTADO\]\s*/g, ' ').trim()
          const { data: claim } = await supabaseAdmin
            .from('sdr_leads')
            .update({ status: 'CADASTRO_RECEBIDO', observacoes: `[CAD_ALERTADO] ${obsCad}`.trim() })
            .eq('id', lead.id)
            .not('observacoes', 'like', '%[CAD_ALERTADO]%')
            .select('id')
          if (!claim || claim.length === 0) {
            // Outro turno já reivindicou a conclusão — só garante o status e sai.
            console.log(`[cadastro-completo] opp #${oppId}: conclusão já reivindicada por turno anterior — sem re-disparo.`)
            resposta.novo_status = 'CADASTRO_RECEBIDO'
            return NextResponse.json({ ok: true, dedup: 'cadastro_ja_concluido' })
          }

          cadastroCompletoConfirmado = true
          resposta.novo_status = 'CADASTRO_RECEBIDO'

          await addOpportunityNote(oppId, `Cadastro completo (12 dados) coletado pela VictorIA. Enviado pro HubSpot.`)
          console.log(`CRM: Oportunidade #${oppId} → Cadastro Completo → HubSpot`)
          try {
            await sendToHubSpot({ ...dados12 })
          } catch (err) {
            console.error(`Erro ao enviar pro HubSpot — opp #${oppId}:`, err)
          }

          // Complementa planilha AIVA APROVAÇÃO. O Apps Script faz upsert por
          // opportunity_id: se a linha já existe (criada na Fase 1), só preenche
          // as células vazias — preserva o que já está lá.
          try {
            await sendToGoogleSheets({
              ...dados12,
              status: 'CADASTRO_RECEBIDO',
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
      } else if (resposta.novo_status === 'ODRES' || resposta.novo_status === 'UME') {
        // Lojista já usa Odres OU UME → transfere pro funil 19 (etapa "Parcelex" 84)
        // com a tag correspondente. A API do Evo não move opp entre funis: recria no
        // 19 e apaga a antiga (§evotalks).
        const tagId = resposta.novo_status === 'ODRES' ? TAG_IDS.ODRES : TAG_IDS.UME
        try {
          const novaOpp = await transferirParaFunil19({
            oldOppId: oppId,
            title: `${lead.nome} — AIVA`,
            number: lead.telefone,
            city: lead.cidade ?? undefined,
            tagId,
          })
          await supabaseAdmin.from('sdr_leads')
            .update({ evotalks_opportunity_id: String(novaOpp) })
            .eq('id', lead.id)
          console.log(`CRM: Lead ${resposta.novo_status} ${lead.telefone} transferido pro funil 19/84 (opp #${novaOpp}, tag ${tagId})`)
        } catch (err) {
          console.log(`CRM: Erro ao transferir lead ${resposta.novo_status} #${oppId}:`, err)
        }
      }
    }
  } catch (err) {
    console.error('Erro ao atualizar CRM:', err)
  }

  // 14. Alertas para humanos — só disparam na TRANSIÇÃO de status, não em cada msg.
  //
  // GATE ANTI-REGRESSÃO (fonte da verdade = etapa REAL da opp no Evo):
  // O rebaixamento intencional (stage 49 "Cadastro Recebido" + Fase 3 incompleta →
  // status derivado INTERESSADO) fazia o alerta comparar contra um status "atrás" da
  // coluna real do Evo. Resultado: a VictorIA retornava PRE_APROVACAO no meio da Fase 3
  // e disparava um alerta FALSO "qualificado p/ pré-aprovação" (a opp já estava em
  // Cadastro Recebido). Aqui lemos a ETAPA REAL da opp e suprimimos o alerta se ela já
  // estiver MAIS AVANÇADA que o status alertado. Fail-open: se não ler o Evo, alerta.
  let ordemRealEvo = -1
  if (resposta.novo_status === 'PRE_APROVACAO' && oppId) {
    try {
      const oppAlerta = await getOpportunity(oppId)
      const rawStatus = STAGE_TO_STATUS[Number(oppAlerta.fkStage)]
      ordemRealEvo = rawStatus ? (ORDEM_STATUS_FUNIL[rawStatus] ?? -1) : -1
    } catch { /* fail-open */ }
  }
  const telAlerta = lead.telefone
  const regressaoFalsa = (alvo: 'PRE_APROVACAO' | 'CADASTRO_RECEBIDO') => {
    const suprime = ordemRealEvo > (ORDEM_STATUS_FUNIL[alvo] ?? -1)
    if (suprime) console.log(`[alerta-suprimido] ${telAlerta}: ${alvo}, mas Evo já está em ordem ${ordemRealEvo}. Regressão falsa — não alerta.`)
    return suprime
  }

  // Dados coletados frescos (acumulado + o que chegou nesta volta) — pros alertas
  // detalhados que o Nei usa pra acompanhar sem abrir o painel (pedido do Aldo 22/07).
  const dadosAlerta = { ...dadosAcumulados, ...((resposta.dados_coletados as Record<string, string>) ?? {}) }

  // Fluxo de documentos (sem sócio) COMPLETO → registra a linha na aba "Manual"
  // da planilha AIVA APROVAÇÃO (razão social/endereço/fantasia vêm da Receita;
  // CPF e dados bancários o Edu completa a partir dos docs na pasta do Drive).
  if (resposta.motivo_humano === 'documentos_sem_socio_completos' && !(lead.observacoes ?? '').includes('[LINHA_MANUAL_OK]')) {
    try {
      const cnpjLead = String(dadosAlerta.cnpj_matriz ?? '').replace(/\D/g, '') ||
        ((lead.observacoes ?? '').match(/cnpj_matriz=(\d{14})/)?.[1] ?? '')
      const infoReceita = cnpjLead.length === 14 ? await consultarCNPJ(cnpjLead) : null
      const okLinha = await enviarLinhaManual({
        signer_name: dadosAlerta.nome_socio ?? null,
        signer_email: dadosAlerta.email_socio ?? null,
        razao_social: infoReceita?.razaoSocial ?? null,
        endereco: infoReceita?.endereco ?? null,
        cnpj: cnpjLead || null,
        nome_varejo: dadosAlerta.nome_varejo ?? lead.nome,
        // Nome fantasia dito pelo lojista vence o da Receita (muitas vezes vazio lá)
        fantasia: (dadosAlerta as Record<string, string>).nome_fantasia ?? infoReceita?.nomeFantasia ?? null,
        telefone: lead.telefone,
        link_pasta: 'https://drive.google.com/drive/folders/1yAtSYdjDISW2SX965f925KjMBTMHD2gp',
        cpf: (dadosAlerta as Record<string, string>).cpf_responsavel ?? null,
        banco_codigo: (dadosAlerta as Record<string, string>).banco_codigo ?? null,
        banco_agencia: (dadosAlerta as Record<string, string>).banco_agencia ?? null,
        banco_conta: (dadosAlerta as Record<string, string>).banco_conta ?? null,
        banco_digito: (dadosAlerta as Record<string, string>).banco_digito ?? null,
      })
      if (okLinha) {
        await supabaseAdmin
          .from('sdr_leads')
          .update({ observacoes: `${(updates.observacoes as string | null) ?? lead.observacoes ?? ''} [LINHA_MANUAL_OK]`.trim() })
          .eq('id', lead.id)
        console.log(`[MANUAL_DOCS] Linha da aba Manual registrada pra ${lead.telefone}`)
      }
    } catch (err) {
      console.error(`[MANUAL_DOCS] Falha ao registrar linha Manual pra ${lead.telefone}:`, err)
    }
  }

  if (resposta.novo_status === 'PRE_APROVACAO' && lead.status !== 'PRE_APROVACAO' && !regressaoFalsa('PRE_APROVACAO')) {
    const detalhe = formatarDadosLead(dadosAlerta)
    const msg =
      `🟡 *${lead.nome}* (${lead.telefone} — ${lead.cidade ?? 'cidade n/d'}) qualificado p/ pré-aprovação.\n` +
      (detalhe ? `\n${detalhe}\n` : '') +
      `\n➡️ Mover pra Cadastro Recebido no Evo Talks quando aprovar.`
    await alertHuman(process.env.NEI_WHATSAPP!, msg)
    await alertHuman(process.env.ALDO_WHATSAPP!, msg)
  } else if (cadastroCompletoConfirmado) {
    // Dispara SÓ quando o cadastro completou de verdade nesta volta (12 dados válidos
    // + HubSpot enviado). cadastroCompletoConfirmado só é setado dentro do bloco de
    // CRM (§13) que agora tem o guard `lead.status !== 'CADASTRO_RECEBIDO'` — ou seja,
    // só true numa transição REAL. Sem re-alerta a cada msg espontânea pós-cadastro
    // (bug corrigido 2026-07-09 — Imports Store: 9 alertas duplicados em 6 minutos).
    const detalhe = formatarDadosLead(dadosAlerta)
    // CNPJs pro formulário de pré-cadastro: o form é da AIVA e exige login,
    // então não dá pra enviar automático. Os links pré-preenchidos ficam no
    // PAINEL (/registros) — o alerta só aponta pra lá (decisão Aldo 2026-07-28,
    // substituindo o bloco de links no WhatsApp).
    const qtdCnpjsForm =
      extrairCnpjs(String(dadosAlerta.cnpj_matriz ?? '')).length +
      extrairCnpjs(String(dadosAlerta.cnpjs_adicionais ?? '')).filter(
        (c) => !extrairCnpjs(String(dadosAlerta.cnpj_matriz ?? '')).includes(c),
      ).length
    const linksForm = qtdCnpjsForm > 0
      ? `\n📝 *${qtdCnpjsForm} CNPJ(s) pra lançar no pré-cadastro* — links já preenchidos no painel:\nhttps://sdr-aiva.vercel.app/registros`
      : ''
    const msg =
      `✅ *${lead.nome}* (${lead.telefone} — ${lead.cidade ?? 'cidade n/d'}) completou o cadastro!\n` +
      (detalhe ? `\n${detalhe}\n` : '') +
      `\n📤 12 dados enviados pro HubSpot. Pronto pra mover pra Análise AIVA.\n` +
      linksForm
    await alertHuman(process.env.NEI_WHATSAPP!, msg)
    await alertHuman(process.env.ALDO_WHATSAPP!, msg)

    // Registro na aba "Atendimentos" da planilha AIVA APROVAÇÃO: CNPJ matriz,
    // adicionais e data/hora em que os CNPJs foram liberados pro pré-cadastro.
    if (linksForm) {
      try {
        const cnpjMatriz = String(dadosAlerta.cnpj_matriz ?? '')
        const cnpjsAdd = String(dadosAlerta.cnpjs_adicionais ?? '')
        await registrarAtendimento({
          loja: lead.nome,
          telefone: lead.telefone,
          cnpj_matriz: cnpjMatriz || null,
          cnpjs_adicionais: cnpjsAdd || null,
          qtd: extrairCnpjs(cnpjMatriz).length + extrairCnpjs(cnpjsAdd).length,
          opportunity_id: lead.evotalks_opportunity_id ?? null,
        })
      } catch (err) {
        console.error(`[ATENDIMENTOS] Falha ao registrar ${lead.telefone}:`, err)
      }

      // Espelho no painel (/registros, aba "CNPJs registrados na base"):
      // uma linha por CNPJ, com checkbox "enviado" pro Nei controlar por lá.
      try {
        const leadRef = { lead_id: lead.id, loja: lead.nome, telefone: lead.telefone }
        const matriz = extrairCnpjs(String(dadosAlerta.cnpj_matriz ?? ''))
        const adicionais = extrairCnpjs(String(dadosAlerta.cnpjs_adicionais ?? '')).filter((c) => !matriz.includes(c))
        const linhas = [
          ...matriz.map((c) => ({ cnpj: c, tipo: 'matriz' })),
          ...adicionais.map((c) => ({ cnpj: c, tipo: 'adicional' })),
        ].map((r) => ({ ...r, ...leadRef }))
        if (linhas.length > 0) {
          await supabaseAdmin.from('sdr_registros_cnpj').upsert(linhas, { onConflict: 'lead_id,cnpj', ignoreDuplicates: true })
        }
      } catch (err) {
        console.error(`[REGISTROS] Falha ao espelhar CNPJs de ${lead.telefone}:`, err)
      }
    }
  } else if (
    resposta.motivo_humano?.startsWith('dados_colaborador_coletados') &&
    !(lead.observacoes ?? '').includes('dados_colaborador_coletados')
  ) {
    // 📋 Campanha "está vendendo?" (14/07): VictorIA fechou a coleta de dados de
    // colaborador(es) — manda o resumo COMPLETO pro Nei/Aldo. Branch próprio,
    // ANTES do 🔔: não depende da transição do acionar_humano (que engoliria o
    // aviso se o lead já estivesse marcado). Dedupe: o motivo do turno anterior
    // fica nas observações — se já contém o marcador, não re-alerta.
    // Lançamento AUTOMÁTICO no Google Form "Colaborador AIVA" (2026-07-28):
    // o form aceita POST anônimo (testado), então cada colaborador com dados
    // completos é enviado direto — o Nei só confere. Idempotência por CPF via
    // [COLAB_FORM:cpf1,cpf2] em observacoes. Quem falhar/vier incompleto ganha
    // link pré-preenchido no alerta pro lançamento manual.
    let blocoForm = ''
    try {
      const nomeLojaForm = lead.nome
      const { validos, incompletos } = parseColaboradores(resposta.motivo_humano)
      const jaEnviados: string[] = ((lead.observacoes ?? '').match(/\[COLAB_FORM:([^\]]+)\]/)?.[1] ?? '')
        .split(',').map((c) => c.trim()).filter(Boolean)
      const pendentes = validos.filter((c) => !jaEnviados.includes(c.cpf))

      const lancados: string[] = []
      const falharam: Colaborador[] = []
      for (const colab of pendentes) {
        const ok = await enviarColaboradorAoForm(nomeLojaForm, colab)
        if (ok) {
          lancados.push(colab.cpf)
          // Espelha o lançamento na aba "Senhas" da planilha AIVA APROVAÇÃO
          // (Senha/Enviado ficam pro time preencher quando a AIVA liberar).
          await registrarSenhaColab({
            loja: nomeLojaForm,
            cnpj_loja: colab.cnpjLoja,
            nome: colab.nome,
            cpf: colab.cpf,
            email: colab.email,
            telefone: colab.telefone,
          })
        } else {
          falharam.push(colab)
        }
        // Espelho no painel (/registros, aba "Colaboradores das Lojas") —
        // registra TODO envio tentado, com form_ok dizendo se entrou.
        try {
          await supabaseAdmin.from('sdr_registros_colab').upsert(
            [{
              lead_id: lead.id,
              loja: nomeLojaForm,
              telefone_lead: lead.telefone,
              cnpj_loja: colab.cnpjLoja,
              nome: colab.nome,
              cpf: colab.cpf,
              email: colab.email,
              telefone: colab.telefone,
              form_ok: ok,
            }],
            { onConflict: 'lead_id,cpf' },
          )
        } catch (err) {
          console.error(`[REGISTROS] Falha ao espelhar colaborador ${colab.cpf}:`, err)
        }
        await new Promise((r) => setTimeout(r, 400))
      }

      if (lancados.length > 0) {
        const { data: obsRowColab } = await supabaseAdmin
          .from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
        const obsColab = (obsRowColab?.observacoes ?? '')
        const todos = [...new Set([...jaEnviados, ...lancados])]
        const obsLimpa = obsColab.replace(/\s*\[COLAB_FORM:[^\]]*\]\s*/g, ' ').trim()
        await supabaseAdmin
          .from('sdr_leads')
          .update({ observacoes: `${obsLimpa} [COLAB_FORM:${todos.join(',')}]`.trim() })
          .eq('id', lead.id)
      }

      const partesForm: string[] = []
      if (lancados.length > 0) {
        partesForm.push(`✅ *${lancados.length} colaborador(es) JÁ LANÇADO(S) automaticamente no formulário de acesso* (indicação: Parceria Track). Nada a digitar — só acompanhar a liberação.`)
      }
      if (falharam.length > 0) {
        partesForm.push(
          `⚠️ ${falharam.length} falhou(aram) no envio automático — lançar pelo link (já vem preenchido, é só enviar):\n` +
            falharam.map((c) => `• ${c.nome}\n${linkColaboradorPreenchido(nomeLojaForm, c)}`).join('\n'),
        )
      }
      if (incompletos > 0) {
        partesForm.push(`⚠️ ${incompletos} colaborador(es) com dados incompletos/inválidos — conferir na conversa e lançar manualmente.`)
      }
      if (validos.length === 0 && incompletos === 0) {
        // Parse não reconheceu NADA — nunca falhar em silêncio (bug Diana Upstore
        // 2026-07-29: formato fora do padrão passou batido sem aviso).
        partesForm.push(`⚠️ NÃO consegui interpretar os dados automaticamente — conferir a conversa e lançar manualmente no formulário.`)
      }
      if (partesForm.length > 0) blocoForm = `\n\n${partesForm.join('\n\n')}`
      console.log(`[COLAB_FORM] ${lead.telefone}: ${lancados.length} lançado(s), ${falharam.length} falha(s), ${incompletos} incompleto(s)`)
    } catch (err) {
      console.error(`[COLAB_FORM] Erro no lançamento pra ${lead.telefone}:`, err)
    }

    const msg =
      `📋 *${lead.nome}* (${lead.telefone}) mandou dados de colaborador(es) pra cadastrar na plataforma:\n\n` +
      `${resposta.motivo_humano}` +
      blocoForm +
      `\n\n(Dados completos também na conversa — painel ou Evo Talks.)`
    if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
    if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
  } else if (
    ['TREINAR', 'LOGIN'].includes(lead.status) &&
    capturarColaborador(conteudoEfetivo, dadosAcumulados?.cpf_responsavel as string | undefined)
  ) {
    // ─── REDE DE SEGURANÇA — colaborador que a VictorIA não emitiu ───────────
    // Em 04-10/08/2026 sete colaboradores de 4 lojas mandaram nome+CPF+e-mail+
    // telefone e a VictorIA não retornou "dados_colaborador_coletados" — ficaram
    // sem acesso e ninguém viu. Ajustar o prompt melhorou, mas não garantiu
    // (o cenário da WL Elétron continuou falhando em teste). Aqui a captura é
    // determinística: regex + CPF válido, sem depender do julgamento do modelo.
    const capturado = capturarColaborador(conteudoEfetivo, dadosAcumulados?.cpf_responsavel as string | undefined)!
    try {
      const { data: jaTem } = await supabaseAdmin
        .from('sdr_registros_colab').select('id').eq('lead_id', lead.id).eq('cpf', capturado.cpf).maybeSingle()
      const jaNoMarcador = (lead.observacoes ?? '').includes(capturado.cpf)

      if (!jaTem && !jaNoMarcador) {
        const cnpj = String(dadosAcumulados?.cnpj_matriz ?? '').replace(/\D/g, '')
        const colab = {
          cnpjMatriz: cnpj, cnpjLoja: cnpj,
          nome: capturado.nome, cpf: capturado.cpf, email: capturado.email, telefone: capturado.telefone,
        }
        const formOk = cnpj.length === 14 ? await enviarColaboradorAoForm(lead.nome, colab) : false
        if (formOk) {
          await registrarSenhaColab({
            loja: lead.nome, cnpj_loja: cnpj, nome: colab.nome,
            cpf: colab.cpf, email: colab.email, telefone: colab.telefone,
          })
        }
        await supabaseAdmin.from('sdr_registros_colab').upsert([{
          lead_id: lead.id, loja: lead.nome, telefone_lead: lead.telefone, cnpj_loja: cnpj,
          nome: colab.nome, cpf: colab.cpf, email: colab.email, telefone: colab.telefone, form_ok: formOk,
        }], { onConflict: 'lead_id,cpf' })

        const { data: obsRow } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
        const obsAtual = obsRow?.observacoes ?? ''
        const antigos = (obsAtual.match(/\[COLAB_FORM:([^\]]+)\]/)?.[1] ?? '').split(",").map((s: string) => s.trim()).filter(Boolean)
        const todos = [...new Set([...antigos, capturado.cpf])]
        await supabaseAdmin.from('sdr_leads')
          .update({ observacoes: `${obsAtual.replace(/\s*\[COLAB_FORM:[^\]]*\]\s*/g, ' ').trim()} [COLAB_FORM:${todos.join(',')}]`.trim() })
          .eq('id', lead.id)

        const aviso =
          `🛟 *COLABORADOR CAPTURADO PELA REDE DE SEGURANÇA*\n\n` +
          `🏪 ${lead.nome}\n📞 ${lead.telefone}\n\n` +
          `👤 ${colab.nome}\n🆔 CPF: ${colab.cpf}\n📧 ${colab.email}\n📱 ${colab.telefone}\n\n` +
          (formOk
            ? `✅ Lançado no formulário de acesso e na planilha. Nada a fazer — só confira se o nome saiu certinho.`
            : `⚠️ NÃO foi lançado no formulário${cnpj.length === 14 ? '' : ' (lead sem CNPJ matriz nos dados)'} — precisa de lançamento manual.`)
        if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, aviso)
        if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, aviso)
        console.log(`[REDE_COLAB] ${lead.telefone}: ${colab.nome} (${colab.cpf}) capturado — form_ok=${formOk}`)
      }
    } catch (err) {
      console.error(`[REDE_COLAB] Falha ao capturar colaborador de ${lead.telefone}:`, err)
    }
  } else if (resposta.acionar_humano && !autoDetected && !lead.acionar_humano) {
    // Auto-detectado não alerta humanos (seria spam a cada msg do bot do outro lado).
    // O lead fica visível no filtro /?aguardando_humano=true do painel se quiserem revisar.
    //
    // `!lead.acionar_humano` = só alerta na TRANSIÇÃO false→true. Bug 2026-07-10
    // (Central da Informática): pós-pré-aprovação o modelo re-retorna acionar_humano=true
    // a cada msg trivial do lead ("Ok") e o 🔔 re-disparava com aviso confuso. O lead já
    // está no filtro "Aguardando humano" do painel; quando o Nei clica "Atendido"
    // (acionar_humano=false), um novo acionamento volta a alertar normalmente.
    const detalhe = formatarDadosLead(dadosAlerta)
    const msg =
      `🔔 *${lead.nome}* (${lead.telefone}${lead.cidade ? ` — ${lead.cidade}` : ''}) precisa de atendimento humano.\n` +
      `📌 Etapa: ${lead.status}\n` +
      `❓ Motivo: ${resposta.motivo_humano ?? 'não especificado'}\n` +
      `💬 Última mensagem do lojista: "${conteudo}"` +
      (detalhe ? `\n\n${detalhe}` : '')
    if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
    if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
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
