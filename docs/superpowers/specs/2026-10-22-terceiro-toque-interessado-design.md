# Terceiro toque e descarte dos interessados que esgotaram a régua — design

**Decisão do Aldo (22/10/2026):** opção 1 do parecer. Terceiro toque com oferta diferente para quem deu dados ou
conversou de verdade; descarte automático de quem esgotou a régua e está mudo há mais de 60 dias.

## Situação (22/10, banco da AIVA)

- 1.450 leads em INTERESSADO/AGUARDANDO com `[RETOM_INT_FIM]` (2 toques da retomada sem resposta). Nenhuma rotina
  nem pessoa olha para eles.
- 684 têm `[DADOS_COLETADOS:` · 778 mandaram 3+ mensagens · 447 responderam uma única vez.
- Silêncio (última mensagem do lojista): 871 até 30 d · 356 de 30 a 60 d · 223 acima de 60 d.
- A retomada rende 24 % de resposta no 1º toque e 10,5 % no 2º.

## Regras

Tudo é decidido pela **última mensagem do lojista** (`sdr_mensagens`, `direcao='in'`), nunca por
`data_ultimo_contato` (sobe quando NÓS enviamos).

| Situação do lead esgotado (`[RETOM_INT_FIM]`) | Ação |
|---|---|
| Quente (tem `[DADOS_COLETADOS:` **ou** 3+ mensagens `in`), mudo de 7 a 60 d, 8+ d desde o toque 2, sem `[RETOM_INT3:` | **Toque 3** (oferta diferente), orçamento próprio |
| Já levou o toque 3, lojista NÃO respondeu depois dele, 15+ d desde o toque 3 | **Descartar** |
| Já levou o toque 3 e o lojista respondeu depois | Nada (`respondeu_oferta`): a VictorIA/humano conduz |
| Mudo há mais de 60 d (quente ou não) | **Descartar** |
| Não quente, mudo até 60 d | Nada (`esperando_60d`): chega ao descarte sozinho |
| Opt-out, `[PAUSA_ATE]` vigente, `acionar_humano`, importado do portal, CNPJ irregular, telefone 000… | Nada (mesmas exclusões da retomada) |

**Descartar** = `sdr_leads.status='DESCARTADO'`, `acionar_humano=false`, marcador `[DESCARTE_RETOMADA:ISO]` nas
observações, card do Evo movido para **53 Interessado (Sem resposta)** quando houver `evotalks_opportunity_id`.
Se o Evo falhar ao mover, o lead NÃO é descartado nesse dia (mesmo desenho do auto-descarte). O webhook do Evo
não revive o lead: `opportunity-stage` já pula `DESCARTADO` + `SEM_RESPOSTA` (`sub_estado_descartado`).

**Tetos diários:** toque 3 = 100 (rótulo `aiva_retomada_oferta`), descarte = 300. Os dois moram na rota
`retomada-interessado`, que já roda de hora em hora (10h–16h BRT) e já calcula o silêncio de todo mundo; cada
rodada gasta só o que sobrou do dia.

## Oferta diferente (texto do {{2}} do HSM 48 — UMA linha, sem link, < 320 caracteres)

⚠️ Texto a aprovar pelo Aldo antes do deploy. Proposta padrão (não depende de fluxo novo): convite para ver a
ferramenta funcionando numa turma ao vivo da AIVA (seg/qua/sex 9h30).

- Com dados: `Antes de encerrar por aqui, uma proposta diferente: a AIVA faz turmas ao vivo seg, qua e sex às 9h30 mostrando a ferramenta funcionando numa loja de verdade. Quer que eu te mande o link da próxima pra você assistir, sem compromisso?`
- Sem dados: `Antes de encerrar por aqui, uma proposta diferente: em vez de eu explicar, que tal ver a AIVA funcionando ao vivo? Tem turma seg, qua e sex às 9h30. Quer o link da próxima, sem compromisso?`

Alternativa (precisa confirmar que a VictorIA conduz): pedir só o CNPJ para consultar a pré-aprovação.

## Fora de escopo

- Mudar a régua de 2 toques (fica como está).
- Descartar quem nunca entrou na régua (`frio_demais` sem `[RETOM_INT_FIM]`): decisão separada.
- Excluir as automações 80/81 do Evo: passo operacional do Aldo, listado no plano.
