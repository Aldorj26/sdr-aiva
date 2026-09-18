# Mensagem para o Mauricio (AIVA) — reenvio de senha · 18/09/2026

> Segunda mensagem do dia, depois da que tratou da API de onboardings.
> Números conferidos no portal agora: 134 retailers em `login_sends`,
> 113 com `credentials_sent_at` preenchido, 26 pendentes, o mais antigo de 19/08.

---

Mauricio, de novo eu — esse é outro assunto, bem mais curto.

Hoje o caso mais comum que chega pra gente depois do treinamento é o lojista dizendo
"não recebi a senha". Fomos olhar o que dá pra fazer e esbarramos em duas coisas.

**1. A gente não tem como reenviar.** Quem reenvia é quem tem o painel — o botão
"Reenviar senha" no card do lojista. A API pública só permite escrita pra remover e
restaurar cadastro. Então todo "não recebi" vira tarefa manual do nosso time, mesmo
quando a resposta é simplesmente apertar o botão.

Se der pra expor isso como endpoint (`POST /onboardings/{id}/resend-credentials`, ou
o nome que fizer sentido aí), a gente resolve na hora, na própria conversa do
WhatsApp, sem fila humana no meio. Se preferir limitar — uma vez por loja por dia,
por exemplo — pra nós está ótimo.

**2. O botão aparece mesmo quando a senha nunca foi criada.** Esse é o que me
preocupa mais, porque atrapalha vocês também. Exemplo: a BUSSIS STORE (RID 5126) tem
o botão "Reenviar senha" no card e o `credentials_sent_at` dela está nulo desde
27/08 — nunca saiu nada. Quem opera o painel aperta o botão achando que reenviou, e
o lojista continua sem acesso, sem ninguém perceber. Se o botão só aparecesse quando
existe senha enviada (ou tivesse um rótulo diferente pro outro caso), esse erro
sumiria.

Do nosso lado a gente já contornou lendo `login_sends.credentials_sent_at` direto —
com isso a nossa assistente parou de tratar os dois casos igual: se a senha saiu, ela
pede pro lojista procurar a mensagem do 4020-2024; se não saiu, ela não manda ele
caçar mensagem que não existe. Mas isso depende de login com senha no portal, que é
justamente o que a gente está tentando aposentar — daí o pedido do `login_sends` na
API, que já tinha citado na mensagem anterior. Agora ele tem um uso concreto: é o
dado que separa "esperar a AIVA" de "reenviar".

**Sobre os 26 pendentes.** Continuam parados e alguns são antigos: o mais velho é a
P DE S POTER ASSISTÊNCIA TÉCNICA (RID 6178), que pediu acesso em **19/08** — quase um
mês. Em seguida vêm a M A COMÉRCIO DE ELETRÔNICOS (RID 6175) e a FEEL X (RID 6104),
as duas de 21/08. São lojas aprovadas e treinadas que não conseguem vender. Se ajudar,
eu mando a lista completa dos 26 com CNPJ e data do pedido.

Abraço,
Aldo
