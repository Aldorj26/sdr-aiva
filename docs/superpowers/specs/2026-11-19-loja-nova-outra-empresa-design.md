# Loja nova de OUTRA empresa pedida por cliente já ativo — desenho

Data: 19/11/2026 · Pedido do Aldo · Estado: **aguardando aprovação do Aldo** (nada programado)

## Por quê

Cliente que já vende pela AIVA volta no mesmo WhatsApp querendo cadastrar mais uma loja. Hoje:

- **Filial (mesma raiz de CNPJ):** resolvido — a VictorIA pede CNPJ + número do endereço e o sistema abre o
  ticket de filial na AIVA (`abrir_ticket_filial`, `lib/tickets-aiva.ts`). **Não muda.**
- **CNPJ de outra empresa (raiz diferente):** a VictorIA diz "passei pro Nei" e a conversa para. É o caso de
  Eduardo Cell (32.306.162 → 59.218.413/0001-90) e RG Cell (53.259.692 → 69.849.333/0001-96), e dos próximos.

## Objetivo

A VictorIA conduz sozinha o pedido da loja de outra empresa, **sem aprovação humana**; o único passo manual é o
clique do Nei no pré-cadastro (exigência da AIVA); o lojista recebe o link do cadastro sozinho e é acompanhado
até a loja nascer.

**Fora do escopo:** segundo lead/card para o mesmo telefone; coletar no chat o que o formulário da AIVA já
coleta; automatizar o pré-cadastro (o formulário exige login — candidato a um próximo passo).

**Seria um fracasso se:** a VictorIA refizesse a qualificação do zero; o card da loja que vende voltasse de
etapa; ela prometesse cadastro para CNPJ que a AIVA reprova (menos de 1 ano, não ATIVA) ou para endereço sem CNPJ.

## Caminhos considerados

1. **Palavra-chave obrigatória** ("NOVA LOJA") para abrir o fluxo — descartado como mecanismo único: quem não
   digitar cai no vazio de hoje.
2. **Segundo lead/card por loja** — descartado: um telefone com dois leads quebra o roteamento do webhook e o
   vínculo do espelho (`vinculo-portal-calc.ts` trata telefone com 2 leads como ambíguo).
3. **Escolhido: gatilho pelo CNPJ + registro dentro do mesmo lead + link automático após o pré-cadastro.**
   (Mandar o link antes do pré-cadastro foi descartado: o lojista poderia preencher sem o registro existir.) O CNPJ desconhecido já é
   capturado de forma determinística (webhook, bloco LOJA NOVA) e gravado em `sdr_registros_cnpj`; o espelho já
   aceita lead com vários CNPJs e vale o mais avançado (card de quem vende não regride — conferido em
   `espelho-portal-calc.ts`). A palavra-chave entra só como atalho.

## Como funciona

1. **Gatilho.** Lead em TREINAR / LOGIN / LOJA_FINALIZADA_E_VENDENDO manda um CNPJ que não conhecemos, ou digita
   o atalho **NOVA LOJA** (aí a VictorIA pede o CNPJ). Em fase anterior segue a regra atual: anota e avisa que a
   loja nova entra depois da principal ativa.
2. **Classificação pelo sistema (não pelo modelo).** Raiz igual à de um CNPJ do lead → fluxo de filial atual.
   Raiz diferente → este fluxo. O resultado vai para a VictorIA por instrução do sistema no turno.
3. **Conferência automática na Receita** (a consulta que já roda): ATIVA, 1 ano ou mais, fora da base Odres/UME,
   e se já existe cadastro desse CNPJ na API da AIVA.
   - Reprovou → a VictorIA explica o motivo em uma frase, **não abre pedido**; o Nei recebe aviso informativo.
   - Já existe na AIVA → ela informa a situação do cadastro, sem pedido novo.
4. **Uma pergunta só.** "O sócio dessa empresa é você mesmo?" Se não for: nome e WhatsApp do sócio (quem faz o
   formulário e a biometria é o sócio da empresa nova). Nada de faturamento, e-mail ou número de lojas.
5. **Sem aprovação do Nei (decisão do Aldo, 19/11, revendo a anterior).** A checagem automática + o "sim" do
   lojista bastam. Mas o link da AIVA só vale depois do **pré-cadastro** (confirmado pelo Aldo), que hoje é o
   clique do Nei em "Abrir form" no quadro Registros AIVA. Então: a linha em `sdr_registros_cnpj` (tipo `adicional` +
   `fluxo = 'loja_nova_empresa'` — nunca `matriz`, que move o card no clique — com os dados do sócio) entra **direto na fila de pré-cadastro** do `/atendimento`, já preenchida e marcada
   como "loja nova de cliente ativo". O Nei não julga nada — só clica. A VictorIA diz: "Registrei a loja nova;
   assim que o cadastro dela abrir na AIVA eu te mando o link por aqui." Sem prazo.
6. **Link automático.** Quando o espelho enxergar o pré-cadastro desse CNPJ na AIVA (coluna `dados_varejo`), o
   sistema manda, no WhatsApp de quem pediu, o link `https://retail-onboarding-hub.vercel.app/` dizendo qual
   CNPJ usar (texto se a janela estiver aberta; template de utilidade 86 se não). Mesmo gatilho do fluxo de
   prospecção, só que por CNPJ. Se o sócio for outra pessoa, o lojista repassa o link.
7. **Pré-cadastro parado.** Se o CNPJ ficar mais de 24 h na fila sem clique, ou clicado sem chegar à AIVA, vale
   o aviso que já existe ("pré-cadastro não chegou"), para a loja nova não ficar esquecida.
8. **Acompanhamento.** O espelho já enxerga o CNPJ novo. Quando a AIVA criar a loja, sai um aviso "sua nova loja
   <nome> foi criada" — **por CNPJ**, sem mexer no card nem repetir as mensagens de etapa da loja principal.

## Casos que NÃO viram pedido

- **Endereço novo sem CNPJ próprio** ("usar o CNPJ da matriz" em outro endereço, caso RG Cell/Osasco): a
  VictorIA orienta a registrar a filial com o contador e voltar com o CNPJ; não promete análise.
- **Troca de CNPJ de loja existente:** continua no formulário de alteração de dados da empresa.
- **Criar usuário em loja que já opera:** continua no formulário de Login de operadores.

## O que muda no código

- `app/api/sdr/webhook/route.ts`: classificação por raiz no bloco LOJA NOVA; instrução do sistema por turno;
  leitura do motivo novo `loja_nova_empresa: cnpj=… | socio=mesmo|<nome> | tel=…`; atalho NOVA LOJA.
- `lib/loja-nova-calc.ts` (novo, regra pura + `npm run test:lojanova`): raiz, elegibilidade, leitura do motivo, textos.
- `prompts/aiva.ts`: seção LOJA NOVA ganha o ramo "outra empresa" e a regra do endereço sem CNPJ; corrigir
  TODAS as passagens que hoje dizem "é loja nova: o time cuida". Passa pelo `revisor-prompt-victoria`.
- `lib/tickets-aiva.ts` (`mensagemFilial`, caso raiz diferente): em vez de "passei pro time", entra neste fluxo.
- Painel: a loja nova aparece na fila de pré-cadastro que já existe, com a marca "loja nova de cliente ativo"
  e os dados do sócio (`app/atendimento`).
- `docs/sql/`: colunas do sócio e origem em `sdr_registros_cnpj`.
- Espelho: envio do link quando o CNPJ chega a `dados_varejo` e aviso de loja criada, os dois por CNPJ, para
  registro nascido deste fluxo.

## Decisões minhas (o Aldo pode corrigir)

- Atalho com o texto **NOVA LOJA**.
- Link vai para quem pediu, mesmo com sócio diferente.
- Os dois clientes de hoje (Eduardo Cell e RG Cell) entram pelo painel assim que publicar: o registro do CNPJ já
  existe, vai para a fila de pré-cadastro e o Nei só clica.
- Textos que a VictorIA e o sistema mandam ao lojista são mostrados ao Aldo antes do push (push = produção).

## Deixado para quem programar

Nome exato dos status e colunas; desenho do aviso no painel; chave de idempotência do aviso de loja criada.
