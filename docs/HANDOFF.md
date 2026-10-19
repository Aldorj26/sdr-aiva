# HANDOFF — SDR AIVA

> Documento vivo. **Leia ao abrir a sessão; atualize ao encerrar (`/handoff`).** Substitui carregar o histórico da
> conversa anterior: aqui vai o que foi feito, o que está em aberto e o próximo passo — nada mais.

## Estado de produção (19/10/2026)

- **Disparo D+0: entrega baixa AVISA, não pausa mais** (`de61461`). O piso de 30% e o disjuntor de envio continuam
  medindo, mas só mandam alerta (coringa 48 + texto) pra Aldo e Nei, 1×/hora BRT. **Só `/pausar` ou o botão do
  painel param o dia.** Decisão do Aldo em 19/10: "preciso dos 500 na manhã, sempre; se tiver ruído, não pausar".
  ⚠️ Custo aceito: apagão tipo 21/09 (fatura recusada) não se contém sozinho — quem recebe o aviso confere a
  fatura da Meta.
- **Ritmo 3× maior**: `PARALELO = 3` em `lib/disparo-diario-calc.ts` — 3 lotes de 5 em paralelo, ~30 envios por
  rodada (~360/h) contra ~120/h antes. Cada lote já era um POST próprio ao `send-initial`, então o paralelismo é
  entre invocações da Vercel e o `send-initial` não mudou. Medido em produção: rodadas de 10 → 30 envios.
- **Planilha "AIVA APROVAÇÃO" e HubSpot saíram do fluxo** (`4419313`, `8713030`). Os 4 pontos de envio e as duas
  funções foram removidos. Os dados do lojista seguem indo pro formulário da oportunidade no Evo
  (`updateOpportunityForms`), que é o que o Nei lê. ⏳ **As variáveis `GOOGLE_SHEETS_WEBHOOK_URL`,
  `HUBSPOT_PORTAL_ID` e `HUBSPOT_FORM_GUID` continuam na Vercel sem nenhum leitor — o Aldo remove.**
- **Biometria reprovada: a VictorIA coleta documento + selfie** (`06d39a0`). Ela avisa a reprovação e pede **uma
  foto de cada vez — primeiro o documento com foto do sócio, depois a selfie** (o pipeline entrega só 1 imagem por
  turno; duas seguidas caem no lock de 60s e a segunda é descartada). Com as duas: `acionar_humano` +
  `motivo_humano = "biometria_docs_recebidos"`. Não manda mais refazer pelo link.
  ⚠️ **As fotos ficam na Evo e a exclusão LGPD não as apaga** — a orientação do Nei manda apagar após encaminhar.
- Cron de biometria negada (`mioloNegada`) **continua desligado** (`ENVIO_NEGADA_ATIVO = false`) e o texto dele
  ainda manda refazer pelo link. ⛔ Não ligar sem reescrever. A dúvida que o travava (o link reabre?) deixou de
  importar: o caminho novo não usa link.
- **Painel é PWA** instalável no iPhone (`7d86b65`, `f546b31`): Safari → Compartilhar → Adicionar à Tela de Início.
- A FASE 3 acabou em 17/10: 4 campos (nome e telefone do sócio, nome da loja, CNPJ matriz). Stage 49 = cadastro
  completo, com o coringa 48.
- `send-initial` **sem autenticação** e grava o lead antes de enviar o template — Aldo decidiu NÃO mexer agora.
- Hook de fim de sessão não faz push. **Push na `main` = deploy em produção.**

## Feito nesta sessão (19/10)

- Investigado "o disparo está lento": **não estava lento, estava pausado** — 3 pausas (08:32, 09:02, 10:43) por
  entrega abaixo do piso, com 126 de 500 até as 11h. Medindo chat a chat na Evo, a manhã entregou **50%**, dentro
  dos 49–62% de 14, 15 e 16/10; as janelas que pausaram tinham 21–23 lojas. Era alarme falso. Daí `de61461`.
- Resultado do dia: **500 atingidos às 13:54** (meia manhã perdida nas pausas; o ritmo novo só entrou ~11:30).
  Com a manhã inteira, a projeção é ~09:30.
- `2bd2516`: TypeError no bloco de cadastro completo do webhook, **introduzido por mim em 17/10** — 3 campos saíram
  de `camposObrigatorios` com o fim da Fase 3 e 5 acessos ficaram para trás; `valorF3(undefined)` derrubava o bloco
  inteiro (HubSpot, planilha, `[CAD_ALERTADO]`). Alcance limitado: o caminho normal pro 49 é o `/registros`.
- `06d39a0` passou pelo `revisor-prompt-victoria`, que achou **7 problemas** — todos corrigidos: `lib/claude.ts:344`
  ainda mandava "REFAZER só a selfie"; contradição dentro do bloco novo sobre recusa; `instrucaoPedirPrint` sem gate
  de biometria negada; `[LEAD_ENVIOU_ARQUIVO]` só escrito sem legenda (PDF com legenda sumia — e CNH digital é PDF);
  orientação do Nei ainda mandando link; ramo morto de `biometria_negada` removido; texto de privacidade corrigido.
- Conferido que nenhuma das 12 correções da curadoria que entram no prompt fala de biometria ou selfie.
- **Etapa 50 x `dados_varejo`, medido ao vivo** (`docs/Etapa50-x-dados_varejo-2026-10-19.xlsx`, 8 abas, só leitura).
  A tela do portal mostra **202** porque filtra os **últimos 30 dias**; a API devolve **473 CNPJs** em
  `dados_varejo` (202 + 271 mais antigos) = **403 cards distintos**, contra **334** na etapa 50 do Evo. Ou seja:
  **o portal tem mais formulário pendente do que o Evo mostra.** Dos 334 cards na 50, 157 estão fora da janela de
  30 dias (invisíveis na tela), 6 não têm onboarding; dos 473 CNPJs, 72 têm card fora da 50 (33 em **51 Vendendo**
  — matriz vendendo com filial pendente), 56 não têm lead nosso (razão social vazia, lotes de 28/08, 31/08 e 04/09)
  e 12 têm lead sem card no funil 15.
- **`sdr_etapa_log` NÃO existia** — o `docs/sql/2026-10-15-sdr-etapa-log.sql` nunca tinha sido aplicado, então a
  trilha do espelho nunca gravou e a regra de bate-volta (`espelho-repeticao-calc`) ficou cega de 15 a 19/10.
  Aplicado hoje via MCP do Supabase (11 colunas, 2 índices, RLS ligada e sem policy, como o SQL pedia). Começa a
  encher na primeira rodada do espelho que mover card.
- **Mensagem pro Mauricio enviada pelo Aldo** (`docs/Mensagem-Mauricio-dados-varejo-2026-10-19.md`): (1) `created_at`
  do onboarding não é a data real da pendência — nada antes de 28/08 e 176 das 473 linhas criadas em 28/08 (54),
  31/08 (41) e 04/09 (81), cheiro de migração; a Teccell (45.949.064/0001-71) espera formulário desde 03/08 e a API
  diz 31/08; (2) confirmar o filtro de 30 dias da tela; (3) **Minas Celulares (60.849.076/0001-18) não existe nos
  859 onboardings** — não é filtro; (4) **YourCase Avenida (68.700.493/0001-06) entrou em 13/10 e está em
  `dados_varejo`** — o pré-cadastro passou, só confirmar que loja nova (e não `/filial`) é o caminho.

## Em aberto (quem decide)

- **Aldo — Vercel:** remover `GOOGLE_SHEETS_WEBHOOK_URL`, `HUBSPOT_PORTAL_ID`, `HUBSPOT_FORM_GUID` (sem leitor).
- **Aldo — links da planilha no painel:** `/atendimento` e `/registros` ainda têm "Abrir planilha" (abas
  Atendimentos e Senhas, preenchidas à mão). Paramos de escrever, não de ler. Se as abas morreram, tirar os links.
- **Aldo — acompanhar 1–2 dias:** o volume diário segue 500, mas agora concentrado em ~1h30. Se a taxa de resposta
  cair bem abaixo dos 15–22% de costume, baixar `PARALELO` de 3 para 2.
- **Aldo × Mauricio — Minas Celulares (60.849.076/0001-18):** pré-cadastro enviado 2× (02/10 e 17/10) e o CNPJ
  **nunca aparece no portal**. Perguntar se o formulário recusa esse CNPJ e se há log do lado deles.
- **Aldo — YourCase Avenida (Bruno):** filial 68.700.493/0001-06 com **raiz diferente** da matriz → é **loja nova**,
  e a API do parceiro só tem `/filial` e `/repasse`. Definir o caminho com o Mauricio. Ele também está bloqueado
  por limite de originação há 10 dias.
- **Nei:** GT Cell e Ph Celulares em Cadastro Recebido com **CNPJ INAPTA** → etapa 94. **AS Imports** sem CNPJ.
  12 CNPJs novos no `/registros` esperam "Abrir form".
- **Aldo:** responder o Gerisson (4 pontos) + lista de varejos Track na base da UME + origem de Rauenne (6443) e
  Adricell (4782). Lista "Para o Nei" em `docs/Conciliacao-AIVA-Gerson-2026-10-13-v3.xlsx` (col. K).
- **Viagem 30/10–15/11:** Aldo/Nei respondem o briefing das 5h todo dia útil (mantém a janela de 24h).

## Próximos passos sugeridos

1. **Medidor de entrega** (card proposto): ele mistura campanha fria (49–62%) com templates da base (~100%) e
   devolve 72%, 40% ou 17% no mesmo dia conforme a hora. Agora que o alerta é a única proteção, precisa ser exato.
2. **Marcador `[BIO_DOCS:...]`** (card proposto): sem ele a VictorIA se guia pelo histórico de 30 mensagens e pode
   repedir documento e selfie de quem já mandou, dias depois.
3. **O D+14 da etapa 50** — 334 cards parados (19/10), a maioria há mais de 14 dias, e depois do 4º toque não existe
   nada. ⚠️ O relógio não pode sair do `created_at` do portal (ver achado de 19/10): ele é mais novo que a espera
   real. Enquanto o Mauricio não responder, medir pela entrada na etapa no Evo.
4. **Trava do "prometeu ticket e não abriu"**: a promessa está no texto e a ação no `motivo_humano`; nada confere.
5. **Fio solto:** Senna (31106953000162) e Magazine Sousa (40149506000181) estão em `dados_varejo` no portal e em
   Cadastro Recebido no CRM; deveriam mover e não movem. Abrir `calcularEspelho`.
6. Investigar **por que leads chegam a Cadastro Recebido sem CNPJ registrado** — eram 17, o mais antigo de 13/05.
7. Depois da viagem: auth no `send-initial` + desfazer lead quando o template falha (nos dois repos).

## Como retomar rápido

`npm run test:disparo` · `test:biometria` · `test:espelho` · `test:entrega` · `npx tsc --noEmit -p tsconfig.json`
⚠️ Mudança de comportamento da VictorIA passa pelo agente `revisor-prompt-victoria` ANTES do commit — em 19/10 ele
achou 7 problemas que eu não tinha visto.
Estado do disparo: `select * from sdr_disparo_estado` (id=1). **O teto do dia vem de `sdr_mensagens` com
`template_hsm='aiva_campanha'`, não da `sdr_fila_disparo`** — em 19/10 a fila mostrava 431 e o orçamento já tinha
fechado em 501. Rodadas do cron: `sdr_avisos_chave` com chave `disparo:%`.
Trilha de etapas: `sdr_etapa_log` (criada em 19/10; vazia até o espelho mover o primeiro card) · avisos do painel: `sdr_avisos_painel` com `resolvido_em is null` · logs:
Vercel → sdr-aiva. Histórico: `docs/HISTORICO-OPERACAO-AIVA.md`.
