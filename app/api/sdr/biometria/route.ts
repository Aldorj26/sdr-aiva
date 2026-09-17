/**
 * biometria/route.ts (AIVA) — passo 4 da Fase 1 (Aldo 16/09/2026)
 *
 * O lojista terminou o formulário do varejo e o portal da AIVA está em
 * `biometria` (falta o reconhecimento facial). O link (onboardings.liveness_url)
 * fica no banco do portal e o Nei mandava na mão. Agora o cron manda pelo HSM 48
 * coringa na hora em que vê a loja nessa etapa, reforça em D+2 e D+5 e, se ainda
 * assim não concluir, avisa o time uma vez. Quem conclui some da fila sozinho
 * (portal → cadastro_finalizado → espelho move o card pra Treinar).
 *
 * Também grava o envio em liveness_sends no portal (mesma tabela que o painel do
 * parceiro usa) e deixa o link em [BIOMETRIA_LINK:url] nas observações — a
 * VictorIA usa na conversa (bloco FASE 4 em lib/claude.ts).
 *
 * Não envia: acionar_humano, [PAUSA_ATE], [BIOMETRIA_OPTOUT], importados do
 * portal sem WhatsApp, loja sem liveness_url (aparece em `sem_link`).
 *
 * Regras puras e textos: lib/biometria-calc.ts (`npm run test:biometria`).
 * Params: ?dry=true · ?max=N (padrão 40)
 * Schedule (vercel.json): `0 12-21 * * 1-5` UTC = de hora em hora, 9h–18h BRT, seg–sex.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate, alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { nomeSaudacao } from '@/lib/text'
import { loginPortal, partnerIdTrack, listarBiometriaPendenteApi, registrarLivenessSend } from '@/lib/portal-aiva'
import { decidir, lerMarcadores, remontarObs, miolo, MAX_TOQUES } from '@/lib/biometria-calc'
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
  const max = Math.min(Number(url.searchParams.get('max')) || 40, 100)
  const agora = Date.now()

  // 1) portal: quem está na biometria (com o link)
  // A LISTA vem da API pública (sem senha) desde 18/09: o cron não morre mais
  // quando o login do portal falha — antes era 502 e ninguém recebia o link.
  let pendentesPortal
  try {
    pendentesPortal = await listarBiometriaPendenteApi()
  } catch (e) {
    return NextResponse.json({ ok: false, erro: `portal (API): ${String(e).slice(0, 160)}` }, { status: 502 })
  }
  // O login continua necessário só pra REGISTRAR o envio em liveness_sends (o
  // painel do Nei lê de lá). Se falhar, a gente manda o link assim mesmo e só
  // perde o registro do lado da AIVA — melhor que não mandar nada.
  let sessao = null, partnerId = null
  try {
    sessao = await loginPortal()
    partnerId = await partnerIdTrack(sessao)
  } catch (e) {
    console.warn('[biometria] login do portal falhou — envios seguem, sem registrar liveness_sends:', String(e).slice(0, 120))
  }
  const porCnpj = new Map(pendentesPortal.map((o) => [soDigitos(o.cnpj), o]))

  // 2) nossos leads em Em Análise com um desses CNPJs
  const { data: regs } = await supabaseAdmin.from('sdr_registros_cnpj').select('lead_id, cnpj').in('cnpj', [...porCnpj.keys()])
  const leadIds = [...new Set((regs ?? []).map((r) => r.lead_id).filter(Boolean))]
  const { data: leads, error } = leadIds.length
    ? await supabaseAdmin.from('sdr_leads').select('id, nome, telefone, observacoes').in('id', leadIds)
        .eq('produto', 'AIVA').eq('status', 'EM_ANALISE_AIVA').eq('acionar_humano', false).not('nome', 'ilike', '%teste%')
    : { data: [], error: null }
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  const elegiveis = (leads ?? []).filter((l) => !(l.observacoes ?? '').includes('[IMPORTADO_PORTAL:') && !l.telefone.startsWith('000'))
  const onbDe = (leadId: string) => {
    for (const r of regs ?? []) if (r.lead_id === leadId) { const o = porCnpj.get(soDigitos(r.cnpj)); if (o) return o }
    return null
  }

  // 3) conversa viva (48h)
  const recentes = new Set<string>()
  if (elegiveis.length) {
    const { data } = await supabaseAdmin.from('sdr_mensagens').select('lead_id').in('lead_id', elegiveis.map((l) => l.id)).eq('direcao', 'in').gte('enviado_em', new Date(agora - JANELA_CONVERSA_MS).toISOString())
    for (const m of data ?? []) recentes.add(m.lead_id)
  }

  // 4) decisão
  const enviar: Array<{ lead: (typeof elegiveis)[number]; toque: number; onb: NonNullable<ReturnType<typeof onbDe>> }> = []
  const esgotar: typeof elegiveis = []
  const semLink: string[] = []
  const nada: Record<string, number> = {}
  for (const l of elegiveis) {
    const onb = onbDe(l.id)
    if (!onb) continue
    if (!onb.liveness_url) { semLink.push(l.nome); continue }
    const d = decidir(lerMarcadores(l.observacoes, agora), recentes.has(l.id), agora)
    if (d.acao === 'enviar') enviar.push({ lead: l, toque: d.toque, onb })
    else if (d.acao === 'esgotou') esgotar.push(l)
    else nada[d.motivo] = (nada[d.motivo] ?? 0) + 1
  }
  enviar.sort((a, b) => a.toque - b.toque)   // primeiro envio tem prioridade (loja acabou de fechar o formulário)
  const fila = enviar.slice(0, max)
  const resumo = { na_biometria_portal: pendentesPortal.length, leads_em_analise: elegiveis.length, enviar: enviar.length, esgotar: esgotar.length, sem_link: semLink.length, nada }

  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, ...resumo,
      exemplo: fila[0] ? `Oi ${nomeSaudacao(fila[0].lead.nome, fila[0].lead.observacoes)}, tudo bem?\n${miolo(fila[0].toque, fila[0].onb.liveness_url!)} É só responder essa mensagem. 😊` : null,
      destinatarios: fila.map((f) => ({ loja: f.lead.nome, telefone: f.lead.telefone, toque: f.toque, portal: f.onb.legal_name })),
      sem_link_nomes: semLink,
    })
  }

  const inicio = Date.now()
  let enviados = 0
  const falhas: string[] = []
  const avisos: string[] = []
  for (const { lead, toque, onb } of fila) {
    if (Date.now() - inicio > TETO_TEMPO_MS) break
    const nome = nomeSaudacao(lead.nome, lead.observacoes)
    const link = onb.liveness_url!.trim()
    const texto = miolo(toque, link)
    try {
      await sendTemplate(lead.telefone, TEMPLATE_ID, [nome, texto])
      await supabaseAdmin.from('sdr_mensagens').insert({
        lead_id: lead.id, direcao: 'out',
        conteudo: `Oi ${nome}, tudo bem?\n${texto} É só responder essa mensagem. 😊`,
        template_hsm: 'aiva_reativacao_48h',
      })
      const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
      await supabaseAdmin.from('sdr_leads')
        .update({ observacoes: remontarObs(fresco?.observacoes ?? lead.observacoes, { inicio: true, link, toque, esgotado: toque >= MAX_TOQUES }), data_ultimo_contato: new Date().toISOString() })
        .eq('id', lead.id)
      enviados++
      try { if (sessao && partnerId) await registrarLivenessSend(sessao, partnerId, { onboardingId: onb.id, url: link, telefone: lead.telefone, nome }) }
      catch (e) { avisos.push(`liveness_sends não gravado p/ ${lead.nome}: ${String(e).slice(0, 80)}`) }
      console.log(`[biometria] ✅ ${lead.nome} (${lead.telefone}) — toque ${toque}/${MAX_TOQUES}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      falhas.push(`${lead.telefone} (${lead.nome}): ${msg}`)
      console.error(`[biometria] ❌ ${lead.nome}:`, msg)
    }
    await new Promise((r) => setTimeout(r, 1200))
  }

  if (esgotar.length) {
    const aviso =
      `🪪 *BIOMETRIA DA AIVA — ${esgotar.length} loja(s) sem concluir após ${MAX_TOQUES} envios do link (D0/D+2/D+5)*\n\n` +
      esgotar.map((l) => `• ${l.nome} (${l.telefone})`).slice(0, 30).join('\n') +
      '\n\nParei de mandar o link pra essas. Vale um contato direto — pode ser dificuldade com a câmera ou o documento.'
    try {
      if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, aviso)
      if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, aviso)
    } catch (e) { console.error('[biometria] aviso de esgotados falhou:', e) }
    for (const l of esgotar) {
      const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', l.id).maybeSingle()
      await supabaseAdmin.from('sdr_leads').update({ observacoes: remontarObs(fresco?.observacoes ?? l.observacoes, { esgotado: true, esgotadoAvisado: true }) }).eq('id', l.id)
    }
  }

  // 5) quem saiu da biometria no portal (concluiu, ou voltou) perde o [BIOMETRIA_LINK]:
  //    senão a FASE 4 seguiria dizendo "formulário concluído" e mandando um link velho
  //    — inclusive pra uma loja nova do mesmo lead (revisor 16/09).
  let limpos = 0
  const { data: comLink } = await supabaseAdmin.from('sdr_leads').select('id, observacoes').like('observacoes', '%[BIOMETRIA_LINK:%')
  for (const l of comLink ?? []) {
    const { data: rs } = await supabaseAdmin.from('sdr_registros_cnpj').select('cnpj').eq('lead_id', l.id)
    const aindaNaBiometria = (rs ?? []).some((r) => porCnpj.has(soDigitos(r.cnpj)))
    if (aindaNaBiometria) continue
    await supabaseAdmin.from('sdr_leads').update({ observacoes: (l.observacoes ?? '').replace(/\s*\[BIOMETRIA_LINK:[^\]]*\]/g, '').trim() }).eq('id', l.id)
    limpos++
  }

  console.log(`[biometria] portal=${pendentesPortal.length} elegiveis=${elegiveis.length} enviados=${enviados} esgotados=${esgotar.length} falhas=${falhas.length} links_limpos=${limpos}`)
  return NextResponse.json({ ok: true, ...resumo, enviados, sobraram: enviar.length - enviados, falhas, avisos, links_limpos: limpos })
}

export const GET = executar
export const POST = executar
