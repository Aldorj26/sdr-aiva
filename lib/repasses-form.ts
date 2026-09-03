/**
 * lib/repasses-form.ts — solicita acesso ao PAINEL DE REPASSES da AIVA
 * (form público "Painel de Repasse - Sócio", verificado sem login em 03/09).
 *
 * Fluxo (decisão do Aldo 03/09): quando o lojista diz que NÃO tem acesso ao
 * painel de repasses, a VictorIA coleta CNPJ da matriz + GMAIL (o acesso é por
 * conta Google) e o sistema lança aqui + registra na aba Repasses da planilha
 * AIVA APROVAÇÃO + na tabela sdr_repasses_solicitados.
 *
 * Campos do form (extraídos do FB_PUBLIC_LOAD_DATA_ em 03/09):
 *   entry.204909228 → "CNPJ Matriz (Sem Caracteres Especiais)" — só dígitos!
 *   entry.259540144 → "Gmail"
 */

const FORM_ID = '1FAIpQLSfdJL4AuHOc4HrJnbyJ9IiX3UtNvzeTn9eoWPAj63dZx_IbMA'
const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`

const ENTRIES = {
  cnpj: 'entry.204909228',
  gmail: 'entry.259540144',
} as const

/** E-mail aceito pelo painel: precisa ser conta Google (gmail.com / googlemail). */
export function ehGmail(email: string): boolean {
  return /^[a-z0-9._%+-]+@(gmail|googlemail)\.com$/i.test(email.trim())
}

export async function solicitarPainelRepasses(cnpj: string, gmail: string): Promise<boolean> {
  const digits = (cnpj ?? '').replace(/\D/g, '')
  if (digits.length !== 14 || !ehGmail(gmail)) return false
  try {
    const body = new URLSearchParams({
      [ENTRIES.cnpj]: digits, // o form pede SEM caracteres especiais
      [ENTRIES.gmail]: gmail.trim(),
    })
    const res = await fetch(FORM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'user-agent': 'sdr-aiva/1.0' },
      body: body.toString(),
      redirect: 'follow',
    })
    if (!res.ok) console.error(`[REPASSES_FORM] ${digits} / ${gmail} → HTTP ${res.status}`)
    return res.ok
  } catch (err) {
    console.error(`[REPASSES_FORM] Falha ao lançar ${digits}:`, err)
    return false
  }
}

/** Link pré-preenchido (fallback manual quando o envio automático falhar). */
export function linkRepassesPreenchido(cnpj: string, gmail: string): string {
  const q = new URLSearchParams({
    usp: 'pp_url',
    [ENTRIES.cnpj]: (cnpj ?? '').replace(/\D/g, ''),
    [ENTRIES.gmail]: gmail ?? '',
  })
  return `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?${q.toString()}`
}
