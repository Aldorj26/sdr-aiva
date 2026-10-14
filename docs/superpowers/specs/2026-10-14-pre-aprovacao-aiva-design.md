# Quem decide quem entra é a AIVA — fim da trava pela base Odres/UME

**Data:** 14/10/2026 · **Decidido com:** Aldo · **Status:** desenho aprovado em conversa, aguardando leitura

## Problema

Quando o `cnpj_matriz` chega, o webhook consulta `aiva_base_cnpjs` e, se achar o CNPJ,
barra o lojista na hora: manda a mensagem oficial de Odres ou de UME, joga a
oportunidade no funil 19 e encerra a conversa. A consulta à Receita nem roda.

Três coisas estão erradas nisso:

1. **A base morreu.** A última linha gravada em `aiva_base_cnpjs` é de **02/10/2026**.
   A tarefa `importar-base-aiva-diaria` roda todo dia às 11h, reporta "succeeded" e não
   escreve nada desde então — o relatório do Data Studio deixou de ser exportável. Hoje a
   trava decide com um retrato de doze dias atrás, e piora a cada dia.
2. **A decisão não é nossa.** Quem sabe se um CNPJ pertence a outro distribuidor é a AIVA,
   e ela já responde isso na pré-aprovação: hoje há 26 lojas em `not_approved` no portal.
   A resposta vem em cerca de um dia.
3. **O lojista reprovado não é avisado.** Quando a AIVA recusa, o espelho move o card para
   95, trava o lead como `NAO_QUALIFICADO` e avisa Aldo e Nei — e o lojista fica sem
   resposta nenhuma, sem nunca saber o que houve.

## Decisão

A trava pela base sai. Todo lojista que passar pela Receita segue até a pré-aprovação, o
pré-cadastro vai para a AIVA como já vai hoje, e **a AIVA decide**. Nas duas pontas o
lojista é avisado.

Decisões do Aldo nesta conversa:

- Não manter a base nem como sinal interno: ela não está mais disponível para baixar.
- Na recusa, **mensagem neutra**: avisar que a AIVA não aprovou neste momento, sem alegar
  motivo. O portal devolve só `declined`, sem justificativa, e afirmar "você é de outro
  distribuidor" seria inventar o motivo nos casos em que a recusa for outra.
- Manter o envio manual do formulário no `/registros` como está.

## O que muda

### 1. Sai a trava (`app/api/sdr/webhook/route.ts`, ~1665–1709)

Remover a consulta a `aiva_base_cnpjs`, a bandeira `naBaseAiva`, a atribuição de
`novo_status = 'ODRES' | 'UME'` por causa da base e o alerta 📇 "LEAD JÁ É DA BASE".

A consulta à Receita passa a ser incondicional: hoje ela roda dentro de
`if (!naBaseAiva && !jaClienteOutroCanal)`; fica só a guarda de `jaClienteOutroCanal`.

**Não remover** os status `ODRES` e `UME` nem `transferirParaFunil19`. Eles continuam
alcançáveis pelo outro caminho, que não depende da base: quando o próprio lojista diz
que já trabalha com Odres ou com a UME, a VictorIA classifica assim pelo prompt
(`lib/claude.ts`, webhook 1849 e 2612). Esse fluxo fica intacto.

### 2. Para a importação diária

Desligar a tarefa agendada `importar-base-aiva-diaria` (hoje `enabled: true`, 11h, falhando
em silêncio desde 02/10).

`scripts/importar-base-aiva.mjs` e a tabela `aiva_base_cnpjs` ficam onde estão, sem leitor
no fluxo, com um comentário no topo do script dizendo que foi aposentado em 14/10/2026 e
por quê. A tabela é referenciada por scripts datados de conciliação
(`scripts/conferencia-lojas-2026-10-06.mjs`), que são históricos e não devem quebrar.
Apagar a tabela fica para uma limpeza futura, fora desta mudança.

### 3. Avisar o lojista na recusa (`lib/espelho-portal.ts`, passo 6)

No laço que trata `r.reprovados`, depois de mover o card para 95 e gravar
`NAO_QUALIFICADO`, enviar **uma** mensagem ao lojista. A guarda é a que já existe,
`!x.jaAvisado` — o mesmo marcador que hoje decide se o time é avisado —, então a mensagem
sai uma vez por lead e nunca em reprocessamento.

Texto proposto, para o Aldo aprovar junto com esta spec:

> Oi {primeiro nome}! Voltei com a resposta da AIVA sobre o seu cadastro.
> Infelizmente ele não foi aprovado neste momento. Essa análise é feita direto pela AIVA e
> eu não recebo aqui o detalhe do motivo. Obrigada de verdade pelo seu tempo e pelas
> informações que você me passou — qualquer dúvida, é só me chamar por aqui. 😊

O que o texto não pode fazer, e é por isso que ele é curto: alegar motivo (não sabemos),
prometer reanálise (não temos como garantir) ou sugerir que o lojista procure a AIVA
(ele não é cliente dela, e isso viraria um chamado sem dono).

A mensagem vai por `sendText` e é gravada com `saveMensagem`, como qualquer outra saída,
para aparecer no histórico do painel.

Falha no envio não pode derrubar a rodada do espelho: envolver em `try/catch` e registrar
no array `avisos`, seguindo o padrão do próprio arquivo.

### 4. Aprovação: nada a construir

Quando a AIVA aprova, o card entra na etapa 50 e o handler de `/api/sdr/opportunity-stage`
já manda o `aiva_link_cadastro` — o link do cadastro, uma vez por loja. **Essa é a
mensagem de aprovação.** Não criar uma segunda mensagem: duas seguidas confundem, e o link
é mais útil que um aviso solto.

### 5. A VictorIA precisa saber da recusa (`lib/claude.ts`)

Hoje `MARCADOR_REPROVADO` é gravado no lead e não chega ao prompt. Se o lojista responder à
mensagem neutra, a VictorIA não sabe de nada e pode recomeçar a coleta.

Adicionar um bloco de instrução para lead `NAO_QUALIFICADO` com esse marcador: não reabrir
cadastro, não pedir dados, não prometer reanálise, responder com educação e manter o
status; `OPT_OUT` se pedir para parar. Mesmo formato dos blocos por fase que já existem.

## O que não muda

Receita (1 ano, situação ATIVA, dígito verificador) · envio manual do formulário no
`/registros` · a regra das 24h do espelho · o funil 19 quando o lojista menciona Odres ou
UME espontaneamente · tudo da Fase 3 em diante.

## Riscos aceitos

- **Mais trabalho manual no formulário.** A base barrava cerca de 65 lojas por mês
  (209 desde 27/07). Elas passam a chegar à pré-aprovação e ao envio manual do Nei, que
  hoje faz 389 envios por mês. Aldo aceitou explicitamente.
- **Se a AIVA não reprovar esses casos**, cadastramos loja de outro distribuidor e só
  descobrimos no conflito. A medição abaixo é o que detecta isso.
- O lojista reprovado passa pela Fase 1 inteira antes de ouvir o não, em vez de ser barrado
  no turno do CNPJ.

## Como saber se deu certo

Trinta dias depois de publicar, comparar o número de lojas em `not_approved` no portal da
AIVA com as 26 de hoje. Se subir na ordem de 60 por mês, a AIVA está pegando o que a base
pegava e a mudança se sustenta. Se continuar perto de 26, significa que a AIVA aprova quem
já é de outro distribuidor, e aí a conversa muda: volta a ser um problema nosso, a ser
resolvido com a AIVA, não com um CSV.

Acompanhar também quantas mensagens neutras saíram e se alguma virou reclamação.

## Testes

`lib/espelho-portal.ts` não tem suíte pura; a regra que decide quem é reprovado mora em
`lib/espelho-portal-calc.ts`, que tem. O envio da mensagem é efeito colateral, então:

- Rodar `npx tsc --noEmit -p tsconfig.json`.
- Rodar as suítes existentes que tocam o que foi mexido (`npm run test:espelho`).
- Conferir o passo 6 com `?dry` antes de publicar, para ver quem entraria na mensagem sem
  enviar nada.
