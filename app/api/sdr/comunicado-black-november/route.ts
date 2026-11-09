/**
 * comunicado-black-november/route.ts — aviso único da Black November da AIVA/Flexfone (Aldo 09/11/2026).
 *
 * Em novembro a comissão do vendedor sobe de R$ 10 pra até R$ 50 por venda (R$ 20 garantidos em dezembro + R$ 30 de
 * bônus em janeiro se a inadimplência da carteira da loja vier positiva). Regras e textos: lib/black-november-calc.ts.
 *
 * Quem: AIVA da etapa 50 em diante (EM_ANALISE_AIVA = cadastro pendente, texto de incentivo; TREINAR / LOGIN /
 * LOJA_FINALIZADA_E_VENDENDO = loja criada, texto "avise o time"). Cada loja recebe UMA vez ([BLACK_NOVEMBER:ISO] +
 * rótulo `aiva_black_november`). Pula opt-out, pausa e conversa viva (lojista falou nas últimas 48h — a VictorIA
 * conta no próprio fio). Roda SÓ nos dias de DIAS_DO_ENVIO (cron 17,37,57 13-18 BRT 10h17–15h57), teto de
 * TETO_DIA envios/dia pra não misturar com os 500 do disparo frio. ?dry mostra o que faria; ?force ignora a data.
 * Molde: comunicado-forms (13/10/2026).
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate, alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'
import { flag } from '@/lib/req-flags'
import { grupoDoStatus, textoComunicado } from '@/lib/black-november-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DIAS_DO_ENVIO = ['2026-11-10', '2026-11-11']
const ROTULO = 'aiva_black_november'
const MARCADOR = '[BLACK_NOVEMBER:'
const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const TETO_MS = 230_000
const TETO_DIA = 400
const CONVERSA_VIVA_H = 48

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const t0 = Date.now()
  const sp = new URL(req.url).searchParams
  const dry = flag(sp, 'dry')
  const hojeBrt = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  if (!dry && !flag(sp, 'force') && !DIAS_DO_ENVIO.includes(hojeBrt)) {
    return NextResponse.json({ ok: true, ignorado: 'fora_do_dia', hojeBrt, dias: DIAS_DO_ENVIO })
  }

  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, observacoes')
    .eq('produto', 'AIVA')
    .in('status', ['EM_ANALISE_AIVA', 'TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO'])
    .limit(3000)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  const todos = leads ?? []

  // teto do dia derivado das mensagens com o rótulo (nunca de contador)
  const inicioDiaUtc = new Date(`${hojeBrt}T03:00:00Z`).toISOString()
  const { count: enviadosHoje } = await supabaseAdmin
    .from('sdr_mensagens').select('id', { count: 'exact', head: true })
    .eq('template_hsm', ROTULO).gte('enviado_em', inicioDiaUtc)
  const restamHoje = Math.max(0, TETO_DIA - (enviadosHoje ?? 0))

  // última fala do lojista (conversa viva)
  const ids = todos.map((l) => l.id)
  const falou = new Set<string>()
  const desde = new Date(Date.now() - CONVERSA_VIVA_H * 3600_000).toISOString()
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabaseAdmin.from('sdr_mensagens').select('lead_id').in('lead_id', ids.slice(i, i + 300)).eq('direcao', 'in').gte('enviado_em', desde)
    for (const m of data ?? []) falou.add(m.lead_id)
  }

  const motivos: Record<string, number> = {}
  const conta = (m: string) => { motivos[m] = (motivos[m] ?? 0) + 1 }
  let jaRecebeu = 0
  const fila = todos.filter((l) => {
    const o = l.observacoes ?? ''
    if (o.includes(MARCADOR)) { jaRecebeu++; return false }
    if (!grupoDoStatus(l.status)) { conta('status_fora'); return false }
    if (!l.telefone || l.telefone.startsWith('000')) { conta('sem_whatsapp'); return false }
    if (/\[(CONSULTORIA_OPTOUT|DICAS_OPTOUT|COBRANCA_FORM_OPTOUT)/.test(o)) { conta('optout'); return false }
    const pausa = o.match(/\[PAUSA_ATE:([^\]]+)\]/)?.[1]
    if (pausa && Date.parse(pausa) > Date.now()) { conta('pausa'); return false }
    if (falou.has(l.id)) { conta('conversa_viva'); return false }
    return true
  })
  const nomeDe = (l: (typeof todos)[number]) => {
    const socio = (l.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1]?.trim()
    return (socio ? normalizaNome(socio) : normalizaNome(l.nome)) || 'lojista'
  }
  const porGrupo = fila.reduce<Record<string, number>>((a, l) => { const g = grupoDoStatus(l.status)!; a[g] = (a[g] ?? 0) + 1; return a }, {})

  if (dry) {
    const ex = (g: 'vendendo' | 'cadastro') => { const l = fila.find((x) => grupoDoStatus(x.status) === g); return l ? `Oi ${nomeDe(l)}, tudo bem? ${textoComunicado(g)} É só responder essa mensagem.` : null }
    return NextResponse.json({ ok: true, dry: true, dias: DIAS_DO_ENVIO, hojeBrt, lojas: todos.length, ja_receberam: jaRecebeu, fila: fila.length, por_grupo: porGrupo, restam_hoje: restamHoje, motivos, exemplo_vendendo: ex('vendendo'), exemplo_cadastro: ex('cadastro') })
  }
  if (!TEMPLATE_ID) return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })

  let enviados = 0, cortado = false, tetoDia = false
  const falhas: Array<{ loja: string; erro: string }> = []
  for (const l of fila) {
    if (Date.now() - t0 > TETO_MS) { cortado = true; break }
    if (enviados >= restamHoje) { tetoDia = true; break }
    const nome = nomeDe(l)
    const grupo = grupoDoStatus(l.status)!
    const texto = textoComunicado(grupo)
    try {
      await sendTemplate(l.telefone, TEMPLATE_ID, [nome, texto])
      const agora = new Date().toISOString()
      await supabaseAdmin.from('sdr_mensagens').insert({ lead_id: l.id, direcao: 'out', conteudo: `Oi ${nome}, tudo bem? ${texto} É só responder essa mensagem.`, template_hsm: ROTULO })
      await supabaseAdmin.from('sdr_leads').update({ observacoes: `${(l.observacoes ?? '').trim()} ${MARCADOR}${agora}|${grupo}]`.trim(), data_ultimo_contato: agora }).eq('id', l.id)
      enviados++
    } catch (e) {
      falhas.push({ loja: l.nome, erro: e instanceof Error ? e.message : String(e) })
    }
  }

  // resumo na última rodada do dia (15h57 BRT)
  const horaUtc = new Date().getUTCHours(), minUtc = new Date().getUTCMinutes()
  if (horaUtc === 18 && minUtc >= 50) {
    const restam = fila.length - enviados
    const msg = `🖤 *Black November — comunicado (${hojeBrt.slice(8, 10)}/${hojeBrt.slice(5, 7)})*\nEnviados até agora: ${jaRecebeu + enviados} de ${todos.length} lojas da etapa 50 em diante.\nFicam pra próxima rodada/dia: ${restam}${Object.entries(motivos).map(([k, v]) => ` · ${k}: ${v}`).join('')}${falhas.length ? ` · falhas: ${falhas.length}` : ''}.`
    try {
      if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
      if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
    } catch (err) { console.error('[black-november] resumo falhou:', err) }
  }
  return NextResponse.json({ ok: true, hojeBrt, lojas: todos.length, ja_receberam: jaRecebeu + enviados, enviados, por_grupo: porGrupo, falhas, cortado_por_tempo: cortado, teto_do_dia: tetoDia, motivos })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
