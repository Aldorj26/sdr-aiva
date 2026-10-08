import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehDesistencia, marcadoresDesistencia, statusDeVolta, obsDaVolta } from './desistencia.ts'

const agora = new Date('2026-10-08T15:00:00Z')

test('só é desistência com DESCARTADO + motivo lojista_desistiu', () => {
  assert.equal(ehDesistencia('DESCARTADO', 'lojista_desistiu: vão resolver coisas da empresa'), true)
  assert.equal(ehDesistencia('DESCARTADO', 'sem perfil'), false)
  assert.equal(ehDesistencia('AGUARDANDO', 'lojista_desistiu'), false)
  assert.equal(ehDesistencia('DESCARTADO', null), false)
})

test('desistiu e voltou: reabre na etapa em que estava, sem os carimbos', () => {
  const obs = `[CNPJ_RECEITA:cnpj=1] ${marcadoresDesistencia('EM_ANALISE_AIVA', agora).join(' ')}`
  assert.equal(statusDeVolta('DESCARTADO', obs), 'EM_ANALISE_AIVA')
  const volta = obsDaVolta(obs, agora)
  assert.ok(!volta.includes('[DESISTIU'))
  assert.ok(!volta.includes('[DESCARTADO_MANUAL'))
  assert.ok(volta.includes('[CNPJ_RECEITA:cnpj=1]'))
  assert.ok(volta.includes('[VOLTOU_DESISTENCIA:'))
})

test('descarte que não foi desistência não reabre', () => {
  assert.equal(statusDeVolta('DESCARTADO', '[DESCARTADO_MANUAL:2026-10-01T00:00:00Z]'), null)
  assert.equal(statusDeVolta('DESCARTADO', null), null)
  // lead que já voltou e está ativo
  assert.equal(statusDeVolta('INTERESSADO', `${marcadoresDesistencia('INTERESSADO', agora).join(' ')}`), null)
})

test('status terminal não vira status de volta', () => {
  assert.match(marcadoresDesistencia('DESCARTADO', agora)[0], /^\[DESISTIU:INTERESSADO:/)
})
