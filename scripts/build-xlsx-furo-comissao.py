# -*- coding: utf-8 -*-
"""Monta o .xlsx do furo de comissão — lojas fechadas pela Track, vendendo,
fora do fechamento da Ume (pedido do Aldo, 09/11/2026).

Entrada: scripts/out-furo-comissao.json
Saída:   docs/Furo-comissao-lojas-vendendo-2026-11-09.xlsx
"""
import json
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
J = json.load(open(os.path.join(AQUI, "out-furo-comissao.json"), encoding="utf8"))
LINHAS, POP = J["linhas"], J["populacao"]
SAIDA = os.path.join(RAIZ, "docs", "Furo-comissao-lojas-vendendo-2026-11-09.xlsx")

ARIAL = "Arial"
AZUL = PatternFill("solid", fgColor="1F3864")
VERM = PatternFill("solid", fgColor="F8CBAD")
LARANJA = PatternFill("solid", fgColor="FFF2CC")
CINZA = PatternFill("solid", fgColor="F2F2F2")
VERDE = PatternFill("solid", fgColor="E2EFDA")
BORDA = Border(*(Side(style="thin", color="D9D9D9"),) * 4)
COR = {"RECLAMOU": VERM, "ALTA": LARANJA, "MEDIA": CINZA}

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


def tabela(ws, cols, dados, texto=(), cor=None, altura=None):
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
    for rr, item in enumerate(dados, start=2):
        for i, (titulo, _, chave) in enumerate(cols, start=1):
            v = chave(item)
            c = ws.cell(row=rr, column=i, value=v)
            c.font = Font(name=ARIAL, size=10, bold=(titulo == "Loja"))
            c.border = BORDA
            c.alignment = Alignment(vertical="top", wrap_text=(titulo in ("O que o lojista disse", "Fontes")))
            if titulo in texto:
                c.number_format = "@"
            if cor:
                f = cor(item, titulo)
                if f:
                    c.fill = f
        if altura:
            ws.row_dimensions[rr].height = altura(item)
    ws.sheet_view.showGridLines = False


# ───────────────────────────── Resumo ─────────────────────────────
ws = wb.active
ws.title = "Resumo"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 56
ws.column_dimensions["B"].width = 12
ws.column_dimensions["C"].width = 88

n = {k: len([l for l in LINHAS if l["forca"] == k]) for k in ("RECLAMOU", "ALTA", "MEDIA")}
semRid = len([l for l in LINHAS if l["temRid"] == "nao"])

r = 1
ws.cell(row=r, column=1, value="ONDE ESTÁ O FURO — lojas fechadas, vendendo, fora do fechamento").font = Font(name=ARIAL, size=14, bold=True, color="1F3864")
r += 1
ws.cell(row=r, column=1, value="Track / 2N Soluções · 09/11/2026 · base: fechamento Ume de outubro/2026 + conversas da VictorIA").font = Font(name=ARIAL, size=9, italic=True, color="666666")
r += 2

LIN = [
    ("__sec__", "A IDEIA", None),
    ("", "",
     "Se o lojista VENDE pelo AIVA, a loja existe do lado da Ume — com retailer ID e tudo. Se mesmo assim ela "
     "não aparece no nosso relatório de comissão, o que falta não é a loja: é o VÍNCULO dela com a Track. "
     "A comissão dela está sendo paga para outro lugar, ou para ninguém."),
    ("", "",
     "Isso não dá para ver pelo portal da AIVA: ele já vem filtrado pelo partner_id da Track, então o que não "
     "é nosso simplesmente não aparece lá. A prova de venda teve que vir de outro lugar — e veio da CONVERSA. "
     "O lojista conta que vendeu, reclama que a venda não caiu, pede ajuda. Essa é a única fonte que não "
     "depende da Ume nem do portal."),

    ("__sec__", "O TAMANHO DO PROBLEMA", None),
    ("Lojas que a Track fechou", 706, "Funil 11 (contas fechadas MRR), funil 15, registros, leads e portal AIVA."),
    ("Dessas, FORA do fechamento de outubro", len(POP),
     "57% da carteira fechada não gerou um centavo em outubro. A maior parte é loja que de fato não vendeu — "
     "o trabalho é separar essas das que venderam."),
    ("Com conversa rastreável no WhatsApp", len([x for x in POP if x["temConversa"] == "sim"]),
     "As outras só existem como card do funil 11, sem conversa ligada — nelas não há como procurar prova de venda."),
    ("Que FALARAM de venda na conversa", len(LINHAS), "Varredura das mensagens RECEBIDAS por termos de venda e financiamento."),

    ("__sec__", "A LISTA PRIORITÁRIA (aba 'Furo provavel')", None),
    ("RECLAMOU — vendeu e a venda não apareceu", n["RECLAMOU"],
     "O nível mais forte e o mais barato de provar: o lojista diz que vendeu E que a venda não caiu, com data. "
     "É o furo descrito na voz de quem vendeu. Começar por estes três."),
    ("ALTA — afirma venda feita", n["ALTA"],
     "Venda concluída, no passado, sem ser intenção nem venda em outra financeira."),
    ("MEDIA — fala de venda sem confirmar", n["MEDIA"],
     "Ficam na aba 'Todas as evidencias'. Servem de segunda rodada, não de cobrança."),
    ("Dessas, SEM retailer ID nenhum", semRid,
     "Pior caso: vende e nem sequer temos o número do varejo para citar na cobrança."),

    ("__sec__", "COMO USAR", None),
    ("1. Levar os RECLAMOU ao Gerisson", "",
     "Cada um tem CNPJ, data e a frase do lojista. Pedir o extrato de vendas desses CNPJs no período e "
     "perguntar a qual parceiro a comissão foi creditada."),
    ("2. Pedir a lista de varejos Track na base da Ume", "",
     "Já está em aberto no CLAUDE.md. É o único jeito de fechar a conta de uma vez: comparar a lista deles "
     "com a nossa e ver quem está fora."),
    ("3. Conferir com o lojista", "",
     "Os 12 da lista prioritária têm telefone. Uma pergunta — 'quantas vendas você fez pelo AIVA?' — "
     "transforma indício em prova."),

    ("__sec__", "⚠️ O QUE ESTA LISTA NÃO É", None),
    ("Não é prova de venda", "",
     "É o que o lojista DISSE, com data e texto à vista. A leitura final é humana — por isso o trecho vai "
     "na planilha, não só a classificação."),
    ("Não cobre quem não conversa com a VictorIA", "",
     f"{len([x for x in POP if x['temConversa'] == 'nao'])} lojas fechadas não têm conversa ligada. Se o lojista falou com o Nei pelo "
     "telefone dele, ou mandou vídeo por outro canal, não há como essa varredura enxergar."),
    ("Não usa o desempenho do portal", "",
     "A coleta está parada desde 26/10 (a AIVA desligou o login por e-mail e senha). Quando voltar, dá para "
     "cruzar venda registrada x comissão paga e esta lista fica muito mais curta e mais certeira."),
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
    a.font = Font(name=ARIAL, size=10, bold=k.startswith(("RECLAMOU", "ALTA", "MEDIA")))
    b.font = Font(name=ARIAL, size=11, bold=True)
    c.font = Font(name=ARIAL, size=9, color="444444")
    b.alignment = Alignment(horizontal="center")
    c.alignment = Alignment(wrap_text=True, vertical="top")
    for cc in (a, b, c):
        cc.border = BORDA
    if k.startswith("RECLAMOU"):
        b.fill = VERM
    if k.startswith("ALTA"):
        b.fill = LARANJA
    if k.startswith("MEDIA"):
        b.fill = CINZA
    ws.row_dimensions[r].height = 40 if len(obs or "") > 110 else 28
    r += 1

# ──────────────────────── Furo provável ────────────────────────
COLS = [
    ("Força", 11, lambda l: l["forca"]),
    ("Loja", 30, lambda l: l["loja"]),
    ("CNPJ", 20, lambda l: fmt_cnpj(l["cnpj"])),
    ("Telefone", 17, lambda l: fmt_tel(l["telefone"])),
    ("Retailer ID", 12, lambda l: l["rid"] or "SEM RID"),
    ("O que o lojista disse (data + trecho)", 86, lambda l: l["trechos"]),
    ("Msgs falando de venda", 11, lambda l: l["msgsVenda"]),
    ("Msgs afirmando venda", 11, lambda l: l["msgsVendaAfirmada"]),
    ("Msgs reclamando", 11, lambda l: l["msgsReclamando"]),
    ("Primeira fala de venda", 14, lambda l: l["primeiraFala"]),
    ("Última fala de venda", 14, lambda l: l["ultimaFala"]),
    ("Último contato", 13, lambda l: l["ultimoContato"]),
    ("Status do lead", 26, lambda l: l["statusLead"]),
    ("Status do pré-cadastro", 20, lambda l: l["statusRegistro"]),
    ("Pré-cadastro em", 14, lambda l: l["preCadastroEm"]),
    ("Fontes", 56, lambda l: l["fontes"]),
]
TXT = {"CNPJ", "Telefone", "Retailer ID"}


def cor_forca(item, titulo):
    if titulo == "Força":
        return COR.get(item["forca"])
    if titulo == "Retailer ID" and item["temRid"] == "nao":
        return VERM
    return None


prior = [l for l in LINHAS if l["forca"] in ("RECLAMOU", "ALTA")]
ws = wb.create_sheet("Furo provavel")
tabela(ws, COLS, prior, texto=TXT, cor=cor_forca,
       altura=lambda l: min(120, 16 + 15 * (l["trechos"].count("\n") + 1 + len(l["trechos"]) // 110)))

ws = wb.create_sheet("Todas as evidencias")
tabela(ws, COLS, LINHAS, texto=TXT, cor=cor_forca,
       altura=lambda l: min(90, 16 + 14 * (l["trechos"].count("\n") + 1 + len(l["trechos"]) // 120)))

# ──────────────────── População inteira ────────────────────
COLS2 = [
    ("Falou de venda?", 13, lambda l: l["falouDeVenda"]),
    ("Força", 11, lambda l: l["forca"]),
    ("Loja", 32, lambda l: l["loja"]),
    ("CNPJ", 20, lambda l: fmt_cnpj(l["cnpj"])),
    ("Telefone", 17, lambda l: fmt_tel(l["telefone"])),
    ("Retailer ID", 12, lambda l: l["rid"] or "SEM RID"),
    ("Tem conversa?", 12, lambda l: l["temConversa"]),
    ("Último contato", 13, lambda l: l["ultimoContato"]),
    ("Status do lead", 26, lambda l: l["statusLead"]),
    ("Status do pré-cadastro", 20, lambda l: l["statusRegistro"]),
    ("Pré-cadastro em", 14, lambda l: l["preCadastroEm"]),
    ("Fontes", 62, lambda l: l["fontes"]),
]


def cor_pop(item, titulo):
    if titulo == "Força" and item["forca"]:
        return COR.get(item["forca"])
    if titulo == "Falou de venda?" and item["falouDeVenda"] == "sim":
        return LARANJA
    if titulo == "Retailer ID" and item["temRid"] == "nao":
        return VERM
    return None


ws = wb.create_sheet("Fechadas fora do fechamento")
tabela(ws, COLS2, POP, texto={"CNPJ", "Telefone", "Retailer ID"}, cor=cor_pop)

os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
wb.save(SAIDA)
print("gravado:", SAIDA, os.path.getsize(SAIDA), "bytes")
for s in wb.sheetnames:
    print("  aba %-30s %d linhas" % (s, wb[s].max_row))
