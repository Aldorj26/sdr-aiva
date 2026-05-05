import { createClient } from '@supabase/supabase-js'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type LeadStatus =
  | 'DISPARO_REALIZADO'
  | 'INTERESSADO'
  | 'FORMULARIO_ENVIADO' // legacy — não usado no fluxo novo, mantido pra leads antigos
  | 'SEM_RESPOSTA'
  | 'OPT_OUT'
  | 'NAO_QUALIFICADO'
  | 'AGUARDANDO'
  | 'DESCARTADO'
  | 'BOT_DETECTADO' // número respondido por chatbot/atendimento automático sem acesso ao decisor
  | 'AGUARDANDO_APROVACAO' // 7 dados coletados, no stage 54 esperando análise
  | 'COLETANDO_COMPLEMENTO' // operador moveu pro stage 49, coletando 5 dados restantes
  | 'CADASTRO_COMPLETO'    // 12 dados coletados, HubSpot disparado
  | 'ANALISE_AIVA'         // stage 50 (Em Análise CAF) — link de onboarding enviado, aguardando lead concluir cadastro + biometria

export interface Lead {
  id: string
  nome: string
  telefone: string
  cidade: string | null
  produto: string
  status: LeadStatus
  etapa_cadencia: number
  evotalks_chat_id: string | null
  evotalks_client_id: string | null
  evotalks_opportunity_id: string | null
  data_disparo_inicial: string | null
  data_proximo_followup: string | null
  data_ultimo_contato: string | null
  acionar_humano: boolean
  importante: boolean
  observacoes: string | null
  criado_em: string
  webhook_lock_at: string | null
}

export interface Mensagem {
  id: string
  lead_id: string
  direcao: 'in' | 'out'
  conteudo: string
  template_hsm: string | null
  enviado_em: string
}

// ─── Clientes ─────────────────────────────────────────────────────────────────

// Cliente público (browser / API routes sem RLS bypass)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Cliente admin (server only — usa service role key)
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Helpers de leads ─────────────────────────────────────────────────────────

export async function getLeadByTelefone(telefone: string): Promise<Lead | null> {
  // .maybeSingle() retorna null quando não encontra (sem lançar erro do Supabase
  // como o .single() fazia). Erros reais (rede, permissão) ficam visíveis no log
  // ao invés de serem confundidos com "lead inexistente" — o que antes podia
  // criar duplicatas via fluxo TRIAGEM em caso de falha de conexão.
  const { data, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('*')
    .eq('telefone', telefone)
    .maybeSingle()

  if (error) {
    console.error(`[getLeadByTelefone] erro ao buscar ${telefone}:`, error)
    return null
  }
  return (data as Lead) ?? null
}

export async function getLeadByChatId(chatId: string): Promise<Lead | null> {
  const { data, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('*')
    .eq('evotalks_chat_id', chatId)
    .maybeSingle()

  if (error) {
    console.error(`[getLeadByChatId] erro ao buscar chatId=${chatId}:`, error)
    return null
  }
  return (data as Lead) ?? null
}

export async function updateLeadStatus(
  leadId: string,
  status: LeadStatus,
  extra: Partial<Lead> = {}
): Promise<void> {
  await supabaseAdmin
    .from('sdr_leads')
    .update({ status, data_ultimo_contato: new Date().toISOString(), ...extra })
    .eq('id', leadId)
}

export async function getLeadsForFollowup(): Promise<Lead[]> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('*')
    .lte('data_proximo_followup', now)
    .in('status', ['DISPARO_REALIZADO', 'SEM_RESPOSTA'])

  if (error) {
    console.error('Erro ao buscar leads para follow-up:', error)
    return []
  }

  return (data ?? []) as Lead[]
}

// ─── Helpers de mensagens ─────────────────────────────────────────────────────

export async function saveMensagem(
  leadId: string,
  direcao: 'in' | 'out',
  conteudo: string,
  templateHsm?: string,
  evotalksMid?: string | null
): Promise<void> {
  await supabaseAdmin.from('sdr_mensagens').insert({
    lead_id: leadId,
    direcao,
    conteudo,
    template_hsm: templateHsm ?? null,
    evotalks_mid: evotalksMid ?? null,
  })
}

/**
 * Verifica se um mId (messageid do WhatsApp via Evo Talks) já foi salvo.
 * Usado pra idempotência — se Evo Talks reentregar o mesmo webhook,
 * ignoramos a reprocessamento.
 */
export async function mensagemMidExiste(mid: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('id')
    .eq('evotalks_mid', mid)
    .limit(1)
    .maybeSingle()
  return !!data
}

/**
 * Tenta adquirir um lock de processamento do webhook para um lead.
 * Lock expira após `ttlSeconds` pra evitar locks órfãos em caso de crash.
 * Retorna true se conseguiu adquirir, false se outro processo está processando.
 */
export async function acquireWebhookLock(
  leadId: string,
  ttlSeconds = 60
): Promise<boolean> {
  const now = new Date()
  const expiredBefore = new Date(now.getTime() - ttlSeconds * 1000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('sdr_leads')
    .update({ webhook_lock_at: now.toISOString() })
    .eq('id', leadId)
    .or(`webhook_lock_at.is.null,webhook_lock_at.lt.${expiredBefore}`)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Erro ao adquirir webhook lock:', error)
    return false
  }
  return !!data
}

export async function releaseWebhookLock(leadId: string): Promise<void> {
  await supabaseAdmin
    .from('sdr_leads')
    .update({ webhook_lock_at: null })
    .eq('id', leadId)
}

export async function getMensagens(leadId: string, limit = 20): Promise<Mensagem[]> {
  const { data, error } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('*')
    .eq('lead_id', leadId)
    .order('enviado_em', { ascending: false })
    .limit(limit)

  if (error) return []
  return ((data ?? []) as Mensagem[]).reverse()
}
