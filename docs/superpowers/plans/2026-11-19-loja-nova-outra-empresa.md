# Loja nova de outra empresa (cliente ativo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cliente que já opera a AIVA pede, no mesmo WhatsApp, o cadastro de uma loja de OUTRA empresa (raiz de CNPJ diferente) e é conduzido pela VictorIA até receber o link de cadastro, sem aprovação humana.

**Architecture:** O sistema (não o modelo) classifica o CNPJ novo pela raiz e confere a Receita antes da resposta da VictorIA; o resultado chega a ela como bloco dinâmico do prompt. O pedido vive como linha em `sdr_registros_cnpj` dentro do MESMO lead, cai na fila de pré-cadastro que já existe no `/atendimento`, e o espelho manda o link quando a AIVA registrar o pré-cadastro (`dados_varejo`) e o aviso quando a loja for criada — os dois por CNPJ.

**Tech Stack:** Next.js 15 + TypeScript, Supabase, `node --test` (regras puras em `lib/*-calc.ts`), Evo Talks.

**Spec:** `docs/superpowers/specs/2026-11-19-loja-nova-outra-empresa-design.md`

## Global Constraints

- **Nada vai a produção sem o OK do Aldo.** Push na `main` = deploy. Commits locais por tarefa; push só no fim, com os textos aprovados.
- Git: `git add` SEMPRE por nome de arquivo. `CLAUDE.md` nunca.
- Mudança em `prompts/aiva.ts` passa pelo agente `revisor-prompt-victoria` (`.claude/agents/revisor-prompt-victoria.md`, rodar num `general-purpose`) e corrige TODAS as passagens da regra.
- SQL é aplicado à mão pelo Aldo/sessão com OK dele; o código tem que funcionar com a coluna ausente (padrão do `enviado_em` em `app/api/registros/route.ts`).
- O fluxo de **filial (mesma raiz)** não muda de comportamento.
- A linha da loja nova **não pode ter `tipo: 'matriz'`**: esse tipo move o card no clique do pré-cadastro (`app/api/registros/route.ts:73`) e é o primeiro escolhido como RID da matriz nos tickets. Fica `tipo: 'adicional'` + coluna nova `fluxo = 'loja_nova_empresa'`. (Correção ao spec, que dizia "tipo matriz".)
- Link de cadastro: `https://retail-onboarding-hub.vercel.app/`. Atalho: `NOVA LOJA`. Elegibilidade: situação `ATIVA`, idade ≥ 1 ano, fora da base Odres/UME, sem onboarding desse CNPJ na API da AIVA.
- Status que abrem o fluxo: `TREINAR`, `LOGIN`, `LOJA_FINALIZADA_E_VENDENDO`. Em `CADASTRO_RECEBIDO`/`EM_ANALISE_AIVA` vale a regra atual (anota, sem pedido).
- Envio ao lojista: texto se a janela estiver aberta; senão `enviarUtilidadeOu` com template 86 (`lib/template-utilidade.ts`). Toda rota nova respeita `?dry` via `flag()` de `lib/req-flags`.
- A VictorIA nunca promete prazo nem ativação.

## Review Focus

1. CNPJ mandado em papo de repasse/painel financeiro (`contextoRep`) — não pode abrir o fluxo nem mandar link. Teste na Task 1 (`deveAbrirFluxo`).
2. Lojista responde "não" à confirmação ("não é loja nova, é meu fornecedor") — o marcador sai e o registro fica `informada`, sem fila. Teste na Task 1 (`lerMotivoLojaNova` com `cancelar`).
3. Filial da SEGUNDA empresa (raiz igual à de uma loja nova já criada, diferente da matriz original) — o ticket de filial tem que usar o RID do registro de mesma raiz, não o da matriz original. Teste na Task 1 (`ridDaRaiz`).
4. Pré-cadastro da loja nova recusado pela AIVA (`not_approved`) — avisa o time, não manda link nem mensagem automática ao lojista. Teste na Task 4 (`pendentesLink`).
5. Mesmo CNPJ mandado duas vezes / espelho rodando duas vezes — um link e um aviso de loja criada por CNPJ, para sempre. Teste na Task 4 (idempotência por `link_enviado_em` / `criada_avisada_em`).

---

### Task 1: Regras puras — `lib/loja-nova-calc.ts`

**Files:**
- Create: `lib/loja-nova-calc.ts`, `lib/loja-nova-calc.test.ts`
- Modify: `package.json` (script `"test:lojanova": "node --test lib/loja-nova-calc.test.ts"`)

**Interfaces — Produces:**

```ts
export const FLUXO_LOJA_NOVA = 'loja_nova_empresa'
export const MOTIVO_LOJA_NOVA = 'loja_nova_empresa'           // prefixo do motivo_humano
export const STATUS_ABRE_FLUXO = ['TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO'] as const
export const raizCnpj = (cnpj: unknown): string               // 8 primeiros dígitos; '' se não tiver 14
export type Classe = 'conhecido' | 'filial' | 'outra_empresa'
export function classificar(cnpj: string, cnpjsDoLead: string[]): Classe
export function ridDaRaiz(cnpj: string, regs: { cnpj: string; rid: string | null; tipo: string }[]): string | null
export function ehAtalhoNovaLoja(texto: string | null | undefined): boolean
export type Elegibilidade = { ok: true } | { ok: false; motivo: 'nao_ativa' | 'menos_de_1_ano' | 'odres' | 'ja_na_aiva' | 'receita_indisponivel'; detalhe: string }
export function elegibilidade(e: { situacao: string | null; idadeAnos: number | null; odres: boolean; jaNaAiva: string | null }): Elegibilidade
export function deveAbrirFluxo(e: { status: string; classe: Classe; contextoRepasse: boolean }): boolean
export type PedidoLojaNova = { cnpj: string; acao: 'confirmar' | 'cancelar'; socioNome: string | null; socioTelefone: string | null }
export function lerMotivoLojaNova(motivo: string | null | undefined): PedidoLojaNova | null
export const marcadorLojaNova = (cnpj: string, elegivel: Elegibilidade, iso: string): string   // [LOJA_NOVA:cnpj=…|sit=ok|…|ISO]
export function blocoPromptLojaNova(obs: string | null | undefined, agora?: number): string | null
export function textoLinkLojaNova(cnpj: string, razao: string | null): string
export function textoLojaCriada(razao: string | null): string
```

Formato do motivo: `loja_nova_empresa: cnpj=<14 dígitos ou formatado> | acao=confirmar|cancelar | socio=mesmo|<nome> | tel=<telefone>`.

- [ ] **Step 1: Testes que falham** em `lib/loja-nova-calc.test.ts` (`node:test` + `node:assert/strict`, como `lib/tickets-aiva.test.ts`):

```ts
test('raiz e classificação', () => {
  assert.equal(raizCnpj('32.306.162/0001-49'), '32306162')
  assert.equal(raizCnpj('123'), '')
  assert.equal(classificar('59218413000190', ['32306162000149']), 'outra_empresa')
  assert.equal(classificar('32306162000220', ['32306162000149']), 'filial')
  assert.equal(classificar('32306162000149', ['32306162000149']), 'conhecido')
})
test('filial da segunda empresa usa o RID da mesma raiz', () => {
  const regs = [{ cnpj: '32306162000149', rid: '7933', tipo: 'matriz' }, { cnpj: '59218413000190', rid: '9001', tipo: 'adicional' }]
  assert.equal(ridDaRaiz('59218413000271', regs), '9001')
  assert.equal(ridDaRaiz('32306162000220', regs), '7933')
  assert.equal(ridDaRaiz('11111111000191', regs), null)
})
test('atalho', () => {
  for (const t of ['NOVA LOJA', 'nova loja', ' Nova  Loja! ', 'quero nova loja']) assert.ok(ehAtalhoNovaLoja(t), t)
  for (const t of ['a loja nova do vizinho fechou e eu comprei o estoque todo dele ontem', '', null]) assert.ok(!ehAtalhoNovaLoja(t), String(t))
})
test('elegibilidade', () => {
  assert.deepEqual(elegibilidade({ situacao: 'ATIVA', idadeAnos: 3, odres: false, jaNaAiva: null }), { ok: true })
  assert.equal((elegibilidade({ situacao: 'INAPTA', idadeAnos: 3, odres: false, jaNaAiva: null }) as any).motivo, 'nao_ativa')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 0.4, odres: false, jaNaAiva: null }) as any).motivo, 'menos_de_1_ano')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 3, odres: true, jaNaAiva: null }) as any).motivo, 'odres')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 3, odres: false, jaNaAiva: 'biometria' }) as any).motivo, 'ja_na_aiva')
  assert.equal((elegibilidade({ situacao: null, idadeAnos: null, odres: false, jaNaAiva: null }) as any).motivo, 'receita_indisponivel')
})
test('só abre com loja principal criada, outra empresa e fora do papo de repasse', () => {
  assert.ok(deveAbrirFluxo({ status: 'LOJA_FINALIZADA_E_VENDENDO', classe: 'outra_empresa', contextoRepasse: false }))
  assert.ok(!deveAbrirFluxo({ status: 'LOJA_FINALIZADA_E_VENDENDO', classe: 'outra_empresa', contextoRepasse: true }))
  assert.ok(!deveAbrirFluxo({ status: 'EM_ANALISE_AIVA', classe: 'outra_empresa', contextoRepasse: false }))
  assert.ok(!deveAbrirFluxo({ status: 'LOGIN', classe: 'filial', contextoRepasse: false }))
})
test('motivo', () => {
  assert.deepEqual(lerMotivoLojaNova('loja_nova_empresa: cnpj=59.218.413/0001-90 | acao=confirmar | socio=mesmo'),
    { cnpj: '59218413000190', acao: 'confirmar', socioNome: null, socioTelefone: null })
  assert.deepEqual(lerMotivoLojaNova('loja_nova_empresa: cnpj=59218413000190 | acao=confirmar | socio=Maria Souza | tel=(21) 96500-2926'),
    { cnpj: '59218413000190', acao: 'confirmar', socioNome: 'Maria Souza', socioTelefone: '5521965002926' })
  assert.equal(lerMotivoLojaNova('loja_nova_empresa: cnpj=59218413000190 | acao=cancelar')?.acao, 'cancelar')
  assert.equal(lerMotivoLojaNova('loja_nova_empresa: cnpj=123 | acao=confirmar'), null)
  assert.equal(lerMotivoLojaNova('abrir_ticket_filial: cnpj=59218413000190 | numero=1'), null)
})
test('bloco do prompt: elegível pede confirmação e sócio; inelegível proíbe pedido; sem marcador = null', () => {
  const ok = blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: true }, '2026-11-19T12:00:00Z')}`, Date.parse('2026-11-19T13:00:00Z'))!
  assert.match(ok, /59\.218\.413\/0001-90/); assert.match(ok, /loja_nova_empresa: cnpj=/); assert.doesNotMatch(ok, /retail-onboarding-hub/)
  const ruim = blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: false, motivo: 'menos_de_1_ano', detalhe: '0,4 ano' }, '2026-11-19T12:00:00Z')}`, Date.parse('2026-11-19T13:00:00Z'))!
  assert.match(ruim, /NÃO abra pedido/i)
  assert.equal(blocoPromptLojaNova('sem nada'), null)
  // marcador com mais de 7 dias não instrui mais
  assert.equal(blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: true }, '2026-11-01T12:00:00Z')}`, Date.parse('2026-11-19T13:00:00Z')), null)
})
test('textos ao lojista: link com o CNPJ, sem prazo', () => {
  const t = textoLinkLojaNova('59218413000190', 'ACME LTDA')
  assert.match(t, /https:\/\/retail-onboarding-hub\.vercel\.app\//); assert.match(t, /59\.218\.413\/0001-90/)
  for (const s of [t, textoLojaCriada('ACME LTDA')]) assert.doesNotMatch(s, /\b(hoje|amanhã|\d+ ?(h|horas|dias))\b/i)
})
```

- [ ] **Step 2:** `npm run test:lojanova` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar.** Reaproveitar `telefone55` de `lib/filiais-aiva.ts` e `fmtCnpj` de `lib/tickets-aiva.ts`. `ehAtalhoNovaLoja`: texto normalizado (minúsculo, sem acento/pontuação) contém `nova loja` e tem até 6 palavras. `blocoPromptLojaNova` usa o marcador MAIS RECENTE; o bloco elegível instrui: (a) confirmar que ele quer cadastrar essa empresa como nova loja na AIVA; (b) perguntar se o sócio é ele mesmo, senão nome + WhatsApp do sócio; (c) devolver o motivo no formato acima com `acionar_humano = false`; (d) dizer "Registrei a loja nova; assim que o cadastro dela abrir na AIVA eu te mando o link por aqui."; (e) ⛔ não mandar link, não prometer prazo, não refazer qualificação. O bloco inelegível traz a frase do motivo e "NÃO abra pedido".
- [ ] **Step 4:** `npm run test:lojanova` → PASS. `npx tsc --noEmit -p tsconfig.json` → limpo.
- [ ] **Step 5:** `git add lib/loja-nova-calc.ts lib/loja-nova-calc.test.ts package.json` · `git commit -m "feat(loja-nova): regras puras da loja de outra empresa"`

---

### Task 2: SQL + fila de pré-cadastro no painel

**Files:**
- Create: `docs/sql/2026-11-19-loja-nova-empresa.sql`
- Modify: `app/atendimento/page.tsx` (quadro Registros AIVA, ~linhas 198–270) e a rota que alimenta esse quadro

- [ ] **Step 1:** SQL (`alter table sdr_registros_cnpj add column if not exists …`): `fluxo text`, `socio_nome text`, `socio_telefone text`, `link_enviado_em timestamptz`, `criada_avisada_em timestamptz`, com `comment on column` explicando cada uma. **Não aplicar** — entregar ao Aldo.
- [ ] **Step 2:** No quadro de pendentes (`enviado = false`), linha com `fluxo = 'loja_nova_empresa'` ganha o selo "loja nova de cliente ativo" e mostra sócio (nome/telefone, ou "mesmo sócio"). Linha `tipo: 'adicional'` SEM `fluxo` continua como hoje. O select tolera coluna ausente (erro `42703` → refaz sem as colunas novas).
- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.json` limpo; abrir `/atendimento` no preview (`preview_start "SDR AIVA"`, porta 3012) e conferir que o quadro renderiza sem as colunas novas no banco.
- [ ] **Step 4:** `git add docs/sql/2026-11-19-loja-nova-empresa.sql app/atendimento/page.tsx <rota tocada>` · `git commit -m "feat(loja-nova): colunas e selo na fila de pré-cadastro"`

---

### Task 3: Webhook — classificar antes da resposta, registrar o pedido depois

**Files:**
- Modify: `app/api/sdr/webhook/route.ts` (bloco de consulta de CNPJ pós-credenciamento ~1725–1934; bloco de tickets ~2978–3065; bloco LOJA NOVA ~3462–3565), `lib/claude.ts` (onde entram `blocoPromptTickets`/`blocoPromptRegua`), `lib/tickets-aiva.ts` (`mensagemFilial`, ramo "outra empresa")

**Interfaces — Consumes:** tudo da Task 1. `consultarCNPJ` (`lib/cnpj.ts`), `listarOnboardingsApi` (`lib/portal-aiva.ts`), a conferência Odres/UME que a pré-aprovação já usa (localizar com `grep -n "funil 19\|[Oo]dres" app/api/sdr/webhook/route.ts`).

- [ ] **Step 1 (antes da chamada ao modelo):** para lead em `STATUS_ABRE_FLUXO` com CNPJ de DV válido na mensagem: `classificar` contra os CNPJs de `sdr_registros_cnpj` do lead + os das observações; se `deveAbrirFluxo` (com o mesmo `contextoRep` do bloco de repasse, que precisa ser calculado antes), rodar `elegibilidade` e gravar `marcadorLojaNova` nas observações do lead **antes** de montar o prompt. Conferir no código que este ponto roda antes da chamada ao modelo; se o bloco ~1725 rodar depois, mover só o cálculo, não o alerta.
- [ ] **Step 2:** atalho — `ehAtalhoNovaLoja(conteudoEfetivo)` em lead de `STATUS_ABRE_FLUXO` injeta no turno a instrução "o lojista quer cadastrar uma loja nova: peça o CNPJ dela (14 dígitos)". Sem CNPJ ainda, sem marcador.
- [ ] **Step 3:** `lib/claude.ts` inclui `blocoPromptLojaNova(lead.observacoes)` no bloco dinâmico por lead (fora do cache), ao lado de `blocoPromptTickets`.
- [ ] **Step 4 (depois da resposta):** tratar `motivo_humano` com prefixo `MOTIVO_LOJA_NOVA` no mesmo ponto dos tickets:
  - `lerMotivoLojaNova` nulo, ou CNPJ que o lojista não escreveu na janela recente, ou sem marcador elegível para esse CNPJ → não registra; escala ao time com o motivo cru (mesmo padrão do `escalarT` de filial).
  - `acao = confirmar` → `update sdr_registros_cnpj set fluxo = FLUXO_LOJA_NOVA, socio_nome, socio_telefone where lead_id and cnpj` (linha já existe pela captura; se não existir, `upsert` com `tipo: 'adicional', status: 'informada'`). Aviso informativo ao Nei: "🏪 LOJA NOVA DE CLIENTE ATIVO — na fila de pré-cadastro" com loja, CNPJ, razão social, sócio e link `/atendimento`.
  - `acao = cancelar` → remove o marcador `[LOJA_NOVA:…]` desse CNPJ; registro fica como está.
- [ ] **Step 5 (bloco LOJA NOVA ~3462):** para CNPJ classificado `outra_empresa`: **não** gerar linha na aba Filiais (`montarLinhaFilial`/`registrarFilialAiva` só para `filial`) e trocar o texto do alerta "conferir: loja nova ou correção/troca?" por um que diga a classe e o resultado da elegibilidade. Para `filial`, nada muda.
- [ ] **Step 6:** ticket de filial usa `ridDaRaiz(ped.cnpj, regsT)` no lugar do `ridMatriz` atual, caindo no comportamento de hoje quando devolver `null`.
- [ ] **Step 7:** `mensagemFilial`, ramo de raiz diferente: texto passa a ser "O CNPJ <c> é de outra empresa — aí o caminho é o cadastro de loja nova. Quer que eu registre essa empresa como nova loja na AIVA?" e o webhook grava o marcador para esse CNPJ (o turno seguinte segue o fluxo). Atualizar o teste correspondente em `lib/tickets-aiva.test.ts`.
- [ ] **Step 8:** `npm run test:lojanova`, o script do `package.json` que roda `lib/tickets-aiva.test.ts` e `npm run test:json` → PASS; `npx tsc --noEmit -p tsconfig.json` limpo.
- [ ] **Step 9:** `git add app/api/sdr/webhook/route.ts lib/claude.ts lib/tickets-aiva.ts lib/tickets-aiva.test.ts` · `git commit -m "feat(loja-nova): classificação por raiz e pedido sem aprovação humana"`

---

### Task 4: Espelho — link quando o pré-cadastro chega, aviso quando a loja nasce

**Files:**
- Modify: `lib/loja-nova-calc.ts` + teste (seleção pura), `lib/espelho-portal.ts` (passo novo ao fim da rodada, dentro do teto de tempo)

**Interfaces — Produces:**

```ts
export type RegLojaNova = { id: string | number; lead_id: string; cnpj: string; fluxo: string | null; link_enviado_em: string | null; criada_avisada_em: string | null }
export type OnbLojaNova = { cnpj: string; stage?: string | null; retailer_id?: string | number | null; legal_name?: string | null; pre_cadastro_status?: string | null }
export function pendentesLink(regs: RegLojaNova[], onbs: OnbLojaNova[]): { reg: RegLojaNova; onb: OnbLojaNova }[]
export function pendentesCriada(regs: RegLojaNova[], onbs: OnbLojaNova[]): { reg: RegLojaNova; onb: OnbLojaNova }[]
export function recusadas(regs: RegLojaNova[], onbs: OnbLojaNova[]): { reg: RegLojaNova; onb: OnbLojaNova }[]
```

- [ ] **Step 1: Testes que falham:**

```ts
const reg = (p: Partial<RegLojaNova> = {}): RegLojaNova => ({ id: 1, lead_id: 'a', cnpj: '59218413000190', fluxo: 'loja_nova_empresa', link_enviado_em: null, criada_avisada_em: null, ...p })
test('link: só fluxo loja nova, em dados_varejo, ainda sem link', () => {
  const o = [{ cnpj: '59218413000190', stage: 'dados_varejo' }]
  assert.equal(pendentesLink([reg()], o).length, 1)
  assert.equal(pendentesLink([reg({ link_enviado_em: '2026-11-19T12:00:00Z' })], o).length, 0)
  assert.equal(pendentesLink([reg({ fluxo: null })], o).length, 0)
  assert.equal(pendentesLink([reg()], []).length, 0)                                   // pré-cadastro ainda não chegou
  assert.equal(pendentesLink([reg()], [{ cnpj: '59218413000190', stage: 'not_approved', pre_cadastro_status: 'not_approved' }]).length, 0)
})
test('recusada pela AIVA aparece só em recusadas', () => {
  const o = [{ cnpj: '59218413000190', stage: 'not_approved', pre_cadastro_status: 'not_approved' }]
  assert.equal(recusadas([reg()], o).length, 1); assert.equal(pendentesCriada([reg()], o).length, 0)
})
test('loja criada: retailer_id presente, um aviso só', () => {
  const o = [{ cnpj: '59218413000190', stage: 'cadastro_finalizado', retailer_id: 9001, legal_name: 'ACME' }]
  assert.equal(pendentesCriada([reg()], o).length, 1)
  assert.equal(pendentesCriada([reg({ criada_avisada_em: '2026-11-20T12:00:00Z' })], o).length, 0)
})
```

- [ ] **Step 2:** `npm run test:lojanova` → FAIL.
- [ ] **Step 3:** implementar as três funções e o passo no espelho: lê os registros `fluxo = FLUXO_LOJA_NOVA` (coluna ausente → passo pulado com `console.warn`), cruza com os onboardings que a rodada já carregou; para cada `pendentesLink` envia `textoLinkLojaNova` (texto com janela aberta; senão `enviarUtilidadeOu` com `linkCadastro` de `lib/template-utilidade-calc.ts`) e **só depois de envio aceito** grava `link_enviado_em`; para `pendentesCriada` envia `textoLojaCriada`, grava `criada_avisada_em` e `rid`; para `recusadas` cria aviso ao time (uma vez, chave em `sdr_avisos_chave`), nada ao lojista. **Fila parada:** registro do fluxo com `enviado = false` há mais de 24 h (pelo `criado_em`) gera aviso ao time, no máximo 1×/dia por CNPJ (chave em `sdr_avisos_chave`); e conferir que o aviso existente `pre_cadastro_nao_chegou` (passo 11 do espelho) cobre linha `tipo: 'adicional'` deste fluxo — se filtrar por `matriz`, estender para `fluxo = FLUXO_LOJA_NOVA`. Em `?dry` só conta. Grava em `sdr_mensagens` com rótulo `aiva_loja_nova`. **Não move card nem toca marcadores de etapa do lead.**
- [ ] **Step 4:** `npm run test:lojanova && npm run test:espelho` → PASS; `tsc` limpo; `GET /api/sdr/espelho-portal?dry=1` local com `Bearer CRON_SECRET` → 200 e contadores novos no JSON (zero).
- [ ] **Step 5:** `git add lib/loja-nova-calc.ts lib/loja-nova-calc.test.ts lib/espelho-portal.ts` · `git commit -m "feat(loja-nova): link e aviso de loja criada por CNPJ no espelho"`

---

### Task 5: Prompt da VictorIA + revisor + textos para o Aldo

**Files:**
- Modify: `prompts/aiva.ts` (seção 🏪 LOJA NOVA NO MEIO DA CONVERSA ~1167–1173; tabela de canais ~458 e ~1283; desambiguação ~917; exceções ~892 e ~1383)
- Create: `docs/Textos-loja-nova-outra-empresa-2026-11-19.md` (todo texto que vai ao lojista e ao Nei, para aprovação)

- [ ] **Step 1:** Na seção LOJA NOVA: (a) quem decide filial × outra empresa é a instrução do sistema, nunca a VictorIA; (b) ramo "outra empresa" segue o bloco dinâmico (confirmação + sócio + motivo `loja_nova_empresa`), sem link e sem prazo; (c) regra nova: **endereço novo sem CNPJ próprio** ("usar o CNPJ da matriz" em outro endereço) → orientar a registrar a filial com o contador e voltar com o CNPJ; ⛔ não dizer que "o time vai analisar"; (d) atalho NOVA LOJA → pedir o CNPJ. Remover/alinhar toda passagem que diz "é loja nova: o time cuida" (linha 1171) e as duas tabelas.
- [ ] **Step 2:** Rodar o `revisor-prompt-victoria` sobre o diff; aplicar todos os achados; conferir a curadoria (`/curadoria`) por correção que contradiga a regra nova.
- [ ] **Step 3:** Escrever o doc de textos (bloco dinâmico elegível e inelegível por motivo, fala de registro, link, loja criada, alertas ao Nei) e **parar para o Aldo aprovar**.
- [ ] **Step 4:** `npm run test:json && npm run test:lojanova` → PASS; `tsc` limpo.
- [ ] **Step 5:** `git add prompts/aiva.ts docs/Textos-loja-nova-outra-empresa-2026-11-19.md` · `git commit -m "feat(loja-nova): regra no prompt da VictorIA (revisor aplicado)"`

---

### Task 6: Publicação e os dois clientes de hoje (só com OK do Aldo)

- [ ] **Step 1:** Suíte inteira que o repo usa antes de deploy + `tsc`. Reportar o que falhar (o `test:campanha` tem 1 falha pré-existente por data).
- [ ] **Step 2:** Com o OK do Aldo: aplicar `docs/sql/2026-11-19-loja-nova-empresa.sql` no Supabase `axkrorkhnkfkpbjikwrb`; depois `git push` (= produção) e conferir o deploy READY.
- [ ] **Step 3:** Eduardo Cell (`59218413000190`) e RG Cell (`69849333000196`): conferir a elegibilidade de cada um na Receita e mostrar ao Aldo; com o OK dele, `update sdr_registros_cnpj set fluxo = 'loja_nova_empresa'` nas duas linhas para entrarem na fila de pré-cadastro. A RG Cell tem ainda o pedido de Osasco "com o CNPJ da matriz" prometido na conversa de 19/11 13h22 — o Nei corrige com o lojista.
- [ ] **Step 4:** Atualizar `docs/HANDOFF.md` (o que entrou, chaves, como desligar: sem marcador `[LOJA_NOVA` o bloco não aparece) e o `CLAUDE.md` local na linha da regra de filial.
