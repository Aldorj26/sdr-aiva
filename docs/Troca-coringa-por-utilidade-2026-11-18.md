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
