import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase'
import { sendText } from '@/lib/evotalks'
import { buildBriefingPipeline } from '@/lib/pipeline-briefing'
import { formatarRelatorioIncompletos } from '@/lib/cadastro-recebido'
import { callClaudeWithRetry } from '@/lib/claude'

// Números autorizados como admin
const ADMIN_NUMBERS = [
  process.env.ALDO_WHATSAPP ?? '5547996085000',
  process.env.NEI_WHATSAPP ?? '5548999155655',
]

/**
 * Canoniza um número BR pra comparação tolerante ao 9º dígito.
 * O Evo Talks às vezes entrega o número SEM o 9 (ex: clientId "554796085000"),
 * enquanto a env tem COM o 9 ("5547996085000"). Sem normalizar, o admin não é
 * reconhecido e cai no fluxo de lead. Remove o 9 extra de celular (55+DDD+9+8díg).
 */
function canonBR(telefone: string): string {
  const d = (telefone ?? '').replace(/\D/g, '')
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') {
    return d.slice(0, 4) + d.slice(5) // remove o 9º dígito → 12 dígitos
  }
  return d
}

/**
 * Verifica se o telefone é de um admin (tolerante ao 9º dígito BR).
 */
export function isAdmin(telefone: string): boolean {
  const alvo = canonBR(telefone)
  return ADMIN_NUMBERS.some((n) => canonBR(n) === alvo)
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
      case '/dados':
        return await cmdDados(parts[1])
      case '/incompletos':
        return await cmdIncompletos()
      case '/pipeline':
      case '/resumo':
      case '/funil':
        return await cmdPipeline()
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

// ─── Verificação de dados de qualificação (12 campos) ─────────────────────────

// Os 12 dados coletados ficam em sdr_leads.observacoes no formato
// [DADOS_COLETADOS:chave=valor|chave2=valor2]. Estes são os campos esperados.
const CAMPOS_FASE1: [string, string][] = [
  ['nome_socio', 'Nome do sócio'],
  ['telefone_socio', 'Telefone do sócio'],
  ['nome_varejo', 'Nome da loja'],
  ['cnpj_matriz', 'CNPJ matriz'],
  ['regiao_varejo', 'Região/cidade'],
  ['numero_lojas', 'Número de lojas'],
  ['possui_outra_financeira', 'Possui outra financeira'],
]
const CAMPOS_FASE3: [string, string][] = [
  ['email_socio', 'E-mail do sócio'],
  ['faturamento_anual', 'Faturamento anual'],
  ['valor_boleto_mensal', 'Valor boleto mensal'],
  ['localizacao_lojas', 'Localização das lojas'],
]
// Opcional — só existe quando a loja tem mais de 1 CNPJ. Não conta como "faltando".
const CAMPO_OPCIONAL: [string, string][] = [['cnpjs_adicionais', 'CNPJs adicionais (opcional)']]

function parseDados(obs: string | null): Record<string, string> {
  if (!obs) return {}
  const m = obs.match(/\[DADOS_COLETADOS:([^\]]+)\]/)
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const pair of m[1].split('|')) {
    const i = pair.indexOf('=')
    if (i > 0) {
      const k = pair.slice(0, i).trim()
      const v = pair.slice(i + 1).trim()
      if (k && v && v !== 'null') out[k] = v
    }
  }
  return out
}

/** Lista as chaves obrigatórias (11) que estão faltando nos dados coletados. */
function camposFaltando(dados: Record<string, string>): string[] {
  return [...CAMPOS_FASE1, ...CAMPOS_FASE3]
    .filter(([k]) => !dados[k])
    .map(([, label]) => label)
}

// ─── Comandos ────────────────────────────────────────────────────────────────

function cmdHelp(): string {
  return [
    '*Comandos Admin SDR Agent AIVA*',
    '',
    '/status — métricas do sistema',
    '/pipeline — resumo do funil AIVA (mesmo do briefing das 5h)',
    '/lead <telefone> — detalhes de um lead',
    '/dados <telefone> — checklist dos 12 dados de qualificação (o que falta)',
    '/incompletos — oportunidades em Cadastro Recebido com dados faltando',
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
    .not('status', 'in', '("CADASTRO_RECEBIDO","OPT_OUT","NAO_QUALIFICADO","DESCARTADO")')

  // Importantes
  const { count: importantes } = await supabaseAdmin
    .from('sdr_leads')
    .select('id', { count: 'exact', head: true })
    .eq('importante', true)

  return [
    '*Status SDR Agent AIVA*',
    '',
    `Total de leads: ${total}`,
    ...lines,
    '',
    `Conversas ativas (2h): ${ativas ?? 0}`,
    `Aguardando humano: ${humano ?? 0}`,
    `Importantes: ${importantes ?? 0}`,
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
    const dir = m.direcao === 'in' ? '>' : '<'
    return `${dir} ${m.conteudo.substring(0, 80)}`
  }).join('\n')

  return [
    `*Lead: ${lead.nome}*`,
    `Tel: ${lead.telefone}`,
    `Cidade: ${lead.cidade ?? '--'}`,
    `Status: ${lead.status}`,
    `Importante: ${lead.importante ? 'Sim' : 'Nao'}`,
    `Acionar humano: ${lead.acionar_humano ? 'Sim' : 'Nao'}`,
    lead.observacoes ? `Obs: ${lead.observacoes.substring(0, 100)}` : '',
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
      : 'https://sdr-agente.vercel.app'

  const res = await fetch(`${baseUrl}/api/sdr/send-initial`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leads: [{ nome, telefone: tel }] }),
  })

  const data = await res.json()
  if (data.ok && data.sucesso > 0) {
    return `[OK] Campanha disparada para ${tel} (${nome})`
  }
  return `[ERRO] Falha ao disparar: ${JSON.stringify(data)}`
}

async function cmdFollowup(): Promise<string> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : 'https://sdr-agente.vercel.app'

  const res = await fetch(`${baseUrl}/api/sdr/followup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WEBHOOK_SECRET}` },
  })

  const data = await res.json()
  if (data.ok) {
    return `[OK] Follow-up executado: ${data.sucesso} enviados, ${data.falha} falhas (${data.processados} processados)`
  }
  return `[ERRO] Erro no follow-up: ${JSON.stringify(data)}`
}

async function cmdDados(telefone?: string): Promise<string> {
  if (!telefone) return 'Uso: /dados <telefone>\nEx: /dados 5562992889353'
  const tel = telefone.replace(/\D/g, '')
  const { data: lead } = await supabaseAdmin
    .from('sdr_leads')
    .select('nome, telefone, status, observacoes')
    .eq('telefone', tel)
    .maybeSingle()
  if (!lead) return `Lead não encontrado: ${tel}`

  const dados = parseDados(lead.observacoes)
  const linha = ([k, label]: [string, string]) =>
    `${dados[k] ? '✅' : '❌'} ${label}${dados[k] ? `: ${dados[k]}` : ''}`

  const faltando = camposFaltando(dados)
  const veredito = faltando.length === 0
    ? '✅ QUALIFICAÇÃO COMPLETA (11 dados obrigatórios)'
    : `⚠️ FALTAM ${faltando.length}: ${faltando.join(', ')}`

  return [
    `*Dados de qualificação — ${lead.nome}*`,
    `Tel: ${lead.telefone} | Status: ${lead.status}`,
    '',
    '*Fase 1:*',
    ...CAMPOS_FASE1.map(linha),
    '',
    '*Fase 3:*',
    ...CAMPOS_FASE3.map(linha),
    ...CAMPO_OPCIONAL.map(linha),
    '',
    veredito,
  ].join('\n')
}

async function cmdIncompletos(): Promise<string> {
  // Fonte da verdade = ETAPA do Evo Talks (Cadastro Recebido), não o status interno
  // do Supabase. Lista os cards reais na etapa e o que falta de dado em cada um.
  const relatorio = await formatarRelatorioIncompletos()
  return `${relatorio}\n\nUse /dados <telefone> pra ver o checklist completo de uma.`
}

async function cmdPipeline(): Promise<string> {
  try {
    return await buildBriefingPipeline()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `Erro ao montar o resumo do pipeline: ${msg}`
  }
}

// ─── Modo equipe: conversa natural com admin (Aldo/Nei) ───────────────────────
// Em vez de forçar /comandos, a VictorIA conversa em linguagem natural e usa as
// funções de dados (pipeline/lead/dados/incompletos/status) como FERRAMENTAS.

const ADMIN_SYSTEM = `Você é a VictorIA, assistente interna da Track Tecnologia, conversando com a EQUIPE (Aldo ou Nei) — NÃO com um cliente/lojista. Eles tocam a operação da AIVA (crediário pra lojas de celular).

REGRAS:
- Converse de forma natural, direta e prestativa, como colega de equipe. Português coloquial, sem formalidade nem emoji em excesso.
- NUNCA trate quem fala como lead/prospect: não faça pitch da AIVA, não peça CNPJ/dados de qualificação, não mande link de cadastro.
- Você TEM ferramentas pra consultar dados reais da operação — USE quando a pergunta pedir dado concreto:
  • get_pipeline: resumo do funil AIVA (totais por etapa + ações necessárias).
  • get_status: métricas gerais (contagem por status, conversas ativas, aguardando humano).
  • get_lead: detalhes de um lead + últimas mensagens (precisa do telefone).
  • get_dados: checklist dos dados de qualificação de um lead — o que falta (precisa do telefone).
  • get_incompletos: oportunidades em Cadastro Recebido com dados faltando.
- Se precisar de um telefone e não tiver, peça antes de chamar a ferramenta.
- Depois de chamar uma ferramenta, responda em linguagem natural com base no resultado — resuma e destaque o que importa (pode colar o bloco inteiro quando fizer sentido, ex: pipeline).
- Papo/orientação (ex: "como funciona X", "o que faço com lead travado") → responda direto, sem ferramenta.
- Seja honesta: se não souber ou não tiver ferramenta pra algo, diga e aponte o caminho (painel/Evo Talks). NUNCA invente dado.`

const ADMIN_TOOLS: Anthropic.Tool[] = [
  { name: 'get_pipeline', description: 'Resumo do funil/pipeline AIVA: total por etapa, ações necessárias pro Nei, novos leads do dia.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_status', description: 'Métricas gerais do sistema: contagem de leads por status, conversas ativas nas últimas 2h, quantos aguardando humano.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_lead', description: 'Detalhes de um lead específico (nome, status, observações, últimas mensagens) pelo telefone.', input_schema: { type: 'object', properties: { telefone: { type: 'string', description: 'Telefone do lead (com ou sem máscara)' } }, required: ['telefone'] } },
  { name: 'get_dados', description: 'Checklist dos dados de qualificação de um lead: quais dos campos obrigatórios já tem e quais faltam, pelo telefone.', input_schema: { type: 'object', properties: { telefone: { type: 'string', description: 'Telefone do lead (com ou sem máscara)' } }, required: ['telefone'] } },
  { name: 'get_incompletos', description: 'Visão COMPLETA da etapa Cadastro Recebido (fonte: etapa do Evo Talks, não status interno): total na etapa e, por loja, exatamente quais dados obrigatórios faltam. Use sempre que perguntarem quantos/quais estão em Cadastro Recebido ou o que falta neles.', input_schema: { type: 'object', properties: {} } },
]

async function execAdminTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_pipeline': return await cmdPipeline()
    case 'get_status': return await cmdStatus()
    case 'get_lead': return await cmdLead(String(input?.telefone ?? ''))
    case 'get_dados': return await cmdDados(String(input?.telefone ?? ''))
    case 'get_incompletos': return await cmdIncompletos()
    default: return `Ferramenta desconhecida: ${name}`
  }
}

/**
 * Conversa em linguagem natural com um admin (Aldo/Nei), usando as funções de
 * dados como ferramentas. Loop de tool-use (até 4 turnos). Retorna o texto final.
 */
export async function conversarComAdmin(mensagem: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: mensagem }]

  for (let turno = 0; turno < 4; turno++) {
    const resp = await callClaudeWithRetry({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: ADMIN_SYSTEM,
      tools: ADMIN_TOOLS,
      messages,
    }, 'admin-chat')

    const toolUses = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')

    if (toolUses.length === 0) {
      const texto = resp.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim()
      return texto || 'Não entendi, pode reformular?'
    }

    messages.push({ role: 'assistant', content: resp.content })
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      let out: string
      try {
        out = await execAdminTool(tu.name, (tu.input ?? {}) as Record<string, unknown>)
      } catch (err) {
        out = `Erro ao executar ${tu.name}: ${err instanceof Error ? err.message : String(err)}`
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: out })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return 'Não consegui concluir agora — tenta de novo? (ou usa um atalho: /pipeline, /dados <telefone>, /incompletos)'
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
      : 'https://sdr-agente.vercel.app'

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
    return `[OK] Lead ${lead.nome} (${tel}) reprocessado — status: ${data.status}`
  }
  return `[ERRO] Erro ao reprocessar: ${JSON.stringify(data)}`
}
