# HANDOFF — SDR AIVA

> Leia ao abrir a sessão; atualize ao encerrar (`/handoff`). Estado ATUAL, não log: o log é o git e
> `docs/HISTORICO-OPERACAO-AIVA.md`. Push na `main` = deploy em produção.

## Estado de produção (11/11/2026, 16h40)

- **Disparo D+0 na nuvem** (cron 5 min, 8h–19h BRT dia útil, teto 500/dia, 3 lotes de 5). Entrega baixa AVISA, não pausa.
- **Retomada do INTERESSADO** com toque 3 + oferta (22/10) e descarte; **campanha de boas-vindas**; **dicas semanais**
  com link `/r/<token>`; comissão do vendedor só no 1º mês. Detalhes e medições: HISTORICO.
- **Tokens (10/11):** auditoria em `docs/Auditoria-tokens-VictorIA-2026-11-10.md` (US$ 238/14 d ≈ US$ 510/mês; 38% era reescrita
  de cache). Cache de 1 h + bloco diário cacheado + `/api/sdr/aquecer-cache` (cron 30 min, 7h–20h30 BRT) + histórico 20 + blocos
  de fase enxutos. **Medir em ~17/11** com a mesma consulta (cache_creation deve cair de ~25/dia pra <5; custo/dia de ~US$ 20
  pra ~US$ 13). Próximo degrau: dieta do prompt (67 mil → 35 mil tokens), seções maiores listadas na auditoria.
- **Black November (09/11, `e5bd706`):** comissão do vendedor até R$ 50 por venda de 01 a 30/11 (R$ 20 início de dez + R$ 30
  1ª semana de jan, inadimplência da própria loja), toda loja do canal. Comunicado único `/api/sdr/comunicado-black-november`
  (cron 10 e 11/11, 10h17–15h57 BRT, teto 400/dia, 687 na fila: 296 cadastro × 391 loja criada; marcador
  `[BLACK_NOVEMBER:ISO|grupo]`, rótulo `aiva_black_november`). Regras em `lib/black-november-calc.ts`; linha 💰 do bloco de
  números e dicas falam da campanha em novembro; dez/jan a linha avisa que cobrança das vendas de novembro vai pra humano.
  **Remover o cron depois de 11/11.** Dúvidas sem resposta do Aldo: gerente (20% sobre R$ 50?), vendas Odres contam?
- **Painel financeiro (09/11, `6f4e384`):** o aviso de ticket resolvido traz o link do Looker Studio
  (`LINK_PAINEL_FINANCEIRO` em `lib/tickets-aiva.ts`) + vídeo; a VictorIA passa o link SÓ com o pedido resolvido
  (ou se o lojista diz que já recebeu o e-mail de liberação). O link também está escrito no prompt (item 1 de REPASSE
  DE VENDA) — se mudar, trocar nos DOIS lugares.
- **Login do portal (e-mail/senha) BLOQUEADO desde 26/10** (`422 email_provider_disabled`): parados agenda das turmas
  (`training_sessions`), senha pendente (`login_sends`), desempenho diário, limite de originação. Pedido ao Mauricio na
  mensagem de 09/11. Testar: POST em `AIVA_PORTAL_URL/auth/v1/token?grant_type=password` com as credenciais do `.env.local`.
- **API pública** (`/onboardings`): sem mudança desde 07/10 — 29 campos; `scripts/sonda-api-aiva.mjs` usa esse retrato.
  `/tickets` devolve `priority, description, first_response_at, closed_at` (tipados em `d2dbd6f`).
- **TEMPLATES: apagão 10/11 15h45 → resolvido 11/11 16h30, mas `silencio_templates` SEGUE LIGADO até ordem do Aldo.**
  O Evo reconectou o número +55 47 9204-2626 numa conta de mensagens NOVA da Meta ("Track … - Habilis", asset
  `1836233717512412`); o Aldo recriou os 12 templates lá e a Maisa sincronizou no Evo (IDs 21–70 do Evo continuam valendo,
  mesmo com `cloudApiId` antigo no `getTemplates`). Causa real da não entrega: a conta de cobrança nova estava sem dados
  fiscais ("Faltam informações da empresa") → texto de sessão (grátis) passava e template (conversa paga) era aceito com
  `wamid` e nunca entregue. Aldo preencheu às 16h30; teste 48 → Aldo 7 s, 48 → Nei 4 s, 69 → Aldo 3 s.
  **Pendente (12/11):** a Evo vai reclassificar os 8 templates que a Meta marcou como MARKETING (41, 48, 34, 38, 32, 31…)
  de volta pra UTILITY; o Aldo avisa aqui quando estiver pronto → então: testar 48 pro Aldo com `clientrcvtime` e
  `delete from sdr_avisos_chave where chave='silencio_templates'`. Depois: **reenviar** Black November marcado 10/11 após
  15h45 + os 12 de 11/11, retomada/acesso-pendente de 11/11, biometria aprovada `c999b0f1`, treinamento liberado Casa
  Brasileira (aviso no painel). D+0 continua pausado (ordem de 10/11).
  Travas em `lib/evotalks.ts` (`7ec8f41`): `silencio_global` (tudo) e `silencio_templates` (só `sendWaTemplate`), chaves em
  `sdr_avisos_chave`, sem deploy, cache 20 s. Teste de texto em prod: `GET /api/admin/test-alert?number=&secret=` (WEBHOOK_SECRET).
  **Bug visto:** com silêncio ligado o webhook grava a resposta em `sdr_mensagens` como `out` mesmo bloqueada (3 casos
  12h31–12h33; lead `14c80fe6` disse "Oi" e ficou sem resposta). Monitor do dia: `scratchpad/monitor_victoria.mjs` (sessão 11/11).
- **Templates HSM:** 13 no Evo (21 e 48 = mesmo nome na Meta). Em uso: 41 (D+0), 48 (coringa), 34, 29, 69; 21 manual; 28 sem
  rota. Lista via `POST /int/getTemplates` {queueId, apiKey, limit}. Planilha: `docs/Templates-HSM-AIVA-categorias-2026-11-10.xlsx`.
- `send-initial` segue sem autenticação (Aldo: não mexer agora). Biometria negada: cron DESLIGADO.

## Feito em 09–10/11 (publicado: `d2dbd6f`, `6f4e384`, `e5bd706`, `e4de388`)

- 10/11 (`e4de388`): economia de tokens A+B+C da auditoria. `montarSystemBlocks()` em `lib/claude.ts` (4 blocos: base,
  curadoria, diário — todos cache 1 h — e por lead sem cache; a HORA fica no bloco por lead, nunca no diário). Verificado
  em produção: 2 pings em 65 s → `cache_read 69633, cache_write 0`.

- Sonda da API: baseline 07/10, `TicketApi` com 4 campos, relatório `docs/Sonda-API-AIVA-2026-11-09.md`.
- Diagnóstico "Marcado e não chegou à AIVA (17)": os 20 CNPJs estão mesmo fora do portal; o Resolvido é soneca de 6 h
  por desenho (reabre enquanto o CNPJ não aparece). 6 são lojas que a AIVA DERRUBOU do quadro (30+ dias em formulário
  pendente) e o reenvio do pré-cadastro NÃO as traz de volta; 14 nunca apareceram (Minas desde 02/10). Só 2 de 32 lojas
  saíram dessa lista por aparecer no portal. Mensagem pronta: `docs/Mensagem-Mauricio-nao-chegou-2026-11-09.md`
  (inclui o pedido do login e já tem versão WhatsApp no histórico da sessão).
- Lead Sidney (opp Evo 20338) reativado à mão: estava NAO_QUALIFICADO (CNPJ anterior < 1 ano); o CNPJ novo está
  ATIVO há 1,2 ano. Card 93 → 47, marcadores trocados, template de retomada entregue 14:47 BRT.
  **Lição:** retomar pelo painel um lead NAO_QUALIFICADO não destrava — o webhook descarta as respostas dele (bloco 4c)
  e só avisa 1×/24 h. O caminho é mover o card pra Interessado + Reativar (ou trocar os marcadores, como feito).

## Em aberto (quem decide)

- **Aldo → Mauricio:** enviar a mensagem de 09/11 (20 CNPJs que não chegam + login do portal; agenda das turmas,
  `rejection_reason` e `training_label` seguem pendentes desde 18/09).
- **Nei:** nos 14 CNPJs "nunca apareceram", confirmar se viu a tela "Sua resposta foi registrada" (as marcações foram em
  lote no mesmo minuto em 28/10 e 03/11 — pode ter sido só remarcação, sem envio).
- **Aldo:** o bloco "não chegou" do painel não distingue "AIVA derrubou" de "nunca chegou" — vale separar (os derrubados
  têm `[DERRUBADO_AIVA:…]` no lead).
- **Aldo — Evo:** excluir automações 80 e 81. **Aldo — Vercel:** remover `GOOGLE_SHEETS_WEBHOOK_URL`, `HUBSPOT_*`.
- **Aldo × AIVA:** material de treinamento diz "R$ 10 por venda" sem "primeiro mês"?
- **Viagem 30/10–15/11:** Aldo/Nei respondem o briefing das 5h todo dia útil.

## Próximos passos sugeridos

1. 10 e 11/11: conferir o resumo das 15h57 do comunicado Black November (Aldo/Nei) e os recibos `clientrcvtime`; depois tirar o cron do `vercel.json`.
2. Quando o login do portal voltar: conferir os 20 CNPJs no banco do portal (removidos? outro parceiro?).
3. ~17/11: medir cache_creation/dia e custo/dia em `sdr_token_usage`; depois a dieta do prompt (D) em sessão nova, com o revisor.
4. Medir toque 3/descarte e dicas+link (itens 1–2 do handoff de 23/10, ainda não medidos).
5. Primeiro ticket de painel resolvido após `6f4e384`: conferir no Evo que o HSM com o link saiu e teve `clientrcvtime`.
6. Depois da viagem: auth no `send-initial` + desfazer o lead quando o template falha.

## Como retomar rápido

- Testes: `npm run test:retomada` · `test:desempenho` · `test:campanha` · `test:avisos` · `test:disparo` · `test:tickets` ·
  `npx tsc --noEmit -p tsconfig.json`. Mudança de comportamento da VictorIA passa pelo `revisor-prompt-victoria` antes do
  commit (o agente não está registrado no app: rode um `general-purpose` com o conteúdo de `.claude/agents/revisor-prompt-victoria.md`).
- Dry das rotas: `GET /api/sdr/<rota>?dry=1` com `Bearer CRON_SECRET` (local: `preview_start "SDR AIVA"`, porta 3012).
- Estado: `sdr_disparo_estado` (id=1) · rodadas `sdr_avisos_chave` (`disparo:%`, `vigia:%`) · trilha `sdr_etapa_log` ·
  avisos do painel `sdr_avisos_painel` (`resolvido_em is null`) · curadoria `/curadoria` (12 correções entram no prompt).
- Logs: Vercel → sdr-aiva. Vigia às 17h BRT (`/vigia?dry=1`) diz qual rota tem fila e não age.
- Scripts ad hoc em Node: `node --env-file=.env.local -e '…'` (tsx não está instalado; `@/lib` não resolve fora do Next —
  chame Supabase/Evo/API da AIVA direto por fetch).
