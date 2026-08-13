/**
 * lib/pipeline-briefing.ts
 *
 * Builder do briefing do PIPELINE AIVA (texto único). Usado por:
 *  - app/api/sdr/briefing-pipeline/route.ts (cron 5h BRT → manda pra Aldo+Nei)
 *  - lib/admin-commands.ts (/pipeline → retorna sob demanda no WhatsApp)
 *
 * FONTE ÚNICA: Evo Talks (pipeline 15). Tempo "parado" = tempo na ETAPA
 * (stagebegintime), não última mensagem. "Aguardando humano" vem do Supabase
 * (flag acionar_humano).
 */
import { supabaseAdmin } from '@/lib/supabase'

const EVO_BASE = process.env.EVO_TALKS_BASE_URL!
const QUEUE_ID = Number(process.env.EVO_TALKS_QUEUE_ID ?? 10)
const GLOBAL_KEY = process.env.EVO_TALKS_GLOBAL_API_KEY ?? '2e8a5e207d7ea31ce4cd4430d3ee7c98'
const PIPELINE_AIVA = 15

const STAGES_ORDER: Array<{ id: number; nome: string; emoji: string }> = [
  { id: 66, nome: 'Inicio',                     emoji: '🆕' },
  { id: 47, nome: 'Interessado',                emoji: '💬' },
  { id: 53, nome: 'Sem Resposta',               emoji: '📭' },
  { id: 54, nome: 'Pré Aprovação',              emoji: '⏳' },
  { id: 49, nome: 'Cadastro Recebido',          emoji: '✅' },
  { id: 50, nome: 'Em Análise AIVA',            emoji: '🔍' },
  { id: 70, nome: 'Treinar',                    emoji: '🎓' },
  { id: 71, nome: 'Login',                      emoji: '🔑' },
  { id: 51, nome: 'Loja Finalizada e Vendendo', emoji: '🛍' },
  { id: 69, nome: 'Bot Detectado',              emoji: '🤖' },
]

const STAGE_PRE_APROVACAO = 54
const STAGE_CADASTRO_RECEBIDO = 49
const STAGE_EM_ANALISE = 50

const NOMES_DIA = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO']

export function brtNow() {
  const now = new Date()
  const brtDate = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const dia = brtDate.getUTCDay()
  const dd = String(brtDate.getUTCDate()).padStart(2, '0')
  const mm = String(brtDate.getUTCMonth() + 1).padStart(2, '0')
  return { dia, data: `${dd}/${mm}`, nomeDia: NOMES_DIA[dia] ?? 'DIA' }
}

export interface OppFromEvo {
  id: number
  fkStage: number
  title: string
  mainphone: string
  stagebegintime: number
  createdAt: string
  tags: number[]
}

export async function fetchOpps(): Promise<OppFromEvo[]> {
  const res = await fetch(`${EVO_BASE}/int/getPipeOpportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: GLOBAL_KEY, pipelineId: PIPELINE_AIVA }),
  })
  if (!res.ok) throw new Error(`getPipeOpportunities → ${res.status}`)
  return res.json()
}

function horasNaEtapa(stagebegintime: number): number {
  if (!stagebegintime) return 0
  return Math.floor((Date.now() / 1000 - stagebegintime) / 3600)
}

function fmtTempo(horas: number): string {
  if (horas < 48) return `${horas}h na etapa`
  return `${Math.floor(horas / 24)}d na etapa`
}

function nomeOpp(title: string): string {
  return (title || '').replace(/\s*—\s*AIVA\s*$/i, '').trim().slice(0, 32) || 'Sem nome'
}

function listaOpps(opps: OppFromEvo[]): string[] {
  const ordenadas = [...opps].sort((a, b) => (a.stagebegintime || 0) - (b.stagebegintime || 0))
  const top = ordenadas.slice(0, 6).map(
    (o) => `• ${nomeOpp(o.title)} (${o.mainphone || '?'}) — ${fmtTempo(horasNaEtapa(o.stagebegintime))}`
  )
  if (ordenadas.length > 6) top.push(`...e mais ${ordenadas.length - 6}`)
  return top
}

async function contarAguardandoHumano(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('sdr_leads')
    .select('id', { count: 'exact', head: true })
    .eq('produto', 'AIVA')
    .eq('acionar_humano', true)
    .not('status', 'in', '("OPT_OUT","NAO_QUALIFICADO","DESCARTADO","BOT_DETECTADO")')
  return count ?? 0
}

function montarMensagem(opps: OppFromEvo[], aguardandoHumano: number): string {
  const { data, nomeDia } = brtNow()
  const total = opps.length
  const stageCount = new Map<number, number>()
  for (const o of opps) stageCount.set(o.fkStage, (stageCount.get(o.fkStage) ?? 0) + 1)

  const linhas: string[] = [
    `☀️ Bom dia! Aqui é a Victoria, da AIVA.`,
    ``,
    `📊 *Pipeline AIVA — ${nomeDia} ${data}*`,
    `Total no funil: *${total}*`,
    ``,
  ]

  for (const stage of STAGES_ORDER) {
    const qtd = stageCount.get(stage.id) ?? 0
    if (qtd > 0) linhas.push(`${stage.emoji} ${stage.nome}: *${qtd}*`)
  }

  if (aguardandoHumano > 0) {
    linhas.push(``, `🙋 *Aguardando atendimento humano: ${aguardandoHumano}*`)
  }

  const preAprov = opps.filter((o) => o.fkStage === STAGE_PRE_APROVACAO)
  const cadastro = opps.filter((o) => o.fkStage === STAGE_CADASTRO_RECEBIDO)
  const emAnalise = opps.filter((o) => o.fkStage === STAGE_EM_ANALISE)

  if (preAprov.length > 0 || cadastro.length > 0 || emAnalise.length > 0) {
    linhas.push(``, `⚠️ *Ação necessária — Nei:*`)

    if (preAprov.length > 0) {
      linhas.push(``, `📋 *Aguardando análise (Pré Aprovação) — ${preAprov.length}:*`, ...listaOpps(preAprov))
    }
    if (cadastro.length > 0) {
      linhas.push(``, `✅ *Cadastro Recebido — mover p/ Em Análise AIVA — ${cadastro.length}:*`, ...listaOpps(cadastro))
    }
    if (emAnalise.length > 0) {
      linhas.push(``, `🔍 *Em Análise AIVA — concluir — ${emAnalise.length}:*`, ...listaOpps(emAnalise))
    }
  }

  const inicioHojeMs = (() => {
    const d = new Date(Date.now() - 3 * 3600 * 1000)
    d.setUTCHours(3, 0, 0, 0)
    return d.getTime()
  })()
  const novosHoje = opps.filter((o) => o.createdAt && new Date(o.createdAt).getTime() >= inicioHojeMs).length
  if (novosHoje > 0) {
    linhas.push(``, `🆕 ${novosHoje} novos leads disparados hoje`)
  }

  return linhas.join('\n')
}

const PAINEL_URL = process.env.PAINEL_URL ?? 'https://sdr-agente.vercel.app'

/**
 * Resumo COMPACTO de uma linha (sem \n) pra caber na variável de um template HSM.
 *
 * POR QUE EXISTE: o briefing detalhado vai como texto livre, que só entrega se a
 * janela de 24h do WhatsApp estiver ABERTA. Um template (HSM) disparado pela
 * empresa NÃO reabre essa janela — só uma mensagem do cliente abre. Às 5h o Aldo
 * normalmente não mandou nada nas 24h anteriores → janela fechada → o texto livre
 * é descartado silenciosamente pela Meta. Então o que importa de verdade (os
 * números) vai DENTRO do HSM, que entrega sempre.
 *
 * Renderiza depois de "Olá {nome}, " no corpo do template de reabertura.
 */
function montarResumoCompacto(opps: OppFromEvo[], aguardandoHumano: number): string {
  const { data, nomeDia } = brtNow()
  const total = opps.length
  const preAprov = opps.filter((o) => o.fkStage === STAGE_PRE_APROVACAO).length
  const cadastro = opps.filter((o) => o.fkStage === STAGE_CADASTRO_RECEBIDO).length
  const emAnalise = opps.filter((o) => o.fkStage === STAGE_EM_ANALISE).length

  const partes = [
    `aqui é a Victoria 📊 Pipeline AIVA ${nomeDia} ${data}`,
    `Funil: ${total}`,
    `Pré-aprovação: ${preAprov}`,
    `Cadastro recebido p/ mover: ${cadastro}`,
    `Em análise: ${emAnalise}`,
    `Aguardando humano: ${aguardandoHumano}`,
  ]
  return `${partes.join(' | ')}. 👉 Responda aqui (qualquer coisa) que eu te mando o pipeline completo, etapa por etapa. Ou veja por loja em ${PAINEL_URL}/funil`
}

/**
 * Monta o briefing em DOIS formatos a partir de UMA única leitura do funil:
 *  - detalhado: texto livre completo (montarMensagem) — bônus, depende da janela.
 *  - compacto: 1 linha pra variável de HSM — entrega garantida.
 */
export async function buildBriefingCompleto(): Promise<{ detalhado: string; compacto: string }> {
  const opps = await fetchOpps()
  const aguardandoHumano = await contarAguardandoHumano()
  return {
    detalhado: montarMensagem(opps, aguardandoHumano),
    compacto: montarResumoCompacto(opps, aguardandoHumano),
  }
}

/** Monta o texto completo do briefing do pipeline AIVA (não envia). Usado pelo /pipeline admin. */
export async function buildBriefingPipeline(): Promise<string> {
  return (await buildBriefingCompleto()).detalhado
}

/** Destinos do briefing diário (Aldo + Nei). */
export function briefingDestinos(): string[] {
  return [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean) as string[]
}

// ─── Follow-up do briefing: "responda pra receber o detalhado" ──────────────────
// Às 5h o HSM compacto entrega sempre, mas o detalhado (texto livre, multi-linha)
// só entra com a janela 24h ABERTA — e o HSM NÃO abre a janela. A resposta do
// admin abre. Então guardamos o detalhado do dia; quando o admin responde, o
// webhook dispara este texto (já com a janela aberta pela resposta dele).

function canonTel(raw: string): string {
  let d = (raw ?? '').replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') d = d.slice(0, 4) + d.slice(5)
  return d
}

function hojeBRT(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

/** Guarda o briefing detalhado do dia pra um destino (chamado pelo cron das 5h). */
export async function salvarBriefingFollowup(telefone: string, detalhado: string): Promise<void> {
  await supabaseAdmin
    .from('briefing_followup')
    .upsert(
      { telefone: canonTel(telefone), data: hojeBRT(), detalhado, enviado: false, criado_em: new Date().toISOString() },
      { onConflict: 'telefone,data' },
    )
}

/**
 * Consome (atômico) o briefing detalhado pendente de hoje pra este admin.
 * Retorna o texto na PRIMEIRA resposta do dia e marca como enviado; depois → null.
 */
export async function consumirBriefingFollowup(telefone: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('briefing_followup')
    .update({ enviado: true })
    .eq('telefone', canonTel(telefone))
    .eq('data', hojeBRT())
    .eq('enviado', false)
    .select('detalhado')
    .maybeSingle()
  return (data?.detalhado as string | undefined) ?? null
}
