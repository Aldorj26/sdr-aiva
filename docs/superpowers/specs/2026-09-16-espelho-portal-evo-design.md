# Espelho Portal AIVA → Evo (Fase 1, passo 1)

**Data:** 16/09/2026 · **Decisão:** Aldo ("pode começar o espelho portal → Evo")
**Objetivo:** tirar do Nei o arrasto manual dos cards pós-cadastro. O portal da AIVA
vira a fonte dos eventos; o Evo continua sendo a fonte da verdade das etapas
(o painel espelha o Evo, como hoje).

## Como funciona

Cron `/api/sdr/espelho-portal` a cada 15 min (`*/15 * * * *`):

1. Lê os onboardings da Track na **API pública** do parceiro (chave `AIVA_PORTAL_API_KEY`).
2. Lê `login_sends` (senha enviada) e `retailer_performance` (vendas) no **banco do portal**
   com o login do site. Se esse acesso falhar, a rodada segue só com a API (ninguém
   sobe pra Login/Vendendo) e nada quebra.
3. Cruza CNPJ → lead (`sdr_registros_cnpj.lead_id`) → opp (`sdr_leads.evotalks_opportunity_id`)
   e lê a etapa atual de todas as opps abertas do funil 15 numa chamada só.
4. Decide (função pura `calcularEspelho`) e executa.

## Regras

| Portal | Card vai pra |
|---|---|
| `stage` dados_varejo ou biometria (pré-cadastro aprovado) | 50 Em Análise |
| `stage` cadastro_finalizado (tem `retailer_id`) | 70 Treinar |
| `login_sends.credentials_sent_at` preenchido | 71 Login |
| alguma linha com `n_vendas > 0` em `retailer_performance` | 51 Vendendo |
| `stage` not_approved (e nenhum outro CNPJ do lead avançou) | **95 "Loja Descartada pela Aiva"** (etapa criada pelo Aldo 16/09, sem automação) + lead `NAO_QUALIFICADO`; marca `[PORTAL_REPROVADO:ISO]` e avisa Nei + Aldo uma vez. Vale de qualquer etapa/status (menos OPT_OUT); se o lead voltar a falar, o webhook 4c avisa o time |

- **Só avança.** Ordem linear 66 → 47 → 54 → 49 → 50 → 70 → 71 → 51 (a mesma do
  `changeStageSeAvanco`). Sem Resposta (53) pode avançar. Bot (69), Menos de 1 Ano (93)
  e CNPJ Irregular (94) nunca são tocados. Leads OPT_OUT / NAO_QUALIFICADO / DESCARTADO /
  BOT_DETECTADO nunca são tocados.
- **Destino ≥ Treinar passa por 70** (a automação do Evo manda o HSM 69 com o link do
  treinamento). **Nunca passa por 50** quando o destino é além (o HSM 34 pede pra preencher
  um formulário que já foi preenchido).
- Lead com matriz + filiais: vale o CNPJ mais avançado.
- Registro `informada` cujo CNPJ já está no portal → `pre_cadastro_enviado`, `enviado=true`,
  `origem='portal'` (o Nei não marca mais o checkbox no /registros).
- Marcador `[ESPELHO_PORTAL:<etapa>:<ISO>]` nas observações do lead a cada movimento.
- Teto: 30 movimentos ou 200 s por rodada; o resto entra na próxima.

## Por que só mover o card basta

Mover pela API **dispara a automação do Evo**: na ação em massa de 11/09, 15 movimentos
via `/int/changeOpportunityStage` geraram 15 webhooks em `/api/sdr/opportunity-stage`
no mesmo minuto (`webhook_debug`). Então HSM de aprovação (50), HSM de treinamento (70),
status LOGIN (71), relógio da consultoria (51) e os avisos de etapa ao Nei/Aldo saem pelos
handlers que já existem. O espelho **não** chama a rota e **não** fala com o lojista —
chamar a rota duplicaria o HSM.

## O que NÃO faz (ainda)

- Não avisa o lojista da reprovação (só o time) — decisão pendente do Aldo.
- Não cobra formulário pendente, não envia biometria, não inscreve em turma (passos 3–5).
- Não cria pré-cadastro (Google Forms exige login — pergunta 17 da reunião).

## Arquivos

- `lib/espelho-portal-calc.ts` — regras, puro. Testes: `npm run test:espelho`.
- `lib/espelho-portal.ts` — IO (portal, Supabase, Evo, WhatsApp).
- `app/api/sdr/espelho-portal/route.ts` — cron (GET/POST, `?dry=1`).
- `lib/portal-aiva.ts` — `listarOnboardingsApi()` (compartilhada com o backfill de RID) e `rest` exportado.
