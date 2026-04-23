import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, saveMensagem, getMensagens, type Lead, type Mensagem } from '@/lib/supabase'
import { sendText } from '@/lib/evotalks'
import { processarMensagem } from '@/lib/claude'
import { isDiaUtil, rotuloHorario } from '@/lib/business-time'

export const maxDuration = 60

const TRES_HORAS_MS = 3 * 60 * 60 * 1000
const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000
const MAX_LEADS_POR_EXECUCAO = 5

/**
 * Remove mensagens 'out' que são apenas marcadores internos (ex: "[Template X enviado]").
 * Duplicado do webhook/route.ts — mantido aqui pra evitar dependência circular.
 */
function stripInternalMarkers(msgs: Mensagem[]): Mensagem[] {
  return msgs.filter((m) => {
    if (m.direcao !== 'out') return true
    return !/^\[.*\]$/.test(m.conteudo.trim())
  })
}

/**
 * Cron de nudge — cutuca leads com conversa parada há 3+ horas.
 * Roda a cada hora via Vercel Cron.
 *
 * Detecta pausa pela última mensagem em sdr_mensagens (não por data_ultimo_contato),
 * cobrindo leads em DISPARO_REALIZADO, INTERESSADO e AGUARDANDO.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Skip em fim de semana (sáb/dom BRT) — nudge é "automação de impacto"
  if (!isDiaUtil()) {
    console.log(`[nudge] skip: ${rotuloHorario()} (fim de semana)`)
    return NextResponse.json({ ok: true, ignorado: 'fim_de_semana', quando: rotuloHorario() })
  }

  // Só dispara em horário comercial BRT (8h–20h)
  const horaBrt = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  )
  if (horaBrt < 8 || horaBrt >= 20) {
    return NextResponse.json({ ok: true, ignorado: 'fora_horario_comercial', hora_brt: horaBrt })
  }

  // Busca leads que podem receber nudge:
  // — Exclui status finais/em espera (OPT_OUT, descartados, cadastros finalizados)
  // — AGUARDANDO_APROVACAO: lead aguarda aprovação interna, não deve ser cutucado
  // — CADASTRO_COMPLETO / FORMULARIO_ENVIADO: fluxo encerrado, humano assumiu
  // O filtro real de "parado há 3h+" é feito no loop via sdr_mensagens
  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('*')
    .not('status', 'in', '("OPT_OUT","NAO_QUALIFICADO","DESCARTADO","FORMULARIO_ENVIADO","AGUARDANDO_APROVACAO","CADASTRO_COMPLETO","BOT_DETECTADO")')

  if (error) {
    console.error('Erro ao buscar leads para nudge:', error)
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  }

  if (!leads?.length) {
    return NextResponse.json({ ok: true, processados: 0, mensagem: 'Nenhum lead para nudge' })
  }

  const agora = Date.now()
  let enviados = 0
  let pulados = 0
  let processadosComClaude = 0

  for (const lead of leads as Lead[]) {
    if (processadosComClaude >= MAX_LEADS_POR_EXECUCAO) {
      pulados++
      continue
    }
    try {
      const mensagensRaw = await getMensagens(lead.id, 10)
      // Remove marcadores internos ([Template X enviado]) — confundem a VictorIA
      // sobre a fase atual, especialmente em COLETANDO_COMPLEMENTO.
      const mensagens = stripInternalMarkers(mensagensRaw)

      // Sem conversa real (só template inicial ou sem msgs) — pula
      if (mensagens.length < 2) {
        pulados++
        continue
      }

      const ultimaMensagem = mensagens[mensagens.length - 1]

      // Lead respondeu mas webhook não processou — pula (será tratado separadamente)
      if (ultimaMensagem.direcao === 'in') {
        pulados++
        continue
      }

      // Verifica se o último 'out' foi há 3h-24h (janela válida do WhatsApp)
      const ultimoOutMs = new Date(ultimaMensagem.enviado_em).getTime()
      const pausaMs = agora - ultimoOutMs
      if (pausaMs < TRES_HORAS_MS || pausaMs > VINTE_QUATRO_HORAS_MS) {
        pulados++
        continue
      }

      // Conta 'out' consecutivos no final — máximo 2 nudges por pausa
      // (pergunta original + nudge 1 às 3h + nudge 2 às 6h = 3 out = para)
      let outConsecutivos = 0
      for (let i = mensagens.length - 1; i >= 0; i--) {
        if (mensagens[i].direcao === 'out') outConsecutivos++
        else break
      }
      if (outConsecutivos >= 3) {
        pulados++
        continue
      }

      // Guard de concorrência: marca data_ultimo_contato ANTES de enviar.
      // Se outra instância já atualizou nos últimos 10 min, pula (evita rajada duplicada).
      const DEZ_MIN_MS = 10 * 60 * 1000
      const ultimoContatoMs = lead.data_ultimo_contato ? new Date(lead.data_ultimo_contato).getTime() : 0
      if (agora - ultimoContatoMs < DEZ_MIN_MS) {
        pulados++
        continue
      }
      const { error: lockError } = await supabaseAdmin
        .from('sdr_leads')
        .update({ data_ultimo_contato: new Date().toISOString() })
        .eq('id', lead.id)
        .eq('data_ultimo_contato', lead.data_ultimo_contato) // só atualiza se não mudou (CAS)
      if (lockError) {
        pulados++ // outra instância ganhou a corrida
        continue
      }

      // Gera nudge contextual via Claude usando o histórico.
      // Para COLETANDO_COMPLEMENTO, instrução específica de Fase 3 — o buildFaseInstrucao
      // vai injetar a instrução de fase no user message, então só precisamos adicionar
      // o contexto de que o lead parou de responder e qual dado ainda falta.
      const nudgeInstrucao = lead.status === 'COLETANDO_COMPLEMENTO'
        ? '[INSTRUÇÃO DO SISTEMA: O lead parou de responder durante o preenchimento do cadastro (Fase 3). Envie UMA mensagem curta e gentil lembrando que falta concluir o preenchimento. Olhe o histórico, identifique qual dado ainda não foi informado e pergunte especificamente por ele. Seja breve e amigável — máximo 2 linhas.]'
        : '[INSTRUÇÃO DO SISTEMA: O lead parou de responder há mais de 3 horas. Envie UMA mensagem curta e natural de follow-up para retomar a conversa. Não repita informações já ditas. Seja breve e direto — máximo 2 linhas. Retome a última pergunta de forma diferente ou ofereça ajuda.]'

      const resposta = await processarMensagem(nudgeInstrucao, mensagens, lead.nome, lead.status)

      await sendText(lead.telefone, resposta.mensagem)
      await saveMensagem(lead.id, 'out', resposta.mensagem)

      console.log(`Nudge enviado para ${lead.nome} (${lead.telefone}) — ${outConsecutivos + 1}º out consecutivo`)
      enviados++
      processadosComClaude++
    } catch (err) {
      console.error(`Erro no nudge do lead ${lead.id}:`, err)
      pulados++
      processadosComClaude++
    }
  }

  return NextResponse.json({ ok: true, total: leads.length, enviados, pulados, limite: MAX_LEADS_POR_EXECUCAO })
}

// Vercel Cron — roda a cada hora
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  return POST(
    new NextRequest(req.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.WEBHOOK_SECRET}` },
    })
  )
}
