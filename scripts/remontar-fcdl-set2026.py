# -*- coding: utf-8 -*-
"""
Remonta a planilha FCDL de setembro/2026 no layout que lib/comissoes.ts espera.

Por que existe: o .xlsx original não pôde ser baixado (o Chrome engoliu o
download num diálogo nativo de "salvar como"). O conteúdo foi lido pelo MCP do
Drive, que devolve a planilha já RENDERIZADA — e, como a coluna CNPJ da Ume é
numérica, os CNPJs chegaram em notação científica (2,91808E+13), com 6 dígitos
significativos.

Decisão: gravar o CNPJ VAZIO em vez de um número truncado. CNPJ errado no banco
é pior que CNPJ ausente — a conferência do painel casa por CNPJ antes de casar
por retailer ID, e um CNPJ inventado poderia colidir com loja nossa de verdade.
Retailer ID, varejo, grupo e todos os valores são exatos.

Quando o .xlsx original aparecer, reimportar por cima (o importador substitui
o par mês+origem) resolve sozinho.
"""
import io
import os
from datetime import datetime

from openpyxl import Workbook

AQUI = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(AQUI, "dados-fcdl-set2026.csv")
DESTINO = os.path.join(AQUI, "Comissao Track - FCDL - Setembro 2026 (sem CNPJ).xlsx")

# totais declarados no cabeçalho da planilha original
TOTAIS = {"contratos": 2010, "originacao": 609503.65, "mdr": 67154.06, "comissao": 2813.69}
SUBTOTAIS = [
    ("SEM GRUPO", 309, 1977, 561106.45, 62314.30, 2492.57),
    ("INSIDE_SALES", 2, 33, 48397.20, 4839.76, 321.12),
]


def main():
    lojas = []
    with io.open(CSV, encoding="utf-8") as fh:
        next(fh)
        for linha in fh:
            if not linha.strip():
                continue
            p = linha.rstrip("\n").split(",")
            lojas.append({
                "rid": int(p[0]), "varejo": p[2], "grupo": p[3],
                "contratos": int(p[4]), "originacao": float(p[5]),
                "mdr": float(p[6]), "comissao": float(p[7]),
            })

    wb = Workbook()
    ws = wb.active
    ws.title = "RESUMO"
    ws.append(["RESUMO COMISSÃO — 2N SOLUÇÕES EM TECNOLOGIA (TRACK) - FCDL"])
    ws.append([])
    ws.append(["Parceiro", "2n Soluções em Tecnologia (Track) - FCDL"])
    ws.append(["Competência", datetime(2026, 9, 1)])
    ws.append(["Total Contratos", TOTAIS["contratos"]])
    ws.append(["Total Originação", TOTAIS["originacao"]])
    ws.append(["Total MDR", TOTAIS["mdr"]])
    ws.append(["Total Comissão", TOTAIS["comissao"]])
    ws.append([])
    ws.append(["⚠️ CNPJ em branco de propósito: o .xlsx original não pôde ser baixado e a leitura "
               "disponível trazia o CNPJ truncado em notação científica. Os demais campos são exatos."])
    ws.append([])
    ws.append(["RETAILER ID", "CNPJ", "VAREJO", "GRUPO", "CONTRATOS", "ORIGINAÇÃO", "MDR", "COMISSÃO"])

    for nome, n_varejos, contratos, orig, mdr, com in SUBTOTAIS:
        ws.append(["▸ " + nome, None, None, None, "%d varejos" % n_varejos])
        for l in (x for x in lojas if x["grupo"] == nome):
            ws.append([l["rid"], None, l["varejo"], l["grupo"],
                       l["contratos"], l["originacao"], l["mdr"], l["comissao"]])
        ws.append([None, None, None, "Subtotal " + nome, contratos, orig, mdr, com])
    ws.append([None, None, None, "TOTAL GERAL", TOTAIS["contratos"], TOTAIS["originacao"],
               TOTAIS["mdr"], TOTAIS["comissao"]])

    wb.save(DESTINO)
    print("gravado:", DESTINO)
    print("%d lojas | soma comissão R$ %.2f | total declarado R$ %.2f"
          % (len(lojas), sum(l["comissao"] for l in lojas), TOTAIS["comissao"]))


if __name__ == "__main__":
    main()
