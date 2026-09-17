# Mensagem para o Mauricio (AIVA) — atualizada 18/09/2026

> Reescrita depois da segunda atualização da API (a anterior pedia coisas que ele
> já entregou). Números conferidos contra a API: 525 registros, 26 campos.

---

Mauricio, tudo bem?

Obrigado pela nova rodada — `phone_number`, `email`, `liveness_url` e os campos de
treinamento entraram exatamente como a gente precisava. Já colocamos em uso:

- O cron que manda o link da biometria pro lojista **parou de depender do login com
  senha**: agora ele lê a lista por `?stage=biometria` na API. Isso corrigiu um modo
  de falha silencioso — antes, se o login falhasse, ninguém recebia o link e não
  aparecia erro em lugar nenhum.
- A checagem de CNPJ que você liberou na rodada anterior já está segurando cobrança
  indevida: paramos de pedir formulário para **6 lojas** que estão INAPTA ou BAIXADA
  na Receita, e separamos delas as que têm dígito inválido (que quase sempre é erro
  de digitação, não problema da loja).

Três retornos e um pedido:

**1. `training_label` vem sempre nulo.** Os outros três (`training_at`, `training_id`,
`training_source`) vieram preenchidos nos 30 cadastros com agendamento, mas o label
está vazio em 100%. Provavelmente ficou faltando o mesmo passo que o `training_at`
tinha na rodada anterior.

**2. `phone_number` não cobre justamente o grupo que a gente precisava.** Ele veio
preenchido em 237 dos 525, mas fomos conferir as **47 lojas atribuídas à Track para
as quais não temos nenhum contato** — os 47 CNPJs estão no portal e **nenhum** tem
telefone. Ou seja: não é limitação da API, é que esse dado não existe do lado de
vocês para essas lojas. Se houver outra fonte aí (o cadastro original, a proposta,
o que for), a gente resolve 47 lojas paradas de uma vez. Se não houver, tudo bem —
só queria confirmar para parar de procurar por esse caminho.

**3. O motivo da reprovação continua sendo o nosso maior ponto cego** — é o único
pedido da lista anterior que não veio, e é o que a gente não consegue contornar
sozinho. Recapitulando o número: temos **25 lojas com `pre_cadastro_status =
not_approved`** e **todas as 25** estão com `cnpj_check_status = valid` e
`cnpj_situacao = ATIVA`. Então a checagem de CNPJ, que ficou muito boa, não explica
nenhuma dessas reprovações.

Quando o lojista pergunta "por que fui reprovado?", a gente não tem o que responder.
Não precisa ser o parecer da análise: um campo de categoria já resolve
(`rejection_reason: "restricao_socio" | "perfil_nao_atendido" | "documentacao" | …`),
com um texto livre opcional. Com isso a gente para de abrir chamado caso a caso e
consegue dizer ao lojista se vale corrigir algo e voltar.

**O pedido novo: um endpoint da AGENDA das turmas** (o equivalente da tabela
`training_sessions`: data/hora, código do Meet e label de cada turma). Hoje o
`training_at` nos diz em qual turma cada loja está inscrita — ótimo —, mas não quais
turmas existem. A agenda é o que alimenta a mensagem automática de treinamento, o kit
que o lojista recebe e as respostas da nossa assistente quando ele pergunta "quando é
o próximo treinamento?".

Isso é mais importante do que parece: quando vocês mudaram os dias em 16/09, a gente
só não mandou data errada para os lojistas porque tínhamos acesso a essa tabela. Com
ela na API, o fluxo de treinamento inteiro para de depender de login com senha.

Na mesma linha, se um dia der para expor `login_sends` (quando o acesso foi pedido e
quando a senha saiu) e `retailer_performance`, a gente encerra de vez o uso da senha
do portal — hoje são os dois últimos pontos.

Sobre volume: consultamos o `/onboardings` a cada 15 minutos, cerca de 200 chamadas
por dia, bem dentro do limite de 5.000. Vimos também o endpoint de remover/restaurar
cadastro; ainda não usamos, e quando formos usar eu te aviso antes.

Abraço,
Aldo
