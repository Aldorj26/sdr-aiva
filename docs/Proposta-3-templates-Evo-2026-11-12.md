# Proposta: 3 templates para o dia a dia com quem já é parceiro (AIVA) — 12/11/2026

Objetivo: substituir os 8 templates que a Meta reclassificou (21, 31, 32, 48, 35, 38, 39 e similares) por
**1 template principal + 2 coringas**, todos com texto fixo suficiente para ficarem em UTILITY e sobreviverem
à releitura da Meta. Os três são para **loja que já é parceira ou já está em cadastro** (relação existente).
Prospecção fria (D+0, template 41) fica fora desta proposta.

Por que o 48 caiu: a Meta classifica pelo conteúdo real. "Oi {{1}}, tudo bem? {{2}} É só responder" não tem
âncora de conta/transação; o que vai no {{2}} (Black November, dicas, cobrança) é que define a categoria.
Regra de desenho usada abaixo: o texto fixo diz **de quem é, sobre qual loja, e que tipo de aviso é**; a variável
só completa o fato.

---

## T1 — Principal: `aiva_comunicado_parceiro` (UTILITY)

Uso: mudança de regra, condição, processo ou acesso que afeta a conta da loja (nova tabela de comissão permanente,
mudança no portal, novo horário de atendimento, nova etapa no cadastro, manutenção).

```
Olá {{1}}, aqui é a VictorIA, da Track, parceira oficial AIVA.

Comunicado para a loja {{2}}: {{3}}

{{4}}

Vale a partir de {{5}}. Dúvidas, é só responder esta mensagem.
```

| Var | Conteúdo | Exemplo (amostra para submissão) |
|---|---|---|
| {{1}} | nome do contato | Kaio |
| {{2}} | nome fantasia da loja | KR Infocell |
| {{3}} | título do comunicado (até 80 caracteres) | nova tabela de repasse de vendas |
| {{4}} | detalhe em 1 frase (até 200 caracteres) | O repasse passa a cair em D+1 para vendas aprovadas até as 15h. |
| {{5}} | data | 01/12/2026 |

**Irmão gêmeo em MARKETING:** `aiva_novidade_parceiro`, mesmo corpo com "Novidade para a loja {{2}}" no lugar de
"Comunicado". Serve para o que é promoção ou incentivo por tempo limitado (Black November, bônus de comissão,
campanha de vendas). Custa mais, mas não contamina o UTILITY. O sistema escolhe o template pela natureza do
aviso (flag no painel ou lista de palavras, ver "Regras no código").

---

## T2 — Coringa de status: `aiva_atualizacao_loja` (UTILITY)

Uso: a loja avançou ou algo foi concluído e o lojista precisa saber. Biometria aprovada, treinamento liberado,
acesso liberado, cadastro aprovado, ticket resolvido, venda repassada, documento recebido.

```
Olá {{1}}, aqui é a VictorIA, da Track, sobre a loja {{2}} na AIVA.

Atualização: {{3}}

Próximo passo: {{4}}

Qualquer dúvida, responda esta mensagem.
```

| Var | Conteúdo | Exemplo |
|---|---|---|
| {{1}} | nome do contato | Maria |
| {{2}} | nome fantasia | Planeta Cell |
| {{3}} | fato concluído (até 160 caracteres) | sua biometria foi aprovada e o cadastro seguiu para análise de documentos |
| {{4}} | o que fazer agora (até 160 caracteres) | nada por enquanto; aviso aqui quando a análise terminar |

---

## T3 — Coringa de pendência: `aiva_pendencia_loja` (UTILITY)

Uso: tudo que está parado esperando o lojista. Documento faltando, código de 6 dígitos, senha pendente, acesso
pendente, retomada de cadastro parado, agendar treinamento, confirmar dado.

```
Olá {{1}}, aqui é a VictorIA, da Track. O cadastro da loja {{2}} na AIVA está aguardando uma ação sua.

Pendência: {{3}}

Prazo: {{4}}

Responda esta mensagem para resolver.
```

Botões de resposta rápida (opcionais, ajudam na taxa de resposta e abrem a janela com um toque):
`Resolver agora` · `Preciso de ajuda`

| Var | Conteúdo | Exemplo |
|---|---|---|
| {{1}} | nome do contato | Kaio |
| {{2}} | nome fantasia | KR Infocell |
| {{3}} | o que falta (até 160 caracteres) | enviar o código de 6 dígitos que chegou no seu e-mail |
| {{4}} | prazo ou consequência | até sexta, 14/11; depois o cadastro é reiniciado |

Para loja já ativa (não é cadastro), a Evo pode aprovar uma variação `aiva_pendencia_conta` trocando
"O cadastro da loja" por "A conta da loja". Se quiser manter só três, usar "A loja {{2}} na AIVA está aguardando
uma ação sua" que serve para os dois casos.

---

## O que mapeia para onde (hoje → proposta)

| Hoje | Vai para |
|---|---|
| 48 coringa: retomada, cobranças, avisos de etapa | T3 (pendência) ou T2 (status) |
| 48 coringa: Black November, dicas, incentivos | `aiva_novidade_parceiro` (MARKETING) |
| 48 coringa: alertas Aldo/Nei | continua no 48 ou num template interno; número de vocês, risco zero |
| 69/70 treinamento liberado | T2 com {{3}} = "sua loja foi liberada para o treinamento" e {{4}} = link/agenda |
| 29 loja pré-aprovada, 34 link de cadastro | T3 ({{3}} = "finalizar o cadastro no link ...") |
| 21, 31, 32, 35, 38, 39 | descontinuar |

Templates que ficam: 41 (D+0 prospecção), T1, T2, T3, gêmeo MARKETING de T1. Cinco em vez de treze.

## Regras no código (`lib/evotalks.ts`, antes do `/int/sendWaTemplate`)

1. Se a última mensagem do lojista tem menos de 24 h, **não manda template**: manda texto de sessão (grátis).
2. Sanitizar variáveis: sem quebra de linha, sem 4 espaços seguidos, limite de caracteres por variável (Meta recusa
   e a Evo devolve erro HTML, como nos 66 da Novembro Black).
3. Lista de bloqueio nas variáveis dos UTILITY: promoção, desconto, oferta, aproveite, ganhe, bônus, grátis,
   última chance, só hoje, %, R$ acima do que for repasse real. Se bater, o envio vai para o gêmeo MARKETING ou é
   barrado com aviso no painel. É isso que impede o T2/T3 de virarem o 48 de novo.
4. Rótulo `template_hsm` por template, para medir custo e taxa de resposta de cada um.

## Para a submissão (Gustavo/Evo)

- Nome com significado (`aiva_pendencia_loja`), não nome reciclado. Nome de "validação de pedido" com corpo de
  outra coisa é sinal para a revisão da Meta.
- Amostras de variável realistas e operacionais, como as tabelas acima. A Meta classifica pela amostra.
- Categoria UTILITY nos três; MARKETING só no gêmeo. Se a Meta devolver T1 como MARKETING, aceitar e usar T2 para
  o que for atualização de conta; não insistir em recurso.
- "Abertura pelo agente" LIGADO nos três (reabrem janela de 24 h).

## Espelho para a Parcelex (Patricia, fila 21)

Mesmos três corpos, trocando "VictorIA, da Track, parceira oficial AIVA" por "Patricia, da Track, canal oficial
Parcelex" e "na AIVA" por "na Parcelex". Nomes `parcelex_comunicado_lojista`, `parcelex_atualizacao_loja`,
`parcelex_pendencia_loja`. O `parcelex_reabridor_conversa` pendente desde julho tem o mesmo corpo do 48 e deve
cair pelo mesmo motivo; substituir pelo T3 antes de o Gustavo submeter.
