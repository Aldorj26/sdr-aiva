# Mensagem para o Mauricio (AIVA) — 17/09/2026

> Pronta para enviar por WhatsApp ou e-mail. O bloco abaixo é o texto; os números
> foram conferidos contra a API hoje (525 registros).

---

Mauricio, tudo bem?

Primeiro: obrigado pela atualização da API. Os campos de checagem de CNPJ chegaram
exatamente no momento em que a gente precisava, e já estão rodando aqui.

**O que já fizemos com eles hoje:**

- Paramos de cobrar formulário de **6 lojas** que estão INAPTA ou BAIXADA na Receita.
  A gente estava mandando mensagem pedindo o preenchimento, e o formulário não ia
  destravar nada enquanto a empresa não regularizar. Agora essas lojas saem da régua
  automática e vão pro nosso time falar com o lojista sobre regularização.
- Separamos delas os **17 cadastros nossos com `invalid`/`not_found`** (são 20 no total
  do portal), que são outra história: quase
  sempre é o CNPJ digitado errado no cadastro — temos loja vendendo normalmente
  marcada assim. Essas viraram uma lista de conferência, não de bloqueio.
- Como os campos vieram na API pública, conseguimos tirar uma dependência de login
  com senha que a gente tinha. Ficou mais simples e mais confiável dos dois lados.

Três coisas que eu queria te passar:

**1. `training_at` está sempre nulo.** A documentação mostra o campo preenchido no
exemplo, mas nos 525 registros que a gente lê ele vem `null` em 100%. Se for para ter
valor, parece que ficou algo pendente no preenchimento. Esse campo resolveria um
problema real nosso: hoje a gente não sabe por qual turma de treinamento cada loja
passou, e acaba perguntando ao lojista o que o sistema de vocês já sabe.

**2. O motivo da reprovação continua sendo o nosso maior ponto cego.** Cruzei os
dados: temos **25 lojas com `pre_cadastro_status = not_approved`**, e todas as 25
estão com `cnpj_check_status = valid` e `cnpj_situacao = ATIVA`. Ou seja, a checagem
de CNPJ (que ficou ótima) não explica nenhuma dessas reprovações — o motivo é a
análise de vocês, e a gente não tem acesso a ele.

Isso significa que quando o lojista pergunta "por que fui reprovado?", a gente não
tem resposta. Não precisa ser o parecer completo: um campo com categoria já
resolveria (ex.: `rejection_reason: "restricao_socio" | "perfil_nao_atendido" |
"documentacao" | ...`), mais um texto livre opcional. Com isso a gente para de abrir
chamado com vocês pra perguntar caso a caso, e consegue dizer ao lojista se vale a
pena corrigir algo e voltar.

**3. Dois campos que já existem no banco e ajudariam muito se viessem na API:**

- **`phone_number` e `email`** — temos **47 lojas** atribuídas à Track no portal para
  as quais não temos telefone nenhum. Elas estão paradas esperando o formulário do
  varejo e a gente não tem por onde falar com elas. Esses contatos estão no cadastro
  de vocês; com eles na API, essas 47 entram na nossa régua automática amanhã.
- **`liveness_url`** — a gente usa esse link para mandar a biometria para o lojista
  no momento certo. Hoje ele é a única coisa que ainda nos obriga a manter o acesso
  por login; se vier na API, fechamos essa ponta também.

Sobre volume, para você dimensionar: a gente consulta o `/onboardings` a cada 15
minutos, o que dá cerca de 200 chamadas por dia — bem dentro do limite de 5.000. Os
filtros novos (`updated_since`, `cnpj_check_status`) estão anotados aqui e a gente
passa a usar se o volume crescer.

Qualquer coisa que facilite do lado de vocês, é só falar.

Abraço,
Aldo
