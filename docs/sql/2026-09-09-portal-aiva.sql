-- Portal Parceiros AIVA como fonte do desempenho (spec 2026-09-09).
-- aiva_portal_diario = retrato bruto do portal, um por dia (fonte de verdade);
-- aiva_desempenho e aiva_desempenho_semanal passam a ser derivadas dela.

create table if not exists aiva_portal_diario (
  data_ref            date        not null,   -- dia da coleta - 1 (BRT): retrato "até ontem"
  retailer_id         text        not null,
  mes                 date        not null,   -- dia 1 do mês (como vem do portal)
  cnpj                text        not null,   -- 14 dígitos
  nome_varejo         text,
  consultas           integer     not null default 0,   -- acumulados do mês naquele dia
  aprovados           integer     not null default 0,
  vendas              integer     not null default 0,
  valor_vendas        numeric     not null default 0,
  inadimplencia_aiva  numeric,
  inadimplencia_odres numeric,
  foto_fora_pct       numeric,
  status              text,                   -- Ativo / Inativo
  cadastro_em         date,                   -- só se o portal expuser a coluna
  bruto               jsonb       not null,   -- linha inteira do portal
  coletado_em         timestamptz not null default now(),
  primary key (data_ref, retailer_id, mes)
);
create index if not exists aiva_portal_diario_mes_idx on aiva_portal_diario (mes, data_ref);
create index if not exists aiva_portal_diario_cnpj_idx on aiva_portal_diario (cnpj);

alter table aiva_desempenho
  add column if not exists consultas           integer,
  add column if not exists rid                 text,
  add column if not exists status_portal       text,
  add column if not exists inadimplencia_aiva  numeric,
  add column if not exists inadimplencia_odres numeric,
  add column if not exists foto_fora_pct       numeric,
  add column if not exists cadastro_em         date,
  add column if not exists atencao             text;  -- novo_sem_engajamento | baixa_performance | null

-- Leitura pela assistente (RPC assistente_sql roda como assistente_ro)
grant select on aiva_portal_diario to assistente_ro;
