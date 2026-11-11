# -*- coding: utf-8 -*-
"""Plano de ação por prioridade — comissões e carteira AIVA/Ume (09/11/2026).

Saída: docs/Plano-de-acao-comissoes-e-carteira-2026-11-09.xlsx
"""
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "docs", "Plano-de-acao-comissoes-e-carteira-2026-11-09.xlsx")

ARIAL = "Arial"
AZUL = PatternFill("solid", fgColor="1F3864")
VERM = PatternFill("solid", fgColor="F8CBAD")
AMAR = PatternFill("solid", fgColor="FFF2CC")
VERDE = PatternFill("solid", fgColor="E2EFDA")
CINZA = PatternFill("solid", fgColor="F2F2F2")
BORDA = Border(*(Side(style="thin", color="D9D9D9"),) * 4)

# (prioridade, ação, por quê, dono, depende de, status, esforço, pronto quando)
ACOES = [
    (1, "Pedir ao Gerisson a lista de varejos da Track",
     "É o único documento que fecha a conta de uma vez. O retailer ID é a única chave que atravessa as "
     "três bases; sem ele, 'quantas lojas temos operando' continua sendo opinião. Destrava as prioridades 5 e 6.",
     "Aldo", "—", "A FAZER",
     "20 min",
     "A lista chegou com retailer ID, CNPJ, grupo/canal, data de ativação e situação.",
     "Mensagem pronta: docs/Mensagem-Gerisson-lista-varejos-Track-2026-11-09.md"),

    (2, "Mandar ao Mauricio a cobrança dos 577 cadastros travados",
     "577 cadastros que a AIVA aceitou e nunca viraram loja — 527 parados no formulário do varejo. É a maior "
     "perda da operação e não é comissão: é cadastro que não anda. Nenhum deles pode gerar receita como está.",
     "Aldo", "—", "A FAZER",
     "20 min",
     "Sabemos se o formulário expira, por que trava, se dá para reenviar em lote e o motivo dos 11 recusados.",
     "Mensagem pronta: docs/Mensagem-Mauricio-cadastros-travados-2026-11-09.md"),

    (3, "Religar o acesso ao desempenho do portal",
     "A coleta está parada desde 26/10: a AIVA desligou o login por e-mail e senha. Ficamos cegos nos últimos "
     "dias de cada mês — foi o que obrigou a conferência de outubro a improvisar — e as dicas semanais rodam "
     "com dado congelado.",
     "Mauricio (AIVA)", "—", "EM ANDAMENTO",
     "—",
     "A rotina das 6h volta a gravar e aparece dado de novembro em aiva_portal_diario.",
     "Aldo já pediu ao Mauricio. Alternativa: chave de API como a de onboardings, que continua funcionando."),

    (4, "Fazer o vigia acusar coleta parada",
     "A coleta morreu em 26/10 e ninguém soube por 14 dias. O vigia das 17h confere rota respondendo, não dado "
     "chegando. Enquanto for assim, a próxima parada também vai passar batida.",
     "código", "—", "EM ANDAMENTO",
     "1 sessão",
     "O vigia rodado em ?dry acusa a coleta parada com o número de dias; erro de login sai nomeado.",
     "Sessão já rodando."),

    (5, "Limpar as contas fechadas que não existem na AIVA",
     "636 contas fechadas no funil 11, 292 sem loja criada na AIVA. E há card movido à mão para 'Loja Finalizada "
     "e Vendendo' ANTES de o pré-cadastro existir (AF Celulares: marcada em 23/07, pré-cadastro em 03/11). "
     "É por isso que nenhum número nosso bate com o deles.",
     "Nei", "—", "A FAZER",
     "meio dia",
     "Cada uma das 292 decidida: retoma o cadastro ou sai do funil 11. Zero card em etapa de loja sem retailer ID.",
     "Lista: docs/Lojas-sem-loja-na-AIVA-2026-11-09.xlsx (49 sem retailer ID) + aba 'Todas as lojas' da reconciliação."),

    (6, "Criar a carteira única (retailer ID ↔ CNPJ ↔ canal)",
     "Uma tabela só, com precedência explícita entre as fontes, que responde 'esta loja é da Track e está "
     "operando'. Hoje isso é remontado na unha a cada pergunta.",
     "código", "prioridade 1 (para ficar definitiva)", "A FAZER",
     "1 sessão",
     "A carga roda, explica cada linha pela origem, e as divergências entre fontes saem listadas em vez de escondidas.",
     "Pode começar sem a lista da Ume e absorvê-la quando chegar."),

    (7, "Automatizar a conferência mensal da comissão",
     "O script já existe e rodou outubro inteiro. Falta virar rotina: quando o fechamento chega, roda sozinho e "
     "cospe loja a loja, por canal. O que hoje leva uma sessão passa a levar dez minutos.",
     "código", "prioridade 6", "A FAZER",
     "1 sessão",
     "Chegou a apuração → sai a conferência com os quatro estados por loja, sem ninguém pedir.",
     "Base: scripts/conferencia-ume-2026-10.mjs (trocar três constantes no topo já serve para novembro)."),

    (8, "Guardar no banco a resposta da whitelist",
     "Quando o pré-cadastro volta como 'CNPJ já cadastrado' ou 'reservado por outro parceiro', isso morre na "
     "caixa de e-mail do Nei. É a medida de loja que perdemos para outro parceiro — em novembro foram pelo "
     "menos 22 CNPJs, e nenhum aparece em relatório nenhum.",
     "código", "—", "A FAZER",
     "meio dia",
     "Toda resposta da whitelist vira linha no banco, com data e motivo, e entra num contador.",
     "Hoje só existem os e-mails do iury.barbosa@ume.com.br."),

    (9, "Confirmar com o Nei a origem do 527",
     "O relatório dele aponta 527 em 25/10 como 'lojas ativas vendendo'. Hoje 527 é EXATAMENTE o número de "
     "cadastros nossos parados em dados_varejo — ou seja, lojas que nunca viraram loja. Se for isso, a leitura "
     "está invertida e vale corrigir antes que vire meta.",
     "Aldo / Nei", "—", "A FAZER",
     "10 min",
     "Sabemos qual relatório é e o que ele conta.",
     "Para comparar: enviados 897 · onboardings 878 · passaram do formulário 428 · lojas criadas 352 · "
     "medidas pelo portal 369 · contas fechadas 636 · etapa 51 157."),
]

wb = Workbook()

# ───────────── Resumo ─────────────
ws = wb.active
ws.title = "Resumo"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 60
ws.column_dimensions["B"].width = 90

r = 1
ws.cell(row=r, column=1, value="PLANO DE AÇÃO — comissões e carteira AIVA / Ume").font = Font(name=ARIAL, size=14, bold=True, color="1F3864")
r += 1
ws.cell(row=r, column=1, value="Track / 2N Soluções · 09/11/2026").font = Font(name=ARIAL, size=9, italic=True, color="666666")
r += 2

BLOCOS = [
    ("O PROBLEMA DE FUNDO",
     "Existem três bases — o nosso Evo/banco, o portal da AIVA e o fechamento da Ume — e nenhuma delas é dona da "
     "verdade sobre 'esta loja é da Track'. Não é um bug para corrigir: é um registro que não existe. Enquanto for "
     "assim, toda conferência vai ser arqueologia e todo número vai divergir."),
    ("O QUE JÁ SABEMOS (medido em 09/11)",
     "Mandamos 1.041 CNPJs à AIVA; ela reconhece 385 como loja. 577 cadastros foram abertos e nunca viraram loja, "
     "527 deles parados no formulário do varejo. Do nosso lado, 636 contas fechadas no funil 11, das quais 292 não "
     "existem como loja na AIVA. E 209 das lojas que a Ume nos paga (R$ 26.963,91 de R$ 38.528,25 em outubro) não "
     "aparecem no portal, porque o portal só enxerga o canal AIVA."),
    ("O QUE NÃO É PROBLEMA",
     "O portal da AIVA não encolheu: em 45 dias de retrato diário a carteira Track só subiu (214 em 08/09 → 372 em "
     "26/10) e nenhuma loja saiu de um retrato para o outro. A apuração de outubro está correta até o centavo e "
     "nenhuma loja que vendeu ficou de fora. Os três casos de venda não paga que apareceram na varredura das "
     "conversas JÁ FORAM PAGOS."),
    ("COMO LER ESTA LISTA",
     "As prioridades 1 e 2 são dois e-mails e custam quarenta minutos somados — e são o que destrava o resto. "
     "As de código (6 e 7) ficam definitivas depois que a lista da Ume chegar, mas podem começar antes. "
     "A 5 é a única que depende só de nós e já dá para fazer hoje."),
]
for titulo, texto in BLOCOS:
    for cc in (1, 2):
        c = ws.cell(row=r, column=cc, value=titulo if cc == 1 else None)
        c.fill = AZUL
        c.border = BORDA
        c.font = Font(name=ARIAL, size=11, bold=True, color="FFFFFF")
    r += 1
    c = ws.cell(row=r, column=1, value=texto)
    c.font = Font(name=ARIAL, size=10)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    c.border = BORDA
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
    ws.row_dimensions[r].height = 62
    r += 2

# ───────────── Plano ─────────────
ws = wb.create_sheet("Plano")
cols = [("#", 5), ("Ação", 44), ("Por quê", 70), ("Dono", 16), ("Depende de", 24),
        ("Status", 14), ("Esforço", 11), ("Pronto quando", 60), ("Apoio", 70)]
for i, (t, larg) in enumerate(cols, start=1):
    c = ws.cell(row=1, column=i, value=t)
    c.font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
    c.fill = AZUL
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDA
    ws.column_dimensions[get_column_letter(i)].width = larg
ws.row_dimensions[1].height = 30
ws.freeze_panes = "C2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}1"

CORSTATUS = {"A FAZER": AMAR, "EM ANDAMENTO": VERDE, "FEITO": CINZA}
for rr, linha in enumerate(ACOES, start=2):
    for i, v in enumerate(linha, start=1):
        c = ws.cell(row=rr, column=i, value=v)
        c.font = Font(name=ARIAL, size=10, bold=(i in (1, 2)))
        c.border = BORDA
        c.alignment = Alignment(vertical="top", wrap_text=(i in (3, 8, 9)),
                                horizontal="center" if i in (1, 4, 6, 7) else "left")
    ws.cell(row=rr, column=6).fill = CORSTATUS.get(linha[5], CINZA)
    if linha[0] <= 2:
        ws.cell(row=rr, column=1).fill = VERM
    ws.row_dimensions[rr].height = 86
ws.sheet_view.showGridLines = False

os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
wb.save(SAIDA)
print("gravado:", SAIDA, os.path.getsize(SAIDA), "bytes")
for s in wb.sheetnames:
    print("  aba %-12s %d linhas" % (s, wb[s].max_row))
