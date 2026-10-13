/**
 * Tickets da AIVA pela API pública (Mauricio 13/10/2026 — "sempre pelo ticket"): repasse, filial e consulta de status.
 * O painel financeiro tem módulo próprio (lib/painel-financeiro.ts), mais antigo.
 *
 * A VictorIA coleta os dados e devolve um motivo estruturado; o webhook abre o ticket e confirma ao lojista:
 *   abrir_ticket_repasse: vendas=123456:950,40;789012 | obs=o repasse de ontem não caiu
 *   abrir_ticket_filial: cnpj=60.854.022/0002-21 | numero=150 | complemento=sala 2
 * A rotina /api/sdr/tickets-aiva consulta o que mudou (GET /tickets?updated_since) e avisa lojista e time.
 *
 * Partes puras (testadas em lib/tickets-aiva.test.ts, `npm run test:tickets`) + IO no fim do arquivo.
 */

const BASE = 'https://parceiro-aiva.lovable.app/api/public/partner/tickets'

// ─── motivos ──────────────────────────────────────────────────────────────────────────────────────
export const MOTIVO_REPASSE = 'abrir_ticket_repasse'
export const MOTIVO_FILIAL = 'abrir_ticket_filial'

const campos = (resto: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const parte of resto.split('|')) {
    const i = parte.indexOf('=')
    if (i > 0) out[parte.slice(0, i).trim().toLowerCase()] = parte.slice(i + 1).trim().replace(/^<|>$/g, '').trim()
  }
  return out
}
const depoisDoPrefixo = (motivo: string, prefixo: string): string | null => {
  const m = String(motivo ?? '').trim()
  return m.toLowerCase().startsWith(prefixo) ? m.slice(prefixo.length).replace(/^[:\s]+/, '') : null
}

export interface PedidoRepasse { vendas: Array<{ numero: string; valor?: string }>; observacoes: string }
export function lerMotivoRepasse(motivo: string | null | undefined): PedidoRepasse | null {
  const resto = depoisDoPrefixo(motivo ?? '', MOTIVO_REPASSE)
  if (resto == null) return null
  const c = campos(resto)
  const vendas = (c.vendas ?? '').split(';').map((v) => v.trim()).filter(Boolean).map((v) => {
    const [numero, valor] = v.split(':').map((x) => x.trim())
    return { numero: numero.slice(0, 50), ...(valor ? { valor } : {}) }
  }).filter((v) => /\w{3,}/.test(v.numero)).slice(0, 200)
  const observacoes = (c.obs ?? c.observacoes ?? '').slice(0, 5000)
  if (!vendas.length && !observacoes) return null
  return { vendas, observacoes }
}

export interface PedidoFilial { cnpj: string; numero: string; complemento: string }
export function lerMotivoFilial(motivo: string | null | undefined): PedidoFilial | null {
  const resto = depoisDoPrefixo(motivo ?? '', MOTIVO_FILIAL)
  if (resto == null) return null
  const c = campos(resto)
  const cnpj = (c.cnpj ?? '').replace(/\D/g, '')
  const numero = (c.numero ?? c['número'] ?? '').slice(0, 20)
  if (cnpj.length !== 14 || !numero) return null
  return { cnpj, numero, complemento: (c.complemento ?? '').slice(0, 120) }
}

export const ehMotivoTicket = (m: string | null | undefined) => {
  const s = String(m ?? '').trim().toLowerCase()
  return s.startsWith(MOTIVO_REPASSE) || s.startsWith(MOTIVO_FILIAL)
}

// ─── resposta da abertura ─────────────────────────────────────────────────────────────────────────
export type Abertura =
  | { tipo: 'criado'; numero: number; corpo: Record<string, unknown> }
  | { tipo: 'ja_existe'; numero: number | null }
  | { tipo: 'recusado'; erro: string }       // 422 com motivo que o lojista pode corrigir (filial: Receita/raiz/endereço)
  | { tipo: 'nao_elegivel'; erro: string }   // 404/409/422 de carteira/varejo — é com o time
  | { tipo: 'falha'; erro: string }

export function classificarAbertura(status: number, corpo: Record<string, unknown>): Abertura {
  const erro = String(corpo.error ?? '')
  if (status === 201) return { tipo: 'criado', numero: Number(corpo.ticket_number), corpo }
  if (status === 409 && corpo.ticket_number != null) return { tipo: 'ja_existe', numero: Number(corpo.ticket_number) }
  if (status === 422 && /receita|raiz|filial|inativ|n[ãa]o encontrad|endere[çc]o|cep|ativa/i.test(erro) && !/varejo n[ãa]o eleg/i.test(erro)) return { tipo: 'recusado', erro }
  if (status === 404 || status === 409 || status === 422) return { tipo: 'nao_elegivel', erro: `${status} ${erro}`.trim() }
  return { tipo: 'falha', erro: `${status} ${erro}`.trim() }
}

export function mensagemRepasse(a: Abertura): string {
  switch (a.tipo) {
    case 'criado': return `Pronto! Abri o chamado sobre o seu repasse na AIVA (ticket nº ${a.numero}). O time financeiro deles analisa — quando a AIVA concluir, eu te aviso por aqui. 😊`
    case 'ja_existe': return `Já tem um chamado de repasse aberto na AIVA${a.numero ? ` (ticket nº ${a.numero})` : ''} — o time deles está analisando. Quando a AIVA concluir, eu te aviso por aqui.`
    case 'recusado': case 'nao_elegivel': return 'Não consegui abrir o chamado do repasse pela sua loja agora — passei pro nosso time abrir direto com a AIVA.'
    case 'falha': return 'O sistema da AIVA não respondeu agora pra abrir o chamado do seu repasse — passei pro nosso time abrir pra você.'
  }
}

export function mensagemFilial(a: Abertura, cnpj: string): string {
  const c = fmtCnpj(cnpj)
  switch (a.tipo) {
    case 'criado': return `Pronto! Abri o pedido de cadastro da filial ${c} na AIVA (ticket nº ${a.numero}). A AIVA já conferiu o CNPJ na Receita; agora o time deles faz o cadastro — quando concluírem, eu te aviso por aqui. 🎉`
    case 'ja_existe': return `Já existe um pedido de cadastro aberto pra filial ${c}${a.numero ? ` (ticket nº ${a.numero})` : ''} — é só aguardar, eu te aviso quando a AIVA concluir.`
    case 'recusado': return /raiz/i.test(a.erro)
      ? `O CNPJ ${c} não é filial da sua loja principal (é de outra empresa) — aí não é cadastro de filial, é uma loja nova. Passei pro nosso time ver o melhor caminho com você.`
      : /endere|cep/i.test(a.erro)
        ? `A AIVA não conseguiu completar o endereço da filial ${c} pelo CEP. Me confirma o endereço completo dela (rua, bairro, cidade e estado)?`
        : `A AIVA não aceitou o CNPJ ${c} como filial: ${a.erro.replace(/^\d+\s*/, '')}. Confere o número? Se estiver certo, passei pro nosso time olhar.`
    case 'nao_elegivel': return 'Não consegui abrir o pedido da filial pela sua loja agora — passei pro nosso time resolver com a AIVA.'
    case 'falha': return 'O sistema da AIVA não respondeu agora pra abrir o pedido da filial — passei pro nosso time abrir pra você.'
  }
}

export const fmtCnpj = (c: string) => { const d = c.replace(/\D/g, ''); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : c }

// ─── acompanhamento (consulta) ────────────────────────────────────────────────────────────────────
export interface TicketApi {
  id: string; number: number; type: string; status: string; retailer_id: string | null; cnpj: string | null
  subject?: string; details?: Record<string, unknown>; created_at: string; updated_at: string; resolved_at?: string | null
  messages?: Array<{ id: string; from: 'aiva' | 'parceiro'; body: string; created_at: string }>
}
export const STATUS_ROTULO: Record<string, string> = { aberto: 'aberto', em_analise: 'em análise', aguardando_parceiro: 'aguardando a nossa resposta', resolvido: 'resolvido', fechado: 'fechado' }
export const ABERTOS = ['aberto', 'em_analise', 'aguardando_parceiro']

/** Marcador do lead: [TICKET_AIVA:<nº>|<tipo>|<status>|<msgs da AIVA vistas>] — um por ticket. */
export function lerTicketsDoLead(obs: string | null | undefined): Map<number, { tipo: string; status: string; msgsAiva: number }> {
  const m = new Map<number, { tipo: string; status: string; msgsAiva: number }>()
  for (const x of (obs ?? '').matchAll(/\[TICKET_AIVA:(\d+)\|([^|\]]*)\|([a-z_]+)\|(\d+)\]/g)) m.set(Number(x[1]), { tipo: x[2], status: x[3], msgsAiva: Number(x[4]) })
  return m
}
export function gravarTicketNoLead(obs: string | null | undefined, t: { number: number; type: string; status: string; msgsAiva: number }): string {
  const limpo = (obs ?? '').replace(new RegExp(`\\s*\\[TICKET_AIVA:${t.number}\\|[^\\]]*\\]`, 'g'), '').trim()
  return `${limpo} [TICKET_AIVA:${t.number}|${t.type.replace(/[|\]]/g, ' ')}|${t.status}|${t.msgsAiva}]`.trim()
}

export type EventoTicket = { tipo: 'resolvido' | 'fechado' | 'aguardando' | 'resposta'; mensagem?: string }
/** O que mudou desde a última vez que vimos o ticket. */
export function eventosDoTicket(t: TicketApi, visto: { status: string; msgsAiva: number } | undefined): EventoTicket[] {
  const doAiva = (t.messages ?? []).filter((m) => m.from === 'aiva').sort((a, b) => a.created_at.localeCompare(b.created_at))
  const ev: EventoTicket[] = []
  const novas = doAiva.slice(visto?.msgsAiva ?? 0)
  const ultima = novas[novas.length - 1]?.body
  if (visto?.status !== t.status) {
    if (t.status === 'resolvido') ev.push({ tipo: 'resolvido', mensagem: ultima })
    else if (t.status === 'fechado' && visto?.status !== 'resolvido') ev.push({ tipo: 'fechado', mensagem: ultima })
    else if (t.status === 'aguardando_parceiro') ev.push({ tipo: 'aguardando', mensagem: ultima })
  }
  if (!ev.length && novas.length) ev.push({ tipo: 'resposta', mensagem: ultima })
  return ev
}

/** Aviso ao LOJISTA (UMA linha — vai no {{2}} do HSM 48). Só status; o texto do CS da AIVA vai pro time, não pro lojista. */
export function avisoLojista(t: TicketApi, e: EventoTicket): string | null {
  const tipo = t.type.toLowerCase()
  if (e.tipo === 'resolvido') {
    if (/painel/.test(tipo)) return `seu pedido de acesso ao painel financeiro da AIVA (ticket nº ${t.number}) foi resolvido ✅ Confere o e-mail que você informou — vale olhar também o spam e as promoções.`
    if (/repasse/.test(tipo)) return `o chamado sobre o seu repasse (ticket nº ${t.number}) foi resolvido pela AIVA ✅ Se ainda ficou alguma dúvida sobre esse valor, me chama aqui.`
    if (/filial/.test(tipo)) return `o cadastro da sua filial (ticket nº ${t.number}) foi concluído pela AIVA ✅ Qualquer dúvida pra começar a vender nela, me chama aqui.`
    return `o seu chamado na AIVA (ticket nº ${t.number}) foi resolvido ✅ Se ainda precisar de algo, me chama aqui.`
  }
  return null
}

/** Bloco dinâmico pra VictorIA com os chamados do lead (lido do marcador). */
export function blocoPromptTickets(obs: string | null | undefined): string | null {
  const t = [...lerTicketsDoLead(obs).entries()]
  if (!t.length) return null
  const linhas = t.sort((a, b) => b[0] - a[0]).slice(0, 6).map(([n, x]) => `- ticket nº ${n} (${x.tipo}): ${STATUS_ROTULO[x.status] ?? x.status}`)
  return `[INSTRUÇÃO DO SISTEMA — CHAMADOS DESTA LOJA NA AIVA]\n${linhas.join('\n')}\nSe ele perguntar de um desses pedidos, diga o status acima (atualiza de hora em hora), sem prazo e sem prometer data. "Aguardando a nossa resposta" = a AIVA pediu algo ao nosso time, que já foi avisado — diga que o time está tratando. Pedido resolvido do painel financeiro: oriente a conferir o e-mail (inclusive spam). ⛔ Não abra outro ticket igual a um que ainda está aberto.\n[FIM INSTRUÇÃO DO SISTEMA]`
}

// ─── IO ───────────────────────────────────────────────────────────────────────────────────────────
async function chamar(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const chave = process.env.AIVA_PORTAL_API_KEY
  if (!chave) return { status: 0, corpo: { error: 'AIVA_PORTAL_API_KEY não configurada' } }
  try {
    const res = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: { 'x-api-key': chave, ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(25_000),
    })
    return { status: res.status, corpo: (await res.json().catch(() => ({}))) as Record<string, unknown> }
  } catch (e) {
    return { status: 0, corpo: { error: e instanceof Error ? e.message : String(e) } }
  }
}

export async function abrirTicketRepasse(retailerId: string, p: PedidoRepasse): Promise<Abertura> {
  const corpo: Record<string, unknown> = { retailer_id: retailerId }
  if (p.vendas.length) corpo.vendas = p.vendas
  if (p.observacoes) corpo.observacoes = p.observacoes
  const r = await chamar('POST', '/repasse', corpo)
  return classificarAbertura(r.status, r.corpo)
}

export async function abrirTicketFilial(retailerIdMatriz: string, p: PedidoFilial): Promise<Abertura> {
  const r = await chamar('POST', '/filial', { retailer_id: retailerIdMatriz, cnpj_filial: p.cnpj, numero: p.numero, ...(p.complemento ? { complemento: p.complemento } : {}) })
  return classificarAbertura(r.status, r.corpo)
}

export async function listarTicketsAtualizados(desde: string | null): Promise<{ ok: boolean; tickets: TicketApi[]; erro?: string }> {
  const tickets: TicketApi[] = []
  for (let offset = 0; offset < 2000; offset += 200) {
    const q = new URLSearchParams({ limit: '200', offset: String(offset), include_messages: 'true' })
    if (desde) q.set('updated_since', desde)
    const r = await chamar('GET', `?${q}`)
    if (r.status !== 200) return { ok: false, tickets, erro: `${r.status} ${String(r.corpo.error ?? '')}` }
    const lote = (r.corpo.tickets ?? []) as TicketApi[]
    tickets.push(...lote)
    if (lote.length < 200) break
  }
  return { ok: true, tickets }
}

export async function listarTicketsAbertos(): Promise<TicketApi[]> {
  const r = await chamar('GET', `?${new URLSearchParams({ status: ABERTOS.join(','), limit: '200', include_messages: 'false' })}`)
  return r.status === 200 ? ((r.corpo.tickets ?? []) as TicketApi[]) : []
}
