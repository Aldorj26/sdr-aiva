# Painel de Comissões AIVA/UME — Design

**Data:** 2026-08-26
**Aprovado por:** Aldo (discussão em sessão, 26/08)

## Problema

As comissões da parceria Track × UME chegam por email mensal ("Ume — Apuração
de comissão · <Mês>") com duas planilhas: **Carteira** (todos os varejos,
grupos AIVA e UME juntos) e **FCDL** (separada). A conferência hoje é manual:
Aldo bate loja a loja contra o funil 11 do Evo ("Contas fechadas MRR") e
questiona diferenças por email. Problemas do processo atual:

- Conferência manual, demorada e sujeita a erro (em julho a NF saiu com valor
  errado — 39k vs 42k — porque Carteira e FCDL são informadas separadas).
- ~154 contas do funil 11 ainda sem Retailer ID (o cód. interno da UME,
  combinado como chave de conferência em 19/08). Eduardo vai fornecer os que
  faltam via Data Studio.
- O inverso não é conferido: loja que a UME pagou mas não existe no funil 11
  passa despercebida.
- "Loja fora do relatório = sem venda no mês" (regra alinhada com Gerisson em
  19/08) — mas hoje não há como validar isso contra outra fonte.

## Fatos verificados (não assumir diferente)

- **Formato da planilha Carteira** (validado com o arquivo real de julho/26):
  aba `RESUMO`; linhas 0–7 = cabeçalho (Parceiro, Competência, Total
  Contratos/Originação/MDR/Comissão); linha 9 = header
  `RETAILER ID | CNPJ | VAREJO | GRUPO | CONTRATOS | ORIGINAÇÃO | MDR | COMISSÃO`;
  depois linhas de dados intercaladas com linhas de grupo (`▸ NOME_GRUPO`),
  `Subtotal <grupo>` e `TOTAL GERAL`. FCDL vem em arquivo próprio, mesmo layout.
- **Retailer ID no funil 11**: convenção já em uso — descrição da oportunidade
  contém `UME_RID: <n>`. Contas criadas pelo backfill de 26/08 têm
  `CNPJ: <14 dígitos>` na descrição. Ambos são parseáveis por regex.
- **Grupos com emissão AIVA** (lista da Mayte, 17/08): `INSIDE_SALES`, `COMM`,
  `MIDDLE_REALME_ES`, `REALME_CURITIBA`, `VAREJO_MAIS`, `VOCE_PONTO_COM`.
  Demais grupos (IVS etc.) = UME.
- **Funil 11**: pipeline 11, etapa única 32 ("Início"). Populado por: sync
  UME externo (descrição `UME_RID: n`, sem telefone), criações manuais do
  Nei/Aldo, backfill 26/08 e a automação da etapa 51 (conta-espelho).
- **Snapshot de desempenho** (`aiva_desempenho`): mês, cnpj, aprovados,
  vendas, valor_vendas — importado do Data Studio Parceiros-AIVA.

## Decisões de design (aprovadas)

1. **Uma tela só**: `/comissoes`, item "Comissões" no menu lateral abaixo de
   Desempenho. Abas **AIVA** e **UME** (padrão visual do /registros). A aba
   UME contém também a sub-visão FCDL. Grupo desconhecido (novo em relatório
   futuro) cai na aba UME com aviso "grupo não classificado".
2. **Ingestão por upload**: botão "Importar relatório" na tela; aceita os
   xlsx do email (Carteira e/ou FCDL). Sem integração com Gmail.
3. **Escrita do Retailer ID no Evo**: aprovada. Botão na linha ⚠️ grava
   `UME_RID: <n>` na descrição da opp (merge — preserva o texto existente).
4. **Cruzamento com o desempenho**: aprovado. Na aba AIVA, cada linha casa
   também com `aiva_desempenho` do mesmo mês (por CNPJ) — vira a contraprova
   de "não vendeu mesmo".

## Arquitetura

### Banco (Supabase)

```sql
CREATE TABLE ume_comissoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mes TEXT NOT NULL,                 -- '2026-07'
  origem TEXT NOT NULL CHECK (origem IN ('carteira','fcdl')),
  retailer_id INT,
  cnpj TEXT,                         -- 14 dígitos, texto (zeros à esquerda)
  varejo TEXT,
  grupo TEXT,
  contratos INT,
  originacao NUMERIC,
  mdr NUMERIC,
  comissao NUMERIC,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mes, origem, retailer_id)
);

CREATE TABLE ume_comissoes_meta (
  mes TEXT NOT NULL,
  origem TEXT NOT NULL,
  total_contratos INT,
  total_originacao NUMERIC,
  total_mdr NUMERIC,
  total_comissao NUMERIC,           -- declarado no cabeçalho da planilha
  arquivo TEXT,
  importado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mes, origem)
);
```

Reimportar o mesmo `(mes, origem)` apaga e regrava as linhas daquele par.

### Import (`POST /api/comissoes/importar`)

- Recebe o xlsx (multipart), parseia a aba RESUMO com a biblioteca `xlsx`
  (SheetJS — nova dependência, uso só de leitura; verificado em 26/08 que o
  projeto não tem lib de planilha).
- Detecta mês/competência pelo cabeçalho ("Competência: Julho 2026" →
  '2026-07') e origem pelo nome do arquivo (contém "FCDL") com fallback pra
  escolha manual na UI.
- Ignora linhas `▸`, `Subtotal`, `TOTAL GERAL` e vazias. CNPJ vem como número
  na planilha → normalizar pra string de 14 dígitos com zeros à esquerda.
- **Validação dura**: soma das linhas de COMISSÃO deve bater com o
  `Total Comissão` do cabeçalho (tolerância R$ 0,05). Se não bater → recusa o
  import inteiro e mostra o delta. Proteção contra planilha truncada/editada.

### Conferência (server-side, no render de `/comissoes`)

Entradas: linhas de `ume_comissoes` do mês selecionado + funil 11 ao vivo
(`getPipeOpportunities(11)` — verificado em 26/08: o payload **traz
`description`**; 409 das 430 contas já têm `UME_RID`/`CNPJ` parseáveis. Uma
chamada só, sem tabela-espelho. Requer estender o mapeamento em
`lib/evotalks.ts` pra expor `description`) + `aiva_desempenho` do mês (aba
AIVA).

Estados por conta do funil 11:

| Estado | Critério |
|---|---|
| ✅ Comissionada | `UME_RID` da descrição casa com `retailer_id` do mês; fallback: CNPJ da descrição casa com `cnpj` do relatório |
| 💤 Sem venda no mês | tem `UME_RID` mas não aparece no relatório do mês |
| ⚠️ Sem Retailer ID | descrição sem `UME_RID:`; se casar por CNPJ, mostra a comissão + botão "gravar Retailer ID" |
| 🆕 Só no relatório | linha do relatório cujo retailer_id E cnpj não casam com nenhuma conta do funil 11 |

Contraprova (aba AIVA): coluna "Data Studio" com aprovados/vendas do
`aiva_desempenho` do mês. Alerta 🔴 quando estado = 💤/⚠️ sem comissão MAS o
Data Studio mostra `vendas > 0` no mês — divergência real pra questionar a UME.

### Escrita do Retailer ID (`POST /api/comissoes/gravar-rid`)

Body: `{ opportunityId, retailerId }`. Lê a opp (`getOpportunity`), monta
`descrição existente + ' | UME_RID: <n>'` (ou insere se vazia) e chama
`/int/updateOpportunity` **só com `id` e `description`** (não tocar em tags —
updateOpportunity substitui arrays). Recusa se a descrição já tem `UME_RID:`
com valor diferente (conflito → resolver manual).

### Tela `/comissoes`

- Cabeçalho: seletor de mês (meses existentes em `ume_comissoes`), botão
  "Importar relatório".
- Cards do mês: Contratos, Originação, MDR, Comissão da aba ativa; card
  destacado "**Valor da NF**" = Comissão Carteira + FCDL do mês (nas duas
  abas, sempre o total — é o número da nota fiscal).
- Comparativo com o mês anterior (Δ% comissão).
- Abas AIVA / UME. Dentro de UME, toggle Carteira | FCDL.
- Tabela com busca (`casaBusca` de lib/text.ts) e cabeçalho fixo (padrão do
  /desempenho): Estado, Loja (funil 11 + varejo do relatório), Retailer ID,
  CNPJ, Grupo, Contratos, Originação, MDR, Comissão, Data Studio (só AIVA),
  ações (gravar RID / abrir conversa via LeadDrawer quando houver lead).
- Filtros rápidos por estado (cards clicáveis: Comissionadas, Sem venda,
  Sem RID, Só no relatório, Divergências 🔴).

### Segurança

- `/comissoes`, `/api/comissoes/:path*` entram no matcher do middleware
  (lição do /clientes).
- Upload só aceita `.xlsx`, tamanho máx. 2 MB, parse em memória.

## Fora de escopo (adiado de propósito)

- Leitura automática do email da UME / alerta "relatório chegou".
- Edição de valores de comissão no painel (fonte é sempre a planilha).
- Snapshot histórico do funil 11 (a conferência de meses antigos usa o funil
  como está hoje — limitação aceita).
- Geração da NF.

## Critérios de sucesso

1. Importar as planilhas reais de julho/26 sem ajuste manual e os totais
   baterem com o email (R$ 39.704,92 + R$ 2.986,76).
2. A conferência de julho reproduzir o que o Aldo achou na mão (as lojas do
   email "Sem-Comissao-Julho26-Funil11.xlsx") — mesmas lojas nos estados
   💤/⚠️.
3. Gravar um Retailer ID pelo painel e ele aparecer na descrição da opp no
   Evo sem perder o texto anterior.
4. Loja com vendas no Data Studio e fora do relatório da UME aparecer com 🔴.
