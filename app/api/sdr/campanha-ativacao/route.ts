/**
 * campanha-ativacao/route.ts — campanha de boas-vindas da AIVA pras lojas novas (Aldo 09/10/2026).
 *
 * Regras e textos: lib/campanha-ativacao-calc.ts (`npm run test:campanha`). 4 semanas a partir do primeiro acesso;
 * cada semana batida = R$ 80, tudo batido = R$ 500 (pago pela AIVA junto do repasse).
 * Quem: loja com primeiro acesso a partir de 01/10/2026 que não tinha venda antes de começar (quem entrou em outubro
 * antes do lançamento começa em 09/10). Uma mensagem por evento: boas-vindas, parcial no dia 4 de cada semana (se a
 * meta ainda não bateu) e resultado na virada da semana. HSM 48, rótulo `aiva_campanha_boas_vindas`.
 * Todo dia grava o placar no lead ([CAMP_ATIV_PLACAR:…]) — é dele que a VictorIA lê na conversa.
 *
 * ENVIO_ATIVO ligado em 09/10/2026 (Aldo aprovou os textos). ?dry mostra quem entra, o placar e as mensagens.
 * ?force ignora o horário. Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'
import { flag } from '@/lib/req-flags'
import { listarOnboardingsApi, lerSerie } from '@/lib/portal-aiva'
import { leadsBloqueadosPorLimite } from '@/lib/limite-originacao'
import {
  inicioCampanha, progresso, proximaMensagem, textoMensagem, remontarObs, lerMarcas, acumuladoAte, somaDias,
  type Retrato, type TipoMsg,
} from '@/lib/campanha-ativacao-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ENVIO_ATIVO = true
const ROTULO = 'aiva_campanha_boas_vindas'
const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const TETO_MS = 240_000
const MAX_POR_RODADA = 60
const TERMINAIS = ['OPT_OUT', 'DESCARTADO', 'NAO_QUALIFICADO', 'BOT_DETECTADO']
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const hojeBrt = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const t0 = Date.now()
  const sp = new URL(req.url).searchParams
  const dry = flag(sp, 'dry')
  const horaBrt = (new Date().getUTCHours() + 21) % 24
  if (!dry && !flag(sp, 'force') && (horaBrt < 9 || horaBrt >= 19)) return NextResponse.json({ ok: true, ignorado: 'fora_horario', horaBrt })

  // 1) portal: lojas com primeiro acesso dentro da janela da campanha
  const hoje = hojeBrt()
  const porCnpj = new Map<string, { inicio: string; rid: string }>()
  for (const o of await listarOnboardingsApi()) {
    const c = dig(o.cnpj)
    const inicio = inicioCampanha(o.primeiro_acesso_em as string | null)
    if (c.length !== 14 || !inicio || !o.retailer_id) continue
    if (hoje > somaDias(inicio, 35)) continue // terminou (28 dias + folga pro resultado final)
    porCnpj.set(c, { inicio, rid: String(o.retailer_id) })
  }

  // 2) CNPJ → lead (sdr_registros_cnpj — é onde todo CNPJ de loja criada pela Track está)
  const cnpjs = [...porCnpj.keys()]
  const leadCnpjs = new Map<string, Set<string>>()
  for (let i = 0; i < cnpjs.length; i += 300) {
    const { data } = await supabaseAdmin.from('sdr_registros_cnpj').select('lead_id,cnpj').in('cnpj', cnpjs.slice(i, i + 300))
    for (const r of data ?? []) if (r.lead_id) leadCnpjs.set(r.lead_id, (leadCnpjs.get(r.lead_id) ?? new Set()).add(dig(r.cnpj)))
  }
  const ids = [...leadCnpjs.keys()]
  const leads: Array<{ id: string; nome: string; telefone: string; status: string; observacoes: string | null; acionar_humano: boolean; data_ultimo_contato: string | null }> = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabaseAdmin.from('sdr_leads').select('id,nome,telefone,status,observacoes,acionar_humano,data_ultimo_contato').in('id', ids.slice(i, i + 200))
    leads.push(...(data ?? []))
  }

  // 3) série diária do portal (acumulado do mês) das lojas envolvidas
  const inicios = [...porCnpj.values()].map((x) => x.inicio).sort()
  const rids = new Set([...porCnpj.values()].map((x) => x.rid))
  const serieToda = inicios.length ? await lerSerie(inicios[0].slice(0, 7) + '-01', hoje.slice(0, 7) + '-01') : []
  const serie = serieToda.filter((r) => rids.has(String(r.retailer_id))).map((r) => ({ data_ref: String(r.data_ref), retailer_id: String(r.retailer_id), mes: String(r.mes), consultas: Number(r.consultas) || 0, vendas: Number(r.vendas) || 0 })) as Retrato[]
  const ultimoRetrato = serie.reduce((m, r) => (r.data_ref > m ? r.data_ref : m), '')
  const dadosFrescos = ultimoRetrato >= somaDias(hoje, -1)

  const bloqueados = await leadsBloqueadosPorLimite()
  const motivos: Record<string, number> = {}
  const conta = (m: string) => { motivos[m] = (motivos[m] ?? 0) + 1 }
  // lead duplicado da mesma loja (mesmas lojas no portal): só o mais recente recebe — senão a loja leva 2×
  const donoDaLoja = new Map<string, (typeof leads)[number]>()
  for (const l of leads.filter((x) => !TERMINAIS.includes(x.status))) {
    const chave = [...(leadCnpjs.get(l.id) ?? [])].map((c) => porCnpj.get(c)!.rid).sort().join(',')
    const atual = donoDaLoja.get(chave)
    if (!atual || (l.data_ultimo_contato ?? '') > (atual.data_ultimo_contato ?? '')) donoDaLoja.set(chave, l)
  }
  const donos = new Set([...donoDaLoja.values()].map((l) => l.id))
  const fila: Array<{ lead: (typeof leads)[number]; inicio: string; msg: TipoMsg | null; obs: string; texto: string | null; placar: string }> = []
  for (const l of leads) {
    if (TERMINAIS.includes(l.status)) { conta('status_terminal'); continue }
    if (!donos.has(l.id)) { conta('lead_duplicado_da_loja'); continue }
    const cs = [...(leadCnpjs.get(l.id) ?? [])]
    const inicio = cs.map((c) => porCnpj.get(c)!.inicio).sort()[0]
    const ridsLead = new Set(cs.map((c) => porCnpj.get(c)!.rid))
    const s = serie.filter((r) => ridsLead.has(r.retailer_id))
    const marcas = lerMarcas(l.observacoes)
    // quem já vendia antes de começar não é "loja nova sem venda" (só se ainda não entrou na campanha)
    if (!marcas.inicio && acumuladoAte(s, inicio).vendas > 0) { conta('ja_vendia_antes'); continue }
    const p = progresso(marcas.inicio ?? inicio, s, ultimoRetrato || hoje)
    let msg = proximaMensagem(p, marcas.enviadas)
    if (msg && msg !== 'boas_vindas' && !dadosFrescos) { conta('retrato_atrasado'); msg = null }
    if (msg && (!l.telefone || l.telefone.startsWith('000'))) { conta('sem_whatsapp'); msg = null }
    if (msg && bloqueados.has(l.id)) { conta('bloqueada_limite'); msg = null }
    if (msg && /\[PAUSA_ATE:([^\]]+)\]/.test(l.observacoes ?? '') && Date.parse(RegExp.$1) > Date.now()) { conta('pausa'); msg = null }
    if (msg && marcas.ultimaMsg && Date.now() - marcas.ultimaMsg < 20 * 3600_000) { conta('mensagem_recente'); msg = null }
    const agora = new Date()
    fila.push({
      lead: l, inicio: marcas.inicio ?? inicio, msg,
      obs: remontarObs(l.observacoes, marcas.inicio ?? inicio, p, msg, agora),
      texto: msg ? textoMensagem(msg, p) : null,
      placar: `semana ${Math.min(p.semanaAtual, 4)} · ${p.semanas[Math.min(p.semanaAtual, 4) - 1].consultas} consultas · ${p.vendasTotal} vendas · R$ ${p.premioGarantido} previstos`,
    })
  }

  const nomeDe = (l: (typeof leads)[number]) => {
    const socio = (l.observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1]?.trim()
    return (socio ? normalizaNome(socio) : normalizaNome(l.nome)) || 'lojista'
  }
  const comMsg = fila.filter((f) => f.msg)

  if (dry || !ENVIO_ATIVO) {
    return NextResponse.json({
      ok: true, dry: true, envio_ativo: ENVIO_ATIVO, retrato_mais_recente: ultimoRetrato, dados_frescos: dadosFrescos,
      lojas_no_portal: porCnpj.size, leads: fila.length, mensagens_hoje: comMsg.length, motivos,
      participantes: fila.map((f) => ({ loja: f.lead.nome, inicio: f.inicio, placar: f.placar, mensagem: f.msg })),
      amostra: comMsg.slice(0, 8).map((f) => ({ loja: f.lead.nome, tipo: f.msg, texto: `Olá ${nomeDe(f.lead)}, ${f.texto}` })),
    })
  }

  if (!TEMPLATE_ID) return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })
  let enviados = 0, placares = 0, cortado = false
  const falhas: Array<{ loja: string; erro: string }> = []
  for (const f of fila) {
    if (Date.now() - t0 > TETO_MS) { cortado = true; break }
    try {
      if (f.msg && enviados < MAX_POR_RODADA) {
        const nome = nomeDe(f.lead)
        await sendTemplate(f.lead.telefone, TEMPLATE_ID, [nome, f.texto!])
        await supabaseAdmin.from('sdr_mensagens').insert({ lead_id: f.lead.id, direcao: 'out', conteudo: `Olá ${nome}, ${f.texto}`, template_hsm: ROTULO })
        await supabaseAdmin.from('sdr_leads').update({ observacoes: f.obs, data_ultimo_contato: new Date().toISOString() }).eq('id', f.lead.id)
        enviados++
      } else {
        // só o placar (sem o carimbo da mensagem que não saiu)
        const obsSemMsg = f.msg ? f.obs.replace(/\s*\[CAMP_ATIV_MSG:[a-z_0-9]+:[^\]]+\]$/, '') : f.obs
        if (obsSemMsg !== (f.lead.observacoes ?? '')) { await supabaseAdmin.from('sdr_leads').update({ observacoes: obsSemMsg }).eq('id', f.lead.id); placares++ }
      }
    } catch (e) {
      falhas.push({ loja: f.lead.nome, erro: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ ok: true, leads: fila.length, enviados, placares_atualizados: placares, falhas, cortado_por_tempo: cortado, motivos })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
