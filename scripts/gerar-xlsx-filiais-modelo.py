# -*- coding: utf-8 -*-
"""Filiais no modelo novo da AIVA (aba do Mauricio) + aba de conferência."""
import json, io
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

d = json.load(io.open(r'C:\projetos claude\sdr-aiva\scripts\out-filiais-modelo.json', encoding='utf-8'))
ARIAL, HDR = 'Arial', PatternFill('solid', fgColor='1F3864')
ALERTA = PatternFill('solid', fgColor='FFF2CC')
wb = Workbook(); wb.remove(wb.active)

COLS = list(d['saida'][0].keys())
LARG = [11, 30, 11, 30, 9, 22, 20, 18, 5, 20, 20, 30, 15, 32, 26]
ws = wb.create_sheet('Modelo AIVA')
ws.append(COLS)
for i, c in enumerate(COLS, 1):
    cel = ws.cell(row=1, column=i)
    cel.font = Font(name=ARIAL, bold=True, color='FFFFFF', size=10)
    cel.fill = HDR; cel.alignment = Alignment(vertical='center', wrap_text=True)
    ws.column_dimensions[get_column_letter(i)].width = LARG[i-1]
ws.row_dimensions[1].height = 32
ws.freeze_panes = 'A2'
for r in d['saida']:
    ws.append([r[c] for c in COLS])
# tudo texto: CNPJ, CPF, CEP e telefone não podem virar número
for row in ws.iter_rows(min_row=2):
    for cel in row:
        cel.font = Font(name=ARIAL, size=10); cel.number_format = '@'
ws.auto_filter.ref = ws.dimensions

ws = wb.create_sheet('Conferir antes de enviar')
cab = ['Loja', 'CNPJ DA FILIAL', 'Operador', 'Avisos']
ws.append(cab)
for i, c in enumerate(cab, 1):
    cel = ws.cell(row=1, column=i)
    cel.font = Font(name=ARIAL, bold=True, color='FFFFFF', size=10); cel.fill = HDR
    ws.column_dimensions[get_column_letter(i)].width = [34, 20, 30, 110][i-1]
ws.freeze_panes = 'A2'
for r in d['conferir']:
    ws.append([r['Loja'], r['CNPJ DA FILIAL'], r['Operador'], r['Avisos']])
for row in ws.iter_rows(min_row=2):
    for cel in row:
        cel.font = Font(name=ARIAL, size=10); cel.alignment = Alignment(wrap_text=True, vertical='top')
    if 'INAPTA' in str(row[3].value) or 'não respondeu' in str(row[3].value):
        for cel in row: cel.fill = ALERTA
ws.column_dimensions['D'].width = 110

wb.save(r'C:\projetos claude\sdr-aiva\docs\Filiais-modelo-AIVA-2026-09-18.xlsx')

# TSV pra colar direto na aba do Google Sheets (mesma ordem de colunas)
with io.open(r'C:\projetos claude\sdr-aiva\docs\Filiais-modelo-AIVA-2026-09-18.tsv', 'w', encoding='utf-8', newline='\n') as f:
    f.write('\t'.join(COLS) + '\n')
    for r in d['saida']:
        f.write('\t'.join(str(r[c]) for c in COLS) + '\n')
print('ok')
