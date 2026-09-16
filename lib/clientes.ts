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
  cidade: string
  etapa: string
  numeroLojas: string // texto cru exibido
  numeroLojasN: number | null // normalizado pra filtro
  cnpj: string
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

function canonFone(raw: string | null | undefined): string {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.startsWith('55')) d = d.slice(2)
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3)
  return d
}

// O campo nativo `state` da Evo vem VAZIO — então derivamos a UF do texto livre
// da localização (localizacao_lojas / regiao_varejo / city). Primeiro tenta achar
// a sigla (SP, RJ...), depois casa por nome de cidade. Cobertura parcial (a coleta
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
    const statusKey = STAGE_TO_STATUS[Number(o.fkStage)] ?? ''
    return {
      oppId: Number(o.id ?? 0),
      leadId: mapa.get(canonFone(telefone)) ?? null,
      empresa: (String(o.title ?? '') || campo(forms, 'nome_varejo') || 'Sem nome').replace(/\s*—\s*AIVA\s*$/i, '').trim(),
      socio: campo(forms, 'nome_socio'),
      telefone,
      // regiao_varejo é preenchido pelo sistema com o município da Receita
      // (16/09/2026) — a cidade continua vindo daí quando a opp não tem `city`.
      cidade: String(o.city ?? '').trim() || campo(forms, 'regiao_varejo'),
      etapa: STAGE_LABEL[statusKey] ?? (statusKey || '—'),
      numeroLojas,
      numeroLojasN: parseLojas(numeroLojas),
      cnpj: campo(forms, 'cnpj_matriz'),
    }
  })

  // ordena por empresa
  rows.sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'))
  return rows
}
