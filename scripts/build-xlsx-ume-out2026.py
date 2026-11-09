# -*- coding: utf-8 -*-
"""Monta o .xlsx da conferência da comissão Ume de outubro/2026.

Entradas: scripts/out-conferencia-ume-2026-10.json e scripts/out-extras-2026-10.json
Saída:    docs/Conferencia-comissao-UME-2026-10.xlsx

Padrão da casa: Arial, cabeçalho formatado, freeze panes + autofiltro,
CNPJ e telefone como TEXTO (zero à esquerda não some).
"""
import json
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
J = json.load(open(os.path.join(AQUI, "out-conferencia-ume-2026-10.json"), encoding="utf8"))
E = json.load(open(os.path.join(AQUI, "out-extras-2026-10.json"), encoding="utf8"))
SAIDA = os.path.join(RAIZ, "docs", "Conferencia-comissao-UME-2026-10.xlsx")

ARIAL = "Arial"
AZUL = PatternFill("solid", fgColor="1F3864")
CINZA = PatternFill("solid", fgColor="F2F2F2")
VERDE = PatternFill("solid", fgColor="E2EFDA")
AMAR = PatternFill("solid", fgColor="FFF2CC")
VERM = PatternFill("solid", fgColor="FCE4E4")
BORDA = Border(*(Side(style="thin", color="D9D9D9"),) * 4)
MOEDA = 'R$ #,##0.00'

wb = Workbook()


def fmt_cnpj(c):
    c = "".join(ch for ch in str(c or "") if ch.isdigit())
    if len(c) != 14:
        return str(c or "")
    return f"{c[:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:]}"


def cabecalho(ws, cols, linha=1):
    for i, (titulo, larg, _) in enumerate(cols, start=1):
        c = ws.cell(row=linha, column=i, value=titulo)
        c.font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
        c.fill = AZUL
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BORDA
        ws.column_dimensions[get_column_letter(i)].width = larg
    ws.row_dimensions[linha].height = 30
    ws.freeze_panes = ws.cell(row=linha + 1, column=1)
    ws.auto_filter.ref = f"A{linha}:{get_column_letter(len(cols))}{linha}"


def escreve(ws, cols, dados, linha0=2, cor=None):
    for r, item in enumerate(dados, start=linha0):
        for i, (_, _, chave) in enumerate(cols, start=1):
            v = chave(item) if callable(chave) else item.get(chave)
            c = ws.cell(row=r, column=i)
            if isinstance(v, str) and v.startswith("$$"):   # força texto
                c.value = v[2:]
                c.number_format = "@"
            elif isinstance(v, float):
                c.value = v
                c.number_format = MOEDA
            else:
                c.value = v
            c.font = Font(name=ARIAL, size=10)
            c.border = BORDA
            c.alignment = Alignment(vertical="center",
                                    horizontal="right" if isinstance(v, (int, float)) and not isinstance(v, bool) else "left")
            if cor:
                f = cor(item)
                if f:
                    c.fill = f
    ws.sheet_view.showGridLines = False


# ─────────────────────────────── 1. RESUMO ───────────────────────────────
ws = wb.active
ws.title = "Resumo"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 54
ws.column_dimensions["B"].width = 24
ws.column_dimensions["C"].width = 72

nossas = [l for l in J["lojas"] if l["noRelatorio"]]
rel = J["relatorioLinhas"]
rid_nossos = {r for l in J["lojas"] for r in l["rids"]}
linhas_nossas = [l for l in rel if str(l["rid"]) in rid_nossos]
com_nossas = sum(l["comissao"] for l in linhas_nossas)
venderam = [l for l in J["lojas"] if (l.get("vendas") or 0) > 0]

LIN = []


def sec(t):
    LIN.append(("__sec__", t, None))


def kv(k, v, obs=""):
    LIN.append((k, v, obs))


sec("VEREDITO")
kv("Comissão a receber (nota única em nome da Ume)", 44622.55,
   "R$ 44.622,55 — bate com o detalhamento das duas planilhas, até o centavo.")
kv("Alguma loja nossa vendeu e ficou de fora?", "NÃO",
   "Nenhuma das lojas que venderam em outubro ficou fora do relatório. Ressalva de método na seção abaixo.")
kv("Divergência de valor encontrada", "nenhuma",
   "Contratos, originação, MDR e comissão fecham nas duas apurações e no consolidado.")

sec("O QUE A UME DECLAROU x O QUE A PLANILHA SOMA")
kv("Contratos", 13146, "e-mail 13.146 · planilhas 13.146 — OK")
kv("Originação", 5494246.43, "e-mail e planilhas idênticos — OK")
kv("MDR", 327848.10, "e-mail e planilhas idênticos — OK")
kv("Comissão — Outros Varejos + IVS", 41963.45, "329 lojas. A aba POR ISSUER (342 linhas) fecha no mesmo total.")
kv("Comissão — FCDL", 2659.10, "299 lojas.")
kv("Comissão — TOTAL", 44622.55, "41.963,45 + 2.659,10 = 44.622,55 — OK")

sec("DE ONDE VEM O DINHEIRO")
kv("Lojas da NOSSA carteira dentro do relatório", len(linhas_nossas),
   "casadas por retailer ID com funil 11/15, registros, leads e portal AIVA.")
kv("Comissão das lojas da nossa carteira", float(com_nossas),
   f"{com_nossas / 44622.55 * 100:.0f}% do total. O resto é FCDL e varejos da Ume fora do nosso funil.")
kv("Linhas do relatório sem loja nossa", len(J["soRelatorio"]),
   f"R$ {sum(l['comissao'] for l in J['soRelatorio']):,.2f} — 298 são FCDL (canal próprio) e o resto, grupos da Ume."
   .replace(",", "@").replace(".", ",").replace("@", "."))
kv("Taxa de comissão sobre o MDR", "20% / 12% / 4%",
   "126 lojas a 20%, 202 a 12%, 298 (FCDL) a 4% e 1 a 6,6% (SIGMA, INSIDE_SALES do FCDL). "
   "NENHUMA loja mudou de taxa em relação a setembro.")

sec("COMO FOI CONFERIDO")
kv("Lojas nossas reunidas de todas as fontes", len(J["lojas"]),
   "funil 11 (contas fechadas), funil 15 (etapas 70/98/71/99/51), sdr_registros_cnpj, "
   "sdr_leads (TREINAR/LOGIN/VENDENDO), portal AIVA (onboardings) e aiva_desempenho.")
kv("Dessas, com venda registrada em outubro", len(venderam), "todas presentes no relatório.")
kv("Lojas nossas sem retailer ID em lugar nenhum", len([l for l in J["lojas"] if not l["rids"]]),
   "não dá para casar com o relatório por ID — nenhuma delas tem venda registrada.")
kv("Chave de casamento", "retailer ID",
   "ID é exato. CNPJ entra só como reforço — nome nunca casa sozinho.")

sec("⚠️ RESSALVA DE MÉTODO (ler antes de usar o veredito)")
kv("Retrato de desempenho do portal", "parou em 26/10",
   "A rotina que copia o desempenho do portal AIVA não roda desde 26/10: o login por e-mail e senha "
   "foi DESLIGADO pela AIVA (o portal responde 'Email logins are disabled'). Sem isso, o retrato de "
   "outubro cobre 26 dos 31 dias e não existe nenhum dado de novembro.")
kv("Como o buraco foi fechado", "quadro ao vivo",
   "A API de onboardings (chave própria, continua funcionando) traz a coluna do quadro de cada loja. "
   "Calibrando: das 19 lojas cuja PRIMEIRA venda caiu em outubro, 19 estão no relatório (100%); "
   "das 6 cuja primeira venda caiu em novembro, 0 estão (0%) — como tem de ser. "
   "Ou seja, nenhuma primeira venda de outubro ficou fora.")
kv("O que ainda não dá para afirmar", "venda repetida de 27 a 31/10",
   "Uma loja que já vendia antes, cuja ÚNICA venda de outubro tenha caído nos últimos 5 dias do mês, "
   "não aparece em nenhuma fonte nossa. São valores pequenos (as lojas desse perfil fizeram R$ 25 a "
   "R$ 430 de comissão em setembro). Religar a coleta resolve de vez.")

r = 1
ws.cell(row=r, column=1, value="CONFERÊNCIA DA COMISSÃO UME — OUTUBRO/2026").font = Font(name=ARIAL, size=14, bold=True, color="1F3864")
r += 1
ws.cell(row=r, column=1, value="Track / 2N Soluções · apuração recebida em 05/11/2026 do BackOffice da Ume · conferida em 09/11/2026").font = Font(name=ARIAL, size=9, italic=True, color="666666")
r += 2
for k, v, obs in LIN:
    if k == "__sec__":
        r += 1
        c = ws.cell(row=r, column=1, value=v)
        c.font = Font(name=ARIAL, size=11, bold=True, color="FFFFFF")
        c.fill = AZUL
        for cc in range(1, 4):
            ws.cell(row=r, column=cc).fill = AZUL
            ws.cell(row=r, column=cc).border = BORDA
        r += 1
        continue
    a = ws.cell(row=r, column=1, value=k)
    b = ws.cell(row=r, column=2, value=v)
    c = ws.cell(row=r, column=3, value=obs)
    a.font = Font(name=ARIAL, size=10)
    b.font = Font(name=ARIAL, size=10, bold=True)
    c.font = Font(name=ARIAL, size=9, color="444444")
    if isinstance(v, float):
        b.number_format = MOEDA
    b.alignment = Alignment(horizontal="right")
    c.alignment = Alignment(wrap_text=True, vertical="top")
    for cc in (a, b, c):
        cc.border = BORDA
    if k.startswith("Alguma loja"):
        b.fill = VERDE
    if "parou em" in str(v) or "27 a 31" in str(v):
        b.fill = AMAR
    ws.row_dimensions[r].height = 30
    r += 1

# ─────────────────────────────── 2. PENDÊNCIAS ───────────────────────────────
ws = wb.create_sheet("Pendencias")
cols = [("#", 5, "n"), ("Assunto", 34, "assunto"), ("Situação", 70, "situacao"),
        ("O que fazer", 60, "acao"), ("Com quem", 20, "quem")]
cabecalho(ws, cols)
pend = [
  dict(n=1, assunto="Coleta do portal AIVA parada desde 26/10",
       situacao="O portal desligou o login por e-mail e senha ('Email logins are disabled'), e a rotina de 6h que "
                "copia o desempenho das lojas parou junto. Já são 14 dias sem dado novo: outubro congelou no dia 26 "
                "e novembro está vazio. Isso cega a conferência de comissão nos últimos dias do mês e afeta as dicas "
                "de desempenho semanais, que são o único contato recorrente com a loja ativa.",
       acao="Pedir ao Mauricio o caminho novo de acesso (chave de API como a de onboardings, que continua "
            "funcionando, ou liberar o login de volta). É a pendência mais cara desta lista.",
       quem="Aldo → Mauricio (Ume/AIVA)"),
  dict(n=2, assunto="6 lojas com primeira venda em novembro",
       situacao="i-love-celulares (7937), Panificadora Caremellas (6732), Gong Jianwei (5905), Smart Power (6320), "
                "Dayane Fernanda (6846) e Dolfimports (6301) entraram na coluna 'primeira venda' com data de "
                "01/11. Pela calibração, isso significa venda de NOVEMBRO — por isso não estão no fechamento "
                "de outubro, e está correto.",
       acao="Nenhuma ação agora. Conferir no fechamento de novembro se as seis aparecem.",
       quem="conferência de novembro"),
  dict(n=3, assunto="30 lojas nossas venderam em setembro e nada em outubro",
       situacao="Somavam R$ 2.039,32 de comissão em setembro e sumiram do relatório de outubro — a maioria com "
                "1 a 3 contratos. Não é erro de apuração: é loja que vendeu uma vez e parou. Lista na aba "
                "'Pararam de vender'.",
       acao="Decidir se vira fila de reativação. Com a coleta do portal parada, essa é hoje a única leitura "
            "de churn que temos.",
       quem="Aldo / Nei"),
  dict(n=4, assunto="Pendências antigas com o Gerisson — situação em outubro",
       situacao="WM Celulares (5681), Rauenne (6443) e Adricell (4782) ESTÃO no relatório de outubro e foram "
                "pagas. Os retailers 5476 e 4712 (Maricell) continuam sem aparecer.",
       acao="Fechar com o Gerisson só o que resta: 5476 e 4712, e a NF complementar de R$ 1.843,12 das linhas "
            "ocultas, se ainda estiver em aberto.",
       quem="Aldo → Gerisson (Ume)"),
  dict(n=5, assunto="Mesmo CNPJ em três retailers do Grupo Mini Preço",
       situacao="O CNPJ 17.342.870/0001-41 aparece nos retailers 647 (Mini Preço), 727 (Mini Preço ES) e "
                "662 (Rei dos Salvados). São lojas distintas do mesmo grupo sob um CNPJ só — não há cobrança "
                "duplicada, as três linhas têm contratos próprios.",
       acao="Só registrar. Casar por CNPJ nesse grupo daria resultado errado; usar retailer ID.",
       quem="registro"),
  dict(n=6, assunto="Nota fiscal",
       situacao="Nota ÚNICA em nome da Ume (UME DESENVOLVIMENTO DE SOFTWARE LTDA, CNPJ 29.311.808/0001-71), "
                "R$ 44.622,55, descrição 'Comissão de parceria comercial — referente a Outubro 2026', "
                "respondendo o próprio e-mail com o PDF ou XML.",
       acao="Emitir e responder o e-mail do BackOffice.",
       quem="Aldo"),
]
escreve(ws, cols, pend, cor=lambda i: AMAR if i["n"] in (1,) else None)
for rr in range(2, 2 + len(pend)):
    ws.row_dimensions[rr].height = 86
    for cc in range(1, 6):
        ws.cell(row=rr, column=cc).alignment = Alignment(wrap_text=True, vertical="top")

# ─────────────────────────────── 3. CONFERÊNCIA ───────────────────────────────
ws = wb.create_sheet("Conferencia")
com_por_rid = {}
for l in rel:
    com_por_rid[str(l["rid"])] = com_por_rid.get(str(l["rid"]), 0) + l["comissao"]
grupo_por_rid = {str(l["rid"]): l["grupo"] for l in rel}
varejo_por_rid = {str(l["rid"]): l["varejo"] for l in rel}


def estado(l):
    if l["noRelatorio"]:
        return "comissionada" if (l.get("vendas") or 0) > 0 else "no relatorio, sem venda no retrato"
    if (l.get("vendas") or 0) > 0:
        return "VENDEU E NAO ESTA NO RELATORIO"
    if not l["rids"]:
        return "sem retailer ID"
    return "sem venda no mes"


dados = sorted(J["lojas"], key=lambda l: (-(l.get("comissao") or 0), -(l.get("vendas") or 0)))
cols = [
    ("Estado", 32, lambda l: estado(l)),
    ("CNPJ", 20, lambda l: "$$" + fmt_cnpj(l["cnpj"]) if l["cnpj"] else ""),
    ("Retailer ID", 12, lambda l: "$$" + "/".join(l["rids"]) if l["rids"] else ""),
    ("Nome (nosso)", 34, lambda l: (l["nomes"] or [""])[0]),
    ("Nome (relatorio Ume)", 30, lambda l: next((varejo_por_rid.get(r, "") for r in l["rids"] if r in varejo_por_rid), "")),
    ("Grupo (Ume)", 24, lambda l: next((grupo_por_rid.get(r, "") for r in l["rids"] if r in grupo_por_rid), "")),
    ("Comissao out/26", 15, lambda l: float(l["comissao"] or 0)),
    ("Vendas out (ate 26/10)", 12, lambda l: l.get("vendas") or 0),
    ("Valor vendido out", 15, lambda l: float(l.get("valorVendas") or 0)),
    ("Consultas", 10, lambda l: l.get("consultas") or 0),
    ("Etapa no funil 15", 22, lambda l: l.get("etapa15") or ""),
    ("Status do lead", 26, lambda l: l.get("statusLead") or ""),
    ("Telefone", 16, lambda l: "$$" + str(l.get("telefone") or "")),
    ("Status portal", 12, lambda l: l.get("statusPortal") or ""),
    ("Cadastro", 12, lambda l: l.get("cadastroEm") or ""),
    ("Como casou", 18, lambda l: l.get("comoCasou") or ""),
    ("Fontes", 70, lambda l: " · ".join(l["fontes"])),
]
cabecalho(ws, cols)
escreve(ws, cols, dados, cor=lambda l: (
    VERM if estado(l).startswith("VENDEU E") else
    VERDE if estado(l) == "comissionada" else
    AMAR if estado(l) == "sem retailer ID" else None))

# ─────────────────────────── 4. RELATÓRIO DA UME ───────────────────────────
ws = wb.create_sheet("Relatorio Ume")
cols = [
    ("Planilha", 16, "planilha"),
    ("Retailer ID", 12, lambda l: "$$" + str(l["rid"])),
    ("CNPJ", 20, lambda l: "$$" + fmt_cnpj(l["cnpj"]) if l["cnpj"] else ""),
    ("Varejo", 36, "varejo"),
    ("Grupo", 26, "grupo"),
    ("E nossa?", 10, lambda l: "sim" if str(l["rid"]) in rid_nossos else "nao"),
    ("Contratos", 11, "contratos"),
    ("Originacao", 15, lambda l: float(l["originacao"])),
    ("MDR", 14, lambda l: float(l["mdr"])),
    ("Comissao", 14, lambda l: float(l["comissao"])),
    ("Taxa s/ MDR", 12, lambda l: f"{l['comissao'] / l['mdr'] * 100:.1f}%" if l["mdr"] else ""),
]
cabecalho(ws, cols)
escreve(ws, cols, sorted(rel, key=lambda l: -l["comissao"]),
        cor=lambda l: VERDE if str(l["rid"]) in rid_nossos else None)

# ───────────────────────── 5. PARARAM DE VENDER ─────────────────────────
ws = wb.create_sheet("Pararam de vender")
cols = [
    ("Retailer ID", 12, lambda l: "$$" + str(l["rid"])),
    ("CNPJ", 20, lambda l: "$$" + fmt_cnpj(l["cnpj"]) if l["cnpj"] else ""),
    ("Varejo", 38, "varejo"),
    ("Grupo", 26, "grupo"),
    ("E nossa?", 10, lambda l: "sim" if l["nossa"] else "nao"),
    ("Contratos set", 12, "contratos"),
    ("MDR set", 14, lambda l: float(l["mdr"])),
    ("Comissao set", 14, lambda l: float(l["comissao"])),
]
cabecalho(ws, cols)
ws.cell(row=1, column=1)
escreve(ws, cols, E["churn"], cor=lambda l: AMAR if l["nossa"] else None)

# ─────────────── 6. PRIMEIRA VENDA FORA DO RELATÓRIO ───────────────
ws = wb.create_sheet("Primeira venda x relatorio")
cols = [
    ("Retailer ID", 12, lambda l: "$$" + str(l["rid"])),
    ("CNPJ", 20, lambda l: "$$" + fmt_cnpj(l["cnpj"]) if l["cnpj"] else ""),
    ("Loja", 44, "nome"),
    ("Primeira venda (mes)", 18, "desde"),
    ("E nossa?", 10, lambda l: "sim" if l["nossa"] else "nao"),
    ("Comissao set/26", 15, lambda l: float(l["setembro"])),
    ("Leitura", 60, lambda l: "primeira venda em NOVEMBRO — entra no fechamento de novembro"
     if l["desde"].startswith("2026-11") else "vendeu pela primeira vez em mes anterior e nao vendeu em outubro"),
]
cabecalho(ws, cols)
escreve(ws, cols, E["pvFora"], cor=lambda l: AMAR if l["desde"].startswith("2026-11") else None)

os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
wb.save(SAIDA)
print("gravado:", SAIDA, os.path.getsize(SAIDA), "bytes")
for s in wb.sheetnames:
    print("  aba %-28s %d linhas" % (s, wb[s].max_row))
