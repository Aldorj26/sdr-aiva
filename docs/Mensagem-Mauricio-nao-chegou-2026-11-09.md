# Mensagem para o Mauricio (AIVA) — pré-cadastros que não aparecem no portal + login do portal (09/11/2026)

> Base: API pública em 09/11 (999 cadastros) × nosso quadro de Registros. Os 20 CNPJs abaixo foram enviados pelo
> formulário de pré-cadastro há mais de 24h (vários há semanas, reenviados mais de uma vez) e nenhum aparece em
> `/onboardings`. O login no portal está bloqueado pra gente desde 26/10 ("Email logins are disabled"), então não
> conseguimos ver se eles existem aí em outro estado.

---

Mauricio, tudo bem?

Preciso de uma ajuda com a importação do formulário de pré-cadastro. Temos **20 CNPJs enviados pelo formulário
que nunca aparecem na API nem no quadro** — alguns reenviados três, quatro vezes ao longo de um mês. Como a
importação roda de hora em hora e normalmente o CNPJ aparece em ~1h30, passou de 24h é sinal de que algo barrou.

Eles se dividem em dois grupos, e o primeiro é o que mais me preocupa:

**1. Seis lojas que estavam no quadro, saíram dele e não voltam** — ficaram 30+ dias em "formulário do varejo
pendente", sumiram do quadro (entendemos que vocês tiram quem fica parado), e a gente reenviou o pré-cadastro
em seguida. Nenhuma voltou. A pergunta: **a importação ignora CNPJ que já existiu na base de vocês, mesmo
removido do quadro?** Se sim, hoje não existe caminho pra uma loja que o lojista demorou a completar voltar a
entrar — e são lojas que o lojista quer ativar.

| Loja | CNPJ | Saiu do quadro | Reenviado em |
|---|---|---|---|
| World Cell | 14.406.211/0001-33 | 30/10 | 03/11 |
| Mais Case Cell | 60.764.696/0001-54 | 30/10 | 03/11 |
| Clínica do Celular | 52.734.312/0001-22 | 30/10 | 03/11 |
| Center Tech | 35.605.931/0001-06 | 30/10 | 03/11 |
| RAS Informática e Celulares | 54.224.069/0001-28 | 30/10 | 03/11 |
| Universo on | 46.633.157/0001-55 | 06/11 | 06/11 |

**2. Catorze lojas que nunca apareceram**, mesmo com o formulário enviado (a Minas Celulares é a que te mandei
em 23/10; segue igual):

| Loja | CNPJ | Último envio |
|---|---|---|
| Minas Celulares | 60.849.076/0001-18 | 28/10 (enviado desde 02/10) |
| Peninha Celulares | 28.946.588/0001-90 | 28/10 |
| JR Imports | 49.400.320/0001-28 | 28/10 |
| ML Cell | 46.202.704/0001-48 | 28/10 |
| Lb Cell | 50.639.606/0001-40 | 28/10 |
| Central Tech | 62.627.397/0001-01 | 28/10 |
| Street Cell | 52.443.402/0001-64 | 28/10 |
| Universe Phone | 65.115.267/0001-70 | 27/10 |
| Pixel Celulares | 42.563.856/0001-15 | 29/10 |
| AL Celulares | 62.089.162/0001-03 | 03/11 |
| JP Celulares | 46.885.134/0001-38 | 03/11 |
| StarCase | 58.030.606/0001-50 | 03/11 |
| Bw10 Repair | 61.245.532/0001-83 | 06/11 |
| Conect Ceel | 59.791.886/0001-81 | 07/11 |

O que ajudaria, nessa ordem:

1. **Conferir na planilha de respostas do formulário se esses 20 CNPJs chegaram aí.** Se chegaram e não
   importaram, o problema é na importação (e aí o motivo nos diz como evitar). Se não chegaram, o problema é
   nosso e eu paro de te perguntar — mas pelo menos a Minas e as seis do grupo 1 a gente tem certeza que foram.
2. **Confirmar a regra de CNPJ que já existiu na base** (grupo 1). Se a importação descarta duplicado contra
   removidos, precisamos de um caminho de volta — pode ser vocês reativarem na mão, ou a importação aceitar
   quando o registro anterior já saiu do quadro.
3. Uma coisa pequena que resolveria isso de vez: **a API devolver também os cadastros que saíram do quadro**
   (um `removed_at` ou um `stage=removido`). Hoje, pra gente, "saiu do quadro" e "nunca chegou" são a mesma
   coisa — e são problemas diferentes, com ações diferentes do nosso lado.

**E um pedido à parte: o nosso login no portal parou em 26/10.** Desde então ele responde
`422 email_provider_disabled` ("Email logins are disabled") — vocês desligaram o login por e-mail/senha e a conta
que a gente usa (a do `AIVA_PORTAL_EMAIL`) ficou de fora. Com isso pararam, do nosso lado:

- a **agenda das turmas** (`training_sessions`) — a mensagem automática de treinamento e as respostas da assistente
  sobre "quando é o próximo" estão com a agenda congelada em 26/10;
- o aviso de **senha pendente** (`login_sends`: pediu acesso e a credencial não saiu);
- o **desempenho diário** das lojas (`retailer_performance`) e o aviso de **loja bloqueada por limite de originação**;
- e justamente a conferência deste e-mail: se o login estivesse de pé, eu veria sozinho se os 20 CNPJs existem aí
  removidos ou sob outro parceiro, em vez de te pedir.

Dois caminhos resolvem, o que for mais simples pra vocês: **reabilitar o login por e-mail pra essa conta** (ou nos
dar um usuário no provedor que ficou ativo), **ou** expor na API pública o que a gente lia direto — agenda das turmas
(`training_sessions`), `login_sends` e `retailer_performance`. A segunda é a que eu já tinha pedido em 18/09 e é a que
deixa a gente sem depender de senha nenhuma.

Qualquer formato que for mais fácil pra você (print, lista, um "não achei") já resolve.

Abraço,
Aldo
