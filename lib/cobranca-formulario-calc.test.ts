import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidir, lerMarcadores, remontarObs, MIOLOS, MAX_TOQUES } from './cobranca-formulario-calc.ts'

const DIA = 24 * 60 * 60 * 1000
const HORA = 60 * 60 * 1000
const T0 = Date.parse('2026-09-16T16:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

test('miolos: 4 toques, uma linha cada, sem link', () => {
  assert.equal(MIOLOS.length, MAX_TOQUES)
  for (const m of MIOLOS) { assert.doesNotMatch(m, /\n/); assert.doesNotMatch(m, /https?:\/\//); assert.ok(m.length < 320) }
})

test('sem marcador: iniciar (carimba D0, não envia)', () => {
  assert.deepEqual(decidir(lerMarcadores(null, T0), false, T0), { acao: 'iniciar' })
})

test('escada D+1 / D+3 / D+7 / D+14 a partir do INICIO', () => {
  const obs0 = `[COBRANCA_FORM_INICIO:${iso(T0)}]`
  // ainda no MESMO dia BRT (T0 = 13h, aqui 19h) → não manda
  assert.equal(decidir(lerMarcadores(obs0, T0 + 6 * HORA), false, T0 + 6 * HORA).acao, 'nada')
  assert.deepEqual(decidir(lerMarcadores(obs0, T0 + 1 * DIA), false, T0 + 1 * DIA), { acao: 'enviar', toque: 1 })
  const obs1 = remontarObs(obs0, { toque: 1 }, new Date(T0 + 1 * DIA))
  assert.equal(decidir(lerMarcadores(obs1, T0 + 2 * DIA), false, T0 + 2 * DIA).acao, 'nada')          // D+3 ainda não
  assert.deepEqual(decidir(lerMarcadores(obs1, T0 + 3 * DIA), false, T0 + 3 * DIA), { acao: 'enviar', toque: 2 })
  const obs2 = remontarObs(obs1, { toque: 2 }, new Date(T0 + 3 * DIA))
  assert.deepEqual(decidir(lerMarcadores(obs2, T0 + 7 * DIA), false, T0 + 7 * DIA), { acao: 'enviar', toque: 3 })
  const obs3 = remontarObs(obs2, { toque: 3 }, new Date(T0 + 7 * DIA))
  assert.deepEqual(decidir(lerMarcadores(obs3, T0 + 14 * DIA), false, T0 + 14 * DIA), { acao: 'enviar', toque: 4 })
  const obs4 = remontarObs(obs3, { toque: 4 }, new Date(T0 + 14 * DIA))
  assert.deepEqual(decidir(lerMarcadores(obs4, T0 + 15 * DIA), false, T0 + 15 * DIA), { acao: 'esgotou' })
  const obs5 = remontarObs(obs4, { esgotado: true, esgotadoAvisado: true })
  assert.equal(decidir(lerMarcadores(obs5, T0 + 20 * DIA), false, T0 + 20 * DIA).acao, 'nada')
})

test('lead atrasado na escada não recebe dois toques no mesmo dia', () => {
  // INICIO há 10 dias, toque 1 enviado hoje de manhã → D+3 já venceu, mas espera 24h
  const obs = remontarObs(`[COBRANCA_FORM_INICIO:${iso(T0 - 10 * DIA)}]`, { toque: 1 }, new Date(T0 - 3600_000))
  assert.deepEqual(decidir(lerMarcadores(obs, T0), false, T0), { acao: 'nada', motivo: 'toque_hoje' })
  assert.deepEqual(decidir(lerMarcadores(obs, T0 + DIA), false, T0 + DIA), { acao: 'enviar', toque: 2 })
})

test('conversa viva (respondeu nas últimas 48h) segura o toque; pausa e optout bloqueiam', () => {
  const obs = `[COBRANCA_FORM_INICIO:${iso(T0)}]`
  assert.deepEqual(decidir(lerMarcadores(obs, T0 + 2 * DIA), true, T0 + 2 * DIA), { acao: 'nada', motivo: 'conversa_recente' })
  assert.deepEqual(decidir(lerMarcadores(`${obs} [PAUSA_ATE:${iso(T0 + 30 * DIA)}]`, T0 + 2 * DIA), false, T0 + 2 * DIA), { acao: 'nada', motivo: 'pausa' })
  assert.deepEqual(decidir(lerMarcadores(`${obs} [COBRANCA_FORM_OPTOUT]`, T0 + 2 * DIA), false, T0 + 2 * DIA), { acao: 'nada', motivo: 'optout' })
})

test('remontarObs não duplica marcadores', () => {
  const a = remontarObs('[X] texto', { inicio: true }, new Date(T0))
  const b = remontarObs(a, { inicio: true, toque: 1 }, new Date(T0 + DIA))
  const c = remontarObs(b, { toque: 2 }, new Date(T0 + 3 * DIA))
  assert.equal((c.match(/COBRANCA_FORM_INICIO/g) ?? []).length, 1)
  assert.equal((c.match(/\[COBRANCA_FORM:\d+:/g) ?? []).length, 1)
  assert.match(c, /\[COBRANCA_FORM:2:/)
  assert.match(c, /^\[X\] texto/)
})

test('o marco vale na virada do dia, não no múltiplo exato de 24h', () => {
  // Bug de 17/09/2026: os 49 primeiros INICIO foram carimbados 14h35 BRT numa
  // execução manual; o cron das 13h do dia seguinte não fechava as 24h e a régua
  // inteira escorregava um dia. Agora conta dia civil de Brasília.
  const inicio = Date.parse('2026-09-16T17:35:33Z')   // 14h35 BRT de 16/09
  const cron = Date.parse('2026-09-17T16:00:00Z')     // 13h BRT de 17/09
  assert.ok(cron - inicio < DIA, 'o cenário só faz sentido com menos de 24h entre os dois')
  assert.deepEqual(decidir(lerMarcadores(`[COBRANCA_FORM_INICIO:${iso(inicio)}]`, cron), false, cron), { acao: 'enviar', toque: 1 })
})

test('virada de dia não atropela o "um toque por dia"', () => {
  // toque 1 às 23h BRT; o cron da manhã seguinte é outro dia civil, mas o marco
  // seguinte (D+3) ainda não venceu — quem segura é a escada, não o relógio.
  const inicio = Date.parse('2026-09-16T16:00:00Z')
  const toque1 = Date.parse('2026-09-18T02:00:00Z')   // 23h BRT de 17/09
  const obs = remontarObs(`[COBRANCA_FORM_INICIO:${iso(inicio)}]`, { toque: 1 }, new Date(toque1))
  const manha = Date.parse('2026-09-18T16:00:00Z')    // 13h BRT de 18/09
  assert.deepEqual(decidir(lerMarcadores(obs, manha), false, manha), { acao: 'nada', motivo: 'aguardando D+3' })
})
