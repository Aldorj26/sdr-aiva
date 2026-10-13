/**
 * Acesso ao PAINEL FINANCEIRO da AIVA por ticket (Mauricio liberou o endpoint em 13/10/2026; o formulário antigo morreu:
 * "sempre por aqui agora"). A VictorIA pede o Gmail e devolve motivo_humano "abrir_painel_financeiro: <email>"; o webhook
 * abre o ticket na API pública e manda ao lojista a confirmação com o número (ou o porquê de não ter aberto).
 *
 * POST /api/public/partner/tickets/painel-financeiro  { retailer_id | onboarding_id, email, subject?, description? }
 *   201 criado · 409 já existe em aberto (traz ticket_number) · 422 varejo não elegível OU e-mail não é conta Google ·
 *   404 varejo fora da carteira · 429/503 tente de novo. Erros: { error }.
 */

export const MOTIVO = 'abrir_painel_financeiro'
const URL_API = 'https://parceiro-aiva.lovable.app/api/public/partner/tickets/painel-financeiro'

export function ehMotivoPainel(motivo: string | null | undefined): boolean {
  return String(motivo ?? '').trim().toLowerCase().startsWith(MOTIVO)
}

export function emailDoMotivo(motivo: string | null | undefined): string | null {
  const m = String(motivo ?? '').trim()
  if (!ehMotivoPainel(m)) return null
  const email = m.slice(MOTIVO.length).replace(/^[:\s<]+/, '').trim().split(/\s/)[0]?.replace(/[<>]/g, '').replace(/[.,;)]+$/, '').toLowerCase()
  return email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) ? email : null
}

export type ResultadoTicket =
  | { tipo: 'criado'; numero: number }
  | { tipo: 'ja_existe'; numero: number | null }
  | { tipo: 'email_nao_google' }
  | { tipo: 'nao_elegivel'; erro: string }
  | { tipo: 'falha'; erro: string }

export function classificar(status: number, corpo: Record<string, unknown>): ResultadoTicket {
  const erro = String(corpo.error ?? '')
  if (status === 201) return { tipo: 'criado', numero: Number(corpo.ticket_number) }
  if (status === 409 && corpo.ticket_number != null) return { tipo: 'ja_existe', numero: Number(corpo.ticket_number) }
  if (status === 409 && /aberto|existe/i.test(erro)) return { tipo: 'ja_existe', numero: null }
  if (status === 422 && /google|gmail|e-?mail/i.test(erro)) return { tipo: 'email_nao_google' }
  if (status === 404 || status === 422 || status === 409) return { tipo: 'nao_elegivel', erro: `${status} ${erro}` }
  return { tipo: 'falha', erro: `${status} ${erro}`.trim() }
}

/** Mensagem pro lojista (null = não manda nada além da fala da VictorIA). */
export function mensagemLojista(r: ResultadoTicket, email: string): string | null {
  switch (r.tipo) {
    case 'criado': return `Pronto! Abri o pedido de acesso ao seu painel financeiro na AIVA (ticket nº ${r.numero}) pro e-mail ${email}. O acesso chega nesse e-mail — fica de olho também no spam e em promoções. 😊`
    case 'ja_existe': return `Você já tem um pedido de acesso ao painel financeiro aberto pra ${email}${r.numero ? ` (ticket nº ${r.numero})` : ''} — é só aguardar, o acesso chega nesse e-mail (confere também o spam). 😊`
    case 'email_nao_google': return `Esse e-mail não foi aceito: o painel financeiro da AIVA só libera acesso pra conta Google — Gmail (@gmail.com) ou e-mail de empresa no Google. Me manda um Gmail que eu abro o pedido na hora!`
    case 'nao_elegivel': return `Não consegui abrir o pedido do painel financeiro pela sua loja agora — passei pro nosso time resolver isso direto com a AIVA.`
    case 'falha': return `O sistema da AIVA não respondeu agora pra abrir o seu pedido do painel financeiro — passei pro nosso time abrir pra você.`
  }
}

export async function abrirTicketPainel(retailerId: string, email: string, loja: string): Promise<ResultadoTicket> {
  const chave = process.env.AIVA_PORTAL_API_KEY
  if (!chave) return { tipo: 'falha', erro: 'AIVA_PORTAL_API_KEY não configurada' }
  try {
    const res = await fetch(URL_API, {
      method: 'POST',
      headers: { 'x-api-key': chave, 'content-type': 'application/json' },
      body: JSON.stringify({ retailer_id: retailerId, email, subject: 'Acesso ao painel financeiro', description: `Pedido do lojista pelo WhatsApp (VictorIA/Track) — ${loja}`.slice(0, 5000) }),
      signal: AbortSignal.timeout(20_000),
    })
    const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return classificar(res.status, corpo)
  } catch (e) {
    return { tipo: 'falha', erro: e instanceof Error ? e.message : String(e) }
  }
}
