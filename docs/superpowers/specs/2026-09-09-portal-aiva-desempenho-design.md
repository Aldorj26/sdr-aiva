# Portal Parceiros AIVA como fonte do desempenho — design

**Data:** 2026-09-09 · **Decisão do Aldo:** trocar o Data Studio pelo portal em TUDO
(painel `/desempenho`, contraprova do `/comissoes`, pulso semanal e detecção de
lojas ativas).

## Contexto

Em 09/09/2026 o Mauricio (AIVA) liberou o **Portal de Parceiros**
(`https://parceiro-aiva.lovable.app/performance`). É um app Lovable com Supabase
próprio (`xznsbwdpfmwvuqipeilq.supabase.co`); a tela "Performance" lê a tabela
`retailer_performance` via PostgREST, filtrada pelo `partner_id` da Track. Logo,
**dá pra coletar por API** — sem Chrome, sem paginar tabela do Looker.

Colunas do portal: `id`, `retailer_id`, `partner_id`, `cnpj`, `retailer_name`,
`mes` (date, dia 1 — uma linha por loja × mês, mês corrente atualizada
diariamente), `n_consultas`, `n_aprovados`, `n_vendas`, `valor_vendas`,
`inadimplencia_aiva`, `inadimplencia_odres`, `out_of_store_photo_pct`, `status`
(Ativo/Inativo). A aba "Precisam de atenção" usa uma data de cadastro que não
apareceu no `select` da tela — confirmar no `select=*` (ver Coleta).

Diferenças relevantes em relação ao Data Studio:

| | Data Studio | Portal |
|---|---|---|
| Granularidade | período livre | só mês (acumulado até o dia) |
| Lojas set/26 | 119 (só com atividade) | 214 (base inteira) |
| Exclusivo | UF, cidade, "Status Consulta" | consultas, inadimplência AIVA/Odres, % foto fora da loja, status Ativo/Inativo, Retailer ID |

**Os números não batem.** Agosto/26 fechado: Data Studio 404 vendas / R$ 534.025,79
(snapshot gravado em 03/09); portal 401 contratos / R$ 579.970,57. Setembro até
08/09: DS 113 / R$ 150.012 (até 07/09); portal 134 / R$ 195.157. O portal é a
visão da própria AIVA e passa a ser a referência da Track.

## Decisões (perguntas respondidas)

1. Escopo: **tudo** migra (C). Data Studio vira legado.
2. Login: **e-mail + senha** do portal, guardados em env (A).
3. Painel: **evolui** com inadimplência, foto fora e "precisam de atenção" (B).
4. Abordagem: **cron no Vercel + série diária** (1).
5. Ativação de loja: **presença no portal com status Ativo**, não a primeira consulta.

## Modelo de dados

### `aiva_portal_diario` (nova) — retrato bruto, um por dia

| coluna | tipo | origem / regra |
|---|---|---|
| `data_ref` | date | dia da coleta − 1 em BRT (retrato "até ontem") |
| `retailer_id` | text | portal |
| `cnpj` | text (14 dígitos) | portal, normalizado |
| `nome_varejo` | text | `retailer_name` |
| `mes` | date (dia 1) | portal |
| `consultas`, `aprovados`, `vendas` | integer | `n_consultas`, `n_aprovados`, `n_vendas` — acumulados do mês naquele dia |
| `valor_vendas` | numeric | `valor_vendas` |
| `inadimplencia_aiva`, `inadimplencia_odres`, `foto_fora_pct` | numeric, nulos permitidos | portal |
| `status` | text | Ativo / Inativo |
| `cadastro_em` | date, nulo permitido | coluna do portal se existir no `select=*`; senão nulo |
| `bruto` | jsonb | linha inteira do portal |
| `coletado_em` | timestamptz | now() |

PK `(data_ref, retailer_id, mes)`. Upsert — rodar duas vezes no mesmo dia
substitui a mesma `data_ref`. É a única fonte de verdade; tudo abaixo deriva dela
e pode ser regerado.

A cada dia coletam-se as linhas com `mes >= mês anterior` (virada de mês). No
primeiro run, todos os meses que o portal devolver (backfill).

### `aiva_desempenho` (mensal, existente) — colunas novas

`consultas integer`, `rid text`, `status_portal text`, `inadimplencia_aiva numeric`,
`inadimplencia_odres numeric`, `foto_fora_pct numeric`, `cadastro_em date`,
`atencao text` (`novo_sem_engajamento` | `baixa_performance` | null).

Colunas do Data Studio (`uf`, `cidade`, `status_consulta`, `sem_operador`,
`telefone`, `qtd_operadores`) permanecem; o importador novo grava nulo/false.
PK `(mes, cnpj)` não muda. `sem_consulta` passa a ser **consultas = 0** (antes era
o proxy aprovados = 0).

### `aiva_desempenho_semanal` (existente) — schema intacto

`uf`/`cidade` nulos. Preenchida pela derivação semanal.

## Coleta — `lib/portal-aiva.ts` + `app/api/cron/portal-aiva/route.ts`

Env (`.env.local` e Vercel): `AIVA_PORTAL_URL`, `AIVA_PORTAL_ANON_KEY` (chave
anon pública do bundle do app), `AIVA_PORTAL_EMAIL`, `AIVA_PORTAL_SENHA`,
`AIVA_PORTAL_PARTNER_ID` (fallback). O Aldo preenche e-mail/senha.

Fluxo da rota (`GET`, Bearer `WEBHOOK_SECRET` ou `CRON_SECRET`, cron
`0 9 * * *` UTC = 6h BRT todos os dias):

1. **Login** `POST /auth/v1/token?grant_type=password` com `apikey` anon → JWT.
   Nada de token persistido.
2. **Partner** lido de `profiles` (`partner_id` do usuário logado); env como
   fallback.
3. **Busca** `retailer_performance?select=*&partner_id=eq.X&mes=gte.<mês anterior>`
   paginada por `Range` (1.000 por página). Sem `?tudo=1` só mês corrente +
   anterior; `?tudo=1` (ou primeiro run, tabela vazia) traz todos os meses.
4. **Validação — não grava nada se**: login recusado; zero linhas; mês corrente
   com menos de 70% das lojas do retrato anterior (base truncada). Falha → WhatsApp
   pro Aldo (mesmo helper/números do briefing) + resposta 500.
5. **Grava** `aiva_portal_diario` com `data_ref = ontem (BRT)`.
6. **Deriva** mensal (mês corrente + anterior; todos no backfill) e, às segundas,
   a semana fechada. Depois roda a **ativação diária** (abaixo).

Parâmetros de reprocesso: `?mes=YYYY-MM` (rederiva o mensal), `?semana=YYYY-MM-DD`
(segunda; rederiva a semana), `?dry=1` (valida e devolve totais sem gravar).

`scripts/portal-aiva.mjs` — atalho local que chama a rota em produção com o
secret (`--dry`, `--mes`, `--semana`, `--tudo`). Não duplica lógica.

## Derivações — `lib/portal-aiva-derivar.ts` (funções puras, testáveis)

### Mensal → `aiva_desempenho`

Para um `mes`: último retrato (`data_ref` máximo) das linhas daquele mês;
agrega por CNPJ — soma consultas/aprovados/vendas/valor; `loja`/`rid` da loja que
mais vendeu; `status_portal` = Ativo se qualquer loja do CNPJ está ativa;
inadimplências = maior valor; `cadastro_em` = menor. Calcula `conversao`,
`ticket_medio`, `sem_venda`, `sem_consulta`, `atencao`. Apaga o mês e insere
(mesma semântica "reimportar substitui").

**Precisam de atenção** (espelha o portal, com a nossa série):
- `novo_sem_engajamento`: cadastro entre 8 e 29 dias atrás, vendas = 0 e
  aprovados ≤ 3 desde o cadastro.
- `baixa_performance`: cadastro há ≥ 30 dias (ou desconhecido) e vendas = 0 nos
  últimos 30 dias (janela calculada pela série diária, mesma subtração das
  semanas; sem série suficiente, usa mês corrente + anterior).
- Sem `cadastro_em` do portal, cadastro = primeiro `data_ref` em que a loja
  apareceu na série (no backfill, primeiro `mes` com linha).

### Semanal → `aiva_desempenho_semanal` (seg–dom, chave = segunda)

- `MTD(loja, mes, D)` = valor do retrato mais recente com `data_ref ≤ D` para
  aquele `mes`; 0 se não há retrato daquele mês até D (mês ainda não começou).
- `semana = MTD(domingo) − MTD(domingo − 7)` por loja e por métrica. Semana que
  cruza mês: `[MTD(último dia do mês antigo) − MTD(dom − 7)] + MTD(domingo, mês novo)`.
- Delta negativo (AIVA cancelou/reprocessou) → 0 + aviso no log da rota.
- **Lojas incluídas**: consultas, aprovados ou vendas > 0 na semana **ou**
  vendas > 0 na semana anterior (preserva o segmento C "queda" do pulso e o
  comportamento atual de só listar quem teve atividade).
- Falha (não grava) se não existe retrato com `data_ref` = domingo nem = segunda.
  WhatsApp pro Aldo.

`pulso-semanal.mjs` e `detectar-lojas-ativas.mjs` não mudam.

### Ativação diária (passo novo na rota)

CNPJ em `sdr_registros_cnpj` ainda não ativo que aparece no retrato do dia com
`status = Ativo` → mesma ação do `detectar-lojas-ativas.mjs` (status `ativa`,
RID, `ativa_em`, conta no funil 11 com `UME_RID | CNPJ`, dedupe por RID, digest
WhatsApp Aldo/Nei só quando há novidade). A lógica de criação da conta é
extraída para `lib/ativacao-loja.ts` e reaproveitada pelo script de segunda,
que vira rede de segurança.

## Painel `/desempenho`

- Cabeçalho: "N lojas no retrato de DD/MM/AAAA · Portal Parceiros AIVA"
  (`data_ref`). Navegação por mês como hoje.
- Cards (filtros): Lojas · Ativas · Consultas · Aprovados · Vendas · Valor
  vendido · Conversão média · Sem venda · Sem consulta · ⚠️ Novos sem
  engajamento · ⚠️ Baixa performance (vermelho quando > 0). "Sem operador" sai.
- Filtros: busca atual (inclui e-mail/sócio/vínculos do lead) + status
  (Todas/Ativas/Inativas) no lugar de UF.
- Tabela ordenável: Loja (nome + CNPJ + RID + marcadores) · Status · Consultas ·
  Aprovados · Vendas · Conv. · Valor · Ticket · Inad. AIVA · Inad. Odres · Foto
  fora · Tend. (vendas vs mês anterior). Nulos = `—`; inadimplência > 0 em âmbar.
  Linha abre o drawer do lead. UF e Cidade saem.
- Meses antigos aparecem com `—` nas colunas novas até o backfill substituí-los.

`/comissoes` e `conferencia-comissao.mjs`: lógica intacta; rótulos "Data Studio"
→ "Portal AIVA".

## Transição

- **Backfill**: primeiro run com `?tudo=1` grava retrato único (`data_ref =
  ontem`) de mai–set/26 e rederiva `aiva_desempenho` de todos — snapshots do Data
  Studio são substituídos. Antes/depois de agosto fica registrado aqui (404 /
  R$ 534.025,79 → 401 / R$ 579.970,57).
- **Pulso**: a semana 07–13/09 não tem retrato de 06/09. Segunda **14/09** roda
  uma última vez com o Data Studio (tarefa atual). A partir de **21/09**, semana
  sai da série diária. Nunca misturar as duas fontes numa subtração.
- **Tarefas agendadas**: `aiva-desempenho-diario` apagada (cron do Vercel
  assume). `aiva-pulso-semanal` perde os passos de Data Studio e passa a:
  `scripts/portal-aiva.mjs --semana <segunda>` → `detectar-lojas-ativas` →
  `pulso-semanal --dry` → disparo — texto novo escrito agora, com nota "vale a
  partir de 21/09". `conferencia-comissao-ume`: passo 7 atualizado (a contraprova
  é rederivada pela rota, `--mes`).
- `coletor-funil-loja.js`, `importar-funil-loja.mjs`,
  `importar-desempenho-semanal.mjs`, `importar-desempenho-aiva.mjs` ficam com
  cabeçalho "LEGADO — substituído pelo portal em 09/09/2026".

## Erros e avisos

Falha da rota → WhatsApp pro Aldo com o motivo + HTTP 500 (aparece no log do
Vercel). Sucesso é silencioso; o painel mostra a data do retrato.

## Testes

Sem runner no projeto — usar `node --test` com type stripping (Node 24) sobre
`lib/portal-aiva-derivar.ts` (funções puras, sem alias de import):
- semanal: semana normal; virada de mês; dia sem coleta (usa retrato anterior);
  delta negativo → 0; loja só na semana anterior entra com zeros; loja zerada
  nas duas semanas fica fora.
- mensal: multi-loja no mesmo CNPJ (soma, loja/RID da que mais vendeu, status
  Ativo se alguma ativa); `sem_consulta` = consultas 0; regras de `atencao`.
Coleta real: `?dry=1` contra o portal antes de ligar o cron.
