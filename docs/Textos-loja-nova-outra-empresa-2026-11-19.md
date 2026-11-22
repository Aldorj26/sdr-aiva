# Textos da "loja nova de outra empresa" — para aprovação do Aldo (19/11/2026)

**O que é:** um lojista que já opera a AIVA (etapas TREINAR, LOGIN ou VENDENDO) manda o CNPJ de **outra empresa**
(os 8 primeiros dígitos do CNPJ são diferentes dos da loja dele) para cadastrar uma loja nova, ou digita o atalho
**NOVA LOJA**. O sistema confere o CNPJ (Receita ATIVA, 1 ano ou mais, fora da base Odres/UME, sem cadastro na AIVA),
a VictorIA confirma com o lojista, o pedido entra na fila de pré-cadastro e, quando a AIVA abrir o cadastro, o
sistema manda o link sozinho.

Todos os textos abaixo foram **copiados do código, sem alteração**. Onde aparece `<...>` é um dado que o sistema
preenche na hora (CNPJ, razão social, nome da loja etc.).

Nada disto vai para produção antes da sua aprovação.

---

## 1. O que a VictorIA é instruída a dizer

Estes textos são **instruções para a VictorIA** (ela lê, o lojista não). A fala final é dela, seguindo a instrução.
Fonte: `lib/loja-nova-calc.ts`.

### 1.1 CNPJ de outra empresa que PASSOU na conferência (elegível)

**Quando:** o lojista (TREINAR / LOGIN / VENDENDO) mandou o CNPJ de outra empresa e ele passou na conferência. Vale
por até 7 dias, até a VictorIA registrar o pedido. **Para quem:** VictorIA.

```
## LOJA NOVA DE OUTRA EMPRESA — ELEGÍVEL
O lojista pediu para cadastrar o CNPJ <CNPJ> (outra empresa) como loja nova na AIVA, e o CNPJ passou na conferência.
VictorIA, conduza assim:
1. Confirme com ele que quer cadastrar essa empresa (<CNPJ>) como nova loja na AIVA.
2. Pergunte se o sócio responsável é ele mesmo; se não for, peça o nome e o WhatsApp do sócio.
3. Com a confirmação, devolva o motivo no formato `loja_nova_empresa: cnpj=<14 dígitos> | acao=confirmar | socio=mesmo|<nome> | tel=<telefone>` com acionar_humano = false. Se ele desistir, use acao=cancelar.
4. Diga: "Registrei a loja nova; assim que o cadastro dela abrir na AIVA eu te mando o link por aqui."
⛔ Não mande link de cadastro, não prometa prazo e não refaça a qualificação (a loja principal já está ativa).
```

**A frase que o lojista recebe ao final:**
> Registrei a loja nova; assim que o cadastro dela abrir na AIVA eu te mando o link por aqui.

### 1.2 CNPJ de outra empresa que NÃO passou na conferência (não elegível)

**Quando:** mesma situação, mas o CNPJ foi barrado. **Para quem:** VictorIA. Nenhum pedido é aberto.

```
## LOJA NOVA DE OUTRA EMPRESA — NÃO ELEGÍVEL
O lojista pediu para cadastrar o CNPJ <CNPJ> como loja nova. <MOTIVO>
VictorIA: NÃO abra pedido de loja nova para esse CNPJ. Explique ao lojista, com cordialidade e sem prometer prazo, que esse CNPJ não pode seguir por aqui agora, e ofereça ajuda com o que ele precisar da loja que já está ativa.
```

`<MOTIVO>` é uma destas frases, conforme o caso:

| Motivo | Frase |
|---|---|
| Situação na Receita não é ATIVA | A situação desse CNPJ na Receita não é ATIVA (`<situação>`). |
| Menos de 1 ano de abertura | Esse CNPJ tem menos de 1 ano de abertura (`<ex.: 0,4 ano / 3 meses>`). |
| Está na base Odres/UME | Esse CNPJ está na base Odres/UME, que é tratada manualmente pela equipe. |
| Já tem cadastro na AIVA | Esse CNPJ já tem cadastro na AIVA (`<detalhe>`), então não cabe um pedido novo. |
| Receita fora do ar | Não foi possível consultar esse CNPJ na Receita agora. |
| Qualquer outro | Esse CNPJ não pôde ser aceito como loja nova. |

### 1.3 Atalho NOVA LOJA sem CNPJ

**Quando:** o lojista manda uma frase curta (até 6 palavras) com "nova loja" e ainda não mandou CNPJ, sem pedido em
andamento nos últimos 7 dias. **Para quem:** VictorIA.

```
[INSTRUÇÃO DO SISTEMA — LOJA NOVA] O lojista quer cadastrar uma loja nova: peça o CNPJ dela (14 dígitos). [FIM INSTRUÇÃO DO SISTEMA]
```

### 1.4 Pedido de filial recusado pela AIVA por ser de outra empresa

**Quando:** a VictorIA tentou abrir um ticket de FILIAL e a AIVA recusou porque a raiz do CNPJ é diferente.
**Para quem:** o lojista (mensagem direta do sistema). Fonte: `lib/tickets-aiva.ts` (`mensagemFilial`). No turno
seguinte, a VictorIA segue o bloco 1.1 ou 1.2.

> O CNPJ `<CNPJ>` é de outra empresa — aí o caminho é o cadastro de loja nova. Quer que eu registre essa empresa como nova loja na AIVA?

---

## 2. O que o sistema manda ao lojista

Fonte: `lib/loja-nova-calc.ts` + `lib/espelho-portal.ts` (rotina do espelho, a cada 15 min). Cada mensagem sai
**uma vez só por CNPJ**. Se o lojista escreveu nas últimas 24 h, sai como texto normal; se não, sai pelo
**template 86** (utilidade, "etapa concluída").

### 2.1 Link do cadastro

**Quando:** o pré-cadastro da loja nova chegou na AIVA (coluna "dados_varejo") e a loja ainda não foi criada.

**Texto normal (janela aberta):**
> O cadastro de `<RAZÃO SOCIAL>` (CNPJ `<CNPJ>`) já está aberto na AIVA. Para concluir, acesse https://retail-onboarding-hub.vercel.app/ e informe esse CNPJ. Qualquer dúvida, é só me chamar por aqui.

(Sem razão social: "O cadastro de o CNPJ `<CNPJ>` já está aberto na AIVA. …")

**Template 86 (janela fechada):**
> Olá `<nome do sócio>`, aqui é a VictorIA da Track.
>
> A loja `<RAZÃO SOCIAL> (CNPJ <CNPJ>)` teve uma etapa concluída: aprovação da loja pela AIVA.
>
> Situação: falta preencher o cadastro da AIVA neste link: https://retail-onboarding-hub.vercel.app/ Assim que finalizar, me avisa por aqui.
>
> Dúvidas, responda esta mensagem.

### 2.2 Loja criada

**Quando:** a AIVA criou a loja nova (o portal mostra o ID da loja).

**Texto normal (janela aberta):**
> A loja nova `<RAZÃO SOCIAL>` foi criada na AIVA. Os próximos passos dela chegam por aqui, neste mesmo WhatsApp. Qualquer dúvida, é só me chamar.

**Template 86 (janela fechada):**
> Olá `<nome do sócio>`, aqui é a VictorIA da Track.
>
> A loja `<RAZÃO SOCIAL> (CNPJ <CNPJ>)` teve uma etapa concluída: loja nova criada na AIVA.
>
> Situação: os próximos passos dessa loja chegam por este mesmo WhatsApp.
>
> Dúvidas, responda esta mensagem.

Se a AIVA **recusar** a loja nova, o lojista **não recebe nada** do robô (só o time é avisado, item 3.4).

---

## 3. Avisos ao time (Nei e Aldo, pelo WhatsApp)

### 3.1 CNPJ de outra empresa apareceu na conversa

**Quando:** lojista em TREINAR / LOGIN / VENDENDO mandou só CNPJs de outra empresa, todos conferidos.
Fonte: `app/api/sdr/webhook/route.ts`.

```
🏪 *CNPJ DE OUTRA EMPRESA NA CONVERSA — loja nova de cliente ativo*

<loja> (<telefone> — etapa <status>) mandou:
• <CNPJ> — <razão social>
  🔎 OUTRA EMPRESA (raiz diferente): <resultado da conferência>

📝 Registrado no painel (status "informada"). Raiz diferente da loja dele = OUTRA EMPRESA: não é filial e não gerou linha na aba Filiais.
Se elegível, a VictorIA confirma com o lojista (e o sócio); com a confirmação o pedido entra na fila de pré-cadastro (/atendimento) e chega outro aviso. Se não elegível, ela explica ao lojista que não segue por aqui.
Se for TROCA do CNPJ cadastral: o lojista pede no form de alterações da empresa (https://forms.gle/GkmyfeDghnzxbxm89); desconsiderar o registro.
```

`<resultado da conferência>` é um destes:
- `elegível (Receita ATIVA, 1 ano ou mais, fora da base Odres/UME e sem cadastro na AIVA) — a VictorIA confirma com o lojista`
- `NÃO elegível — <uma das frases de motivo da tabela 1.2>`
- `elegibilidade não conferida (etapa fora do fluxo ou consulta falhou)`

(Se a mensagem misturar CNPJ de outra empresa com outro tipo de CNPJ, sai o aviso antigo "🏪 *CNPJ NOVO NA CONVERSA —
conferir: loja nova ou correção/troca?*", com a mesma linha 🔎 em cada CNPJ de outra empresa.)

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

**Quando:** a VictorIA devolveu o pedido, mas algo não bate. O aviso humano de sempre sai com o motivo seguido de
"— ⚠️" e um destes textos:

- `motivo de loja nova ilegível (<motivo>) — a VictorIA pode já ter dito ao lojista que registrou a loja nova`
- `o lojista desistiu da loja nova <CNPJ>, mas o pedido já está na fila de pré-cadastro — tirar da fila`
- `CNPJ <CNPJ> do motivo não foi escrito pelo lojista na janela recente — a VictorIA já disse ao lojista que registrou a loja nova`
- `sem conferência recente do CNPJ <CNPJ> — a VictorIA já disse ao lojista que registrou a loja nova`
- `CNPJ <CNPJ> não elegível (<motivo>: <detalhe>) — a VictorIA já disse ao lojista que registrou a loja nova`
- `erro no bloco de loja nova — a VictorIA pode já ter dito ao lojista que registrou a loja nova`

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

**Mensagem ao lojista que pode não ter saído** (envio retido):
```
⚠️ *Loja nova de cliente ativo: mensagem ao lojista pode não ter saído* (<n>)
• <loja> — CNPJ <CNPJ> · <link do cadastro | aviso de loja criada> · <recusado pelo Evo N× | resposta ambígua do Evo (pode ter saído) | recusado pelo Evo e a reserva não foi solta (não saiu)>

O link da loja nova (ou o aviso de loja criada) pode não ter saído — conferir na conversa e reenviar à mão. O robô NÃO tenta de novo sozinho pra não mandar em dobro (pra liberar: apagar em sdr_avisos_chave as chaves loja_nova_<link|criada>:<cnpj> e loja_nova_retido:<tipo>:<cnpj>).
```

---

## 4. Trechos alterados no prompt da VictorIA (`prompts/aiva.ts`)

### 4.1 Linha 65 — lista de canais já mapeados
- **Antes:** `filial → ticket que o sistema abre (seção LOJA NOVA NO MEIO DA CONVERSA);`
- **Depois:** `filial ou loja nova de outra empresa → seção LOJA NOVA NO MEIO DA CONVERSA (filial = ticket que o sistema abre; outra empresa = pedido pelo bloco do sistema, sem link);`

### 4.2 Linha 458 — tabela de canais oficiais
- **Antes:** `| Credenciar uma FILIAL / loja nova do mesmo dono | TICKET da AIVA que o sistema abre — você coleta o CNPJ da filial e o número do endereço (seção LOJA NOVA NO MEIO DA CONVERSA) |`
- **Depois:** `| Credenciar uma FILIAL / loja nova do mesmo dono (mesma empresa ou OUTRA empresa) | você pede o CNPJ e o SISTEMA diz qual é: FILIAL = TICKET da AIVA que o sistema abre (você coleta também o número do endereço); OUTRA EMPRESA = pedido de loja nova pelo bloco do sistema, sem link (seção LOJA NOVA NO MEIO DA CONVERSA) |`

### 4.3 Linha 461 — exceções a "quem preenche é o lojista"
- **Antes:** `(⚠️ exceções: PAINEL FINANCEIRO, REPASSE e FILIAL — você pede SÓ o que o item diz (Gmail; número da venda; CNPJ + número do endereço) e o sistema abre o ticket na AIVA; …)`
- **Depois:** `(⚠️ exceções: PAINEL FINANCEIRO, REPASSE, FILIAL e LOJA NOVA DE OUTRA EMPRESA — você pede SÓ o que o item diz (Gmail; número da venda; CNPJ + número do endereço; na outra empresa, a confirmação e o sócio) e o sistema abre o ticket / registra o pedido; …)`

### 4.4 Linha 892 — não recoletar dados (pós-cadastro)
- **Antes:** `(Exceção: o CNPJ de uma LOJA NOVA que ele queira incluir — seção LOJA NOVA. …)`
- **Depois:** `(Exceção: o CNPJ de uma LOJA NOVA que ele queira incluir — e, se o sistema disser que é de outra empresa, quem é o sócio dela — seção LOJA NOVA. …)`

### 4.5 Linha 917 — desambiguação usuário × loja nova
- **Antes:** `… seção LOJA NOVA NO MEIO DA CONVERSA (ticket de filial: CNPJ + número do endereço).`
- **Depois:** `… seção LOJA NOVA NO MEIO DA CONVERSA (você pede o CNPJ; o sistema diz se é filial — ticket, com o número do endereço — ou outra empresa — pedido de loja nova, sem link).`

### 4.6 Linha 1129 — prazos oficiais da Flexfone
- **Antes:** `cadastro de loja nova até 7 dias;`
- **Depois:** `cadastro de loja nova até 7 dias (⛔ não cite no pedido de filial ou de loja nova — seção LOJA NOVA: sem prazo);`

### 4.7 Linhas 1167–1177 — seção 🏪 LOJA NOVA NO MEIO DA CONVERSA
**Antes (título, abertura e passos 0–2):**
```
## 🏪 LOJA NOVA NO MEIO DA CONVERSA (regra 01/09; canal novo em 01/10/2026 — vale em QUALQUER fase pós-cadastro)
Se o lojista já cadastrado (CADASTRO_RECEBIDO em diante) disser que **abriu/vai abrir outra loja, quer incluir uma filial ou mais um CNPJ**:
0. ⚠️ O pedido de filial só vale com a loja PRINCIPAL já criada na AIVA (…). Em CADASTRO_RECEBIDO/EM_ANALISE_AIVA, faça só o passo 1 (…)
1. Comemore ("Que ótimo, mais uma loja! 🎉") e **peça o CNPJ da loja nova** — EXCEÇÃO cirúrgica (…).
2. **Regra 13/10/2026: o pedido é por TICKET (…)** (…) A AIVA confere na Receita: a filial tem que ter a MESMA raiz de CNPJ da loja principal e estar ATIVA. Se o sistema avisar que é de outra empresa (raiz diferente), não é filial — é loja nova: o time cuida. Se o sistema pedir o endereço completo, (…)
```
**Depois:**
```
## 🏪 LOJA NOVA NO MEIO DA CONVERSA (regra 01/09; canal novo em 01/10/2026; loja de OUTRA empresa em 19/11/2026 — vale em QUALQUER fase pós-cadastro)
Se o lojista já cadastrado (CADASTRO_RECEBIDO em diante) disser que **abriu/vai abrir outra loja, quer incluir uma filial ou mais um CNPJ** (ou mandar o atalho **NOVA LOJA**):
0. ⚠️ O pedido de filial ou de loja nova só vale com a loja PRINCIPAL já criada na AIVA (…igual…).
1. (…igual…) Atalho NOVA LOJA: quando vier a instrução do sistema "LOJA NOVA" mandando pedir o CNPJ, é este passo — peça só o CNPJ (14 dígitos).
**Regra 19/11/2026 — quem diz se o CNPJ é FILIAL (mesma raiz da loja dele) ou de OUTRA EMPRESA (raiz diferente) é o SISTEMA, nunca você.** ⛔ Não compare raiz de CNPJ por conta própria nem pergunte ao lojista se é filial. Com o CNPJ na conversa: veio o bloco do sistema **LOJA NOVA DE OUTRA EMPRESA** → passo 2b; não veio → passo 2a.
2a. **FILIAL — Regra 13/10/2026: (…texto antigo do ticket de filial, igual…)** Se a AIVA recusar por ser de outra empresa (raiz diferente), o próprio sistema pergunta ao lojista se registra a empresa como loja nova — dali em diante vale o passo 2b (bloco LOJA NOVA DE OUTRA EMPRESA). (…endereço completo, igual…)
2b. **LOJA NOVA DE OUTRA EMPRESA (regra 19/11/2026):** siga o bloco **LOJA NOVA DE OUTRA EMPRESA** da instrução do sistema — ele traz o resultado da conferência que o sistema já fez e o passo a passo. ELEGÍVEL: confirme que ele quer cadastrar essa empresa como loja nova na AIVA e faça UMA pergunta — o sócio dela é ele mesmo? se não, o nome e o WhatsApp do sócio; com a confirmação, devolva o motivo_humano "loja_nova_empresa: …" exatamente no formato do bloco, com acionar_humano = false, e use a fala do bloco ("Registrei a loja nova; …"). Se ele disser que não é loja nova, acao=cancelar. NÃO ELEGÍVEL: explique em uma frase o motivo que o bloco traz, sem prazo, e não abra pedido. ⛔ Aqui NÃO existe ticket de filial: não peça número do endereço nem devolva abrir_ticket_filial. ⛔ Você NÃO manda link de cadastro (o sistema manda sozinho quando o cadastro abrir na AIVA), NÃO promete prazo nem ativação e NÃO refaz a qualificação (faturamento, e-mail, número de lojas).
2c. **ENDEREÇO NOVO SEM CNPJ PRÓPRIO (regra 19/11/2026):** se ele quer operar em outro endereço usando o CNPJ da matriz (ou de uma loja que já opera), isso NÃO é pedido de filial nem de loja nova — cada loja da AIVA tem o próprio CNPJ. Oriente a registrar a filial com o contador dele e voltar aqui com o CNPJ da filial (aí segue o passo 1). Não abra pedido (nem abrir_ticket_filial nem loja_nova_empresa). ⛔ Não diga que "o time vai analisar" nem que dá pra usar o mesmo CNPJ.
```
Passos 3 (troca de CNPJ = formulário de alterações da empresa; usuário = Login de operadores) e 4 (não recadastrar) ficaram iguais.

### 4.8 Linha 1286 — tabela de canais (suporte pós-venda)
- **Antes:** `| Lojista — credenciar filial / loja nova | ticket da AIVA (seção LOJA NOVA NO MEIO DA CONVERSA) |`
- **Depois:** `| Lojista — credenciar filial / loja nova | seção LOJA NOVA NO MEIO DA CONVERSA: filial = ticket da AIVA; outra empresa = pedido pelo bloco do sistema, sem link |`

### 4.9 Linha 1386 — cliente já existente: não perguntar dado de qualificação
- **Antes:** `Exceção no outro sentido: CNPJ de loja nova que ele queira incluir — seção LOJA NOVA.)`
- **Depois:** `Exceção no outro sentido: CNPJ de loja nova que ele queira incluir — e o sócio dela, se o sistema disser que é de outra empresa — seção LOJA NOVA.)`

---

## 5. Pontos para você decidir

1. **Template 86 do link (2.1)** diz "etapa concluída: **aprovação da loja pela AIVA**" — é o mesmo texto usado no
   cadastro normal. Para a loja nova, o lojista pode ler como "a AIVA já aprovou". Manter ou trocar?
2. **Motivo "base Odres/UME" (1.2):** a VictorIA vai explicar ao lojista com essa frase como base. Ok citar a Odres/UME
   para o lojista, ou prefere uma frase neutra ("esse CNPJ não pode seguir por aqui")?
3. **Lojista perdeu o link da loja nova:** pela regra atual a VictorIA não manda o link de cadastro em TREINAR /
   LOGIN / VENDENDO, então ela não consegue reenviar. Hoje o caminho seria o time reenviar à mão.
