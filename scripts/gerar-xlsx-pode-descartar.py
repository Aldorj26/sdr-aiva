# -*- coding: utf-8 -*-
"""UMA lista só: o que pode ser descartado (Aldo, 22/09/2026).

Junta as duas conferências (230 CNPJs da AIVA + 64 "descartados no pipeline"),
fica só com quem a regra única liberou, e remove duplicata — as duas listas se
cruzam em 36 lojas, e quem aparece nas duas não pode virar duas linhas aqui.
Chave de deduplicação: telefone (10 últimos dígitos) e CNPJ.
"""
import json, io, collections
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

BASE = r'C:\projetos claude\sdr-aiva'
SAIDA = BASE + r'\docs\PODE-DESCARTAR-2026-09-22.xlsx'
A = json.load(io.open(BASE + r'\scripts\out-descartados-conferidos.json', encoding='utf-8'))
B = json.load(io.open(BASE + r'\scripts\out-descartados-pipeline.json', encoding='utf-8'))

so = lambda v: ''.join(ch for ch in str(v or '') if ch.isdigit())
t10 = lambda v: so(v)[-10:] if len(so(v)) >= 10 else ''

def primeiro_tel(campo):
    """A lista dos 230 guarda 'numero (origem) | numero (origem)'.
    ⚠️ Exige 12-13 dígitos: o campo `telefone` de alguns registros guarda CNPJ
    (ex.: 00046618959000277), e um filtro frouxo de >= 10 dígitos trazia isso
    como se fosse telefone."""
    for parte in str(campo or '').split('|'):
        d = so(parte)
        if 12 <= len(d) <= 13:
            return d
    return ''


def classificar_tel(t):
    """Separa quem dá pra chamar de registro-lixo. O Nei não pode perder tempo
    ligando pra 0800 nem pra número zerado."""
    d = so(t)
    if not d:
        return 'sem telefone'
    if not d.startswith('55') or len(d) not in (12, 13):
        return 'não é telefone'
    r, corpo = d[2:], d[4:]
    ddd = int(r[:2])
    if ddd < 11 or ddd > 99:
        return 'DDD inválido'
    if len(set(corpo)) <= 2:
        return 'número falso'
    if corpo[:4] in ('4004', '4141', '0800', '0300', '3021', '3225') or corpo.startswith('0'):
        return 'número de serviço'
    if len(r) == 11 and corpo[0] != '9':
        return 'celular sem o 9'
    return 'ok'

linhas = []
vistos = set()

def add(chaves, dados):
    if any(k in vistos for k in chaves if k):
        return False
    for k in chaves:
        if k:
            vistos.add(k)
    linhas.append(dados)
    return True

# 1) os do painel primeiro: têm telefone limpo e o histórico da conversa
for x in B:
    if x['recomendacao'] != 'PODE DESCARTAR':
        continue
    tel = so(x['telefone'])
    cnpjs = [so(c) for c in str(x['cnpjs'] or '').split(',') if so(c)]
    add([t10(tel)] + cnpjs, {
        'origem': 'Descartados no pipeline (painel)',
        'loja': x['loja'], 'cnpj': ', '.join(cnpjs), 'telefone': tel, 'cidade': x['cidade'] or '',
        'porque': x['motivos'], 'motivo_descarte': x['por_que_descartou'],
        'card': x['card_15'] or '(sem card)', 'mover_card': 'MOVER' if x['card_precisa_mover'] else '',
        'portal': x['stage_portal'] or ('cadastro no portal' if x['no_portal'] else '(fora do portal)'),
        'msgs': x['nossas_mensagens'], 'ultima': x['ultima_msg_lojista'] or 'nunca respondeu',
        'silencio': x['silencio_dias'], 'deu_dados': 'SIM' if x['deu_dados'] else '',
        'opp': x['opp_lead'] or '', 'tel_ok': classificar_tel(tel),
    })

# 2) os da lista da AIVA
for x in A:
    if x['recomendacao'] != 'PODE DESCARTAR':
        continue
    cnpj = so(x['cnpj'])
    tel = primeiro_tel(x['telefones'])
    add([t10(tel), cnpj], {
        'origem': 'Lista da AIVA (fora do pipe)',
        'loja': x['loja'] or x['razao_portal'], 'cnpj': cnpj, 'telefone': tel, 'cidade': x['cidade'] or '',
        'porque': x['motivos'], 'motivo_descarte': '',
        'card': x['etapa_15'] or '(sem card)', 'mover_card': 'MOVER' if x['card_precisa_mover'] else '',
        'portal': x['stage_portal'] or '(fora do portal)',
        'msgs': x['nossas_mensagens'], 'ultima': x['ultima_msg_lojista'] or 'nunca respondeu',
        'silencio': x['silencio_dias'], 'deu_dados': '',
        'opp': '', 'tel_ok': classificar_tel(tel),
    })

# Três grupos, porque a ação é diferente em cada um:
#   1. tem telefone válido → loja de verdade, descarte consciente
#   2. só CNPJ, nada nosso → não é oportunidade nossa, só confirmar pra AIVA
#   3. telefone-lixo → registro sujo da nossa base, apagar sem dó
com_tel = [r for r in linhas if r['tel_ok'] == 'ok']
so_cnpj = [r for r in linhas if r['tel_ok'] == 'sem telefone']
lixo = [r for r in linhas if r['tel_ok'] not in ('ok', 'sem telefone')]
for g in (com_tel, so_cnpj, lixo):
    g.sort(key=lambda r: (r['loja'] or 'zzz').lower())
linhas = com_tel + so_cnpj + lixo

ARIAL = 'Arial'
HDR = PatternFill('solid', fgColor='1F3864')
wb = Workbook(); wb.remove(wb.active)

COLS = ['Loja', 'CNPJ', 'Telefone', 'Situação do telefone', 'Cidade', 'Por que pode descartar', 'Card no funil 15',
        'Mover o card?', 'Etapa no portal', 'Msgs nossas', 'Última msg do lojista',
        'Silêncio (dias)', 'Veio de', 'Motivo do descarte anterior', 'Opp']
LARG = [32, 20, 16, 20, 20, 72, 22, 14, 20, 12, 20, 15, 30, 40, 10]
TEXT = ('B', 'C', 'O')

ws = wb.create_sheet('Pode descartar')
ws.append(COLS)
for i, c in enumerate(COLS, 1):
    cel = ws.cell(row=1, column=i)
    cel.font = Font(name=ARIAL, bold=True, color='FFFFFF', size=10)
    cel.fill = HDR
    cel.alignment = Alignment(vertical='center', wrap_text=True)
    ws.column_dimensions[get_column_letter(i)].width = LARG[i - 1]
ws.row_dimensions[1].height = 32
ws.freeze_panes = 'A2'

for r in linhas:
    ws.append([r['loja'], r['cnpj'], r['telefone'], r['tel_ok'], r['cidade'], r['porque'], r['card'],
               r['mover_card'], r['portal'], r['msgs'], r['ultima'], r['silencio'],
               r['origem'], r['motivo_descarte'], r['opp']])
for row in ws.iter_rows(min_row=2):
    for cel in row:
        cel.font = Font(name=ARIAL, size=10)
        cel.alignment = Alignment(vertical='top', wrap_text=(cel.column_letter == 'F'))
        if cel.column_letter in TEXT:
            cel.number_format = '@'
ws.auto_filter.ref = ws.dimensions

# ── Resumo curto ────────────────────────────────────────────────────────────
ws2 = wb.create_sheet('Resumo', 0)
ws2.column_dimensions['A'].width = 72
ws2.column_dimensions['B'].width = 12
n = lambda f: sum(1 for x in linhas if f(x))
resumo = [
    ('LIBERADOS PARA DESCARTE — 22/09/2026', ''),
    ('Só o que a conferência liberou, das duas listas, já sem duplicata.', ''),
    ('A aba ao lado vem nesta mesma ordem: primeiro os que têm telefone.', ''),
    ('', ''),
    ('Total', len(linhas)),
    ('', ''),
    ('1) LOJA DE VERDADE — tem telefone válido, descarte é decisão sua', len(com_tel)),
    ('2) SÓ CNPJ, NADA NOSSO — sem lead, sem card: nem é oportunidade nossa', len(so_cnpj)),
    ('3) REGISTRO-LIXO — telefone zerado, 0800 ou CNPJ no campo do telefone', len(lixo)),
    ('', ''),
    ('O QUE ESTES TÊM EM COMUM', ''),
    ('  Nunca responderam nada', n(lambda x: x['ultima'] == 'nunca respondeu')),
    ('  Nunca receberam mensagem nossa', n(lambda x: (x['msgs'] or 0) == 0)),
    ('  Ainda com card ocupando o funil 15', n(lambda x: x['card'] != '(sem card)')),
    ('', ''),
    ('O QUE NÃO ESTÁ AQUI (ficou nas outras duas planilhas)', ''),
    ('  Loja vendendo, com RID, biometria aprovada ou cadastro finalizado', ''),
    ('  Card em Cadastro Recebido, Treinar, Login ou Vendendo', ''),
    ('  Lojista que respondeu nos últimos 3 dias', ''),
    ('  Lojista que entregou CNPJ e dados e parou no meio', ''),
    ('  Filial de lojista que já tem loja ativa', ''),
    ('  Telefone no funil 19 (Odres) ou CNPJ com dígito inválido', ''),
    ('', ''),
    ('ONDE ESTÃO NO PORTAL DA AIVA', ''),
]
for k, q in collections.Counter(x['portal'] for x in linhas).most_common():
    resumo.append((f'  {k}', q))
resumo += [('', ''), ('ETAPA DO CARD NO FUNIL 15', '')]
for k, q in collections.Counter(x['card'] for x in linhas).most_common():
    resumo.append((f'  {k}', q))
for t, v in resumo:
    ws2.append([t, v])
for row in ws2.iter_rows(min_row=1):
    txt = str(row[0].value or '')
    b = txt.isupper() and len(txt) > 3
    row[0].font = Font(name=ARIAL, size=10, bold=b)
    row[1].font = Font(name=ARIAL, size=10, bold=b)
ws2['A1'].font = Font(name=ARIAL, size=12, bold=True, color='1F3864')

wb.save(SAIDA)
print(SAIDA)
print(f'{len(linhas)} linhas (sem duplicata)')
