/**
 * followup-fase/route.ts
 *
 * Cron diário que monitora leads em duas fases críticas sem resposta há 24h+:
 *
 *   COLETANDO_COMPLEMENTO — VictorIA está coletando os 5 dados restantes.
 *   Lead sumiu → reabre janela 24h com template de retomada.
 *
 *   ANALISE_AIVA — Link da CAF foi enviado, lead precisa concluir
 *   o cadastro + biometria facial. Cobra a conclusão.
 *
 * Usa o template HSM AIVA_REATIVACAO_TEMPLATE_ID ("Follow Up Aiva" — template 21)
 * com miolo contextualizado gerado pelo Claude via gerarMioloRetomada().
 *
 * Anti-spam:
 *   - Só envia se [FOLLOWUP_FASE:ISO] em observacoes for >= 24h atrás (ou inexistente)
 *   - Máximo MAX_FOLLOWUPS por lead — após isso alerta Nei e para de tentar
 *   - Respeita [PAUSA_ATE:ISO] em observacoes
 *
 * Schedule (vercel.json): 0 16 * * *  →  13h BRT
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, getMensagens } from '@/lib/supabase'
import { sendTemplate, alertHuman } from '@/lib/evotalks'
import { gerarMioloRetomada, extrairNomeRealDoHistorico } from '@/lib/claude'
import { normalizaNome } from '@/lib/text'

// Após MAX_FOLLOWUPS sem resposta, escala pro Nei em vez de continuar enviando.
const MAX_FOLLOWUPS = 3

// ─── Helpers de flags em observacoes ──────────────────────────────────────────

function getFollowupCount(obs: string | null): number {
  if (!obs) return 0
  const m = obs.match(/\[FOLLOWUP_FASE_COUNT:(\d+)\]/)
  return m ? parseInt(m[1], 10) : 0
}

function getLastFollowupAt(obs: string | null): Date | null {
  if (!obs) return null
  const m = obs.match(/\[FOLLOWUP_FASE:([^\]]+)\]/)
  if (!m) return null
  const d = new Date(m[1])
  return isNaN(d.getTime()) ? null : d
}

function setFollowupFlags(obs: string | null, count: number): string {
  // Remove flags antigas antes de adicionar novas
  const base = (obs ?? '')
    .replace(/\s*\[FOLLOWUP_FASE:[^\]]+\]\s*/g, '')
    .replace(/\s*\[FOLLOWUP_FASE_COUNT:\d+\]\s*/g, '')
    .trim()
  return `${base} [FOLLOWUP_FASE:${new Date().toISOString()}] [FOLLOWUP_FASE_COUNT:${count}]`.trim()
}

function hasPausa(obs: string | null): boolean {
  if (!obs) return false
  const m = obs.match(/\[PAUSA_ATE:([^\]]+)\]/)
  if (!m) return false
  const ate = new Date(m[1])
  return !isNaN(ate.getTime()) && new Date() < ate
}

// ─── Fallback de miolo (caso Claude falhe) ─────────────────────────────────────

function mioloFallback(status: string): string {
  return status === 'ANALISE_AIVA'
    ? 'ainda dá pra finalizar o cadastro na plataforma. consegue acessar o link e completar a biometria?'
    : 'ainda dá pra continuar o cadastro. consegue retornar pra finalizarmos?'
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Autenticação
  const secret =
    req.headers.get('x-internal-secret') ??
    req.nextUrl.searchParams.get('secret') ??
    ''
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Template HSM de retomada (template 21 — "Follow Up Aiva")
  const templateId = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
  if (!templateId) {
    console.error('[followup-fase] AIVA_REATIVACAO_TEMPLATE_ID não configurado')
    return NextResponse.json(
      { error: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' },
      { status: 500 }
    )
  }

  // Guarda de horário comercial BRT (8h–18h)
  const agora = new Date()
  const horasBRT = agora.getUTCHours() - 3
  if (horasBRT < 8 || horasBRT >= 18) {
    return NextResponse.json({ ok: true, ignorado: 'fora_horario_comercial', horasBRT })
  }

  // Busca leads elegíveis: COLETANDO_COMPLEMENTO ou ANALISE_AIVA, sem resposta há 24h+
  const limite24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, observacoes, evotalks_chat_id, produto')
    .in('status', ['COLETANDO_COMPLEMENTO', 'ANALISE_AIVA'])
    .lt('data_ultimo_contato', limite24h)
    .neq('produto', 'TRIAGEM')
    .order('data_ultimo_contato', { ascending: true })
    .limit(30)

  if (error) {
    console.error('[followup-fase] erro ao buscar leads:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let enviados = 0
  let ignorados = 0
  let escalados = 0
  const resultados: Array<{ telefone: string; status: string; acao: string }> = []

  for (const lead of leads ?? []) {
    try {
      // Pula leads em pausa temporária
      if (hasPausa(lead.observacoes)) {
        ignorados++
        resultados.push({ telefone: lead.telefone, status: lead.status, acao: 'ignorado_pausa' })
        continue
      }

      // Pula se já enviou follow-up nas últimas 24h (proteção dupla contra spam)
      const lastFollowup = getLastFollowupAt(lead.observacoes)
      if (
        lastFollowup &&
        Date.now() - lastFollowup.getTime() < 24 * 60 * 60 * 1000
      ) {
        ignorados++
        resultados.push({
          telefone: lead.telefone,
          status: lead.status,
          acao: 'ignorado_followup_recente',
        })
        continue
      }

      const count = getFollowupCount(lead.observacoes)

      // Após MAX_FOLLOWUPS sem resposta: escala pro Nei e para de tentar
      if (count >= MAX_FOLLOWUPS) {
        const msg =
          `⏰ *${lead.nome}* (${lead.telefone}) está em *${lead.status}* há mais de 24h ` +
          `e já recebeu ${count} follow-up${count > 1 ? 's' : ''} automático${count > 1 ? 's' : ''} sem resposta.\n` +
          `Precisa de atenção manual.`
        try {
          if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
        } catch (alertErr) {
          console.error(`[followup-fase] alerta Nei falhou para ${lead.telefone}:`, alertErr)
        }
        await supabaseAdmin
          .from('sdr_leads')
          .update({ acionar_humano: true, data_proximo_followup: null })
          .eq('id', lead.id)

        escalados++
        resultados.push({
          telefone: lead.telefone,
          status: lead.status,
          acao: `escalado_apos_${count}_followups`,
        })
        continue
      }

      // Gera miolo contextualizado via Claude
      const mensagens = await getMensagens(lead.id, 20)
      const nomeStored = normalizaNome(lead.nome) ?? 'lojista'

      let nomeReal: string
      try {
        nomeReal = await extrairNomeRealDoHistorico(mensagens, nomeStored)
      } catch {
        nomeReal = nomeStored
      }

      let miolo: string
      try {
        miolo = await gerarMioloRetomada(mensagens, nomeReal)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[followup-fase] gerarMioloRetomada falhou id=${lead.id}: ${msg}`)
        miolo = ''
      }
      if (!miolo?.trim()) {
        miolo = mioloFallback(lead.status)
      }

      // Dispara template HSM de retomada
      await sendTemplate(lead.telefone, templateId, [nomeReal, miolo])

      // Salva no histórico: marker (pra audit) + texto completo (pra Claude ter contexto)
      const textoCompleto = `Olá ${nomeReal}, ${miolo}`
      const labelFase = lead.status === 'ANALISE_AIVA' ? 'cobrança CAF' : 'retomada cadastro'
      await supabaseAdmin.from('sdr_mensagens').insert([
        {
          lead_id: lead.id,
          direcao: 'out',
          conteudo: `[Template Follow Up Aiva (followup-fase automático — ${labelFase}) — ${nomeReal}]`,
          template_hsm: 'aiva_reativacao',
        },
        {
          lead_id: lead.id,
          direcao: 'out',
          conteudo: textoCompleto,
        },
      ])

      // Atualiza data_ultimo_contato + flags anti-spam
      const newObs = setFollowupFlags(lead.observacoes, count + 1)
      await supabaseAdmin
        .from('sdr_leads')
        .update({
          data_ultimo_contato: new Date().toISOString(),
          observacoes: newObs,
        })
        .eq('id', lead.id)

      enviados++
      resultados.push({
        telefone: lead.telefone,
        status: lead.status,
        acao: `enviado_${count + 1}_de_${MAX_FOLLOWUPS}`,
      })
      console.log(
        `[followup-fase] enviado: ${lead.telefone} (${lead.status}) count=${count + 1}/${MAX_FOLLOWUPS}`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[followup-fase] erro no lead ${lead.id}:`, msg)
      ignorados++
      resultados.push({
        telefone: lead.telefone,
        status: lead.status,
        acao: `erro: ${msg.slice(0, 80)}`,
      })
    }
  }

  console.log(
    `[followup-fase] concluído: ${enviados} enviados, ${ignorados} ignorados, ${escalados} escalados de ${(leads ?? []).length} total`
  )
  return NextResponse.json({
    ok: true,
    enviados,
    ignorados,
    escalados,
    total: (leads ?? []).length,
    resultados,
  })
}
