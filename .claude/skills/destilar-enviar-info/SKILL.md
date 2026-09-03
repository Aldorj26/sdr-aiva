---
name: destilar-enviar-info
description: Ciclo de aprendizado AUTÔNOMO da VictorIA (liberado pelo Aldo 03/09) — destila as respostas manuais do Nei (Enviar info) E as conversas que deram certo, aplica curadoria sozinho e regra de prompt só com revisor limpo; manda digest de auditoria pro Aldo/Nei em vez de pedir aprovação. Use quando pedirem pra "destilar", "rodar o destilador", "aprender com as conversas", ou na rodada agendada semanal.
---

# Destilador → aprendizado autônomo da VictorIA

## Modo de operação (decisão do Aldo 03/09)

**Autônomo com auditoria**: nada de pedir aprovação prévia — aplica, registra
e reporta no WhatsApp do Aldo/Nei o que foi aprendido, com instrução de como
reverter ("responda aqui ou apague na /curadoria"). As exceções da seção
ZONAS PROIBIDAS nunca são autônomas.

## Fontes de aprendizado (as duas)

1. **Respostas manuais do Nei** — `sdr_mensagens` com `%manual via painel%`
   desde a última rodada (log em `docs/destilador-enviar-info.log`, linha
   `RODADA: <iso> | <resumo>`; sem log = 14 dias). Intervenção humana = a
   VictorIA não resolveu sozinha.
2. **Conversas que DERAM CERTO** — respostas da própria VictorIA seguidas de
   avanço real do lead: status progrediu (INTERESSADO→PRE_APROVACAO→
   CADASTRO_RECEBIDO→…) logo após, ou o lojista destravou/agradeceu/agiu.
   Buscar nos últimos 14 dias os leads que MUDARAM de status e olhar a
   resposta imediatamente anterior ao avanço.

## Classificação e destino (via Claude API, padrão dos scripts/mineracao-*)

| Achado | Destino | Autônomo? |
|---|---|---|
| Correção de conduta (Nei refez a resposta dela) | `sdr_curadoria` avaliacao='ruim' + correcao (voz da VictorIA) | ✅ sim |
| Jogada vencedora (resposta dela → lead avançou) | `sdr_curadoria` avaliacao='boa' com pergunta+resposta (entra no bloco [JOGADAS QUE DERAM CERTO] do prompt) | ✅ sim |
| Fato novo operacional (prazo, procedimento, canal) | regra em `prompts/aiva.ts` | ⚠️ só se o `revisor-prompt-victoria` voltar SEM contradição ALTA/MÉDIA; senão, parqueia no digest |
| Caso pontual do lead (valores, negociação) | nada (no máximo instrucao_silvia do lead) | — |
| Tema de ZONA PROIBIDA | parquear no digest pro Aldo decidir | ⛔ nunca |

## ZONAS PROIBIDAS (nunca aprender sozinho)

Histórico do projeto justifica cada uma:
- **Telefones/contatos e acusação de golpe** (caso JN Multimarcas: 2 dias
  chamando o número do Nei de golpe). Qualquer regra com telefone/URL fora
  de FONES_OFICIAIS/whitelist → digest, nunca automático.
- **Parcelex** (gate rígido: só loja já vendendo, e por pedido).
- **Promessas de aprovação/prazo/taxa/comissão** (valores mudam; NUNCA
  garantir aprovação).
- **Regras de coleta de dados** (colaboradores/CNPJ — acabaram de mudar).

## Limites por rodada

- Máx **5** entradas 'ruim' + **5** 'boa' novas (a fila do prompt injeta as
  12 'ruim' + 6 'boa' mais recentes — entrada nova empurra antiga pra fora;
  se a fila estiver valiosa, preferir promover a regra de prompt).
- Máx **1** mudança de prompt por rodada (e sempre commit separado).
- Dedupe: não criar entrada de tema que já existe na curadoria ativa.

## Fechamento da rodada (sempre)

1. Gravar `RODADA:` no log + commitar (log, curadoria não é git; prompt sim).
2. Digest WhatsApp pro Aldo e Nei (fluxo openChat/sendMessageToChat dos
   scripts): o que aprendeu (ruins, boas, regra aplicada ou parqueada), com
   "pra reverter: apague na /curadoria ou me chame".
3. Se algo foi parqueado (zona proibida / revisor barrou), listar no digest
   como PENDENTE DE DECISÃO.

## Cuidados herdados

- Revisor obrigatório em QUALQUER edição de prompts/aiva.ts ou blocos de
  lib/claude.ts — sem exceção no modo autônomo.
- "[Info pendente (manual via painel…)]" é registro de envio; o texto útil
  pode estar na mensagem seguinte ou só no Evo — pular os vazios.
- tsc + build antes de commitar mudança de código/prompt.
