const BASE_URL = process.env.EVO_TALKS_BASE_URL!
const QUEUE_ID = Number(process.env.EVO_TALKS_QUEUE_ID!)
const QUEUE_API_KEY = process.env.EVO_TALKS_QUEUE_API_KEY!

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface OpenChatResult {
  chatId: string | number
  clientId: string | number
  ok: boolean
}

export interface EnqueueResult {
  enqueuedId: number
}

export interface ChatDetail {
  chatId: string | number
  clientId: string | number
  number?: string
  name?: string
  status?: string
}

export interface IncomingMessage {
  kId: number
  mId?: string
  chatId: string | number
  clientId: string | number
  queueId: number
  direction: 'in' | 'out' | 'system-info' | 'info' | 'alert'
  text?: string
  messageTimestamp?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: QUEUE_API_KEY, ...body }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Evo Talks ${path} → ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

/**
 * POST sem parse de JSON na resposta (para endpoints que retornam vazio ou texto).
 */
async function postRaw(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: QUEUE_API_KEY, ...body }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Evo Talks ${path} → ${res.status}: ${text}`)
  }
}

// ─── Funções principais ───────────────────────────────────────────────────────

/**
 * Abre um novo atendimento (chat) para o número informado.
 * Retorna o chatId e clientId criados pelo Evo Talks.
 */
export async function openChat(
  number: string,
  message?: string
): Promise<OpenChatResult> {
  const body: Record<string, unknown> = { number }
  if (message) body.message = message

  const data = await post<Record<string, unknown>>('/int/openChat', body)

  return {
    chatId: (data.chatId ?? data.id ?? '') as string | number,
    clientId: (data.clientId ?? '') as string | number,
    ok: true,
  }
}

/**
 * Busca o chatId de um chat aberto pelo número do cliente.
 */
export async function getOpenChatId(
  number: string
): Promise<number | null> {
  try {
    const data = await post<{ openChats: number; chats: { chatId: number }[] }>(
      '/int/getClientOpenChats',
      { number }
    )
    return data.chats?.[0]?.chatId ?? null
  } catch {
    return null
  }
}

/**
 * Busca as últimas mensagens de um chat pelo chatId.
 * direction: 1 = IN (lead), 2 = template/HSM, 3 = OUT (agente)
 */
export async function getChatMessages(
  chatId: number,
  limit = 10
): Promise<Array<{ id: number; direction: number; message: string; srvrcvtime: string; messagetimestamp: number }>> {
  const data = await post<{ messages: Array<{ id: number; direction: number; message: string; srvrcvtime: string; messagetimestamp: number }> }>(
    '/int/getChatMessages',
    { chatId, limit }
  )
  return data.messages ?? []
}

/**
 * Sobe um arquivo pro Evo Talks e devolve o fileId (usado depois no envio).
 * Contrato descoberto 2026-07-20: JSON com `data` (base64). Pra imagem, o Evo
 * EXIGE width/height — sem eles retorna 400.
 */
export async function uploadFileToEvo(opts: {
  fileName: string
  mimeType: string
  base64: string
  width?: number
  height?: number
}): Promise<number> {
  const body: Record<string, unknown> = {
    fileName: opts.fileName,
    mimeType: opts.mimeType,
    data: opts.base64,
  }
  if (opts.width && opts.height) {
    body.width = opts.width
    body.height = opts.height
  }
  const res = await post<{ fileId: number }>('/int/uploadFile', body)
  return res.fileId
}

/**
 * Envia um arquivo (já subido via uploadFileToEvo) num chat aberto. O `caption`
 * vira a legenda da mídia. Só entrega com a janela 24h ABERTA — media é mensagem
 * de texto livre, não passa por HSM.
 */
export async function sendFileToChat(
  chatId: number,
  fileId: number,
  caption = ''
): Promise<{ mId: string; kId: number }> {
  return post<{ mId: string; kId: number }>('/int/sendMessageToChat', { chatId, text: caption, fileId })
}

/**
 * Envia uma mensagem de texto em um chat já aberto (via chatId).
 */
export async function sendMessageToChat(
  chatId: number,
  text: string
): Promise<{ mId: string; kId: number }> {
  return post<{ mId: string; kId: number }>('/int/sendMessageToChat', { chatId, text })
}

/**
 * Envia mensagem para um número — busca chatId aberto e envia.
 * Fallback: tenta abrir chat novo se não houver chat aberto.
 */
export async function sendText(
  number: string,
  text: string,
  knownChatId?: number | string | null
): Promise<void> {
  // 1. Usa chatId conhecido (salvo no lead) se disponível
  if (knownChatId) {
    try {
      await sendMessageToChat(Number(knownChatId), text)
      return
    } catch (err) {
      console.warn(`sendText: chatId ${knownChatId} falhou, tentando por número:`, err)
    }
  }
  // 2. Tenta encontrar chat aberto pelo número
  const chatId = await getOpenChatId(number)
  if (chatId) {
    await sendMessageToChat(chatId, text)
    return
  }
  // 3. Sem chat aberto — tenta abrir com mensagem
  await openChat(number, text)
}

/**
 * Abre um novo chat e envia a primeira mensagem.
 * Usado no disparo inicial D+0 e nos follow-ups.
 */
export async function openChatAndSend(
  number: string,
  text: string
): Promise<{ chatId: string | number; clientId: string | number; enqueuedId: number }> {
  // Abre o atendimento com a mensagem inicial já embutida
  const chat = await openChat(number, text)

  return {
    chatId: chat.chatId,
    clientId: chat.clientId,
    enqueuedId: 0, // openChat já envia a mensagem
  }
}

/**
 * Envia template HSM aprovado pela Meta (Cloud API).
 * templateId = ID numérico do template no painel Evo Talks.
 * vars = array de strings para substituição de {{1}}, {{2}}, etc.
 *
 * Retorna o chatId/clientId/kId quando disponíveis na resposta da Evo Talks —
 * útil para enviar mensagens livres logo em seguida sem precisar buscar o chat.
 */
/**
 * Sanitiza um parâmetro de template HSM pra atender a regra da Meta.
 * A WhatsApp Cloud API rejeita (erro #132018) qualquer variável de template
 * que contenha quebra de linha, tab ou mais de 4 espaços consecutivos.
 * Texto gerado por LLM (ex.: miolo de retomada da VictorIA) costuma vir com
 * \n — então normalizamos: \r\n\t viram espaço e runs de espaço colapsam pra 1.
 */
function sanitizeTemplateParam(v: string): string {
  return (v ?? '')
    .replace(/[\r\n\t]+/g, ' ') // quebras de linha e tabs → espaço
    .replace(/ {2,}/g, ' ')      // 2+ espaços consecutivos → 1
    .trim()
}

export async function sendTemplate(
  number: string,
  templateId: number,
  vars: string[] = [],
  openNewChat = true
): Promise<{ chatId?: number; clientId?: number; kId?: number; raw: Record<string, unknown> }> {
  const varsSanitizadas = vars.map(sanitizeTemplateParam)
  const data = await post<Record<string, unknown>>('/int/sendWaTemplate', {
    number,
    templateId,
    data: varsSanitizadas,
    openNewChat,
  })
  console.log(`sendTemplate response for ${number} (template ${templateId}):`, JSON.stringify(data))
  return {
    chatId: typeof data.chatId === 'number' ? data.chatId : (typeof data.fkChat === 'number' ? data.fkChat : undefined),
    clientId: typeof data.clientId === 'number' ? data.clientId : undefined,
    kId: typeof data.kId === 'number' ? data.kId : undefined,
    raw: data,
  }
}

/**
 * Busca os detalhes de um chat pelo chatId.
 */
export async function getChatDetail(chatId: string | number): Promise<ChatDetail> {
  const data = await post<Record<string, unknown>>('/int/getChatDetail', { chatId })
  return {
    chatId: (data.chatId ?? data.id ?? chatId) as string | number,
    clientId: (data.clientId ?? '') as string | number,
    number: data.number as string | undefined,
    name: data.name as string | undefined,
    status: data.status as string | undefined,
  }
}

/**
 * Verifica se um número WhatsApp tem cadastro no Evo Talks.
 */
export async function checkUserExists(
  number: string
): Promise<{ exists: boolean; clientId: string }> {
  return post('/int/checkIfUserExists', { number })
}

/**
 * Status da fila no Evo Talks — usado pelo health check.
 * Detecta fila desconectada antes que cause silêncio operacional.
 */
export interface QueueStatus {
  name: string
  connected: boolean
  authenticated: boolean
  enabled: boolean
  openChats: number
  businessHoursConfigId: number | null
}

export async function getQueueStatus(): Promise<QueueStatus> {
  const data = await post<Record<string, unknown>>('/int/getQueueStatus', {})
  return {
    name: (data.name as string) ?? '',
    connected: Boolean(data.connected),
    authenticated: Boolean(data.authenticated),
    enabled: Boolean(data.enabled),
    openChats: (data.openChats as number) ?? 0,
    businessHoursConfigId: (data.businessHoursConfigId as number | null) ?? null,
  }
}

/**
 * Oportunidade aberta no CRM Evo Talks (subset dos campos que importam pra auditoria).
 */
export interface PipelineOpportunity {
  id: number
  title: string
  mainphone: string
  fkPipeline: number
  fkStage: number
  responsableid: number
  status: number
  tags: number[]
}

/**
 * Busca todas as oportunidades ABERTAS de um pipeline.
 * Usa apiKey global (a apiKey de fila não autoriza esse endpoint).
 * Param correto é `pipelineId` (não `fkPipeline`).
 */
export async function getPipeOpportunities(
  pipelineId: number,
): Promise<PipelineOpportunity[]> {
  const url = `${BASE_URL}/int/getPipeOpportunities`
  const globalKey = process.env.EVO_TALKS_API_KEY
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: globalKey, pipelineId }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Evo Talks /int/getPipeOpportunities → ${res.status}: ${text}`)
  }
  const data = (await res.json()) as Array<Record<string, unknown>>
  return data.map((o) => ({
    id: (o.id as number) ?? 0,
    title: (o.title as string) ?? '',
    mainphone: (o.mainphone as string) ?? '',
    fkPipeline: (o.fkPipeline as number) ?? 0,
    fkStage: (o.fkStage as number) ?? 0,
    responsableid: (o.responsableid as number) ?? 0,
    status: (o.status as number) ?? 0,
    tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map(Number).filter(Boolean) : [],
  }))
}

/**
 * IDs de chats encerrados no intervalo. Usa apiKey global.
 * startDate/endDate em formato YYYY-MM-DD.
 */
export async function getChatsByDateRange(
  startDate: string,
  endDate: string,
): Promise<number[]> {
  const url = `${BASE_URL}/int/getChatsByDateRange`
  const globalKey = process.env.EVO_TALKS_API_KEY
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: globalKey, startDate, endDate }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Evo Talks /int/getChatsByDateRange → ${res.status}: ${text}`)
  }
  return (await res.json()) as number[]
}

/**
 * Gera uma URL pública para download de um arquivo do Evo Talks.
 */
export async function generateDownloadUrl(fileId: number): Promise<string> {
  const data = await post<{ path: string; url?: string }>('/int/generateDownloadUrl', { fileId })
  const path = data.url ?? data.path ?? ''
  // Se for path relativo, adiciona o BASE_URL
  if (path.startsWith('/')) return `${BASE_URL}${path}`
  return path
}

/**
 * Baixa um arquivo de áudio do Evo Talks e retorna como Buffer + mimeType.
 */
export async function downloadAudio(fileId: number): Promise<{ buffer: Buffer; mimeType: string }> {
  const url = await generateDownloadUrl(fileId)
  console.log(`Baixando áudio: ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Erro ao baixar áudio: ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()
  const mimeType = res.headers.get('content-type') ?? 'audio/ogg'
  return { buffer: Buffer.from(arrayBuffer), mimeType }
}

/**
 * Envia dados de qualificação para o formulário HubSpot da UME/AIVA.
 */
export async function sendToHubSpot(data: {
  nome_socio?: string | null
  email_socio?: string | null
  telefone?: string | null
  nome_varejo?: string | null
  cnpj_matriz?: string | null
  faturamento_anual?: string | null
  valor_boleto_mensal?: string | null
  regiao_varejo?: string | null
  numero_lojas?: string | null
  localizacao_lojas?: string | null
  possui_outra_financeira?: string | null
  cnpjs_adicionais?: string | null
}): Promise<void> {
  const portalId = process.env.HUBSPOT_PORTAL_ID
  const formGuid = process.env.HUBSPOT_FORM_GUID
  if (!portalId || !formGuid) {
    console.warn('HubSpot form não configurado')
    return
  }

  // Separar nome e sobrenome
  const nomeCompleto = data.nome_socio ?? ''
  const partes = nomeCompleto.trim().split(/\s+/)
  const firstName = partes[0] ?? ''
  const lastName = partes.slice(1).join(' ') ?? ''

  const fields = [
    { objectTypeId: '0-1', name: 'firstname', value: firstName },
    { objectTypeId: '0-1', name: 'lastname', value: lastName },
    { objectTypeId: '0-1', name: 'email', value: data.email_socio ?? '' },
    { objectTypeId: '0-1', name: 'phone', value: data.telefone ?? '' },
    { objectTypeId: '0-2', name: 'name', value: data.nome_varejo ?? '' },
    { objectTypeId: '0-2', name: 'cnpj', value: data.cnpj_matriz ?? '' },
    { objectTypeId: '0-2', name: 'faturamento_anual_estimado', value: data.faturamento_anual ?? '' },
    { objectTypeId: '0-2', name: 'venda_no_crediario_mensal', value: data.valor_boleto_mensal ?? '' },
    { objectTypeId: '0-2', name: 'regiao', value: data.regiao_varejo ?? '' },
    { objectTypeId: '0-2', name: 'numero_de_lojas', value: data.numero_lojas ?? '' },
    { objectTypeId: '0-2', name: 'localizacao_das_lojas', value: data.localizacao_lojas ?? '' },
    { objectTypeId: '0-2', name: 'concorrentes', value: data.possui_outra_financeira ?? '' },
    { objectTypeId: '0-2', name: 'cnpjs_adicionais', value: data.cnpjs_adicionais ?? '' },
  ].filter(f => f.value)

  try {
    const res = await fetch(
      `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HubSpot → ${res.status}: ${text}`)
    }
    console.log('HubSpot: formulário enviado com sucesso')
  } catch (err) {
    console.error('Erro ao enviar para HubSpot:', err)
  }
}

/**
 * Envia dados de qualificação para a planilha Google Sheets "AIVA APROVAÇÃO".
 */
export async function sendToGoogleSheets(data: {
  nome_socio?: string | null
  email_socio?: string | null
  telefone?: string | null
  nome_varejo?: string | null
  cnpj_matriz?: string | null
  faturamento_anual?: string | null
  valor_boleto_mensal?: string | null
  regiao_varejo?: string | null
  numero_lojas?: string | null
  localizacao_lojas?: string | null
  possui_outra_financeira?: string | null
  cnpjs_adicionais?: string | null
  status?: string
  opportunity_id?: string
}): Promise<void> {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL
  if (!url) {
    console.warn('GOOGLE_SHEETS_WEBHOOK_URL não configurada')
    return
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`Google Sheets → ${res.status}`)
    console.log('Google Sheets: dados enviados com sucesso')
  } catch (err) {
    console.error('Erro ao enviar para Google Sheets:', err)
  }
}

/**
 * Envia alerta via WhatsApp para um número (Nei ou Aldo).
 *
 * Retorna { ok: boolean; error?: string } pra quem quiser checar.
 * Em falha (janela 24h fechada, número inválido, Evo Talks fora do ar):
 *  - Loga estruturado com prefixo [ALERT_FAILED] (greppable em Vercel logs)
 *  - Persiste em webhook_debug pra auditoria via Supabase
 *  - Callers existentes que ignoram o retorno continuam funcionando igual
 *    (fire-and-forget), mas agora a falha fica visivel.
 */
// Extrai o "tipo" do alerta a partir do emoji inicial da mensagem (🟡, ✅, 🔔...).
function tipoAlerta(message: string): string {
  const m = message.trim().match(/^(\p{Emoji}|\p{Emoji_Presentation}|[←-⯿])/u)
  return m ? m[1] : '•'
}

// Registra o alerta na tabela sdr_alertas (pra aparecer no painel, além do
// WhatsApp). Dedup: alertHuman é chamado 2x por alerta (Nei + Aldo) com a MESMA
// mensagem em ~ms — só grava uma vez (checa se mensagem idêntica entrou nos
// últimos 20s). Best-effort: falha aqui nunca derruba o envio do alerta.
async function registrarAlerta(message: string, entregue: boolean): Promise<void> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase')
    const { data: jaTem } = await supabaseAdmin
      .from('sdr_alertas')
      .select('id')
      .eq('mensagem', message)
      .gte('criado_em', new Date(Date.now() - 20000).toISOString())
      .limit(1)
      .maybeSingle()
    if (jaTem) return
    await supabaseAdmin.from('sdr_alertas').insert({ tipo: tipoAlerta(message), mensagem: message, entregue })
  } catch {
    // ignora — registro no painel é secundário ao envio
  }
}

export async function alertHuman(
  number: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await sendText(number, message)
    await registrarAlerta(message, true)
    return { ok: true }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const errStack = err instanceof Error ? err.stack : undefined
    console.error(`[ALERT_FAILED] number=${number} error=${errMsg}`, errStack)
    // Registra no painel mesmo tendo falhado o envio (marcado como não entregue).
    await registrarAlerta(message, false)
    // Persiste em webhook_debug (tabela ja existe — usada por opportunity-stage)
    // pra historico auditavel das falhas. Se a tabela nao existir ou der erro
    // de permissao, ignoramos silenciosamente — o log do console ja capturou.
    try {
      const { supabaseAdmin } = await import('@/lib/supabase')
      await supabaseAdmin.from('webhook_debug').insert({
        endpoint: '/lib/alertHuman',
        method: 'POST',
        body: { number, message: message.substring(0, 500), error: errMsg },
        status_code: 500,
      })
    } catch {
      // ignora — o console.error acima ja registrou
    }
    return { ok: false, error: errMsg }
  }
}

// ─── CRM — Pipelines ────────────────────────────────────────────────────────

export const PIPELINE_AIVA = 15
export const PIPELINE_SINGLO = 17

// Stages do funil AIVA (pipeline 15) — IDs reais do Evo Talks.
// ATUALIZADO 2026-06-03: alinhado com o Kanban real. Antes tinha
// CAF_PENDENTE:51 / VALIDACAO_CONCLUIDA:52 / TREINA:70 (obsoletos).
// Hoje: 51 = Loja Finalizada e Vendendo, 70 = Treinar, 71 = Login.
const STAGES = {
  INICIO: 66,
  INTERESSADO: 47,
  SEM_RESPOSTA: 53,
  PRE_APROVACAO: 54,
  CADASTRO_RECEBIDO: 49,
  EM_ANALISE_AIVA: 50,
  TREINAR: 70,
  LOGIN: 71,
  LOJA_FINALIZADA_E_VENDENDO: 51,
  BOT_DETECTADO: 69,
} as const

// Progressão LINEAR do funil (ordem de avanço) por ID de stage. Usada por
// changeStageSeAvanco (abaixo) pra impedir que movimentos automáticos da
// VictorIA REGRIDAM uma opp que um humano (ou etapa posterior) já avançou.
// Stages laterais (SEM_RESPOSTA 53, BOT_DETECTADO 69) ficam FORA — sem ordem.
//
// Bug raiz (03/06/2026 — "Mundo das Capas"): lead em Cadastro Recebido mandou
// msg, VictorIA retornou INTERESSADO/PRE_APROVACAO, e o changeOpportunityStage
// cego regrediu a opp 2 etapas.
const ORDEM_FUNIL: Record<number, number> = {
  66: 0, // INICIO
  47: 1, // INTERESSADO
  54: 2, // PRE_APROVACAO
  49: 3, // CADASTRO_RECEBIDO
  50: 4, // EM_ANALISE_AIVA
  70: 5, // TREINAR
  71: 6, // LOGIN
  51: 7, // LOJA_FINALIZADA_E_VENDENDO
}

// Stages da pipeline Singlo (id 17). Por enquanto só temos INTERESSADO mapeado;
// quando o time Singlo precisar dos outros stages (qualificado, proposta, etc.)
// adicionar aqui pra manter centralizado igual STAGES do AIVA.
export const SINGLO_STAGES = {
  INTERESSADO: 62,
} as const

// ⚠️ COLISÃO INTENCIONAL DE ID: o stage BOT_DETECTADO=69 e a tag AIVA=69 (TAG_IDS.AIVA)
// têm o mesmo número 69. Isso não é bug — são namespaces diferentes no Evo Talks
// (um vai em /int/changeStage, outro em /int/updateOpportunity tags[]). Mas é
// PERIGOSO: passar TAG_IDS.AIVA pra changeOpportunityStage por engano move o opp
// pra Bot Detectado silenciosamente. Sempre use a constante semanticamente correta.

export { STAGES }

/**
 * Cria uma oportunidade na Evo Talks.
 *
 * Por padrão cria na pipeline AIVA (15) em stage INTERESSADO (47). Pra Singlo
 * passe `pipelineId: PIPELINE_SINGLO` + `stageId: SINGLO_STAGES.INTERESSADO`
 * (cada pipeline tem stages com IDs diferentes — não dá pra reusar o STAGES do AIVA).
 *
 * Retorna o ID da oportunidade criada.
 */
export async function createOpportunity(opts: {
  title: string
  number: string
  city?: string
  pipelineId?: number
  responsableId?: number
  stageId?: number
  tags?: string[]
  chatId?: string | number
  clientId?: string | number
}): Promise<number> {
  const body: Record<string, unknown> = {
    fkPipeline: opts.pipelineId ?? PIPELINE_AIVA,
    fkStage: opts.stageId ?? STAGES.INTERESSADO,
    responsableid: opts.responsableId ?? 507, // Nei (userId padrão)
    title: opts.title,
    mainphone: opts.number,
    city: opts.city ?? '',
  }
  if (opts.chatId) body.fkChat = Number(opts.chatId)
  if (opts.clientId) body.fkClient = Number(opts.clientId)

  const data = await post<{ id: number }>('/int/createOpportunity', body)
  return data.id
}

/**
 * Vincula um chat a uma oportunidade existente.
 */
export async function linkChatToOpportunity(
  opportunityId: number,
  chatId: number
): Promise<void> {
  await post<{ id: number }>('/int/updateOpportunity', {
    id: opportunityId,
    fkChat: chatId,
  })
  console.log(`CRM: Chat #${chatId} vinculado à oportunidade #${opportunityId}`)
}

/**
 * IDs das etiquetas (tags) no CRM Evo Talks.
 * O endpoint updateOpportunity aceita um array de IDs numéricos em `tags`.
 *
 * REGRAS DE USO:
 * - AIVA: aplicada em TODA opp criada antes do disparo (toda nova oportunidade ganha)
 * - IMPORTANTE: aplicada quando lead tem 3+ lojas (numero_lojas >= 3)
 * - ATENDIMENTO_HUMANO: aplicada quando lead pede pra falar com humano
 *
 * Os IDs são validados em runtime via /api/health (chama validateTagIds).
 */
export const TAG_IDS = {
  AIVA: 69,
  IMPORTANTE: 74,
  ATENDIMENTO_HUMANO: 76, // nome no Evo Talks é "Atend Humano"
  INBOUND: 77,            // aplicada em toda opp criada a partir de lead inbound (TRIAGEM)
  ODRES: 79,              // lojista que já usa o crediário da Odres (transferido pro funil 19)
  UME: 7,                 // lojista que já usa a UME — já é cliente AIVA (transferido pro funil 19)
  SEM_SOCIO: 80,          // empresário individual (Receita sem quadro societário) — fluxo de documentos
} as const

// ─── Funil 19 "Leads de Campanha AIVA" (etapa "Parcelex" 84) ────────────────────
// Lojistas que já usam Odres OU UME são transferidos pra esse funil. A API do Evo
// NÃO move opp entre funis — então transferirParaFunil19() recria a opp no funil 19
// e apaga a antiga. A tag (Odres 79 ou UME 7) é passada por parâmetro.
export const PIPELINE_FUNIL19 = 19
const STAGE_FUNIL19_ENTRADA = 67  // etapa inicial do funil 19 (createOpportunity precisa entrar por ela)
const STAGE_FUNIL19_DESTINO = 84  // etapa "Parcelex" — destino final

/**
 * Tag genérica retornada por /int/getTags (universo de tags do sistema —
 * tanto contato quanto oportunidade). O endpoint exige apiKey global.
 */
export interface SystemTag {
  id: number
  name: string
  /** Cor de fundo definida no painel do Evo (ex.: "#00752b"). */
  bgcolor: string
  /** Cor do texto definida no painel do Evo (ex.: "#fff"). */
  fgcolor: string
}

export async function getTags(): Promise<SystemTag[]> {
  const url = `${BASE_URL}/int/getTags`
  const globalKey = process.env.EVO_TALKS_API_KEY
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: QUEUE_ID, apiKey: globalKey }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Evo Talks /int/getTags → ${res.status}: ${text}`)
  }
  const data = (await res.json()) as Array<Record<string, unknown>>
  return data.map((t) => ({
    id: (t.id as number) ?? 0,
    name: (t.name as string) ?? '',
    bgcolor: (t.bgcolor as string) || '#6b7280',
    fgcolor: (t.fgcolor as string) || '#fff',
  }))
}

/**
 * Catálogo de etiquetas (id → nome + cores) pra replicar no painel as tags que
 * aparecem nas oportunidades do Evo — que chegam só como IDs numéricos.
 *
 * Cache em memória de 10 min: a listagem do painel renderiza dezenas de chips
 * por página e o catálogo quase nunca muda (só quando alguém cria/renomeia tag
 * no painel do Evo). Fail-soft: se o Evo estiver fora, devolve o último
 * catálogo conhecido; se nunca carregou, devolve mapa vazio e os chips somem
 * (nunca quebram a página).
 */
const TAG_CATALOG_TTL_MS = 10 * 60 * 1000
let tagCatalogCache: { at: number; mapa: Map<number, SystemTag> } | null = null

export async function getTagCatalog(): Promise<Map<number, SystemTag>> {
  if (tagCatalogCache && Date.now() - tagCatalogCache.at < TAG_CATALOG_TTL_MS) {
    return tagCatalogCache.mapa
  }
  try {
    const tags = await getTags()
    const mapa = new Map(tags.map((t) => [t.id, t]))
    tagCatalogCache = { at: Date.now(), mapa }
    return mapa
  } catch (err) {
    console.warn('[getTagCatalog] falhou:', err instanceof Error ? err.message : err)
    return tagCatalogCache?.mapa ?? new Map()
  }
}

/**
 * Valida que os IDs hardcoded em TAG_IDS ainda batem com os nomes esperados
 * no painel da Evo Talks. Detecta desincronização silenciosa quando alguém
 * renomeia/recria tag pelo painel.
 *
 * Retorna { ok, drift } — ok=true se tudo casa, drift=[] vazio.
 */
export async function validateTagIds(): Promise<{
  ok: boolean
  drift: Array<{ id: number; expected: string; actual: string | null }>
}> {
  const tags = await getTags()
  const byId = new Map(tags.map((t) => [t.id, t.name]))

  const expectations: Array<{ id: number; expected: string }> = [
    { id: TAG_IDS.AIVA, expected: 'AIVA' },
    { id: TAG_IDS.IMPORTANTE, expected: 'IMPORTANTE' },
    { id: TAG_IDS.ATENDIMENTO_HUMANO, expected: 'Atend' }, // match parcial — "Atend Humano"
    { id: TAG_IDS.INBOUND, expected: 'INBOUND' },
  ]

  const drift: Array<{ id: number; expected: string; actual: string | null }> = []
  for (const e of expectations) {
    const actual = byId.get(e.id) ?? null
    if (!actual || !actual.toUpperCase().includes(e.expected.toUpperCase())) {
      drift.push({ id: e.id, expected: e.expected, actual })
    }
  }

  return { ok: drift.length === 0, drift }
}

/**
 * Define as etiquetas (tags) de uma oportunidade existente.
 * IMPORTANTE: isso SOBRESCREVE as tags atuais — inclua todas as que devem permanecer.
 */
export async function addOpportunityTags(
  opportunityId: number,
  tagIds: number[]
): Promise<void> {
  await post<{ id: number }>('/int/updateOpportunity', {
    id: opportunityId,
    tags: tagIds,
  })
  console.log(`CRM: Tags ${tagIds.join(', ')} aplicadas na oportunidade #${opportunityId}`)
}

/**
 * Remove UMA tag específica de uma oportunidade, preservando as demais.
 *
 * O updateOpportunity SUBSTITUI o array de tags inteiro — então pra remover
 * uma só, busca as tags atuais (getOpportunity), filtra a removida e reescreve.
 * Usado pra tirar a tag "Atend Humano" (76) quando o lead é marcado como
 * atendido no painel (acionar_humano = false), mantendo Evo alinhado.
 *
 * Fail-soft: erros são logados mas não propagados (não trava o fluxo do painel).
 */
/**
 * Adiciona UMA tag preservando as existentes (updateOpportunity SUBSTITUI o
 * array inteiro — então busca as atuais, mescla e reescreve).
 * Fail-soft: erros são logados mas não propagados.
 */
export async function mergeOpportunityTag(
  opportunityId: number,
  tagId: number
): Promise<void> {
  try {
    const opp = await getOpportunity(opportunityId)
    const atuais = (opp.tags as number[] | undefined) ?? []
    if (atuais.includes(tagId)) return // já tem — nada a fazer
    await post<{ id: number }>('/int/updateOpportunity', {
      id: opportunityId,
      tags: [...atuais, tagId],
    })
    console.log(`CRM: Tag ${tagId} adicionada à oportunidade #${opportunityId} (agora ${JSON.stringify([...atuais, tagId])})`)
  } catch (err) {
    console.error(`CRM: falha ao mesclar tag ${tagId} na opp #${opportunityId}:`, err)
  }
}

export async function removeOpportunityTag(
  opportunityId: number,
  tagId: number
): Promise<void> {
  try {
    const opp = await getOpportunity(opportunityId)
    const atuais = (opp.tags as number[] | undefined) ?? []
    if (!atuais.includes(tagId)) return // já não tem — nada a fazer
    const novas = atuais.filter((t) => t !== tagId)
    await post<{ id: number }>('/int/updateOpportunity', {
      id: opportunityId,
      tags: novas,
    })
    console.log(`CRM: Tag ${tagId} removida da oportunidade #${opportunityId} (restam ${JSON.stringify(novas)})`)
  } catch (err) {
    console.error(`CRM: falha ao remover tag ${tagId} da opp #${opportunityId}:`, err)
  }
}

/**
 * Atualiza o título de uma oportunidade no CRM.
 */
export async function updateOpportunityTitle(
  opportunityId: number,
  title: string
): Promise<void> {
  await post<{ id: number }>('/int/updateOpportunity', {
    id: opportunityId,
    title,
  })
  console.log(`CRM: Título da oportunidade #${opportunityId} → "${title}"`)
}

/**
 * Move uma oportunidade para outra etapa do funil (move CEGO — não valida ordem).
 * Use changeStageSeAvanco pros movimentos AUTOMÁTICOS da VictorIA, que nunca
 * devem regredir. Este aqui fica pra movimentos explícitos (BOT_DETECTADO,
 * NAO_QUALIFICADO) e pros handlers de opportunity-stage acionados por humano.
 */
export async function changeOpportunityStage(
  opportunityId: number,
  destStageId: number
): Promise<void> {
  await postRaw('/int/changeOpportunityStage', {
    id: opportunityId,
    destStageId,
  })
}

/**
 * Apaga (remove) uma oportunidade do CRM. Endpoint: /int/removeOpportunity.
 */
export async function removeOpportunity(opportunityId: number): Promise<void> {
  await postRaw('/int/removeOpportunity', { id: opportunityId })
}

/**
 * Transfere um lead pro funil 19 ("Leads de Campanha AIVA", etapa "Parcelex" 84).
 * Usado pra Odres (tag 79) e UME (tag 7). A API do Evo NÃO move opp entre funis,
 * então: cria uma NOVA opp no funil 19 (entra pela etapa 67 e move pra 84), aplica
 * a tag informada, e apaga a opp antiga do funil de origem. Retorna o ID da nova opp.
 */
export async function transferirParaFunil19(opts: {
  oldOppId: number
  title: string
  number: string
  city?: string
  tagId: number
}): Promise<number> {
  const novoId = await createOpportunity({
    title:      opts.title,
    number:     opts.number,
    city:       opts.city,
    pipelineId: PIPELINE_FUNIL19,
    stageId:    STAGE_FUNIL19_ENTRADA,
  })
  await changeOpportunityStage(novoId, STAGE_FUNIL19_DESTINO)   // 67 → 84 (dentro do funil 19)
  await addOpportunityTags(novoId, [opts.tagId])                 // etiqueta (Odres 79 / UME 7)
  try {
    await removeOpportunity(opts.oldOppId)                       // apaga a antiga (evita duplicata)
  } catch (err) {
    console.error(`Funil19: falha ao apagar opp antiga #${opts.oldOppId}:`, err)
  }
  console.log(`Funil19: lead transferido pro funil 19/84 tag ${opts.tagId} (nova opp #${novoId}, antiga #${opts.oldOppId} apagada)`)
  return novoId
}

/**
 * Move a opp SÓ se o destino for um AVANÇO na progressão linear do funil.
 * Defesa em profundidade contra regressão (bug "Mundo das Capas", 03/06/2026):
 * se a opp já está numa etapa igual ou mais avançada que o destino, NÃO move.
 *
 * Stages laterais (SEM_RESPOSTA 53, BOT_DETECTADO 69) ficam fora da ORDEM_FUNIL —
 * mover PARA eles sempre passa; mover A PARTIR deles pra qualquer etapa também
 * (lead voltou a engajar). A trava só atua DENTRO da progressão linear.
 *
 * Retorna { moved, motivo } pra log/auditoria. Fail-open: se não conseguir ler
 * o stage atual, faz o move (comportamento antigo) pra não travar o fluxo.
 */
export async function changeStageSeAvanco(
  opportunityId: number,
  destStageId: number
): Promise<{ moved: boolean; motivo?: string }> {
  let stageAtual: number | undefined
  try {
    const opp = await getOpportunity(opportunityId)
    stageAtual = Number(opp.fkStage)
  } catch {
    // Não conseguiu ler stage atual → move (fail-open, comportamento antigo)
    await changeOpportunityStage(opportunityId, destStageId)
    return { moved: true, motivo: 'sem_stage_atual_fail_open' }
  }

  const ordAtual = ORDEM_FUNIL[stageAtual]
  const ordDest = ORDEM_FUNIL[destStageId]

  // Ambos na progressão linear E destino não avança → BLOQUEIA (regressão/no-op)
  if (ordAtual !== undefined && ordDest !== undefined && ordDest <= ordAtual) {
    console.log(
      `[changeStageSeAvanco] REGRESSÃO EVITADA: opp ${opportunityId} está em ` +
      `stage ${stageAtual} (ordem ${ordAtual}), tentou mover pra ${destStageId} ` +
      `(ordem ${ordDest}). Mantido.`,
    )
    return { moved: false, motivo: 'regressao_evitada' }
  }

  await changeOpportunityStage(opportunityId, destStageId)
  return { moved: true }
}

// Mapeamento: campo da VictorIA → ID do formulário "Qualificação Varejo" no Evo Talks
export const FORM_FIELD_MAP: Record<string, string> = {
  nome_socio: 'da6ddf70',
  email_socio: 'dafa40f0',
  telefone_socio: 'db8569f0',
  nome_varejo: 'dcacfa00',
  cnpj_matriz: 'dd2ab580',
  faturamento_anual: 'ddb960f0',
  valor_boleto_mensal: 'de2cbc30',
  regiao_varejo: 'dede58f0',
  numero_lojas: 'df6f9c70',
  localizacao_lojas: 'e0099280',
  possui_outra_financeira: 'e07d62f0',
  cnpjs_adicionais: 'e0f66380',
}

/**
 * Busca os dados atuais de uma oportunidade.
 */
export async function getOpportunity(opportunityId: number): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/int/getOpportunity', { id: opportunityId })
}

// Stage Evo (pipeline 15 AIVA) → Status Supabase (1:1). Evo é a FONTE DA VERDADE.
// Usado pelo sync diário e pela checagem em tempo real do webhook.
export const STAGE_TO_STATUS: Record<number, string> = {
  66: 'INICIO',
  47: 'INTERESSADO',
  53: 'SEM_RESPOSTA',
  54: 'PRE_APROVACAO',
  49: 'CADASTRO_RECEBIDO',
  50: 'EM_ANALISE_AIVA',
  70: 'TREINAR',
  71: 'LOGIN',
  51: 'LOJA_FINALIZADA_E_VENDENDO',
  69: 'BOT_DETECTADO',
}

// Campos da Fase 3 obrigatórios pra considerar o cadastro "recebido" de verdade.
// (cnpjs_adicionais é OPCIONAL — alinhado com CAMPOS_OBRIGATORIOS de lib/cadastro-recebido.)
const FASE3_OBRIGATORIOS = ['email_socio', 'faturamento_anual', 'valor_boleto_mensal', 'localizacao_lojas'] as const

function campoPreenchido(v: string | null | undefined): boolean {
  return !!v && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'null'
}

/** True só quando os 4 dados obrigatórios da Fase 3 estão preenchidos no formulário. */
export function fase3Completa(forms: Record<string, string | null> | null | undefined): boolean {
  const f = forms ?? {}
  return FASE3_OBRIGATORIOS.every((k) => campoPreenchido(f[FORM_FIELD_MAP[k]]))
}

/**
 * Status CORRETO a partir da oportunidade do Evo.
 *
 * O stage 49 "Cadastro Recebido" é AMBÍGUO: o operador move o card pra cá pra
 * DISPARAR a coleta da Fase 3 (loja pré-aprovada) — nesse momento o cadastro
 * ainda NÃO está completo. Mapear stage 49 → CADASTRO_RECEBIDO cegamente fazia
 * a VictorIA dizer "seu cadastro está completo" assim que o lead respondia,
 * mesmo com os 4 dados da Fase 3 ainda vazios (bug Smartmania/Loja Claro).
 *
 * Regra: stage 49 só é CADASTRO_RECEBIDO quando a Fase 3 está completa; enquanto
 * faltar dado, o lead permanece INTERESSADO (Fase 3 em andamento → VictorIA segue
 * coletando, sem falsa conclusão).
 */
export function statusFromOpp(
  opp: { fkStage?: number; formsdata?: Record<string, string | null> | null } | null | undefined,
): string | null {
  const stage = Number(opp?.fkStage)
  const mapped = STAGE_TO_STATUS[stage] ?? null
  if (mapped === 'CADASTRO_RECEBIDO' && !fase3Completa(opp?.formsdata)) {
    return 'INTERESSADO'
  }
  return mapped
}

/**
 * Consulta a etapa ATUAL da oportunidade no Evo e devolve o status mapeado.
 * Retorna null se a opp não existir, a etapa não for do funil AIVA (pipeline 15)
 * ou a chamada falhar (fail-open — quem chama mantém o status do Supabase).
 */
/**
 * Chave de telefone pra casar Supabase × Evo (formatos variados: com/sem 55,
 * com/sem o 9º dígito). Mesma normalização usada no painel.
 */
export function chaveTelefone(s: string | null | undefined): string {
  let d = (s ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11) d = d.slice(0, 2) + d.slice(3)
  return d
}

/**
 * Conjunto de telefones (chaveTelefone) que estão numa etapa específica do funil
 * AIVA no Evo. UMA chamada à API, não uma por lead.
 *
 * Serve pra automações que precisam da ETAPA REAL e não do status do Supabase —
 * os dois divergem de propósito: um lead na etapa "Cadastro Recebido" carrega
 * status INTERESSADO enquanto a Fase 3 não fecha (regra do statusFromOpp). Sem
 * este filtro, uma cadência que busca por status pegaria leads de outra etapa
 * e mandaria mensagem duplicada (bug real 2026-07-20: o reengajamento ia tocar
 * 26 leads que a cobrança de Cadastro Recebido já tinha contatado no mesmo dia).
 */
export async function telefonesNaEtapa(stageId: number): Promise<Set<string>> {
  const opps = await getPipeOpportunities(PIPELINE_AIVA)
  const set = new Set<string>()
  for (const o of opps) {
    if (Number(o.fkStage) !== stageId) continue
    const k = chaveTelefone(o.mainphone)
    if (k) set.add(k)
  }
  return set
}

export async function getStatusAtualNoEvo(opportunityId: number): Promise<string | null> {
  try {
    const opp = await getOpportunity(opportunityId)
    return statusFromOpp(opp as { fkStage?: number; formsdata?: Record<string, string | null> | null })
  } catch {
    return null
  }
}

/**
 * Atualiza os campos do formulário "Qualificação Varejo" na oportunidade.
 * Faz MERGE com dados existentes (não sobrescreve campos já preenchidos).
 */
export async function updateOpportunityForms(
  opportunityId: number,
  dados: Record<string, string | null | undefined>,
  telefone?: string
): Promise<void> {
  const newFields: Record<string, string> = {}

  for (const [key, value] of Object.entries(dados)) {
    if (value && FORM_FIELD_MAP[key]) {
      newFields[FORM_FIELD_MAP[key]] = value
    }
  }

  // Telefone do sócio = número do WhatsApp do lead
  if (telefone) {
    newFields[FORM_FIELD_MAP.telefone_socio] = telefone
  }

  if (Object.keys(newFields).length === 0) return

  // Busca dados existentes para fazer merge
  const opp = await getOpportunity(opportunityId)
  const existingForms = (opp.formsdata ?? {}) as Record<string, string | null>

  // Merge: dados existentes + novos (novos sobrescrevem)
  const merged: Record<string, string | null> = { ...existingForms }
  for (const [id, value] of Object.entries(newFields)) {
    merged[id] = value
  }

  await post<{ id: number }>('/int/updateOpportunity', {
    id: opportunityId,
    formsdata: merged,
  })
  console.log(`CRM: Formulário atualizado na oportunidade #${opportunityId}:`, Object.keys(newFields).length, 'novos campos')
}

/**
 * Adiciona uma nota à oportunidade.
 */
export async function addOpportunityNote(
  opportunityId: number,
  note: string
): Promise<void> {
  await postRaw('/int/insertOpportunityNote', {
    id: opportunityId,
    note,
  })
}
