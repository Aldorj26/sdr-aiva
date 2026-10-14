# Pré-aprovação pela AIVA — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar a trava pela base Odres/UME do início do funil e passar a decisão para a AIVA, avisando o lojista quando ela recusa.

**Architecture:** A decisão da recusa já é calculada por `calcularEspelho` e aplicada pelo passo 6 de `lib/espelho-portal.ts` (card para 95, lead travado, time avisado). O que entra é uma mensagem ao lojista nesse mesmo ponto, com texto e regra de prompt isolados numa `lib/*-calc.ts` pura, no padrão do repo. A trava da base sai do webhook por último, quando o aviso já estiver funcionando.

**Tech Stack:** Next.js 15, TypeScript, Supabase, Evo Talks API, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-14-pre-aprovacao-aiva-design.md`

## Global Constraints

- Nunca `git add -A`/`-a`/`.` — adicionar por nome. `CLAUDE.md` é gitignored.
- Push na `main` é deploy em produção: **não dar push**. Commits locais apenas.
- Regra pura vai em `lib/*-calc.ts` com suíte própria; IO fica no arquivo sem `-calc`.
- Segredos nunca em prompt, log, docs ou commit.
- A mensagem ao lojista é a da spec, palavra por palavra. Ela não pode alegar motivo, prometer reanálise nem mandar o lojista procurar a AIVA.
- Fecha com `npx tsc --noEmit -p tsconfig.json` limpo.

## Review Focus

- **Lead sem nome** (`nome` nulo ou vazio no banco): a mensagem não pode sair como "Oi !" — Task 1.
- **Reprovado já avisado**: o espelho roda a cada 15 min; a mensagem não pode repetir a cada rodada. Já coberto pelo teste de `lib/espelho-portal-calc.test.ts:170`, que afirma o `jaAvisado`; a Task 2 só precisa pendurar o envio nessa mesma guarda.
- **Lead reprovado sem telefone**: não tentar enviar e não quebrar a rodada — Task 2.
- **Falha no `sendText`** (Evo fora do ar): não pode derrubar a rodada nem impedir o card de ir para 95 — Task 2.
- **Lojista responde depois da recusa**: a VictorIA não pode reabrir a coleta nem pedir dados — Task 1 e 3.

---

### Task 1: Texto da recusa e regra de prompt (puro)

**Files:**
- Create: `lib/recusa-aiva-calc.ts`
- Create: `lib/recusa-aiva-calc.test.ts`
- Modify: `package.json` (script `test:recusa`)

**Interfaces:**
- Consumes: `MARCADOR_REPROVADO` de `lib/espelho-portal-calc.ts` (valor `'PORTAL_REPROVADO'`).
- Produces: `mensagemRecusaAiva(nome: string | null): string` e `blocoRecusaAiva(status: string, observacoes: string | null): string | null`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
test('mensagem usa só o primeiro nome', () => {
  const m = mensagemRecusaAiva('João Carlos da Silva')
  assert.ok(m.startsWith('Oi João!'))
})

test('sem nome, abre sem saudação quebrada', () => {
  for (const n of [null, '', '   ']) {
    const m = mensagemRecusaAiva(n)
    assert.ok(!m.includes('Oi !'), `abertura quebrada: ${m}`)
    assert.ok(m.length > 40)
  }
})

test('nunca alega motivo, reanálise ou manda procurar a AIVA', () => {
  const m = mensagemRecusaAiva('Ana').toLowerCase()
  for (const proibido of ['distribuidor', 'concorrent', 'reanális', 'reanalis', 'recurso', 'entre em contato com a aiva']) {
    assert.ok(!m.includes(proibido), `proibido: ${proibido}`)
  }
  assert.ok(m.includes('não foi aprovado'))
})

test('bloco do prompt só existe pra reprovado travado', () => {
  const obs = '[PORTAL_REPROVADO:2026-10-14T12:00:00.000Z]'
  assert.equal(blocoRecusaAiva('INTERESSADO', obs), null)
  assert.equal(blocoRecusaAiva('NAO_QUALIFICADO', null), null)
  const b = blocoRecusaAiva('NAO_QUALIFICADO', obs)
  assert.ok(b && b.includes('[INSTRUÇÃO DO SISTEMA]') && b.includes('[FIM]'))
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:recusa`
Esperado: FAIL — módulo não existe.

- [ ] **Step 3: Implementar as duas funções em `lib/recusa-aiva-calc.ts`**

`mensagemRecusaAiva` devolve o texto da spec (seção "3. Avisar o lojista na recusa"), com o primeiro nome interpolado; sem nome utilizável, abre com `Oi!`.
`blocoRecusaAiva` devolve `null` salvo quando `status === 'NAO_QUALIFICADO'` e `observacoes` contém `[PORTAL_REPROVADO:` — aí devolve um bloco no formato dos demais de `lib/claude.ts` (`[INSTRUÇÃO DO SISTEMA]` … `[FIM]`) instruindo: não reabrir cadastro, não pedir dados, não prometer reanálise, responder com educação, manter `novo_status="NAO_QUALIFICADO"`, `OPT_OUT` se pedir para parar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:recusa` · Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recusa-aiva-calc.ts lib/recusa-aiva-calc.test.ts package.json
git commit -m "feat: texto da recusa da AIVA e regra de prompt do lead reprovado"
```

---

### Task 2: Espelho avisa o lojista na recusa

**Files:**
- Modify: `lib/espelho-portal-calc.ts` (tipos `LeadEspelho` e `Reprovado`)
- Modify: `lib/espelho-portal.ts:132` (select) e o passo 6, `lib/espelho-portal.ts:375-387`
- Test: `lib/espelho-portal-calc.test.ts`

**Interfaces:**
- Consumes: `mensagemRecusaAiva` da Task 1; `sendText` de `lib/evotalks`, já importado em `espelho-portal.ts:21`; `saveMensagem` de `lib/supabase`.
- Produces: `LeadEspelho` passa a carregar `telefone: string | null` e `evotalks_chat_id: string | number | null` (nomes iguais aos do `select`); `Reprovado` passa a carregar `telefone: string | null` e `chatId: string | number | null`.

- [ ] **Step 1: Escrever o teste que falha**

Estender o teste que já existe em `lib/espelho-portal-calc.test.ts:170` ("reprovado: vai pra 95 de qualquer etapa; avisa só uma vez…"), que já monta três leads reprovados e já cobre o `jaAvisado`. Dar telefone e chat ao lead `novo`, deixar o lead `descartado` sem telefone, e somar ao fim do teste:

```ts
assert.equal(r.reprovados[0].telefone, '5547999990000')
assert.equal(r.reprovados[0].chatId, 1234)
// lead sem telefone no banco: chega como null e o envio é pulado lá no espelho
assert.equal(r.reprovados[2].telefone, null)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:espelho` · Esperado: FAIL — propriedade não existe no tipo.

- [ ] **Step 3: Levar telefone e chat até o `Reprovado`**

Somar `telefone: string | null` e `chatId: string | number | null` a `LeadEspelho` e a `Reprovado` em `lib/espelho-portal-calc.ts`, preenchendo-os onde o reprovado é montado. Em `lib/espelho-portal.ts:132`, incluir `telefone` e `evotalks_chat_id` no `select`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:espelho` · Esperado: PASS.

- [ ] **Step 5: Enviar a mensagem no passo 6**

Em `lib/espelho-portal.ts`, dentro do laço de `r.reprovados`, depois do `changeOpportunityStage` e do `update` que grava `NAO_QUALIFICADO`, e **somente quando `!x.jaAvisado` e `x.telefone`**: `sendText(x.telefone, mensagemRecusaAiva(x.nome), x.chatId)` seguido de `saveMensagem(x.lead_id, 'out', <mesmo texto>)`.

Envolver em `try/catch` próprio: falha de envio empurra uma linha em `avisos` e segue — não pode impedir o `marcar(...)` nem o resto da rodada. Sem telefone, registrar em `avisos` e não tentar enviar.

A guarda de repetição é a que já existe: `jaAvisado` vem do marcador `[PORTAL_REPROVADO:` e é o mesmo que decide o alerta ao time, então a mensagem sai uma vez por lead.

- [ ] **Step 6: Conferir sem enviar nada**

Run: `npx tsc --noEmit -p tsconfig.json` · Esperado: sem erros.
Depois, com o servidor local, chamar a rota do espelho com `?dry` e conferir no log quem entraria na mensagem. Nenhum envio pode sair em `?dry`.

- [ ] **Step 7: Commit**

```bash
git add lib/espelho-portal-calc.ts lib/espelho-portal-calc.test.ts lib/espelho-portal.ts
git commit -m "feat: avisar o lojista quando a AIVA recusa o pré-cadastro"
```

---

### Task 3: A VictorIA sabe da recusa

**Files:**
- Modify: `lib/claude.ts:782` (junto do bloco de `preCadastroNaoChegou`)

**Interfaces:**
- Consumes: `blocoRecusaAiva` da Task 1.

- [ ] **Step 1: Ligar o bloco**

Importar `blocoRecusaAiva` e, no mesmo trecho onde os blocos por fase são concatenados em `faseInstrucao`, somar o retorno quando ele não for `null`, usando `lead.status` e `lead.observacoes`. Mesmo padrão de concatenação do bloco vizinho.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit -p tsconfig.json` · Esperado: sem erros.
Run: `npm run test:recusa` · Esperado: PASS (a regra já é testada na Task 1).

- [ ] **Step 3: Commit**

```bash
git add lib/claude.ts
git commit -m "feat: VictorIA reconhece o lead reprovado pela AIVA e não reabre a coleta"
```

---

### Task 4: Sai a trava pela base Odres/UME

**Files:**
- Modify: `app/api/sdr/webhook/route.ts:1665-1709`
- Modify: `scripts/importar-base-aiva.mjs` (cabeçalho de aposentadoria)

**Interfaces:**
- Consumes: nada das tarefas anteriores. É a última porque só deve entrar com o aviso de recusa já funcionando.

- [ ] **Step 1: Remover a consulta à base**

Em `app/api/sdr/webhook/route.ts`, apagar: a consulta a `aiva_base_cnpjs`, a variável `naBaseAiva`, a atribuição `resposta.novo_status = ehOdres ? 'ODRES' : 'UME'` e o alerta 📇 "LEAD JÁ É DA BASE" (Nei e Aldo).

A condição da Receita, hoje `if (!naBaseAiva && !jaClienteOutroCanal)`, passa a `if (!jaClienteOutroCanal)`.

**Não remover** os status `ODRES` e `UME` de `lib/claude.ts`, `lib/supabase.ts`, `lib/desistencia.ts` nem as chamadas de `transferirParaFunil19` nas linhas 1833, 1849 e 2612: esse caminho continua valendo quando o próprio lojista diz que já trabalha com Odres ou UME.

- [ ] **Step 2: Aposentar o script de importação**

Somar no topo de `scripts/importar-base-aiva.mjs` um comentário dizendo que foi aposentado em 14/10/2026, que o relatório do Data Studio deixou de ser exportável (última gravação 02/10) e que a decisão passou para a pré-aprovação da AIVA. O script e a tabela ficam, sem leitor no fluxo.

- [ ] **Step 3: Verificar que nada mais lê a base**

Run: `grep -rn "aiva_base_cnpjs" app lib --include=*.ts`
Esperado: nenhuma linha. (Em `scripts/` as referências históricas permanecem.)
Run: `npx tsc --noEmit -p tsconfig.json` · Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add app/api/sdr/webhook/route.ts scripts/importar-base-aiva.mjs
git commit -m "feat: quem decide quem entra é a AIVA — sai a trava pela base Odres/UME"
```

---

## Depois de publicar

A tarefa agendada `importar-base-aiva-diaria` já foi desligada em 14/10/2026, antes desta implementação.

Trinta dias depois do deploy, medir o que a spec pede: quantas lojas em `not_approved` no portal da AIVA, contra as 26 de hoje.
