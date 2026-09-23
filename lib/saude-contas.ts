/**
 * lib/saude-contas.ts — a sonda que pergunta "a conta ainda paga?" (IO).
 * A decisão e os textos ficam em saude-contas-calc.ts.
 *
 * ⚠️ Por que é uma CHAMADA DE VERDADE e não uma leitura de saldo: a Anthropic
 * **não tem endpoint de saldo restante** (o Console mostra, a API não). Então a
 * única forma honesta de saber se a conta paga é pedir a coisa mais barata
 * possível e ver se ela vem. Custa ~US$ 0,00003 por checagem.
 *
 * O lado da META é diferente e já está resolvido em outro lugar: lá a falha de
 * cobrança não volta como erro — a Evo responde "success" e a mensagem
 * simplesmente não chega. Quem detecta isso é o recibo `clientrcvtime`
 * (lib/entrega-meta.ts), já ligado no mesmo vigia. Ler o saldo da Meta pela
 * Graph API exigiria um token de anúncios que a operação não tem hoje; quando
 * tiver, o lugar de plugar é aqui.
 */
import Anthropic from '@anthropic-ai/sdk'
import { classificarFalha, type TipoFalha } from './saude-contas-calc'

export type SondaConta = {
  conta: 'anthropic'
  ok: boolean
  tipo: TipoFalha | null
  detalhe: string | null
  ms: number
}

export async function sondarAnthropic(): Promise<SondaConta> {
  const t0 = Date.now()
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 })
    await client.messages.create({
      // o modelo mais barato e 1 token de saída: a pergunta é "a conta paga?",
      // não "o modelo pensa bem"
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    })
    return { conta: 'anthropic', ok: true, tipo: null, detalhe: null, ms: Date.now() - t0 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { conta: 'anthropic', ok: false, tipo: classificarFalha(msg), detalhe: msg.slice(0, 200), ms: Date.now() - t0 }
  }
}
