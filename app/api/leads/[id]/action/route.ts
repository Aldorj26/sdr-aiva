import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getMensagens, saveMensagem } from '@/lib/supabase'
import { sendText, sendTemplate } from '@/lib/evotalks'
import { processarMensagem, gerarMioloRetomada } from '@/lib/claude'
import { normalizaNome, APROVACAO_TEMPLATE_VAR, buildAvisoMatrizMsg } from '@/lib/text'

type Action =
  | { type: 'pause'; hours: number }
  | { type: 'unpause' }
  | { type: 'force-followup' }
  | { type: 'mark-descartado' }
  | { type: 'unlock' }
  | { type: 'send-manual'; mensagem: string }
  | { type: 'reprocess' }
  | { type: 'approve' }
  | { type: 'update-lead'; nome?: string; cidade?: string; observacoes?: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const action = (await req.json()) as Action

  const { data: lead, error: leadErr } = await supabaseAdmin
    .from('sdr_leads')
    .select('observacoes, telefone, evotalks_chat_id, nome')
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

    // 4) Marca lead como FORMULARIO_ENVIADO
    await supabaseAdmin
      .from('sdr_leads')
      .update({
        status: 'FORMULARIO_ENVIADO',
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

    // Detecta janela 24h: conta da última msg DO CLIENTE (in)
    let ultimaMsgIn: typeof mensagens[number] | undefined
    for (let i = mensagens.length - 1; i >= 0; i--) {
      if (mensagens[i].direcao === 'in') {
        ultimaMsgIn = mensagens[i]
        break
      }
    }
    const janelaMs = 24 * 60 * 60 * 1000
    const agora = Date.now()
    const tsUltimaIn = ultimaMsgIn ? new Date(ultimaMsgIn.enviado_em).getTime() : NaN
    const diffMs = agora - tsUltimaIn
    const diffHoras = Number.isFinite(diffMs) ? (diffMs / 3600_000).toFixed(2) : 'NaN'
    // Considera janela aberta SOMENTE se diff for número finito E menor que 24h.
    // Se o parsing der NaN, força janela=false (não confia, vai pra HSM).
    const janelaAberta = !!ultimaMsgIn && Number.isFinite(diffMs) && diffMs < janelaMs

    console.log(
      `[lead-action] force-followup id=${id} ultimaIn=${ultimaMsgIn?.enviado_em ?? 'null'} ` +
      `diffHoras=${diffHoras}h janelaAberta=${janelaAberta} totalMsgs=${mensagens.length}`
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

      console.log(`[lead-action] force-followup id=${id} → contextual enviado (${resposta.mensagem.length} chars)`)
      return NextResponse.json({
        ok: true,
        action: 'force-followup',
        modo: 'contextual',
        mensagem: resposta.mensagem,
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

    const nomeNorm = normalizaNome(lead.nome)
    const nomeBase = nomeNorm ?? 'lojista'

    let miolo: string
    try {
      miolo = await gerarMioloRetomada(mensagens, lead.nome ?? 'Lojista')
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

    console.log(`[lead-action] force-followup id=${id} → hsm_retomada enviado (${miolo.length} chars no miolo)`)
    return NextResponse.json({
      ok: true,
      action: 'force-followup',
      modo: 'hsm_retomada',
      mensagem: textoCompleto,
      miolo,
    })
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
