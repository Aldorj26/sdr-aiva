/**
 * Normaliza o nome do sócio/lead para uso em saudações:
 * - Pega só o primeiro nome
 * - Capitaliza a primeira letra, resto minúsculas
 * - Retorna null se for inválido (vazio, curto, só números, repetido, palavra de teste)
 */
/**
 * Nome pra saudação de mensagem/HSM: prioriza o NOME DO SÓCIO coletado pela
 * VictorIA ([DADOS_COLETADOS:nome_socio=...]) e só cai pro nome da loja se não
 * houver sócio. Motivo: lead.nome guarda o nome do VAREJO ("Tudo Celular"), e
 * o normalizaNome corta no primeiro token — a saudação virava "Olá Tudo,".
 * (bug reportado pelo Aldo em 28/07 no lead Tudo Celular)
 */
export function nomeSaudacao(
  nomeLead: string | null | undefined,
  observacoes: string | null | undefined,
  fallback = 'lojista',
): string {
  const socio = (observacoes ?? '').match(/nome_socio=([^|\]]+)/)?.[1] ?? null
  return normalizaNome(socio) || normalizaNome(nomeLead) || fallback
}

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
  'https://retail-onboarding-hub.vercel.app/'

/**
 * (nome histórico) Devolve o PRÓXIMO dia de treinamento — segunda ou quinta,
 * 09:30 BRT (12:30 UTC). Atualizado 2026-08-27: turmas às segundas E quintas.
 * Treinamento dura 1h (09:30 às 10:30 BRT).
 */
/**
 * Contexto temporal pro prompt. A VictorIA não tem noção de "hoje" — sem isso ela
 * INVENTA data (caso Carlos Celulares 12/08/2026: prometeu os acessos pra
 * "quarta, dia 15/01"; 15/01 é outro mês e 15/08 caía num sábado).
 *
 * Devolve tudo mastigado — dia da semana, data e a próxima quarta de liberação
 * já calculada pela regra do corte de terça — pra ela não precisar fazer conta.
 */
export function contextoDeData(): {
  hojeExtenso: string
  quartaAcesso: string
  tercaCorte: string
  hojeISO: string
} {
  const agoraBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
  const dd = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()}`

  // Corte: até TERÇA fim do dia sai na quarta desta semana; de quarta em diante,
  // vai pra quarta seguinte.
  const diaSemana = agoraBRT.getDay() // 0=dom … 3=qua
  const quarta = new Date(agoraBRT)
  const faltam = diaSemana <= 2 ? 3 - diaSemana : 3 + (7 - diaSemana)
  quarta.setDate(agoraBRT.getDate() + faltam)

  // a terça do corte é sempre a véspera da quarta de liberação — entregue pronta
  // pro prompt, porque quando a VictorIA fazia essa conta sozinha ela errava
  // (respondeu "terça 19/08, quarta 20/08" com a quarta correta sendo 19/08).
  const terca = new Date(quarta)
  terca.setDate(quarta.getDate() - 1)

  return {
    hojeExtenso: `${dias[diaSemana]}, ${fmt(agoraBRT)}, ${dd(agoraBRT.getHours())}:${dd(agoraBRT.getMinutes())}`,
    quartaAcesso: fmt(quarta),
    tercaCorte: fmt(terca),
    hojeISO: `${agoraBRT.getFullYear()}-${dd(agoraBRT.getMonth() + 1)}-${dd(agoraBRT.getDate())}`,
  }
}

// Links Meet dos treinamentos AIVA — CADA DIA TEM O SEU (Aldo, 27/08):
// segunda usa a sala nova, quinta segue na sala original.
export const MEET_TREINO_SEGUNDA = 'https://meet.google.com/gdh-ppvw-nmp'
export const MEET_TREINO_QUINTA = 'https://meet.google.com/hqn-vcrr-dxo'

export function proximaQuintaFeira09h30(): { start: string; end: string; dia: 'segunda' | 'quinta'; meet: string } {
  // ATUALIZADO 2026-08-27: treinamentos agora às SEGUNDAS e QUINTAS 9h30–10h30
  // (aviso do Edu). O nome da função ficou histórico — devolve o PRÓXIMO dia de
  // treinamento (segunda ou quinta, o que vier primeiro; se hoje é dia de
  // treino, pega o próximo — o convite é pra próxima turma) e o link Meet do dia.
  const agoraBrt = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const DIAS_TREINO = [1, 4] // segunda, quinta (UTC-3 aplicado acima)
  for (let add = 1; add <= 7; add++) {
    const d = new Date(agoraBrt.getTime() + add * 24 * 60 * 60 * 1000)
    if (DIAS_TREINO.includes(d.getUTCDay())) {
      const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), dd = String(d.getUTCDate()).padStart(2, '0')
      const dia = d.getUTCDay() === 1 ? 'segunda' as const : 'quinta' as const
      return {
        start: `${y}${m}${dd}T123000Z`,
        end: `${y}${m}${dd}T133000Z`,
        dia,
        meet: dia === 'segunda' ? MEET_TREINO_SEGUNDA : MEET_TREINO_QUINTA,
      }
    }
  }
  // inalcançável (7 dias sempre contêm seg/qui) — fallback defensivo
  return { start: '', end: '', dia: 'quinta', meet: MEET_TREINO_QUINTA }
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
  const proximoTreino = proximaQuintaFeira09h30()
  const calendarLink =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent('Treinamento AIVA')}` +
    `&dates=${proximoTreino.start}/${proximoTreino.end}` +
    `&details=${encodeURIComponent(`Link da reunião: ${proximoTreino.meet}`)}` +
    `&location=${encodeURIComponent(proximoTreino.meet)}`

  const msgReuniao =
    `🎓 *Treinamento:*\n` +
    `O vídeo *Curso_Treinamento* na pasta de materiais (link na próxima mensagem) adianta todo o aprendizado — pode assistir AGORA. 🚀 O seu login chega automático no WhatsApp (+55 21 4020-2024) na próxima leva, após o treinamento de segunda ou quinta.\n\n` +
    `Se preferir participar ao vivo, temos turmas às *segundas e quintas, das 9h30 às 10h30* (cada dia tem seu link):\n` +
    `🔗 Segundas 👉 ${MEET_TREINO_SEGUNDA.replace('https://', '')}\n` +
    `🔗 Quintas 👉 ${MEET_TREINO_QUINTA.replace('https://', '')}\n\n` +
    `📲 *Adicionar a próxima turma (${proximoTreino.dia}) ao seu calendário:*\n` +
    `👉 ${calendarLink}`

  const msgMateriais =
    `📚 *Materiais de apoio:*\n` +
    `Todos os documentos e vídeos do treinamento estão aqui:\n` +
    `👉 https://drive.google.com/drive/folders/1t0WpRYg7b5TIb7Hbbkjg9oyMI1bGXe-w?usp=sharing`

  const msgCadastro =
    `🔑 *Acessos (regra nova):*\n` +
    `O SEU login (sócio) chega automático no WhatsApp pelo número +55 21 4020-2024 depois do treinamento — é só clicar em "Sim, quero".\n` +
    `Pra criar os logins dos seus vendedores: abre o chat dentro da plataforma (círculo azul no canto) → opção *Cadastrar/Remover Usuário* → preenche ali e a senha chega por SMS em até 48h úteis. 😊`

  return [msgReuniao, msgMateriais, msgCadastro]
}

export function buildKitPosFechamentoMsg(nome: string): string {
  return (
    `${nome}, enquanto o treinamento não acontece, aqui vai um resumo de como funciona a parceria — pra você já ficar por dentro de tudo: 👇\n\n` +
    `💰 *Taxa:* 12% por venda aprovada — única cobrança. Sem mensalidade e sem custo de ativação.\n` +
    `🏷️ *Precificação:* na venda parcelada, o valor do aparelho pode ser acrescido em até *15%* sobre o seu preço à vista (explicado no vídeo do curso, na pasta de materiais).\n` +
    `💵 *Repasse:* você recebe à vista, em até *2 dias úteis* após a venda.\n` +
    `🛡️ *Inadimplência:* risco *zero* pra você — a AIVA assume 100%. Se o cliente atrasar, o problema é dela, não seu.\n` +
    `📲 *Pro seu cliente:* aprovação em ~2 minutos, com DUAS financeiras na mesma consulta — pela AIVA o parcelamento é mensal (6x, 9x ou 12x) e, se ela não aprovar, a Odres Cred tenta na hora (bissemanal, 12x ou 18x). Menos venda perdida!\n` +
    `🎲 *Sobre aprovação (importante!):* cada consulta depende do perfil do cliente — é normal as primeiras consultas reprovarem, isso NÃO significa que "não aprova". A regra de ouro é consultar TODO cliente: quem consulta todo mundo aprova mais e vende mais no fim do mês. Não desanima com as primeiras! 💪\n\n` +
    `*Próximos passos:*\n` +
    `1️⃣ Participa do treinamento ao vivo — turmas às *segundas e quintas, 9h30–10h30* (o vídeo Curso_Treinamento na pasta de materiais adianta tudo)\n` +
    `2️⃣ Depois do treinamento, o SEU login chega automático no WhatsApp pelo número +55 21 4020-2024 — clica em "Sim, quero" e pronto\n` +
    `3️⃣ Logins dos vendedores: você mesmo solicita no chat dentro da plataforma (opção Cadastrar/Remover Usuário — senha por SMS em até 48h úteis). Aí é só fazer a primeira venda — eu acompanho você aqui! 😊\n\n` +
    `Qualquer dúvida sobre taxa, repasse ou o sistema, me pergunta que eu respondo na hora.`
  )
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
    `São os dados que a AIVA usa pra analisar o perfil da loja e concluir sua aprovação — os valores podem ser aproximados, sem compromisso.\n\n` +
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
  // "Comunicados Aiva Pay" (+55 4020-2024) — envia login/senha do Flexfone aos
  // clientes novos (treinamento 20/08/2026). Duas chaves de propósito: escrito
  // "+55 4020-2024" o chaveFone NÃO remove o 55 (número curto), então sem a
  // segunda entrada o pós-processamento apagava a frase inteira da VictorIA.
  '40202024',
  '5540202024',
  '2140202024',   // mesma linha com DDD 21 (+55 21 4020-2024 — grafia do aviso do Edu 27/08)
  '552140202024',
  '1140201990', // Suporte Odres Cred cliente final — WhatsApp (11) 4020-1990 (material Flexfone 27/08)
]

export const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

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

// ─── Formatação de dados coletados pra alertas do Nei/Aldo ────────────────────
// Deixa os alertas 🟡 (pré-aprovação) e ✅ (cadastro completo) DETALHADOS — como
// o alerta 📋 de colaboradores que o Aldo curtiu — pra o Nei acompanhar sem abrir
// o painel. Mostra só os campos que existem, na ordem do funil.
const LABEL_DADOS: Array<[string, string]> = [
  ['nome_socio', '👤 Sócio'],
  ['telefone_socio', '📱 Telefone'],
  ['email_socio', '📧 Email'],
  ['nome_varejo', '🏪 Loja'],
  ['cnpj_matriz', '🏢 CNPJ matriz'],
  ['tempo_cnpj', '📅 Tempo de CNPJ'],
  ['cnpjs_adicionais', '🏢 CNPJs adicionais'],
  ['regiao_varejo', '📍 Região/Cidade'],
  ['localizacao_lojas', '📍 Localização das lojas'],
  ['numero_lojas', '🔢 Nº de lojas'],
  ['faturamento_anual', '💰 Faturamento anual'],
  ['valor_boleto_mensal', '💵 Venda mensal no crediário'],
  ['possui_outra_financeira', '💳 Outra financeira'],
  // Fluxo sem sócio (coletados no chat — vão pra aba Manual da planilha)
  ['cpf_responsavel', '🧾 CPF do responsável'],
  ['nome_fantasia', '🏷️ Nome fantasia'],
  ['banco_codigo', '🏦 Banco (código)'],
  ['banco_agencia', '🏦 Agência'],
  ['banco_conta', '🏦 Conta'],
  ['banco_digito', '🏦 Dígito da conta'],
]

/**
 * Formata os dados coletados de um lead num bloco legível pra alerta de WhatsApp.
 * Só inclui campos preenchidos. Retorna '' se não houver nada.
 */
export function formatarDadosLead(dados: Record<string, string | null | undefined>): string {
  const linhas: string[] = []
  for (const [chave, label] of LABEL_DADOS) {
    const v = dados[chave]
    if (v && String(v).trim() && String(v).trim().toLowerCase() !== 'null') {
      linhas.push(`${label}: ${String(v).trim()}`)
    }
  }
  return linhas.join('\n')
}

// ── Busca dos painéis ────────────────────────────────────────────────────────
// Compara sem acento/caixa e, pra número, só os dígitos — assim
// "52.618.643/0001-05", "52618643" e "(55) 16 99340-0269" acham a mesma linha.
// Nasceu em /registros e virou compartilhada quando /desempenho ganhou os
// mesmos campos de busca (2026-08-25).
export const normBusca = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/**
 * `true` se o termo casa com QUALQUER um dos campos. Termo vazio casa com tudo.
 * O casamento por dígitos só vale a partir de 3 dígitos, senão "12" acharia
 * metade da base por causa de CNPJ/telefone.
 */
export function casaBusca(termo: string, campos: unknown[]): boolean {
  const t = normBusca(termo).trim()
  if (!t) return true
  const tDig = soDigitos(termo)
  return campos.some((c) => {
    if (normBusca(c).includes(t)) return true
    return tDig.length >= 3 && soDigitos(c).includes(tDig)
  })
}
