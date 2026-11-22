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

export type Elegibilidade =
  | { ok: true }
  | { ok: false; motivo: 'nao_ativa' | 'menos_de_1_ano' | 'odres' | 'ja_na_aiva' | 'receita_indisponivel'; detalhe: string }

export function elegibilidade(e: { situacao: string | null; idadeAnos: number | null; odres: boolean; jaNaAiva: string | null }): Elegibilidade {
  if (!e.situacao || e.idadeAnos == null) return { ok: false, motivo: 'receita_indisponivel', detalhe: 'Receita sem resposta' }
  if (e.situacao.trim().toUpperCase() !== 'ATIVA') return { ok: false, motivo: 'nao_ativa', detalhe: e.situacao }
  if (e.idadeAnos < 1) return { ok: false, motivo: 'menos_de_1_ano', detalhe: `${String(Math.floor(e.idadeAnos * 10 + 1e-9) / 10).replace('.', ',')} ano` } // trunca em 1 casa: nunca "1 ano"
  if (e.odres) return { ok: false, motivo: 'odres', detalhe: 'base Odres/UME' }
  if (e.jaNaAiva) return { ok: false, motivo: 'ja_na_aiva', detalhe: e.jaNaAiva }
  return { ok: true }
}

export function deveAbrirFluxo(e: { status: string; classe: Classe; contextoRepasse: boolean }): boolean {
  return (STATUS_ABRE_FLUXO as readonly string[]).includes(e.status) && e.classe === 'outra_empresa' && !e.contextoRepasse
}

export type PedidoLojaNova = { cnpj: string; acao: 'confirmar' | 'cancelar'; socioNome: string | null; socioTelefone: string | null }

/** `loja_nova_empresa: cnpj=… | acao=confirmar|cancelar | socio=mesmo|<nome> | tel=<telefone>` */
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
  const socioNome = socio && socio.toLowerCase() !== 'mesmo' ? socio : null
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

const FRASE_MOTIVO: Record<string, (det: string) => string> = {
  nao_ativa: det => `A situação desse CNPJ na Receita não é ATIVA${det ? ` (${det})` : ''}.`,
  menos_de_1_ano: det => `Esse CNPJ tem menos de 1 ano de abertura${det ? ` (${det})` : ''}.`,
  odres: () => 'Esse CNPJ está na base Odres/UME, que é tratada manualmente pela equipe.',
  ja_na_aiva: det => `Esse CNPJ já tem cadastro na AIVA${det ? ` (${det})` : ''}, então não cabe um pedido novo.`,
  receita_indisponivel: () => 'Não foi possível consultar esse CNPJ na Receita agora.',
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

  if (melhor.sit !== 'ok') {
    const frase = (FRASE_MOTIVO[melhor.sit] ?? (() => 'Esse CNPJ não pôde ser aceito como loja nova.'))(melhor.det)
    return [
      '## LOJA NOVA DE OUTRA EMPRESA — NÃO ELEGÍVEL',
      `O lojista pediu para cadastrar o CNPJ ${cnpj} como loja nova. ${frase}`,
      'VictorIA: NÃO abra pedido de loja nova para esse CNPJ. Explique ao lojista, com cordialidade e sem prometer prazo, que esse CNPJ não pode seguir por aqui agora, e ofereça ajuda com o que ele precisar da loja que já está ativa.',
    ].join('\n')
  }
  return [
    '## LOJA NOVA DE OUTRA EMPRESA — ELEGÍVEL',
    `O lojista pediu para cadastrar o CNPJ ${cnpj} (outra empresa) como loja nova na AIVA, e o CNPJ passou na conferência.`,
    'VictorIA, conduza assim:',
    `1. Confirme com ele que quer cadastrar essa empresa (${cnpj}) como nova loja na AIVA.`,
    '2. Pergunte se o sócio responsável é ele mesmo; se não for, peça o nome e o WhatsApp do sócio.',
    `3. Com a confirmação, devolva o motivo no formato \`${MOTIVO_LOJA_NOVA}: cnpj=${melhor.cnpj} | acao=confirmar | socio=mesmo|<nome> | tel=<telefone>\` com acionar_humano = false. Se ele desistir, use acao=cancelar.`,
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

/** CNPJs da mensagem (DV já conferido por quem chama) que abrem o fluxo neste turno — no máximo 3. */
export function cnpjsParaConferir(e: { status: string; cnpjsMensagem: string[]; cnpjsDoLead: string[]; contextoRepasse: boolean; obs: string | null; agora: number }): string[] {
  // sem CNPJ nenhum do lead, todo CNPJ seria "outra empresa" — inclusive o dele mesmo (revisão 1, item 2)
  if (!e.cnpjsDoLead.some((c) => soDigitos(c).length === 14)) return []
  const out: string[] = []
  for (const c of new Set(e.cnpjsMensagem.map(soDigitos))) {
    if (!deveAbrirFluxo({ status: e.status, classe: classificar(c, e.cnpjsDoLead), contextoRepasse: e.contextoRepasse })) continue
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
  if (!e) return 'elegibilidade não conferida (etapa fora do fluxo ou consulta falhou)'
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
  const quem = razao ? `${razao} (CNPJ ${fmtCnpj(cnpj)})` : `o CNPJ ${fmtCnpj(cnpj)}`
  return `O cadastro de ${quem} já está aberto na AIVA. Para concluir, acesse ${LINK_CADASTRO} e informe esse CNPJ. Qualquer dúvida, é só me chamar por aqui.`
}

export function textoLojaCriada(razao: string | null): string {
  return `A loja${razao ? ` ${razao}` : ''} foi criada na AIVA. Você já pode acessar normalmente com o seu login. Qualquer dúvida, é só me chamar por aqui.`
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
    const onb = doCnpj.find((o) => o.stage === 'dados_varejo' && !temRid(o))
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

/** Loja criada pelo template 86 (janela fechada). Mesmo conteúdo do `textoLojaCriada`, sem prazo. */
export const utilLojaCriada = (): Etapa => ({
  tipo: 'etapa',
  etapa: 'loja nova criada na AIVA.',
  situacao: 'você já pode acessar normalmente com o seu login. Qualquer dúvida, é só me chamar por aqui.',
})

// ─── fila de pré-cadastro (painel /atendimento) ─────────────────────────────────────────────────
/** Selo e sócio de uma linha de `sdr_registros_cnpj` na fila. Sem `fluxo` = linha comum (null). */
export function seloRegistroFila(r: { fluxo?: string | null; socio_nome?: string | null; socio_telefone?: string | null }): { selo: string; socio: string } | null {
  if (r.fluxo !== FLUXO_LOJA_NOVA) return null
  const nome = r.socio_nome?.trim()
  const tel = r.socio_telefone?.trim()
  const socio = nome ? `sócio: ${nome}${tel ? ` (${tel})` : ''}` : 'mesmo sócio'
  return { selo: 'loja nova de cliente ativo', socio }
}
