/**
 * cobranca-docs/route.ts (AIVA — lembrete D+2 dos documentos sem sócio)
 *
 * Origem: caso Alex/Loja Online 2026-07-28 — lojista sem sócio recebe o pedido
 * dos 5 documentos, some, e ninguém cobrava (o nudge só atua na qualificação).
 *
 * O que faz: cron diário que encontra leads com o fluxo de documentos ativo
 * ([DOCS_SEM_SOCIO]) e ainda incompleto (sem [LINHA_MANUAL_OK]), parados há
 * 2+ dias, e manda um lembrete via template HSM 48 coringa ("Olá {{1}}, {{2}}")
 * — entrega garantida mesmo com a janela 24h fechada. Quando o lojista
 * responde/manda arquivo, o fluxo normal assume (Drive + confirmações).
 *
 * Anti-spam: máx 3 lembretes por lead, 3 dias entre eles.
 * Flags: [DOCS_COBRANCA_N:n] [DOCS_COBRANCA_ULTIMA:ISO]
 *
 * Params: ?dry=true (preview) | ?max=N (lote, default 20)
 * Schedule: 0 13 * * * UTC = 10h BRT diário
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const REOPEN_TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const DIA_MS = 24 * 60 * 60 * 1000
const MAX_COBRANCAS = 3
const COOLDOWN_DIAS = 3
const QUIETO_DIAS = 2

// {{2}} do HSM — UMA linha, sem \n (regra da Meta pra parâmetro de template).
const MIOLO_DOCS =
  'tudo bem? 😊 Só passando pra lembrar dos documentos que ainda preciso pro seu cadastro na AIVA: contrato social, e-mail para assinatura do contrato, selfie do responsável, documento com foto (RG ou CNH) e dados bancários. Pode mandar por aqui mesmo que eu já encaminho pra análise!'

const STATUS_ATIVOS = ['INTERESSADO', 'PRE_APROVACAO', 'CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA']

function parseFlagDate(obs: string, key: string): Date | null {
  const m = obs.match(new RegExp(`\\[${key}:([^\\]]+)\\]`))
  if (!m) return null
  const d = new Date(m[1])
  return isNaN(d.getTime()) ? null : d
}

function nomeSocioDeObs(obs: string): string | null {
  const m = obs.match(/nome_socio=([^|\]]+)/)
  return m ? m[1].trim() : null
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ⛔ DESATIVADO em 2026-08-24: a trava de QSA foi removida (o Nei resolveu com
  // a AIVA) e o fluxo de documentos manuais está aposentado desde 03/08. Este
  // cron continuava cobrando por HSM os 5 itens (contrato social, selfie,
  // RG/CNH, dados bancários) de 21 leads legados com [DOCS_SEM_SOCIO] — texto
  // que o prompt agora PROÍBE a VictorIA de pedir. Cobrar por HSM e negar no
  // chat é o pior dos dois mundos.
  //
  // Guard por env (e não `return` fixo) de propósito: mantém a lógica viva e
  // permite religar sem deploy — basta COBRANCA_DOCS_ATIVO=true na Vercel.
  // O agendador externo pode continuar chamando: responde ok e não envia nada.
  if (process.env.COBRANCA_DOCS_ATIVO !== 'true') {
    return NextResponse.json({ ok: true, desativado: 'fluxo_docs_sem_socio_aposentado_2026-08-24' })
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === 'true'
  const max = Math.min(Number(url.searchParams.get('max')) || 20, 50)

  const agora = Date.now()
  const quietoDesde = new Date(agora - QUIETO_DIAS * DIA_MS).toISOString()

  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, observacoes, data_ultimo_contato')
    .eq('produto', 'AIVA')
    .in('status', STATUS_ATIVOS)
    .eq('acionar_humano', false)
    .like('observacoes', '%[DOCS_SEM_SOCIO]%')
    .not('observacoes', 'like', '%[LINHA_MANUAL_OK]%')
    .lte('data_ultimo_contato', quietoDesde)
    .order('data_ultimo_contato', { ascending: true })

  if (error) {
    console.error('[COBRANCA_DOCS] Erro ao buscar leads:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const candidatos = (leads ?? []).filter((l) => {
    const obs = l.observacoes ?? ''
    const n = parseInt(obs.match(/\[DOCS_COBRANCA_N:(\d+)\]/)?.[1] ?? '0', 10)
    if (n >= MAX_COBRANCAS) return false
    const ultima = parseFlagDate(obs, 'DOCS_COBRANCA_ULTIMA')
    if (ultima && agora - ultima.getTime() < COOLDOWN_DIAS * DIA_MS) return false
    return true
  }).slice(0, max)

  let enviados = 0
  let falhas = 0
  const previews: Array<{ nome: string; telefone: string; cobranca_n: number }> = []

  for (const lead of candidatos) {
    const obs = lead.observacoes ?? ''
    let nome = normalizaNome(nomeSocioDeObs(obs)) || normalizaNome(lead.nome) || 'Lojista'
    if (nome.replace(/[^\p{L}]/gu, '').length < 3) nome = 'Lojista'
    const n = parseInt(obs.match(/\[DOCS_COBRANCA_N:(\d+)\]/)?.[1] ?? '0', 10) + 1

    if (dry) {
      previews.push({ nome, telefone: lead.telefone, cobranca_n: n })
      continue
    }
    if (!REOPEN_TEMPLATE_ID) { falhas++; continue }

    try {
      await sendTemplate(lead.telefone, REOPEN_TEMPLATE_ID, [nome, MIOLO_DOCS])

      const novaObs = `${obs
        .replace(/\s*\[DOCS_COBRANCA_N:\d+\]\s*/g, ' ')
        .replace(/\s*\[DOCS_COBRANCA_ULTIMA:[^\]]+\]\s*/g, ' ')
        .trim()} [DOCS_COBRANCA_N:${n}] [DOCS_COBRANCA_ULTIMA:${new Date().toISOString()}]`.trim()

      await supabaseAdmin
        .from('sdr_leads')
        .update({ observacoes: novaObs, data_ultimo_contato: new Date().toISOString() })
        .eq('id', lead.id)
      await supabaseAdmin.from('sdr_mensagens').insert([
        { lead_id: lead.id, direcao: 'out', conteudo: '[Cobrança de documentos enviada]', template_hsm: 'aiva_reativacao_48h' },
        { lead_id: lead.id, direcao: 'out', conteudo: `Olá ${nome}, ${MIOLO_DOCS}` },
      ])
      enviados++
      console.log(`[COBRANCA_DOCS] Lembrete ${n}/${MAX_COBRANCAS} enviado pra ${lead.telefone}`)
    } catch (err) {
      console.error(`[COBRANCA_DOCS] Falha ao enviar pra ${lead.telefone}:`, err)
      falhas++
    }
  }

  return NextResponse.json({
    ok: true,
    dry,
    candidatos: candidatos.length,
    enviados,
    falhas,
    ...(dry ? { previews } : {}),
  })
}
