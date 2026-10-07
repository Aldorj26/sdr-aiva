# -*- coding: utf-8 -*-
"""Conferência das lojas (Aldo 06/10/2026) — lê o JSON do .mjs irmão e monta a planilha. SÓ LEITURA."""
import json, re, io
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

D = json.load(io.open('scripts/out-conferencia-lojas-2026-10-06.json', encoding='utf-8'))
so = lambda c: re.sub(r'\D', '', str(c or ''))

POS = ['PRE_APROVACAO', 'CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']
ETAPA_EVO = {66: 'Início', 47: 'Interessado', 54: 'Pré-aprovação', 49: 'Cadastro Recebido', 50: 'Em Análise AIVA', 70: 'Treinar',
             71: 'Login', 51: 'Vendendo', 53: 'Sem Resposta', 69: 'Bot', 93: 'Menos de 1 ano', 94: 'CNPJ Irregular', 95: 'Descartada AIVA'}
EVO_POS = {54, 49, 50, 70, 71, 51, 95}
FINAL_NOSSO = {'TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO'}

opp_stage = {o['id']: o.get('fkStage') for o in D['f15']}
reg_por_lead = defaultdict(list)
for r in D['registros']:
    if r.get('lead_id'): reg_por_lead[r['lead_id']].append(r)

def obs_val(obs, chave):
    m = re.search(chave + r'=([^|\]]+)', obs or '')
    return m.group(1) if m else None

# ── universo: leads que chegaram na pré-aprovação ─────────────────────────────
lojas = {}   # cnpj -> dict
def loja(cnpj):
    if cnpj not in lojas:
        lojas[cnpj] = {'cnpj': cnpj, 'leads': [], 'fontes': set()}
    return lojas[cnpj]

for l in D['leads']:
    obs = l.get('observacoes') or ''
    st = l['status']
    stage = opp_stage.get(int(l['evotalks_opportunity_id'])) if str(l.get('evotalks_opportunity_id') or '').isdigit() else None
    regs = reg_por_lead.get(l['id'], [])
    entrou = st in POS or regs or (stage in EVO_POS) or '[CAD_ALERTADO]' in obs or '[PORTAL_REPROVADO' in obs
    if not entrou: continue
    cnpjs = {so(r['cnpj']) for r in regs}
    cm = so(obs_val(obs, 'cnpj_matriz'))
    if len(cm) == 14: cnpjs.add(cm)
    for c in re.findall(r'\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}', obs_val(obs, 'cnpjs_adicionais') or ''):
        if len(so(c)) == 14: cnpjs.add(so(c))
    entrada = min([r['criado_em'] for r in regs] or [l.get('status_alterado_em') or l['criado_em']])
    info = {'lead_id': l['id'], 'nome': l['nome'], 'telefone': l['telefone'], 'status': st,
            'etapa_evo': ETAPA_EVO.get(stage, str(stage) if stage else '—'), 'stage': stage,
            'importado': '[IMPORTADO_PORTAL:' in obs, 'entrada': entrada[:10]}
    if not cnpjs:
        lojas['SEM-CNPJ-' + l['id'][:8]] = {'cnpj': '', 'leads': [info], 'fontes': {'funil'}}
        continue
    for c in cnpjs:
        x = loja(c); x['leads'].append(info); x['fontes'].add('funil')

# funil 11 (Lojas Fechadas MRR) — controle do Nei
f11 = {}
for o in D['f11']:
    d = o.get('description') or ''
    rid = re.search(r'UME_RID:\s*(\d+)', d, re.I)
    cn = re.search(r'CNPJ:\s*([\d./-]{14,18})', d, re.I)
    c = so(cn.group(1)) if cn else ''
    reg = {'id': o['id'], 'title': o.get('title'), 'aiva': 69 in (o.get('tags') or []), 'rid': rid.group(1) if rid else None, 'tel': so(o.get('mainphone'))}
    if len(c) == 14: f11[c] = reg
    elif reg['aiva']: f11['F11-%d' % o['id']] = reg

# AIVA
onb = {so(o['cnpj']): o for o in D['onbs'] if len(so(o.get('cnpj'))) == 14}
perf = defaultdict(list)
for p in D['perf']: perf[so(p['cnpj'])].append(p)
rid_perf = {}
for c, ps in perf.items():
    for p in ps: rid_perf[str(p['retailer_id'])] = c
com = defaultdict(list)
for c in D['comissoes']: com[so(c['cnpj'])].append(c)
com_rid = defaultdict(list)
for c in D['comissoes']:
    if c.get('retailer_id') is not None: com_rid[str(c['retailer_id'])].append(c)
base = {so(b['cnpj']): b['nome'] for b in D['base']}
bloq = {str(b['retailer_id']): b['bloqueado_desde'] for b in D['bloqueios'] if b.get('bloqueado_por_limite')}
# telefone (DDD + últimos 8) → lojas da Track no portal: pega quem fez o cadastro com OUTRO CNPJ (caso Gfourr)
def chave_tel(t):
    d = so(t)
    if d.startswith('55') and len(d) >= 12: d = d[2:]
    return d[:2] + d[-8:] if len(d) >= 10 else None
track_por_tel = defaultdict(set)
for c, ps in perf.items():
    for p in ps:
        k = chave_tel(p.get('phone_number'))
        if k: track_por_tel[k].add(c)
for c, o in onb.items():
    k = chave_tel(o.get('phone_number'))
    if k and o.get('retailer_id'): track_por_tel[k].add(c)
meses_com = sorted({m['mes'] for m in D['metas']})

# funil 11 com CNPJ que não está no nosso universo vira linha também (controle do Nei)
for c, reg in f11.items():
    if not reg['aiva']: continue
    if c.startswith('F11-'):
        lojas[c] = {'cnpj': '', 'leads': [], 'fontes': {'funil11'}}
    else:
        loja(c)['fontes'].add('funil11')

linhas = []
for key, x in lojas.items():
    c = x['cnpj']
    lead = x['leads'][0] if x['leads'] else {}
    o = onb.get(c)
    ps = perf.get(c, [])
    rid = str(o['retailer_id']) if o and o.get('retailer_id') else (str(ps[0]['retailer_id']) if ps else None)
    cs = com.get(c, []) or (com_rid.get(rid, []) if rid else [])
    vend_mes = defaultdict(float); qtd_mes = defaultdict(int); cons = 0
    for p in ps:
        m = p['mes'][:7]; vend_mes[m] += float(p.get('valor_vendas') or 0); qtd_mes[m] += int(p.get('n_vendas') or 0); cons += int(p.get('n_consultas') or 0)
    com_mes = defaultdict(float)
    for r in cs: com_mes[r['mes']] += float(r.get('comissao') or 0)
    vendas_tot = sum(qtd_mes.values()); valor_tot = sum(vend_mes.values()); comissao_tot = sum(com_mes.values())
    sem_com_meses = [m for m in meses_com if qtd_mes.get(m, 0) > 0 and com_mes.get(m, 0) <= 0]
    vendas_sem_relatorio = sum(v for m, v in vend_mes.items() if m not in meses_com)
    reg11 = f11.get(c) if c else (f11.get(key) if key.startswith('F11-') else None)
    status_perf = sorted(ps, key=lambda p: p['mes'])[-1]['status'] if ps else None
    na_base = base.get(c)
    concluida_nosso = (lead.get('status') in FINAL_NOSSO) or (lead.get('stage') in {70, 71, 51}) or bool(reg11 and reg11['aiva'])

    outros = sorted(track_por_tel.get(chave_tel(lead.get('telefone')), set()) - {c}) if lead.get('telefone') else []
    if not c and concluida_nosso:
        grupo = '7. Concluída por nós SEM CNPJ no cadastro' if not outros else '8. Na Track com OUTRO CNPJ (pelo telefone)'
    elif not c:
        grupo = '9. Sem CNPJ no nosso cadastro (não concluída)'
    elif comissao_tot > 0 and not sem_com_meses:
        grupo = '1. OK — comissionada'
    elif sem_com_meses:
        grupo = '2. Vendeu e falta comissão'
    elif ps or (o and o.get('retailer_id')):
        grupo = '3. Loja da Track — vendas só depois de ago (relatório ainda não veio)' if vendas_sem_relatorio > 0 else '4. Loja da Track sem venda'
    elif (concluida_nosso or na_base) and outros:
        grupo = '8. Na Track com OUTRO CNPJ (pelo telefone)'
    elif concluida_nosso or na_base:
        grupo = '5. SUSPEITA — concluída por nós e fora da Track'
    else:
        grupo = '6. Travada antes de virar loja'

    if grupo.startswith('6'):
        if not o: motivo = 'pré-cadastro não chegou à AIVA'
        elif o['stage'] == 'not_approved': motivo = 'reprovada pela AIVA'
        elif o['stage'] == 'dados_varejo': motivo = 'formulário do varejo pendente'
        elif o['stage'] == 'biometria': motivo = 'biometria ' + str(o.get('biometry_status') or 'pendente')
        else: motivo = o['stage']
    elif grupo.startswith('5'):
        sinais = []
        if lead.get('status') in FINAL_NOSSO: sinais.append('status ' + lead['status'])
        if lead.get('stage') in {70, 71, 51}: sinais.append('card em ' + lead['etapa_evo'])
        if reg11 and reg11['aiva']: sinais.append('no funil 11 (AIVA)')
        if na_base: sinais.append('CNPJ na base de clientes AIVA: ' + na_base)
        if o: sinais.append('onboarding em ' + o['stage'] + ' sem RID')
        else: sinais.append('sem cadastro no onboarding da Track')
        motivo = '; '.join(sinais)
    else:
        motivo = ''

    linhas.append({
        'grupo': grupo, 'motivo': motivo, 'cnpj': c, 'loja': lead.get('nome') or (reg11 or {}).get('title') or (o or {}).get('legal_name') or '',
        'telefone': lead.get('telefone') or (reg11 or {}).get('tel') or '', 'status_nosso': lead.get('status', ''), 'etapa_evo': lead.get('etapa_evo', ''),
        'entrada': lead.get('entrada', ''), 'importado': 'sim' if lead.get('importado') else '', 'funil11': ('sim' + (' (AIVA)' if reg11['aiva'] else '')) if reg11 else '',
        'onb_stage': (o or {}).get('stage', '') or '', 'biometria': (o or {}).get('biometry_status', '') or '', 'rid': rid or '',
        'status_portal': status_perf or '', 'bloqueada': 'sim' if rid and rid in bloq else '', 'consultas': cons, 'vendas': vendas_tot, 'valor_vendas': round(valor_tot, 2),
        'vendas_jul': round(vend_mes.get('2026-07', 0), 2), 'com_jul': round(com_mes.get('2026-07', 0), 2), 'vendas_ago': round(vend_mes.get('2026-08', 0), 2), 'com_ago': round(com_mes.get('2026-08', 0), 2),
        'vendas_set_out': round(vend_mes.get('2026-09', 0) + vend_mes.get('2026-10', 0), 2), 'comissao_total': round(comissao_tot, 2),
        'meses_sem_comissao': ', '.join(sem_com_meses), 'cnpj_track_pelo_tel': ', '.join(outros), 'base_aiva': na_base or '', 'n_leads': len(x['leads']),
    })

# lojas da Track no portal que não estão no nosso universo
nossos = {l['cnpj'] for l in linhas if l['cnpj']}
fora = []
for c, ps in perf.items():
    if c in nossos: continue
    vm = defaultdict(float)
    for p in ps: vm[p['mes'][:7]] += float(p.get('valor_vendas') or 0)
    cm = defaultdict(float)
    for r in com.get(c, []): cm[r['mes']] += float(r.get('comissao') or 0)
    fora.append({'cnpj': c, 'loja': ps[0].get('retailer_name') or '', 'rid': str(ps[0]['retailer_id']), 'cadastro': ps[0].get('registered_at') or '',
                 'status_portal': sorted(ps, key=lambda p: p['mes'])[-1]['status'], 'valor_vendas': round(sum(vm.values()), 2),
                 'comissao_total': round(sum(cm.values()), 2), 'na_onboarding': 'sim' if c in onb else '', 'funil11': 'sim' if c in f11 else ''})

# comparação pelo NOME pros casos sem CNPJ / suspeitos (lojas antigas cadastradas sem CNPJ no nosso lado)
import unicodedata
STOP = {'celular', 'celulares', 'cell', 'cel', 'loja', 'lojas', 'ltda', 'me', 'eireli', 'assistencia', 'tecnica', 'e', 'de', 'da', 'do',
        'imports', 'import', 'store', 'acessorios', 'eletronicos', 'eletronica', 'comercio', 'servicos', 'smartphones', 'smartphone', 'tecnologia', 'tech', 'matriz', 'filial', 'principal', 'grupo'}
def toks(t):
    t = unicodedata.normalize('NFKD', str(t or '').lower()).encode('ascii', 'ignore').decode()
    return {w for w in re.split(r'[^a-z0-9]+', t) if len(w) >= 3 and w not in STOP and not w.isdigit()}
alvos = [(c, ps[0].get('retailer_name') or '', 'Track portal RID ' + str(ps[0]['retailer_id'])) for c, ps in perf.items()]
alvos += [(c, n, 'base AIVA') for c, n in base.items()]
idx = defaultdict(list)
for c, n, fonte in alvos:
    for w in toks(n): idx[w].append((c, n, fonte))
for l in linhas:
    if not (l['grupo'][0] in '57'): continue
    tk = toks(l['loja'])
    if not tk: continue
    cand = None
    for w in tk:
        for c, n, fonte in idx.get(w, []):
            if tk <= toks(n) and c != l['cnpj']:
                cand = cand or []
                if len(cand) < 3: cand.append(f'{fonte}: {n} ({c})')
    l['match_nome'] = ' | '.join(cand) if cand else ''

json.dump({'linhas': linhas, 'fora': fora, 'meses_com': meses_com}, io.open('scripts/out-conferencia-lojas-2026-10-06-calc.json', 'w', encoding='utf-8'), ensure_ascii=False)
cont = defaultdict(int)
for l in linhas: cont[l['grupo']] += 1
for g in sorted(cont): print(g, cont[g])
print('fora do nosso universo (Track, portal):', len(fora))
