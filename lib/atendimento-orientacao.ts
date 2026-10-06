/**
 * atendimento-orientacao.ts — traduz o motivo do acionamento em "o que está acontecendo" e
 * "o que fazer", as duas colunas que orientam o Nei no /atendimento (Aldo 05/10/2026, mesmo
 * formato do painel da Parcelex). Parte pura (`npm run test:avisos`).
 *
 * O motivo vem da VictorIA: às vezes é um código do prompt ("acesso_flexfone_nao_chegou"), às
 * vezes um código que ela inventa ("erro_vinculo_societario_persistente") e às vezes texto livre
 * ("lead pediu contato por telefone/meet"). Por isso são 3 camadas: dicionário exato → famílias
 * por palavra-chave → texto do próprio motivo com uma ação genérica.
 */

export type Orientacao = { situacao: string; acao: string }

const AIVA = 'a AIVA (Mauricio/Edu)'

const EXATOS: Record<string, Orientacao> = {
  acesso_flexfone_nao_chegou: { situacao: 'A senha do sócio não chegou — o prazo da AIVA já venceu', acao: `Cobrar ${AIVA} pelo envio da senha. A VictorIA não promete data.` },
  senha_reenviada_nao_chegou: { situacao: 'Reenviamos a senha e o lojista diz que não recebeu', acao: 'Conferir se o telefone do cadastro da AIVA é o dele; se não for, mandar o link de atualização cadastral.' },
  reenviar_senha_painel: { situacao: 'Lojista não acha a mensagem com a senha', acao: 'Reenviar a senha pelo painel da AIVA (card da loja → Reenviar senha).' },
  senha_usuario_nao_chegou: { situacao: 'Usuário de vendedor/gerente foi pedido e a senha não veio por SMS', acao: `Cobrar ${AIVA} com nome, função e data do pedido. Reenviar a senha do sócio NÃO resolve.` },
  acesso_colaborador_pendente: { situacao: 'Equipe da loja ainda sem acesso', acao: 'Conferir se o sócio já preencheu o formulário de Login de operadores; se não, mandar o link.' },
  telefone_cadastro_diferente: { situacao: 'O telefone do cadastro na AIVA não é o do lojista — a senha vai pra outro número', acao: 'Ajudar o lojista a trocar o telefone pelo link de atualização cadastral.' },
  corrigir_dado_cadastro: { situacao: 'Lojista quer corrigir um dado do cadastro antes de a loja ser criada', acao: `Pedir a correção pra ${AIVA}.` },
  dificuldade_onboarding_caf: { situacao: 'Lojista travou no cadastro da AIVA (formulário ou biometria)', acao: `Ver o print na conversa. Se for erro do site, abrir com ${AIVA}; se for dúvida, ligar e fazer junto.` },
  link_biometria_nao_chegou: { situacao: 'Lojista não achou o link da biometria', acao: 'Reenviar o link da biometria (está no card da loja no painel da AIVA).' },
  link_biometria_nao_reabre: { situacao: 'Biometria negada e o link só abre a tela de concluído — o lojista não consegue refazer', acao: `Pedir um link novo de biometria pra ${AIVA} e mandar pro lojista.` },
  portal_pre_cadastro_pendente: { situacao: 'O pré-cadastro não chegou à AIVA', acao: 'Reenviar o formulário de pré-cadastro pelo Registros AIVA.' },
  biometria_refeita: { situacao: 'A selfie tinha sido reprovada e o lojista diz que refez', acao: 'Conferir no painel da AIVA se a biometria passou agora.' },
  portal_nao_atualizou_cadastro: { situacao: 'Lojista insiste que concluiu o cadastro, mas o portal da AIVA mostra em aberto', acao: `Conferir no painel da AIVA em que etapa parou; se ele fez mesmo, abrir com ${AIVA}.` },
  cadastro_caf_confirmado: { situacao: 'Lojista disse que concluiu o cadastro', acao: 'Nada a mover: o card anda sozinho quando a AIVA criar a loja. Marcar Atendido.' },
  cadastro_completo: { situacao: 'Lojista passou todos os dados do cadastro', acao: 'Lançar o CNPJ em Registros AIVA.' },
  qualificacao_inicial_completa: { situacao: 'Qualificação completa — pronto pra pré-aprovação', acao: 'Lançar o pré-cadastro em Registros AIVA.' },
  aiva_nao_criou_loja: { situacao: 'Lojista fez tudo e a biometria foi aprovada — falta a AIVA criar a loja', acao: `Cobrar ${AIVA} pela criação da loja.` },
  loja_finalizada_sem_operar: { situacao: 'Loja liberada que nunca chegou a operar', acao: 'Ligar: descobrir se falta senha, treinamento ou cadastro dos vendedores.' },
  loja_ativa_sem_vendas: { situacao: 'Lojista desanimado ou reclamando de vendas fracas', acao: 'Ligar pra entender — é risco de a loja parar.' },
  desanimo_reprovacao_inicial: { situacao: 'Lojista desanimado porque os primeiros clientes foram reprovados', acao: 'Ligar e explicar que a aprovação varia por CPF; reforçar consultar todo cliente.' },
  interesse_parcelex: { situacao: 'Lojista quer a Parcelex (segunda financeira)', acao: 'Encaminhar pro fluxo da Parcelex.' },
  quer_flexfone: { situacao: 'Lojista perguntou do Flexfone / da Odres', acao: 'Explicar a liberação pelo telefone.' },
  duvida_odres: { situacao: 'Dúvida sobre a Odres que a VictorIA não responde', acao: 'Responder o lojista.' },
  duvida_treinamento: { situacao: 'Dúvida sobre o treinamento', acao: 'Responder o lojista (turmas e link estão no kit de treinamento).' },
  duvida_pos_cadastro: { situacao: 'Dúvida depois do cadastro que a VictorIA não soube responder', acao: 'Ler a conversa e responder o lojista.' },
  duvida_qsa_historico: { situacao: 'Dúvida sobre os sócios da empresa (QSA)', acao: 'Conferir o quadro societário e responder o lojista.' },
  campanha_comissao: { situacao: 'Quer os detalhes da campanha de bônus/comissão vigente', acao: 'Passar as regras da campanha atual.' },
  confirmar_contato: { situacao: 'Lojista desconfiou de um contato/número da Track', acao: 'Confirmar pra ele se o contato é nosso.' },
  recusou_email_socio: { situacao: 'Lojista não quis passar o e-mail do sócio', acao: 'Ligar e explicar que o e-mail é exigência do cadastro da AIVA.' },
  usuario_multi_loja: { situacao: 'Quer um mesmo usuário em mais de uma loja', acao: `Confirmar com ${AIVA} como cadastrar.` },
  livechat_aiva_sem_resposta: { situacao: 'O Live Chat da AIVA não respondeu o lojista em 2 dias úteis', acao: `Cobrar ${AIVA} pelo atendimento do Live Chat.` },
  cnpj_menos_de_1_ano: { situacao: 'CNPJ com menos de 1 ano — não qualifica', acao: 'Conferir se o lojista tem outro CNPJ mais antigo.' },
  cnpj_irregular_receita: { situacao: 'CNPJ irregular na Receita (inapto, suspenso ou baixado)', acao: 'Orientar o lojista a regularizar com o contador.' },
  cnpj_invalido: { situacao: 'O CNPJ que o lojista passou é inválido (dígito não confere)', acao: 'Confirmar o CNPJ certo com o lojista.' },
  cnpj_nao_encontrado_na_receita: { situacao: 'O CNPJ que o lojista passou não consta na Receita', acao: 'Confirmar o CNPJ certo com o lojista.' },
  atendimento_automatico_detectado: { situacao: 'Quem responde é o robô da loja', acao: 'Ligar pra falar com uma pessoa.' },
  loja_nova_incluida: { situacao: 'Lojista informou uma loja/filial nova', acao: 'Conferir se o CNPJ entrou em Registros AIVA e na aba Filiais.' },
  solicitacao_exclusao_dados: { situacao: 'Lojista pediu a exclusão dos dados dele (LGPD)', acao: 'Atender o pedido de exclusão e confirmar pra ele.' },
  cliente_importado_portal: { situacao: 'Cliente que veio importado do portal', acao: 'Ler a conversa e responder o lojista.' },
}

/** Famílias por palavra-chave, na ordem: a primeira que casar vale. */
const FAMILIAS: Array<{ re: RegExp; o: Orientacao }> = [
  { re: /cliente_final/, o: { situacao: 'Problema com um cliente final da loja', acao: `Abrir com ${AIVA}; o lojista está com o cliente esperando.` } },
  { re: /inativ|bloquead|suspens/, o: { situacao: 'Loja inativada ou bloqueada na AIVA', acao: `Abrir com ${AIVA} pra saber o motivo e dar retorno ao lojista.` } },
  { re: /repasse|pagamento|recebimento/, o: { situacao: 'Problema ou dúvida sobre repasse', acao: 'Mandar o formulário de repasses (ou o do painel financeiro) e acompanhar.' } },
  { re: /vinculo_societario|validacao_socio|cpf_nao/, o: { situacao: 'O cadastro da AIVA não reconhece o sócio/CPF', acao: `Abrir com ${AIVA} com o CNPJ e o CPF do sócio.` } },
  { re: /biometria/, o: { situacao: 'Problema na biometria (reconhecimento facial)', acao: `Ligar e tentar junto pelo celular; se não abrir, abrir com ${AIVA}.` } },
  { re: /onboarding|caf|tela_(branca|travada)|recaptcha|formulario/, o: { situacao: 'Erro ou travamento no cadastro da AIVA', acao: `Ver o print na conversa e abrir com ${AIVA}.` } },
  { re: /filial|loja_nova|cnpj_adicional/, o: { situacao: 'Assunto de filial / segundo CNPJ', acao: 'Conferir o CNPJ da filial em Registros AIVA e orientar o formulário de filial.' } },
  { re: /colaborador|operador|vendedor|funcionario/, o: { situacao: 'Assunto de acesso/dados da equipe da loja', acao: 'Conferir os dados na conversa e lançar no formulário de Login de operadores (Registros AIVA → Lançar manual).' } },
  { re: /cnpj/, o: { situacao: 'Problema com o CNPJ do lojista', acao: 'Conferir o CNPJ na Receita e falar com o lojista.' } },
  { re: /login|senha|acesso/, o: { situacao: 'Problema de login / acesso à plataforma', acao: 'Conferir se a senha foi enviada; se foi e não entra, mandar o link de atualização cadastral.' } },
  { re: /catalogo|modelo|aparelho|preco/, o: { situacao: 'Dúvida sobre catálogo, modelos ou preços da plataforma', acao: 'Não é com a gente: orientar o Live Chat da AIVA.' } },
  { re: /visita|presencial/, o: { situacao: 'Lojista pediu visita / consultor na loja', acao: 'Ligar pro lojista (não fazemos visita — atender por ligação ou vídeo).' } },
  { re: /liga[cç][aã]o|telefone|telefonic|meet|chamada|call\b/, o: { situacao: 'Lojista quer falar por ligação ou vídeo', acao: 'Ligar pro lojista.' } },
  { re: /representa|parceri|indic/, o: { situacao: 'Lojista indicou alguém ou quer ser parceiro/representante', acao: 'Ligar e entender a proposta.' } },
  { re: /contato|decisor|responsavel|transferid/, o: { situacao: 'Contato passou pra outra pessoa (sócio/decisor)', acao: 'Falar com a pessoa indicada.' } },
  { re: /desanimo|desist|parar|cancel/, o: { situacao: 'Lojista desanimado ou pensando em desistir', acao: 'Ligar hoje.' } },
  { re: /irritad|reclama|insatisf/, o: { situacao: 'Lojista irritado ou reclamando', acao: 'Ligar hoje.' } },
  { re: /^duvida|pediu_mais_info|receio/, o: { situacao: 'Dúvida que a VictorIA não soube responder', acao: 'Ler a conversa e responder o lojista.' } },
  { re: /interesse/, o: { situacao: 'Lojista demonstrou um interesse fora do fluxo', acao: 'Ler a conversa e responder o lojista.' } },
  { re: /pediu|humano|atendente|pessoa/, o: { situacao: 'Lojista pediu pra falar com uma pessoa', acao: 'Assumir a conversa.' } },
]

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const frase = (s: string) => { const t = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : '' }

export function orientar(motivoBruto: string | null | undefined): Orientacao {
  const motivo = (motivoBruto ?? '').trim()
  if (!motivo) return { situacao: 'A VictorIA acionou sem registrar o motivo', acao: 'Abrir a conversa, ver o que o lojista precisa e marcar Atendido.' }
  // "codigo: detalhe livre" → o detalhe vai junto da situação
  const [cabeca, ...resto] = motivo.split(/:\s*/)
  const detalhe = resto.join(': ').trim()
  const codigo = semAcento(cabeca).replace(/\s+/g, '_')
  const comDetalhe = (o: Orientacao): Orientacao => (detalhe ? { ...o, situacao: `${o.situacao} — ${detalhe}` } : o)
  const exato = EXATOS[codigo]
  if (exato) return comDetalhe(exato)
  const fam = FAMILIAS.find((f) => f.re.test(codigo))
  // código inventado ou texto livre: mostra o que a VictorIA escreveu (é mais específico que o rótulo da família)
  const proprio = frase(cabeca)
  if (fam) return comDetalhe({ situacao: /_/.test(cabeca) ? `${fam.o.situacao} (${proprio.toLowerCase()})` : proprio, acao: fam.o.acao })
  return comDetalhe({ situacao: proprio, acao: 'Ler a conversa e responder o lojista.' })
}

/** Texto curto da última fala do lojista pra caber na coluna. */
export function resumirFala(conteudo: string | null | undefined, max = 110): string {
  const c = (conteudo ?? '').trim()
  if (!c) return ''
  if (/^\[LEAD_ENVIOU_IMAGEM/.test(c)) return '📷 enviou uma imagem'
  if (/^\[LEAD_ENVIOU_(AUDIO|ÁUDIO)/i.test(c)) return '🎤 enviou um áudio'
  if (/^\[LEAD_ENVIOU_/.test(c)) return '📎 enviou um arquivo'
  const limpo = c.replace(/\s+/g, ' ')
  return limpo.length > max ? `${limpo.slice(0, max - 1).trimEnd()}…` : limpo
}

/** "Parado há": minutos, horas (até 48h) ou dias. */
export function haQuanto(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const h = Math.max(0, agora - t) / 3_600_000
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 48) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} dias`
}
