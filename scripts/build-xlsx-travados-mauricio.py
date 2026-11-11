# -*- coding: utf-8 -*-
"""Lista dos cadastros da Track que a AIVA aceitou e que nunca viraram loja,
para mandar ao Mauricio (pedido do Aldo, 09/11/2026).

Entrada: scripts/out-travados-mauricio.json
Saída:   docs/Cadastros-travados-AIVA-2026-11-09.xlsx
"""
import json
import os
from collections import Counter

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
D = json.load(open(os.path.join(AQUI, "out-travados-mauricio.json"), encoding="utf8"))
N = json.load(open(os.path.join(AQUI, "out-nao-chegaram-aiva.json"), encoding="utf8"))
SAIDA = os.path.join(RAIZ, "docs", "Cadastros-travados-AIVA-2026-11-09.xlsx")

ARIAL = "Arial"
AZUL = PatternFill("solid", fgColor="1F3864")
VERM = PatternFill("solid", fgColor="F8CBAD")
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


onde = Counter(l["ondeTravou"] for l in D)
nao_ativa = [l for l in D if l["cnpjSituacao"] and l["cnpjSituacao"] != "ATIVA"]
filiais = [l for l in D if l["grupoJaELoja"] == "sim"]
dias = sorted(l["diasNoPortal"] for l in D if l["diasNoPortal"] is not None)

# ───────────────────────────── Resumo ─────────────────────────────
ws = wb.active
ws.title = "Resumo"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 52
ws.column_dimensions["B"].width = 12
ws.column_dimensions["C"].width = 92

r = 1
ws.cell(row=r, column=1, value="CADASTROS DA TRACK QUE NÃO VIRARAM LOJA — 09/11/2026").font = Font(name=ARIAL, size=14, bold=True, color="1F3864")
r += 1
ws.cell(row=r, column=1, value="Track / 2N Soluções · lido ao vivo da API de onboardings do portal AIVA em 09/11/2026").font = Font(name=ARIAL, size=9, italic=True, color="666666")
r += 2

LIN = [
    ("__sec__", "O QUE É ESTA LISTA", None),
    ("Cadastros da Track no portal SEM retailer ID", len(D),
     "CNPJ que a Track enviou, que a AIVA aceitou e abriu cadastro, e que até hoje não virou loja. "
     "Sem retailer ID não existe venda registrada nem comissão possível — nenhum deles pode gerar receita "
     "enquanto estiver assim."),
    ("De onde vem o número", "",
     "Mandamos 1.041 CNPJs à AIVA. Ela abriu cadastro para 954 e criou loja para 385. Esta lista é o que "
     "sobra no meio do caminho."),

    ("__sec__", "ONDE CADA UM TRAVOU", None),
] + [
    (nome, qtd, "")
    for nome, qtd in onde.most_common()
] + [
    ("__sec__", "O QUE O NÚMERO DIZ", None),
    ("Formulário do varejo ainda pendente", len([l for l in D if l["formulario"] == "pending"]),
     "O gargalo é um só. O lojista passou na whitelist, recebeu o acesso e parou no formulário."),
    ("Biometria pendente", len([l for l in D if l["biometria"] == "pendente"]), ""),
    ("Biometria negada", len([l for l in D if l["biometria"] == "negado"]),
     "A pergunta de sempre: o link reabre? Se reabre, ligamos o aviso automático ao lojista."),
    ("Espera mediana no portal", f"{dias[len(dias) // 2]} dias",
     f"Mais antigo: {dias[-1]} dias. Faixas: 0–30 = {len([d for d in dias if d <= 30])}, "
     f"31–60 = {len([d for d in dias if 30 < d <= 60])}, 61–90 = {len([d for d in dias if 60 < d <= 90])}. "
     "Nenhum passa de 90 dias, o que bate com o corte de created_at que já conversamos (nada antes de 28/08)."),
    ("Com telefone do lojista", len([l for l in D if l["telefone"]]), "Todos. E-mail em " + str(len([l for l in D if l["email"]])) + "."),

    ("__sec__", "CASOS QUE SÃO NOSSOS, NÃO DA AIVA (já separados)", None),
    ("CNPJ com situação ≠ ATIVA na Receita", len(nao_ativa),
     "Esses provavelmente não viram loja por motivo legítimo. Tratamos do nosso lado — não precisa entrar "
     "na conversa com a AIVA. Filtrar a coluna 'Situação do CNPJ' na aba Cadastros."),
    ("Filial de grupo que JÁ é loja na AIVA", len(filiais),
     "O lojista já opera com outro CNPJ do mesmo grupo. Conversa curta e diferente: é cadastrar filial de "
     "cliente, não prospectar. Coluna 'Grupo já é loja na AIVA'."),

    ("__sec__", "⚠️ E TEM UM GRUPO PIOR (aba 'Nao chegaram na AIVA')", None),
    ("CNPJs que mandamos e que NÃO existem no portal", len(N),
     "Não é que travaram: é que não estão em coluna nenhuma do portal. O lojista não tem onde entrar e nós "
     "não temos como acompanhar. Mandados há 54 dias na mediana, o mais antigo há "
     + str(max((l["diasDesdeEnvio"] or 0) for l in N)) + " dias."),
    ("   desses, que o nosso lado dá como loja ativa", len([l for l in N if l["statusRegistro"] == "ativa"]),
     "Marcados como 'ativa' no nosso registro, sem existir cadastro do outro lado. Erro nosso, mas mostra "
     "o tamanho da desconexão."),
    ("   com lead em status de loja criada", len([l for l in N if l["statusLead"] in ("TREINAR", "LOGIN", "LOJA_FINALIZADA_E_VENDENDO")]),
     "Inclui a Upcell (58.267.251/0001-17), que está no nosso funil como 'Loja Finalizada e Vendendo' desde "
     "10/07 e cujo pré-cadastro foi enviado em 24/08 — e que a AIVA nunca registrou."),

    ("__sec__", "O QUE PEDIMOS À AIVA", None),
    ("1. O que o lojista vê quando trava no formulário", "",
     "Hoje cobramos no escuro: não sabemos em que campo ele para, se o link expira, se algum documento dá erro."),
    ("2. O cadastro expira?", "",
     "Aprovado que passa de X dias sem formulário sai da coluna, vira recusado, ou fica ali para sempre? "
     "Precisamos saber se estamos cobrando quem já perdeu a vaga."),
    ("3. Dá para reenviar o link em lote?", "",
     "Se vocês dispararem de novo para esses, combinamos o texto e fazemos a cobrança junto, no mesmo dia."),
    ("4. Motivo dos recusados", len([l for l in D if l["quadro"] == "not_approved"]),
     "Se for recusa definitiva, tiramos do funil e paramos de insistir com o lojista."),
    ("5. A data real da pendência", "",
     "O created_at parece ser a data da linha no portal, não a data em que o lojista ficou pendente. "
     "Com centenas de cobranças a fazer, a data certa muda a priorização inteira."),
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
    if k == "Formulário do varejo pendente" or k.startswith("Cadastros da Track"):
        b.fill = VERM
    if k.startswith(("CNPJ com situação", "Filial de grupo")):
        b.fill = VERDE
    ws.row_dimensions[r].height = 40 if len(obs or "") > 110 else 26
    r += 1

# ───────────────────────── Cadastros ─────────────────────────
ws = wb.create_sheet("Cadastros")
cols = [
    ("Onde travou", 36, "ondeTravou"),
    ("Coluna no portal", 20, "quadro"),
    ("Loja", 36, "loja"),
    ("CNPJ", 20, lambda l: fmt_cnpj(l["cnpj"])),
    ("Sócio", 24, "socio"),
    ("Telefone", 17, lambda l: fmt_tel(l["telefone"])),
    ("E-mail", 30, "email"),
    ("Cidade / região", 26, "cidade"),
    ("Formulário", 13, "formulario"),
    ("Biometria", 13, "biometria"),
    ("Pré-cadastro", 13, "preCadastroStatus"),
    ("Situação do CNPJ", 15, "cnpjSituacao"),
    ("Criado no portal", 14, "criadoNoPortal"),
    ("Dias no portal", 11, "diasNoPortal"),
    ("Na coluna desde", 14, "naColunaDesde"),
    ("Dias na coluna", 11, "diasNaColuna"),
    ("Enviado pela Track", 15, "enviadoPelaTrack"),
    ("Dias desde o envio", 12, "diasDesdeEnvio"),
    ("Matriz/filial", 12, "tipo"),
    ("Grupo já é loja na AIVA", 13, "grupoJaELoja"),
    ("CNPJs irmãos já com retailer ID", 46, "irmasNaAiva"),
    ("Status na Track (interno)", 26, "statusLead"),
    ("Último contato nosso", 14, "ultimoContato"),
]
TEXTO = {"CNPJ", "Telefone"}

for i, (titulo, larg, _) in enumerate(cols, start=1):
    c = ws.cell(row=1, column=i, value=titulo)
    c.font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
    c.fill = AZUL
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDA
    ws.column_dimensions[get_column_letter(i)].width = larg
ws.row_dimensions[1].height = 32
ws.freeze_panes = "D2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}1"

COR_ONDE = {
    "Formulário do varejo pendente": AMAR,
    "Biometria pendente": CINZA,
    "Recusado pela AIVA": VERM,
}
for rr, item in enumerate(D, start=2):
    for i, (titulo, _, chave) in enumerate(cols, start=1):
        v = chave(item) if callable(chave) else item.get(chave)
        c = ws.cell(row=rr, column=i, value=v)
        c.font = Font(name=ARIAL, size=10, bold=(titulo == "Loja"))
        c.border = BORDA
        c.alignment = Alignment(vertical="center",
                                horizontal="center" if titulo.startswith("Dias") else "left",
                                wrap_text=(titulo == "CNPJs irmãos já com retailer ID"))
        if titulo in TEXTO:
            c.number_format = "@"
        if titulo == "Onde travou":
            f = COR_ONDE.get(item["ondeTravou"])
            if f:
                c.fill = f
        if titulo == "Situação do CNPJ" and v and v != "ATIVA":
            c.fill = VERDE
        if titulo == "Grupo já é loja na AIVA" and v == "sim":
            c.fill = VERDE
        if titulo == "Dias no portal" and isinstance(v, int) and v > 60:
            c.fill = VERM
    ws.row_dimensions[rr].height = 22
ws.sheet_view.showGridLines = False

# ───────────────── Não chegaram na AIVA ─────────────────
ws = wb.create_sheet("Nao chegaram na AIVA")
cols2 = [
    ("Loja", 36, "loja"),
    ("CNPJ", 20, lambda l: fmt_cnpj(l["cnpj"])),
    ("Sócio", 24, "socio"),
    ("Telefone", 17, lambda l: fmt_tel(l["telefone"])),
    ("E-mail", 30, "email"),
    ("Cidade / região", 26, "cidade"),
    ("Matriz/filial", 12, "tipo"),
    ("Enviado pela Track", 15, "enviadoPelaTrack"),
    ("Dias desde o envio", 12, "diasDesdeEnvio"),
    ("Como foi enviado", 18, "origem"),
    ("Status do nosso registro", 20, "statusRegistro"),
    ("Grupo já é loja na AIVA", 13, "grupoJaELoja"),
    ("CNPJs irmãos já com retailer ID", 46, "irmasNaAiva"),
    ("Status na Track (interno)", 26, "statusLead"),
    ("Último contato nosso", 14, "ultimoContato"),
]
for i, (titulo, larg, _) in enumerate(cols2, start=1):
    c = ws.cell(row=1, column=i, value=titulo)
    c.font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
    c.fill = AZUL
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDA
    ws.column_dimensions[get_column_letter(i)].width = larg
ws.row_dimensions[1].height = 32
ws.freeze_panes = "C2"
ws.auto_filter.ref = f"A1:{get_column_letter(len(cols2))}1"
for rr, item in enumerate(N, start=2):
    for i, (titulo, _, chave) in enumerate(cols2, start=1):
        v = chave(item) if callable(chave) else item.get(chave)
        c = ws.cell(row=rr, column=i, value=v)
        c.font = Font(name=ARIAL, size=10, bold=(titulo == "Loja"))
        c.border = BORDA
        c.alignment = Alignment(vertical="center",
                                horizontal="center" if titulo.startswith("Dias") else "left",
                                wrap_text=(titulo == "CNPJs irmãos já com retailer ID"))
        if titulo in TEXTO:
            c.number_format = "@"
        if titulo == "Status do nosso registro" and v == "ativa":
            c.fill = VERM
        if titulo == "Dias desde o envio" and isinstance(v, int) and v > 60:
            c.fill = VERM
        if titulo == "Status na Track (interno)" and v in ("TREINAR", "LOGIN", "LOJA_FINALIZADA_E_VENDENDO"):
            c.fill = AMAR
    ws.row_dimensions[rr].height = 22
ws.sheet_view.showGridLines = False

os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
wb.save(SAIDA)
print("gravado:", SAIDA, os.path.getsize(SAIDA), "bytes")
for s in wb.sheetnames:
    print("  aba %-14s %d linhas" % (s, wb[s].max_row))
