-- Hora do CLIQUE em "Abrir form" (Registros AIVA) — furo 1 do aviso "pré-cadastro não chegou à AIVA".
--
-- O passo 11 do espelho (lib/espelho-portal-calc.ts, preCadastroNaoChegou) conta 24h sem o CNPJ
-- aparecer no portal da AIVA pra concluir que o formulário não foi enviado. Até 15/10/2026 essas
-- 24h saíam de `criado_em`, que é a criação da LINHA: a hora em que o CNPJ foi capturado do
-- lojista, não a hora em que alguém clicou em "Abrir form". Consequência: um CNPJ registrado dias
-- antes e clicado hoje disparava o aviso na PRIMEIRA rodada do espelho, com o painel afirmando
-- "marcado como enviado há mais de 24h" — falso.
--
-- `enviado_em` passa a ser carimbado em /api/registros na transição enviado false → true (e
-- limpo ao desmarcar). O código tem fallback para `criado_em`, então ele funciona antes e depois
-- desta migração: as linhas antigas seguem com o comportamento de hoje, e as novas ganham a data
-- certa. Nada precisa ser preenchido retroativamente.
--
-- Aplicar à mão no SQL Editor do Supabase (projeto axkrorkhnkfkpbjikwrb), como as outras.

alter table sdr_registros_cnpj
  add column if not exists enviado_em timestamptz;

comment on column sdr_registros_cnpj.enviado_em is
  'Clique em "Abrir form" no /registros (transição enviado false→true). Relógio das 24h do aviso pre_cadastro_nao_chegou. Null nas linhas anteriores a 15/10/2026 e nas que nascem já marcadas — aí vale criado_em.';
