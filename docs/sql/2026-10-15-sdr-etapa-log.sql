-- Trilha dos movimentos de etapa do espelho do portal (lacuna 3 da auditoria de 15/10/2026).
--
-- Até aqui o movimento só ia pro `console.log` da Vercel: auditar "as etapas estão trocando certo?"
-- exigia script, e o defeito do dia (opp #29936 TeamVL, 70 → 51 recusado pelo Evo com HTTP 200)
-- passou mais de 24 h invisível. Com a trilha em tabela, a conferência é um SELECT — e é ela que
-- alimenta a regra de movimento repetido (lib/espelho-repeticao-calc.ts): o MESMO movimento
-- (opp + de + para) em N rodadas seguidas é card travado e avisa Aldo e Nei.
--
-- Escrita é BEST-EFFORT: lib/espelho-portal.ts grava num try/catch e segue a rodada se falhar.
-- Nada no espelho depende desta tabela para mover card.
--
-- Aplicar à mão no SQL Editor do Supabase (projeto axkrorkhnkfkpbjikwrb), como as outras.

create table if not exists sdr_etapa_log (
  id         bigserial   primary key,
  criado_em  timestamptz not null default now(),
  -- sem FK pra sdr_leads de propósito: trilha de auditoria sobrevive ao lead (o sync apaga leads
  -- do funil 19) e o insert do log nunca pode falhar por causa de um lead que saiu da tabela.
  lead_id    uuid,
  nome       text,                      -- nome do lojista no momento do movimento (histórico)
  opp        bigint      not null,       -- oportunidade no Evo (funil 15)
  de         int,                        -- etapa de origem; null = não sabíamos
  para       int         not null,       -- etapa de destino
  via        int[],                      -- etapas intermediárias por onde o card passou (ex.: {70})
  motivo     text        not null,       -- por que o espelho quis mover (texto do Movimento)
  ok         boolean     not null,       -- o Evo aceitou?
  erro       text        -- mensagem do Evo quando recusou (inclui o 200-com-erro-no-corpo)
);

-- a consulta da regra de repetição: últimas linhas de um punhado de opps
create index if not exists idx_sdr_etapa_log_opp ON sdr_etapa_log (opp, criado_em desc);
-- auditoria do dia ("o que o espelho mexeu hoje?")
create index if not exists idx_sdr_etapa_log_criado_em ON sdr_etapa_log (criado_em desc);

-- RLS ligada e SEM policy: o service_role (as rotas) ignora RLS; a chave anon, que vai no bundle do
-- navegador, fica negada em leitura e escrita — a trilha tem nome de loja e id de oportunidade.
alter table sdr_etapa_log enable row level security;
