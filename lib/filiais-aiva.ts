/**
 * lib/filiais-aiva.ts — a linha da FILIAL na aba Filiais da planilha (Aldo 18/09/2026).
 *
 * POR QUE EXISTE: até hoje, filial nova virava linha na mão. O Nei juntava o CNPJ
 * que o lojista mandou, procurava o endereço, copiava CPF e e-mail do sócio e
 * digitava tudo na planilha — e o modelo do Mauricio pede CEP, logradouro, número,
 * complemento e bairro, que a gente NÃO coleta no chat. Agora a linha nasce sozinha
 * quando o CNPJ da filial entra na conversa.
 *
 * Cidade/UF e a situação cadastral vêm da RECEITA pelo CNPJ da filial (BrasilAPI,
 * a mesma fonte que o fluxo já usa pra validar CNPJ) — ninguém procura no Google.
 * A situação irregular (INAPTA/BAIXADA/SUSPENSA) cai sozinha na coluna Pendencias,
 * que é onde o Nei olha antes de lançar.
 *
 * ⚠️ CPF do operador é o único campo que o fluxo não tem de onde tirar: a gente não
 * pede CPF em fase nenhuma. A linha sai com ele EM BRANCO e o alerta diz isso —
 * é o último campo manual. Se um dia o Aldo mandar a VictorIA perguntar, é só
 * passar `cpf` aqui.
 *
 * A ordem das colunas é a que o Aldo definiu pra aba (COLUNAS_FILIAL_AIVA):
 * mexer nela muda o que o Apps Script escreve, que só faz append na ordem do array.
 */

/** Cabeçalho da aba Filiais — sequência definida pelo Aldo em 18/09/2026.
 *  ⚠️ Mexer aqui muda a ordem das colunas que o Apps Script escreve na planilha:
 *  ele faz appendRow com o array na ordem DESTA lista, sem conferir cabeçalho. */
export const COLUNAS_FILIAL_AIVA = [
  'Loja', 'Cidade/UF', 'CNPJ da Filial', 'CNPJ da Matriz', 'ID Varejo (da API)',
  'Operador', 'CPF', 'E-mail', 'Telefone', 'Pendencias',
] as const

export type EnderecoReceita = {
  cep?: string | null
  logradouro?: string | null
  numero?: string | number | null
  complemento?: string | null
  bairro?: string | null
  municipio?: string | null
  uf?: string | null
  razao_social?: string | null
  nome_fantasia?: string | null
  descricao_situacao_cadastral?: string | null
}

export type DadosFilial = {
  cnpjFilial: string
  cnpjMatriz?: string | null
  nomeLoja?: string | null
  nomeOperador?: string | null
  cpf?: string | null
  email?: string | null
  telefone?: string | null
  idVarejo?: string | null
  receita?: EnderecoReceita | null
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/**
 * Telefone no formato que o modelo pede: 55 + DDD + número, só dígitos.
 * O que chega da conversa já vem assim (o Evo entrega 55DDD…), mas número
 * digitado pelo lojista pode vir sem o 55 — aí a gente põe.
 */
export function telefone55(bruto: unknown): string {
  const d = soDigitos(bruto)
  if (!d) return ''
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d   // fora do padrão: devolve como veio, o alerta sinaliza
}

/** Cidade/UF numa coluna só, como a planilha usa ("Paracatu/MG"). */
export function cidadeUf(r: EnderecoReceita | null | undefined): string {
  const c = String(r?.municipio ?? '').trim()
  const u = String(r?.uf ?? '').trim()
  return c && u ? `${c}/${u}` : c || u || ''
}

/** O que falta (ou o que cheira mal) na linha — vira a coluna Pendencias.
 *  É a coluna que o Nei lê pra saber o que conferir antes de lançar. */
export function pendenciasDaLinha(d: DadosFilial, receitaOk: boolean): string[] {
  const p: string[] = []
  const sit = String(d.receita?.descricao_situacao_cadastral ?? '').toUpperCase()
  if (!receitaOk) p.push('CNPJ não encontrado na Receita — conferir o número com o lojista')
  else if (sit && sit !== 'ATIVA') p.push(`CNPJ ${sit} na Receita — a AIVA reprova`)
  if (!soDigitos(d.cpf)) p.push('falta CPF do operador (o fluxo não coleta CPF)')
  else if (soDigitos(d.cpf).length !== 11) p.push(`CPF com ${soDigitos(d.cpf).length} dígitos`)
  if (!(d.nomeOperador ?? '').trim()) p.push('falta o nome do operador')
  if (!(d.email ?? '').trim()) p.push('falta o e-mail do sócio')
  if (!soDigitos(d.cnpjMatriz)) p.push('falta o CNPJ da matriz')
  const tel = telefone55(d.telefone)
  if (!tel) p.push('falta telefone')
  else if (!(tel.startsWith('55') && (tel.length === 12 || tel.length === 13))) p.push(`telefone fora do padrão 55DDD… (${tel})`)
  return p
}

/** Monta a linha na ORDEM das colunas da planilha. Campo sem dado vai vazio —
 *  nunca inventado: isso vira cadastro de loja de verdade na AIVA. */
export function montarLinhaFilial(d: DadosFilial): Record<string, string> {
  const r = d.receita ?? null
  return {
    'Loja': (d.nomeLoja ?? '').trim() || String(r?.nome_fantasia ?? r?.razao_social ?? ''),
    'Cidade/UF': cidadeUf(r),
    'CNPJ da Filial': soDigitos(d.cnpjFilial),
    'CNPJ da Matriz': soDigitos(d.cnpjMatriz),
    'ID Varejo (da API)': String(d.idVarejo ?? ''),
    'Operador': (d.nomeOperador ?? '').trim(),
    'CPF': soDigitos(d.cpf),
    'E-mail': (d.email ?? '').trim(),
    'Telefone': telefone55(d.telefone),
    'Pendencias': pendenciasDaLinha(d, !!r).join('; '),
  }
}

/** Endereço da Receita pelo CNPJ. Best-effort: devolve null se a API recusar —
 *  a linha sai sem endereço e a pendência aparece no alerta. */
export async function enderecoDaReceita(cnpj: string): Promise<EnderecoReceita | null> {
  const c = soDigitos(cnpj)
  if (c.length !== 14) return null
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${c}`, {
      headers: { accept: 'application/json', 'user-agent': 'sdr-aiva/1.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn(`[FILIAL_AIVA] Receita ${res.status} para ${c}`)
      return null
    }
    return (await res.json()) as EnderecoReceita
  } catch (e) {
    console.warn(`[FILIAL_AIVA] Receita falhou para ${c}:`, e)
    return null
  }
}

/** Marcador de idempotência no lead: uma linha por CNPJ, para sempre. */
export const marcadorFilial = (cnpj: string) => `[FILIAL_AIVA:${soDigitos(cnpj)}]`
