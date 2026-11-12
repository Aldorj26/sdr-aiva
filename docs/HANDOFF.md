# HANDOFF — SDR AIVA

> Leia ao abrir a sessão; atualize ao encerrar (`/handoff`). Estado ATUAL, não log: o log é o git e
> `docs/HISTORICO-OPERACAO-AIVA.md`. Push na `main` = deploy em produção.

## Estado de produção (12/11/2026, manhã)

- **TEMPLATES TRAVADOS: chave `silencio_templates` em `sdr_avisos_chave` LIGADA desde 11/11 12h48, até ordem do Aldo.**
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
- **Login do portal BLOQUEADO desde 26/10** (`422 email_provider_disabled`): parados turmas, senha pendente, desempenho,
  limite de originação. Pedido ao Mauricio na mensagem de 09/11 (`docs/Mensagem-Mauricio-nao-chegou-2026-11-09.md`).
- **Templates HSM:** 13 no Evo (21 e 48 = mesmo nome na Meta). Em uso: 41 (D+0), 48 (coringa), 34, 29, 69; 21 manual;
  28 sem rota. Lista: `POST /int/getTemplates` {queueId, apiKey, limit}. Planilha `docs/Templates-HSM-AIVA-categorias-2026-11-10.xlsx`.
  Marketing custa ~8× utilidade no Brasil; prazo de 24 h pra pedir análise de reclassificação na Meta.
- `send-initial` sem autenticação (Aldo: não mexer agora). Biometria negada: cron DESLIGADO. Retomada, boas-vindas e dicas: HISTORICO.

## Feito em 11/11 (publicado `eebbdcf`, `7ec8f41`; docs locais `ab2fd63`, `6ba451b`)

- Travas `silencio_global` e `silencio_templates`; rota `GET /api/admin/test-alert?number=&secret=` (WEBHOOK_SECRET) pra testar texto em prod.
- Diagnóstico do apagão (Evo × Meta × cobrança) e testes de entrega; monitoramento da VictorIA 12h55–17h16 sem problema
  (script `monitor_victoria.mjs` no scratchpad da sessão 11/11 — recriar se precisar: inbound × out × recibo no Evo).
- 09–10/11: sonda da API, diagnóstico "não chegou à AIVA" e lição do lead NAO_QUALIFICADO → movidos pro HISTORICO (seção 11/11).

## Em aberto (quem decide)

- **Aldo:** avisar quando a Evo terminar a reclassificação → religar templates (passos acima). Pedir análise de categoria na Meta?
- **Aldo → Mauricio:** mensagem de 09/11 (20 CNPJs + login do portal). **Nei:** 14 CNPJs "nunca apareceram" — viu "resposta registrada"?
- **Aldo — Evo:** excluir automações 80 e 81. **Aldo — Vercel:** remover `GOOGLE_SHEETS_WEBHOOK_URL`, `HUBSPOT_*`.
- **Aldo × AIVA:** material diz "R$ 10 por venda" sem "primeiro mês"? **Viagem até 15/11:** Aldo/Nei respondem o briefing das 5h.

## Próximos passos sugeridos

1. Religar templates (ordem do Aldo) → reenvios → tirar cron Black November → corrigir o bug do `out` gravado com silêncio.
2. ~17/11: medir cache em `sdr_token_usage`; depois dieta do prompt em sessão nova, com o revisor.
3. Login do portal de volta → conferir os 20 CNPJs no banco do portal. Medir toque 3/descarte e dicas+link (23/10).
4. Depois da viagem: auth no `send-initial` + desfazer o lead quando o template falha.

## Como retomar rápido

- Testes: `npm run test:<nome>` (retomada, desempenho, campanha, avisos, disparo, tickets…) · `npx tsc --noEmit -p tsconfig.json`.
  Mudança de comportamento da VictorIA passa pelo `revisor-prompt-victoria` (rode um `general-purpose` com `.claude/agents/revisor-prompt-victoria.md`).
- Dry das rotas: `GET /api/sdr/<rota>?dry=1` com `Bearer CRON_SECRET` (local: `preview_start "SDR AIVA"`, porta 3012).
- Estado: `sdr_disparo_estado` (id=1) · chaves `sdr_avisos_chave` (`silencio_%`, `disparo:%`, `vigia:%`) · `sdr_etapa_log` ·
  `sdr_avisos_painel` (`resolvido_em is null`) · curadoria `/curadoria`. Recibo da Meta: `getChatMessages` → `clientrcvtime`/`clientreadtime`.
- Logs: Vercel → sdr-aiva. Vigia 17h BRT (`/vigia?dry=1`). Scripts ad hoc: `node --env-file=.env.local -e '…'` (fetch direto; `@/lib` não resolve).
