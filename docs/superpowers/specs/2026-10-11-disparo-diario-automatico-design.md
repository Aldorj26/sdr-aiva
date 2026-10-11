# Disparo diário automático — AIVA e Parcelex

**Data:** 11/10/2026 · **Decidido com:** Aldo
**Abrange DOIS repositórios:** `sdr-aiva` e `sdr-parcelex`. O spec mora aqui porque
é aqui que estão as peças reutilizáveis; a Parcelex recebe a porta equivalente.

## Por que

Aldo viaja no fim de outubro. Hoje o disparo D+0 dos dois SDRs **só sai se o PC
dele estiver ligado** e alguém rodar o script na mão:

| | script | fila | volume |
|---|---|---|---|
| AIVA | `scripts/disparar-fila.mjs` | `sdr_fila_disparo` — 29.318 pendentes | 500/dia (padrão 30/09) |
| Parcelex | `scripts/prospeccao-onda.mjs` | `parcelex_prospeccao` — ~7,3 mil P1 + ~39 mil P2 | ~500/dia (501 funcionou, 702 quebrou em 24/09) |

Todo o resto já roda na Vercel: 19 crons na AIVA, 10 na Parcelex. Os dois scripts
são **só um laço com ritmo** em cima de `/api/sdr/send-initial`, que já está em
produção nos dois projetos. A máquina do Aldo não faz trabalho nenhum que o
servidor não saiba fazer — ela conta e espera.

**Sucesso:** durante a viagem, os dois disparam sozinhos todo dia útil, no ritmo
combinado, e **param sozinhos** se a entrega cair — sem ninguém abrir o notebook.

### Decisões do Aldo (11/10/2026)

1. **Trava:** se a entrega cair, pausa sozinho e avisa. **Não** retoma sozinho.
2. **Ritmo:** teto fixo por dia útil, constante no código. Nada de ajuste automático.
3. **Destrave:** Aldo **ou** Nei, por WhatsApp.

### Prazo e janela de acompanhamento (Aldo, 11/10)

| data | o que |
|---|---|
| **seg 12/10** | AIVA precisa estar disparando sozinha. Aldo no escritório, acompanhando. |
| semana de 12/10 | Parcelex entra. |
| 12/10 → 29/10 | **14 dias úteis de operação supervisionada** com Aldo por perto. |
| **30/10 → 15/11** | viagem. Ninguém olhando de perto. |

A janela supervisionada é o que torna esse desenho aceitável: a trava, o teto e o
destrave são exercitados com Aldo presente antes de valerem sozinhos. **Nada
entra em produção na véspera da viagem** — o que não estiver rodando bem até
29/10 fica de fora e volta ao disparo manual.

Teto confirmado pelo Aldo em 11/10: **500 por dia para CADA empresa** — 500 AIVA
e 500 Parcelex, não 500 somados.

### Fora de escopo

- Publicação do Instagram (Squad Track), que também morre com o PC desligado —
  problema separado, barrado no plano free da Social API.
- Mudar o volume à distância (Aldo escolheu constante).
- Retomada automática depois da pausa.

## O que já existe e vai ser reaproveitado

| peça | AIVA | Parcelex |
|---|---|---|
| `/api/sdr/send-initial` em produção | ✅ | ✅ |
| bloqueio de fim de semana dentro do send-initial | ✅ `isDiaUtil` | ✅ |
| rótulo do D+0 em `sdr_mensagens.template_hsm` | ✅ `aiva_campanha` | ✅ `parcelex_d1` |
| leitura de recibo de entrega da Meta | ✅ `lib/entrega-meta.ts` | ❌ **falta** |
| comandos admin por WhatsApp | ✅ `lib/admin-commands.ts` | ❌ **falta** |
| molde de cron fatiado com orçamento diário | ✅ `retomada-interessado` | — |

Os dois ❌ da Parcelex são o grosso do trabalho desse lado.

## Arquitetura

Uma rota nova por projeto — `/api/sdr/disparo-diario` — chamada por cron de hora
em hora dentro da janela útil. **É o mesmo molde da `retomada-interessado`**, que
roda assim desde 23/09: cada rodada pega um naco, gasta até 240s, para, e a
seguinte continua de onde a anterior parou.

### Por que fatiado e não uma rodada só

Função da Vercel morre em 300s. 500 leads a ~5s cada são ~42 minutos de envio.
Rodada única seria cortada no meio sem aviso — exatamente o que já aconteceu com
a retomada antes do teto por tempo, e com a onda da Parcelex em 21/09 (lote de
60 deu "fetch failed" com as 300 mensagens já enviadas).

### O que cada rodada faz, em ordem

1. **Guarda de janela.** Fora de 8h–19h BRT ou fim de semana, sai sem fazer nada.
   (O `send-initial` já barra fim de semana; a guarda aqui evita gastar a rodada.)
2. **Lê o estado.** Pausado? Sai, sem disparar e sem avisar de novo.
3. **Confere a entrega do que já saiu hoje.** Veredito `alerta` → grava a pausa,
   avisa Aldo e Nei, sai. Veredito `sem_dados` (amostra menor que o mínimo) →
   **segue disparando**: no começo do dia ainda não há o que medir, e tratar
   ausência de dado como falha pararia o disparo todo dia de manhã.
4. **Calcula o que ainda cabe:** `restanteHoje(TETO_DIA, jaSaiuHoje)`.
5. **Dispara** em lotes, parando no teto de tempo. Marca cada lead na fila.
6. **Na última rodada do dia**, manda uma linha de resumo pro Aldo e pro Nei.

### Estado: só duas perguntas

**"Quanto já saiu hoje?"** — vem de `sdr_mensagens`, contando o rótulo do D+0
(`aiva_campanha` / `parcelex_d1`) no dia civil BRT. **Não** de um contador que a
rota incrementa.

Isso importa por dois motivos. Rodada que morre no meio não perde nem duplica a
conta, porque a conta deriva do que de fato foi enviado. E um disparo manual do
Aldo pelo script antigo **entra na mesma conta automaticamente** — os dois
caminhos passam pelo mesmo `send-initial` e gravam o mesmo rótulo. Sem isso, o
cron e uma rodada manual no mesmo dia somariam 1.000 envios sem ninguém notar.

**"Está pausado?"** — tabela de uma linha por projeto:

```sql
create table sdr_disparo_estado (
  id            int primary key default 1 check (id = 1),
  pausado       boolean     not null default false,
  pausado_em    timestamptz,
  motivo        text,
  retomado_em   timestamptz,
  retomado_por  text        -- telefone de quem mandou /retomar
);
```

A pausa **não** expira na virada do dia. Aldo escolheu "só volta quando alguém
destravar" — pausa que se limpa sozinha à meia-noite é retomada automática com
outro nome.

### A trava de entrega

**AIVA:** reusa `conferirEntregaHoje()` de `lib/entrega-meta.ts` como está. Ela
amostra os chats do dia, lê `clientrcvtime || clientreadtime` e devolve
`ok` / `alerta` / `sem_dados`, com piso de 30% e amostra mínima de 12 — números
já calibrados contra o apagão real de 21-22/09, que deu 0 de 30.

**Parcelex:** precisa ganhar o equivalente. `lib/entrega-meta-calc.ts` é puro e
já tem teste; copia para o repo da Parcelex e escreve só o IO (buscar os chats
do dia no Evo). **Copiar, não extrair para pacote compartilhado:** são dois
deploys independentes, com repos separados e chaves separadas; um pacote comum
acrescenta uma peça de build aos dois para economizar ~80 linhas.

O piso de 30% e a amostra mínima valem igual. A Parcelex já viveu o mesmo
apagão (24/09: 702 disparos, 1.003 mensagens sem recibo, zero respostas).

### O destrave

**AIVA:** três comandos novos em `lib/admin-commands.ts`, que já tem `ehAdmin()`
tolerante ao 9º dígito e já autoriza só os números do Aldo e do Nei:

- `/disparo` — quanto saiu hoje, quanto falta, pausado ou não, taxa de entrega
- `/pausar` — para o disparo (útil para parar à distância sem deploy)
- `/retomar` — limpa a pausa; a próxima rodada volta a disparar

**Parcelex:** não tem canal de entrada de admin — `numerosEquipe()` só serve para
avisar. Entra um desvio no topo do webhook: mensagem de número da equipe que
começa com `/` é tratada como comando e **não** é roteada para a Patricia. Os
mesmos três comandos.

### O alerta da pausa

Sai na hora, para Aldo e Nei, dizendo o que mediu e o que fazer:

```
🛑 Disparo AIVA pausado
Entrega em 12% (3 de 25 confirmados) — piso é 30%.
Saíram 180 de 500 hoje. Não vou disparar mais até alguém destravar.

Primeiro: confira a fatura da Meta (foi isso em 21/09).
Depois, responda /retomar aqui.
```

O caminho "fatura primeiro" está no texto de propósito: no apagão de setembro a
investigação levou horas olhando qualidade do número, status e modelos — tudo
verde — enquanto a causa era cobrança recusada.

### Erro

Rodada que estoura vira HTTP 500, aparece no log da Vercel e é pega pelo
`/api/sdr/vigia` das 17h, que já existe e já reclama de rota que falha. Como a
contagem do dia deriva das mensagens enviadas, uma rodada perdida não corrompe
nada: a seguinte recalcula e continua.

## Ritmo concreto

**AIVA** — teto 500/dia útil, `37 11-21 * * 1-5` (UTC) = 8h37 às 18h37 BRT,
11 rodadas. A ~5s por lead e 240s por rodada cabem ~46 por rodada: 11 × 46 = 506,
com folga. Lotes de 5 para o `send-initial`, como o script faz hoje.

**Parcelex** — teto 500/dia útil, `17 11-21 * * 1-5` (UTC) = 8h17 às 18h17 BRT,
11 rodadas. Lotes de 20, como a onda faz hoje. A rodada processa lotes até bater
240s, então se autoajusta.

**Os minutos quebrados não são capricho.** A AIVA tem `sync-from-evo` a cada 5
minutos, `auto-reprocess` a cada 10 e `espelho-portal` a cada 15: todo múltiplo
de 5 já está ocupado. E `:30` é da `campanha-ativacao` (14h30 UTC). Na Parcelex,
`receita-pendente` roda em `5-59/10` e três outras em `*/10`, `*/20` e `*/30` —
também todo múltiplo de 5.

Mais importante que a colisão de invocação: na AIVA a **retomada roda em `0 13-19`**
e gasta HSM do mesmo número. Pôr o disparo em `:37` separa os dois por mais de
meia hora, em vez de empilhar dois lotes de template no mesmo minuto.

O volume da AIVA não muda a carga do número: hoje ele já manda ~700 templates por
dia somando disparo, retomada (320) e cobrança. Esse desenho mantém o mesmo
patamar — só tira a mão do Aldo do meio.

**Esses números são o ponto de partida, medido do histórico, não um chute.** Na
primeira semana a rotina reporta quanto cada rodada realmente conseguiu; se
sobrar fila todo dia, sobe-se o número de rodadas, não o teto por rodada.

### Reconciliação antes de disparar (só Parcelex)

A onda da Parcelex roda `reconciliar()` antes de começar, porque um lote que cai
no meio deixa lead "pendente" na fila com a mensagem já enviada — foi assim que
quase houve disparo duplicado em 21/09. A rodada do cron faz o mesmo no começo.
A AIVA não precisa: ela marca lead a lead dentro do mesmo laço.

## Unidades e limites

| arquivo | o que faz | depende de |
|---|---|---|
| `lib/disparo-diario-calc.ts` | **regras puras**: janela, dia útil, quanto cabe agora, qual o veredito da rodada | nada |
| `lib/disparo-diario.ts` | IO: lê fila, lê estado, grava pausa, chama `send-initial`, avisa | Supabase, Evo, entrega-meta |
| `app/api/sdr/disparo-diario/route.ts` | orquestra uma rodada, `?dry` e `?qtd` para rodada manual | as duas acima |
| `lib/admin-commands.ts` (AIVA) | `/disparo`, `/pausar`, `/retomar` | `lib/disparo-diario.ts` |

A separação calc/IO é a convenção da casa e existe por um motivo prático: a
decisão de disparar ou parar é testável sem banco e sem Evo.

## Testes

`lib/disparo-diario-calc.test.ts`, rodando por `npm run test:disparo`. Casos que
precisam existir:

- fora da janela / fim de semana → não dispara
- pausado → não dispara, **e continua pausado depois da virada do dia**
- entrega em `alerta` → pausa; `sem_dados` → **dispara** (regressão: o contrário
  pararia o disparo toda manhã)
- orçamento já gasto → não dispara
- orçamento parcial → dispara só o que falta
- disparo manual no mesmo dia consome o mesmo orçamento

Além disso: `?dry=1` em cada rota mostra a decisão da rodada sem enviar nada —
e `?dry` que diverge do caminho real é mentira, então os dois passam pela mesma
função de decisão.

## Ordem de execução

1. **AIVA inteira.** É onde está o volume (29.318 na fila) e onde as peças já
   existem. Entrega valor sozinha.
2. **Parcelex.** Porta `entrega-meta`, abre o canal de comando no webhook,
   replica a rota.

Se o prazo apertar antes da viagem, parar depois do passo 1 deixa metade da
operação automática e a outra metade como está hoje — não deixa nada pior.

## Riscos

**A fila da AIVA acaba?** 29.318 pendentes a 500/dia são ~58 dias úteis. Não é
risco na janela da viagem. A Parcelex tem ~46 mil.

**O disparo some e ninguém nota.** Mitigado pelo resumo diário e pelo vigia, que
já cobra rota que não agiu.

**Pausa indevida derruba o mês.** O piso de 30% foi escolhido justamente porque
a taxa varia muito por segmento de lista (Manaus 86%, outras praças 43%) e um
piso de 50% daria alarme falso. Ainda assim é o risco mais caro do desenho, e é
por isso que o destrave é um comando de uma palavra no celular, não um deploy.
