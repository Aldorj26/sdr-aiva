/**
 * lib/clientes.ts
 *
 * Monta a lista de CLIENTES (aba Clientes do painel) a partir da Qualificação
 * Varejo. FONTE: Evo Talks, pipeline 15 (getPipeOpportunities) — a MESMA leitura
 * do Funil/briefing, que já traz `formsdata` (o formulário) + campos nativos
 * (state, city). SÓ LEITURA — não escreve em nada, não toca VictorIA/crons.
 *
 * Lista só as oportunidades com Qualificação Varejo preenchida (formsdata não vazio).
 */
import { selectAllAivaLeads } from '@/lib/supabase'
import { FORM_FIELD_MAP, STAGE_TO_STATUS } from '@/lib/evotalks'

const EVO_BASE = process.env.EVO_TALKS_BASE_URL!
const QUEUE_ID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const GLOBAL_KEY = process.env.EVO_TALKS_API_KEY ?? '2e8a5e207d7ea31ce4cd4430d3ee7c98'
const PIPELINE_AIVA = 15

const STAGE_LABEL: Record<string, string> = {
  INICIO: 'Início',
  INTERESSADO: 'Interessado',
  SEM_RESPOSTA: 'Sem Resposta',
  PRE_APROVACAO: 'Pré Aprovação',
  CADASTRO_RECEBIDO: 'Cadastro Recebido',
  EM_ANALISE_AIVA: 'Em Análise AIVA',
  TREINAR: 'Treinar',
  LOGIN: 'Login',
  LOJA_FINALIZADA_E_VENDENDO: 'Loja Finalizada e Vendendo',
  BOT_DETECTADO: 'Bot Detectado',
}

export interface ClienteRow {
  oppId: number
  leadId: string | null // id do lead no Supabase (pra abrir o drawer); null se não casar
  empresa: string
  socio: string
  telefone: string
  estado: string
  cidade: string
  etapa: string
  numeroLojas: string // texto cru exibido
  numeroLojasN: number | null // normalizado pra filtro
  faturamento: string
  faturamentoN: number | null
  valorCrediario: string
  valorCrediarioN: number | null
  cnpj: string
  regiao: string
  localizacao: string
  outraFinanceira: string
}

const campo = (forms: Record<string, unknown> | null | undefined, k: keyof typeof FORM_FIELD_MAP): string => {
  const v = forms?.[FORM_FIELD_MAP[k]]
  return v == null ? '' : String(v).trim()
}

/** Extrai o primeiro inteiro de um texto livre ("umas 3 lojas" → 3). */
function parseLojas(s: string): number | null {
  const m = s.replace(/\./g, '').match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

/**
 * Normaliza valor monetário em texto livre pra número (R$):
 * "R$ 500 mil" → 500000 · "2 milhões"/"2 mi" → 2000000 · "1,5 mi" → 1500000
 * "500.000" → 500000 · "uns 800k" → 800000. Retorna null se não der pra interpretar.
 */
function parseValor(raw: string): number | null {
  // NÃO remove espaços antes de detectar o sufixo — senão "1.5 mi" cola em "1.5mi"
  // e o sufixo deixa de casar (bug que fazia "1.5 mi" virar 2).
  const low = (raw || '').toLowerCase()
  const m = low.match(/[\d.,]+/)
  if (!m) return null
  let numStr = m[0]
  if (numStr.includes(',')) {
    // vírgula = decimal; pontos = milhar
    numStr = numStr.replace(/\./g, '').replace(',', '.')
  } else {
    // só pontos: se o ÚLTIMO grupo tem 3 dígitos, são separadores de milhar
    // (ex "150.000" = 150000, "1.500.000" = 1500000) → remove. Senão (1-2 dígitos),
    // é decimal (ex "1.5 mi") → mantém.
    const partes = numStr.split('.')
    if (partes.length > 1 && partes[partes.length - 1].length === 3) numStr = partes.join('')
  }
  const base = parseFloat(numStr)
  if (isNaN(base)) return null
  // Sufixo de magnitude — detectado no texto COM espaços. "milh" antes de "mil"
  // pra "milhão" não cair em mil. "mi"/"k" aceitam estar colados a dígito.
  let mult = 1
  if (/milh/.test(low) || /(^|[\d\s])mi\b/.test(low) || /\bmm\b|kk/.test(low)) mult = 1_000_000
  else if (/mil\b/.test(low) || /(^|[\d\s])k\b/.test(low)) mult = 1_000
  return Math.round(base * mult)
}

function canonFone(raw: string | null | undefined): string {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.startsWith('55')) d = d.slice(2)
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3)
  return d
}

// O campo nativo `state` da Evo vem VAZIO — então derivamos a UF do texto livre
// da localização (localizacao_lojas / regiao_varejo / city). Primeiro tenta achar
// a sigla (SP, RJ...), depois casa por nome de cidade. Cobertura parcial (a coleta
// é texto livre); quando não dá pra inferir, fica em branco.
const UF_RE = /\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/�/g, 'a').toLowerCase().trim()
}

const CIDADE_UF: Record<string, string> = {
  'sao paulo': 'SP', 'rio de janeiro': 'RJ', 'brasilia': 'DF', 'salvador': 'BA', 'fortaleza': 'CE',
  'belo horizonte': 'MG', 'manaus': 'AM', 'curitiba': 'PR', 'recife': 'PE', 'goiania': 'GO',
  'belem': 'PA', 'porto alegre': 'RS', 'guarulhos': 'SP', 'campinas': 'SP', 'sao luis': 'MA',
  'maceio': 'AL', 'natal': 'RN', 'teresina': 'PI', 'campo grande': 'MS', 'joao pessoa': 'PB',
  'aracaju': 'SE', 'cuiaba': 'MT', 'florianopolis': 'SC', 'vitoria': 'ES', 'porto velho': 'RO',
  'macapa': 'AP', 'rio branco': 'AC', 'boa vista': 'RR', 'palmas': 'TO', 'santo andre': 'SP',
  'sao bernardo do campo': 'SP', 'osasco': 'SP', 'sorocaba': 'SP', 'ribeirao preto': 'SP',
  'sao jose dos campos': 'SP', 'santos': 'SP', 'jundiai': 'SP', 'piracicaba': 'SP', 'bauru': 'SP',
  'ponta grossa': 'PR', 'londrina': 'PR', 'maringa': 'PR', 'cascavel': 'PR', 'foz do iguacu': 'PR',
  'caxias do sul': 'RS', 'pelotas': 'RS', 'canoas': 'RS', 'joinville': 'SC', 'blumenau': 'SC',
  'itajai': 'SC', 'chapeco': 'SC', 'criciuma': 'SC', 'uberlandia': 'MG', 'contagem': 'MG',
  'juiz de fora': 'MG', 'betim': 'MG', 'niteroi': 'RJ', 'duque de caxias': 'RJ', 'sao goncalo': 'RJ',
  'nova iguacu': 'RJ', 'feira de santana': 'BA', 'anapolis': 'GO', 'aparecida de goiania': 'GO',
}

function extractUF(...textos: string[]): string {
  for (const t of textos) {
    const m = (t || '').toUpperCase().match(UF_RE)
    if (m) return m[1]
  }
  for (const t of textos) {
    const n = norm(t)
    if (!n) continue
    for (const [cidade, uf] of Object.entries(CIDADE_UF)) {
      if (n === cidade || n.startsWith(cidade + ' ') || n.startsWith(cidade + '/') || n.startsWith(cidade + '-') || n.startsWith(cidade + ',')) return uf
    }
  }
  return ''
}

export async function fetchClientes(): Promise<ClienteRow[]> {
  const res = await fetch(`${EVO_BASE}/int/getPipeOpportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: GLOBAL_KEY, pipelineId: PIPELINE_AIVA }),
  })
  if (!res.ok) throw new Error(`getPipeOpportunities → ${res.status}`)
  const arr = (await res.json()) as Array<Record<string, unknown>>

  // só com Qualificação Varejo preenchida
  const comForm = arr.filter((o) => {
    const f = o.formsdata as Record<string, unknown> | null
    return f && Object.keys(f).length > 0
  })

  // mapa telefone→leadId (Supabase) pra abrir o drawer ao clicar.
  // Pagina TODOS os leads (o PostgREST corta em 1000 e o .limit não vence isso —
  // por isso antes a maioria das linhas não abria).
  const leadsRaw = await selectAllAivaLeads<{ id: string; telefone: string }>('id, telefone')
  const mapa = new Map<string, string>()
  for (const l of leadsRaw) mapa.set(canonFone(l.telefone), l.id)

  const rows: ClienteRow[] = comForm.map((o) => {
    const forms = (o.formsdata ?? {}) as Record<string, unknown>
    const telefone = String(o.mainphone ?? '')
    const numeroLojas = campo(forms, 'numero_lojas')
    const faturamento = campo(forms, 'faturamento_anual')
    const valorCrediario = campo(forms, 'valor_boleto_mensal')
    const statusKey = STAGE_TO_STATUS[Number(o.fkStage)] ?? ''
    return {
      oppId: Number(o.id ?? 0),
      leadId: mapa.get(canonFone(telefone)) ?? null,
      empresa: (String(o.title ?? '') || campo(forms, 'nome_varejo') || 'Sem nome').replace(/\s*—\s*AIVA\s*$/i, '').trim(),
      socio: campo(forms, 'nome_socio'),
      telefone,
      estado: extractUF(campo(forms, 'localizacao_lojas'), campo(forms, 'regiao_varejo'), String(o.city ?? '')),
      cidade: String(o.city ?? '').trim() || campo(forms, 'regiao_varejo'),
      etapa: STAGE_LABEL[statusKey] ?? (statusKey || '—'),
      numeroLojas,
      numeroLojasN: parseLojas(numeroLojas),
      faturamento,
      faturamentoN: parseValor(faturamento),
      valorCrediario,
      valorCrediarioN: parseValor(valorCrediario),
      cnpj: campo(forms, 'cnpj_matriz'),
      regiao: campo(forms, 'regiao_varejo'),
      localizacao: campo(forms, 'localizacao_lojas'),
      outraFinanceira: campo(forms, 'possui_outra_financeira'),
    }
  })

  // ordena por empresa
  rows.sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'))
  return rows
}
