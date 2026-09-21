# -*- coding: utf-8 -*-
"""Etapa LOGIN x sistema da AIVA — quem recebeu a senha, quem usou, quem nunca entrou."""
import json, io, collections
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

d = json.load(io.open(r'C:\projetos claude\sdr-aiva\scripts\out-login-conferencia.json', encoding='utf-8'))
L = d['linhas']
ARIAL = 'Arial'; HDR = PatternFill('solid', fgColor='1F3864')
VERDE = PatternFill('solid', fgColor='E2F0D9'); AMARELO = PatternFill('solid', fgColor='FFF2CC'); VERM = PatternFill('solid', fgColor='FCE4EC')
wb = Workbook(); wb.remove(wb.active)

COLS = ['Loja', 'Telefone', 'CNPJ', 'RID', 'Situação na AIVA', 'Usou o login', 'Senha enviada em', 'Dias desde o envio',
        'Consultas', 'Aprovados', 'Vendas', 'Tel. cadastro AIVA', 'Tel. diferente da conversa', 'Reenvios',
        'Última msg do lojista', 'Silêncio (dias)', 'Fila humana', 'Stage portal', 'Marcadores']
LARG = [30, 15, 16, 7, 34, 26, 14, 10, 10, 10, 8, 16, 12, 9, 14, 10, 8, 18, 30]

def aba(nome, linhas):
    ws = wb.create_sheet(nome)
    ws.append(COLS)
    for i, c in enumerate(COLS, 1):
        cel = ws.cell(row=1, column=i)
        cel.font = Font(name=ARIAL, bold=True, color='FFFFFF', size=10); cel.fill = HDR
        cel.alignment = Alignment(vertical='center', wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = LARG[i-1]
    ws.row_dimensions[1].height = 32; ws.freeze_panes = 'A2'
    for x in linhas:
        ws.append([x.get(c, '') for c in COLS])
    for row in ws.iter_rows(min_row=2):
        for cel in row:
            cel.font = Font(name=ARIAL, size=10)
            if cel.column_letter in ('B', 'C', 'D', 'L'): cel.number_format = '@'
        uso = str(row[5].value)
        fill = VERDE if uso.startswith('SIM') else AMARELO if uso.startswith('NÃO') else VERM
        for cel in row: cel.fill = fill
    ws.auto_filter.ref = ws.dimensions
    return ws

ordem = {'SEM RID': 0, 'PEDIDO': 1, 'SEM PEDIDO': 2, 'SENHA ENVIADA': 3}
def chave(x):
    sit = x['Situação na AIVA']; k = next((v for p, v in ordem.items() if sit.startswith(p)), 9)
    return (k, 0 if str(x['Usou o login']).startswith('NÃO') else 1, -(x['Dias desde o envio'] or 0))

ws = wb.create_sheet('Resumo')
ws.column_dimensions['A'].width = 70; ws.column_dimensions['B'].width = 12
n = lambda f: sum(1 for x in L if f(x))
linhas = [
    ('Leads em LOGIN (status) — cards na etapa 71 do Evo', f"{len(L)} — {d['cards71']}"),
    ('', ''),
    ('SITUAÇÃO NO SISTEMA DA AIVA (login_sends.credentials_sent_at)', ''),
    ('Senha do sócio ENVIADA pela AIVA', n(lambda x: x['Situação na AIVA'] == 'SENHA ENVIADA')),
    ('  … e o lojista JÁ CONSULTOU (usou o login)', n(lambda x: str(x['Usou o login']).startswith('SIM'))),
    ('  … e NUNCA fez uma consulta (recebeu e não entrou — ou não recebeu)', n(lambda x: str(x['Usou o login']).startswith('NÃO'))),
    ('Pedido feito e senha NÃO enviada', n(lambda x: x['Situação na AIVA'].startswith('PEDIDO'))),
    ('Sem RID — a loja ainda não existe na AIVA', n(lambda x: x['Situação na AIVA'].startswith('SEM RID'))),
    ('', ''),
    ('SINAIS', ''),
    ('Telefone do cadastro da AIVA ≠ WhatsApp da conversa (a senha foi pra outro número)', n(lambda x: x['Tel. diferente da conversa'] == 'SIM')),
    ('Já teve cliente APROVADO e nenhuma venda', n(lambda x: x['Aprovados'] > 0 and x['Vendas'] == 0)),
    ('Já vendeu (deveria estar em Loja Vendendo)', n(lambda x: x['Já vendeu'] == 'SIM')),
    ('Com reenvio de senha registrado', n(lambda x: x['Reenvios'] > 0)),
    ('Na fila humana', n(lambda x: x['Fila humana'] == 'SIM')),
    ('Silêncio do lojista > 14 dias', n(lambda x: x['Silêncio (dias)'] != '' and x['Silêncio (dias)'] > 14)),
]
for t, v in linhas:
    ws.append([t, v])
for row in ws.iter_rows(min_row=1):
    for cel in row: cel.font = Font(name=ARIAL, size=10, bold=(cel.column == 1 and str(cel.value or '').isupper()))

aba('Todos (33)', sorted(L, key=chave))
aba('Nunca consultou', [x for x in L if str(x['Usou o login']).startswith('NÃO')])
aba('Tel. diferente', [x for x in L if x['Tel. diferente da conversa'] == 'SIM'])
wb.save(r'C:\projetos claude\sdr-aiva\docs\Etapa-Login-x-AIVA-2026-09-21.xlsx')
print('ok')
