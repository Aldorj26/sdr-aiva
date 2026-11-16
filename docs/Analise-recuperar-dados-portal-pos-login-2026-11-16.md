# Análise — dá pra recuperar os números do portal sem o login? (16/11/2026)

> O Maurício confirmou (15/11) que **bloqueou de propósito** a leitura que a gente fazia entrando no
> banco do portal com login — não volta. Acesso daqui pra frente: **só a API pública de parceiros**
> (`parceiro-aiva.lovable.app/api/public/partner/...`, chave `x-api-key`). Esta análise responde: do que a
> gente lia nas três tabelas do portal, quanto dá pra reconstruir pela API sancionada + fontes nossas, e o
> que só existe se o Maurício expuser.
>
> **Limite ético assumido:** não procurei furo de autenticação nem endpoint escondido pra puxar o que ele
> fechou — isso seria contornar a decisão de acesso do dono do dado. A sonda abaixo usou só o endpoint de
> onboardings que já roda em produção, com a nossa chave, olhando os campos que ELE já devolve.

## O que a gente lia pelo login (as 3 tabelas)

| tabela | o que alimentava aqui |
|---|---|
| `retailer_performance` | consultas, aprovados, vendas, R$ vendido, conversão, ticket médio, inadimplência AIVA/Odres, % foto fora da loja — por loja/mês. Base de **dicas-desempenho** e do **limite de originação** (R$ 15 mil/semana). |
| `login_sends` | `credentials_sent_at` por loja — "a senha do sócio já saiu". Usado pelo **espelho** (Set loginEnviado) e pelo aviso **senha-pendente**. |
| `training_sessions` | agenda das turmas ao vivo: `starts_at`, `invite_id` (→ link do Meet), `label`. Base das **turmas** no prompt da VictorIA. |

## O que a API pública devolve hoje (sonda 16/11, página de 500 onboardings)

Campos presentes e úteis: `board_column` (500/500), `board_column_since` (436/500), `primeiro_acesso_em`
(98/500), `stage`, `biometry_status`, `retailer_id` (147/500), `retailer_registered_at`, `cnpj_*` (Receita),
`phone_number`/`email`/`liveness_url` (biometria), `training_at`/`training_id` (126/500), `partner_owner_name`.

**Ausentes por completo** (procurei um a um): `n_consultas`, `n_vendas`, `n_aprovados`, `valor_vendas`,
`conversao`, `ticket_medio`, `inadimplencia_aiva/odres`, `foto_fora_pct`, `credentials_sent_at`.
`training_label` existe mas vem **0/500** (sempre vazio).

## Veredito por dado

**1. Números de desempenho (o coração do que perdemos) — NÃO recuperável pela API.**
Nenhuma contagem ou valor de venda está na API pública — nem consultas, nem vendas, nem R$, nem inadimplência,
nem % de foto. A única coisa que dá pra saber é **binário**: pelo `board_column` ("consultou ou vendeu") a
gente sabe que a loja *começou a operar*, com `board_column_since` dizendo desde quando e `primeiro_acesso_em`
o 1º acesso. Mas "quanto vendeu / quantas consultas / ticket / inadimplência" **só o Maurício expondo
`retailer_performance` na API**. Enquanto isso, **dicas-desempenho** e **limite de originação** ficam sem
insumo (a última foto boa é de 26/10, congelada).

**2. Senha enviada / primeiro acesso — recuperável, até melhor.**
`credentials_sent_at` não existe, mas `board_column` na faixa LOGIN (pronto_para_operar/primeiro_acesso) +
`primeiro_acesso_em` cobrem "a loja já tem acesso / já entrou" — que é o que o **espelho** usa (hoje ele
avisa "Login/Vendendo não avaliados nesta rodada" porque o login caiu). O que **não** dá: distinguir "pediu a
senha e ela não chegou" (o caso do aviso **senha-pendente**) — isso dependia de `login_sends` ter o pedido sem
o envio; a API não separa.

**3. Agenda das turmas — NEM a agenda futura vem pela API (corrigido 16/11 após teste real).**
A API traz `training_at` por loja, mas ele é **retrospectivo**: é a turma mais recente de CADA loja, não o
calendário à frente. No teste de 16/11, das 24 datas distintas, **zero eram futuras** — todas já tinham
acontecido. Ou seja, a API não reconstrói o calendário das próximas turmas; e `training_id` é um id interno de
2 dígitos (não o código do Meet) e `training_label` vem vazio, então o link também não vem. **A agenda à frente
continua vindo da regra fixa** (`REGRA_FALLBACK`: seg/qua/sex 9h30, link único `vou-gpmy-rtp` publicado pela
AIVA em 16/09). O `training_at` só serve pro retrospectivo: "em que turma esta loja está/esteve"
(`inscricoesPorCnpj`). Pra ter a agenda futura de verdade de novo, só a AIVA expondo `training_sessions` (datas
+ `invite_id`) na API.

## Recomendação

**Feito no nosso código em 16/11 (sem depender de ninguém, sem deploy ainda):**
1. **espelho-portal** — `sinaisPortal` não chama mais o login; "operando" e "login enviado" saem de
   `board_column`/`primeiro_acesso_em`. Tira o aviso "Login/Vendendo não avaliados" que vinha toda rodada.
   Teste real: loginEnviado 371, vendeu 126 (antes 0/0). tsc + testes verdes.
2. **turmas-treinamento** — tirei o login morto das três funções; `inscricoesPorCnpj` volta a funcionar
   (training_at por loja, retrospectivo); `houveTurmaHoje` passa a usar a cadência oficial (seg/qua/sex);
   `proximasTurmas` tenta a API e, como ela não traz data futura, cai no fallback da regra fixa como já fazia.
   **Ou seja, a agenda FUTURA de turmas segue na regra fixa** — isso o código não resolve, só o Maurício.

**Só o Maurício resolve (expor na API):**
3. Os **números de desempenho** por loja/mês (`retailer_performance`) — único caminho pra dicas-desempenho e
   limite de originação voltarem. Sem isso, essas duas automações ficam cegas.
4. A **agenda das turmas** (`training_sessions`: `starts_at` + `invite_id`/link do Meet) — pra VictorIA voltar a
   citar datas e links reais em vez da regra fixa seg/qua/sex.

A mensagem antiga (`docs/Mensagem-Mauricio-login-portal-2026-11-13.md`) pedia pra religar o login — isso caiu.
Precisa ser reescrita pra pedir só os itens 3 e 4 acima.
