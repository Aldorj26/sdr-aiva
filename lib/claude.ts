import Anthropic from '@anthropic-ai/sdk'
import Groq, { toFile } from 'groq-sdk'
import { AIVA_SYSTEM_PROMPT } from '@/prompts/aiva'
import type { Mensagem } from '@/lib/supabase'
import { readFileSync } from 'fs'
import { join } from 'path'

function loadEnvKey(key: string): string | undefined {
  // Tenta process.env primeiro
  if (process.env[key]) return process.env[key]
  // Fallback: lê .env.local diretamente
  try {
    const content = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

function getClient() {
  const apiKey = loadEnvKey('ANTHROPIC_API_KEY')
  console.log('ANTHROPIC_API_KEY present:', !!apiKey, 'length:', apiKey?.length ?? 0)
  return new Anthropic({ apiKey })
}

function getGroqClient() {
  const apiKey = loadEnvKey('GROQ_API_KEY')
  return new Groq({ apiKey })
}

export interface DadosColetados {
  nome_socio?: string | null
  email_socio?: string | null
  nome_varejo?: string | null
  cnpj_matriz?: string | null
  faturamento_anual?: string | null
  valor_boleto_mensal?: string | null
  regiao_varejo?: string | null
  numero_lojas?: string | null
  localizacao_lojas?: string | null
  possui_outra_financeira?: string | null
  cnpjs_adicionais?: string | null
}

export interface ClaudeResponse {
  mensagem: string
  novo_status:
    | 'INTERESSADO'
    | 'FORMULARIO_ENVIADO' // legacy
    | 'OPT_OUT'
    | 'NAO_QUALIFICADO'
    | 'AGUARDANDO'
    | 'BOT_DETECTADO' // chatbot/atendimento automático detectado, sem acesso ao decisor
    | 'AGUARDANDO_APROVACAO' // 7 dados Fase 1 completos
    | 'COLETANDO_COMPLEMENTO' // Fase 3 em andamento (setado via stage 49)
    | 'CADASTRO_COMPLETO' // 12 dados Fase 3 completos
  acionar_humano: boolean
  motivo_humano: string | null
  dados_coletados: DadosColetados | null
}

/**
 * Transcreve áudio usando OpenAI Whisper API.
 * Retorna o texto transcrito.
 */
export async function transcreverAudio(
  audioBuffer: Buffer,
  mimeType: string
): Promise<string> {
  // Define extensão baseada no mimeType
  const extMap: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/x-wav': 'wav',
    'application/ogg': 'ogg',
  }
  const ext = extMap[mimeType] ?? 'ogg'

  const file = await toFile(audioBuffer, `audio.${ext}`, { type: mimeType })

  const transcription = await getGroqClient().audio.transcriptions.create({
    model: 'whisper-large-v3',
    file,
    language: 'pt',
  })

  return transcription.text.trim()
}

/**
 * Instrução de fase injetada no último user message pra forçar o Claude a
 * seguir o status atual, mesmo quando o histórico sugere outra fase.
 */
function buildFaseInstrucao(statusAtual: string): string | null {
  if (statusAtual === 'COLETANDO_COMPLEMENTO') {
    return `[INSTRUÇÃO DO SISTEMA — NÃO IGNORAR]\nStatus do lead = COLETANDO_COMPLEMENTO. Você está na FASE 3.\nA Fase 1 e Fase 2 JÁ PASSARAM. Ignore a mensagem "Perfeito, já tenho tudo pra pré-aprovação" no histórico — ela é de uma fase anterior.\nAgora você PRECISA coletar os 5 dados restantes, um de cada vez: email, faturamento, valor boleto, localização detalhada, CNPJs adicionais.\nComece perguntando o EMAIL do sócio.\nRetorne novo_status = "COLETANDO_COMPLEMENTO" (ou "CADASTRO_COMPLETO" se os 5 dados ficarem completos nessa mensagem).\nNUNCA retorne "AGUARDANDO_APROVACAO" nem "INTERESSADO".\n[FIM INSTRUÇÃO DO SISTEMA]`
  }
  if (statusAtual === 'AGUARDANDO_APROVACAO') {
    return `[INSTRUÇÃO DO SISTEMA]\nStatus do lead = AGUARDANDO_APROVACAO. Você está na FASE 2.\nResponda neutro tipo "Estamos analisando, em breve retorno". NÃO peça dados novos.\nRetorne novo_status = "AGUARDANDO_APROVACAO" e acionar_humano = false.\n[FIM INSTRUÇÃO DO SISTEMA]`
  }
  return null
}

/**
 * Processa uma mensagem recebida do lead com histórico de conversa.
 * Retorna a resposta estruturada da VictorIA.
 */
export async function processarMensagem(
  mensagemRecebida: string,
  historico: Mensagem[],
  nomeDoLead: string,
  statusAtual?: string
): Promise<ClaudeResponse> {
  // Monta histórico no formato Claude, agrupando mensagens consecutivas do
  // mesmo role (Claude API exige alternância user/assistant — se duas user
  // messages chegam seguidas, retorna 400 "messages: roles must alternate")
  const messages: Anthropic.MessageParam[] = []
  for (const m of historico) {
    const role: 'user' | 'assistant' = m.direcao === 'out' ? 'assistant' : 'user'
    const last = messages[messages.length - 1]
    if (last && last.role === role && typeof last.content === 'string') {
      last.content = `${last.content}\n${m.conteudo}`
    } else {
      messages.push({ role, content: m.conteudo })
    }
  }

  // A mensagem recebida normalmente já está no histórico (o webhook salva
  // antes de chamar Claude). Só appenda se por alguma razão não estiver.
  const ultimaUser = messages[messages.length - 1]
  if (!ultimaUser || ultimaUser.role !== 'user') {
    messages.push({ role: 'user', content: mensagemRecebida })
  } else if (
    typeof ultimaUser.content === 'string' &&
    !ultimaUser.content.includes(mensagemRecebida)
  ) {
    ultimaUser.content = `${ultimaUser.content}\n${mensagemRecebida}`
  }

  // Claude exige que a conversa comece com 'user'. Se começar com assistant,
  // descarta até achar o primeiro user.
  while (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift()
  }

  if (messages.length === 0) {
    messages.push({ role: 'user', content: mensagemRecebida })
  }

  // Injeta instrução de fase no último user message — o Claude dá peso maior
  // a instruções no user message recente do que no system prompt quando o
  // histórico é longo. Isso impede de voltar pra fase anterior.
  const status = statusAtual ?? 'INTERESSADO'
  const faseInstrucao = buildFaseInstrucao(status)
  if (faseInstrucao) {
    const ultima = messages[messages.length - 1]
    if (ultima.role === 'user' && typeof ultima.content === 'string') {
      ultima.content = `${faseInstrucao}\n\n${ultima.content}`
    }
  }

  // Prefill: força o Claude a começar a resposta com "{" (garante JSON)
  messages.push({ role: 'assistant', content: '{' })

  const systemPrompt = AIVA_SYSTEM_PROMPT
    .replaceAll('{{nome}}', nomeDoLead)
    .replaceAll('{{status_atual}}', status)

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('')

  // Parse do JSON — o prefill já fornece o "{" inicial
  const fullJson = `{${text}`
  const jsonMatch = fullJson.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error(`Claude não retornou JSON válido: ${text.substring(0, 200)}`)
  }
  const parsed = JSON.parse(jsonMatch[0]) as ClaudeResponse
  return parsed
}
