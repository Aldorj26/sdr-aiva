# -*- coding: utf-8 -*-
"""
Confere a apuração de comissão da Ume de setembro/2026.

As planilhas não puderam ser baixadas pelo Chrome (um diálogo nativo de "salvar
como" engoliu o download), então foram salvas no Drive do Aldo e lidas pelo MCP
do Drive, que devolve o conteúdo já renderizado em texto.

A planilha "Outros Varejos" tem DUAS tabelas:
  1) detalhamento por varejo, agrupado por GRUPO  (317 lojas)
  2) DETALHAMENTO POR ISSUER, retailer x issuer   (343 linhas)
As duas fecham no mesmo TOTAL GERAL — somar as duas junto dobra tudo.

Uso:
  python scripts/conferir-comissao-ume-2026-09.py
"""
import io
import json
import os
import re
from collections import OrderedDict

AQUI = os.path.dirname(os.path.abspath(__file__))
OUTROS = (r"C:/Users/rocha/.claude/projects/C--projetos-claude/"
          r"acd1246b-28ce-456f-8346-cccf0f896c99/tool-results/"
          r"mcp-e7ff2897-79b1-4d3b-9ad6-ae9efe25da96-read_file_content-1791545784670.txt")
FCDL_CSV = os.path.join(AQUI, "dados-fcdl-set2026.csv")

# Valores anunciados no corpo do e-mail (Ume BackOffice, 08/10/2026 18:44).
EMAIL = {
    "total": 48027.21, "odres": 3976.02, "nao_odres": 44051.19,
    "contratos": 11558, "originacao": 5378181.59, "mdr": 343863.99,
    "outros": {"contratos": 9548, "originacao": 4768677.94, "mdr": 276709.93, "comissao": 45213.52},
    "fcdl": {"contratos": 2010, "originacao": 609503.65, "mdr": 67154.06, "comissao": 2813.69},
}
# subtotais FCDL lidos na própria planilha
FCDL_SUBTOTAIS = {
    "SEM GRUPO": (1977, 561106.45, 62314.30, 2492.57),
    "INSIDE_SALES": (33, 48397.20, 4839.76, 321.12),
}
FCDL_VAREJOS_ANUNCIADOS = {"SEM GRUPO": 309, "INSIDE_SALES": 2}

TOL = 0.015
problemas = []


def brl(v):
    if v is None:
        return "—"
    return "R$ " + ("{:,.2f}".format(v)).replace(",", "@").replace(".", ",").replace("@", ".")


def ok(a, b, tol=TOL):
    return a is not None and b is not None and abs(a - b) <= tol


def checa(rotulo, calc, esperado, tol=TOL, inteiro=False):
    bate = ok(calc, esperado, tol)
    f = (lambda v: "%d" % round(v)) if inteiro else brl
    print("   %-34s %16s | %16s  %s"
          % (rotulo, f(calc), f(esperado), "OK" if bate else "DIVERGE (%+.2f)" % (calc - esperado)))
    if not bate:
        problemas.append("%s: %.2f x %.2f" % (rotulo, calc, esperado))
    return bate


def num(txt):
    t = (txt or "").strip().strip('"').replace(",", "")
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def campos(linha):
    return [c.strip() for c in re.findall(r'"[^"]*"|[^,]*', linha) if c != ""] or [""]


def limpar(s):
    return s.replace("\\_", "_").replace("\\&", "&").strip()


# ─────────────────────────── Outros Varejos ───────────────────────────
def ler_outros():
    doc = json.load(io.open(OUTROS, encoding="utf-8"))
    bruto = doc["fileContent"]
    corte = bruto.index("DETALHAMENTO POR ISSUER")
    return doc["title"], bruto[:corte], bruto[corte:]


def quebrar(bruto):
    s = re.sub(r" (?=\d+,[\d.])", "\n", bruto)
    s = re.sub(r" (?=▸ )", "\n", s)
    s = re.sub(r" (?=,,,)", "\n", s)
    s = re.sub(r" (?=RETAILER ID,|Parceiro,|Competência,|Total |ISSUER,|COMISSÃO POR ISSUER|Dica:)", "\n", s)
    # o bloco "COMISSÃO POR ISSUER" tem 3 linhas que começam por nome, não por número
    s = re.sub(r" (?=(?:UME|AIVA|ODRES\\_CRED),\d)", "\n", s)
    return [l for l in (x.strip() for x in s.split("\n")) if l]


def parse_tabela(bruto, com_issuer):
    """Devolve (cabecalho, lojas, subtotais, total_geral, por_issuer_resumo, varejos_anunciados)."""
    cab, lojas, subtot, total_geral, resumo_issuer, anunciados = {}, [], OrderedDict(), None, [], OrderedDict()
    grupo = None
    for linha in quebrar(bruto):
        c = campos(linha)
        r = limpar(c[0].strip('"'))

        if r.startswith("Total "):
            cab[r] = num(c[1] if len(c) > 1 else "")
            continue
        if r == "Competência":
            cab["Competência"] = c[1] if len(c) > 1 else ""
            continue
        if r.startswith("▸"):
            grupo = limpar(r.lstrip("▸ "))
            m = re.search(r"(\d+)\s+varejos", linha)
            if m:
                anunciados[grupo] = int(m.group(1))
            continue
        if r in ("UME", "AIVA", "ODRES_CRED") and len(c) <= 5:
            resumo_issuer.append((r, num(c[1]), num(c[2]), num(c[3])))
            continue
        if linha.startswith(",,,"):
            c2 = linha.split(",")
            nome = limpar(c2[3])
            vals = [num(x) for x in re.findall(r'"[^"]*"|[^,]+', linha) if num(x) is not None]
            if nome.startswith("Subtotal"):
                subtot[limpar(nome.replace("Subtotal", ""))] = vals[-4:]
            elif nome.startswith("TOTAL GERAL"):
                total_geral = vals[-4:]
            continue
        if re.fullmatch(r"\d+", r):
            cauda = c[4:]
            issuer = None
            if com_issuer and len(cauda) == 5:
                issuer, cauda = limpar(cauda[0]), cauda[1:]
            if len(cauda) != 4:
                problemas.append("linha ilegível: " + linha[:90])
                continue
            lojas.append(dict(rid=r, cnpj=c[1], varejo=limpar(c[2].strip('"')),
                              grupo=limpar(c[3]), issuer=issuer,
                              contratos=num(cauda[0]), originacao=num(cauda[1]),
                              mdr=num(cauda[2]), comissao=num(cauda[3])))
    return cab, lojas, subtot, total_geral, resumo_issuer, anunciados


def soma(lojas, campo):
    return sum(l[campo] or 0 for l in lojas)


def bloco_outros():
    titulo, parte1, parte2 = ler_outros()
    print("=" * 84)
    print(titulo)
    print("=" * 84)

    cab, lojas1, subtot, tg1, resumo_issuer, anunciados = parse_tabela(parte1, com_issuer=False)
    _c2, lojas2, _s2, tg2, _r2, _a2 = parse_tabela(parte2, com_issuer=True)

    print("Competência: %s" % cab.get("Competência"))
    print("Tabela 1 (por varejo): %d lojas | Tabela 2 (varejo x issuer): %d linhas" % (len(lojas1), len(lojas2)))

    print("\n1) soma das %d linhas de loja  x  total declarado no cabeçalho" % len(lojas1))
    checa("contratos", soma(lojas1, "contratos"), cab["Total Contratos"], 0.5, True)
    checa("originação", soma(lojas1, "originacao"), cab["Total Originação"], 0.02)
    checa("MDR", soma(lojas1, "mdr"), cab["Total MDR"], 0.02)
    checa("comissão", soma(lojas1, "comissao"), cab["Total Comissão"], 0.02)

    print("\n2) linha TOTAL GERAL da tabela 1  x  cabeçalho")
    for rot, v, d in zip(("contratos", "originação", "MDR", "comissão"), tg1,
                         (cab["Total Contratos"], cab["Total Originação"], cab["Total MDR"], cab["Total Comissão"])):
        checa(rot, v, d, 0.5 if rot == "contratos" else 0.02, rot == "contratos")

    print("\n3) subtotais de grupo  x  soma das lojas de cada grupo")
    porg = {}
    for l in lojas1:
        g = porg.setdefault(l["grupo"], dict(n=0, contratos=0, originacao=0, mdr=0, comissao=0))
        g["n"] += 1
        for k in ("contratos", "originacao", "mdr", "comissao"):
            g[k] += l[k] or 0
    for nome, v in subtot.items():
        g = porg.get(nome)
        if not g:
            print("   %-28s  subtotal sem lojas" % nome)
            problemas.append("subtotal %s sem lojas" % nome)
            continue
        difs = []
        for i, k in enumerate(("contratos", "originacao", "mdr", "comissao")):
            tol = 0.5 if k == "contratos" else 0.02
            if not ok(g[k], v[i], tol):
                difs.append("%s %+.2f" % (k, g[k] - v[i]))
        bate = not difs
        an = anunciados.get(nome)
        obs = "" if an in (None, g["n"]) else "  [diz %d varejos, li %d]" % (an, g["n"])
        print("   %-28s %4d lojas  comissão %13s  %s%s"
              % (nome, g["n"], brl(g["comissao"]), "OK" if bate else "DIVERGE: " + ", ".join(difs), obs))
        if not bate:
            problemas.append("subtotal %s: %s" % (nome, ", ".join(difs)))
        if obs:
            problemas.append("contagem de varejos de %s: diz %d, tem %d" % (nome, an, g["n"]))

    print("\n4) tabela 2 (varejo x issuer)  x  tabela 1")
    checa("contratos", soma(lojas2, "contratos"), soma(lojas1, "contratos"), 0.5, True)
    checa("originação", soma(lojas2, "originacao"), soma(lojas1, "originacao"), 0.02)
    checa("MDR", soma(lojas2, "mdr"), soma(lojas1, "mdr"), 0.02)
    checa("comissão", soma(lojas2, "comissao"), soma(lojas1, "comissao"), 0.02)

    print("\n5) bloco COMISSÃO POR ISSUER  x  soma das linhas da tabela 2")
    porissuer = {}
    for l in lojas2:
        d = porissuer.setdefault(l["issuer"] or "(sem issuer)", dict(contratos=0, originacao=0, comissao=0))
        d["contratos"] += l["contratos"] or 0
        d["originacao"] += l["originacao"] or 0
        d["comissao"] += l["comissao"] or 0
    for nome, contratos, orig, com in resumo_issuer:
        d = porissuer.get(nome, dict(contratos=0, originacao=0, comissao=0))
        print("   %-12s resumo %5.0f contr %13s | linhas %5.0f contr %13s  %s"
              % (nome, contratos, brl(com), d["contratos"], brl(d["comissao"]),
                 "OK" if (ok(d["comissao"], com, 0.02) and ok(d["contratos"], contratos, 0.5)) else "DIVERGE"))
        if not (ok(d["comissao"], com, 0.02) and ok(d["contratos"], contratos, 0.5)):
            problemas.append("issuer %s diverge entre resumo e linhas" % nome)
    tot_issuer = sum(x[3] for x in resumo_issuer)
    checa("soma dos 3 issuers = comissão total", tot_issuer, cab["Total Comissão"], 0.02)

    # cada varejo: soma dos issuers = linha da tabela 1
    print("\n6) por varejo: soma dos issuers  x  linha única da tabela 1")
    t1 = {}
    for l in lojas1:
        t1.setdefault(l["rid"], 0.0)
        t1[l["rid"]] += l["comissao"] or 0
    t2 = {}
    for l in lojas2:
        t2.setdefault(l["rid"], 0.0)
        t2[l["rid"]] += l["comissao"] or 0
    so1 = sorted(set(t1) - set(t2))
    so2 = sorted(set(t2) - set(t1))
    difs = [(r, t1[r], t2[r]) for r in sorted(set(t1) & set(t2)) if abs(t1[r] - t2[r]) > 0.02]
    print("   varejos na tabela 1: %d | na tabela 2: %d | só em 1: %d | só em 2: %d | com diferença: %d"
          % (len(t1), len(t2), len(so1), len(so2), len(difs)))
    for r in so1[:10]:
        problemas.append("RID %s está no detalhamento por varejo e não no por issuer" % r)
    for r in so2[:10]:
        problemas.append("RID %s está no por issuer e não no detalhamento por varejo" % r)
    for r, a, b in difs[:10]:
        problemas.append("RID %s: por varejo %.2f x por issuer %.2f" % (r, a, b))

    odres = next((c for n, _k, _o, c in resumo_issuer if n == "ODRES_CRED"), None)
    return cab, lojas1, odres


# ──────────────────────────────── FCDL ────────────────────────────────
def bloco_fcdl():
    print("\n" + "=" * 84)
    print("Comissao Track - FCDL - Setembro 2026.xlsx")
    print("=" * 84)
    lojas = []
    with io.open(FCDL_CSV, encoding="utf-8") as fh:
        next(fh)
        for linha in fh:
            if not linha.strip():
                continue
            p = linha.rstrip("\n").split(",")
            lojas.append(dict(rid=p[0], cnpj=p[1], varejo=p[2], grupo=p[3], issuer=None,
                              contratos=float(p[4]), originacao=float(p[5]),
                              mdr=float(p[6]), comissao=float(p[7])))
    print("Linhas de loja lidas: %d" % len(lojas))

    print("\n1) soma das linhas  x  total declarado no cabeçalho")
    checa("contratos", soma(lojas, "contratos"), EMAIL["fcdl"]["contratos"], 0.5, True)
    checa("originação", soma(lojas, "originacao"), EMAIL["fcdl"]["originacao"], 0.02)
    checa("MDR", soma(lojas, "mdr"), EMAIL["fcdl"]["mdr"], 0.02)
    checa("comissão", soma(lojas, "comissao"), EMAIL["fcdl"]["comissao"], 0.02)

    print("\n2) subtotais de grupo")
    for nome, v in FCDL_SUBTOTAIS.items():
        g = [l for l in lojas if l["grupo"] == nome]
        difs = []
        for i, k in enumerate(("contratos", "originacao", "mdr", "comissao")):
            tol = 0.5 if k == "contratos" else 0.02
            s = sum(l[k] for l in g)
            if not ok(s, v[i], tol):
                difs.append("%s %+.2f" % (k, s - v[i]))
        bate = not difs
        an = FCDL_VAREJOS_ANUNCIADOS.get(nome)
        obs = "" if an == len(g) else "  [diz %d varejos, li %d]" % (an, len(g))
        print("   %-16s %4d lojas  comissão %12s  %s%s"
              % (nome, len(g), brl(sum(l["comissao"] for l in g)), "OK" if bate else "DIVERGE: " + ", ".join(difs), obs))
        if not bate:
            problemas.append("FCDL subtotal %s: %s" % (nome, ", ".join(difs)))
        if obs:
            problemas.append("FCDL contagem de %s: diz %d, tem %d" % (nome, an, len(g)))
    return lojas


def main():
    cab_outros, lojas_outros, odres = bloco_outros()
    lojas_fcdl = bloco_fcdl()

    print("\n" + "=" * 84)
    print("FECHAMENTO CONTRA O E-MAIL")
    print("=" * 84)
    tot_con = cab_outros["Total Contratos"] + EMAIL["fcdl"]["contratos"]
    tot_ori = cab_outros["Total Originação"] + EMAIL["fcdl"]["originacao"]
    tot_mdr = cab_outros["Total MDR"] + EMAIL["fcdl"]["mdr"]
    tot_com = cab_outros["Total Comissão"] + EMAIL["fcdl"]["comissao"]
    checa("contratos", tot_con, EMAIL["contratos"], 0.5, True)
    checa("originação", tot_ori, EMAIL["originacao"], 0.02)
    checa("MDR", tot_mdr, EMAIL["mdr"], 0.02)
    checa("comissão total a pagar", tot_com, EMAIL["total"], 0.02)
    if odres is not None:
        checa("Nota 1 · Odres", odres, EMAIL["odres"], 0.02)
        checa("Nota 2 · demais (não-Odres)", tot_com - odres, EMAIL["nao_odres"], 0.02)

    print("\n" + "=" * 84)
    if problemas:
        print("PROBLEMAS (%d):" % len(problemas))
        for x in problemas:
            print("  -", x)
    else:
        print("NENHUMA DIVERGÊNCIA. Todas as somas fecham, linha a linha.")

    todas = lojas_outros + lojas_fcdl
    saida = os.path.join(AQUI, "out-comissao-ume-2026-09.json")
    io.open(saida, "w", encoding="utf-8").write(json.dumps(todas, ensure_ascii=False, indent=1))
    print("\n%d lojas (%d Outros Varejos + %d FCDL) em %s"
          % (len(todas), len(lojas_outros), len(lojas_fcdl), os.path.basename(saida)))


if __name__ == "__main__":
    main()
