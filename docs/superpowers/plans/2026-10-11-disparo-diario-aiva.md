# Disparo diário automático — AIVA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O disparo D+0 da AIVA sai sozinho todo dia útil, sem o PC do Aldo ligado, e pausa sozinho se a entrega da Meta cair.

**Architecture:** Rota `/api/sdr/disparo-diario` chamada por cron de hora em hora na janela útil. Cada rodada confere o recibo de entrega do dia, calcula quanto ainda cabe no teto de 500, puxa esse naco de `sdr_fila_disparo` e dispara em lotes de 5 pelo `/api/sdr/send-initial` até bater 240s. Regras puras em `lib/disparo-diario-calc.ts`, IO em `lib/disparo-diario.ts`. Mesmo molde da `retomada-interessado`.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Supabase (`axkrorkhnkfkpbjikwrb`), Evo Talks, cron da Vercel, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-disparo-diario-automatico-design.md`

> **Escopo:** este plano cobre **só a AIVA**. A Parcelex tem plano próprio (`2026-10-11-disparo-diario-parcelex.md`), que só começa depois que a AIVA rodar um dia observada.

## Global Constraints

- **Teto: 500 disparos por dia útil**, só para a AIVA (a Parcelex tem os seus 500).
- **Janela: 8h–19h BRT.** Fora dela a rodada não dispara.
- **Teto de tempo por rodada: 240_000 ms.** A função da Vercel morre em 300s.
- **Piso de entrega: 30%** (`PISO_TAXA` de `lib/entrega-meta-calc.ts`). Não redefinir.
- **A pausa NÃO expira na virada do dia.** Só `/retomar` limpa.
- **Contagem do dia vem de `sdr_mensagens`** (`direcao='out'`, `template_hsm='aiva_campanha'`, `enviado_em >= meia-noite BRT`), nunca de um contador incrementado pela rota.
- **Cron da Vercel chama por GET** — rota sem `export const GET` é 405 silencioso.
- **`?dry` sempre por `flag(searchParams, 'dry')`** de `lib/req-flags`, nunca `=== '1'`.
- Auth das rotas de cron: `Bearer ${WEBHOOK_SECRET}` ou `Bearer ${CRON_SECRET}`.

## Review Focus

1. **Evo fora do ar na conferência de entrega** — `conferirEntregaHoje()` lançando não pode pausar o disparo nem derrubar a rodada; queda do Evo não é bloqueio da Meta. Esperado: trata como `sem_dados` e dispara. *(Task 2)*
2. **`send-initial` devolve 200 com falhas por lead** — `resultados[].ok === false` não pode virar `DISPARADO` na fila. Esperado: aquele lead vira `ERRO` com o detalhe. *(Task 2)*
3. **`fetch` do lote estoura (timeout/5xx)** — os 5 leads ficam `PENDENTE` e voltam na próxima rodada. Esperado: a rodada não morre e segue para o próximo lote. *(Task 2)*
4. **Fila menor que o orçamento restante** — 12 pendentes com 300 de orçamento. Esperado: dispara 12, `acao: 'disparar'`, sem erro e sem laço vazio. *(Task 1)*
5. **`/retomar` com o disparo já ativo, e `/pausar` com ele já pausado** — comando repetido é o caso normal de quem está no celular. Esperado: idempotente, responde o estado atual, não reescreve `pausado_em`. *(Task 3)*

---

### Task 1: Regras puras + tabela de estado

**Files:**
- Create: `lib/disparo-diario-calc.ts`
- Create: `lib/disparo-diario-calc.test.ts`
- Create: `supabase/migrations/2026-10-11-disparo-estado.sql`
- Modify: `package.json` (adicionar `"test:disparo": "node --test lib/disparo-diario-calc.test.ts"`)

**Interfaces:**
- Consumes: `diaBrt(ms: number): string` de `lib/retomada-interessado-calc.ts` (já exportada e testada — usar essa, não escrever uma terceira cópia).
- Produces:
  - `TETO_DIA = 500`, `ROTULO = 'aiva_campanha'`, `JANELA = { de: 8, ate: 19 }`, `TETO_TEMPO_MS = 240_000`, `LOTE = 5`
  - `type Entrega = { estado: 'ok' | 'alerta' | 'sem_dados'; taxa: number | null; amostra: number; entregues: number; motivo: string }`
  - `type Decisao = { acao: 'disparar'; quantidade: number } | { acao: 'pausar'; motivo: string } | { acao: 'nada'; motivo: 'fora_da_janela' | 'fim_de_semana' | 'pausado' | 'orcamento_gasto' | 'fila_vazia' }`
  - `decidirRodada(e: { agoraMs: number; pausado: boolean; jaSaiuHoje: number; filaPendente: number; entrega: Entrega }): Decisao`
  - `textoPausa(entrega: Entrega, jaSaiuHoje: number): string`
  - `ehUltimaRodada(agoraMs: number): boolean` — verdadeiro na rodada das 18h37 BRT
  - `textoResumoDia(r: Resumo): string`
  - `entregaIndisponivel(): Entrega` — o `sem_dados` que se usa quando o Evo não responde
  - `type Resumo = { saiuHoje: number; restante: number; filaPendente: number; pausado: boolean; entrega: Entrega }`

- [ ] **Step 1: Escrever os testes que falham** em `lib/disparo-diario-calc.test.ts`

Um helper no topo monta o caso base (dia útil, 10h BRT, não pausado, 0 enviados, 1000 na fila, entrega `ok`). Cada teste muda um campo.

```ts
test('dia útil dentro da janela, nada enviado → dispara o teto do dia', ...)
  // decidirRodada(base) → { acao: 'disparar', quantidade: 500 }

test('fora da janela (7h BRT e 19h BRT) → nada', ...)
  // motivo 'fora_da_janela' nos dois

test('sábado e domingo → nada', ...)
  // motivo 'fim_de_semana'

test('pausado → nada, mesmo com fila e orçamento', ...)
  // motivo 'pausado'

test('pausado continua pausado depois da virada do dia', ...)
  // mesmo caso, agoraMs do dia seguinte → ainda 'pausado'

test('orçamento do dia já gasto → nada', ...)
  // jaSaiuHoje 500 → motivo 'orcamento_gasto'

test('orçamento parcial → dispara só o que falta', ...)
  // jaSaiuHoje 460 → quantidade 40

test('fila vazia → nada', ...)
  // filaPendente 0 → motivo 'fila_vazia'

test('fila menor que o orçamento → dispara o tamanho da fila', ...)
  // filaPendente 12, jaSaiuHoje 200 → quantidade 12

test('entrega em alerta → pausar, com a taxa no motivo', ...)
  // entrega { estado:'alerta', taxa:0.12, amostra:25, entregues:3 } → acao 'pausar',
  // motivo contém '12%'

test('entrega sem_dados → DISPARA (regressão: de manhã não há o que medir)', ...)
  // entrega { estado:'sem_dados', taxa:null, amostra:4 } → acao 'disparar'

test('textoPausa cita a taxa, quanto saiu, a fatura da Meta e /retomar', ...)
  // assert em quatro includes: '12%', '180', 'fatura', '/retomar'

test('entregaIndisponivel devolve sem_dados — Evo fora não é bloqueio da Meta', ...)
  // { estado: 'sem_dados', taxa: null }, e decidirRodada com ela → acao 'disparar'

test('ehUltimaRodada: verdadeiro às 18h37 BRT, falso às 17h37 e às 8h37', ...)

test('textoResumoDia traz saiu, restante, fila e a taxa do dia', ...)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/disparo-diario-calc.test.ts`
Expected: FAIL — `Cannot find module './disparo-diario-calc.ts'`

- [ ] **Step 3: Implementar `lib/disparo-diario-calc.ts`**

Ordem das guardas em `decidirRodada`, que é o que os testes fixam: fim de semana → janela → pausado → entrega em alerta → orçamento → fila. A hora e o dia da semana saem de `Intl.DateTimeFormat` com `timeZone: 'America/Sao_Paulo'` (`TZ=America/Sao_Paulo` no Git Bash devolve UTC — não usar). `quantidade = Math.min(TETO_DIA - jaSaiuHoje, filaPendente)`.

`textoPausa` devolve o texto do spec (seção "O alerta da pausa"), com a taxa formatada por `pct()` de `lib/entrega-meta-calc.ts`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:disparo`
Expected: PASS, 16 testes

- [ ] **Step 5: Criar a migração da tabela de estado**

`supabase/migrations/2026-10-11-disparo-estado.sql` com `sdr_disparo_estado` exatamente como no spec (uma linha, `id int primary key default 1 check (id = 1)`), mais o `insert` da linha inicial com `pausado = false`.

- [ ] **Step 6: Aplicar a migração no Supabase e confirmar a leitura**

Run: `node --env-file=.env.local -e "..."` lendo `sdr_disparo_estado`
Expected: uma linha, `pausado: false`

- [ ] **Step 7: Commit**

```bash
git add lib/disparo-diario-calc.ts lib/disparo-diario-calc.test.ts supabase/migrations/2026-10-11-disparo-estado.sql package.json
git commit -m "feat(disparo): regras puras do disparo diário + tabela de estado"
```

---

### Task 2: IO e rota do cron

**Files:**
- Create: `lib/disparo-diario.ts`
- Create: `app/api/sdr/disparo-diario/route.ts`

**Interfaces:**
- Consumes: tudo de Task 1; `conferirEntregaHoje()` de `lib/entrega-meta.ts`; `alertHuman(tel, texto)`; `flag` de `lib/req-flags`; `supabaseAdmin` de `lib/supabase`.
- Produces (usadas pela Task 3):
  - `lerEstado(): Promise<{ pausado: boolean; motivo: string | null; pausado_em: string | null }>`
  - `pausar(motivo: string): Promise<void>` — idempotente: se já pausado, não mexe em `pausado_em`
  - `retomar(porTelefone: string): Promise<boolean>` — `false` se já estava ativo
  - `resumoDoDia(): Promise<{ saiuHoje: number; restante: number; filaPendente: number; pausado: boolean; entrega: Entrega }>`

- [ ] **Step 1: Escrever o teste que falha** — acrescentar a `lib/disparo-diario-calc.test.ts` (o marcador é puro; o resto da task é IO)

```ts
test('marcarResultados: resultado ok → DISPARADO; ok=false → ERRO com detalhe', ...)
test('marcarResultados: lead sem linha em resultados fica PENDENTE (lote que estourou)', ...)
```

`marcarResultados(lote: Array<{id:string;telefone:string}>, resultados: Array<{telefone:string;ok:boolean;erro?:string}>): Array<{id:string;status:'DISPARADO'|'ERRO'|'PENDENTE';detalhe:string|null}>` mora em `lib/disparo-diario-calc.ts`.

O terceiro caso — lote que ficou `PENDENTE` — é o que faz a próxima rodada reprocessar esses leads. Duplicata é barrada pelo próprio `send-initial`, que recusa lead já existente.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:disparo`
Expected: FAIL — `marcarResultados is not a function`

- [ ] **Step 3: Implementar `marcarResultados` no calc, e `lib/disparo-diario.ts`**

`lib/disparo-diario.ts` faz, nesta ordem: lê estado · conta `jaSaiuHoje` (`sdr_mensagens`, `template_hsm = ROTULO`, `enviado_em >= ${diaBrt(agora)}T03:00:00.000Z`) · conta `filaPendente` · chama `conferirEntregaHoje()` **dentro de try/catch que devolve `{ estado: 'sem_dados' }` quando falha** (Review Focus 1) · chama `decidirRodada`.

Em `acao: 'disparar'`, puxa a fila ordenada por `avaliacoes desc nullsFirst:false`, depois `criado_em asc` — a mesma ordem de `scripts/disparar-fila.mjs` — e manda em lotes de 5 para `${APP_URL}/api/sdr/send-initial`, com `try/catch por lote` (Review Focus 3) e parada quando `Date.now() - inicio > TETO_TEMPO_MS`.

Em `acao: 'pausar'`, grava a pausa e manda `textoPausa(...)` por `alertHuman` para `ALDO_WHATSAPP` e `NEI_WHATSAPP`.

No fim de toda rodada, se `ehUltimaRodada(agora)` e não houve pausa, manda `textoResumoDia(await resumoDoDia())` pelos mesmos dois números. É o que o Aldo lê de viagem sem abrir nada.

- [ ] **Step 4: Rodar os testes**

Run: `npm run test:disparo`
Expected: PASS

- [ ] **Step 5: Escrever a rota** `app/api/sdr/disparo-diario/route.ts`

Molde de `app/api/sdr/retomada-interessado/route.ts`: `maxDuration = 300`, `executar(req)` com a checagem de `Bearer`, `flag(url.searchParams, 'dry')`, `export const GET = executar` **e** `export const POST = executar`. `?dry` devolve a decisão **passando pela mesma `decidirRodada`** e não envia nada. `?qtd=N` limita a rodada manual, nunca acima do restante do dia.

A resposta JSON traz `{ ok, acao, motivo, enviados, falhas, saiu_hoje, restante, fila_pendente, entrega: { estado, taxa, amostra }, cortado_por_tempo }` — `cortado_por_tempo` existe para o log não parecer erro quando a rodada para no teto.

- [ ] **Step 6: Conferir o `?dry` em produção**

Run: `curl -s -H "Authorization: Bearer $WEBHOOK_SECRET" "https://sdr-aiva.vercel.app/api/sdr/disparo-diario?dry=1"` (depois do deploy da Task 4)
Expected: `acao: "disparar"`, `fila_pendente: 29318`, `enviados: 0`

- [ ] **Step 7: Commit**

```bash
git add lib/disparo-diario.ts lib/disparo-diario-calc.ts lib/disparo-diario-calc.test.ts app/api/sdr/disparo-diario/route.ts
git commit -m "feat(disparo): rota do disparo diário com trava de entrega e orçamento por dia"
```

---

### Task 3: Comandos `/disparo`, `/pausar` e `/retomar`

**Files:**
- Modify: `lib/admin-commands.ts` (novo `case` no `switch` de `handleCommand`, e as três funções)

**Interfaces:**
- Consumes: `lerEstado`, `pausar`, `retomar`, `resumoDoDia` da Task 2.
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Escrever os testes que falham** — acrescentar a `lib/disparo-diario-calc.test.ts` os textos de resposta, que são puros

```ts
test('textoStatusDisparo: ativo mostra saiu/restante/fila e a taxa de entrega', ...)
test('textoStatusDisparo: pausado diz desde quando e manda usar /retomar', ...)
test('textoRetomado: confirma e diz que a próxima rodada volta a disparar', ...)
test('textoRetomado quando já estava ativo: diz que não estava pausado', ...)
```

`textoStatusDisparo(r: Resumo & { pausado_em: string | null; motivo: string | null }): string` e `textoRetomado(estavaPausado: boolean): string` ficam em `lib/disparo-diario-calc.ts`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:disparo`
Expected: FAIL

- [ ] **Step 3: Implementar os textos no calc e os três comandos em `lib/admin-commands.ts`**

`case '/disparo'` → `textoStatusDisparo(await resumoDoDia() + estado)`.
`case '/pausar'` → `pausar('pausado por <telefone> no WhatsApp')` e confirma.
`case '/retomar'` → `textoRetomado(await retomar(telefone))`.

Acrescentar as três linhas ao `/help` e ao `/ajuda`, que já existem no mesmo `switch`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:disparo` e `npx tsc --noEmit -p tsconfig.json`
Expected: PASS e typecheck limpo

- [ ] **Step 5: Commit**

```bash
git add lib/admin-commands.ts lib/disparo-diario-calc.ts lib/disparo-diario-calc.test.ts
git commit -m "feat(disparo): /disparo, /pausar e /retomar no WhatsApp do Aldo e do Nei"
```

---

### Task 4: Agendar, vigiar e rodar observado

**Files:**
- Modify: `vercel.json` (entrada nova no array `crons`)
- Modify: `app/api/sdr/vigia/route.ts` (uma linha no array de rotas vigiadas)
- Modify: `CLAUDE.md` (seção nova documentando a rotina)

**Interfaces:**
- Consumes: a rota da Task 2.
- Produces: nada.

- [ ] **Step 1: Acrescentar o cron ao `vercel.json`**

`{ "path": "/api/sdr/disparo-diario", "schedule": "37 11-21 * * 1-5" }` — o minuto `:37` é escolhido no spec (todo múltiplo de 5 já está ocupado; `:30` é da campanha-ativacao; e separa o disparo da retomada, que roda em `0 13-19` e gasta HSM do mesmo número).

- [ ] **Step 2: Acrescentar a rota ao vigia**

Em `app/api/sdr/vigia/route.ts`, no array de rotas: `{ rota: 'disparo-diario', tolerancia: 2, fila: (j) => n(j.fila_pendente), acao: (j) => n(j.enviados) }`. Tolerância 2 porque, diferente da biometria, essa rota tem fila cheia todo dia — dois dias úteis sem nenhum envio é anormal.

- [ ] **Step 3: Deploy**

Run: `npx vercel --prod --yes`
Expected: `readyState: READY`, alias `sdr-aiva.vercel.app`

- [ ] **Step 4: Rodada manual pequena, observada**

Run: `curl -s -H "Authorization: Bearer $WEBHOOK_SECRET" "https://sdr-aiva.vercel.app/api/sdr/disparo-diario?qtd=20"`
Expected: `enviados: 20`, `falhas: []`. Esperar 15 min e conferir o recibo com `?dry=1`: `entrega.amostra` cresceu.

**Este passo é a porta:** 20 antes de 500. Se a entrega vier abaixo do piso nesses 20, a rodada seguinte pausa sozinha — e é exatamente isso que se quer ver acontecer com o Aldo presente.

- [ ] **Step 5: Exercitar a trava de propósito**

Do WhatsApp do Aldo, nesta ordem: `/disparo` → `/pausar` → `/pausar` de novo → conferir que `?dry=1` devolve `acao: 'nada', motivo: 'pausado'` → `/retomar` → `/retomar` de novo → conferir que volta a `acao: 'disparar'`.

Expected: os comandos repetidos respondem o estado atual sem reescrever `pausado_em` nem dar erro, e o `?dry` acompanha. Repetir comando é o caso normal de quem está no celular sem ver a resposta.

- [ ] **Step 6: Documentar em `CLAUDE.md`**

Seção nova no padrão das outras rotinas: o que a rota faz, o teto, a janela, o piso de entrega, os três comandos, e **que a pausa não expira sozinha**. Mais a linha de que `scripts/disparar-fila.mjs` continua existindo para rodada manual e **consome o mesmo orçamento do dia**.

- [ ] **Step 7: Commit**

```bash
git add vercel.json app/api/sdr/vigia/route.ts CLAUDE.md
git commit -m "feat(disparo): agenda o disparo diário (11 rodadas, 500/dia) e põe no vigia"
```

---

## Depois do plano

A primeira semana é de medição, não de código. Todo dia útil, pelo `?dry=1` ou pelo `/disparo` no WhatsApp: quanto saiu, quanto sobrou e qual a taxa de entrega. Se sobrar fila todo dia, o ajuste é **mais rodadas**, não mais leads por rodada — o teto de 240s é a física da função, não um parâmetro.

A Parcelex entra só depois de a AIVA fechar um dia inteiro sozinha.
