---
name: destilar-enviar-info
description: Destila as respostas manuais do Nei (botão "Enviar info" do painel) em conhecimento pra VictorIA — gera um digest com sugestões prontas de curadoria e de regra de prompt, aplica só o que o Aldo aprovar. Use quando o Aldo pedir pra "destilar o Enviar info", "aprender com as respostas do Nei", rodar o "destilador", ou na rodada semanal se estiver combinado.
---

# Destilador do "Enviar info" → conhecimento da VictorIA

## O que esta skill faz

As respostas manuais do Nei ficam em `sdr_mensagens` com marcador
`manual via painel` no conteúdo (ou logo após ele, quando o texto vai em
mensagem separada). Elas só beneficiam O PRÓPRIO lead (entram no histórico).
Esta skill fecha o ciclo pros OUTROS leads: minera o que o Nei respondeu,
identifica o que a VictorIA não sabia (ou teria respondido diferente) e
transforma em sugestões de aprendizado — **nada é aplicado sem aprovação
explícita do Aldo**.

## Passo a passo

1. **Janela**: pegar as mensagens `direcao='out'` com `%manual via painel%`
   desde a última rodada. A última rodada fica registrada em
   `docs/destilador-enviar-info.log` (uma linha `RODADA: <iso> | <n> analisadas`)
   — se não existir, usar 14 dias.

2. **Contexto**: pra cada resposta manual, buscar as ~6 mensagens anteriores
   do lead (o que o lojista perguntou e o que a VictorIA tinha respondido
   antes de o Nei intervir). Intervenção do Nei = sinal de que a VictorIA
   não resolveu sozinha.

3. **Destilar** (Claude API, claude-sonnet-4-5, mesmo padrão dos mineradores
   em `scripts/mineracao-*.mjs`): pra cada caso, classificar:
   - `fato_novo` — o Nei informou algo que NÃO está no prompt (prazo, regra,
     contato, procedimento). Candidato a virar REGRA DE PROMPT.
   - `correcao_de_conduta` — a VictorIA respondeu e o Nei corrigiu/refez.
     Candidato a virar ENTRADA DE CURADORIA (pergunta + resposta ruim dela +
     resposta certa do Nei).
   - `caso_pontual` — específico daquele lead (valores, datas, negociação).
     NÃO vira aprendizado; no máximo `instrucao_silvia` daquele lead.
   Agrupar os repetidos (mesmo tema respondido pra N leads = prioridade).

4. **Digest pro Aldo** (no chat, não disparar nada): tabela com tema,
   quantas vezes o Nei respondeu isso, o texto-fonte do Nei, e a sugestão
   PRONTA — pra curadoria: pergunta/resposta_ruim/correção; pra prompt: a
   frase exata e a seção onde entraria. Terminar perguntando quais aplicar.

5. **Aplicar SÓ o aprovado**:
   - Curadoria → insert em `sdr_curadoria` (avaliacao='ruim', correcao=texto
     do Nei adaptado à voz da VictorIA; vincular mensagem_id real quando der).
   - Prompt → editar `prompts/aiva.ts` e **SEMPRE rodar o subagente
     `revisor-prompt-victoria` antes de commitar** (regra da casa).
   - Registrar a rodada no log (passo 1) e commitar.

## Cuidados (aprendidos neste projeto)

- ⛔ Nunca aprender sozinho: improviso do Nei pode estar errado ou datado —
  o Aldo é o filtro de qualidade.
- ⛔ Telefones citados pelo Nei que não estão em FONES_OFICIAIS
  (`lib/text.ts`): se virarem regra, o sanitizador APAGA a frase da resposta.
  Sinalizar no digest quando a sugestão contém telefone/URL fora da whitelist.
- ⛔ Regra nova convivendo com passagem antiga = comportamento alternado.
  Por isso o revisor é obrigatório em qualquer mudança de prompt.
- A curadoria injeta só as 12 correções mais recentes — entrada nova empurra
  a mais antiga pra fora. Se a fila estiver cheia de correções valiosas,
  preferir transformar em regra de prompt (permanente).
- Respostas do tipo "[Info pendente (manual via painel, HSM) — Nome]" são o
  REGISTRO do envio; o texto real pode estar na mensagem seguinte ou só no
  Evo. Ignorar as que não têm conteúdo útil.
