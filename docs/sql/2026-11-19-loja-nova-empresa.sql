-- Loja nova de OUTRA empresa pedida por varejista já ativo (mesmo WhatsApp) — colunas em sdr_registros_cnpj.
--
-- O pedido vira uma linha em sdr_registros_cnpj (mesmo lead, tipo 'adicional') com fluxo = 'loja_nova_empresa'.
-- Ela aparece na fila "Registros AIVA" do /atendimento com o selo "loja nova de cliente ativo": o Nei só
-- clica em "Abrir form". Linhas 'adicional' sem fluxo continuam como sempre.
--
-- O código tolera a ausência destas colunas (erro 42703 → refaz o select sem elas), então pode ser
-- publicado antes ou depois desta migração; sem ela o selo e o sócio simplesmente não aparecem.
-- Nada precisa ser preenchido retroativamente.
--
-- Aplicar à mão no SQL Editor do Supabase (projeto axkrorkhnkfkpbjikwrb), como as outras.

alter table sdr_registros_cnpj
  add column if not exists fluxo text,
  add column if not exists socio_nome text,
  add column if not exists socio_telefone text,
  add column if not exists link_enviado_em timestamptz,
  add column if not exists criada_avisada_em timestamptz;

comment on column sdr_registros_cnpj.fluxo is
  'Origem especial da linha. ''loja_nova_empresa'' = varejista ativo pediu loja de outra empresa (raiz de CNPJ diferente) pelo WhatsApp. Null = registro comum.';
comment on column sdr_registros_cnpj.socio_nome is
  'Nome do sócio responsável pela loja nova quando NÃO é o mesmo do lead. Null no fluxo = mesmo sócio.';
comment on column sdr_registros_cnpj.socio_telefone is
  'WhatsApp do sócio responsável (formato 55DDDNÚMERO) quando diferente do lead. Null = mesmo sócio.';
comment on column sdr_registros_cnpj.link_enviado_em is
  'Quando o link de cadastro foi enviado ao lojista depois que o cadastro da loja nova abriu na AIVA. Null = ainda não enviado.';
comment on column sdr_registros_cnpj.criada_avisada_em is
  'Quando o lojista foi avisado de que a loja nova foi criada na AIVA. Null = ainda não avisado.';
