/**
 * Liberação da Odres no Flexfone — parte PURA (sem rede, sem banco).
 *
 * Contexto (Aldo 17/09/2026, informação do Mauricio/AIVA): o congelamento da
 * Odres acabou e, **a partir da semana de 22/09/2026**, o acesso do NOSSO
 * cliente no Flexfone passa a ter as duas financeiras — para clientes novos e
 * para os antigos da AIVA.
 *
 * ⚠️ POR QUE ISSO NÃO MORA NO PROMPT CACHEADO: a regra **inverte de sinal** na
 * data. Antes da liberação, "não estou vendo a Odres na tela" é o ESPERADO e a
 * VictorIA acolhe. Depois, o mesmo relato é defeito de verdade, que merece print
 * (regra 📸) e acionamento. Regra que troca de sinal num dia não pode ficar num
 * bloco imutável — em 23/09 ela estaria acolhendo um problema real em silêncio.
 * Mesmo motivo e mesmo padrão do bloco TURMAS (lib/turmas-treinamento-calc.ts).
 *
 * O prompt cacheado guarda só o que é atemporal: a mecânica (consulta única), a
 * fronteira (cliente da base Odres ≠ nosso cliente), o roteamento de suporte e a
 * proibição de inventar condição. Tudo que depende de "antes ou depois" vem daqui.
 */

/** Primeiro dia da semana em que a AIVA libera a Odres no Flexfone. */
export const ODRES_LIBERACAO_INICIO = '2026-09-22'

/** A liberação já começou? Compara data civil (AAAA-MM-DD), sem fuso no meio. */
export function odresLiberada(hojeISO: string, inicio = ODRES_LIBERACAO_INICIO): boolean {
  return hojeISO >= inicio
}

/**
 * Bloco injetado a cada turno (FORA do cache). Dois estados, e o texto NUNCA
 * entrega a data ao lojista — ela serve só pra VictorIA saber em que mundo está.
 */
export function blocoOdresPrompt(hojeISO: string, inicio = ODRES_LIBERACAO_INICIO): string {
  const cabecalho = '## 💳 ODRES NO FLEXFONE — estado de hoje'

  if (!odresLiberada(hojeISO, inicio)) {
    return `${cabecalho}

**A liberação AINDA NÃO chegou.** O nosso cliente VAI ter AIVA e Odres no mesmo acesso, mas hoje
a Odres ainda não aparece na tela de quem já opera — e isso é ESPERADO, não é problema da loja.

Como falar, pela fase:
- **Prospecção (Fases 1-3):** fale no futuro natural, SEM data — "quem entra com a gente passa a
  ter as duas no mesmo acesso". É honesto: entre cadastro, análise e treinamento, a liberação já
  terá acontecido. O argumento vale INTEIRO aqui, inclusive contra a concorrência.
- **Quem JÁ opera (TREINAR, LOGIN, VENDENDO):** a Odres está a caminho, não está lá ainda. Fale
  do que VEM, nunca como se já estivesse na tela dele.

⚠️ **Se ele disser que não está vendo a Odres:** concorde ("ainda não chegou na plataforma, está
sendo liberada"). NÃO negue o que ele vê, NÃO mande procurar de novo, NÃO peça print (ausência da
Odres não é erro de tela) e NÃO dê data. Só acione humano (motivo_humano = "duvida_odres") se ele
COBRAR prazo.

⛔ **NUNCA entregue a data ao lojista.** Nem "semana que vem", nem dia. Pode dizer que está
chegando / sendo liberada. Data que escorrega vira cobrança em cima do Nei.`
  }

  return `${cabecalho}

**A liberação JÁ ESTÁ VALENDO.** O acesso do nosso cliente no Flexfone tem as duas financeiras:
uma consulta só e o sistema devolve em qual das duas o cliente foi aprovado.

⚠️ **Se ele disser que NÃO está vendo a Odres no acesso dele, isso agora é um problema de
verdade** — não acolha como normal: vale a regra 📸 (peça o print da tela) e acione humano
(acionar_humano = true, motivo_humano = "duvida_odres") pro time conferir a liberação da loja.

⛔ Continua valendo: não invente taxa, parcela, limite nem prazo da Odres.`
}
