/**
 * Black November da AIVA/Flexfone (Aldo 09/11/2026) — regras puras, sem IO.
 *
 * Em NOVEMBRO/2026 a comissão do VENDEDOR por venda sobe de R$ 10 pra até R$ 50 e vale pra TODAS as lojas do canal
 * (Inside Sales/Track), não só no primeiro mês da loja: R$ 20 garantidos (pagos no início de dezembro, por venda de
 * 1 a 30/11) + R$ 30 de bônus (1ª semana de janeiro, condicionado à inadimplência positiva da carteira da PRÓPRIA loja).
 * Quem não tinha campanha passa a ter esta; quem tinha os R$ 10 (1º mês) passa a ter esta. Em 01/12 volta a regra
 * normal dos R$ 10 no primeiro mês (lib/desempenho-loja-calc.ts → comissaoVendedor).
 *
 * Comunicado único às lojas da etapa 50 em diante (funil 15): dois textos — loja já criada × cadastro ainda pendente.
 * Testes: `npm run test:black`.
 */

export const BLACK_NOVEMBER = {
  inicio: '2026-11-01',
  fim: '2026-11-30',
  garantido: 20,
  bonus: 30,
  normal: 10,
  /** arte da Flexfone servida pelo próprio projeto (public/) — vai como link porque template não leva imagem */
  arte: 'https://sdr-aiva.vercel.app/black-november-flexfone.webp',
} as const

/** `hoje` = data civil BRT (YYYY-MM-DD). */
export const blackNovemberAtivo = (hoje: string): boolean => hoje >= BLACK_NOVEMBER.inicio && hoje <= BLACK_NOVEMBER.fim

/** Linha 💰 do bloco NÚMEROS DA LOJA enquanto a campanha vale — substitui a linha dos R$ 10 do 1º mês. */
export function linhaComissaoBlackNovember(): string {
  return `💰 Comissão ao VENDEDOR — BLACK NOVEMBER (01 a 30/11/2026, vale pra TODA loja do canal, independe do primeiro mês): ` +
    `R$ ${BLACK_NOVEMBER.garantido} garantidos por venda feita em novembro (pagos no início de dezembro) + R$ ${BLACK_NOVEMBER.bonus} de bônus por venda ` +
    `(pagos na 1ª semana de janeiro, SÓ se a inadimplência da carteira da PRÓPRIA loja vier positiva) = até R$ ${BLACK_NOVEMBER.garantido + BLACK_NOVEMBER.bonus} por venda. ` +
    `Pagamento ao vendedor via Pix CPF, como sempre. Use como munição. ⛔ Não diga "R$ 50 garantidos" (os R$ ${BLACK_NOVEMBER.bonus} dependem da inadimplência) nem que vale depois de 30/11: ` +
    `em dezembro volta a regra normal (R$ ${BLACK_NOVEMBER.normal} por venda só no primeiro mês da loja). Se ele cobrar comissão não paga ou discutir a inadimplência → acionar_humano = true, motivo_humano = "duvida_comissao_vendedor".`
}

export type GrupoComunicado = 'vendendo' | 'cadastro'

/** Loja criada (TREINAR/LOGIN/VENDENDO) ouve "avise o time"; cadastro pendente (EM_ANALISE_AIVA) ouve "termine pra participar". */
export function grupoDoStatus(status: string | null | undefined): GrupoComunicado | null {
  if (status === 'TREINAR' || status === 'LOGIN' || status === 'LOJA_FINALIZADA_E_VENDENDO') return 'vendendo'
  if (status === 'EM_ANALISE_AIVA') return 'cadastro'
  return null
}

/**
 * Miolo ({{2}}) do HSM 48. UMA linha, sem quebra: o corpo do template já abre com "Oi {nome}, tudo bem?" e fecha
 * com "É só responder essa mensagem." (ver lib/text.ts). Link em variável de template é entregue (04/11, Assistel).
 */
export function textoComunicado(grupo: GrupoComunicado): string {
  const base = `chegou a Black November da AIVA 🖤 Em novembro a comissão do vendedor sobe de R$ ${BLACK_NOVEMBER.normal} pra até R$ ${BLACK_NOVEMBER.garantido + BLACK_NOVEMBER.bonus} por venda: ` +
    `R$ ${BLACK_NOVEMBER.garantido} garantidos por cada venda de 1 a 30/11 (pagos no início de dezembro) + R$ ${BLACK_NOVEMBER.bonus} de bônus na 1ª semana de janeiro, se a inadimplência da carteira da sua loja vier positiva.`
  if (grupo === 'vendendo') {
    return `${base} Vale pra todas as vendas de novembro — avise seu time de vendas hoje! A arte pra repassar pra equipe: ${BLACK_NOVEMBER.arte} Quer ajuda pra montar a meta do mês?`
  }
  return `${base} Só venda de loja ativa conta — quanto antes a sua ficar ativa, mais vendas de novembro entram. Me chama que eu te digo em que pé está o seu cadastro. A arte: ${BLACK_NOVEMBER.arte}`
}
