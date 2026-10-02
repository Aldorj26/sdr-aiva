import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumir, blocoPrompt, intervaloDias, SEMANAS_JANELA } from './desempenho-loja-calc.ts'

const ULT = '2026-09-21'
const MES = '2026-10'
const s = (semana: string, aprovados: number, vendas: number, valor = vendas * 1300) => ({ semana, aprovados, vendas, valor_vendas: valor })
const m = (mes: string, consultas: number, aprovados: number, vendas: number) => ({ mes, consultas, aprovados, vendas, valor_vendas: vendas * 1300 })

test('semana sem linha vira zero e a janela tem sempre o mesmo tamanho', () => {
  const r = resumir([s('2026-09-07', 3, 2)], [], ULT, MES)
  assert.equal(r.semanas.length, SEMANAS_JANELA)
  assert.deepEqual(r.semanas.map((x) => x.semana), ['2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31'])
  assert.equal(r.semanas[0].vendas, 0)
  assert.equal(r.semanas[2].vendas, 2)
})

test('parada ha 2 semanas nao parece vendendo so porque a ultima linha dela tem venda', () => {
  const r = resumir([s('2026-09-07', 5, 4)], [m('2026-09', 40, 5, 4)], ULT, MES)
  assert.equal(r.segmento, 'parou')
  assert.equal(intervaloDias(r.segmento), 14)
})

test('varios CNPJs somam por semana', () => {
  const r = resumir([s(ULT, 2, 1), s(ULT, 3, 2), s('2026-09-14', 1, 1)], [], ULT, MES)
  assert.equal(r.semanas[0].vendas, 3)
  assert.equal(r.vendas2, 4)
  assert.equal(r.segmento, 'vende_firme')
  assert.equal(intervaloDias(r.segmento), 7)
})

test('segmentos', () => {
  assert.equal(resumir([s(ULT, 4, 1)], [], ULT, MES).segmento, 'vende_pouco')
  assert.equal(resumir([s(ULT, 6, 0)], [], ULT, MES).segmento, 'aprova_nao_vende')
  assert.equal(resumir([], [], ULT, MES).segmento, 'sem_uso')
  assert.equal(intervaloDias('sem_uso'), 14)
  assert.equal(intervaloDias('aprova_nao_vende'), 7)
})

test('venda no mes corrente (semana ainda aberta) tira do parado', () => {
  const r = resumir([], [m(MES, 10, 2, 1)], ULT, MES)
  assert.equal(r.segmento, 'vende_pouco')
})

test('mes anterior atravessa o ano', () => {
  const r = resumir([], [m('2026-12', 5, 1, 1)], '2026-12-28', '2027-01')
  assert.equal(r.mesAnterior?.mes, '2026-12')
})

test('bloco do prompt: numeros, datas e as travas', () => {
  const r = resumir([s(ULT, 6, 2, 2600)], [m('2026-09', 120, 30, 9), m(MES, 8, 2, 0)], ULT, MES)
  const b = blocoPrompt(r)
  assert.match(b, /semana de 21\/09: 6 aprovados · 2 vendas/)
  assert.match(b, /120 consultas · 30 aprovados · 9 vendas \(30% dos aprovados\)/)
  assert.match(b, /ACREDITE nele/)
  assert.match(b, /Nunca invente/)
})
