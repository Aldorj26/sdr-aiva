/**
 * Cron diário (6h BRT) — coleta o Portal Parceiros AIVA e rederiva o desempenho.
 *
 * Fluxo: login → partner → busca (mês corrente + anterior; ?tudo=1 ou tabela
 * vazia = todos os meses) → validação → grava aiva_portal_diario (data_ref =
 * ontem) → rederiva mensal → (segunda) rederiva a semana fechada → ativação.
 *
 * Reprocesso na mão: ?mes=YYYY-MM | ?semana=YYYY-MM-DD (segunda) | ?dry=1.
 * Falha = WhatsApp pro Aldo + HTTP 500 (aparece no log do Vercel). Sucesso é
 * silencioso — o painel mostra a data do retrato.
 *
 * GET obrigatório: o cron do Vercel chama por GET (rota sem GET = 405 silencioso).
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  loginPortal, partnerIdTrack, buscarPerformance, paraLinhaDiaria, gravarDiario,
  salvarMensal, salvarSemanal, ativarLojasPresentes, avisarAldo, hojeBrt,
} from '@/lib/portal-aiva'
import { mesDe, somarDias } from '@/lib/portal-aiva-derivar'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const sp = req.nextUrl.searchParams
  // Validação dos parâmetros manuais antes de usar — evita passar lixo pro
  // Postgres/derivador (ex.: ?mes=lixo) e só descobrir no meio da execução
  // (revisão de código 09/09).
  const mesParam = sp.get('mes')
  if (mesParam && !/^\d{4}-\d{2}$/.test(mesParam)) {
    return NextResponse.json({ ok: false, error: 'parâmetro inválido' }, { status: 400 })
  }
  const semanaParam = sp.get('semana')
  if (semanaParam && !/^\d{4}-\d{2}-\d{2}$/.test(semanaParam)) {
    return NextResponse.json({ ok: false, error: 'parâmetro inválido' }, { status: 400 })
  }
  const dry = sp.get('dry') === '1'
  const hoje = hojeBrt()
  const ontem = somarDias(hoje, -1)
  const log: string[] = []

  try {
    // Só rederivar (sem coletar): ?mes= / ?semana= sem ?coletar=1
    if ((mesParam || semanaParam) && sp.get('coletar') !== '1') {
      const out: Record<string, unknown> = {}
      if (mesParam) out.mensal = await salvarMensal(mesParam, hoje)
      if (semanaParam) out.semanal = await salvarSemanal(semanaParam)
      return NextResponse.json({ ok: true, ...out })
    }

    const sessao = await loginPortal()
    const partner = await partnerIdTrack(sessao)
    const { count } = await supabaseAdmin.from('aiva_portal_diario').select('*', { count: 'exact', head: true })
    const tudo = sp.get('tudo') === '1' || !count
    const mesAnt = mesDe(somarDias(mesDe(hoje), -1))
    const brutas = await buscarPerformance(sessao, partner, tudo ? null : mesAnt)
    const linhas = brutas.map((b) => paraLinhaDiaria(b, ontem))
    log.push(`portal: ${linhas.length} linhas (${tudo ? 'todos os meses' : `desde ${mesAnt}`}), chaves: ${Object.keys(brutas[0] ?? {}).join(',')}`)

    // Validação: zero linhas, ou mês corrente com menos de 70% das lojas do retrato anterior = base truncada
    if (!linhas.length) throw new Error('portal devolveu zero linhas')
    const mesAtual = mesDe(hoje)
    const lojasHoje = linhas.filter((l) => l.mes === mesAtual).length
    const { data: antRows } = await supabaseAdmin.from('aiva_portal_diario').select('retailer_id').eq('mes', mesAtual).eq('data_ref', somarDias(ontem, -1))
    const lojasAnt = antRows?.length ?? 0
    if (lojasAnt > 0 && lojasHoje < 0.7 * lojasAnt) throw new Error(`base truncada: ${lojasHoje} lojas hoje vs ${lojasAnt} ontem no mês ${mesAtual}`)

    const totais = (mes: string) => {
      const m = linhas.filter((l) => l.mes === mes)
      return { mes, lojas: m.length, consultas: m.reduce((s, l) => s + l.consultas, 0), aprovados: m.reduce((s, l) => s + l.aprovados, 0), vendas: m.reduce((s, l) => s + l.vendas, 0), valor: Number(m.reduce((s, l) => s + l.valor_vendas, 0).toFixed(2)) }
    }
    if (dry) {
      // Dry-run mostra também o que ativaria (sem gravar/enviar) — ativarLojasPresentes
      // com dry=true só lê e devolve as linhas do digest (lib/portal-aiva.ts).
      const ativacoes_previstas = await ativarLojasPresentes(linhas.filter((l) => l.mes === mesAtual), true)
      return NextResponse.json({ ok: true, dry: true, data_ref: ontem, log, totais: [...new Set(linhas.map((l) => l.mes))].sort().map(totais), ativacoes_previstas })
    }

    await gravarDiario(linhas, brutas)
    log.push(`gravado data_ref=${ontem}`)

    const meses = tudo ? [...new Set(linhas.map((l) => l.mes))].sort() : [mesAnt, mesAtual]
    const mensal: unknown[] = []
    for (const m of meses) mensal.push(await salvarMensal(m.slice(0, 7), hoje))

    let semanal: unknown = null
    const diaSemana = new Date(hoje + 'T12:00:00Z').getUTCDay()
    if (diaSemana === 1 && !tudo) {
      const r = await salvarSemanal(somarDias(hoje, -7))
      if (r.avisos.length) log.push(...r.avisos.map((a) => `semana: ${a}`))
      semanal = r
    }

    const ativacoes = await ativarLojasPresentes(linhas.filter((l) => l.mes === mesAtual), false)
    return NextResponse.json({ ok: true, data_ref: ontem, log, mensal, semanal, ativacoes })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[portal-aiva]', msg, log)
    if (!dry) await avisarAldo(`⚠️ Coleta do portal AIVA falhou (${hoje}): ${msg}. Nada foi gravado hoje — o /desempenho segue com o retrato anterior.`)
    return NextResponse.json({ ok: false, error: msg, log }, { status: 500 })
  }
}
