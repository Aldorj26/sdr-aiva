/**
 * check-treinamento/route.ts (AIVA)
 *
 * Pedido do Aldo 14/09/2026: perguntar aos leads da etapa TREINAR (stage 70)
 * se já fizeram o treinamento — à TARDE DE CADA DIA DE TURMA (agenda do portal
 * AIVA; as turmas são de manhã, então a pergunta vai depois da aula do dia).
 *
 * Entrega: template coringa HSM 48 (AIVA_REATIVACAO_TEMPLATE_ID), corpo
 *   "Oi {{1}}, tudo bem?\n{{2}} É só responder essa mensagem. 😊"
 * O {{2}} vai em UMA linha — a Meta rejeita \n em variável de template (#132018).
 * Como é HSM, entrega mesmo com a janela de 24h fechada (o caso da maioria
 * em Treinar). Quem responde cai na VictorIA (bloco de instrução da fase
 * TREINAR) e o webhook avisa o Nei pra mover o card — ver §"CHECK TREINAMENTO"
 * em app/api/sdr/webhook/route.ts.
 *
 * Anti-spam:
 *   - não reenvia pra quem recebeu nos últimos 2 dias (segunda→quinta são 3)
 *   - PARA de perguntar assim que o lojista responde ([CHECK_TREINAMENTO_RESP]
 *     mais novo que o envio) — o Nei é avisado pelo webhook e move o card
 *   - máximo MAX_TOQUES por lead; ao esgotar, marca [CHECK_TREINAMENTO_ESGOTADO]
 *     e avisa o time uma vez em vez de seguir cobrando
 *   - pula lead com [PAUSA_ATE] vigente e lead com acionar_humano = true
 *
 * Inscrições (training_bookings do portal): quem já tem turma MARCADA não recebe
 * cobrança — recebe UMA vez o lembrete com data e link ([CHECK_TREINAMENTO_INSCRITO]);
 * quem passou por uma turma recebe a pergunta específica daquela turma.
 *
 * Flags em observacoes: [CHECK_TREINAMENTO:ISO] [CHECK_TREINAMENTO_N:n]
 *                       [CHECK_TREINAMENTO_RESP:ISO] [CHECK_TREINAMENTO_ESGOTADO]
 *                       [CHECK_TREINAMENTO_ESGOTADO_AVISADO]
 *
 * Params: ?dry=true (preview sem enviar) · ?max=N (lote) · ?force=true (ignora a espera)
 * Schedule (vercel.json): `0 17 * * 1-5` UTC = 14h BRT todo dia útil — mas só age em dia
 * que teve turma de manhã (agenda do portal AIVA via houveTurmaHoje; 16/09: seg/qua/sex).
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate, alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { nomeSaudacao } from '@/lib/text'
import { proximasTurmas, houveTurmaHoje, inscricoesPorCnpj, classificarInscricoes, rotulo, type Inscricao, type Turma } from '@/lib/turmas-treinamento'
import { flag } from '@/lib/req-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const REOPEN_TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const DIA_MS = 24 * 60 * 60 * 1000
const ESPERA_DIAS = 2
const MAX_TOQUES = 8 // ~3 semanas de turmas (seg/qua/sex)
const TETO_TEMPO_MS = 240_000 // a função morre em 300s

// {{2}} do template — UMA linha, sem \n. O corpo já abre com "Oi {nome}, tudo bem?"
// e fecha com "É só responder essa mensagem. 😊" — não repetir saudação aqui.
// Dias vêm da agenda oficial do portal AIVA (lib/turmas-treinamento) — desde 16/09
// nada de "segunda e quinta" fixo (a AIVA mudou pra seg/qua/sex a partir de 21/09).
function montarMiolo(turmas: Turma[]): string {
  const proximas = turmas.slice(0, 2)
  const quando = proximas.length
    ? `as próximas turmas são ${proximas.map(rotulo).join(' e ')}, online`
    : 'tem turma toda semana, online'
  return `Passando pra saber se você já conseguiu participar do treinamento da AIVA. Se ainda não deu tempo, ${quando} — me avisa que eu te mando o link certinho do dia.`
}

/** Lojista INSCRITO numa turma que ainda vai acontecer: lembrete com data e link, não cobrança. */
function mioloLembrete(i: Inscricao): string {
  return `Vi aqui que você está inscrito no treinamento da AIVA de ${rotuloInscricao(i)} (online, 1h). É só entrar por este link na hora: ${i.link}`
}

/** Lojista que estava inscrito numa turma que JÁ passou: pergunta específica daquela turma. */
function mioloPosTurma(i: Inscricao, turmas: Turma[]): string {
  const prox = turmas[0] ? ` Se não deu pra participar, a próxima é ${rotulo(turmas[0])} — me avisa que eu te mando o link.` : ''
  return `Passando pra saber se você conseguiu participar do treinamento da AIVA de ${rotuloInscricao(i)}.${prox}`
}

/** "quinta 17/09, 9h30" a partir de uma inscrição (mesmo formato do rotulo de turma). */
const rotuloInscricao = (i: Inscricao) => rotulo({ startsAt: i.startsAt, inviteId: i.inviteId, link: i.link, label: null })

/** Já mandamos lembrete da turma que começa em `startsAt`? */
const lembreteEnviado = (obs: string | null, startsAt: string) => (obs ?? '').includes(`[CHECK_TREINAMENTO_INSCRITO:${startsAt}]`)

function toques(obs: string | null): number {
  return Number((obs ?? '').match(/\[CHECK_TREINAMENTO_N:(\d+)\]/)?.[1] ?? 0)
}

function ultimaRespostaMs(obs: string | null): number | null {
  const iso = (obs ?? '').match(/\[CHECK_TREINAMENTO_RESP:([^\]]+)\]/)?.[1]
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : null
}

function ultimoEnvioMs(obs: string | null): number | null {
  const iso = (obs ?? '').match(/\[CHECK_TREINAMENTO:([^\]]+)\]/)?.[1]
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : null
}

function pausaVigente(obs: string | null): boolean {
  const iso = (obs ?? '').match(/\[PAUSA_ATE:([^\]]+)\]/)?.[1]
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) && ms > Date.now()
}

/** Reescreve os marcadores do check sem duplicar (observacoes é append-only na prática). */
function remontarObs(obs: string | null, n: number, esgotou: boolean): string {
  let base = (obs ?? '')
    .replace(/\s*\[CHECK_TREINAMENTO:[^\]]*\]/g, '')
    .replace(/\s*\[CHECK_TREINAMENTO_N:\d+\]/g, '')
    .trim()
  base = `${base} [CHECK_TREINAMENTO:${new Date().toISOString()}] [CHECK_TREINAMENTO_N:${n}]`.trim()
  if (esgotou && !base.includes('[CHECK_TREINAMENTO_ESGOTADO]')) base = `${base} [CHECK_TREINAMENTO_ESGOTADO]`
  return base
}

async function executar(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!REOPEN_TEMPLATE_ID) {
    return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })
  }

  const url = new URL(req.url)
  const dry = flag(url.searchParams, 'dry')
  const force = flag(url.searchParams, 'force')
  const max = Math.min(Number(url.searchParams.get('max')) || 60, 100)
  // Roda todo dia útil à tarde, mas só pergunta em dia que TEVE turma de manhã —
  // a agenda vem do portal AIVA (16/09: seg/qui → seg/qua/sex a partir de 21/09).
  if (!force && !dry && !(await houveTurmaHoje())) {
    return NextResponse.json({ ok: true, ignorado: 'sem_turma_hoje' })
  }
  const { turmas } = await proximasTurmas(3)
  const MIOLO = montarMiolo(turmas)

  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, observacoes')
    .eq('produto', 'AIVA')
    .eq('status', 'TREINAR')
    // Lead com problema aberto está esperando o Nei em /atendimento — não
    // recebe HSM alegre por cima (mesma regra do check-primeira-venda).
    .eq('acionar_humano', false)
    .not('nome', 'ilike', '%teste%')
  if (error) {
    console.error('[check-treinamento] erro ao buscar leads:', error.message)
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  }

  const esgotados: string[] = []
  const respondidos: string[] = []
  const elegiveis = (leads ?? []).filter((l) => {
    const obs = l.observacoes
    if (pausaVigente(obs)) return false
    // Esgotou nesta rodada (marcador gravado no último envio) → entra na lista
    // do aviso ao Nei UMA vez; depois o marcador ESGOTADO_AVISADO cala de vez.
    if (obs?.includes('[CHECK_TREINAMENTO_ESGOTADO]')) {
      if (!obs.includes('[CHECK_TREINAMENTO_ESGOTADO_AVISADO]')) esgotados.push(`${l.nome} (${l.telefone})|${l.id}`)
      return false
    }
    if (toques(obs) >= MAX_TOQUES) return false
    if (force) return true
    const ultimo = ultimoEnvioMs(obs)
    if (ultimo === null) return true
    // Já respondeu a última pergunta → não pergunta de novo. O card sai de
    // TREINAR quando o Nei mover (ele é avisado pelo webhook); até lá, silêncio.
    const resposta = ultimaRespostaMs(obs)
    if (resposta !== null && resposta > ultimo) {
      respondidos.push(`${l.nome} (${l.telefone})`)
      return false
    }
    return Date.now() - ultimo >= ESPERA_DIAS * DIA_MS
  })

  // ── Inscrições no portal (training_bookings): quem já tem turma marcada NÃO
  //    leva "já fez o treinamento?" (em 14/09 isso aconteceu com 12 lojas, uma
  //    delas inscrita na turma daquela mesma manhã). Falha do portal → segue sem.
  const inscPorLead = new Map<string, { futura: Inscricao | null; passada: Inscricao | null }>()
  try {
    const { data: regs } = await supabaseAdmin.from('sdr_registros_cnpj').select('lead_id, cnpj').in('lead_id', elegiveis.map((l) => l.id))
    const mapa = await inscricoesPorCnpj((regs ?? []).map((r) => String(r.cnpj)))
    const agora = new Date()
    for (const l of elegiveis) {
      const cnpjs = (regs ?? []).filter((r) => r.lead_id === l.id).map((r) => String(r.cnpj).replace(/\D/g, ''))
      const todas = cnpjs.flatMap((c) => mapa.get(c) ?? [])
      if (todas.length) inscPorLead.set(l.id, classificarInscricoes(todas, agora))
    }
  } catch (e) {
    console.warn('[check-treinamento] inscrições do portal indisponíveis:', String(e).slice(0, 120))
  }

  type Item = { lead: (typeof elegiveis)[number]; tipo: 'lembrete' | 'pos_turma' | 'generico'; miolo: string; turma: string | null }
  const itens: Item[] = []
  let inscritosPulados = 0
  for (const l of elegiveis) {
    const insc = inscPorLead.get(l.id)
    if (insc?.futura) {
      // Tem turma marcada: manda o lembrete UMA vez (com data e link) e nunca cobra.
      if (lembreteEnviado(l.observacoes, insc.futura.startsAt)) { inscritosPulados++; continue }
      itens.push({ lead: l, tipo: 'lembrete', miolo: mioloLembrete(insc.futura), turma: insc.futura.startsAt })
      continue
    }
    if (insc?.passada) {
      itens.push({ lead: l, tipo: 'pos_turma', miolo: mioloPosTurma(insc.passada, turmas), turma: insc.passada.startsAt })
      continue
    }
    itens.push({ lead: l, tipo: 'generico', miolo: MIOLO, turma: null })
  }
  const fila = itens.slice(0, max)

  if (dry) {
    return NextResponse.json({
      ok: true,
      dry: true,
      em_treinar: leads?.length ?? 0,
      enviaria: fila.length,
      por_tipo: fila.reduce<Record<string, number>>((a, i) => { a[i.tipo] = (a[i.tipo] ?? 0) + 1; return a }, {}),
      inscritos_ja_lembrados: inscritosPulados,
      ja_responderam: respondidos.length,
      esgotados: esgotados.length,
      exemplo: fila[0]
        ? `Oi ${nomeSaudacao(fila[0].lead.nome, fila[0].lead.observacoes)}, tudo bem?\n${fila[0].miolo} É só responder essa mensagem. 😊`
        : null,
      destinatarios: fila.map((i) => ({ loja: i.lead.nome, telefone: i.lead.telefone, tipo: i.tipo, turma: i.turma, toque: i.tipo === 'lembrete' ? '—' : toques(i.lead.observacoes) + 1 })),
    })
  }

  const inicio = Date.now()
  let enviados = 0
  const falhas: string[] = []

  for (const { lead, tipo, miolo, turma } of fila) {
    if (Date.now() - inicio > TETO_TEMPO_MS) {
      console.log('[check-treinamento] teto de tempo atingido — resto fica pra próxima rodada')
      break
    }
    const nome = nomeSaudacao(lead.nome, lead.observacoes)
    // Lembrete de turma marcada NÃO é cobrança: não consome toque.
    const n = tipo === 'lembrete' ? toques(lead.observacoes) : toques(lead.observacoes) + 1
    try {
      await sendTemplate(lead.telefone, REOPEN_TEMPLATE_ID, [nome, miolo])
      await supabaseAdmin.from('sdr_mensagens').insert({
        lead_id: lead.id,
        direcao: 'out',
        conteudo: `Oi ${nome}, tudo bem?\n${miolo} É só responder essa mensagem. 😊`,
        template_hsm: 'aiva_reativacao_48h',
      })
      // Re-lê observacoes AGORA: o laço leva minutos e o webhook pode ter
      // remontado o campo nesse meio-tempo (achado do revisor 14/09).
      const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
      const base = fresco?.observacoes ?? lead.observacoes
      const obs = tipo === 'lembrete'
        ? `${(base ?? '').trim()} [CHECK_TREINAMENTO_INSCRITO:${turma}]`.trim()
        : remontarObs(base, n, n >= MAX_TOQUES)
      await supabaseAdmin.from('sdr_leads').update({ observacoes: obs, data_ultimo_contato: new Date().toISOString() }).eq('id', lead.id)
      enviados++
      console.log(`[check-treinamento] ✅ ${lead.nome} (${lead.telefone}) — ${tipo}${tipo === 'lembrete' ? ` (turma ${turma})` : ` toque ${n}/${MAX_TOQUES}`}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      falhas.push(`${lead.telefone} (${lead.nome}): ${msg}`)
      console.error(`[check-treinamento] ❌ ${lead.nome}:`, msg)
    }
    await new Promise((r) => setTimeout(r, 1200))
  }

  // Quem esgotou os toques sem nunca responder: avisa o time UMA vez, não cobra mais.
  if (esgotados.length) {
    const aviso =
      `🎓 *CHECK DE TREINAMENTO — ${esgotados.length} loja(s) sem resposta após ${MAX_TOQUES} toques*\n\n` +
      esgotados.map((e) => `• ${e.split('|')[0]}`).join('\n') +
      `\n\nParei de perguntar pra essas. Vale um contato direto ou reavaliar a etapa.`
    if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, aviso)
    // Carimba pra não repetir o aviso na próxima rodada.
    for (const e of esgotados) {
      const id = e.split('|')[1]
      if (!id) continue
      const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', id).maybeSingle()
      await supabaseAdmin
        .from('sdr_leads')
        .update({ observacoes: `${(fresco?.observacoes ?? '').trim()} [CHECK_TREINAMENTO_ESGOTADO_AVISADO]`.trim() })
        .eq('id', id)
    }
  }

  return NextResponse.json({ ok: true, em_treinar: leads?.length ?? 0, enviados, por_tipo: fila.reduce<Record<string, number>>((a, i) => { a[i.tipo] = (a[i.tipo] ?? 0) + 1; return a }, {}), inscritos_ja_lembrados: inscritosPulados, ja_responderam: respondidos.length, falhas: falhas.length, detalhe_falhas: falhas, esgotados: esgotados.length })
}

// O Vercel Cron chama por GET — sem este handler a rota responde 405 e o cron
// morre em silêncio (armadilha registrada no CLAUDE.md).
export async function GET(req: NextRequest) {
  return executar(req)
}
export async function POST(req: NextRequest) {
  return executar(req)
}
