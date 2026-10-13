/**
 * tickets-aiva/route.ts — acompanha os tickets da Track na AIVA (Aldo 13/10/2026, API do Mauricio).
 *
 * De hora em hora: GET /tickets?updated_since=<última rodada> e, pra cada ticket que mudou:
 *   - RESOLVIDO → avisa o LOJISTA (HSM 48, rótulo `aiva_ticket_resolvido`, só status — o texto do CS vai pro time);
 *   - AGUARDANDO PARCEIRO → avisa Aldo/Nei com o que a AIVA pediu (quem responde é o time, pelo portal);
 *   - resposta nova da AIVA sem mudar status → avisa Aldo/Nei (informação).
 * Grava no lead [TICKET_AIVA:<nº>|<tipo>|<status>|<msgs da AIVA vistas>] — é o que a VictorIA lê na conversa.
 * Primeira rodada (sem estado) só tira o retrato, sem avisar ninguém. Regras puras em lib/tickets-aiva.ts.
 * ?dry mostra o que faria. Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate, alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'
import { flag } from '@/lib/req-flags'
import { listarTicketsAtualizados, eventosDoTicket, avisoLojista, lerTicketsDoLead, gravarTicketNoLead, STATUS_ROTULO, type TicketApi } from '@/lib/tickets-aiva'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CHAVE_ESTADO = 'tickets_aiva:ultima_rodada'
const ROTULO = 'aiva_ticket_resolvido'
const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const TERMINAIS = ['OPT_OUT', 'DESCARTADO', 'NAO_QUALIFICADO', 'BOT_DETECTADO']

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dry = flag(new URL(req.url).searchParams, 'dry')
  const inicio = new Date()

  const { data: est } = await supabaseAdmin.from('sdr_avisos_chave').select('ultimo_aviso').eq('chave', CHAVE_ESTADO).maybeSingle()
  const ultima = est?.ultimo_aviso ? new Date(Date.parse(est.ultimo_aviso) - 10 * 60_000).toISOString() : null // 10 min de folga
  const baseline = !ultima
  const r = await listarTicketsAtualizados(ultima)
  if (!r.ok) return NextResponse.json({ ok: false, erro: r.erro }, { status: 502 })

  // RID → lead
  const rids = [...new Set(r.tickets.map((t) => String(t.retailer_id ?? '')).filter(Boolean))]
  const { data: regs } = rids.length ? await supabaseAdmin.from('sdr_registros_cnpj').select('rid, lead_id').in('rid', rids) : { data: [] as Array<{ rid: string; lead_id: string }> }
  const leadPorRid = new Map((regs ?? []).filter((x) => x.lead_id).map((x) => [String(x.rid), x.lead_id as string]))
  const ids = [...new Set(leadPorRid.values())]
  const { data: leads } = ids.length ? await supabaseAdmin.from('sdr_leads').select('id, nome, telefone, status, observacoes').in('id', ids) : { data: [] as Array<{ id: string; nome: string; telefone: string; status: string; observacoes: string | null }> }
  const L = new Map((leads ?? []).map((l) => [l.id, l]))

  // tickets de loja sem conversa nossa: o "já visto" mora em sdr_avisos_chave (senão a folga de 10 min repete o aviso)
  // chave = ticket_aiva:<nº>:<status>:<msgs da AIVA>; vale a mais recente de cada ticket
  const { data: vistosSemLead } = await supabaseAdmin.from('sdr_avisos_chave').select('chave, ultimo_aviso').like('chave', 'ticket_aiva:%').order('ultimo_aviso', { ascending: true })
  const vistoSemLead = new Map<string, { status: string; msgsAiva: number }>()
  for (const x of vistosSemLead ?? []) { const [, n, st, m] = String(x.chave).split(':'); if (n && st) vistoSemLead.set(`ticket_aiva:${n}`, { status: st, msgsAiva: Number(m) || 0 }) }

  const relatorio: Array<{ ticket: number; tipo: string; status: string; loja: string; eventos: string[]; lojista?: string }> = []
  const paraTime: string[] = []
  for (const t of r.tickets as TicketApi[]) {
    const lead = L.get(leadPorRid.get(String(t.retailer_id ?? '')) ?? '')
    const msgsAiva = (t.messages ?? []).filter((m) => m.from === 'aiva').length
    const visto = lead ? lerTicketsDoLead(lead.observacoes).get(t.number) : vistoSemLead.get(`ticket_aiva:${t.number}`)
    // ticket que não abrimos (Nei abriu à mão, sem marcador): avisa só o time, nunca o lojista
    const nosso = !!(lead && visto)
    const evs = baseline ? [] : eventosDoTicket(t, visto ?? { status: 'aberto', msgsAiva: 0 })
    const loja = lead?.nome ?? `RID ${t.retailer_id ?? '?'}`
    const item: (typeof relatorio)[number] = { ticket: t.number, tipo: t.type, status: t.status, loja, eventos: evs.map((e) => e.tipo) }
    let statusGravar = t.status
    for (const e of evs) {
      if (e.tipo === 'resolvido' && nosso && lead && !TERMINAIS.includes(lead.status) && lead.telefone && !lead.telefone.startsWith('000')) {
        const texto = avisoLojista(t, e)
        if (texto && !dry) {
          let ok = false
          if (TEMPLATE_ID) {
            const nome = normalizaNome((lead.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1] ?? null) || normalizaNome(lead.nome) || 'lojista'
            try {
              await sendTemplate(lead.telefone, TEMPLATE_ID, [nome, texto])
              await supabaseAdmin.from('sdr_mensagens').insert({ lead_id: lead.id, direcao: 'out', conteudo: `Olá ${nome}, ${texto}`, template_hsm: ROTULO })
              ok = true
            } catch (err) { console.error('[tickets-aiva] aviso ao lojista falhou:', err) }
          }
          if (ok) item.lojista = texto
          else statusGravar = visto?.status ?? 'aberto' // não avança: tenta de novo na próxima rodada
        } else if (texto) item.lojista = texto
      }
      const sufixoLojista = item.lojista ? (dry ? ' — lojista seria avisado' : ' — lojista avisado') : !lead ? ' — loja sem conversa nossa, ninguém avisado' : !nosso ? ' — ticket aberto fora da VictorIA, lojista NÃO avisado' : statusGravar !== t.status ? ' — ⚠️ aviso ao lojista FALHOU, tento de novo na próxima rodada' : ''
      if (e.tipo === 'aguardando') paraTime.push(`⏳ *AIVA pediu algo* — ticket nº ${t.number} (${t.type}) · ${loja}${e.mensagem ? `\n«${e.mensagem.slice(0, 400)}»` : ''}\nResponder pelo portal da AIVA (Tickets).`)
      if (e.tipo === 'resposta') paraTime.push(`💬 *Resposta da AIVA* — ticket nº ${t.number} (${t.type}, ${STATUS_ROTULO[t.status] ?? t.status}) · ${loja}${e.mensagem ? `\n«${e.mensagem.slice(0, 400)}»` : ''}`)
      if (e.tipo === 'resolvido') paraTime.push(`✅ *Resolvido pela AIVA* — ticket nº ${t.number} (${t.type}) · ${loja}${sufixoLojista}${e.mensagem ? `\n«${e.mensagem.slice(0, 300)}»` : ''}`)
      if (e.tipo === 'fechado') paraTime.push(`🔒 *Fechado pela AIVA sem resolver* — ticket nº ${t.number} (${t.type}) · ${loja}${e.mensagem ? `\n«${e.mensagem.slice(0, 400)}»` : ''}\nConferir o motivo no portal e falar com o lojista — ele NÃO foi avisado.`)
    }
    relatorio.push(item)
    if (dry) continue
    if (lead) {
      // relê na hora: o webhook pode ter gravado marcador novo durante a rodada
      const { data: fr } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
      const atual = fr?.observacoes ?? lead.observacoes ?? ''
      const novo = gravarTicketNoLead(atual, { number: t.number, type: t.type, status: statusGravar, msgsAiva: statusGravar === t.status ? msgsAiva : (visto?.msgsAiva ?? 0) })
      if (novo !== atual) await supabaseAdmin.from('sdr_leads').update({ observacoes: novo }).eq('id', lead.id)
      lead.observacoes = novo
    } else {
      await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: `ticket_aiva:${t.number}:${t.status}:${msgsAiva}`, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
    }
  }

  if (!dry) {
    if (paraTime.length) {
      const msg = `🎫 *Tickets da AIVA — novidades*\n\n${paraTime.slice(0, 15).join('\n\n')}${paraTime.length > 15 ? `\n\n…e mais ${paraTime.length - 15}.` : ''}`
      for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean) as string[]) {
        try { await alertHuman(tel, msg) } catch (err) { console.error('[tickets-aiva] aviso ao time falhou:', err) }
      }
    }
    await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: CHAVE_ESTADO, ultimo_aviso: inicio.toISOString() }, { onConflict: 'chave' })
  }
  return NextResponse.json({ ok: true, dry, baseline, desde: ultima, tickets: r.tickets.length, avisos_time: paraTime.length, lojistas_avisados: relatorio.filter((x) => x.lojista).length, relatorio })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
