import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diasUteisEntre, decidir, lerPendenteDesde, lerUltimoAviso, remontarObs, linhaAlerta } from './senha-pendente-calc.ts'

const DIA = 24 * 60 * 60 * 1000
const seg = Date.parse('2026-09-14T13:00:00Z') // segunda 10h BRT

test('diasUteisEntre pula sábado e domingo (fuso BRT)', () => {
  assert.equal(diasUteisEntre(seg, seg + 2 * 60 * 60 * 1000), 0)   // mesmo dia
  assert.equal(diasUteisEntre(seg, seg + 1 * DIA), 1)              // terça
  assert.equal(diasUteisEntre(seg, seg + 4 * DIA), 4)              // sexta
  assert.equal(diasUteisEntre(seg, seg + 5 * DIA), 4)              // sábado não conta
  assert.equal(diasUteisEntre(seg, seg + 6 * DIA), 4)              // domingo não conta
  assert.equal(diasUteisEntre(seg, seg + 7 * DIA), 5)              // segunda seguinte
  assert.equal(diasUteisEntre(seg + DIA, seg), 0)                  // ordem invertida
})

test('só avisa depois de 2 dias úteis; reavisa a cada 7 dias corridos', () => {
  assert.deepEqual(decidir({ pedidoMs: seg, avisoMs: null }, seg + 1 * DIA), { acao: 'nada', diasUteis: 1 })
  assert.deepEqual(decidir({ pedidoMs: seg, avisoMs: null }, seg + 2 * DIA), { acao: 'avisar', diasUteis: 2 })
  // avisado hoje → silêncio
  assert.equal(decidir({ pedidoMs: seg, avisoMs: seg + 2 * DIA }, seg + 3 * DIA).acao, 'nada')
  assert.equal(decidir({ pedidoMs: seg, avisoMs: seg + 2 * DIA }, seg + 8 * DIA).acao, 'nada')
  assert.equal(decidir({ pedidoMs: seg, avisoMs: seg + 2 * DIA }, seg + 9 * DIA).acao, 'reavisar')
  // pedido de 19/08 (caso real): muitos dias úteis, nunca avisado → avisar
  const d = decidir({ pedidoMs: Date.parse('2026-08-19T18:00:00Z'), avisoMs: null }, Date.parse('2026-09-16T18:00:00Z'))
  assert.equal(d.acao, 'avisar')
  assert.ok(d.diasUteis >= 19 && d.diasUteis <= 21, `diasUteis=${d.diasUteis}`)
})

test('marcadores: grava, lê e limpa sem duplicar', () => {
  const a = remontarObs('[X] nota', { desde: '2026-09-14T13:00:00.000Z' })
  const b = remontarObs(a, { desde: '2026-09-14T13:00:00.000Z', aviso: '2026-09-16T18:00:00.000Z' })
  const c = remontarObs(b, { desde: '2026-09-14T13:00:00.000Z', aviso: '2026-09-23T18:00:00.000Z' })
  assert.equal((c.match(/SENHA_PENDENTE_DESDE/g) ?? []).length, 1)
  assert.equal((c.match(/SENHA_PENDENTE_AVISO/g) ?? []).length, 1)
  assert.equal(lerPendenteDesde(c), Date.parse('2026-09-14T13:00:00.000Z'))
  assert.equal(lerUltimoAviso(c), Date.parse('2026-09-23T18:00:00.000Z'))
  assert.equal(remontarObs(c, { limpar: true }), '[X] nota')
  assert.equal(lerPendenteDesde('[X] nota'), null)
})

test('linha do digest esconde telefone-marcador dos importados', () => {
  assert.match(linhaAlerta({ loja: 'Cell Store', telefone: '5551999999999', cnpj: '07805356000141', rid: '6178', diasUteis: 3, pedidoBrt: '19/08 12:11' }), /\(5551999999999\)/)
  assert.doesNotMatch(linhaAlerta({ loja: 'X', telefone: '00012345678000199', cnpj: null, rid: '1', diasUteis: 3, pedidoBrt: '19/08' }), /\(000/)
})
