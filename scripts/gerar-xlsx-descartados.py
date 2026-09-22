# -*- coding: utf-8 -*-
"""Planilha da conferência dos 230 CNPJs que a AIVA quer tirar do pipe (Aldo 22/09/2026).

Diferença pra versão de 18/09: cada CNPJ foi procurado também PELO TELEFONE, nos
funis 15/19/17/20 do Evo — porque o lead some da nossa base quando o card vai pro
funil 19, e porque o CNPJ da lista pode ser filial de um lojista que já vende.
"""
import json, io, collections
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

FONTE = r'C:\projetos claude\sdr-aiva\scripts\out-descartados-conferidos.json'
SAIDA = r'C:\projetos claude\sdr-aiva\docs\Descartados-conferidos-2026-09-22.xlsx'
d = json.load(io.open(FONTE, encoding='utf-8'))

ARIAL = 'Arial'
HDR = PatternFill('solid', fgColor='1F3864')
VERDE = PatternFill('solid', fgColor='E8F5E9')    # pode descartar
AMAR = PatternFill('solid', fgColor='FFF8E1')     # conferir
VERM = PatternFill('solid', fgColor='FCE4EC')     # não descartar
COR = {'PODE DESCARTAR': VERDE, 'CONFERIR': AMAR, 'NÃO DESCARTAR': VERM}

wb = Workbook(); wb.remove(wb.active)

def cabecalho(ws, cols, larguras):
    ws.append(cols)
    for i, c in enumerate(cols, 1):
        cel = ws.cell(row=1, column=i)
        cel.font = Font(name=ARIAL, bold=True, color='FFFFFF', size=10)
        cel.fill = HDR
        cel.alignment = Alignment(vertical='center', wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = larguras[i - 1]
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = 'A2'

def fmt(ws, textuais=(), pintar_por_rec=False):
    for row in ws.iter_rows(min_row=2):
        for cel in row:
            cel.font = Font(name=ARIAL, size=10)
            cel.alignment = Alignment(vertical='top', wrap_text=(cel.column_letter == 'C'))
            if cel.column_letter in textuais:
                cel.number_format = '@'
        if pintar_por_rec:
            f = COR.get(row[0].value)
            if f:
                row[0].fill = f
                row[0].font = Font(name=ARIAL, size=10, bold=True)
    ws.auto_filter.ref = ws.dimensions

COLS = ['Recomendação', 'CNPJ', 'Por quê', 'Loja', 'Telefone(s) encontrado(s)', 'Cidade',
        'Status do lead', 'Etapa no funil 15', 'Cards no Evo', 'No funil 19 (Odres)',
        'RID (ID da loja AIVA)', 'Vendas', 'Consultas', 'Etapa no portal', 'Biometria',
        'Base Odres', 'Outros CNPJs do lojista', 'Outra loja ativa do lojista',
        'Msgs nossas', 'Última msg do lojista', 'Silêncio (dias)', 'DV do CNPJ',
        'Temos registro', 'Achado só pelo telefone', 'Marcadores']
LARG = [17, 20, 66, 30, 34, 18, 26, 18, 30, 16, 18, 9, 11, 17, 13, 12, 26, 24, 12, 20, 15, 11, 14, 20, 24]
TEXTUAIS = ('B', 'E', 'K', 'Q', 'R')

def sn(v):
    return 'SIM' if v else ''

def linha(x):
    return [x['recomendacao'], x['cnpj'], x['motivos'], x['loja'] or x['razao_portal'], x['telefones'], x['cidade'],
            x['status_lead'] or '(sem lead)', x['etapa_15'] or '', x['cards_evo'] or '', sn(x['no_funil_19']),
            x['rid'] or '', x['vendas'], x['consultas'], x['stage_portal'] or '(fora do portal)', x['biometria'] or '',
            sn(x['base_odres']), x['outros_cnpjs_do_lojista'] or '', x['outra_loja_ativa'] or '',
            x['nossas_mensagens'], x['ultima_msg_lojista'] or 'nunca respondeu', x['silencio_dias'],
            'ok' if x['dv_valido'] else 'INVÁLIDO', sn(x['temos_registro']), sn(x['lead_por_telefone']), x['marcadores'] or '']

ordem = {'NÃO DESCARTAR': 0, 'CONFERIR': 1, 'PODE DESCARTAR': 2}
conta = collections.Counter(x['recomendacao'] for x in d)

# ── Resumo ──────────────────────────────────────────────────────────────────
ws = wb.create_sheet('Resumo')
ws.column_dimensions['A'].width = 74
ws.column_dimensions['B'].width = 12
n = lambda f: sum(1 for x in d if f(x))
linhas = [
    ('CONFERÊNCIA DOS CNPJS QUE A AIVA QUER TIRAR DO PIPE — 22/09/2026', ''),
    ('Cada CNPJ foi procurado por CNPJ e por TELEFONE (funis 15, 19, 17 e 20 do Evo,', ''),
    ('portal da AIVA, base Odres e histórico de conversa).', ''),
    ('', ''),
    ('CNPJs na lista', len(d)),
    ('', ''),
    ('RECOMENDAÇÃO', ''),
    ('  NÃO DESCARTAR — tem sinal concreto de que a loja está viva', conta['NÃO DESCARTAR']),
    ('  CONFERIR — precisa de decisão humana antes', conta['CONFERIR']),
    ('  PODE DESCARTAR — nenhum sinal de vida em nenhuma fonte', conta['PODE DESCARTAR']),
    ('', ''),
    ('POR QUE NÃO DESCARTAR (um CNPJ pode ter mais de um motivo)', ''),
    ('  Lojista respondeu nos últimos 3 dias', n(lambda x: x['silencio_dias'] is not None and x['silencio_dias'] <= 3)),
    ('  Card está em Vendendo / Login / Treinar / Cadastro Recebido', n(lambda x: x['etapa_15'] in ('Vendendo', 'Login', 'Treinar', 'Cadastro Recebido'))),
    ('  É 2º CNPJ (filial) de lojista que já tem loja ativa', n(lambda x: bool(x['outra_loja_ativa']))),
    ('  Cadastro avançou no portal (passou de dados_varejo)', n(lambda x: x['stage_portal'] and x['stage_portal'] != 'dados_varejo')),
    ('  Tem ID de loja na AIVA (RID)', n(lambda x: bool(x['rid']))),
    ('  Loja com venda registrada no portal', n(lambda x: (x['vendas'] or 0) > 0)),
    ('', ''),
    ('POR QUE CONFERIR', ''),
    ('  Telefone está no funil 19 (cliente Odres/UME barrado)', n(lambda x: x['no_funil_19'])),
    ('  CNPJ com dígito verificador inválido (erro de digitação na origem)', n(lambda x: not x['dv_valido'])),
    ('  Respondeu entre 4 e 30 dias atrás — a cobrança do formulário ainda atua nele', n(lambda x: x['silencio_dias'] is not None and 3 < x['silencio_dias'] <= 30)),
    ('  Aparece na base Odres pelo CNPJ', n(lambda x: x['base_odres'])),
    ('', ''),
    ('O QUE SÓ APARECEU AGORA (a conferência de 18/09 buscava só por CNPJ)', ''),
    ('  Achados pelo TELEFONE, sem registro do CNPJ na nossa base', n(lambda x: x['lead_por_telefone'])),
    ('  Telefone com card no funil 19 (lead apagado da nossa base pelo sync)', n(lambda x: x['no_funil_19'])),
    ('  Filiais de lojista com outra loja ativa', n(lambda x: bool(x['outros_cnpjs_do_lojista']))),
    ('', ''),
    ('QUANTO DISSO É OPORTUNIDADE DE VERDADE', ''),
    ('  Nunca recebeu nenhuma mensagem nossa', n(lambda x: x['nunca_trabalhado'])),
    ('  Nunca respondeu nada', n(lambda x: x['silencio_dias'] is None)),
    ('  Sem registro, sem lead e sem card em nenhum funil', n(lambda x: not x['temos_registro'] and not x['cards_evo'])),
    ('', ''),
    ('ONDE CADA UM ESTÁ NO PORTAL DA AIVA', ''),
]
for k, q in collections.Counter(x['stage_portal'] or '(fora do portal)' for x in d).most_common():
    linhas.append((f'  {k}', q))
linhas += [('', ''), ('ETAPA DO CARD NO FUNIL 15', '')]
for k, q in collections.Counter(x['etapa_15'] or '(sem card no 15)' for x in d).most_common():
    linhas.append((f'  {k}', q))

for t, v in linhas:
    ws.append([t, v])
for row in ws.iter_rows(min_row=1):
    txt = str(row[0].value or '')
    negrito = txt.isupper() and len(txt) > 3
    row[0].font = Font(name=ARIAL, size=10, bold=negrito)
    row[1].font = Font(name=ARIAL, size=10, bold=negrito)
ws['A1'].font = Font(name=ARIAL, size=12, bold=True, color='1F3864')

# ── Abas ────────────────────────────────────────────────────────────────────
def aba(nome, itens):
    w = wb.create_sheet(nome)
    cabecalho(w, COLS, LARG)
    for x in itens:
        w.append(linha(x))
    fmt(w, textuais=TEXTUAIS, pintar_por_rec=True)
    return w

aba('Todos (230)', sorted(d, key=lambda y: (ordem[y['recomendacao']], -(y['vendas'] or 0), y['loja'] or 'zzz')))
aba('NAO descartar', [x for x in d if x['recomendacao'] == 'NÃO DESCARTAR'])
aba('Conferir', [x for x in d if x['recomendacao'] == 'CONFERIR'])
aba('Pode descartar', [x for x in d if x['recomendacao'] == 'PODE DESCARTAR'])
aba('Funil 19 (Odres)', [x for x in d if x['no_funil_19']])
aba('Filiais de loja ativa', [x for x in d if x['outra_loja_ativa']])
aba('CNPJ invalido', [x for x in d if not x['dv_valido']])

wb.save(SAIDA)
print(SAIDA)
print({k: v for k, v in conta.items()})
