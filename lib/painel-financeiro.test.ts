import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emailDoMotivo, classificar, mensagemLojista } from './painel-financeiro.ts'

test('e-mail sai do motivo; motivo de outra coisa ou e-mail inválido = null', () => {
  assert.equal(emailDoMotivo('abrir_painel_financeiro: Fulano@Gmail.com'), 'fulano@gmail.com')
  assert.equal(emailDoMotivo('abrir_painel_financeiro:fulano@empresa.com.br.'), 'fulano@empresa.com.br')
  assert.equal(emailDoMotivo('abrir_painel_financeiro: sem email'), null)
  assert.equal(emailDoMotivo('reenviar_senha_painel'), null)
  assert.equal(emailDoMotivo(null), null)
})

test('respostas da API viram o caso certo', () => {
  assert.deepEqual(classificar(201, { ticket_number: 1040 }), { tipo: 'criado', numero: 1040 })
  assert.deepEqual(classificar(409, { error: 'já existe ticket em aberto', ticket_number: 1031 }), { tipo: 'ja_existe', numero: 1031 })
  assert.equal(classificar(422, { error: 'e-mail não é conta Google' }).tipo, 'email_nao_google')
  assert.equal(classificar(422, { error: 'varejo não elegível' }).tipo, 'nao_elegivel')
  assert.equal(classificar(404, { error: 'varejo não encontrado na sua carteira' }).tipo, 'nao_elegivel')
  assert.equal(classificar(409, { error: 'mais de um cadastro com esse retailer_id' }).tipo, 'nao_elegivel')
  assert.equal(classificar(503, { error: 'indisponível' }).tipo, 'falha')
  assert.equal(classificar(429, {}).tipo, 'falha')
})

test('mensagem ao lojista traz o número e nunca promete prazo', () => {
  const m = mensagemLojista({ tipo: 'criado', numero: 1040 }, 'a@gmail.com')!
  assert.match(m, /ticket nº 1040/)
  assert.doesNotMatch(m, /hora|dia|prazo/i)
  assert.match(mensagemLojista({ tipo: 'email_nao_google' }, 'a@hotmail.com')!, /Gmail/)
})

test('motivo copiado do modelo com <> e caixa alta ainda funciona', () => {
  assert.equal(emailDoMotivo('Abrir_Painel_Financeiro: <fulano@gmail.com>'), 'fulano@gmail.com')
})
