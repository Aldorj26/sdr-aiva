# Mensagem para o Mauricio (AIVA) — por que o nosso acesso ao portal parou (13/11/2026)

> Base: sonda feita em 13/11 às 16h17 (BRT) contra o Supabase do portal (`xznsbwdpfmwvuqipeilq.supabase.co`).
> Login por senha → `422 email_provider_disabled`; `/auth/v1/settings` → provedor `email: false`, só `google: true`;
> magic link/OTP → mesmo 422; API pública com `x-api-key` → 200 (segue normal). Última coleta boa: 27/10 09h (UTC),
> dados de 26/10, 371 lojas. Código: `lib/portal-aiva.ts` (`loginPortal`), diagnóstico em `lib/frescor-portal-calc.ts`.

---

Mauricio, tudo bem?

Queria te explicar com detalhe por que a integração da gente com o portal parou, porque não é senha errada nem
coisa do nosso lado — é uma configuração que mudou aí e que vocês resolvem em um clique.

**Como a gente acessa o portal**

Desde setembro, a nossa automação entra no portal todo dia às 6h da manhã do mesmo jeito que uma pessoa entraria:
faz login com e-mail e senha na autenticação do portal (o Supabase do app, endpoint
`/auth/v1/token?grant_type=password`) e, com o token que volta, lê pela API de dados (`/rest/v1/...`) as tabelas
que o próprio portal mostra na tela — `retailer_performance` (Performance), `login_sends` (senha enviada) e
`training_sessions` (agenda das turmas) — sempre filtrando pelo nosso `partner_id`. Não guardamos token: cada
execução loga de novo. A conta é a mesma que vocês criaram pra gente, a que a gente usa pra entrar no portal pelo
navegador.

**O que aconteceu em 26/10**

A partir de 26/10 o login passou a responder:

```
HTTP 422 {"code":422,"error_code":"email_provider_disabled","msg":"Email logins are disabled"}
```

Esse erro não é "senha inválida" (isso seria `400 invalid_credentials`). Ele diz que o **provedor de login por
e-mail foi desligado** no projeto Supabase do portal. Confirmei hoje pelo endpoint de configuração pública da
autenticação (`/auth/v1/settings`): o provedor `email` está **desativado** e só o `google` está ativo. Ou seja,
alguém mudou, em Authentication › Providers, o login por e-mail/senha pra desligado — provavelmente quando vocês
passaram a entrar com Google. Pra quem entra com conta Google no navegador não mudou nada; pra nossa automação,
que entra com e-mail e senha, fechou a porta. Magic link e código por e-mail dependem do mesmo provedor, então
também dão 422.

Nada mudou do nosso lado: mesma conta, mesma senha, mesma chave pública (anon key). A API pública de parceiros,
a que usa `x-api-key` (`/api/public/partner/onboardings`), continua funcionando normalmente — mas ela só expõe os
cadastros (onboardings), não as três tabelas acima.

**O que parou aqui por causa disso (desde 27/10, 18 dias)**

- Desempenho diário das lojas: a última foto que temos é de 26/10 (371 lojas). Com isso pararam as **dicas de
  desempenho** pras lojas e o aviso de **loja bloqueada por limite de originação**.
- **Agenda das turmas de treinamento**: a assistente responde "quando é o próximo treinamento" com a agenda
  congelada em 26/10, e a mensagem automática de treinamento usa a mesma agenda.
- Aviso de **senha pendente** (loja pediu acesso e a credencial não saiu) — lia `login_sends`.
- O **espelho do portal**, que a cada 15 minutos confere o estágio de cada loja aí pra mover o card do nosso lado,
  está falhando a cada rodada desde então.
- E o registro de liveness que a gente gravava em `liveness_sends`.

**Como resolver — qualquer uma das três**

1. **Religar o provedor de e-mail** no Supabase do portal: Authentication › Providers › Email › "Enable Email
   provider" (e manter "Enable email signup" como está). O Google continua ligado junto; só volta a aceitar
   e-mail/senha também. É a mais rápida — a nossa rotina das 6h volta sozinha no dia seguinte, sem mexer em nada aqui.
2. Se o e-mail/senha precisar ficar desligado por política, **nos garantir a entrada pelo Google** com a mesma
   conta (ela precisa estar permitida no provedor Google de vocês). A gente faz um login único pelo navegador e
   passa a renovar a sessão por refresh token, sem senha.
3. Ou **expor na API pública** (a de `x-api-key`) o que a gente lia direto: `retailer_performance`, `login_sends` e
   `training_sessions` filtradas pelo parceiro. É o que eu já tinha pedido em 18/09 e é o caminho que deixa a gente
   sem depender de login nenhum — mas é a opção que dá trabalho pra vocês, então a 1 resolve agora e a 3 fica pra
   quando der.

Se preferir, me manda um print da tela Authentication › Providers que eu te digo exatamente o que está diferente.

Abraço,
Aldo
