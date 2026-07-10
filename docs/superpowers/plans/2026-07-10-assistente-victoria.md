# VictorIA Analista (widget do painel) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widget de chat flutuante em todas as telas do painel AIVA onde a VictorIA Analista responde Aldo/Nei sobre dados reais da operação (somente leitura).

**Architecture:** Botão flutuante + slide-over montados no `app/layout.tsx` (estado sobrevive à navegação). API `/api/assistente` roda loop de tool-use com Claude (4 ferramentas; a de SQL livre executa via RPC Postgres que assume um role somente-SELECT — mutação impossível no nível do banco).

**Tech Stack:** Next.js 15 (App Router), @anthropic-ai/sdk (claude-sonnet-4-5), Supabase (RPC plpgsql), CSS inline no padrão do painel.

**Convenções deste repo:** sem framework de teste — verificação por `npm run build` + smoke test real. Commits pequenos por task. NÃO commitar os arquivos já modificados de outras frentes (`git add` só nos arquivos da task).

---

### Task 1: RPC `assistente_sql` somente-leitura no Supabase

**Files:** nenhum arquivo local — migration via MCP Supabase (`apply_migration`, project_id `axkrorkhnkfkpbjikwrb`).

- [ ] **Step 1: Aplicar migration** com nome `assistente_sql_readonly`:

```sql
-- Role sem login e sem NENHUM privilégio de escrita
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'assistente_ro') then
    create role assistente_ro nologin;
  end if;
end $$;

grant usage on schema public to assistente_ro;
grant select on all tables in schema public to assistente_ro;
alter default privileges in schema public grant select on tables to assistente_ro;

-- necessário pro SET LOCAL ROLE dentro da função (dono = postgres)
grant assistente_ro to postgres;

-- Função: valida que é SELECT/WITH, assume o role read-only e executa.
-- SET LOCAL ROLE vale até o fim da transação (cada chamada RPC = 1 transação).
create or replace function public.assistente_sql(q text)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '8s'
as $$
declare
  result jsonb;
begin
  if q !~* '^\s*(select|with)\b' then
    raise exception 'apenas consultas SELECT são permitidas';
  end if;
  execute 'set local role assistente_ro';
  execute q into result;
  return coalesce(result, '[]'::jsonb);
end $$;

revoke all on function public.assistente_sql(text) from public;
grant execute on function public.assistente_sql(text) to service_role;
```

> Nota: a função recebe o SQL **já embrulhado** pela aplicação em
> `select coalesce(jsonb_agg(t), '[]'::jsonb) from (<q sem ; final> ) t limit ...`
> (ver Task 4) — por isso o `execute q into result` espera 1 linha/1 coluna jsonb.

- [ ] **Step 2: Smoke test da função** via `execute_sql`:

```sql
select public.assistente_sql(
  $q$select coalesce(jsonb_agg(t),'[]'::jsonb) from (select status, count(*) as total from sdr_leads group by status) t$q$
);
```
Expected: JSON com contagens por status.

- [ ] **Step 3: Confirmar que escrita FALHA** via `execute_sql`:

```sql
select public.assistente_sql(
  $q$select coalesce(jsonb_agg(t),'[]'::jsonb) from (select 1) t$q$
);
-- e depois, o caso malicioso:
select public.assistente_sql($q$update sdr_leads set nome='x'$q$);
```
Expected: primeira OK; segunda → erro `apenas consultas SELECT são permitidas`.
E um `with x as (update ...) select 1` deve falhar com `permission denied` (role sem escrita).

---

### Task 2: System prompt da analista — `prompts/assistente.ts`

**Files:**
- Create: `prompts/assistente.ts`

- [ ] **Step 1: Criar o arquivo:**

```typescript
/**
 * System prompt da VictorIA ANALISTA — assistente interna do painel AIVA.
 * Diferente do prompts/aiva.ts (vendedora): esta responde Aldo e Nei sobre
 * os dados da operação. SOMENTE consulta — nunca executa ações.
 */
export const ASSISTENTE_SYSTEM_PROMPT = `Você é a VictorIA Analista, assistente interna do painel SDR AIVA da Track Tecnologia (Brusque/SC).

Quem fala com você: Aldo (estratégia/produto) e Nei (operação comercial). Responda em português brasileiro, direto e objetivo, citando números EXATOS vindos das ferramentas. NUNCA invente dado — se a consulta não retornar nada, diga isso.

## Contexto da operação
- Produto: AIVA — financiamento de celulares para lojas de varejo (parceria Track + UME).
- A VictorIA vendedora (outra instância sua) prospecta lojas via WhatsApp, qualifica e coleta 7 dados de cadastro pelo chat.
- Funil no Evo Talks (CRM), dados operacionais no Supabase (fonte da verdade pra você).

## Tabelas (Postgres/Supabase)
### sdr_leads — 1 linha por loja prospectada
Colunas principais: id (uuid), nome (text — nome do varejo qualificado; 'Loja' = ainda não qualificado), telefone (text, formato 55DDDNÚMERO, único), cidade, produto ('AIVA'), status, etapa_cadencia (int: 1/3/7/14), data_disparo_inicial, data_proximo_followup, data_ultimo_contato, acionar_humano (bool), observacoes (text — anotações e marcadores tipo [BOT_TROCAS:n]), evotalks_opportunity_id, criado_em.
Use consulta_sql em information_schema.columns se precisar confirmar alguma coluna.

### sdr_mensagens — histórico de conversa (contexto do agente)
Colunas: id, lead_id (fk sdr_leads), direcao ('in' = lead falou, 'out' = VictorIA falou), conteudo, template_hsm (nome do HSM se disparo), enviado_em.

### Significado dos status (etapas do funil)
- INICIO — HSM inicial disparado, sem resposta ainda
- INTERESSADO — lead respondeu, conversa em andamento
- PRE_APROVACAO — 7 dados coletados, aguardando validação
- CADASTRO_RECEBIDO — cadastro completo, humano assumiu
- EM_ANALISE_AIVA — em análise CAF/biometria pela AIVA
- TREINAR / LOGIN / LOJA_FINALIZADA_E_VENDENDO — pós-aprovação até loja ativa
- SEM_RESPOSTA — em cadência de follow-up (D+3/D+7/D+14)
- AGUARDANDO — lead pediu pra retomar depois
- OPT_OUT — pediu pra não ser contatado (nunca sugerir recontato)
- NAO_QUALIFICADO — fora do perfil (ex.: só iPhone, 1 loja com baixo volume)
- BOT_DETECTADO — número respondido por bot/URA
- DESCARTADO — sem resposta após D+14

## Suas ferramentas
- contar_leads: contagem por status (com filtro de período opcional). Use pra "quantos leads em X?".
- buscar_lead: acha lead por nome (parcial) ou telefone (parcial). Use antes de olhar conversa.
- historico_conversa: últimas mensagens de um lead. Use pra "o que aconteceu com o lead Y?" e RESUMA a conversa (não despeje o log inteiro, destaque: quem é, o que pediu, onde parou, próximo passo).
- consulta_sql: SELECT livre (somente leitura, máx. 50 linhas) pra qualquer pergunta fora do padrão.

## Regras
- Se a pergunta for ambígua (ex.: "quantos leads?"), assuma o recorte mais útil e DIGA qual assumiu.
- Datas/horas: o banco está em UTC; ao falar de "hoje/ontem", considere fuso de Brasília (UTC-3) nas suas queries.
- Telefones: sempre formato 55 + DDD + número, sem máscara.
- Você NÃO executa ações (mudar status, enviar mensagem, reengajar). Se pedirem, explique que isso é feito pelo painel ou pelo time — você só consulta.
- Respostas curtas para perguntas curtas. Tabelas markdown quando ajudar a comparar.`
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add prompts/assistente.ts
git commit -m "feat(assistente): system prompt da VictorIA Analista"
```

---

### Task 3: Exportar `getClient` de `lib/claude.ts`

**Files:**
- Modify: `lib/claude.ts:22` (função `getClient`)

- [ ] **Step 1: Tornar exportada** — trocar:

```typescript
function getClient() {
```
por:
```typescript
export function getClient() {
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → sem erros.

- [ ] **Step 3: Commit**

```bash
git add lib/claude.ts
git commit -m "refactor(claude): exporta getClient pra reuso do assistente"
```

---

### Task 4: Motor do assistente — `lib/assistente.ts`

**Files:**
- Create: `lib/assistente.ts`

- [ ] **Step 1: Criar o arquivo** (ferramentas + loop de tool-use):

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { getClient } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase'
import { ASSISTENTE_SYSTEM_PROMPT } from '@/prompts/assistente'

const MODEL = 'claude-sonnet-4-5'
const MAX_ITERACOES = 8
const MAX_LINHAS = 50
const MAX_CHARS_RESULTADO = 8000

export interface MsgChat {
  role: 'user' | 'assistant'
  content: string
}

// ─── Ferramentas ──────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'contar_leads',
    description:
      'Contagem de leads por status. Opcionalmente filtra por período (últimos N dias, pela data de criação).',
    input_schema: {
      type: 'object',
      properties: {
        ultimos_dias: {
          type: 'number',
          description: 'Se informado, conta só leads criados nos últimos N dias.',
        },
      },
    },
  },
  {
    name: 'buscar_lead',
    description:
      'Busca leads por nome (parcial, case-insensitive) ou telefone (parcial). Retorna até 10 com id, nome, telefone, cidade, status, datas e observações.',
    input_schema: {
      type: 'object',
      properties: {
        termo: {
          type: 'string',
          description: 'Nome da loja ou trecho do telefone (só dígitos).',
        },
      },
      required: ['termo'],
    },
  },
  {
    name: 'historico_conversa',
    description:
      'Últimas mensagens da conversa de um lead (use o id retornado por buscar_lead). direcao in = lead falou, out = VictorIA falou.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'UUID do lead.' },
        limite: { type: 'number', description: 'Qtde de mensagens (padrão 30, máx 60).' },
      },
      required: ['lead_id'],
    },
  },
  {
    name: 'consulta_sql',
    description:
      'Executa um SELECT livre no Postgres (somente leitura, máx 50 linhas). Tabelas: sdr_leads, sdr_mensagens. Use para perguntas que as outras ferramentas não cobrem.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Consulta SELECT (sem ponto-e-vírgula final).' },
      },
      required: ['sql'],
    },
  },
]

// ─── Executores ───────────────────────────────────────────────────────────────

async function rodarSqlReadonly(sql: string): Promise<string> {
  // remove ; finais e embrulha com agregação jsonb + LIMIT duro
  const limpo = sql.trim().replace(/;+\s*$/g, '')
  const embrulhado = `select coalesce(jsonb_agg(t), '[]'::jsonb) from (${limpo}) t`
  const { data, error } = await supabaseAdmin.rpc('assistente_sql', { q: embrulhado })
  if (error) return `ERRO na consulta: ${error.message}`
  const json = JSON.stringify(data)
  return json.length > MAX_CHARS_RESULTADO
    ? json.slice(0, MAX_CHARS_RESULTADO) + '… [truncado]'
    : json
}

async function executarFerramenta(nome: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (nome) {
      case 'contar_leads': {
        const dias = typeof input.ultimos_dias === 'number' ? input.ultimos_dias : null
        const where = dias ? `where criado_em >= now() - interval '${Math.floor(dias)} days'` : ''
        return rodarSqlReadonly(
          `select status, count(*)::int as total from sdr_leads ${where} group by status order by total desc`
        )
      }
      case 'buscar_lead': {
        const termo = String(input.termo ?? '').trim()
        if (!termo) return 'ERRO: termo vazio'
        const digitos = termo.replace(/\D/g, '')
        const porTelefone = digitos.length >= 4
        const filtro = porTelefone
          ? `telefone like '%${digitos}%'`
          : `nome ilike '%${termo.replace(/'/g, "''")}%'`
        return rodarSqlReadonly(
          `select id, nome, telefone, cidade, status, acionar_humano, data_disparo_inicial, data_ultimo_contato, observacoes from sdr_leads where ${filtro} order by data_ultimo_contato desc nulls last limit 10`
        )
      }
      case 'historico_conversa': {
        const leadId = String(input.lead_id ?? '')
        const limite = Math.min(Number(input.limite) || 30, 60)
        if (!/^[0-9a-f-]{36}$/i.test(leadId)) return 'ERRO: lead_id inválido (use o UUID de buscar_lead)'
        return rodarSqlReadonly(
          `select direcao, conteudo, template_hsm, enviado_em from sdr_mensagens where lead_id = '${leadId}' order by enviado_em desc limit ${limite}`
        )
      }
      case 'consulta_sql': {
        const sql = String(input.sql ?? '')
        if (!/^\s*(select|with)\b/i.test(sql)) return 'ERRO: apenas SELECT é permitido'
        // LIMIT duro: embrulha de novo com limit
        const limpo = sql.trim().replace(/;+\s*$/g, '')
        return rodarSqlReadonly(`select * from (${limpo}) _q limit ${MAX_LINHAS}`)
      }
      default:
        return `ERRO: ferramenta desconhecida ${nome}`
    }
  } catch (err) {
    return `ERRO: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── Loop do agente ───────────────────────────────────────────────────────────

export async function responderAssistente(
  mensagem: string,
  historico: MsgChat[]
): Promise<string> {
  const client = getClient()

  const messages: Anthropic.MessageParam[] = [
    ...historico.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: mensagem },
  ]

  for (let i = 0; i < MAX_ITERACOES; i++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: ASSISTENTE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    })

    if (resp.stop_reason !== 'tool_use') {
      const texto = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      return texto || 'Não consegui montar uma resposta. Tenta reformular a pergunta?'
    }

    // Executa as tools pedidas e devolve os resultados
    messages.push({ role: 'assistant', content: resp.content })
    const resultados: Anthropic.ToolResultBlockParam[] = []
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue
      const resultado = await executarFerramenta(block.name, block.input as Record<string, unknown>)
      resultados.push({ type: 'tool_result', tool_use_id: block.id, content: resultado })
    }
    messages.push({ role: 'user', content: resultados })
  }

  return 'A consulta ficou complexa demais e atingi o limite de tentativas. Tenta quebrar a pergunta em partes menores?'
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → sem erros.

- [ ] **Step 3: Commit**

```bash
git add lib/assistente.ts
git commit -m "feat(assistente): motor de tool-use da VictorIA Analista (4 ferramentas, read-only)"
```

---

### Task 5: API `POST /api/assistente` + proteção no middleware

**Files:**
- Create: `app/api/assistente/route.ts`
- Modify: `middleware.ts` (matcher)

- [ ] **Step 1: Criar a rota:**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { responderAssistente, type MsgChat } from '@/lib/assistente'

export const maxDuration = 60 // loop de tools pode levar alguns segundos

export async function POST(req: NextRequest) {
  const { mensagem, historico } = (await req.json()) as {
    mensagem?: string
    historico?: MsgChat[]
  }

  if (!mensagem?.trim()) {
    return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 })
  }

  try {
    // Limita o histórico enviado (as últimas 20 trocas bastam de contexto)
    const resposta = await responderAssistente(mensagem.trim(), (historico ?? []).slice(-20))
    return NextResponse.json({ resposta })
  } catch (err) {
    console.error('[assistente] erro:', err)
    return NextResponse.json({ error: 'Erro ao processar' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Adicionar ao matcher do middleware** — em `middleware.ts`, no array `matcher`, adicionar a linha:

```typescript
    '/api/assistente',
```
(logo após `'/api/curadoria/:path*',`)

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → sem erros.

- [ ] **Step 4: Smoke test local** — `npm run dev` e:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/assistente" -Method POST `
  -ContentType "application/json" `
  -Body '{"mensagem":"quantos leads temos por etapa?"}'
```
Expected: `{ resposta: "..." }` com contagens reais por status.

- [ ] **Step 5: Commit**

```bash
git add app/api/assistente/route.ts middleware.ts
git commit -m "feat(assistente): endpoint /api/assistente protegido pelo painel"
```

---

### Task 6: Widget flutuante — `AssistenteWidget.tsx` + montagem no layout

**Files:**
- Create: `app/_components/AssistenteWidget.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Criar o componente:**

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

export default function AssistenteWidget() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, open])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150)
  }, [open])

  // Fora do painel autenticado: /login e /chat (simulador público)
  if (pathname.startsWith('/login') || pathname.startsWith('/chat')) return null

  async function enviar() {
    if (!input.trim() || loading) return
    const userMsg: Msg = { role: 'user', content: input.trim() }
    const atualizado = [...messages, userMsg]
    setMessages(atualizado)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/assistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem: userMsg.content, historico: messages }),
      })
      const data = await res.json()
      setMessages([
        ...atualizado,
        { role: 'assistant', content: data.resposta ?? data.error ?? 'Erro ao processar.' },
      ])
    } catch {
      setMessages([...atualizado, { role: 'assistant', content: 'Erro de rede. Tenta de novo?' }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  return (
    <>
      <style>{css}</style>

      {/* Botão flutuante */}
      {!open && (
        <button className="ast-fab" onClick={() => setOpen(true)} title="VictorIA Analista">
          <span className="ast-fab-icon">V</span>
        </button>
      )}

      {/* Slide-over */}
      {open && (
        <div className="ast-panel">
          <div className="ast-header">
            <div className="ast-header-left">
              <div className="ast-avatar">V</div>
              <div>
                <div className="ast-title">VictorIA Analista</div>
                <div className="ast-sub">Pergunte sobre a operação AIVA</div>
              </div>
            </div>
            <button className="ast-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="ast-body">
            {messages.length === 0 && (
              <div className="ast-empty">
                Ex.: “quantos leads em cadastro recebido?”<br />
                “o que aconteceu na conversa com a Imports Store?”<br />
                “quais leads estão parados há mais de 2 dias?”
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ast-msg-user' : 'ast-msg-ia'}>
                {m.content}
              </div>
            ))}
            {loading && <div className="ast-msg-ia ast-typing">consultando…</div>}
            <div ref={endRef} />
          </div>

          <div className="ast-input-row">
            <input
              ref={inputRef}
              className="ast-input"
              placeholder="Pergunte sobre leads, etapas, conversas…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enviar()}
              disabled={loading}
            />
            <button className="ast-send" onClick={enviar} disabled={loading || !input.trim()}>➤</button>
          </div>
        </div>
      )}
    </>
  )
}

const css = `
  .ast-fab {
    position: fixed; right: 22px; bottom: 22px; z-index: 950;
    width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
    background: linear-gradient(135deg, #16a34a, #059669); color: #fff;
    font-size: 22px; font-weight: 700;
    box-shadow: 0 6px 24px rgba(22,163,74,.45);
    transition: transform .15s;
  }
  .ast-fab:hover { transform: scale(1.07); }

  .ast-panel {
    position: fixed; right: 16px; bottom: 16px; z-index: 960;
    width: 400px; max-width: calc(100vw - 32px);
    height: 560px; max-height: calc(100dvh - 32px);
    display: flex; flex-direction: column;
    background: #101010; border: 1px solid #262626; border-radius: 16px;
    box-shadow: 0 16px 48px rgba(0,0,0,.6);
    overflow: hidden;
    color: #ededed;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  .ast-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; background: #161616; border-bottom: 1px solid #222;
    flex-shrink: 0;
  }
  .ast-header-left { display: flex; align-items: center; gap: 10px; }
  .ast-avatar {
    width: 34px; height: 34px; border-radius: 50%;
    background: linear-gradient(135deg, #16a34a, #059669);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; color: #fff; font-size: 15px;
  }
  .ast-title { font-size: 14px; font-weight: 600; }
  .ast-sub { font-size: 11px; color: #4ade80; }
  .ast-close {
    background: none; border: none; color: #888; font-size: 14px; cursor: pointer;
    padding: 6px; border-radius: 8px;
  }
  .ast-close:hover { background: #222; color: #fff; }

  .ast-body {
    flex: 1; overflow-y: auto; padding: 14px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .ast-empty { color: #555; font-size: 12.5px; line-height: 1.7; margin-top: 16px; text-align: center; }

  .ast-msg-user {
    align-self: flex-end; max-width: 88%;
    background: #14532d; border-radius: 14px 14px 4px 14px;
    padding: 8px 12px; font-size: 13.5px; line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
  }
  .ast-msg-ia {
    align-self: flex-start; max-width: 92%;
    background: #191919; border: 1px solid #262626;
    border-radius: 14px 14px 14px 4px;
    padding: 8px 12px; font-size: 13.5px; line-height: 1.55;
    white-space: pre-wrap; word-break: break-word;
  }
  .ast-typing { color: #777; font-style: italic; }

  .ast-input-row {
    display: flex; gap: 8px; padding: 10px 12px;
    border-top: 1px solid #222; background: #141414; flex-shrink: 0;
  }
  .ast-input {
    flex: 1; min-width: 0; padding: 10px 14px; border-radius: 20px;
    border: 1px solid #333; background: #1c1c1c; color: #fff;
    font-size: 13.5px; outline: none; caret-color: #16a34a;
  }
  .ast-input:focus { border-color: #16a34a; }
  .ast-send {
    width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
    background: #16a34a; color: #fff; font-size: 15px; flex-shrink: 0;
  }
  .ast-send:disabled { opacity: .35; cursor: default; }

  @media (max-width: 640px) {
    .ast-panel { right: 8px; bottom: 8px; width: calc(100vw - 16px); height: 70dvh; }
    .ast-fab { right: 14px; bottom: 14px; }
  }
`
```

- [ ] **Step 2: Montar no layout** — `app/layout.tsx` fica:

```tsx
import type { Metadata } from 'next'
import './globals.css'
import Sidebar from './_components/Sidebar'
import AssistenteWidget from './_components/AssistenteWidget'

export const metadata: Metadata = {
  title: 'SDR Agent AIVA',
  description: 'Agente SDR autônomo para prospecção AIVA — Track Tecnologia',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="app-shell">
          <Sidebar />
          <div className="app-main">{children}</div>
        </div>
        <AssistenteWidget />
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Verificar no preview** — com `npm run dev`:
  - `/` (Pipeline): botão flutuante aparece; abre; pergunta "quantos leads por etapa?" responde com números.
  - Navegar pra `/clientes` com o chat aberto → conversa preservada.
  - `/chat` e `/login`: botão NÃO aparece.

- [ ] **Step 4: Commit**

```bash
git add app/_components/AssistenteWidget.tsx app/layout.tsx
git commit -m "feat(assistente): widget flutuante da VictorIA Analista no painel"
```

---

### Task 7: Build, deploy e smoke test em produção

- [ ] **Step 1: Build** — `npm run build` → sucesso, sem erros de tipo/lint.

- [ ] **Step 2: Deploy** — `npx vercel --prod --yes` → deploy OK.

- [ ] **Step 3: Smoke test produção** — abrir `https://sdr-aiva.vercel.app`, logar, abrir o widget e perguntar:
  - "quantos leads estão em CADASTRO_RECEBIDO?" → número bate com o Supabase.
  - "o que aconteceu na conversa com a Imports Store?" → resumo coerente do histórico.
  - Confirmar que `POST /api/assistente` sem cookie → redirect/401 (proteção ativa).

- [ ] **Step 4: Atualizar CLAUDE.md** — adicionar seção curta "VictorIA Analista (widget do painel)" com endpoint, ferramentas e RPC. Commit:

```bash
git add CLAUDE.md
git commit -m "docs: registra VictorIA Analista no CLAUDE.md"
```
