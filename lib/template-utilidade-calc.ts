/**
 * template-utilidade-calc.ts — os textos das rotinas no formato dos templates de UTILIDADE
 * (Aldo 18/11/2026: "tudo que dá pra usar os templates de utilidade, usar — menor custo possível").
 * Parte PURA (`npm run test:utilidade`); o envio e o liga/desliga ficam em lib/template-utilidade.ts.
 *
 * Substituem o coringa 48 ("Olá {{1}}, {{2}}", cobrado como MARKETING) nas rotinas de loja já
 * cadastrada ou em cadastro. Dois corpos fixos, aprovados na Meta como utilidade (IDs do Evo, fila 10):
 *   87 PENDÊNCIA — "Olá {{1}}, aqui é a VictorIA da Track. A loja {{2}} tem uma pendência registrada:
 *                   {{3}} Prazo: {{4}} Dúvidas, responda esta mensagem."
 *   86 ETAPA     — "Olá {{1}}, aqui é a VictorIA da Track. A loja {{2}} teve uma etapa concluída:
 *                   {{3}} Situação: {{4}} Dúvidas, responda esta mensagem."
 *
 * ⚠️ REGRAS DOS TEXTOS (pra não perder a categoria de utilidade):
 *  - {{3}} é FATO do cadastro/da conta, sem adjetivo e sem emoji; {{4}} é prazo/situação + a ação.
 *  - Nada de argumento de venda, prêmio, comissão ou promoção — isso é marketing e arrisca a Meta
 *    reclassificar o template (aí os três ficam caros, inclusive a régua de alerta).
 *  - Uma linha por campo: a Meta recusa \n, tab e 4+ espaços em variável.
 *
 * ⛔ FICAM NO CORINGA 48 de propósito (não cabem em "a loja tem uma pendência"):
 *  - retomada-interessado e followup: prospect que ainda NÃO é loja — é prospecção, marketing por natureza;
 *  - campanha-ativacao: prêmio em dinheiro, é promoção;
 *  - painel "Enviar info" e "Follow-up agora": texto livre do operador / gerado pela IA.
 */

export type Pendencia = { tipo: 'pendencia'; pendencia: string; prazo: string }
export type Etapa = { tipo: 'etapa'; etapa: string; situacao: string }
export type MsgUtilidade = Pendencia | Etapa

const pend = (pendencia: string, prazo: string): Pendencia => ({ tipo: 'pendencia', pendencia, prazo })
const etapa = (e: string, situacao: string): Etapa => ({ tipo: 'etapa', etapa: e, situacao })

/** A Meta recusa variável com quebra de linha, tab ou 4+ espaços seguidos. */
export function limpar(v: string, max = 900): string {
  const t = (v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return t.length > max ? t.slice(0, max).trim() : t
}

/** Nome da loja pro {{2}}: `nome_varejo` do cadastro, senão o nome do lead (que é o da loja). */
export function lojaDe(nomeLead: string | null | undefined, observacoes: string | null | undefined): string {
  const varejo = (observacoes ?? '').match(/nome_varejo=([^|\]]+)/)?.[1]?.trim()
  return limpar(varejo || nomeLead || '', 60) || 'sua loja'
}

/** Variáveis na ordem do template e o texto como o lojista lê (pra gravar em sdr_mensagens). */
export function montar(nome: string, loja: string, m: MsgUtilidade): { vars: string[]; texto: string } {
  const n = limpar(nome, 40) || 'lojista'
  const l = limpar(loja, 60) || 'sua loja'
  if (m.tipo === 'pendencia') {
    const a = limpar(m.pendencia), b = limpar(m.prazo)
    return { vars: [n, l, a, b], texto: `Olá ${n}, aqui é a VictorIA da Track.\n\nA loja ${l} tem uma pendência registrada: ${a}\n\nPrazo: ${b}\n\nDúvidas, responda esta mensagem.` }
  }
  const a = limpar(m.etapa), b = limpar(m.situacao)
  return { vars: [n, l, a, b], texto: `Olá ${n}, aqui é a VictorIA da Track.\n\nA loja ${l} teve uma etapa concluída: ${a}\n\nSituação: ${b}\n\nDúvidas, responda esta mensagem.` }
}

// ─── cobrança do formulário do varejo (4 toques: D+1, D+3, D+7, D+14) ────────────────────
export const FORMULARIO: Pendencia[] = [
  pend('falta preencher o formulário do varejo da AIVA. O cadastro já foi aprovado e é esse formulário que libera a plataforma.', 'assim que puder. Conseguiu abrir o link que a AIVA te enviou? Se precisar, eu te mando de novo.'),
  pend('o formulário do varejo da AIVA ainda não foi preenchido.', 'assim que puder. Travou em algum campo ou ficou alguma dúvida? Me conta que eu te ajudo a concluir.'),
  pend('o formulário do varejo da AIVA segue pendente. Sem ele a loja não é liberada.', 'assim que puder. Quer que eu reenvie o link? Se travou em alguma tela, me manda um print.'),
  pend('último lembrete do formulário do varejo da AIVA. O cadastro fica em aberto até ele ser preenchido.', 'sem data definida. Se ainda tiver interesse, me responde que eu te ajudo a concluir.'),
]

// ─── cadastro recebido com dado faltando ─────────────────────────────────────────────────
/** `pedido` = o que falta, já no formato "o seu melhor e-mail", "o CNPJ da loja"… */
export const cadastroIncompleto = (pedido: string): Pendencia =>
  pend(`falta informar ${pedido} pra concluir o cadastro na AIVA. A loja já passou na análise.`, 'assim que puder. É só me responder por aqui com essa informação.')

// ─── biometria (reconhecimento facial) ───────────────────────────────────────────────────
export function biometria(toque: number, url: string, negada = false): Pendencia {
  const u = url.trim()
  if (negada) {
    const onde = `assim que puder. Refaça em lugar bem iluminado, sem boné nem óculos e com o documento original em mãos: ${u}`
    return toque <= 1
      ? pend('o reconhecimento facial não foi aprovado pela AIVA e precisa ser refeito. Isso acontece quando a foto do documento ou do rosto não fica legível.', onde)
      : pend('o reconhecimento facial segue reprovado e precisa ser refeito pra loja ser liberada.', onde)
  }
  if (toque <= 1) return pend('falta o reconhecimento facial, último passo do cadastro na AIVA.', `assim que puder. É pelo celular, só apontar a câmera pro rosto: ${u}`)
  if (toque === 2) return pend('o reconhecimento facial do cadastro na AIVA ainda não foi feito.', `assim que puder. Leva menos de 2 minutos pelo celular: ${u}`)
  return pend('último lembrete do reconhecimento facial. Sem ele a loja não é liberada pela AIVA.', `sem data definida. O link é este: ${u}`)
}

// ─── acesso liberado e nunca usado ───────────────────────────────────────────────────────
export function acessoPendente(toque: number): Pendencia {
  return toque <= 1
    ? pend('o acesso da loja na AIVA ainda não foi usado.', 'assim que puder. O login e a senha vêm pelo WhatsApp do número +55 21 4020-2024 e o acesso é em https://vendas.flexfone.com.br/login. Se não achou a mensagem, me responde aqui.')
    : pend('o acesso da loja na AIVA segue sem uso.', 'assim que puder. Se a senha não chegou ou ficou em outro número, me avisa aqui que eu te ajudo.')
}

// ─── treinamento ─────────────────────────────────────────────────────────────────────────
/** `proximas` = rótulos das próximas turmas ("quinta 17/09, 9h30"), até 2. */
export function treinamentoGenerico(proximas: string[]): Pendencia {
  const quando = proximas.length ? `as próximas turmas são ${proximas.join(' e ')}, online` : 'tem turma toda semana, online'
  return pend('falta participar do treinamento da AIVA.', `${quando}. Me avisa que eu te mando o link do dia.`)
}
export const treinamentoLembrete = (rotuloTurma: string, link: string): Pendencia =>
  pend('treinamento da AIVA agendado (online, 1 hora).', `${rotuloTurma}. É só entrar por este link na hora: ${link}`)
export function treinamentoPosTurma(rotuloTurma: string, proxima: string | null): Pendencia {
  return pend(
    `confirmar se você participou do treinamento da AIVA de ${rotuloTurma}.`,
    proxima ? `a próxima turma é ${proxima}. Se não deu pra participar, me avisa que eu te mando o link.` : 'assim que puder. É só me responder por aqui.',
  )
}

// ─── ticket resolvido pela AIVA ──────────────────────────────────────────────────────────
export function ticketResolvido(tipoTicket: string, numero: number | string, linkPainel: string, videoPainel: string): Etapa {
  const tipo = tipoTicket.toLowerCase()
  if (/painel/.test(tipo)) return etapa(`pedido de acesso ao painel financeiro da AIVA resolvido (ticket nº ${numero}).`, `acesso liberado. Use este link com o e-mail que você informou: ${linkPainel} Se aparecer pedido de acesso, confere o e-mail (inclusive spam e promoções). Vídeo de como usar o painel: ${videoPainel}`)
  if (/repasse/.test(tipo)) return etapa(`chamado sobre o seu repasse resolvido pela AIVA (ticket nº ${numero}).`, 'resolvido. Se ainda ficou alguma dúvida sobre esse valor, me chama aqui.')
  if (/filial/.test(tipo)) return etapa(`cadastro da sua filial concluído pela AIVA (ticket nº ${numero}).`, 'concluído. Qualquer dúvida pra começar a operar nela, me chama aqui.')
  return etapa(`chamado na AIVA resolvido (ticket nº ${numero}).`, 'resolvido. Se ainda precisar de algo, me chama aqui.')
}

// ─── avisos de mudança de etapa (uma vez por loja) ───────────────────────────────────────
export const AVISO_ETAPA_UTIL: Record<number, Etapa> = {
  97: etapa('biometria aprovada pela AIVA.', 'do seu lado está tudo certo. Agora a AIVA cria a sua loja no sistema; depois eu te mando o material do treinamento, e o acesso chega pelo WhatsApp do número +55 21 4020-2024. Não precisa fazer mais nada por enquanto.'),
  99: etapa('primeiro acesso à plataforma da AIVA realizado.', 'loja pronta pra consultar. A consulta de CPF sai em uns 2 minutos e pode ser feita pra qualquer cliente que pedir preço. Qualquer dúvida no sistema, me chama aqui.'),
  71: etapa('acesso à AIVA liberado.', 'o login e a senha vêm pelo WhatsApp do número +55 21 4020-2024 e o acesso é em https://vendas.flexfone.com.br/login. Se não chegou ou travou em algum passo, me chama aqui.'),
}
export const PRE_APROVADA_UTIL: Etapa = etapa('pré-aprovação da loja na AIVA.', 'você não precisa fazer nada agora. O link do cadastro da AIVA chega aqui por mensagem, e é nele que você preenche os dados da loja.')

// ─── avisos internos (Aldo e Nei) ────────────────────────────────────────────────────────
/** Alerta do sistema pro time: o teaser de uma linha vira a "pendência". */
export const LOJA_INTERNA = 'Track (aviso interno)'
export const alertaInterno = (teaser: string): Pendencia => pend(teaser, 'verificar hoje.')
