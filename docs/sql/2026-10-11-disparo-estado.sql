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

-- RLS ligada e SEM nenhuma policy: o service_role (usado pelas rotas) ignora RLS;
-- a chave anon (pública, vai no bundle do navegador) fica negada em leitura e escrita.
-- Sem isso qualquer um com a chave pública poderia setar pausado=false e desfazer
-- em silêncio uma pausa por queda de entrega da Meta, sem passar pelo /retomar.
alter table sdr_disparo_estado enable row level security;
