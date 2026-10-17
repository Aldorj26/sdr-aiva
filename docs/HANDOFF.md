# HANDOFF — SDR AIVA

> Documento vivo. **Leia ao abrir a sessão; atualize ao encerrar (`/handoff`).** Substitui carregar o histórico da
> conversa anterior: aqui vai o que foi feito, o que está em aberto e o próximo passo — nada mais.

## Estado de produção (17/10/2026)

- **A FASE 3 ACABOU** (deploy de 17/10, 6 commits `36ad9f0`…`fd72ec8` na `main`). A VictorIA coleta **4 campos**
  (nome e telefone do sócio, nome da loja, CNPJ matriz); e-mail, nº de lojas e CNPJs adicionais saíram — quem pede
  é a AIVA, no formulário do varejo. **Mover o card pro stage 49 É, sozinho, o cadastro completo**: `statusFromOpp`
  perdeu a trava que segurava o 49 em INTERESSADO.
- **Stage 49 usa o coringa 48**, não mais o template 29: o corpo aprovado do 29 dizia "preciso de mais alguns dados
  rapidinho", que virou mentira. Texto em `lib/text.ts` (`PRE_APROVADA_MIOLO`).
- Efeito medido no mesmo dia: 20 leads destravados, `[FASE3_DESDE:]` de 20 → 1, `[CAD_BLOQUEIO:]` em 0, nenhum
  alerta falso de card travado. Espelho saudável no `?dry=1`: 810 onboardings, 742 leads, 1 movimento (TeamVL).
- **Aviso "pré-cadastro não chegou" consertado** (`25e353d`): as 24h contam do CLIQUE (coluna `enviado_em`, SQL **já
  aplicado**) e o "✓ Resolvido" virou **soneca de 6h** — antes ele calava o caso para sempre. Provou-se no mesmo
  dia: a Minas Celulares estava silenciada desde 06/10 e o aviso reabriu sozinho.
- **Alertas adaptados** (`fd72ec8`): a "zona morta" de CADASTRO_RECEBIDO na auditoria agora ignora quem já teve o
  pré-cadastro lançado (senão TODO lead do 49 viraria ruído); `retomada-cadastro` **desativada (410)**.
- Espelho de etapas (`36ad9f0`): `primeira_venda` → 51, aviso de card travado em 4 rodadas, trilha em
  `sdr_etapa_log` (**tabela já existe**).
- **Disparo D+0 na nuvem ligado** (cron 5 min, 8h02–18h57 BRT, teto 500). ⚠️ A pausa automática por entrega não
  expira, só `/retomar` — **confira o estado antes de qualquer análise de volume** (em 14/10 ficou um dia parado).
  Página `/disparos` no painel tem estado e os botões.
- `send-initial` **sem autenticação** e grava o lead antes de enviar o template — Aldo decidiu NÃO mexer agora.
- Hook de fim de sessão não faz push. **Push na `main` = deploy em produção.**
- **Agendado:** tarefa `aviso-turma-aiva-19-10` dispara seg 19/10 às 9h o aviso da turma de 9h30 para 4 lojistas da
  whitelist do Mauricio (script `scripts/aviso-turma-whitelist-2026-10-19.mjs`; roda ensaio e só envia se os 4
  aparecerem). Só roda com o app aberto.

## Feito nesta sessão (17/10)

- Fim da Fase 3 ponta a ponta: prompt, `lib/claude.ts`, `lib/evotalks.ts`, webhook, `opportunity-stage`,
  `sync-from-evo`, `fase3-destravada`, `lib/text.ts`. Revisado pelo `revisor-prompt-victoria` — ele achou 3
  bloqueadores (mensagem do 49 pedindo e-mail, webhook revertendo o status, handler do 49 gravando INTERESSADO),
  todos corrigidos antes do commit.
- Apagada a curadoria `099a44ed` (11/09, marcada "boa") que ensinava a insistir no e-mail.
- Saneamento: 14 CNPJs lançados em `sdr_registros_cnpj` (12 novos no `/registros`, 2 que já estavam no portal),
  3 CNPJ BAIXADA → etapa 94, 2 leads reativados (Sofintech, Espaço do Celular), Rosa Outlet Cell descartada,
  Playcell com registro criado e nome corrigido.
- Ticket **1075** aberto na AIVA (filial da AppleCel, CNPJ 39.913.084/0002-70, matriz RID 4655).
- Aviso de turma enviado 4/4 em 16/10 (whitelist anterior) — a Clinica do Celular foi de "aprovada sem cadastro"
  a Primeiro acesso em ~12h.

## Em aberto (quem decide)

- **Aldo × Mauricio — Minas Celulares (60.849.076/0001-18):** pré-cadastro enviado 2× (02/10 e 17/10) e o CNPJ
  **nunca aparece no portal**, nem por telefone. Outros envios entram normal. Perguntar se o formulário recusa
  esse CNPJ e se há log do lado deles. O lojista acha que fez a biometria (não fez: nunca houve link).
- **Aldo — YourCase Avenida (Bruno):** pediu filial 68.700.493/0001-06, mas a **raiz é diferente** da matriz
  (44.318.197/0001-87, RID 6847) → pela regra do Aldo (17/10) isso é **loja nova**, não filial. A API do parceiro
  só tem `/filial` e `/repasse` — **não existe endpoint de loja nova**. Definir o caminho com o Mauricio.
  Ele também está **bloqueado por limite de originação há 10 dias** e já reclamou.
- **Nei:** GT Cell e Ph Celulares estão em Cadastro Recebido com **CNPJ INAPTA** — deveriam ir pra etapa 94.
  **AS Imports** não tem CNPJ em lugar nenhum. Os 12 CNPJs novos no `/registros` esperam "Abrir form".
- **Aldo — plano da pré-aprovação pela AIVA** (`docs/superpowers/plans/2026-10-14-pre-aprovacao-aiva.md`): falta
  escolher o método de execução (recomendado subagent-driven).
- **Aldo:** responder o Gerisson (4 pontos) + lista de varejos Track na base da UME + origem de Rauenne (6443) e
  Adricell (4782). Lista "Para o Nei" em `docs/Conciliacao-AIVA-Gerson-2026-10-13-v3.xlsx` (col. K).
- **Viagem 30/10–15/11:** Aldo/Nei respondem o briefing das 5h todo dia útil (mantém a janela de 24h).

## Próximos passos sugeridos

1. **O D+14 da etapa 50** — o gargalo que o Mauricio levantou e que a mudança NÃO resolve: 323 lojas paradas, a
   maioria há mais de 14 dias, e depois do 4º toque não existe nada. Decidir: nova régua, ligação ou descarte.
2. **Trava do "prometeu ticket e não abriu"**: a promessa está no texto e a ação no `motivo_humano`; nada confere
   se batem. Varredura desde 13/10 achou 2 casos (YourCase, AppleCel). Escalar pra fila quando divergir.
3. **Fio solto:** Senna (31106953000162) e Magazine Sousa (40149506000181) estão em `dados_varejo` no portal e em
   Cadastro Recebido no CRM; pela ORDEM do espelho (49→50 é avanço) deveriam mover e não movem. Abrir
   `calcularEspelho`.
4. Investigar **por que leads chegam a Cadastro Recebido sem CNPJ registrado** — eram 17, o mais antigo de 13/05.
5. Depois da viagem: auth no `send-initial` + desfazer lead quando o template falha (nos dois repos).

## Como retomar rápido

`npm run test:espelho` · `test:disparo` · `test:cnpj` · `test:repeticao` · `npx tsc --noEmit -p tsconfig.json`
Scripts de diagnóstico (só leitura): `scripts/verificar-fim-fase3-2026-10-17.mjs` (destravamento, marcadores,
bloqueios) · `scripts/leads-sem-lastro-2026-10-17.mjs` (status avançado sem opp/CNPJ) ·
`scripts/varredura-ticket-prometido-2026-10-17.mjs`.
Estado do disparo: `select * from sdr_disparo_estado` (id=1) · envios do dia: `sdr_mensagens` com
`template_hsm='aiva_campanha'` · trilha de etapas: `sdr_etapa_log` · avisos do painel: `sdr_avisos_painel` com
`resolvido_em is null` · logs: Vercel → sdr-aiva. Histórico: `docs/HISTORICO-OPERACAO-AIVA.md`.
