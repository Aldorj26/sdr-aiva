# HANDOFF — SDR AIVA

> Documento vivo. **Leia ao abrir a sessão; atualize ao encerrar (`/handoff`).** Substitui carregar o histórico da
> conversa anterior: aqui vai o que foi feito, o que está em aberto e o próximo passo — nada mais.

## Estado de produção (15/10/2026)

- **Disparo D+0 na nuvem ligado** desde 13/10 (`/api/sdr/disparo-diario`, cron a cada 5 min, 8h02–18h57 BRT, teto 500).
  Comandos pelo WhatsApp da VictorIA: `/disparo`, `/pausar`, `/retomar`.
- ⚠️ **14/10 o disparo ficou pausado o dia todo.** Pausa automática às 08h32 (entrega 6 de 22 = 27%, piso 30%); o
  Aldo tentou `/retomar` duas vezes e o corretor do celular trocou por "/retornar" — o comando nunca chegou.
  Enquanto pausado o cron roda e não envia nada. **Conferir o estado antes de qualquer análise de volume.**
- **Consulta de CNPJ com segunda fonte** desde 15/10 (commit `6e0a7a9`, deploy READY): BrasilAPI 5xx/timeout/rate
  limit cai no `publica.cnpj.ws` e ainda confere idade (≥1 ano) e situação ATIVA. O alerta "PRÉ-APROVAÇÃO SEM
  CONFERIR O CNPJ" só sai quando as DUAS fontes falham. 400/404 seguem bloqueando (decisão, não instabilidade).
- `send-initial` **sem autenticação** (pré-existente) e **grava o lead antes de enviar o template** — Aldo decidiu
  NÃO mexer agora.
- Hook de fim de sessão **não faz mais push** (só commit local). Push na `main` = deploy em produção.

## Em aberto (quem decide)

- **Aldo — página `/disparos` no painel:** desenho apresentado em 15/10 e aguardando OK. Estado do disparo
  (ativo/pausado, saíram X de 500, fila, entrega) + botões Pausar/Retomar, para destravar pelo navegador do celular
  sem depender do WhatsApp. Sem botão "disparar agora" (a `rodada()` respeita janela e lock de 5 min). Nada escrito.
- **Aldo — plano da pré-aprovação pela AIVA** (`docs/superpowers/plans/2026-10-14-pre-aprovacao-aiva.md`, já na
  `main`): falta escolher o método de execução. Recomendado **subagent-driven** (a Task 4 remove a trava atual do
  funil e as Tasks 1–3 são a substituição dela). Não começar antes da escolha.
- **Aldo — ✓ "Enviado" no `/registros`:** desenho curto apresentado; sub-decisão aberta entre coluna nova
  `form_aberto_em` (recomendado, exige `ALTER TABLE` na mão) e reusar `origem='abriu-form'` com `enviado=false`.
- **Nei:** reenviar na mão 6 pré-cadastros no `/registros` (Connect Shop, Minas Celulares, RM Celulares, JR IMPORTS,
  Peninha Celulares, Solucion Cell; Fra cell ainda não fez 24h) + enviar o pré-cadastro da **DB Tecnologia**
  (55.817.303/0001-93 — conferido na mão em 14/10: aberta 05/07/2024, Ativa, CNAE 4752-1/00, liberada).
- **Nei:** lista "Para o Nei" em `docs/Conciliacao-AIVA-Gerson-2026-10-13-v3.xlsx` (col. K = próximo passo).
- **Aldo:** responder o Gerisson (4 pontos: valor 1.843,02 × 1.843,12; linhas ocultas 5476/5681; Kero Celular jul;
  Maricell 4712) + lista de varejos Track na base da UME + origem de Rauenne (6443) e Adricell (4782).
- **Viagem 30/10–15/11:** Aldo/Nei respondem o briefing das 5h todo dia útil (mantém a janela de 24h dos alertas).

## Próximos passos sugeridos

1. Implementar a `/disparos` assim que o Aldo aprovar — é o que evita outro dia parado como o 14/10.
2. Escolher o método de execução do plano da pré-aprovação e rodar.
3. Apagar de vez a tarefa agendada `importar-base-aiva-diaria` (já desabilitada).
4. Depois da viagem: auth no `send-initial` + desfazer lead quando o template falha (nos dois repos).

## Como retomar rápido

`npm run test:disparo` · `npm run test:cnpj` · `npx tsc --noEmit -p tsconfig.json` ·
estado do disparo: `select * from sdr_disparo_estado` (uma linha, id=1) · envios do dia: `sdr_mensagens` com
`template_hsm='aiva_campanha'` · fila: `sdr_fila_disparo` status `PENDENTE` ·
logs: Vercel → sdr-aiva → `/api/sdr/disparo-diario` e `[CNPJ]`. Histórico: `docs/HISTORICO-OPERACAO-AIVA.md`.
