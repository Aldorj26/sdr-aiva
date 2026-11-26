/**
 * regua-alerta-calc.ts — régua de ativação em cima dos alertas da AIVA (Aldo 17/11/2026).
 * Parte PURA (`npm run test:regua`); IO em lib/regua-alerta.ts, rota em app/api/sdr/regua-alerta.
 * Proposta completa: docs/Proposta-regua-ativacao-alertas-2026-11-17.md.
 *
 * Fonte: GET /api/public/partner/retailers/attention — só `retailer_id`, `attention_status`, `mes`.
 * NÃO traz número (consultas, vendas, R$): nenhum texto daqui cita número. O alerta cruzado com a
 * coluna do quadro (`board_column`) vira a TRILHA, que é a hipótese do problema da loja.
 *
 * Decisões do Aldo (17/11):
 *  1. PERMANENTE: toda loja que entrar num alerta entra na régua; quem sai recebe um reconhecimento.
 *  2. Só por template de UTILIDADE (87 pendência, 86 etapa concluída) — nunca pelo coringa 48.
 *     Por isso os textos são factuais: argumento de venda (comissão, Black November) NÃO entra em
 *     campo de template, senão a Meta reclassifica pra marketing. Isso fica com a VictorIA na conversa.
 *
 * Cadência: toque 1 ao entrar; 2, 3 e 4 a cada 7 dias; depois 1 a cada 30 dias. Lojista falou há
 * menos de 7 dias → a régua espera (a VictorIA está na conversa). Trilhas A e B sem resposta no 3º
 * toque vão pra lista de ligação do Nei.
 */

export type Alerta = 'novo_sem_engajamento' | 'antigo_sem_engajamento' | 'baixa_performance'
export type Trilha = 'A' | 'B' | 'C' | 'D'

const DIA = 24 * 60 * 60 * 1000
export const ROTULO_TOQUE = 'aiva_regua_alerta'
export const ROTULO_RECONHECIMENTO = 'aiva_regua_reconhecimento'
export const INTERVALO_DIAS = 7
export const INTERVALO_MANUTENCAO_DIAS = 30
/** Depois deste nº de toques a cadência cai pra mensal. */
export const TOQUES_SEMANAIS = 4
/** Lojista falou há menos que isso → a conversa é da VictorIA, a régua espera. */
export const RESPIRO_RESPOSTA_DIAS = 7
/** Outro template nosso saiu pra mesma loja há menos que isso → não empilha. */
export const RESPIRO_OUTRO_TEMPLATE_DIAS = 3
/** Trilhas A e B: a partir deste toque sem resposta, a loja entra na lista de ligação. */
export const TOQUE_LIGACAO = 3

export const NOME_TRILHA: Record<Trilha, string> = {
  A: 'Fechar a venda', B: 'Reconquista', C: 'Primeira venda', D: 'Primeira consulta',
}
/** Ordem da fila: quem está mais perto de dinheiro primeiro. */
export const PRIORIDADE: Record<Trilha, number> = { A: 0, B: 1, C: 2, D: 3 }

export const ehAlerta = (v: unknown): v is Alerta =>
  v === 'novo_sem_engajamento' || v === 'antigo_sem_engajamento' || v === 'baixa_performance'

/**
 * Alerta + coluna do quadro → trilha.
 *  A  consulta agora e não vende (baixa_performance)
 *  B  já vendeu e parou de consultar
 *  C  consultou, nunca vendeu e parou
 *  D  nunca consultou
 */
export function classificar(alerta: Alerta, boardColumn: string | null | undefined, primeiroAcessoEm: string | null | undefined): Trilha {
  if (alerta === 'baixa_performance') return 'A'
  if (boardColumn === 'primeira_venda') return 'B'
  if (boardColumn === 'primeiro_acesso' || primeiroAcessoEm) return 'C'
  return 'D'
}

/** Loja com várias filiais em alerta: vale a trilha mais prioritária (uma mensagem por lojista). */
export function trilhaDoLead(trilhas: Trilha[]): Trilha | null {
  if (!trilhas.length) return null
  return [...trilhas].sort((a, b) => PRIORIDADE[a] - PRIORIDADE[b])[0]
}

export type Estado = { trilha: Trilha; toque: number; ultima: number | null; reconhecidoEm: number | null }

export type Marcadores = {
  estado: Estado | null
  optout: boolean
  reprovado: boolean
  semAcesso: boolean
  pausaAte: number | null
}

const dataDe = (o: string, re: RegExp) => { const m = o.match(re); const t = m ? Date.parse(m[1]) : NaN; return Number.isNaN(t) ? null : t }

export function lerMarcadores(obs: string | null | undefined): Marcadores {
  const o = obs ?? ''
  const m = o.match(/\[REGUA_ALERTA:trilha=([ABCD])\|toque=(\d+)\|ultima=([^\]|]*)\]/)
  const reconhecidoEm = dataDe(o, /\[REGUA_RECONH:([^\]]+)\]/)
  const ultima = m && m[3] ? Date.parse(m[3]) : NaN
  return {
    estado: m ? { trilha: m[1] as Trilha, toque: Number(m[2]), ultima: Number.isNaN(ultima) ? null : ultima, reconhecidoEm } : null,
    optout: o.includes('[CONSULTORIA_OPTOUT]') || o.includes('[DICAS_OPTOUT]') || o.includes('[REGUA_OPTOUT]'),
    reprovado: o.includes('[PORTAL_REPROVADO'),
    // senha pendente / cadastro aberto: o problema é acesso — é das rotinas senha-pendente e acesso-pendente
    semAcesso: o.includes('[SENHA_PENDENTE_DESDE:') || o.includes('[ONB_ETAPA:'),
    pausaAte: dataDe(o, /\[PAUSA_ATE:([^\]]+)\]/),
  }
}

export type Reconhecimento = 'saiu' | 'voltou_consultar' | 'primeira_venda'

export type Decisao =
  | { acao: 'toque'; trilha: Trilha; toque: number; ligar: boolean }
  | { acao: 'reconhecer'; variante: Reconhecimento; novaTrilha: Trilha | null }
  | { acao: 'trocar_trilha'; trilha: Trilha }
  | { acao: 'encerrar' }
  | { acao: 'nada'; motivo: string }

export type Contexto = {
  /** Trilha de HOJE (null = a loja não está em nenhum alerta). */
  trilhaAtual: Trilha | null
  boardColumn: string | null
  ultimaFalaLojista: number | null
  ultimoOutroTemplate: number | null
  filaHumana: boolean
  bloqueadaLimite: boolean
}

/** Intervalo até o PRÓXIMO toque, dado quantos já saíram. */
export const intervaloDias = (toquesEnviados: number) => (toquesEnviados >= TOQUES_SEMANAIS ? INTERVALO_MANUTENCAO_DIAS : INTERVALO_DIAS)

export function decidir(m: Marcadores, c: Contexto, agora = Date.now()): Decisao {
  const e = m.estado
  // ── saiu do alerta ────────────────────────────────────────────────────────────────────
  if (c.trilhaAtual === null) {
    if (!e) return { acao: 'nada', motivo: 'fora_do_alerta' }
    // nunca chegou a receber toque: só limpa a marca, sem mensagem
    if (e.toque === 0) return { acao: 'encerrar' }
    if (m.optout) return { acao: 'encerrar' }
    if (c.ultimaFalaLojista && agora - c.ultimaFalaLojista < 2 * DIA) return { acao: 'nada', motivo: 'conversa_viva' }
    const variante: Reconhecimento = (e.trilha === 'C' || e.trilha === 'D') && c.boardColumn === 'primeira_venda' ? 'primeira_venda' : 'saiu'
    return { acao: 'reconhecer', variante, novaTrilha: null }
  }
  // ── travas ────────────────────────────────────────────────────────────────────────────
  if (m.optout) return { acao: 'nada', motivo: 'optout' }
  if (m.reprovado) return { acao: 'nada', motivo: 'reprovado' }
  if (m.semAcesso) return { acao: 'nada', motivo: 'sem_acesso' }
  if (m.pausaAte && m.pausaAte > agora) return { acao: 'nada', motivo: 'pausa' }
  if (c.filaHumana) return { acao: 'nada', motivo: 'fila_humano' }
  if (c.bloqueadaLimite) return { acao: 'nada', motivo: 'bloqueada_limite' }
  if (c.ultimaFalaLojista && agora - c.ultimaFalaLojista < RESPIRO_RESPOSTA_DIAS * DIA) return { acao: 'nada', motivo: 'respondeu_recente' }
  // ── mudou de trilha ───────────────────────────────────────────────────────────────────
  if (e && e.trilha !== c.trilhaAtual) {
    // sem engajamento → baixa performance = voltou a consultar: reconhece e troca
    if (c.trilhaAtual === 'A' && e.toque > 0) return { acao: 'reconhecer', variante: 'voltou_consultar', novaTrilha: 'A' }
    return { acao: 'trocar_trilha', trilha: c.trilhaAtual }
  }
  if (c.ultimoOutroTemplate && agora - c.ultimoOutroTemplate < RESPIRO_OUTRO_TEMPLATE_DIAS * DIA) return { acao: 'nada', motivo: 'outro_template_recente' }
  const enviados = e?.toque ?? 0
  if (e?.ultima != null) {
    // folga de 12h: o cron roda em hora fixa e o envio anterior saiu alguns minutos depois
    if (agora - e.ultima < intervaloDias(enviados) * DIA - 12 * 3600_000) return { acao: 'nada', motivo: 'aguardando_intervalo' }
  }
  const toque = enviados + 1
  const ligar = (c.trilhaAtual === 'A' || c.trilhaAtual === 'B') && toque >= TOQUE_LIGACAO
  return { acao: 'toque', trilha: c.trilhaAtual, toque, ligar }
}

// ─── textos ─────────────────────────────────────────────────────────────────────────────

/** DD/MM da próxima conferência (BRT): hoje + o intervalo que vale depois deste toque. */
export function dataConferencia(toque: number, agora = Date.now()): string {
  const d = new Date(agora - 3 * 3600_000 + intervaloDias(toque) * DIA)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** [pendência, pergunta] de cada toque. A pergunta entra no campo "Prazo" depois da data. */
const TOQUES: Record<Trilha, Array<[string, string]>> = {
  A: [
    ['há consultas de CPF, mas nenhuma venda concluída nos últimos 30 dias.', 'Me conta onde a venda trava: cliente reprovado, limite baixo ou desistência na entrada.'],
    ['nenhuma venda concluída nos últimos 30 dias, mesmo com consultas de CPF.', 'Se o cliente aprovado desiste no final, me avisa que eu passo como apresentar a entrada de 25% logo no começo.'],
    ['a loja segue sem venda concluída nos últimos 30 dias.', 'Se o motivo for reprovação, me conta quantos clientes vocês consultam por dia.'],
    ['a loja segue sem venda concluída nos últimos 30 dias.', 'Posso te passar o passo a passo do atendimento no balcão, é só responder.'],
  ],
  B: [
    ['sem consulta de CPF registrada nos últimos dias. A loja já vendeu pela AIVA antes.', 'Me conta o que mudou: equipe, acesso ou aprovação dos clientes.'],
    ['sem consulta de CPF registrada nos últimos dias.', 'Se saiu vendedor ou a senha travou, me avisa que eu te mostro o caminho.'],
    ['a loja segue sem consulta de CPF registrada.', 'Se o que parou foi cliente reprovado, me conta que eu explico como contornar.'],
    ['a loja segue sem consulta de CPF registrada.', 'O que falta pra loja voltar a consultar esta semana?'],
  ],
  C: [
    ['consultas de CPF paradas e primeira venda ainda não concluída.', 'Os primeiros clientes foram reprovados? Me conta o que aconteceu.'],
    ['primeira venda ainda não concluída e sem consulta de CPF nos últimos dias.', 'Se travou em alguma tela da consulta, me manda o print que eu te guio.'],
    ['a loja segue sem a primeira venda concluída.', 'Me diz qual é o caso: clientes reprovados, equipe sem costume ou acesso travado.'],
    ['a loja segue sem a primeira venda concluída.', 'O que falta: o passo a passo, cadastrar vendedor ou outra coisa?'],
  ],
  D: [
    ['nenhuma consulta de CPF registrada desde a liberação da loja.', 'Me conta o que travou: o acesso não chegou, a equipe não sabe usar ou outra coisa.'],
    ['nenhuma consulta de CPF registrada desde a liberação da loja.', 'Se ainda não conseguiu entrar na plataforma, responde aqui que eu te ajudo com o acesso.'],
    ['a loja segue sem a primeira consulta de CPF.', 'Se faltou o treinamento, tem turma ao vivo segunda, quarta e sexta às 9h30. Responde que eu mando o link.'],
    ['a loja segue sem a primeira consulta de CPF.', 'O que está faltando pra fazer a primeira consulta?'],
  ],
}

/** Campos {{3}} e {{4}} do template 87 (pendência registrada). `toque` começa em 1. */
export function camposToque(trilha: Trilha, toque: number, agora = Date.now()): { pendencia: string; prazo: string } {
  const lista = TOQUES[trilha]
  const [pendencia, pergunta] = lista[(toque - 1) % lista.length]
  return { pendencia, prazo: `conferência em ${dataConferencia(toque, agora)}. ${pergunta}` }
}

/** Campos {{3}} e {{4}} do template 86 (etapa concluída). */
export function camposReconhecimento(v: Reconhecimento): { etapa: string; situacao: string } {
  if (v === 'primeira_venda') return { etapa: 'primeira venda concluída pela AIVA.', situacao: 'loja operando. Se precisar de ajuda com a equipe ou com o sistema, me chama por aqui.' }
  if (v === 'voltou_consultar') return { etapa: 'a loja voltou a consultar CPF.', situacao: 'falta a venda ser concluída. Se o cliente reprovar ou desistir, me conta que eu ajudo.' }
  return { etapa: 'a loja voltou a registrar movimento na AIVA.', situacao: 'sem pendência no momento. Se travar algo no sistema, me chama por aqui.' }
}

/** Como o lojista lê (pra gravar em sdr_mensagens e mostrar no ?dry). Espelha o corpo aprovado na Meta. */
export function renderToque(nome: string, loja: string, c: { pendencia: string; prazo: string }): string {
  return `Olá ${nome}, aqui é a VictorIA da Track.\n\nA loja ${loja} tem uma pendência registrada: ${c.pendencia}\n\nPrazo: ${c.prazo}\n\nDúvidas, responda esta mensagem.`
}
export function renderReconhecimento(nome: string, loja: string, c: { etapa: string; situacao: string }): string {
  return `Olá ${nome}, aqui é a VictorIA da Track.\n\nA loja ${loja} teve uma etapa concluída: ${c.etapa}\n\nSituação: ${c.situacao}\n\nDúvidas, responda esta mensagem.`
}

/** A Meta recusa variável com quebra de linha, tab ou 4+ espaços seguidos. */
export function limparCampo(v: string, max = 60): string {
  const t = v.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return t.length > max ? t.slice(0, max).trim() : t
}

// ─── conversa: bloco do prompt + motivo declarado ───────────────────────────────────────

/** Motivos fechados que a VictorIA registra quando o lojista DIZ por que não consulta/não vende. */
export const MOTIVOS = ['acesso', 'equipe', 'reprovacao', 'entrada_limite', 'movimento', 'desistiu'] as const
export type Motivo = (typeof MOTIVOS)[number]

/** Aceita o código vindo do modelo (com acento, maiúscula ou espaço) e devolve o código canônico, ou null. */
export function normalizarMotivo(v: unknown): Motivo | null {
  if (typeof v !== 'string') return null
  const t = v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s/-]+/g, '_')
  return (MOTIVOS as readonly string[]).includes(t) ? (t as Motivo) : null
}

/** Marca durável do motivo (uma só; a mais recente substitui a anterior). */
export const marcaMotivo = (m: Motivo, agora = new Date()) => `[REGUA_MOTIVO:${m}:${agora.toISOString()}]`
export function lerMotivo(obs: string | null | undefined): { motivo: Motivo; em: number } | null {
  const m = (obs ?? '').match(/\[REGUA_MOTIVO:([a-z_]+):([^\]]+)\]/)
  const cod = m ? normalizarMotivo(m[1]) : null
  const em = m ? Date.parse(m[2]) : NaN
  return cod && !Number.isNaN(em) ? { motivo: cod, em } : null
}

const SITUACAO: Record<Trilha, string> = {
  A: 'a loja ESTÁ consultando CPF, mas não teve venda concluída nos últimos 30 dias',
  B: 'a loja JÁ VENDEU pela AIVA e parou de consultar CPF nos últimos dias',
  C: 'a loja já consultou CPF, NUNCA concluiu uma venda e parou de consultar',
  D: 'a loja está liberada e NUNCA fez uma consulta de CPF',
}
const INVESTIGAR: Record<Trilha, string> = {
  A: 'em que ponto a venda trava — cliente reprovado, limite aprovado baixo, ou cliente aprovado que desiste (entrada de 25%)',
  B: 'o que mudou — vendedor que saiu, acesso/senha que travou, clientes reprovando, ou movimento fraco',
  C: 'o que aconteceu depois das primeiras consultas — clientes reprovados, equipe que não pegou o costume, ou acesso que travou',
  D: 'o que impediu a primeira consulta — acesso/senha que não chegou, equipe que não sabe usar (treinamento), ou falta de cliente pedindo parcelado',
}

/**
 * Bloco dinâmico do prompt (fora do cache) pra loja que JÁ recebeu toque da régua.
 * Sem toque enviado → null (a loja nem sabe do aviso; a conversa segue as regras da fase).
 */
export function blocoPromptRegua(obs: string | null | undefined, agora = Date.now(), status: string | null = null): string | null {
  const m = lerMarcadores(obs)
  const e = m.estado
  if (!e || e.toque < 1 || e.ultima == null) return null
  // senha pendente / cadastro aberto: o sistema JÁ sabe o motivo (acesso) e os blocos de senha/ONB conduzem (revisor 17/11)
  if (m.semAcesso) return null
  const d = new Date(e.ultima - 3 * 3600_000)
  const quando = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  const conf = dataConferencia(e.toque, e.ultima)
  const ja = lerMotivo(obs)
  const recente = agora - e.ultima < 14 * DIA
  return `[INSTRUÇÃO DO SISTEMA — LOJA NA RÉGUA DE ALERTA DA AIVA]
O portal da AIVA sinaliza (informação do sistema, não do lojista) que ${SITUACAO[e.trilha]}. Em ${quando} nós mandamos a ele um aviso de "pendência registrada" sobre isso (aviso nº ${e.toque}), com "conferência em ${conf}"${recente ? ' — é provável que ele esteja respondendo a esse aviso' : ''}.
- O alerta NÃO traz número e você NÃO tem os números desta loja neste turno: não sabe quantas consultas ou vendas ela fez. ⛔ Não cite quantidade, valor nem data de consulta/venda, nem de memória do histórico. O alerta pode estar atrasado: se ele disser que consultou ou vendeu depois disso, ACREDITE, parabenize em uma linha e não discuta.
- Se ele perguntar o que é a "pendência" ou o "prazo": explique com naturalidade que é só um acompanhamento nosso da loja — a data é quando a gente olha de novo, não é cobrança, multa nem risco de perder o acesso. ⛔ Não trate como dívida nem como obrigação.
${ja
    ? `- MOTIVO JÁ CONHECIDO: ele já disse que o motivo é "${ja.motivo}". ⛔ NÃO pergunte o motivo de novo. Oriente direto pelo caso dele, usando as regras que já existem (acesso e senha, equipe e Login de operadores, reprovação, entrada e limite, treinamento). Só se ele disser um motivo DIFERENTE, inclua em dados_coletados o campo "motivo_alerta" com o código novo`
    : `- OBJETIVO desta conversa: descobrir o MOTIVO antes de dar dica — ${INVESTIGAR[e.trilha]}. Uma pergunta por vez, curta.${status === 'LOGIN' ? ' Nesta fase a pergunta do motivo É a pergunta do acesso que o bloco da fase já pede (se recebeu login e senha e conseguiu entrar): faça só essa, não duas.' : ''} Só depois de saber o motivo você orienta, usando as regras que já existem pra cada caso (acesso e senha, equipe e Login de operadores, reprovação, entrada e limite, treinamento).
- Quando ELE disser o motivo (não deduza), inclua em dados_coletados o campo "motivo_alerta" com UM código`}: "acesso" (senha, login, não consegue entrar) · "equipe" (vendedor saiu, equipe não usa ou não sabe usar) · "reprovacao" (clientes reprovados) · "entrada_limite" (cliente aprovado desiste pela entrada, ou limite baixo) · "movimento" (pouco cliente, loja fraca, sazonal) · "desistiu" (não quer mais usar a AIVA). Se ele não disse motivo nenhum nesta mensagem, NÃO inclua o campo.
- ⛔ O aviso que mandamos NÃO é promessa de que você resolve acesso ou reenvia senha sozinha: valem as regras de acesso da fase (senha do sócio, link de atualização cadastral, aba Colaboradores / formulário de Login de operadores). Mostre o caminho certo.
- Este bloco NÃO muda status, NÃO muda as regras de acionar humano da fase e NÃO autoriza prometer nada em nome da AIVA. Se ele disser que DECIDIU parar de usar a AIVA: mantenha o status, não insista e acione com motivo_humano = "loja_quer_parar: <motivo>" (regra 🚪 pra loja já criada). Se só está desanimado, valem as regras da fase.
[FIM INSTRUÇÃO DO SISTEMA]`
}

// ─── marcas nas observações ─────────────────────────────────────────────────────────────

const semMarca = (obs: string | null | undefined) => (obs ?? '').replace(/\s*\[REGUA_ALERTA:[^\]]*\]/g, '').trim()

export function gravarEstado(obs: string | null | undefined, trilha: Trilha, toque: number, ultima: Date | null): string {
  return `${semMarca(obs)} [REGUA_ALERTA:trilha=${trilha}|toque=${toque}|ultima=${ultima ? ultima.toISOString() : ''}]`.trim()
}
/** Saiu do alerta: tira a marca da régua (se voltar a entrar, recomeça do toque 1). */
export function encerrarEstado(obs: string | null | undefined, reconhecidoEm: Date | null): string {
  const base = semMarca(obs).replace(/\s*\[REGUA_RECONH:[^\]]*\]/g, '').trim()
  return reconhecidoEm ? `${base} [REGUA_RECONH:${reconhecidoEm.toISOString()}]`.trim() : base
}
