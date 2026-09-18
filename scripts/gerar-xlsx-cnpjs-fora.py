# -*- coding: utf-8 -*-
"""Planilha dos CNPJs que a AIVA marcou pra sair do pipe (Aldo 18/09/2026)."""
import json, io, collections
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

d = json.load(io.open(r'C:\projetos claude\sdr-aiva\scripts\out-cnpjs-fora.json', encoding='utf-8'))
ARIAL = 'Arial'
HDR = PatternFill('solid', fgColor='1F3864')
ALERTA = PatternFill('solid', fgColor='FFF2CC')
PERIGO = PatternFill('solid', fgColor='FCE4EC')

wb = Workbook(); wb.remove(wb.active)

def cabecalho(ws, cols, larguras):
    ws.append(cols)
    for i, c in enumerate(cols, 1):
        cel = ws.cell(row=1, column=i)
        cel.font = Font(name=ARIAL, bold=True, color='FFFFFF', size=10)
        cel.fill = HDR; cel.alignment = Alignment(vertical='center', wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = larguras[i-1]
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = 'A2'

def fmt(ws, textuais=()):
    for row in ws.iter_rows(min_row=2):
        for cel in row:
            cel.font = Font(name=ARIAL, size=10)
            if cel.column_letter in textuais: cel.number_format = '@'
    ws.auto_filter.ref = ws.dimensions

# ── Resumo ──
ws = wb.create_sheet('Resumo')
ws.column_dimensions['A'].width = 62; ws.column_dimensions['B'].width = 14
linhas = [
    ('CNPJs na lista do Aldo (únicos)', len(d)),
    ('  … com DV inválido (erro de digitação na origem)', sum(1 for x in d if not x['dv_valido'])),
    ('', ''),
    ('SITUAÇÃO NO PORTAL DA AIVA (consulta de 18/09/2026)', ''),
    ('Ainda aparecem na listagem da API do parceiro', sum(1 for x in d if x['ainda_no_portal'])),
    ('  … em "dados_varejo" com formulário PENDENTE', sum(1 for x in d if x['stage_portal'] == 'dados_varejo')),
    ('  … já concluíram (saíram do padrão da lista)', sum(1 for x in d if x['stage_portal'] != 'dados_varejo')),
    ('Pré-cadastro aprovado pela AIVA', sum(1 for x in d if x['pre_cadastro'] == 'approved')),
    ('Criados no portal em agosto/2026', sum(1 for x in d if (x['criado_portal'] or '').startswith('2026-08'))),
    ('Criados no portal em setembro/2026', sum(1 for x in d if (x['criado_portal'] or '').startswith('2026-09'))),
    ('', ''),
    ('NOSSA BASE', ''),
    ('Com registro no painel (/registros)', sum(1 for x in d if x['temos_registro'])),
    ('Com lead no SDR', sum(1 for x in d if x['temos_lead'])),
    ('SEM nada nosso (não são oportunidades nossas)', sum(1 for x in d if not x['temos_registro'])),
    ('Registro do tipo MATRIZ', sum(1 for x in d if x['tipo_registro'] == 'matriz')),
    ('Registro do tipo ADICIONAL (filial/2º CNPJ)', sum(1 for x in d if x['tipo_registro'] == 'adicional')),
    ('', ''),
    ('CARDS NO FUNIL 15 (Evo)', ''),
]
for etapa, q in collections.Counter(x['etapa_card'] for x in d if x['etapa_card']).most_common():
    linhas.append((f'  {etapa}', q))
linhas += [
    ('  sem card no funil', sum(1 for x in d if not x['etapa_card'])),
    ('', ''),
    ('⚠️ ATENÇÃO ANTES DE DESCARTAR', ''),
    ('Pertencem a lojista que JÁ TEM loja ativa (RID) — é filial/2º CNPJ', sum(1 for x in d if x['lead_tem_loja_ativa'])),
    ('Já receberam 1 toque da cobrança automática do formulário', sum(1 for x in d if x['cobranca_toque'] >= 1)),
    ('Nunca receberam toque da cobrança', sum(1 for x in d if x['cobranca_toque'] == 0)),
]
for t, v in linhas:
    ws.append([t, v])
for row in ws.iter_rows(min_row=1):
    for cel in row:
        cel.font = Font(name=ARIAL, size=10, bold=(cel.column == 1 and str(cel.value or '').isupper()))
        if str(cel.value or '').startswith('⚠️'): cel.font = Font(name=ARIAL, size=10, bold=True, color='C00000')

# ── Detalhe ──
COLS = ['CNPJ', 'DV ok', 'Loja (nossa base)', 'Razão social (portal)', 'Telefone', 'Status do lead',
        'Etapa do card', 'Opp', 'Tipo registro', 'RID', 'Lojista já tem loja ativa', 'Stage portal',
        'Formulário', 'Biometria', 'Criado no portal', 'Atualizado no portal', 'Toques cobrança', 'Marcadores']
LARG = [20, 7, 30, 34, 16, 20, 18, 9, 13, 8, 22, 15, 12, 11, 18, 18, 15, 28]
def linha(x):
    return [x['cnpj'], 'sim' if x['dv_valido'] else 'NÃO', x['nossa_loja'], x['nome_portal'], x['telefone'],
            x['status_lead'], x['etapa_card'] or '(sem card)', x['card_opp'], x['tipo_registro'], x['rid'],
            'SIM' if x['lead_tem_loja_ativa'] else '', x['stage_portal'], x['formulario'], x['biometria'],
            (x['criado_portal'] or '')[:10], (x['atualizado_portal'] or '')[:10], x['cobranca_toque'], x['marcadores']]

ordem = {'Em Análise AIVA': 0, 'Treinar': 1, 'Login': 2, 'Vendendo': 3}
ws = wb.create_sheet('Detalhe')
cabecalho(ws, COLS, LARG)
for x in sorted(d, key=lambda y: (ordem.get(y['etapa_card'], 9), y['nossa_loja'] or 'zzz')):
    ws.append(linha(x))
fmt(ws, textuais=('A', 'E'))
for row in ws.iter_rows(min_row=2):
    if row[10].value == 'SIM':
        for cel in row: cel.fill = PERIGO

ws = wb.create_sheet('NÃO descartar')
cabecalho(ws, COLS, LARG)
for x in [y for y in d if y['lead_tem_loja_ativa']]:
    ws.append(linha(x))
fmt(ws, textuais=('A', 'E'))

ws = wb.create_sheet('Sem lead nosso')
cabecalho(ws, COLS, LARG)
for x in [y for y in d if not y['temos_registro']]:
    ws.append(linha(x))
fmt(ws, textuais=('A', 'E'))

wb.save(r'C:\projetos claude\sdr-aiva\docs\CNPJs-fora-do-pipe-AIVA-2026-09-18.xlsx')
print('ok')
