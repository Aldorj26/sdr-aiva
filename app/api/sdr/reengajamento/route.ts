/**
 * reengajamento/route.ts (AIVA)
 *
 * Campanha de REENGAJAMENTO dos leads INTERESSADO que pararam sem finalizar.
 * Pra cada lead: lê a conversa → a Claude gera um follow-up PERSONALIZADO (1 linha)
 * → envia via template HSM 48 reabridor (entrega garantida). Quando o lojista
 * responde, a VictorIA retoma a qualificação de onde parou.
 *
 * Idempotente: marca [REENGAJAMENTO:ISO] em observacoes — nunca dispara 2x pro mesmo.
 *
 * Params:
 *   ?dry=true  → GERA as mensagens e devolve no preview, SEM enviar (validação)
 *   ?max=N     → tamanho do lote (default 6 no dry, 30 no real; teto 50)
 *
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET. (Disparo manual em lotes — não é cron.)
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate, telefonesNaEtapa, chaveTelefone, STAGES, alertHuman } from '@/lib/evotalks'
import { supabaseAdmin, getMensagens } from '@/lib/supabase'
import { gerarReengajamento } from '@/lib/claude'
import { normalizaNome } from '@/lib/text'
import { isAdmin } from '@/lib/admin-commands'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const REOPEN_TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)

// Cadência recorrente: até 3 reengajamentos por lead, com 15 dias entre eles.
// Depois disso marca [REENGAJAMENTO_ESGOTADO], para de tentar e avisa o time —
// NÃO descarta sozinho (mudar status pra DESCARTADO tira o lead do funil; essa
// decisão fica com o Nei, que passa a ver o lead sinalizado).
const MAX_REENGAJOS = 3
const COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000

function nomeDoLead(obs: string | null, nome: string): string {
  const m = (obs ?? '').match(/nome_socio=([^|\]]+)/)
  return normalizaNome(m?.[1] ?? null) || normalizaNome(nome) || 'lojista'
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === 'true'
  const max = Math.min(Number(url.searchParams.get('max')) || (dry ? 6 : 30), 50)

  // INTERESSADO AIVA ainda sem reengajamento (idempotente). Mais recentes primeiro.
  const { data: todos, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, observacoes, acionar_humano')
    .eq('status', 'INTERESSADO')
    .eq('produto', 'AIVA')
    .order('data_ultimo_contato', { ascending: false })
    .limit(500)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })

  // FILTRO POR ETAPA REAL DO EVO (não pelo status do Supabase). Um lead na etapa
  // "Cadastro Recebido" carrega status INTERESSADO enquanto a Fase 3 não fecha —
  // sem este filtro o reengajamento tocaria quem a cobrança de Cadastro Recebido
  // já está contatando (bug pego em 2026-07-20: 26 leads receberiam 2 mensagens
  // no mesmo dia). Fail-closed: se o Evo não responder, não envia nada.
  let naEtapaInteressado: Set<string>
  try {
    naEtapaInteressado = await telefonesNaEtapa(STAGES.INTERESSADO)
  } catch (e) {
    console.error('[reengajamento] falha ao ler etapas do Evo — abortando:', e)
    return NextResponse.json({ ok: false, erro: 'evo_indisponivel_abortado' }, { status: 503 })
  }

  const agora = Date.now()
  const pendentes = (todos ?? []).filter((l) => {
    if (isAdmin(l.telefone)) return false
    if (l.acionar_humano) return false                       // humano assumiu — não atropelar
    if (!naEtapaInteressado.has(chaveTelefone(l.telefone))) return false
    const obs = l.observacoes ?? ''
    if (obs.includes('[REENGAJAMENTO_ESGOTADO]')) return false
    // Cadência recorrente: até MAX_REENGAJOS toques, respeitando COOLDOWN entre eles.
    // Antes era one-shot na vida do lead — os 349 reengajados em 09/07 voltaram a
    // parar e ficaram órfãos, sem nenhuma automação alcançando (o nudge só cobre
    // 3–24h e o followup D+3/D+7/D+14 nunca incluiu INTERESSADO).
    const n = parseInt(obs.match(/\[REENGAJAMENTO_N:(\d+)\]/)?.[1] ?? '0', 10)
      || (obs.includes('[REENGAJAMENTO:') ? 1 : 0)          // legado: marcador antigo conta como toque 1
    if (n >= MAX_REENGAJOS) return false
    const ultimoISO = obs.match(/\[REENGAJAMENTO:([^\]]+)\]/)?.[1]
    if (ultimoISO) {
      const t = new Date(ultimoISO).getTime()
      if (!Number.isNaN(t) && agora - t < COOLDOWN_MS) return false
    }
    return true
  })
  const lote = pendentes.slice(0, max)

  const previews: Array<{ nome: string; telefone: string; mensagem: string }> = []
  let enviados = 0
  let falhas = 0

  for (const lead of lote) {
    try {
      const historico = await getMensagens(lead.id, 14)
      const nome = nomeDoLead(lead.observacoes, lead.nome)
      const miolo = await gerarReengajamento(historico, nome)
      const textoCompleto = `Oi ${nome}, tudo bem?\n${miolo} É só responder essa mensagem. 😊`

      if (dry) {
        previews.push({ nome, telefone: lead.telefone, mensagem: textoCompleto })
        continue
      }

      if (!REOPEN_TEMPLATE_ID) { falhas++; continue }
      await sendTemplate(lead.telefone, REOPEN_TEMPLATE_ID, [nome, miolo])

      // Contador do toque atual (legado sem [REENGAJAMENTO_N:] conta como 1).
      const obsAtual = lead.observacoes ?? ''
      const nAnterior = parseInt(obsAtual.match(/\[REENGAJAMENTO_N:(\d+)\]/)?.[1] ?? '0', 10)
        || (obsAtual.includes('[REENGAJAMENTO:') ? 1 : 0)
      const nAgora = nAnterior + 1
      const base = obsAtual
        .replace(/\s*\[REENGAJAMENTO:[^\]]+\]\s*/g, ' ')
        .replace(/\s*\[REENGAJAMENTO_N:\d+\]\s*/g, ' ')
        .trim()
      const esgotou = nAgora >= MAX_REENGAJOS
      const novaObs = `[REENGAJAMENTO:${new Date().toISOString()}] [REENGAJAMENTO_N:${nAgora}]${esgotou ? ' [REENGAJAMENTO_ESGOTADO]' : ''} ${base}`.trim()

      if (esgotou) {
        try {
          const msg = `🔕 *${nome}* (${lead.telefone}) — ${MAX_REENGAJOS}º e último reengajamento enviado, sem retomar a conversa. Sai da automação; se valer a pena, é contato manual.`
          if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
        } catch { /* alerta é best-effort, não derruba o envio */ }
      }
      await supabaseAdmin
        .from('sdr_leads')
        .update({ observacoes: novaObs, data_ultimo_contato: new Date().toISOString() })
        .eq('id', lead.id)
      await supabaseAdmin.from('sdr_mensagens').insert([
        { lead_id: lead.id, direcao: 'out', conteudo: '[Reengajamento personalizado enviado]', template_hsm: 'aiva_reativacao_48h' },
        { lead_id: lead.id, direcao: 'out', conteudo: textoCompleto },
      ])
      enviados++
    } catch (err) {
      console.error(`[reengajamento] falha ${lead.telefone}:`, err)
      falhas++
    }
  }

  return NextResponse.json({
    ok: true,
    dry,
    total_interessado: (todos ?? []).length,
    pendentes: pendentes.length,
    processados: lote.length,
    enviados: dry ? 0 : enviados,
    falhas,
    restantes: pendentes.length - (dry ? 0 : enviados),
    previews: dry ? previews : undefined,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
