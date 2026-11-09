import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  avaliarFrescor, diasEntre, dataBr, teaserFrescor, retratoUsavelParaDicas,
  DIAS_RETRATO_ACEITO_DICAS, DIA_LIMITE_MES_CORRENTE,
  diagnosticarLoginPortal, FalhaAcessoPortal, lerErroDoPortal,
} from './frescor-portal-calc.ts'

test('dia saudavel: retrato de ontem e mes corrente derivado = nenhum problema', () => {
  const f = avaliarFrescor({ hoje: '2026-11-09', ultimoRetrato: '2026-11-08', temMesCorrente: true })
  assert.equal(f.ok, true)
  assert.equal(f.diasParados, 1)
  assert.equal(f.retratoVelho, false)
  assert.deepEqual(f.problemas, [])
})

test('retrato do proprio dia (reprocesso na mao) tambem esta fresco', () => {
  const f = avaliarFrescor({ hoje: '2026-11-09', ultimoRetrato: '2026-11-09', temMesCorrente: true })
  assert.equal(f.ok, true)
  assert.equal(f.diasParados, 0)
})

test('o incidente de 09/11/2026: parada em 26/10 acusa 14 dias e a ultima data presente', () => {
  const f = avaliarFrescor({ hoje: '2026-11-09', ultimoRetrato: '2026-10-26', temMesCorrente: false })
  assert.equal(f.ok, false)
  assert.equal(f.diasParados, 14)
  assert.equal(f.retratoVelho, true)
  assert.equal(f.mesCorrenteFaltando, true)
  assert.equal(f.problemas.length, 2)
  assert.match(f.problemas[0], /26\/10\/2026/)
  assert.match(f.problemas[0], /14 dias atrás/)
  assert.match(f.problemas[1], /2026-11/)
})

test('um dia de atraso ja acusa: retrato de anteontem nao passa', () => {
  const f = avaliarFrescor({ hoje: '2026-11-09', ultimoRetrato: '2026-11-07', temMesCorrente: true })
  assert.equal(f.ok, false)
  assert.equal(f.retratoVelho, true)
  assert.equal(f.diasParados, 2)
  assert.equal(f.problemas.length, 1)
})

test('tabela vazia e um problema com texto proprio, e diasParados fica null', () => {
  const f = avaliarFrescor({ hoje: '2026-11-09', ultimoRetrato: null, temMesCorrente: false })
  assert.equal(f.ok, false)
  assert.equal(f.diasParados, null)
  assert.match(f.problemas[0], /VAZIA/)
})

test('mes corrente ausente nos dias 1 e 2 e calendario, nao defeito (retrato ainda e do mes passado)', () => {
  for (const [hoje, retrato] of [['2026-12-01', '2026-11-30'], ['2026-12-02', '2026-12-01']] as const) {
    const f = avaliarFrescor({ hoje, ultimoRetrato: retrato, temMesCorrente: false })
    assert.equal(f.mesCorrenteFaltando, false, hoje)
    assert.equal(f.ok, true, hoje)
  }
  // a partir do dia 3 a ausencia e defeito, mesmo com o retrato fresco
  const f = avaliarFrescor({ hoje: '2026-12-03', ultimoRetrato: '2026-12-02', temMesCorrente: false })
  assert.equal(f.mesCorrenteFaltando, true)
  assert.equal(f.ok, false)
  assert.equal(f.problemas.length, 1)
  assert.match(f.problemas[0], /hoje é dia 3/)
  assert.equal(DIA_LIMITE_MES_CORRENTE, 2)
})

test('retrato fresco na virada do mes nao vira alarme de retrato', () => {
  const f = avaliarFrescor({ hoje: '2026-11-01', ultimoRetrato: '2026-10-31', temMesCorrente: false })
  assert.equal(f.retratoVelho, false)
  assert.equal(f.ok, true)
})

test('diasEntre atravessa mes e ano', () => {
  assert.equal(diasEntre('2026-10-26', '2026-11-09'), 14)
  assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1)
  assert.equal(diasEntre('2026-11-09', '2026-11-09'), 0)
  assert.equal(diasEntre('2026-11-09', '2026-11-08'), -1)
  assert.equal(dataBr('2026-10-26'), '26/10/2026')
})

test('teaser: uma linha, sem quebra, <= 160 caracteres, e diz a data da parada', () => {
  for (const e of [
    { hoje: '2026-11-09', ultimoRetrato: '2026-10-26', temMesCorrente: false },
    { hoje: '2026-11-09', ultimoRetrato: null, temMesCorrente: false },
    { hoje: '2026-11-09', ultimoRetrato: '2026-11-08', temMesCorrente: false },
  ]) {
    const t = teaserFrescor(avaliarFrescor(e))
    assert.ok(t.length <= 160, `${t.length}: ${t}`)
    assert.ok(!/[\n\r\t]/.test(t), t)
  }
  assert.match(teaserFrescor(avaliarFrescor({ hoje: '2026-11-09', ultimoRetrato: '2026-10-26', temMesCorrente: false })), /26\/10\/2026 \(14d\)/)
  // retrato fresco mas mes corrente faltando: o teaser fala do mes, nao da data
  assert.match(teaserFrescor(avaliarFrescor({ hoje: '2026-11-09', ultimoRetrato: '2026-11-08', temMesCorrente: false })), /sem linha de 2026-11/)
})

test('dicas: aceitam retrato de ate 3 dias e recusam acima disso', () => {
  assert.deepEqual(retratoUsavelParaDicas('2026-11-09', '2026-11-08'), { ok: true, dias: 1 })
  assert.deepEqual(retratoUsavelParaDicas('2026-11-09', '2026-11-06'), { ok: true, dias: 3 })
  assert.deepEqual(retratoUsavelParaDicas('2026-11-09', '2026-11-05'), { ok: false, dias: 4, motivo: 'retrato_velho' })
  assert.deepEqual(retratoUsavelParaDicas('2026-11-09', null), { ok: false, dias: null, motivo: 'sem_retrato_do_portal' })
  // o estado real de 09/11: 14 dias de retrato velho, a dica nao sai
  assert.deepEqual(retratoUsavelParaDicas('2026-11-09', '2026-10-26'), { ok: false, dias: 14, motivo: 'retrato_velho' })
  assert.equal(DIAS_RETRATO_ACEITO_DICAS, 3)
})

test('dicas toleram mais que o vigia: 2 dias de atraso alarma o vigia e nao cala a dica', () => {
  const dois = { hoje: '2026-11-09', ultimoRetrato: '2026-11-07', temMesCorrente: true }
  assert.equal(avaliarFrescor(dois).ok, false)
  assert.equal(retratoUsavelParaDicas(dois.hoje, dois.ultimoRetrato).ok, true)
})

test('o 422 de 26/10/2026 vira falha de ACESSO com nome, nao erro generico de HTTP', () => {
  const corpo = '{"code":422,"error_code":"email_provider_disabled","msg":"Email logins are disabled"}'
  const e = diagnosticarLoginPortal(422, corpo)
  assert.ok(e instanceof FalhaAcessoPortal)
  assert.equal((e as FalhaAcessoPortal).codigo, 'email_provider_disabled')
  assert.equal((e as FalhaAcessoPortal).httpStatus, 422)
  assert.match(e.message, /DESLIGOU o login por e-mail e senha/)
  assert.match(e.message, /PARADA/)
  assert.match(e.message, /nenhum deploy resolve/)
  assert.match(e.message, /email_provider_disabled/)
})

test('qualquer 4xx de auth e ACESSO; 429 e 5xx sao portal fora do ar', () => {
  for (const st of [400, 401, 403, 404, 422]) {
    const e = diagnosticarLoginPortal(st, '{"msg":"Invalid login credentials"}')
    assert.ok(e instanceof FalhaAcessoPortal, String(st))
    assert.match(e.message, /recusou a credencial/)
  }
  for (const st of [429, 500, 502, 503]) {
    const e = diagnosticarLoginPortal(st, 'upstream timeout')
    assert.ok(!(e instanceof FalhaAcessoPortal), String(st))
    assert.match(e.message, /fora do ar/)
  }
})

test('corpo nao-JSON nao explode e entra cortado', () => {
  const e = diagnosticarLoginPortal(502, '<html><body>' + 'x'.repeat(500) + '</body></html>')
  assert.ok(!(e instanceof FalhaAcessoPortal))
  assert.ok(e.message.length < 260, String(e.message.length))
})

test('e-mail do login nunca sai na mensagem (log/WhatsApp/commit)', () => {
  const e = diagnosticarLoginPortal(400, '{"msg":"user track@trackcr.com.br not allowed"}')
  assert.ok(!e.message.includes('track@trackcr.com.br'), e.message)
  assert.match(e.message, /<e-mail oculto>/)
  assert.equal(lerErroDoPortal('{"msg":"a@b.co"}').msg, '<e-mail oculto>')
})
