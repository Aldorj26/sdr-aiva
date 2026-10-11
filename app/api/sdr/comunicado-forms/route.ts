/**
 * comunicado-forms/route.ts — aviso único às lojas com loja criada (Aldo 11/10/2026, pedido do Nei):
 * acesso só pelo vendas.flexfone.com.br, pedidos à AIVA por formulário e convite pro painel financeiro.
 *
 * Roda SÓ em 13/10/2026 (cron 17,37,57 13-18 13 10 * = 10h17–15h57 BRT), lotes até o teto de tempo; cada loja recebe
 * UMA vez ([COMUNICADO_FORMS:ISO] + rótulo `aiva_comunicado_forms`). Quem: AIVA em TREINAR / LOGIN /
 * LOJA_FINALIZADA_E_VENDENDO com WhatsApp. Pula opt-out, pausa e conversa viva (lojista falou nas últimas 48h).
 * A última rodada do dia manda o resumo a Aldo e Nei. ?dry mostra o que faria; ?force ignora a data (rodada manual).
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate, alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'
import { flag } from '@/lib/req-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DIA_DO_ENVIO = '2026-10-13'
const ROTULO = 'aiva_comunicado_forms'
const MARCADOR = '[COMUNICADO_FORMS:'
const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const TETO_MS = 230_000
const CONVERSA_VIVA_H = 48
const TEXTO = 'um aviso importante da AIVA 📢 O acesso à plataforma agora é só por https://vendas.flexfone.com.br e os pedidos à AIVA passaram a ser por formulário. Já garanta o acesso ao seu painel financeiro (é onde você acompanha o que vai receber): https://docs.google.com/forms/d/e/1FAIpQLSf3vvEgnb8fWXKYloRhh8jL7DxnPQIrbBkU8zNBO3L6_oa4Jw/viewform — leva 2 minutos. Pra repasse, dados bancários, login de vendedor ou alteração de cadastro, me chama aqui que eu te mando o formulário certo!'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const t0 = Date.now()
  const sp = new URL(req.url).searchParams
  const dry = flag(sp, 'dry')
  const hojeBrt = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
  if (!dry && !flag(sp, 'force') && hojeBrt !== DIA_DO_ENVIO) return NextResponse.json({ ok: true, ignorado: 'fora_do_dia', hojeBrt, dia: DIA_DO_ENVIO })

  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, observacoes')
    .eq('produto', 'AIVA')
    .in('status', ['TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO'])
    .limit(2000)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  const todos = leads ?? []

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

  if (dry) {
    return NextResponse.json({ ok: true, dry: true, dia: DIA_DO_ENVIO, lojas: todos.length, ja_receberam: jaRecebeu, fila: fila.length, motivos, exemplo: fila[0] ? `Olá ${nomeDe(fila[0])}, ${TEXTO}` : null })
  }
  if (!TEMPLATE_ID) return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })

  let enviados = 0, cortado = false
  const falhas: Array<{ loja: string; erro: string }> = []
  for (const l of fila) {
    if (Date.now() - t0 > TETO_MS) { cortado = true; break }
    const nome = nomeDe(l)
    try {
      await sendTemplate(l.telefone, TEMPLATE_ID, [nome, TEXTO])
      const agora = new Date().toISOString()
      await supabaseAdmin.from('sdr_mensagens').insert({ lead_id: l.id, direcao: 'out', conteudo: `Olá ${nome}, ${TEXTO}`, template_hsm: ROTULO })
      await supabaseAdmin.from('sdr_leads').update({ observacoes: `${(l.observacoes ?? '').trim()} ${MARCADOR}${agora}]`.trim(), data_ultimo_contato: agora }).eq('id', l.id)
      enviados++
    } catch (e) {
      falhas.push({ loja: l.nome, erro: e instanceof Error ? e.message : String(e) })
    }
  }

  // resumo na última rodada do dia (15h57 BRT)
  const horaUtc = new Date().getUTCHours(), minUtc = new Date().getUTCMinutes()
  if (horaUtc === 18 && minUtc >= 50) {
    const restam = fila.length - enviados
    const msg = `📢 *Comunicado dos formulários AIVA (13/10)*\nEnviados no dia: ${jaRecebeu + enviados} de ${todos.length} lojas com loja criada.\nFicaram de fora: ${restam} na fila${Object.entries(motivos).map(([k, v]) => ` · ${k}: ${v}`).join('')}${falhas.length ? ` · falhas: ${falhas.length}` : ''}.`
    try {
      if (process.env.ALDO_WHATSAPP) await alertHuman(process.env.ALDO_WHATSAPP, msg)
      if (process.env.NEI_WHATSAPP) await alertHuman(process.env.NEI_WHATSAPP, msg)
    } catch (err) { console.error('[comunicado-forms] resumo falhou:', err) }
  }
  return NextResponse.json({ ok: true, lojas: todos.length, ja_receberam: jaRecebeu + enviados, enviados, falhas, cortado_por_tempo: cortado, motivos })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
