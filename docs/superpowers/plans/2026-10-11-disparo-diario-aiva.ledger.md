# SDD ledger — plan: docs/superpowers/plans/2026-10-11-disparo-diario-aiva.md

Spec: docs/superpowers/specs/2026-10-11-disparo-diario-automatico-design.md (lido)
Branch: feat/disparo-diario (criado a partir de main @ f1d5eb7)
Prazo: primeira rodada automática 12/10 08h37 BRT

## Ruling de setup

Ruling: trabalhar em BRANCH no checkout principal, não em git worktree — o
`.env.local` é gitignored e tanto os testes quanto o deploy da Task 4
(`npx vercel --prod`, que sobe o conteúdo do diretório) precisam dele; um
worktree subiria sem env e o deploy iria quebrado pra produção. Custo se
errado: o branch compartilha o diretório com qualquer outro trabalho na
máquina — mitigado por `git status` limpo antes de começar.

## Pré-flight scan

### Pares de tarefas que dividem arquivo ou interface

| par | produz → consome | achado |
|---|---|---|
| T1 → T2 | `lib/disparo-diario-calc.ts`: constantes, `Entrega`, `Decisao`, `Resumo`, `decidirRodada`, `textoPausa`, `entregaIndisponivel`, `ehUltimaRodada`, `textoResumoDia` → T2 importa tudo e ACRESCENTA `marcarResultados` no mesmo arquivo | ⚠️ T2 declara `resumoDoDia(): Promise<{saiuHoje;restante;filaPendente;pausado;entrega}>` em vez de `Promise<Resumo>`, que é o tipo que a T1 define. Mesma forma, nome solto. |
| T1 → T3 | `Resumo` e `Entrega` → T3 declara `textoStatusDisparo(r: Resumo & { pausado_em; motivo })` | ok — T3 acrescenta a função ao calc, não redefine o tipo |
| T2 → T3 | `lerEstado`, `pausar`, `retomar`, `resumoDoDia` → os três comandos | ok — os quatro estão no bloco Produces da T2 |
| T2 → T4 | JSON da rota (`fila_pendente`, `enviados`) → linha do vigia `fila: (j) => n(j.fila_pendente)`, `acao: (j) => n(j.enviados)` | ok — os dois campos estão na resposta especificada |
| T1 → T4 | nenhum arquivo em comum | ok |
| T3 → T4 | nenhum arquivo em comum | ok |

### Consistência interna de cada tarefa

| tarefa | tests × código × arquivos | achado |
|---|---|---|
| T1 | 16 testes listados × 9 símbolos em Produces × 4 arquivos | ⚠️ Step 5 manda criar `supabase/migrations/…` — esse diretório NÃO existe neste repo |
| T2 | 2 testes novos no calc × `marcarResultados` + rota × 2 arquivos criados | ok — Step 1 corrigido para escrever no test do calc, não em arquivo novo |
| T3 | 4 testes de texto × 3 comandos × 1 arquivo modificado + calc | ok |
| T4 | sem teste próprio; passos 4 e 5 são verificação manual em produção | ok — é tarefa de agendamento, o gate é a rodada de 20 observada |

### Rulings do scan

Ruling: a migração vai em `docs/sql/2026-10-11-disparo-estado.sql`, não em
`supabase/migrations/`. O repo não tem esse diretório; a convenção real é
`docs/sql/YYYY-MM-DD-<assunto>.sql` (dois precedentes, de 09/09). Custo se
errado: arquivo no lugar errado, renomear é trivial.

Ruling: `resumoDoDia()` da T2 devolve `Promise<Resumo>`, usando o tipo
exportado pela T1 — não uma forma anônima equivalente. Custo se errado: o
tipo duplica e a T3 pode divergir do que a T2 devolve.

---

## Progresso
Task 1: dispatched (sonnet) — BASE f1d5eb7 — brief task-1-brief.md, report task-1-report.md
Task 1: implementada — commit 40dce15, 17/17 testes, tsc limpo. Verificado por mim:
  commit existe, arquivos batem, testes rodados de novo (17/17, saída limpa),
  tabela sdr_disparo_estado existe em produção com 1 linha e DDL idempotente.
Task 1: concerns do implementador — (a) diaBrt não importado: PROCEDE, o calc deriva
  hora/dia por Intl e quem precisa da string do dia é a Task 2; (b) texto do
  textoResumoDia não vem do spec; (c) tabela sem RLS.
Task 1: review dispatched (sonnet) — pacote review-f1d5eb7..40dce15.diff

Ruling: o `npx vercel --prod` da Task 4 e a rodada de 20 disparos em produção NÃO
vão para subagente — faço no sessão controladora. Deploy e envio real de WhatsApp
são efeito externo; subagente despachado já teve um relatório bloqueado por
"Production Deploy" nesta execução, e delegar o deploy tiraria o humano do laço
justamente no passo que existe para ter humano no laço. Custo se errado: a Task 4
anda mais devagar porque passa por mim.

Ruling: a instrução sobre `diaBrt` migra para o dispatch da Task 2 — é lá que a
contagem do dia precisa da string do dia em BRT. Custo se errado: a Task 2
reimplementa uma função que já existe testada.
Task 1: review 1 — spec compliant; 1 Important (RLS ausente na sdr_disparo_estado,
  rotulado plan-mandated), 4 Minor.

Ruling: o achado de RLS VENCE o texto do plano. O spec omitiu RLS no DDL, não
  mandou que não houvesse — e o requisito vinculante do spec é "a pausa só volta
  com /retomar". Confirmei empiricamente: a chave ANÔNIMA (pública, vai no bundle)
  lê sdr_disparo_estado hoje. Com RLS desligada o mesmo grant permite escrever, ou
  seja, qualquer um com a chave pública desfaz uma pausa de entrega em silêncio.
  Entra no fix round 1. Custo se errado: uma linha de DDL a mais numa tabela que
  só o service_role precisa acessar.

Ruling: PROMOVO o Minor "testes não cobrem as bordas da janela (8h00 e 18h59)"
  para o fix round 1. A guarda de janela é uma das duas únicas coisas que impedem
  disparo em massa fora do horário comercial, e um teste que passaria com um
  off-by-one nessa guarda não testa a guarda. Custo se errado: dois casos de teste
  a mais num round que já estava acontecendo.

Task 1: minor (deferred): assert fraco em textoResumoDia — '20' como substring solta
Task 1: minor (deferred): motivo da pausa duplica a linha 2 de textoPausa (duas edições
  para uma mudança de texto)
Task 1: minor (deferred): guarda cobre só sábado/domingo, não feriado
Task 1: fix round 1/5 (2 corrigidos no commit 7c7e695: RLS no SQL + bordas 8h00/18h59;
  18/18 testes; implementador fez mutação das guardas para provar que o teste novo pega)
Task 1: RLS APLICADA EM PRODUÇÃO por mim (apply_migration disparo_estado_enable_rls,
  projeto axkrorkhnkfkpbjikwrb). Verificado: anon recebe [] em leitura e update afeta
  0 linhas; service_role lê a linha intacta (pausado=false). Buraco fechado.
Task 1: re-review 1 dispatched (sonnet) — pacote review-40dce15..7c7e695.diff
Task 1: re-review 1 — 2/2 ADDRESSED, sem breakage novo
Task 1: complete (commits f1d5eb7..7c7e695, review clean, 3 minor deferred)
Task 2: dispatched (sonnet) — BASE 7c7e695 — brief task-2-brief.md, report task-2-report.md
Task 2: implementada — commit b0a75b5, 20/20, tsc limpo. Verificado por mim: produção
  intocada (estado inalterado, 0 disparados hoje, 0 aiva_campanha hoje).
Task 2: concerns do implementador — (1) lead bloqueado pelo send-initial vira ERRO (o
  script antigo marcava DUPLICADO); (2) resumo das 18h sai em fim de semana também —
  cron é seg-sex, inócuo; (3) resumoDoDia ganhou 2º arg opcional (entrega já medida);
  (4) timeout de 45s por lote. Concern 1 vai para o revisor julgar, sem pré-julgamento.
Task 2: review dispatched (opus — é a rota que envia de verdade) — pacote review-7c7e695..b0a75b5.diff
Task 2: review 1 — spec ✅ no papel; 2 Important (I-1 timeout de 45s por lote aborta
  praticamente todo lote real; I-2 Evo PENDURADO ainda mata a rodada), 10 Minor, e um
  achado acima da tarefa: o revisor mediu em produção (sdr_mensagens, somente leitura)
  ~10-13 s por lead no D+0, janelas de 5 envios em 48-75 s — o spec assumiu ~5 s.
  Com 11 rodadas de 240 s isso dá ~150/dia, não 500.

Ruling: a MEDIÇÃO vence a estimativa do spec. O ~5 s veio da retomada (CLAUDE.md), que
  só manda template; o send-initial cria lead + oportunidade no Evo + template, e o
  revisor mediu 5 envios em 48-75 s nos últimos 14 dias. O spec já previa a alavanca
  certa ("sobe-se o número de rodadas, não o teto por rodada"). Cron passa de
  `37 11-21 * * 1-5` para `7,27,47 11-21 * * 1-5` — 33 rodadas de 20 em 20 min,
  8h07-18h47 BRT, nenhum múltiplo de 5, 240 s < 20 min logo sem sobreposição. A ~14
  leads/rodada dá ~460; o orçamento de 500 é teto, não meta. Vai para o dispatch da
  Task 4 e para o spec. Custo se errado: rodadas de sobra que saem sem fila (inócuo)
  ou 500 não alcançado no 1º dia (a 1ª semana é de medição mesmo).

Ruling: com 3 rodadas na hora das 18h, `ehUltimaRodada` (hora === 18) dispararia o
  resumo 3x. Passa a exigir hora 18 E minuto >= 40 — só a rodada das 18h47. Acoplado
  ao minuto do cron, documentar no código. Custo se errado: resumo duplicado ou ausente.

Ruling: PROMOVO M-1 (bloqueado_* → ERRO em vez de DUPLICADO) para o fix round. Não é
  cosmético: é o caminho de recuperação do I-1 — lote abortado deixa PENDENTE, a rodada
  seguinte reenvia, o send-initial recusa como bloqueado_*, e o lead que FOI enviado
  tem que ficar DUPLICADO (="já na base"), não ERRO. Custo se errado: um status a mais
  na fila, que o script antigo já usava.

Task 2: minor (deferred): M-2 resumo sai em fim de semana se alguém chamar às 18h
Task 2: minor (deferred): M-4 cauda de tempo — coberto pelo corte dinâmico do I-1
Task 2: minor (deferred): M-5 exceção em resumoDoDia vira 500 e perde `enviados`
Task 2: minor (deferred): M-6 fila_pendente subtrai só enviados, não falhas
Task 2: minor (deferred): M-7 sem lock entre rodadas sobrepostas — PARA A REVISÃO FINAL
Task 2: minor (deferred): M-8 linha de estado ausente = "não pausado" (DDL semeia a linha)
Task 2: minor (deferred): M-9 ?qtd=abc vira 0; CRON_SECRET ausente aceita "Bearer undefined"
Task 2: minor (deferred): M-10 sem teste para "erro sem detalhe" nem bloqueado_* no marcarResultados
Task 2: nota p/ revisão final: lead morto entre upsert e sendTemplate no send-initial fica
  INICIO sem mensagem e é recusado para sempre — propriedade pré-existente do send-initial
Task 2: fix round 1/5 dispatched (resume do implementador) — I-1, I-2, M-1 promovido, ehUltimaRodada 18h40+; spec corrigido em 9a51b60
Task 2: fix round 1/5 (4 corrigidos no commit 75519a9; 21/21; tsc limpo — verificado por mim)
Task 2: re-review 1 dispatched (opus) — pacote review-b0a75b5..75519a9.diff
Task 2: re-review 1 — 4/4 ADDRESSED, sem breakage novo. Nota do revisor: com guarda de
  100 s cabem 10-15 leads/rodada → 330-495/dia em 33 rodadas (spec no lado otimista).
Task 2: minor (deferred): alertHuman→sendText (lib/evotalks.ts:550) sem timeout; Evo
  pendurado no resumo das 18h47 pode passar de 300 s — pré-existente, PARA A REVISÃO FINAL
Task 2: complete (commits 7c7e695..75519a9, review clean, 8 minor deferred)
Task 3: dispatched (sonnet) — BASE 75519a9 — brief task-3-brief.md, report task-3-report.md
Task 3: implementada — commit 59d9353, 27/27, tsc limpo. Verificado por mim: estado de
  produção intocado. Concerns: 2 textos extras (textoPausadoAgora/textoJaPausado, com
  teste) para o /pausar repetido; corrida mínima em /pausar simultâneo (banco fica certo).
Task 3: review dispatched (sonnet) — pacote review-75519a9..59d9353.diff
Ruling (pré-Task 4): a linha do vigia no plano (`acao: (j) => n(j.enviados)`) está
  ERRADA. O vigia roda às 17h BRT e lê o `?dry` de cada rota — e `?dry` do disparo
  não envia nada, logo `enviados` é SEMPRE 0 no que o vigia vê → alarme falso todo
  dia a partir do 2º. É o mesmo defeito que a biometria/cobrança tiveram em 24/09
  (por isso elas expõem `tocados_hoje`). A rota já devolve `saiu_hoje` (contagem de
  sdr_mensagens do dia), que é o sinal certo de "a rota agiu hoje". Task 4 usa
  `acao: (j) => n(j.saiu_hoje)`. Custo se errado: vigia cego para o disparo (mas o
  resumo das 18h47 e o /disparo cobrem).
Task 3: review 1 — spec PASS, 0 Important, 3 Minor
Task 3: minor (deferred): status com sem_dados diz "(sem envio confirmado hoje)" mesmo
  quando a causa é Evo indisponível — usar r.entrega.motivo
Task 3: minor (deferred): /disparo pode esperar até 60 s pela medição do Evo dentro do
  webhook, sem aviso intermediário
Task 3: minor (deferred): cmdDisparo lê o estado 2x (resumoDoDia + lerEstado); janela de ms
Task 3: complete (commits 75519a9..59d9353, review clean, 3 minor deferred)

Ruling (Task 4, passo 4): a rodada observada de 20 NÃO pode ser hoje — é domingo, e tanto
  a rota (fim_de_semana) quanto o send-initial barram. Em vez do `?qtd=20` por curl, o
  deploy sobe com o estado PAUSADO (motivo "aguardando /retomar do Aldo na 1ª manhã"):
  às 8h07 de segunda o cron roda e vê pausado → nada; o Aldo manda /disparo (vê a
  pausa), /retomar, e a rodada das 8h27 envia ~10-15 — gate menor que 20, e exercita
  em produção exatamente a alavanca que ele vai ter na viagem. Custo se errado: se ele
  esquecer o /retomar, segunda não dispara (o /disparo e o alerta de pausa avisam).
Task 4: dispatched (sonnet, SÓ edição de arquivos — deploy/DB/curl são meus) — BASE 59d9353
Task 4: edições implementadas — commit fb556eb (vercel.json + vigia); CLAUDE.md editado
  em disco. Verificado por mim: JSON válido, cron 7,27,47, vigia com saiu_hoje.
Ruling: CLAUDE.md fica FORA do git, como sempre esteve — é gitignored (.gitignore:9)
  porque carrega chaves em texto puro. O implementador acertou ao NÃO forçar. Custo se
  errado: a documentação vive só nesta máquina (já é assim para todo o arquivo).
Task 4: review dispatched (sonnet) — pacote review-59d9353..fb556eb.diff
Task 4: review 1 — spec PASS, 0 Important, 4 Minor. Revisor confirmou: saiu_hoje às 17h
  é sinal justo; pausa que atravessa p/ o 2º dia dispara o vigia (tolerância 2) — é
  cobrança legítima, não alarme falso.
Task 4: minor (deferred): doc diz "parada aos 240 s" — na prática lote novo só começa
  com ≥100 s restantes (trabalho real para em ~140-200 s)
Task 4: minor (deferred): doc do vigia podia dizer que pausa no 2º dia dispara o alerta
Task 4: minor (deferred): ?dry do disparo roda conferirEntregaHoje (~20 s, teto 60 s)
  dentro do laço do vigia; entrada é a última, seria a primeira cortada se o vigia estourar
Task 4: minor (deferred): resumo imprime "Fila: N pendentes", doc não menciona
Task 4: complete — edições (commits 59d9353..fb556eb, review clean, 4 minor deferred).
  Passos 3-5 (deploy, rodada observada, exercício de WhatsApp) são meus e vêm DEPOIS da
  revisão final do branch.
Final: review dispatched (opus) — merge-base f1d5eb7 → HEAD fb556eb
Pré-deploy (verificado por mim, `vercel env ls production`): CRON_SECRET, WEBHOOK_SECRET,
  ALDO_WHATSAPP, NEI_WHATSAPP, EVO_TALKS_*, SUPABASE_* existem em Production. APP_URL
  NÃO existe — a rota cai no fallback `https://sdr-aiva.vercel.app`, que é o alias real
  de produção. Não bloqueia.
Final: review — 0 Critical, 6 Important (I-1 /retomar re-pausa em 20 min porque a amostra
  é "o dia inteiro"; I-2 alerta diz "78% — piso 30%" no caso "parou agora"; I-3
  sdr_fila_disparo SEM RLS, anon lê/escreve/insere — vira entrada de um disparador
  sem vigilância; I-4 alerta/resumo são texto livre, fora da janela de 24h a Meta
  descarta sem erro; I-5 feriado: 12/10 É FERIADO (N. Sra. Aparecida), 02/11 também;
  I-6 sem lock, script manual ignora pausa e orçamento). Veredito: deploy hoje COM
  correções; I-1/I-4/I-5/lock/timeout obrigatórios antes de 30/10.

Ruling: onda de correção ÚNICA hoje com I-3 (RLS na fila — edito o SQL via subagente,
  APLICO eu), I-2 (texto do alerta usa entrega.motivo; fecha também o Minor T1-2),
  I-1 PROMOVIDO para hoje (é a alavanca central; ~10 linhas + teste; `desde`
  opcional em conferirEntregaHoje não muda o vigia), e os dois avisos de doc (I-6:
  nunca rodar o script manual com o cron armado; I-4: durante a viagem responder o
  briefing das 5h todo dia útil para manter a janela aberta). Custo se errado: deploy
  um pouco mais tarde hoje — a 1ª rodada é só às 8h07.
Ruling: antes de 30/10 (plano próprio, fora desta execução): I-4 por HSM (template
  reabridor), I-5 conjunto FERIADOS no calc, I-6 lock por chave de slot em
  sdr_avisos_chave, timeout de ~20 s no alertHuman com envio em paralelo, M-a (/pausar
  interrompe rodada em curso), M-b (não medir entrega quando a decisão não depende).
Ruling: 12/10 é feriado — a decisão de retomar é do Aldo; vou recomendar /retomar na
  TERÇA 13/10 (loja fechada = entrega ruidosa = risco de pausa falsa no 1º dia).
Ruling: faço merge LOCAL em main antes do deploy (um deploy futuro a partir de main sem
  o branch apagaria a rota e o cron); NÃO faço push — é ação externa, pergunto ao Aldo.
Final: fix wave dispatched (sonnet) — FIX_BASE fb556eb — report final-fix-report.md
Pré-deploy: estado de produção gravado como PAUSADO por mim (service_role), com
  pausado_em=now e motivo "deploy de 11/10 — aguardando /retomar do Aldo". Inócuo
  antes do deploy (nada em produção lê a tabela ainda); garante que a rodada das
  8h07 de segunda não envia nada sem um humano mandar.
Final: fix wave — commit 2ad7445 (I-1, I-2, I-3 + docs); 34/34; tsc limpo — verificado por mim
Final: RLS da sdr_fila_disparo APLICADA EM PRODUÇÃO por mim (apply_migration
  fila_disparo_enable_rls). Verificação abaixo no mesmo passo.
Final: re-review dispatched (opus) — pacote review-fb556eb..2ad7445.diff
  → verificado: anon lê 0 linhas e INSERT negado (42501); service_role segue lendo 29.318 PENDENTE. Buraco fechado.
Final: re-review — I-1, I-2, I-3, Docs: 4/4 ADDRESSED; sem breakage novo. Vigia inalterado.
Final: minor (deferred): amostra de entrega conta todo template do dia, não só aiva_campanha
Final: minor (deferred): erro da query `outs` em conferirEntregaHoje é ignorado
Final: minor (deferred): ".." em textoStatusDisparo quando motivo termina em ponto
Final: minor (deferred): teste do inicioEfetivoDaAmostra rotula 01:00Z como "21h BRT" (é 22h);
  a fronteira exata 03:00Z não está pinada
Final: review clean → merge local em main e deploy (pausado).
DEPLOY: main 4c4c65a → sdr-aiva-64fciaaus (READY), aliases sdr-aiva.vercel.app (+ sdr-agente).
  Estado em produção: PAUSADO. Verificação do ?dry logo abaixo.
  → verificado em produção: ?dry com Bearer = 200 {acao:nada, motivo:fim_de_semana (domingo
    vence pausado na ordem das guardas), fila_pendente:29318, entrega:sem_dados}; sem Bearer = 401.
PLANO CONCLUÍDO. Workspace apagado após coleta dos rulings.
