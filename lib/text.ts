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
 * Mensagem enviada logo após o template de aprovação, orientando sobre o
 * preenchimento completo do cadastro CAF — incluindo a biometria facial obrigatória.
 */
export function buildAvisoCadastroMsg(nomeContato: string | null): string {
  const saudacao = nomeContato ? `${nomeContato}, p` : 'P'
  return (
    `${saudacao}ara garantir a aprovação completa, siga os passos do cadastro até o final:\n\n` +
    `✅ Preencha todos os dados da sua loja\n` +
    `✅ Informe os dados bancários para recebimento\n` +
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
