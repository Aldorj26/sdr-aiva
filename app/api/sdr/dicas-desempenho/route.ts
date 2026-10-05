/**
 * dicas-desempenho/route.ts — dica de vendas com os números da loja no portal da AIVA
 * (Aldo 02/10/2026). Substitui a /consultoria-vendas (4 toques fixos e iguais pra todo mundo).
 *
 * Quem: LOJA_FINALIZADA_E_VENDENDO (AIVA, com WhatsApp). Cadência e textos em
 * lib/dicas-desempenho-calc.ts (`npm run test:desempenho`): 1ª dica 7 dias após entrar na
 * etapa, depois semanal pra quem vende/aprova e quinzenal pra quem está parado.
 * Números: lib/desempenho-loja-calc.ts (semanas fechadas do portal; fecham toda segunda).
 * Entrega: HSM 48 com o texto no {{2}}; rótulo próprio `aiva_dicas_desempenho` pra medir.
 *
 * ?dry → mostra o que faria (segmentos, motivos, amostra dos textos) sem enviar nada.
 * ?max=N → limita o lote (rodada manual). ?force → ignora o horário comercial.
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'
import { flag } from '@/lib/req-flags'
import { resumir, type LinhaMes, type LinhaSemana, type Segmento } from '@/lib/desempenho-loja-calc'
import { mesBrt, ultimaSemanaFechada } from '@/lib/desempenho-loja'
import { decidir, lerMarcadores, remontarObs, textoDica, PRIORIDADE, ROTULO, CONVERSA_VIVA_HORAS } from '@/lib/dicas-desempenho-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const MAX_POR_RODADA = 45
const TETO_MS = 240_000
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '')

async function todas<T>(q: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await q(de, de + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const t0 = Date.now()
  const sp = new URL(req.url).searchParams
  const dry = flag(sp, 'dry')
  const force = flag(sp, 'force')
  const max = Math.min(Number(sp.get('max')) || MAX_POR_RODADA, MAX_POR_RODADA)

  const horaBrt = (new Date().getUTCHours() + 21) % 24
  if (!dry && !force && (horaBrt < 9 || horaBrt >= 18)) return NextResponse.json({ ok: true, ignorado: 'fora_horario_comercial', horaBrt })

  const ult = await ultimaSemanaFechada()
  if (!ult) return NextResponse.json({ ok: false, erro: 'aiva_desempenho_semanal vazia' }, { status: 500 })

  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, observacoes, acionar_humano')
    .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
    .eq('produto', 'AIVA')
    .limit(1000)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  const alvo = (leads ?? []).filter((l) => l.telefone && !l.telefone.startsWith('000'))
  const ids = alvo.map((l) => l.id)

  // CNPJs de cada lead: registros + cnpj_matriz das observações
  const regs = ids.length ? await todas<{ lead_id: string; cnpj: string }>((de, ate) => supabaseAdmin.from('sdr_registros_cnpj').select('lead_id,cnpj').in('lead_id', ids).range(de, ate)) : []
  const cnpjsPorLead = new Map<string, Set<string>>()
  for (const l of alvo) {
    const s = new Set<string>()
    const m = dig((l.observacoes ?? '').match(/cnpj_matriz=([0-9./-]+)/)?.[1])
    if (m.length === 14) s.add(m)
    cnpjsPorLead.set(l.id, s)
  }
  for (const r of regs) { const c = dig(r.cnpj); if (c.length === 14) cnpjsPorLead.get(r.lead_id)?.add(c) }
  const todosCnpjs = [...new Set([...cnpjsPorLead.values()].flatMap((s) => [...s]))]

  const desde = new Date(Date.parse(ult + 'T12:00:00Z') - 5 * 7 * 86400_000).toISOString().slice(0, 10)
  const [sem, mens, falas] = await Promise.all([
    todosCnpjs.length ? todas<LinhaSemana & { cnpj: string }>((de, ate) => supabaseAdmin.from('aiva_desempenho_semanal').select('cnpj,semana,aprovados,vendas,valor_vendas').in('cnpj', todosCnpjs).gte('semana', desde).range(de, ate)) : [],
    todosCnpjs.length ? todas<LinhaMes & { cnpj: string }>((de, ate) => supabaseAdmin.from('aiva_desempenho').select('cnpj,mes,consultas,aprovados,vendas,valor_vendas').in('cnpj', todosCnpjs).range(de, ate)) : [],
    ids.length ? todas<{ lead_id: string; enviado_em: string }>((de, ate) => supabaseAdmin.from('sdr_mensagens').select('lead_id,enviado_em').in('lead_id', ids).eq('direcao', 'in').gte('enviado_em', new Date(Date.now() - CONVERSA_VIVA_HORAS * 3600_000).toISOString()).range(de, ate)) : [],
  ])
  const ultimaFala = new Map<string, number>()
  for (const f of falas) ultimaFala.set(f.lead_id, Math.max(ultimaFala.get(f.lead_id) ?? 0, Date.parse(f.enviado_em)))
  const mes = mesBrt()

  const motivos: Record<string, number> = {}
  const porSegmento: Record<string, number> = {}
  const fila: { lead: (typeof alvo)[number]; seg: Segmento; texto: string; count: number }[] = []
  for (const l of alvo) {
    const cs = cnpjsPorLead.get(l.id) ?? new Set<string>()
    const r = resumir(sem.filter((x) => cs.has(x.cnpj)), mens.filter((x) => cs.has(x.cnpj)), ult, mes)
    porSegmento[r.segmento] = (porSegmento[r.segmento] ?? 0) + 1
    if (l.acionar_humano) { motivos.fila_humano = (motivos.fila_humano ?? 0) + 1; continue }
    const m = lerMarcadores(l.observacoes)
    const d = decidir(m, r.segmento, ultimaFala.get(l.id) ?? null)
    if (d.acao === 'nada') { motivos[d.motivo] = (motivos[d.motivo] ?? 0) + 1; continue }
    fila.push({ lead: l, seg: r.segmento, texto: textoDica(r, m.count), count: m.count })
  }
  fila.sort((a, b) => PRIORIDADE[a.seg] - PRIORIDADE[b.seg])

  const nomeDe = (l: (typeof alvo)[number]) => {
    const socio = (l.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1]?.trim()
    return (socio ? normalizaNome(socio) : normalizaNome(l.nome)) || 'lojista'
  }

  if (dry) {
    // quem já levou dica HOJE (BRT): o vigia roda às 17h, depois da rodada das 10h, e o ?dry só vê o que sobrou
    const hojeBrt = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
    const tocadosHoje = alvo.filter((l) => {
      const u = lerMarcadores(l.observacoes).ultima
      return u !== null && new Date(u - 3 * 3600_000).toISOString().slice(0, 10) === hojeBrt
    }).length
    const porSegFila: Record<string, number> = {}
    for (const f of fila) porSegFila[f.seg] = (porSegFila[f.seg] ?? 0) + 1
    return NextResponse.json({
      ok: true, dry: true, semana_fechada: ult, lojas: alvo.length, por_segmento: porSegmento, tocados_hoje: tocadosHoje,
      fila: fila.length, fila_por_segmento: porSegFila, nesta_rodada: Math.min(fila.length, max), motivos,
      amostra: fila.slice(0, 12).map((f) => ({ loja: f.lead.nome, segmento: f.seg, texto: `Olá ${nomeDe(f.lead)}, ${f.texto}` })),
    })
  }

  if (!TEMPLATE_ID) return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })
  const enviados: { loja: string; segmento: Segmento }[] = []
  const falhas: { loja: string; erro: string }[] = []
  let cortadoPorTempo = false
  for (const f of fila.slice(0, max)) {
    if (Date.now() - t0 > TETO_MS) { cortadoPorTempo = true; break }
    const nome = nomeDe(f.lead)
    try {
      await sendTemplate(f.lead.telefone, TEMPLATE_ID, [nome, f.texto])
      const agora = new Date()
      await supabaseAdmin.from('sdr_leads').update({ observacoes: remontarObs(f.lead.observacoes, f.count + 1, f.seg, agora), data_ultimo_contato: agora.toISOString() }).eq('id', f.lead.id)
      await supabaseAdmin.from('sdr_mensagens').insert({ lead_id: f.lead.id, direcao: 'out', conteudo: `Olá ${nome}, ${f.texto}`, template_hsm: ROTULO })
      enviados.push({ loja: f.lead.nome, segmento: f.seg })
    } catch (e) {
      falhas.push({ loja: f.lead.nome, erro: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: true, semana_fechada: ult, lojas: alvo.length, fila: fila.length, enviados: enviados.length, falhas, cortado_por_tempo: cortadoPorTempo, motivos, detalhe: enviados })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
