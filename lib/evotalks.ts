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
export async function sendTemplate(
  number: string,
  templateId: number,
  vars: string[] = [],
  openNewChat = true
): Promise<{ chatId?: number; clientId?: number; kId?: number; raw: Record<string, unknown> }> {
  const data = await post<Record<string, unknown>>('/int/sendWaTemplate', {
    number,
    templateId,
    data: vars,
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
export async function alertHuman(
  number: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await sendText(number, message)
    return { ok: true }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const errStack = err instanceof Error ? err.stack : undefined
    console.error(`[ALERT_FAILED] number=${number} error=${errMsg}`, errStack)
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

const STAGES = {
  INICIO: 66,
  INTERESSADO: 47,
  SEM_RESPOSTA: 53,
  PRE_APROVACAO: 54,
  CADASTRO_RECEBIDO: 49,
  EM_ANALISE: 50,
  CAF_PENDENTE: 51,
  VALIDACAO_CONCLUIDA: 52,
  BOT_DETECTADO: 69,
  TREINA: 70,
} as const

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
} as const

/**
 * Tag genérica retornada por /int/getTags (universo de tags do sistema —
 * tanto contato quanto oportunidade). O endpoint exige apiKey global.
 */
export interface SystemTag {
  id: number
  name: string
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
  }))
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
 * Move uma oportunidade para outra etapa do funil.
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

// Mapeamento: campo da VictorIA → ID do formulário "Qualificação Varejo" no Evo Talks
const FORM_FIELD_MAP: Record<string, string> = {
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
