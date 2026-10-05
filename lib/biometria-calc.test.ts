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

// ── Biometria NEGADA pela AIVA (05/10/2026) ──────────────────────────────────
import { decidirNegada, mioloNegada, MAX_TOQUES_NEGADA } from './biometria-calc.ts'

test('negada: textos em uma linha, com o link, dizendo que NAO foi aprovado', () => {
  for (const n of [1, 2]) {
    const m = mioloNegada(n, ' https://cadastro.io/abc ')
    assert.doesNotMatch(m, /\n/)
    assert.match(m, /https:\/\/cadastro\.io\/abc$/)
    assert.match(m, /n.o foi aprovado/)
    assert.ok(m.length < 330, String(m.length))
  }
  assert.equal(MAX_TOQUES_NEGADA, 2)
})

test('negada: avisa na hora, reforca em 2 dias e para; desligada nao envia nada', () => {
  const T = Date.parse('2026-10-06T12:00:00Z'); const DIA = 86400000
  const iso = (ms: number) => new Date(ms).toISOString()
  const ler = (o: string) => lerMarcadores(o, T)
  // mesmo com conversa viva e mesmo ja "esgotada" nos lembretes genericos, o 1o aviso sai
  assert.deepEqual(decidirNegada(ler('[BIOMETRIA:3:2026-10-05T12:00:00Z] [BIOMETRIA_ESGOTADO] [BIOMETRIA_ESGOTADO_AVISADO]'), true, T, true), { acao: 'enviar', toque: 1 })
  assert.deepEqual(decidirNegada(ler(`[BIO_NEGADA:1:${iso(T - DIA)}]`), false, T, true), { acao: 'nada', motivo: 'negada_aguardando_reforco' })
  assert.deepEqual(decidirNegada(ler(`[BIO_NEGADA:1:${iso(T - 2 * DIA)}]`), true, T, true), { acao: 'nada', motivo: 'conversa_recente' })
  assert.deepEqual(decidirNegada(ler(`[BIO_NEGADA:1:${iso(T - 2 * DIA)}]`), false, T, true), { acao: 'enviar', toque: 2 })
  assert.deepEqual(decidirNegada(ler(`[BIO_NEGADA:2:${iso(T - 9 * DIA)}]`), false, T, true), { acao: 'nada', motivo: 'negada_avisada' })
  assert.deepEqual(decidirNegada(ler('[BIOMETRIA_OPTOUT]'), false, T, true), { acao: 'nada', motivo: 'optout' })
  assert.deepEqual(decidirNegada(ler(''), false, T, false), { acao: 'nada', motivo: 'negada_envio_desligado' })
})

test('negada: marcador proprio, sem mexer nos toques genericos', () => {
  const o = remontarObs('[BIOMETRIA:3:2026-10-05T12:00:00Z] [BIOMETRIA_ESGOTADO]', { link: 'https://cadastro.io/x', negada: 1 }, new Date('2026-10-06T12:00:00Z'))
  assert.match(o, /\[BIO_NEGADA:1:2026-10-06T12:00:00.000Z\]/)
  assert.match(o, /\[BIOMETRIA:3:2026-10-05T12:00:00Z\]/)
  const m = lerMarcadores(o, Date.parse('2026-10-06T13:00:00Z'))
  assert.equal(m.negadaToques, 1); assert.equal(m.toques, 3)
})
