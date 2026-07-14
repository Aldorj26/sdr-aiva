/**
 * Normaliza o nome do sócio/lead para uso em saudações:
 * - Pega só o primeiro nome
 * - Capitaliza a primeira letra, resto minúsculas
 * - Retorna null se for inválido (vazio, curto, só números, repetido, palavra de teste)
 */
export function normalizaNome(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length < 2) return null

  // Pega só o primeiro "token" (primeiro nome)
  const primeiro = trimmed.split(/\s+/)[0]
  if (!primeiro || primeiro.length < 2) return null

  // Rejeita se for só números
  if (/^\d+$/.test(primeiro)) return null

  // Rejeita se todas as letras forem iguais (ex: "aaaa", "xxxx")
  if (/^(.)\1+$/i.test(primeiro)) return null

  // Rejeita palavras comuns de teste/genéricas
  const invalidos = new Set([
    'teste', 'test', 'asdf', 'qwerty', 'lojista', 'loja',
    'xxx', 'aaa', 'nome', 'cliente', 'usuario', 'varejo',
  ])
  if (invalidos.has(primeiro.toLowerCase())) return null

  // Capitaliza: primeira letra maiúscula, resto minúsculas
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
}

/**
 * Texto da variável {{1}} do template HSM "(CAMPANHA) Link de Cadastro" (id 15).
 * Corpo do template: "Bem vindo{{1}}\nAssim que finalizar, retorne aqui."
 */
export const APROVACAO_TEMPLATE_VAR =
  ', sua loja foi aprovada pela Aiva! Preencha esse seu cadastro atraves do link ' +
  'https://retail-onboarding-hub.vercel.app/onboarding/full'

/**
 * Calcula a próxima quinta-feira às 09:30 BRT (12:30 UTC).
 * Se hoje for quinta, pega a quinta da semana que vem.
 * Treinamento dura 1h (09:30 às 10:30 BRT).
 */
export function proximaQuintaFeira09h30(): { start: string; end: string } {
  const agora = new Date()
  const diaSemanaUTC = agora.getUTCDay() // 0=dom, 4=qui
  let diasAteQuinta = (4 - diaSemanaUTC + 7) % 7
  if (diasAteQuinta === 0) diasAteQuinta = 7
  const inicio = new Date(agora)
  inicio.setUTCDate(agora.getUTCDate() + diasAteQuinta)
  inicio.setUTCHours(12, 30, 0, 0) // 09:30 BRT
  const fim = new Date(inicio)
  fim.setUTCHours(13, 30, 0, 0) // 10:30 BRT
  const fmt = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '')
  return { start: fmt(inicio), end: fmt(fim) }
}

/**
 * Monta os 3 textos enviados após o template HSM 25 [AIVA] TREINAMENTO (stage 70):
 * 1. Reunião ao vivo (link Meet + link Google Calendar pré-preenchido)
 * 2. Materiais de apoio (Drive)
 * 3. Cadastro dos funcionários (Google Forms)
 *
 * Reutilizado pelo opportunity-stage (envio imediato) e pelo webhook
 * (reforço quando lead responde — Caminho 2).
 */
export function buildAvisoTreinamentoMsgs(): string[] {
  const proximaQuinta = proximaQuintaFeira09h30()
  const calendarLink =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent('Treinamento AIVA')}` +
    `&dates=${proximaQuinta.start}/${proximaQuinta.end}` +
    `&details=${encodeURIComponent('Link da reunião: https://meet.google.com/hqn-vcrr-dxo')}` +
    `&location=${encodeURIComponent('https://meet.google.com/hqn-vcrr-dxo')}`

  const msgReuniao =
    `📅 *Treinamento ao vivo:*\n` +
    `Os treinamentos acontecem geralmente nas *quintas-feiras às 9h30*. Confirme o horário com nossa equipe.\n\n` +
    `🔗 Link da reunião:\n` +
    `👉 meet.google.com/hqn-vcrr-dxo\n\n` +
    `📲 *Adicionar ao seu calendário:*\n` +
    `👉 ${calendarLink}`

  const msgMateriais =
    `📚 *Materiais de apoio:*\n` +
    `Todos os documentos e vídeos do treinamento estão aqui:\n` +
    `👉 https://drive.google.com/drive/folders/1t0WpRYg7b5TIb7Hbbkjg9oyMI1bGXe-w?usp=sharing`

  const msgCadastro =
    `📝 *Cadastro dos funcionários:*\n` +
    `Para liberar o acesso da equipe da sua loja ao sistema AIVA, preencha este formulário:\n` +
    `👉 https://docs.google.com/forms/d/1_3QtZtSjOFVh3zQVpwkNW0JatI3T0F4pG5t-O90cKcA/viewform\n\n` +
    `Qualquer dúvida é só chamar aqui! 😊`

  return [msgReuniao, msgMateriais, msgCadastro]
}

/**
 * Mensagem enviada logo após o template HSM 20 "Complete o Cadastro" (stage 49),
 * orientando o lojista sobre os 5 dados complementares que a VictorIA vai
 * coletar na sequência (Fase 3).
 *
 * Reutilizada pelo opportunity-stage (envio imediato) e pelo webhook
 * (reforço quando lead responde — Caminho 2).
 */
export function buildAvisoColetandoComplementoMsg(nomeContato: string | null): string {
  const saudacao = nomeContato ? `${nomeContato}, ` : ''
  return (
    `${saudacao}sua loja foi *pré-aprovada* pela AIVA! 🎉\n\n` +
    `Pra avançar pra próxima etapa, preciso só de mais 5 informações:\n\n` +
    `📧 Email do sócio\n` +
    `💰 Faturamento anual da operação\n` +
    `💳 Valor médio mensal em vendas parceladas (boleto)\n` +
    `📍 Cidades das suas lojas\n` +
    `🏢 Outros CNPJs (matriz/filial), se tiver\n\n` +
    `Vou te perguntar um por um pra ficar tranquilo. Pode começar? 😊`
  )
}

/**
 * Mensagem enviada logo após o template de aprovação, orientando sobre o
 * preenchimento completo do cadastro CAF — incluindo a biometria facial obrigatória.
 */
export function buildAvisoCadastroMsg(nomeContato: string | null): string {
  const saudacao = nomeContato ? `${nomeContato}, p` : 'P'
  return (
    `${saudacao}ara garantir a aprovação completa, siga os passos do cadastro até o final:\n\n` +
    `✅ Preencha todos os dados da sua loja\n` +
    `✅ Informe os dados bancários para receber os pagamentos das vendas\n` +
    `✅ *Ao final, realize a biometria facial* — esse passo é obrigatório para liberar 100% do seu acesso\n\n` +
    `📱 Se possível, faça o cadastro pelo celular para facilitar a biometria. Qualquer dúvida é só chamar!`
  )
}

/**
 * Mensagem de texto livre enviada após o template de aprovação,
 * orientando sobre matriz/filial. Aceita nome opcional para personalizar a saudação.
 */
export function buildAvisoMatrizMsg(nomeContato: string | null): string {
  const saudacao = nomeContato ? `${nomeContato}, uma` : 'Olá! Uma'
  return (
    `${saudacao} dica rápida pra agilizar seu cadastro:\n\n` +
    `Quantas lojas você vai cadastrar na AIVA?\n\n` +
    `*Se for só 1 loja*: pode seguir direto no link, é um cadastro só.\n\n` +
    `*Se forem 2 ou mais*: preciso saber se elas têm CNPJs totalmente diferentes (são matrizes independentes) ou se são filiais da mesma empresa (mesmo CNPJ com finais diferentes tipo 0001, 0002).\n\n` +
    `- *Matrizes diferentes*: um cadastro para cada CNPJ raiz\n` +
    `- *Filiais do mesmo CNPJ*: um cadastro só cobre todas\n\n` +
    `Me conta aqui quantas lojas você tem antes de começar, que eu te oriento no caminho certo. Assim evitamos retrabalho.`
  )
}

// ─── Sanitização de telefones alucinados ──────────────────────────────────────
// Bug real 2026-07-14: a VictorIA INVENTOU um telefone ("pode também me ligar:
// (31) 3360-0197") numa resposta — número que não existe em lugar nenhum do
// prompt/código. Defesa em profundidade: qualquer telefone na resposta que não
// esteja na whitelist (oficiais + números ditos pelo próprio lead na conversa)
// tem a SENTENÇA removida antes do envio.

/** Telefones oficiais que a VictorIA PODE citar (só dígitos, sem 55). */
export const FONES_OFICIAIS = [
  '2220290100', // Suporte AIVA cliente final — WhatsApp 22 2029-0100
]

const soDigitos = (s: string) => s.replace(/\D/g, '')

/** Normaliza pra comparação: tira 55 do início e o 9º dígito (celular). */
function chaveFone(digitos: string): string {
  let d = digitos
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3)
  return d
}

// Padrão de telefone BR em texto: (31) 3360-0197 / 31 99999-8888 / +55 48 ...
// Guards (?<!\d)/(?!\d) evitam casar dentro de sequências longas (protocolos, CNPJ).
const RE_FONE = /(?<!\d)(?:\+?55[\s.-]*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]?\d{4}(?!\d)/g

/**
 * Remove da mensagem qualquer telefone que não esteja na whitelist.
 * `permitidosExtras`: números legítimos do contexto (telefone do lead,
 * telefone_socio coletado, números que o lead escreveu na conversa).
 */
export function removeFonesNaoOficiais(
  mensagem: string,
  permitidosExtras: string[] = []
): { texto: string; removidos: string[] } {
  const whitelist = new Set(
    [...FONES_OFICIAIS, ...permitidosExtras].map((f) => chaveFone(soDigitos(f))).filter(Boolean)
  )
  const removidos: string[] = []

  const achados = mensagem.match(RE_FONE) ?? []
  const proibidos = achados.filter((f) => !whitelist.has(chaveFone(soDigitos(f))))
  if (proibidos.length === 0) return { texto: mensagem, removidos }

  // Remove a(s) sentença(s) que contêm o número proibido (mantém o resto).
  let texto = mensagem
  for (const fone of proibidos) {
    removidos.push(fone)
    const linhas = texto.split('\n').map((linha) => {
      if (!linha.includes(fone)) return linha
      const sentencas = linha.split(/(?<=[.!?])\s+/).filter((s) => !s.includes(fone))
      return sentencas.join(' ')
    })
    texto = linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  // Rede de segurança: se a remoção de sentenças esvaziou a mensagem,
  // volta pra original só arrancando os números em si.
  if (!texto) {
    texto = mensagem
    for (const fone of proibidos) texto = texto.split(fone).join('')
    texto = texto.trim()
  }

  return { texto, removidos }
}
