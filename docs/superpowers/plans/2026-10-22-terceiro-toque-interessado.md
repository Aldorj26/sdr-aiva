# Terceiro toque e descarte dos interessados esgotados — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar destino aos ~1.450 interessados da AIVA que esgotaram a régua: um terceiro toque com oferta diferente para os quentes e descarte automático de quem está mudo há mais de 60 dias.

**Architecture:** Toda a regra nova entra em `lib/retomada-interessado-calc.ts` (puro, com suíte própria): `decidir` passa a devolver também `enviar toque 3` e `descartar`. A rota `retomada-interessado` já lê todos os leads e o silêncio de cada um; ela só ganha dois efeitos novos (envio do toque 3 com orçamento próprio e descarte com teto) e campos novos no JSON que o vigia e o briefing consomem.

**Tech Stack:** Next.js 15, TypeScript, Supabase (PostgREST), Evo Talks API, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-22-terceiro-toque-interessado-design.md`

## Global Constraints

- Nunca `git add -A`/`-a`/`.` — adicionar por nome. `CLAUDE.md` é gitignored.
- Push na `main` é deploy em produção: **não dar push**. Commits locais; o Aldo publica.
- Regra pura em `lib/*-calc.ts` com teste; IO só na rota.
- Silêncio = última mensagem `in` do lojista. Nunca `data_ultimo_contato`.
- Texto do toque 3 é o da spec, palavra por palavra, UMA linha, sem `\n`, sem link, < 320 caracteres, e só vai ao ar depois do OK do Aldo.
- `MAX_TOQUES` continua 2; o toque 3 é outra régua (marcador e orçamento próprios). Não renumerar `[RETOM_INT:n]`.
- Fecha com `npx tsc --noEmit -p tsconfig.json` limpo e `npm run test:retomada` verde.

## Review Focus

- **Lojista responde ao toque 3 e some de novo**: não pode ser descartado pelos "15 d após o toque 3"; `decidir` devolve `nada/respondeu_oferta` — Task 1.
- **Lead sem `evotalks_opportunity_id`**: descarta só no banco, sem erro e sem pular o lote — Task 2.
- **Evo fora do ar ao mover o card**: o lead fica como está (não vira DESCARTADO com card em 47) e entra em `falhas` — Task 2.
- **Rodada de hora em hora**: o teto de descarte (300) e o orçamento do toque 3 (100) são do DIA, contados pelo que já saiu hoje, não por rodada — Task 2.
- **Webhook do Evo ao mover para 53**: `opportunity-stage` precisa manter `sub_estado_descartado`; verificação em produção com 1 lead antes de liberar o teto — Task 5.

---

### Task 1: Regra pura — toque 3 e descarte em `retomada-interessado-calc`

**Files:**
- Modify: `lib/retomada-interessado-calc.ts`
- Test: `lib/retomada-interessado-calc.test.ts`

**Interfaces:**
- Produces:
  - `export const SILENCIO_DESCARTE_DIAS = 60`, `export const DIAS_DESCARTE_POS_T3 = 15`
  - `export const ORCAMENTO_DIA` ganha a chave `OFERTA: 100`; `export const ROTULO` ganha `OFERTA: 'aiva_retomada_oferta'`; `export const TETO_DESCARTE_DIA = 300`
  - `export const MIOLOS_OFERTA: { comDados: string; semDados: string }` (textos da spec)
  - `export function perfilQuente(obs: string | null | undefined, mensagensIn: number): boolean` — `[DADOS_COLETADOS:` presente **ou** `mensagensIn >= 3`
  - `Marcadores` ganha `toque3Ms: number | null` (de `[RETOM_INT3:ISO]`) e `descartado: boolean` (de `[DESCARTE_RETOMADA:`)
  - `Decisao` ganha `{ acao: 'enviar'; toque: 3 }` e `{ acao: 'descartar'; motivo: 'mudo_60d' | 'sem_resposta_oferta' }`
  - `decidir(m, diasSilencio, agora, ctx: { quente: boolean; ultimaInMs: number | null })` — 4º parâmetro novo; chamadas antigas com 3 parâmetros continuam válidas (`ctx` opcional, padrão `{ quente: false, ultimaInMs: null }`)
  - `remontarObs(obs, patch: { toque?: number; encerrar?: boolean; toque3?: boolean; descartar?: boolean })` — `toque3` grava `[RETOM_INT3:ISO]`, `descartar` grava `[DESCARTE_RETOMADA:ISO]`
  - `miolo(toque, temDados)` com `toque === 3` devolve `MIOLOS_OFERTA.comDados|semDados`
  - `montarFila(itens, maxInteressado, maxAguardando, maxOferta = 0)` — itens com `status === 'OFERTA'` entram por último, ordenados por `temDados` desc e `dias` desc, no máximo `maxOferta`

Ordem das verificações em `decidir` (as três primeiras já existem e vêm antes de tudo):
optout → pausa → **encerrado**: se `m.descartado` → `nada/descartado`; se `diasSilencio > SILENCIO_DESCARTE_DIAS` → `descartar/mudo_60d`; se `m.toque3Ms`: se `ctx.ultimaInMs > m.toque3Ms` → `nada/respondeu_oferta`, senão se `diasCorridos(toque3Ms, agora) >= DIAS_DESCARTE_POS_T3` → `descartar/sem_resposta_oferta`, senão `nada/aguardando_oferta`; se `!ctx.quente` → `nada/esperando_60d`; se `diasSilencio < SILENCIO_DIAS` → `nada/conversa_viva`; se `m.ultimoToqueMs` e `diasCorridos(ultimoToqueMs, agora) < DIAS_ENTRE_TOQUES` → `nada/aguardando D+8`; senão `enviar toque 3`. Lead **não** encerrado segue o fluxo atual sem mudança.

- [ ] **Step 1: Escrever os testes que falham** (em `lib/retomada-interessado-calc.test.ts`, mesmo estilo dos 17 existentes; `T0`, `DIA`, `iso` já definidos)

```ts
test('oferta: miolos em uma linha, sem link, < 320', () => {
  for (const m of [MIOLOS_OFERTA.comDados, MIOLOS_OFERTA.semDados]) { assert.doesNotMatch(m, /\n/); assert.doesNotMatch(m, /https?:\/\//); assert.ok(m.length < 320) }
  assert.equal(miolo(3, true), MIOLOS_OFERTA.comDados); assert.equal(miolo(3, false), MIOLOS_OFERTA.semDados)
})
test('perfil quente: dados coletados OU 3+ mensagens do lojista', () => {
  assert.equal(perfilQuente('[DADOS_COLETADOS:nome_socio=Ana]', 1), true)
  assert.equal(perfilQuente(null, 3), true); assert.equal(perfilQuente(null, 2), false)
})
test('esgotado e quente: toque 3 so depois de D+8 do toque 2 e com silencio >= 7', () => {
  const obs = remontarObs(remontarObs(null, { toque: 2 }, new Date(T0)), { encerrar: true })
  const q = { quente: true, ultimaInMs: T0 - 20 * DIA }
  assert.deepEqual(decidir(lerMarcadores(obs, T0 + DIA), 20, T0 + DIA, q), { acao: 'nada', motivo: `aguardando D+${DIAS_ENTRE_TOQUES}` })
  assert.deepEqual(decidir(lerMarcadores(obs, T0 + 8 * DIA), 28, T0 + 8 * DIA, q), { acao: 'enviar', toque: 3 })
  assert.deepEqual(decidir(lerMarcadores(obs, T0 + 8 * DIA), 28, T0 + 8 * DIA, { quente: false, ultimaInMs: null }), { acao: 'nada', motivo: 'esperando_60d' })
})
test('esgotado e mudo ha mais de 60 dias: descarta, quente ou nao', () => {
  const obs = remontarObs(null, { encerrar: true })
  for (const quente of [true, false]) assert.deepEqual(decidir(lerMarcadores(obs, T0), SILENCIO_DESCARTE_DIAS + 1, T0, { quente, ultimaInMs: null }), { acao: 'descartar', motivo: 'mudo_60d' })
  assert.notEqual(decidir(lerMarcadores(obs, T0), SILENCIO_DESCARTE_DIAS, T0, { quente: false, ultimaInMs: null }).acao, 'descartar')
})
test('depois do toque 3: 15 dias calado descarta; resposta ao toque 3 nao descarta', () => {
  const obs = remontarObs(remontarObs(null, { encerrar: true }), { toque3: true }, new Date(T0))
  const t = T0 + DIAS_DESCARTE_POS_T3 * DIA
  assert.deepEqual(decidir(lerMarcadores(obs, t), 30, t, { quente: true, ultimaInMs: T0 - DIA }), { acao: 'descartar', motivo: 'sem_resposta_oferta' })
  assert.deepEqual(decidir(lerMarcadores(obs, t - DIA), 29, t - DIA, { quente: true, ultimaInMs: T0 - DIA }), { acao: 'nada', motivo: 'aguardando_oferta' })
  assert.deepEqual(decidir(lerMarcadores(obs, t), 10, t, { quente: true, ultimaInMs: T0 + 2 * DIA }), { acao: 'nada', motivo: 'respondeu_oferta' })
})
test('marcadores novos: toque3 e descarte gravam uma vez e sao lidos de volta', () => {
  const o = remontarObs(remontarObs('[RETOM_INT_FIM]', { toque3: true }, new Date(T0)), { descartar: true }, new Date(T0 + DIA))
  const m = lerMarcadores(o, T0 + DIA)
  assert.equal(m.toque3Ms, T0); assert.equal(m.descartado, true); assert.equal(m.encerrado, true)
  assert.deepEqual(decidir(m, 90, T0 + DIA, { quente: true, ultimaInMs: null }), { acao: 'nada', motivo: 'descartado' })
  assert.equal((o.match(/\[DESCARTE_RETOMADA:/g) ?? []).length, 1)
})
test('montarFila: oferta tem teto proprio e vem depois das outras', () => {
  const it = (status: string, dias: number, temDados = false) => ({ status, dias, temDados })
  const fila = montarFila([it('OFERTA', 10, true), it('OFERTA', 40), it('OFERTA', 20, true), it('INTERESSADO', 9)], 5, 5, 2)
  assert.deepEqual(fila.map((f) => [f.status, f.dias]), [['INTERESSADO', 9], ['OFERTA', 20], ['OFERTA', 10]])
  assert.equal(montarFila([it('OFERTA', 10)], 5, 5).length, 0)
})
test('chamada antiga de decidir (3 parametros) continua igual', () => {
  assert.deepEqual(decidir(lerMarcadores(null, T0), SILENCIO_DIAS, T0), { acao: 'enviar', toque: 1 })
  assert.deepEqual(decidir(lerMarcadores(remontarObs(null, { encerrar: true }), T0), 30, T0), { acao: 'nada', motivo: 'esperando_60d' })
})
```

Ajustar o import do teste para incluir `MIOLOS_OFERTA, perfilQuente, SILENCIO_DESCARTE_DIAS, DIAS_DESCARTE_POS_T3`. O teste existente `'dois toques e acabou'` espera `{ acao: 'nada', motivo: 'encerrado' }` para o lead encerrado: trocar essa asserção para `'esperando_60d'` (o significado mudou de propósito).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:retomada`
Expected: FAIL (exports inexistentes / asserções de `decidir`).

- [ ] **Step 3: Implementar em `lib/retomada-interessado-calc.ts`** as constantes, `perfilQuente`, os campos novos de `Marcadores`/`lerMarcadores`, os ramos novos de `decidir` na ordem acima, `remontarObs` com `toque3`/`descartar` (regex de limpeza igual à de `[RETOM_INT:`), e `miolo(3, …)`. Atualizar o comentário de cabeçalho do arquivo (lista de marcadores) com `[RETOM_INT3:ISO]` e `[DESCARTE_RETOMADA:ISO]`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:retomada`
Expected: PASS, 25 testes.

- [ ] **Step 5: Commit**

```bash
git add lib/retomada-interessado-calc.ts lib/retomada-interessado-calc.test.ts
git commit -m "retomada: regra do toque 3 (oferta) e do descarte dos interessados esgotados"
```

---

### Task 2: Rota — enviar o toque 3 e executar o descarte

**Files:**
- Modify: `app/api/sdr/retomada-interessado/route.ts`

**Interfaces:**
- Consumes: tudo da Task 1.
- Consumes: `changeOpportunityStage(oppId: number, stageId: number)` e `STAGES.SEM_RESPOSTA` (= 53) de `lib/evotalks.ts`.
- Produces (JSON da rota, dry e real): `oferta: number` (toque 3 na fila de hoje), `descartar: number` (candidatos ao descarte hoje), `descartados: number` (efetivados nesta rodada), `por_status.OFERTA = { elegiveis_hoje, orcamento_dia, ja_enviados_hoje, nesta_rodada }`, `descarte = { teto_dia, ja_hoje, nesta_rodada }`, `nada` ganha os motivos novos. `exemplo_oferta: string | null` no dry.

- [ ] **Step 1: Ler a contagem de mensagens `in` e o silêncio por lead** — `textosIn.get(l.id)?.length ?? 0` já existe no laço de decisão; passar `decidir(…, { quente: perfilQuente(l.observacoes, nIn), ultimaInMs: ult })`. Incluir `evotalks_opportunity_id` no `select` de `sdr_leads` e no tipo `Lead`.

- [ ] **Step 2: Separar as decisões** — `enviar` continua; `encerrar` continua; novo array `descartar: Lead[]` para `acao === 'descartar'` (guardar o `motivo`). Itens com `toque === 3` vão para `enviar` com `status: 'OFERTA'` (chave de orçamento), mantendo o status real do lead à parte para o log.

- [ ] **Step 3: Orçamentos do dia** — `jaHoje(ROTULO.OFERTA)` junto dos dois existentes; `restanteHoje(ORCAMENTO_DIA.OFERTA, hojeOferta)`; parâmetro manual `?max_oferta=N` com o mesmo teto. Chamar `montarFila(enviar, max, maxAguardando, maxOferta)` (assinatura da Task 1).

- [ ] **Step 4: Descarte com teto do dia** — `jaDescartadosHoje` = `count` de `sdr_leads` com `status = 'DESCARTADO'` e `observacoes ilike '%[DESCARTE_RETOMADA:' + diaBrt(agora) + '%'`; `restanteDescarte = max(0, TETO_DESCARTE_DIA − jaDescartadosHoje)`. Para cada lead do lote (ordem: mais mudo primeiro), dentro do `TETO_TEMPO_MS`: se tem `evotalks_opportunity_id`, `changeOpportunityStage(id, STAGES.SEM_RESPOSTA)`; em erro → `falhas.push`, `continue`. Depois reler `observacoes` (como o envio já faz), `update({ status: 'DESCARTADO', acionar_humano: false, observacoes: remontarObs(fresco, { descartar: true }) })`. Log por lead: `[retomada-interessado] 🗑 ${nome} (${telefone}) — ${motivo}`.

- [ ] **Step 5: Envio do toque 3** — mesmo laço de envio; `template_hsm: ROTULO.OFERTA`; `remontarObs(fresco, { toque3: true })` em vez de `{ toque }`; `conteudo` com o miolo da oferta.

- [ ] **Step 6: Resumo e dry** — acrescentar os campos de Interfaces ao `resumo`; no dry, `exemplo_oferta` com o primeiro item de oferta da fila e `primeiros_descartes: fila de descarte .slice(0, 10).map(({ nome, telefone, dias, motivo }))`. Em modo dry nada é gravado (já é assim).

- [ ] **Step 7: Verificar tipos e rodar o dry local**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros.

Run (com `.env.local` carregado, servidor `npm run dev` no ar): `curl -s -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/sdr/retomada-interessado?dry=1" | jq '{elegiveis, enviar, oferta, descartar, nada, por_status, descarte, exemplo_oferta}'`
Expected: `oferta` e `descartar` > 0 (hoje ~ centenas); `nada.encerrado` deixa de existir e aparecem `esperando_60d`, `aguardando_oferta`; `exemplo_oferta` começa com `Oi ` e contém o texto da spec.

- [ ] **Step 8: Commit**

```bash
git add app/api/sdr/retomada-interessado/route.ts lib/retomada-interessado-calc.ts lib/retomada-interessado-calc.test.ts
git commit -m "retomada: toque 3 com oferta (100/dia) e descarte dos esgotados mudos 60d+ (teto 300/dia)"
```

---

### Task 3: Vigia enxerga as ações novas

**Files:**
- Modify: `app/api/sdr/vigia/route.ts:95`

- [ ] **Step 1: Trocar a linha da retomada** para `acao: (j) => n(j.enviar) + n(j.encerrar) + n(j.descartados ?? j.descartar)` e `fila: (j) => n(j.elegiveis)`. Tolerância continua 9.

- [ ] **Step 2: Verificar** `npx tsc --noEmit -p tsconfig.json` limpo e `curl … /api/sdr/vigia?dry=1` local mostrando a rota `retomada-interessado` com `acao > 0`.

- [ ] **Step 3: Commit**

```bash
git add app/api/sdr/vigia/route.ts
git commit -m "vigia: retomada conta toque 3 e descarte como acao"
```

---

### Task 4: Linha do bolsão no briefing diário

**Files:**
- Modify: `lib/pipeline-briefing.ts` (bloco das linhas, perto de `linhas.push(\`\`, \`🙋 *Aguardando atendimento humano…\`)` em :124)

**Interfaces:**
- Produces: `export async function contarEsgotados(): Promise<{ total: number; comOferta: number; descartadosHoje: number }>` — três `count: 'exact', head: true` em `sdr_leads` (`produto='AIVA'`): `status in (INTERESSADO, AGUARDANDO)` e `observacoes ilike '%[RETOM_INT_FIM]%'`; idem com `ilike '%[RETOM_INT3:%'`; `status='DESCARTADO'` e `observacoes ilike '%[DESCARTE_RETOMADA:<diaBrt hoje>%'`.

- [ ] **Step 1: Implementar `contarEsgotados`** e inserir a linha `♻️ *Esgotaram a régua: ${total}* (oferta enviada ${comOferta} · descartados hoje ${descartadosHoje})` logo após a linha de "Aguardando atendimento humano". Falha na contagem não derruba o briefing (try/catch, linha omitida).

- [ ] **Step 2: Verificar** `npx tsc --noEmit -p tsconfig.json` limpo; `curl … /api/sdr/briefing-pipeline?dry=1` (se a rota aceitar dry; senão chamar `buildBriefingPipeline()` num `node -e` com o env carregado) e conferir a linha.

- [ ] **Step 3: Commit**

```bash
git add lib/pipeline-briefing.ts
git commit -m "briefing: linha dos interessados que esgotaram a regua"
```

---

### Task 5: Liberação em produção (Aldo) e limpeza do Evo

Nada aqui é código. Ordem importa.

- [ ] **Step 1: Aprovar o texto do toque 3** (spec, seção "Oferta diferente"). Se o Aldo preferir a alternativa do CNPJ, trocar `MIOLOS_OFERTA` na Task 1 e confirmar antes que a VictorIA (`prompts/aiva.ts`) saiba conduzir a pré-aprovação; essa mudança de prompt passa pelo agente `revisor-prompt-victoria`.
- [ ] **Step 2: Publicar** (push pelo Aldo). Rodar em produção `GET /api/sdr/retomada-interessado?dry=1` e confrontar `descartar` e `oferta` com a SQL do parecer (esperado: descartar ≈ 223 + os 60d+ que entraram desde 22/10; oferta ≤ 100).
- [ ] **Step 3: Teste de 1 lead**: `GET …/retomada-interessado?max=0&max_aguardando=0&max_oferta=1` numa rodada manual; conferir no Evo que o card foi para 53 só no descarte e que o lead descartado continua `DESCARTADO` 15 min depois (webhook não reviveu: log `sub_estado_descartado` em `opportunity-stage`). Depois `?max_oferta=0` com 1 descarte: confirmar o mesmo.
- [ ] **Step 4: Deixar o cron seguir** (ele já chama sem parâmetro). No dia seguinte conferir no briefing a linha ♻️ e no vigia o estado da rota.
- [ ] **Step 5: Evo — excluir as automações soltas 80 e 81** (`automations_delete` via MCP Omni, com o OK do Aldo): nenhuma etapa aponta para elas (`stagnationautomation = 0` em 47 e 53) e a régua mora no código.
- [ ] **Step 6: HANDOFF** (`docs/HANDOFF.md`): registrar marcadores novos, tetos, e que o descarte move o card para 53.
