# Disparo diário — Parcelex inteira + itens de viagem (AIVA) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Antes de 30/10, a AIVA fica confiável sem ninguém olhando (feriados, lock, alerta por coringa, "quebrou" avisa na hora) e a Parcelex passa a disparar sozinha com a mesma trava, os mesmos comandos e o mesmo gate pausado.

**Architecture:** A AIVA já em produção é a implementação de referência. Tarefas 1–2 endurecem a AIVA (dois repos tocados: só `sdr-aiva`). Tarefas 3–5 espelham `lib/disparo-diario-calc.ts`, `lib/disparo-diario.ts`, a rota e os comandos em `sdr-parcelex`, trocando o que a tabela do adendo do spec lista. Regras puras em `*-calc.ts` com `node --test`; IO separado; `?dry` pela mesma decisão.

**Tech Stack:** Next.js 15, TypeScript, Supabase (AIVA `axkrorkhnkfkpbjikwrb`, Parcelex `bvklfrlxukfsqbwiyfuy`), Evo Talks, cron Vercel, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-11-disparo-diario-automatico-design.md` — ler o **Adendo de 11/10 (noite)** antes de qualquer tarefa; ele manda sobre o corpo do spec onde diferem.

**Ledger do plano anterior** (23 minors adiados, rulings): `docs/superpowers/plans/2026-10-11-disparo-diario-aiva.ledger.md`.

## Global Constraints

- Teto **500/dia útil por empresa**. Janela **8h–19h BRT**. Rodada **240_000 ms**; lote só começa com **≥100 s** restantes. Piso de entrega **30%** (`PISO_TAXA`), amostra mínima 12; `sem_dados` dispara.
- **A pausa não expira na virada do dia; só `/retomar` limpa.** `pausar()` idempotente, `retomar()` devolve `false` se não estava pausado. Depois de `/retomar`, a amostra de entrega recomeça de `retomado_em`.
- Contagem do dia deriva da tabela de mensagens pelo rótulo (AIVA `aiva_campanha`; Parcelex `parcelex_d1b` **e** `parcelex_d1`), nunca de contador.
- **Feriados** (`FERIADOS`, ambos os repos): `2026-10-12, 2026-11-02, 2026-11-15, 2026-11-20, 2026-12-25, 2027-01-01`. Formato `YYYY-MM-DD` no dia civil BRT.
- **Lock de fatia:** chave `disparo:<YYYY-MM-DD>T<HH>:<fatia>` com `fatia = floor(minuto/20)`; inserção com conflito → `nada`, motivo `fatia_ocupada`.
- Alertas (pausa, resumo, quebrou): coringa **e** texto livre; variável de template é UMA linha, sem `\n`; dois destinatários em paralelo, 20 s cada; estado gravado antes do alerta.
- Cron chama por **GET**; `?dry` por `flag()`; auth `Bearer ${WEBHOOK_SECRET}` ou `Bearer ${CRON_SECRET}`.
- Parcelex: cron **`17,47 11-21 * * 1-5`**; lote **20**; status da fila em **minúsculo**; `reconciliar()` antes de puxar a fila.
- **Nada de deploy, escrita em produção ou WhatsApp por subagente.** Deploy, migrações e a rodada observada são do controlador.
- Nenhum `CLAUDE.md` entra no git (os dois são gitignored, têm chaves).

## Review Focus

1. **Feriado que cai em dia de semana** (02/11 é segunda) — `decidirRodada` e `isDiaUtil()` ambos devem negar; o `send-initial` da Parcelex usa `isDiaUtil()`, logo precisa do mesmo conjunto. *(T1, T5)*
2. **Duas rodadas na mesma fatia** — a segunda inserção da chave falha e a rodada sai com `fatia_ocupada`, sem tocar a fila. A chave do minuto 47 e a do 07 seguinte são fatias diferentes. *(T1, T4)*
3. **Alerta com Evo pendurado** — 20 s por destinatário, `allSettled`; a rodada termina e devolve seus contadores mesmo se os dois alertas estourarem. *(T2)*
4. **`/retomar` de número que não é da equipe (Parcelex)** — cai no fluxo normal da Patricia, nenhum estado muda. *(T5)*
5. **Reconciliação marca `disparado` sem `lead_id` quando o telefone está em `patricia_leads` mas com formatação diferente** — comparar por dígitos, como o script faz. *(T4)*

---

### Task 1 (AIVA): feriados + lock de fatia

**Files:**
- Modify: `sdr-aiva/lib/business-time.ts` (exportar `FERIADOS` e `ehFeriado(diaISO: string): boolean`; `isDiaUtil()` passa a consultar)
- Modify: `sdr-aiva/lib/disparo-diario-calc.ts` (guarda `feriado`; `chaveDaFatia(agoraMs: number): string`)
- Modify: `sdr-aiva/lib/disparo-diario.ts` (inserir a chave antes de puxar a fila)
- Test: `sdr-aiva/lib/disparo-diario-calc.test.ts` (hoje 34 testes)

**Interfaces:**
- Produces: `FERIADOS: ReadonlySet<string>`, `ehFeriado(diaISO)`, `chaveDaFatia(agoraMs)`, novo motivo `'feriado' | 'fatia_ocupada'` em `Decisao['nada']`.
- `decidirRodada` ganha `fatiaOcupada: boolean` na entrada (default `false`).

- [ ] **Step 1: Testes que falham** (acrescentar)

```ts
test('02/11/2026 (segunda, Finados) → nada, motivo feriado', ...)   // agoraMs = 2026-11-02T14:00:00Z
test('03/11/2026 (terça) → dispara normalmente', ...)
test('ehFeriado usa o dia civil BRT: 2026-11-02T02:30:00Z ainda é 01/11', ...)
test('chaveDaFatia: 11:07Z e 11:19Z → mesma fatia 0; 11:27Z → fatia 1; 21:47Z → disparo:2026-10-13T18:2', ...)
test('fatiaOcupada → nada, motivo fatia_ocupada, antes do orçamento', ...)
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:disparo` → FAIL em `ehFeriado`/`chaveDaFatia` não exportados
- [ ] **Step 3: Implementar.** Ordem das guardas vira: fim de semana → **feriado** → janela → pausado → **fatia ocupada** → alerta → orçamento → fila. `chaveDaFatia` usa hora/minuto BRT (o `relogioBrt` já existe no calc — expor o minuto). No IO, logo após `lerEstado`: `supabaseAdmin.from('sdr_avisos_chave').insert({ chave, ultimo_aviso: now })` — erro de conflito (`23505`) → `fatiaOcupada = true`; qualquer outro erro lança.
- [ ] **Step 4: Rodar e ver passar** — `npm run test:disparo` 39/39; `npx tsc --noEmit -p tsconfig.json`
- [ ] **Step 5: Commit** — `feat(disparo): feriados nacionais e lock de fatia`

---

### Task 2 (AIVA): alertas por coringa, em paralelo, e "quebrou"

**Files:**
- Create: `sdr-aiva/lib/alerta-equipe.ts`
- Modify: `sdr-aiva/lib/disparo-diario.ts` (`avisarTime` passa a usar o novo módulo)
- Modify: `sdr-aiva/app/api/sdr/disparo-diario/route.ts` (try/catch em volta de `rodada()`)
- Modify: `sdr-aiva/lib/disparo-diario-calc.ts` (`teaserPausa`, `teaserResumo`, `teaserQuebrou` — uma linha cada, sem `\n`)
- Test: `sdr-aiva/lib/disparo-diario-calc.test.ts`

**Interfaces:**
- Produces: `avisarEquipe(detalhe: string, teaser: string, opts?: { chaveDedupe?: string; janelaMs?: number }): Promise<{ enviados: number; falhas: number }>` — para cada número em `[ALDO_WHATSAPP, NEI_WHATSAPP]`: `sendTemplate(tel, AIVA_REATIVACAO_TEMPLATE_ID, [primeiroNome, teaser])` **e** `alertHuman(tel, detalhe)`, tudo via `Promise.allSettled`, cada chamada em `Promise.race` com 20_000 ms. Dedupe opcional por `sdr_avisos_chave` (mesmo padrão do vigia).
- Consumes: `sendTemplate(number, templateId, vars)` e `alertHuman(tel, texto)` de `lib/evotalks.ts`.

- [ ] **Step 1: Testes que falham**

```ts
test('teaserPausa: uma linha, sem \\n, cita a taxa e manda responder /retomar', ...)
test('teaserResumo: uma linha com saiu/restante', ...)
test('teaserQuebrou: uma linha com o motivo truncado em 120 chars', ...)
test('teasers nunca contêm \\n mesmo com motivo multilinha', ...)
```

- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar.** Na rota: `try { return await rodada(...) } catch (e) { await avisarEquipe(detalhe, teaserQuebrou(msg), { chaveDedupe: 'disparo_quebrou:' + horaBrt, janelaMs: 3_600_000 }); throw e }` — o 500 continua saindo. Os textos longos existentes (`textoPausa`, `textoResumoDia`) viram o `detalhe`.
- [ ] **Step 4: Rodar e ver passar**; typecheck
- [ ] **Step 5: Commit** — `feat(disparo): alertas pelo HSM 48 em paralelo com timeout + alerta imediato de rodada quebrada`

---

### Task 3 (Parcelex): base — req-flags, recibo de entrega, calc, estado

**Files (em `sdr-parcelex`):**
- Create: `lib/req-flags.ts` (cópia da AIVA)
- Create: `lib/entrega-meta-calc.ts` (cópia da AIVA, intacta) + `lib/entrega-meta-calc.test.ts` (cópia)
- Create: `lib/entrega-meta.ts` (IO sobre `patricia_mensagens`/`patricia_leads`; mesma assinatura `conferirEntregaHoje(agora?, desde?)`)
- Create: `lib/disparo-diario-calc.ts` + `.test.ts` (cópia da AIVA com as trocas abaixo)
- Create: `docs/sql/2026-10-11-parcelex-disparo-estado.sql` (tabelas `parcelex_disparo_estado` e `parcelex_avisos_chave`, RLS ligada nas duas, linha semeada)
- Modify: `lib/business-time.ts` (`FERIADOS`, `ehFeriado`, `isDiaUtil` consulta)
- Modify: `package.json` (`"test:disparo": "node --test lib/disparo-diario-calc.test.ts lib/entrega-meta-calc.test.ts"`)

**Trocas no calc:** `ROTULOS = ['parcelex_d1b', 'parcelex_d1']` (array, não string); `LOTE = 20`; status `'pendente' | 'disparado' | 'erro' | 'duplicado'` em `marcarResultados`; `ehUltimaRodada` = hora 18 e minuto ≥ 40 (a rodada das 18h47 segue sendo a última). Tudo o mais igual, inclusive os nomes exportados — a Task 4 importa pelos mesmos nomes da AIVA.

**⚠️ Para o implementador verificar antes de escrever o IO do recibo:** onde a Parcelex guarda o `chatId` do Evo por lead (na AIVA é `sdr_leads.evotalks_chat_id`) e qual função de `lib/evotalks.ts` lê mensagens do chat. Se não houver, usar `/int/getClientOpenChats` pelo número, como a AIVA faz quando o chat está velho (CLAUDE.md da AIVA, seção "Recibo de entrega").

- [ ] **Step 1:** copiar calc+testes, aplicar as trocas, rodar — os testes de rótulo/lote/status falham → ajustar os testes para os valores Parcelex
- [ ] **Step 2:** `npm run test:disparo` passa (≥ 39 + os de entrega-meta-calc); `npx tsc --noEmit -p tsconfig.json`
- [ ] **Step 3:** DDL — mesmo texto de `sdr-aiva/docs/sql/2026-10-11-disparo-estado.sql` com os nomes Parcelex, mais `parcelex_avisos_chave (chave text primary key, ultimo_aviso timestamptz not null, criado_em timestamptz default now())` e `enable row level security` nas duas. **Não aplicar.**
- [ ] **Step 4: Commit** — `feat(disparo): base do disparo diário na Parcelex (calc, recibo de entrega, feriados, DDL)`

---

### Task 4 (Parcelex): IO + rota

**Files:** Create `lib/disparo-diario.ts`, `app/api/sdr/disparo-diario/route.ts`.

**Interfaces (iguais à AIVA):** `lerEstado`, `pausar`, `retomar`, `resumoDoDia(): Promise<Resumo>`, `rodada(opts)`, `ResultadoRodada` com `saiu_hoje` e `fila_pendente`.

**Diferenças, todas no IO:**
- Antes de puxar a fila: `reconciliar()` — `parcelex_prospeccao` `status=pendente` × `patricia_leads` criados nos últimos 7 dias, comparando **dígitos** do telefone; achados viram `disparado` + `disparado_em` + `lead_id`. Devolve a contagem para o JSON (`reconciliados`).
- Fila: `.eq('status','pendente').order('prioridade').order('avaliacoes', { ascending: false, nullsFirst: false })`, colunas `telefone, loja, cidade, uf`; corpo do `send-initial` = `{ leads: [{ nome: loja, telefone, cidade }] }`; lote 20; contagem do dia com `.in('template_hsm', ROTULOS)`.
- Marcação: `disparado` também grava `lead_id` quando `resultados[].lead_id` vier.
- Lock: `parcelex_avisos_chave`, mesma chave.
- Alertas: **`avisarEquipe(numerosEquipe(), detalhe, teaser)` de `lib/equipe.ts`** — já faz texto-ou-teaser-HSM; passar `{ semFiltro: true }` no alerta de pausa (tem que repetir se pausar duas vezes no mês).
- Rota: `try/catch` com alerta "🚨 disparo Parcelex quebrou" como na Task 2.

- [ ] **Step 1:** teste puro de `marcarResultados` com `lead_id` e de `reconciliar` extraído em função pura `casarPendentesComLeads(pendentes, leads): Array<{telefone, lead_id}>` (compara dígitos)
- [ ] **Step 2:** implementar; `?dry` local devolve `{ acao, motivo, reconciliados, fila_pendente, saiu_hoje }`; typecheck
- [ ] **Step 3: Commit** — `feat(disparo): rota do disparo diário da Parcelex com reconciliação, lock e trava de entrega`

---

### Task 5 (Parcelex): comandos no webhook, cron, docs

**Files:** Modify `app/api/sdr/webhook/route.ts` (desvio admin no topo do `POST`, depois do `x-internal-secret` e do parse do payload), Create `lib/admin-commands.ts` (porte mínimo: `isAdmin` tolerante ao 9º dígito, `isCommand`, `handleCommand` só com `/disparo`, `/pausar`, `/retomar`, `/ajuda`), Modify `vercel.json`, `CLAUDE.md` (disco).

- [ ] **Step 1:** testes dos textos (`textoStatusDisparo`, `textoRetomado`, `textoPausadoAgora`, `textoJaPausado`) — copiar da AIVA com "Parcelex" no lugar de "AIVA"
- [ ] **Step 2:** desvio: `if (isAdmin(telefone) && isCommand(texto)) { const resposta = await handleCommand(telefone, texto); await sendText(telefone, resposta); return 200 }` — **antes** de qualquer lógica da Patricia; a resposta sai como texto livre (a pessoa acabou de escrever, janela aberta)
- [ ] **Step 3:** `vercel.json`: `{ "path": "/api/sdr/disparo-diario", "schedule": "17,47 11-21 * * 1-5" }`
- [ ] **Step 4:** `CLAUDE.md` da Parcelex: seção espelho da AIVA (500/dia, janela, 22 rodadas, piso, comandos, pausa não expira, `prospeccao-onda.mjs` gasta o mesmo orçamento e **não pode rodar com o cron armado**, responder o briefing das 5h na viagem)
- [ ] **Step 5:** `npm run test:disparo`, typecheck, commit — `feat(disparo): /disparo, /pausar e /retomar no webhook da Parcelex + cron`

---

### Task 6 (controlador): migrações, deploys pausados, rodada observada

- [ ] Aplicar `parcelex-disparo-estado.sql` em `bvklfrlxukfsqbwiyfuy`; verificar anon negado nas duas tabelas
- [ ] Gravar `parcelex_disparo_estado` como **pausado** com motivo
- [ ] Deploy AIVA (Tasks 1–2) e Parcelex (3–5) — `npx vercel --prod --yes` em cada pasta; `?dry=1` em produção nos dois: `fila_pendente` > 0, `motivo` coerente com o dia
- [ ] **Com o Aldo:** na Parcelex, `/disparo → /retomar → /retomar → (rodada) → /disparo → /pausar → /pausar → /retomar`; às 18h47 o resumo chega **pelo coringa** nos dois números
- [ ] Forçar um "quebrou" controlado em staging? Não há staging — validar por teste unitário da rota com `rodada` mockada para lançar, e conferir no log da Vercel que o alerta saiu na primeira exceção real
- [ ] Merge local em `main`, push (a integração Git deploya sozinha — confirmar `Ready` e repetir o `?dry`)
