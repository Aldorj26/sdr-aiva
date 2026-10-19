# Mensagem para o Mauricio (AIVA) — 19/10/2026

> Motivo: conferência de hoje entre a coluna `dados_varejo` do portal e a nossa etapa
> "Formulário do varejo pendente". Números lidos ao vivo da API do parceiro em
> 19/10/2026 (859 onboardings da Track, 473 em `dados_varejo`).
> Planilha de apoio: `docs/Etapa50-x-dados_varejo-2026-10-19.xlsx`.

---

Mauricio, tudo bem?

Fizemos hoje uma conferência CNPJ por CNPJ entre a coluna `dados_varejo` do portal e a
nossa etapa de formulário pendente, e apareceram três coisas que só você consegue
responder. Nenhuma é urgente, mas a primeira muda como a gente cobra o lojista.

**1. O `created_at` do onboarding não parece ser a data real da pendência.**

Na API, os 473 CNPJs da Track em `dados_varejo` têm `created_at` entre **28/08 e 19/10** —
nenhum antes de 28/08. E 176 deles estão concentrados em três dias: **54 em 28/08, 41 em
31/08 e 81 em 04/09**. Pela cara, é uma importação ou migração do lado de vocês no fim de
agosto, não a data em que cada loja ficou pendente.

O caso que deixa isso claro é a **Teccell Celulares (45.949.064/0001-71)**: o onboarding
na API diz `created_at` de 31/08, mas do nosso lado essa loja está esperando o formulário
desde **03/08** — 77 dias. Então, se a gente usar o `created_at` como "há quanto tempo
está parado", erra para menos em boa parte da base.

Duas perguntas:
- O `created_at` é a data da **linha no portal** (recriada numa migração/reimportação) ou
  a data do **pré-cadastro**? Se foi migração, qual a data de corte?
- Existe algum campo com a data real — quando o pré-cadastro foi aprovado, ou quando o
  lojista entrou em `dados_varejo`? Se houver (um `stage_events`/histórico, por exemplo),
  a gente passa a medir o tempo de espera por ele e para de errar na cobrança.
- E existe expurgo ou expiração: pré-cadastro aprovado que passa de X dias sem formulário
  sai da coluna, vira `not_approved` ou é apagado?

**2. A tela do portal mostra 202, a API devolve 473 para a mesma coluna.**

Conferimos o corte: são exatamente os onboardings com `created_at` nos **últimos 30
dias**. Os outros 271 continuam em `dados_varejo` na API, só não aparecem na tela. Está
certo isso — a tela filtra 30 dias por padrão? Se der para ter um seletor de período (ou
um "todos"), ajuda muito: hoje quem olha só a tela subestima o pendente pela metade.

**3. Minas Celulares (60.849.076/0001-18) não existe no portal.**

Mandamos o pré-cadastro duas vezes, **02/10 e 17/10**, e o CNPJ não aparece em nenhuma
coluna — conferi contra os 859 onboardings visíveis para o nosso login, não é questão de
filtro. Tem log do lado de vocês dessas duas submissões? O formulário recusa esse CNPJ
por algum motivo (sócio, situação na Receita, duplicidade com outro parceiro)?

**4. YourCase Avenida (68.700.493/0001-06) — só confirmando o caminho.**

Esse CNPJ tem **raiz diferente** da matriz do Bruno, então tratamos como loja nova em vez
de filial. Ele entrou no portal em **13/10 e está em `dados_varejo`**, ou seja, o
pré-cadastro passou. Queria só confirmar que esse é o caminho certo nesse caso (loja nova,
não `/filial`), porque a API do parceiro só expõe `/filial` e `/repasse`. E, se puder
olhar: o Bruno está bloqueado por limite de originação há mais de 10 dias.

Obrigado!
