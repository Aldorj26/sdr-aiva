/**
 * Lojas em "Primeiro acesso" — entraram na plataforma da AIVA e ainda não venderam (Aldo 08/10/2026).
 *
 * Na virada de 07/10 (funil 15 = quadro da AIVA) 38 lojas saíram da 51 pra 71/99 em silêncio. Com isso:
 *   - quase ninguém recebeu o aviso da etapa 99 (a virada foi silenciosa — 1 aviso enviado);
 *   - as dicas de desempenho e o check da 1ª venda só olhavam LOJA_FINALIZADA_E_VENDENDO, e elas pararam
 *     de receber incentivo justamente na janela de ativação.
 * Agora as duas rotinas também pegam lead LOGIN cujo CNPJ já teve primeiro acesso no portal, e a rodada das
 * dicas manda o aviso da 99 (uma vez por loja) a quem ainda não recebeu.
 */
import { listarOnboardingsApi } from '@/lib/portal-aiva'

export const ROTULO_PRIMEIRO_ACESSO = 'aiva_primeiro_acesso'
export const MIOLO_PRIMEIRO_ACESSO = 'vi que você já entrou na plataforma da AIVA 🎉 Agora a dica de ouro: consulte o CPF de todo cliente que pedir preço, até de quem diz que vai pagar à vista — a resposta sai em uns 2 minutos e muita gente acaba parcelando. Qualquer dúvida no sistema, me chama aqui!'

/** CNPJs (só dígitos) que já entraram na plataforma — primeiro acesso registrado ou coluna depois dele. */
export async function cnpjsComPrimeiroAcesso(): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    for (const o of await listarOnboardingsApi()) {
      const r = o as unknown as { cnpj?: unknown; primeiro_acesso_em?: unknown; board_column?: unknown }
      if (r.primeiro_acesso_em || r.board_column === 'primeiro_acesso' || r.board_column === 'primeira_venda') {
        const c = String(r.cnpj ?? '').replace(/\D/g, '')
        if (c.length === 14) out.add(c)
      }
    }
  } catch (e) {
    // portal fora: as rotinas seguem só com LOJA_FINALIZADA_E_VENDENDO, como antes
    console.error('[primeiro-acesso] API de onboardings falhou:', e)
  }
  return out
}
