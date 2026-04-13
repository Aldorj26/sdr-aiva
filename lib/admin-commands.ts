import { supabaseAdmin } from '@/lib/supabase'
import { sendText } from '@/lib/evotalks'

// Números autorizados como admin
const ADMIN_NUMBERS = [
  process.env.ALDO_WHATSAPP ?? '5547996085000',
  process.env.NEI_WHATSAPP ?? '5548991555655',
]

/**
 * Verifica se o telefone é de um admin.
 */
export function isAdmin(telefone: string): boolean {
  return ADMIN_NUMBERS.includes(telefone)
}

/**
 * Verifica se a mensagem é um comando admin (começa com /).
 */
export function isCommand(text: string): boolean {
  return text.trim().startsWith('/')
}

/**
 * Processa um comando admin e retorna a resposta.
 */
export async function handleCommand(telefone: string, text: string): Promise<string> {
  const parts = text.trim().split(/\s+/)
  const cmd = parts[0].toLowerCase()

  try {
    switch (cmd) {
      case '/status':
        return await cmdStatus()
      case '/followup':
        return await cmdFollowup()
      case '/lead':
        return await cmdLead(parts[1])
      case '/disparar':
        return await cmdDisparar(parts[1], parts.slice(2).join(' '))
      case '/reprocessar':
        return await cmdReprocessar(parts[1])
      case '/help':
      case '/ajuda':
        return cmdHelp()
      default:
        return `Comando desconhecido: ${cmd}\n\nDigite /ajuda pra ver os comandos disponíveis.`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `Erro ao executar ${cmd}: ${msg}`
  }
}

/**
 * Envia a resposta do comando de volta pro admin via WhatsApp.
 */
export async function respondToAdmin(telefone: string, response: string): Promise<void> {
  await sendText(telefone, response)
}

// ─── Comandos ────────────────────────────────────────────────────────────────

function cmdHelp(): string {
  return [
    '🤖 *Comandos Admin SDR Agent AIVA*',
    '',
    '/status — métricas do sistema',
    '/lead <telefone> — detalhes de um lead',
    '/disparar <telefone> [nome] — disparar campanha',
    '/followup — rodar follow-ups pendentes',
    '/reprocessar <telefone> — retriggar lead travado',
    '/ajuda — esta mensagem',
  ].join('\n')
}

async function cmdStatus(): Promise<string> {
  const { data: metricas } = await supabaseAdmin.from('sdr_metricas').select('*')
  if (!metricas || metricas.length === 0) return 'Sem dados de métricas.'

  const total = metricas.reduce((s, m) => s + Number(m.total), 0)
  const lines = metricas.map(m => `  ${m.status}: ${m.total}`)

  // Conversas ativas (últimas 2h)
  const duasH = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { count: ativas } = await supabaseAdmin
    .from('sdr_leads')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'INTERESSADO')
    .gte('data_ultimo_contato', duasH)

  // Aguardando humano
  const { count: humano } = await supabaseAdmin
    .from('sdr_leads')
    .select('id', { count: 'exact', head: true })
    .eq('acionar_humano', true)
    .not('status', 'in', '("FORMULARIO_ENVIADO","OPT_OUT","NAO_QUALIFICADO","DESCARTADO")')

  // Importantes
  const { count: importantes } = await supabaseAdmin
    .from('sdr_leads')
    .select('id', { count: 'exact', head: true })
    .eq('importante', true)

  return [
    '📊 *Status SDR Agent AIVA*',
    '',
    `Total de leads: ${total}`,
    ...lines,
    '',
    `🟢 Conversas ativas (2h): ${ativas ?? 0}`,
    `🟡 Aguardando humano: ${humano ?? 0}`,
    `⭐ Importantes: ${importantes ?? 0}`,
  ].join('\n')
}

async function cmdLead(telefone?: string): Promise<string> {
  if (!telefone) return 'Uso: /lead <telefone>\nEx: /lead 5543998051903'

  const tel = telefone.replace(/\D/g, '')
  const { data: lead } = await supabaseAdmin
    .from('sdr_leads')
    .select('*')
    .eq('telefone', tel)
    .maybeSingle()

  if (!lead) return `Lead não encontrado: ${tel}`

  const { data: msgs } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('direcao, conteudo, enviado_em')
    .eq('lead_id', lead.id)
    .order('enviado_em', { ascending: false })
    .limit(3)

  const ultimasMsgs = (msgs ?? []).reverse().map(m => {
    const dir = m.direcao === 'in' ? '👤' : '🤖'
    return `${dir} ${m.conteudo.substring(0, 80)}`
  }).join('\n')

  return [
    `📋 *Lead: ${lead.nome}*`,
    `📱 ${lead.telefone}`,
    `📍 ${lead.cidade ?? '—'}`,
    `📌 Status: ${lead.status}`,
    `⭐ Importante: ${lead.importante ? 'Sim' : 'Não'}`,
    `🔔 Acionar humano: ${lead.acionar_humano ? 'Sim' : 'Não'}`,
    lead.observacoes ? `📝 ${lead.observacoes.substring(0, 100)}` : '',
    '',
    '*Últimas msgs:*',
    ultimasMsgs || '(sem mensagens)',
  ].filter(Boolean).join('\n')
}

async function cmdDisparar(telefone?: string, nomeRaw?: string): Promise<string> {
  if (!telefone) return 'Uso: /disparar <telefone> [nome]\nEx: /disparar 5543998051903 Kelly'

  const tel = telefone.replace(/\D/g, '')
  if (tel.length < 10) return 'Telefone inválido. Use formato: 5543998051903'

  const nome = nomeRaw?.trim() || 'Loja'

  // Chama o endpoint send-initial
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : 'https://sdr-agent-nine.vercel.app'

  const res = await fetch(`${baseUrl}/api/sdr/send-initial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leads: [{ nome, telefone: tel }] }),
  })

  const data = await res.json()
  if (data.ok && data.sucesso > 0) {
    return `✅ Campanha disparada para ${tel} (${nome})`
  }
  return `❌ Falha ao disparar: ${JSON.stringify(data)}`
}

async function cmdFollowup(): Promise<string> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : 'https://sdr-agent-nine.vercel.app'

  const res = await fetch(`${baseUrl}/api/sdr/followup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WEBHOOK_SECRET}` },
  })

  const data = await res.json()
  if (data.ok) {
    return `✅ Follow-up executado: ${data.sucesso} enviados, ${data.falha} falhas (${data.processados} processados)`
  }
  return `❌ Erro no follow-up: ${JSON.stringify(data)}`
}

async function cmdReprocessar(telefone?: string): Promise<string> {
  if (!telefone) return 'Uso: /reprocessar <telefone>\nEx: /reprocessar 5543998051903'

  const tel = telefone.replace(/\D/g, '')
  const { data: lead } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, status, webhook_lock_at')
    .eq('telefone', tel)
    .maybeSingle()

  if (!lead) return `Lead não encontrado: ${tel}`

  // Limpa lock se travado
  if (lead.webhook_lock_at) {
    await supabaseAdmin.from('sdr_leads').update({ webhook_lock_at: null }).eq('id', lead.id)
  }

  // Busca última mensagem IN
  const { data: lastIn } = await supabaseAdmin
    .from('sdr_mensagens')
    .select('conteudo')
    .eq('lead_id', lead.id)
    .eq('direcao', 'in')
    .order('enviado_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!lastIn) return `Sem mensagens recebidas do lead ${tel}`

  // Simula webhook
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : 'https://sdr-agent-nine.vercel.app'

  const res = await fetch(`${baseUrl}/api/sdr/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.WEBHOOK_SECRET ?? '',
    },
    body: JSON.stringify({
      event: 'messages.upsert',
      data: {
        key: { fromMe: false, remoteJid: `${tel}@s.whatsapp.net` },
        message: { conversation: lastIn.conteudo },
      },
    }),
  })

  const data = await res.json()
  if (data.ok) {
    return `✅ Lead ${lead.nome} (${tel}) reprocessado — status: ${data.status}`
  }
  return `❌ Erro ao reprocessar: ${JSON.stringify(data)}`
}
