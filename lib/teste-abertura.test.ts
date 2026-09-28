import { test } from 'node:test'
import assert from 'node:assert/strict'
import { varianteAbertura, ehPrimeiraResposta } from './teste-abertura.ts'

test('variante é fixa por lead e divide meio a meio', () => {
  assert.equal(varianteAbertura('0a1b2c3d-0000-0000-0000-000000000000'), 'A')
  assert.equal(varianteAbertura('0a1b2c3d-0000-0000-0000-000000000001'), 'B')
  assert.equal(varianteAbertura('x-f'), 'B')           // f = 15, ímpar
  assert.equal(varianteAbertura('x-e'), 'A')
  const id = '9f1c2d3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f'
  assert.equal(varianteAbertura(id), varianteAbertura(id))
  // 1000 ids sequenciais: ~metade pra cada lado
  let b = 0
  for (let i = 0; i < 1000; i++) if (varianteAbertura(`id-${i.toString(16).padStart(8, '0')}`) === 'B') b++
  assert.ok(b > 400 && b < 600, `B = ${b}`)
})

const base = { status: 'INICIO', dados: {}, historico: [{ direcao: 'out', template_hsm: 'aiva_campanha' }, { direcao: 'in', template_hsm: null }], mensagemEhAutomatica: false }

test('1ª resposta: só o template D+0 saiu antes → vale o teste', () => {
  assert.equal(ehPrimeiraResposta(base), true)
  assert.equal(ehPrimeiraResposta({ ...base, status: 'INTERESSADO' }), true)
})

test('não é 1ª resposta: VictorIA já falou, nome já coletado, robô ou fora da Fase 1', () => {
  assert.equal(ehPrimeiraResposta({ ...base, historico: [...base.historico, { direcao: 'out', template_hsm: null }] }), false)
  assert.equal(ehPrimeiraResposta({ ...base, dados: { nome_socio: 'Ana' } }), false)
  assert.equal(ehPrimeiraResposta({ ...base, mensagemEhAutomatica: true }), false)
  assert.equal(ehPrimeiraResposta({ ...base, status: 'EM_ANALISE_AIVA' }), false)
  assert.equal(ehPrimeiraResposta({ ...base, status: 'AGUARDANDO' }), false)
})
