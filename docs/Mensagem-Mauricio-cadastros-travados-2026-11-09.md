# Mensagem para o Mauricio (AIVA) — 09/11/2026

> Motivo: 577 cadastros da Track que a AIVA aceitou e que nunca viraram loja — 527
> deles parados em `dados_varejo`. É a maior perda da operação e não tem nada a ver
> com comissão: é cadastro que não anda.
> Números lidos ao vivo da API de onboardings do parceiro em 09/11/2026
> (997 onboardings da Track; 385 com retailer ID).
> Planilha de apoio: `docs/Track-x-portal-AIVA-reconciliacao-2026-11-09.xlsx`
> (aba "Todas as lojas", filtrar Degrau = "2. cadastro aberto, loja NÃO criada").
>
> Obs.: o pedido de acesso ao desempenho (login por e-mail/senha desligado) já foi
> feito ao Mauricio em separado — por isso não entra aqui.

---

Mauricio, tudo bem?

Fizemos uma medição da nossa base inteira contra o portal e chegamos num número que
queria discutir com você, porque ele é grande demais para ser normal.

**Mandamos 1.041 CNPJs. A AIVA abriu cadastro para 954. Viraram loja 385.**

Sobram **577 cadastros que vocês aceitaram e que nunca viraram loja**. Onde eles estão
hoje, pela API:

| onde está | quantos |
|---|---|
| `dados_varejo` (formulário do varejo) | **527** |
| `biometria_pendente` | 36 |
| `not_approved` | 11 |
| `pre_cadastro` | 2 |
| `cadastro_finalizado` (sem retailer ID) | 1 |

Complementando: **541 estão com `formulario_status: pending`** e **570 com biometria
pendente** (7 negadas). A idade mediana do cadastro é de **37 dias**, o mais antigo tem
72 dias, e nenhum passa de 90 — o que bate com aquele corte de `created_at` que a gente
comentou em outubro (nada antes de 28/08).

Ou seja: o gargalo é um só, e é o **formulário do varejo**. 527 lojistas passaram na
whitelist, receberam o acesso e pararam ali.

**O que eu precisava de você:**

**1. O que o lojista vê quando trava nessa etapa?** A gente cobra esses 527 pelo
WhatsApp, mas cobra no escuro — não sabemos em que campo ele para, se o link expira,
se dá erro em algum documento. Se vocês tiverem qualquer visão de onde o preenchimento
morre, isso muda a nossa cobrança de genérica para específica.

**2. Tem expiração?** Cadastro aprovado que passa de X dias sem formulário sai da
coluna, vira `not_approved`, ou fica ali para sempre? Precisamos saber se estamos
cobrando gente que já perdeu a vaga.

**3. Dá para reabrir ou reenviar o link de formulário em lote?** Se existir um jeito de
vocês dispararem de novo para esses 527, a gente combina o texto e faz a cobrança junto,
no mesmo dia, em vez de um a um.

**4. Os 11 `not_approved` — qual o motivo?** Se for recusa definitiva, a gente tira do
funil e para de insistir com o lojista. Hoje eles continuam na nossa fila.

**5. As 7 biometrias negadas reabrem?** Essa é a mesma pergunta que ficou em aberto da
outra vez: se o link reabre, a gente liga o aviso automático para o lojista; se não
reabre, a gente precisa saber para não prometer o que não existe.

**6. Ainda sobre a data real.** Continua valendo o que conversamos em 19/10: o
`created_at` do onboarding parece ser a data da linha no portal, não a data em que o
lojista ficou pendente. Com 527 cobranças para fazer, ter a data certa muda a
priorização inteira — a gente ataca primeiro quem está parado há mais tempo, e hoje não
sabe quem é.

Se preferir, marco 20 minutos e a gente passa a lista junto na tela.

Obrigado!
