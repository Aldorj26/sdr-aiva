import Anthropic from '@anthropic-ai/sdk'
import { getClient } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase'
import { ASSISTENTE_SYSTEM_PROMPT } from '@/prompts/assistente'
import { getPipeOpportunities, getOpportunity, STAGE_TO_STATUS, PIPELINE_AIVA } from '@/lib/evotalks'

// Rótulos das etapas do funil AIVA no Evo (fonte da verdade da ETAPA)
const ETAPA_LABEL: Record<number, string> = {
  66: 'Início',
  47: 'Interessado',
  53: 'Interessado (Sem resposta)',
  54: 'Pré-Aprovação',
  49: 'Cadastro Recebido',
  50: 'Em Análise AIVA',
  70: 'Treinar',
  71: 'Login',
  51: 'Loja Finalizada e Vendendo',
  69: 'Bot Detectado',
}

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
    name: 'funil_evo',
    description:
      'Consulta AO VIVO o funil AIVA no Evo Talks (fonte da verdade da ETAPA). Retorna a contagem de cards abertos por etapa E a comparação com o painel: leads cujo status no painel diverge da etapa atual do card no Evo. Use sempre que a pergunta envolver etapas do funil, totais por etapa ou consistência painel×Evo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'lead_no_evo',
    description:
      'Compara UM lead específico entre o painel e o Evo (fonte da verdade): etapa atual do card, título, tags e status do painel, com flag de divergência. Passe o telefone (só dígitos) do lead.',
    input_schema: {
      type: 'object',
      properties: {
        telefone: { type: 'string', description: 'Telefone do lead (só dígitos, com DDI 55).' },
      },
      required: ['telefone'],
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
      case 'funil_evo': {
        // Etapas AO VIVO no Evo + divergências com o painel (Evo = fonte da verdade)
        const opps = await getPipeOpportunities(PIPELINE_AIVA)
        const abertas = opps.filter((o) => o.status === 0)
        const porEtapa: Record<string, number> = {}
        for (const o of abertas) {
          const rotulo = ETAPA_LABEL[o.fkStage] ?? `etapa_${o.fkStage}`
          porEtapa[rotulo] = (porEtapa[rotulo] ?? 0) + 1
        }
        // Mapa opp_id → status do painel (paginado — PostgREST corta em 1000)
        const statusPorOpp = new Map<string, { status: string; nome: string; telefone: string }>()
        let from = 0
        while (true) {
          const { data, error } = await supabaseAdmin
            .from('sdr_leads')
            .select('nome, telefone, status, evotalks_opportunity_id')
            .not('evotalks_opportunity_id', 'is', null)
            .range(from, from + 999)
          if (error) return `ERRO ao ler painel: ${error.message}`
          for (const l of data ?? []) {
            if (l.evotalks_opportunity_id) statusPorOpp.set(String(l.evotalks_opportunity_id), l)
          }
          if (!data || data.length < 1000) break
          from += 1000
        }
        // Divergência REAL: status do painel ≠ esperado pela etapa. Exceção BY
        // DESIGN: etapa 49 (Cadastro Recebido) com status INTERESSADO é normal —
        // é a Fase 3, VictorIA coletando os 5 dados complementares.
        const ehDivergente = (o: (typeof abertas)[number]) => {
          const lead = statusPorOpp.get(String(o.id))
          if (!lead) return false
          const esperado = STAGE_TO_STATUS[o.fkStage]
          if (!esperado || lead.status === esperado) return false
          if (o.fkStage === 49 && lead.status === 'INTERESSADO') return false
          return true
        }
        let semLeadNoPainel = 0
        const divergentes: Array<Record<string, string>> = []
        for (const o of abertas) {
          const lead = statusPorOpp.get(String(o.id))
          if (!lead) { semLeadNoPainel++; continue }
          if (ehDivergente(o) && divergentes.length < 20) {
            divergentes.push({
              loja: lead.nome, telefone: lead.telefone,
              etapa_evo: ETAPA_LABEL[o.fkStage] ?? String(o.fkStage),
              status_painel: lead.status, status_esperado: STAGE_TO_STATUS[o.fkStage],
            })
          }
        }
        const totalDivergentes = abertas.filter(ehDivergente).length
        const json = JSON.stringify({
          consultado_em: new Date().toISOString(),
          fonte_da_verdade: 'Evo Talks (funil 15) — consulta ao vivo',
          cards_abertos_por_etapa: porEtapa,
          total_cards_abertos: abertas.length,
          divergencias_painel_vs_evo: totalDivergentes,
          exemplos_divergentes: divergentes,
          cards_sem_lead_no_painel: semLeadNoPainel,
        })
        return json.length > MAX_CHARS_RESULTADO ? json.slice(0, MAX_CHARS_RESULTADO) + '… [truncado]' : json
      }
      case 'lead_no_evo': {
        const tel = String(input.telefone ?? '').replace(/\D/g, '')
        if (tel.length < 8) return 'ERRO: telefone inválido'
        const { data: lead } = await supabaseAdmin
          .from('sdr_leads')
          .select('nome, telefone, status, acionar_humano, data_ultimo_contato, evotalks_opportunity_id, observacoes')
          .like('telefone', `%${tel}%`)
          .limit(1)
          .maybeSingle()
        if (!lead) return 'Lead não encontrado no painel com esse telefone.'
        if (!lead.evotalks_opportunity_id) {
          return JSON.stringify({ painel: lead, evo: null, aviso: 'Lead sem oportunidade vinculada no Evo.' })
        }
        const opp = await getOpportunity(Number(lead.evotalks_opportunity_id))
        const stageNum = Number(opp.fkStage)
        const etapaEvo = ETAPA_LABEL[stageNum] ?? `etapa_${opp.fkStage}`
        const esperado = STAGE_TO_STATUS[stageNum]
        // Etapa 49 + INTERESSADO = Fase 3 em coleta (by design, não é divergência)
        const fase3EmColeta = stageNum === 49 && lead.status === 'INTERESSADO'
        return JSON.stringify({
          consultado_em: new Date().toISOString(),
          painel: { nome: lead.nome, telefone: lead.telefone, status: lead.status, acionar_humano: lead.acionar_humano, ultimo_contato: lead.data_ultimo_contato },
          evo: { opp_id: lead.evotalks_opportunity_id, etapa: etapaEvo, titulo: opp.title, tags: opp.tags ?? [] },
          divergencia: fase3EmColeta ? false : esperado ? lead.status !== esperado : false,
          ...(fase3EmColeta ? { nota_fase3: 'Etapa Cadastro Recebido + status INTERESSADO = Fase 3 em coleta (comportamento normal).' } : {}),
          status_esperado_pela_etapa: esperado ?? 'sem mapeamento',
          nota: 'Evo é a fonte da verdade da ETAPA; o status do painel deveria acompanhar.',
        })
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
      // 8000: com 1500 as respostas longas (ex.: varredura de categorias de
      // leads) saíam cortadas no meio — reclamação do Aldo 01/09.
      max_tokens: 8000,
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
      const cortada = resp.stop_reason === 'max_tokens' ? '\n\n⚠️ (a resposta atingiu o limite de tamanho — manda "prossiga" que eu continuo de onde parei)' : ''
      return (texto || 'Não consegui montar uma resposta. Tenta reformular a pergunta?') + cortada
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
