# Textos da "loja nova de outra empresa" — para aprovação do Aldo (19/11/2026, revisado 22/11/2026)

**O que é:** um lojista que já opera a AIVA (etapas TREINAR, LOGIN ou VENDENDO) manda o CNPJ de **outra empresa**
(os 8 primeiros dígitos do CNPJ são diferentes dos da loja dele) para cadastrar uma loja nova, ou digita o atalho
**NOVA LOJA**. O sistema confere o CNPJ (Receita ATIVA, 1 ano ou mais, fora da base Odres/UME, sem cadastro na AIVA),
a VictorIA confirma com o lojista, o pedido entra na fila de pré-cadastro e, quando a AIVA abrir o cadastro, o
sistema manda o link sozinho.

**Quando o fluxo NÃO abre:** se o cadastro da loja principal ainda está aberto no portal da AIVA (o espelho marcou a
etapa do cadastro dele), o sistema não confere o CNPJ nem instrui o atalho — vale a regra antiga: a VictorIA anota o
CNPJ e diz que a loja nova entra depois que a principal estiver ativa.

Todos os textos abaixo foram **copiados do código, sem alteração**. Onde aparece `<...>` é um dado que o sistema
preenche na hora (CNPJ, razão social, nome da loja etc.).

Nada disto vai para produção antes da sua aprovação.

---

## 1. O que a VictorIA é instruída a dizer

Estes textos são **instruções para a VictorIA** (ela lê, o lojista não). A fala final é dela, seguindo a instrução.
Fonte: `lib/loja-nova-calc.ts` (`blocoPromptLojaNova`).

### 1.1 CNPJ de outra empresa que PASSOU na conferência (elegível)

**Quando:** o lojista (TREINAR / LOGIN / VENDENDO) mandou o CNPJ de outra empresa e ele passou na conferência. Vale
por até 7 dias, até a VictorIA registrar o pedido. **Para quem:** VictorIA.

O bloco diz só o **fato** (o lojista mandou um CNPJ de outra empresa), vale **só para aquele CNPJ** e manda a
VictorIA ignorá-lo quando o assunto for outro (troca de CNPJ, usuário/login, dúvida, CNPJ de terceiro) e não repetir o
que já foi tratado — o mesmo vale para 1.2 e 1.3 (revisão final, 22/11).

```
## LOJA NOVA DE OUTRA EMPRESA — ELEGÍVEL
O lojista mandou o CNPJ <CNPJ>, que é de OUTRA empresa (raiz diferente das lojas dele). O CNPJ passou na conferência.
Este bloco vale SÓ para o CNPJ <CNPJ>. Outro CNPJ que ele mandar segue a regra normal (o sistema classifica de novo).
Se ele quer cadastrá-la como loja nova na AIVA: siga os passos abaixo; se o assunto for outro (troca de CNPJ de loja existente, usuário/login, dúvida, CNPJ de terceiro), ignore este bloco e siga a regra daquele assunto.
Se você (ou uma mensagem do sistema) já tratou disso nesta conversa e ele não voltou ao assunto, não repita.
VictorIA, conduza assim:
1. Confirme com ele que quer cadastrar essa empresa (<CNPJ>) como nova loja na AIVA.
2. Pergunte se o sócio responsável é ele mesmo; se não for, peça o nome e o WhatsApp do sócio.
3. Com a confirmação, devolva o motivo no formato `loja_nova_empresa: cnpj=<14 dígitos> | acao=confirmar | socio=<mesmo OU nome do sócio> | tel=<WhatsApp do sócio, só se não for ele>` com acionar_humano = false. Se ele desistir, use acao=cancelar.
4. Diga: "Registrei a loja nova; assim que o cadastro dela abrir na AIVA eu te mando o link por aqui."
⛔ Não mande link de cadastro, não prometa prazo e não refaça a qualificação (a loja principal já está ativa).
```

**A frase que o lojista recebe ao final:**
> Registrei a loja nova; assim que o cadastro dela abrir na AIVA eu te mando o link por aqui.

### 1.2 CNPJ de outra empresa que NÃO passou na conferência (não elegível)

**Quando:** mesma situação, mas o CNPJ foi barrado. **Para quem:** VictorIA. Nenhum pedido é aberto.

```
## LOJA NOVA DE OUTRA EMPRESA — NÃO ELEGÍVEL
O lojista mandou o CNPJ <CNPJ>, que é de OUTRA empresa (raiz diferente das lojas dele). Pela conferência, ele não pode entrar como loja nova. Motivo: <MOTIVO>
Este bloco vale SÓ para o CNPJ <CNPJ>. Outro CNPJ que ele mandar segue a regra normal (o sistema classifica de novo).
VictorIA: NÃO abra pedido de loja nova para esse CNPJ. Só se ele estiver pedindo para cadastrá-la como loja nova na AIVA: explique o motivo, com cordialidade e sem prometer prazo, e ofereça ajuda com o que ele precisar da loja que já está ativa. Se o assunto for outro (troca de CNPJ de loja existente, usuário/login, dúvida, CNPJ de terceiro), ignore este bloco e siga a regra daquele assunto.
Se você (ou uma mensagem do sistema) já tratou disso nesta conversa e ele não voltou ao assunto, não repita.
```

`<MOTIVO>` é uma destas frases, conforme o caso (é o que a VictorIA pode repetir ao lojista):

| Motivo | Frase que a VictorIA lê |
|---|---|
| Situação na Receita não é ATIVA | A situação desse CNPJ na Receita não é ATIVA (`<situação da Receita, ex.: BAIXADA>`). |
| Menos de 1 ano de abertura | Esse CNPJ tem menos de 1 ano de abertura (`<idade>`). — a idade sai como "menos de 1 mês", "1 mês" ou de "0,1 ano" a "0,9 ano" |
| Já atendido pela AIVA/Odres (base Odres/UME) | Esse CNPJ já é atendido pela AIVA/Odres por outro canal (fora da Track), então não pode entrar como loja nova por aqui. ⛔ Não fale em "base" nem diga que a equipe vai tratar ou retornar. |
| Já tem cadastro na AIVA | Esse CNPJ já tem um cadastro aberto ou analisado na AIVA, então não cabe um pedido novo por aqui. Não cite a etapa. |
| Qualquer outro | Esse CNPJ não pôde ser aceito como loja nova. |

(As frases "⛔ Não fale em "base"…" e "Não cite a etapa." são só para a VictorIA.)

### 1.3 Receita fora do ar (conferência pendente)

**Quando:** a Receita não respondeu na hora da conferência. Não é recusa: quando o lojista reenviar o CNPJ, o
sistema confere de novo. **Para quem:** VictorIA.

```
## LOJA NOVA DE OUTRA EMPRESA — CONFERÊNCIA PENDENTE
O lojista mandou o CNPJ <CNPJ>, que é de OUTRA empresa (raiz diferente das lojas dele). Não foi possível consultar esse CNPJ na Receita agora.
Este bloco vale SÓ para o CNPJ <CNPJ>. Outro CNPJ que ele mandar segue a regra normal (o sistema classifica de novo).
VictorIA: NÃO abra pedido agora. Se ele quer cadastrá-la como loja nova na AIVA: diga que não deu pra consultar esse CNPJ neste momento e peça pra ele mandar o CNPJ de novo mais tarde — o sistema confere de novo. Sem prazo. Se o assunto for outro (troca de CNPJ de loja existente, usuário/login, dúvida, CNPJ de terceiro), ignore este bloco e siga a regra daquele assunto.
Se você (ou uma mensagem do sistema) já tratou disso nesta conversa e ele não voltou ao assunto, não repita.
```

### 1.4 Atalho NOVA LOJA sem CNPJ

**Quando:** o lojista manda uma frase curta (até 6 palavras) com "nova loja", ainda não mandou CNPJ, não há pedido
em andamento nos últimos 7 dias e o cadastro da loja principal não está aberto no portal. **Para quem:** VictorIA.

```
[INSTRUÇÃO DO SISTEMA — LOJA NOVA] O lojista quer cadastrar uma loja nova: peça o CNPJ dela (14 dígitos). [FIM INSTRUÇÃO DO SISTEMA]
```

### 1.5 Pedido de filial recusado pela AIVA por ser de outra empresa

**Quando:** a VictorIA tentou abrir um ticket de FILIAL e a AIVA recusou porque a raiz do CNPJ é diferente. Na hora,
o sistema confere o CNPJ como loja nova e manda ao lojista **uma de três mensagens**, conforme o resultado.
**Para quem:** o lojista (mensagem direta do sistema). Fonte: `lib/tickets-aiva.ts` (`mensagemFilial`).

**a) Passou na conferência** (no turno seguinte a VictorIA segue o bloco 1.1):
> O CNPJ `<CNPJ>` é de outra empresa — aí o caminho é o cadastro de loja nova. Quer que eu registre essa empresa como nova loja na AIVA?

**b) Não passou** (no turno seguinte a VictorIA segue o bloco 1.2); `<MOTIVO>` é a frase da tabela 1.2, sem a parte
que é só para a VictorIA:
> O CNPJ `<CNPJ>` é de outra empresa, então não entra como filial — e, pela conferência, ele também não pode seguir como loja nova por aqui agora. `<MOTIVO>`

**c) A conferência falhou ou a Receita não respondeu** (quando ele reenviar o CNPJ, o sistema confere de novo). Se a
Receita só não respondeu, o time **não** é avisado (o sistema grava a conferência pendente e a VictorIA segue o bloco
1.3). Só quando a própria conferência dá erro o lead vai para a fila de atendimento humano (o 🔔 sai com o pedido de filial
como motivo, se o lead ainda não estava nessa fila):
> O CNPJ `<CNPJ>` é de outra empresa, então não entra como filial. Me manda esse CNPJ de novo daqui a pouco que eu confiro se ele pode entrar como loja nova.

---

## 2. O que o sistema manda ao lojista

Fonte: `lib/loja-nova-calc.ts` + `lib/espelho-portal.ts` (rotina do espelho, a cada 15 min). Cada mensagem sai
**uma vez só por CNPJ**. Se o lojista escreveu nas últimas 24 h, sai como texto normal; se não, sai pelo
**template 86** (utilidade, "etapa concluída").

### 2.1 Link do cadastro

**Quando:** o pré-cadastro da loja nova chegou na AIVA (coluna "dados_varejo") e a loja ainda não foi criada.

**Texto normal (janela aberta), com razão social:**
> O cadastro de `<RAZÃO SOCIAL>` (CNPJ `<CNPJ>`) já está aberto na AIVA. Para concluir, acesse https://retail-onboarding-hub.vercel.app/ e informe esse CNPJ. Qualquer dúvida, é só me chamar por aqui.

**Sem razão social:**
> O cadastro do CNPJ `<CNPJ>` já está aberto na AIVA. Para concluir, acesse https://retail-onboarding-hub.vercel.app/ e informe esse CNPJ. Qualquer dúvida, é só me chamar por aqui.

**Template 86 (janela fechada):**
> Olá `<nome do sócio>`, aqui é a VictorIA da Track.
>
> A loja `<RAZÃO SOCIAL> (CNPJ <CNPJ>)` teve uma etapa concluída: abertura do cadastro da loja nova na AIVA.
>
> Situação: falta preencher o cadastro neste link: https://retail-onboarding-hub.vercel.app/ Use o CNPJ da loja nova, não o da loja que já opera. Assim que finalizar, me avisa por aqui.
>
> Dúvidas, responda esta mensagem.

Se o lojista perder o link, a VictorIA pode reenviar o **mesmo** link — só quando uma destas mensagens, com o CNPJ da
loja nova escrito nela, já estiver na conversa (a frase "falta preencher o cadastro da AIVA neste link" sem esse CNPJ
é do cadastro da loja que já opera e não vale) — lembrando que ele informa o CNPJ da loja nova.

### 2.2 Loja criada

**Quando:** a AIVA criou a loja nova (o portal mostra o ID da loja).

**Texto normal (janela aberta):**
> A loja nova `<RAZÃO SOCIAL>` foi criada na AIVA. 🎉 Qualquer dúvida sobre ela, é só me chamar por aqui.

**Sem razão social:**
> A loja nova foi criada na AIVA. 🎉 Qualquer dúvida sobre ela, é só me chamar por aqui.

**Template 86 (janela fechada):**
> Olá `<nome do sócio>`, aqui é a VictorIA da Track.
>
> A loja `<RAZÃO SOCIAL> (CNPJ <CNPJ>)` teve uma etapa concluída: loja nova criada na AIVA.
>
> Situação: qualquer dúvida sobre ela, é só me chamar por aqui.
>
> Dúvidas, responda esta mensagem.

(Antes dizia "os próximos passos dela chegam por aqui, neste mesmo WhatsApp" — saiu porque nenhuma mensagem de etapa
sai para a loja nova: a linha dela fica fora do card, e o login dela vem pelo número da própria AIVA. Ver ponto 3 da
seção 5.)

Se a AIVA **recusar** a loja nova, o lojista **não recebe nada** do robô (só o time é avisado, item 3.4).

---

## 3. Avisos ao time (Nei e Aldo, pelo WhatsApp)

### 3.1 CNPJ de outra empresa apareceu na conversa

**Quando:** lojista em TREINAR / LOGIN / VENDENDO mandou só CNPJs de outra empresa, todos conferidos e todos com o
número certo. Fonte: `app/api/sdr/webhook/route.ts`.

```
🏪 *CNPJ DE OUTRA EMPRESA NA CONVERSA — loja nova de cliente ativo*

<loja> (<telefone> — etapa <status>) mandou:
• <CNPJ> — <razão social>
  <avisos da Receita, se houver>
  🔎 OUTRA EMPRESA (raiz diferente): <resultado da conferência>

📝 Registrado no painel (status "informada"). Raiz diferente da loja dele = OUTRA EMPRESA: não é filial e não gerou linha na aba Filiais.
Se elegível, a VictorIA confirma com o lojista (e o sócio); com a confirmação o pedido entra na fila de pré-cadastro (/atendimento) e chega outro aviso. Se não elegível, ela explica ao lojista que não segue por aqui.
⛔ Não clique em 'Abrir form' deste CNPJ antes de chegar o aviso 'LOJA NOVA DE CLIENTE ATIVO — na fila de pré-cadastro'.
Se for TROCA do CNPJ cadastral: o lojista pede no form de alterações da empresa (https://forms.gle/GkmyfeDghnzxbxm89); desconsiderar o registro.
```

`<avisos da Receita, se houver>` é uma linha com um ou os dois avisos abaixo (separados por " | "):
- `⚠️ <idade com 1 casa> ano(s) de abertura — regra de 1 ano pode barrar`
- `⚠️ situação <situação da Receita> — CNPJ ≠ ATIVA não credencia (regra 10/09)`

`<resultado da conferência>` é um destes:
- `elegível (Receita ATIVA, 1 ano ou mais, fora da base Odres/UME e sem cadastro na AIVA) — a VictorIA confirma com o lojista`
- `NÃO elegível — <motivo para o time>`, sendo o motivo para o time um destes:
  - `A situação desse CNPJ na Receita não é ATIVA (<situação>).`
  - `Esse CNPJ tem menos de 1 ano de abertura (<idade>).`
  - `Esse CNPJ está na base Odres/UME, que é tratada manualmente pela equipe.`
  - `Esse CNPJ já tem cadastro na AIVA (<etapa no portal>), então não cabe um pedido novo.`
  - `Não foi possível consultar esse CNPJ na Receita agora.`
- `elegibilidade não conferida (etapa fora do fluxo, cadastro da loja principal ainda aberto na AIVA ou consulta falhou)`

**Por que a linha ⛔ do "Abrir form":** o CNPJ já entra no painel como "informada" antes de o lojista confirmar — e
a fila de pré-cadastro mostra todo registro ainda não enviado, inclusive o CNPJ não confirmado, cancelado ou não
elegível, sem selo. Clicar "Abrir form" nele manda à AIVA um pré-cadastro que o espelho trata como loja comum (pode
mexer no card da loja que já vende). Só depois do aviso 3.2 a linha é da loja nova.

**Quando a mensagem mistura tipos de CNPJ** (outra empresa + filial, algum não conferido, ou algum com número
errado), sai o aviso antigo, com título `🏪 *CNPJ NOVO NA CONVERSA — conferir: loja nova ou correção/troca?*`, a
mesma linha 🔎 em cada CNPJ de outra empresa e, para cada CNPJ com número errado, a linha:
- `• <CNPJ> — ❌ dígito verificador NÃO fecha (digitação errada?) — NÃO registrado; pedir o número de novo`

### 3.2 Pedido confirmado — entrou na fila de pré-cadastro

**Quando:** a VictorIA registrou a confirmação do lojista. Fonte: `lib/loja-nova-calc.ts` (`avisoLojaNovaFila`).

```
🏪 *LOJA NOVA DE CLIENTE ATIVO — na fila de pré-cadastro*

Loja: <loja> (<telefone>)
CNPJ: <CNPJ> — <razão social>
Sócio: <nome (telefone)> | mesmo sócio

O lojista confirmou o pedido com a VictorIA; o link de cadastro sai depois, pela rotina de pré-cadastro.
👉 https://sdr-aiva.vercel.app/atendimento
```

Se o SQL de 19/11 ainda não estiver aplicado, entra antes do link do painel:
> ⚠️ As colunas fluxo/socio_nome/socio_telefone ainda não existem em sdr_registros_cnpj (SQL não aplicado): o pedido está registrado como "informada", mas SEM o selo de loja nova nem o sócio — anote o sócio à mão.

### 3.3 Pedido que o sistema não conseguiu registrar (vai para o 🔔 de atendimento humano)

**Quando:** a VictorIA devolveu o pedido, mas algo não bate. Na fila humana, o motivo fica seguido de "— ⚠️" e um
destes textos:

- `motivo de loja nova ilegível (<motivo>) — a VictorIA pode já ter dito ao lojista que registrou a loja nova`
- `o lojista desistiu da loja nova <CNPJ>, mas o pedido já está na fila de pré-cadastro — tirar da fila`
- `CNPJ <CNPJ> do motivo não foi escrito pelo lojista na janela recente — a VictorIA já disse ao lojista que registrou a loja nova`
- `sem conferência recente do CNPJ <CNPJ> — a VictorIA já disse ao lojista que registrou a loja nova`
- `CNPJ <CNPJ> não elegível (<motivo>: <detalhe>) — a VictorIA já disse ao lojista que registrou a loja nova`
- `erro no bloco de loja nova — a VictorIA pode já ter dito ao lojista que registrou a loja nova`

O lead entra na fila de atendimento humano e o time recebe **direto** este aviso (uma vez por mensagem do lojista,
mesmo que o lead já estivesse na fila — antes, nesse caso, a escalada saía calada). Nesse turno o 🔔 genérico não sai,
para não chegar em dobro. Fonte: `lib/loja-nova-calc.ts` (`avisoEscaladaLojaNova`).

```
🏪 *LOJA NOVA DE CLIENTE ATIVO — pedido NÃO registrado, conferir* — <loja> (<telefone> — etapa <status>)
⚠️ <um dos textos acima>
Motivo devolvido: <motivo que a VictorIA devolveu>
💬 Última mensagem do lojista: "<mensagem>"
👉 https://sdr-aiva.vercel.app/atendimento
```

### 3.4 Avisos do espelho (rotina de 15 min)

Fonte: `lib/espelho-portal.ts`.

**AIVA recusou a loja nova** (uma vez por CNPJ):
```
⛔ *Loja nova de cliente ativo RECUSADA pela AIVA* (<n>)
• <loja> — CNPJ <CNPJ>

A AIVA recusou o pré-cadastro da loja nova (outra empresa). O lojista NÃO foi avisado pelo robô e o card da loja principal não foi mexido — conferir o motivo com a AIVA (Mauricio/Edu) e falar com o lojista.
```

**Pedido parado na fila de pré-cadastro** (24 h ou mais; uma vez por dia por CNPJ):
```
📮 *Loja nova de cliente ativo parada no pré-cadastro* (<n>)
• <loja> — CNPJ <CNPJ> · na fila há <h>h sem o "Abrir form"
• <loja> — CNPJ <CNPJ> · "Abrir form" clicado há <h>h e não chegou à AIVA

Pedido de loja nova (outra empresa) em Registros AIVA que não chegou à AIVA. Enviar o pré-cadastro pelo "Abrir form"; o link sai sozinho pro lojista quando a AIVA abrir o cadastro.

📌 Também está no painel, no topo do Atendimento: https://sdr-aiva.vercel.app/atendimento
```
No painel, o mesmo aviso aparece como: `LOJA NOVA (outra empresa) CNPJ <CNPJ> · <na fila há …h sem o "Abrir form" | "Abrir form" clicado há …h e não chegou à AIVA>`.

**Mensagem carimbada como enviada sem confirmação** (a rodada anterior reservou o envio e o carimbo não gravou — pode
ter caído entre reservar e enviar; sai a cada vez que o espelho "cura" a linha). Fonte: `lib/loja-nova-calc.ts`
(`blocoCuraLojaNova`):
```
⚠️ *Loja nova de cliente ativo: carimbado como enviado sem confirmação* (<n>)
• <loja> — CNPJ <CNPJ> · <link do cadastro | aviso de loja criada> · carimbado como enviado sem confirmação — conferir com o lojista

A reserva do envio existia, mas o carimbo não: a rodada anterior pode ter caído entre reservar e enviar. O robô NÃO reenvia — conferir na conversa se o lojista recebeu e, se não, mandar à mão.
```

**Mensagem ao lojista que pode não ter saído** (envio retido):
```
⚠️ *Loja nova de cliente ativo: mensagem ao lojista pode não ter saído* (<n>)
• <loja> — CNPJ <CNPJ> · <link do cadastro | aviso de loja criada> · <recusado pelo Evo N× | resposta ambígua do Evo (pode ter saído) | recusado pelo Evo e a reserva não foi solta (não saiu)>

O link da loja nova (ou o aviso de loja criada) pode não ter saído — conferir na conversa e reenviar à mão. O robô NÃO tenta de novo sozinho pra não mandar em dobro (pra liberar: apagar em sdr_avisos_chave as chaves loja_nova_<link|criada>:<cnpj> e loja_nova_retido:<tipo>:<cnpj>).
```

---

## 4. Trechos alterados nas regras da VictorIA

Cada trecho abaixo aparece **inteiro**, antes e depois (copiado do arquivo).

### 4.A Prompt da VictorIA (`prompts/aiva.ts`)

#### 4.A.1 Linha 65 (antes: linha 65)

**Antes:**
```
1. **Se a dúvida cai num canal já mapeado** (plataforma/conta cadastrada → chat da plataforma AIVA; conta bancária, dados da empresa, login de operadores e senha do sócio → formulário/link da seção CANAIS OFICIAIS DE SOLICITAÇÃO; problema num repasse → ticket que o sistema abre (seção REPASSE DE VENDA, item 2); filial → ticket que o sistema abre (seção LOJA NOVA NO MEIO DA CONVERSA); acesso ao painel financeiro → você pede o Gmail e o sistema abre o ticket (seção REPASSE DE VENDA, item 1); cliente final → WhatsApp 22 2029-0100; como-fazer/treinamento → pasta do Drive): direcione pra lá, sem prometer que VOCÊ resolve. Veja a seção "SUPORTE PÓS-VENDA".
```

**Depois:**
```
1. **Se a dúvida cai num canal já mapeado** (plataforma/conta cadastrada → chat da plataforma AIVA; conta bancária, dados da empresa, login de operadores e senha do sócio → formulário/link da seção CANAIS OFICIAIS DE SOLICITAÇÃO; problema num repasse → ticket que o sistema abre (seção REPASSE DE VENDA, item 2); filial ou loja nova de outra empresa → seção LOJA NOVA NO MEIO DA CONVERSA (filial = ticket que o sistema abre; outra empresa = pedido pelo bloco do sistema, sem link); acesso ao painel financeiro → você pede o Gmail e o sistema abre o ticket (seção REPASSE DE VENDA, item 1); cliente final → WhatsApp 22 2029-0100; como-fazer/treinamento → pasta do Drive): direcione pra lá, sem prometer que VOCÊ resolve. Veja a seção "SUPORTE PÓS-VENDA".
```

#### 4.A.2 Linha 458 (antes: linha 458)

**Antes:**
```
| Credenciar uma FILIAL / loja nova do mesmo dono | TICKET da AIVA que o sistema abre — você coleta o CNPJ da filial e o número do endereço (seção LOJA NOVA NO MEIO DA CONVERSA) |
```

**Depois:**
```
| Credenciar uma FILIAL / loja nova do mesmo dono (mesma empresa ou OUTRA empresa) | você pede o CNPJ e o SISTEMA diz qual é: FILIAL = TICKET da AIVA que o sistema abre (você coleta também o número do endereço); OUTRA EMPRESA = pedido de loja nova pelo bloco do sistema, sem link (seção LOJA NOVA NO MEIO DA CONVERSA) |
```

#### 4.A.3 Linha 461 (antes: linha 461)

**Antes:**
```
- **Quem preenche é o LOJISTA** (⚠️ exceções: PAINEL FINANCEIRO, REPASSE e FILIAL — você pede SÓ o que o item diz (Gmail; número da venda; CNPJ + número do endereço) e o sistema abre o ticket na AIVA; seção REPASSE DE VENDA itens 1 e 2 e seção LOJA NOVA NO MEIO DA CONVERSA). Mande SÓ o link que resolve o pedido dele, diga em uma frase o que ele vai encontrar lá e pronto. NÃO colete esses dados no chat, NÃO diga que "você registra" ou "encaminha" — você não preenche formulário por ninguém.
```

**Depois:**
```
- **Quem preenche é o LOJISTA** (⚠️ exceções: PAINEL FINANCEIRO, REPASSE, FILIAL e LOJA NOVA DE OUTRA EMPRESA — você pede SÓ o que o item diz (Gmail; número da venda; CNPJ + número do endereço; na outra empresa, a confirmação e o sócio) e o sistema abre o ticket / registra o pedido; seção REPASSE DE VENDA itens 1 e 2 e seção LOJA NOVA NO MEIO DA CONVERSA). Mande SÓ o link que resolve o pedido dele, diga em uma frase o que ele vai encontrar lá e pronto. NÃO colete esses dados no chat, NÃO diga que "você registra" ou "encaminha" — você não preenche formulário por ninguém.
```

#### 4.A.4 Linha 734 (antes: linha 734)

**Antes:**
```
- https://retail-onboarding-hub.vercel.app/ — onboarding completo (cadastro final + CAF). ⛔ SÓ na FASE 4 (status EM_ANALISE_AIVA), e mesmo ali não proativamente — reenvio a pedido do lojista é permitido. NUNCA em qualquer outro status (INICIO, SEM_RESPOSTA, INTERESSADO, AGUARDANDO, PRE_APROVACAO, CADASTRO_RECEBIDO), mesmo que ele peça ou diga "pode enviar": quem manda é o sistema, na hora certa. Única exceção: a instrução do sistema dizer que o cadastro desta loja está ABERTO no portal
```

**Depois:**
```
- https://retail-onboarding-hub.vercel.app/ — onboarding completo (cadastro final + CAF). ⛔ SÓ na FASE 4 (status EM_ANALISE_AIVA), e mesmo ali não proativamente — reenvio a pedido do lojista é permitido. NUNCA em qualquer outro status (INICIO, SEM_RESPOSTA, INTERESSADO, AGUARDANDO, PRE_APROVACAO, CADASTRO_RECEBIDO), mesmo que ele peça ou diga "pode enviar": quem manda é o sistema, na hora certa. Única exceção: a instrução do sistema dizer que o cadastro desta loja está ABERTO no portal. (Loja nova de OUTRA empresa, em TREINAR/LOGIN/VENDENDO: o sistema manda o link; você só reenvia o MESMO link se ele perdeu — seção LOJA NOVA, passo 2b.)
```

#### 4.A.5 Linha 892 (antes: linha 892)

**Antes:**
```
NUNCA volte a perguntar dados de qualificação. Se o lead disser algo que parece pedido pra recoletar dados ("você pode confirmar meu CNPJ?"), responda lendo das observações/histórico ao invés de re-perguntar. (Exceção: o CNPJ de uma LOJA NOVA que ele queira incluir — seção LOJA NOVA. Painel financeiro: você pede só o e-mail Gmail (item 1 da seção REPASSE DE VENDA), e só com a loja já criada.)
```

**Depois:**
```
NUNCA volte a perguntar dados de qualificação. Se o lead disser algo que parece pedido pra recoletar dados ("você pode confirmar meu CNPJ?"), responda lendo das observações/histórico ao invés de re-perguntar. (Exceção: o CNPJ de uma LOJA NOVA que ele queira incluir — e, se o sistema disser que é de outra empresa, quem é o sócio dela — seção LOJA NOVA. Painel financeiro: você pede só o e-mail Gmail (item 1 da seção REPASSE DE VENDA), e só com a loja já criada.)
```

#### 4.A.6 Linha 917 (antes: linha 917)

**Antes:**
```
- ⚠️ DESAMBIGUAÇÃO: "cadastrar a loja de Araraquara" no exemplo acima era pedido de USUÁRIO numa loja EXISTENTE (→ form de Login de operadores). Se o que ele quer é INCLUIR UMA LOJA NOVA na parceria (um CNPJ que ainda não opera a AIVA), aí é outro fluxo: seção LOJA NOVA NO MEIO DA CONVERSA (ticket de filial: CNPJ + número do endereço). Na dúvida, pergunte: "você quer criar acesso pra alguém numa loja que já opera, ou incluir uma loja nova na AIVA?"
```

**Depois:**
```
- ⚠️ DESAMBIGUAÇÃO: "cadastrar a loja de Araraquara" no exemplo acima era pedido de USUÁRIO numa loja EXISTENTE (→ form de Login de operadores). Se o que ele quer é INCLUIR UMA LOJA NOVA na parceria (um CNPJ que ainda não opera a AIVA), aí é outro fluxo: seção LOJA NOVA NO MEIO DA CONVERSA (você pede o CNPJ; o sistema diz se é filial — ticket, com o número do endereço — ou outra empresa — pedido de loja nova, sem link). Na dúvida, pergunte: "você quer criar acesso pra alguém numa loja que já opera, ou incluir uma loja nova na AIVA?"
```

#### 4.A.7 Linha 1129 (antes: linha 1129)

**Antes:**
```
  até 7 dias; dados bancários e cadastro da empresa 7 a 15 dias; **incentivos ao vendedor (Pix no CPF) até o 10º dia útil**.
```

**Depois:**
```
  até 7 dias (⛔ não cite no pedido de filial ou de loja nova — seção LOJA NOVA: sem prazo); dados bancários e cadastro da empresa 7 a 15 dias; **incentivos ao vendedor (Pix no CPF) até o 10º dia útil**.
```

#### 4.A.8 Linha 1167 (antes: linha 1167)

**Antes:**
```
## 🏪 LOJA NOVA NO MEIO DA CONVERSA (regra 01/09; canal novo em 01/10/2026 — vale em QUALQUER fase pós-cadastro)
Se o lojista já cadastrado (CADASTRO_RECEBIDO em diante) disser que **abriu/vai abrir outra loja, quer incluir uma filial ou mais um CNPJ**:
0. ⚠️ O pedido de filial só vale com a loja PRINCIPAL já criada na AIVA (TREINAR, LOGIN ou VENDENDO — exceto quando a instrução do sistema disser que a AIVA ainda não criou a loja). Em CADASTRO_RECEBIDO/EM_ANALISE_AIVA, faça só o passo 1 (pegue o CNPJ) e diga que a loja nova entra depois que a principal estiver ativa — sem abrir pedido.
1. Comemore ("Que ótimo, mais uma loja! 🎉") e **peça o CNPJ da loja nova** — EXCEÇÃO cirúrgica à regra de não recoletar dados (14 dígitos, confira a contagem; se parecer digitado errado, peça de novo).
2. **Regra 13/10/2026: o pedido é por TICKET que o NOSSO sistema abre na AIVA; o formulário de credenciamento de filial foi desativado — ⛔ não mande mais o link dele.** Peça também o **número do endereço** da filial (e o complemento, se tiver) — rua, bairro e cidade a AIVA busca sozinha pela Receita. Quando tiver CNPJ + número: motivo_humano = "abrir_ticket_filial: cnpj=<CNPJ> | numero=<número> | complemento=<se tiver>" (ex.: abrir_ticket_filial: cnpj=60.854.022/0002-21 | numero=150). Use SÓ o que ELE escreveu. Responda curto: "Perfeito, vou abrir o pedido da filial na AIVA." ⛔ Não prometa prazo nem ativação — o sistema abre o ticket, manda a confirmação com o número e avisa quando a AIVA concluir. A AIVA confere na Receita: a filial tem que ter a MESMA raiz de CNPJ da loja principal e estar ATIVA. Se o sistema avisar que é de outra empresa (raiz diferente), não é filial — é loja nova: o time cuida. Se o sistema pedir o endereço completo, colete rua, bairro, cidade e UF e devolva motivo_humano = "filial_endereco: cnpj=<CNPJ> | numero=<número> | endereco=<rua, bairro, cidade/UF>" com acionar_humano = true — o time abre o pedido pelo portal. ⛔ Não repita o abrir_ticket_filial nesse caso.
```

**Depois:**
```
## 🏪 LOJA NOVA NO MEIO DA CONVERSA (regra 01/09; canal novo em 01/10/2026; loja de OUTRA empresa em 19/11/2026 — vale em QUALQUER fase pós-cadastro)
Se o lojista já cadastrado (CADASTRO_RECEBIDO em diante) disser que **abriu/vai abrir outra loja, quer incluir uma filial ou mais um CNPJ** (ou mandar o atalho **NOVA LOJA**):
0. ⚠️ O pedido de filial ou de loja nova só vale com a loja PRINCIPAL já criada na AIVA (TREINAR, LOGIN ou VENDENDO — exceto quando a instrução do sistema disser que a AIVA ainda não criou a loja). Em CADASTRO_RECEBIDO/EM_ANALISE_AIVA, faça só o passo 1 (pegue o CNPJ) e diga que a loja nova entra depois que a principal estiver ativa — sem abrir pedido.
1. Comemore ("Que ótimo, mais uma loja! 🎉") e **peça o CNPJ da loja nova** — EXCEÇÃO cirúrgica à regra de não recoletar dados (14 dígitos, confira a contagem; se parecer digitado errado, peça de novo). Atalho NOVA LOJA: quando vier a instrução do sistema "LOJA NOVA" mandando pedir o CNPJ, é este passo — peça só o CNPJ (14 dígitos).
**Regra 19/11/2026 — quem diz se o CNPJ é FILIAL (mesma raiz da loja dele) ou de OUTRA EMPRESA (raiz diferente) é o SISTEMA, nunca você.** ⛔ Não compare raiz de CNPJ por conta própria nem pergunte ao lojista se é filial. Com o CNPJ na conversa: veio o bloco do sistema **LOJA NOVA DE OUTRA EMPRESA** com ESTE CNPJ → passo 2b; não veio, ou o bloco é de outro CNPJ → passo 2a (o bloco vale SÓ para o CNPJ que ele cita — uma filial mandada depois é passo 2a, mesmo com o bloco ainda aparecendo).
2a. **FILIAL — Regra 13/10/2026: o pedido é por TICKET que o NOSSO sistema abre na AIVA; o formulário de credenciamento de filial foi desativado — ⛔ não mande mais o link dele.** Peça também o **número do endereço** da filial (e o complemento, se tiver) — rua, bairro e cidade a AIVA busca sozinha pela Receita. Quando tiver CNPJ + número: motivo_humano = "abrir_ticket_filial: cnpj=<CNPJ> | numero=<número> | complemento=<se tiver>" (ex.: abrir_ticket_filial: cnpj=60.854.022/0002-21 | numero=150). Use SÓ o que ELE escreveu. Responda curto: "Perfeito, vou abrir o pedido da filial na AIVA." ⛔ Não prometa prazo nem ativação — o sistema abre o ticket, manda a confirmação com o número e avisa quando a AIVA concluir. A AIVA confere na Receita: a filial tem que ter a MESMA raiz de CNPJ da loja principal e estar ATIVA. Se a AIVA recusar por ser de outra empresa (raiz diferente), o próprio sistema pergunta ao lojista se registra a empresa como loja nova — dali em diante, para ESSE CNPJ, vale o passo 2b (bloco LOJA NOVA DE OUTRA EMPRESA). Se o sistema pedir o endereço completo, colete rua, bairro, cidade e UF e devolva motivo_humano = "filial_endereco: cnpj=<CNPJ> | numero=<número> | endereco=<rua, bairro, cidade/UF>" com acionar_humano = true — o time abre o pedido pelo portal. ⛔ Não repita o abrir_ticket_filial nesse caso.
2b. **LOJA NOVA DE OUTRA EMPRESA (regra 19/11/2026):** o bloco **LOJA NOVA DE OUTRA EMPRESA** da instrução do sistema diz um FATO — o lojista mandou um CNPJ de outra empresa — e traz o resultado da conferência que o sistema já fez. Ele vale SÓ para o CNPJ que cita (outro CNPJ segue a regra normal; o sistema classifica de novo). Se o assunto da mensagem for outro (troca de CNPJ de loja existente, usuário/login, dúvida, CNPJ de terceiro), ignore o bloco e siga a regra daquele assunto. Se você (ou uma mensagem do sistema) já tratou disso nesta conversa e ele não voltou ao assunto, não repita. Se ele quer cadastrar essa empresa como loja nova na AIVA, siga o bloco. ELEGÍVEL: confirme que ele quer cadastrar essa empresa como loja nova na AIVA e faça UMA pergunta — o sócio dela é ele mesmo? se não, o nome e o WhatsApp do sócio; com a confirmação, devolva motivo_humano = "loja_nova_empresa: cnpj=<CNPJ> | acao=confirmar | socio=<mesmo OU nome do sócio> | tel=<WhatsApp do sócio, só se não for ele>" (o formato do bloco), com acionar_humano = false, e use a fala do bloco ("Registrei a loja nova; …"). Se ele disser que não é loja nova, acao=cancelar. NÃO ELEGÍVEL: não abra pedido; só se ele estiver pedindo pra cadastrar esse CNPJ, explique em uma frase o motivo que o bloco traz, sem prazo. CONFERÊNCIA PENDENTE (a Receita não respondeu): não abra pedido; se ele quer cadastrar esse CNPJ, peça pra ele mandar o CNPJ de novo mais tarde, como o bloco diz. ⛔ Aqui NÃO existe ticket de filial: não peça número do endereço nem devolva abrir_ticket_filial. ⛔ Você NÃO manda link de cadastro antes do sistema (ele manda sozinho quando o cadastro abrir na AIVA). Depois do pedido registrado: se ele perguntar da loja nova, diga que o pedido está registrado e que o link do cadastro chega por aqui quando a AIVA abrir — sem prazo. Se ele disser que perdeu o link E no histórico já houver a mensagem do sistema "O cadastro de/do … já está aberto na AIVA" (ou, pelo modelo, "falta preencher o cadastro neste link" / "falta preencher o cadastro da AIVA neste link") que traga o CNPJ da loja NOVA escrito nela ("CNPJ …"), reenvie o MESMO link https://retail-onboarding-hub.vercel.app/ e lembre que ele informa o CNPJ da loja NOVA, não o da loja que já opera. A frase "falta preencher o cadastro da AIVA neste link" sem o CNPJ da loja nova é do cadastro da loja que já opera — não vale. Sem essa mensagem com o CNPJ da loja nova no histórico, o cadastro ainda não abriu: não mande link. ⛔ Você NÃO promete prazo nem ativação e NÃO refaz a qualificação (faturamento, e-mail, número de lojas).
2c. **ENDEREÇO NOVO SEM CNPJ PRÓPRIO (regra 19/11/2026):** se ele quer operar em outro endereço usando o CNPJ da matriz (ou de uma loja que já opera), isso NÃO é pedido de filial nem de loja nova — cada loja da AIVA tem o próprio CNPJ. Oriente a registrar a filial com o contador dele e voltar aqui com o CNPJ da filial (aí segue o passo 1). Não abra pedido (nem abrir_ticket_filial nem loja_nova_empresa). ⛔ Não diga que "o time vai analisar" nem que dá pra usar o mesmo CNPJ.
```

#### 4.A.9 Linha 1272 (antes: linha 1269)

**Antes:**
```
| Onboarding completo / cadastro final + CAF | https://retail-onboarding-hub.vercel.app/ (⛔ SÓ na FASE 4 — status EM_ANALISE_AIVA — e só a pedido; NUNCA em PRE_APROVACAO nem em outro status, mesmo que ele peça: quem manda é o sistema. Única exceção: instrução do sistema dizendo que o cadastro está ABERTO no portal) |
```

**Depois:**
```
| Onboarding completo / cadastro final + CAF | https://retail-onboarding-hub.vercel.app/ (⛔ SÓ na FASE 4 — status EM_ANALISE_AIVA — e só a pedido; NUNCA em PRE_APROVACAO nem em outro status, mesmo que ele peça: quem manda é o sistema. Única exceção: instrução do sistema dizendo que o cadastro está ABERTO no portal; reenvio do link da loja nova de OUTRA empresa: seção LOJA NOVA, passo 2b) |
```

#### 4.A.10 Linha 1286 (antes: linha 1283)

**Antes:**
```
| Lojista — credenciar filial / loja nova | ticket da AIVA (seção LOJA NOVA NO MEIO DA CONVERSA) |
```

**Depois:**
```
| Lojista — credenciar filial / loja nova | seção LOJA NOVA NO MEIO DA CONVERSA: filial = ticket da AIVA; outra empresa = pedido pelo bloco do sistema, sem link |
```

#### 4.A.11 Linha 1322 (antes: linha 1319)

**Antes:**
```
- Oriente o sócio a solicitar os usuários da outra loja no formulário de **Login de operadores** (https://forms.gle/izjwzRDXzYWDvtEt6), informando o CNPJ certo de cada loja. Você NÃO coleta mais dados de colaboradores (regra 27/08).
```

**Depois:**
```
- Oriente o sócio a solicitar os usuários da outra loja no formulário de **Login de operadores** (https://forms.gle/izjwzRDXzYWDvtEt6), informando o CNPJ certo de cada loja. Você NÃO coleta mais dados de colaboradores (regra 27/08). Se a outra loja ainda não opera a AIVA, primeiro é a seção LOJA NOVA NO MEIO DA CONVERSA (peça o CNPJ dela).
```

#### 4.A.12 Linha 1386 (antes: linha 1383)

**Antes:**
```
**NUNCA pergunte CNPJ, número de lojas, faturamento ou qualquer dado de qualificação pra cliente já existente.** Se ele mandar um dado DE QUALIFICAÇÃO voluntariamente (ex: "o CNPJ é XXX"), apenas registre nos dados coletados sem pedir mais nada. (Isso NÃO vale pra dados de colaborador/vendedor — nome/CPF/e-mail/telefone de equipe você não registra nem "recebe": seção ACESSOS DA EQUIPE. Exceção no outro sentido: CNPJ de loja nova que ele queira incluir — seção LOJA NOVA.)
```

**Depois:**
```
**NUNCA pergunte CNPJ, número de lojas, faturamento ou qualquer dado de qualificação pra cliente já existente.** Se ele mandar um dado DE QUALIFICAÇÃO voluntariamente (ex: "o CNPJ é XXX"), apenas registre nos dados coletados sem pedir mais nada. (Isso NÃO vale pra dados de colaborador/vendedor — nome/CPF/e-mail/telefone de equipe você não registra nem "recebe": seção ACESSOS DA EQUIPE. Exceção no outro sentido: CNPJ de loja nova que ele queira incluir — e o sócio dela, se o sistema disser que é de outra empresa — seção LOJA NOVA.)
```

### 4.B Instrução de cada fase (`lib/claude.ts`)

As linhas destes blocos são muito longas; abaixo está o trecho inteiro que mudou (o resto da linha ficou igual).

#### 4.B.1 Fase TREINAR (`lib/claude.ts`, bloco da fase TREINAR)

**Antes:**
```
(Exceção: CNPJ e número do endereço de LOJA NOVA/filial que ele queira incluir — seção LOJA NOVA NO MEIO DA CONVERSA, o sistema abre o ticket na AIVA; NÃO prometa ativação.
```

**Depois:**
```
(Exceção: o CNPJ de LOJA NOVA/filial que ele queira incluir — seção LOJA NOVA NO MEIO DA CONVERSA: peça SÓ o CNPJ; quem diz se é FILIAL (aí você pede também o número do endereço e o sistema abre o ticket) ou OUTRA EMPRESA (aí siga o bloco LOJA NOVA DE OUTRA EMPRESA: confirmação + sócio, sem link e sem número do endereço) é o SISTEMA. NÃO prometa prazo nem ativação.
```

#### 4.B.2 Fase LOGIN (`lib/claude.ts`, bloco da fase LOGIN)

**Antes:**
```
exceção: CNPJ e número do endereço de LOJA NOVA/filial que ele queira incluir — seção LOJA NOVA NO MEIO DA CONVERSA, o sistema abre o ticket na AIVA;
```

**Depois:**
```
exceção: o CNPJ de LOJA NOVA/filial que ele queira incluir — peça SÓ o CNPJ; o SISTEMA diz se é FILIAL (número do endereço → ticket) ou OUTRA EMPRESA (bloco LOJA NOVA DE OUTRA EMPRESA: confirmação + sócio, sem link), seção LOJA NOVA NO MEIO DA CONVERSA;
```

#### 4.B.3 Fase LOJA_FINALIZADA_E_VENDENDO (`lib/claude.ts`, bloco da fase VENDENDO)

**Antes:**
```
🏪 LOJA NOVA/FILIAL (outro CNPJ): CNPJ + número do endereço e seção LOJA NOVA NO MEIO DA CONVERSA (ticket; não prometa ativação).
```

**Depois:**
```
🏪 LOJA NOVA/FILIAL (outro CNPJ): peça SÓ o CNPJ e siga a seção LOJA NOVA NO MEIO DA CONVERSA — o SISTEMA diz se é FILIAL (número do endereço → ticket) ou OUTRA EMPRESA (bloco LOJA NOVA DE OUTRA EMPRESA: confirmação + sócio, sem link). Não prometa prazo nem ativação.
```

---

## 5. Pontos para você decidir

1. **Template 86 do link (2.1)** — ✅ decidido pelo Aldo em 22/11: trocado para "etapa concluída: abertura do cadastro da
   loja nova na AIVA" (texto próprio, `utilLinkLojaNova`). Eduardo Cell e RG Cell receberam a redação antiga
   ("aprovação da loja pela AIVA") às 19h46 de 22/11; por isso o prompt aceita as duas frases no reenvio do link.
2. **Motivo Odres (1.2 e 1.5 b):** a frase agora é "Esse CNPJ já é atendido pela AIVA/Odres por outro canal (fora da
   Track), então não pode entrar como loja nova por aqui." Ok assim, ou prefere outra redação?
3. **"Loja criada" (2.2):** o texto deixou de dizer que "os próximos passos dela chegam por aqui, neste mesmo
   WhatsApp" — o sistema não manda mensagem de etapa para a loja nova (ela fica fora do card) e o login dela vem pelo
   número da própria AIVA. Ficou neutro: "… foi criada na AIVA. 🎉 Qualquer dúvida sobre ela, é só me chamar por
   aqui." Ok assim, ou quer que a VictorIA diga que o acesso vem pela AIVA?

---

## 6. Publicação — ordem e cuidados

1. **Aprovação:** você aprova os textos deste documento e confere o `/curadoria` — se alguma correção ativa ensinar
   "CNPJ + número do endereço" ou "o time cuida" para CNPJ de outra empresa, ela contradiz a regra nova e precisa sair.
2. **SQL antes do push:** aplicar `docs/sql/2026-11-19-loja-nova-empresa.sql` ANTES do push e rodar
   `notify pgrst, 'reload schema'`; conferir com `select fluxo from sdr_registros_cnpj limit 1`.
3. **Ensaio na produção atual:** `GET /api/sdr/espelho-portal?dry=1` — esperar `loja_nova.pulado = null` e os
   contadores zerados.
4. **Push:** aguardar o deploy ficar READY; abrir `/atendimento` e conferir o quadro; acompanhar a rodada seguinte do
   espelho.
5. **Só então os dois casos reais** (59.218.413/0001-90 e 69.849.333/0001-96), **UM de cada vez**. As duas linhas já
   estão `pre_cadastro_enviado`, `enviado = true`. Marcar só o `fluxo` faz o espelho agir em até 15 min: em
   `dados_varejo` sai o link (provavelmente pelo modelo 86); com a loja já criada sai "loja criada"; em biometria,
   nada; fora do portal, o aviso diário "clicado e não chegou". Antes do update:
   - consultar cada CNPJ na API de onboardings e perguntar ao Nei o que ele já mandou ao lojista;
   - para NÃO mandar uma mensagem, preencher `link_enviado_em` / `criada_avisada_em` no mesmo update;
   - acrescentar `[LOJA_NOVA_PEDIDA:cnpj=…|ISO]` nas observações dos dois leads;
   - conferir que cada lead tem a linha da loja principal com RID;
   - ler o `?dry` antes da rodada real.
6. **Desligar sem deploy:** `update sdr_registros_cnpj set fluxo = null` desliga o passo do espelho; sem marcador
   `[LOJA_NOVA:` nas observações, o bloco da VictorIA não aparece.
7. **Riscos conhecidos e aceitos:**
   - o mesmo CNPJ pedido por dois leads: só o primeiro recebe o link;
   - lojista que cancela e reenvia o CNPJ é perguntado de novo;
   - a campanha de boas-vindas pode disparar no primeiro acesso da loja nova;
   - os avisos do painel desta fila não fecham sozinhos.
