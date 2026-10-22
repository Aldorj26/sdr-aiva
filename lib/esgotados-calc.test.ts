import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linhaEsgotados } from './esgotados-calc.ts'

test('linha do bolsão: números na ordem total · oferta · descartados hoje; null omite', () => {
  assert.equal(linhaEsgotados({ total: 1450, comOferta: 100, descartadosHoje: 222 }), '♻️ *Esgotaram a régua: 1450* (oferta enviada 100 · descartados hoje 222)')
  assert.equal(linhaEsgotados(null), null)
})
