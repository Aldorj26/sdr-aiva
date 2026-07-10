import Anthropic from '@anthropic-ai/sdk'
import { getClient } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase'
import { ASSISTENTE_SYSTEM_PROMPT } from '@/prompts/assistente'

const MODEL = 'claude-sonnet-4-5'
const MAX_ITERACOES = 8
const MAX_LINHAS = 50
const MAX_CHARS_RESULTADO = 8000

export interface MsgChat {
  role: 'user' | 'assistant'
  content: string
}

// ─── Ferramentas ──────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'contar_leads',
    description:
      'Contagem de leads por status. Opcionalmente filtra por período (últimos N dias, pela data de criação).',
    input_schema: {
      type: 'object',
      properties: {
        ultimos_dias: {
          type: 'number',
          description: 'Se informado, conta só leads criados nos últimos N dias.',
        },
      },
    },
  },
  {
    name: 'buscar_lead',
    description:
      'Busca leads por nome (parcial, case-insensitive) ou telefone (parcial). Retorna até 10 com id, nome, telefone, cidade, status, datas e observações.',
    input_schema: {
      type: 'object',
      properties: {
        termo: {
          type: 'string',
          description: 'Nome da loja ou trecho do telefone (só dígitos).',
        },
      },
      required: ['termo'],
    },
  },
  {
    name: 'historico_conversa',
    description:
      'Últimas mensagens da conversa de um lead (use o id retornado por buscar_lead). direcao in = lead falou, out = VictorIA falou.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'UUID do lead.' },
        limite: { type: 'number', description: 'Qtde de mensagens (padrão 30, máx 60).' },
      },
      required: ['lead_id'],
    },
  },
  {
    name: 'consulta_sql',
    description:
      'Executa um SELECT livre no Postgres (somente leitura, máx 50 linhas). Tabelas: sdr_leads, sdr_mensagens. Use para perguntas que as outras ferramentas não cobrem.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Consulta SELECT (sem ponto-e-vírgula final).' },
      },
      required: ['sql'],
    },
  },
]

// ─── Executores ───────────────────────────────────────────────────────────────

async function rodarSqlReadonly(sql: string): Promise<string> {
  // remove ; finais e embrulha com agregação jsonb (o RPC espera 1 linha/1 col jsonb)
  const limpo = sql.trim().replace(/;+\s*$/g, '')
  const embrulhado = `select coalesce(jsonb_agg(t), '[]'::jsonb) from (${limpo}) t`
  const { data, error } = await supabaseAdmin.rpc('assistente_sql', { q: embrulhado })
  if (error) return `ERRO na consulta: ${error.message}`
  const json = JSON.stringify(data)
  return json.length > MAX_CHARS_RESULTADO
    ? json.slice(0, MAX_CHARS_RESULTADO) + '… [truncado]'
    : json
}

async function executarFerramenta(nome: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (nome) {
      case 'contar_leads': {
        const dias = typeof input.ultimos_dias === 'number' ? input.ultimos_dias : null
        const where = dias ? `where criado_em >= now() - interval '${Math.floor(dias)} days'` : ''
        return rodarSqlReadonly(
          `select status, count(*)::int as total from sdr_leads ${where} group by status order by total desc`
        )
      }
      case 'buscar_lead': {
        const termo = String(input.termo ?? '').trim()
        if (!termo) return 'ERRO: termo vazio'
        const digitos = termo.replace(/\D/g, '')
        const porTelefone = digitos.length >= 4
        const filtro = porTelefone
          ? `telefone like '%${digitos}%'`
          : `nome ilike '%${termo.replace(/'/g, "''")}%'`
        return rodarSqlReadonly(
          `select id, nome, telefone, cidade, status, acionar_humano, data_disparo_inicial, data_ultimo_contato, observacoes from sdr_leads where ${filtro} order by data_ultimo_contato desc nulls last limit 10`
        )
      }
      case 'historico_conversa': {
        const leadId = String(input.lead_id ?? '')
        const limite = Math.min(Number(input.limite) || 30, 60)
        if (!/^[0-9a-f-]{36}$/i.test(leadId)) return 'ERRO: lead_id inválido (use o UUID de buscar_lead)'
        return rodarSqlReadonly(
          `select direcao, conteudo, template_hsm, enviado_em from sdr_mensagens where lead_id = '${leadId}' order by enviado_em desc limit ${limite}`
        )
      }
      case 'consulta_sql': {
        const sql = String(input.sql ?? '')
        if (!/^\s*(select|with)\b/i.test(sql)) return 'ERRO: apenas SELECT é permitido'
        // LIMIT duro: embrulha de novo com limit
        const limpo = sql.trim().replace(/;+\s*$/g, '')
        return rodarSqlReadonly(`select * from (${limpo}) _q limit ${MAX_LINHAS}`)
      }
      default:
        return `ERRO: ferramenta desconhecida ${nome}`
    }
  } catch (err) {
    return `ERRO: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── Loop do agente ───────────────────────────────────────────────────────────

export async function responderAssistente(
  mensagem: string,
  historico: MsgChat[]
): Promise<string> {
  const client = getClient()

  const messages: Anthropic.MessageParam[] = [
    ...historico.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: mensagem },
  ]

  for (let i = 0; i < MAX_ITERACOES; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: ASSISTENTE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    })

    if (resp.stop_reason !== 'tool_use') {
      const texto = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      return texto || 'Não consegui montar uma resposta. Tenta reformular a pergunta?'
    }

    // Executa as tools pedidas e devolve os resultados
    messages.push({ role: 'assistant', content: resp.content })
    const resultados: Anthropic.ToolResultBlockParam[] = []
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue
      const resultado = await executarFerramenta(block.name, block.input as Record<string, unknown>)
      resultados.push({ type: 'tool_result', tool_use_id: block.id, content: resultado })
    }
    messages.push({ role: 'user', content: resultados })
  }

  return 'A consulta ficou complexa demais e atingi o limite de tentativas. Tenta quebrar a pergunta em partes menores?'
}
