# HANDOFF — SDR AIVA

> Documento vivo. **Leia ao abrir a sessão; atualize ao encerrar (`/handoff`).** Substitui carregar o histórico da
> conversa anterior: aqui vai o que foi feito, o que está em aberto e o próximo passo — nada mais.

## Estado de produção (14/10/2026)

- **Disparo D+0 na nuvem ligado** desde 13/10 (`/api/sdr/disparo-diario`, cron a cada 5 min, 8h02–18h57 BRT, teto 500).
  13/10 fechou com ~370 (pausa falsa das 11:07 até 15:52 — corrigida: amostra de recentes 20, carência 20 min).
  Comandos pelo WhatsApp da VictorIA: `/disparo`, `/pausar`, `/retomar`.
- `send-initial` **sem autenticação** (pré-existente) e **grava o lead antes de enviar o template** (loja fica em INICIO
  sem D+0 se o Evo falhar) — Aldo decidiu NÃO mexer agora (escopo da viagem é só o disparo).
- Hook de fim de sessão **não faz mais push** (só commit local). Push na `main` = deploy em produção.
- Comissões UME: retroativo do Gerisson (R$ 1.843,12, abr–set) importado como origem `retroativo` (painel → UME →
  Retroativo); 7 lojas pagas sem registro cadastradas em `sdr_registros_cnpj` (origem `conciliacao-ume-2026-10`).

## Em aberto (quem decide)

- **Aldo:** responder o Gerisson (4 pontos: valor 1.843,02 × 1.843,12; linhas ocultas 5476/5681; Kero Celular jul;
  Maricell 4712) + pedir a lista de varejos Track na base da UME + origem de Rauenne (6443) e Adricell (4782) +
  Fone Express (cadastro manual pedido em 03/09). Texto pronto na conversa de 13/10.
- **Nei:** lista "Para o Nei" em `docs/Conciliacao-AIVA-Gerson-2026-10-13-v3.xlsx` (col. K = próximo passo).
  WM …0228 (contrato por e-mail), Maricell L2 (form de filial), Dany …0158 (retomar em 27/10, `[PAUSA_ATE]`).
- **Viagem 30/10–15/11:** Aldo/Nei respondem o briefing das 5h todo dia útil (mantém a janela de 24h dos alertas em
  texto; o coringa 48 chega mesmo sem janela).

## Próximos passos sugeridos

1. Acompanhar 2 dias de disparo a 5 min (entrega, pausas, resumo das 18h57) antes de qualquer outro ajuste.
2. Quando o Gerisson mandar as linhas de 5476/5681: completar `ume_comissoes` (origem `retroativo`) pra fechar 1.843,12.
3. Depois da viagem: auth no `send-initial` + desfazer lead quando o template falha (nos dois repos).

## Como retomar rápido

`npm run test:disparo` · `npx tsc --noEmit -p tsconfig.json` · estado do disparo: `select * from sdr_disparo_estado` ·
envios do dia: `sdr_mensagens` com `template_hsm='aiva_campanha'` · logs: Vercel → sdr-aiva → `/api/sdr/disparo-diario`.
Histórico completo: `docs/HISTORICO-OPERACAO-AIVA.md`.
