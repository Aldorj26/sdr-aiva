import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linhaEsgotados, diaUtcAnterior } from './esgotados-calc.ts'

test('linha do bolsão: números na ordem total · oferta · descartados ONTEM (o briefing sai às 5h); null omite', () => {
  assert.equal(linhaEsgotados({ total: 1450, comOferta: 100, descartadosOntem: 222 }), '♻️ *Esgotaram a régua: 1450* (oferta enviada 100 · descartados ontem 222)')
  assert.equal(linhaEsgotados(null), null)
})

test('data de "ontem" para o marcador: dia UTC anterior, em YYYY-MM-DD', () => {
  assert.equal(diaUtcAnterior(Date.parse('2026-10-23T08:00:00Z')), '2026-10-22')
  assert.equal(diaUtcAnterior(Date.parse('2026-11-01T08:00:00Z')), '2026-10-31')
})
