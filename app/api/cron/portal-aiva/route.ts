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
 * ⚠️ O HORÁRIO DO CRON É PARTE DA SEMÂNTICA (revisão 09/09). A linha do portal
 * é um contador VIVO do mês corrente (acumulado até agora), não um fechamento
 * de dia. Rotular o retrato com `data_ref = ontem` só é honesto porque a coleta
 * roda às 6h BRT, quando o movimento de hoje é praticamente zero — o número
 * lido é, na prática, o de ontem no fim do dia. Mover o agendamento pra mais
 * tarde muda o significado de TODA subtração semanal (a semana passaria a
 * incluir vendas de hoje sob o rótulo de ontem). Por isso o mês de referência
 * sai de `ontem` (mesDe(ontem)) e não de `hoje`: no dia 1º, o retrato ainda é
 * do mês passado, e keying por hoje derivava um mês sem nenhuma linha.
 *
 * GET obrigatório: o cron do Vercel chama por GET (rota sem GET = 405 silencioso).
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  loginPortal, partnerIdTrack, buscarPerformance, paraLinhaDiaria, gravarDiario,
  salvarMensal, salvarSemanal, ativarLojasPresentes, avisarAldo, hojeBrt,
  primeiraAparicao,
} from '@/lib/portal-aiva'
import { mesDe, somarDias } from '@/lib/portal-aiva-derivar'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// mesmo teto do /followup — a ativação sozinha já pode gastar boa parte dos 60s
// default (várias chamadas ao Evo por loja), fora scraping+gravação do portal (revisão final 09/09)
export const maxDuration = 300

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
      // ?dry=1 aqui é armadilha: este ramo APAGA e reinsere o mês/semana. Quem
      // digita dry espera prévia, não escrita — recusar é mais honesto do que
      // ignorar o parâmetro (revisão 09/09).
      if (dry) return NextResponse.json({ ok: false, error: 'dry não se aplica a ?mes/?semana' }, { status: 400 })
      const out: Record<string, unknown> = {}
      if (mesParam) out.mensal = await salvarMensal(mesParam, hoje)
      if (semanaParam) out.semanal = await salvarSemanal(semanaParam)
      return NextResponse.json({ ok: true, ...out })
    }

    const sessao = await loginPortal()
    const partner = await partnerIdTrack(sessao)
    const { count, error: eCount } = await supabaseAdmin.from('aiva_portal_diario').select('*', { count: 'exact', head: true })
    // erro na contagem virava `count = null` → tudo = true → coleta e rederiva
    // TODOS os meses sem ninguém pedir (revisão 09/09).
    if (eCount) throw new Error(`contar aiva_portal_diario: ${eCount.message}`)
    const tudo = sp.get('tudo') === '1' || !count
    // Mês do RETRATO (ontem), não de hoje — ver cabeçalho do arquivo.
    const mesAtual = mesDe(ontem)
    const mesAnt = mesDe(somarDias(mesAtual, -1))
    const brutas = await buscarPerformance(sessao, partner, tudo ? null : mesAnt)
    const linhas = brutas.map((b) => paraLinhaDiaria(b, ontem))
    log.push(`portal: ${linhas.length} linhas (${tudo ? 'todos os meses' : `desde ${mesAnt}`})`)

    // Validação: zero linhas, ou mês corrente com menos de 70% das lojas do retrato anterior = base truncada
    if (!linhas.length) throw new Error('portal devolveu zero linhas')
    const lojasHoje = linhas.filter((l) => l.mes === mesAtual).length
    const { data: antRows } = await supabaseAdmin.from('aiva_portal_diario').select('retailer_id').eq('mes', mesAtual).eq('data_ref', somarDias(ontem, -1))
    const lojasAnt = antRows?.length ?? 0
    if (lojasAnt > 0 && lojasHoje < 0.7 * lojasAnt) throw new Error(`base truncada: ${lojasHoje} lojas hoje vs ${lojasAnt} ontem no mês ${mesAtual}`)

    const totais = (mes: string) => {
      const m = linhas.filter((l) => l.mes === mes)
      return { mes, lojas: m.length, consultas: m.reduce((s, l) => s + l.consultas, 0), aprovados: m.reduce((s, l) => s + l.aprovados, 0), vendas: m.reduce((s, l) => s + l.vendas, 0), valor: Number(m.reduce((s, l) => s + l.valor_vendas, 0).toFixed(2)) }
    }
    const mesesDoRetrato = [...new Set(linhas.map((l) => l.mes))].sort()
    if (dry) {
      // chaves cruas do portal: ajuda pontual de depuração (o portal muda coluna
      // sem avisar) — fica só no dry, não polui o log do cron (revisão 09/09).
      log.push(`chaves: ${Object.keys(brutas[0] ?? {}).join(',')}`)
      // Dry-run mostra também o que ativaria (sem gravar/enviar) — ativarLojasPresentes
      // com dry=true só lê e devolve as linhas do digest (lib/portal-aiva.ts).
      const ativacoes_previstas = await ativarLojasPresentes(linhas.filter((l) => l.mes === mesAtual), true)
      return NextResponse.json({ ok: true, dry: true, data_ref: ontem, log, totais: mesesDoRetrato.map(totais), ativacoes_previstas })
    }

    await gravarDiario(linhas, brutas)
    log.push(`gravado data_ref=${ontem}`)

    // Só rederiva mês que EXISTE no retrato: no dia 1º o portal ainda não tem
    // linha do mês novo e o salvarMensal estourava ("sem retrato do portal"),
    // derrubando toda a rodada depois de já ter gravado o diário (revisão 09/09).
    // O throw continua valendo pro reprocesso explícito ?mes= — lá o mês vazio
    // é erro de verdade, alguém pediu aquele mês.
    const pedidos = tudo ? mesesDoRetrato : [mesAnt, mesAtual]
    const meses = pedidos.filter((m) => linhas.some((l) => l.mes === m))
    for (const m of pedidos.filter((m) => !meses.includes(m))) log.push(`mensal ${m.slice(0, 7)}: sem linhas no retrato — pulado`)
    // primeiraAparicao é um agregado da tabela inteira e não muda entre os
    // meses do laço: calcular uma vez só (revisão 09/09).
    const primeira = meses.length ? await primeiraAparicao() : new Map<string, string>()
    const mensal: unknown[] = []
    for (const m of meses) mensal.push(await salvarMensal(m.slice(0, 7), hoje, primeira))

    let semanal: unknown = null
    const diaSemana = new Date(hoje + 'T12:00:00Z').getUTCDay()
    if (diaSemana === 1 && !tudo) {
      const r = await salvarSemanal(somarDias(hoje, -7))
      if (r.avisos.length) log.push(...r.avisos.map((a) => `semana: ${a}`))
      semanal = r
    } else if (diaSemana === 1) {
      // ?tudo=1 numa segunda não fecha a semana (o retrato de hoje não tem os
      // dias anteriores) — avisar, senão a semana some sem ninguém notar.
      log.push(`semana: fechamento de ${somarDias(hoje, -7)} PULADO por ?tudo=1 — rodar com ?semana=${somarDias(hoje, -7)}`)
    }

    // Coleta e derivações já estão gravadas; ativação é passo independente e
    // repetível amanhã. Deixar a exceção subir jogaria 500 e WhatsApp de falha
    // numa rodada que, no essencial, deu certo (revisão 09/09).
    let ativacoes: string[] | null = null
    try {
      ativacoes = await ativarLojasPresentes(linhas.filter((l) => l.mes === mesAtual), false)
    } catch (e) {
      log.push(`ativação falhou: ${e instanceof Error ? e.message : String(e)}`)
    }
    return NextResponse.json({ ok: true, data_ref: ontem, log, mensal, semanal, ativacoes })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[portal-aiva]', msg, log)
    // "Nada foi gravado" era mentira quando a falha vinha depois do diário —
    // o aviso agora lista o que já concluiu (revisão 09/09).
    if (!dry) {
      await avisarAldo(`⚠️ Coleta do portal AIVA falhou (${hoje}): ${msg}.` +
        (log.length ? ` Etapas concluídas: ${log.join(' | ')}` : ' Nada foi gravado.'))
    }
    return NextResponse.json({ ok: false, error: msg, log }, { status: 500 })
  }
}
