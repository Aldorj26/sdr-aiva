import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularEspelho, etapaDesejada, type Entrada, type OnbApi } from './espelho-portal-calc.ts'

const onb = (p: Partial<OnbApi> & { cnpj: string }): OnbApi => ({ stage: 'dados_varejo', pre_cadastro_status: 'approved', retailer_id: null, legal_name: 'LOJA X', ...p })
const base = (p: Partial<Entrada> = {}): Entrada => ({
  onboardings: [], loginEnviado: new Set(), vendeu: new Set(), registros: [], leads: [], stageAtual: new Map(), ...p,
})
const lead = (id: string, opp: number | null, status = 'CADASTRO_RECEBIDO', observacoes: string | null = null) =>
  ({ id, nome: `Lead ${id}`, status, evotalks_opportunity_id: opp, observacoes })

test('etapaDesejada: escada do portal', () => {
  const l = new Set(['5']), v = new Set(['9'])
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'pre_cadastro' }), l, v), null)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'not_approved' }), l, v), null)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'dados_varejo' }), l, v), 50)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'biometria' }), l, v), 50)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', retailer_id: 7 }), l, v), 70)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', retailer_id: '5' }), l, v), 71)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', retailer_id: '9' }), l, v), 51)
})

test('avança 49 → 50 quando o portal está em dados_varejo', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '46.618.959/0002-77' })],
    registros: [{ id: 1, cnpj: '46618959000277', lead_id: 'a', status: 'informada' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 49]]),
  }))
  assert.equal(r.movimentos.length, 1)
  assert.deepEqual({ opp: r.movimentos[0].opp, de: r.movimentos[0].de, para: r.movimentos[0].para, via: r.movimentos[0].via }, { opp: 100, de: 49, para: 50, via: [] })
  assert.deepEqual(r.registrosEnviados, [1])
})

test('nunca regride e fica em silêncio quando já está igual ou além', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 70]]),
  }))
  assert.equal(r.movimentos.length, 0)
  assert.equal(r.pulados.length, 0)
  assert.equal(r.registrosEnviados.length, 0)
})

test('destino além de Treinar passa por 70 (HSM do treinamento) mas não por 50', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '5' })],
    loginEnviado: new Set(['5']),
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 49]]),
  }))
  assert.equal(r.movimentos.length, 1)
  assert.deepEqual({ para: r.movimentos[0].para, via: r.movimentos[0].via }, { para: 71, via: [70] })
})

test('já em Treinar indo pra Login não repassa por 70', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '5' })],
    loginEnviado: new Set(['5']),
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 70]]),
  }))
  assert.deepEqual({ para: r.movimentos[0].para, via: r.movimentos[0].via }, { para: 71, via: [] })
})

test('Sem Resposta (53) pode avançar; Bot/93/94 nunca; status terminal nunca', () => {
  const o = [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '5' })]
  const reg = (l: string) => ({ id: l, cnpj: '11111111000191', lead_id: l, status: 'pre_cadastro_enviado' })
  const r = calcularEspelho(base({
    onboardings: o,
    registros: [reg('semresp'), reg('bot'), reg('menos1'), reg('irreg'), reg('optout')],
    leads: [lead('semresp', 1), lead('bot', 2), lead('menos1', 3), lead('irreg', 4), lead('optout', 5, 'OPT_OUT')],
    stageAtual: new Map([[1, 53], [2, 69], [3, 93], [4, 94], [5, 49]]),
  }))
  assert.deepEqual(r.movimentos.map((m) => m.lead_id), ['semresp'])
  assert.deepEqual(r.pulados.map((p) => p.lead_id).sort(), ['bot', 'irreg', 'menos1', 'optout'])
})

test('lead sem opp ou com opp fora do funil é pulado com motivo', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: null }, { id: 2, cnpj: '11111111000191', lead_id: 'b', status: null }],
    leads: [lead('a', null), lead('b', 999)],
    stageAtual: new Map(),
  }))
  assert.equal(r.movimentos.length, 0)
  assert.equal(r.pulados.length, 2)
  assert.deepEqual(r.registrosEnviados, [1, 2])
})

test('lead com matriz e filial: vale o CNPJ mais avançado', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'dados_varejo' }), onb({ cnpj: '11111111000272', stage: 'cadastro_finalizado', retailer_id: '8' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }, { id: 2, cnpj: '11111111000272', lead_id: 'a', status: 'informada' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 50]]),
  }))
  assert.equal(r.movimentos[0].para, 70)
  assert.deepEqual(r.registrosEnviados, [2])
})

test('reprovado: só quando nenhum CNPJ do lead seguiu, uma vez, e não em status terminal', () => {
  const o = [onb({ cnpj: '11111111000191', stage: 'not_approved', pre_cadastro_status: 'not_approved' })]
  const reg = (l: string) => ({ id: l, cnpj: '11111111000191', lead_id: l, status: 'pre_cadastro_enviado' })
  const r = calcularEspelho(base({
    onboardings: [...o, onb({ cnpj: '22222222000191', stage: 'dados_varejo' })],
    registros: [reg('novo'), reg('jamarcado'), reg('terminal'), reg('temoutro'), { id: 'x', cnpj: '22222222000191', lead_id: 'temoutro', status: 'pre_cadastro_enviado' }],
    leads: [lead('novo', 1), lead('jamarcado', 2, 'EM_ANALISE_AIVA', '[PORTAL_REPROVADO:2026-09-01T00:00:00Z]'), lead('terminal', 3, 'NAO_QUALIFICADO'), lead('temoutro', 4)],
    stageAtual: new Map([[1, 50], [2, 50], [3, 50], [4, 49]]),
  }))
  assert.deepEqual(r.reprovados.map((x) => x.lead_id), ['novo'])
  assert.equal(r.reprovados[0].cnpj, '11111111000191')
  assert.deepEqual(r.movimentos.map((m) => m.lead_id), ['temoutro'])
})
