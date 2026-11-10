# Auditoria de tokens da VictorIA — 10/11/2026

Fonte: tabela `sdr_token_usage` (toda chamada ao Claude grava modelo, contexto, tokens e custo), 27/10 a 10/11 (14 dias),
cruzada com `sdr_mensagens` e com a montagem do prompt em `lib/claude.ts` / `prompts/aiva.ts`.

## 1. Onde o dinheiro vai

| | 14 dias | por dia | por mês (projeção) |
|---|---|---|---|
| Total | US$ 237,73 | US$ 16,98 | **≈ US$ 510** |
| `processarMensagem` (resposta da VictorIA) | US$ 232,68 (98%) | 4.903 chamadas = 350/dia | |
| Assistente interna (`/assistente`) | US$ 4,80 | 45 chamadas | |
| Retomada/chamado/nome (crons) | US$ 0,24 | 53 chamadas | |

Dia útil: US$ 20–28. Fim de semana: US$ 4–8. Uma chamada da VictorIA por mensagem recebida (383/dia) — não há chamada dobrada.

**Decomposição da chamada da VictorIA (US$ 232,68):**

| Parcela | US$ 14d | % | O que é |
|---|---|---|---|
| Leitura do cache | 92,02 | 39% | 62,5 mil tokens de prompt lidos do cache em TODA chamada (US$ 0,30/M) |
| **Escrita do cache** | **88,51** | **38%** | **350 chamadas (7%) acharam o cache frio e reescreveram 67 mil tokens (US$ 3,75/M = US$ 0,25 cada)** |
| Entrada não cacheada | 41,25 | 17% | bloco dinâmico + instrução de fase + histórico: mediana 2,2 mil tokens, p90 5,5 mil, máx 9,3 mil |
| Saída | 10,91 | 5% | mediana 141 tokens (JSON) — está ótimo |

Leitura: **o prompt cacheado tem ~67 mil tokens** (1.465 linhas, 63 seções, 178 mil caracteres + bloco de curadoria). Ele é pago
inteiro em cada uma das 350 chamadas do dia, e reescrito ~25 vezes por dia porque o cache dura 5 minutos e as mensagens
chegam com intervalos maiores que isso (os misses se espalham das 8h às 20h, não é só madrugada).

## 2. O que NÃO é problema

- Volume de chamadas: 1 por mensagem recebida; dedup, laço de bot e `fromMe` já cortam repetição.
- Saída: `max_tokens` 3000 mas mediana 141; prefill `{` funciona.
- Crons que usam Claude (retomada, nome, chamado): US$ 0,24 em 14 dias.
- Modelo: Sonnet 4.5 em tudo; nada em Opus.

## 3. Alavancas, da mais barata à mais cara

| # | Mudança | Economia/mês | Risco | Esforço |
|---|---|---|---|---|
| A | **Cache de 1 hora (`ttl: '1h'`) + ping de aquecimento a cada 50 min (7h–21h, cron)**. Escrita sobe pra US$ 6/M mas cai de ~25 pra ~3 por dia; o ping custa 1 leitura (US$ 0,02). | **≈ US$ 140** | baixo | 1 h |
| B | Bloco dinâmico: mover o texto FIXO (regras de ACESSOS, avisos de data — 2 mil caracteres) pro prompt cacheado e cachear o bloco data+turmas (muda 1×/dia) num 3º breakpoint. | ≈ US$ 25 | baixo | 1 h |
| C | Instruções de fase enxutas (TREINAR e LOGIN têm 1,2 mil tokens cada, VENDENDO 1,1 mil) e histórico de 30 → 20 mensagens. | ≈ US$ 25 | baixo | 2 h |
| D | **Dieta do prompt: 67 mil → ~35 mil tokens.** Tirar justificativas datadas ("em 21/10 um lojista…"), exemplos repetidos e regras só de fase pós-venda pra quem é prospect. As 4 maiores seções (SUPORTE PÓS-VENDA 17 mil chars, VACINA DA REPROVAÇÃO 13,7 mil, IDENTIDADE 11,9 mil, NÃO PROMETA 9,5 mil) são 30% do prompt. | **≈ US$ 100–130** (mais com A feito, porque sobra a leitura) | médio-alto: cada corte passa pelo `revisor-prompt-victoria` e pelos testes de curadoria | 1–2 dias, em etapas |
| E | Prompt por fase: prospect (FASE 1) não carrega pós-venda, repasse, tickets, campanha (≈ metade do prompt). 3 prefixos cacheados em vez de 1. | parte do D | médio | junto com D |
| F | Experimento: Haiku 4.5 só na FASE 1 (prospecção), via A/B como o `teste-abertura`. Haiku custa 1/3 (leitura de cache US$ 0,10/M). | até US$ 100 se a qualidade segurar | alto (qualidade da abertura é o funil inteiro) | 1 dia + 2 semanas de medição |

**Com A + B + C (baixo risco, ~1 dia): de ≈ US$ 510 pra ≈ US$ 320/mês.** Com D depois: ≈ US$ 200/mês.

## 4. Detalhes técnicos pra quem for implementar

- `lib/claude.ts:887` — `cache_control: { type: 'ephemeral' }` nos dois blocos; SDK `@anthropic-ai/sdk ^0.82` aceita `ttl: '1h'`.
- Ping: rota `GET /api/sdr/aquecer-cache` que chama `messages.create` com o MESMO `system` (prompt + curadoria) e `max_tokens: 1`;
  precisa montar os blocos pela mesma função (extrair `montarSystemBlocks()` de `processarMensagem`), senão o prefixo difere e não aquece.
  Qualquer edição no prompt ou na curadoria invalida o cache (esperado; custa US$ 0,25–0,40 por vez).
- Bloco dinâmico (`lib/claude.ts` ~905–935): o trecho "HOJE / ACESSOS" é fixo exceto a data; separar em (i) cacheado, (ii) data+turmas+Odres
  cacheado com 3º breakpoint (muda à meia-noite), (iii) `{{nome}}`, `{{status_atual}}`, instrução do operador — não cacheado.
- Instruções de fase (`buildFaseInstrucao`, ~310–388): 7,5 mil tokens no total; cada chamada leva uma. TREINAR/LOGIN repetem regras que já
  estão no prompt (acesso do sócio, painel de repasses, trava de aparelho) — manter só o que é específico do status.
- Histórico: `getMensagens(lead.id, 30)` (`webhook/route.ts:965`). Mediana de mensagens por lead em 14 dias é 1; p90 = 7. 20 basta;
  o que importa pra regra (marcadores) já vem pelas observações, não pelo histórico.
- Medir depois: a mesma consulta desta auditoria (contexto × cache_read × cache_creation × input × output por dia) — vale virar aba do
  painel `/atendimento` ou linha do briefing das 5h (US$ do dia anterior, % de miss).
