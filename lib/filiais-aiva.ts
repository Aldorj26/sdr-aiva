/**
 * lib/filiais-aiva.ts — a linha da FILIAL no modelo padrão da AIVA (Aldo 18/09/2026).
 *
 * POR QUE EXISTE: até hoje, filial nova virava linha na mão. O Nei juntava o CNPJ
 * que o lojista mandou, procurava o endereço, copiava CPF e e-mail do sócio e
 * digitava tudo na planilha — e o modelo do Mauricio pede CEP, logradouro, número,
 * complemento e bairro, que a gente NÃO coleta no chat. Agora a linha nasce sozinha
 * quando o CNPJ da filial entra na conversa.
 *
 * O endereço vem da RECEITA pelo CNPJ da filial (BrasilAPI, a mesma fonte que o
 * fluxo já usa pra validar CNPJ) — ninguém digita endereço.
 *
 * ⚠️ CPF do operador é o único campo que o fluxo não tem de onde tirar: a gente não
 * pede CPF em fase nenhuma. A linha sai com ele EM BRANCO e o alerta diz isso —
 * é o último campo manual. Se um dia o Aldo mandar a VictorIA perguntar, é só
 * passar `cpf` aqui.
 *
 * As 15 colunas e a grafia delas são as do Mauricio: mexer aqui quebra o colar
 * na aba Filiais, que espera essa ordem exata.
 */

/** Cabeçalho oficial da aba Filiais — ordem e grafia do modelo da AIVA. */
export const COLUNAS_FILIAL_AIVA = [
  'ID VAREJO', 'NOME DA LOJA', 'CEP', 'LOGRADOURO', 'NÚMERO', 'COMPLEMENTO', 'BAIRRO',
  'CIDADE', 'UF', 'CNPJ DA FILIAL', 'CNPJ DA MATRIZ', 'NOME COMPLETO', 'CPF (SÓ NUMEROS)',
  'EMAIL', 'TELEFONE (FORMATADO 55DDDTELEFONE)',
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

/** Monta a linha na ORDEM das colunas do modelo. Campo sem dado vai vazio — nunca
 *  inventado: a AIVA usa isso pra cadastrar loja de verdade. */
export function montarLinhaFilial(d: DadosFilial): Record<string, string> {
  const r = d.receita ?? null
  const [cidadeFallback, ufFallback] = ['', '']
  const linha: Record<string, string> = {
    'ID VAREJO': String(d.idVarejo ?? ''),
    'NOME DA LOJA': (d.nomeLoja ?? '').trim() || String(r?.nome_fantasia ?? r?.razao_social ?? ''),
    'CEP': soDigitos(r?.cep),
    'LOGRADOURO': String(r?.logradouro ?? ''),
    'NÚMERO': String(r?.numero ?? ''),
    'COMPLEMENTO': String(r?.complemento ?? ''),
    'BAIRRO': String(r?.bairro ?? ''),
    'CIDADE': String(r?.municipio ?? cidadeFallback),
    'UF': String(r?.uf ?? ufFallback),
    'CNPJ DA FILIAL': soDigitos(d.cnpjFilial),
    'CNPJ DA MATRIZ': soDigitos(d.cnpjMatriz),
    'NOME COMPLETO': (d.nomeOperador ?? '').trim(),
    'CPF (SÓ NUMEROS)': soDigitos(d.cpf),
    'EMAIL': (d.email ?? '').trim(),
    'TELEFONE (FORMATADO 55DDDTELEFONE)': telefone55(d.telefone),
  }
  return linha
}

/** O que falta pra linha poder ser enviada à AIVA. Vazio = pronta. */
export function pendenciasDaLinha(l: Record<string, string>, receitaOk: boolean): string[] {
  const p: string[] = []
  if (!receitaOk) p.push('endereço não veio da Receita (CNPJ novo demais ou API fora) — preencher CEP/logradouro/número/bairro')
  if (!l['CPF (SÓ NUMEROS)']) p.push('CPF do operador (o fluxo não coleta CPF — preencher na mão)')
  else if (l['CPF (SÓ NUMEROS)'].length !== 11) p.push(`CPF com ${l['CPF (SÓ NUMEROS)'].length} dígitos`)
  if (!l['NOME COMPLETO']) p.push('nome completo do operador')
  if (!l['EMAIL']) p.push('e-mail do sócio')
  if (!l['NOME DA LOJA']) p.push('nome da loja')
  if (!l['CNPJ DA MATRIZ']) p.push('CNPJ da matriz')
  const tel = l['TELEFONE (FORMATADO 55DDDTELEFONE)']
  if (!tel) p.push('telefone')
  else if (!(tel.startsWith('55') && (tel.length === 12 || tel.length === 13))) p.push(`telefone fora do padrão 55DDD… (${tel})`)
  return p
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
