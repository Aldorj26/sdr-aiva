/**
 * app/api/disparos/acao/route.ts — os três botões da página `/disparos` (15/10/2026, Aldo).
 *
 * Por que existe: o disparo D+0 só se destravava por `/retomar` no WhatsApp da VictorIA, e em
 * 14/10/2026 ficou pausado o dia inteiro porque o corretor do celular trocou o comando por
 * "/retornar" — a mensagem nunca chegou. Pelo navegador do celular (em viagem, inclusive) o
 * Aldo abre a página e toca no botão.
 *
 * Protegida pelo cookie do painel (`dash_auth`), via middleware — a rota PRECISA estar no matcher.
 *
 * `disparar` = destrava a pausa (se houver) e roda UM lote na hora, com `lock: 'manual'` (fatia
 * própria: não espera o cron, e o segundo toque no mesmo minuto não manda de novo). O resto dos 500
 * continua saindo pelo cron de 5 em 5 min — o botão destrava e prova que está saindo. Teto do dia,
 * janela de dia útil 8h–19h e a pausa automática por entrega baixa seguem valendo: quem decide é a
 * mesma `rodada()` do cron.
 */
import { NextRequest, NextResponse } from 'next/server'
import { lerEstado, pausar, retomar, rodada } from '@/lib/disparo-diario'
import { textoBotaoDisparo, MOTIVO_PAUSA_PAINEL } from '@/lib/disparo-diario-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Um lote de 5 leva 50–75 s (10–13 s por loja, medido em produção em 01–09/10/2026). 180 s dá folga
 *  pro lote e ainda deixa a resposta chegar; o cliente desiste antes (90 s) e a rodada segue no servidor. */
export const maxDuration = 180

/** Um lote só. O botão é destrave + prova de vida, não o disparo do dia: o cron faz o volume. */
const LOTE_MANUAL = 5

export async function POST(req: NextRequest) {
  let body: { acao?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 })
  }
  const acao = String(body.acao ?? '')

  try {
    if (acao === 'pausar') {
      const antes = await lerEstado()
      if (antes.pausado) return NextResponse.json({ ok: true, acao, info: 'Já estava pausado.' })
      await pausar(MOTIVO_PAUSA_PAINEL)
      console.log('[disparos] pausado pelo painel')
      return NextResponse.json({ ok: true, acao, info: 'Disparo pausado. Nada sai até você tocar em Retomar.' })
    }

    if (acao === 'retomar') {
      const destravou = await retomar('painel')
      console.log(`[disparos] retomar pelo painel: ${destravou ? 'destravou' : 'já estava ativo'}`)
      return NextResponse.json({ ok: true, acao, info: destravou ? 'Disparo retomado. O cron volta a mandar em até 5 min.' : 'Já estava ativo.' })
    }

    if (acao === 'disparar') {
      const antes = await lerEstado()
      // Destrava ANTES: a `rodada()` lê o estado do banco e uma pausa de pé a faria devolver "nada".
      const destravou = antes.pausado ? await retomar('painel') : false
      const r = await rodada({ qtd: LOTE_MANUAL, lock: 'manual' })
      const info = textoBotaoDisparo({ acao: r.acao, motivo: r.motivo, enviados: r.enviados, falhas: r.falhas, saiuHoje: r.saiu_hoje }, destravou)
      console.log(`[disparos] disparar pelo painel: ${info}`)
      return NextResponse.json({ ok: true, acao, destravou, enviados: r.enviados, falhas: r.falhas, saiu_hoje: r.saiu_hoje, restante: r.restante, info })
    }

    return NextResponse.json({ error: 'acao_desconhecida' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[disparos] ${acao} falhou:`, msg)
    return NextResponse.json({ ok: false, error: msg, info: `Não consegui: ${msg}` }, { status: 500 })
  }
}
