/**
 * retomada-interessado/route.ts (AIVA) — o maior vazamento do funil (Aldo 18/09/2026)
 *
 * Levantamento de 18/09: 1.489 leads em INTERESSADO, 1.164 sem falar com a gente
 * há 7–30 dias e 591 já tinham entregado dados. É 3,5× todo o histórico de quem
 * chegou à pré-aprovação — e desde 10/09 nenhuma automação tocava neles (as
 * rotinas da etapa Interessado saíram pro redesenho, e a régua D+3/D+7/D+14 só
 * pega INICIO e SEM_RESPOSTA).
 *
 * DOIS toques e encerra ([RETOM_INT_FIM]) — de propósito: sem isso a gente só
 * trocaria um bolsão parado por um bolsão sendo cutucado pra sempre. Quem não
 * responder os dois vira decisão humana, não fila automática.
 *
 * O silêncio é medido pela ÚLTIMA MENSAGEM DO LOJISTA (sdr_mensagens direcao=in),
 * não por data_ultimo_contato — esse campo também sobe quando NÓS enviamos, então
 * a própria régua zeraria o contador e nunca avançaria.
 *
 * Não toca: conversa viva (<7d), acionar_humano, [PAUSA_ATE], opt-out, importados
 * do portal, telefone 000…, e quem já tem CNPJ irregular na Receita.
 *
 * Entrega: HSM 48 coringa (AIVA_REATIVACAO_TEMPLATE_ID). Quem responde cai na
 * VictorIA, que retoma a coleta de onde parou (lib/claude.ts).
 *
 * Regras/textos: lib/retomada-interessado-calc.ts (`npm run test:retomada`).
 * Params: ?dry · ?max=N (teto de envios, padrão 60)
 * Schedule (vercel.json): `0 16 * * 1-5` UTC = 13h BRT, seg–sex. GET obrigatório.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { nomeSaudacao } from '@/lib/text'
import { flag } from '@/lib/req-flags'
import { decidir, lerMarcadores, remontarObs, miolo, MAX_TOQUES, SILENCIO_DIAS } from '@/lib/retomada-interessado-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const TETO_TEMPO_MS = 240_000
const DIA_MS = 24 * 60 * 60 * 1000

type Lead = { id: string; nome: string | null; telefone: string; observacoes: string | null }

async function executar(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!TEMPLATE_ID) return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })

  const url = new URL(req.url)
  const dry = flag(url.searchParams, 'dry')
  const max = Math.min(Number(url.searchParams.get('max')) || 60, 150)
  const agora = Date.now()

  // 1) todos os INTERESSADO (paginado — o PostgREST corta em 1.000 e são ~1.500)
  const todos: Lead[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin
      .from('sdr_leads')
      .select('id, nome, telefone, observacoes')
      .eq('produto', 'AIVA')
      .eq('status', 'INTERESSADO')
      .eq('acionar_humano', false)
      .not('nome', 'ilike', '%teste%')
      .order('criado_em', { ascending: true })
      .range(de, de + 999)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    todos.push(...((data ?? []) as Lead[]))
    if (!data || data.length < 1000) break
  }
  const elegiveis = todos.filter((l) =>
    !(l.observacoes ?? '').includes('[IMPORTADO_PORTAL') &&
    !(l.observacoes ?? '').includes('[CNPJ_IRREGULAR_AIVA:') &&
    !l.telefone.startsWith('000'))

  // 2) silêncio do LOJISTA: última mensagem direcao='in' de cada lead
  const ultimaIn = new Map<string, number>()
  for (let i = 0; i < elegiveis.length; i += 200) {
    const ids = elegiveis.slice(i, i + 200).map((l) => l.id)
    const { data } = await supabaseAdmin
      .from('sdr_mensagens').select('lead_id, enviado_em')
      .in('lead_id', ids).eq('direcao', 'in')
      .order('enviado_em', { ascending: false })
    for (const m of data ?? []) {
      const t = Date.parse(m.enviado_em)
      if (!ultimaIn.has(m.lead_id) || t > (ultimaIn.get(m.lead_id) as number)) ultimaIn.set(m.lead_id, t)
    }
  }

  // 3) decisão
  const enviar: Array<{ lead: Lead; toque: number; temDados: boolean; dias: number }> = []
  const encerrar: Lead[] = []
  const nada: Record<string, number> = {}
  for (const l of elegiveis) {
    const ult = ultimaIn.get(l.id)
    // Nunca mandou mensagem nenhuma (5 casos em 18/09: viraram INTERESSADO por
    // reengajamento ou mudança manual de status). O texto da retomada diz "a
    // gente conversou" / "paramos no meio" — com quem nunca respondeu isso é
    // mentira. Fica de fora; se for pra falar com eles, é outra abordagem.
    if (!ult) { nada.nunca_falou = (nada.nunca_falou ?? 0) + 1; continue }
    const dias = Math.floor((agora - ult) / DIA_MS)
    const d = decidir(lerMarcadores(l.observacoes, agora), dias, agora)
    if (d.acao === 'enviar') enviar.push({ lead: l, toque: d.toque, temDados: (l.observacoes ?? '').includes('[DADOS_COLETADOS:'), dias })
    else if (d.acao === 'encerrar') encerrar.push(l)
    else nada[d.motivo] = (nada[d.motivo] ?? 0) + 1
  }
  // mais frio primeiro: quem está em silêncio há mais tempo esfria mais rápido
  enviar.sort((a, b) => b.dias - a.dias)
  const fila = enviar.slice(0, max)

  const resumo = {
    interessados: todos.length,
    elegiveis: elegiveis.length,
    silencio_minimo_dias: SILENCIO_DIAS,
    enviar: enviar.length,
    encerrar: encerrar.length,
    com_dados: enviar.filter((f) => f.temDados).length,
    nada,
  }
  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, ...resumo,
      exemplo_com_dados: (() => { const f = fila.find((x) => x.temDados); return f ? `Oi ${nomeSaudacao(f.lead.nome, f.lead.observacoes)}, tudo bem?\n${miolo(f.toque, true)} É só responder essa mensagem. 😊` : null })(),
      exemplo_sem_dados: (() => { const f = fila.find((x) => !x.temDados); return f ? `Oi ${nomeSaudacao(f.lead.nome, f.lead.observacoes)}, tudo bem?\n${miolo(f.toque, false)} É só responder essa mensagem. 😊` : null })(),
      destinatarios: fila.slice(0, 20).map((f) => ({ loja: f.lead.nome, telefone: f.lead.telefone, toque: f.toque, silencio_dias: f.dias, tem_dados: f.temDados })),
    })
  }

  const inicio = Date.now()
  let enviados = 0
  const falhas: string[] = []
  for (const { lead, toque, temDados } of fila) {
    if (Date.now() - inicio > TETO_TEMPO_MS) break
    const nome = nomeSaudacao(lead.nome, lead.observacoes)
    const texto = miolo(toque, temDados)
    try {
      await sendTemplate(lead.telefone, TEMPLATE_ID, [nome, texto])
      await supabaseAdmin.from('sdr_mensagens').insert({
        lead_id: lead.id, direcao: 'out',
        conteudo: `Oi ${nome}, tudo bem?\n${texto} É só responder essa mensagem. 😊`,
        template_hsm: 'aiva_reativacao_48h',
      })
      const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
      await supabaseAdmin.from('sdr_leads')
        .update({ observacoes: remontarObs(fresco?.observacoes ?? lead.observacoes, { toque }), data_ultimo_contato: new Date().toISOString() })
        .eq('id', lead.id)
      enviados++
      console.log(`[retomada-interessado] ✅ ${lead.nome} (${lead.telefone}) — toque ${toque}/${MAX_TOQUES}${temDados ? ' (tem dados)' : ''}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      falhas.push(`${lead.telefone}: ${msg}`)
      console.error(`[retomada-interessado] ❌ ${lead.nome}:`, msg)
    }
    await new Promise((r) => setTimeout(r, 1200))
  }

  // encerra quem já levou os 2 toques — some da régua, sem avisar ninguém:
  // o volume aqui é alto demais pra virar fila humana. Fica no marcador.
  for (const l of encerrar) {
    const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', l.id).maybeSingle()
    await supabaseAdmin.from('sdr_leads')
      .update({ observacoes: remontarObs(fresco?.observacoes ?? l.observacoes, { encerrar: true }) }).eq('id', l.id)
  }

  console.log(`[retomada-interessado] elegiveis=${elegiveis.length} enviados=${enviados} encerrados=${encerrar.length} falhas=${falhas.length}`)
  return NextResponse.json({ ok: true, ...resumo, enviados, sobraram: enviar.length - enviados, falhas })
}

export const GET = executar
export const POST = executar
