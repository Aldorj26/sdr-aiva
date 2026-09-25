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
 * AGUARDANDO (23/09/2026, Aldo): entra na mesma régua, com orçamento PRÓPRIO
 * e teto de 90 dias de silêncio.
 *
 * VOLUME (23/09/2026): orçamento DIÁRIO (INTERESSADO 150, AGUARDANDO 30) gasto em
 * rodadas de hora em hora, 10h–16h BRT. Cada rodada conta o que já saiu hoje pelo
 * rótulo próprio e manda só o que sobrou, parando no teto de tempo. Motivo: o envio
 * real mede ~6 s (de 3 a 12 s), então cabem ~40 por rodada — uma rodada única de 90
 * já era cortada no meio. Detalhes em ORCAMENTO_DIA (calc). É pra lá que
 * o auto-descarte manda o INTERESSADO após 21 dias, e nenhuma automação olhava
 * pra etapa — eram 992 leads. Ver as justificativas em retomada-interessado-calc.
 * O nome da rota ficou "retomada-interessado" de propósito: trocar o path mata o
 * agendamento do vercel.json e o vigia, que chamam por esse caminho.
 *
 * Não toca: conversa viva (<7d), silêncio > 90d, acionar_humano, [PAUSA_ATE],
 * opt-out, importados do portal, telefone 000…, e quem já tem CNPJ irregular.
 *
 * Entrega: HSM 48 coringa (AIVA_REATIVACAO_TEMPLATE_ID). Quem responde cai na
 * VictorIA, que retoma a coleta de onde parou (lib/claude.ts).
 *
 * Regras/textos: lib/retomada-interessado-calc.ts (`npm run test:retomada`).
 * Params (só rodada MANUAL — o cron chama sem parâmetro): ?dry · ?max=N · ?max_aguardando=N
 *   Nunca passam do que sobrou no orçamento do dia. Pra desligar uma etapa: orçamento 0 no calc + deploy.
 * Schedule (vercel.json): `0 13-19 * * 1-5` UTC = de hora em hora, 10h–16h BRT, seg–sex. GET obrigatório.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { nomeSaudacao } from '@/lib/text'
import { flag } from '@/lib/req-flags'
import {
  decidir, lerMarcadores, remontarObs, miolo, montarFila, soRespostaAutomatica, saudacaoRetomada,
  MAX_TOQUES, SILENCIO_DIAS, SILENCIO_MAX_DIAS, STATUS_RETOMADA,
  ORCAMENTO_DIA, ROTULO, restanteHoje, diaBrt,
} from '@/lib/retomada-interessado-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const TETO_TEMPO_MS = 240_000
const DIA_MS = 24 * 60 * 60 * 1000

type Lead = { id: string; nome: string | null; telefone: string; observacoes: string | null; status: string }

async function executar(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!TEMPLATE_ID) return NextResponse.json({ ok: false, erro: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })

  const url = new URL(req.url)
  const dry = flag(url.searchParams, 'dry')
  const agora = Date.now()

  // Quanto a retomada JÁ mandou hoje, por etapa — pelo rótulo próprio. É isso que
  // permite rodar de hora em hora sem estourar o orçamento do dia: cada rodada
  // gasta só o que sobrou. Meia-noite de Brasília, não UTC.
  const inicioDia = `${diaBrt(agora)}T03:00:00.000Z`
  const jaHoje = async (rotulo: string) => {
    const { count } = await supabaseAdmin.from('sdr_mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('direcao', 'out').eq('template_hsm', rotulo).gte('enviado_em', inicioDia)
    return count ?? 0
  }
  const [hojeInt, hojeAg] = await Promise.all([jaHoje(ROTULO.INTERESSADO), jaHoje(ROTULO.AGUARDANDO)])
  // `?max=` / `?max_aguardando=` só valem pra rodada MANUAL (o cron chama sem
  // parâmetro) e nunca passam do que sobrou no dia
  const param = (k: string) => { const v = url.searchParams.get(k); return v === null ? null : Math.max(0, Number(v) || 0) }
  const restInt = restanteHoje(ORCAMENTO_DIA.INTERESSADO, hojeInt)
  const restAg = restanteHoje(ORCAMENTO_DIA.AGUARDANDO, hojeAg)
  const max = Math.min(param('max') ?? restInt, restInt)
  const maxAguardando = Math.min(param('max_aguardando') ?? restAg, restAg)

  // 1) INTERESSADO + AGUARDANDO (paginado — o PostgREST corta em 1.000 e são ~2.000)
  const todos: Lead[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin
      .from('sdr_leads')
      .select('id, nome, telefone, observacoes, status')
      .eq('produto', 'AIVA')
      .in('status', [...STATUS_RETOMADA])
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

  // 2) silêncio do LOJISTA: última mensagem direcao='in' de cada lead, e o que ele
  //    escreveu (pra separar quem só respondeu com a mensagem automática da loja).
  // ⚠️ Paginado desde 25/09: 200 leads por lote passavam fácil de 1.000 mensagens e
  // o PostgREST cortava calado — lead com histórico cortado virava `nunca_falou`.
  const ultimaIn = new Map<string, number>()
  const textosIn = new Map<string, string[]>()
  for (let i = 0; i < elegiveis.length; i += 200) {
    const ids = elegiveis.slice(i, i + 200).map((l) => l.id)
    for (let de = 0; ; de += 1000) {
      const { data, error } = await supabaseAdmin
        .from('sdr_mensagens').select('lead_id, enviado_em, conteudo')
        .in('lead_id', ids).eq('direcao', 'in')
        .order('enviado_em', { ascending: false })
        .range(de, de + 999)
      if (error) return NextResponse.json({ ok: false, erro: `sdr_mensagens: ${error.message}` }, { status: 500 })
      for (const m of data ?? []) {
        const t = Date.parse(m.enviado_em)
        if (!ultimaIn.has(m.lead_id) || t > (ultimaIn.get(m.lead_id) as number)) ultimaIn.set(m.lead_id, t)
        const lista = textosIn.get(m.lead_id) ?? []
        lista.push(m.conteudo ?? '')
        textosIn.set(m.lead_id, lista)
      }
      if (!data || data.length < 1000) break
    }
  }

  // 3) decisão
  const enviar: Array<{ lead: Lead; toque: number; temDados: boolean; dias: number; status: string }> = []
  const encerrar: Lead[] = []
  const nada: Record<string, number> = {}
  for (const l of elegiveis) {
    const ult = ultimaIn.get(l.id)
    // Nunca mandou mensagem nenhuma (5 casos em 18/09: viraram INTERESSADO por
    // reengajamento ou mudança manual de status). O texto da retomada diz "a
    // gente conversou" / "paramos no meio" — com quem nunca respondeu isso é
    // mentira. Fica de fora; se for pra falar com eles, é outra abordagem.
    if (!ult) { nada.nunca_falou = (nada.nunca_falou ?? 0) + 1; continue }
    const temDados = (l.observacoes ?? '').includes('[DADOS_COLETADOS:')
    // Só o robô da loja respondeu até hoje (25/09, Aldo): fica fora. Quem já deu
    // dados nunca cai aqui — passar dados é prova de que houve uma pessoa.
    if (!temDados && soRespostaAutomatica(textosIn.get(l.id) ?? [])) {
      nada.so_resposta_automatica = (nada.so_resposta_automatica ?? 0) + 1
      continue
    }
    const dias = Math.floor((agora - ult) / DIA_MS)
    const d = decidir(lerMarcadores(l.observacoes, agora), dias, agora)
    if (d.acao === 'enviar') enviar.push({ lead: l, toque: d.toque, temDados, dias, status: l.status })
    else if (d.acao === 'encerrar') encerrar.push(l)
    else nada[d.motivo] = (nada[d.motivo] ?? 0) + 1
  }
  // DOIS orçamentos: com fila única o AGUARDANDO nunca seria atendido, porque o
  // disparo gera INTERESSADO novo todo dia. Regras em montarFila (calc).
  const fila = montarFila(enviar, max, maxAguardando)
  const conta = (st: string) => enviar.filter((f) => f.status === st).length

  const resumo = {
    interessados: todos.length,
    elegiveis: elegiveis.length,
    silencio_minimo_dias: SILENCIO_DIAS,
    silencio_maximo_dias: SILENCIO_MAX_DIAS,
    enviar: enviar.length,
    por_status: {
      INTERESSADO: { elegiveis_hoje: conta('INTERESSADO'), orcamento_dia: ORCAMENTO_DIA.INTERESSADO, ja_enviados_hoje: hojeInt, nesta_rodada: max },
      AGUARDANDO: { elegiveis_hoje: conta('AGUARDANDO'), orcamento_dia: ORCAMENTO_DIA.AGUARDANDO, ja_enviados_hoje: hojeAg, nesta_rodada: maxAguardando },
    },
    na_fila_hoje: fila.length,
    encerrar: encerrar.length,
    com_dados: enviar.filter((f) => f.temDados).length,
    nada,
  }
  if (dry) {
    return NextResponse.json({
      ok: true, dry: true, ...resumo,
      exemplo_com_dados: (() => { const f = fila.find((x) => x.temDados); return f ? `Oi ${saudacaoRetomada(nomeSaudacao(f.lead.nome, f.lead.observacoes), f.lead.nome)}, tudo bem?\n${miolo(f.toque, true)} É só responder essa mensagem. 😊` : null })(),
      exemplo_sem_dados: (() => { const f = fila.find((x) => !x.temDados); return f ? `Oi ${saudacaoRetomada(nomeSaudacao(f.lead.nome, f.lead.observacoes), f.lead.nome)}, tudo bem?\n${miolo(f.toque, false)} É só responder essa mensagem. 😊` : null })(),
      saudacoes_de_sigla: fila.filter((f) => saudacaoRetomada(nomeSaudacao(f.lead.nome, f.lead.observacoes), f.lead.nome) !== nomeSaudacao(f.lead.nome, f.lead.observacoes)).slice(0, 10).map((f) => `${f.lead.nome} → Oi ${saudacaoRetomada(nomeSaudacao(f.lead.nome, f.lead.observacoes), f.lead.nome)}`),
      destinatarios: fila.slice(0, 20).map((f) => ({ loja: f.lead.nome, telefone: f.lead.telefone, status: f.status, toque: f.toque, silencio_dias: f.dias, tem_dados: f.temDados })),
      primeiros_aguardando: fila.filter((f) => f.status === 'AGUARDANDO').slice(0, 10).map((f) => ({ loja: f.lead.nome, silencio_dias: f.dias, tem_dados: f.temDados })),
    })
  }

  const inicio = Date.now()
  let enviados = 0
  const falhas: string[] = []
  const enviadosPorStatus: Record<string, number> = {}
  for (const { lead, toque, temDados, status } of fila) {
    if (Date.now() - inicio > TETO_TEMPO_MS) break
    const nome = saudacaoRetomada(nomeSaudacao(lead.nome, lead.observacoes), lead.nome)
    const texto = miolo(toque, temDados)
    try {
      await sendTemplate(lead.telefone, TEMPLATE_ID, [nome, texto])
      await supabaseAdmin.from('sdr_mensagens').insert({
        lead_id: lead.id, direcao: 'out',
        conteudo: `Oi ${nome}, tudo bem?\n${texto} É só responder essa mensagem. 😊`,
        template_hsm: ROTULO[status as 'INTERESSADO' | 'AGUARDANDO'] ?? ROTULO.INTERESSADO,
      })
      const { data: fresco } = await supabaseAdmin.from('sdr_leads').select('observacoes').eq('id', lead.id).maybeSingle()
      await supabaseAdmin.from('sdr_leads')
        .update({ observacoes: remontarObs(fresco?.observacoes ?? lead.observacoes, { toque }), data_ultimo_contato: new Date().toISOString() })
        .eq('id', lead.id)
      enviados++
      enviadosPorStatus[status] = (enviadosPorStatus[status] ?? 0) + 1
      console.log(`[retomada-interessado] ✅ [${status}] ${lead.nome} (${lead.telefone}) — toque ${toque}/${MAX_TOQUES}${temDados ? ' (tem dados)' : ''}`)
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
  // Parou pelo TEMPO com fila de hoje ainda pendente? Não é falha: a próxima
  // rodada (de hora em hora) continua de onde parou. Fica registrado pra quem
  // olhar o log não achar que foi erro.
  const cortadoPorTempo = enviados + falhas.length < fila.length
  if (cortadoPorTempo) console.log(`[retomada-interessado] teto de tempo: ${fila.length - enviados - falhas.length} ficam pra próxima rodada`)
  return NextResponse.json({ ok: true, ...resumo, enviados, enviados_por_status: enviadosPorStatus, cortado_por_tempo: cortadoPorTempo, sobraram: enviar.length - enviados, falhas })
}

export const GET = executar
export const POST = executar
