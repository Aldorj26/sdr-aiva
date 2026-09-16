import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidir, lerMarcadores, remontarObs, miolo, MAX_TOQUES } from './biometria-calc.ts'

const DIA = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-09-16T16:00:00Z')
const URL = 'https://cadastro.io/237b6015e0b99aad0ace591e43a0f0ca'

test('miolos: uma linha, com o link, tamanho ok', () => {
  for (let n = 1; n <= MAX_TOQUES; n++) { const m = miolo(n, URL); assert.doesNotMatch(m, /\n/); assert.ok(m.includes(URL)); assert.ok(m.length < 400) }
})

test('primeira vez: envia na hora, mesmo com conversa viva', () => {
  assert.deepEqual(decidir(lerMarcadores(null, T0), true, T0), { acao: 'enviar', toque: 1 })
})

test('reforços em D+2 e D+5; conversa viva segura o reforço; esgota depois do 3º', () => {
  const o1 = remontarObs(null, { inicio: true, link: URL, toque: 1 }, new Date(T0))
  assert.equal(decidir(lerMarcadores(o1, T0 + 1 * DIA), false, T0 + 1 * DIA).acao, 'nada')
  assert.deepEqual(decidir(lerMarcadores(o1, T0 + 2 * DIA), true, T0 + 2 * DIA), { acao: 'nada', motivo: 'conversa_recente' })
  assert.deepEqual(decidir(lerMarcadores(o1, T0 + 2 * DIA), false, T0 + 2 * DIA), { acao: 'enviar', toque: 2 })
  const o2 = remontarObs(o1, { toque: 2 }, new Date(T0 + 2 * DIA))
  assert.equal(decidir(lerMarcadores(o2, T0 + 4 * DIA), false, T0 + 4 * DIA).acao, 'nada')
  assert.deepEqual(decidir(lerMarcadores(o2, T0 + 5 * DIA), false, T0 + 5 * DIA), { acao: 'enviar', toque: 3 })
  const o3 = remontarObs(o2, { toque: 3 }, new Date(T0 + 5 * DIA))
  assert.deepEqual(decidir(lerMarcadores(o3, T0 + 6 * DIA), false, T0 + 6 * DIA), { acao: 'esgotou' })
  const o4 = remontarObs(o3, { esgotado: true, esgotadoAvisado: true })
  assert.equal(decidir(lerMarcadores(o4, T0 + 9 * DIA), false, T0 + 9 * DIA).acao, 'nada')
})

test('nunca dois toques no mesmo dia; optout e pausa bloqueiam', () => {
  const o = remontarObs(`[BIOMETRIA_INICIO:${new Date(T0 - 10 * DIA).toISOString()}]`, { toque: 1 }, new Date(T0 - 3600_000))
  assert.deepEqual(decidir(lerMarcadores(o, T0), false, T0), { acao: 'nada', motivo: 'toque_hoje' })
  assert.deepEqual(decidir(lerMarcadores(`${o} [BIOMETRIA_OPTOUT]`, T0 + DIA), false, T0 + DIA), { acao: 'nada', motivo: 'optout' })
  assert.deepEqual(decidir(lerMarcadores(`${o} [PAUSA_ATE:${new Date(T0 + 30 * DIA).toISOString()}]`, T0 + DIA), false, T0 + DIA), { acao: 'nada', motivo: 'pausa' })
})

test('remontarObs guarda o link sem duplicar e o troca quando muda', () => {
  const a = remontarObs('[X]', { inicio: true, link: URL, toque: 1 }, new Date(T0))
  const b = remontarObs(a, { link: 'https://cadastro.io/novo', toque: 2 }, new Date(T0 + 2 * DIA))
  assert.equal((b.match(/BIOMETRIA_INICIO/g) ?? []).length, 1)
  assert.equal((b.match(/\[BIOMETRIA_LINK:/g) ?? []).length, 1)
  assert.equal(lerMarcadores(b).link, 'https://cadastro.io/novo')
  assert.equal(lerMarcadores(b).toques, 2)
})
