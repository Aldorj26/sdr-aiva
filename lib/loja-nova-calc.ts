/**
 * Loja nova de OUTRA empresa (raiz de CNPJ diferente) pedida por varejista já ativo, no mesmo WhatsApp.
 * Regras puras — sem IO. Consumidores: webhook, espelho do portal e prompt da VictorIA.
 */
import { telefone55 } from './filiais-aiva.ts'
import { fmtCnpj } from './tickets-aiva.ts'

export const FLUXO_LOJA_NOVA = 'loja_nova_empresa'
export const MOTIVO_LOJA_NOVA = 'loja_nova_empresa' // prefixo do motivo_humano
export const STATUS_ABRE_FLUXO = ['TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO'] as const
const LINK_CADASTRO = 'https://retail-onboarding-hub.vercel.app/'
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
  return n.includes('nova loja') && n.split(' ').length <= 6
}

export type Elegibilidade =
  | { ok: true }
  | { ok: false; motivo: 'nao_ativa' | 'menos_de_1_ano' | 'odres' | 'ja_na_aiva' | 'receita_indisponivel'; detalhe: string }

export function elegibilidade(e: { situacao: string | null; idadeAnos: number | null; odres: boolean; jaNaAiva: string | null }): Elegibilidade {
  if (!e.situacao || e.idadeAnos == null) return { ok: false, motivo: 'receita_indisponivel', detalhe: 'Receita sem resposta' }
  if (e.situacao.trim().toUpperCase() !== 'ATIVA') return { ok: false, motivo: 'nao_ativa', detalhe: e.situacao }
  if (e.idadeAnos < 1) return { ok: false, motivo: 'menos_de_1_ano', detalhe: `${String(e.idadeAnos).replace('.', ',')} ano` }
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

// ─── textos ao lojista (sem prazo) ──────────────────────────────────────────────────────────────
export function textoLinkLojaNova(cnpj: string, razao: string | null): string {
  const quem = razao ? `${razao} (CNPJ ${fmtCnpj(cnpj)})` : `o CNPJ ${fmtCnpj(cnpj)}`
  return `O cadastro de ${quem} já está aberto na AIVA. Para concluir, acesse ${LINK_CADASTRO} e informe esse CNPJ. Qualquer dúvida, é só me chamar por aqui.`
}

export function textoLojaCriada(razao: string | null): string {
  return `A loja${razao ? ` ${razao}` : ''} foi criada na AIVA. Você já pode acessar normalmente com o seu login. Qualquer dúvida, é só me chamar por aqui.`
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
