# Portal Parceiros AIVA → desempenho — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o Data Studio pelo Portal de Parceiros AIVA como fonte diária do desempenho das lojas — coleta por API num cron do Vercel, série diária no banco, mensal/semanal derivados, painel `/desempenho` evoluído.

**Architecture:** Uma rota cron (`/api/cron/portal-aiva`, 6h BRT todo dia) loga no Supabase do portal com e-mail/senha, baixa `retailer_performance` da Track e grava o retrato do dia em `aiva_portal_diario`. Funções puras em `lib/portal-aiva-derivar.ts` transformam a série em `aiva_desempenho` (mês) e `aiva_desempenho_semanal` (semana = domingo − domingo anterior), que os consumidores atuais (`/comissoes`, `pulso-semanal.mjs`, `detectar-lojas-ativas.mjs`) já leem. A rota também ativa no mesmo dia os CNPJs registrados que aparecem no portal com status Ativo.

**Tech Stack:** Next.js 15 (App Router, rotas `nodejs`), Supabase (`supabaseAdmin` service role), PostgREST do portal via `fetch`, `node --test` com type stripping (Node 24) para as funções puras, Evo Talks (`lib/evotalks.ts`) para conta MRR e WhatsApp.

**Spec:** `docs/superpowers/specs/2026-09-09-portal-aiva-desempenho-design.md`

**Constantes descobertas na exploração (09/09/2026):**
- Portal: `https://xznsbwdpfmwvuqipeilq.supabase.co`
- Chave publishable (pública, está no bundle do app): `sb_publishable_EenngGy0xB2pzpwglt_HNg_qp3Rt7xg`
- `partner_id` da Track: `647bcb15-f6ad-4da9-aa70-d65900461500`
- Cards do portal em 09/09 (retrato até 08/09), set/26: 214 varejos · 675 aprovados · 134 contratos · R$ 195.157,38. Ago/26: 191 · 401 contratos · R$ 579.970,57.

**Convenções do repo que valem pra todo task:**
- Comentários em português, no estilo dos arquivos vizinhos (explicam o *porquê* e a data da decisão).
- `node --env-file=.env.local` pra scripts; a rota usa `process.env` do Vercel.
- Depois de cada task: `git add <arquivos> && git commit`. Não commitar `prompts/aiva.ts` (mudança alheia já no working tree).
- Node no Git Bash: `TZ=` não funciona — datas BRT sempre via `Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' })`.

---

## File structure

| Arquivo | Responsabilidade |
|---|---|
| `docs/sql/2026-09-09-portal-aiva.sql` | Migração: cria `aiva_portal_diario`, adiciona colunas em `aiva_desempenho`. Aplicada via MCP Supabase (`apply_migration`, projeto `axkrorkhnkfkpbjikwrb`). |
| `lib/portal-aiva-derivar.ts` | **Funções puras, sem imports**: tipos, datas, `mtdEm`, `agregarMensal`, `classificarAtencao`, `derivarSemana`. |
| `lib/portal-aiva-derivar.test.ts` | Testes `node --test` das funções puras. |
| `lib/portal-aiva.ts` | Cliente do portal (login, partner, busca paginada) + persistência (gravar diário, salvar mensal/semanal) + ativação diária + alerta WhatsApp. |
| `app/api/cron/portal-aiva/route.ts` | `GET` autenticado; orquestra coleta → validação → gravação → derivações → ativação. |
| `vercel.json` | Entrada de cron `0 9 * * *`. |
| `scripts/portal-aiva.mjs` | CLI que chama a rota em produção (`--dry`, `--mes`, `--semana`, `--tudo`). |
| `app/desempenho/page.tsx` | Painel com colunas/cards/filtros novos. |
| `app/comissoes/page.tsx` | Rótulos "Data Studio" → "Portal AIVA". |
| `.env.example`, `CLAUDE.md` | Env novas e nota de contexto. |
| `scripts/coletor-funil-loja.js`, `scripts/importar-funil-loja.mjs`, `scripts/importar-desempenho-semanal.mjs`, `scripts/importar-desempenho-aiva.mjs` | Cabeçalho "LEGADO". |
| `~/.claude/scheduled-tasks/aiva-pulso-semanal/SKILL.md`, `.../conferencia-comissao-ume/SKILL.md`, `.../aiva-desempenho-diario/` | Fora do repo: texto novo do pulso (vale a partir de 21/09), passo 7 da conferência, apagar a diária. |

---

### Task 1: Migração do banco

**Files:**
- Create: `docs/sql/2026-09-09-portal-aiva.sql`

- [ ] **Step 1: Escrever o SQL**

```sql
-- Portal Parceiros AIVA como fonte do desempenho (spec 2026-09-09).
-- aiva_portal_diario = retrato bruto do portal, um por dia (fonte de verdade);
-- aiva_desempenho e aiva_desempenho_semanal passam a ser derivadas dela.

create table if not exists aiva_portal_diario (
  data_ref            date        not null,   -- dia da coleta - 1 (BRT): retrato "até ontem"
  retailer_id         text        not null,
  mes                 date        not null,   -- dia 1 do mês (como vem do portal)
  cnpj                text        not null,   -- 14 dígitos
  nome_varejo         text,
  consultas           integer     not null default 0,   -- acumulados do mês naquele dia
  aprovados           integer     not null default 0,
  vendas              integer     not null default 0,
  valor_vendas        numeric     not null default 0,
  inadimplencia_aiva  numeric,
  inadimplencia_odres numeric,
  foto_fora_pct       numeric,
  status              text,                   -- Ativo / Inativo
  cadastro_em         date,                   -- só se o portal expuser a coluna
  bruto               jsonb       not null,   -- linha inteira do portal
  coletado_em         timestamptz not null default now(),
  primary key (data_ref, retailer_id, mes)
);
create index if not exists aiva_portal_diario_mes_idx on aiva_portal_diario (mes, data_ref);
create index if not exists aiva_portal_diario_cnpj_idx on aiva_portal_diario (cnpj);

alter table aiva_desempenho
  add column if not exists consultas           integer,
  add column if not exists rid                 text,
  add column if not exists status_portal       text,
  add column if not exists inadimplencia_aiva  numeric,
  add column if not exists inadimplencia_odres numeric,
  add column if not exists foto_fora_pct       numeric,
  add column if not exists cadastro_em         date,
  add column if not exists atencao             text;  -- novo_sem_engajamento | baixa_performance | null

-- Leitura pela assistente (RPC assistente_sql roda como assistente_ro)
grant select on aiva_portal_diario to assistente_ro;
```

- [ ] **Step 2: Aplicar no Supabase**

Use a ferramenta MCP `mcp__c0121895-efd9-4761-8afa-b58ff190b442__apply_migration` com `project_id: axkrorkhnkfkpbjikwrb`, `name: portal_aiva_diario`, `query:` = conteúdo do arquivo. Se o `grant` falhar porque o role `assistente_ro` não existe, remova a linha e reaplique (a RPC continua funcionando pras tabelas antigas).

- [ ] **Step 3: Verificar**

Via MCP `execute_sql`:
```sql
select column_name from information_schema.columns where table_name='aiva_portal_diario' order by ordinal_position;
select column_name from information_schema.columns where table_name='aiva_desempenho' and column_name in ('consultas','rid','status_portal','atencao','cadastro_em');
```
Expected: 16 colunas na primeira; 5 linhas na segunda.

- [ ] **Step 4: Commit**

```bash
git add docs/sql/2026-09-09-portal-aiva.sql
git commit -m "feat(portal-aiva): tabela aiva_portal_diario + colunas novas em aiva_desempenho"
```

---

### Task 2: Tipos, datas e `mtdEm` (funções puras)

**Files:**
- Create: `lib/portal-aiva-derivar.ts`
- Create: `lib/portal-aiva-derivar.test.ts`

O arquivo de derivação **não pode importar nada** (nem `@/…`): é executado direto pelo `node --test` com type stripping, sem bundler.

- [ ] **Step 1: Escrever o teste de `mtdEm` e das datas**

```ts
// lib/portal-aiva-derivar.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { somarDias, ultimoDiaDoMes, mesDe, mtdEm, type LinhaDiaria } from './portal-aiva-derivar.ts'

export const linha = (p: Partial<LinhaDiaria> & { data_ref: string; retailer_id: string; mes: string }): LinhaDiaria => ({
  cnpj: '11111111000191', nome_varejo: 'Loja', consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0,
  inadimplencia_aiva: null, inadimplencia_odres: null, foto_fora_pct: null, status: 'Ativo', cadastro_em: null,
  ...p,
})

test('somarDias e ultimoDiaDoMes trabalham em texto YYYY-MM-DD sem fuso', () => {
  assert.equal(somarDias('2026-08-31', 1), '2026-09-01')
  assert.equal(somarDias('2026-09-01', -8), '2026-08-24')
  assert.equal(ultimoDiaDoMes('2026-09-01'), '2026-09-30')
  assert.equal(ultimoDiaDoMes('2026-02-15'), '2026-02-28')
  assert.equal(mesDe('2026-09-13'), '2026-09-01')
})

test('mtdEm devolve o retrato mais recente até a data, ou zeros se não há retrato', () => {
  const serie = [
    linha({ data_ref: '2026-09-05', retailer_id: 'r1', mes: '2026-09-01', vendas: 2, aprovados: 5, consultas: 9, valor_vendas: 100 }),
    linha({ data_ref: '2026-09-07', retailer_id: 'r1', mes: '2026-09-01', vendas: 4, aprovados: 7, consultas: 12, valor_vendas: 250 }),
    linha({ data_ref: '2026-09-07', retailer_id: 'r2', mes: '2026-09-01', vendas: 1 }),
  ]
  assert.deepEqual(mtdEm(serie, 'r1', '2026-09-01', '2026-09-06'), { consultas: 9, aprovados: 5, vendas: 2, valor_vendas: 100 })
  assert.deepEqual(mtdEm(serie, 'r1', '2026-09-01', '2026-09-07'), { consultas: 12, aprovados: 7, vendas: 4, valor_vendas: 250 })
  assert.deepEqual(mtdEm(serie, 'r1', '2026-09-01', '2026-09-04'), { consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 })
  assert.deepEqual(mtdEm(serie, 'r1', '2026-08-01', '2026-09-07'), { consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/portal-aiva-derivar.test.ts`
Expected: FAIL — `Cannot find module './portal-aiva-derivar.ts'`

- [ ] **Step 3: Implementar tipos, datas e `mtdEm`**

```ts
// lib/portal-aiva-derivar.ts
/**
 * Derivações do Portal Parceiros AIVA (spec 2026-09-09) — SÓ funções puras.
 *
 * ⚠️ Sem imports (nem "@/…"): este arquivo roda direto no `node --test` com
 * type stripping, fora do bundler do Next. Tudo que toca banco/rede fica em
 * lib/portal-aiva.ts.
 *
 * Datas são strings YYYY-MM-DD e a aritmética é feita em UTC de propósito —
 * uma data de calendário não tem fuso; converter pra Date local no Windows
 * dava dia errado (lição das rotinas de follow-up).
 */

export type LinhaDiaria = {
  data_ref: string        // YYYY-MM-DD (retrato "até este dia")
  retailer_id: string
  mes: string             // YYYY-MM-01
  cnpj: string
  nome_varejo: string | null
  consultas: number       // acumulados do mês naquele dia
  aprovados: number
  vendas: number
  valor_vendas: number
  inadimplencia_aiva: number | null
  inadimplencia_odres: number | null
  foto_fora_pct: number | null
  status: string | null   // Ativo / Inativo
  cadastro_em: string | null
}

export type Metricas = { consultas: number; aprovados: number; vendas: number; valor_vendas: number }
export const ZERO: Metricas = { consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 }

const utc = (d: string) => new Date(d + 'T00:00:00Z')
const iso = (d: Date) => d.toISOString().slice(0, 10)

export function somarDias(data: string, dias: number): string {
  const d = utc(data)
  d.setUTCDate(d.getUTCDate() + dias)
  return iso(d)
}

/** Primeiro dia do mês da data, no formato do portal (YYYY-MM-01). */
export function mesDe(data: string): string {
  return data.slice(0, 7) + '-01'
}

export function ultimoDiaDoMes(data: string): string {
  const d = utc(mesDe(data))
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return iso(d)
}

/** Dias inteiros entre duas datas (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / 86400e3)
}

/**
 * Acumulado do mês ("month-to-date") de uma loja até a data: o retrato mais
 * recente com data_ref <= data para aquele mês. Sem retrato = zeros (mês ainda
 * não começou, ou a loja não existia).
 */
export function mtdEm(serie: LinhaDiaria[], retailerId: string, mes: string, data: string): Metricas {
  let melhor: LinhaDiaria | null = null
  for (const l of serie) {
    if (l.retailer_id !== retailerId || l.mes !== mes || l.data_ref > data) continue
    if (!melhor || l.data_ref > melhor.data_ref) melhor = l
  }
  if (!melhor) return { ...ZERO }
  return { consultas: melhor.consultas, aprovados: melhor.aprovados, vendas: melhor.vendas, valor_vendas: Number(melhor.valor_vendas) }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/portal-aiva-derivar.test.ts`
Expected: `# pass 2`

- [ ] **Step 5: Commit**

```bash
git add lib/portal-aiva-derivar.ts lib/portal-aiva-derivar.test.ts
git commit -m "feat(portal-aiva): tipos, datas e mtdEm das derivações (puros, testados)"
```

---

### Task 3: `classificarAtencao`

**Files:**
- Modify: `lib/portal-aiva-derivar.ts`
- Modify: `lib/portal-aiva-derivar.test.ts`

Regra (spec): *novo_sem_engajamento* = cadastro há 8–29 dias, vendas = 0 e aprovados ≤ 3 desde o cadastro; *baixa_performance* = cadastro há ≥ 30 dias (ou desconhecido) e vendas = 0 nos últimos 30 dias.

- [ ] **Step 1: Teste**

```ts
// acrescentar ao lib/portal-aiva-derivar.test.ts
import { classificarAtencao } from './portal-aiva-derivar.ts'

test('classificarAtencao espelha a aba "Precisam de atenção" do portal', () => {
  const hoje = '2026-09-09'
  // novo (14 dias), 0 vendas, 2 aprovados → novo sem engajamento
  assert.equal(classificarAtencao({ cadastro: '2026-08-26', hoje, vendasDesdeCadastro: 0, aprovadosDesdeCadastro: 2, vendas30d: 0 }), 'novo_sem_engajamento')
  // novo demais (5 dias) → ainda não conta
  assert.equal(classificarAtencao({ cadastro: '2026-09-04', hoje, vendasDesdeCadastro: 0, aprovadosDesdeCadastro: 0, vendas30d: 0 }), null)
  // novo com 4 aprovados → engajou
  assert.equal(classificarAtencao({ cadastro: '2026-08-26', hoje, vendasDesdeCadastro: 0, aprovadosDesdeCadastro: 4, vendas30d: 0 }), null)
  // novo que vendeu → ok
  assert.equal(classificarAtencao({ cadastro: '2026-08-26', hoje, vendasDesdeCadastro: 1, aprovadosDesdeCadastro: 1, vendas30d: 1 }), null)
  // base (83 dias) sem venda em 30d → baixa performance
  assert.equal(classificarAtencao({ cadastro: '2026-06-18', hoje, vendasDesdeCadastro: 3, aprovadosDesdeCadastro: 20, vendas30d: 0 }), 'baixa_performance')
  // base vendendo → ok
  assert.equal(classificarAtencao({ cadastro: '2026-06-18', hoje, vendasDesdeCadastro: 3, aprovadosDesdeCadastro: 20, vendas30d: 2 }), null)
  // cadastro desconhecido = trata como base
  assert.equal(classificarAtencao({ cadastro: null, hoje, vendasDesdeCadastro: 0, aprovadosDesdeCadastro: 0, vendas30d: 0 }), 'baixa_performance')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/portal-aiva-derivar.test.ts`
Expected: FAIL — `classificarAtencao is not a function` (ou export ausente)

- [ ] **Step 3: Implementar**

```ts
// acrescentar ao lib/portal-aiva-derivar.ts
export type Atencao = 'novo_sem_engajamento' | 'baixa_performance' | null

/**
 * Espelha a aba "Precisam de atenção" do portal, com a nossa série:
 * - novo sem engajamento: cadastrado há 8–29 dias, sem venda e com no máximo 3
 *   aprovados desde o cadastro (o portal fala em "baixíssima atividade" sem dar
 *   o número; 3 é o que a lista dele mostra na prática — decisão 09/09).
 * - baixa performance: cadastrado há 30+ dias (ou data desconhecida) e sem
 *   venda nos últimos 30 dias.
 */
export function classificarAtencao(p: {
  cadastro: string | null
  hoje: string
  vendasDesdeCadastro: number
  aprovadosDesdeCadastro: number
  vendas30d: number
}): Atencao {
  const dias = p.cadastro ? diasEntre(p.cadastro, p.hoje) : Infinity
  if (dias < 8) return null
  if (dias <= 29) {
    return p.vendasDesdeCadastro === 0 && p.aprovadosDesdeCadastro <= 3 ? 'novo_sem_engajamento' : null
  }
  return p.vendas30d === 0 ? 'baixa_performance' : null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/portal-aiva-derivar.test.ts`
Expected: `# pass 3`

- [ ] **Step 5: Commit**

```bash
git add lib/portal-aiva-derivar.ts lib/portal-aiva-derivar.test.ts
git commit -m "feat(portal-aiva): classificarAtencao (novo sem engajamento / baixa performance)"
```

---

### Task 4: `agregarMensal`

**Files:**
- Modify: `lib/portal-aiva-derivar.ts`
- Modify: `lib/portal-aiva-derivar.test.ts`

Entrada: a série diária dos meses envolvidos + o mês alvo + `hoje` + mapa de "primeira aparição" por retailer (quem chama lê `min(data_ref)` no banco). Saída: uma linha por CNPJ no formato de `aiva_desempenho`.

- [ ] **Step 1: Teste**

```ts
// acrescentar ao lib/portal-aiva-derivar.test.ts
import { agregarMensal } from './portal-aiva-derivar.ts'

test('agregarMensal usa o último retrato do mês e soma lojas do mesmo CNPJ', () => {
  const serie = [
    // retrato antigo (deve ser ignorado)
    linha({ data_ref: '2026-09-05', retailer_id: 'r1', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Multicell 1', vendas: 1, aprovados: 3, consultas: 5, valor_vendas: 100 }),
    // último retrato
    linha({ data_ref: '2026-09-08', retailer_id: 'r1', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Multicell 1', vendas: 2, aprovados: 6, consultas: 10, valor_vendas: 300, status: 'Inativo', inadimplencia_aiva: 0.02 }),
    linha({ data_ref: '2026-09-08', retailer_id: 'r2', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Multicell 2', vendas: 5, aprovados: 8, consultas: 12, valor_vendas: 900, status: 'Ativo', inadimplencia_aiva: 0.05, cadastro_em: '2026-06-01' }),
    linha({ data_ref: '2026-09-08', retailer_id: 'r3', mes: '2026-09-01', cnpj: '22222222000191', nome_varejo: 'Zerada', consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 }),
    // mês anterior do r3 (vendeu em agosto → não é baixa performance ainda no dia 9)
    linha({ data_ref: '2026-08-31', retailer_id: 'r3', mes: '2026-08-01', cnpj: '22222222000191', nome_varejo: 'Zerada', vendas: 1, aprovados: 2, consultas: 3, valor_vendas: 50 }),
  ]
  const primeira = new Map([['r1', '2026-05-01'], ['r2', '2026-06-01'], ['r3', '2026-05-01']])
  const rows = agregarMensal(serie, '2026-09-01', '2026-09-09', primeira)
  assert.equal(rows.length, 2)

  const multi = rows.find((r) => r.cnpj === '11111111000191')!
  assert.equal(multi.mes, '2026-09')
  assert.equal(multi.consultas, 22)
  assert.equal(multi.aprovados, 14)
  assert.equal(multi.vendas, 7)
  assert.equal(multi.valor_vendas, 1200)
  assert.equal(multi.loja, 'Multicell 2')      // a que mais vendeu
  assert.equal(multi.rid, 'r2')
  assert.equal(multi.status_portal, 'Ativo')  // qualquer loja ativa
  assert.equal(multi.inadimplencia_aiva, 0.05) // a maior
  assert.equal(multi.cadastro_em, '2026-06-01')
  assert.equal(multi.conversao, 7 / 14)
  assert.equal(multi.ticket_medio, 1200 / 7)
  assert.equal(multi.sem_venda, false)
  assert.equal(multi.sem_consulta, false)
  assert.equal(multi.atencao, null)

  const zerada = rows.find((r) => r.cnpj === '22222222000191')!
  assert.equal(zerada.sem_venda, true)
  assert.equal(zerada.sem_consulta, true)     // consultas = 0 de verdade, não aprovados = 0
  assert.equal(zerada.ticket_medio, null)
  assert.equal(zerada.conversao, 0)
  assert.equal(zerada.cadastro_em, '2026-05-01') // sem coluna do portal → primeira aparição
  assert.equal(zerada.atencao, null)           // vendeu em agosto, dentro dos 30 dias
})

test('agregarMensal marca baixa performance quando não vende há 30 dias', () => {
  const serie = [
    linha({ data_ref: '2026-09-08', retailer_id: 'r3', mes: '2026-09-01', cnpj: '22222222000191', vendas: 0 }),
    linha({ data_ref: '2026-08-31', retailer_id: 'r3', mes: '2026-08-01', cnpj: '22222222000191', vendas: 0, aprovados: 1 }),
  ]
  const rows = agregarMensal(serie, '2026-09-01', '2026-09-09', new Map([['r3', '2026-05-01']]))
  assert.equal(rows[0].atencao, 'baixa_performance')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/portal-aiva-derivar.test.ts`
Expected: FAIL — `agregarMensal is not a function`

- [ ] **Step 3: Implementar**

```ts
// acrescentar ao lib/portal-aiva-derivar.ts
export type LinhaMensal = {
  mes: string               // YYYY-MM (formato da aiva_desempenho)
  cnpj: string
  nome_varejo: string | null
  loja: string | null
  rid: string | null
  status_portal: string | null
  consultas: number
  aprovados: number
  vendas: number
  valor_vendas: number
  conversao: number
  ticket_medio: number | null
  inadimplencia_aiva: number | null
  inadimplencia_odres: number | null
  foto_fora_pct: number | null
  cadastro_em: string | null
  atencao: Atencao
  sem_venda: boolean
  sem_consulta: boolean
  // colunas do Data Studio que continuam na tabela — sempre nulas/false agora
  uf: null; cidade: null; status_consulta: null; sem_operador: false; telefone: null; qtd_operadores: null
}

const maxNulo = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b))
const minData = (a: string | null, b: string | null) => (a == null ? b : b == null ? a : a < b ? a : b)

/**
 * Vendas de uma loja nos últimos 30 dias até `hoje`, pela série: acumulado do
 * mês corrente + (acumulado final do mês anterior − acumulado do mês anterior
 * em hoje−30). Sem retrato antigo o mês anterior entra inteiro — é a
 * aproximação "mês corrente + anterior" da spec, que some sozinha quando a
 * série tiver 30 dias.
 */
function vendas30d(serie: LinhaDiaria[], retailerId: string, hoje: string): number {
  const mesAtual = mesDe(hoje)
  const mesAnt = mesDe(somarDias(mesAtual, -1))
  const inicioJanela = somarDias(hoje, -30)
  const atual = mtdEm(serie, retailerId, mesAtual, hoje).vendas
  if (inicioJanela >= mesAtual) return atual
  const fimAnt = mtdEm(serie, retailerId, mesAnt, ultimoDiaDoMes(mesAnt)).vendas
  const inicioAnt = mtdEm(serie, retailerId, mesAnt, inicioJanela).vendas
  return atual + Math.max(0, fimAnt - inicioAnt)
}

/**
 * Uma linha por CNPJ pra aiva_desempenho, a partir do ÚLTIMO retrato do mês.
 * Agrega multi-lojas do mesmo CNPJ (Multicell Loja 1/2/3): soma métricas, fica
 * o nome/RID da loja que mais vendeu, Ativo se qualquer loja está ativa,
 * inadimplência = a maior, cadastro = o mais antigo.
 *
 * `primeiraAparicao`: retailer_id → primeiro data_ref na série inteira (quem
 * chama lê do banco). É o cadastro quando o portal não expõe a coluna.
 */
export function agregarMensal(
  serie: LinhaDiaria[],
  mes: string,
  hoje: string,
  primeiraAparicao: Map<string, string>,
): LinhaMensal[] {
  const doMes = serie.filter((l) => l.mes === mes)
  if (!doMes.length) return []
  const ultimo = doMes.reduce((m, l) => (l.data_ref > m ? l.data_ref : m), doMes[0].data_ref)
  const retrato = doMes.filter((l) => l.data_ref === ultimo)

  type Acc = LinhaMensal & { _maisVendas: number; _aprovDesdeCad: number; _vendasDesdeCad: number; _vendas30d: number; _cad: string | null }
  const porCnpj = new Map<string, Acc>()
  for (const l of retrato) {
    const cadastro = l.cadastro_em ?? primeiraAparicao.get(l.retailer_id) ?? null
    // "desde o cadastro" pra lojas novas (≤ 29 dias) cabe em mês atual + anterior
    const mesAnt = mesDe(somarDias(mes, -1))
    const ant = mtdEm(serie, l.retailer_id, mesAnt, ultimoDiaDoMes(mesAnt))
    const acc = porCnpj.get(l.cnpj)
    if (!acc) {
      porCnpj.set(l.cnpj, {
        mes: mes.slice(0, 7), cnpj: l.cnpj, nome_varejo: l.nome_varejo, loja: l.nome_varejo, rid: l.retailer_id,
        status_portal: l.status, consultas: l.consultas, aprovados: l.aprovados, vendas: l.vendas, valor_vendas: Number(l.valor_vendas),
        conversao: 0, ticket_medio: null,
        inadimplencia_aiva: l.inadimplencia_aiva, inadimplencia_odres: l.inadimplencia_odres, foto_fora_pct: l.foto_fora_pct,
        cadastro_em: cadastro, atencao: null, sem_venda: false, sem_consulta: false,
        uf: null, cidade: null, status_consulta: null, sem_operador: false, telefone: null, qtd_operadores: null,
        _maisVendas: l.vendas, _aprovDesdeCad: l.aprovados + ant.aprovados, _vendasDesdeCad: l.vendas + ant.vendas,
        _vendas30d: vendas30d(serie, l.retailer_id, hoje), _cad: cadastro,
      })
      continue
    }
    acc.consultas += l.consultas
    acc.aprovados += l.aprovados
    acc.vendas += l.vendas
    acc.valor_vendas += Number(l.valor_vendas)
    if (l.vendas > acc._maisVendas) { acc._maisVendas = l.vendas; acc.loja = l.nome_varejo; acc.rid = l.retailer_id }
    if (l.status === 'Ativo') acc.status_portal = 'Ativo'
    acc.inadimplencia_aiva = maxNulo(acc.inadimplencia_aiva, l.inadimplencia_aiva)
    acc.inadimplencia_odres = maxNulo(acc.inadimplencia_odres, l.inadimplencia_odres)
    acc.foto_fora_pct = maxNulo(acc.foto_fora_pct, l.foto_fora_pct)
    acc.cadastro_em = minData(acc.cadastro_em, cadastro)
    acc._aprovDesdeCad += l.aprovados + ant.aprovados
    acc._vendasDesdeCad += l.vendas + ant.vendas
    acc._vendas30d += vendas30d(serie, l.retailer_id, hoje)
  }

  return [...porCnpj.values()].map(({ _maisVendas, _aprovDesdeCad, _vendasDesdeCad, _vendas30d, _cad, ...r }) => ({
    ...r,
    conversao: r.aprovados > 0 ? r.vendas / r.aprovados : 0,
    ticket_medio: r.vendas > 0 ? r.valor_vendas / r.vendas : null,
    sem_venda: r.vendas === 0,
    sem_consulta: r.consultas === 0,
    atencao: classificarAtencao({ cadastro: r.cadastro_em, hoje, vendasDesdeCadastro: _vendasDesdeCad, aprovadosDesdeCadastro: _aprovDesdeCad, vendas30d: _vendas30d }),
  }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/portal-aiva-derivar.test.ts`
Expected: `# pass 5`

- [ ] **Step 5: Commit**

```bash
git add lib/portal-aiva-derivar.ts lib/portal-aiva-derivar.test.ts
git commit -m "feat(portal-aiva): agregarMensal — último retrato do mês agregado por CNPJ"
```

---

### Task 5: `derivarSemana`

**Files:**
- Modify: `lib/portal-aiva-derivar.ts`
- Modify: `lib/portal-aiva-derivar.test.ts`

Regras (spec): semana seg–dom; `semana = MTD(dom) − MTD(dom−7)` por mês tocado; cruzando mês soma os dois pedaços; delta negativo → 0 + aviso; entra a loja com atividade na semana OU vendas > 0 na semana anterior (mapa passado por quem chama, lido de `aiva_desempenho_semanal`); ponto final = retrato de domingo, senão o de segunda (aviso), senão erro.

- [ ] **Step 1: Teste**

```ts
// acrescentar ao lib/portal-aiva-derivar.test.ts
import { derivarSemana } from './portal-aiva-derivar.ts'

const L = (data_ref: string, retailer_id: string, mes: string, m: Partial<LinhaDiaria>) =>
  linha({ data_ref, retailer_id, mes, cnpj: retailer_id.padStart(14, '0'), nome_varejo: 'Loja ' + retailer_id, ...m })

test('derivarSemana: semana normal = domingo menos domingo anterior', () => {
  const serie = [
    L('2026-09-06', 'r1', '2026-09-01', { consultas: 10, aprovados: 4, vendas: 1, valor_vendas: 100 }),
    L('2026-09-13', 'r1', '2026-09-01', { consultas: 25, aprovados: 9, vendas: 3, valor_vendas: 450 }),
  ]
  const { linhas, avisos } = derivarSemana(serie, '2026-09-07', new Map())
  assert.equal(avisos.length, 0)
  assert.equal(linhas.length, 1)
  assert.deepEqual(
    { ...linhas[0] },
    { semana: '2026-09-07', cnpj: '000000000000r1', rid: 'r1', nome_varejo: 'Loja r1', loja: 'Loja r1', uf: null, cidade: null, consultas: 15, aprovados: 5, vendas: 2, valor_vendas: 350 },
  )
})

test('derivarSemana: virada de mês soma o fim do mês antigo com o começo do novo', () => {
  // semana 31/08 (seg) a 06/09 (dom): agosto fecha em 31/08, setembro começa em 01/09
  const serie = [
    L('2026-08-30', 'r1', '2026-08-01', { vendas: 10, aprovados: 20, consultas: 30, valor_vendas: 1000 }),
    L('2026-08-31', 'r1', '2026-08-01', { vendas: 12, aprovados: 22, consultas: 33, valor_vendas: 1200 }),
    L('2026-09-06', 'r1', '2026-08-01', { vendas: 12, aprovados: 22, consultas: 33, valor_vendas: 1200 }), // agosto ainda vem no retrato
    L('2026-09-06', 'r1', '2026-09-01', { vendas: 3, aprovados: 5, consultas: 8, valor_vendas: 300 }),
  ]
  const { linhas } = derivarSemana(serie, '2026-08-31', new Map())
  assert.equal(linhas[0].vendas, 2 + 3)
  assert.equal(linhas[0].aprovados, 2 + 5)
  assert.equal(linhas[0].consultas, 3 + 8)
  assert.equal(linhas[0].valor_vendas, 200 + 300)
})

test('derivarSemana: dia sem coleta usa o retrato anterior; delta negativo vira 0 com aviso', () => {
  const serie = [
    L('2026-09-05', 'r1', '2026-09-01', { vendas: 4, aprovados: 4, consultas: 4, valor_vendas: 400 }), // não tem 06/09
    L('2026-09-13', 'r1', '2026-09-01', { vendas: 3, aprovados: 6, consultas: 9, valor_vendas: 300 }), // AIVA cancelou 1 venda
  ]
  const { linhas, avisos } = derivarSemana(serie, '2026-09-07', new Map())
  assert.equal(linhas[0].vendas, 0)
  assert.equal(linhas[0].valor_vendas, 0)
  assert.equal(linhas[0].aprovados, 2)
  assert.equal(avisos.length, 1)
  assert.match(avisos[0], /negativo/)
})

test('derivarSemana: quem entra — atividade na semana ou venda na semana anterior', () => {
  const serie = [
    L('2026-09-06', 'r1', '2026-09-01', { vendas: 2 }),
    L('2026-09-13', 'r1', '2026-09-01', { vendas: 2 }),          // zerada nesta semana, mas vendeu na anterior → entra (segmento C)
    L('2026-09-06', 'r2', '2026-09-01', {}),
    L('2026-09-13', 'r2', '2026-09-01', {}),                     // zerada nas duas → fora
    L('2026-09-06', 'r3', '2026-09-01', {}),
    L('2026-09-13', 'r3', '2026-09-01', { consultas: 1 }),       // só consultou → entra (segmento A)
  ]
  const vendasAnt = new Map([['000000000000r1', 2]])
  const { linhas } = derivarSemana(serie, '2026-09-07', vendasAnt)
  assert.deepEqual(linhas.map((l) => l.rid).sort(), ['r1', 'r3'])
  assert.equal(linhas.find((l) => l.rid === 'r1')!.vendas, 0)
})

test('derivarSemana: sem retrato de domingo usa o de segunda com aviso; sem nenhum, erro', () => {
  const serie = [
    L('2026-09-06', 'r1', '2026-09-01', { vendas: 1 }),
    L('2026-09-14', 'r1', '2026-09-01', { vendas: 4 }),
  ]
  const { linhas, avisos } = derivarSemana(serie, '2026-09-07', new Map())
  assert.equal(linhas[0].vendas, 3)
  assert.match(avisos[0], /segunda/)
  assert.throws(() => derivarSemana([L('2026-09-06', 'r1', '2026-09-01', {})], '2026-09-07', new Map()), /retrato/)
})

test('derivarSemana: duas lojas do mesmo CNPJ viram uma linha (RID da que mais vendeu)', () => {
  const serie = [
    linha({ data_ref: '2026-09-06', retailer_id: 'a', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Loja A' }),
    linha({ data_ref: '2026-09-13', retailer_id: 'a', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Loja A', vendas: 1, valor_vendas: 100 }),
    linha({ data_ref: '2026-09-06', retailer_id: 'b', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Loja B' }),
    linha({ data_ref: '2026-09-13', retailer_id: 'b', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Loja B', vendas: 3, valor_vendas: 300 }),
  ]
  const { linhas } = derivarSemana(serie, '2026-09-07', new Map())
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].vendas, 4)
  assert.equal(linhas[0].rid, 'b')
  assert.equal(linhas[0].loja, 'Loja B')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/portal-aiva-derivar.test.ts`
Expected: FAIL — `derivarSemana is not a function`

- [ ] **Step 3: Implementar**

```ts
// acrescentar ao lib/portal-aiva-derivar.ts
export type LinhaSemanal = {
  semana: string          // segunda-feira YYYY-MM-DD
  cnpj: string
  rid: string | null
  nome_varejo: string | null
  loja: string | null
  uf: null
  cidade: null
  consultas: number       // não existe na tabela semanal — usado só pro filtro de inclusão
  aprovados: number
  vendas: number
  valor_vendas: number
}

const chaves: (keyof Metricas)[] = ['consultas', 'aprovados', 'vendas', 'valor_vendas']

/**
 * Semana fechada (segunda a domingo) a partir dos acumulados do mês:
 *   semana = MTD(domingo) − MTD(domingo − 7)
 * Semana que cruza mês: [MTD(último dia do mês antigo) − MTD(dom−7)] + MTD(dom, mês novo).
 *
 * Ponto final: o retrato de domingo; se a coleta de segunda falhou, aceita o
 * retrato de segunda (aviso — inclui a segunda-feira) ; sem nenhum dos dois,
 * erro — sem ponto final não existe semana.
 *
 * Delta negativo (AIVA cancelou/reprocessou contrato) vira 0 e entra em
 * `avisos` — nunca chega a mensagem pro lojista.
 *
 * Quem entra: loja com consultas/aprovados/vendas > 0 na semana OU vendas > 0
 * na semana anterior (`vendasSemanaAnterior`, por CNPJ, lido de
 * aiva_desempenho_semanal) — preserva o segmento C "queda" do pulso e o
 * comportamento do Data Studio, que só listava quem teve atividade.
 */
export function derivarSemana(
  serie: LinhaDiaria[],
  segunda: string,
  vendasSemanaAnterior: Map<string, number>,
): { linhas: LinhaSemanal[]; avisos: string[] } {
  const avisos: string[] = []
  const domingo = somarDias(segunda, 6)
  const domAnt = somarDias(segunda, -1)
  const temRetrato = (d: string) => serie.some((l) => l.data_ref === d)
  let fim = domingo
  if (!temRetrato(domingo)) {
    if (!temRetrato(somarDias(domingo, 1))) throw new Error(`sem retrato de ${domingo} nem de ${somarDias(domingo, 1)} — não dá pra fechar a semana ${segunda}`)
    fim = somarDias(domingo, 1)
    avisos.push(`sem retrato de domingo ${domingo}; usando o de segunda ${fim} (inclui a segunda-feira)`)
  }
  const meses = [...new Set([mesDe(segunda), mesDe(domingo)])]

  const porRetailer = new Map<string, LinhaDiaria>()
  for (const l of serie) if (!porRetailer.has(l.retailer_id)) porRetailer.set(l.retailer_id, l)

  type Acc = LinhaSemanal & { _maisVendas: number }
  const porCnpj = new Map<string, Acc>()
  for (const [rid, info] of porRetailer) {
    const delta: Metricas = { ...ZERO }
    for (const mes of meses) {
      const fimMes = mes === mesDe(fim) ? fim : ultimoDiaDoMes(mes)
      const a = mtdEm(serie, rid, mes, fimMes)
      const b = mtdEm(serie, rid, mes, domAnt)
      for (const k of chaves) {
        const d = a[k] - b[k]
        if (d < 0) { avisos.push(`${info.nome_varejo ?? rid} (${rid}): ${k} negativo em ${mes} (${b[k]} → ${a[k]}); zerado`); continue }
        delta[k] += d
      }
    }
    const acc = porCnpj.get(info.cnpj)
    if (!acc) {
      porCnpj.set(info.cnpj, { semana: segunda, cnpj: info.cnpj, rid, nome_varejo: info.nome_varejo, loja: info.nome_varejo, uf: null, cidade: null, ...delta, _maisVendas: delta.vendas })
      continue
    }
    for (const k of chaves) acc[k] += delta[k]
    if (delta.vendas > acc._maisVendas) { acc._maisVendas = delta.vendas; acc.rid = rid; acc.loja = info.nome_varejo }
  }

  const linhas = [...porCnpj.values()]
    .filter((l) => l.consultas > 0 || l.aprovados > 0 || l.vendas > 0 || (vendasSemanaAnterior.get(l.cnpj) ?? 0) > 0)
    .map(({ _maisVendas, ...l }) => l)
  return { linhas, avisos }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/portal-aiva-derivar.test.ts`
Expected: `# pass 11`

- [ ] **Step 5: Adicionar script de teste no package.json**

Em `package.json`, dentro de `"scripts"`, acrescentar:
```json
"test:portal": "node --test lib/portal-aiva-derivar.test.ts"
```

Run: `npm run test:portal` — Expected: `# pass 11`

- [ ] **Step 6: Commit**

```bash
git add lib/portal-aiva-derivar.ts lib/portal-aiva-derivar.test.ts package.json
git commit -m "feat(portal-aiva): derivarSemana — domingo menos domingo anterior, com virada de mês"
```

---

### Task 6: Cliente do portal (login, partner, busca)

**Files:**
- Create: `lib/portal-aiva.ts`
- Modify: `.env.example`
- Modify: `.env.local` (só pelo Aldo — e-mail/senha)

- [ ] **Step 1: Env**

Em `.env.example` acrescentar:
```env
# Portal Parceiros AIVA (fonte do desempenho desde 09/09/2026 — spec docs/superpowers/specs/2026-09-09-*)
AIVA_PORTAL_URL=https://xznsbwdpfmwvuqipeilq.supabase.co
AIVA_PORTAL_ANON_KEY=sb_publishable_EenngGy0xB2pzpwglt_HNg_qp3Rt7xg
AIVA_PORTAL_EMAIL=
AIVA_PORTAL_SENHA=
AIVA_PORTAL_PARTNER_ID=647bcb15-f6ad-4da9-aa70-d65900461500
```
No `.env.local` colar as mesmas linhas. **O Aldo preenche `AIVA_PORTAL_EMAIL`/`AIVA_PORTAL_SENHA`** (pedir a ele no fim deste task; não pedir a senha no chat).

- [ ] **Step 2: Escrever o cliente**

```ts
// lib/portal-aiva.ts
/**
 * Portal Parceiros AIVA (parceiro-aiva.lovable.app) — coleta por API.
 *
 * O portal é um app Lovable com Supabase próprio; a tela "Performance" lê a
 * tabela retailer_performance via PostgREST filtrada pelo partner_id da Track.
 * Aqui fazemos o mesmo, logando com e-mail/senha (grant password) a cada
 * execução — nenhum token fica guardado. Spec: docs/superpowers/specs/2026-09-09-*.
 *
 * Substituiu o Data Studio em 09/09/2026 (coletor-funil-loja.js ficou como legado).
 */
import { supabaseAdmin } from '@/lib/supabase'
import { sendText } from '@/lib/evotalks'
import {
  agregarMensal, derivarSemana, mesDe, somarDias,
  type LinhaDiaria, type LinhaMensal, type LinhaSemanal,
} from '@/lib/portal-aiva-derivar'

const URL_PORTAL = () => (process.env.AIVA_PORTAL_URL ?? '').replace(/\/$/, '')
const ANON = () => process.env.AIVA_PORTAL_ANON_KEY ?? ''

/** Linha crua da tabela retailer_performance do portal (select=*). */
export type LinhaPortal = {
  id: string
  retailer_id: string | number
  partner_id: string
  cnpj: string | null
  retailer_name: string | null
  mes: string
  n_consultas: number | null
  n_aprovados: number | null
  n_vendas: number | null
  valor_vendas: number | string | null
  inadimplencia_aiva: number | null
  inadimplencia_odres: number | null
  out_of_store_photo_pct: number | null
  status: string | null
  [extra: string]: unknown
}

export type Sessao = { token: string; userId: string }

export async function loginPortal(): Promise<Sessao> {
  const email = process.env.AIVA_PORTAL_EMAIL, senha = process.env.AIVA_PORTAL_SENHA
  if (!URL_PORTAL() || !ANON() || !email || !senha) throw new Error('env do portal incompleta (AIVA_PORTAL_URL/ANON_KEY/EMAIL/SENHA)')
  const res = await fetch(`${URL_PORTAL()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON() },
    body: JSON.stringify({ email, password: senha }),
  })
  if (!res.ok) throw new Error(`login do portal recusado: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const j = (await res.json()) as { access_token: string; user: { id: string } }
  return { token: j.access_token, userId: j.user.id }
}

async function rest<T>(s: Sessao, path: string, range?: [number, number]): Promise<{ data: T; total: number | null }> {
  const headers: Record<string, string> = { apikey: ANON(), Authorization: `Bearer ${s.token}`, Prefer: 'count=exact' }
  if (range) headers.Range = `${range[0]}-${range[1]}`
  const res = await fetch(`${URL_PORTAL()}/rest/v1/${path}`, { headers })
  if (!res.ok && res.status !== 206) throw new Error(`portal ${path.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const cr = res.headers.get('content-range') ?? ''   // "0-999/1234"
  const total = cr.includes('/') && cr.split('/')[1] !== '*' ? Number(cr.split('/')[1]) : null
  return { data: (await res.json()) as T, total }
}

/** partner_id da Track: lê do profile do usuário logado; env como fallback. */
export async function partnerIdTrack(s: Sessao): Promise<string> {
  try {
    const { data } = await rest<{ partner_id: string | null }[]>(s, `profiles?select=partner_id&id=eq.${s.userId}`)
    if (data[0]?.partner_id) return data[0].partner_id
  } catch (e) {
    console.warn('[portal-aiva] profile indisponível, usando AIVA_PORTAL_PARTNER_ID:', e)
  }
  const env = process.env.AIVA_PORTAL_PARTNER_ID
  if (!env) throw new Error('sem partner_id: profile não devolveu e AIVA_PORTAL_PARTNER_ID vazio')
  return env
}

/**
 * Busca retailer_performance paginada (PostgREST limita em 1.000 por resposta;
 * o portal já beira isso no total). `mesMinimo` = YYYY-MM-01; null = todos.
 */
export async function buscarPerformance(s: Sessao, partnerId: string, mesMinimo: string | null): Promise<LinhaPortal[]> {
  const filtro = `select=*&partner_id=eq.${partnerId}&order=mes.desc,retailer_id.asc` + (mesMinimo ? `&mes=gte.${mesMinimo}` : '')
  const tudo: LinhaPortal[] = []
  for (let de = 0; ; de += 1000) {
    const { data, total } = await rest<LinhaPortal[]>(s, `retailer_performance?${filtro}`, [de, de + 999])
    tudo.push(...data)
    if (data.length < 1000 || (total != null && tudo.length >= total)) break
  }
  return tudo
}

/** Converte a linha do portal pro formato da nossa série diária. */
export function paraLinhaDiaria(l: LinhaPortal, dataRef: string): LinhaDiaria {
  const dataCad = typeof l.created_at === 'string' ? l.created_at.slice(0, 10)
    : typeof l.cadastro_em === 'string' ? l.cadastro_em.slice(0, 10)
    : typeof l.retailer_created_at === 'string' ? l.retailer_created_at.slice(0, 10)
    : null
  return {
    data_ref: dataRef,
    retailer_id: String(l.retailer_id),
    mes: String(l.mes).slice(0, 10),
    cnpj: String(l.cnpj ?? '').replace(/\D/g, '').padStart(14, '0'),
    nome_varejo: l.retailer_name ?? null,
    consultas: l.n_consultas ?? 0,
    aprovados: l.n_aprovados ?? 0,
    vendas: l.n_vendas ?? 0,
    valor_vendas: Number(l.valor_vendas ?? 0),
    inadimplencia_aiva: l.inadimplencia_aiva ?? null,
    inadimplencia_odres: l.inadimplencia_odres ?? null,
    foto_fora_pct: l.out_of_store_photo_pct ?? null,
    status: l.status ?? null,
    cadastro_em: dataCad,
  }
}

/** Hoje em BRT, YYYY-MM-DD. */
export function hojeBrt(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export async function avisarAldo(texto: string): Promise<void> {
  const tel = process.env.ALDO_WHATSAPP
  if (!tel) return
  try { await sendText(tel, texto) } catch (e) { console.error('[portal-aiva] aviso WhatsApp falhou:', e) }
}
```

> ⚠️ Sobre `cadastro_em`: o `select=*` vai revelar se o portal expõe a data de cadastro (a aba "Precisam de atenção" mostra uma). `paraLinhaDiaria` tenta `created_at`, `cadastro_em` e `retailer_created_at`. No Task 8 (dry-run real) **imprima as chaves da primeira linha** e ajuste esse trecho pro nome verdadeiro — se nenhuma coluna existir, fica nulo e a "primeira aparição" assume, como manda a spec.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep portal-aiva`
Expected: nenhuma linha (sem erros nesses arquivos).

- [ ] **Step 4: Commit**

```bash
git add lib/portal-aiva.ts .env.example
git commit -m "feat(portal-aiva): cliente do portal — login, partner, busca paginada"
```

- [ ] **Step 5: Pedir ao Aldo** que preencha `AIVA_PORTAL_EMAIL` e `AIVA_PORTAL_SENHA` no `.env.local` (e depois no Vercel — Task 9). Continuar os tasks 7 e 8 enquanto isso.

---

### Task 7: Persistência e derivações no banco

**Files:**
- Modify: `lib/portal-aiva.ts`

- [ ] **Step 1: Acrescentar gravação da série e derivações**

```ts
// acrescentar ao lib/portal-aiva.ts

/** Grava o retrato do dia (upsert — rodar duas vezes substitui a mesma data_ref). */
export async function gravarDiario(linhas: LinhaDiaria[], brutas: LinhaPortal[]): Promise<void> {
  const brutoPor = new Map(brutas.map((b) => [`${b.retailer_id}|${String(b.mes).slice(0, 10)}`, b]))
  const rows = linhas.map((l) => ({ ...l, bruto: brutoPor.get(`${l.retailer_id}|${l.mes}`) ?? {}, coletado_em: new Date().toISOString() }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from('aiva_portal_diario').upsert(rows.slice(i, i + 500), { onConflict: 'data_ref,retailer_id,mes' })
    if (error) throw new Error(`gravar aiva_portal_diario: ${error.message}`)
  }
}

/** Série diária de um intervalo de meses (mes >= de, mes <= ate) — dados, sem o jsonb. */
export async function lerSerie(mesDe: string, mesAte: string): Promise<LinhaDiaria[]> {
  const cols = 'data_ref,retailer_id,mes,cnpj,nome_varejo,consultas,aprovados,vendas,valor_vendas,inadimplencia_aiva,inadimplencia_odres,foto_fora_pct,status,cadastro_em'
  const tudo: LinhaDiaria[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabaseAdmin.from('aiva_portal_diario').select(cols).gte('mes', mesDe).lte('mes', mesAte).range(de, de + 999)
    if (error) throw new Error(`ler aiva_portal_diario: ${error.message}`)
    tudo.push(...((data ?? []) as unknown as LinhaDiaria[]))
    if (!data || data.length < 1000) break
  }
  return tudo.map((l) => ({ ...l, valor_vendas: Number(l.valor_vendas) }))
}

/** retailer_id → primeiro data_ref em que apareceu (cadastro quando o portal não expõe). */
export async function primeiraAparicao(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin.rpc('assistente_sql', {
    q: `select coalesce(jsonb_agg(t), '[]'::jsonb) from (select retailer_id, min(data_ref) as primeiro from aiva_portal_diario group by retailer_id) t`,
  })
  if (error) throw new Error(`primeiraAparicao: ${error.message}`)
  return new Map(((data ?? []) as { retailer_id: string; primeiro: string }[]).map((r) => [r.retailer_id, r.primeiro]))
}

/**
 * Rederiva aiva_desempenho de um mês (YYYY-MM) a partir do último retrato.
 * Apaga e insere — mesma semântica "reimportar substitui" do importador antigo.
 */
export async function salvarMensal(mes: string, hoje = hojeBrt()): Promise<{ lojas: number; aprovados: number; vendas: number; valor: number }> {
  const mesPortal = mes + '-01'
  const mesAnt = mesDe(somarDias(mesPortal, -1))
  const serie = await lerSerie(mesAnt, mesPortal)
  const rows: LinhaMensal[] = agregarMensal(serie, mesPortal, hoje, await primeiraAparicao())
  if (!rows.length) throw new Error(`sem retrato do portal pra ${mes}`)
  const atualizado_em = new Date().toISOString()
  const del = await supabaseAdmin.from('aiva_desempenho').delete().eq('mes', mes)
  if (del.error) throw new Error(`limpar aiva_desempenho ${mes}: ${del.error.message}`)
  const ins = await supabaseAdmin.from('aiva_desempenho').insert(rows.map((r) => ({ ...r, atualizado_em })))
  if (ins.error) throw new Error(`gravar aiva_desempenho ${mes}: ${ins.error.message}`)
  return {
    lojas: rows.length,
    aprovados: rows.reduce((s, r) => s + r.aprovados, 0),
    vendas: rows.reduce((s, r) => s + r.vendas, 0),
    valor: rows.reduce((s, r) => s + r.valor_vendas, 0),
  }
}

/** Rederiva aiva_desempenho_semanal da semana (segunda YYYY-MM-DD). */
export async function salvarSemanal(segunda: string): Promise<{ lojas: number; vendas: number; avisos: string[] }> {
  if (new Date(segunda + 'T12:00:00Z').getUTCDay() !== 1) throw new Error(`${segunda} não é segunda-feira`)
  const domAnt = somarDias(segunda, -1), fim = somarDias(segunda, 7)
  const serie = (await lerSerie(mesDe(domAnt), mesDe(fim))).filter((l) => l.data_ref >= domAnt && l.data_ref <= fim)
  const { data: ant } = await supabaseAdmin.from('aiva_desempenho_semanal').select('cnpj,vendas').eq('semana', somarDias(segunda, -7))
  const vendasAnt = new Map((ant ?? []).map((r) => [r.cnpj as string, Number(r.vendas)]))
  const { linhas, avisos } = derivarSemana(serie, segunda, vendasAnt)
  const rows = linhas.map(({ consultas, ...l }: LinhaSemanal) => ({ ...l, criado_em: new Date().toISOString() }))
  const del = await supabaseAdmin.from('aiva_desempenho_semanal').delete().eq('semana', segunda)
  if (del.error) throw new Error(`limpar semanal ${segunda}: ${del.error.message}`)
  if (rows.length) {
    const ins = await supabaseAdmin.from('aiva_desempenho_semanal').insert(rows)
    if (ins.error) throw new Error(`gravar semanal ${segunda}: ${ins.error.message}`)
  }
  return { lojas: rows.length, vendas: rows.reduce((s, r) => s + r.vendas, 0), avisos }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep portal-aiva`
Expected: nada. (Se o `select` tipado do Supabase reclamar do cast, manter o `as unknown as LinhaDiaria[]` — a tabela não está nos tipos gerados.)

- [ ] **Step 3: Commit**

```bash
git add lib/portal-aiva.ts
git commit -m "feat(portal-aiva): gravar série diária e rederivar mensal/semanal no banco"
```

---

### Task 8: Ativação diária (loja presente no portal com status Ativo)

**Files:**
- Modify: `lib/portal-aiva.ts`

Mesma ação do `scripts/detectar-lojas-ativas.mjs` (que fica intacto como rede de segurança de segunda), agora em TS e disparada todo dia pela rota.

- [ ] **Step 1: Implementar**

```ts
// acrescentar aos imports do lib/portal-aiva.ts
import { createOpportunity, updateOpportunityDescription, addOpportunityTags, getPipeOpportunities, PIPELINE_MRR, STAGE_MRR_INICIO, TAG_IDS } from '@/lib/evotalks'

// acrescentar ao lib/portal-aiva.ts
/**
 * CNPJ registrado (sdr_registros_cnpj) que aparece no retrato do dia com
 * status Ativo = loja ativada na AIVA (decisão do Aldo 09/09: presença no
 * portal, não a primeira consulta). Marca status='ativa' + RID, cria a conta
 * espelho no funil 11 (dedupe por UME_RID na descrição) e manda digest pro
 * Aldo/Nei só quando houve novidade. Espelha detectar-lojas-ativas.mjs.
 */
export async function ativarLojasPresentes(retrato: LinhaDiaria[], dry: boolean): Promise<string[]> {
  const ativasPorCnpj = new Map<string, LinhaDiaria>()
  for (const l of retrato) if (l.status === 'Ativo' && !ativasPorCnpj.has(l.cnpj)) ativasPorCnpj.set(l.cnpj, l)

  const { data: pendentes, error } = await supabaseAdmin.from('sdr_registros_cnpj').select('id,lead_id,loja,telefone,cnpj,status').neq('status', 'ativa')
  if (error) throw new Error(`sdr_registros_cnpj: ${error.message}`)
  const ativaram = (pendentes ?? []).filter((r) => ativasPorCnpj.has(String(r.cnpj)))
  if (!ativaram.length) return []

  const opps = dry ? [] : await getPipeOpportunities(PIPELINE_MRR)
  const linhas: string[] = []
  for (const r of ativaram) {
    const s = ativasPorCnpj.get(String(r.cnpj))!
    const rid = s.retailer_id
    const fone = String(r.telefone ?? '').replace(/\D/g, '')
    if (dry) { linhas.push(`• ${r.loja} — ${s.nome_varejo ?? r.cnpj} (RID ${rid}) [dry]`); continue }

    await supabaseAdmin.from('sdr_registros_cnpj').update({ status: 'ativa', rid, ativa_em: new Date().toISOString() }).eq('id', r.id)

    const re = new RegExp(`UME_RID:\\s*${rid}\\b`)
    const dup = opps.find((o) => re.test(o.description ?? ''))
    let contaInfo: string
    if (dup) contaInfo = `conta MRR já existia (#${dup.id})`
    else {
      try {
        const id = await createOpportunity({ title: (s.nome_varejo ?? r.loja ?? 'Loja AIVA').trim(), number: fone, pipelineId: PIPELINE_MRR, stageId: STAGE_MRR_INICIO, responsableId: 507 })
        await updateOpportunityDescription(id, `UME_RID: ${rid} | CNPJ: ${r.cnpj} | Loja de ${r.loja} (ativa no portal AIVA em ${s.data_ref}) | Fone lojista: ${fone}`)
        await addOpportunityTags(id, [TAG_IDS.UME])
        // read-after-write (lição 26/08: o Evo pode responder 200 sem persistir)
        const conf = (await getPipeOpportunities(PIPELINE_MRR)).find((o) => o.id === id && re.test(o.description ?? ''))
        contaInfo = conf ? `conta MRR criada (#${id})` : `⚠️ conta #${id} criada mas descrição NÃO confirmou — conferir`
      } catch (e) {
        contaInfo = `⚠️ falha ao criar conta MRR: ${String(e).slice(0, 100)}`
      }
    }
    linhas.push(`• ${r.loja} — ${s.nome_varejo ?? r.cnpj} (RID ${rid}) → ${contaInfo}`)
  }

  if (!dry) {
    const resumo = `🆕 *Lojas novas ATIVARAM no portal AIVA (${retrato[0]?.data_ref ?? hojeBrt()})*\n${linhas.join('\n')}`
    for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean) as string[]) {
      try { await sendText(tel, resumo) } catch (e) { console.error('[portal-aiva] digest de ativação falhou:', e) }
    }
  }
  return linhas
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p . 2>&1 | grep portal-aiva`
Expected: nada. Se `PipelineOpportunity` não tiver `description`, olhe `lib/evotalks.ts:316` — tem.

- [ ] **Step 3: Commit**

```bash
git add lib/portal-aiva.ts
git commit -m "feat(portal-aiva): ativação diária — CNPJ registrado presente no portal como Ativo"
```

---

### Task 9: Rota cron, `vercel.json`, CLI e primeiro run real

**Files:**
- Create: `app/api/cron/portal-aiva/route.ts`
- Modify: `vercel.json`
- Create: `scripts/portal-aiva.mjs`

- [ ] **Step 1: Rota**

```ts
// app/api/cron/portal-aiva/route.ts
/**
 * Cron diário (6h BRT) — coleta o Portal Parceiros AIVA e rederiva o desempenho.
 *
 * Fluxo: login → partner → busca (mês corrente + anterior; ?tudo=1 ou tabela
 * vazia = todos os meses) → validação → grava aiva_portal_diario (data_ref =
 * ontem) → rederiva mensal → (segunda) rederiva a semana fechada → ativação.
 *
 * Reprocesso na mão: ?mes=YYYY-MM | ?semana=YYYY-MM-DD (segunda) | ?dry=1.
 * Falha = WhatsApp pro Aldo + HTTP 500 (aparece no log do Vercel). Sucesso é
 * silencioso — o painel mostra a data do retrato.
 *
 * GET obrigatório: o cron do Vercel chama por GET (rota sem GET = 405 silencioso).
 */
import { NextRequest, NextResponse } from 'next/server'
import {
  loginPortal, partnerIdTrack, buscarPerformance, paraLinhaDiaria, gravarDiario,
  salvarMensal, salvarSemanal, ativarLojasPresentes, avisarAldo, hojeBrt,
} from '@/lib/portal-aiva'
import { mesDe, somarDias } from '@/lib/portal-aiva-derivar'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const sp = req.nextUrl.searchParams
  const dry = sp.get('dry') === '1'
  const hoje = hojeBrt()
  const ontem = somarDias(hoje, -1)
  const log: string[] = []

  try {
    // Só rederivar (sem coletar): ?mes= / ?semana= sem ?coletar=1
    if ((sp.get('mes') || sp.get('semana')) && sp.get('coletar') !== '1') {
      const out: Record<string, unknown> = {}
      if (sp.get('mes')) out.mensal = await salvarMensal(sp.get('mes')!, hoje)
      if (sp.get('semana')) out.semanal = await salvarSemanal(sp.get('semana')!)
      return NextResponse.json({ ok: true, ...out })
    }

    const sessao = await loginPortal()
    const partner = await partnerIdTrack(sessao)
    const { count } = await supabaseAdmin.from('aiva_portal_diario').select('*', { count: 'exact', head: true })
    const tudo = sp.get('tudo') === '1' || !count
    const mesAnt = mesDe(somarDias(mesDe(hoje), -1))
    const brutas = await buscarPerformance(sessao, partner, tudo ? null : mesAnt)
    const linhas = brutas.map((b) => paraLinhaDiaria(b, ontem))
    log.push(`portal: ${linhas.length} linhas (${tudo ? 'todos os meses' : `desde ${mesAnt}`}), chaves: ${Object.keys(brutas[0] ?? {}).join(',')}`)

    // Validação: zero linhas, ou mês corrente com menos de 70% das lojas do retrato anterior = base truncada
    if (!linhas.length) throw new Error('portal devolveu zero linhas')
    const mesAtual = mesDe(hoje)
    const lojasHoje = linhas.filter((l) => l.mes === mesAtual).length
    const { data: antRows } = await supabaseAdmin.from('aiva_portal_diario').select('retailer_id').eq('mes', mesAtual).eq('data_ref', somarDias(ontem, -1))
    const lojasAnt = antRows?.length ?? 0
    if (lojasAnt > 0 && lojasHoje < 0.7 * lojasAnt) throw new Error(`base truncada: ${lojasHoje} lojas hoje vs ${lojasAnt} ontem no mês ${mesAtual}`)

    const totais = (mes: string) => {
      const m = linhas.filter((l) => l.mes === mes)
      return { mes, lojas: m.length, consultas: m.reduce((s, l) => s + l.consultas, 0), aprovados: m.reduce((s, l) => s + l.aprovados, 0), vendas: m.reduce((s, l) => s + l.vendas, 0), valor: Number(m.reduce((s, l) => s + l.valor_vendas, 0).toFixed(2)) }
    }
    if (dry) return NextResponse.json({ ok: true, dry: true, data_ref: ontem, log, totais: [...new Set(linhas.map((l) => l.mes))].sort().map(totais) })

    await gravarDiario(linhas, brutas)
    log.push(`gravado data_ref=${ontem}`)

    const meses = tudo ? [...new Set(linhas.map((l) => l.mes))].sort() : [mesAnt, mesAtual]
    const mensal: unknown[] = []
    for (const m of meses) mensal.push(await salvarMensal(m.slice(0, 7), hoje))

    let semanal: unknown = null
    const diaSemana = new Date(hoje + 'T12:00:00Z').getUTCDay()
    if (diaSemana === 1 && !tudo) {
      const r = await salvarSemanal(somarDias(hoje, -7))
      if (r.avisos.length) log.push(...r.avisos.map((a) => `semana: ${a}`))
      semanal = r
    }

    const ativacoes = await ativarLojasPresentes(linhas.filter((l) => l.mes === mesAtual), false)
    return NextResponse.json({ ok: true, data_ref: ontem, log, mensal, semanal, ativacoes })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[portal-aiva]', msg, log)
    if (!dry) await avisarAldo(`⚠️ Coleta do portal AIVA falhou (${hoje}): ${msg}. Nada foi gravado hoje — o /desempenho segue com o retrato anterior.`)
    return NextResponse.json({ ok: false, error: msg, log }, { status: 500 })
  }
}
```

- [ ] **Step 2: Cron no `vercel.json`**

Acrescentar ao array `crons`:
```json
{ "path": "/api/cron/portal-aiva", "schedule": "0 9 * * *" }
```

- [ ] **Step 3: CLI**

```js
#!/usr/bin/env node
// scripts/portal-aiva.mjs — atalho pra rota /api/cron/portal-aiva em produção
// (ou local com --local). Não duplica lógica: só chama a rota com o secret.
//   node --env-file=.env.local scripts/portal-aiva.mjs --dry
//   node --env-file=.env.local scripts/portal-aiva.mjs --tudo          # backfill (todos os meses)
//   node --env-file=.env.local scripts/portal-aiva.mjs --mes 2026-08   # rederiva o mensal
//   node --env-file=.env.local scripts/portal-aiva.mjs --semana 2026-09-14
const args = process.argv.slice(2)
const pega = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const base = args.includes('--local') ? 'http://localhost:3000' : (process.env.APP_URL ?? 'https://sdr-agent-t5dct1xnn-aldo-7870s-projects.vercel.app')
const p = new URLSearchParams()
if (args.includes('--dry')) p.set('dry', '1')
if (args.includes('--tudo')) p.set('tudo', '1')
if (pega('--mes')) p.set('mes', pega('--mes'))
if (pega('--semana')) p.set('semana', pega('--semana'))
const url = `${base}/api/cron/portal-aiva?${p}`
console.log('GET', url)
const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.WEBHOOK_SECRET}` } })
const j = await res.json().catch(() => ({}))
console.log(res.status, JSON.stringify(j, null, 1))
process.exit(res.ok ? 0 : 1)
```

- [ ] **Step 4: Dry-run local contra o portal real** (precisa do e-mail/senha no `.env.local`)

Run (em dois terminais): `npm run dev` e depois `node --env-file=.env.local scripts/portal-aiva.mjs --dry --local`
Expected: `200 { ok: true, dry: true, totais: [...] }` com set/26 ≈ 214 lojas / 134+ contratos / R$ 195 mil+ (confira com os cards abertos em `parceiro-aiva.lovable.app/performance` na mesma hora — vendas e valor têm que bater exatamente). Olhe `log[0]` — **as chaves da linha**: se houver coluna de cadastro com outro nome, ajuste `paraLinhaDiaria` (Task 6) agora.

- [ ] **Step 5: Backfill local**

Run: `node --env-file=.env.local scripts/portal-aiva.mjs --tudo --local`
Expected: `ok: true`, `mensal` com 5 meses (mai–set/26). Conferir:
```
node --env-file=.env.local -e "const{createClient}=await import('@supabase/supabase-js');const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);const{data}=await s.rpc('assistente_sql',{q:\"select mes,count(*) lojas,sum(vendas) vendas,round(sum(valor_vendas)) valor,count(*) filter (where atencao is not null) atencao from aiva_desempenho group by mes order by mes\"});console.log(JSON.stringify(data))"
```
Expected: 2026-08 → 401 vendas / 579971; 2026-09 → bate com o dry. Registrar os números no commit.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/portal-aiva/route.ts vercel.json scripts/portal-aiva.mjs
git commit -m "feat(portal-aiva): rota cron diária 6h BRT + CLI; backfill mai-set/26 do portal"
```

---

### Task 10: Painel `/desempenho`

**Files:**
- Modify: `app/desempenho/page.tsx`

Mudanças pontuais no arquivo existente (manter o resto — busca, drawer, sticky header, ordenação):

- [ ] **Step 1: Tipo `Row` e comentário de cabeçalho**

Substituir o comentário do topo (linhas 7–10) por:
```ts
// Desempenho dos lojistas na AIVA — retrato diário do Portal Parceiros AIVA
// (rota /api/cron/portal-aiva, 6h BRT; spec docs/superpowers/specs/2026-09-09-*).
// Até 09/09/2026 vinha do Data Studio; UF/cidade/status-consulta eram dele e
// não existem mais no portal — ficaram na tabela só pros meses antigos.
```
Acrescentar ao `type Row`:
```ts
  consultas: number | null
  rid: string | null
  status_portal: string | null
  inadimplencia_aiva: number | null
  inadimplencia_odres: number | null
  foto_fora_pct: number | null
  cadastro_em: string | null
  atencao: 'novo_sem_engajamento' | 'baixa_performance' | null
```

- [ ] **Step 2: Filtros e cards**

Em `searchParams`, trocar `uf?: string` por `status?: string`. Substituir o bloco de filtros:
```ts
  const filtro = sp.filtro ?? ''
  let rows = todas
  if (filtro === 'sem_venda') rows = rows.filter((r) => r.sem_venda)
  if (filtro === 'sem_consulta') rows = rows.filter((r) => r.sem_consulta)
  if (filtro === 'ativas') rows = rows.filter((r) => r.status_portal === 'Ativo')
  if (filtro === 'novo_sem_engajamento') rows = rows.filter((r) => r.atencao === 'novo_sem_engajamento')
  if (filtro === 'baixa_performance') rows = rows.filter((r) => r.atencao === 'baixa_performance')
  if (sp.status === 'ativas') rows = rows.filter((r) => r.status_portal === 'Ativo')
  if (sp.status === 'inativas') rows = rows.filter((r) => r.status_portal && r.status_portal !== 'Ativo')
```
Na busca (`casaBusca`), trocar `r.uf, r.cnpj, r.status_consulta` por `r.cnpj, r.rid, r.status_portal`.

`COLUNAS` vira:
```ts
  const COLUNAS: Record<string, { rotulo: string; campo: keyof Row; numerica: boolean }> = {
    loja: { rotulo: 'Loja', campo: 'loja', numerica: false },
    status: { rotulo: 'Status', campo: 'status_portal', numerica: false },
    consultas: { rotulo: 'Consultas', campo: 'consultas', numerica: true },
    aprovados: { rotulo: 'Aprovados', campo: 'aprovados', numerica: true },
    vendas: { rotulo: 'Vendas', campo: 'vendas', numerica: true },
    conv: { rotulo: 'Conv.', campo: 'conversao', numerica: true },
    valor: { rotulo: 'Valor', campo: 'valor_vendas', numerica: true },
    ticket: { rotulo: 'Ticket', campo: 'ticket_medio', numerica: true },
    inad_aiva: { rotulo: 'Inad. AIVA', campo: 'inadimplencia_aiva', numerica: true },
    inad_odres: { rotulo: 'Inad. Odres', campo: 'inadimplencia_odres', numerica: true },
    foto: { rotulo: 'Foto fora', campo: 'foto_fora_pct', numerica: true },
  }
```
Em `tot`, substituir `semOperador` por:
```ts
    ativas: todas.filter((r) => r.status_portal === 'Ativo').length,
    consultas: todas.reduce((s, r) => s + (r.consultas ?? 0), 0),
    novos: todas.filter((r) => r.atencao === 'novo_sem_engajamento').length,
    baixa: todas.filter((r) => r.atencao === 'baixa_performance').length,
```
Em `qsSort`, trocar `if (sp.uf) p.set('uf', sp.uf)` por `if (sp.status) p.set('status', sp.status)`.

Texto do cabeçalho:
```tsx
            : `${todas.length} lojas no retrato de ${atualizadoEm ? new Date(atualizadoEm).toLocaleDateString('pt-BR') : ''} · Portal Parceiros AIVA`}
```
(`atualizado_em` é a hora da derivação; o retrato é de ontem — pra mostrar a `data_ref`, ler `max(data_ref)` de `aiva_portal_diario` do mês: `const { data: dr } = await supabaseAdmin.from('aiva_portal_diario').select('data_ref').eq('mes', mes + '-01').order('data_ref', { ascending: false }).limit(1)` e usar `dr?.[0]?.data_ref` formatado com `new Date(d + 'T12:00:00Z').toLocaleDateString('pt-BR')`; se vazio (mês antigo do Data Studio), cair no texto "importado do Data Studio (legado)".)

Cards:
```tsx
        <Card label="Lojas" value={String(todas.length)} href={qs({})} ativo={!filtro} />
        <Card label="Ativas" value={String(tot.ativas)} href={qs({ filtro: 'ativas' })} ativo={filtro === 'ativas'} />
        <Card label="Consultas" value={tot.consultas.toLocaleString('pt-BR')} href={qs({})} />
        <Card label="Aprovados" value={tot.aprovados.toLocaleString('pt-BR')} href={qs({})} />
        <Card label="Vendas" value={tot.vendas.toLocaleString('pt-BR')} href={qs({})} />
        <Card label="Valor vendido" value={fmtBRL(tot.valor)} href={qs({})} />
        <Card label="Conversão média" value={fmtPct(convMedia)} color="var(--accent)" href={qs({})} />
        <Card label="Sem venda" value={String(tot.semVenda)} color={tot.semVenda > 0 ? 'var(--red)' : undefined} href={qs({ filtro: 'sem_venda' })} ativo={filtro === 'sem_venda'} />
        <Card label="Sem consulta" value={String(tot.semConsulta)} color={tot.semConsulta > 0 ? 'var(--red)' : undefined} href={qs({ filtro: 'sem_consulta' })} ativo={filtro === 'sem_consulta'} />
        <Card label="⚠️ Novos sem engajamento" value={String(tot.novos)} color={tot.novos > 0 ? 'var(--red)' : undefined} href={qs({ filtro: 'novo_sem_engajamento' })} ativo={filtro === 'novo_sem_engajamento'} />
        <Card label="⚠️ Baixa performance" value={String(tot.baixa)} color={tot.baixa > 0 ? 'var(--red)' : undefined} href={qs({ filtro: 'baixa_performance' })} ativo={filtro === 'baixa_performance'} />
```

Form: trocar o `<select name="uf">` por
```tsx
        <select name="status" defaultValue={sp.status ?? ''} style={{ padding: '0.45rem 0.7rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)' }}>
          <option value="">Todas</option>
          <option value="ativas">Ativas</option>
          <option value="inativas">Inativas</option>
        </select>
```
e o placeholder da busca pra `"Loja, CNPJ, RID, e-mail, sócio, telefone…"`.

- [ ] **Step 3: Células da tabela**

Substituir o bloco `const celulas = (...)` por:
```tsx
              const fmtPctNulo = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
              const ambar = (v: number | null): React.CSSProperties => (v != null && v > 0 ? { color: '#d97706', fontWeight: 600 } : {})
              const rotuloAtencao = r.atencao === 'novo_sem_engajamento' ? ' · ⚠️ novo sem engajamento' : r.atencao === 'baixa_performance' ? ' · ⚠️ baixa performance' : ''
              const celulas = (
                <>
                  <td style={{ padding: '0.45rem 0.6rem', maxWidth: 280 }} title={leadId ? 'Abrir a conversa do lead' : 'Loja sem lead no painel (veio direto da AIVA)'}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {leadId ? '💬 ' : ''}{r.loja ?? r.nome_varejo ?? r.cnpj}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{r.cnpj}{r.rid ? ` · RID ${r.rid}` : ''}{r.sem_venda ? ' · sem venda' : ''}{r.sem_consulta ? ' · sem consulta' : ''}{rotuloAtencao}</div>
                  </td>
                  <td style={{ padding: '0.45rem 0.6rem', color: r.status_portal === 'Ativo' ? 'var(--green)' : 'var(--text-dim)' }}>{r.status_portal ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{r.consultas ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{r.aprovados ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{r.vendas ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{fmtPct(r.conversao)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBRL(r.valor_vendas)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtBRL(r.ticket_medio)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', ...ambar(r.inadimplencia_aiva) }}>{fmtPctNulo(r.inadimplencia_aiva)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', ...ambar(r.inadimplencia_odres) }}>{fmtPctNulo(r.inadimplencia_odres)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right' }}>{fmtPctNulo(r.foto_fora_pct)}</td>
                  <td style={{ padding: '0.45rem 0.6rem', color: tendCor, textAlign: 'center' }}>{tend}</td>
                </>
              )
```
> Se no dry-run (Task 9) as inadimplências vierem como 0–100 e não 0–1, trocar `fmtPctNulo` pra `${v.toFixed(1)}%` sem multiplicar.

- [ ] **Step 4: Rodar e conferir**

Run: `npm run dev` → abrir `http://localhost:3000/desempenho` (login do painel).
Expected: cabeçalho "214 lojas no retrato de 08/09/2026 · Portal Parceiros AIVA"; cards com Ativas/Consultas/⚠️; clicar em "⚠️ Novos sem engajamento" filtra ≈ 26 lojas (o portal mostrava 26 em 09/09); mês `2026-08` abre com colunas novas preenchidas. `npx tsc --noEmit -p . 2>&1 | grep desempenho` sem erros.

- [ ] **Step 5: Commit**

```bash
git add app/desempenho/page.tsx
git commit -m "feat(desempenho): painel lê o retrato do portal AIVA — status, consultas, inadimplência, atenção"
```

---

### Task 11: Rótulos no `/comissoes`, legado, docs e env do Vercel

**Files:**
- Modify: `app/comissoes/page.tsx` (linhas 115, 315, 343, 360, 378)
- Modify: `scripts/coletor-funil-loja.js`, `scripts/importar-funil-loja.mjs`, `scripts/importar-desempenho-semanal.mjs`, `scripts/importar-desempenho-aiva.mjs`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `/comissoes`** — trocar cada "Data Studio" por "Portal AIVA" nas 5 ocorrências (`grep -n "Data Studio" app/comissoes/page.tsx` tem que voltar vazio). Em `lib/comissoes.ts:205` e `:218` idem (comentários).

- [ ] **Step 2: Legado** — primeira linha do bloco de comentário dos 4 scripts:
```
 * ⚠️ LEGADO — substituído pelo Portal Parceiros AIVA em 09/09/2026
 *    (lib/portal-aiva.ts + /api/cron/portal-aiva). Só serve se o portal cair.
```

- [ ] **Step 3: `CLAUDE.md`** — acrescentar depois da seção "Nudge":
```markdown
## Desempenho das lojas — Portal Parceiros AIVA (desde 09/09/2026)

- Fonte: `https://parceiro-aiva.lovable.app/performance` (Supabase próprio; tabela
  `retailer_performance`). Coleta por API na rota `/api/cron/portal-aiva` (6h BRT,
  todo dia) — sem Chrome. Spec: `docs/superpowers/specs/2026-09-09-portal-aiva-desempenho-design.md`.
- `aiva_portal_diario` = retrato bruto por dia (fonte de verdade). `aiva_desempenho`
  (mês) e `aiva_desempenho_semanal` (semana = domingo − domingo anterior) são
  DERIVADAS — regerar com `node --env-file=.env.local scripts/portal-aiva.mjs --mes YYYY-MM | --semana <segunda>`.
- Loja ativa = CNPJ registrado presente no portal com status Ativo (ativação diária na rota).
- Data Studio e `coletor-funil-loja.js` são legado. Os números das duas fontes NÃO
  batem (ago/26: DS 404 vendas/R$ 534 mil × portal 401/R$ 580 mil) — o portal é o oficial.
```

- [ ] **Step 4: Env no Vercel** — pedir ao Aldo pra adicionar em Settings → Environment Variables (Production): `AIVA_PORTAL_URL`, `AIVA_PORTAL_ANON_KEY`, `AIVA_PORTAL_EMAIL`, `AIVA_PORTAL_SENHA`, `AIVA_PORTAL_PARTNER_ID` (valores do `.env.local`). O Vercel CLI não está instalado nesta máquina; é pelo painel `https://vercel.com/aldo-7870s-projects/sdr-agent/settings/environment-variables`.

- [ ] **Step 5: Commit**

```bash
git add app/comissoes/page.tsx lib/comissoes.ts scripts/coletor-funil-loja.js scripts/importar-funil-loja.mjs scripts/importar-desempenho-semanal.mjs scripts/importar-desempenho-aiva.mjs CLAUDE.md
git commit -m "docs(portal-aiva): rótulos Portal AIVA no /comissoes, scripts do Data Studio marcados como legado"
```

---

### Task 12: Deploy e verificação em produção

- [ ] **Step 1: Push** — `git push origin main` (o deploy é automático pelo GitHub). Acompanhar em `https://vercel.com/aldo-7870s-projects/sdr-agent` até "Ready".

- [ ] **Step 2: Dry em produção**

Run: `node --env-file=.env.local scripts/portal-aiva.mjs --dry`
Expected: `200 { ok: true, dry: true, ... }`. Se 500 com "env do portal incompleta" → variáveis do Task 11 Step 4 faltando.

- [ ] **Step 3: Run real em produção**

Run: `node --env-file=.env.local scripts/portal-aiva.mjs`
Expected: `ok: true`, `mensal` com 2 meses, `semanal: null` (não é segunda), `ativacoes: []` ou lista. Abrir `/desempenho` em produção e conferir o cabeçalho com a data do retrato.

- [ ] **Step 4: Confirmar o cron** — no painel do Vercel, Settings → Cron Jobs deve listar `/api/cron/portal-aiva` `0 9 * * *`. Amanhã 6h05 BRT conferir `max(data_ref)` em `aiva_portal_diario` = ontem.

---

### Task 13: Tarefas agendadas (fora do repo)

**Files:**
- Delete: `~/.claude/scheduled-tasks/aiva-desempenho-diario/` (via MCP `mcp__scheduled-tasks__delete_scheduled_task`)
- Modify: `~/.claude/scheduled-tasks/aiva-pulso-semanal/SKILL.md`
- Modify: `~/.claude/scheduled-tasks/conferencia-comissao-ume/SKILL.md`

- [ ] **Step 1: Apagar `aiva-desempenho-diario`** — o cron do Vercel assume. Antes, confirmar com o Aldo que o run real do Task 12 passou.

- [ ] **Step 2: Pulso** — substituir os passos 1–3 do `aiva-pulso-semanal/SKILL.md` por (e manter 4 e 5 iguais, renumerados):

```
⚠️ TRANSIÇÃO: em 14/09/2026 rode o fluxo ANTIGO (Data Studio, abaixo do traço) uma última vez —
a semana 07–13/09 não tem retrato do portal de 06/09. A partir de 21/09 vale só este fluxo novo.

1. GARANTE A SEMANA FECHADA (o cron diário já coletou o retrato de domingo às 6h):
   node --env-file=.env.local scripts/portal-aiva.mjs --semana YYYY-MM-DD   (a SEGUNDA da semana passada)
   A saída traz lojas/vendas da semana e `avisos` — leia os avisos. Se der 500 "sem retrato",
   a coleta de hoje falhou: NÃO dispare nada e avise o Aldo.
2. CONFERE o total de vendas da semana contra o portal (https://parceiro-aiva.lovable.app/performance,
   aba Resumo por mês): o acumulado do mês no portal menos o acumulado gravado no domingo anterior
   tem que bater com a soma da semana. Divergência > 5% = pare e avise.
```

Abaixo, sob um traço `---`, manter o texto antigo com o título "FLUXO ANTIGO (Data Studio) — só até 14/09/2026".

- [ ] **Step 3: Conferência de comissão** — passo 7 do `conferencia-comissao-ume/SKILL.md` vira:
```
7. A contraprova (aiva_desempenho do mês) vem do Portal Parceiros AIVA e é rederivada todo dia pelo
   cron. Antes da conferência, force a rederivação do mês fechado:
   node --env-file=.env.local scripts/portal-aiva.mjs --mes <MES>
```

- [ ] **Step 4: Anotar no resultado** da sessão: tarefas alteradas, data de virada (21/09) e que `aiva-desempenho-diario` foi apagada.

---

## Self-review

**Spec coverage:** tabela diária + colunas novas (T1); derivações mensal/atenção/semanal com as regras da spec (T3–T5); login/partner/busca paginada/validação 70%/gravação/aviso WhatsApp/500 (T6, T7, T9); ativação por presença Ativo (T8); painel com cards, status, inadimplência, atenção, sem UF (T10); rótulos `/comissoes` + legado + CLAUDE.md + env Vercel (T11); backfill + transição do pulso 14/09→21/09 + tarefas agendadas (T9, T13). A extração pro script de segunda (`lib/ativacao-loja.ts`) da spec ficou de fora de propósito: o script `.mjs` não importa TS com alias, e como rede de segurança ele já faz exatamente o mesmo — YAGNI.

**Placeholders:** o único ponto aberto é o nome real da coluna de cadastro do portal; o plano diz onde olhar (log de chaves do dry-run) e o que fazer nos dois casos.

**Type consistency:** `LinhaDiaria`/`Metricas`/`LinhaMensal`/`LinhaSemanal` definidos em T2/T4/T5 e usados com os mesmos campos em T6–T10; `salvarMensal(mes: 'YYYY-MM')` converte pra `YYYY-MM-01` internamente e a rota passa `m.slice(0, 7)`; `derivarSemana` recebe `Map<cnpj, vendas>` e `salvarSemanal` monta esse mapa por `cnpj`.
