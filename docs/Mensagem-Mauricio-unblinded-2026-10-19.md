# Pergunta extra pro Mauricio — os 27 com `unblinded_at` (19/10/2026)

> Complemento da mensagem de hoje. Números lidos da API do parceiro em 19/10/2026
> (859 onboardings da Track). Lista completa dos 27 CNPJs disponível se ele quiser.

---

Mauricio, mais uma pequena, que apareceu agora quando tirei o filtro de período da tela:

A coluna **"Formulário do varejo pendente"**, em "Todo o período", mostra **446**. A API
devolve **473** em `dados_varejo` para a Track. A diferença são **27 registros**, e o único
campo que separa esses 27 dos outros 446 é o **`unblinded_at` preenchido** — em todo o
resto da nossa base (859 onboardings, todas as colunas) esse campo está vazio.

Os 27 têm um padrão bem fechado:

- `unblinded_at` entre **15/09 e 23/09**, e **`unblinded_by` nulo** nos 27;
- todos com `formulario_status = pending` e `biometry_status = pendente`, igual aos outros 446;
- do nosso lado, **12 deles são lojas que já estão operando** (vendendo pela AIVA), 11 não
  estão mais no nosso funil e só 2 estão realmente aguardando formulário.

Três perguntas:

1. O que é o "desblindado" nesse contexto, e o que aconteceu entre 15 e 23/09 que desblindou
   esses 27 de uma vez (com `unblinded_by` vazio — foi rotina/sistema, não uma pessoa)?
2. A tela **tira** os desblindados da coluna de formulário pendente de propósito? Se sim,
   eles aparecem em algum outro lugar, ou saem do quadro?
3. Pra 12 deles já tem loja vendendo do nosso lado. Esses CNPJs são filiais/CNPJs adicionais
   de loja já criada? Se forem, a gente para de contá-los como pendência — hoje eles entram
   na nossa conta de "falta formulário" e não deveriam.

O motivo prático: a gente usa `dados_varejo` pra decidir quem cobrar. Se 27 não são cobráveis,
é melhor saber do que mandar mensagem pra loja que já está operando.

Obrigado!
