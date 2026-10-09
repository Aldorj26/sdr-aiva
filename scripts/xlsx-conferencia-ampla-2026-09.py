# -*- coding: utf-8 -*-
"""
Planilha da conferência AMPLA da comissão Ume de setembro/2026.

Cruza o relatório da Ume com TODAS as fontes onde a Track registra loja
fechada (funil 11, funil 15, sdr_registros_cnpj, sdr_leads, portal AIVA) e
responde: tem loja nossa vendendo que não entrou na comissão?
"""
import io
import json
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
DESTINO = os.path.join(RAIZ, "docs", "Conferencia-comissao-UME-2026-09.xlsx")

ESCURO = PatternFill("solid", fgColor="0F3D3E")
VERDE = PatternFill("solid", fgColor="E3F4E6")
AMARELO = PatternFill("solid", fgColor="FFF4D6")
VERMELHO = PatternFill("solid", fgColor="FBE2E2")
ARIAL = "Arial"


def cab(ws, n):
    for c in range(1, n + 1):
        cel = ws.cell(row=1, column=c)
        cel.fill = ESCURO
        cel.font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
        cel.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        cel.border = Border(bottom=Side(style="thin", color="7A8B8C"))
    ws.row_dimensions[1].height = 28


def larg(ws, ws_l):
    for i, w in enumerate(ws_l, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def corpo(ws, texto=(), wrap=(), moeda=()):
    for row in ws.iter_rows(min_row=2):
        for cel in row:
            cel.font = Font(name=ARIAL, size=10)
        for c in texto:
            row[c - 1].number_format = "@"
            row[c - 1].alignment = Alignment(horizontal="left")
        for c in wrap:
            row[c - 1].alignment = Alignment(horizontal="left", wrap_text=True, vertical="top")
        for c in moeda:
            row[c - 1].number_format = '#,##0.00'


def main():
    amplo = json.load(io.open(os.path.join(AQUI, "out-conferencia-ampla-2026-09.json"), encoding="utf-8"))
    semrid = json.load(io.open(os.path.join(AQUI, "out-sem-rid-2026-09.json"), encoding="utf-8"))
    lojas = amplo["lojas"]

    wb = Workbook()

    # ───────────────────────── Resumo ─────────────────────────
    ws = wb.active
    ws.title = "Resumo"
    ws.append(["O que foi conferido", "Resultado", "Observação"])
    for l in [
        ("COMISSÃO TOTAL A PAGAR — R$ 48.027,21", "CONFERE",
         "Somei as 628 linhas de loja, os 13 subtotais, a linha TOTAL GERAL das duas planilhas, "
         "o bloco por issuer e a divisão das duas notas fiscais. Tudo fecha (diferenças de centavos, "
         "por ordem de arredondamento)."),
        ("Taxas de comissão mudaram em relação a agosto?", "NÃO",
         "20% do MDR em todos os grupos, menos Instituto Visão Solidária (12%) e FCDL (4% e ~6,6%). Iguais a agosto."),
        ("", "", ""),
        ("LOJA NOSSA VENDENDO E FORA DA COMISSÃO", "1 loja",
         "Porto Celulares. Única em 86 lojas que o portal da AIVA registra com venda em setembro. Aba 'Faltando'."),
        ("Lojas reunidas de todas as nossas fontes", "617",
         "Funil 11 (contas fechadas) + funil 15 (etapas 70/98/71/99/51) + sdr_registros_cnpj + sdr_leads + "
         "portal AIVA (712 cadastros) + desempenho do portal."),
        ("  dessas, no relatório de setembro", "306", ""),
        ("  fora do relatório, portal confirma sem venda", "206", "Loja criada que não vendeu no mês. Normal."),
        ("  fora do relatório e invisível ao portal", "58",
         "Nenhuma delas vendeu em mês nenhum até setembro: 31 nunca tiveram linha de desempenho e 27 só "
         "aparecem em outubro. Não há comissão faltando aqui."),
        ("  sem retailer ID em lugar nenhum", "47", "Aba 'Sem retailer ID' — classificadas uma a uma."),
        ("", "", ""),
        ("⚠️ LIMITE DESTA CONFERÊNCIA", "48% da comissão não tem segunda fonte",
         "Dos 317 varejos da planilha Outros Varejos, 210 vendem SÓ pelo issuer UME (R$ 22.847,58 = 48% do "
         "total) e NENHUM deles aparece no portal da AIVA. 195 desses 210 são loja nossa. Para essa fatia, "
         "o relatório da Ume é a única fonte — se faltar loja ali, não temos como saber. Ver aba 'Cobertura'."),
    ]:
        ws.append(list(l))
    cab(ws, 3)
    larg(ws, [46, 34, 82])
    corpo(ws, wrap=(1, 3))
    for row in ws.iter_rows(min_row=2):
        v = str(row[1].value or "")
        if v in ("CONFERE", "NÃO"):
            row[1].fill = VERDE
        elif v.startswith("1 loja"):
            row[1].fill = VERMELHO
        elif "48%" in v:
            row[1].fill = AMARELO
    ws.freeze_panes = "A2"

    # ───────────────────────── Faltando ─────────────────────────
    ws2 = wb.create_sheet("Faltando")
    ws2.append(["CNPJ", "Retailer ID", "Loja", "Consultas set", "Aprovados set", "Vendas set",
                "Valor vendido set", "Comissão estimada", "Onde está registrada", "Vendas out"])
    for l in lojas:
        if l["vendas"] > 0 and not l["noRelatorio"]:
            ws2.append([l["cnpj"], "/".join(l["rids"]), (l["nomes"] or [""])[0], l["consultas"],
                        l["aprovados"], l["vendas"], l["valorVendas"],
                        round(l["valorVendas"] * 0.018169, 2), " · ".join(l["fontes"]), l["vendasOut"]])
    cab(ws2, 10)
    larg(ws2, [17, 11, 30, 13, 13, 11, 16, 16, 60, 11])
    corpo(ws2, texto=(1, 2), wrap=(9,), moeda=(7, 8))
    ws2.freeze_panes = "C2"

    # ───────────────────────── Cobertura ─────────────────────────
    ws3 = wb.create_sheet("Cobertura")
    ws3.append(["Fatia do relatório", "Varejos", "Visíveis no portal AIVA", "Comissão", "Dá pra conferir por fora?"])
    for c in semrid["cobertura"]:
        ws3.append([f"Outros Varejos · issuer {c['issuer']}", c["varejos"], c["noPortal"], c["comissao"],
                    "SIM" if c["noPortal"] else "NÃO — sem segunda fonte"])
    ws3.append(["FCDL (canal separado)", 311, 0, 2813.69, "NÃO — outro canal, não passa pelo portal AIVA"])
    ws3.append([])
    ws3.append(["Leitura: só a fatia AIVA + Odres (R$ 22.365,94) tem prova independente de venda. "
                "O resto depende da palavra da Ume.", "", "", "", ""])
    cab(ws3, 5)
    larg(ws3, [38, 10, 24, 16, 46])
    corpo(ws3, wrap=(1, 5), moeda=(4,))
    for row in ws3.iter_rows(min_row=2):
        v = str(row[4].value or "")
        if v == "SIM":
            row[4].fill = VERDE
        elif v.startswith("NÃO"):
            row[4].fill = AMARELO
    ws3.freeze_panes = "A2"

    # ───────────────────────── Lojas conferidas ─────────────────────────
    ws4 = wb.create_sheet("Lojas conferidas")
    ws4.append(["CNPJ", "Retailer ID", "Loja", "Etapa no funil 15", "Status do lead", "Status no portal",
                "Consultas set", "Vendas set", "Valor vendido set", "No relatório?", "Casou por",
                "Comissão set", "Fontes"])
    def chave(l):
        return (0 if (l["vendas"] > 0 and not l["noRelatorio"]) else 1, -l["valorVendas"], -l["comissao"])
    for l in sorted(lojas, key=chave):
        ws4.append([l["cnpj"], "/".join(l["rids"]), (l["nomes"] or [""])[0], l["etapa15"], l["statusLead"],
                    l["statusPortal"], l["consultas"], l["vendas"], l["valorVendas"],
                    "sim" if l["noRelatorio"] else "não", l["comoCasou"], l["comissao"], " · ".join(l["fontes"])])
    cab(ws4, 13)
    larg(ws4, [17, 11, 34, 20, 26, 13, 12, 10, 16, 12, 16, 13, 56])
    corpo(ws4, texto=(1, 2), wrap=(13,), moeda=(9, 12))
    for row in ws4.iter_rows(min_row=2):
        if row[9].value == "não" and (row[7].value or 0) > 0:
            for cel in row:
                cel.fill = VERMELHO
    ws4.freeze_panes = "D2"
    ws4.auto_filter.ref = "A1:M%d" % ws4.max_row

    # ───────────────────────── Sem retailer ID ─────────────────────────
    ws5 = wb.create_sheet("Sem retailer ID")
    ws5.append(["Classificação", "CNPJ", "Loja", "Situação no portal AIVA", "Matriz com retailer ID",
                "Status do lead", "Fontes"])
    rot = {
        "portal_tem_rid": "VERIFICAR — portal já criou a loja e nós não gravamos o retailer ID",
        "fora_do_portal": "VERIFICAR — CNPJ não existe no portal da AIVA",
        "portal_sem_loja": "OK — cadastro aberto, AIVA ainda não criou a loja (não vende, não comissiona)",
        "filial_matriz_tem_rid": "OK — filial que vende sob o retailer ID da matriz",
    }
    for k in ("portal_tem_rid", "fora_do_portal", "portal_sem_loja", "filial_matriz_tem_rid"):
        for l in semrid["classes"].get(k, []):
            o = l.get("onb") or {}
            irma = l.get("irma") or {}
            ws5.append([
                rot[k], l["cnpj"], (l["nomes"] or [""])[0],
                ("stage=%s · coluna=%s · retailer=%s" % (o.get("stage"), o.get("board"), o.get("rid") or "—")) if o else "não existe no portal",
                ("%s · retailer %s · %s · no relatório: %s" % (irma.get("cnpj"), "/".join(irma.get("rids", [])),
                 (irma.get("nome") or "")[:28], "sim" if irma.get("noRelatorio") else "não")) if irma else "",
                l.get("statusLead") or "", " · ".join(l["fontes"]),
            ])
    cab(ws5, 7)
    larg(ws5, [52, 17, 34, 44, 54, 26, 50])
    corpo(ws5, texto=(2,), wrap=(1, 4, 5, 7))
    for row in ws5.iter_rows(min_row=2):
        v = str(row[0].value or "")
        row[0].fill = AMARELO if v.startswith("VERIFICAR") else VERDE
    ws5.freeze_panes = "B2"
    ws5.auto_filter.ref = "A1:G%d" % ws5.max_row

    # ───────────────────────── Só no relatório ─────────────────────────
    ws6 = wb.create_sheet("Só no relatório")
    ws6.append(["Planilha", "Retailer ID", "Varejo", "Grupo", "Contratos", "Originação", "MDR", "Comissão"])
    for l in sorted(amplo["soRelatorio"], key=lambda x: -x["comissao"]):
        ws6.append([l["planilha"], l["rid"], l["varejo"], l["grupo"], l["contratos"],
                    l["originacao"], l["mdr"], l["comissao"]])
    cab(ws6, 8)
    larg(ws6, [15, 11, 44, 26, 10, 15, 13, 12])
    corpo(ws6, texto=(2,), moeda=(6, 7, 8))
    ws6.freeze_panes = "C2"
    ws6.auto_filter.ref = "A1:H%d" % ws6.max_row

    wb.save(DESTINO)
    print("salvo:", DESTINO)
    for n in wb.sheetnames:
        print("  %-20s %4d linhas" % (n, wb[n].max_row))


if __name__ == "__main__":
    main()
