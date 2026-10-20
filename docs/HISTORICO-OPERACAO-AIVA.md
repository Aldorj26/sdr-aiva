# Histórico de operação — SDR AIVA (VictorIA)

> **Este arquivo NÃO é lido automaticamente pelo Claude.** É o diário de bordo que vivia no `CLAUDE.md`
> até 14/10/2026 (126 KB ≈ 31 mil tokens por sessão). Foi movido pra cá pra o `CLAUDE.md` ficar só com
> as regras vivas. Consulte por seção quando precisar do contexto de um incidente, de uma decisão ou do
> "por quê" de uma regra. Segredos foram substituídos por `<ver .env.local>`.
> Gerado em 14/10/2026 a partir do CLAUDE.md original (cópia em `CLAUDE.md.bak-2026-10-14`, gitignored).

---

@../CLAUDE.md

# SDR Agent AIVA — Documento de Contexto para Claude Code

## ⏭ LEMBRAR O ALDO (pendências que dependem de terceiros)

- (06/10) "Biometria aprovada → Treinar" foi SUBSTITUÍDA em 07/10 pela etapa própria **97 Biometria aprovada** (ver
  "Funil 15 = quadro da AIVA"). Os textos "sem loja criada" (HSM 69 {{5}}, kit, bloco "A BOLA ESTÁ COM A AIVA") seguem
  no código e só valem pra quem estiver em 70 com `[ONB_ETAPA:aguardando_aiva]`.

- **Aviso automático de biometria negada ao lojista — LIGAR quando o Mauricio responder (aberto em 05/10/2026).**
  Textos já aprovados pelo Aldo. Pergunta enviada ao Mauricio: depois de negada, o MESMO link (`liveness_url`) reabre
  pra refazer ou precisa de link novo? (No TevCell o link só abria a tela de concluído.)
  → Se reabre: `ENVIO_NEGADA_ATIVO = true` em `lib/biometria-calc.ts` + deploy.
  → Se precisa de link novo: NÃO ligar como está — o aviso mandaria link morto; primeiro ver como obter o link novo.
  **Ao abrir uma sessão nova, pergunte ao Aldo se o Mauricio já respondeu.** Detalhes na seção "🚫 Biometria NEGADA".
- Mesma mensagem ao Mauricio (05/10): motivo e previsão de volta de loja INATIVADA (Ajucelulares e mais 7) e as 17
  senhas do sócio pendentes (`docs/Senhas-pendentes-AIVA-2026-10-05.xlsx`).

## Visão Geral do Projeto

Agente de IA para prospecção ativa de lojas de celulares via WhatsApp.
Produto prospectado: **AIVA** (financiamento de celulares para o varejo).
Empresa: **Track Tecnologia e Inovação** — Brusque, SC.

O agente opera como um SDR (Sales Development Representative) autônomo:
- Envia mensagens personalizadas para lojas de celulares
- Responde dúvidas e objeções usando IA (Claude API)
- Conduz o lead até o formulário de cadastro da AIVA
- Alerta o time humano quando um lead está qualificado
- Faz follow-up automático nos dias D+3, D+7, D+14

---

## Stack Tecnológica

- **Framework:** Next.js 15.2.4 + TypeScript
- **IA:** Claude API (claude-sonnet-4-5) via @anthropic-ai/sdk
- **WhatsApp:** Evo Talks API (envio HSM + texto livre)
- **Banco de dados:** Supabase (PostgreSQL)
- **Deploy:** Vercel
- **Repositório:** https://github.com/Aldorj26/sdr-agent

---

## Estrutura do Projeto

```
sdr-agent/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                          # Página de status
│   └── api/
│       ├── sdr/
│       │   ├── send-initial/route.ts     # Disparo D+0 para nova lista de leads
│       │   ├── followup/route.ts         # Follow-up automático D+3, D+7, D+14
│       │   └── webhook/route.ts          # Recebe mensagens do Evo Talks e processa com Claude
│       └── leads/route.ts               # Listagem de leads com métricas
├── lib/
│   ├── supabase.ts                       # Cliente Supabase + tipos TypeScript
│   ├── evotalks.ts                       # Funções de envio via Evo Talks API
│   └── claude.ts                         # Chamada à Claude API com system prompt AIVA
├── prompts/
│   └── aiva.ts                           # System prompt completo da VictorIA
├── supabase-schema.sql                   # SQL para criar tabelas (já aplicado)
├── .env.local                            # Variáveis de ambiente (não commitado)
├── .env.example                          # Template de variáveis
└── package.json
```

---

## Variáveis de Ambiente

Arquivo `.env.local` (já configurado localmente e no Vercel):

```env
# Anthropic
ANTHROPIC_API_KEY=<ver .env.local>

# Supabase (projeto: sdr-agent | project_id: axkrorkhnkfkpbjikwrb)
NEXT_PUBLIC_SUPABASE_URL=https://axkrorkhnkfkpbjikwrb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ver .env.local>
SUPABASE_SERVICE_ROLE_KEY=<ver .env.local>

# Evo Talks
EVO_TALKS_BASE_URL=https://tracktecnologia.evotalks.com.br
EVO_TALKS_API_KEY=<ver .env.local>
EVO_TALKS_INSTANCE=                      # PENDENTE — aguarda criação pela equipe Evo Talks
EVO_TALKS_PIPELINE_ID=9                  # Pipeline Prospecção UME

# Segurança
WEBHOOK_SECRET=<ver .env.local>

# Notificações humanos
NEI_WHATSAPP=5548999155655
ALDO_WHATSAPP=5547996085000
```

> **Nota:** A var `AIVA_FORM_URL` foi removida — coleta dos 7 dados agora é feita via chat (VictorIA pergunta um por um), não mais via Google Forms.

---

## Banco de Dados Supabase

**Project ID:** `axkrorkhnkfkpbjikwrb`
**Região:** South America (São Paulo)

### Tabela: sdr_leads

Tabela principal de leads em cadência.

```sql
CREATE TABLE sdr_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT UNIQUE NOT NULL,        -- chave de lookup do webhook
  cidade TEXT,
  produto TEXT NOT NULL DEFAULT 'AIVA',
  status TEXT NOT NULL DEFAULT 'DISPARO_REALIZADO',
  etapa_cadencia INT NOT NULL DEFAULT 1, -- 1, 3, 7, 14
  data_disparo_inicial TIMESTAMPTZ,
  data_proximo_followup TIMESTAMPTZ,
  data_ultimo_contato TIMESTAMPTZ,
  acionar_humano BOOLEAN NOT NULL DEFAULT false,
  observacoes TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Status possíveis:**
- `DISPARO_REALIZADO` — mensagem Dia 1 enviada, aguardando resposta
- `INTERESSADO` — lead respondeu, conversa em andamento
- `FORMULARIO_ENVIADO` — link do formulário enviado, humano assume
- `SEM_RESPOSTA` — sem resposta, aguardando próximo follow-up
- `OPT_OUT` — pediu para não ser mais contactado
- `NAO_QUALIFICADO` — loja não vende celulares
- `AGUARDANDO` — estado intermediário
- `DESCARTADO` — sem resposta após D+14, fora do funil

### Tabela: sdr_mensagens

Histórico de mensagens — usado como contexto para o Claude.

```sql
CREATE TABLE sdr_mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES sdr_leads(id) ON DELETE CASCADE,
  direcao TEXT NOT NULL CHECK (direcao IN ('in', 'out')),
  conteudo TEXT NOT NULL,
  template_hsm TEXT,                    -- nome do template HSM se aplicável
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### View: sdr_metricas

```sql
CREATE VIEW sdr_metricas AS
SELECT status, COUNT(*) AS total,
  COUNT(*) FILTER (WHERE data_disparo_inicial >= NOW() - INTERVAL '7 days') AS ultimos_7_dias,
  COUNT(*) FILTER (WHERE data_disparo_inicial >= NOW() - INTERVAL '30 days') AS ultimos_30_dias
FROM sdr_leads GROUP BY status;
```

---

## Evo Talks API

**Base URL:** `https://tracktecnologia.evotalks.com.br`
**Autenticação:** apiKey no body da requisição (NÃO no header)
**API Key global:** `<EVO_TALKS_API_KEY>`
**Pipeline Prospecção UME:** id `9`

### Endpoints utilizados

```
POST /message/sendText/{INSTANCE}        # Texto livre (conversa 1:1)
POST /message/sendTemplate/{INSTANCE}    # HSM aprovado pela Meta (disparo ativo)
POST /crm/opportunity                    # Criar oportunidade no CRM
```

### Webhook recebido do Evo Talks

```json
{
  "event": "messages.upsert",
  "data": {
    "key": {
      "fromMe": false,
      "remoteJid": "5511999998888@s.whatsapp.net"
    },
    "message": {
      "conversation": "texto da mensagem"
    }
  }
}
```

Header de autenticação: `x-internal-secret: <WEBHOOK_SECRET>`

---

## Agente IA — VictorIA

O agente se chama **VictorIA**. Sempre responde em JSON estruturado:

```json
{
  "mensagem": "texto que será enviado ao lead via WhatsApp",
  "novo_status": "INTERESSADO | FORMULARIO_ENVIADO | OPT_OUT | NAO_QUALIFICADO | AGUARDANDO",
  "acionar_humano": true,
  "motivo_humano": "razão para acionar humano ou null"
}
```

**Quando aciona humano:**
- Lead diz "quero avançar" / "pode mandar o formulário"
- Pergunta que o agente não sabe responder
- Lead demonstra irritação
- Lead pede para falar com pessoa

**Produto que representa — AIVA:**
- Fintech de financiamento de celulares para o varejo
- 2.000+ lojas atendidas no Brasil
- Taxa de 12% para o lojista (ativação gratuita, sem mensalidade)
- Aprovação de crédito em 2 minutos
- Pagamento ao lojista em 2 dias úteis
- Zero risco de inadimplência
- Parcelamento para o cliente: 6x, 9x ou 12x
- Coleta dos 7 dados de qualificação: feita via chat (VictorIA pergunta um por um, sem formulário externo)

---

## Cadência de Follow-up

```
Dia 1  → HSM inicial (via /api/sdr/send-initial)
Dia 3  → HSM template id 35 — Prova Social
Dia 7  → HSM template id 38 — Vendas Perdidas
Dia 14 → HSM template id 39 — Última tentativa
→ Sem resposta após D+14: status DESCARTADO
→ ⏸ **PAUSADA** (desde 17/08; religada e pausada de novo em 10/09). Quando o Aldo
  autorizar: readicionar `{ "path": "/api/sdr/followup", "schedule": "0 14,17,20 * * 1-5" }`
  no vercel.json (11h, 14h e 17h BRT, seg-sex) e apagar o lembrete em lib/pipeline-briefing.ts
```

**Como a régua funciona hoje (corrigido em 10/08/2026 — antes NUNCA rodou):**
- Teto de **150 por rodada** E parada por tempo aos **240s** (a função morre em 300s e cada
  envio leva ~3,9s — sem isso o lote é cortado no meio, sem resposta e sem log).
- Fila ordenada por **etapa primeiro** (D+3 antes de D+7 — decisão do Aldo 10/08) e, dentro
  da etapa, o vencido há mais tempo. A ordenação vale no banco **e** em memória.
- `auto-descarte` só manda pra DESCARTADO quem tem `data_proximo_followup is null` (ciclo
  encerrado). Sem essa trava ele descartaria quem ainda deve receber D+3/D+7/D+14.

---

## Endpoints da API

### POST /api/sdr/send-initial
Disparo D+0 para lista de leads.

```json
// Request
{
  "leads": [
    { "nome": "João", "telefone": "5511999998888", "cidade": "São Paulo" }
  ]
}

// Response
{
  "ok": true,
  "total": 1,
  "sucesso": 1,
  "falha": 0,
  "resultados": [{ "telefone": "5511999998888", "ok": true, "lead_id": "uuid" }]
}
```

### POST /api/sdr/followup
Cron de follow-up — chamado a cada hora. Autenticação via Bearer token.

Header: `Authorization: Bearer <WEBHOOK_SECRET>`

### POST /api/sdr/webhook
Recebe mensagens do Evo Talks. Autenticação via header.

Header: `x-internal-secret: <WEBHOOK_SECRET>`

### GET /api/leads
Lista leads com filtros opcionais.

```
GET /api/leads?status=INTERESSADO&limit=50
```

---

## Fluxo Completo do Webhook

```
1. Recebe payload do Evo Talks
2. Valida x-internal-secret
3. Ignora se fromMe=true ou evento diferente de messages.upsert
4. Extrai telefone do remoteJid
5. Busca lead no Supabase pelo telefone
6. Ignora se status = OPT_OUT | NAO_QUALIFICADO | DESCARTADO
7. Se status = FORMULARIO_ENVIADO → alerta Nei e ignora
8. Busca histórico de mensagens (últimas 20)
9. Salva mensagem recebida (direcao: 'in')
10. Envia para Claude API com system prompt + histórico
11. Claude retorna JSON com: mensagem, novo_status, acionar_humano
12. Envia resposta ao lead via Evo Talks
13. Salva resposta no histórico (direcao: 'out')
14. Atualiza status do lead no Supabase
15. Se FORMULARIO_ENVIADO → cria oportunidade no CRM Evo Talks
16. Se acionar_humano=true → alerta Nei via WhatsApp
17. Se FORMULARIO_ENVIADO → copia Aldo no alerta
```

---

## Templates HSM (APROVADOS)

Todos os templates de cadência já foram aprovados pela Meta e estão configurados em `app/api/sdr/followup/route.ts`:

| Etapa | Template (Evo Talks) | ID |
|---|---|---|
| D+1 (disparo inicial) | AIVA Dia 1 | (usado em `/api/sdr/send-initial`) |
| D+3 | AIVA Follow-up D+3 - Prova Social | **12** |
| D+7 | AIVA Follow-up D+7 - Vendas Perdidas | **11** |
| D+14 | AIVA Follow-up D+14 - Última tentativa | **10** |

### Pendente
- **Template HSM "Treinar"** — aguardando Gustavo entregar. Vai conter link Drive (materiais) + cadastro funcionários. Disparado quando Nei move card pra stage TREINAR.
- **Rotação de chaves** (segurança) — agendada pra semana de 2026-05-04. ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, EVO_TALKS_API_KEY, WEBHOOK_SECRET.

### Decisões registradas (não mudar)
- **Fila Evo Talks `queueId=10` é a fila DEFINITIVA** — Aldo confirmou em 2026-05-01 que não vai trocar. Documentação antiga falava em "trocar antes de escalar produção plena" — isso está OBSOLETO.

## ⏸ Régua D+3/D+7/D+14 — religada em 17/09 e PAUSADA DE NOVO em 18/09 (Aldo)

Ficou ligada por **uma rodada**. O motivo da pausa é medição, não opinião — comparando o que saiu
em 17/09, todos com ~17h de maturação:

| o que saiu | enviados | responderam | taxa |
|---|---|---|---|
| disparo novo (`aiva_campanha`) | 300 | 100 | **33,3%** (73 viraram INTERESSADO) |
| cobrança de formulário (`aiva_reativacao_48h`) | 67 | 16 | **23,9%** |
| **régua D+3 (`aiva_d3`)** | **148** | **0** | **0,0%** — 147 seguem SEM_RESPOSTA |

E não é um dia ruim: o histórico do `aiva_d3` desde 01/08 é **2.016 envios → 5 respostas = 0,2%**.

A régua consumia 150 slots/dia de HSM do mesmo número. Com 3.777 leads na fila de disparo novo,
esses slots valem ~35 interessados/dia em vez de ~0,3. **Capacidade de HSM é o recurso escasso da
operação — é por isso que a régua sai, não por ela "não funcionar" em abstrato.**

⚠️ Ressalvas registradas: os 33% do disparo incluem auto-resposta de WhatsApp Business (o número
honesto é 24%, os que viraram INTERESSADO); a régua fala com quem NÃO respondeu à primeira
mensagem, público mais difícil por definição; e a validação de número do Evo está fora do ar desde
10/08, então parte desses contatos pode nem existir no WhatsApp.

Se um dia religar: `{ "path": "/api/sdr/followup", "schedule": "0 14 * * 1-5" }` no vercel.json.
A rota, o teto de 150/rodada e a ordenação continuam intactos — só o agendamento saiu.
⚠️ `getLeadsForFollowup` tem `limit(1000)`: o `fila_total` do `?dry` mostra no máximo ~1.000 e NÃO
é o tamanho da fila (a real, paginando, era 4.530 em 17/09).

## Como a Evo enxerga os nossos templates (Maisa/Evotalks, 21/09/2026)

Tudo que sai por `/int/sendWaTemplate` (D+0 template 41, template 48 da cobrança/biometria/retomada, HSM 69, 20…)
é registrado na Evo como **"envio de template para o contato"** — o equivalente a um atendente abrir o chat e
mandar o template na mão — e **NÃO como "disparo de campanha"**. Por isso o relatório de campanhas deles fica
vazio e a Maisa achou que nada tinha sido enviado. A resposta da API é só `{"message":"success"}`, sem id de
mensagem: **a resposta não distingue "aceito" de "entregue"**.

### ✅ MAS O RECIBO DE ENTREGA EXISTE — `getChatMessages` (corrigido 22/09/2026)

⚠️ Estava escrito aqui que template "não aparece no histórico do chat". **ERRADO, e custou um dia de disparo
morto.** `/int/getChatMessages` devolve o template como `direction: 2`, com três campos que são o recibo da Meta:

| campo | significado |
|---|---|
| `srvrcvtime` | a Evo aceitou o envio |
| `clientrcvtime` | **a Meta ENTREGOU no aparelho** (vazio = não entregou) |
| `clientreadtime` | o lojista abriu |

⚠️ **LIDO também é entregue (02/10/2026):** a Evo deixa `clientrcvtime` vazio em parte das mensagens que já têm
`clientreadtime`. Amostra de 30 do disparo de 02/10: 6 com recibo de entrega, 14 lidas → 19 entregues de fato (63%), e não 20%.
O vigia (`entregaDoChat`) passou a contar `clientrcvtime || clientreadtime`. As leituras de 43% de 30/09 e 01/10 usaram
só o `clientrcvtime` e provavelmente estão subestimadas.

É a única prova de entrega que temos por conta própria, e ela é por mensagem. Em lote saudável dá 87–90% de
`clientrcvtime` preenchido (17/09: 26/30 · 18/09: 27/30 · 21/09 manhã: 27/30). **Zero entregue num lote inteiro
não é azar — é bloqueio.** O `chatId` vem de `sdr_leads.evotalks_chat_id`; se estiver vazio ou velho,
`/int/getClientOpenChats` pelo número devolve o chat atual (59 leads do levantamento de 22/09 só apareceram assim).

## 🚨 Entrega parou e o número está "saudável"? OLHE A FATURA DA META PRIMEIRO (22/09/2026)

Em 21/09 ~13h BRT a entrega caiu pra **zero** em conversa nova e ficou assim por 24h: 415 disparos D+0 + 84
template 48 aceitos pela Evo, `wamid` gerado pela Meta, **nenhum entregue**. Só passava mensagem em janela de 24h
aberta (essas são gratuitas). O erro que a Evo devolve é o genérico **131026 "Message Undeliverable"**, cuja
descrição fala de "número não existe no WhatsApp" — **e isso é mentira no nosso caso**: 82 dos 84 destinatários
do template 48 tinham nos escrito nos dias anteriores, 38 na semana.

**A causa real:** duas cobranças do MasterCard final 7917 **falharam em 21/09** (R$ 287,61 e R$ 287,26; saldo
devedor R$ 252,73, conta de anúncios desabilitada). Sem forma de pagamento válida a Meta recusa toda conversa
INICIADA pela empresa, que é a paga. O erro verdadeiro é o **131042 "Business eligibility payment issue"** e ele
só aparece num lugar: **WhatsApp Manager → Gerenciar modelos → clicar no modelo → gráfico "Mensagens de erro"**,
onde se lê "Problema de pagamento referente à qualificação da empresa" (modelo 41: 375 em 22/09; modelo 48: 93
em 21/09). Aldo pagou o saldo em 22/09 ~14h e a entrega voltou no mesmo minuto (teste com 5 números: 4 entregues
em 2–13s; o 5º é número que não existe mesmo).

⚠️ **Onde NÃO adianta olhar** (tudo verde durante o apagão, foi por isso que a investigação levou horas):
qualidade do número (Alta), status (Conectado), limite (10.000/24h), os 13 modelos (Ativos), registro de
atividades (nada desde 3/set), recategorização (zero), status da plataforma Meta (sem incidente) e o painel da
Evo. **A conta de pagamento é a MESMA dos anúncios** — anúncio pausado por cobrança = WhatsApp parado junto.

**Receita quando "não sai nada":** (1) amostra de 30 chats do lote conferindo `clientrcvtime`; (2) se der zero,
WhatsApp Manager → modelo → Mensagens de erro; (3) Cobrança e pagamentos da Track (conta 1393519272841254).
**Reenvio:** `scripts/reenvio-nao-entregues-2026-09-22.mjs` é o molde — monta a lista pelo recibo faltando, reenvia
D+0 com o template 41 e lembrete com o MESMO texto do 48 (desmonta o `conteudo` gravado em `sdr_mensagens`), e
pula OPT_OUT/DESCARTADO/já vendendo. Pergunta em aberto com a Evo: id de mensagem/status na resposta do envio.

## 29/09/2026 — dia de 1.000 disparos: fixo na lista velha + janela sem entrega (PENDENTE testar 30/09)

- **Fila nova (varredura 28/09):** 37.860 lojas (só celular — `Tipo=Celular` e 13 dígitos com 9 — e nome de loja de
  celular; sem operadora/rede/shopping), 35.045 pendentes após cruzar a base. `disparar-fila.mjs` agora sai por
  **`avaliacoes` desc** (mais avaliados no Maps primeiro). Muitas lojas top já tinham sido contatadas pela lista de 01/09.
- **Metade do disparo de 28/09 foi pra FIXO** (fim da lista de 01/09, ex. 554130825077): Meta registra como
  "Mensagens não enviadas" (~270 de ~500). A lista antiga acabou; a nova é só celular.
- **Janela sem entrega em 29/09 ~11h55–14h:** TODO template que abre conversa (41 e 48) sem `clientrcvtime`; às 15h o 48
  voltou a entregar. Os 400 do disparo das 11h55 ficaram 0/25 até 17h. WhatsApp Manager (portfólio Track Tecnologia e
  Inovação, conta **"Track Tecnologia"**, asset 2385306101954733, número 47 9204-2626; o modelo do disparo é
  `verifica_pedido_enviado`, id 1421497396657964): modelo Ativo, limite 10.000, qualidade Alta, erro de pagamento só em
  22/09. Causa NÃO confirmada. ⏭ **30/09: testar o 41 com 5 da fila, olhar Cobrança e pagamentos, e reenviar os ~400
  pelo recibo** (molde `scripts/reenvio-nao-entregues-2026-09-22.mjs`). Até lá, 500/dia em lotes menores.
- ✅ **30/09: teste do 41 entregou 4/5 em segundos** — a janela de 29/09 foi passageira. Os 400 das 11h55 de 29/09
  seguiam 0/25 na manhã seguinte (não chegam sozinhos; reenvio pendente de decisão do Aldo).
- 📈 **30/09 13h11: Meta subiu o limite do número pra 100.000 conversas/24h** (e-mail "Seus limites do WhatsApp
  Business aumentaram"; critério = 5.000+ clientes únicos em 7 dias com qualidade alta — estávamos em 5.661). Prova de que
  a Meta NÃO está punindo o número. O limite nunca foi o gargalo: o padrão segue 500/dia.
- 📉 **30/09: entrega de 43% (13/30)** nos 505 do dia, sem bloqueio (últimos 5/8). Suspeita: lista em ~45 avaliações
  com celular do Maps sem WhatsApp. Conferir no gráfico de erros do modelo ("Mensagens não enviadas").
- 📏 **PADRÃO DO DISPARO: 500 por dia (Aldo 30/09).** Faixa que já rodou sem problema (350–600 em 22–25/09); o dia de
  1.000 foi o da janela sem entrega. Somando retomada (até 210) e cobrança/biometria, o número manda ~700 templates/dia.
- ⚠️ **Risco em aberto:** o disparo sai pelo modelo `verifica_pedido_enviado`, categoria UTILIDADE, com texto de
  prospecção (é Marketing pra Meta). Pode ser recategorizado/restringido. Caminho seguro: modelo próprio de Marketing.

## VictorIA calada por JSON inválido — quebra de linha crua (22/09/2026)

`[CLAUDE_ERR:...Bad control character in string literal in JSON]` era **43 dos 166** erros
registrados da VictorIA — a causa nº 1, 4 a 6 por dia útil. Ela responde em JSON e, quando
escreve a quebra de parágrafo como **newline cru** dentro da string (em vez de `
`), o
`JSON.parse` estoura e o turno inteiro morre: o lojista recebe *"estou com um volume alto de
atendimentos"* (que é mentira — o problema é formatação), Nei e Aldo levam alerta 🚨 e o webhook
entra em retry. Caso que motivou: MY CASE (5592982741062) em 22/09 15:44, depois de uma saudação
automática cheia de quebras de linha.

`lib/claude-json.ts` (`npm run test:json`) faz o parse tolerante: tenta `JSON.parse` puro e, **só
se falhar**, escapa caractere de controle que esteja DENTRO de string literal e tenta de novo.
É seguro porque controle cru dentro de string nunca é JSON válido — não muda nenhum JSON que já
funcionava. ⚠️ **Não conserta outros defeitos** (JSON truncado por limite de tokens, aspas
abertas): esses continuam estourando com o erro original, de propósito, porque são problema de
conteúdo do prompt e mascará-los esconderia defeito real.

## 🚨 Recibo de entrega da Meta — `clientrcvtime` (22/09/2026)

⚠️ **Estava escrito neste arquivo que template não aparece no histórico do chat. ERRADO, e custou
um dia de disparo.** `/int/getChatMessages` devolve o template como `direction: 2` com
`srvrcvtime` (a Evo aceitou), **`clientrcvtime` (a META ENTREGOU)** e `clientreadtime` (o lojista
abriu). É a única prova de entrega que temos: a resposta do `sendWaTemplate` é só
`{"message":"success"}`. Lote saudável dá **87–90%** de `clientrcvtime`; zero num lote inteiro é
bloqueio, não azar.

**O apagão de 21-22/09:** duas cobranças do cartão da conta Meta falharam em 21/09 (R$ 287,61 e
R$ 287,26; saldo devedor R$ 252,73, conta de anúncios desabilitada). Sem pagamento válido a Meta
recusa **toda conversa iniciada pela empresa** (a paga) — erro **131042 "Business eligibility
payment issue"**. 415 disparos + 84 lembretes foram pro vazio por 24h. A Evo repassa o genérico
**131026**, cujo texto fala em "número não existe no WhatsApp" — falso: 82 dos 84 destinatários
tinham nos escrito nos dias anteriores. O 131042 só aparece em **WhatsApp Manager → Gerenciar
modelos → abrir o modelo → "Mensagens de erro"**. Aldo pagou e a entrega voltou no mesmo minuto.

⚠️ **Onde NÃO adianta olhar** (tudo verde durante o apagão): qualidade do número (Alta), status
(Conectado), limite (10.000/24h), os 13 modelos (Ativos), registro de atividades, recategorização,
status da plataforma Meta e o painel da Evo. **A conta de pagamento é a MESMA dos anúncios.**

**Vigia:** `/api/sdr/vigia` (17h BRT) amostra o dia, confere o recibo e avisa Aldo+Nei **no mesmo
dia**, mandando olhar a fatura primeiro.
⚠️ **Piso é 30%, não 50%, e a amostra é DUPLA** (corrigido 23/09 antes de causar alarme falso):
a taxa varia muito por segmento de lista e isso é NORMAL — Manaus 86%, Natal 64%, Recife/Natal 74%
(censo de 114). Não é bloqueio, é lista com número que não existe no WhatsApp. O apagão real deu
**0 de 30**, então 30% separa com folga. E as duas amostras são medidas SEPARADAMENTE: a do DIA
(varredura de ponta a ponta, "está entregando?") e a dos RECENTES (últimos 10, "parou agora?").
Juntar as duas com `slice(-30)` jogava fora o começo do dia e fez o vigia ler 53% num dia de 83%. Regras puras em
`lib/entrega-meta-calc.ts` (`npm run test:entrega`), IO em `lib/entrega-meta.ts`.
⚠️ `sdr_leads.evotalks_chat_id` **fica velho** (29 de 48 leads medidos em 22/09 tinham o template só
no chat aberto atual): quem lê recibo precisa cair pro `/int/getClientOpenChats` quando não achar o
template, senão a amostra encolhe e o vigia fica calado justamente no dia do apagão.
**Reenvio:** `scripts/reenvio-nao-entregues-2026-09-22.mjs` é o molde (monta a lista pelo recibo
faltando, reenvia D+0 com o 41 e lembrete com o MESMO texto do 48, pula OPT_OUT/descartado/vendendo).

## 💳 DUAS ORGANIZAÇÕES NA ANTHROPIC — a chave de produção NÃO é a da "Track" (23/09/2026)

Em 23/09 às 10h44 a VictorIA parou: `Your credit balance is too low to access the Anthropic API`.
18 falhas, 16 lojistas receberam *"estou com um volume alto de atendimentos"* (mentira). O Aldo
comprou crédito, a API continuou recusando por meia hora — **porque o crédito foi pra organização
errada**.

| organização | chave | observação |
|---|---|---|
| **Track** | `nei-luiz-api-key` (`<ANTHROPIC_API_KEY>`) | tinha US$ 500 parados, só US$ 3,45 gastos desde junho. **Recarga automática LIGADA** |
| **Aldo da Rocha Junior's Individual Org** | **`sdr-agent-2`** (`<ANTHROPIC_API_KEY>`) | **é a chave do SDR em produção**, US$ 283,94 gastos. Era ela que estava zerada |

⚠️ **Antes de comprar crédito, confira a organização no seletor do canto inferior esquerdo do
console.** As duas aparecem na mesma conta (aldo@trackcr.com.br) e o console abre numa delas sem
avisar. Outras chaves da Individual: `sdr-parcelex`, `Track-deals-prod`, `claude_code_key_aldo`,
`track-agent`, `Instagram`, `vocacao-comercial`.

**Decisão em aberto:** consolidar na organização Track (gerar chave lá, trocar no `.env.local` e
no Vercel) e/ou ligar recarga automática na Individual. Recarga automática é a única prevenção
real — **não existe API que devolva o saldo restante** (o Console mostra, a API não; é limitação
conhecida da Anthropic, com pedido aberto no GitHub deles).

### Detecção: `lib/saude-contas*.ts` (`npm run test:contas`)

Como não dá pra ler saldo, a detecção é por FALHA, em dois pontos:
1. **No webhook, na hora.** `classificarFalha()` separa `sem_credito` / `credencial` (não passam com
   retry) de `limite` / `outro`. Quando é de conta, sai **UM** alerta nomeando a causa, o efeito e o
   caminho — e o alerta genérico por lead é **calado**. Foi o excesso de alerta por lojista que
   escondeu a causa em 23/09: 18 mensagens dizendo "erro ao processar mensagem de Fulano".
   Dedupe por `sdr_avisos_chave` (`conta_parada:<tipo>`), 1 aviso a cada 6h.
2. **No vigia das 17h.** `sondarAnthropic()` faz a chamada mais barata possível (haiku, 1 token,
   ~US$ 0,00003) e avisa se a conta recusar. É rede de segurança pra quando ninguém escreve.

⚠️ **O lado da META é outro mecanismo e já existe:** lá a falta de pagamento NÃO volta como erro —
a Evo responde `success` e a mensagem some. Quem pega é o recibo `clientrcvtime`
(`lib/entrega-meta.ts`), no mesmo vigia. Ler saldo da Meta exigiria token da Graph API com
`ads_read`, que a operação não tem; se um dia tiver, o lugar de plugar é `lib/saude-contas.ts`.

## ⚠️ LEAD COM MAIS DE UM CNPJ — dois defeitos gêmeos (24/09/2026)

Revisão da API da AIVA achou dois buracos com a MESMA raiz: quando o lojista tem vários CNPJs, o
código olhava só "o melhor" e o sinal dos outros sumia.

1. **Reprovação engolida pelo CNPJ que avança.** `calcularEspelho` só entrava no bloco de
   reprovado com `if (!melhor && reprovadoEm)` — então quem tinha um CNPJ avançando e outro
   recusado pela AIVA não gerava nem aviso. Caso real: **DHtech e Pulse**, matriz 47640647000141
   vendendo (RID 5643) e filial 49357065000188 `not_approved`. Agora, quando os dois existem, o
   card continua avançando (a loja opera, não se move pra 95) mas entra em **conferir** com o
   motivo "outro CNPJ do lojista avançou, mas este foi reprovado pela AIVA".
   ⚠️ O teste `espelho-portal-calc.test.ts` **fixava o defeito** (`conferir.length === 0`, com o
   nome "outro CNPJ aprovado prevalece") — foi corrigido junto. Teste que documenta bug vira
   muralha do bug.
2. **Um marcador por LEAD em vez de por marcador.** O `vistos` da marcação de CNPJ usava só o
   `lead.id`, então quem tinha DOIS CNPJs problemáticos recebia só o primeiro. **Smarttech
   Celulares**: 62555956000108 `invalid` e 13222874000135 **INAPTA** — ficou só o de inválido, e a
   situação real na Receita, que é a mais grave, não aparecia em lugar nenhum. A chave virou
   `lead+marcador`; os dois marcadores são independentes e coexistem. O bloco `?dry` tinha a mesma
   contagem e foi corrigido junto (dry que diverge do real mente).
   Junto veio um terceiro: o "regularizou" desmarcava olhando se havia **qualquer** CNPJ ruim, então
   quem regularizasse a inaptidão mas seguisse com um CNPJ de DV inválido ficava com o marcador
   errado pra sempre. Agora confere o tipo.

Depois da correção (dry de 24/09): 15 irregulares · 17 inválidos · Smarttech entra como novo ·
`conferir` passou a listar Teccell e DHtech, que antes sumiam.

## 🔎 API pública da AIVA — o que existe de fato (revisado 24/09/2026)

Sondagem de 21 caminhos: **nada de endpoint novo**. Só `/onboardings` (leitura),
`/onboardings/remove` e `/onboardings/resend-password`. **Continua SEM endpoint de restaurar** —
`restore`/`unremove`/`recover`/`restaurar` todos 404. Isso importa: os 13 cadastros removidos em
23/09 não têm volta pela API (o backup está em `scripts/out-removidos-portal-2026-09-23.json`).

**26 campos por registro.** Três não estão declarados em `OnboardingApi`, embora dois já sejam
usados pelo índice `[extra: string]`: `partner_owner_name` (nome do SÓCIO — difere da razão social
em 226 de 248; já é o que `telefonePorRetailer` prefere), `created_at` e `retailer_name` (slug
`nome-CNPJ`, sem uso). **`training_label` segue 0/543** — a pergunta ao Mauricio continua aberta.

⚠️ **Armadilhas dos parâmetros:**
- `limit=1000` devolve **lista VAZIA**, sem erro. O teto é 500, e passar disso falha em silêncio.
- Parâmetro desconhecido é **ignorado sem avisar**: `cnpj=` e `retailer_id=` devolvem a página
  inteira como se não houvesse filtro. Só `stage=` e `cursor=` filtram de verdade (`stage=` já é
  usado em `listarBiometriaPendenteApi`).

**Reconferido 30/09** (Mauricio avisou que vem atualização; `scripts/sonda-api-aiva.mjs` refaz tudo SÓ com GET): nada
novo ainda — 26 campos, mesmos caminhos (remove/resend-password só POST). ✅ **`updated_since=<ISO>` FILTRA** (258 de 587
desde 29/09) — não estava documentado; serve pra busca incremental. `stage` agora também vem `pre_cadastro` (1 caso; o
espelho já ignora). ⚠️ O banco do portal (login) tem MAIS campos que a API: `ready_to_operate_at`, `formulario_completed_at`,
`cadastro_completed_at`, `manual_registration`, `unblinded_at`… O quadro "Pronto para operar" do portal =
`cadastro_finalizado` E (`ready_to_operate_at` OU senha enviada em `login_sends`) — conferido: 209 exatos em 30/09.

**Retrato de 24/09** (543 cadastros): stage `dados_varejo` 269 · `cadastro_finalizado` 231 ·
`not_approved` 25 · `biometria` 18. Biometria: pendente 313 · aprovado 221 · negado 9.
`cnpj_check_status`: valid 504 · invalid 18 · inapta 12 · baixada 6 · not_found 2 · suspensa 1 —
**nenhum `pending`**, a AIVA passou a conferir todos. Conferi o DV por conta própria: **16 dos 18
`invalid` têm dígito realmente errado**, a AIVA está certa. Três deles são de lojas que estão
VENDENDO (Rosa-Rio Shop, Zé do celular, Joelcelularessm) — CNPJ errado no cadastro de loja que
opera, o que pode afetar repasse.

## 📌 LEIA ANTES DE MEXER (atualizado 2026-08-13)

Passagem completa da sessão 05→13/08 (pendências, o que foi construído e as armadilhas):
**`docs/sessao-2026-08-05-a-13.md`**. Resumo do que NÃO pode ser esquecido:

- **`sdr_leads` não é histórico de disparo.** O sync APAGA leads transferidos pro funil 19
  (Odres/UME). Pra saber se um telefone já foi contatado, cruze também as oportunidades do
  Evo (pipelines 15, 19, 17, 20) — ~2.000 telefones só existem lá.
- **Crons do Vercel chamam por GET.** Rota sem handler GET = 405 = cron morto e silencioso.
  Já derrubou `/followup` e `/auto-descarte` por meses. Ao criar cron, exporte `GET`.
- **Funções morrem em 300s.** Lote grande precisa de teto por tempo, não só de contagem.
- **A VictorIA não sabe que dia é hoje** — a data é injetada a cada turno em `lib/claude.ts`
  (bloco dinâmico, FORA do cache). Nunca mova isso pro prompt cacheado.
- **Confira a data com `date` no início de cada análise** e converta fuso com Node —
  `TZ=America/Sao_Paulo` no Git Bash devolve UTC (errado).
- **Ao mudar uma regra do prompt, corrija TODAS as passagens** sobre o assunto. Regra nova
  convivendo com exemplo antigo = comportamento alternado.
- **Validação de WhatsApp do Evo (`/int/checkIfUserExists`) está fora do ar** (503) desde
  ~10/08 — disparos saem sem checagem prévia de número.
- ~~Etapa 51 não aceita `changeOpportunityStage` via API~~ — **OBSOLETO (11/09/2026)**: a ação
  em massa Treinar→51 moveu 15 cards pela API sem erro (`/int/changeOpportunityStage` com
  `queueId` + `EVO_TALKS_QUEUE_API_KEY`). ⚠️ A chave GLOBAL (`EVO_TALKS_API_KEY`) devolve
  400 `GENERIC_001` — o endpoint exige as credenciais da FILA.

## Contatos oficiais e Parcelex (registrado 2026-08-13)

A Track representa **AIVA e Parcelex**. Números legítimos que a VictorIA precisa reconhecer:

| Quem | Telefone | Papel |
|---|---|---|
| **Nei Luiz** | **48 99915-5655** (`5548999155655`) | comercial principal Track/AIVA |
| **Ricardo** | **21 97177-0730** | apoio aos leads Parcelex — **não é funcionário da Track**, é ex-diretor comercial da Parcelex |

- ⛔ **A VictorIA NUNCA pode acusar um número de golpe** nem mandar bloquear. Número
  desconhecido ≠ número falso — ela não tem a lista completa. Na dúvida: `acionar_humano`
  com `motivo_humano = "confirmar_contato"`.
- ⛔ **Parcelex não se oferece em conversa qualquer.** Só quando o lojista pergunta, menciona
  o Ricardo, ou (FASE 5) reclama que a AIVA reprova muito.
- 🔥 **Por que essa regra existe:** em 12-13/08/2026 a VictorIA disse ao JN Multimarcas que o
  número do Nei era golpe, que "nenhum Ricardo faz parte do time", e mandou bloquear. Quando
  o lojista encaminhou o áudio real do Nei, ela insistiu que era falso e repetiu o erro por
  2 dias. Regras em `prompts/aiva.ts` (seções "TIME" e "A TRACK REPRESENTA AIVA E PARCELEX").

## Política de qualificação (atualizada 2026-07-27)

- ✅ **SEM mínimo de faturamento ou de lojas** — 1 loja com qualquer volume qualifica (decisão do Aldo 2026-07-27)
- 🔼 +10 lojas → aciona humano
- ❌ Só vende iPhone | não vende celular → NAO_QUALIFICADO
- ❌ **CNPJ com menos de 1 ano** → NAO_QUALIFICADO automático (validado na Receita via BrasilAPI quando o CNPJ chega no chat)
- ❌ **CNPJ com situação cadastral ≠ ATIVA na Receita** (INAPTA/SUSPENSA/BAIXADA/NULA) → TRAVA
  automática no início da jornada (NAO_QUALIFICADO), mensagem ao sócio com a situação + orientação
  de regularizar, card → etapa **94 "CNPJ Irregular na Receita"** (automação 102). Regra 2026-09-10.
- ❌ **CNPJ inválido (DV) ou que não consta na Receita** → NÃO pré-aprova (2026-08-11/13).
  DV é conferido localmente antes da API; 400 = inválido, 404 = não consta, ambos bloqueiam.
  Só 5xx/timeout segue fail-open. ⚠️ O marcador `[CNPJ_RECEITA:...]` impede a revalidação —
  se o lojista corrigir o CNPJ depois, valide na mão.
- 📋 CNPJ já na base AIVA/Odres (`aiva_base_cnpjs`) → mensagem oficial Odres + funil 19 (barrado automaticamente)
- ✅ **A conferência também roda no turno da PRÉ-APROVAÇÃO** (ARPF Tech, 07/10/2026): antes ela só rodava no turno em
  que o cnpj_matriz chegava. Lojista corrigiu o CNPJ ("só confirma: é 62.817.987?" → "Ok") e o modelo não regravou — a
  pré-aprovação e o pré-cadastro saíram com o número de DV errado. Agora: CNPJ acumulado sem `[CNPJ_RECEITA]` é
  conferido na pré-aprovação; DV inválido → usa o último CNPJ VÁLIDO que o lojista mandou (getMensagens); Receita fora do
  ar → 2 tentativas e alerta "PRÉ-APROVAÇÃO SEM CONFERIR O CNPJ" pro Nei/Aldo (segue fail-open).

## Coleta de dados — 12 → 7 campos (Aldo 16/09/2026)

**FASE 1 (5):** nome_socio · telefone_socio · nome_varejo · cnpj_matriz · numero_lojas
**FASE 3 (2):** email_socio · cnpjs_adicionais (só quando numero_lojas >= 2)

SAÍRAM do fluxo (não se pergunta em fase nenhuma): `regiao_varejo`, `possui_outra_financeira`,
`faturamento_anual`, `valor_boleto_mensal`, `localizacao_lojas` e `faturamento_medio_mensal`.
Motivo: a AIVA não usa na análise e a coleta afastava o lojista (é no intervalo da Fase 3 que ele some).

- 📍 **A cidade não é mais perguntada** — vem da consulta do CNPJ na Receita (`CNPJInfo.cidadeUf`,
  lib/cnpj.ts) e é gravada em `regiao_varejo` + `sdr_leads.cidade` só se ainda estiverem vazios.
  Isso mantém `/clientes` (que deriva estado/cidade desses campos) funcionando.
- ⛔ **Não se pergunta mais sobre Odres/UME** (Aldo 16/09): a trava real é o CNPJ conferido contra
  `aiva_base_cnpjs`. As regras Odres/UME continuam valendo quando o LOJISTA mencionar espontaneamente.
- **Formulário 10 "Qualificação Varejo" (Evo):** `regiao_varejo` e `possui_outra_financeira` viraram
  `required:false`. Os 13 campos e seus ids foram preservados — histórico das 6.466 opps intacto.
  ⚠️ A etapa 50 exige esse formulário: se um dia voltar a marcar campo como obrigatório sem coletá-lo,
  o card para de entrar na etapa (falha silenciosa, 200 sem gravar).
- **Gates atualizados** (senão o fluxo trava): `camposFase1` e `camposObrigatorios` no webhook,
  `FASE3_OBRIGATORIOS` (lib/evotalks), `CAMPOS_OBRIGATORIOS` (lib/cadastro-recebido), rótulos do
  /incompletos (lib/admin-commands) e a mensagem pós-aprovação (lib/text).
  ⚠️ `dados12` no webhook lê os 5 campos removidos por fieldId literal (`valorLegado`) — eles não
  estão mais em `camposObrigatorios` e o acesso direto quebraria em runtime (o TS não acusa).
- Campos legados continuam na interface `DadosColetados` e no `FORM_FIELD_MAP`: lead antigo tem valor
  gravado e as telas continuam exibindo.

## `?dry` nas rotas de cron — sempre por `lib/req-flags` (17/09/2026)

`flag(searchParams, 'dry')` aceita `1`, `true`, `sim`, `yes`, `on` e `?dry` sozinho. Antes o
espelho lia `=== '1'` e as outras doze rotas `=== 'true'`: quem digitasse `?dry=1` na cobrança
achava que estava simulando e **disparava HSM de verdade**. Ao criar rota de cron nova, use o
helper — nunca compare a string na mão.

## Pré-cadastro na Pré Aprovação + card automático pra 49 (Aldo 17/09/2026)

O registro do CNPJ matriz nasce na **transição pra PRE_APROVACAO** (webhook, junto do envio pra
planilha) — antes só nascia na etapa 49, e quem movia pra 49 era o Nei arrastando o card. Marcar o
CNPJ como enviado em `/registros` (POST `/api/registros`, tanto pelo "Abrir form ↗" quanto pelo
checkbox) **avança o card pra Cadastro Recebido (49)** via `changeStageSeAvanco` — daí pra frente é
o fluxo de sempre (automação do Evo → HSM 20 → handler da 49 → Fase 3).
- Só avança: card em 49+ ou em 69/93/94/95 não é tocado. **Desmarcar NÃO traz o card de volta.**
- ⚠️ "Abrir form" marca no clique (regra 24/08): abrir sem enviar move o card e dispara o HSM 20.
- Falha ao mover não derruba a marcação — o Nei move na mão e o log diz o motivo.
- O alerta 🟡 de pré-aprovação aponta o `/registros` (não pede mais pra arrastar card); o alerta da
  49 reconhece quando o card veio do próprio clique.

## Regra "OK" NÃO É CONFIRMAÇÃO DE FATO (Aldo 17/09/2026)

`prompts/aiva.ts` (seção própria) + blocos de fase em `lib/claude.ts` (FASE 4, TREINAR, LOGIN):
aceno curto ("ok", "blz", "entendi", 👍) confirma que o lojista LEU, nunca que ele FEZ. Só vale como
confirmação o que ele DIZ ("sim", "isso", "já fiz", "preenchi") ou um print. Exceções que continuam
valendo acima dela: o "sim" de Odres/UME, o "sim/não" de qualificação e o "ok" que responde uma
OFERTA dela ("te mando o link?"). Teto de 2 tentativas por assunto.
⚠️ No código: `lib/reconhecimento.ts` (`ehSoReconhecimento`, `npm run test:reconhecimento`) decide o
que é aceno, e o webhook (bloco 8e) só carimba `[CHECK_TREINAMENTO_RESP]`/avisa o Nei quando NÃO for
aceno — antes qualquer "ok" matava a cadência do check de treinamento. **Ao mexer na lista de
palavras, lembre que falso positivo é o erro caro**: cala quem respondeu de verdade.

## Retomada do INTERESSADO + rede de segurança + vigia (Aldo 18/09/2026)

Levantamento do funil (18/09): 8.435 leads · 423 chegaram à pré-aprovação · 220 vendendo (52% de
quem qualifica). **O vazamento está antes:** 1.489 em INTERESSADO, e desde 10/09 nenhuma automação
tocava neles (as rotinas da etapa saíram pro redesenho; a régua D+3/7/14 só pega INICIO/SEM_RESPOSTA).

**1) `/api/sdr/retomada-interessado`** — 2 toques (silêncio de 7d, depois +8d) e encerra com
`[RETOM_INT_FIM]`. Texto muda se o lead JÁ deu dados ("retomo de onde paramos") ou não.
⚠️ O silêncio é medido pela última mensagem DO LOJISTA (`direcao='in'`), nunca por
`data_ultimo_contato` — esse campo sobe quando NÓS enviamos, então a régua zeraria o próprio
contador. Foi medindo assim que apareceu silêncio real de até **160 dias** (por
`data_ultimo_contato` o máximo parecia ser 30). Quem nunca mandou mensagem fica FORA: o texto diz
"a gente conversou" e com eles isso é mentira. Regras: `lib/retomada-interessado-calc.ts`
(`npm run test:retomada`). ✅ **LIGADA em 23/09/2026 (Aldo).** Primeira rodada controlada: 10
enviados, 9 entregues por recibo. O vigia acompanha a rota (tolerância 9 dias).

**Volume — orçamento DIÁRIO gasto de hora em hora** (Aldo: "60 é muito pouco"):
`0 13-19 * * 1-5` = **10h às 16h BRT, 7 rodadas**. Orçamento do dia: **INTERESSADO 150,
AGUARDANDO 60** (`ORCAMENTO_DIA` no calc; o AGUARDANDO subiu de 30 pra 60 no mesmo dia, pedido do Aldo). Cada rodada conta o que já saiu hoje e manda só o que
sobrou, parando no teto de 240s; a seguinte continua de onde parou.
⚠️ **Por que várias rodadas e não uma maior:** o envio real é LENTO — **~5 a 6 s cada, subindo até
12 s** (medido em 23/09). Cabem **~49 por rodada**. A rodada única de 90 que estava agendada já seria
cortada no meio sem aviso nenhum. Prova da passagem de bastão: rodada 1 mandou 49 e parou por
tempo (`cortado_por_tempo: true`, zero falha); a seguinte já leu "49 hoje" e mirou os 101 restantes.
⚠️ **Rótulo próprio** (`ROTULO`): `aiva_retomada_interessado` / `aiva_retomada_aguardando`. Até 23/09
a retomada gravava `aiva_reativacao_48h`, o mesmo da cobrança, da biometria e de mais 7 rotinas —
impossível contar o dia (pro orçamento) ou medir o rendimento (pra decidir se fica). A medição de
uma semana do AGUARDANDO sai direto desse rótulo.
⚠️ **Desligar uma etapa = orçamento 0 no calc + deploy.** `?max=`/`?max_aguardando=` só valem na
rodada MANUAL — o cron chama o caminho sem parâmetro (estava documentado errado como "desliga sem
deploy"). Como o INTERESSADO vem primeiro na fila, em dia de pouca capacidade o AGUARDANDO é quem
espera; com 7 rodadas (~340 de capacidade) contra 210 de orçamento, sobra folga.
✅ **AGUARDANDO entrou na mesma rota em 23/09/2026 (Aldo)**, com três travas que não são detalhe:
1. **Orçamento PRÓPRIO: 30/dia** (`?max_aguardando=`, e `=0` desliga sem deploy). Com fila única ele
   nunca seria atendido — o disparo gera interessado novo todo dia (70 só em 23/09) e os 60 slots
   seriam consumidos pelo INTERESSADO pra sempre.
2. **Teto de 90 dias de silêncio** (`SILENCIO_MAX_DIAS`). É um público muito abordado: 917 dos 992
   já tinham levado reengajamento, 874 reativação e 840 a novidade Flexfone das rotinas antigas.
   Quem ignora a gente há 4 meses rende quase nada e é quem denuncia como spam — e denúncia derruba
   a entrega do disparo novo, que sai pelo mesmo número. Ficaram de fora 212 no dia.
3. **Ordem dentro do AGUARDANDO:** quem já deu dados primeiro, depois o menos frio (22 dias se
   recupera, 85 quase nunca). O INTERESSADO manteve a ordem aprovada (mais frio primeiro) e vem
   antes na fila, pra ser ele quem sai se a rota bater o teto de tempo.
Parte do AGUARDANDO tem só 7–15 dias de silêncio: é lead que a PRÓPRIA VictorIA pôs em AGUARDANDO
na conversa ("vou pensar", "falo com meu sócio"), não o auto-descarte. São os mais quentes da etapa.
O webhook trata AGUARDANDO como etapa lateral: quando o lojista responde, volta pra INTERESSADO.
⚠️ **Medir em uma semana** a resposta do AGUARDANDO contra a do disparo (~27–33%), como foi feito
com a régua D+3 (0,2% → cortada), pelo rótulo `aiva_retomada_aguardando`. Se render como a D+3,
desliga pondo `ORCAMENTO_DIA.AGUARDANDO = 0` e fazendo deploy.
⚠️ O path continua `retomada-interessado`: trocar mata o agendamento e o vigia, que chamam por ele.

**Primeira medição e três ajustes (Aldo, 25/09/2026).** Dos 326 envios de 23-24/09, 157 "responderam" (48%) —
mas **129 eram a mensagem automática do WhatsApp Business da loja**. Resposta de PESSOA: 18% de quem já deu
dados · 9% de quem conversou sem dar dados · **6% de quem só tinha resposta automática no histórico** (1/3 dos
envios: viraram INTERESSADO no D+0 só porque o robô da loja respondeu). Avanço real em 2 dias: 3 pré-aprovações
e 1 Treinar. Ajustes: (1) INTERESSADO também ordena **dados primeiro**, depois o mais frio; (2) lead SEM dados cujo
histórico inteiro é resposta automática sai (`nada.so_resposta_automatica`, regex `RESPOSTA_AUTOMATICA` no calc —
erra pro lado de NÃO mandar; conferidos 60 excluídos à mão, todos robô). Tirou **695** da fila no primeiro dia;
(3) saudação de sigla ("Oi Jf", 26 de 326) vira o começo do nome da loja ("Oi JF Celulares") via
`saudacaoRetomada`, fallback "lojista" — o "Oi {nome}," é fixo no HSM 48, não dá pra tirar o nome.
Junto: a busca das mensagens do lojista na rota passou a paginar (200 leads por lote passavam de 1.000 linhas e o
PostgREST cortava calado).
✅ **Causa-raiz corrigida no mesmo dia (25/09, Aldo):** o webhook (bloco 9a2) não promove mais pra INTERESSADO
lead em INICIO/SEM_RESPOSTA, sem dados, cujas mensagens recebidas são TODAS resposta automática — mantém o status.
A conversa segue igual (o prompt trata INICIO/SEM_RESPOSTA/INTERESSADO com o mesmo bloco de Fase 1, e o contador
de 10 tentativas do bot → BOT_DETECTADO continua); muda só o status e o card do Evo. Na primeira fala de pessoa
promove normal. A regra saiu da retomada pra `lib/resposta-automatica.ts` (`npm run test:auto`) — os dois usam a
MESMA. ✅ **Os antigos também foram devolvidos (25/09, Aldo):** 705 leads (599 INTERESSADO + 106 AGUARDANDO) → INICIO,
card movido pra 66 no Evo antes do status (senão o sync desfaz), marcador `[REBAIXADO_SO_ROBO:ISO]`, 0 falhas.
Script `scripts/rebaixar-so-robo-2026-09-25.mts` (ensaio sem `--executar`), backup com status/etapa anteriores em
`scripts/out-rebaixados-so-robo-2026-09-25.json`. Mover pra 66 dispara a automação 97, que SÓ avisa o
`/opportunity-stage` (espelho de status) — não manda nada pro lojista. ⚠️ Consequência esperada: o auto-descarte
(10h) leva INICIO com disparo > 15 dias pra SEM_RESPOSTA (53), 400/dia — é o caminho normal de quem nunca respondeu.

## Fase 1: onde o lojista desiste e o teste A/B da abertura (Aldo, 28/09/2026)

**Medição (disparos 01–25/09, só quem conversou com PESSOA):** 732 conversaram → **263 (36%) disseram o nome** →
202 nome da loja → 146 CNPJ → 117 pré-aprovação. **O vazamento é ANTES do nome**; depois dele quase metade chega à
pré-aprovação. Descartado como causa: o botão "Saber Mais" (64% voltam, 17% chegam ao cadastro) e a abertura
"já trabalham com crediário?" (a melhor que temos: 64% voltam, 18% pré-aprovação). Perdas identificadas: resposta que
não termina em pergunta (47% voltam × 64%), explicação longa depois do "não trabalho com crediário", e pedir pra falar
com o responsável (7% × 18% de pré-aprovação). Dos 29 que deram CNPJ e travaram, 23 são CNPJ < 1 ano (regra, não vazamento).

**Ajustes no prompt** (revisados pelo `revisor-prompt-victoria`, 7 achados aplicados): (1) na Fase 1 TODA fala termina
com UMA pergunta — na 1ª resposta é a do crediário, depois o próximo dado começando pelo nome; lista de exceções na seção
FASE 1 (já é cliente AIVA, cliente final, pediu pra falar depois, confirmar_contato, irritado, pediu humano, opt-out,
não qualificado, pré-aprovação; esclarecimento Odres/UME/nome ambíguo/CNPJ 11 dígitos vai sozinho); (2) depois do
crediário, a próxima é o NOME; "não trabalho" = 1 linha + nome; saiu "quais marcas?"; apresentação/fechamento deixaram
de ser porteira; (3) com PESSOA não pede mais transferência pro responsável (só no modo "furar o bot"); nome de
funcionário NÃO vira nome_socio.

**Teste A/B** (`lib/teste-abertura.ts`, `npm run test:abertura`): variante B junta "Vocês já trabalham com crediário
hoje? E com quem eu falo?" na 1ª resposta. Variante fixa por lead (paridade do último hex do uuid), só na 1ª resposta a
uma PESSOA (não conta resposta automática), marcador `[TESTE_ABERTURA:A|B:ISO]`. **Medir ~12/10**: por variante, % que
disse o nome e % que chegou à pré-aprovação. Encerrar = `TESTE_ABERTURA_ATIVO = false` + deploy. O simulador
(`/api/chat`) aceita `teste_abertura: 'B'` pra conferir a variante.

**Tabela de campanhas (`/campanhas`, 28/09/2026):** conta o status ATUAL de quem foi disparado em cada dia
(função `get_campanhas_por_dia`). Colunas "Vendendo" e "Em andamento" (pré-aprovação→login **+ Fase 3**: lead com
`[FASE3_DESDE:]` usa status INTERESSADO pela regra antiga e aparecia como "Interessado"). "Responderam" inclui quem
avançou. ⚠️ **Lote novo engana:** de quem se engaja, avança 10% nos lotes de até 10 dias, 23% nos de 10–20 e 30% nos
de 3+ semanas — por isso o selo "lote novo" (< 14 dias). Não compare lote de 5 dias com lote de 1 mês.
Achado junto: 5 leads com os 5 dados completos parados em INTERESSADO/AGUARDANDO desde jul–ago (conversa travou em
pergunta desnecessária). 3 levados pra pré-aprovação por `scripts/pre-aprovar-completos-2026-09-28.mjs` (replica a
transição do webhook: card 54, nota, Sheets, /registros, status, alerta 🟡); Cristal Celular (card já em 49) só ganhou
o registro; Lb Cell ficou de fora (CNPJ na base AIVA = barrado).

**2) `/api/sdr/fase3-destravada`** (16h BRT) — rede de segurança. A conclusão da Fase 3 mora no
webhook e só roda quando chega mensagem do lojista; se uma regra muda e desbloqueia quem já parou
de falar, ele fica preso pra sempre (foi o corte de 16/09: 6 leads presos até 57 dias). O cron
acha quem já satisfaz os campos e nunca teve `[CAD_ALERTADO]`, cria o CNPJ que faltou no
/registros e avisa uma vez. NÃO finge a conclusão completa — HubSpot/planilha/status seguem sendo
do webhook, com a trava atômica dele.

**3) `/api/sdr/vigia`** (17h BRT, depois de todos) — chama o `?dry` de cada rota e grita quando
`HTTP != 200` ou quando a fila está cheia e a ação é zero além da tolerância DA ROTA
(cobrança 3 · biometria 6 · senha 8 · retomada 9; espelho e fase3 nunca gritam por silêncio,
porque fila 0 é o estado saudável deles). ⚠️ A tolerância por rota não é detalhe: com limite único
de 3 dias o vigia daria alarme falso na biometria e na senha já na primeira semana — e alarme
falso ensina o time a ignorar alerta. Contador de dias seguidos em `sdr_avisos_chave`
(chave `vigia:<rota>:<n>`); avisa no dia em que bate o limite, não todo dia depois.

⚠️ **Alarme falso da biometria (24/09):** "5 na fila e nenhuma ação há 6 dias" com a rota funcionando (iniciou
lojas em 16, 17, 18, 22 e 24/09). Duas leituras erradas no vigia: (1) a fila contava quem a régua corretamente não
toca mais — `nada.esgotado/optout/pausa/cnpj_irregular` agora saem da conta (`semTerminais`); esgotado nunca volta a
gerar ação, então o alarme nunca pararia; (2) o vigia roda 17h, DEPOIS das rodadas do dia, e o `?dry` só vê o que
sobrou — biometria e cobrança passaram a devolver `tocados_hoje` (carimbo do último toque desde a meia-noite BRT),
somado como ação. ⚠️ `nada.toque_hoje` NÃO serve pra isso: quem levou o 1º toque hoje aparece como `aguardando D+2`.

Existe porque em 17/09 uma varredura achou 4 defeitos em produção e **nenhum** havia aparecido
sozinho: o `pending` marcando loja boa como CNPJ irregular, o `desmarcar()` que nunca removeu nada
e reportava sucesso, a cobrança saindo um dia atrasada e o alerta de senha repetindo todo dia.

## Tags CRM Evo Talks (IDs numéricos)

- **AIVA** = id **69** → aplicada em toda nova oportunidade criada pelo webhook
- **IMPORTANTE** = id **74** → aplicada automaticamente quando detecta `numero_lojas >= 3`
- Centralizadas em `lib/evotalks.ts` → `export const TAG_IDS`
- Endpoint `/int/updateOpportunity` espera `tags: number[]` (IDs, não strings)

## Espelho Portal AIVA → Evo (Fase 1 do fluxo novo — ligado 16/09/2026)

Cron `/api/sdr/espelho-portal` a cada 15 min AVANÇA o card no funil 15 pela etapa real do
portal: dados_varejo/biometria → 50 · cadastro_finalizado → 70 · senha enviada
(login_sends) → 71 · venda (retailer_performance) → 51. Só avança; não toca 69/93/94 nem
status terminais; destino ≥ 70 passa por 70 (HSM 69) e nunca por 50. Reprovado (not_approved)
→ card pra **95 "Loja Descartada pela Aiva"** (criada pelo Aldo 16/09, sem automação) + lead
NAO_QUALIFICADO + `[PORTAL_REPROVADO]` + aviso único a Nei/Aldo; se o lead voltar a falar, o
webhook 4c avisa (1×/24h). Exceção: card em 51 ou registro com RID/ativa (loja operando, ex.:
Vandertech RID 5819 reprovado no portal) → não move, marca `[PORTAL_REPROVADO_CONFERIR]` e avisa 1×. Registro `informada` com CNPJ no portal vira `pre_cadastro_enviado` sozinho.
⚠️ Etapa 50 tem `requiredforms:[10]` e `cancreate:0`: card sem o form "Qualificação Varejo"
NÃO entra na 50 (o move devolve 200 e não grava) — lição da importação dos 82 em 16/09.
Mover pela API DISPARA a automação do Evo (provado 11/09 no webhook_debug) — o espelho NÃO
chama /opportunity-stage nem fala com o lojista. Regras puras em `lib/espelho-portal-calc.ts`
(`npm run test:espelho`); IO em `lib/espelho-portal.ts`; spec em
`docs/superpowers/specs/2026-09-16-espelho-portal-evo-design.md`. `?dry=1` mostra o que faria.
Primeira rodada real (dry de 16/09): 20× 49→50, 19× 70→71, 3× 50→70, 16 reprovados.

**Etapa 51 = LOJA OPERANDO, não "loja que já vendeu" (Aldo 28/09/2026).** O espelho leva pra 51 quem **vendeu OU
já consultou** crédito (antes só venda). Nas ações em massa de 11/09 (Treinar→51) e 21/09 (Login→51, senha já
enviada) o Aldo adotou 51 = loja pronta pra vender — por isso **~114 leads em 51 não têm venda e ESTÃO CERTOS** (loja
criada + senha; ficam na consultoria de vendas). Quem mede venda de verdade: Jornada ("Vendendo" = venda nos últimos
2 meses) e Campanhas ("Já vendeu", `aiva_desempenho`). Não confunda os dois números nem "corrija" os 114 pra Login.
**Arrumar card pra trás sem mensagem:** os handlers de 50 (link de cadastro) e 70 (HSM 69 + kit) NÃO têm trava de
repetição. Grave `[MOVE_SILENCIOSO:<etapa>:<ISO>]` no lead e mova o card em até 30 min — o `/opportunity-stage` só
atualiza o status (sem alerta, sem HSM). Molde: `scripts/arrumar-51-sem-operar-2026-09-28.mjs` (18 cards em 28/09:
4→50 cadastro aberto, 14→70 sem senha; 0 mensagens). ⚠️ A automação do Evo chama `sdr-agente.vercel.app` — é o mesmo
projeto do `sdr-aiva.vercel.app`, mas confirme o deploy nos DOIS antes de mover.

**Cobrança do formulário do varejo** (passo 3, ligado 16/09): cron `/api/sdr/cobranca-formulario`
13h BRT seg–sex — lead EM_ANALISE_AIVA cujo portal está em `dados_varejo` recebe HSM 48 em
D+1/D+3/D+7/D+14 a partir de `[COBRANCA_FORM_INICIO]`; 4 toques sem resultado → aviso único ao
time ([COBRANCA_FORM_ESGOTADO]), sem fila humana. Não cobra com conversa viva (msg do lead <48h),
[PAUSA_ATE], [COBRANCA_FORM_OPTOUT], importados sem WhatsApp. Textos em
`lib/cobranca-formulario-calc.ts` (`npm run test:cobranca`). SUBSTITUIU o `followup-fase`
(apagado). ⚠️ A escada conta **virada de dia civil (BRT)**, não múltiplo de 24h — corrigido em
17/09: o cron roda em hora fixa (13h) e os INICIO carimbados 14h35 nunca fechavam as 24h, o que
empurrava a régua inteira pra D+2/D+4/D+8/D+15. A VictorIA reenvia o link do onboarding na FASE 4 quando o lojista pede (lib/claude.ts).

**Biometria automática** (passo 4, ligado 16/09): cron `/api/sdr/biometria` de hora em hora
9h–18h BRT seg–sex — lead EM_ANALISE_AIVA cujo portal está em `biometria` recebe o
`onboardings.liveness_url` (só no banco do portal, via login) pelo HSM 48 na hora (toque 1),
D+2 e D+5; depois aviso único ao time ([BIOMETRIA_ESGOTADO]). Grava `liveness_sends` no portal
(mesma tabela que o painel do Nei) e `[BIOMETRIA_LINK:url]` no lead — a FASE 4 (lib/claude.ts)
usa esse link na conversa e para de cobrar formulário. Regras/textos em `lib/biometria-calc.ts`
(`npm run test:biometria`).

**Turmas de treinamento — agenda dinâmica (16/09/2026):** a AIVA republicou a agenda no portal
(`training_sessions`): até 17/09 seg/qui com dois links; **a partir de 21/09 seg/qua/sex 9h30 com
link único `vou-gpmy-rtp`**. Dias e links NÃO ficam mais fixos em lugar nenhum: `lib/turmas-treinamento.ts`
(`proximasTurmas`, cache 1h, fallback = última agenda conhecida em REGRA_FALLBACK) alimenta o HSM 69,
o kit, o reforço do webhook, o check de treinamento (que agora roda todo dia útil 14h e só age em
dia com turma — `houveTurmaHoje`) e o bloco dinâmico do prompt (`blocoTurmasPrompt`, fora do cache).
Parte pura em `lib/turmas-treinamento-calc.ts` (`npm run test:turmas`). Se a AIVA mudar a agenda
no portal, a VictorIA pega sozinha em ≤1h; se mudar "de boca" sem atualizar o portal, não.
**Inscritos** (`training_bookings` via `inscricoesPorCnpj`): quem tem turma MARCADA não recebe
"já fez o treinamento?" — recebe UMA vez o lembrete com data e link ([CHECK_TREINAMENTO_INSCRITO:
startsAt]) e nunca consome toque; quem passou por uma turma nos últimos 14 dias recebe a pergunta
daquela turma específica. Corrige o caso de 14/09 (12 lojas cobradas estando inscritas).
A correção antiga da curadoria (5a841292) foi reescrita pra apontar pro bloco.

**Senha do sócio pendente na AIVA** (passo 6, ligado 16/09): cron `/api/sdr/senha-pendente`
11h BRT seg–sex — lê `login_sends` (pedido feito, `credentials_sent_at` nulo), cruza por RID/CNPJ
com o lead e, passados 2 dias ÚTEIS, avisa Nei+Aldo (reaviso a cada 7 dias); marca
`[SENHA_PENDENTE_DESDE]`/`[SENHA_PENDENTE_AVISO]` e limpa quando a senha sai. Em 16/09 eram
25 lojas, a mais antiga de 19/08 (20 dias úteis). A VictorIA ganha bloco próprio nas fases
pós-cadastro: NÃO manda procurar spam do SMS nem a mensagem do 4020-2024 (não existe), não
repete "2 dias", aciona com motivo `acesso_flexfone_nao_chegou` e acredita no lojista se ele
disser que já recebeu. ⚠️ Vale só pro acesso do SÓCIO — senha de VENDEDOR (SMS/Live Chat) segue
com a regra 📵 do spam. Textos fixos (HSM 69, kit) trocam o parágrafo de acesso quando pendente.
Regras puras: `lib/senha-pendente-calc.ts` (`npm run test:senha`). Revisado (10 achados aplicados).
⚠️ Loja do portal que NÃO casa com lead nosso também entra no alerta, mas a memória do aviso vai
pra **`sdr_avisos_chave`** (chave `senha_pendente:<rid>`, apagada quando a senha sai): sem lead não
há observacoes pra marcar e ela voltava no digest todo dia útil (RID 6413, achado de 17/09).

**`stage` do portal mente — leia junto com `biometry_status` (18/09/2026):** a LT CELL IMPORTS mandou o print
do "Tudo certo" e continuava em Em Análise. O portal tem `stage: biometria` + `biometry_status: aprovado` +
`retailer_id: null` — ela fez TUDO e quem está devendo é a AIVA, que não criou o ID da loja. Pelo stage sozinho
o sistema tratava como biometria pendente: o cron mandaria o link de novo em D+2 e a VictorIA diria que falta
fazer. `situacaoOnb(stage, biometry_status)` em `lib/espelho-portal-calc.ts` (`npm run test:espelho`) resolve os
4 estados: `dados_varejo` · `biometria` · `biometria_negada` (selfie reprovada — refazer só a selfie, motivo
`biometria_refeita`, nunca `cadastro_caf_confirmado`) · `aguardando_aiva`. Neste último a VictorIA não cobra
NADA dele, não fala de senha nem de "24h", e qualquer pergunta vira `acionar_humano` com motivo
`aiva_nao_criou_loja`. `listarBiometriaPendenteApi()` filtra `aprovado` e o espelho avisa o time (1×/CNPJ,
`sdr_avisos_chave` chave `aiva_sem_criar:<cnpj>`) quando passa de 24h. Distribuição em 18/09: 260 dados_varejo ·
15 biometria pendente · 2 aguardando a AIVA · 1 selfie negada · 205 lojas criadas.

**Endereço ANTIGO `https://vendas.aivapay.com.br/login`** (Aldo 28/09): ainda abre, mas vai ser desativado — e a
própria AIVA ainda manda esse link no canal 4020-2024 (caso Rosimar/Alves Imports, 28/09: a VictorIA chamou a mensagem
oficial de "auto-reply" e ignorou). Regra no prompt: não é golpe nem auto-reply; responder que o login agora é no
Flexfone. Exceção registrada na regra "a AIVA não tem site" (esse endereço EXISTE). Outros domínios aivapay seguem válidos.

**🚫 Desde 13/10/2026 SÓ o vendas.flexfone.com.br (comunicado oficial Flexfone, Nei 13/10):** vendas E atendimento (a
Central) exclusivamente por https://vendas.flexfone.com.br; os demais sites de vendas foram INATIVADOS, inclusive o
vendas.aivapay.com.br/login. No prompt (ACESSO À PLATAFORMA, regra "site da AIVA", clientes antigos) a VictorIA informa isso
se perguntarem por outro site e PODE citar 13/10. Endereços aivapay do CLIENTE FINAL (termo, atendimento@, clientes.aivapay) e o
operadores.flexfone (atualização cadastral) seguem valendo. Revisor: 1 achado aplicado; curadoria conferida (só cliente final).

**Login da AIVA = SEMPRE https://vendas.flexfone.com.br/login (Aldo 28/09/2026):** sócio E vendedores, clientes novos
e antigos — único endereço. Está no prompt (ACESSO À PLATAFORMA, liberação de logins, links oficiais/úteis, exceção na
regra "site da AIVA", frases-modelo do Live Chat), nos blocos TREINAR/LOGIN/ACESSOS de `lib/claude.ts` e nos textos fixos
de `lib/text.ts` (kit e aviso de treinamento). Os trechos "cliente antigo no sistema AIVA de sempre / sem Flexfone" saíram;
a liberação da Odres pra antigos segue a regra de 17/09. ⚠️ A VictorIA NÃO cita data da mudança nem afirma que a senha
antiga funciona (ela repetia "é só entrar com seu usuário e senha de sempre" — a gente não sabe). Sem acesso ainda
(cadastro aberto, AIVA não criou a loja, senha não saiu) → não manda o link. ⚠️ A variável do **HSM 69 NÃO ganhou o
link** de propósito: o limite de tamanho do template na Meta não foi conferido e, se estourar, a loja nova fica sem o
HSM; o kit que vai logo em seguida já leva o endereço.

**Duas senhas, dois painéis — perguntar antes de agir (Aldo 18/09/2026):** o lojista diz só "não recebi a
senha" e reclama das DUAS. **Painel de VENDAS** (Flexfone/AIVA): login do sócio por WhatsApp do 4020-2024 — é o
único que a gente reenvia. **Painel de REPASSES**: o acesso chega por **e-mail (Gmail)** e **nós nunca enviamos
senha de repasse** — o caminho é a seção REPASSE DE VENDA (CNPJ matriz + Gmail, o sistema lança) e procurar no
e-mail/spam. Seção própria no prompt ("🔀 DOIS PAINÉIS, DUAS SENHAS") + linha nos blocos TREINAR/LOGIN.
⛔ `reenviar_senha_painel` (que dispara reenvio REAL) só depois de saber que é o de VENDAS. A pergunta é só
quando a mensagem não indicar: "não consigo entrar pra vender" já é VENDAS e perguntar de novo vira repetição.
⚠️ Revisor: as passagens que mandavam "acesso → chat DENTRO da plataforma" (SUPORTE PÓS-VENDA e FASE 5) foram
ressalvadas — quem nunca recebeu senha não consegue abrir esse chat; era resposta circular.

**Reenvio de senha AUTOMÁTICO (Mauricio liberou o endpoint em 18/09, no mesmo dia do pedido):**
`POST /api/public/partner/onboardings/resend-password` (`retailer_ids`, opcionais `phone`/`name`) faz a mesma
coisa que o botão "Reenviar senha" do painel. `reenviarSenhaApi()` em `lib/portal-aiva.ts`. ⚠️ **HTTP 200 não
quer dizer que reenviou** — o resultado é por cadastro em `results[].success`; cadastro sem histórico devolve
"reenvio de senha indisponível" (o próprio endpoint confirma a distinção que fazemos por `credentials_sent_at`).
No webhook, o motivo `reenviar_senha_painel` **deixou de ser fila humana**: o sistema chama a API, marca
`[SENHA_REENVIADA:ISO]`, zera `acionar_humano`, manda UMA confirmação ao lojista e avisa o time como informação.
Travas: prefixo exato do motivo + status pós-cadastro (a separação sócio × vendedor vivia só no prompt — com
`includes` solto, um pedido de senha de VENDEDOR reenviaria a do sócio), exige `[SENHA_ENVIADA]`, 1 por lead a
cada 24h, e telefone/nome são os do cadastro DA AIVA (não somos nós que escolhemos pra onde a senha vai).
A VictorIA recebe `[SENHA_REENVIADA]` no prompt pra não reprometer quando ele volta dizendo que não chegou —
aí o motivo é `senha_reenviada_nao_chegou`. As outras escritas liberadas pela chave continuam sendo
remover/restaurar cadastro (**nunca usadas**).

**⚠️ O reenvio disparou no papo errado (YourCase Avenida, 18/09 21h24) — trava de assunto:** o lojista
perguntou de **campanha de bônus**, a VictorIA ofereceu confirmar com o time, ele respondeu *"isso, pode
verificar"* — e ela respondeu sobre SENHA e emitiu `reenviar_senha_painel`. O reenvio saiu de verdade. Duas
lições: (1) motivo emitido pelo modelo com consequência REAL precisa de trava no CÓDIGO, não só no prompt;
(2) a AIVA envia pro telefone do **cadastro dela** (ali, +5542999020383) que pode não ser o WhatsApp da
conversa (554288258679) — então mesmo o reenvio "bem-sucedido" não chega, e o lojista diz com razão que não
recebeu. Agora: o webhook só chama a API se o assunto senha/acesso estiver aberto na JANELA (últimas 4
mensagens + a atual) — não só na última fala dele, porque o turno legítimo costuma ser "procurei e não achei",
que não tem a palavra senha (achado do revisor: a primeira versão do gate bloquearia o caminho feliz). Fora de
contexto: não reenvia, avisa Nei+Aldo com a frase do lojista. No prompt, o bloco `[SENHA_ENVIADA]` passou a
exigir **assunto aberto** (dele ou de uma oferta SUA sobre senha) e a não prometer que chega "no seu WhatsApp".

**A senha vai pro telefone do CADASTRO da AIVA — e agora ela avisa (Aldo 19/09/2026):** o reenvio usa sempre
`phone_number`/nome do cadastro da AIVA, não o WhatsApp da conversa (YourCase: cadastro 5542999020383 "Diego"
× conversa 554288258679 "Bruno" — a senha saiu e ele continuou esperando). `telefonePorRetailer()` em
`lib/portal-aiva.ts` (cache de 15 min, roda dentro do turno) compara os dois; quando diferem, a confirmação ao
lojista já diz pra qual número foi (só o **final**, com o primeiro nome do cadastro) e oferece atualizar o
cadastro; o aviso ao time traz os dois números completos. Se ele disser que não tem acesso àquele número:
a VictorIA manda o link de atualização cadastral (abaixo, 30/09) e só aciona `telefone_cadastro_diferente` se ele não
conseguir por lá. Ela não troca número nem manda senha por outro caminho. ⚠️ Prova de que o reenvio automático funciona: a tabela
`password_resends` do portal registra a linha com `sent_by: null` (as do painel têm o UUID de quem clicou) —
é assim que se audita o que foi da VictorIA e o que foi do Nei.

**Senha de VENDEDOR/GERENTE que não veio ≠ reenvio (L. A CELL, 21/09/2026):** a gerente Dayane pediu o
próprio usuário pelo Live Chat em 31/08 (o caminho certo, a VictorIA orientou bem) e a AIVA nunca mandou o SMS.
Por 3 semanas a VictorIA repetiu "já cobrei o time, te dou uma posição hoje" (a frase-modelo ✅ da FASE 5 dizia
"o Nei te retorna") e o time "resolveu" em 08/09 reenviando a senha do SÓCIO (Clóvis) — que não cria usuário
nenhum. Três correções: (1) prompt — 4ª exceção na FASE 5 + fecho nos blocos 📵 de TREINAR/LOGIN/FASE 5: NUNCA
prometer retorno/posição; dizer que o pedido está com a AIVA, sem data; promessa própria no histórico NÃO vale;
(2) código — o gate do reenvio automático bloqueia quando a janela fala de vendedor/gerente/funcionário/"meu
usuário" e avisa o time que reenviar a do sócio não resolve; (3) `/excecoes` ganhou a seção "👤 Usuário de
vendedor/gerente pedido e a senha não veio" (marcador `[SENHA_USUARIO_NAO_CHEGOU:ISO|detalhe]`, gravado 1× quando
o motivo `senha_usuario_nao_chegou` é emitido) — porque lead já na fila humana re-aciona em silêncio e ninguém
via. ⚠️ Não temos visibilidade de usuários de equipe no portal (`login_sends` é só do sócio): cobrar a AIVA é
manual, e é por isso que a tela existe.

**Catálogo, preços e lista de aparelhos da plataforma NÃO são nossos (HCELL, 18/09 → regra 21/09/2026):** o
lojista disse que os preços do sistema estavam acima dos dele e queria tirar modelos; a VictorIA mandou certo
pro Live Chat, o chat silenciou ("vou verificar se tenho um analista") e ela improvisou: perguntou as marcas, disse
"registrei pro time técnico ajustar catálogo e preços" e "eles vão te retornar". Aldo: **ninguém da Track altera
preço nem lista; a única referência é a lista de aparelhos do Drive.** Correções: quinta exceção na seção LIMITES,
bloco 🗂️ no item 1️⃣ da FASE 5 (±15% no preço DA VENDA o lojista faz no carrinho; tabela/modelos = só Live Chat;
Live Chat mudo → horário seg–sex 9h–18h, e só depois de 2 dias úteis sem resposta `livechat_aiva_sem_resposta`),
escopo na TABELA DE PREÇOS (é faixa de financiamento, não catálogo), e no webhook `configCatalogo` tira essas
frases do print "pro time ver" e do chamado — senão o código registrava pro Nei exatamente o pedido que o prompt
proíbe. A frase-modelo genérica do item 2 ("encaminho pra te dar o retorno") também deixou de prometer retorno.

**Pede senha sem ter concluído o cadastro (Aldo 18/09/2026):** o espelho marca `[ONB_ETAPA:stage:ISO]`
(`dados_varejo` | `biometria`) enquanto o onboarding do lojista está aberto no portal, e a VictorIA ganha um
bloco que **vence os dois de senha** (precedência: cadastro aberto > senha pendente > senha enviada): antes do
cadastro fechar não existe ID de loja, logo não existe senha nenhuma pra enviar ou reenviar. Em `dados_varejo`
ela manda https://retail-onboarding-hub.vercel.app/ **sem ele pedir** (exceção registrada nos 4 pontos do prompt
que dizem "nunca proativamente"); em `biometria` manda só o link da biometria e nunca o do onboarding.
É a mensagem que o Nei manda na mão hoje. ⛔ NÃO marca quem já opera — `[IMPORTADO_PORTAL:]` (o lote de 16/09
está em `dados_varejo` no portal e vende há meses) nem lead com registro `rid`/`ativa` (matriz vendendo +
filial nova em cadastro): o marcador é do LEAD e a etapa é do CNPJ. O bloco não vale em
LOJA_FINALIZADA_E_VENDENDO e não toca em senha de VENDEDOR (regra 📵 do SMS segue).

**Senha JÁ ENVIADA — "não recebi" que vira reenvio (Aldo 18/09/2026):** o mesmo cron
`/api/sdr/senha-pendente` agora marca `[SENHA_ENVIADA:ISO]` em quem tem `login_sends.credentials_sent_at`
preenchido (`listarSenhasEnviadas`, por retailer_id). A VictorIA ganha o bloco espelho do de senha pendente:
aí SIM manda procurar a mensagem do +55 21 4020-2024 e, se ele não achar, aciona com
`motivo_humano = "reenviar_senha_painel"` pro time apertar **Reenviar senha** no card do painel da AIVA —
ela NUNCA reenvia senha (a API pública da AIVA só escreve remove/restore; não há endpoint de reenvio).
⚠️ **O botão "Reenviar senha" aparecer no card NÃO prova que a senha saiu** (BUSSIS STORE, RID 5126: botão
presente, `credentials_sent_at` nulo desde 27/08) — quem decide é o campo, e era por isso que a checagem
"tem o botão?" que o Aldo imaginou não funcionaria sozinha. Em 18/09: 140 registros, 114 enviados, 26 pendentes.
⚠️ Os dois marcadores podem coexistir (login_sends é por store_id: matriz enviada + filial pendente): o cron
NÃO limpa `[SENHA_PENDENTE_*]` ao marcar enviada, e em `lib/claude.ts` **pendente vence** — o lado conservador,
que não manda ninguém procurar mensagem que talvez não exista. Marcador órfão (portal deixou de reportar o
envio) é apagado na rodada seguinte.

**Filial nova vira linha na planilha sozinha (Aldo 18/09/2026):** quando um CNPJ novo aparece na conversa
(bloco LOJA NOVA do webhook), além do registro em `sdr_registros_cnpj` o sistema monta a linha no **modelo
padrão do Mauricio** (15 colunas, `COLUNAS_FILIAL_AIVA` em `lib/filiais-aiva.ts`, `npm run test:filiais`) e
acrescenta na aba **Filiais** da planilha AIVA APROVAÇÃO via Apps Script (`acao: 'filial'`, grava como TEXTO
senão o CPF perde o zero à esquerda). **O endereço (CEP, logradouro, número, complemento, bairro) vem da
Receita pelo CNPJ da filial** — o modelo exige e a gente não coleta isso no chat.
⚠️ **CPF do operador sai VAZIO**: o fluxo não pede CPF em fase nenhuma. É o único campo manual, e a pendência
vai no alerta do Nei. Se um dia a VictorIA for perguntar, é só passar `cpf` em `montarLinhaFilial`.
Idempotente por `[FILIAL_AIVA:<cnpj>]` no lead. ✅ **Apps Script reimplantado em 18/09/2026 (versão 15)** com a ação `filial`, testado ponta a ponta (linha de
teste criada e apagada). ⚠️ O projeto é **standalone** — "AIVA Docs Cadastro Manual" em script.google.com, NÃO
é script preso à planilha (o bound é outro: "upsert por ID CRM"). Por isso usa `SpreadsheetApp.openById`.
O código lá **já divergiu** de `docs/apps-script-manual-docs.gs` (editado direto no editor): edite só o bloco
necessário, nunca cole o arquivo inteiro por cima. Reimplantar = Implantar → Gerenciar implantações → lápis →
Nova versão → Implantar (mantém a MESMA URL; criar implantação nova troca a URL e quebra a env).
Modelo, mapeamento do controle antigo e as filiais já lançadas: `docs/controle_filiais_padrao_AIVA.xlsx`.

**Tela de Exceções** (passo 7, 16/09): `/excecoes` no painel (sidebar 🚨) — só o que as
automações da Fase 1 NÃO resolveram: senha pendente ([SENHA_PENDENTE_DESDE], com dias úteis),
biometria não concluída ([BIOMETRIA_ESGOTADO]), formulário sem resposta ([COBRANCA_FORM_ESGOTADO]),
treinamento sem resposta ([CHECK_TREINAMENTO_ESGOTADO]), reprovado que opera
([PORTAL_REPROVADO_CONFERIR]) e travado que voltou a falar ([RETORNO_CNPJ_ALERTA]). Cada seção diz
o que é e o que fazer. Lê SÓ marcadores de sdr_leads — nada de portal no render (abre rápido e não
quebra se a AIVA estiver fora). Clicar na linha abre o LeadDrawer.

**Fase 1 — próximos passos combinados (16/09):** ~~2) trava de reprovado~~ (feito, etapa 95)
· ~~3) cobrança do formulário pendente~~ (feito) · ~~4) biometria automática~~ (feito) · ~~5) check de treinamento com inscritos + Meet~~ (feito
16/09; falta só a AIVA confirmar na reunião se lê inscrição feita pelo parceiro — Q11) ·
~~6) alerta de senha pendente~~ (feito) · ~~7) tela de exceções~~ (feito) — **Fase 1 COMPLETA**
com `onboardings.liveness_url` · 5) check de treinamento lendo `training_bookings` + link da
turma (`lib/turmas-treinamento`) · 6) alerta de senha pendente
(`login_sends.credentials_sent_at` null) · 7) tela de exceções no painel.
Pré-cadastro continua manual (Google Forms exige login) — pergunta 17 da reunião com a AIVA.

## 🩻 Raio-x do funil e 3 ações (Aldo, 02/10/2026)

`docs/Raio-X-funil-AIVA-2026-10-02.xlsx` (resumo por etapa + 8 abas de ação). Achados: formulário da AIVA travando
(tela branca / não passa da 3ª página — 9 lojas, 7 na semana); Em Análise com 43 leads DESCARTADOS ainda no card, 70
importados parados (47 com telefone 000), 32 com cobrança esgotada; Cadastro Recebido com 17 CNPJs fora do portal; Treinar
com 22 senhas que a AIVA não mandou; 41 lojas com senha e zero consulta. Retomada rende 3,5–3,9% de avanço por envio
(disparo frio ~1,5%). ⚠️ O `stagebegintime` do card do Evo NÃO serve pra medir tempo na etapa (deu 30+ dias em tudo).
Feito (Aldo aprovou A, C, D):
- **A)** 7 cards Treinar → Em Análise (cadastro ainda aberto no portal), sem mensagem — `scripts/voltar-70-para-50-2026-10-02.mjs`
  (MOVE_SILENCIOSO:50, marcador `[VOLTOU_70_50]`; lead DESCARTADO fica de fora).
- **C)** Importados do portal que continuam em EM_ANALISE_AIVA NÃO operam (quem consulta/vende o espelho já levou pra 51):
  entram na cobrança do formulário e na biometria automática (só sai telefone 000), o espelho passa a marcar
  `[ONB_ETAPA]` neles, e o bloco especial "cliente que já opera" da VictorIA (lib/claude.ts) foi REMOVIDO — seguem a FASE 4.
- **D)** Retomada: AGUARDANDO 60 → **120**/dia (batia o teto todo dia) e INTERESSADO 150 → **200** (não usava os 150:
  falta elegível, não orçamento). 320 cabem nas 7 rodadas.

## 📮 CANAIS OFICIAIS DE SOLICITAÇÃO DA AIVA (AIVA, 01/10/2026) — os antigos foram desativados

O LOJISTA preenche; a VictorIA só manda o link (seção "📮 CANAIS OFICIAIS" no topo dos assuntos pós-venda de `prompts/aiva.ts`):
| pedido | link |
|---|---|
| problema num repasse já feito | https://forms.gle/RJSwhWkN7CQ5naq17 (é o mesmo form que já usávamos pra contestar) |
| acesso ao painel financeiro (ex-painel de repasses) | https://docs.google.com/forms/d/e/1FAIpQLSf3vvEgnb8fWXKYloRhh8jL7DxnPQIrbBkU8zNBO3L6_oa4Jw/viewform |
| login de operadores (vendedor/gerente/financeiro: novo, inativar, cargo, loja, reset) | https://forms.gle/izjwzRDXzYWDvtEt6 |
| sócio redefine senha / dados do login | https://operadores.flexfone.com.br/atualizacao-cadastral (substitui o operadores.ume) |
| dados bancários | https://forms.gle/k5hHPAKiVQpmumjWA (pede login Google) |
| alterações cadastrais da empresa (inclui troca de CNPJ) | https://forms.gle/GkmyfeDghnzxbxm89 (pede login Google) |
| credenciamento de filial | https://forms.gle/AyWzxY2bqktyz61v6 (pede login Google) |
Decisões do Aldo: **painel financeiro = lojista preenche** (o form novo pede CPF do sócio, nome, função, telefone — a VictorIA
não coleta mais CNPJ+Gmail; a captura do webhook foi DESLIGADA com `REPASSE_AUTO_ATIVO = false`, e o marcador
`[CAMPANHA_PAINEL_REPASSES` deixou de calar a captura de LOJA NOVA nos 183 leads da campanha de 03/09); **filial = lojista
preenche** (a VictorIA ainda pega o CNPJ pro time acompanhar; a linha da planilha Filiais segue como registro; o form de filial
só vale com a loja principal já criada — em CADASTRO_RECEBIDO/EM_ANALISE só pega o CNPJ). Os formulários valem só pra loja
JÁ CRIADA (TREINAR em diante, inclusive importados do portal). O "Cadastrar/Remover Usuário" do Live Chat e o e-mail
atendimentoaovarejo@ume.com.br saíram de tudo (prompt, blocos de fase, kit em lib/text.ts, texto da etapa 70 em
opportunity-stage, alertas). Live Chat continua pra uso/erro/trava/catálogo. Senha de operador: spam do SMS → reset no
form → `senha_usuario_nao_chegou`; ⛔ sem citar prazo (a curadoria tinha "48h úteis" — 2 correções reescritas no banco).
Revisor: 14 achados aplicados. ✅ Fora da VictorIA (01/10): o "Lançar manual" de colaborador do `/registros` abre o form novo de Login de operadores
pré-preenchido (`linkColaboradorPreenchido`), e `/excecoes`/senha-pendente/espelho mandam cobrar a AIVA (Mauricio/Edu), não o Live Chat.
O form antigo de colaborador (lib/colaborador-form.ts) já dava 410 antes desta mudança.

## ✏️ Link de ATUALIZAÇÃO CADASTRAL da AIVA (Mauricio, 30/09/2026)

https://operadores.ume.com.br/atualizacao-cadastral — a própria loja com cadastro JÁ REALIZADO atualiza e-mail, senha,
telefone e outros dados. Seção "✏️ ATUALIZAÇÃO CADASTRAL DA LOJA" em `prompts/aiva.ts` + mapa de canais, lista de links
oficiais, tabela LINKS ÚTEIS, situação A (plataforma), blocos LOGIN e VENDENDO e bloco `[SENHA_ENVIADA]` de `lib/claude.ts`
(telefone do cadastro de outra pessoa → link; `telefone_cadastro_diferente` só se não conseguir). A confirmação automática do
reenvio de senha (webhook) também oferece o link. ⛔ NÃO vale pra loja ainda não criada (até EM_ANALISE_AIVA → humano
`corrigir_dado_cadastro`), senha que a AIVA ainda não enviou, usuário de VENDEDOR (Live Chat), conta bancária (e-mail) e
Gmail do painel de REPASSES. Revisor (7 achados aplicados) — junto entraram: regra UME ganhou a mesma EXCEÇÃO ABSOLUTA da Odres
(credenciado nunca vira UME — o domínio ume.com.br agora aparece pra cliente nosso) e o "NUNCA mencionar UME" virou
"proativamente". ✅ Confirmado pelo Mauricio (30/09, Nei testou): o link NÃO pede código no telefone antigo — quem trocou de número resolve sozinho; o humano (`telefone_cadastro_diferente`) fica só como rede de segurança. O simulador
(`/api/chat`) passou a aceitar TREINAR, LOGIN e LOJA_FINALIZADA_E_VENDENDO.

## Prospect que diz "já trabalho com a AIVA" ≠ cliente nosso (Aldo 29/09/2026)

Lojista do disparo frio respondia "já trabalhamos com a AIVA" e a VictorIA aplicava a regra de cliente DA TRACK:
perguntava da experiência, oferecia liberação de login e acionava o Nei (`lead ja eh cliente aiva`) — 17 casos,
descartados na mão. É cliente da AIVA por OUTRO canal. Agora (bloco 🚦 no topo da "REGRA CRÍTICA — LEAD JÁ É CLIENTE
AIVA" em `prompts/aiva.ts`): status INICIO/SEM_RESPOSTA/INTERESSADO/AGUARDANDO fora da Fase 3 → pede o CNPJ uma vez
(a base `aiva_base_cnpjs` é conferida no mesmo turno e, se achar, entra a mensagem oficial UME/ODRES) e encerra
**NAO_QUALIFICADO** com `motivo_humano = "ja_cliente_aiva_outro_canal"`, `acionar_humano = false`. Quem já deu o CNPJ na
Fase 1 é encerrado direto (lembrete dinâmico no bloco de Fase 1 de `lib/claude.ts` — só o prompt não bastou, o modelo
pedia o CNPJ de novo). No webhook esse motivo pula a Receita (CNPJ inválido acionaria humano) e vira nota legível no card.
Cliente nosso = PRE_APROVACAO em diante ou Fase 3 → regra antiga. ⚠️ CNPJ válido que NÃO está na base também encerra
(decisão: ele disse que já usa a AIVA). Recusou o CNPJ e mandou depois → NAO_QUALIFICADO está em STATUS_IGNORAR, não confere.

## Cliente barrado (funil 19) que volta a escrever NÃO vira lead novo (Diniz Imports, 21/09/2026)

O sync apaga o lead quando o card vai pro funil 19 (decisão 29/05 — o 19 é manual e não deve poluir o SDR).
Efeito colateral: quando o lojista escrevia de novo, o telefone era "desconhecido" → o webhook criava lead + opp
NOVOS no funil 15 → a VictorIA recomeçava do zero (nome, CNPJ), barrava de novo, o sync apagava de novo. A Diniz
Imports (CNPJ 32300755000106, base Odres) passou por isso 3 vezes (#7981, #11230, #21077) e na 4ª, depois de
pedir um humano, ouviu "qual seu nome?" e "vocês já trabalham com a Odres?". Agora `noFunil19()` no webhook
(cache 10 min dos ~500 cards) checa o telefone ANTES de criar lead inbound: se está no 19, não cria nada, responde
1×/24h ("sua loja já é atendida pela Odres, passei sua mensagem pro Nei") e avisa Nei+Aldo com a frase dele
(`sdr_avisos_chave` `funil19_retorno:<tel>`). ⚠️ A conversa "quero sair da Odres e vir pra Track" é comercial e
do Nei — pela regra, cliente da base Odres é barrado; a VictorIA não decide isso.

## Rotinas da etapa Interessado — REMOVIDAS em 10/09/2026 (Aldo)

Nudge (3–24h), reativação 48h (HSM 48), reengajamento personalizado (3× a cada 15d) e
régua-saída (→ etapa 53) foram tirados do código e do vercel.json — o Aldo está limpando
o fluxo antes do redesenho. Sobrou só a régua D+3/D+7/D+14 (`/api/sdr/followup`), pausada.
Marcadores antigos em observacoes ([REATIVACAO_ENVIADA], [REENGAJAMENTO:], [REGUA_SAIDA:])
ficam inertes nos leads legados. `gerarReengajamento` saiu de lib/claude.ts.

---

## Números da loja na conversa + dicas de desempenho (Aldo 02/10/2026)

**1) A VictorIA enxerga os números da loja.** Para lead em LOJA_FINALIZADA_E_VENDENDO o webhook monta o bloco
`[NÚMEROS DA LOJA NO PORTAL DA AIVA]` (`lib/desempenho-loja*.ts`, `npm run test:desempenho`): últimas 4 semanas
fechadas (aprovados · vendas · R$), mês anterior e mês atual (consultas · aprovados · vendas · % dos aprovados),
somando todos os CNPJs do lead (`sdr_registros_cnpj` + `cnpj_matriz`). Bloco dinâmico, fora do cache. Falha na
leitura não cala a VictorIA (segue sem números). O simulador aceita `cnpj_desempenho` pra testar com loja real.
⚠️ **Semana sem linha na `aiva_desempenho_semanal` = semana sem atividade** (a derivação só grava quem
consultou/aprovou/vendeu). Por isso a janela é ancorada na última semana fechada DA TABELA, não na da loja:
senão loja parada há 3 semanas parecia vendendo. Segmentos: `vende_firme` (4+ vendas em 2 semanas) ·
`vende_pouco` · `aprova_nao_vende` · `parou` · `sem_uso`.
⚠️ No simulador ela inventou "sem entrada", valor de parcela, "8x ou 10x" e meta de mercado ("a régua é 50%") ao dar dica — o bloco repete as regras do
produto (SEM exemplo de valor — o exemplo "R$ 89/mês" na própria proibição fazia ela repetir), e o exemplo antigo "8x ou 10x?" do prompt (Munição extra) e o "10x" do Guia de Vendas viraram 9x/12x. Revisor: 7 achados aplicados (FASE 5 "diagnóstico primeiro" aceita o bloco; `sem_uso` pergunta o que travou — 2️⃣b; consulta sem aprovação → OBJEÇÃO Nº1; número fraco no bloco não aciona humano).

**2) Rotina `/api/sdr/dicas-desempenho`** (`lib/dicas-desempenho-calc.ts`): substitui a `/consultoria-vendas`
(4 toques iguais pra todo mundo, resposta 27% → 11%, 104 lojas já tinham terminado a série). 1ª dica 7 dias
depois de entrar na etapa (`[CONSULTORIA_INICIO]`; loja antiga sem a data está liberada), depois **semanal pra
quem vende ou aprova e quinzenal pra quem está parado** (Aldo). Sem fim de série. Texto por segmento com o
número da loja, 3 variações cada, no {{2}} do HSM 48, rótulo `aiva_dicas_desempenho`. Fila: aprova_nao_vende →
vende_pouco → parou → vende_firme → sem_uso; 45 por rodada, teto de 240 s. Não toca: optout
(`[CONSULTORIA_OPTOUT]`/`[DICAS_OPTOUT]`), reprovado, senha pendente/cadastro aberto, `[PAUSA_ATE]`, fila humana,
lojista que falou nas últimas 48h, consultoria antiga há menos de 7 dias. Marcadores `[DICAS_COUNT/ULTIMA/SEG]`.
✅ **LIGADA em 05/10/2026 (Aldo)**: `0 13 * * 1-5` (10h BRT) no lugar da `/consultoria-vendas`, que saiu do vercel.json
(a rota ficou no código, sem agendamento). O `/check-primeira-venda` (terças) e as dicas se respeitam: um pula a loja
que levou o outro há menos de 7–10 dias (`[DICAS_ULTIMA]` × `[CHECK_VENDA_ULTIMA]`). No vigia: tolerância 3 dias, ação =
`tocados_hoje` do `?dry`. **Fila (06/10, Aldo):** loja criada há <30 dias e SEM consulta (`sem_uso` novo) vai na FRENTE de todos — é a janela de
ativação; o `sem_uso` antigo segue por último (`prioridade()` no calc, data de criação = menor `cadastro_em` da `aiva_desempenho`).
Levantamento de 06/10: 70 lojas em LFV nunca consultaram — 29 nem têm loja na AIVA (17 sem CNPJ, 12 com CNPJ fora do portal) e
41 têm loja (28 com senha enviada, 12 delas criadas há <30d). O que elas dizem: acesso não chegou / não sabem usar.
⏭ **Medir em 2 semanas** pelo rótulo `aiva_dicas_desempenho`: resposta de PESSOA por segmento
contra a consultoria antiga (27% no 1º toque → 11% no 4º).

## 🧭 Funil 15 = quadro Onboarding da AIVA, coluna por coluna (Aldo 07/10/2026)

A API de onboardings ganhou (Mauricio, 07/10) **`board_column`** e **`board_column_since`** — a coluna do quadro da
AIVA e desde quando o cadastro está nela (vazio em ~26 antigos). Colunas, em ordem: `not_approved` · `pre_cadastro` ·
`dados_varejo` · `biometria_pendente` · `biometria_aprovada` · `cadastro_finalizado` · `treinamento_agendado`
(automático com turma marcada; VOLTA pra cadastro_finalizado 4h depois da turma) · `pronto_para_operar` (senha enviada
ou marcação manual — vale mais que o treinamento). `stage` continua igual.

| coluna AIVA | etapa Evo | status do lead |
|---|---|---|
| pre_cadastro | (fica em 49 Cadastro Recebido — nosso) | — |
| dados_varejo | **50 Formulário do varejo pendente** (ex-"Em Análise AIVA") | EM_ANALISE_AIVA |
| biometria_pendente | **96 Biometria pendente** (nova, automação 103) | EM_ANALISE_AIVA |
| biometria_aprovada | **97 Biometria aprovada** (nova, automação 104) | EM_ANALISE_AIVA |
| cadastro_finalizado | **70 Cadastro finalizado** (ex-"Treinar") | TREINAR |
| treinamento_agendado | **98 Treinamento agendado** (nova, automação 105) | TREINAR |
| pronto_para_operar | **71 Pronto para operar** (ex-"Login") | LOGIN |
| (consulta/venda) | 51 Loja Finalizada e Vendendo — nossa | LOJA_FINALIZADA_E_VENDENDO |
| not_approved | 95 (trilha de reprovado de sempre) | NAO_QUALIFICADO |

- **Status do lead NÃO mudou** de propósito: crons, VictorIA, prompt e telas seguem lendo EM_ANALISE_AIVA/TREINAR/LOGIN.
  As etapas novas mapeiam pra esses status em `STAGE_TO_STATUS` (lib/evotalks).
- **Espelho** (`etapaDesejada`): venda/consulta → 51; senão `COLUNA_PARA_ETAPA[board_column]`; sem board_column cai na
  dedução antiga (biometria aprovada → 97, pendente/negada → 96). Dentro do **`BLOCO_AIVA` (50/96/97/70/98/71) o card
  SEGUE a coluna também pra trás**; fora dele (51, laterais) só avança. Pulando a 70 pra frente passa por ela (HSM 69).
- **Mensagem de etapa sai uma vez por loja**: o handler da 50 (link do cadastro, `aiva_link_cadastro`) e o da 70 (HSM 69
  + kit, `aiva_treinamento_completo`) checam `sdr_mensagens` e, se já mandaram, só atualizam o status. O aviso de etapa
  ao Nei/Aldo (`[ALERTA_ETAPA:n]`) também ficou 1× por etapa (não limpa mais as outras).
- **Virada silenciosa**: até `VIRADA_SILENCIOSA_ATE` (07/10 18h BRT) e com `?silencioso` todo movimento grava
  `[MOVE_SILENCIOSO:<etapa>]` antes (o handler só atualiza o status; NÃO mexe mais em `acionar_humano`); entrada na 51
  nunca é silenciosa (cria a conta MRR). Rodada da virada: 25 cards (14× 50→96, 10× 70→98, 1× 50→97), 0 mensagens.
- Rótulos novos em: Pipeline (`app/page.tsx`), ficha do lead, assistente, Jornada (`ETAPAS_EVO`, `ORDEM_EVO`,
  `ETAPA_DA_FASE`), briefing do pipeline e descarte (`ETAPAS_AVANCADAS`/`EM_CURSO`). Etapas criadas/renomeadas pela
  API do Evo (MCP omni: `pipeline_stages_create/update`, `automations_create`, `pipelines_update.stageorders`).
- **Aviso ao lojista por etapa** (Aldo 07/10): 97 Biometria aprovada ("biometria aprovada, do seu lado está tudo certo,
  agora é a AIVA criar a loja") e 71 Pronto para operar ("acesso liberado, login pelo +55 21 4020-2024,
  vendas.flexfone.com.br/login, faça a primeira consulta") — `avisarEtapa` em `/opportunity-stage`, HSM 48, uma vez por
  loja (rótulos `aiva_biometria_aprovada` / `aiva_pronto_operar`), pula OPT_OUT/DESCARTADO/NAO_QUALIFICADO/BOT. Resumo do
  que cada etapa manda: 50 link do cadastro + cobrança · 96 link da biometria (cron) · 97 aviso · 70 HSM 69 + kit ·
  98 lembrete da turma (check de treinamento 14h) · 71 aviso.
- **Coluna `primeiro_acesso` + campo `primeiro_acesso_em` (Karol/AIVA, 07/10 tarde):** a AIVA acrescentou a 9ª coluna
  (com cadastro finalizado a prioridade é primeiro_acesso > pronto_para_operar > treinamento_agendado > cadastro_finalizado).
  → **etapa 99 "Primeiro acesso"** no Evo (automação 106, entre 71 e 51, status LOGIN). Card em **51 SEM consulta nem
  venda** passou a seguir a coluna real (as ações em massa de set/2026 punham loja só "pronta" em 51): na virada, 38
  saíram de 51 (21→71, 11→99, 5→70, 1→50) + 2× 71→99, em silêncio, 0 mensagens. 51 agora = consultou ou vendeu, de fato.
  Aviso ao lojista ao entrar em 99 (`aiva_primeiro_acesso`: "vi que você já entrou… consulte o CPF de todo cliente").
- **`/api/sdr/acesso-pendente`** (11h BRT seg–sex, `lib/acesso-pendente-calc.ts`, `npm run test:acesso`): coluna
  `pronto_para_operar` sem `primeiro_acesso_em` há 2+ dias úteis → toque 1 (HSM 48, `aiva_acesso_pendente`), +3 dias →
  toque 2, +2 dias → `[ACESSO_ESGOTADO]` + aviso "🚪 Senha enviada e nunca acessou" no Atendimento (PELO_MARCADOR). Quando
  o acesso aparece, limpa os marcadores e fecha o aviso. Pula fila humana, optout, pausa, conversa viva <48h, bloqueada por
  limite, telefone 000. Dry de 07/10: 41 sem acesso, 30 na fila do toque 1.
- Todas as mensagens de etapa e de cobrança usam o **HSM 48 (coringa "Olá {{1}}, {{2}}")** — o mesmo da cobrança,
  biometria, retomada e dicas. Risco: tudo num modelo só; por isso cada aviso de etapa sai uma vez por loja.
- ⏭ Possível próximo passo: usar `board_column_since` como "parado há" real no painel (o `stagebegintime` do Evo não serve).

## 🚪 Lojista que DESISTE ou "dá um tempo" → DESCARTADO, reabre se voltar (Aldo 08/10/2026)

Caso Cleyton Barbosa Informática: em 09/09, logo após a pré-aprovação, "vamos dar uma seguradinha… futuramente eu entro
em contato". A VictorIA respondeu bem, mas o status ficou e vieram 9 cobranças automáticas em 3 semanas.
- **Prompt** (seção 🚪 em `prompts/aiva.ts` + ressalvas nos blocos de fase de `lib/claude.ts`): decisão de parar/adiar
  por conta própria → despedida curta sem pergunta, `novo_status = "DESCARTADO"`, `motivo_humano = "lojista_desistiu: …"`.
  Vale de INICIO a EM_ANALISE_AIVA. Hesitação ("vou pensar", "me chama semana que vem") segue AGUARDANDO. Loja já criada
  (TREINAR/LOGIN/LFV) nunca é descartada: `loja_quer_parar` + humano (trava também no código).
- **Webhook** (`lib/desistencia.ts`, `npm run test:desistencia`): carimba `[DESISTIU:<status>:<ISO>]` + `[DESCARTADO_MANUAL]`
  (o sync e o /opportunity-stage não revivem; o evo-sync em tempo real do webhook também passou a respeitar o
  descarte manual). Quando ele volta a escrever, reabre no status anterior e avisa Nei/Aldo — exceto aceno
  ("obrigado", 👍), retry/reprocesso e as primeiras 12h depois da despedida. DESCARTADO da IA sem o prefixo vira desistência.
- Revisor: 8 achados aplicados. Simulado: Cleyton/PRE_APROVACAO e EM_ANALISE → DESCARTADO; "vou pensar" → AGUARDANDO;
  loja ativa "decidimos parar" → LFV + `loja_quer_parar`.
- Cleyton descartado em 08/10 (com os carimbos). Levantamento dos parecidos: `docs/Desistencias-a-revisar-2026-10-08.xlsx`.
- ⏭ **Em aberto (Aldo decidir):** prospect que diz só "não tenho interesse" hoje vira AGUARDANDO e leva a retomada
  (4–7 mensagens nos casos da planilha). Não está coberto pela regra 🚪.

## 🎁 Campanha de boas-vindas da AIVA — lojas novas, 4 semanas (Aldo 09/10/2026, LIGADA)

Semanas 1 e 2 = 30 consultas; semana 3 = 30 consultas + 2 vendas acumuladas; semana 4 = 30 consultas + 6 vendas
acumuladas. Cada semana batida = R$ 80; tudo batido = R$ 500 NO TOTAL. Paga pela AIVA junto do repasse (Aldo).
Começa no primeiro acesso (portal); quem teve 1º acesso em out antes de 09/10 começa em 09/10.
- `lib/campanha-ativacao-calc.ts` (`npm run test:campanha`): placar pelo `aiva_portal_diario` (acumulado do mês; atividade
  de [a,b) = retrato de b − retrato de a; o cron do portal traz o mês anterior, então a virada de mês fecha).
- `/api/sdr/campanha-ativacao` (11h30 BRT seg–sáb): boas-vindas, parcial no dia 4 da semana se a meta não bateu,
  resultado na virada, final. HSM 48, rótulo `aiva_campanha_boas_vindas`, máx 1 msg/20h por loja. Lead duplicado da mesma
  loja: só o mais recente recebe. Marcadores `[CAMP_ATIV:]`, `[CAMP_ATIV_PLACAR:]`, `[CAMP_ATIV_MSG:]`.
- VictorIA: seção 🎁 no prompt (só fala com o bloco) + bloco dinâmico do placar (TREINAR/LOGIN/LFV; não vai com loja
  bloqueada por limite). A campanha antiga de ago/2026 ("CPFs distintos", "no mês") saiu do prompt. Dicas e check da
  1ª venda pulam quem está na campanha. Revisor: 6 achados aplicados.
- 1ª rodada 09/10 (manual, prod): 13 boas-vindas, 0 falhas.
- ✅ **CPF diferente confirmado pelo Aldo (09/10)** e pagamento junto do repasse. O portal só dá o total de consultas, então o
  placar é PRÉVIA: textos e VictorIA dizem "pelo placar"/"previsto", nunca "garantido" — a AIVA confere no fechamento.

## 📤 Disparo D+0 diário na nuvem — `/api/sdr/disparo-diario` (Aldo 11/10/2026)

O lote diário de D+0 saiu do PC do Aldo (`scripts/disparar-fila.mjs`) e roda sozinho no Vercel. Regras puras em
`lib/disparo-diario-calc.ts` (`npm run test:disparo`), IO em `lib/disparo-diario.ts`.
- **Teto: 500/dia pra AIVA** (a Parcelex tem os 500 dela). **Janela 8h–19h BRT**, seg–sex. O orçamento é derivado de
  `sdr_mensagens` (rótulo `aiva_campanha`): cada rodada conta o que já saiu hoje e manda só o que sobrou.
- **Cron `7,27,47 11-21 * * 1-5` = 33 rodadas** (8h07–18h47 BRT), lotes de 5; um lote só começa com ≥100 s sobrando na rodada (o trabalho termina em ~140–200 s). Por que tantas: o ritmo
  medido é **~10–13 s por lead** (5 envios em 48–75 s), então uma rodada cabe ~10–15 leads e 33 chegam a ~330–495/dia
  (spec corrigido no commit 9a51b60). Minutos 7/27/47 fogem de todo múltiplo de 5 (`sync-from-evo`, `auto-reprocess`,
  `espelho-portal`) e do `:30` da campanha-ativacao; 240 s < 20 min, rodadas não se sobrepõem. Falta fila no fim do dia =
  **mais rodadas, nunca mais leads por rodada** (a física da função é ~10–13 s por lead).
- **Trava de entrega:** antes de cada rodada mede o recibo da Meta (`lib/entrega-meta-calc.ts`, piso **30%**, mesma
  amostra do vigia). Abaixo do piso a rota **pausa sozinha** e avisa Aldo+Nei. `sem_dados` (Evo fora do ar, ou de manhã
  sem envio do dia pra medir) **NÃO bloqueia** — dispara. Lead que o `send-initial` recusa por já estar na base volta como
  status `DUPLICADO`: não conta como falha. ⚠️ O `/retomar` grava `retomado_em` e **zera a amostra de entrega**: depois
  dele a rodada só mede envios posteriores à retomada (`inicioEfetivoDaAmostra`). Sem isso a rodada seguinte re-media os
  mesmos envios da pausa e re-pausava em 20 min. Com ≥12 confirmáveis pós-retomada ela volta a medir e re-pausa se o
  problema for real.
- **WhatsApp (só Aldo e Nei, os números de `lib/admin-commands.ts`):** `/disparo` (saiu hoje, fila, entrega), `/pausar`,
  `/retomar`. Repetir comando responde o estado atual sem reescrever nada. ⚠️ **A pausa NÃO expira à meia-noite — só o
  `/retomar` tira.** Estado em `sdr_disparo_estado` (uma linha, id = 1, RLS ligada).
- **Resumo do dia:** a rodada das 18h47 manda a Aldo e Nei o balanço (saiu, restante, entrega). Acoplado ao minuto do
  cron — mexer em `vercel.json` exige conferir `ehUltimaRodada`.
- **Vigia (17h):** `disparo-diario`, tolerância 2, ação = `saiu_hoje` (NÃO `enviados`: o `?dry` não envia nada).
- ⛔ **NUNCA rodar `scripts/disparar-fila.mjs` nem chamar a rota na mão (sem `?dry`) com o cron armado (seg–sex,
  8h07–18h47 BRT).** Script e rota leem as MESMAS linhas PENDENTE na mesma ordem e só marcam DISPARADO depois de enviar; o
  duplicado do `send-initial` é check-then-upsert, então duas execuções concorrentes mandam o template à mesma loja duas
  vezes. O script ainda ignora o `/pausar` e o orçamento do dia. Ele gasta o mesmo orçamento (`aiva_campanha`), mas só
  serve com o cron parado (fim de semana/fora da janela) — não é "rodada manual segura".
- ⚠️ **Alertas fora da janela de 24 h somem.** Aviso de pausa e resumo das 18h47 saem como texto livre por `alertHuman`;
  fora da janela de 24 h do WhatsApp a Meta descarta em silêncio (igual ao `briefing-pipeline`). **Em 30/10–15/11 o Aldo
  ou o Nei precisam responder o HSM do briefing das 5h TODO dia útil** pra manter a janela aberta até a manhã seguinte.
  Alerta por HSM está planejado antes da viagem.
- ⏭ **Em aberto (minors da revisão):** sem trava entre rodadas sobrepostas (curl manual durante um cron) · `alertHuman`
  sem timeout · `fila_pendente` não desconta falhas · resumo de fim de semana se a rota for chamada às 18h · `/disparo`
  pode esperar até 60 s pela checagem da Evo.

## 💳 Acesso ao PAINEL FINANCEIRO por ticket via API (Mauricio 13/10/2026 — "sempre por aqui agora")

O formulário Google do painel financeiro MORREU (inclusive o link que foi no comunicado de 13/10). Endpoint:
`POST /api/public/partner/tickets/painel-financeiro` (`retailer_id`|`onboarding_id` + `email` conta Google; 201/409/422/404/429/503).
O Mauricio disse que ainda nesta semana a AIVA vai incluir no painel AUTOMATICAMENTE toda loja nova assim que for criada.
- VictorIA (item 1 da seção REPASSE DE VENDA + blocos TREINAR/LOGIN/LFV): só com loja criada, pede UM e-mail Gmail/Workspace
  (Hotmail/Outlook não) e devolve `abrir_painel_financeiro: <email>`. Antes da loja existir não pede e-mail.
- Webhook (bloco "PAINEL FINANCEIRO POR TICKET", `lib/painel-financeiro.ts`, `npm run test:painel`): abre um ticket por RID do
  lead e manda ao lojista "ticket nº X". Travas: loja criada, RID, assunto na janela, e-mail escrito pelo lojista, sem repetir
  ticket do mesmo e-mail (`[PAINEL_FIN_TICKET:#n (RID r)|email|ISO]`), pedido que não abre vai pra fila (nunca morre calado),
  não derruba escalada aberta. Nota 💳 ao time só quando abre.
- Revisor: 9 + 4 achados aplicados. Simulado (pede Gmail, recusa Hotmail, não pede antes da loja, motivo lido nas 3 fases).
  ⚠️ Não abrimos ticket real de teste — o primeiro uso de verdade é com lojista.

## 🎫 Tickets do portal AIVA — fase de observação (Aldo 13/10/2026)

O portal de parceiros ganhou uma central de tickets pro CS da AIVA (`/tickets`; tabelas `tickets`, `ticket_types`,
`ticket_messages`, `ticket_attachments`). 6 tipos: Cadastro de filial · Comissão · Cadastro de loja · Suporte operacional ·
Outros · Problemas com repasse. Status aberto → em_analise → aguardando_parceiro → resolvido → fechado; ticket guarda CNPJ,
retailer_id e onboarding_id. **Sem endpoint na API pública** (só onboardings/remove/resend-password); o login do portal lê as
tabelas direto (`rest(loginPortal(), 'tickets?select=*')`), mas isso não é API oficial.
- **Plano (Aldo):** o Nei abre tickets À MÃO por um tempo; depois analisamos todos (tipo, texto, campos, resposta do CS,
  tempo até resolver) e montamos o modelo que a VictorIA vai usar. Primeiros: #1030 e #1031 (13/10, painel financeiro).
- ⏭ Perguntas ao Mauricio: API de tickets? "Cadastro de loja" substitui o pré-cadastro do Google Forms? SLA do CS?

## 🎫 Repasse e filial por TICKET + acompanhamento dos tickets (Mauricio/Aldo 13/10/2026 — "sempre pelo ticket")

Os forms de Pagamentos e repasses (RJSw…) e de credenciamento de filial (AyWzx…) foram DESATIVADOS. API:
`POST /tickets/repasse` (retailer_id, vendas[{numero,valor}], observacoes), `POST /tickets/filial` (RID da matriz, cnpj, numero,
complemento — a AIVA busca o resto na Receita e valida raiz/ativa), `GET /tickets?updated_since=&include_messages`.
- VictorIA (loja criada: TREINAR/LOGIN/LFV): repasse → pede nº da venda (+valor) → `abrir_ticket_repasse: vendas=<n>:<v>;… | obs=…`
  (atrasado mantém acionar_humano = true); filial → CNPJ + nº do endereço → `abrir_ticket_filial: cnpj=… | numero=… | complemento=…`.
  Endereço pedido pela AIVA → `filial_endereco: cnpj=… | numero=… | endereco=…` + humano (o time abre pelo portal).
- Webhook (bloco "REPASSE E FILIAL POR TICKET", `lib/tickets-aiva.ts`, `npm run test:tickets`): mesmas travas do painel (status,
  RID, assunto na janela, só dado que o LOJISTA escreveu, sem repetir: `[TICKET_REQ:repasse:<vendas>|#n|ISO]` vale só enquanto o
  ticket está aberto). Falha → fila humana. Marcador por ticket `[TICKET_AIVA:<nº>|<tipo>|<status>|<msgs AIVA>]` (painel também).
  O remonte de observacoes do webhook relê os `[TICKET_AIVA]` do banco (o cron escreve a qualquer hora).
- Cron `/api/sdr/tickets-aiva` (`13 11-22 * * *`, 8h13–19h13 BRT, todo dia): 1ª rodada = retrato sem aviso. Resolvido → HSM 48
  ao lojista (`aiva_ticket_resolvido`) SÓ se o ticket tem marcador nosso (ticket que o Nei abre à mão → só o time); falha no envio
  não avança o marcador. Aguardando/resposta/resolvido/fechado → digest a Aldo+Nei. Ticket de loja sem lead: estado em
  `sdr_avisos_chave` (`ticket_aiva:<nº>:<status>:<msgs>` — `ultimo_aviso` é timestamptz, por isso o estado vai na chave).
- `/atendimento`: seção "🎫 Chamados abertos na AIVA". Revisor: 14 + 7 achados aplicados; simulado (pede nº da venda, motivo de
  repasse e filial). ⚠️ Nenhum ticket real de teste foi aberto. A linha da aba Filiais segue como registro — NÃO mandar à AIVA.
- ⏭ Perguntar ao Mauricio: tickets #1030/#1031 (Nei, à mão) não aparecem no GET; 409 de repasse é por loja ou por venda?

## 🚧 Loja BLOQUEADA POR LIMITE DE ORIGINAÇÃO (Aldo 06/10/2026)

A AIVA trava a loja que bate o teto de vendas (Aldo: R$ 15 mil/semana): portal mostra "Inativo" + "⚠️ Bloqueada por
limite de originação"; o lojista vê "Loja inativada. Entre em contato com o suporte". Fonte: tabela
**`store_origination_limit`** do banco do portal (login, não está na API pública; criada pela AIVA em 06/10; só tem
`retailer_id`, `bloqueado_por_limite`, `bloqueado_desde` — sem valor do limite nem data de volta). Achada no bundle do
portal (`performance-*.js`). Em 06/10: 3 bloqueadas — Ajucelulares (RID 6587, desde 25/09), RIDs 4655 e 7053.
- `lib/limite-originacao.ts`: `lojasBloqueadasPorLimite` (cache 10 min, RID→CNPJ via `retailer_performance`),
  `bloqueioDoLead`, `leadsBloqueadosPorLimite`, `blocoPromptBloqueio`. Nada lança erro.
- Webhook (TREINAR/LOGIN/LFV) lê ANTES do detector de erro: loja bloqueada não pede print nem abre chamado de ERRO DE
  PORTAL. A VictorIA explica em até 3 frases (limite da semana, não é erro dele, time tratando com a AIVA), sem prazo, sem
  "te aviso", sem contorno, sem Parcelex; aciona 1× com `loja_bloqueada_limite_originacao`. Simulador: `bloqueio_limite`.
- Dicas de desempenho e check de primeira venda PULAM a loja bloqueada (`motivos.bloqueada_limite` no `?dry`).
- R$ 15 mil/semana fixo no texto — **confirmado pelo Aldo em 06/10/2026** (a tabela não traz o valor). Se a AIVA mudar o teto, trocar em `blocoPromptBloqueio`.

## 🔗 Lojista fez o cadastro na AIVA com OUTRO CNPJ (Gfourr e Francell, 05/10/2026)

Gfourr deu o CNPJ 33.363.773 na conversa e fez o cadastro com o 61.255.811 (outra empresa do sócio). A AIVA criou a
loja (RID 6798), ela consultava crédito desde setembro — e o card seguia em Em Análise, **levando cobrança de
formulário**, porque o espelho só enxerga CNPJ que está em `sdr_registros_cnpj`. Pior: em 28/09 o
`arrumar-51-sem-operar` tirou as duas da 51 justamente por isso (o único CNPJ conhecido estava em `dados_varejo`).
- **Espelho, passo 1b** (`lib/vinculo-portal-calc.ts`, dentro de `npm run test:espelho`): cadastro do portal que ANDOU
  (RID, `cadastro_finalizado` ou `biometria`), com CNPJ sem registro e `phone_number` que casa com UM lead vivo →
  cria o registro (`tipo adicional`, `origem portal-telefone`) e avisa o time (bloco 🔗). Telefone compara por DDD +
  últimos 8 dígitos (o 55 e o nono dígito variam). `dados_varejo` fica de fora (é criado pelo nosso pré-cadastro, não
  prova nada) e telefone que casa com 2 leads também. `?dry` devolve `vinculados`.
- ⚠️ Antes de "arrumar" card pra trás porque o portal mostra cadastro aberto, procure o telefone do lead em TODOS os
  onboardings — o CNPJ anotado pode não ser o que ele usou.
- Na primeira rodada entraram também Bender, Mega Computadores, Gold Store Cotia e Santa Helena (já em 51; o vínculo
  só completa os números de desempenho delas).

## "Já concluí o cadastro" não é mais fila humana (05/10/2026)

`cadastro_caf_confirmado` punha `acionar_humano=true` e o lead ia pra "Mover card" — onde não há o que mover: o card
só anda quando a AIVA cria a loja, e isso o espelho faz. Efeito colateral grave: a biometria automática e a cobrança
do formulário filtram `acionar_humano=false`, então o lead ficava SEM automação nenhuma. Serginho Import disse "já fiz"
em 01/10 com a biometria PENDENTE no portal e ficou 4 dias parado; Distribuidora de Varejo, 3 semanas. Agora o webhook
zera o `acionar_humano` desse motivo em EM_ANALISE_AIVA (o motivo continua carimbando `[CAF_OK]`). Quem diz se
concluiu é o portal: `biometria`+`aprovado` sem RID = esperando a AIVA (o espelho avisa o time após 24h).
✅ **Regra no prompt, mesmo dia (Aldo): quem confirma a conclusão é o PORTAL, não a fala do lojista.** FASE 4 de
`lib/claude.ts` + bloco "O CADASTRO DESTA LOJA AINDA NÃO FOI CONCLUÍDO" + `prompts/aiva.ts` (Seu papel nessa fase):
- portal com etapa em aberto + "já fiz": ela NÃO diz "cadastro concluído"; explica que no sistema ainda aparece pendente
  (minutos pra atualizar; se faz mais tempo, abrir o link de novo). `cadastro_caf_confirmado`, `acionar_humano = false`.
- ele INSISTE depois dessa explicação (falando ou com print): `acionar_humano = true`, motivo `portal_nao_atualizou_cadastro`.
- portal concluído (`aguardando_aiva`): confirma que está tudo certo do lado dele e NÃO repergunta "já fiz / ainda não".
- sem etapa lida (12 leads em 05/10; costuma ser CNPJ diferente): pede pro time conferir (`portal_nao_atualizou_cadastro`).
Revisor: 7 achados aplicados — o grave era o fecho do próprio bloco, que mandava "acredite nele". A regra do "OK"
(`"já fiz" depois de pergunta fechada é resposta`) ganhou a ressalva "aceitar não é declarar concluído". O card do
Pipeline "CAF preenchido" virou "Disse que concluiu". Simulador: `onb_etapa` e `biometria_link` no `/api/chat`.
Liberados da fila humana: Serginho Import, EdCell e Distribuidora de Varejo.

## 🔬 Biometria "enviada para análise" e "a bola está com a AIVA" — sem promessa de retorno (Aldo 13/10/2026)

Prime Celulares e Boss Imports ouviram "vou pedir pro time conferir… assim que tiver retorno eu te aviso" e "você concluiu a
biometria". `NOTA_BIOMETRIA_EM_ANALISE` (lib/claude.ts) entra no bloco de cadastro aberto quando a etapa é BIOMETRIA: tela
"Tudo certo — enviada para análise" = ele ENVIOU, a AIVA analisa → "enviou certinho, está na análise da AIVA, o próximo passo
chega sozinho"; sem "concluiu", sem prazo, sem reenviar link, sem acionar no mesmo dia; ≥1 dia útil cobrando →
`biometria_em_analise_aiva`. Bloco "A BOLA ESTÁ COM A AIVA": tirou o "vai pra Treinar" (antigo de 06/10), fala permitida ao
acionar ("o time acompanha com a AIVA; o próximo passo chega automaticamente"), print sem pergunta não aciona. Revisor: 4+1 achados
aplicados; simulado nos dois casos. Em 13/10: 5 lojas com biometria aprovada esperando a AIVA criar a loja (mais antiga 09/10)
e 46 cadastros com conferência de CNPJ "pending" no portal (em 24/09 eram 0) — perguntado ao Mauricio.

## 📮 Pré-cadastro marcado e que não chegou à AIVA (Aldo 06/10/2026)

O "Abrir form" do `/registros` marca o CNPJ como enviado no CLIQUE. Se o formulário não é enviado, o lead para em
Cadastro Recebido sem ninguém saber — e a VictorIA respondia "depende da análise da AIVA" (Minas Celulares, 02→06/10).
Medição de 06/10: 106 de 111 pré-cadastros aparecem no portal com mediana de 1h30 e máximo de 30h.
- **Espelho, passo 11**: lead em PRE_APROVACAO/CADASTRO_RECEBIDO com CNPJ `pre_cadastro_enviado` há 24h+ e NENHUM CNPJ no
  portal → marcador `[PRE_CAD_NAO_CHEGOU:ISO]` + aviso `pre_cadastro_nao_chegou` no topo do Atendimento + bloco no digest.
  Sai sozinho quando o CNPJ aparece no portal. `?dry` devolve `pre_cadastro_nao_chegou`.
- **VictorIA**: com o marcador, diz que o cadastro está completo do lado dele e que o NOSSO time está finalizando o envio;
  não culpa a AIVA, não cita 24h, não aciona humano. Simulador: `pre_cadastro_nao_chegou: true`.

## 🚫 Biometria NEGADA pela AIVA — trilha própria (Aldo 05/10/2026)

A AIVA analisa a selfie DEPOIS: o lojista sai do link com a tela de "concluído" e só mais tarde o portal vira
`biometry_status = negado`. Ninguém avisava: o cron seguia mandando o lembrete genérico de "falta fazer" e a VictorIA lia
o print da tela de concluído como conclusão. TevCell: negada em 29/09, 3 lembretes errados e 3 "você concluiu certinho".
- **Cron `/api/sdr/biometria`**: `listarBiometriaPendenteApi()` devolve `negada`; quem está negada sai dos lembretes
  genéricos e do esgotamento e segue `decidirNegada` (`lib/biometria-calc.ts`, `npm run test:biometria`): aviso na hora,
  1 reforço em 2 dias, marcador `[BIO_NEGADA:n:ISO]`. `leads_em_analise` do `?dry` não conta as negadas (vigia).
  ⏸ **`ENVIO_NEGADA_ATIVO = false`**: o aviso ao LOJISTA segue desligado. Os dois textos (`mioloNegada`) foram
  **APROVADOS pelo Aldo em 05/10/2026**; falta só o Mauricio responder se o link reabre depois da negativa.
  Com a flag desligada os lembretes genéricos já param e o painel já avisa.
- **Painel**: aviso `biometria_negada` (primeiro da lista), aberto pelo ESPELHO na troca de etapa do portal e fechado
  sozinho quando a etapa sai de negada. Só na troca: "Resolvido" com a selfie ainda negada não reabre a cada 15 min.
- **VictorIA** (FASE 4 + bloco de cadastro em aberto): com o portal em negada, print da tela de concluído NÃO prova nada;
  ela diz que a AIVA analisou depois e não aprovou. Link que só abre a tela de concluído → `link_biometria_nao_reabre`
  (acionar_humano = true), sem reenviar o mesmo link. "Refiz" continua `biometria_refeita`.
- ⚠️ Em aberto com o Mauricio: depois de negada, o MESMO link reabre pra refazer? (no TevCell parece que não) · motivo
  da negativa na API · status e motivo de loja INATIVADA (Ajucelulares: bloqueada 2× em set, sem motivo em lugar nenhum).

## 🚨 Avisos do robô no topo do Atendimento (Aldo 05/10/2026)

Os digests de WhatsApp pro Nei ("3 lojas sem concluir a biometria…") passavam batido no meio dos outros alertas.
Agora cada loja avisada vira uma linha na seção vermelha **🚨 Avisos do robô**, no topo do `/atendimento`, até alguém
clicar em **✓ Resolvido** — e o menu lateral mostra o total em vermelho ao lado de "Atendimento" em qualquer tela.
- Tabela `sdr_avisos_painel` (um aviso ABERTO por tipo+lead). `lib/avisos-painel.ts` (`registrarAvisos`/`resolverAvisos`,
  nunca lançam erro — o painel é espelho do WhatsApp) e `lib/avisos-painel-calc.ts` (catálogo com título/o-que/ação;
  `npm run test:avisos`). API `/api/avisos-painel` (GET contador, POST resolver) — está no matcher do middleware.
- Quem grava: biometria esgotada, formulário esgotado, check de treinamento esgotado, cadastro-recebido esgotado,
  fase3-destravada e senha pendente (só as NOVAS; fecha sozinho quando a AIVA envia). O digest de WhatsApp continua
  saindo, com uma linha no fim apontando o painel (`RODAPE_PAINEL`).
- **Fecha sozinho** (`avisoVelho`, ao carregar a página) quando o lead muda de etapa ou sai do funil — senão o Nei
  liga pra loja que já resolveu. "Resolvido" só fecha o aviso: não mexe no lead nem na automação.
- Carga inicial (05/10): 6 biometria · 40 formulário · 25 senha, datados pelo último toque. Cada grupo mostra 8 e o
  resto abre em "ver mais". ⚠️ NÃO entraram (seguem só no `/excecoes`): reprovado a conferir, travado que voltou a
  falar, CNPJ irregular/inválido e "AIVA não criou a loja" (espelho). Pra incluir um tipo novo: catálogo + `registrarAvisos`
  no ponto em que o aviso de WhatsApp sai.

## Atendimento no formato da Parcelex — seis colunas (Aldo 05/10/2026)

Todas as seções do `/atendimento` (avisos do robô, ação pendente, CS, chamados, mover card, travados, docs, sem motivo)
usam a MESMA tabela: **Loja · O que está acontecendo · O que fazer · Última fala do lojista · Parado há · Ação**.
- `lib/atendimento-orientacao.ts` (`orientar`, dentro de `npm run test:avisos`) traduz o motivo do acionamento em situação +
  ação, em 3 camadas: dicionário dos ~35 códigos do prompt → famílias por palavra-chave (a VictorIA inventa código:
  `erro_vinculo_societario_persistente…`) → o próprio texto do motivo com ação genérica. Código novo no prompt = entrada
  nova no dicionário `EXATOS`, senão cai na família ou no genérico.
- Última fala: RPC `sdr_ultimas_falas(ids uuid[])` (uma consulta pra tela toda; só `service_role`).
- "Parado há" = `data_ultimo_contato` na fila, `criado_em` no aviso/chamado, `status_alterado_em` nos travados.
- `motivoDeObs(obs, max)` ganhou o 2º parâmetro: a tela usa 200 caracteres; o digest de WhatsApp segue com 70.
- **3 lojas por tema** (Aldo 06/10): `A_VISTA = 3` + `TabelaLimitada` (o resto em "ver mais"), em avisos e seções.
  **Saíram as seções "Mover card" e "Docs / colaboradores"** (a VictorIA/espelho já resolvem) — a categoria continua
  em `lib/fila.ts` e no digest `/api/sdr/fila-humano`, só não aparece na tela.
- **Quadro 📋 Registros AIVA** no topo direito (Aldo 06/10): CNPJs com `enviado = false` (3 à vista + ver mais) com o
  MESMO `AbrirFormLink` do `/registros` (marca no clique e avança o card pra 49), contagem de hoje/7 dias e link da
  planilha. O `/registros` completo continua existindo (desmarcar, colaboradores, busca).
- **Menu (06/10):** saíram Registros AIVA, Alertas, Clientes e **Exceções** — as páginas continuam no ar.
  Os temas acionáveis do `/excecoes` viraram avisos do robô: `senha_usuario`, `portal_reprovado_conferir`,
  `cnpj_irregular`, `cnpj_invalido` (gravados no webhook/espelho na hora do marcador; carga inicial 1+13+11+15).
  ⚠️ Esses 4 são **PELO_MARCADOR** (`lib/avisos-painel-calc.ts`): NÃO fecham quando a etapa muda (CNPJ irregular segue
  irregular de Treinar pra Vendendo); fecham quando o marcador sai do lead ou o lead sai do funil. "Travado que voltou a
  falar" (`[RETORNO_CNPJ_ALERTA]`) ficou só no `/excecoes` — é informativo, o alerta já vai por WhatsApp.
- **🔎 Busca (Aldo 07/10/2026):** campo no topo (`?q=`) filtra a tela inteira por loja, telefone ou CNPJ (busca só de
  números, 4+ dígitos, compara os dígitos — acha com ou sem pontuação). Com busca: some seção vazia, tudo aparece sem
  "ver mais", e quem bate na base mas não está em fila nenhuma aparece em **🗂 Fora da fila** (até 15 de `sdr_leads`,
  CNPJ procurado nas observações), clicável pra abrir a conversa.
- **Limpeza (06/10/2026):** chamado aberto fecha SOZINHO quando o lead avançou de etapa desde a abertura ou saiu do
  funil (`chamadoVelho` na página). A seção "⏱ Travados no CAF" SAIU — lia o marcador da régua antiga
  (`[FOLLOWUP_FASE_COUNT:3]`, followup-fase apagada em 16/09) e chegou a listar a Smarttech com biometria aprovada;
  quem esgota a cobrança nova já aparece em Avisos do robô → "Formulário da AIVA sem preencher".

## Painel Jornada AIVA — `/jornada` (24/09/2026)

Aba abaixo de Atendimento. Junta API de onboardings + banco do portal (desempenho, login_sends) + funil 15
do Evo + `sdr_registros_cnpj`→`sdr_leads` numa tela: trilho de 7 fases (formulário → biometria → esperando a
AIVA → loja sem senha → com senha sem uso → consultando → vendendo) com **quem precisa agir** em cada uma
(lojista/AIVA/Track), a fila "o que precisa de alguém hoje", vendas do mês, ritmo semanal, funil 15 e cards
atrás do portal. Regras puras em `lib/jornada-aiva-calc.ts` (`npm run test:jornada`), IO em `lib/jornada-aiva.ts`
(allSettled — fonte fora vira aviso na tela, não erro; cache 5 min, `?fresco=1` ignora).
- **Venda vence o stage** (o lote importado de 16/09 está em `dados_varejo` e vende) e `biometria`+`aprovado`
  = esperando a AIVA. Loja que só existe no desempenho também entra (senão "Vendendo" fica menor que o portal).
- "Loja criada, sem senha" = sem `credentials_sent_at` E sem nenhuma consulta. As mais antigas (até 133 dias)
  podem ser senha entregue antes do `login_sends` existir — por isso o texto diz "nenhuma senha **registrada**".
- ⚠️ Estreou **pública** (a lista do matcher em `middleware.ts` é explícita) e levou `/excecoes`, que estava
  pública desde 16/09. Corrigido no mesmo dia. **Página nova do painel: adicione no matcher no mesmo commit.**

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

---

## VictorIA Analista — widget de chat interno do painel

Assistente interna (só consulta, nunca ação) pra Aldo/Nei perguntarem sobre a operação:
contagens por etapa, resumo de conversa de lead, leads parados, métricas etc.

- **UI:** botão flutuante (canto inferior direito) em todas as telas do painel → slide-over.
  Componente `app/_components/AssistenteWidget.tsx`, montado no `app/layout.tsx`.
  Não aparece em `/login` nem `/chat` (simulador público). Conversa sobrevive à navegação.
- **API:** `POST /api/assistente` (protegida pelo middleware/cookie do painel).
  Loop de tool-use em `lib/assistente.ts` (claude-sonnet-4-5, máx 8 iterações).
- **Ferramentas:** `contar_leads`, `buscar_lead`, `historico_conversa`, `consulta_sql`.
- **Segurança do SQL livre:** RPC `public.assistente_sql(q)` — dona é o role `assistente_ro`
  (somente SELECT + policies RLS de leitura em `sdr_leads`/`sdr_mensagens`).
  Escrita falha no nível do banco (`permission denied`), mesmo escondida em CTE.
- **Prompt:** `prompts/assistente.ts` (persona analista, schema, status do funil).
- Spec/plano: `docs/superpowers/specs/2026-07-10-*` e `docs/superpowers/plans/2026-07-10-*`.

---

## URLs do Projeto

| Ambiente | URL |
|---|---|
| Local | http://localhost:3000 |
| Produção Vercel | https://sdr-agent-t5dct1xnn-aldo-7870s-projects.vercel.app |
| GitHub | https://github.com/Aldorj26/sdr-agent |
| Supabase Dashboard | https://supabase.com/dashboard/project/axkrorkhnkfkpbjikwrb |
| Vercel Dashboard | https://vercel.com/aldo-7870s-projects/sdr-agent |

---

## Comandos Úteis

```bash
# Rodar local
npm run dev

# Deploy produção
vercel --prod

# Testar webhook local (com ngrok rodando)
Invoke-WebRequest -Uri "https://SEU_NGROK.ngrok-free.dev/api/sdr/webhook" `
  -Method POST `
  -Headers @{"Content-Type"="application/json";"x-internal-secret"="<WEBHOOK_SECRET>"} `
  -Body '{"event":"messages.upsert","data":{"key":{"fromMe":false,"remoteJid":"5547996085000@s.whatsapp.net"},"message":{"conversation":"Olá, quero saber mais"}}}'

# Inserir lead de teste no Supabase
# (via SQL Editor no painel Supabase)
INSERT INTO sdr_leads (nome, telefone, cidade, status, etapa_cadencia)
VALUES ('Teste', '5511999998888', 'São Paulo', 'INTERESSADO', 1);
```

---

## Contexto de Negócio

**Empresa:** Track Tecnologia e Inovação — Brusque, SC
**Responsáveis:**
- **Aldo da Rocha Junior** — estratégia, produto, relacionamento enterprise
- **Nei Luiz** — execução comercial, prospecção, operação

**Time AIVA:**
- **Eduardo** — analista da AIVA (aprova/reprova lojas em até 24h)

**Meta da operação AIVA:**
- 10.000 leads na base
- 150 disparos/dia
- 50 lojas ativas/mês
- Funil esperado: 10.000 disparos → 1.000 respostas → 200 formulários → 100 aprovados → 50 ativas

**Produto AIVA:**
- Parceria Track + AIVA (UME)
- Track é canal de vendas da AIVA
- Comissão por loja ativada
- Público-alvo: lojas de varejo de celulares com faturamento mínimo de R$100/mês em financiamento

---

## Próximas Evoluções Planejadas

1. **Dashboard de métricas** — visualização do funil em tempo real
2. **Importação em massa de leads** — upload de planilha Excel
3. **Cron automático** — configurar no Vercel para follow-up sem intervenção
4. **Multi-produto** — reutilizar a estrutura para Neocredit e Evo Talks
5. **Relatório semanal automático** — resumo enviado para Aldo/Nei via WhatsApp

**Smarttech Celulares (05/10/2026, Aldo):** o `62555956000108` era erro de digitação do `62555956000107` (DV inválido ×
válido e ATIVA; os dois estavam registrados). Registro -08 apagado, -07 virou a matriz, `cnpj_matriz` corrigido e
`[CNPJ_PORTAL_INVALIDO]` removido (marcador `[CNPJ_CORRIGIDO:…]`). ⚠️ O cadastro -08 continua existindo no portal da AIVA
(só a AIVA remove) e a filial 13222874000135 segue INAPTA — por isso o lead continua com `[CNPJ_IRREGULAR_AIVA:inapta]`.

---

## Dicas de desempenho: impacto medido e virada para abordagem investigativa (Aldo 20/10/2026)

**Medição de 05 a 20/10** (`docs/Dicas-desempenho-impacto-2026-10-20.xlsx`): 390 envios para 212 lojas (193 das 250 em
LFV; as 57 restantes estavam na campanha de boas-vindas, há <7 dias na etapa, em conversa viva ou opt-out). Resposta em
48h: **15,5% no 1º toque, 6,9% no 2º** (consultoria antiga: 27% → 11%). Por segmento (lojas que responderam alguma vez):
vende_firme 41% · vende_pouco 36% · parou 31% · aprova_nao_vende 25% · sem_uso 15%. **Efeito em venda: nenhuma loja
`sem_uso` (75) ou `parou` (13) vendeu depois do toque**; 1 de 59 `aprova_nao_vende` vendeu. Vendas semanais das lojas
tocadas caíram 122 → 107 → 79 → 54 (semanas de 21/09 a 12/10) — tendência que já vinha antes da rotina, não causada por
ela, mas a rotina não a conteve. Das 102 lojas que venderam no portal em set/out, 89 receberam dica; 7 vieram da
conciliação UME sem lead no CRM (KW Avenida, B5 Tech, Pixel Games, KW Celulares e três MEIs — 62 vendas) e nunca serão
tocadas enquanto não tiverem lead com WhatsApp.

**Decisão do Aldo (20/10):** "o cara que nunca consultou, estimular a consulta e ver qual é o erro; o que parou, descobrir
por que parou e trazer argumento (se foi aprovação, convencer a ativar de novo); impacto uma vez por semana".
Mudanças: `intervaloDias` = 7 para todo segmento (era 14 para parou/sem_uso); 4 textos novos por segmento em
`lib/dicas-desempenho-calc.ts`, cada um testando uma hipótese (aprovação, equipe/login, acesso, movimento) e terminando com
pergunta; `parou` cita o total de vendas que a loja já fez; seção **2️⃣c LOJA QUE PAROU** na FASE 5 do prompt (motivo
primeiro, resposta por causa, compromisso datado de voltar a consultar); LEITURA do bloco NÚMEROS DA LOJA aponta pra ela.
⏭ Medir em 2 semanas pelo rótulo `aiva_dicas_desempenho`: resposta por segmento e, principalmente, `sem_uso` que fez a
primeira consulta e `parou` que voltou a vender (consulta em `aiva_desempenho_semanal` depois de `[DICAS_ULTIMA]`).

### 20/10/2026 — relatório semanal da loja com link (formato do Farm Track da Parcelex)

O Aldo mostrou o relatório que a Patricia manda pras lojas ativas da Parcelex (`/r/<token>`: funil do mês, semana,
gargalo, dicas, datas) e pediu "algo igual" na AIVA. Mesma mecânica, conteúdo só AIVA: o HSM 48 das dicas ganhou o
link `https://sdr-aiva.vercel.app/r/<token>` no fim, e a página (`lib/relatorio-loja*.ts`, `app/r/[token]/route.ts`)
lê `aiva_portal_diario` — que, por ser retrato acumulado por dia, dá a semana (retrato − retrato de 7 dias antes) e a
data de cada aprovação e venda. Gargalo = consultar (nunca consultou) / retomar (segmento `parou`) / aprovar / fechar /
crescer, com a média das lojas AIVA no retrato mais recente (≈23% de aprovação, ≈21% de conversão em 19/10). Token
estável por lead em `aiva_relatorio_link` (RLS sem policy; `acessos` diz quem abre). Regra antiga "HSM sem link" era
convenção nossa: `aiva_comunicado_forms` (293 em 13/10) e `aiva_acesso_pendente` já levavam link na variável.

### 20/10/2026 — um impacto semanal só na loja ativa (pulso e check de primeira venda desligados)

Depois do relatório com link, o Aldo pediu pra conferir o que mais batia na loja ativa e deixar o relatório como padrão.
Nos 30 dias anteriores, leads em LOJA_FINALIZADA_E_VENDENDO receberam: dicas 371 envios/194 lojas; **pulso semanal**
(`scripts/pulso-semanal.mjs`, tarefa agendada de segunda) 319 envios em 3 segundas, com os MESMOS números da semana
fechada e sem respeitar `[DICAS_*]`; **check de primeira venda** (terça) 36 envios perguntando "já saiu a primeira
venda?" — pergunta que a dica investigativa do `sem_uso` já faz. Uma loja podia ouvir três robôs em três dias.
Desligados o pulso (tarefa aposentada + script aborta sem `--forcar`) e o cron do check; o cron de data fixa do
`comunicado-forms` (13/10) também saiu. A rotina de dicas continua pulando quem está na campanha de boas-vindas.

