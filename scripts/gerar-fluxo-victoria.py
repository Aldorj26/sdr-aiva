# -*- coding: utf-8 -*-
"""Gera o mapa do fluxo atual da VictorIA em 2 formatos a partir de UMA fonte:
   1) docs/fluxo-victoria-2026-09-10.drawio  (editável no diagrams.net)
   2) scratchpad/fluxo-victoria.html          (página de visualização / artifact)
"""
import io, sys, html
from xml.sax.saxutils import escape, quoteattr
sys.stdout.reconfigure(encoding='utf-8')

# ─────────────────────────── FONTE DE VERDADE ───────────────────────────
# Cada coluna = uma etapa do funil 15 do Evo Talks (ordem real do funil).
# Linhas: evo | victoria | humano | rotinas | sistemas
COLS = [
  dict(key='inicio', num=66, nome='Início', auto='automação 97',
       chega='Card criado no disparo do HSM Dia 1',
       victoria=[
         'Lead responde → webhook (Evo → Vercel)',
         'Abertura: "Sou a VictorIA, da Track… já trabalham com crediário?"',
         'Qualifica 1 pergunta por vez: crediário? quantas lojas? marcas?',
         'Detecta bot/auto-reply (tenta furar, máx trocas) → 69 Bot Detectado',
         'Opt-out real ("não quero") → OPT_OUT · só iPhone / não vende celular → NAO_QUALIFICADO',
         'Fim de semana: responde normal (webhook nunca para)',
       ],
       humano=[
         'Aldo dispara 150 números/dia (painel Campanha ou disparar-fila.mjs), seg–sex',
         'Filtro no disparo: pula bot, opt-out, lead já em cadência, base AIVA',
       ],
       rotinas=[
         'HSM 41 "AIVA Dia 1" (D+0) → lead INICIO + card 66',
         'Régua D+3 (HSM 35) · D+7 (HSM 38) · D+14 (HSM 39) — ⏸ PAUSADA (17/08; religada e pausada de novo em 10/09): ~4.100 leads vencidos aguardam o fluxo novo',
         'auto-descarte 10h seg–sex: INICIO +15d sem resposta → card 53 + SEM_RESPOSTA',
         'varredura de lojas 10h (todo dia) → Excel parcial + fila_disparo (4.777 na fila)',
       ],
       sistemas=[
         'sdr_leads (status INICIO) · fila_disparo · sdr_mensagens',
         'Validação de WhatsApp do Evo (checkIfUserExists) fora do ar → sem checagem prévia',
       ]),
  dict(key='interessado', num=47, nome='Interessado', auto='automação 88',
       chega='VictorIA muda status quando o lead conversa',
       victoria=[
         'FASE 1 — coleta 7 dados no chat, um por vez: nome do sócio · CNPJ matriz (cedo) · telefone do sócio · nome da loja · região · nº de lojas · outra financeira?',
         'CNPJ chega → checagens automáticas (ver Sistemas): DV inválido / não consta na Receita → NÃO pré-aprova',
         'CNPJ já na base AIVA/Odres → mensagem oficial + transfere pro funil 19 (tag ODRES/UME)',
         'CNPJ < 1 ano → NAO_QUALIFICADO + card vai pra 93',
         'Sem sócio na Receita (QSA vazio) → tag SEM_SOCIO → fluxo dos 5 documentos (Drive)',
         'Objeções, taxa 12% × juros do cliente, nunca simula parcelas, nunca acusa golpe',
         '7 dados completos → PRE_APROVACAO + aciona humano (qualificacao_inicial_completa)',
       ],
       humano=[
         'Nei entra quando: +10 lojas · pede contrato · irritado · dúvida técnica/jurídica · já cliente AIVA · confirmar_contato',
         'Reengajamento esgotado (3×) → lead sinalizado; descartar é decisão do Nei',
       ],
       rotinas=[
         'nudge 12h (Vercel): conversa parada 3–24h → cutucada contextual (máx 2)',
         'reativação 10h: parado 48h–14d → HSM 48 (20/execução)',
         'reengajamento 16h seg–sex: follow-up personalizado via HSM 48, até 3× a cada 15d',
         'régua-saída 10h30: 3 reengajamentos + 15d mudo + bola com o lead → card 53 + SEM_RESPOSTA',
         'auto-descarte: INTERESSADO +21d sem msg do lead → AGUARDANDO',
         'cobrança-docs 10h: sem sócio parado 2d+ → lembrete HSM 48 (máx 3)',
       ],
       sistemas=[
         'BrasilAPI (Receita): idade, situação, QSA — marcador [CNPJ_RECEITA] impede revalidar',
         'aiva_base_cnpjs (6.323 CNPJs, importada 11h todo dia via Data Studio)',
         'sdr_registros_cnpj (status informada) · formsdata da opp no Evo',
       ]),
  dict(key='pre', num=54, nome='Pré Aprovação', auto='automação 99',
       chega='Automático: VictorIA fechou os 7 dados',
       victoria=[
         'FASE 2 — só tranquiliza: "estamos analisando, em breve retorno". Não pede dado, não promete prazo',
         'Se o CNPJ tiver ≥ 3 lojas → tag IMPORTANTE (74) na opp',
         'Alerta Nei + Aldo: pré-aprovação enviada',
       ],
       humano=[
         'Edu (AIVA) analisa a pré-aprovação pela planilha, em até 24h',
         'Aprovou → Nei move o card 54 → 49 (Cadastro Recebido)',
         'Reprovou → descarte (Nei marca no Evo)',
       ],
       rotinas=[
         'Nenhuma cobrança automática nessa etapa (espera humana)',
       ],
       sistemas=[
         'Planilha AIVA APROVAÇÃO (Google Sheets) — linha por lead pré-aprovado',
         'Tags Evo: AIVA (69) sempre · IMPORTANTE (74) se ≥ 3 lojas',
       ]),
  dict(key='cadastro', num=49, nome='Cadastro Recebido', auto='automação 83',
       chega='Nei move o card após o OK do Edu',
       victoria=[
         'Entrada na etapa → HSM 29 "Complete o cadastro" reabre a janela; status volta a INTERESSADO com marcador de Fase 3',
         'FASE 3 — coleta 5 dados: e-mail do sócio · faturamento anual · boleto mensal · localização das lojas · CNPJs adicionais (só se ≥ 2 lojas)',
         'Dados sensíveis: explica o porquê, aceita "por alto"; recusa → aciona humano (receio_dados_sensiveis)',
         'Trava anti-conclusão: sem os 5, nunca diz "cadastro completo"',
         '12 dados completos → CADASTRO_RECEBIDO + HubSpot + registro do CNPJ + alerta ✅ (cadastro_completo)',
       ],
       humano=[
         'Nei confere no /registros e move o card 49 → 50 (Em Análise)',
         'Cobrança esgotada (3 toques) → escala pro Nei uma vez',
       ],
       rotinas=[
         'cadastro-recebido-cobranca 15h seg–sex: D+1 · D+3 · D+7 na etapa → HSM 48 + pede o dado que falta (um por vez)',
         'Fonte da verdade = etapa do Evo (stagebegintime)',
       ],
       sistemas=[
         'HubSpot (contato/empresa) — só quando os 12 dados fecham',
         'sdr_registros_cnpj (matriz + adicionais) · formsdata da opp',
         'Painel /registros',
       ]),
  dict(key='analise', num=50, nome='Em Análise AIVA', auto='automação 84',
       chega='Nei move o card com os 12 dados fechados',
       victoria=[
         'Entrada na etapa → HSM 34 (aprovação) com o link do onboarding retail-onboarding-hub + biometria (CAF)',
         'FASE 4 — acompanha: "conseguiu acessar? concluiu a biometria?"',
         'Qualquer erro → PEDE O PRINT primeiro (regra 08/09) · dificuldade → aciona humano (dificuldade_onboarding_caf)',
         'Lead diz que concluiu → aciona humano (cadastro_caf_confirmado)',
         'Nunca reenvia o link sozinha; status fica EM_ANALISE_AIVA (só o time muda)',
       ],
       humano=[
         'Edu (AIVA) analisa o onboarding + CAF: aprova ou reprova',
         'Aprovou → Nei move 50 → 70 (Treinar) · Reprovou → descarte',
         'Print do erro chega no chamado (📷) pro Nei identificar',
       ],
       rotinas=[
         'followup-fase 13h: 24h+ sem resposta → HSM 48 com miolo gerado pela Claude; máx 3 → escala Nei',
         'Respeita [PAUSA_ATE] e acionar_humano',
       ],
       sistemas=[
         'Onboarding AIVA (retail-onboarding-hub) + CAF (biometria)',
         'sdr_chamados (erro relatado + print) → planilha Chamados',
       ]),
  dict(key='treinar', num=70, nome='Treinar', auto='automação 31',
       chega='Nei move após aprovação da AIVA',
       victoria=[
         'Entrada na etapa → HSM 69 "Treinamento completo": link do Meet (seg/qui 9h30), Drive de materiais, cadastro de acessos',
         'Regra de acessos (27/08): um usuário por loja; logins liberados pela AIVA após o treinamento',
         'Vacina da reprovação antes das primeiras consultas',
         '🔒 Trava/desbloqueio de aparelho → só pelo Live Chat (Track não tem autoridade)',
         'Erro na tela → pede print → abre chamado pro Nei',
         'Loja nova no meio da conversa → aciona Nei (filial/correção cadastral)',
       ],
       humano=[
         'Nei dá o treinamento (segundas e quintas, 9h30, mesmo link)',
         'Nei confirma acesso/treino e move 70 → 71 (Login)',
       ],
       rotinas=[
         'treinar-primeira-venda: disparo sob demanda (não é cron) — pergunta se já vendeu',
         'Lembretes de treinamento: scripts pontuais (ex.: aviso de feriado 04/09)',
       ],
       sistemas=[
         'Drive AIVA (materiais + vídeos Flexfone) · Google Meet',
         'Apps Script "AIVA Docs" (linha/senha/atendimento manual)',
       ]),
  dict(key='login', num=71, nome='Login', auto='automação 91',
       chega='Nei move quando o login sai',
       victoria=[
         'Espelha status LOGIN no painel (sync em tempo real)',
         'Orienta primeiro acesso, operação Flexfone, consulta a distância × finalização presencial',
         'Boleto do cliente: quem emite é a LOJA, dentro do Flexfone — vídeo "Como emitir boleto"',
         '⛔ Regra 10/09: cliente novo = só AIVA no Flexfone; Odres congelada (segue só em lojas já abertas com ela)',
         'Links úteis por tema (portal, treinamento, 2ª via do cliente)',
       ],
       humano=[
         'AIVA libera o login da loja',
         'Nei acompanha a primeira venda e move 71 → 51',
       ],
       rotinas=[
         'sla-liberacao: digest de lojas paradas em Treinar/Login — ⏸ desativado 06/08 (sob demanda)',
       ],
       sistemas=[
         'Flexfone (plataforma da loja) · clientes.aivapay.com.br (2ª via)',
       ]),
  dict(key='vendendo', num=51, nome='Loja Finalizada e Vendendo', auto='automação 92',
       chega='Nei move após a primeira venda',
       victoria=[
         'Entrada na etapa → liga o relógio da consultoria ([CONSULTORIA_INICIO]) — não fala nada na hora',
         'FASE 5 — consultoria de vendas: playbook (preparar a loja · do CPF ao fechamento · aproveitar cada real · atrair fluxo)',
         'Suporte pós-venda: A) lojista (plataforma/financeiro) · B) cliente final (parcelamento) · C) como fazer (Drive)',
         'Objeção nº 1 "a AIVA não aprova" · prioriza autonomia do lojista',
         'Loja diz que nunca operou → 🚩 alerta Nei (loja_finalizada_sem_operar)',
         'Repasse solicitado → planilha Repasses · CS acionamento → /atendimento',
       ],
       humano=[
         'Nei acompanha /desempenho (Portal Parceiros AIVA) e /atendimento (CS)',
         'Comissão por loja ativada (importação mensal UME)',
         '⚠️ Etapa 51 não aceita mover card pela API (só na mão)',
       ],
       rotinas=[
         'consultoria-vendas 14h seg–sex: D+7 e depois a cada 15d, 4 toques via HSM 48',
         'check-primeira-venda terças 10h: loja quieta 7d+ → "a primeira venda saiu?" (máx 2, 30d)',
         'portal-aiva 6h todo dia: ativa loja (CNPJ registrado + Ativo no portal) + desempenho diário',
         'pulso semanal segunda 8h30: fecha a semana e manda mensagens segmentadas às lojas ativas',
       ],
       sistemas=[
         'Portal Parceiros AIVA → aiva_portal_diario (fonte) → aiva_desempenho (mês/semana)',
         'sdr_repasses_solicitados → planilha Repasses · contas MRR no Evo',
       ]),
]

# Coluna final: saídas e estados fora da linha principal
SAIDAS = dict(key='saidas', nome='Saídas do funil', itens=[
  dict(num=53, nome='Interessado (Sem resposta)', auto='automação 98', txt='auto-descarte (Início +15d) · régua-saída · SEM_RESPOSTA +30d → DESCARTADO'),
  dict(num=69, nome='Bot Detectado', auto='automação 100', txt='VictorIA detectou auto-resposta; reativação recomeça do zero'),
  dict(num=93, nome='Lojas menos de 01 Ano', auto='automação 101', txt='CNPJ < 1 ano na Receita → NAO_QUALIFICADO (regra 08/09)'),
  dict(num=19, nome='Funil 19 · Odres / UME', auto='transferência', txt='CNPJ já na base AIVA/Odres → mensagem oficial + tag ODRES/UME · sdr_leads apaga o lead'),
  dict(num=None, nome='OPT_OUT · LGPD', auto='webhook', txt='"não quero mais" → OPT_OUT · pedido de exclusão → confirma, apaga dados, guarda só o telefone'),
  dict(num=None, nome='DESCARTADO / NAO_QUALIFICADO', auto='terminal', txt='Descarte manual do Nei é respeitado; status terminais nunca são revividos pelo sync'),
])

# Linha transversal: o que corre o funil inteiro
TRANSVERSAL = [
  ('🔁 Sincronização Evo ↔ painel', 'Cada etapa tem uma automação de entrada que chama /opportunity-stage (≈1 s). Reforço: sync-from-evo a cada 5 min, Evo é a fonte da verdade (exceções: descarte manual, terminais, guarda de 2 min).'),
  ('🛠 Auto-reprocess (10 min)', 'Mensagem do lead sem resposta da VictorIA → reprocessa; falha da Claude → até N tentativas e depois escala humano.'),
  ('👤 Fila humana', 'acionar_humano=true entra na fila: 🔴 ação · 📄 docs · 🟡 mover card. WhatsApp pro Nei 8h seg–sex + painel /atendimento (chamados, CS, travados, CNPJ).'),
  ('📋 Chamados', 'Erro relatado → pede print → sdr_chamados + planilha Chamados. Nei clica Resolver → planilha recebe "sim" e o chamado some.'),
  ('📣 Alertas', 'Transições de status alertam Nei/Aldo via WhatsApp (pré-aprovação, cadastro ✅, CAF confirmado, loja sem operar, contato a confirmar).'),
  ('📰 Briefings', 'briefing-pipeline 5h seg–sex (Aldo + Nei) · auditoria Evo × Supabase (só alerta) · destilador semanal sex 10h (curadoria).'),
  ('🧠 VictorIA Analista', 'Widget do painel: consulta leads, conversas, chamados, repasses, desempenho semanal e curadoria. Só leitura.'),
  ('🗓 Data injetada a cada turno', 'A VictorIA não sabe o dia — lib/claude.ts injeta a data BRT fora do cache. Feriados/avisos entram como bloco dinâmico.'),
]

LANES = [
  ('victoria', '🤖 VictorIA (webhook + prompt)'),
  ('humano',   '👤 Humanos — Nei · Edu (AIVA) · Aldo'),
  ('rotinas',  '⏰ Rotinas automáticas (crons)'),
  ('sistemas', '🗂 Sistemas e dados'),
]

# ─────────────────────────── DRAW.IO ───────────────────────────
COLW, GAP, X0 = 250, 22, 60
LANE_H = dict(evo=130, victoria=340, humano=190, rotinas=270, sistemas=170)
PAL = dict(
  evo=('#DCE8F7', '#1F4E8C'), victoria=('#EBE5F9', '#5B3FA6'), humano=('#FBEBC8', '#8A5200'),
  rotinas=('#D6F0EC', '#0F6E63'), sistemas=('#E7EAEE', '#3E4A57'), saida=('#F6DEDA', '#8C2F2F'),
  trans=('#F1EFE8', '#4F4A3A'))
cells = []
nid = [1]
def new_id(prefix):
    nid[0] += 1
    return f'{prefix}{nid[0]}'
def h(txt):  # texto html do label
    return txt
def bullets(items):
    return '<ul style="margin:0;padding-left:14px">' + ''.join(f'<li>{escape(i)}</li>' for i in items) + '</ul>'
def vertex(id_, parent, value, x, y, w, hgt, style):
    cells.append(f'<mxCell id="{id_}" value={quoteattr(value)} style="{style}" vertex="1" parent="{parent}"><mxGeometry x="{x}" y="{y}" width="{w}" height="{hgt}" as="geometry"/></mxCell>')
def edge(id_, parent, src, tgt, value='', style=''):
    st = 'edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=blockThin;endFill=1;strokeWidth=1.5;fontSize=10;' + style
    cells.append(f'<mxCell id="{id_}" value={quoteattr(value)} style="{st}" edge="1" parent="{parent}" source="{src}" target="{tgt}"><mxGeometry relative="1" as="geometry"/></mxCell>')

ncols = len(COLS) + 1
TOTAL_W = X0 + ncols * (COLW + GAP) + 20
def colx(i): return X0 + i * (COLW + GAP)

y = 20
# Título
vertex('titulo', '1', '<b style="font-size:20px">Fluxo atual da VictorIA — AIVA</b><br><span style="font-size:11px">Retrato de 10/09/2026 · colunas = etapas do funil 15 do Evo Talks · linhas = quem faz o quê · edite à vontade, cada caixa é solta</span>',
       20, y, 900, 50, 'text;html=1;align=left;verticalAlign=middle;fontFamily=Helvetica;')
# Legenda
lx = 960
for k, lab in [('evo','Etapa no Evo'),('victoria','VictorIA'),('humano','Humano'),('rotinas','Rotina automática'),('sistemas','Sistema/dado'),('saida','Saída do funil')]:
    f, s = PAL[k]
    vertex(new_id('leg'), '1', lab, lx, y+14, 118, 24, f'rounded=1;html=1;fontSize=10;fillColor={f};strokeColor={s};fontColor={s};')
    lx += 126
y += 70

# Lane das etapas do Evo (cabeçalho)
lane_evo = 'lane_evo'
f, s = PAL['evo']
vertex(lane_evo, '1', '🧭 Etapa no Evo Talks (funil 15)', 0, y, TOTAL_W, LANE_H['evo'],
       f'swimlane;horizontal=0;startSize=40;html=1;fillColor={f};strokeColor={s};fontColor={s};fontStyle=1;fontSize=12;swimlaneFillColor=#FFFFFF;')
evo_ids = []
for i, c in enumerate(COLS):
    cid = f'evo_{c["key"]}'
    evo_ids.append(cid)
    label = f'<b style="font-size:13px">{c["num"]} · {escape(c["nome"])}</b><br><span style="font-size:9px;color:#4A5560">{escape(c["auto"])} → /opportunity-stage</span><hr size="1"><span style="font-size:10px">{escape(c["chega"])}</span>'
    vertex(cid, lane_evo, label, colx(i), 18, COLW, LANE_H['evo']-36,
           f'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=6;fillColor=#FFFFFF;strokeColor={s};strokeWidth=2;fontFamily=Helvetica;')
# coluna de saídas no cabeçalho
fs, ss = PAL['saida']
vertex('evo_saidas', lane_evo, '<b style="font-size:13px">Saídas do funil</b><br><span style="font-size:10px">Estados fora da linha principal — detalhe abaixo</span>',
       colx(len(COLS)), 18, COLW, LANE_H['evo']-36,
       f'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=6;fillColor=#FFFFFF;strokeColor={ss};strokeWidth=2;dashed=1;')
# setas entre etapas com quem move
movers = ['VictorIA (lead conversa)', 'VictorIA (7 dados)', 'Nei, após OK do Edu', 'Nei (12 dados)', 'Nei, após OK do Edu', 'Nei (treinou)', 'Nei (1ª venda)']
for i in range(len(evo_ids)-1):
    edge(new_id('e'), lane_evo, evo_ids[i], evo_ids[i+1], movers[i], 'strokeColor=#1F4E8C;')
y += LANE_H['evo'] + 12

# Lanes de conteúdo
for lk, ltitle in LANES:
    f, s = PAL[lk]
    lid = f'lane_{lk}'
    vertex(lid, '1', ltitle, 0, y, TOTAL_W, LANE_H[lk],
           f'swimlane;horizontal=0;startSize=40;html=1;fillColor={f};strokeColor={s};fontColor={s};fontStyle=1;fontSize=12;swimlaneFillColor=#FFFFFF;')
    for i, c in enumerate(COLS):
        vertex(f'{lk}_{c["key"]}', lid, bullets(c[lk]), colx(i), 14, COLW, LANE_H[lk]-28,
               f'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=4;fontSize=9;fillColor=#FFFFFF;strokeColor={s};fontFamily=Helvetica;')
    # coluna de saídas: só na lane VictorIA cabem as caixas de saída (mais alta)
    if lk == 'victoria':
        yy = 14
        hh = (LANE_H[lk]-28 - 5*6) // 6
        for idx, it in enumerate(SAIDAS['itens']):
            num = f'{it["num"]} · ' if it['num'] else ''
            label = f'<b>{num}{escape(it["nome"])}</b> <span style="font-size:8px;color:#8C2F2F">{escape(it["auto"])}</span><br><span style="font-size:8px">{escape(it["txt"])}</span>'
            vertex(f'saida_{idx}', lid, label, colx(len(COLS)), yy, COLW, hh,
                   f'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=3;fillColor={fs};strokeColor={ss};fontSize=9;')
            yy += hh + 6
    y += LANE_H[lk] + 12

# Setas de saída (gates da Fase 1 → saídas)
edge(new_id('e'), '1', 'victoria_interessado', 'saida_2', 'CNPJ < 1 ano', 'strokeColor=#8C2F2F;dashed=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;')
edge(new_id('e'), '1', 'victoria_interessado', 'saida_3', 'já cliente AIVA/Odres', 'strokeColor=#8C2F2F;dashed=1;exitX=1;exitY=0.7;entryX=0;entryY=0.5;')
edge(new_id('e'), '1', 'victoria_inicio', 'saida_1', 'bot', 'strokeColor=#8C2F2F;dashed=1;exitX=1;exitY=0.3;entryX=0;entryY=0.5;')
edge(new_id('e'), '1', 'rotinas_inicio', 'saida_0', 'Início +15d', 'strokeColor=#8C2F2F;dashed=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;')

# Lane transversal
f, s = PAL['trans']
lid = 'lane_trans'
TH = 150
vertex(lid, '1', '🔗 Transversal — corre o funil inteiro', 0, y, TOTAL_W, TH,
       f'swimlane;horizontal=0;startSize=40;html=1;fillColor={f};strokeColor={s};fontColor={s};fontStyle=1;fontSize=12;swimlaneFillColor=#FFFFFF;')
tw = (TOTAL_W - X0 - 20 - (len(TRANSVERSAL)-1)*GAP) // len(TRANSVERSAL)
for i, (t, d) in enumerate(TRANSVERSAL):
    vertex(f'trans_{i}', lid, f'<b>{escape(t)}</b><br><span style="font-size:9px">{escape(d)}</span>', X0 + i*(tw+GAP), 14, tw, TH-28,
           f'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacing=5;fontSize=9;fillColor=#FFFFFF;strokeColor={s};')
y += TH + 20

xml = f'''<mxfile host="app.diagrams.net" modified="2026-09-10T16:00:00.000Z" agent="claude" version="24.7.0">
  <diagram id="fluxo-victoria" name="Fluxo VictorIA 10/09/2026">
    <mxGraphModel dx="1400" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{TOTAL_W+40}" pageHeight="{y+40}" background="#F4F6F8" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        {chr(10).join(cells)}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
'''
io.open('docs/fluxo-victoria-2026-09-10.drawio', 'w', encoding='utf-8', newline='\n').write(xml)
print('drawio ok', len(cells), 'células', TOTAL_W, 'x', y)

# ─────────────────────────── HTML ───────────────────────────
def li(items): return ''.join(f'<li>{html.escape(i)}</li>' for i in items)
cols_html = []
for c in COLS:
    cols_html.append(f'''
    <section class="col" id="{c['key']}">
      <header class="stage">
        <span class="num">{c['num']}</span>
        <h2>{html.escape(c['nome'])}</h2>
        <p class="auto">{html.escape(c['auto'])} → opportunity-stage</p>
        <p class="chega">{html.escape(c['chega'])}</p>
      </header>
      <div class="cell victoria"><ul>{li(c['victoria'])}</ul></div>
      <div class="cell humano"><ul>{li(c['humano'])}</ul></div>
      <div class="cell rotinas"><ul>{li(c['rotinas'])}</ul></div>
      <div class="cell sistemas"><ul>{li(c['sistemas'])}</ul></div>
    </section>''')
saidas_html = ''.join(f'''
      <div class="saida">
        <b>{(str(s['num'])+' · ') if s['num'] else ''}{html.escape(s['nome'])}</b>
        <span class="auto">{html.escape(s['auto'])}</span>
        <p>{html.escape(s['txt'])}</p>
      </div>''' for s in SAIDAS['itens'])
trans_html = ''.join(f'<div class="trans"><b>{html.escape(t)}</b><p>{html.escape(d)}</p></div>' for t, d in TRANSVERSAL)
movers_html = ''.join(f'<li><span>{i+1}</span>{html.escape(m)}</li>' for i, m in enumerate(movers))

page = f'''<title>Fluxo VictorIA</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
:root{{
  --bg:#F3F5F7; --paper:#FFFFFF; --ink:#1B2430; --ink-2:#4A5563; --line:#D6DBE2;
  --evo:#1F5FBF; --evo-bg:#E4ECFA;
  --vic:#6B4FD1; --vic-bg:#ECE7FA;
  --hum:#B8740A; --hum-bg:#FBEFD6;
  --rot:#178F80; --rot-bg:#DCF2EE;
  --sis:#4B5A6A; --sis-bg:#E8ECF1;
  --out:#C24A3B; --out-bg:#F9E3DF;
  --tr:#6B6350; --tr-bg:#F2EFE6;
  --pause:#8A6D00;
}}
@media (prefers-color-scheme: dark){{
  :root:not([data-theme="light"]){{
    --bg:#13181F; --paper:#1B222B; --ink:#E9EDF2; --ink-2:#A7B1BD; --line:#2E3842;
    --evo:#7FA9F0; --evo-bg:#1B2A45; --vic:#B4A2F2; --vic-bg:#2B2447; --hum:#F0B95A; --hum-bg:#3E2F12;
    --rot:#6ED2C1; --rot-bg:#123A35; --sis:#B3BEC9; --sis-bg:#232C36; --out:#F08A7C; --out-bg:#452321;
    --tr:#CFC6AE; --tr-bg:#2A2823; --pause:#F2D26B;
  }}
}}
:root[data-theme="dark"]{{
  --bg:#13181F; --paper:#1B222B; --ink:#E9EDF2; --ink-2:#A7B1BD; --line:#2E3842;
  --evo:#7FA9F0; --evo-bg:#1B2A45; --vic:#B4A2F2; --vic-bg:#2B2447; --hum:#F0B95A; --hum-bg:#3E2F12;
  --rot:#6ED2C1; --rot-bg:#123A35; --sis:#B3BEC9; --sis-bg:#232C36; --out:#F08A7C; --out-bg:#452321;
  --tr:#CFC6AE; --tr-bg:#2A2823; --pause:#F2D26B;
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 "IBM Plex Sans",system-ui,Segoe UI,Arial,sans-serif;overflow-x:hidden}}
.wrap{{padding:28px 24px 48px;max-width:100%}}
h1{{font:700 26px/1.1 Archivo,"IBM Plex Sans",Arial,sans-serif;margin:0 0 6px;letter-spacing:-.01em;text-wrap:balance}}
.lede{{color:var(--ink-2);max-width:68ch;margin:0 0 18px}}
.legend{{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px;padding:0;list-style:none;font-size:12px}}
.legend li{{display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--paper)}}
.legend i{{width:10px;height:10px;border-radius:3px;display:inline-block}}
.rail{{display:grid;grid-template-columns:auto 1fr;gap:0 12px;align-items:start;margin:0 0 10px}}
.rail .lab{{writing-mode:vertical-rl;transform:rotate(180deg);font:600 11px/1 "IBM Plex Mono",monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);padding:6px 0}}
.board{{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--paper)}}
.grid{{display:grid;grid-template-columns:150px repeat(8,300px) 320px;min-width:max-content}}
.grid > *{{border-right:1px solid var(--line)}}
.rowlab{{position:sticky;left:0;z-index:2;background:var(--paper);padding:12px 10px;font:600 12px/1.3 "IBM Plex Mono",monospace;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid var(--line)}}
.rowlab small{{display:block;font:400 11px/1.3 "IBM Plex Sans",sans-serif;text-transform:none;letter-spacing:0;color:var(--ink-2);margin-top:4px}}
.col{{display:contents}}
.stage{{grid-row:1;padding:12px 12px 10px;border-bottom:2px solid var(--evo);background:var(--evo-bg);position:relative}}
.stage .num{{font:500 11px/1 "IBM Plex Mono",monospace;color:var(--evo);background:var(--paper);border:1px solid var(--evo);border-radius:4px;padding:3px 6px;display:inline-block}}
.stage h2{{font:700 16px/1.15 Archivo,sans-serif;margin:8px 0 4px;color:var(--ink)}}
.stage .auto{{margin:0;font:500 10.5px/1.3 "IBM Plex Mono",monospace;color:var(--ink-2)}}
.stage .chega{{margin:6px 0 0;font-size:12px;color:var(--ink-2)}}
.stage::after{{content:"";position:absolute;right:-9px;top:50%;width:0;height:0;border:8px solid transparent;border-left-color:var(--evo);border-right:0;transform:translateY(-50%);z-index:1}}
.cell{{padding:10px 12px;border-bottom:1px solid var(--line);font-size:12.5px}}
.cell ul{{margin:0;padding-left:16px}} .cell li{{margin:0 0 5px}}
.cell.victoria{{grid-row:2;border-left:3px solid var(--vic)}}
.cell.humano{{grid-row:3;border-left:3px solid var(--hum)}}
.cell.rotinas{{grid-row:4;border-left:3px solid var(--rot)}}
.cell.sistemas{{grid-row:5;border-left:3px solid var(--sis);border-bottom:0}}
.rowlab.r1{{grid-row:1;background:var(--evo-bg);color:var(--evo);border-bottom:2px solid var(--evo)}}
.rowlab.r2{{grid-row:2;color:var(--vic)}} .rowlab.r3{{grid-row:3;color:var(--hum)}}
.rowlab.r4{{grid-row:4;color:var(--rot)}} .rowlab.r5{{grid-row:5;color:var(--sis);border-bottom:0}}
.outcol{{grid-row:1 / span 5;padding:12px;background:var(--out-bg);border-right:0;display:flex;flex-direction:column;gap:8px}}
.outcol h2{{font:700 16px/1.15 Archivo,sans-serif;margin:0 0 2px;color:var(--out)}}
.outcol .sub{{font-size:12px;color:var(--ink-2);margin:0 0 6px}}
.saida{{background:var(--paper);border:1px solid var(--out);border-radius:8px;padding:8px 10px;font-size:12px}}
.saida b{{display:block;color:var(--ink)}} .saida .auto{{font:500 10px/1 "IBM Plex Mono",monospace;color:var(--out)}}
.saida p{{margin:4px 0 0;color:var(--ink-2)}}
.movers{{margin:14px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--ink-2)}}
.movers span{{font:500 10px/1 "IBM Plex Mono",monospace;color:var(--evo);border:1px solid var(--evo);border-radius:3px;padding:2px 5px;margin-right:6px}}
h3{{font:700 18px/1.2 Archivo,sans-serif;margin:30px 0 10px}}
.transgrid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}}
.trans{{background:var(--tr-bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font-size:12.5px}}
.trans b{{display:block;color:var(--tr);margin-bottom:4px}} .trans p{{margin:0;color:var(--ink-2)}}
.note{{margin-top:26px;padding:12px 14px;border-left:3px solid var(--pause);background:var(--paper);border-radius:0 8px 8px 0;font-size:13px;max-width:78ch}}
.note b{{color:var(--pause)}}
footer{{margin-top:22px;font-size:12px;color:var(--ink-2)}}
</style>
<div class="wrap">
  <h1>Fluxo atual da VictorIA — AIVA</h1>
  <p class="lede">Retrato de 10/09/2026, tirado do código em produção. Cada coluna é uma etapa do funil 15 do Evo Talks, na ordem em que o card anda. Cada linha diz quem age naquela etapa. A versão editável está no arquivo .drawio que acompanha esta página.</p>
  <ul class="legend">
    <li><i style="background:var(--evo)"></i>Etapa no Evo (quem move)</li>
    <li><i style="background:var(--vic)"></i>VictorIA (webhook + prompt)</li>
    <li><i style="background:var(--hum)"></i>Humanos: Nei · Edu (AIVA) · Aldo</li>
    <li><i style="background:var(--rot)"></i>Rotinas automáticas (crons)</li>
    <li><i style="background:var(--sis)"></i>Sistemas e dados</li>
    <li><i style="background:var(--out)"></i>Saídas do funil</li>
  </ul>
  <div class="board"><div class="grid">
    <div class="rowlab r1">Etapa no Evo<small>funil 15 · automação de entrada → painel em ≈1 s</small></div>
    <div class="rowlab r2">VictorIA<small>o que ela faz e decide</small></div>
    <div class="rowlab r3">Humanos<small>quando entram e o que movem</small></div>
    <div class="rowlab r4">Rotinas<small>crons Vercel + tarefas agendadas (hora BRT)</small></div>
    <div class="rowlab r5">Sistemas<small>onde o dado vive</small></div>
    {''.join(cols_html)}
    <aside class="outcol">
      <h2>Saídas do funil</h2>
      <p class="sub">Estados fora da linha principal. Terminais nunca são revividos pelo sync.</p>
      {saidas_html}
    </aside>
  </div></div>
  <ul class="movers">{movers_html}</ul>
  <h3>Transversal — corre o funil inteiro</h3>
  <div class="transgrid">{trans_html}</div>
  <div class="note"><b>Dois pontos que o desenho deixa à mostra.</b> A régua D+3 / D+7 / D+14 está pausada desde 17/08 (0,12% de resposta, templates sem botão); foi religada em 10/09 e pausada de novo no mesmo dia, pra ativar os cerca de 4.100 leads vencidos já no fluxo novo. E o nudge externo de hora em hora não existe mais: fica só o do Vercel, uma vez ao dia, ao meio-dia.</div>
  <footer>Fontes: vercel.json, app/api/sdr/*, prompts/aiva.ts, lib/evotalks.ts, etapas do funil 15 via MCP do Evo, tarefas agendadas locais. Gerado junto com docs/fluxo-victoria-2026-09-10.drawio.</footer>
</div>
'''
io.open(sys.argv[1], 'w', encoding='utf-8', newline='\n').write(page)
print('html ok', len(page), 'bytes')
