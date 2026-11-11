# -*- coding: utf-8 -*-
"""Monta o .xlsx das lojas que o nosso quadro dá como fechadas e que não têm
loja criada do lado da AIVA (pedido do Aldo, 09/11/2026).

Entrada: scripts/out-lojas-sem-loja-na-aiva.json
Saída:   docs/Lojas-sem-loja-na-AIVA-2026-11-09.xlsx
"""
import json
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
D = json.load(open(os.path.join(AQUI, "out-lojas-sem-loja-na-aiva.json"), encoding="utf8"))
SAIDA = os.path.join(RAIZ, "docs", "Lojas-sem-loja-na-AIVA-2026-11-09.xlsx")

ARIAL = "Arial"
AZUL = PatternFill("solid", fgColor="1F3864")
VERM = PatternFill("solid", fgColor="FCE4E4")
AMAR = PatternFill("solid", fgColor="FFF2CC")
VERDE = PatternFill("solid", fgColor="E2EFDA")
CINZA = PatternFill("solid", fgColor="F2F2F2")
BORDA = Border(*(Side(style="thin", color="D9D9D9"),) * 4)

wb = Workbook()


def fmt_cnpj(c):
    c = "".join(ch for ch in str(c or "") if ch.isdigit())
    return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}" if len(c) == 14 else str(c or "")


def fmt_tel(t):
    t = "".join(ch for ch in str(t or "") if ch.isdigit())
    if len(t) == 13 and t.startswith("55"):
        return f"({t[2:4]}) {t[4:9]}-{t[9:]}"
    if len(t) == 12 and t.startswith("55"):
        return f"({t[2:4]}) {t[4:8]}-{t[8:]}"
    return t


COR = {"A": VERM, "B": AMAR, "C": VERDE, "D": CINZA}

# ───────────────────────────── Resumo ─────────────────────────────
ws = wb.active
ws.title = "Resumo"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 56
ws.column_dimensions["B"].width = 12
ws.column_dimensions["C"].width = 86

cont = {}
for l in D:
    cont[l["situacao"][0]] = cont.get(l["situacao"][0], 0) + 1
amao = len([l for l in D if l["aMao"] == "sim"])
grupo = len([l for l in D if l["grupoJaELoja"] == "sim"])
comtel = len([l for l in D if l["telefone"]])

r = 1
ws.cell(row=r, column=1, value="LOJAS SEM LOJA CRIADA NA AIVA — 09/11/2026").font = Font(name=ARIAL, size=14, bold=True, color="1F3864")
r += 1
ws.cell(row=r, column=1, value="Saiu da conferência da comissão Ume de outubro: toda loja desta lista está SEM retailer ID.").font = Font(name=ARIAL, size=9, italic=True, color="666666")
r += 1
ws.cell(row=r, column=1, value="Sem retailer ID não há venda registrada — e sem venda registrada ela nunca entra num fechamento da Ume.").font = Font(name=ARIAL, size=9, italic=True, color="666666")
r += 2

LIN = [
    ("__sec__", "O QUE ESTA LISTA É", None),
    ("Lojas nossas sem retailer ID", len(D),
     "Reunidas do funil 11 (contas fechadas), funil 15, sdr_registros_cnpj, sdr_leads e portal AIVA. "
     "Nenhuma delas pode aparecer num fechamento da Ume enquanto estiver assim."),
    ("Dessas, marcadas como CONTA FECHADA no funil 11", cont.get("A", 0) + cont.get("B", 0),
     "É o grupo que importa: o nosso quadro as conta como negócio ganho e a AIVA não tem loja criada para elas."),
    ("Com telefone do lojista para retomar", comtel, "As demais só têm o card do funil 11, sem contato próprio."),
    ("Movidas à MÃO para 'vendendo'", amao,
     "O lead virou LOJA_FINALIZADA_E_VENDENDO ANTES de o pré-cadastro ser enviado — ordem impossível pelo "
     "caminho normal. Alguém arrastou o card no Evo."),
    ("De grupo que JÁ é loja na AIVA com outro CNPJ", grupo,
     "Filial sem cadastro próprio. Aqui não é prospecção: é cadastrar a filial de um lojista que já opera."),

    ("__sec__", "AS QUATRO SITUAÇÕES (coluna Situação, com filtro na aba Lojas)", None),
    ("A — fechada no funil 11 e SEM cadastro no portal", cont.get("A", 0),
     "O pior caso. O funil 11 diz conta fechada e a AIVA não tem NENHUM registro do CNPJ. "
     "Ação: decidir uma a uma — retomar o cadastro ou tirar do funil 11."),
    ("B — fechada no funil 11, cadastro no portal sem loja criada", cont.get("B", 0),
     "O cadastro existe na AIVA mas parou antes de virar loja (em geral em 'dados_varejo'). "
     "Ação: destravar com o lojista ou com a AIVA — é a mais perto de virar receita."),
    ("C — não marcada como fechada, cadastro em andamento", cont.get("C", 0),
     "Comportamento esperado de cadastro em curso. Só entra aqui para a lista ficar completa."),
    ("D — não marcada como fechada e sem cadastro no portal", cont.get("D", 0),
     "Nem fechada nem cadastrada. Sem ação de comissão."),

    ("__sec__", "COMO LER AS COLUNAS", None),
    ("Diagnóstico", "", "Diz em uma linha por que esta loja não tem retailer ID."),
    ("Movida à mão", "",
     "'sim' quando a data em que o lead virou 'vendendo' é anterior à data do pré-cadastro. "
     "Essas são as que mais sujam o funil 11."),
    ("Grupo já é loja na AIVA / CNPJs irmãos", "",
     "Outro CNPJ com a mesma raiz (8 primeiros dígitos) que já tem retailer ID. "
     "Quando tem, o lojista não sumiu — foi ESTE CNPJ que não virou loja."),
    ("Quadro no portal / Biometria", "", "Vêm da API de onboardings ao vivo (chave própria, continua funcionando)."),
    ("Card F11 / Card F15", "", "Número da oportunidade no Evo, para abrir direto."),

    ("__sec__", "⚠️ RESSALVA", None),
    ("Coleta do portal parada desde 26/10", "",
     "A rotina que copia o desempenho do portal não roda desde 26/10 (a AIVA desligou o login por e-mail e senha). "
     "A presença no portal e o quadro de cada loja aqui vieram da API de onboardings AO VIVO, que não depende "
     "desse login — então esta lista está atualizada. O que está velho é só o histórico de vendas."),
]

for k, v, obs in LIN:
    if k == "__sec__":
        r += 1
        for cc in range(1, 4):
            c = ws.cell(row=r, column=cc, value=v if cc == 1 else None)
            c.fill = AZUL
            c.border = BORDA
            c.font = Font(name=ARIAL, size=11, bold=True, color="FFFFFF")
        r += 1
        continue
    a = ws.cell(row=r, column=1, value=k)
    b = ws.cell(row=r, column=2, value=v)
    c = ws.cell(row=r, column=3, value=obs)
    a.font = Font(name=ARIAL, size=10)
    b.font = Font(name=ARIAL, size=11, bold=True)
    c.font = Font(name=ARIAL, size=9, color="444444")
    b.alignment = Alignment(horizontal="center")
    c.alignment = Alignment(wrap_text=True, vertical="top")
    for cc in (a, b, c):
        cc.border = BORDA
    if k.startswith("A —"):
        b.fill = VERM
    if k.startswith("B —"):
        b.fill = AMAR
    if k.startswith("C —"):
        b.fill = VERDE
    if k.startswith("D —"):
        b.fill = CINZA
    ws.row_dimensions[r].height = 32
    r += 1

# ───────────────────────────── Lojas ─────────────────────────────
ws = wb.create_sheet("Lojas")
cols = [
    ("Situação", 46, lambda l: l["situacao"]),
    ("Loja", 34, lambda l: l["loja"]),
    ("CNPJ", 20, lambda l: fmt_cnpj(l["cnpj"])),
    ("Sócio", 24, lambda l: l["socio"]),
    ("Telefone", 17, lambda l: fmt_tel(l["telefone"])),
    ("E-mail", 28, lambda l: l["email"]),
    ("Região", 26, lambda l: l["regiao"]),
    ("Diagnóstico", 62, lambda l: l["diagnostico"]),
    ("Movida à mão", 12, lambda l: l["aMao"]),
    ("Status do lead", 28, lambda l: l["statusLead"]),
    ("Status desde", 13, lambda l: l["statusDesde"]),
    ("Status do pré-cadastro", 22, lambda l: l["statusRegistro"]),
    ("Pré-cadastro em", 15, lambda l: l["preCadastroEm"]),
    ("Origem", 14, lambda l: l["origem"]),
    ("Está no portal?", 13, lambda l: l["noPortal"]),
    ("Quadro no portal", 20, lambda l: l["quadroPortal"]),
    ("Biometria", 14, lambda l: l["biometria"]),
    ("Grupo já é loja na AIVA", 14, lambda l: l["grupoJaELoja"]),
    ("CNPJs irmãos já com retailer ID", 54, lambda l: l["irmasNaAiva"]),
    ("Último contato", 14, lambda l: l["ultimoContato"]),
    ("Card F11", 10, lambda l: l["cardF11"]),
    ("Card F15", 10, lambda l: l["cardF15"]),
    ("Fontes", 60, lambda l: l["fontes"]),
]
TEXTO = {"CNPJ", "Telefone", "Card F11", "Card F15"}

for i, (titulo, larg, _) in enumerate(cols, start=1):
    c = ws.cell(row=1, column=i, value=titulo)
    c.font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
    c.fill = AZUL
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDA
    ws.column_dimensions[get_column_letter(i)].width = larg
ws.row_dimensions[1].height = 32
ws.freeze_panes = "C2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}1"

for rr, item in enumerate(D, start=2):
    fill = COR.get(item["situacao"][0])
    for i, (titulo, _, chave) in enumerate(cols, start=1):
        v = chave(item)
        c = ws.cell(row=rr, column=i, value=v)
        c.font = Font(name=ARIAL, size=10, bold=(titulo == "Loja"))
        c.border = BORDA
        c.alignment = Alignment(vertical="center", wrap_text=(titulo in ("Diagnóstico", "CNPJs irmãos já com retailer ID", "Fontes")))
        if titulo in TEXTO:
            c.number_format = "@"
        if titulo == "Situação" and fill:
            c.fill = fill
        if titulo == "Movida à mão" and v == "sim":
            c.fill = VERM
            c.font = Font(name=ARIAL, size=10, bold=True)
        if titulo == "Grupo já é loja na AIVA" and v == "sim":
            c.fill = VERDE
    ws.row_dimensions[rr].height = 28
ws.sheet_view.showGridLines = False

os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
wb.save(SAIDA)
print("gravado:", SAIDA, os.path.getsize(SAIDA), "bytes")
for s in wb.sheetnames:
    print("  aba %-12s %d linhas" % (s, wb[s].max_row))
