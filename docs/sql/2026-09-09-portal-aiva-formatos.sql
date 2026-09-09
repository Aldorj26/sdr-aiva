-- Portal Parceiros AIVA — ajuste de tipos ao FORMATO REAL do portal (09/09/2026).
--
-- Registro das duas migrações JÁ APLICADAS no Supabase (axkrorkhnkfkpbjikwrb)
-- depois do primeiro dry-run contra o portal de verdade. O schema de
-- docs/sql/2026-09-09-portal-aiva.sql foi escrito a partir do que a spec
-- SUPUNHA; o retrato real (627 linhas de retailer_performance) mostrou outra
-- coisa:
--
--   * inadimplencia_aiva  → NÃO é percentual: é uma CATEGORIA de texto,
--     "BOM" / "RUIM" (40 linhas preenchidas, meses mai–jul; o resto null).
--     Guardar em `numeric` fazia a gravação estourar/zerar o dado.
--   * inadimplencia_odres → veio 100% null até agora; assumimos o mesmo
--     formato da irmã (mesma origem, mesma tela) e migramos junto, pra não
--     descobrir na marra no dia em que a AIVA começar a preencher.
--   * phone_number        → coluna nova do portal, preenchida em 100% das
--     linhas (ex.: "5567999278475"). Vira `telefone` no nosso retrato: é o
--     contato da loja ativa e alimenta a busca do /desempenho.
--     `aiva_desempenho` JÁ tinha `telefone` (herdado do Data Studio) — só
--     `aiva_portal_diario` precisava da coluna.
--
-- Notas do mesmo retrato que NÃO exigiram migração (ficam aqui como registro):
--   * status = "active"/"inactive" (a UI é que rotula Ativo/Inativo) — a
--     normalização é feita em código, em lib/portal-aiva.ts::paraLinhaDiaria.
--   * registered_at = data de cadastro do lojista (YYYY-MM-DD, 100% das
--     linhas) → vai pra `cadastro_em`, que já existia como `date`.
--   * out_of_store_photo_pct está em escala 0–100 (33.3, 50, 100), não 0–1 —
--     `numeric` já servia; mudou só a formatação no painel.

-- 1) inadimplência vira texto (categoria BOM/RUIM) nas duas tabelas.
--    As colunas estavam vazias na prática (nenhuma linha do portal gravada com
--    valor numérico), então o `using` é só formalidade pro Postgres aceitar.
alter table aiva_portal_diario
  alter column inadimplencia_aiva  type text using inadimplencia_aiva::text,
  alter column inadimplencia_odres type text using inadimplencia_odres::text;

alter table aiva_desempenho
  alter column inadimplencia_aiva  type text using inadimplencia_aiva::text,
  alter column inadimplencia_odres type text using inadimplencia_odres::text;

-- 2) telefone no retrato diário (aiva_desempenho já tinha a coluna).
alter table aiva_portal_diario
  add column if not exists telefone text;   -- só dígitos, ex.: 5567999278475
