import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehDesistencia, marcadoresDesistencia, statusDeVolta, obsDaVolta, retornoDeDescartado, obsReabertoAuto } from './desistencia.ts'

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

// 18/11/2026 (Aldo): descartado que volta a escrever não fala mais com o vazio.
test('descartado que volta: automatico reabre, manual avisa o time, aceno e reprocesso sao ignorados', () => {
  assert.equal(retornoDeDescartado('[BULK_CLEANUP:2026-05-28:sem_resp_to_descartado]', false, false), 'reabrir')
  assert.equal(retornoDeDescartado(null, false, false), 'reabrir')
  assert.equal(retornoDeDescartado('[DESCARTADO_MANUAL:2026-11-01T12:00:00.000Z]', false, false), 'avisar')
  assert.equal(retornoDeDescartado('[BULK_CLEANUP:x]', true, false), 'ignorar')   // "ok", "obrigado"
  assert.equal(retornoDeDescartado('[DESCARTADO_MANUAL:x]', true, false), 'ignorar')
  assert.equal(retornoDeDescartado('[BULK_CLEANUP:x]', false, true), 'ignorar')   // reprocessamento interno
})

test('marca de reabertura automatica: uma so, preservando o resto', () => {
  const a = obsReabertoAuto('[BULK_CLEANUP:x] [DADOS_COLETADOS:nome_socio=Ana]', new Date('2026-11-18T19:00:00Z'))
  assert.equal(a, '[BULK_CLEANUP:x] [DADOS_COLETADOS:nome_socio=Ana] [REABERTO_AUTO:2026-11-18T19:00:00.000Z]')
  const b = obsReabertoAuto(a, new Date('2026-11-20T10:00:00Z'))
  assert.equal((b.match(/REABERTO_AUTO/g) ?? []).length, 1)
  assert.ok(b.endsWith('[REABERTO_AUTO:2026-11-20T10:00:00.000Z]'))
})
