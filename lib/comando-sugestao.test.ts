import test from 'node:test'
import assert from 'node:assert/strict'
import { distancia, normalizarComando, sugerirComando, textoComandoDesconhecido } from './comando-sugestao.ts'

const CMDS = ['/disparo', '/pausar', '/retomar', '/ajuda', '/help']

test('distancia: iguais 0, uma troca 1, inserção e remoção 1', () => {
  assert.equal(distancia('/retomar', '/retomar'), 0)
  assert.equal(distancia('/retonar', '/retomar'), 1)
  assert.equal(distancia('/retomarr', '/retomar'), 1)
  assert.equal(distancia('/retoma', '/retomar'), 1)
})

test('normalizarComando: minúsculas, sem acento, sem espaço, barra única', () => {
  assert.equal(normalizarComando('  /Retomar  '), '/retomar')
  assert.equal(normalizarComando('//disparo'), '/disparo')
  assert.equal(normalizarComando('/Pausár agora'), '/pausar')
})

test('sugerirComando: /retonar → /retomar; /Retomar com espaço → /retomar; /dispar → /disparo', () => {
  assert.equal(sugerirComando('/retonar', CMDS), '/retomar')
  assert.equal(sugerirComando(' /Retomar ', CMDS), '/retomar')
  assert.equal(sugerirComando('/dispar', CMDS), '/disparo')
})

test('sugerirComando: longe demais ou comando curto com 2 erros → null (nada de chute)', () => {
  assert.equal(sugerirComando('/status', CMDS), null)
  assert.equal(sugerirComando('/xyz', CMDS), null)
  assert.equal(sugerirComando('/hlpx', CMDS), null) // comando curto: só 1 erro
  assert.equal(sugerirComando('/ajdua', CMDS), '/ajuda') // transposição: 2 edições, ainda sugere
  assert.equal(sugerirComando('/pausar', ['/retomar']), null) // pausar nunca vira retomar
})

test('textoComandoDesconhecido: sugere sem executar; sem sugestão manda pro /ajuda', () => {
  const t = textoComandoDesconhecido('/retonar', CMDS)
  assert.match(t, /Quis dizer \*\/retomar\*\?/)
  assert.match(t, /Manda de novo/)
  assert.match(textoComandoDesconhecido('/xyz', CMDS), /Digite \/ajuda/)
})
