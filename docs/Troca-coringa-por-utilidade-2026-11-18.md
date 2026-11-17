# Troca do coringa 48 pelos templates de utilidade (18/11/2026)

> Pedido do Aldo: "tudo que dá pra usar os templates aprovados como utilidade, usar — menor custo possível".
> **Estado: código publicado com a troca DESLIGADA.** Enquanto a chave não for ligada, cada rotina segue
> exatamente como era (coringa 48, texto antigo). Ligar depende do OK do Aldo nos textos abaixo.

## Como liga e desliga

Chave `coringa_utilidade_ativo` na tabela `sdr_avisos_chave` (mesmo padrão da `regua_alerta_ativa`).

- ligar: `insert into sdr_avisos_chave (chave, ultimo_aviso) values ('coringa_utilidade_ativo', now())`
- desligar: `delete from sdr_avisos_chave where chave = 'coringa_utilidade_ativo'`

Vale pra todas as rotinas convertidas de uma vez, em até 20 segundos. Se a Meta reclassificar um template
ou a entrega cair, apagar a chave volta tudo pro 48 na hora, sem deploy.

## Os dois corpos (aprovados na Meta como utilidade; IDs do Evo, fila 10)

- **87 — pendência:** Olá `{{1}}`, aqui é a VictorIA da Track. A loja `{{2}}` tem uma pendência registrada: `{{3}}` Prazo: `{{4}}` Dúvidas, responda esta mensagem.
- **86 — etapa concluída:** Olá `{{1}}`, aqui é a VictorIA da Track. A loja `{{2}}` teve uma etapa concluída: `{{3}}` Situação: `{{4}}` Dúvidas, responda esta mensagem.

O 85 ("alteração na conta") não foi usado: nenhuma rotina de hoje comunica mudança de conta ou de regra.

`{{2}}` é o nome da loja do cadastro (`nome_varejo`); se faltar, o nome do lead.

## Rotinas convertidas e os textos novos

Todos os textos estão num arquivo só: `lib/template-utilidade-calc.ts` (`npm run test:utilidade`).

### Cobrança do formulário do varejo — template 87

| toque | pendência | prazo |
|---|---|---|
| 1 (D+1) | falta preencher o formulário do varejo da AIVA. O cadastro já foi aprovado e é esse formulário que libera a plataforma. | assim que puder. Conseguiu abrir o link que a AIVA te enviou? Se precisar, eu te mando de novo. |
| 2 (D+3) | o formulário do varejo da AIVA ainda não foi preenchido. | assim que puder. Travou em algum campo ou ficou alguma dúvida? Me conta que eu te ajudo a concluir. |
| 3 (D+7) | o formulário do varejo da AIVA segue pendente. Sem ele a loja não é liberada. | assim que puder. Quer que eu reenvie o link? Se travou em alguma tela, me manda um print. |
| 4 (D+14) | último lembrete do formulário do varejo da AIVA. O cadastro fica em aberto até ele ser preenchido. | sem data definida. Se ainda tiver interesse, me responde que eu te ajudo a concluir. |

### Cadastro recebido com dado faltando — template 87

| pendência | prazo |
|---|---|
| falta informar *[o dado que falta]* pra concluir o cadastro na AIVA. A loja já passou na análise. | assim que puder. É só me responder por aqui com essa informação. |

### Biometria (reconhecimento facial) — template 87

| toque | pendência | prazo |
|---|---|---|
| 1 | falta o reconhecimento facial, último passo do cadastro na AIVA. | assim que puder. É pelo celular, só apontar a câmera pro rosto: *[link]* |
| 2 (D+2) | o reconhecimento facial do cadastro na AIVA ainda não foi feito. | assim que puder. Leva menos de 2 minutos pelo celular: *[link]* |
| 3 (D+5) | último lembrete do reconhecimento facial. Sem ele a loja não é liberada pela AIVA. | sem data definida. O link é este: *[link]* |
| negada 1 (desligado hoje) | o reconhecimento facial não foi aprovado pela AIVA e precisa ser refeito. Isso acontece quando a foto do documento ou do rosto não fica legível. | assim que puder. Refaça em lugar bem iluminado, sem boné nem óculos e com o documento original em mãos: *[link]* |
| negada 2 (desligado hoje) | o reconhecimento facial segue reprovado e precisa ser refeito pra loja ser liberada. | (o mesmo) |

### Acesso liberado e nunca usado — template 87

| toque | pendência | prazo |
|---|---|---|
| 1 | o acesso da loja na AIVA ainda não foi usado. | assim que puder. O login e a senha vêm pelo WhatsApp do número +55 21 4020-2024 e o acesso é em https://vendas.flexfone.com.br/login. Se não achou a mensagem, me responde aqui. |
| 2 | o acesso da loja na AIVA segue sem uso. | assim que puder. Se a senha não chegou ou ficou em outro número, me avisa aqui que eu te ajudo. |

### Treinamento — template 87

| caso | pendência | prazo |
|---|---|---|
| sem inscrição | falta participar do treinamento da AIVA. | as próximas turmas são *[turma 1]* e *[turma 2]*, online. Me avisa que eu te mando o link do dia. |
| inscrito, turma por vir | treinamento da AIVA agendado (online, 1 hora). | *[dia e hora da turma]*. É só entrar por este link na hora: *[link]* |
| turma já passou | confirmar se você participou do treinamento da AIVA de *[turma]*. | a próxima turma é *[turma]*. Se não deu pra participar, me avisa que eu te mando o link. |

### Ticket resolvido pela AIVA — template 86

| tipo | etapa concluída | situação |
|---|---|---|
| painel financeiro | pedido de acesso ao painel financeiro da AIVA resolvido (ticket nº N). | acesso liberado. Use este link com o e-mail que você informou: *[link]* Se aparecer pedido de acesso, confere o e-mail (inclusive spam e promoções). Vídeo de como usar o painel: *[link]* |
| repasse | chamado sobre o seu repasse resolvido pela AIVA (ticket nº N). | resolvido. Se ainda ficou alguma dúvida sobre esse valor, me chama aqui. |
| filial | cadastro da sua filial concluído pela AIVA (ticket nº N). | concluído. Qualquer dúvida pra começar a operar nela, me chama aqui. |
| outros | chamado na AIVA resolvido (ticket nº N). | resolvido. Se ainda precisar de algo, me chama aqui. |

### Avisos de mudança de etapa (uma vez por loja) — template 86

| quando | etapa concluída | situação |
|---|---|---|
| pré-aprovação | pré-aprovação da loja na AIVA. | você não precisa fazer nada agora. O link do cadastro da AIVA chega aqui por mensagem, e é nele que você preenche os dados da loja. |
| biometria aprovada | biometria aprovada pela AIVA. | do seu lado está tudo certo. Agora a AIVA cria a sua loja no sistema; depois eu te mando o material do treinamento, e o acesso chega pelo WhatsApp do número +55 21 4020-2024. Não precisa fazer mais nada por enquanto. |
| acesso liberado | acesso à AIVA liberado. | o login e a senha vêm pelo WhatsApp do número +55 21 4020-2024 e o acesso é em https://vendas.flexfone.com.br/login. Se não chegou ou travou em algum passo, me chama aqui. |
| primeiro acesso | primeiro acesso à plataforma da AIVA realizado. | loja pronta pra consultar. A consulta de CPF sai em uns 2 minutos e pode ser feita pra qualquer cliente que pedir preço. Qualquer dúvida no sistema, me chama aqui. |

### Avisos internos (Aldo e Nei) — template 87

Alertas do sistema e o briefing das 5h. A loja vira "Track (aviso interno)", a pendência é o próprio aviso de
uma linha e o prazo é "verificar hoje.". Exemplo: *A loja Track (aviso interno) tem uma pendência registrada:
⚠️ entrega AIVA baixa (saíram 120 de 500): 22% — disparo SEGUE; se for apagão, /pausar. Prazo: verificar hoje.*

## O que saiu dos textos na conversão

Emojis, "vender parcelado", "liberar o crediário", "dica de ouro" e qualquer argumento de venda. Em template
de utilidade isso arrisca a Meta reclassificar o modelo pra marketing — e aí os três ficam caros de uma vez,
inclusive a régua de alerta. O teste `test:utilidade` barra essas palavras.

## O que NÃO foi convertido, e por quê

| rotina | por que fica no 48 |
|---|---|
| Retomada de interessado (até 420 envios/dia) | É prospect, ainda não é loja: "a loja X tem uma pendência registrada" não é verdade pra ele, e é prospecção — marketing por natureza. É o maior volume do coringa e o maior risco de reclassificação. |
| Campanha de boas-vindas | Fala de prêmio em dinheiro (R$ 80 por semana, R$ 500). É promoção. |
| Painel: "Enviar info" e "Follow-up agora" | Texto livre digitado pelo operador ou gerado pela IA; não cabe num corpo fixo. |
| Dicas de desempenho, consultoria, comunicados, check/treinar primeira venda | Fora do agendamento (rodada manual ou desligadas). |

## Disparo inicial (D+0)

Usa o template 41 ("Saber Mais"), que o Evo lista como utilidade. Nenhuma mudança de código. O ID 96, que
apareceu depois da sincronização como marketing com o mesmo nome, não é usado em lugar nenhum. O D+0 segue
pausado por ordem do Aldo (10/11); só ele dá `/retomar`.

## Atualização — "mais nada pelo 48" (decisão do Aldo, 17/11 à noite)

Depois de ler o alerta de risco, o Aldo determinou: **nada mais sai pelo coringa 48**. A chave
`coringa_utilidade_ativo` foi ligada em 17/11 às 18h19 e as rotinas que tinham ficado de fora foram convertidas.
A seção "O que NÃO foi convertido" acima deixou de valer.

| rotina | template | como ficou |
|---|---|---|
| Retomada de interessado (toques 1, 2 e 3) | 87 | a "pendência" é o cadastro ou a conversa em aberto; a pergunta vai no prazo |
| Campanha de boas-vindas | 86 | a etapa é o momento da campanha (entrada, placar parcial, fechamento da semana, encerramento); a situação é o texto antigo com o placar, sem emoji. **Única rotina que leva prêmio em R$ num template de utilidade.** |
| Painel: "Enviar info" | 87 | pendência "há um retorno do nosso time pra você."; o texto digitado vai no prazo |
| Painel: "Follow-up agora" | 87 | pendência "o atendimento da loja com a Track ficou em aberto."; a frase da IA vai no prazo |
| Dicas, consultoria, comunicados, check/treinar primeira venda (fora do agendamento) | 87 | pendência "há um aviso do nosso time sobre a AIVA pra sua loja."; o texto antigo vai no prazo |

Textos da retomada (template 87):

| caso | pendência | prazo |
|---|---|---|
| toque 1, com dados | o cadastro da loja na AIVA foi iniciado e parou no meio. Os dados já informados estão guardados. | sem data definida. Dá pra retomar de onde paramos, sem começar do zero. Quer seguir? |
| toque 2, com dados | o cadastro da loja na AIVA segue incompleto. Falta pouco pra concluir. | último contato sobre isso. Se ainda fizer sentido, me responde que eu sigo de onde paramos. |
| toque 1, sem dados | a conversa sobre a AIVA pra sua loja ficou sem conclusão. | sem data definida. Se ainda fizer sentido, eu te explico em 2 minutos como funciona e o que precisa pra ativar. Quer que eu siga? |
| toque 2, sem dados | a conversa sobre a AIVA pra sua loja segue em aberto. | último contato sobre isso. Se quiser saber como fica pra sua loja, é só me responder. Se não for o momento, não te incomodo mais. |
| toque 3, com dados | o cadastro da loja na AIVA segue em aberto. | antes de encerrar por aqui. A AIVA faz turmas ao vivo segunda, quarta e sexta às 9h30 mostrando a ferramenta numa loja de verdade. Quer o link da próxima, sem compromisso? |
| toque 3, sem dados | a conversa sobre a AIVA pra sua loja segue em aberto. | antes de encerrar por aqui. Em vez de eu explicar, dá pra ver a AIVA funcionando ao vivo: tem turma segunda, quarta e sexta às 9h30. Quer o link da próxima, sem compromisso? |

**A chave continua existindo como volta de emergência:** apagar `coringa_utilidade_ativo` devolve todas as
rotinas ao 48 sem deploy. Falha na leitura da chave não derruba pro 48 (segue em utilidade).

### ⚠️ Risco assumido, com precedente nosso

Em ~10/11 a Meta reclassificou como MARKETING oito templates nossos que tinham sido aprovados como utilidade,
entre eles o **41 (D+0)** e o **48** (HANDOFF, bloco de 12/11). O catálogo do Evo continua mostrando os dois
como "UTILITY", mas esse campo é o do Evo, não o da Meta — **a categoria cobrada só se confirma no WhatsApp
Manager ou na fatura**. Ou seja: a Meta já reclassificou template nosso por causa do uso em prospecção. Passar a
retomada (até 420 envios/dia a prospects) e a campanha com prêmio pelo 87 e pelo 86 expõe os dois ao mesmo
tratamento; se acontecer, a régua de alerta e todas as rotinas de cadastro encarecem juntas.

### Outros templates em uso (não são o 48)

34 (link de cadastro), 29 (loja pré-aprovada, hoje sem rota), 69 (treinamento completo), 41 (D+0) e o da régua
D+3/D+7 (pausada). O Evo lista todos como utilidade; vale o mesmo aviso — conferir na Meta.

### Campanha de boas-vindas: parada na prática

A simulação de 17/11 mostra `dados_frescos: false` (último retrato do portal em 26/10) e **0 mensagens por
dia**: a rotina já se recusa a enviar placar com dado velho. Como a coleta do portal foi desligada de vez, ela
não volta a enviar. Está convertida, mas hoje não manda nada.

## Atualização 2 — D+0, link de cadastro e treinamento (2ª ordem do Aldo, 17/11 à noite)

"Não quero nenhum disparado pelo marketing." Os templates 41 (D+0), 34 (link de cadastro), 69 (treinamento) e os
da régua D+3/D+7/D+14 também passam a sair pelos de utilidade, com a mesma chave `coringa_utilidade_ativo`
(apagar a chave devolve cada um ao template antigo).

| envio | antes | agora | texto |
|---|---|---|---|
| Disparo inicial (D+0) | 41, com botão "Saber Mais" | 86 (era 87 na 1ª versão; o Aldo achou "pendência registrada" estranho pra 1º contato) | **Etapa:** seleção para o convite da parceria AIVA de financiamento de celulares. **Situação:** aguardando o retorno da loja. Aprovação do cliente em 2 minutos, recebimento em 2 dias úteis e risco de inadimplência por conta da AIVA. Quer que eu te explique como funciona? |
| Link de cadastro (loja aprovada) | 34 | 86 | **Etapa:** aprovação da loja pela AIVA. **Situação:** falta preencher o cadastro da AIVA neste link: *[link]* Assim que finalizar, me avisa por aqui. |
| Treinamento liberado | 69, cinco campos | 86 | **Etapa:** loja liberada pra etapa de treinamento da AIVA. **Situação:** turmas ao vivo de 1 hora (horário de Brasília): *[até 3 turmas com link]*. Materiais (documentos e vídeos): *[link do Drive]* O login do sócio chega pelo WhatsApp do número +55 21 4020-2024 depois do treinamento. Logins dos vendedores: *[formulário]* |
| Régua D+3/D+7/D+14 (pausada) | 31/32/38/39 | 87 | pendência genérica; o texto antigo vai no prazo |

Diferenças que importam no D+0:
- **Sem botão.** O 87 não tem o "Saber Mais"; o lojista precisa responder digitando.
- **Sem nome de pessoa.** No primeiro contato não há nome do sócio; a saudação é "Olá pessoal".
- **O texto diz "teve uma etapa concluída"** pra uma loja que nunca falou com a gente. A etapa descrita é a
  seleção pra lista de convite (verdadeira), sem dizer "aprovada". Continua sendo o envio com maior chance de o
  lojista bloquear ou denunciar — e é o de maior volume (500/dia). O D+0 segue PAUSADO (ordem do Aldo de 10/11); só ele dá `/retomar`.

Depois desta mudança, o único `sendTemplate` direto que resta no código é o da própria régua de alerta, que já
usa o 87 e o 86.
