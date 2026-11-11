# -*- coding: utf-8 -*-
"""Monta o .xlsx da reconciliação Track × portal AIVA × fechamento Ume
(pedido do Aldo, 09/11/2026: "traga a verdade sobre isso").

Entradas: scripts/out-cascata-track-aiva.json, scripts/out-conferencia-ume-2026-10.json
Saída:    docs/Track-x-portal-AIVA-reconciliacao-2026-11-09.xlsx
"""
import json
import os

from openpyxl import Workbook
from openpyxl.chart import LineChart, Reference
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
C = json.load(open(os.path.join(AQUI, "out-cascata-track-aiva.json"), encoding="utf8"))
J = json.load(open(os.path.join(AQUI, "out-conferencia-ume-2026-10.json"), encoding="utf8"))
SAIDA = os.path.join(RAIZ, "docs", "Track-x-portal-AIVA-reconciliacao-2026-11-09.xlsx")

ARIAL = "Arial"
AZUL = PatternFill("solid", fgColor="1F3864")
VERM = PatternFill("solid", fgColor="F8CBAD")
AMAR = PatternFill("solid", fgColor="FFF2CC")
VERDE = PatternFill("solid", fgColor="E2EFDA")
CINZA = PatternFill("solid", fgColor="F2F2F2")
BORDA = Border(*(Side(style="thin", color="D9D9D9"),) * 4)
MOEDA = 'R$ #,##0.00'

LINHAS = C["linhas"]
grupo_rid = {str(l["rid"]): f'{l["planilha"]} / {l["grupo"] or "SEM GRUPO"}' for l in J["relatorioLinhas"]}
grupo_cnpj = {l["cnpj"]: f'{l["planilha"]} / {l["grupo"] or "SEM GRUPO"}' for l in J["relatorioLinhas"] if l["cnpj"]}


def grupo(l):
    for r in str(l.get("retailerId") or "").split("/"):
        if r in grupo_rid:
            return grupo_rid[r]
    return grupo_cnpj.get(l["cnpj"], "")


def nossa(l):
    return (l["mandamos"] == "sim" or l["contaFechadaEvo"] == "sim"
            or l["etapa15"] or l["noPortal"] == "sim" or l["statusLead"])


for l in LINHAS:
    l["grupo"] = grupo(l)
    l["nossa"] = "sim" if nossa(l) else "nao"

NOSSAS = [l for l in LINHAS if l["nossa"] == "sim"]
PAGAS_N = [l for l in NOSSAS if l["pagaEmOutubro"] == "sim"]
FORA_PORTAL = [l for l in PAGAS_N if l["noPortal"] == "nao"]
NO_PORTAL_SEM_PAG = [l for l in LINHAS if l["noPortal"] == "sim" and l["pagaEmOutubro"] == "nao"]

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


def brl(v):
    return "R$ " + f"{v:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")


def tabela(ws, cols, dados, texto=(), cor=None):
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
            c.alignment = Alignment(vertical="center")
            if titulo in texto:
                c.number_format = "@"
            if isinstance(v, float):
                c.number_format = MOEDA
            if cor:
                f = cor(item, titulo)
                if f:
                    c.fill = f
    ws.sheet_view.showGridLines = False


# ───────────────────────────── Resumo ─────────────────────────────
ws = wb.active
ws.title = "Resumo"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 58
ws.column_dimensions["B"].width = 14
ws.column_dimensions["C"].width = 88

casc = C["cascata"]
com_fora = sum(l["comissaoOut"] for l in FORA_PORTAL)
com_total = sum(l["comissaoOut"] for l in PAGAS_N)
com_portal = com_total - com_fora

r = 1
ws.cell(row=r, column=1, value="TRACK × PORTAL AIVA × FECHAMENTO UME — a verdade sobre os números").font = Font(name=ARIAL, size=14, bold=True, color="1F3864")
r += 1
ws.cell(row=r, column=1, value="09/11/2026 · retratos do portal de 08/09 a 26/10 · fechamento Ume de outubro/2026").font = Font(name=ARIAL, size=9, italic=True, color="666666")
r += 2

LIN = [
    ("__sec__", "AS TRÊS RESPOSTAS", None),
    ("1. O portal da AIVA encolheu?", "NÃO",
     f"Guardamos retrato diário do portal desde 08/09. Em 45 dias a carteira Track só SUBIU: 214 lojas em "
     f"08/09, 369 em 25/10, {C['cascata']['noPortal']} medidas no total. ZERO lojas sumiram do portal — nenhuma "
     "saiu de um retrato para o outro. A curva está na aba 'Curva do portal'."),
    ("2. Então por que o número não bate?", "bases diferentes",
     "O portal da AIVA NÃO é a carteira da Track: ele só enxerga o canal AIVA (INSIDE_SALES). Tudo que a Ume "
     "nos paga por fora desse canal — Instituto Visão Solidária, Grupo Mini Preço, Realme, Odres — nunca passa "
     "pelo portal. Comparar a contagem do portal com a nossa é comparar universos diferentes."),
    ("3. De onde sai o 527 do Nei?", "não achei",
     "Nenhuma contagem nossa dá 527 em 25/10, nem perto: pré-cadastros enviados 897, onboardings criados 878, "
     "cadastros que passaram do formulário 428, lojas criadas 352, lojas medidas pelo portal 369, contas "
     "fechadas no funil 11 636, cards na etapa 51 157. Preciso do arquivo do Nei para dizer o que ele conta."),

    ("__sec__", "A PROVA DA RESPOSTA 2 (aba 'Pagas fora do portal')", None),
    ("Lojas nossas pagas no fechamento de outubro", len(PAGAS_N), brl(com_total)),
    ("   que o portal da AIVA mostra", len(PAGAS_N) - len(FORA_PORTAL), f"{brl(com_portal)} — são as do canal INSIDE_SALES."),
    ("   ⚠️ que o portal NÃO mostra", len(FORA_PORTAL),
     f"{brl(com_fora)} — {com_fora / com_total * 100:.0f}% da nossa comissão de outubro vem de loja que o portal "
     "da AIVA não lista. Não é furo: é canal que não passa por lá."),
    ("   das quais, Instituto Visão Solidária", len([l for l in FORA_PORTAL if "VISAO" in l["grupo"]]),
     "O maior grupo da nossa carteira e invisível no portal."),

    ("__sec__", "A CASCATA — o que mandamos até o que a Ume paga (chave: CNPJ)", None),
    ("1. mandamos para a AIVA (pré-cadastro)", casc["mandamos"], "sdr_registros_cnpj — todo CNPJ já enviado à whitelist."),
    ("2. a AIVA abriu cadastro", casc["onboarding"],
     f"{casc['mandamos'] - casc['onboarding']} CNPJs que mandamos e não viraram nem cadastro no portal."),
    ("3. a AIVA CRIOU a loja (retailer ID)", casc["lojaCriada"],
     f"⚠️ o degrau que mais perde: {casc['onboarding'] - casc['lojaCriada']} cadastros abertos que nunca viraram loja. "
     "Sem retailer ID não existe venda registrada nem comissão possível."),
    ("4. o portal mede como Track", casc["noPortal"],
     f"{casc['lojaCriada'] - casc['noPortal']} lojas criadas que o portal não mede."),
    ("5. a Ume pagou em outubro", casc["paga"],
     "Só dentro do canal AIVA, e só quem vendeu no mês. O total pago à Track é maior porque inclui os canais "
     "de fora do portal (ver a resposta 2)."),

    ("__sec__", "O QUE O NOSSO EVO DIZ (e não bate com a AIVA)", None),
    ("Contas fechadas no funil 11", 636, "CNPJs com card de conta fechada (tag 7/69)."),
    ("   dessas, SEM loja criada na AIVA", 292,
     "O funil 11 conta como negócio ganho algo que a AIVA não reconhece como loja. É a maior distorção "
     "do nosso lado e o que mais infla qualquer contagem nossa."),
    ("Cards na etapa 51 (Loja Finalizada e Vendendo)", 157, "Dessas, 118 com loja criada e 73 pagas em outubro."),

    ("__sec__", "OUTROS ACHADOS", None),
    ("No portal como Track e sem pagamento em outubro", len(NO_PORTAL_SEM_PAG),
     f"Dessas, {len([l for l in NO_PORTAL_SEM_PAG if l['vendeuNoPortal'] == 'sim'])} já venderam em algum mês. "
     "O resto é loja criada que nunca vendeu."),
    ("No portal como Track e que nunca mandamos", 9,
     "Chegaram por outro caminho. Uma delas é o CNPJ da própria Track (retailer 7098) — cadastro de teste."),
    ("Linhas do fechamento que não são nossas", 544 - 0, "FCDL (298 lojas) e varejo da própria Ume."),

    ("__sec__", "⚠️ RESSALVA", None),
    ("Retrato do portal parado em 26/10", "",
     "A coleta não roda desde 26/10 porque a AIVA desligou o login por e-mail e senha. A curva vai até lá. "
     "A coluna 'Está no portal hoje' usa a API de onboardings AO VIVO, que não depende desse login."),
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
    a.font = Font(name=ARIAL, size=10, bold=k.startswith(("1.", "2.", "3.")))
    b.font = Font(name=ARIAL, size=11, bold=True)
    c.font = Font(name=ARIAL, size=9, color="444444")
    b.alignment = Alignment(horizontal="center")
    c.alignment = Alignment(wrap_text=True, vertical="top")
    for cc in (a, b, c):
        cc.border = BORDA
    if v == "NÃO":
        b.fill = VERDE
    if v in ("bases diferentes", "não achei") or "⚠️" in k:
        b.fill = AMAR
    ws.row_dimensions[r].height = 44 if len(obs or "") > 120 else 30
    r += 1

# ───────────────────────────── Cascata ─────────────────────────────
ws = wb.create_sheet("Cascata")
ws.sheet_view.showGridLines = False
passos = [
    ("1. Mandamos para a AIVA (pré-cadastro enviado)", casc["mandamos"], "Track", "sdr_registros_cnpj"),
    ("2. A AIVA abriu cadastro (tem onboarding)", casc["onboarding"], "AIVA", "API de onboardings do portal"),
    ("3. A AIVA criou a loja (tem retailer ID)", casc["lojaCriada"], "AIVA", "retailer_id no onboarding"),
    ("4. O portal mede como Track", casc["noPortal"], "AIVA", "retailer_performance (retrato diário)"),
    ("5. A Ume pagou em outubro", casc["paga"], "Ume", "fechamento de outubro/2026"),
]
cab = ["Degrau", "Lojas (CNPJs)", "Perdeu no degrau", "% que passou", "Quem controla", "Fonte do número"]
for i, t in enumerate(cab, start=1):
    c = ws.cell(row=1, column=i, value=t)
    c.font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
    c.fill = AZUL
    c.border = BORDA
    c.alignment = Alignment(horizontal="center", wrap_text=True)
for larg, col in zip([48, 14, 16, 12, 14, 36], "ABCDEF"):
    ws.column_dimensions[col].width = larg
ant = None
for rr, (nome, qtd, dono, fonte) in enumerate(passos, start=2):
    perdeu = "" if ant is None else ant - qtd
    passou = "" if ant is None else f"{qtd / ant * 100:.0f}%"
    for i, v in enumerate([nome, qtd, perdeu, passou, dono, fonte], start=1):
        c = ws.cell(row=rr, column=i, value=v)
        c.font = Font(name=ARIAL, size=10, bold=(i == 2))
        c.border = BORDA
        c.alignment = Alignment(vertical="center", horizontal="center" if i in (2, 3, 4, 5) else "left")
    if isinstance(perdeu, int) and perdeu > 200:
        ws.cell(row=rr, column=3).fill = VERM
    ws.row_dimensions[rr].height = 24
    ant = qtd

# ─────────────────────── Curva do portal ───────────────────────
ws = wb.create_sheet("Curva do portal")
ws.sheet_view.showGridLines = False
ws.cell(row=1, column=1, value="Data do retrato").font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
ws.cell(row=1, column=2, value="Lojas da Track no portal").font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
for i in (1, 2):
    ws.cell(row=1, column=i).fill = AZUL
    ws.cell(row=1, column=i).border = BORDA
ws.column_dimensions["A"].width = 18
ws.column_dimensions["B"].width = 24
for rr, p in enumerate(C["curva"], start=2):
    ws.cell(row=rr, column=1, value=p["data"]).font = Font(name=ARIAL, size=10)
    ws.cell(row=rr, column=2, value=p["lojas"]).font = Font(name=ARIAL, size=10)
    for i in (1, 2):
        ws.cell(row=rr, column=i).border = BORDA
ch = LineChart()
ch.title = "Lojas da Track medidas pelo portal AIVA (nenhuma saiu)"
ch.y_axis.title = "lojas"
ch.height, ch.width = 9, 24
ch.add_data(Reference(ws, min_col=2, min_row=1, max_row=1 + len(C["curva"])), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=2, max_row=1 + len(C["curva"])))
ws.add_chart(ch, "D2")

# ─────────────────────── Abas de lojas ───────────────────────
COLS = [
    ("Degrau", 42, lambda l: l["degrau"]),
    ("É nossa?", 9, lambda l: l["nossa"]),
    ("Loja", 32, lambda l: l["loja"]),
    ("CNPJ", 20, lambda l: fmt_cnpj(l["cnpj"])),
    ("Telefone", 17, lambda l: fmt_tel(l["telefone"])),
    ("Grupo (Ume)", 26, lambda l: l["grupo"]),
    ("Mandamos?", 10, lambda l: l["mandamos"]),
    ("Enviado em", 12, lambda l: l["enviadoEm"]),
    ("Tem cadastro na AIVA?", 12, lambda l: l["temOnboarding"]),
    ("Quadro na AIVA", 20, lambda l: l["quadroAiva"]),
    ("Loja criada?", 10, lambda l: l["lojaCriada"]),
    ("Retailer ID", 14, lambda l: l["retailerId"]),
    ("Criada em", 12, lambda l: l["criadaEm"]),
    ("Portal mede?", 10, lambda l: l["noPortal"]),
    ("Está no portal hoje?", 12, lambda l: l["noPortalHoje"]),
    ("Status no portal", 12, lambda l: l["statusPortal"]),
    ("Vendeu no portal?", 11, lambda l: l["vendeuNoPortal"]),
    ("Paga em outubro?", 11, lambda l: l["pagaEmOutubro"]),
    ("Comissão out", 14, lambda l: float(l["comissaoOut"])),
    ("Contratos out", 11, lambda l: l["contratosOut"]),
    ("Conta fechada no Evo?", 12, lambda l: l["contaFechadaEvo"]),
    ("Etapa no funil 15", 24, lambda l: l["etapa15"]),
    ("Status do lead", 26, lambda l: l["statusLead"]),
]
TXT = {"CNPJ", "Telefone", "Retailer ID"}


def cor(item, titulo):
    if titulo == "Degrau":
        return {"1": AMAR, "2": VERM, "3": AMAR, "4": CINZA, "5": VERDE}.get(item["degrau"][0])
    if titulo == "Portal mede?" and item["pagaEmOutubro"] == "sim" and item["noPortal"] == "nao":
        return AMAR
    return None


ws = wb.create_sheet("Pagas fora do portal")
tabela(ws, COLS, sorted(FORA_PORTAL, key=lambda l: -l["comissaoOut"]), texto=TXT, cor=cor)

ws = wb.create_sheet("No portal sem pagamento")
tabela(ws, COLS, sorted(NO_PORTAL_SEM_PAG, key=lambda l: (l["vendeuNoPortal"] != "sim", l["loja"])), texto=TXT, cor=cor)

ws = wb.create_sheet("Todas as lojas")
tabela(ws, COLS, sorted(LINHAS, key=lambda l: (l["degrau"], -l["comissaoOut"], l["loja"])), texto=TXT, cor=cor)

os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
wb.save(SAIDA)
print("gravado:", SAIDA, os.path.getsize(SAIDA), "bytes")
for s in wb.sheetnames:
    print("  aba %-28s %d linhas" % (s, wb[s].max_row))
