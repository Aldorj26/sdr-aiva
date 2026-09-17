/**
 * cobranca-formulario/route.ts (AIVA) — passo 3 da Fase 1 (Aldo 16/09/2026)
 *
 * Cobra o lojista cujo pré-cadastro a AIVA já aprovou mas que ainda não
 * preencheu o formulário do varejo (portal em `dados_varejo` — 259 lojas
 * paradas aí em 16/09, sem ninguém cobrar). Cadência D+1, D+3, D+7, D+14 a
 * partir da entrada na fila; 4º toque sem resultado → avisa o time uma vez e
 * para. Quem preenche some da fila sozinho (o portal muda de etapa).
 *
 * Substitui o followup-fase (cobrança diária do CAF por data_ultimo_contato,
 * 3 toques e escalação pro Nei) — removido do vercel.json no mesmo commit.
 *
 * Entrega: HSM 48 coringa (AIVA_REATIVACAO_TEMPLATE_ID), {{2}} em uma linha,
 * sem link — quem responde cai na VictorIA (FASE 4), que reenvia o link do
 * onboarding se o lojista pedir.
 *
 * Não cobra: acionar_humano, [PAUSA_ATE], [COBRANCA_FORM_OPTOUT], importados
 * do portal sem WhatsApp ([IMPORTADO_PORTAL] / telefone 000…), quem mandou
 * mensagem nas últimas 48h (conversa viva), lead sem onboarding no portal
 * (pré-cadastro nunca lançado — aparece no retorno como `sem_onboarding`).
 *
 * Regras puras e textos: lib/cobranca-formulario-calc.ts (`npm run test:cobranca`).
 * Params: ?dry=true · ?max=N (teto de envios, padrão 60)
 * Schedule (vercel.json): `0 16 * * 1-5` UTC = 13h BRT, seg–sex. GET obrigatório.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate, alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { nomeSaudacao } from '@/lib/text'
import { listarOnboardingsApi } from '@/lib/portal-aiva'
import { decidir, lerMarcadores, remontarObs, MIOLOS, MAX_TOQUES } from '@/lib/cobranca-formulario-calc'
import { flag } from '@/lib/req-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const TETO_TEMPO_MS = 240_000
const JANELA_CONVERSA_MS = 48 * 60 * 60 * 1000
const soDigitos = (c: unknown) => String(c ?? '').replace(/\D/g, '')

async function executar(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!TEMPLATE_ID) return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })

  const url = new URL(req.url)
  const dry = flag(url.searchParams, 'dry')
  const max = Math.min(Number(url.searchParams.get('max')) || 60, 100)
  const agora = Date.now()

  // 1) leads em Em Análise
  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, observacoes')
    .eq('produto', 'AIVA')
    .eq('status', 'EM_ANALISE_AIVA')
    .eq('acionar_humano', false)
    .not('nome', 'ilike', '%teste%')
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  const todos = (leads ?? []).filter((l) => !(l.observacoes ?? '').includes('[IMPORTADO_PORTAL:') && !l.telefone.startsWith('000'))

  // 2) etapa real no portal (via CNPJ registrado)
  let onboardings
  try {
    onboardings = await listarOnboardingsApi()
  } catch (e) {
    return NextResponse.json({ ok: false, erro: `portal: ${String(e).slice(0, 160)}` }, { status: 502 })
  }
  const stagePorCnpj = new Map<string, string>()
  for (const o of onboardings) { const c = soDigitos(o.cnpj); if (c.length === 14) stagePorCnpj.set(c, String(o.stage ?? '')) }
  const ORDEM: Record<string, number> = { not_approved: -1, pre_cadastro: 0, dados_varejo: 1, biometria: 2, cadastro_finalizado: 3, treinamento_agendado: 4 }

  const cnpjsPorLead = new Map<string, string[]>()
  for (let de = 0; ; de += 1000) {
    const { data } = await supabaseAdmin.from('sdr_registros_cnpj').select('lead_id, cnpj').in('lead_id', todos.map((l) => l.id)).range(de, de + 999)
    for (const r of data ?? []) { const g = cnpjsPorLead.get(r.lead_id) ?? []; g.push(soDigitos(r.cnpj)); cnpjsPorLead.set(r.lead_id, g) }
    if (!data || data.length < 1000) break
  }
  const etapaPortal = (leadId: string): string | null => {
    let melhor: string | null = null
    for (const c of cnpjsPorLead.get(leadId) ?? []) {
      const s = stagePorCnpj.get(c)
      if (s && (melhor == null || (ORDEM[s] ?? 0) > (ORDEM[melhor] ?? 0))) melhor = s
    }
    return melhor
  }

  // 3) conversa viva: quem mandou mensagem nas últimas 48h
  const semOnboarding: string[] = []
  const pendentes = todos.filter((l) => {
    const e = etapaPortal(l.id)
    if (e == null) { semOnboarding.push(l.nome); return false }
    return e === 'dados_varejo'
  })
  const recentes = new Set<string>()
  for (let i = 0; i < pendentes.length; i += 200) {
    const { data } = await supabaseAdmin
      .from('sdr_mensagens').select('lead_id')
      .in('lead_id', pendentes.slice(i, i + 200).map((l) => l.id)).eq('direcao', 'in')
      .gte('enviado_em', new Date(agora - JANELA_CONVERSA_MS).toISOString())
    for (const m of data ?? []) recentes.add(m.lead_id)
  }

  // 4) decisão
  const iniciar: typeof pendentes = []
  const enviar: Array<{ lead: (typeof pendentes)[number]; toque: number }> = []
  const esgotar: typeof pendentes = []
  const nada: Record<string, number> = {}
  for (const l of pendentes) {
    const d = decidir(lerMarcadores(l.observacoes, agora), recentes.has(l.id), agora)
    if (d.acao === 'iniciar') iniciar.push(l)
    else if (d.acao === 'enviar') enviar.push({ lead: l, toque: d.toque })
    else if (d.acao === 'esgotou') esgotar.push(l)
    else nada[d.motivo] = (nada[d.motivo] ?? 0) + 1
  }
  // atrasados primeiro (toque mais alto = está há mais tempo na fila)
  enviar.sort((a, b) => b.toque - a.toque)
  const fila = enviar.slice(0, max)

  const resumo = {
    em_analise: todos.length, formulario_pendente: pendentes.length, sem_onboarding: semOnboarding.length,
    iniciar: iniciar.length, enviar: enviar.length, esgotar: esgotar.length, nada,
  }
  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, ...resumo,
      exemplo: fila[0] ? `Oi ${nomeSaudacao(fila[0].lead.nome, fila[0].lead.observacoes)}, tudo bem?\n${MIOLOS[fila[0].toque - 1]} É só responder essa mensagem. 😊` : null,
      destinatarios: fila.map((f) => ({ loja: f.lead.nome, telefone: f.lead.telefone, toque: f.toque })),
      sem_onboarding_nomes: semOnboarding.slice(0, 40),
    })
  }

  const inicio = Date.now()
  // 5) carimba D0 em quem entrou agora
  for (const l of iniciar) {
    await supabaseAdmin.from('sdr_leads').update({ observacoes: remontarObs(l.observacoes, { inicio: true }) }).eq('id', l.id)
  }

  // 6) envios
  let enviados = 0
  const falhas: string[] = []
  for (const { lead, toque } of fila) {
    if (Date.now() - inicio > TETO_TEMPO_MS) break
    const nome = nomeSaudacao(lead.nome, lead.observacoes)
    const miolo = MIOLOS[toque - 1]
    try {
      await sendTemplate(lead.telefone, TEMPLATE_ID, [nome, miolo])
      await supabaseAdmin.from('sdr_mensagens').insert({
        lead_id: lead.id, direcao: 'out',
        conteudo: `Oi ${nome}, tudo bem?\n${miolo} É só responder essa mensagem. 😊`,
        template_hsm: 'aiva_reativacao_48h',
      })
      // re-lê observacoes: o laço leva minutos e o webhook pode ter escrito no meio
      const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
      await supabaseAdmin.from('sdr_leads')
        .update({ observacoes: remontarObs(fresco?.observacoes ?? lead.observacoes, { toque, esgotado: toque >= MAX_TOQUES }), data_ultimo_contato: new Date().toISOString() })
        .eq('id', lead.id)
      enviados++
      console.log(`[cobranca-formulario] ✅ ${lead.nome} (${lead.telefone}) — toque ${toque}/${MAX_TOQUES}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      falhas.push(`${lead.telefone} (${lead.nome}): ${msg}`)
      console.error(`[cobranca-formulario] ❌ ${lead.nome}:`, msg)
    }
    await new Promise((r) => setTimeout(r, 1200))
  }

  // 7) esgotados: avisa o time UMA vez e para de cobrar
  if (esgotar.length) {
    const linhas = esgotar.map((l) => `• ${l.nome} (${l.telefone})`)
    const aviso =
      `📋 *FORMULÁRIO DA AIVA — ${esgotar.length} loja(s) sem preencher após ${MAX_TOQUES} cobranças (D+1/3/7/14)*\n\n` +
      linhas.slice(0, 30).join('\n') + (linhas.length > 30 ? `\n… +${linhas.length - 30}` : '') +
      '\n\nParei de cobrar essas. Vale um contato direto ou descartar no Evo.'
    try {
      if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, aviso)
      if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, aviso)
    } catch (e) { console.error('[cobranca-formulario] aviso de esgotados falhou:', e) }
    for (const l of esgotar) {
      const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', l.id).maybeSingle()
      await supabaseAdmin.from('sdr_leads').update({ observacoes: remontarObs(fresco?.observacoes ?? l.observacoes, { esgotado: true, esgotadoAvisado: true }) }).eq('id', l.id)
    }
  }

  console.log(`[cobranca-formulario] pendentes=${pendentes.length} iniciados=${iniciar.length} enviados=${enviados} esgotados=${esgotar.length} falhas=${falhas.length}`)
  return NextResponse.json({ ok: true, ...resumo, enviados, sobraram: enviar.length - enviados, falhas })
}

export const GET = executar
export const POST = executar
