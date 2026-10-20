-- Relatório semanal da loja ativa (20/10/2026): o link /r/<token> que vai no HSM 48 da rotina
-- /api/sdr/dicas-desempenho, no formato do Farm Track da Parcelex (mesma mecânica, conteúdo AIVA).
-- O token É a autenticação da página (pública, aberta pelo lojista no celular), então:
--   · é aleatório e longo (16 caracteres base58 ≈ 94 bits), nunca derivado de CNPJ/telefone;
--   · é ESTÁVEL por lead — o lojista pode salvar o link; a página sempre mostra o retrato mais recente;
--   · `cnpjs` é a lista de CNPJs do lead no momento da criação (somados na página, como no resumo da VictorIA).

create table if not exists aiva_relatorio_link (
  token          text primary key,
  lead_id        uuid not null unique references sdr_leads(id) on delete cascade,
  cnpjs          text[] not null,
  criado_em      timestamptz not null default now(),
  acessos        int not null default 0,
  ultimo_acesso  timestamptz
);

-- RLS ligada e sem policy: só o service_role (rotas) lê. A chave anon vai no bundle do navegador
-- e listaria todos os tokens — ou seja, todos os relatórios.
alter table aiva_relatorio_link enable row level security;
