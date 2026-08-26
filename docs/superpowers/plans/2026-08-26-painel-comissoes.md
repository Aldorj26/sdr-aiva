# Painel de Comissões AIVA/UME — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela `/comissoes` que importa as planilhas mensais da UME (Carteira + FCDL) e confere automaticamente contra o funil 11 do Evo, com abas AIVA/UME e contraprova do Data Studio.

**Architecture:** Upload xlsx → parser server-side (`lib/comissoes.ts`) → tabelas `ume_comissoes`/`ume_comissoes_meta` no Supabase → página server-rendered que cruza com `getPipeOpportunities(11)` (descrição traz `UME_RID`/`CNPJ`) e `aiva_desempenho`. Escrita de Retailer ID de volta no Evo via API própria.

**Tech Stack:** Next.js 15 App Router, Supabase, Evo Talks REST, SheetJS (`xlsx`) leitura.

**Spec:** `docs/superpowers/specs/2026-08-26-painel-comissoes-design.md`

**Observação de teste:** o projeto não tem suíte de testes; o padrão da casa é typecheck + build + verificação com dados reais. Cada task termina verificando com a planilha real de julho/26 (Carteira já extraída do Gmail em `scratchpad/comissao-julho-2026.xlsx`; FCDL será extraída na Task 6). Critérios de sucesso da spec: totais R$ 39.704,92 + R$ 2.986,76, e reproduzir a conferência manual do Aldo.

---

### Task 1: Tabelas no Supabase

**Files:** nenhum (migração via MCP Supabase `apply_migration`, projeto `axkrorkhnkfkpbjikwrb`)

- [x] **Step 1:** aplicar a migração `ume_comissoes` com o SQL da spec (duas tabelas; UNIQUE (mes, origem, retailer_id); PK composta na meta).
- [x] **Step 2:** verificar com `select` vazio que as tabelas existem.

### Task 2: expor `description` no getPipeOpportunities

**Files:**
- Modify: `lib/evotalks.ts` (interface `PipelineOpportunity` + mapeamento em `getPipeOpportunities`)

- [x] **Step 1:** adicionar `description: string` à interface e `description: (o.description as string) ?? ''` ao mapeamento.
- [x] **Step 2:** `npx tsc --noEmit` limpo.

### Task 3: parser + reconciliação (`lib/comissoes.ts`)

**Files:**
- Create: `lib/comissoes.ts`
- Modify: `package.json` (dep `xlsx`)

- [x] **Step 1:** `npm i xlsx`.
- [x] **Step 2:** criar `lib/comissoes.ts` com:
  - `AIVA_GRUPOS: Set<string>` = INSIDE_SALES, COMM, MIDDLE_REALME_ES, REALME_CURITIBA, VAREJO_MAIS, VOCE_PONTO_COM.
  - `parsePlanilhaUme(buf: Buffer, nomeArquivo: string)` → `{ mes, origem, linhas[], meta }`:
    aba RESUMO; mês pela linha "Competência" (mapa de meses PT→'YYYY-MM'); origem 'fcdl' se /fcdl/i no nome do arquivo, senão 'carteira'; header localizado pela linha cujo primeiro valor é 'RETAILER ID'; pula linhas `▸`/`Subtotal`/`TOTAL GERAL`/vazias; CNPJ numérico → string 14 dígitos com padStart; valida soma da comissão vs total declarado (tolerância 0,05) e lança erro descritivo com o delta se não bater.
  - `parseDescricaoOpp(desc)` → `{ umeRid: number|null, cnpj: string|null }` (regex `UME_RID:\s*(\d+)` e `CNPJ:\s*(\d{14})`).
  - `conferir(contasFunil11, linhasMes, desempenhoMes)` → linhas classificadas ✅/💤/⚠️/🆕 + flag 🔴 (sem comissão && vendas>0 no Data Studio), conforme tabela da spec.
- [x] **Step 3:** script temporário que roda `parsePlanilhaUme` na planilha real de julho: 264 linhas de varejo, total = 39.704,92 (bate), mês '2026-07'.
- [x] **Step 4:** commit.

### Task 4: API de import (`app/api/comissoes/importar/route.ts`)

**Files:**
- Create: `app/api/comissoes/importar/route.ts`

- [x] **Step 1:** `POST` multipart (`req.formData()`), aceita 1+ arquivos `.xlsx` ≤ 2 MB; para cada um: `parsePlanilhaUme` → delete `(mes, origem)` → insert linhas + upsert meta. Resposta com resumo por arquivo (mes, origem, linhas, total). Erro de validação → 422 com a mensagem do parser. Protegida pelo middleware (Task 7) — sem auth própria.
- [x] **Step 2:** typecheck.

### Task 5: API gravar Retailer ID (`app/api/comissoes/gravar-rid/route.ts`)

**Files:**
- Create: `app/api/comissoes/gravar-rid/route.ts`

- [x] **Step 1:** `POST { opportunityId, retailerId }` → `getOpportunity`; se descrição já tem `UME_RID:` com valor ≠ → 409; senão `postEvo('/int/updateOpportunity', { id, description: desc ? desc + ' | UME_RID: N' : 'UME_RID: N' })` (nunca enviar `tags`). Como `post` do evotalks é privado, exportar helper `updateOpportunityDescription(id, desc)` em `lib/evotalks.ts`.
- [x] **Step 2:** typecheck.

### Task 6: extrair FCDL de julho e importar os dados reais

**Files:** nenhum novo (usa Gmail MCP + curl local)

- [x] **Step 1:** baixar via Gmail (RAW) o anexo "Comissao ... FCDL - Julho 2026.xlsx" (msg 1a001810cd8e96f4) pro scratchpad.
- [x] **Step 2:** rodar o import local (dev server ou script direto com o parser + supabase) das duas planilhas de julho.
- [x] **Step 3:** conferir no banco: meta carteira 39.704,92; meta fcdl 2.986,76; NF total 42.691,68 (bate com o email do Gerisson).

### Task 7: página `/comissoes` + menu + middleware

**Files:**
- Create: `app/comissoes/page.tsx`
- Create: `app/comissoes/ImportarForm.tsx` (client: input file + POST + refresh)
- Create: `app/comissoes/GravarRidButton.tsx` (client: POST gravar-rid + refresh)
- Modify: `app/_components/Sidebar.tsx` (item "Comissões" abaixo de Desempenho)
- Modify: `middleware.ts` (matcher: `/comissoes`, `/api/comissoes/:path*`)

- [x] **Step 1:** página server-side: seletor de mês, abas AIVA/UME (?tab=), toggle Carteira|FCDL dentro de UME (?origem=), cards (Contratos/Originação/MDR/Comissão da aba + card Valor da NF), cards-filtro por estado, tabela com busca `casaBusca`, cabeçalho fixo (padrão thFixo do /desempenho), coluna Data Studio na aba AIVA, LeadDrawer/ClickableRow quando houver lead (casar CNPJ→lead como no /desempenho).
- [x] **Step 2:** typecheck + build.
- [x] **Step 3:** commit.

### Task 8: verificação com julho real + deploy

- [x] **Step 1:** rodar a conferência de julho via script (mesma função `conferir`) e comparar com a lista do email do Aldo (anexo "Sem-Comissao-Julho26-Funil11.xlsx", msg 1a01630068be4026): as lojas apontadas por ele devem cair em 💤/⚠️.
- [x] **Step 2:** conferir os 4 estados: contagens plausíveis (✅ ≈ 240 vinculadas com venda, 🆕 deve pegar IVS/lojas sem conta).
- [x] **Step 3:** commit final + push (deploy Vercel automático).
- [x] **Step 4:** smoke em produção: abrir /comissoes (redireciona pra login = middleware ok) e conferir a página logado por conta do Aldo (ele mesmo valida visual).
