# HANDOFF — SDR AIVA

> Leia ao abrir a sessão; atualize ao encerrar (`/handoff`). Estado ATUAL, não log: o log é o git e
> `docs/HISTORICO-OPERACAO-AIVA.md`. Push na `main` = deploy em produção.

## Estado de produção (23/10/2026)

- **Disparo D+0 na nuvem**: cron Vercel a cada 5 min, 8h–19h BRT dia útil, teto 500/dia (derivado de `sdr_mensagens`
  rótulo `aiva_campanha`), 3 lotes de 5 em paralelo. Entrega baixa AVISA, não pausa (só `/pausar` ou o painel). Fila
  `sdr_fila_disparo` com ~25 mil PENDENTE (≈50 dias úteis); lista nova entra por `scripts/importar-fila-varredura.mjs`.
- **Retomada do INTERESSADO** (`/retomada-interessado`, 10h–16h de hora em hora): 2 toques (200/dia INTERESSADO,
  120/dia AGUARDANDO) e, desde 22/10, **toque 3 com oferta** (turma ao vivo; `aiva_retomada_oferta`, 100/dia) para quem
  esgotou a régua e é quente (dados ou 3+ msgs humanas) + **descarte** (mudo 60 d+ ou 15 d após o toque 3; teto 300/dia;
  roda antes dos envios; card → 53). Marcadores `[RETOM_INT3]`, `[DESCARTE_RETOMADA]`. Briefing das 5h traz a linha ♻️.
- **Comissão de R$ 10/venda ao VENDEDOR vale só nos 30 dias da criação da loja** (`aiva_desempenho.cadastro_em`; regra
  23/10). Linha 💰 no bloco NÚMEROS DA LOJA (VIGENTE até dd/mm / ENCERRADA / DESCONHECIDA); motivo_humano
  `duvida_comissao_vendedor`. Loja com vários CNPJs usa a data mais antiga (filial nova de matriz antiga = ENCERRADA).
- **Campanha de boas-vindas** (4 semanas, loja nova desde 09/10): prazo da semana sai calculado com dia da semana e
  distância ("vai até 26/10, segunda-feira — faltam 4 dias"). A dica semanal cede a vez enquanto ela roda.
- **Dicas de desempenho** semanais para toda loja ativa, com link `/r/<token>` do relatório (`aiva_relatorio_link`);
  pulso semanal e check de primeira venda APOSENTADOS (20/10). Único impacto recorrente na loja ativa.
- **Laço VictorIA × robô de loja** cortado por regra (`lib/laco-bot-calc.ts`): ≥35 respostas/h ou frase repetida 6× →
  pausa 24h + BOT_DETECTADO. Biometria reprovada: VictorIA coleta documento + selfie (1 foto por turno); cron de
  biometria negada continua DESLIGADO (`ENVIO_NEGADA_ATIVO = false`, texto antigo).
- `send-initial` sem autenticação e carimba o lead ANTES do template (pane do Evo em 21/10 queimou leads; reparo feito).
  Aldo decidiu não mexer agora. Funil 15 = quadro de onboarding da AIVA (espelho a cada 15 min).

## Feito em 22–23/10 (tudo publicado)

- `1ab0e62`…`17bc032` toque 3 + descarte dos interessados esgotados (plano em `docs/superpowers/plans/2026-10-22-*`).
- `8d4070d` `de60ea0` prazo da campanha calculado (a VictorIA chamou 26/10 de "amanhã" em 22/10).
- `fc581d5` comissão do vendedor só no 1º mês (prompt, bloco de números, dicas, relatório, painel, pulso).

## Em aberto (quem decide)

- **Aldo — Evo:** excluir as automações soltas 80 e 81 (nenhuma etapa aponta pra elas; a régua mora no código).
- **Aldo — prompt:** a VictorIA entrega o link da turma a prospect que responde "quero o link" à oferta do toque 3?
  (hoje o bloco TURMAS vai pra todos; passa pelo `revisor-prompt-victoria`). O texto da oferta cita "seg, qua e sex
  às 9h30" — a AIVA muda a agenda sem avisar.
- **Aldo × AIVA:** o material de treinamento/apresentação que a VictorIA envia diz "R$ 10 por venda" sem "primeiro mês"?
- **Aldo — Vercel:** remover `GOOGLE_SHEETS_WEBHOOK_URL`, `HUBSPOT_PORTAL_ID`, `HUBSPOT_FORM_GUID` (sem leitor).
- **Aldo × Mauricio:** Minas Celulares (60.849.076/0001-18) nunca aparece no portal; YourCase Avenida (raiz diferente da
  matriz) = loja nova, API só tem `/filial`; `created_at` dos onboardings não é a data real da pendência.
- **Aldo:** 7 lojas que vendem no portal sem lead no CRM (sem telefone) — pedir contatos ao Gerisson? Responder o
  Gerisson (conciliação UME, `docs/Conciliacao-AIVA-Gerson-2026-10-13-v3.xlsx`).
- **Nei:** GT Cell e Ph Celulares (CNPJ INAPTA) → etapa 94; AS Imports sem CNPJ; CNPJs novos no `/registros`.
- **Viagem 30/10–15/11:** Aldo/Nei respondem o briefing das 5h todo dia útil (mantém a janela de 24h).

## Próximos passos sugeridos

1. Medir o toque 3 e o descarte (~05/11): respostas por `aiva_retomada_oferta` × toques 1/2 (24% / 10,5%); linha ♻️.
2. Medir dicas + link do relatório (~03/11): `acessos` em `aiva_relatorio_link`; `sem_uso`/`parou` que voltaram.
3. Medidor de entrega exato (mistura campanha fria com templates da base) — agora que o alerta é a única proteção.
4. D+14 da etapa 50 (334 cards parados em 19/10) medido pela entrada na etapa no Evo, não pelo `created_at` do portal.
5. Depois da viagem: auth no `send-initial` + desfazer o lead quando o template falha (nos dois repos).
6. Fio solto do espelho: Senna e Magazine Sousa em `dados_varejo` no portal e em Cadastro Recebido no CRM.

## Como retomar rápido

- Testes: `npm run test:retomada` · `test:desempenho` · `test:campanha` · `test:avisos` · `test:disparo` ·
  `npx tsc --noEmit -p tsconfig.json`. Mudança de comportamento da VictorIA passa pelo `revisor-prompt-victoria` antes do commit.
- Dry das rotas: `GET /api/sdr/<rota>?dry=1` com `Bearer CRON_SECRET` (local: `preview_start "SDR AIVA"`, porta 3012).
- Estado: `sdr_disparo_estado` (id=1) · rodadas `sdr_avisos_chave` (`disparo:%`, `vigia:%`) · trilha `sdr_etapa_log` ·
  avisos do painel `sdr_avisos_painel` (`resolvido_em is null`) · curadoria `/curadoria` (12 correções entram no prompt).
- Logs: Vercel → sdr-aiva. Vigia às 17h BRT (`/vigia?dry=1`) diz qual rota tem fila e não age.
