# Proposta — régua de ativação em cima dos alertas da AIVA (17/11/2026)

> **Status: proposta pra aprovação do Aldo. Nada foi implementado nem enviado.**
> Fonte nova: `GET /api/public/partner/retailers/attention` (liberado pelo Maurício em 17/11). Devolve só
> `retailer_id`, `attention_status` e `mes`. Não traz número nenhum (consultas, vendas, R$) — então **nenhum
> texto desta régua cita número**. O que ela ganha em troca: sabe *quem* abordar e *qual é o problema provável*.

## 0. Duas decisões do Aldo (17/11) — valem acima de tudo que está abaixo

1. **A régua é permanente, não uma ação pontual.** Toda loja que ENTRAR em qualquer um dos três alertas, em
   qualquer dia, entra na régua automaticamente — não só as 302 da foto de 17/11. A leitura do alerta roda
   todo dia; loja nova na lista recebe o toque 1 da trilha dela, loja que sai recebe o reconhecimento, loja
   que volta a entrar recomeça. As contagens deste documento são só o retrato de partida.
2. **Só começa depois dos templates de utilidade.** Nenhum envio desta régua sai pelo template 48 (cobrado
   como marketing). A régua fica travada até a Maísa sincronizar no Evo os três templates que o Gustavo
   aprovou como utilidade E a gente confirmar, num envio de teste, que eles entregam e são cobrados como
   utilidade. **Atualização 17/11 à tarde:** a Maísa sincronizou — IDs **85, 86 e 87** no Evo, os três como utilidade
   (conferido no catálogo da fila 10). Os textos da seção 4 já foram reescritos pro formato deles. Falta o
   envio de teste (entrega + cobrança como utilidade) e o seu OK nos textos.

## 1. O que temos na mão

O alerta sozinho diz pouco. Cruzado com a coluna do quadro que a mesma API já devolve (`board_column`:
nunca consultou / já consultou / já vendeu), ele vira diagnóstico. Sondagem de 17/11 — 327 lojas em alerta,
**302 com lead nosso** (as contagens abaixo são de leads):

| alerta da AIVA | nunca consultou | consultou, nunca vendeu | já vendeu | total |
|---|---|---|---|---|
| `novo_sem_engajamento` (até 30 dias de loja) | 33 | 32 | 0 | 65 |
| `antigo_sem_engajamento` (30+ dias, 0 consultas em 5 dias) | 54 | 108 | 37 | 199 |
| `baixa_performance` (30+ dias, consulta mas 0 vendas em 30 dias) | 0 | 21 | 17 | 38 |

Fora da régua por enquanto: 13 lojas em alerta sem lead nosso e 10 sem cadastro na listagem (vão numa lista
pro Nei conferir), 4 leads descartados, 1 opt-out.

**Como elas estão com a gente hoje:**
- Antigas sem engajamento: 93 das 199 não falam com a gente há mais de 60 dias; só 2 falaram na última semana.
- Novas: 61 das 65 falaram nos últimos 30 dias — a conversa ainda está quente.
- 18 têm marca de senha pendente: o problema delas é acesso, não venda.

**O que já aprendemos com as dicas antigas** (últimos 120 dias, resposta em até 72 h):

| tipo de mensagem | envios | respostas |
|---|---|---|
| dica de venda ("faça assim") pra quem aprova e não vende | 228 | 14 (6%) |
| dica de venda pra quem já vende | 273 | 35 (12%) |
| pergunta investigativa ("o que aconteceu?") pra quem parou | 20 | 7 (35%) |

A amostra da investigativa é pequena (20 envios, ela só rodou 6 dias antes do portal cair), mas a direção é
clara: **perguntar o que travou rende bem mais resposta do que dar dica**. A régua inteira parte disso.

## 2. As quatro trilhas

Cada loja entra em UMA trilha, definida por alerta + coluna do quadro. A trilha diz qual é a hipótese do
problema e qual é o único objetivo da conversa.

| trilha | quem | lojas | hipótese | objetivo |
|---|---|---|---|---|
| **A — Fechar a venda** | `baixa_performance` | 38 | está consultando agora; cliente reprova ou desiste no fechamento | 1 venda em 30 dias |
| **B — Reconquista** | `antigo_sem_engajamento` que já vendeu | 37 | vendedor saiu, acesso travou, desanimou com reprovação | voltar a consultar |
| **C — Primeira venda** | consultou e nunca vendeu, parou (novo 32 + antigo 108) | 140 | reprovou nas primeiras e desistiu | voltar a consultar com volume |
| **D — Primeira consulta** | nunca consultou (novo 33 + antigo 54) | 87 | senha não chegou, não fez treinamento, não sabe usar | 1ª consulta de CPF |

Ordem de prioridade na fila: **A → B → C (novas antes) → D**. A e B são as que estão mais perto de dinheiro:
A já está no balcão consultando, B já provou que vende.

Trilha D e as rotinas que já existem: loja nova que nunca consultou já é coberta por `acesso-pendente`,
`senha-pendente` e `check-treinamento`. A régua **não duplica** — quem tem marca de senha pendente ou cadastro
aberto fica com essas rotinas, e só entra na trilha D quando elas não se aplicam.

## 3. Cadência

- **Toque 1** no dia em que a loja aparece no alerta (ou na 1ª rodada, pra quem já está).
- **Toques 2, 3 e 4** a cada 7 dias, cada um testando uma hipótese diferente.
- **Depois do 4º sem resposta:** para de insistir toda semana. Passa a 1 toque a cada 30 dias. Hoje a dica é
  semanal sem fim — com 93 lojas mudas há 60+ dias, isso gasta template e derruba a qualidade do número.
- **Trilhas A e B, 3º toque sem resposta:** a loja vai pra lista de ligação do Nei (são 75 lojas no total, as de
  maior retorno). As outras trilhas não geram ligação.
- **Respondeu:** a régua pausa e a VictorIA conduz. Volta 7 dias depois da última fala do lojista se ele
  continuar no alerta.
- **Saiu do alerta** (voltou a consultar ou vendeu): recebe UMA mensagem de reconhecimento e a régua zera.
- **Mudou de alerta** (ex.: de "antigo sem engajamento" pra "baixa performance" = voltou a consultar): reconhece
  o avanço e troca de trilha.

Travas que continuam valendo (as mesmas das dicas de hoje): opt-out, fila humana, loja reprovada, pausa
pedida, conversa viva nas últimas 48 h, loja travada pelo limite de originação, horário comercial, teto de
45 envios por rodada. Com 45/dia a base inteira é coberta em ~7 dias úteis.

## 4. Os textos (reescritos em 17/11 pro formato dos templates de utilidade — precisam do seu OK)

Templates já sincronizados no Evo (fila 10), os três aprovados como **utilidade**: **85** alteração na conta,
**86** etapa concluída, **87** pendência registrada.

**Qual template leva o quê**

| uso na régua | template | como o lojista lê |
|---|---|---|
| os 4 toques de cada trilha | **87** | Olá `{{1}}`, aqui é a VictorIA da Track. A loja `{{2}}` tem uma pendência registrada: `{{3}}` Prazo: `{{4}}` Dúvidas, responda esta mensagem. |
| reconhecimento (saiu ou avançou no alerta) | **86** | Olá `{{1}}`, aqui é a VictorIA da Track. A loja `{{2}}` teve uma etapa concluída: `{{3}}` Situação: `{{4}}` Dúvidas, responda esta mensagem. |
| — | 85 | não entra na régua (é pra mudança de conta/regra; fica pros comunicados) |

**Regras de preenchimento**
- `{{1}}` = primeiro nome do sócio. `{{2}}` = nome da loja (nome do varejo do cadastro; se faltar, o nome do lead).
- `{{3}}` = o fato, curto e sem adjetivo. Só afirma o que o alerta + a coluna do quadro garantem.
- `{{4}}` = começa sempre com a **data da próxima conferência** (hoje + 7 dias, que é quando a régua olha de
  novo) e termina com a pergunta daquele toque. A data é verdadeira: não é prazo inventado nem ameaça.
- Cada campo em uma linha, sem quebra, sem link, sem emoji.
- **Saiu dos textos:** comissão do vendedor, Black November, "venda indo pro concorrente", caso das 185
  consultas. É argumento de venda — dentro de template de utilidade arrisca a Meta reclassificar pra marketing.
  Esses argumentos continuam com a VictorIA, na conversa, depois que o lojista responde.

Nos textos abaixo, `DD/MM` é a data da próxima conferência.

**Trilha A — Fechar a venda** (consulta, não vende) · template 87

| toque | `{{3}}` pendência | `{{4}}` prazo |
|---|---|---|
| 1 | há consultas de CPF, mas nenhuma venda concluída nos últimos 30 dias. | conferência em DD/MM. Me conta onde a venda trava: cliente reprovado, limite baixo ou desistência na entrada. |
| 2 | nenhuma venda concluída nos últimos 30 dias, mesmo com consultas de CPF. | conferência em DD/MM. Se o cliente aprovado desiste no final, me avisa que eu passo como apresentar a entrada de 25% logo no começo. |
| 3 | a loja segue sem venda concluída nos últimos 30 dias. | conferência em DD/MM. Se o motivo for reprovação, me conta quantos clientes vocês consultam por dia. |
| 4 | a loja segue sem venda concluída nos últimos 30 dias. | conferência em DD/MM. Posso te passar o passo a passo do atendimento no balcão, é só responder. |

**Trilha B — Reconquista** (já vendeu, parou) · template 87

| toque | `{{3}}` pendência | `{{4}}` prazo |
|---|---|---|
| 1 | sem consulta de CPF registrada nos últimos dias. A loja já vendeu pela AIVA antes. | conferência em DD/MM. Me conta o que mudou: equipe, acesso ou aprovação dos clientes. |
| 2 | sem consulta de CPF registrada nos últimos dias. | conferência em DD/MM. Se saiu vendedor ou a senha travou, me avisa que eu te mostro o caminho. |
| 3 | a loja segue sem consulta de CPF registrada. | conferência em DD/MM. Se o que parou foi cliente reprovado, me conta que eu explico como contornar. |
| 4 | a loja segue sem consulta de CPF registrada. | conferência em DD/MM. O que falta pra loja voltar a consultar esta semana? |

**Trilha C — Primeira venda** (consultou, nunca vendeu, parou) · template 87

| toque | `{{3}}` pendência | `{{4}}` prazo |
|---|---|---|
| 1 | consultas de CPF paradas e primeira venda ainda não concluída. | conferência em DD/MM. Os primeiros clientes foram reprovados? Me conta o que aconteceu. |
| 2 | primeira venda ainda não concluída e sem consulta de CPF nos últimos dias. | conferência em DD/MM. Se travou em alguma tela da consulta, me manda o print que eu te guio. |
| 3 | a loja segue sem a primeira venda concluída. | conferência em DD/MM. Me diz qual é o caso: clientes reprovados, equipe sem costume ou acesso travado. |
| 4 | a loja segue sem a primeira venda concluída. | conferência em DD/MM. O que falta: o passo a passo, cadastrar vendedor ou outra coisa? |

**Trilha D — Primeira consulta** (nunca consultou) · template 87

| toque | `{{3}}` pendência | `{{4}}` prazo |
|---|---|---|
| 1 | nenhuma consulta de CPF registrada desde a liberação da loja. | conferência em DD/MM. Me conta o que travou: o acesso não chegou, a equipe não sabe usar ou outra coisa. |
| 2 | nenhuma consulta de CPF registrada desde a liberação da loja. | conferência em DD/MM. Se ainda não conseguiu entrar na plataforma, responde aqui que eu te ajudo com o acesso. |
| 3 | a loja segue sem a primeira consulta de CPF. | conferência em DD/MM. Se faltou o treinamento, tem turma ao vivo segunda, quarta e sexta às 9h30. Responde que eu mando o link. |
| 4 | a loja segue sem a primeira consulta de CPF. | conferência em DD/MM. O que está faltando pra fazer a primeira consulta? |

**Reconhecimento** · template 86 · uma vez por avanço

| quando | `{{3}}` etapa concluída | `{{4}}` situação |
|---|---|---|
| saiu do alerta | a loja voltou a registrar movimento na AIVA. | sem pendência no momento. Se travar algo no sistema, me chama por aqui. |
| passou de "sem engajamento" pra "baixa performance" (voltou a consultar) | a loja voltou a consultar CPF. | falta a venda ser concluída. Se o cliente reprovar ou desistir, me conta que eu ajudo. |
| a coluna do quadro virou "primeira venda" | primeira venda concluída pela AIVA. | loja operando. Se precisar de ajuda com a equipe ou com o sistema, me chama por aqui. |

**Exemplo montado** (trilha B, toque 1):

> Olá Carlos, aqui é a VictorIA da Track.
>
> A loja Cell Center tem uma pendência registrada: sem consulta de CPF registrada nos últimos dias. A loja já vendeu pela AIVA antes.
>
> Prazo: conferência em 24/11. Me conta o que mudou: equipe, acesso ou aprovação dos clientes.
>
> Dúvidas, responda esta mensagem.

**O que eu perdi nessa conversão, pra você julgar:** o tom ficou mais seco e "de sistema" que o do 48, e a
palavra "Prazo" vem fixa no template — por isso o campo começa com "conferência em", pra não soar como
cobrança com punição. A pergunta investigativa sobreviveu, só que curta e no fim.

## 5. O que muda na conversa (VictorIA)

Quando o lojista responde, a VictorIA precisa saber em que trilha ele está pra investigar a coisa certa.
Proposta: um bloco curto no prompt dinâmico ("ALERTA DA LOJA: baixa performance — consulta e não vende.
Descubra em qual ponto a venda trava antes de dar dica"). E ela registra o **motivo declarado** numa marca nas
observações, com seis opções fechadas: acesso/senha, equipe/vendedor, reprovação, entrada/limite,
movimento fraco, desistiu do produto.

Esse registro é o que responde a pergunta "por que ele não está consultando / por que não está vendendo":
vira um quadro semanal de motivos por trilha. Mudança de prompt passa pelo `revisor-prompt-victoria` antes.

## 6. Como medir

- Retrato diário do alerta numa tabela nossa (hoje a API só mostra o mês corrente, sem histórico).
- Toda segunda, no briefing: quantas entraram e saíram do alerta, por trilha; taxa de resposta por toque;
  quadro de motivos declarados; lista de ligação do Nei.
- Meta da régua: **loja saindo do alerta**. É o único resultado que a API deixa a gente enxergar.

## 7. Limites que precisam ficar claros

- Sem número, a VictorIA não pode confirmar nem desmentir o que o lojista disser sobre vendas.
- Não sei com que frequência a AIVA recalcula o alerta. Se houver atraso, um lojista que vendeu ontem pode
  ainda estar na lista hoje — por isso os textos perguntam ("faz um tempo que não vejo") em vez de afirmar.
  Vale perguntar ao Maurício.
- As 85 lojas com Retail ID que **não** estão em alerta (71 delas em "primeira venda") são as que vendem.
  Elas ficam sem toque nenhum nesta régua; as dicas antigas pra quem vende dependiam de número e seguem paradas.
- **Templates (decisão do Aldo 17/11): a régua NÃO nasce no 48.** Espera os três de utilidade no Evo
  (aguardando a Maísa). Ponto de atenção: o formato deles é fixo — "A loja {{2}} tem uma pendência
  registrada: {{3}} Prazo: {{4}}", "teve uma etapa concluída: {{3}} Situação: {{4}}", "Alteração na conta da
  loja {{2}}: {{3}} Detalhe: {{4}} Data de aplicação: {{5}}" — e não comporta pergunta aberta longa nem
  argumento de venda. Cada toque vai ter de caber em "o que está pendente" + "prazo", com a pergunta
  investigativa ficando pra VictorIA fazer quando o lojista responder. E se o texto dos campos soar como
  promoção, a Meta pode reclassificar o template pra marketing — os campos têm de ficar factuais.
- `dicas-desempenho` (hoje calada por falta de dado fresco) seria substituída por esta régua, não somada.

## 8. Implementação, se aprovado

**Pré-requisito pra ligar (não pra construir):** IDs numéricos dos três templates de utilidade no Evo +
envio de teste confirmando entrega e cobrança como utilidade. Até lá a rota só roda em `?dry`.

1. Leitura do alerta + retrato diário + classificação em trilha (parte pura com teste).
2. Nova rota no lugar da `dicas-desempenho`, com `?dry` — você vê a fila e os textos reais antes de sair qualquer coisa.
3. Bloco do prompt + registro de motivo (via revisor).
4. Quadro semanal no briefing e lista de ligação do Nei em .xlsx.

## 9. Estado em 17/11 à noite — montada em simulação, SEM commit e SEM envio

Textos aprovados pelo Aldo ("Aprovado, monta"). Arquivos novos (nenhum commitado ainda):
- `lib/regua-alerta-calc.ts` + `lib/regua-alerta-calc.test.ts` — regra pura, `npm run test:regua` (13 testes verdes).
- `lib/regua-alerta.ts` — leitura de `/retailers/attention`.
- `app/api/sdr/regua-alerta/route.ts` — a rota. **Fora do `vercel.json`** (não roda sozinha).
- `package.json` — só o script `test:regua`.

**Trava de envio:** a rota só envia com `REGUA_ALERTA_ATIVA=1` + `AIVA_TPL_PENDENCIA_ID=87` +
`AIVA_TPL_ETAPA_ID=86` na Vercel. Sem os três responde sempre em simulação. Nunca usa o 48.

**Simulação com dados reais (17/11):** 327 alertas no portal → 306 lojistas nossos em alerta
(A 39 · B 36 · C 147 · D 84). Fila: 246 toques 1 (A 38 · B 33 · C 124 · D 51), 45 por rodada.
Seguradas: 34 por outro template nosso nos últimos 3 dias, 16 sem acesso (ficam com senha/acesso pendente),
8 falaram com a gente nos últimos 7 dias, 1 reprovada, 1 opt-out.

**Marca nas observações:** `[REGUA_ALERTA:trilha=X|toque=N|ultima=ISO]`; ao sair do alerta vira `[REGUA_RECONH:ISO]`.

**Falta pra ligar:**
1. Envio de teste dos templates 87 e 86 (entrega + cobrança como utilidade na fatura da Meta).
2. Bloco do prompt da VictorIA com a trilha da loja + registro do motivo declarado (via `revisor-prompt-victoria`).
3. Commit/push, variáveis na Vercel e entrada no `vercel.json`; decidir se a `dicas-desempenho` sai do cron.
4. Depois: retrato diário do alerta (tabela nova), quadro semanal no briefing, lista de ligação do Nei em .xlsx.

**Ponto de atenção no nome da loja ({{2}}):** vem do `nome_varejo` do cadastro. De 414 lojas ativas, 25 não têm
(cai no nome do lead), 30 estão em MAIÚSCULAS e 12 trazem "LTDA/ME" — vai sair assim no template.
