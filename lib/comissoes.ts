/**
 * lib/comissoes.ts — parser das planilhas de comissão da UME + conferência
 * contra o funil 11 (Contas fechadas MRR).
 *
 * Formato validado com a planilha real de julho/26 (aba RESUMO):
 *   linhas 0–7: cabeçalho (Parceiro, Competência, Total Contratos/Originação/
 *   MDR/Comissão); depois o header RETAILER ID | CNPJ | VAREJO | GRUPO |
 *   CONTRATOS | ORIGINAÇÃO | MDR | COMISSÃO; linhas de dados intercaladas com
 *   "▸ GRUPO", "Subtotal ..." e "TOTAL GERAL". FCDL vem em arquivo próprio,
 *   mesmo layout.
 *
 * Spec: docs/superpowers/specs/2026-08-26-painel-comissoes-design.md
 */
import * as XLSX from 'xlsx'

/** Grupos comerciais com emissão AIVA — lista da Mayte (UME) em 17/08/2026. */
export const AIVA_GRUPOS = new Set([
  'INSIDE_SALES',
  'COMM',
  'MIDDLE_REALME_ES',
  'REALME_CURITIBA',
  'VAREJO_MAIS',
  'VOCE_PONTO_COM',
])

export type OrigemComissao = 'carteira' | 'fcdl'

export interface LinhaComissao {
  retailer_id: number | null
  cnpj: string | null
  varejo: string | null
  grupo: string | null
  contratos: number | null
  originacao: number | null
  mdr: number | null
  comissao: number | null
}

export interface MetaComissao {
  total_contratos: number | null
  total_originacao: number | null
  total_mdr: number | null
  total_comissao: number | null
}

export interface PlanilhaUme {
  mes: string // 'YYYY-MM'
  origem: OrigemComissao
  linhas: LinhaComissao[]
  meta: MetaComissao
  /** Preenchido quando a soma das linhas diverge do total declarado (delta pequeno). */
  aviso: string | null
}

const MESES_PT: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04',
  maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09',
  outubro: '10', novembro: '11', dezembro: '12',
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** CNPJ vem como número na planilha — zeros à esquerda somem. Restaura. */
const cnpj14 = (v: unknown): string | null => {
  if (v == null || v === '') return null
  const d = String(typeof v === 'number' ? Math.round(v) : v).replace(/\D/g, '')
  if (!d) return null
  return d.padStart(14, '0').slice(-14)
}

/**
 * Parseia uma planilha de apuração da UME (Carteira ou FCDL).
 * Lança Error com mensagem legível quando o formato não bate ou a soma das
 * linhas diverge do total declarado no cabeçalho (planilha truncada/editada).
 */
export function parsePlanilhaUme(buf: Buffer | ArrayBuffer, nomeArquivo: string): PlanilhaUme {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? 'array' : 'buffer' })
  const nomeAba = wb.SheetNames.find((n) => n.toUpperCase() === 'RESUMO') ?? wb.SheetNames[0]
  const ws = wb.Sheets[nomeAba]
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

  // ── mês pela linha "Competência" ("Julho 2026" → '2026-07')
  let mes = ''
  for (const r of rows.slice(0, 12)) {
    if (String(r?.[0] ?? '').trim().toLowerCase() !== 'competência') continue
    const m = String(r?.[1] ?? '').trim().toLowerCase().match(/^([a-zç]+)[\s/de]*(\d{4})$/)
    if (m && MESES_PT[m[1]]) mes = `${m[2]}-${MESES_PT[m[1]]}`
  }
  if (!mes) throw new Error('Não achei a linha "Competência" com mês/ano no cabeçalho da planilha.')

  const origem: OrigemComissao = /fcdl/i.test(nomeArquivo) ? 'fcdl' : 'carteira'

  // ── totais declarados no cabeçalho
  const meta: MetaComissao = { total_contratos: null, total_originacao: null, total_mdr: null, total_comissao: null }
  for (const r of rows.slice(0, 12)) {
    const rot = String(r?.[0] ?? '').trim().toLowerCase()
    if (rot === 'total contratos') meta.total_contratos = num(r[1])
    if (rot === 'total originação') meta.total_originacao = num(r[1])
    if (rot === 'total mdr') meta.total_mdr = num(r[1])
    if (rot === 'total comissão') meta.total_comissao = num(r[1])
  }

  // ── header da tabela
  const iHeader = rows.findIndex((r) => String(r?.[0] ?? '').trim().toUpperCase() === 'RETAILER ID')
  if (iHeader < 0) throw new Error('Não achei o cabeçalho "RETAILER ID | CNPJ | VAREJO | ..." na planilha.')

  const linhas: LinhaComissao[] = []
  for (const r of rows.slice(iHeader + 1)) {
    const c0 = r?.[0]
    const grupoCell = String(r?.[3] ?? '')
    // pula grupos ("▸ X" na col 0), subtotais (col 3), total geral e vazias
    if (typeof c0 === 'string' && c0.trim().startsWith('▸')) continue
    if (/^subtotal/i.test(grupoCell.trim()) && num(c0) == null) continue
    if (/total geral/i.test(grupoCell)) continue
    if (num(c0) == null && cnpj14(r?.[1]) == null) continue
    linhas.push({
      retailer_id: num(c0) != null ? Math.round(num(c0)!) : null,
      cnpj: cnpj14(r?.[1]),
      varejo: r?.[2] != null ? String(r[2]).trim() : null,
      grupo: r?.[3] != null ? String(r[3]).trim() : null,
      contratos: num(r?.[4]) != null ? Math.round(num(r?.[4])!) : null,
      originacao: num(r?.[5]),
      mdr: num(r?.[6]),
      comissao: num(r?.[7]),
    })
  }
  if (!linhas.length) throw new Error('Nenhuma linha de varejo encontrada abaixo do cabeçalho.')

  // ── validação: soma das linhas × total declarado.
  // A planilha real de julho/26 tem inconsistência INTERNA da própria UME:
  // linhas somam 39.697,90 mas o Total declarado (e o TOTAL GERAL) dizem
  // 39.704,92 — delta de R$ 7,02 que não é truncamento nosso. Então: delta
  // pequeno importa e AVISA (o painel mostra); delta grande (> R$ 50 ou
  // > 0,5% do total) = planilha truncada/editada → recusa.
  let aviso: string | null = null
  if (meta.total_comissao != null) {
    const soma = linhas.reduce((s, l) => s + (l.comissao ?? 0), 0)
    const delta = soma - meta.total_comissao
    const limite = Math.max(50, meta.total_comissao * 0.005)
    if (Math.abs(delta) > limite) {
      throw new Error(
        `Soma das linhas (R$ ${soma.toFixed(2)}) não bate com o Total Comissão declarado ` +
        `(R$ ${meta.total_comissao.toFixed(2)}) — delta R$ ${delta.toFixed(2)}. ` +
        `Planilha truncada ou editada? Import recusado.`,
      )
    }
    if (Math.abs(delta) > 0.05) {
      aviso =
        `Planilha com diferença interna da UME: linhas somam R$ ${soma.toFixed(2)}, ` +
        `total declarado R$ ${meta.total_comissao.toFixed(2)} (delta R$ ${delta.toFixed(2)}). ` +
        `Importado mesmo assim — vale conferir com a UME.`
    }
  }

  return { mes, origem, linhas, meta, aviso }
}

/** Extrai UME_RID e CNPJ da descrição de uma opp do funil 11. */
export function parseDescricaoOpp(desc: string | null | undefined): { umeRid: number | null; cnpj: string | null } {
  const d = desc ?? ''
  const rid = d.match(/UME_RID:\s*(\d+)/i)?.[1]
  const cnpj = d.match(/CNPJ:\s*(\d{14})/i)?.[1]
  return { umeRid: rid ? Number(rid) : null, cnpj: cnpj ?? null }
}

// ── Conferência ───────────────────────────────────────────────────────────────

export type EstadoConferencia = 'comissionada' | 'sem_venda' | 'sem_rid' | 'so_relatorio'

export interface ContaFunil11 {
  id: number
  title: string
  mainphone: string
  description: string
}

export interface DesempenhoMes {
  cnpj: string
  aprovados: number | null
  vendas: number | null
  valor_vendas: number | null
}

export interface LinhaConferencia {
  estado: EstadoConferencia
  /** Divergência real: sem comissão no mês MAS Data Studio mostra vendas > 0. */
  divergencia: boolean
  /** Casou por CNPJ (sem UME_RID) → candidata ao botão "gravar Retailer ID". */
  casouPorCnpj: boolean
  opp: ContaFunil11 | null
  umeRid: number | null
  cnpj: string | null
  relatorio: LinhaComissao | null
  desempenho: DesempenhoMes | null
}

/**
 * Cruza as contas do funil 11 com as linhas do relatório do mês e o snapshot
 * de desempenho (Data Studio). Regra de negócio alinhada com a UME (Gerisson,
 * 19/08): loja fora do relatório = sem venda no mês — estado, não erro.
 */
export function conferir(
  contas: ContaFunil11[],
  linhasMes: LinhaComissao[],
  desempenhoMes: DesempenhoMes[],
): LinhaConferencia[] {
  const porRid = new Map<number, LinhaComissao>()
  const porCnpj = new Map<string, LinhaComissao>()
  for (const l of linhasMes) {
    if (l.retailer_id != null) porRid.set(l.retailer_id, l)
    if (l.cnpj) porCnpj.set(l.cnpj, l)
  }
  const desempPorCnpj = new Map(desempenhoMes.map((d) => [d.cnpj, d]))

  const usadas = new Set<LinhaComissao>()
  const out: LinhaConferencia[] = []

  for (const opp of contas) {
    const { umeRid, cnpj } = parseDescricaoOpp(opp.description)
    let rel: LinhaComissao | null = null
    let casouPorCnpj = false
    if (umeRid != null && porRid.has(umeRid)) rel = porRid.get(umeRid)!
    else if (cnpj && porCnpj.has(cnpj)) { rel = porCnpj.get(cnpj)!; casouPorCnpj = umeRid == null }
    if (rel) usadas.add(rel)

    const estado: EstadoConferencia =
      rel ? 'comissionada' : umeRid != null ? 'sem_venda' : 'sem_rid'
    const desempenho = cnpj ? (desempPorCnpj.get(cnpj) ?? null) : null
    const divergencia = !rel && (desempenho?.vendas ?? 0) > 0
    out.push({ estado, divergencia, casouPorCnpj, opp, umeRid, cnpj, relatorio: rel, desempenho })
  }

  // linhas do relatório que não casaram com conta nenhuma
  for (const l of linhasMes) {
    if (usadas.has(l)) continue
    out.push({
      estado: 'so_relatorio', divergencia: false, casouPorCnpj: false,
      opp: null, umeRid: l.retailer_id, cnpj: l.cnpj, relatorio: l,
      desempenho: l.cnpj ? (desempPorCnpj.get(l.cnpj) ?? null) : null,
    })
  }
  return out
}
