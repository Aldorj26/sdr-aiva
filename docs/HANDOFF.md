# HANDOFF — SDR AIVA

> Leia ao abrir a sessão; atualize ao encerrar (`/handoff`). Estado ATUAL, não log: o log é o git e
> `docs/HISTORICO-OPERACAO-AIVA.md`. Push na `main` = deploy em produção.

## ▶️ PRÓXIMA SESSÃO (combinado com o Aldo em 19/11) — executar o plano "loja nova de outra empresa"

- **O que é:** cliente já ativo pede, no mesmo WhatsApp, cadastro de loja de OUTRA empresa (raiz de CNPJ diferente).
  Hoje a VictorIA diz "passei pro Nei" e para. Casos reais: Eduardo Cell (→ 59.218.413/0001-90) e RG Cell (→ 69.849.333/0001-96).
- **Desenho aprovado pelo Aldo:** `docs/superpowers/specs/2026-11-19-loja-nova-outra-empresa-design.md`.
  **Plano (6 tarefas):** `docs/superpowers/plans/2026-11-19-loja-nova-outra-empresa.md`. **Nada programado, nada commitado**
  (os dois docs estão sem commit).
- **Decisões do Aldo:** SEM aprovação do Nei; o link só sai depois do pré-cadastro (a AIVA exige) — o CNPJ cai direto na
  fila de pré-cadastro do `/atendimento`, o Nei só clica, e o espelho manda o link quando o CNPJ chegar a `dados_varejo`.
  Atalho `NOVA LOJA`. Filial de mesma raiz não muda.
- **Falta o Aldo escolher:** execução com revisão por tarefa (recomendado) ou direto na sessão. Ele volta e dá o comando.
- **Cuidados:** registro da loja nova é `tipo: 'adicional'` + `fluxo`, nunca `matriz` (move o card). Textos e push só com OK
  do Aldo. RG Cell recebeu promessa errada em 19/11 13h22 (credenciar Osasco com o CNPJ da matriz) — o Nei corrige.

## ⚠️ LEIA PRIMEIRO — estado em 17/11/2026 à noite (vale por cima do que conflitar abaixo)

**Três mudanças grandes no dia. Tudo publicado e no ar: último commit `7a18edc`, deploy READY em 17/11 ~19h20 BRT. Nada pendente de push.**

### 1. Régua de alerta — LIGADA e agendada
- Fonte nova: `GET /api/public/partner/retailers/attention` (Maurício liberou em 17/11). Só `retailer_id`,
  `attention_status`, `mes` — **sem número nenhum**. Cruzada com `board_column` vira trilha: A fechar a venda ·
  B reconquista · C primeira venda · D primeira consulta. Regra em `lib/regua-alerta-calc.ts` (`npm run test:regua`),
  rota `/api/sdr/regua-alerta`, proposta em `docs/Proposta-regua-ativacao-alertas-2026-11-17.md`.
- **Permanente** (decisão do Aldo): toda loja que entra no alerta entra na régua; quem sai recebe reconhecimento.
- Cron `0,30 12-14 * * 1-5` (9h–11h30 BRT, 6 rodadas × 45). Liga/desliga: chave `regua_alerta_ativa` em
  `sdr_avisos_chave` — **LIGADA**. 1º lote 17/11 17h48: 10 da trilha A, 0 falha, 7/10 com recibo, 2 respostas.
  **18/11 de manhã saem os ~236 restantes.**
- Conversa: bloco dinâmico `blocoPromptRegua` (só pra loja que já recebeu toque) + motivo declarado em
  `dados_coletados.motivo_alerta` → marca `[REGUA_MOTIVO:codigo:ISO]`. Marca da régua: `[REGUA_ALERTA:trilha=X|toque=N|ultima=ISO]`.

### 2. Tudo que dependia do login do portal — DESLIGADO
- Fora do `vercel.json`: `/api/cron/portal-aiva` e `/api/sdr/dicas-desempenho`. Vigia não avisa mais de coleta
  parada (`COLETA_PORTAL_DESLIGADA`). Limite de originação não tenta mais o login (`LEITURA_LIMITE_DESLIGADA`).
- Bloco NÚMEROS DA LOJA: semana fechada velha (> ~28 dias) vira a variante "números indisponíveis"
  (`blocoPromptSemNumeros`) — mantém a linha 💰 da comissão.
- Segue sem dado e sem aviso: conferência de comissão, placar da campanha de boas-vindas (a rota se recusa a
  enviar: `dados_frescos:false`), relatório semanal da loja.

### 3. NADA mais sai por template de marketing — tudo pelos de utilidade (ordem do Aldo, repetida 3×)
- Templates de utilidade no Evo (fila 10): **85** alteração na conta (sem uso), **86** etapa concluída, **87** pendência.
- Textos todos em `lib/template-utilidade-calc.ts` (`npm run test:utilidade`); envio em `lib/template-utilidade.ts`
  (`enviarCoringa` pro que era 48, `enviarUtilidadeOu` pro que era outro template). Tabela antes/depois em
  `docs/Troca-coringa-por-utilidade-2026-11-18.md`.
- Chave `coringa_utilidade_ativo` em `sdr_avisos_chave` — **LIGADA**. Apagar = cada envio volta ao template antigo,
  sem deploy (volta de emergência; quem decide é o Aldo). Falha de leitura da chave NÃO cai no antigo.
- Convertidos: cobrança de formulário, cadastro recebido, biometria, acesso pendente, check-treinamento, tickets,
  avisos de etapa, alertas internos + briefing, retomada de interessado, campanha, painel (enviar info / follow-up),
  **D+0 (era 41 → 86, sem botão "Saber Mais", saudação "Olá pessoal")**, link de cadastro (34 → 86),
  treinamento (69 → 86), régua D+3 (→ 87). Único `sendTemplate` direto que resta: a régua de alerta.
- ⚠️ **Risco avisado e assumido pelo Aldo:** a Meta reclassificou 41 e 48 pra marketing em ~10/11 por uso em
  prospecção; D+0 (500/dia) e retomada (até 420/dia) pelo 86/87 expõem os dois ao mesmo. Se acontecer, tudo encarece
  junto. O campo "UTILITY" do catálogo do Evo NÃO prova a categoria da Meta — **conferir no WhatsApp Manager/fatura**.
- **Nenhum envio real por utilidade foi conferido na fatura ainda.** Recibo de entrega prova entrega, não categoria.

### Amanhã (18/11)
- 5h: briefing do pipeline chega por 87 (1º envio real das rotinas convertidas). Se não chegar: apagar a chave.
- 9h–11h30: régua de alerta (236).
- **D+0 PAUSADO** — o Aldo vai dar `/retomar` pra testar a abertura nova. Antes, vale `/disparar <telefone do Aldo>`
  pra ele ver a mensagem. Sem botão a resposta tende a cair; medir resposta e entrega do dia contra o histórico.
- Conferir no fim do dia: recibos (`clientrcvtime`) por rótulo, respostas da régua, motivos `[REGUA_MOTIVO]`.

### Como mexer nas chaves (tabela `sdr_avisos_chave`, sem deploy)
- Ver: `select chave, ultimo_aviso from sdr_avisos_chave where chave in ('regua_alerta_ativa','coringa_utilidade_ativo','silencio_templates','silencio_global')`
- Desligar a régua: `delete ... where chave = 'regua_alerta_ativa'` · voltar aos templates antigos: `delete ... where chave = 'coringa_utilidade_ativo'`
- Simular sem enviar: `GET /api/sdr/regua-alerta?dry=1` (e `?dry=1` em qualquer rotina), Bearer `WEBHOOK_SECRET`.
- D+0 sem botão foi escolha consciente do Aldo (17/11): medir a resposta; se cair, ele pede ao Gustavo um 4º template
  de utilidade com botão "Saiba Mais" (aí a Maísa sincroniza e o D+0 aponta pra ele).

### Pendências
- Vercel: o Aldo está sem acesso (pediu desligar o 2FA). A conexão da sessão lê deploys mas não cria variável de
  produção (403). Nada depende mais de variável nova.
- `CLAUDE.md` do repo (gitignored) ainda lista dicas-desempenho e portal-aiva como automações — atualizar.
- `test:campanha` tem 1 teste falhando por data (campanha encerrada em 05/11) — pré-existente.
- Lista de ligação do Nei (trilhas A/B, 3º toque), retrato diário do alerta e quadro semanal de motivos: não feitos.
- Mensagem pro Maurício (pedir `retailer_performance` + `training_sessions` na API): não reescrita.

## Estado de produção (16/11/2026)

- **16/11 09h27 BRT — TEMPLATES RELIGADOS (ordem do Aldo: "pode, mesmo em marketing"):** teste do 48 pro Aldo
  entregue em 2 s e lido (chat 59230); chave `silencio_templates` apagada. D+0 SEGUE PAUSADO. Botão "Saber Mais"
  do 41 nunca parou (40/40 respondidos desde 10/11). Os 3 templates novos da Evo ainda não aparecem no `getTemplates`
  (fila 10) — quando o Aldo avisar, trocar o 48 rota a rota (ver abaixo).
- **16/11 ~09h45 — REENVIO do apagão feito (ordem do Aldo):** dos 74 templates de 10/11 18h45 UTC → 11/11 19h30 UTC,
  61 reenviados (37 retomada, 11 Black November, 10 D+0/41, 2 acesso pendente, 1 pronto pra operar); **54 entregues
  em 1 min (89%)**, 7 sem recibo (4 D+0 frios, 2 retomada, 1 BN). Gravados em `sdr_mensagens` com prefixo
  `[REENVIO 16/11 apagão]` e o mesmo rótulo. Ficaram de fora 13: 3 já entregues, 2 que responderam, 1 descartado,
  biometria/treinamento/link de cadastro desatualizados (lead já avançou) e os **3 "Info pendente" manuais
  (7f574c37, be9e9233, f72f21ce — texto não gravado: Nei reenvia pelo botão do painel, que voltou a funcionar)**.
- ~~TEMPLATES TRAVADOS: chave `silencio_templates` em `sdr_avisos_chave` LIGADA desde 11/11 12h48, até ordem do Aldo.~~
  Só o `/int/sendWaTemplate` é bloqueado (`lib/evotalks.ts`, `7ec8f41`; erro `SILENCIO_TEMPLATES`, lead não é marcado);
  texto de sessão passa — a VictorIA respondeu 44 mensagens em 11/11 à tarde, todas com recibo em 1–7 s. Existe também
  `silencio_global` (bloqueia tudo), hoje desligada. Ligar/desligar = insert/delete da chave, sem deploy, cache 20 s.
- **Por que travou (apagão 10/11 15h45 → 11/11 16h30):** o Evo reconectou o +55 47 9204-2626 numa conta de mensagens
  NOVA da Meta ("Track … - Habilis", asset `1836233717512412`); o Aldo recriou os 12 templates e a Maisa sincronizou o Evo
  (IDs 21–70 do Evo seguem válidos mesmo com `cloudApiId` antigo no `getTemplates`). A não entrega era a conta de cobrança
  sem dados fiscais ("Faltam informações da empresa"): texto (grátis) passava, template (conversa paga) ganhava `wamid` e
  morria. Aldo preencheu em 11/11 16h30 → 48 pro Aldo 7 s, 48 pro Nei 4 s, 69 pro Aldo 3 s.
- **Hoje (12/11) a Evo reclassifica os 8 templates que a Meta marcou MARKETING (41, 48, 34, 38, 32, 31…) de volta pra
  UTILITY.** Quando o Aldo avisar: (1) testar 48 pro Aldo e conferir `clientrcvtime`; (2) `delete from sdr_avisos_chave
  where chave='silencio_templates'`; (3) decidir **reenvios** marcados como enviados sem entrega: Black November de 10/11
  após 15h45 + 12 de 11/11, retomada/acesso-pendente de 11/11, biometria aprovada do lead `c999b0f1`, treinamento liberado
  Casa Brasileira (aviso no painel). **Remover o cron do Black November do `vercel.json`** (janela 10–11/11 encerrada).
- **Decisão do Aldo 12/11 ~10h: chave `silencio_templates` CONTINUA ligada, ninguém recebe template** até ele
  criar os 3 templates novos na Meta/Evo. Proposta em `docs/Proposta-3-templates-Evo-2026-11-12.md` e PDF de
  submissão `docs/templates-3-evo-meta-2026-11.pdf` (principal `aiva_comunicado_parceiro` + gêmeo MARKETING
  `aiva_novidade_parceiro`, coringas `aiva_atualizacao_loja` e `aiva_pendencia_loja`). Quando aprovados: trocar
  `AIVA_REATIVACAO_TEMPLATE_ID` (48) pelos novos IDs rota a rota (status → atualização, cobrança/retomada →
  pendência), adicionar as 3 travas (janela aberta = texto; sanitizar vars; palavras promocionais → gêmeo MARKETING).
  Conferido 12/11: a trava é tudo-ou-nada e o botão "Enviar informação pendente" do painel também usa o 48
  (`app/api/leads/[id]/action/route.ts`, comentário diz 21 mas o env é 48). Evo `getTemplates` ainda mostra 48
  UTILITY/APPROVED (cadastro antigo); categoria não impede entrega, só muda o preço.
- **Apagão Evo 12/11 10h17 → ~13h45 BRT (filas 10 E 21 caíram juntas; a Evo religou).** Conferido 13h55:
  `/int/getQueueStatus` das duas `connected:true, authenticated:true`; VictorIA respondeu no chat 59229 às 13h47 e
  13h49 com recibo `clientrcvtime` em 3 s e leitura em 1–9 s; webhook recebendo. Nada nosso derruba o Evo (sem
  rota de login/logout/config no código; só leituras, `endChat` no 18136 e `openChat` no 59226 antes da queda) —
  a Maisa (Evo) desconfiou do Claude; resposta dada ao Aldo com a lista de chamadas 10h10–10h20 pra ela cruzar no log.
- **Fechar atendimentos (teste 12/11, pedido do Aldo):** 18.667 chats abertos na fila 10 e 15.316 na 21, todos no
  Nei (507); fila sem `clienttimeout` (0) e cada template abre chat novo → nunca fecha. **`POST /int/endChat
  {chatId}` fecha** (chave da fila ou global; testado no chat 18136 do Aldo: `endTime` gravado, some do
  `getClientOpenChats`). Texto em chat fechado = **404 "Chat not found"** → o fallback do `sendText` cobre
  (busca chat aberto, senão `openChat`). URA 86 (entrada da fila 10) revincula a oportunidade pelo telefone em chat
  novo e transfere pro Nei; funil, janela 24 h e custo Meta não mudam. **`endChat` exige o motivo** (fila tem
  `requirereasontoclose`): sem `endReason` devolve 400 "Required data missing"; mandar `{chatId, reason,
  endReason:'ATENDIMENTO FINALIZADO'}` + `queueId`/`apiKey` da fila. Chat vazio 59226 fechado 12/11 13h58.
  Pendente: ligar fechamento automático por inatividade (`clienttimeout` da fila, via omni `queues_update`, só
  com OK do Aldo) e pedir à Evo o fechamento em lote (18.624 abertos na 10, 15.225 na 21).
- **FAQ Flexfone no prompt (12/11, NÃO commitado):** Aldo mandou treinar a VictorIA com os 2 guias oficiais da
  Flexfone ("FAQ do vendedor" e "Resolver Rápido", HTMLs em Downloads). Entrou em `prompts/aiva.ts` a subseção
  `### 📗 FAQ DO VENDEDOR — FLEXFONE` (+ bloco 🧭 Guia 2) antes da FASE 5, e 4 passagens antigas foram alinhadas:
  desbloqueio temporário "24 h" → "até o fim do dia" + site do cliente `clientes.aivapay.com.br` virou link oficial;
  compensação Pix "na hora/2–3 dias" → "2 h / 72 h úteis"; suporte ao cliente final 9h–23h → 8h–23h (dom 10h–19h);
  Live Chat da Central do Vendedor "seg–sex 9h–18h" → "seg–sáb 8h–23h, dom 10h–19h" (login/financeiro/preço seguem
  9h–18h); preço tabelado agora pelo Painel do Varejo (24 h úteis); tabela ⏱ PRAZOS oficiais (repasse 48 h úteis,
  incentivos até o 10º dia útil) citável como "prazo da Flexfone". **Ficou de fora por contradizer regra AIVA 01/10
  (Aldo decide):** guia manda login de vendedor por "Chat › Cadastrar/Remover Usuário" (48 h úteis) + senha por "Esqueci
  minha senha" no site, e financeiro por "Site financeiro › Ajuda / Chat › Financeiro"; o prompt segue com o formulário
  de Login de operadores, a atualização cadastral do sócio e os tickets. Revisor `revisor-prompt-victoria` rodou nos 2
  lotes: 8 achados, todos aplicados (horário antigo em 5 pontos, "só o Live Chat altera preço" no 3️⃣b, 48 h de login
  tirado da tabela de prazos, ressalva "cliente bloqueado por atraso ≠ trava de venda" no prompt e nos blocos TREINAR/
  LOGIN de `lib/claude.ts`, checklist Odres qualificado, acesso ao site = CPF + nascimento, "responsável comercial" =
  da Flexfone). Curadoria conferida: nada conflita. `tsc` ok; testes json/reconhecimento/desistencia ok. **Falta commitar
  e dar push (= deploy)** — Aldo decide.
- **D+0 pausado** (`sdr_disparo_estado` id=1, ordem do Aldo 10/11) — só ele dá `/retomar`. Cron 5 min, 8h–19h BRT, teto 500.
- **Bug a corrigir:** com silêncio ligado o webhook grava a resposta em `sdr_mensagens` como `out` mesmo bloqueada
  (3 casos 11/11 12h31–12h33; lead `14c80fe6` disse "Oi" e ficou sem resposta).
- **Tokens (10/11, `e4de388`):** `montarSystemBlocks()` em `lib/claude.ts` (4 blocos, cache 1 h, HORA só no bloco por lead)
  + `/api/sdr/aquecer-cache` (30 min). Auditoria: `docs/Auditoria-tokens-VictorIA-2026-11-10.md`. **Medir ~17/11**
  (cache_creation <5/dia; custo/dia ~US$ 20 → ~US$ 13). Próximo: dieta do prompt (67 mil → 35 mil tokens).
- **Black November (`e5bd706`):** comissão até R$ 50/venda em novembro; regras em `lib/black-november-calc.ts`. Dúvidas sem
  resposta do Aldo: gerente (20% sobre R$ 50?), vendas Odres contam?
- **Painel financeiro (`6f4e384`):** link do Looker no aviso de ticket resolvido e no prompt (REPASSE DE VENDA) — mudar nos DOIS.
- **Login do portal bloqueado desde 26/10, e o Mauricio confirmou em 15/11 que é DEFINITIVO** (bloqueou de
  propósito; só a API pública `x-api-key` fica). Em 16/11 tiramos espelho e turmas do login morto (commit
  `bca2166`, no ar): espelho lê `board_column`/`primeiro_acesso_em` (loginEnviado 371, vendeu 126 reais, sem o
  aviso "não avaliados"); turmas usam a regra fixa + `training_at` retrospectivo. **Ainda cegos (só o Mauricio
  expondo `retailer_performance` na API):** dicas-desempenho e limite de originação. Análise completa em
  `docs/Analise-recuperar-dados-portal-pos-login-2026-11-16.md`.
- **Templates HSM:** 13 no Evo (21 e 48 = mesmo nome na Meta). Em uso: 41 (D+0), 48 (coringa), 34, 29, 69; 21 manual;
  28 sem rota. Lista: `POST /int/getTemplates` {queueId, apiKey, limit}. Planilha `docs/Templates-HSM-AIVA-categorias-2026-11-10.xlsx`.
  Marketing custa ~8× utilidade no Brasil; prazo de 24 h pra pedir análise de reclassificação na Meta.
- `send-initial` sem autenticação (Aldo: não mexer agora). Biometria negada: cron DESLIGADO. Retomada, boas-vindas e dicas: HISTORICO.

## Feito em 16/11 (publicado `bca2166`)

- **Mauricio confirmou (15/11): o login do portal foi bloqueado DE PROPÓSITO e não volta** — daqui pra frente só
  a API pública de parceiros (`parceiro-aiva.lovable.app/api/public/partner/...`, `x-api-key`). O pedido ao
  Mauricio deixa de ser "religar o login" e passa a ser **expor na API** o que o login lia.
- **espelho e turmas tirados do login morto (commit `bca2166`, deploy de produção feito 16/11):** `tsc` limpo,
  42 testes verdes. O que mudou:
  - **espelho-portal** — `sinaisPortal` não chama mais o login; "operando"/"login enviado" saem de
    `board_column`/`primeiro_acesso_em`. Sumiu o aviso "Login/Vendendo não avaliados" de toda rodada.
    Teste real: loginEnviado **371**, vendeu **126** (antes 0/0 + erro).
  - **turmas-treinamento** — login removido das 3 funções; `inscricoesPorCnpj` volta (training_at por loja,
    retrospectivo); `houveTurmaHoje` usa a cadência oficial seg/qua/sex; `proximasTurmas` tenta a API e cai no
    fallback da regra fixa (a API NÃO traz agenda futura — `training_at` é só retrospectivo, 0 datas futuras no teste).
  - Arquivos: `lib/espelho-portal.ts`, `lib/turmas-treinamento.ts`, `lib/turmas-treinamento-calc.ts`,
    `lib/portal-aiva.ts` (nova `listarTreinamentosApi`), `lib/turmas-treinamento-calc.test.ts` (+2 testes).
- **Veredito (doc `docs/Analise-recuperar-dados-portal-pos-login-2026-11-16.md`):** números de desempenho
  (consultas/vendas/R$/inadimplência) **não** vêm pela API — só o Mauricio expondo `retailer_performance`.
  Agenda FUTURA de turmas também **não** — só expondo `training_sessions` (starts_at + invite_id/link).
- **Pendente:** reescrever `docs/Mensagem-Mauricio-login-portal-2026-11-13.md` (ela ainda pede religar login;
  trocar por pedir só `retailer_performance` e `training_sessions` na API). Ainda não commitada.

## Feito em 12–15/11 (Evo: fechamento em massa; portal: diagnóstico do login)

- **Atendimentos abertos no Evo (filas 10 e 21):** eram 33.847 em 12/11. A Evo fechou 18.859 em lote em 12/11 16h08
  (motivo "Encerrado +15d sem interação (ticket 17055)"). Nós fechamos pela API os que sobraram com >30 dias:
  30 em 12/11 + 163 em 13–15/11 (72 fila 10, 91 fila 21), zero erro. Em 15/11 restam ~144 com >30 dias (envelhecem
  ~50/dia; todos tiveram interação nos últimos 15 dias). Receita: `getChatDetail` por ID (tenta fila 10, 404 → 21),
  `status===1` e `beginTime` < corte → `endChat` {chatId, reason, endReason:'ATENDIMENTO FINALIZADO'} (fila exige
  motivo; chat já fechado devolve 404 "Chat not found"). **Não existe endpoint de listagem de abertos** na API
  `/int` (`getChatsByDateRange` filtra por endTime); a contagem vem do MCP omni `chats_list` (status=open, dateTo).
  ⚠️ Concorrência: 20 chamadas paralelas em 12/11 coincidiram com um 502 da Evo (~14h50, reiniciou e ficou ~1 h
  recarregando, filas desconectadas até a noite) — rodar com 5. Script: `closebulk2.mjs` no scratchpad da sessão 12/11.
- **Portal AIVA — causa do 422 confirmada (13/11):** `/auth/v1/settings` do Supabase do portal mostra provedor
  `email: false`, só `google: true` — desligaram o login por e-mail/senha; magic link/OTP dão o mesmo 422; API pública
  `x-api-key` segue 200. Última coleta boa 27/10 (dados de 26/10, 371 lojas). Mensagem pronta pro Mauricio com 3
  saídas (religar Email provider / liberar nossa conta no Google / expor as 3 tabelas na API):
  `docs/Mensagem-Mauricio-login-portal-2026-11-13.md` — **Aldo envia**.

## Feito em 11/11 (publicado `eebbdcf`, `7ec8f41`; docs locais `ab2fd63`, `6ba451b`)

- Travas `silencio_global` e `silencio_templates`; rota `GET /api/admin/test-alert?number=&secret=` (WEBHOOK_SECRET) pra testar texto em prod.
- Diagnóstico do apagão (Evo × Meta × cobrança) e testes de entrega; monitoramento da VictorIA 12h55–17h16 sem problema
  (script `monitor_victoria.mjs` no scratchpad da sessão 11/11 — recriar se precisar: inbound × out × recibo no Evo).
- 09–10/11: sonda da API, diagnóstico "não chegou à AIVA" e lição do lead NAO_QUALIFICADO → movidos pro HISTORICO (seção 11/11).

## Em aberto (quem decide)

- **Aldo:** avisar quando a Evo terminar a reclassificação → religar templates (passos acima). Pedir análise de categoria na Meta?
- **Aldo → Mauricio:** mensagens de 09/11 (20 CNPJs) e, agora, pedir na API `retailer_performance` (números de venda) + `training_sessions` (agenda+link) — o login não volta. **Nei:** 14 CNPJs "nunca apareceram" — viu "resposta registrada"?
- **Aldo — Evo:** excluir automações 80 e 81. **Aldo — Vercel:** remover `GOOGLE_SHEETS_WEBHOOK_URL`, `HUBSPOT_*`.
- **Aldo × AIVA:** material diz "R$ 10 por venda" sem "primeiro mês"? **Viagem até 15/11:** Aldo/Nei respondem o briefing das 5h.

## Próximos passos sugeridos

1. Religar templates (ordem do Aldo) → reenvios → tirar cron Black November → corrigir o bug do `out` gravado com silêncio.
2. ~17/11: medir cache em `sdr_token_usage`; depois dieta do prompt em sessão nova, com o revisor.
3. Reescrever a mensagem do Mauricio (pedir `retailer_performance` + `training_sessions` na API). Medir toque 3/descarte e dicas+link (23/10).
4. Depois da viagem: auth no `send-initial` + desfazer o lead quando o template falha.

## Como retomar rápido

- Testes: `npm run test:<nome>` (retomada, desempenho, campanha, avisos, disparo, tickets…) · `npx tsc --noEmit -p tsconfig.json`.
  Mudança de comportamento da VictorIA passa pelo `revisor-prompt-victoria` (rode um `general-purpose` com `.claude/agents/revisor-prompt-victoria.md`).
- Dry das rotas: `GET /api/sdr/<rota>?dry=1` com `Bearer CRON_SECRET` (local: `preview_start "SDR AIVA"`, porta 3012).
- Estado: `sdr_disparo_estado` (id=1) · chaves `sdr_avisos_chave` (`silencio_%`, `disparo:%`, `vigia:%`) · `sdr_etapa_log` ·
  `sdr_avisos_painel` (`resolvido_em is null`) · curadoria `/curadoria`. Recibo da Meta: `getChatMessages` → `clientrcvtime`/`clientreadtime`.
- Logs: Vercel → sdr-aiva. Vigia 17h BRT (`/vigia?dry=1`). Scripts ad hoc: `node --env-file=.env.local -e '…'` (fetch direto; `@/lib` não resolve).
