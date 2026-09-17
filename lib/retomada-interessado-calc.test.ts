import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidir, lerMarcadores, remontarObs, miolo,
  MIOLOS_COM_DADOS, MIOLOS_SEM_DADOS, SILENCIO_DIAS, DIAS_ENTRE_TOQUES, MAX_TOQUES,
} from './retomada-interessado-calc.ts'

const DIA = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-09-18T14:00:00Z')   // 11h BRT
const iso = (ms: number) => new Date(ms).toISOString()

test('miolos: 2 toques de cada tipo, uma linha, sem link', () => {
  for (const lista of [MIOLOS_COM_DADOS, MIOLOS_SEM_DADOS]) {
    assert.equal(lista.length, MAX_TOQUES)
    for (const m of lista) { assert.doesNotMatch(m, /\n/); assert.doesNotMatch(m, /https?:\/\//); assert.ok(m.length < 320) }
  }
})

test('conversa viva nao e tocada', () => {
  const m = lerMarcadores(null, T0)
  assert.deepEqual(decidir(m, 0, T0), { acao: 'nada', motivo: 'conversa_viva' })
  assert.deepEqual(decidir(m, SILENCIO_DIAS - 1, T0), { acao: 'nada', motivo: 'conversa_viva' })
  assert.deepEqual(decidir(m, SILENCIO_DIAS, T0), { acao: 'enviar', toque: 1 })
})

test('dois toques e acabou — nunca vira cutucada eterna', () => {
  const o1 = remontarObs(null, { toque: 1 }, new Date(T0))
  // logo depois do toque 1 nao manda de novo
  assert.deepEqual(decidir(lerMarcadores(o1, T0 + DIA), 30, T0 + DIA), { acao: 'nada', motivo: `aguardando D+${DIAS_ENTRE_TOQUES}` })
  const t2 = T0 + DIAS_ENTRE_TOQUES * DIA
  assert.deepEqual(decidir(lerMarcadores(o1, t2), 30, t2), { acao: 'enviar', toque: 2 })
  const o2 = remontarObs(o1, { toque: 2 }, new Date(t2))
  const t3 = t2 + 30 * DIA
  assert.deepEqual(decidir(lerMarcadores(o2, t3), 40, t3), { acao: 'encerrar' })
  const o3 = remontarObs(o2, { encerrar: true })
  assert.deepEqual(decidir(lerMarcadores(o3, t3), 40, t3), { acao: 'nada', motivo: 'encerrado' })
})

test('se o lojista VOLTAR a falar, a regua para de tocar nele', () => {
  const o1 = remontarObs(null, { toque: 1 }, new Date(T0))
  const t2 = T0 + DIAS_ENTRE_TOQUES * DIA
  // respondeu ontem → silencio = 1 dia
  assert.deepEqual(decidir(lerMarcadores(o1, t2), 1, t2), { acao: 'nada', motivo: 'conversa_viva' })
})

test('pausa e optout bloqueiam', () => {
  const pausa = `[PAUSA_ATE:${iso(T0 + 30 * DIA)}]`
  assert.deepEqual(decidir(lerMarcadores(pausa, T0), 30, T0), { acao: 'nada', motivo: 'pausa' })
  assert.deepEqual(decidir(lerMarcadores('[CONSULTORIA_OPTOUT]', T0), 30, T0), { acao: 'nada', motivo: 'optout' })
})

test('quem ja deu dados ouve "retomo de onde paramos"; quem nao deu, a abordagem', () => {
  assert.match(miolo(1, true), /de onde paramos/)
  assert.match(miolo(2, true), /falta pouco/)
  assert.doesNotMatch(miolo(1, false), /de onde paramos/)
  assert.match(miolo(2, false), /não te incomodo mais/)
})

test('remontarObs nao duplica marcador', () => {
  const a = remontarObs('[X] nota', { toque: 1 }, new Date(T0))
  const b = remontarObs(a, { toque: 2 }, new Date(T0 + DIA))
  assert.equal((b.match(/\[RETOM_INT:/g) ?? []).length, 1)
  assert.match(b, /\[RETOM_INT:2:/)
  assert.match(b, /^\[X\] nota/)
})
