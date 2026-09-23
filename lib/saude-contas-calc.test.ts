import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classificarFalha, exigeAcaoHumana, textoAlertaConta, chaveAviso } from './saude-contas-calc.ts'

test('o erro REAL de 23/09 é reconhecido como falta de crédito', () => {
  // texto exato que a API devolveu quando a VictorIA parou
  const real = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
  assert.equal(classificarFalha(real), 'sem_credito')
  assert.equal(exigeAcaoHumana('sem_credito'), true)
})

test('chave revogada é problema diferente de saldo', () => {
  assert.equal(classificarFalha('401 {"error":{"type":"authentication_error","message":"invalid x-api-key"}}'), 'credencial')
  assert.equal(exigeAcaoHumana('credencial'), true)
})

test('sobrecarga e rate limit passam sozinhos — não podem virar alarme de cobrança', () => {
  for (const m of ['429 rate_limit_error', '529 {"type":"overloaded_error"}', 'Too Many Requests']) {
    assert.equal(classificarFalha(m), 'limite', m)
  }
  assert.equal(exigeAcaoHumana('limite'), false)
})

test('erro desconhecido não é classificado como cobrança (seria alarme falso)', () => {
  assert.equal(classificarFalha('socket hang up'), 'outro')
  assert.equal(classificarFalha('Bad control character in string literal in JSON'), 'outro')
  assert.equal(classificarFalha(''), 'outro')
  assert.equal(classificarFalha(null), 'outro')
  assert.equal(exigeAcaoHumana('outro'), false)
})

test('o alerta diz a causa, o efeito e o caminho — e avisa da organização errada', () => {
  const t = textoAlertaConta('sem_credito', { erros: 18, lojistas: 16, desde: '10h44' })
  assert.match(t, /SEM CRÉDITO/)
  assert.match(t, /18 mensagens/)
  assert.match(t, /16 lojistas/)
  assert.match(t, /10h44/)
  assert.match(t, /console\.anthropic\.com/)
  // a lição que custou meia hora em 23/09: comprar na organização errada
  assert.match(t, /sdr-agent-2/)
  assert.match(t, /organização/i)
  assert.match(t, /Não dispare/)
})

test('sem contagem, o alerta continua fazendo sentido', () => {
  const t = textoAlertaConta('sem_credito')
  assert.match(t, /SEM CRÉDITO/)
  assert.doesNotMatch(t, /undefined/)
  assert.doesNotMatch(t, /NaN/)
})

test('um aviso por TIPO, não por lojista', () => {
  // 18 falhas do mesmo tipo compartilham a mesma chave → 1 alerta, não 18
  assert.equal(chaveAviso('sem_credito'), chaveAviso('sem_credito'))
  assert.notEqual(chaveAviso('sem_credito'), chaveAviso('credencial'))
})
