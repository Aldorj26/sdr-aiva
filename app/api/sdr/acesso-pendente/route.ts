/**
 * /api/sdr/acesso-pendente — loja com senha enviada que NUNCA ACESSOU a ferramenta (Karol/AIVA, 07/10/2026).
 * Regras e textos em lib/acesso-pendente-calc.ts (`npm run test:acesso`). Cron 11h BRT, seg–sex.
 *  - coluna `pronto_para_operar` sem `primeiro_acesso_em` → 2 toques no HSM 48 (rótulo aiva_acesso_pendente)
 *    e depois aviso no topo do Atendimento ("Senha enviada e nunca acessou") pro Nei ligar;
 *  - quando o acesso aparece, os marcadores saem e o aviso fecha.
 * Não toca: fila humana, opt-out, pausa, conversa viva (<48h), loja bloqueada por limite, telefone 000.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'
import { flag } from '@/lib/req-flags'
import { listarOnboardingsApi } from '@/lib/portal-aiva'
import { registrarAvisos, resolverAvisos } from '@/lib/avisos-painel'
import { leadsBloqueadosPorLimite } from '@/lib/limite-originacao'
import { decidir, lerMarcas, remontarObs, limparMarcas, texto, ROTULO, CONVERSA_VIVA_HORAS } from '@/lib/acesso-pendente-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const TETO_MS = 240_000
const TERMINAIS = ['OPT_OUT', 'DESCARTADO', 'NAO_QUALIFICADO', 'BOT_DETECTADO']
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const t0 = Date.now()
  const sp = new URL(req.url).searchParams
  const dry = flag(sp, 'dry')
  const horaBrt = (new Date().getUTCHours() + 21) % 24
  if (!dry && !flag(sp, 'force') && (horaBrt < 9 || horaBrt >= 18)) return NextResponse.json({ ok: true, ignorado: 'fora_horario_comercial', horaBrt })

  // 1) portal: quem tem senha e nunca acessou × quem já acessou
  const onbs = await listarOnboardingsApi()
  const semAcesso = new Map<string, number | null>()   // cnpj → desde (board_column_since)
  const comAcesso = new Set<string>()
  for (const o of onbs) {
    const c = dig(o.cnpj)
    if (c.length !== 14) continue
    if (o.primeiro_acesso_em) comAcesso.add(c)
    else if (o.board_column === 'pronto_para_operar') semAcesso.set(c, o.board_column_since ? Date.parse(String(o.board_column_since)) || null : null)
  }

  // 2) CNPJ → lead
  const cnpjs = [...semAcesso.keys(), ...comAcesso]
  const regs: Array<{ lead_id: string | null; cnpj: string }> = []
  for (let i = 0; i < cnpjs.length; i += 300) {
    const { data } = await supabaseAdmin.from('sdr_registros_cnpj').select('lead_id,cnpj').in('cnpj', cnpjs.slice(i, i + 300))
    regs.push(...(data ?? []))
  }
  const desdePorLead = new Map<string, number | null>()
  const leadComAcesso = new Set<string>()
  for (const r of regs) {
    if (!r.lead_id) continue
    const c = dig(r.cnpj)
    if (comAcesso.has(c)) leadComAcesso.add(r.lead_id)
    else if (semAcesso.has(c)) desdePorLead.set(r.lead_id, semAcesso.get(c) ?? null)
  }
  for (const id of leadComAcesso) desdePorLead.delete(id)   // matriz acessou → a loja já entrou

  // 3) limpa quem acessou (marcadores + aviso do painel)
  let limpos = 0
  if (leadComAcesso.size) {
    const { data: comMarca } = await supabaseAdmin.from('sdr_leads').select('id, observacoes').in('id', [...leadComAcesso]).like('observacoes', '%[ACESSO_%')
    for (const l of comMarca ?? []) {
      const novo = limparMarcas(l.observacoes)
      if (novo == null) continue
      limpos++
      if (!dry) {
        await supabaseAdmin.from('sdr_leads').update({ observacoes: novo }).eq('id', l.id)
        await resolverAvisos('nunca_acessou', [l.id], 'auto: a loja fez o primeiro acesso')
      }
    }
  }

  // 4) régua de quem não acessou
  const ids = [...desdePorLead.keys()]
  const { data: leads } = ids.length
    ? await supabaseAdmin.from('sdr_leads').select('id, nome, telefone, status, observacoes, acionar_humano').in('id', ids)
    : { data: [] as Array<{ id: string; nome: string; telefone: string; status: string; observacoes: string | null; acionar_humano: boolean }> }
  const { data: falas } = ids.length
    ? await supabaseAdmin.from('sdr_mensagens').select('lead_id, enviado_em').in('lead_id', ids).eq('direcao', 'in').gte('enviado_em', new Date(Date.now() - CONVERSA_VIVA_HORAS * 3600_000).toISOString())
    : { data: [] as Array<{ lead_id: string; enviado_em: string }> }
  const ultimaFala = new Map<string, number>()
  for (const f of falas ?? []) ultimaFala.set(f.lead_id, Math.max(ultimaFala.get(f.lead_id) ?? 0, Date.parse(f.enviado_em)))
  const bloqueados = await leadsBloqueadosPorLimite()

  const agora = Date.now()
  const motivos: Record<string, number> = {}
  const conta = (k: string) => { motivos[k] = (motivos[k] ?? 0) + 1 }
  const fila: Array<{ lead: NonNullable<typeof leads>[number]; toque: 1 | 2 | null; n: number }> = []
  for (const l of leads ?? []) {
    if (TERMINAIS.includes(l.status)) { conta('status_terminal'); continue }
    if (!l.telefone || l.telefone.startsWith('000')) { conta('sem_whatsapp'); continue }
    if (l.acionar_humano) { conta('fila_humano'); continue }
    if (bloqueados.has(l.id)) { conta('bloqueada_limite'); continue }
    const m = lerMarcas(l.observacoes)
    const d = decidir(m, desdePorLead.get(l.id) ?? null, ultimaFala.get(l.id) ?? null, agora)
    if (d.acao === 'nada') { conta(d.motivo); continue }
    fila.push({ lead: l, toque: d.acao === 'toque' ? d.toque : null, n: m.n })
  }
  const nomeDe = (l: { nome: string; observacoes: string | null }) =>
    normalizaNome((l.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1] ?? null) || normalizaNome(l.nome) || 'lojista'

  if (dry) {
    const hoje = new Date(agora - 3 * 3600_000).toISOString().slice(0, 10)
    const tocadosHoje = (leads ?? []).filter((l) => (l.observacoes ?? '').match(/\[ACESSO_COBRANCA:\d+:([^\]]+)\]/)?.[1]?.slice(0, 10) === hoje).length
    return NextResponse.json({
      ok: true, dry: true, sem_acesso_portal: semAcesso.size, leads_sem_acesso: ids.length, limpariam: limpos, tocados_hoje: tocadosHoje,
      fila: fila.length, motivos,
      amostra: fila.slice(0, 15).map((f) => ({ loja: f.lead.nome, acao: f.toque ? `toque ${f.toque}` : 'aviso no painel', texto: f.toque ? `Olá ${nomeDe(f.lead)}, ${texto(f.toque)}` : null })),
    })
  }

  if (!TEMPLATE_ID) return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })
  const enviados: string[] = [], esgotados: string[] = [], falhas: Array<{ loja: string; erro: string }> = []
  let cortado = false
  for (const f of fila) {
    if (Date.now() - t0 > TETO_MS) { cortado = true; break }
    try {
      if (f.toque) {
        const nome = nomeDe(f.lead), t = texto(f.toque), quando = new Date()
        await sendTemplate(f.lead.telefone, TEMPLATE_ID, [nome, t])
        await supabaseAdmin.from('sdr_leads').update({ observacoes: remontarObs(f.lead.observacoes, f.toque, quando), data_ultimo_contato: quando.toISOString() }).eq('id', f.lead.id)
        await supabaseAdmin.from('sdr_mensagens').insert({ lead_id: f.lead.id, direcao: 'out', conteudo: `Olá ${nome}, ${t}`, template_hsm: ROTULO })
        enviados.push(f.lead.nome)
      } else {
        await supabaseAdmin.from('sdr_leads').update({ observacoes: `${(f.lead.observacoes ?? '').trim()} [ACESSO_ESGOTADO:${new Date().toISOString()}]`.trim() }).eq('id', f.lead.id)
        await registrarAvisos('nunca_acessou', [{ leadId: f.lead.id, loja: f.lead.nome, telefone: f.lead.telefone, status: f.lead.status, detalhe: '2 cobranças sem nenhum acesso' }])
        esgotados.push(f.lead.nome)
      }
    } catch (e) {
      falhas.push({ loja: f.lead.nome, erro: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: true, sem_acesso_portal: semAcesso.size, fila: fila.length, enviados: enviados.length, esgotados: esgotados.length, limpos, falhas, cortado_por_tempo: cortado, motivos, detalhe: { enviados, esgotados } })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
