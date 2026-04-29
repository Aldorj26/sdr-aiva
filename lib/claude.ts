import Anthropic from '@anthropic-ai/sdk'
import Groq, { toFile } from 'groq-sdk'
import { AIVA_SYSTEM_PROMPT } from '@/prompts/aiva'
import { TRIAGEM_SYSTEM_PROMPT } from '@/prompts/triagem'
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
 * Gera o "miolo" curto pro template HSM de retomada (template 21 — Follow Up Aiva).
 *
 * Usado quando o operador clica "Follow-up agora" e a janela 24h do WhatsApp já
 * fechou — texto livre falha, então a gente dispara o template HSM com {{1}}=nome
 * e {{2}}=miolo gerado aqui contextualizado pela última conversa.
 *
 * Regras do miolo:
 *  - até 100 caracteres
 *  - sem cumprimento ("oi/olá")
 *  - sem nome do lead (já vem em {{1}})
 *  - sem assinatura
 *  - tom natural, retoma o último ponto pendente
 */
export async function gerarMioloRetomada(
  historico: Mensagem[],
  nomeDoLead: string,
): Promise<string> {
  // Monta um resumo cronológico curto pra o Claude
  const linhas = historico.slice(-12).map((m) => {
    const quem = m.direcao === 'in' ? 'CLIENTE' : 'NOS'
    const txt = m.conteudo.replace(/\s+/g, ' ').trim().slice(0, 280)
    return `${quem}: ${txt}`
  }).join('\n')

  const systemPrompt = `Você está gerando o MIOLO de uma mensagem HSM do WhatsApp pra retomar uma conversa parada com um lojista da campanha AIVA (financiamento de celulares, taxa 12%, recebe em 2 dias úteis, sem risco de inadimplência, parcelamento até 12x).

A estrutura final do template é:
"Olá {{1}}, {{2}}"
  {{1}} = nome do lojista (já preenchido)
  {{2}} = MIOLO que você vai gerar

REGRAS DO MIOLO:
- Máximo 100 caracteres
- Em português, tom natural e direto
- NÃO comece com "oi", "olá", saudação ou nome (o {{1}} já cuida)
- NÃO inclua assinatura ("Nei", "Track", etc.)
- NÃO use emoji
- Retome o último ponto pendente da conversa, sem repetir tudo
- Termine com uma pergunta curta tipo "podemos continuar?" / "quer seguir?" / "consegue retornar?"
- Se a conversa parou esperando o cliente preencher o cadastro CAF, mencione isso
- Se a conversa parou esperando ele responder uma pergunta sua, retome a pergunta

EXEMPLOS BONS:
- "ainda dá pra fechar a ativação da AIVA nas suas 3 lojas. consegue retornar pra finalizarmos o cadastro?"
- "ficou faltando só o CNPJ da filial pra eu seguir. consegue me passar pra continuarmos?"
- "vi que você tinha começado o cadastro da CAF. quer que eu te ajude a finalizar?"

RETORNE APENAS O TEXTO DO MIOLO. Sem aspas, sem JSON, sem comentários, sem prefixo. Só o texto puro.`

  const userMessage = `Lojista: ${nomeDoLead}

Conversa anterior (últimas mensagens, da mais antiga pra mais recente):
${linhas || '(sem conversa anterior)'}

Gere o miolo agora.`

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  let texto = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('')
    .trim()
    // Remove aspas envolvendo, se vierem
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()

  // Strip cumprimento + nome + "tudo bem?" do início se o Claude colocar
  // contrariando o prompt — o template HSM 21 já abre com "Olá {{1}}, ", então
  // qualquer saudação no miolo resulta em duplicação ("Olá Thiago, Oi Sh,...")
  // ou em nome errado (Claude às vezes alucina um nome do histórico).
  const stripGreeting = (s: string): string => {
    let r = s
    let prev = ''
    while (prev !== r) {
      prev = r
      // Saudação + nome opcional (1-3 palavras) seguido de pontuação forte +
      // "tudo bem?" opcional. Lookahead [,!?] garante que a "name section" só
      // dispara quando o nome é seguido de pontuação (evita comer conteúdo).
      r = r
        .replace(
          /^(?:oi|ol[aá]|ei|opa|hey|hi|hello|bom dia|boa tarde|boa noite)(?:\s+[\p{L}'-]+(?:\s+[\p{L}'-]+){0,2}(?=[,!?]))?[\s,!?]+(?:tudo bem[\s,!?]+)?/iu,
          '',
        )
        .trim()
      // "tudo bem?" solto no início (sem saudação antes)
      r = r.replace(/^tudo bem[\s,!?]+/iu, '').trim()
    }
    return r
  }
  texto = stripGreeting(texto)

  // Capitaliza 1ª letra — depois do strip pode sobrar minúsculo ("vi que…")
  if (texto.length > 0) {
    texto = texto[0].toUpperCase() + texto.slice(1)
  }

  // Trava em 110 chars MAS recua até última quebra natural (espaço/pontuação)
  // pra não cortar palavra ao meio. Ex: "...continuarmo[s]" → "...continuarmo"
  const MAX = 110
  if (texto.length > MAX) {
    const cut = texto.slice(0, MAX)
    const lastBreak = Math.max(
      cut.lastIndexOf(' '),
      cut.lastIndexOf('.'),
      cut.lastIndexOf('?'),
      cut.lastIndexOf('!'),
    )
    texto = lastBreak >= MAX * 0.6
      ? cut.slice(0, lastBreak).trimEnd()
      : cut.trimEnd()
  }

  return texto
}

/**
 * Lê o histórico e tenta extrair o PRIMEIRO NOME REAL do cliente (lojista) —
 * útil quando o `lead.nome` cadastrado é o nome da loja em vez do nome da
 * pessoa (ex: "Sos Celulares" → cliente real é "Ani"). 77% da base atual
 * tem nome de loja no campo `nome`, então sem isso o template HSM sai como
 * "Olá Sos Celulares, ..." quebrando rapport.
 *
 * Estratégia: Claude lê últimas 30 mensagens e devolve só o primeiro nome ou
 * "DESCONHECIDO". Se incerto/erro, devolve `fallback` (preserva
 * comportamento atual). Custo ~$0.001, latência ~500ms.
 */
export async function extrairNomeRealDoHistorico(
  historico: Mensagem[],
  fallback: string,
): Promise<string> {
  if (!historico?.length) return fallback

  const trecho = historico
    .slice(-30)
    .map((m) => {
      const quem = m.direcao === 'in' ? 'CLIENTE' : 'SDR'
      const txt = m.conteudo.replace(/\s+/g, ' ').trim().slice(0, 280)
      return `${quem}: ${txt}`
    })
    .join('\n')

  const systemPrompt = `Você lê uma conversa entre um SDR (vendedor da Track/AIVA) e um CLIENTE (lojista de celular).

Sua tarefa: retornar APENAS o primeiro nome próprio do CLIENTE (a pessoa, não a loja), em uma única palavra, sem pontuação.

Regras:
- O nome deve aparecer com clareza: cliente se identifica ("sou o João", "aqui é a Maria", "meu nome é Pedro"), OU o SDR já o chamou pelo nome em mensagens recebidas e o cliente não corrigiu.
- IGNORE nomes de loja ("Sos Celulares", "AppleCel", "Smarting"), nomes do SDR ("VictorIA", "Aldo", "Nei", "Eduardo"), marcas ("AIVA", "UME", "Track"), e nomes de pessoas mencionadas que NÃO são o destinatário das mensagens.
- Se houver QUALQUER dúvida, ou se nenhum nome aparecer com clareza, responda exatamente: DESCONHECIDO

Responda só com o primeiro nome OU "DESCONHECIDO". Sem explicação, sem aspas, sem pontuação extra.`

  let nome: string
  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 30,
      system: systemPrompt,
      messages: [{ role: 'user', content: trecho }],
    })

    nome = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('')
      .trim()
      .replace(/^[.,!?"'`*]+|[.,!?"'`*]+$/g, '')
      .trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[extrairNomeReal] Claude falhou (fallback="${fallback}"): ${msg}`)
    return fallback
  }

  // Validações de sanidade — qualquer suspeita devolve fallback
  if (!nome) return fallback
  if (nome.toUpperCase() === 'DESCONHECIDO') return fallback
  if (nome.length < 2 || nome.length > 30) return fallback
  if (/\s/.test(nome)) return fallback              // múltiplas palavras = Claude desobedeceu
  if (!/^[\p{L}'-]+$/u.test(nome)) return fallback  // só letras (acentos OK), hífen, apóstrofe

  // Capitaliza: "ani" → "Ani", "JOÃO" → "João"
  return nome[0].toUpperCase() + nome.slice(1).toLowerCase()
}

/**
 * Processa uma mensagem recebida do lead com histórico de conversa.
 * Retorna a resposta estruturada da VictorIA.
 */
export async function processarMensagem(
  mensagemRecebida: string,
  historico: Mensagem[],
  nomeDoLead: string,
  statusAtual?: string,
  produto?: string
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

  // Seleciona o prompt base por produto. Default AIVA — TRIAGEM é usado pra leads
  // inbound puros (telefone novo que entrou em contato sem prospecção prévia).
  const promptBase = produto === 'TRIAGEM' ? TRIAGEM_SYSTEM_PROMPT : AIVA_SYSTEM_PROMPT
  const systemPrompt = promptBase
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
