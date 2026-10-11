-- Disparo diário automático da AIVA (spec 2026-10-11): estado da pausa.
-- Uma linha só (id = 1). A pausa NÃO expira na virada do dia: só /retomar destrava.
-- A contagem do dia NÃO mora aqui — deriva de sdr_mensagens (rótulo aiva_campanha).

create table if not exists sdr_disparo_estado (
  id            int primary key default 1 check (id = 1),
  pausado       boolean     not null default false,
  pausado_em    timestamptz,
  motivo        text,
  retomado_em   timestamptz,
  retomado_por  text        -- telefone de quem mandou /retomar
);

insert into sdr_disparo_estado (id, pausado) values (1, false)
on conflict (id) do nothing;
