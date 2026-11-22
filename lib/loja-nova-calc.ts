/**
 * Loja nova de OUTRA empresa (raiz de CNPJ diferente) pedida por varejista já ativo, no mesmo WhatsApp.
 * Regras puras — sem IO. Consumidores: webhook, espelho do portal e prompt da VictorIA.
 */
import { telefone55 } from './filiais-aiva.ts'
import { fmtCnpj } from './tickets-aiva.ts'
import type { Etapa } from './template-utilidade-calc.ts'

export const FLUXO_LOJA_NOVA = 'loja_nova_empresa'
export const MOTIVO_LOJA_NOVA = 'loja_nova_empresa' // prefixo do motivo_humano
export const STATUS_ABRE_FLUXO = ['TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO'] as const
export const LINK_CADASTRO = 'https://retail-onboarding-hub.vercel.app/'
const SETE_DIAS_MS = 7 * 24 * 3600 * 1000

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** 8 primeiros dígitos; '' se não tiver 14. */
export const raizCnpj = (cnpj: unknown): string => {
  const d = soDigitos(cnpj)
  return d.length === 14 ? d.slice(0, 8) : ''
}

export type Classe = 'conhecido' | 'filial' | 'outra_empresa'

export function classificar(cnpj: string, cnpjsDoLead: string[]): Classe {
  const d = soDigitos(cnpj)
  if (cnpjsDoLead.some(c => soDigitos(c) === d)) return 'conhecido'
  const raiz = raizCnpj(d)
  if (raiz && cnpjsDoLead.some(c => raizCnpj(c) === raiz)) return 'filial'
  return 'outra_empresa'
}

/** RID (retailer_id) do cadastro da mesma raiz do CNPJ. */
export function ridDaRaiz(cnpj: string, regs: { cnpj: string; rid: string | null; tipo: string }[]): string | null {
  const raiz = raizCnpj(cnpj)
  if (!raiz) return null
  return regs.find(r => raizCnpj(r.cnpj) === raiz && r.rid)?.rid ?? null
}

const normalizar = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/** Atalho do lojista: frase curta contendo "nova loja" (até 6 palavras). */
export function ehAtalhoNovaLoja(texto: string | null | undefined): boolean {
  if (!texto) return false
  const n = normalizar(texto)
  // palavras inteiras: "renova loja" e "nova lojas" não são o atalho (normalizar já trocou pontuação por espaço)
  return /(?:^| )nova loja(?: |$)/.test(n) && n.split(' ').length <= 6
}

/** Idade < 1 ano: abaixo de 0,1 ano em meses ("menos de 1 mês", "1 mês"); senão anos truncados em 1 casa
 *  (trunca: nunca "1 ano" pra quem tem menos de 1). */
function idadeCurta(anos: number): string {
  if (anos < 0.1) {
    const meses = Math.floor(anos * 12 + 1e-9)
    return meses < 1 ? 'menos de 1 mês' : `${meses} ${meses === 1 ? 'mês' : 'meses'}`
  }
  return `${String(Math.floor(anos * 10 + 1e-9) / 10).replace('.', ',')} ano`
}

export type Elegibilidade =
  | { ok: true }
  | { ok: false; motivo: 'nao_ativa' | 'menos_de_1_ano' | 'odres' | 'ja_na_aiva' | 'receita_indisponivel'; detalhe: string }

export function elegibilidade(e: { situacao: string | null; idadeAnos: number | null; odres: boolean; jaNaAiva: string | null }): Elegibilidade {
  if (!e.situacao || e.idadeAnos == null) return { ok: false, motivo: 'receita_indisponivel', detalhe: 'Receita sem resposta' }
  if (e.situacao.trim().toUpperCase() !== 'ATIVA') return { ok: false, motivo: 'nao_ativa', detalhe: e.situacao }
  if (e.idadeAnos < 1) return { ok: false, motivo: 'menos_de_1_ano', detalhe: idadeCurta(e.idadeAnos) }
  if (e.odres) return { ok: false, motivo: 'odres', detalhe: 'base Odres/UME' }
  if (e.jaNaAiva) return { ok: false, motivo: 'ja_na_aiva', detalhe: e.jaNaAiva }
  return { ok: true }
}

/** Cadastro da loja PRINCIPAL ainda aberto no portal ([ONB_ETAPA:…] do espelho): a loja dele ainda não está ativa,
 *  então o pedido de loja nova espera (passo 0 da seção LOJA NOVA do prompt — revisão Task 5, item 4). */
export const cadastroPrincipalAberto = (obs: string | null | undefined): boolean => (obs ?? '').includes('[ONB_ETAPA:')

export function deveAbrirFluxo(e: { status: string; classe: Classe; contextoRepasse: boolean; cadastroAberto?: boolean }): boolean {
  return (STATUS_ABRE_FLUXO as readonly string[]).includes(e.status) && e.classe === 'outra_empresa' && !e.contextoRepasse && !e.cadastroAberto
}

export type PedidoLojaNova = { cnpj: string; acao: 'confirmar' | 'cancelar'; socioNome: string | null; socioTelefone: string | null }

/** O sócio é o próprio lojista: "mesmo", "eu", "eu mesmo", "sou eu", "o mesmo" (e o feminino). Sem acento/pontuação. */
const SOCIO_MESMO = new Set(['mesmo', 'mesma', 'o mesmo', 'a mesma', 'eu', 'eu mesmo', 'eu mesma', 'sou eu', 'sou eu mesmo', 'sou eu mesma', 'ele mesmo', 'ela mesma'])
export const ehSocioMesmo = (socio: string | null | undefined): boolean => SOCIO_MESMO.has(normalizar(socio ?? ''))

/** Formato (campos separados por "|"): `loja_nova_empresa: cnpj=<CNPJ> | acao=<confirmar OU cancelar> |
 *  socio=<mesmo OU nome do sócio> | tel=<WhatsApp do sócio, só se não for ele>`. */
export function lerMotivoLojaNova(motivo: string | null | undefined): PedidoLojaNova | null {
  const m = /^\s*loja_nova_empresa\s*:([\s\S]*)$/i.exec(motivo ?? '')
  if (!m) return null
  const campos: Record<string, string> = {}
  for (const parte of m[1].split('|')) {
    const i = parte.indexOf('=')
    if (i > 0) campos[parte.slice(0, i).trim().toLowerCase()] = parte.slice(i + 1).trim()
  }
  const cnpj = soDigitos(campos.cnpj)
  const acao = (campos.acao ?? '').toLowerCase()
  if (cnpj.length !== 14 || (acao !== 'confirmar' && acao !== 'cancelar')) return null
  const socio = campos.socio?.trim()
  const socioNome = socio && !ehSocioMesmo(socio) ? socio : null
  const tel = socioNome && campos.tel ? telefone55(campos.tel) : ''
  return { cnpj, acao, socioNome, socioTelefone: tel || null }
}

// ─── marcador no lead + bloco do prompt ──────────────────────────────────────────────────────────
const limpa = (s: string) => s.replace(/[|\]]/g, ' ').replace(/\s+/g, ' ').trim()

export const marcadorLojaNova = (cnpj: string, elegivel: Elegibilidade, iso: string): string => {
  const c = soDigitos(cnpj)
  return elegivel.ok
    ? `[LOJA_NOVA:cnpj=${c}|sit=ok|${iso}]`
    : `[LOJA_NOVA:cnpj=${c}|sit=${elegivel.motivo}|det=${limpa(elegivel.detalhe)}|${iso}]`
}

/** Motivo como o TIME lê (aviso do webhook): pode citar a base Odres/UME e a etapa do portal. */
const FRASE_MOTIVO: Record<string, (det: string) => string> = {
  nao_ativa: det => `A situação desse CNPJ na Receita não é ATIVA${det ? ` (${det})` : ''}.`,
  menos_de_1_ano: det => `Esse CNPJ tem menos de 1 ano de abertura${det ? ` (${det})` : ''}.`,
  odres: () => 'Esse CNPJ está na base Odres/UME, que é tratada manualmente pela equipe.',
  ja_na_aiva: det => `Esse CNPJ já tem cadastro na AIVA${det ? ` (${det})` : ''}, então não cabe um pedido novo.`,
  receita_indisponivel: () => 'Não foi possível consultar esse CNPJ na Receita agora.',
}

/** Motivo como o LOJISTA pode ouvir (revisão Task 5, itens 3 e 7): sem "base", sem promessa de a equipe tratar,
 *  sem a etapa do portal. Receita fora do ar não é recusa — tem texto próprio (item 6). */
const FRASE_MOTIVO_LOJISTA: Record<string, (det: string) => string> = {
  nao_ativa: FRASE_MOTIVO.nao_ativa,
  menos_de_1_ano: FRASE_MOTIVO.menos_de_1_ano,
  odres: () => 'Esse CNPJ já é atendido pela AIVA/Odres por outro canal (fora da Track), então não pode entrar como loja nova por aqui.',
  ja_na_aiva: () => 'Esse CNPJ já tem um cadastro aberto ou analisado na AIVA, então não cabe um pedido novo por aqui.',
}
/** O que a VictorIA lê além da frase (só no bloco do prompt). */
const ALERTA_VICTORIA: Record<string, string> = {
  odres: ' ⛔ Não fale em "base" nem diga que a equipe vai tratar ou retornar.',
  ja_na_aiva: ' Não cite a etapa.',
}
export const fraseMotivoLojista = (motivo: string, det: string): string =>
  (FRASE_MOTIVO_LOJISTA[motivo] ?? (() => 'Esse CNPJ não pôde ser aceito como loja nova.'))(det)

/** Resultado da conferência levado à mensagem de filial recusada por raiz (`mensagemFilial`, lib/tickets-aiva.ts).
 *  null = conferência falhou, não houve, ou a Receita não respondeu: o lojista reenvia e o sistema confere de novo. */
export type ConferenciaFilial = { ok: true } | { ok: false; frase: string } | null
export function conferenciaParaFilial(e: Elegibilidade | null | undefined): ConferenciaFilial {
  if (!e) return null
  if (e.ok) return { ok: true }
  if (e.motivo === 'receita_indisponivel') return null
  return { ok: false, frase: fraseMotivoLojista(e.motivo, e.detalhe) }
}

export function blocoPromptLojaNova(obs: string | null | undefined, agora: number = Date.now()): string | null {
  const re = /\[LOJA_NOVA:cnpj=(\d{14})\|sit=([a-z_0-9]+)(?:\|det=([^|\]]*))?\|([^|\]]+)\]/g
  let melhor: { cnpj: string; sit: string; det: string; t: number } | null = null
  for (const m of (obs ?? '').matchAll(re)) {
    const t = Date.parse(m[4])
    if (Number.isNaN(t)) continue
    if (!melhor || t > melhor.t) melhor = { cnpj: m[1], sit: m[2], det: m[3] ?? '', t }
  }
  if (!melhor || agora - melhor.t > SETE_DIAS_MS) return null
  const cnpj = fmtCnpj(melhor.cnpj)
  // Fato, não intenção (revisão final, item 1): o CNPJ pode ser troca de CNPJ, de fornecedor, de terceiro…
  const fato = `O lojista mandou o CNPJ ${cnpj}, que é de OUTRA empresa (raiz diferente das lojas dele).`
  const escopo = `Este bloco vale SÓ para o CNPJ ${cnpj}. Outro CNPJ que ele mandar segue a regra normal (o sistema classifica de novo).`
  const outroAssunto = 'o assunto for outro (troca de CNPJ de loja existente, usuário/login, dúvida, CNPJ de terceiro), ignore este bloco e siga a regra daquele assunto.'
  const semRepetir = 'Se você (ou uma mensagem do sistema) já tratou disso nesta conversa e ele não voltou ao assunto, não repita.'

  if (melhor.sit === 'receita_indisponivel') {
    return [
      '## LOJA NOVA DE OUTRA EMPRESA — CONFERÊNCIA PENDENTE',
      `${fato} ${FRASE_MOTIVO.receita_indisponivel('')}`,
      escopo,
      `VictorIA: NÃO abra pedido agora. Se ele quer cadastrá-la como loja nova na AIVA: diga que não deu pra consultar esse CNPJ neste momento e peça pra ele mandar o CNPJ de novo mais tarde — o sistema confere de novo. Sem prazo. Se ${outroAssunto}`,
      semRepetir,
    ].join('\n')
  }
  if (melhor.sit !== 'ok') {
    const frase = fraseMotivoLojista(melhor.sit, melhor.det) + (ALERTA_VICTORIA[melhor.sit] ?? '')
    return [
      '## LOJA NOVA DE OUTRA EMPRESA — NÃO ELEGÍVEL',
      `${fato} Pela conferência, ele não pode entrar como loja nova. Motivo: ${frase}`,
      escopo,
      `VictorIA: NÃO abra pedido de loja nova para esse CNPJ. Só se ele estiver pedindo para cadastrá-la como loja nova na AIVA: explique o motivo, com cordialidade e sem prometer prazo, e ofereça ajuda com o que ele precisar da loja que já está ativa. Se ${outroAssunto}`,
      semRepetir,
    ].join('\n')
  }
  return [
    '## LOJA NOVA DE OUTRA EMPRESA — ELEGÍVEL',
    `${fato} O CNPJ passou na conferência.`,
    escopo,
    `Se ele quer cadastrá-la como loja nova na AIVA: siga os passos abaixo; se ${outroAssunto}`,
    semRepetir,
    'VictorIA, conduza assim:',
    `1. Confirme com ele que quer cadastrar essa empresa (${cnpj}) como nova loja na AIVA.`,
    '2. Pergunte se o sócio responsável é ele mesmo; se não for, peça o nome e o WhatsApp do sócio.',
    `3. Com a confirmação, devolva o motivo no formato \`${MOTIVO_LOJA_NOVA}: cnpj=${melhor.cnpj} | acao=confirmar | socio=<mesmo OU nome do sócio> | tel=<WhatsApp do sócio, só se não for ele>\` com acionar_humano = false. Se ele desistir, use acao=cancelar.`,
    '4. Diga: "Registrei a loja nova; assim que o cadastro dela abrir na AIVA eu te mando o link por aqui."',
    '⛔ Não mande link de cadastro, não prometa prazo e não refaça a qualificação (a loja principal já está ativa).',
  ].join('\n')
}

// ─── webhook: o que conferir antes do modelo e o que fazer com o motivo depois ──────────────────
export const ehMotivoLojaNova = (m: string | null | undefined): boolean =>
  String(m ?? '').trim().toLowerCase().startsWith(MOTIVO_LOJA_NOVA)

const RE_MARCADOR = /\s*\[LOJA_NOVA:cnpj=(\d{14})\|sit=([a-z_0-9]+)(?:\|det=([^|\]]*))?\|([^|\]]+)\]/g

/** CNPJs (14 dígitos) já presentes nas observações — sem contar o marcador do fluxo nem o motivo cru dele
 *  (senão o CNPJ pedido viraria "conhecido" e sumiria da captura de LOJA NOVA). */
export function cnpjsDasObs(obs: string | null | undefined): string[] {
  const limpo = (obs ?? '').replace(RE_MARCADOR, ' ').replace(/loja_nova_empresa\s*:[^[]*/gi, ' ')
  return [...new Set(limpo.replace(/[.\-\/]/g, '').match(/\d{14}/g) ?? [])]
}

/** Marcador `[LOJA_NOVA:…]` mais recente desse CNPJ. */
export function lerMarcadorLojaNova(obs: string | null | undefined, cnpj: string): { sit: string; det: string; t: number } | null {
  const c = soDigitos(cnpj)
  let melhor: { sit: string; det: string; t: number } | null = null
  for (const m of (obs ?? '').matchAll(RE_MARCADOR)) {
    const t = Date.parse(m[4])
    if (m[1] !== c || Number.isNaN(t)) continue
    if (!melhor || t > melhor.t) melhor = { sit: m[2], det: m[3] ?? '', t }
  }
  return melhor
}

export const semMarcadorLojaNova = (obs: string | null | undefined, cnpj: string): string => {
  const c = soDigitos(cnpj)
  return (obs ?? '').replace(RE_MARCADOR, (todo, cm: string) => (cm === c ? '' : todo)).trim()
}

/** Troca o marcador desse CNPJ pelo novo (nunca dois do mesmo CNPJ). */
export const comMarcadorLojaNova = (obs: string | null | undefined, cnpj: string, marcador: string): string =>
  `${semMarcadorLojaNova(obs, cnpj)} ${marcador}`.trim()

/** CNPJs que só são "do lead" porque a captura de LOJA NOVA do webhook gravou a linha (tipo 'adicional',
 *  status 'informada') — não estão nas observações. Esses podem ser conferidos de novo quando o lojista reenviar
 *  (conferência que falhou não deixa marcador; sem isto o reenvio virava "conhecido" — revisão Task 5, item 2). */
export function reconferiveisDoLead(regs: { cnpj: unknown; tipo?: unknown; status?: unknown }[], obs: string | null | undefined): string[] {
  const daObs = new Set(cnpjsDasObs(obs))
  return [...new Set(regs
    .filter((r) => r.tipo === 'adicional' && r.status === 'informada')
    .map((r) => soDigitos(r.cnpj))
    .filter((c) => c.length === 14 && !daObs.has(c)))]
}

/** CNPJs da mensagem (DV já conferido por quem chama) que abrem o fluxo neste turno — no máximo 3. */
export function cnpjsParaConferir(e: { status: string; cnpjsMensagem: string[]; cnpjsDoLead: string[]; contextoRepasse: boolean; obs: string | null; agora: number; reconferiveis?: string[] }): string[] {
  // cadastro da loja principal ainda aberto no portal: o pedido espera a loja dele ficar ativa (item 4)
  const cadastroAberto = cadastroPrincipalAberto(e.obs)
  const reconf = new Set((e.reconferiveis ?? []).map(soDigitos))
  const out: string[] = []
  for (const c of new Set(e.cnpjsMensagem.map(soDigitos))) {
    // CNPJ reconferível: classifica contra os OUTROS CNPJs do lead (a linha dele mesmo não o torna conhecido)
    const doLead = reconf.has(c) ? e.cnpjsDoLead.filter((x) => soDigitos(x) !== c) : e.cnpjsDoLead
    // sem CNPJ nenhum do lead, todo CNPJ seria "outra empresa" — inclusive o dele mesmo (revisão 1, item 2)
    if (!doLead.some((x) => soDigitos(x).length === 14)) continue
    if (!deveAbrirFluxo({ status: e.status, classe: classificar(c, doLead), contextoRepasse: e.contextoRepasse, cadastroAberto })) continue
    const m = lerMarcadorLojaNova(e.obs, c)
    // marcador < 7 dias não repete — salvo Receita fora do ar, que confere de novo quando ele reenviar
    if (m && m.sit !== 'receita_indisponivel' && e.agora - m.t <= SETE_DIAS_MS) continue
    if (jaPedido(e.obs, c)) continue
    out.push(c)
  }
  return out.slice(0, 3)
}

/** Pedido já registrado (o marcador do fluxo sai e entra este — o bloco do prompt para de instruir). */
export const marcadorPedido = (cnpj: string, iso: string) => `[LOJA_NOVA_PEDIDA:cnpj=${soDigitos(cnpj)}|${iso}]`
export const jaPedido = (obs: string | null | undefined, cnpj: string) => (obs ?? '').includes(`[LOJA_NOVA_PEDIDA:cnpj=${soDigitos(cnpj)}|`)

export type DecisaoPedido =
  | { tipo: 'registrar'; pedido: PedidoLojaNova }
  | { tipo: 'cancelar'; pedido: PedidoLojaNova }
  | { tipo: 'ignorar'; porque: string }
  | { tipo: 'escalar'; porque: string }

export function avaliarPedidoLojaNova(e: { motivo: string | null | undefined; obs: string | null | undefined; falasDoLojista: string; agora: number }): DecisaoPedido {
  const p = lerMotivoLojaNova(e.motivo)
  if (!p) return { tipo: 'escalar', porque: `motivo de loja nova ilegível (${e.motivo}) — a VictorIA pode já ter dito ao lojista que registrou a loja nova` }
  const marca = lerMarcadorLojaNova(e.obs, p.cnpj)
  if (p.acao === 'cancelar') {
    if (marca) return { tipo: 'cancelar', pedido: p }
    if (jaPedido(e.obs, p.cnpj)) return { tipo: 'escalar', porque: `o lojista desistiu da loja nova ${fmtCnpj(p.cnpj)}, mas o pedido já está na fila de pré-cadastro — tirar da fila` }
    return { tipo: 'ignorar', porque: 'cancelamento sem marcador aberto' }
  }
  if (jaPedido(e.obs, p.cnpj)) return { tipo: 'ignorar', porque: 'pedido já registrado' }
  // a VictorIA devolve o confirmar junto com "Registrei a loja nova…" — quem recebe a escalada precisa saber
  const jaDisse = ' — a VictorIA já disse ao lojista que registrou a loja nova'
  if (!soDigitos(e.falasDoLojista).includes(p.cnpj)) return { tipo: 'escalar', porque: `CNPJ ${p.cnpj} do motivo não foi escrito pelo lojista na janela recente${jaDisse}` }
  if (!marca || e.agora - marca.t > SETE_DIAS_MS) return { tipo: 'escalar', porque: `sem conferência recente do CNPJ ${p.cnpj}${jaDisse}` }
  if (marca.sit !== 'ok') return { tipo: 'escalar', porque: `CNPJ ${p.cnpj} não elegível (${marca.sit}${marca.det ? `: ${marca.det}` : ''})${jaDisse}` }
  return { tipo: 'registrar', pedido: p }
}

export function resumoElegibilidade(e: Elegibilidade | null): string {
  if (!e) return 'elegibilidade não conferida (etapa fora do fluxo, cadastro da loja principal ainda aberto na AIVA ou consulta falhou)'
  if (e.ok) return 'elegível (Receita ATIVA, 1 ano ou mais, fora da base Odres/UME e sem cadastro na AIVA) — a VictorIA confirma com o lojista'
  return `NÃO elegível — ${(FRASE_MOTIVO[e.motivo] ?? (() => e.motivo))(e.detalhe)}`
}

export function avisoLojaNovaFila(x: { loja: string; telefone: string; cnpj: string; razao: string | null; socioNome: string | null; socioTelefone: string | null; colunasFaltando: boolean }): string {
  const socio = x.socioNome ? `${x.socioNome}${x.socioTelefone ? ` (${x.socioTelefone})` : ''}` : 'mesmo sócio'
  return [
    '🏪 *LOJA NOVA DE CLIENTE ATIVO — na fila de pré-cadastro*',
    '',
    `Loja: ${x.loja} (${x.telefone})`,
    `CNPJ: ${fmtCnpj(x.cnpj)}${x.razao ? ` — ${x.razao}` : ''}`,
    `Sócio: ${socio}`,
    '',
    'O lojista confirmou o pedido com a VictorIA; o link de cadastro sai depois, pela rotina de pré-cadastro.',
    ...(x.colunasFaltando
      ? ['', '⚠️ As colunas fluxo/socio_nome/socio_telefone ainda não existem em sdr_registros_cnpj (SQL não aplicado): o pedido está registrado como "informada", mas SEM o selo de loja nova nem o sócio — anote o sócio à mão.']
      : []),
    '👉 https://sdr-aiva.vercel.app/atendimento',
  ].join('\n')
}

/** Atalho "nova loja" só instrui se não há fluxo aberto (marcador < 7 dias) nem pedido recente (< 7 dias). */
export function deveInstruirAtalho(texto: string | null | undefined, obs: string | null | undefined, agora: number): boolean {
  if (!ehAtalhoNovaLoja(texto)) return false
  if (cadastroPrincipalAberto(obs)) return false // loja principal ainda em cadastro: vale o passo 0 do prompt (item 4)
  const recente = (iso: string) => { const t = Date.parse(iso); return !Number.isNaN(t) && agora - t <= SETE_DIAS_MS }
  for (const m of (obs ?? '').matchAll(RE_MARCADOR)) if (recente(m[4])) return false
  for (const m of (obs ?? '').matchAll(/\[LOJA_NOVA_PEDIDA:cnpj=\d{14}\|([^\]]+)\]/g)) if (recente(m[1])) return false
  return true
}

/** Alerta de CNPJ novo (bloco LOJA NOVA do webhook): qual texto e quais CNPJs viram linha na aba Filiais.
 *  Outra empresa só sai da regra atual em etapa do fluxo; o texto novo só quando todos foram conferidos antes do
 *  modelo (senão prometeria uma confirmação da VictorIA que não vem). Fora do fluxo, tudo como antes. */
export function planoAlertaCnpjNovo(e: { status: string; novos: { cnpj: string; classe: Classe; conferido: boolean }[]; dvRuim: number }): { textoOutraEmpresa: boolean; linhaFiliais: string[] } {
  const noFluxo = (STATUS_ABRE_FLUXO as readonly string[]).includes(e.status)
  const outraNoFluxo = (n: { classe: Classe }) => noFluxo && n.classe === 'outra_empresa'
  return {
    textoOutraEmpresa: e.novos.length > 0 && e.dvRuim === 0 && e.novos.every((n) => outraNoFluxo(n) && n.conferido),
    linhaFiliais: e.novos.filter((n) => !outraNoFluxo(n)).map((n) => n.cnpj),
  }
}

export const instrucaoAtalhoLojaNova = () =>
  '[INSTRUÇÃO DO SISTEMA — LOJA NOVA] O lojista quer cadastrar uma loja nova: peça o CNPJ dela (14 dígitos). [FIM INSTRUÇÃO DO SISTEMA]'

// ─── textos ao lojista (sem prazo) ──────────────────────────────────────────────────────────────
export function textoLinkLojaNova(cnpj: string, razao: string | null): string {
  const quem = razao ? `de ${razao} (CNPJ ${fmtCnpj(cnpj)})` : `do CNPJ ${fmtCnpj(cnpj)}`
  return `O cadastro ${quem} já está aberto na AIVA. Para concluir, acesse ${LINK_CADASTRO} e informe esse CNPJ. Qualquer dúvida, é só me chamar por aqui.`
}

export function textoLojaCriada(razao: string | null): string {
  // sem prometer acesso: no retailer_id a loja existe, mas o acesso só sai depois (treinamento / pronto_para_operar).
  // Sem prometer próximos passos por aqui: a linha do fluxo fica fora do card, nenhuma mensagem de etapa sai dela,
  // e o login da loja nova vem pelo número da própria AIVA (revisão final, item 3).
  return `A loja nova${razao ? ` ${razao}` : ''} foi criada na AIVA. 🎉 Qualquer dúvida sobre ela, é só me chamar por aqui.`
}

// ─── espelho do portal: link, loja criada, recusa e fila parada — tudo POR CNPJ ────────────────
// Só linhas nascidas deste fluxo (`fluxo = FLUXO_LOJA_NOVA`). Quem chama envia e só DEPOIS de envio aceito
// grava o carimbo; a chave em `sdr_avisos_chave` é a segunda trava (ver lib/espelho-portal.ts, passo 12).
export type RegLojaNova = { id: string | number; lead_id: string; cnpj: string; fluxo: string | null; link_enviado_em: string | null; criada_avisada_em: string | null }
export type OnbLojaNova = { cnpj: string; stage?: string | null; retailer_id?: string | number | null; legal_name?: string | null; pre_cadastro_status?: string | null }
export type ParLojaNova = { reg: RegLojaNova; onb: OnbLojaNova }

const doFluxo = (r: RegLojaNova) => r.fluxo === FLUXO_LOJA_NOVA && !!r.lead_id && soDigitos(r.cnpj).length === 14
const recusado = (o: OnbLojaNova) => o.stage === 'not_approved' || o.pre_cadastro_status === 'not_approved'
const temRid = (o: OnbLojaNova) => o.retailer_id != null && String(o.retailer_id).trim() !== ''
const onbsDo = (cnpj: string, onbs: OnbLojaNova[]) => { const c = soDigitos(cnpj); return onbs.filter((o) => soDigitos(o.cnpj) === c) }

/** Pré-cadastro chegou à AIVA (coluna dados_varejo) e o link ainda não foi. Loja já criada não recebe link. */
export function pendentesLink(regs: RegLojaNova[], onbs: OnbLojaNova[]): ParLojaNova[] {
  const out: ParLojaNova[] = []
  for (const reg of regs) {
    if (!doFluxo(reg) || reg.link_enviado_em || reg.criada_avisada_em) continue
    const doCnpj = onbsDo(reg.cnpj, onbs)
    if (doCnpj.some(recusado)) continue
    // algum onboarding do CNPJ já tem RID = a loja existe: vale só o "loja criada" (revisão Task 4, item 3)
    if (doCnpj.some(temRid)) continue
    const onb = doCnpj.find((o) => o.stage === 'dados_varejo')
    if (onb) out.push({ reg, onb })
  }
  return out
}

/** A AIVA criou a loja (retailer_id no onboarding) e o aviso ainda não foi. Recusada nunca entra. */
export function pendentesCriada(regs: RegLojaNova[], onbs: OnbLojaNova[]): ParLojaNova[] {
  const out: ParLojaNova[] = []
  for (const reg of regs) {
    if (!doFluxo(reg) || reg.criada_avisada_em) continue
    const onb = onbsDo(reg.cnpj, onbs).find((o) => temRid(o) && !recusado(o))
    if (onb) out.push({ reg, onb })
  }
  return out
}

/** A AIVA recusou o pré-cadastro (e não há outro onboarding vivo do CNPJ): aviso ao time, nada ao lojista. */
export function recusadas(regs: RegLojaNova[], onbs: OnbLojaNova[]): ParLojaNova[] {
  const out: ParLojaNova[] = []
  for (const reg of regs) {
    if (!doFluxo(reg)) continue
    const doCnpj = onbsDo(reg.cnpj, onbs)
    const onb = doCnpj.find(recusado)
    if (onb && doCnpj.every(recusado)) out.push({ reg, onb })
  }
  return out
}

export const HORAS_FILA_PARADA = 24
export type RegLojaNovaFila = RegLojaNova & { enviado?: boolean | null; criado_em?: string | null; enviado_em?: string | null }
export type ParadaLojaNova = { reg: RegLojaNovaFila; motivo: 'sem_clique' | 'nao_chegou'; horas: number }

/** Pré-cadastro parado: sem clique há 24h+ (relógio = criado_em) ou clicado há 24h+ (enviado_em, senão criado_em)
 *  e o CNPJ não aparece na AIVA. O aviso `pre_cadastro_nao_chegou` do passo 11 nunca pega estas linhas: ele só
 *  olha leads em PRE_APROVACAO/CADASTRO_RECEBIDO sem nenhum CNPJ no portal — e o lead deste fluxo já opera. */
export function filaParadaLojaNova(regs: RegLojaNovaFila[], onbs: OnbLojaNova[], agora: number): ParadaLojaNova[] {
  const noPortal = new Set(onbs.map((o) => soDigitos(o.cnpj)))
  const out: ParadaLojaNova[] = []
  for (const reg of regs) {
    if (!doFluxo(reg) || reg.link_enviado_em || reg.criada_avisada_em || noPortal.has(soDigitos(reg.cnpj))) continue
    const clicado = reg.enviado === true
    const desde = Date.parse(String((clicado ? reg.enviado_em || reg.criado_em : reg.criado_em) ?? ''))
    if (Number.isNaN(desde)) continue
    const horas = Math.floor((agora - desde) / 3_600_000)
    if (horas >= HORAS_FILA_PARADA) out.push({ reg, motivo: clicado ? 'nao_chegou' : 'sem_clique', horas })
  }
  return out
}

/** Chaves em `sdr_avisos_chave`. Link e loja criada: uma vez por CNPJ, para sempre. Fila parada: 1×/dia (BRT). */
export const chaveLinkLojaNova = (cnpj: string) => `loja_nova_link:${soDigitos(cnpj)}`
export const chaveCriadaLojaNova = (cnpj: string) => `loja_nova_criada:${soDigitos(cnpj)}`
export const chaveRecusadaLojaNova = (cnpj: string) => `loja_nova_recusada:${soDigitos(cnpj)}`
export const PREFIXO_FILA_PARADA = 'loja_nova_parada:'
/** Brasília é UTC−3 fixo (sem horário de verão desde 2019). */
export const chaveFilaParada = (cnpj: string, agora: number) =>
  `${PREFIXO_FILA_PARADA}${soDigitos(cnpj)}:${new Date(agora - 3 * 3_600_000).toISOString().slice(0, 10)}`

/** Coluna do SQL de 19/11 ainda não aplicada: 42703 (Postgres, no select) ou PGRST204 (PostgREST, na escrita). */
export function colunaLojaNovaAusente(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false
  if (err.code === '42703' || err.code === 'PGRST204') return true
  return /(fluxo|link_enviado_em|criada_avisada_em)/.test(err.message ?? '') && /(does not exist|could not find)/i.test(err.message ?? '')
}

/** {{2}} do template 86: "<razão> (CNPJ xx.xxx.xxx/xxxx-xx)" em até 60 caracteres (limite do `montar`). */
export function lojaTemplateLojaNova(cnpj: string, razao: string | null | undefined): string {
  const doc = `CNPJ ${fmtCnpj(soDigitos(cnpj))}`
  const r = (razao ?? '').replace(/\s+/g, ' ').trim()
  if (!r) return doc
  const cabe = 60 - doc.length - 3
  return `${r.length > cabe ? r.slice(0, cabe).trim() : r} (${doc})`
}

/** Loja criada pelo template 86 (janela fechada). Mesmo conteúdo do `textoLojaCriada`: sem prazo, sem
 *  prometer acesso nem próximos passos por aqui, sem emoji (variável de utilidade). */
export const utilLojaCriada = (): Etapa => ({
  tipo: 'etapa',
  etapa: 'loja nova criada na AIVA.',
  situacao: 'qualquer dúvida sobre ela, é só me chamar por aqui.',
})

// ─── revisão final: RID da loja principal, cura sem confirmação e escalada direta ───────────────
/** RID da loja PRINCIPAL do lead (repasse / filial sem par de raiz). Nunca de linha do fluxo de loja nova (outra
 *  empresa): a matriz primeiro; sem matriz, a linha com RID mais antiga (criado_em). Sem linha principal com RID = null
 *  (o webhook escala "sem RID"), mesmo que a linha do fluxo já tenha RID. Sem a coluna `fluxo`, ninguém é do fluxo. */
export function ridDaLojaPrincipal(regs: { rid: unknown; tipo?: unknown; fluxo?: unknown; criado_em?: unknown }[]): string | null {
  const t = (v: unknown) => { const n = Date.parse(String(v ?? '')); return Number.isNaN(n) ? Infinity : n }
  const principais = regs
    .filter((r) => r.rid != null && String(r.rid).trim() !== '' && r.fluxo !== FLUXO_LOJA_NOVA)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => t(a.r.criado_em) - t(b.r.criado_em) || a.i - b.i)
    .map((x) => x.r)
  const escolhida = principais.find((r) => r.tipo === 'matriz') ?? principais[0]
  return escolhida ? String(escolhida.rid).trim() : null
}

/** Linha do aviso ao time quando o espelho "cura" (chave reservada, sem carimbo): ninguém confirmou que saiu. */
export const linhaCuraLojaNova = (loja: string, cnpj: string, tipo: TipoEnvioLojaNova): string =>
  `• ${loja} — CNPJ ${fmtCnpj(soDigitos(cnpj))} · ${tipo === 'link' ? 'link do cadastro' : 'aviso de loja criada'} · carimbado como enviado sem confirmação — conferir com o lojista`
export const blocoCuraLojaNova = (linhas: string[]): string =>
  `⚠️ *Loja nova de cliente ativo: carimbado como enviado sem confirmação* (${linhas.length})\n${linhas.join('\n')}\n\n` +
  'A reserva do envio existia, mas o carimbo não: a rodada anterior pode ter caído entre reservar e enviar. O robô NÃO reenvia — conferir na conversa se o lojista recebeu e, se não, mandar à mão.'

/** Escalada do pedido de loja nova direto ao time (o 🔔 genérico só sai na transição false→true do acionar_humano:
 *  lead já marcado escalaria calado, embora o lojista já tenha ouvido "Registrei a loja nova"). */
export const avisoEscaladaLojaNova = (x: { loja: string; telefone: string; status: string; motivo: string | null | undefined; porque: string; ultimaMensagem: string }): string =>
  [
    `🏪 *LOJA NOVA DE CLIENTE ATIVO — pedido NÃO registrado, conferir* — ${x.loja} (${x.telefone} — etapa ${x.status})`,
    `⚠️ ${x.porque}`,
    `Motivo devolvido: ${String(x.motivo ?? '—')}`,
    `💬 Última mensagem do lojista: "${x.ultimaMensagem}"`,
    '👉 https://sdr-aiva.vercel.app/atendimento',
  ].join('\n')

// ─── falha de envio: tentar de novo, segurar ou desistir (revisão Task 4, item 2) ───────────────
/** Rejeições automáticas de um mesmo CNPJ e tipo antes de desistir e avisar o time. */
export const TENTATIVAS_LOJA_NOVA = 3
export type TipoEnvioLojaNova = 'link' | 'criada'

/** O Evo RECUSOU antes de aceitar (4xx, menos 408): nada saiu, pode tentar de novo. 5xx, 408, rede, timeout,
 *  JSON quebrado e qualquer erro desconhecido NÃO são claros — o Evo pode ter aceitado e o lojista recebido. */
export function rejeicaoClara(erro: string): boolean {
  const m = /Evo Talks \S+ → (\d{3})\b/.exec(erro)
  if (!m) return false
  const st = Number(m[1])
  return st >= 400 && st < 500 && st !== 408
}

/** `segurar` = mantém a chave, não reenvia e avisa o time pra conferir à mão. `tentar_de_novo` = solta a chave.
 *  `desistir` = 3ª rejeição: mantém a chave e avisa o time. `conta` = grava uma tentativa. Silêncio de envio
 *  (chave silencio_global/silencio_templates) é pausa deliberada, bloqueada antes de sair: tenta depois sem contar. */
export function decidirFalhaEnvio(erro: string, tentativasAnteriores: number): { acao: 'tentar_de_novo' | 'segurar' | 'desistir'; conta: boolean } {
  if (/SILENCIO_(GLOBAL|TEMPLATES)/.test(erro)) return { acao: 'tentar_de_novo', conta: false }
  if (!rejeicaoClara(erro)) return { acao: 'segurar', conta: false }
  return { acao: tentativasAnteriores + 1 >= TENTATIVAS_LOJA_NOVA ? 'desistir' : 'tentar_de_novo', conta: true }
}

export const chaveTentativaLojaNova = (tipo: TipoEnvioLojaNova, cnpj: string, n: number) => `loja_nova_tentativa:${tipo}:${soDigitos(cnpj)}:${n}`
/** Envio retido (ambíguo ou desistido): a chave de reserva fica, e esta impede o "curar" de carimbar como enviado. */
export const chaveRetidoLojaNova = (tipo: TipoEnvioLojaNova, cnpj: string) => `loja_nova_retido:${tipo}:${soDigitos(cnpj)}`
export function tentativasDe(chaves: Iterable<string>, tipo: TipoEnvioLojaNova, cnpj: string): number {
  const pre = `loja_nova_tentativa:${tipo}:${soDigitos(cnpj)}:`
  let n = 0
  for (const k of chaves) if (k.startsWith(pre)) n++
  return n
}

// ─── fila de pré-cadastro (painel /atendimento) ─────────────────────────────────────────────────
/** Selo e sócio de uma linha de `sdr_registros_cnpj` na fila. Sem `fluxo` = linha comum (null). */
export function seloRegistroFila(r: { fluxo?: string | null; socio_nome?: string | null; socio_telefone?: string | null }): { selo: string; socio: string } | null {
  if (r.fluxo !== FLUXO_LOJA_NOVA) return null
  const nome = r.socio_nome?.trim()
  const tel = r.socio_telefone?.trim()
  const socio = nome ? `sócio: ${nome}${tel ? ` (${tel})` : ''}` : 'mesmo sócio'
  return { selo: 'loja nova de cliente ativo', socio }
}
