import { NextResponse } from 'next/server'

/**
 * retomada-cadastro/route.ts — ⛔ DESATIVADA EM 16/10/2026 (Aldo), com o fim da FASE 3.
 *
 * O que ela era: uma correção pontual de 19/06/2026. Quinze leads no stage 49 com a Fase 3
 * incompleta tinham ouvido da VictorIA "seu cadastro está completo" por causa de um bug de
 * mapeamento stage→status. A rota disparava um HSM de reativação com o miolo "ainda faltam só
 * alguns dados rápidos… posso começar?", reabrindo a janela e a coleta.
 *
 * Por que morreu: não existe mais coleta para retomar. Desde 16/10/2026 o stage 49 significa
 * cadastro completo e a VictorIA está proibida de pedir e-mail, nº de lojas e CNPJs adicionais —
 * quem pede o que falta é a AIVA, no formulário do varejo. A rota não tinha cron, mas seguia
 * chamável à mão: rodá-la hoje mandaria 15 lojistas responderem a uma pergunta que a VictorIA
 * não faria, e a conversa morreria no vácuo.
 *
 * O corpo antigo (lista de OPP_IDS, miolo do template e o laço de envio) está no histórico do
 * git, se algum dia servir de molde para outra correção pontual.
 */
const DESATIVADA = {
  ok: false,
  erro: 'rota_desativada',
  motivo: 'A FASE 3 acabou em 16/10/2026: não existe mais coleta para retomar. Ver prompts/aiva.ts.',
} as const

export async function GET() {
  return NextResponse.json(DESATIVADA, { status: 410 })
}

export async function POST() {
  return NextResponse.json(DESATIVADA, { status: 410 })
}
