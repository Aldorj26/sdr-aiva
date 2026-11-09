# Sonda da API pública da AIVA — 09/11/2026 (só GET)

Comparação com o retrato de 07/10 (29 campos em `/onboardings`) e com o tipo `TicketApi` (13/10).

## /onboardings — SEM mudança de contrato desde 07/10
- 29 campos, os mesmos. Nenhum campo novo, nenhum sumiu. Ainda sem `rejection_reason` e sem endpoint de agenda das turmas
  (`/trainings`, `/training-sessions` etc. → 404). Caminhos: só `/onboardings` (GET), `/onboardings/remove` e `/resend-password` (POST).
- Filtros: `stage=` e `updated_since=` seguem filtrando (384 desde 08/11); `cnpj=`, `retailer_id=`, `board_column=` continuam ignorados.
- `training_label` continua 0/999 (training_at preenchido em 177). phone_number 420/999, email 378, liveness_url 420.
- Valores: `pre_cadastro_status` = pending 3 · approved 984 · declined 12 (o código já trata `declined`). Todas as 8 colunas
  de `board_column` estão em `COLUNA_PARA_ETAPA`/`COLUNA_SEM_ETAPA` — nenhuma coluna desconhecida.
- Volume: 999 cadastros (543 em 24/09; 135 criados desde 23/10). stage: dados_varejo 554 · cadastro_finalizado 386 ·
  biometria 42 · not_approved 14 · pre_cadastro 3. board_column: primeiro_acesso 156 · primeira_venda 122 · pronto_para_operar 80 ·
  cadastro_finalizado 28 · biometria_pendente 42. Biometria: pendente 633 · aprovado 349 · negado 17.

## /tickets — 4 campos que o tipo `TicketApi` não declara
`priority`, `description`, `first_response_at`, `closed_at` (não se sabe se são novos ou se já vinham desde 13/10 — não havia sonda).
15 tickets (#1036–#1097), todos `resolvido`; tipos: Acesso ao Painel Financeiro 14 · Cadastro de filial 1. Último update 30/10.
Os tickets #1030/#1031 (Nei, à mão) seguem fora do GET. Mensagens: `id, from, body, created_at` (sem novidade).

## Observação sobre a sonda
`scripts/sonda-api-aiva.mjs` compara com uma lista fixa de 24/09 e por isso acusa `board_column`, `board_column_since` e
`primeiro_acesso_em` como NOVOS, embora o código os use desde 07/10. Atualizar a lista (ou derivá-la do tipo) na próxima mexida.
