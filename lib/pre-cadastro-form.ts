/**
 * lib/pre-cadastro-form.ts — envia os CNPJs do lead pro Google Form
 * "Pré cadastros de varejos" (pedido do Aldo 2026-07-28).
 *
 * Quando o lead completa o cadastro (CADASTRO_RECEBIDO), TODOS os CNPJs dele —
 * a matriz + os adicionais — precisam ser lançados no formulário, UM POR VEZ
 * (o form tem um único campo: entry.1726492813 = CNPJ).
 *
 * Cada submissão é uma resposta independente do formulário, então mandamos um
 * POST por CNPJ, em sequência. Best-effort: falha em um CNPJ não impede os
 * demais nem interrompe o fluxo do cadastro.
 */

const FORM_ID = '1FAIpQLSdQP3iJVI0I_SlM_Vx-NokNyfNgEJnbZBjWDHa8M8n0nfISLA'
const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`
const CAMPO_CNPJ = 'entry.1726492813'

/**
 * Extrai CNPJs válidos (14 dígitos) de um texto livre.
 * Aceita "12.345.678/0001-90", "12345678000190", listas separadas por
 * vírgula/quebra de linha/"e". Ignora "não possui" e afins.
 */
export function extrairCnpjs(texto: string | null | undefined): string[] {
  if (!texto) return []
  const achados = String(texto).match(/\d[\d./-]{15,}|\d{14}/g) ?? []
  const limpos = achados
    .map((c) => c.replace(/\D/g, ''))
    .filter((c) => c.length === 14)
  return [...new Set(limpos)]
}

/**
 * Monta o link do formulário JÁ PREENCHIDO com o CNPJ.
 *
 * Por que link e não envio automático: o formulário é da AIVA/UME e exige
 * login com e-mail verificado — POST anônimo volta HTTP 401, e o Google não
 * tem API pra enviar respostas. Então o sistema entrega o link pronto e o
 * operador só confere e clica em "Enviar" (decisão do Aldo 2026-07-28).
 */
export function linkFormPreenchido(cnpj: string): string | null {
  const digits = (cnpj ?? '').replace(/\D/g, '')
  if (digits.length !== 14) return null
  return `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?usp=pp_url&${CAMPO_CNPJ}=${digits}`
}

/** Formata CNPJ 14 dígitos como 00.000.000/0000-00 (só pra leitura no alerta). */
export function formatarCnpj(cnpj: string): string {
  const d = (cnpj ?? '').replace(/\D/g, '')
  if (d.length !== 14) return cnpj
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/**
 * Bloco pronto pro alerta do WhatsApp: um link pré-preenchido por CNPJ do lead
 * (matriz + adicionais). Retorna '' se não houver CNPJ válido.
 */
export function blocoLinksPreCadastro(
  cnpjMatriz?: string | null,
  cnpjsAdicionais?: string | null,
): string {
  const lista = [...new Set([...extrairCnpjs(cnpjMatriz), ...extrairCnpjs(cnpjsAdicionais)])]
  if (lista.length === 0) return ''
  const linhas = lista.map((c, i) => {
    const rotulo = i === 0 ? 'matriz' : `adicional ${i}`
    return `${i + 1}) ${formatarCnpj(c)} (${rotulo})\n${linkFormPreenchido(c)}`
  })
  return (
    `\n📝 *Lançar no formulário de pré-cadastro* (${lista.length} CNPJ${lista.length > 1 ? 's' : ''} — ` +
    `abra cada link, o CNPJ já vem preenchido, é só enviar):\n\n${linhas.join('\n\n')}`
  )
}

/**
 * Envia UM CNPJ ao formulário. Retorna true se o Google aceitou.
 * ⚠️ Hoje o formulário exige login (401 em POST anônimo) — mantido para o dia
 * em que a AIVA liberar resposta sem login. Ver blocoLinksPreCadastro.
 */
export async function enviarCnpjAoForm(cnpj: string): Promise<boolean> {
  const digits = (cnpj ?? '').replace(/\D/g, '')
  if (digits.length !== 14) {
    console.log(`[PRECAD_FORM] CNPJ inválido ignorado: "${cnpj}"`)
    return false
  }
  try {
    const body = new URLSearchParams({ [CAMPO_CNPJ]: digits })
    const res = await fetch(FORM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    // O Google responde 200 na página de confirmação (ou 302 pro /formResponse).
    const ok = res.ok || res.status === 302
    if (!ok) console.error(`[PRECAD_FORM] CNPJ ${digits} → HTTP ${res.status}`)
    return ok
  } catch (err) {
    console.error(`[PRECAD_FORM] Falha ao enviar CNPJ ${digits}:`, err)
    return false
  }
}

/**
 * Envia a lista completa de CNPJs do lead (matriz + adicionais), um por vez.
 * Devolve os que entraram com sucesso.
 */
export async function enviarCnpjsAoForm(params: {
  cnpjMatriz?: string | null
  cnpjsAdicionais?: string | null
  jaEnviados?: string[]
}): Promise<{ enviados: string[]; falharam: string[] }> {
  const lista = [
    ...extrairCnpjs(params.cnpjMatriz),
    ...extrairCnpjs(params.cnpjsAdicionais),
  ]
  const pendentes = [...new Set(lista)].filter((c) => !(params.jaEnviados ?? []).includes(c))

  const enviados: string[] = []
  const falharam: string[] = []
  for (const cnpj of pendentes) {
    const ok = await enviarCnpjAoForm(cnpj)
    if (ok) enviados.push(cnpj)
    else falharam.push(cnpj)
    await new Promise((r) => setTimeout(r, 400)) // um por vez, sem atropelar
  }
  return { enviados, falharam }
}
