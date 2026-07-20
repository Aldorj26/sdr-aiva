import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getMensagens, saveMensagem } from '@/lib/supabase'
import { sendText, sendTemplate, uploadFileToEvo, sendFileToChat, getOpenChatId } from '@/lib/evotalks'
import { processarMensagem, gerarMioloRetomada, extrairNomeRealDoHistorico } from '@/lib/claude'
import { normalizaNome, APROVACAO_TEMPLATE_VAR, buildAvisoMatrizMsg } from '@/lib/text'

type Action =
  | { type: 'pause'; hours: number }
  | { type: 'unpause' }
  | { type: 'force-followup' }
  | { type: 'mark-descartado' }
  | { type: 'unlock' }
  | { type: 'send-manual'; mensagem: string }
  | {
      type: 'send-info'
      mensagem: string
      anexo?: { fileName: string; mimeType: string; base64: string; width?: number; height?: number }
    }
  | { type: 'reprocess' }
  | { type: 'approve' }
  | { type: 'update-lead'; nome?: string; cidade?: string; observacoes?: string }
  | { type: 'mark-atendido' }
  | { type: 'update-instrucao'; instrucao: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const action = (await req.json()) as Action

  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('sdr_leads')
    .select('observacoes, telefone, evotalks_chat_id, nome, evotalks_opportunity_id')
    .eq('id', id)
    .maybeSingle()
  if (leadErr || !lead) {
    console.warn(`[lead-action] lead_nao_encontrado id=${id} action=${action.type}`)
    return NextResponse.json({ error: 'lead_nao_encontrado' }, { status: 404 })
  }

  // ─── Ações que não passam pelo bloco de updates ───────────────────────────

  if (action.type === 'send-manual') {
    const texto = action.mensagem?.trim()
    if (!texto) return NextResponse.json({ error: 'mensagem_vazia' }, { status: 400 })

    // Janela WhatsApp 24h: texto livre só é entregue se o cliente respondeu nas
    // últimas 24h. Fora disso o WhatsApp aceita mas NÃO entrega (silenciosamente).
    // Bloqueia o envio e orienta o operador a usar "Follow-up agora" — que
    // dispara um template HSM e reabre a janela de conversa.
    const { data: janelaRow } = await supabaseAdmin
      .from('sdr_mensagens')
      .select('enviado_em')
      .eq('lead_id', id)
      .eq('direcao', 'in')
      .gte('enviado_em', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('enviado_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!janelaRow) {
      return NextResponse.json(
        {
          error: 'janela_24h_fechada',
          motivo:
            'O cliente não responde há mais de 24h, então a janela do WhatsApp está fechada — uma mensagem de texto livre NÃO seria entregue.\n\nUse o botão "Follow-up agora" para disparar um template e reabrir a conversa. Depois que o cliente responder, você poderá responder normalmente.',
        },
        { status: 409 },
      )
    }

    try {
      await sendText(lead.telefone, texto, lead.evotalks_chat_id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `envio_falhou: ${msg}` }, { status: 500 })
    }

    await supabaseAdmin.from('sdr_mensagens').insert({
      lead_id: id,
      direcao: 'out',
      conteudo: texto,
    })
    await supabaseAdmin
      .from('sdr_leads')
      .update({ data_ultimo_contato: new Date().toISOString() })
      .eq('id', id)

    return NextResponse.json({ ok: true, action: 'send-manual' })
  }

  // ─── Enviar INFORMAÇÃO PENDENTE (mensagem manual do operador, SEM contexto/IA) ──
  // Abre uma nova interação com o cliente pra mandar uma info que ficou pendente.
  // Janela 24h aberta → texto livre exato. Fechada → template HSM 21 ("Olá {{1}}, {{2}}")
  // com o texto do operador no {{2}} (reabre a conversa). NÃO passa pela VictorIA.
  if (action.type === 'send-info') {
    const texto = action.mensagem?.trim() ?? ''
    const anexo = action.anexo
    // Com anexo, o texto pode ser vazio (vira só a mídia). Sem anexo, exige texto.
    if (!texto && !anexo) return NextResponse.json({ error: 'mensagem_vazia' }, { status: 400 })

    const { data: janelaRow } = await supabaseAdmin
      .from('sdr_mensagens')
      .select('enviado_em')
      .eq('lead_id', id)
      .eq('direcao', 'in')
      .gte('enviado_em', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('enviado_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    // ANEXO só é possível com a JANELA 24h ABERTA — mídia é mensagem de texto
    // livre, e o HSM de reabertura não carrega arquivo. Fora da janela, bloqueia
    // com uma explicação clara (o operador manda o texto pra reabrir e anexa
    // depois que o lojista responder).
    if (anexo && !janelaRow) {
      return NextResponse.json(
        {
          error: 'janela_fechada_anexo',
          info: 'Não dá pra enviar anexo agora: o lojista não responde há mais de 24h (janela do WhatsApp fechada). Anexo só vai como conversa aberta. Mande só o texto pra reabrir a conversa e, quando o lojista responder, anexe o arquivo.',
        },
        { status: 409 }
      )
    }

    if (janelaRow) {
      try {
        if (anexo) {
          // Sobe o arquivo pro Evo e envia como mídia com o texto de legenda.
          const chatId = lead.evotalks_chat_id ? Number(lead.evotalks_chat_id) : await getOpenChatId(lead.telefone)
          if (!chatId) throw new Error('chat_aberto_nao_encontrado')
          const fileId = await uploadFileToEvo({
            fileName: anexo.fileName,
            mimeType: anexo.mimeType,
            base64: anexo.base64,
            width: anexo.width,
            height: anexo.height,
          })
          await sendFileToChat(chatId, fileId, texto)
          // Registra no histórico com o marcador de mídia (mesmo formato do inbound,
          // pra o painel exibir a imagem/arquivo que FOI ENVIADO pelo operador).
          const marcador = anexo.mimeType.startsWith('image/')
            ? `[LEAD_ENVIOU_IMAGEM:${fileId}]`
            : `[LEAD_ENVIOU_ARQUIVO:${fileId}:${anexo.mimeType}]`
          await supabaseAdmin.from('sdr_mensagens').insert(
            texto
              ? [
                  { lead_id: id, direcao: 'out', conteudo: `[Anexo enviado (manual via painel)] ${texto}` },
                  { lead_id: id, direcao: 'out', conteudo: marcador },
                ]
              : [{ lead_id: id, direcao: 'out', conteudo: marcador }]
          )
        } else {
          // Janela aberta, sem anexo → texto livre exato (sem template)
          await sendText(lead.telefone, texto, lead.evotalks_chat_id)
          await supabaseAdmin.from('sdr_mensagens').insert({
            lead_id: id,
            direcao: 'out',
            conteudo: `[Info pendente (manual via painel)] ${texto}`,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return NextResponse.json({ error: `envio_falhou: ${msg}` }, { status: 500 })
      }
      await supabaseAdmin
        .from('sdr_leads')
        .update({ data_ultimo_contato: new Date().toISOString() })
        .eq('id', id)
      return NextResponse.json({ ok: true, action: 'send-info', modo: anexo ? 'anexo' : 'texto_livre', mensagem: texto })
    }

    // Janela fechada (sem anexo) → template HSM 21 com o texto do operador no {{2}}
    const templateId = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
    if (!templateId) {
      return NextResponse.json({ error: 'template_reativacao_nao_configurado' }, { status: 500 })
    }
    const nomeBase = normalizaNome(lead.nome) ?? 'lojista'
    try {
      await sendTemplate(lead.telefone, templateId, [nomeBase, texto])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `template_falhou: ${msg}` }, { status: 500 })
    }
    const textoCompleto = `Olá ${nomeBase}, ${texto}`
    await supabaseAdmin.from('sdr_mensagens').insert([
      {
        lead_id: id,
        direcao: 'out',
        conteudo: `[Info pendente (manual via painel, HSM) — ${nomeBase}]`,
        template_hsm: 'aiva_reativacao_48h',
      },
      { lead_id: id, direcao: 'out', conteudo: textoCompleto },
    ])
    await supabaseAdmin
      .from('sdr_leads')
      .update({ data_ultimo_contato: new Date().toISOString() })
      .eq('id', id)
    return NextResponse.json({ ok: true, action: 'send-info', modo: 'hsm', mensagem: textoCompleto })
  }

  if (action.type === 'update-lead') {
    const updates: Record<string, unknown> = {}

    if (typeof action.nome === 'string') {
      const novoNome = action.nome.trim()
      if (!novoNome) {
        return NextResponse.json({ error: 'nome_vazio' }, { status: 400 })
      }
      updates.nome = novoNome
    }

    if (typeof action.cidade === 'string') {
      const novaCidade = action.cidade.trim()
      updates.cidade = novaCidade || null
    }

    if (typeof action.observacoes === 'string') {
      const novoTexto = action.observacoes.trim()
      // Preserva o flag [PAUSA_ATE:...] se existir nas observações antigas e
      // o usuário tiver removido por engano (a flag controla a pausa, não deve
      // ser perdida via edição manual).
      const pausaMatch = lead.observacoes?.match(/\[PAUSA_ATE:[^\]]+\]/)
      if (pausaMatch && !novoTexto.includes('[PAUSA_ATE:')) {
        updates.observacoes = `${novoTexto} ${pausaMatch[0]}`.trim()
      } else {
        updates.observacoes = novoTexto || null
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'nada_a_atualizar' }, { status: 400 })
    }

    const { error: updErr } = await supabaseAdmin
      .from('sdr_leads')
      .update(updates)
      .eq('id', id)

    if (updErr) {
      console.error(`[lead-action] update-lead falhou id=${id}:`, updErr.message)
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }

    console.log(`[lead-action] update-lead id=${id} campos=${Object.keys(updates).join(',')}`)
    return NextResponse.json({ ok: true, action: 'update-lead', updates })
  }

  if (action.type === 'approve') {
    const templateId = Number(process.env.AIVA_APROVACAO_TEMPLATE_ID ?? 0)
    if (!templateId) {
      console.warn(`[lead-action] approve falhou id=${id}: AIVA_APROVACAO_TEMPLATE_ID nao configurado`)
      return NextResponse.json(
        { error: 'template_aprovacao_nao_configurado' },
        { status: 500 }
      )
    }

    const telefone = (lead.telefone ?? '').replace(/\D/g, '')
    if (!telefone) {
      return NextResponse.json({ error: 'telefone_nao_encontrado' }, { status: 400 })
    }

    const nomeContato = normalizaNome(lead.nome)
    console.log(`[lead-action] approve id=${id} telefone=${telefone} nome=${nomeContato ?? '(sem nome)'}`)

    // 1) Dispara HSM template 15 (Link de Cadastro AIVA) — abre janela 24h
    try {
      await sendTemplate(telefone, templateId, [APROVACAO_TEMPLATE_VAR])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[lead-action] approve sendTemplate falhou id=${id}: ${msg}`)
      return NextResponse.json({ error: `template_falhou: ${msg}` }, { status: 500 })
    }

    // 2) Aviso CNPJ matriz/filial (texto livre, dentro da janela aberta)
    const avisoMatrizMsg = buildAvisoMatrizMsg(nomeContato)
    let avisoOk = true
    try {
      await sendText(telefone, avisoMatrizMsg, lead.evotalks_chat_id)
    } catch (err) {
      avisoOk = false
      console.error(`[lead-action] approve aviso falhou id=${id}:`, err)
    }

    // 3) Registra ambas as mensagens no histórico
    await supabaseAdmin.from('sdr_mensagens').insert([
      {
        lead_id: id,
        direcao: 'out',
        conteudo: `[Template (CAMPANHA) Link de Cadastro enviado via aprovacao manual no painel — ${nomeContato ?? 'Lojista'}]`,
        template_hsm: 'aiva_link_cadastro',
      },
      ...(avisoOk
        ? [{ lead_id: id, direcao: 'out' as const, conteudo: avisoMatrizMsg }]
        : []),
    ])

    // 4) Marca lead como CADASTRO_RECEBIDO
    await supabaseAdmin
      .from('sdr_leads')
      .update({
        status: 'CADASTRO_RECEBIDO',
        data_ultimo_contato: new Date().toISOString(),
        data_proximo_followup: null,
      })
      .eq('id', id)

    return NextResponse.json({
      ok: true,
      action: 'approve',
      template_enviado: true,
      aviso_matriz_enviado: avisoOk,
      telefone,
    })
  }

  if (action.type === 'reprocess') {
    // Pega última mensagem recebida do lead
    const { data: lastMsg } = await supabaseAdmin
      .from('sdr_mensagens')
      .select('conteudo')
      .eq('lead_id', id)
      .eq('direcao', 'in')
      .order('enviado_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!lastMsg) {
      return NextResponse.json({ error: 'sem_mensagem_para_reprocessar' }, { status: 404 })
    }

    // Limpa lock se existir para não bloquear o reprocessamento
    await supabaseAdmin
      .from('sdr_leads')
      .update({ webhook_lock_at: null })
      .eq('id', id)

    // Chama o webhook internamente com o payload reconstituído
    const origin = new URL(req.url).origin
    const webhookRes = await fetch(`${origin}/api/sdr/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.WEBHOOK_SECRET ?? '',
      },
      body: JSON.stringify({
        event: 'messages.upsert',
        data: {
          key: { fromMe: false, remoteJid: `${lead.telefone}@s.whatsapp.net` },
          message: { conversation: lastMsg.conteudo },
        },
      }),
    })

    const webhookData = await webhookRes.json().catch(() => ({}))
    return NextResponse.json({ ok: webhookRes.ok, action: 'reprocess', ...webhookData })
  }

  if (action.type === 'force-followup') {
    // Estratégia em 3 modos — auto-detecta o melhor formato de envio:
    //
    // 1) AGENDADO: se o lead nem começou a conversar (só recebeu HSM inicial e
    //    nunca respondeu), só bumpa data_proximo_followup. O cron de follow-up
    //    vai pegar e disparar o template HSM da etapa.
    //
    // 2) CONTEXTUAL (texto livre): se a janela WhatsApp 24h está ABERTA
    //    (última msg do CLIENTE há menos de 24h), gera msg natural via Claude
    //    e envia como texto livre.
    //
    // 3) HSM RETOMADA (template 21): se a janela 24h está FECHADA, gera o
    //    miolo curto contextualizado e dispara o template HSM "Follow Up Aiva"
    //    com {{1}}=nome e {{2}}=miolo. Reabre a janela 24h.
    const mensagens = await getMensagens(id, 20)
    const temConversa =
      mensagens.length >= 2 && mensagens.some((m) => m.direcao === 'in')

    if (!temConversa) {
      // Modo 1: AGENDADO — bumpa a data, cron pega
      await supabaseAdmin
        .from('sdr_leads')
        .update({ data_proximo_followup: new Date().toISOString() })
        .eq('id', id)
      console.log(`[lead-action] force-followup id=${id} → fallback (sem conversa, agendado pro cron)`)
      return NextResponse.json({
        ok: true,
        action: 'force-followup',
        modo: 'agendado',
        info: 'Lead sem conversa real — agendado pro próximo cron de follow-up (HSM template)',
      })
    }

    // Detecta janela 24h via SQL — deixa o Postgres comparar timestamps
    // (mais confiável que parse JS de timestamptz). Janela aberta = existe
    // pelo menos 1 msg 'in' nas últimas 24h.
    const { data: janelaRow } = await supabaseAdmin
      .from('sdr_mensagens')
      .select('enviado_em')
      .eq('lead_id', id)
      .eq('direcao', 'in')
      .gte('enviado_em', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('enviado_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    const janelaAberta = !!janelaRow

    // Pega também a ÚLTIMA in (sem filtro de janela) só pra log
    const { data: ultimaInRow } = await supabaseAdmin
      .from('sdr_mensagens')
      .select('enviado_em')
      .eq('lead_id', id)
      .eq('direcao', 'in')
      .order('enviado_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    console.log(
      `[lead-action v4] force-followup id=${id} ` +
      `ultimaIn=${ultimaInRow?.enviado_em ?? 'null'} ` +
      `janelaAberta=${janelaAberta} totalMsgs=${mensagens.length}`
    )

    if (janelaAberta) {
      // Modo 2: CONTEXTUAL (texto livre via Claude)
      const instrucao =
        '[INSTRUÇÃO DO SISTEMA: O operador humano clicou "Follow-up agora" no painel pra retomar essa conversa que ficou parada. ' +
        'Envie UMA mensagem curta e natural que dê sequência ao que foi conversado, retomando o último ponto pendente. ' +
        'Não repita informações já ditas, não comece com "Olá" ou apresentação — você JÁ está em conversa. ' +
        'Máximo 2-3 linhas. Se o último ponto foi uma pergunta sua que não foi respondida, refaça de outro jeito ou ofereça ajuda.]'

      let resposta
      try {
        resposta = await processarMensagem(instrucao, mensagens, lead.nome ?? 'Lojista')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[lead-action] force-followup Claude falhou id=${id}: ${msg}`)
        return NextResponse.json({ error: `claude_falhou: ${msg}` }, { status: 500 })
      }

      if (!resposta?.mensagem?.trim()) {
        return NextResponse.json({ error: 'claude_retornou_vazio' }, { status: 500 })
      }

      try {
        await sendText(lead.telefone, resposta.mensagem, lead.evotalks_chat_id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[lead-action] force-followup sendText falhou id=${id}: ${msg}`)
        return NextResponse.json({ error: `envio_falhou: ${msg}` }, { status: 500 })
      }

      await saveMensagem(id, 'out', resposta.mensagem)
      await supabaseAdmin
        .from('sdr_leads')
        .update({ data_ultimo_contato: new Date().toISOString() })
        .eq('id', id)

      console.log(`[lead-action v4] force-followup id=${id} → contextual enviado (${resposta.mensagem.length} chars)`)
      return NextResponse.json({
        ok: true,
        action: 'force-followup',
        modo: 'contextual',
        mensagem: resposta.mensagem,
        debug: {
          ultimaIn: ultimaInRow?.enviado_em ?? null,
          janelaAberta,
          totalMsgs: mensagens.length,
        },
      })
    }

    // Modo 3: HSM RETOMADA — janela 24h fechada, dispara template 21 com miolo gerado
    const templateId = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
    if (!templateId) {
      console.warn(`[lead-action] force-followup id=${id}: AIVA_REATIVACAO_TEMPLATE_ID nao configurado`)
      return NextResponse.json(
        { error: 'template_reativacao_nao_configurado' },
        { status: 500 }
      )
    }

    // Tenta extrair o nome REAL do cliente do histórico antes de cair no
    // `lead.nome` cadastrado (que costuma ser o nome da loja, não da pessoa —
    // 77% da base sofre disso). Se o histórico não der confiança, usa o
    // fallback normalizado mesmo (comportamento anterior).
    const nomeStored = normalizaNome(lead.nome) ?? 'lojista'
    let nomeBase: string
    try {
      nomeBase = await extrairNomeRealDoHistorico(mensagens, nomeStored)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[lead-action] force-followup extrairNomeReal falhou id=${id}: ${msg}`)
      nomeBase = nomeStored
    }
    if (nomeBase !== nomeStored) {
      console.log(`[lead-action] force-followup id=${id}: nome stored="${nomeStored}" → real="${nomeBase}"`)
    }

    let miolo: string
    try {
      miolo = await gerarMioloRetomada(mensagens, nomeBase)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[lead-action] force-followup gerarMioloRetomada falhou id=${id}: ${msg}`)
      return NextResponse.json({ error: `claude_falhou: ${msg}` }, { status: 500 })
    }

    if (!miolo) {
      // Fallback: miolo padrão se Claude retornar vazio (raro, mas evita HSM bonita
      // virar mensagem branca)
      miolo = 'ainda dá pra continuar de onde paramos. consegue retornar pra finalizarmos?'
    }

    try {
      await sendTemplate(lead.telefone, templateId, [nomeBase, miolo])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[lead-action] force-followup sendTemplate falhou id=${id}: ${msg}`)
      return NextResponse.json({ error: `template_falhou: ${msg}` }, { status: 500 })
    }

    // Salva no histórico tanto o marker do template (pra métrica/audit) quanto o
    // texto cheio reconstruído (pra Claude ter contexto na próxima resposta)
    const textoCompleto = `Olá ${nomeBase}, ${miolo}`
    await supabaseAdmin.from('sdr_mensagens').insert([
      {
        lead_id: id,
        direcao: 'out',
        conteudo: `[Template Follow Up Aiva (retomada manual via painel) — ${nomeBase}]`,
        template_hsm: 'aiva_reativacao_48h',
      },
      {
        lead_id: id,
        direcao: 'out',
        conteudo: textoCompleto,
      },
    ])
    await supabaseAdmin
      .from('sdr_leads')
      .update({ data_ultimo_contato: new Date().toISOString() })
      .eq('id', id)

    console.log(`[lead-action v4] force-followup id=${id} → hsm_retomada enviado (${miolo.length} chars no miolo)`)
    return NextResponse.json({
      ok: true,
      action: 'force-followup',
      modo: 'hsm_retomada',
      mensagem: textoCompleto,
      miolo,
      debug: {
        ultimaIn: ultimaInRow?.enviado_em ?? null,
        janelaAberta,
        totalMsgs: mensagens.length,
      },
    })
  }

  if (action.type === 'update-instrucao') {
    const instrucao = action.instrucao?.trim() || null
    const { error } = await supabaseAdmin
      .from('sdr_leads')
      .update({ instrucao_silvia: instrucao })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, action: 'update-instrucao', instrucao })
  }

  // ─── Ações que atualizam colunas simples ─────────────────────────────────

  const updates: Record<string, unknown> = {}

  switch (action.type) {
    case 'pause': {
      const hours = Math.max(1, Math.min(720, Number(action.hours) || 24))
      const ate = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
      const base = (lead.observacoes ?? '').replace(/\s*\[PAUSA_ATE:[^\]]+\]/, '')
      updates.observacoes = `${base} [PAUSA_ATE:${ate}]`.trim()
      updates.status = 'AGUARDANDO'
      updates.data_proximo_followup = ate
      break
    }
    case 'unpause': {
      updates.observacoes = (lead.observacoes ?? '').replace(/\s*\[PAUSA_ATE:[^\]]+\]/, '').trim() || null
      break
    }
    case 'mark-descartado': {
      updates.status = 'DESCARTADO'
      updates.data_proximo_followup = null
      break
    }
    case 'mark-atendido': {
      // Humano atendeu o lead: limpa a flag para ele sair da fila "Precisam de
      // atendimento" e voltar à automação da VictorIA (webhook + cadência).
      updates.acionar_humano = false
      const carimbo = `[ATENDIDO_HUMANO:${new Date().toISOString()}]`
      const base = (lead.observacoes ?? '').replace(/\s*\[ATENDIDO_HUMANO:[^\]]+\]/, '')
      updates.observacoes = `${base} ${carimbo}`.trim()
      // Atendimento humano é controlado só pelo painel (acionar_humano) — sem
      // etiqueta no Evo desde 29/05/2026. Nada a fazer no CRM aqui.
      break
    }
    case 'unlock': {
      updates.webhook_lock_at = null
      break
    }
    default:
      return NextResponse.json({ error: 'acao_invalida' }, { status: 400 })
  }

  const { error: updErr } = await supabaseAdmin
    .from('sdr_leads')
    .update(updates)
    .eq('id', id)

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, action: action.type, updates })
}
