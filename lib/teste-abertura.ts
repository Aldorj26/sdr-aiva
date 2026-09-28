/**
 * lib/teste-abertura.ts — TESTE A/B da 1ª resposta da VictorIA (Aldo, 28/09/2026).
 * Parte PURA. Testes: `npm run test:abertura`.
 *
 * POR QUE: dos 732 lojistas que conversaram com a VictorIA em setembro, só 36%
 * chegaram a dizer o NOME — e quem diz o nome chega à pré-aprovação quase na
 * metade dos casos. Nos 24 casos em que a 1ª resposta já pedia o nome, 33%
 * chegaram à pré-aprovação (contra 18% da abertura "já trabalham com crediário?").
 * Amostra pequena demais pra virar regra — daí o teste.
 *
 *   A (controle): abertura normal do prompt ("…Vocês já trabalham com crediário hoje?")
 *   B (teste):    a MESMA abertura, juntando o pedido do nome na mesma mensagem
 *                 ("…Vocês já trabalham com crediário hoje? E com quem eu falo?")
 *
 * A variante é FIXA por lead (derivada do id), então o mesmo lojista nunca vê as duas.
 * O webhook grava [TESTE_ABERTURA:A|B:ISO] quando a 1ª resposta sai dentro do teste —
 * é por esse marcador que se mede (pré-aprovação por variante, 2 semanas).
 * Pra ENCERRAR o teste: TESTE_ABERTURA_ATIVO = false + deploy.
 */

export const TESTE_ABERTURA_ATIVO = true

export type Variante = 'A' | 'B'

/** Metade/metade, estável por lead: paridade do último dígito hexadecimal do uuid. */
export function varianteAbertura(leadId: string): Variante {
  const hex = String(leadId).replace(/[^0-9a-f]/gi, '')
  const ultimo = parseInt(hex.slice(-1) || '0', 16)
  return ultimo % 2 === 0 ? 'A' : 'B'
}

const STATUS_FASE1 = new Set(['INICIO', 'INTERESSADO', 'SEM_RESPOSTA'])

/**
 * É a 1ª resposta da VictorIA a uma PESSOA nesta conversa? Só aí o teste vale.
 * - status de Fase 1 e nome ainda não coletado;
 * - a VictorIA ainda não mandou nenhuma mensagem de texto livre (template não conta);
 * - a mensagem que chegou não é resposta automática da loja (isso é "furar o bot").
 */
export function ehPrimeiraResposta(p: {
  status: string
  dados: Record<string, string> | undefined
  historico: ReadonlyArray<{ direcao: string; template_hsm: string | null }>
  mensagemEhAutomatica: boolean
}): boolean {
  if (!STATUS_FASE1.has(p.status)) return false
  if (p.dados?.nome_socio) return false
  if (p.mensagemEhAutomatica) return false
  return !p.historico.some((m) => m.direcao === 'out' && !m.template_hsm)
}

/** Instrução do turno pra variante B (bloco dinâmico, fora do cache do prompt). */
export const INSTRUCAO_VARIANTE_B =
  `[TESTE DE ABERTURA — VARIANTE B]\n` +
  `Esta é a sua PRIMEIRA resposta a esse lojista. Faça a abertura normal, mas termine juntando as DUAS perguntas numa frase só: ` +
  `"Vocês já trabalham com crediário hoje? E com quem eu falo?". ` +
  `É exceção à regra de UMA pergunta SÓ neste turno — mantenha as duas, é isso que o teste mede. ` +
  `Se a mensagem dele JÁ respondeu uma das duas (disse o nome, ou disse se trabalha com crediário), pergunte só a que falta. ` +
  `IGNORE este teste e siga as regras normais se: ele disse que não vende celular, pediu pra parar, é cliente final, ` +
  `disse que JÁ É CLIENTE AIVA / já fez o cadastro, citou Odres ou UME, ou fez uma pergunta direta que precisa de resposta antes.\n` +
  `[FIM TESTE DE ABERTURA]`
