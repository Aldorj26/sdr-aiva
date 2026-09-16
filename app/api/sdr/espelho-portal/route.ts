/**
 * Cron a cada 15 min — espelho Portal Parceiros AIVA → funil 15 do Evo.
 *
 * Lê a etapa real de cada onboarding no portal e AVANÇA o card do lead no Evo
 * (Em Análise → Treinar → Login → Vendendo) sem ninguém arrastar. Só avança,
 * nunca regride. Mover pela API dispara a automação do Evo, então os HSM e os
 * avisos de etapa saem pelos handlers de /api/sdr/opportunity-stage — esta
 * rota não fala com o lojista.
 *
 * Também marca em sdr_registros_cnpj o pré-cadastro como enviado quando o CNPJ
 * já aparece no portal, e avisa Nei + Aldo (uma vez) quando a AIVA reprova.
 *
 * ?dry=1 → só devolve o que faria. GET obrigatório (cron do Vercel chama GET).
 * Lógica: lib/espelho-portal.ts (IO) + lib/espelho-portal-calc.ts (regras, testado).
 */
import { NextRequest, NextResponse } from 'next/server'
import { executarEspelho } from '@/lib/espelho-portal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handler(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const dry = req.nextUrl.searchParams.get('dry') === '1'
  try {
    const saida = await executarEspelho(dry)
    console.log(`[espelho-portal] ${dry ? '[dry] ' : ''}onboardings=${saida.onboardings} leads=${saida.leads} movidos=${saida.movidos.length} sobraram=${saida.sobraram} reprovados=${saida.reprovados.length} registros=${saida.registros_enviados}`)
    return NextResponse.json(saida)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[espelho-portal] falhou:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
