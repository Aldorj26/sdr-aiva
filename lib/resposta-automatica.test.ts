import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehRespostaAutomatica, soRespostaAutomatica, manterAntesDoInteresse } from './resposta-automatica.ts'

test('reconhece as mensagens automáticas reais de 23-25/09', () => {
  for (const t of [
    'GMCELL agradece seu contato. Como podemos ajudar?',
    'Olá! Seja muito bem-vindo(a) à iPhone Mais! 🍎📱',
    'Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível.',
    'Olá, esse é o canal de atendimento da loja Vivo Pantanal',
    'Idobe Tech agradece seu contato. Para melhor atende-lo digite a opção desejada: 1. Produtos',
    'Ola bom dia , tudo bem?me chamo Débora , um minuto e já irei te atender 😁',
  ]) assert.equal(ehRespostaAutomatica(t), true, t)
})

test('fala de pessoa não é automática', () => {
  for (const t of ['Sim', 'Como funciona e qual custo seria ?', 'Fazer o cadastro', 'Não tenho interesse', 'Oi boa tarde', 'Sim / 1 loja'])
    assert.equal(ehRespostaAutomatica(t), false, t)
})

test('soRespostaAutomatica: basta uma fala de pessoa pra valer como conversa', () => {
  assert.equal(soRespostaAutomatica(['Seja bem-vindo!', 'Nosso horário de atendimento é das 9h às 18h']), true)
  assert.equal(soRespostaAutomatica(['Seja bem-vindo!', 'Sim, quero saber mais']), false)
  assert.equal(soRespostaAutomatica([]), false)
  assert.equal(soRespostaAutomatica(['', '  ']), false)
})

test('webhook: robô da loja no INICIO não vira INTERESSADO', () => {
  const robo = ['Tobias Cell agradece seu contato. Como podemos ajudar?']
  assert.equal(manterAntesDoInteresse({ statusAtual: 'INICIO', novoStatus: 'INTERESSADO', textosIn: robo, temDados: false }), true)
  assert.equal(manterAntesDoInteresse({ statusAtual: 'SEM_RESPOSTA', novoStatus: 'INTERESSADO', textosIn: robo, temDados: false }), true)
})

test('webhook: pessoa, dados, outra etapa ou outro destino passam normalmente', () => {
  const robo = ['Tobias Cell agradece seu contato. Como podemos ajudar?']
  // a pessoa respondeu depois do robô → promove
  assert.equal(manterAntesDoInteresse({ statusAtual: 'INICIO', novoStatus: 'INTERESSADO', textosIn: [...robo, 'Oi, sou o dono'], temDados: false }), false)
  // já passou dado
  assert.equal(manterAntesDoInteresse({ statusAtual: 'INICIO', novoStatus: 'INTERESSADO', textosIn: robo, temDados: true }), false)
  // AGUARDANDO/INTERESSADO já conversaram antes: não é com eles
  assert.equal(manterAntesDoInteresse({ statusAtual: 'AGUARDANDO', novoStatus: 'INTERESSADO', textosIn: robo, temDados: false }), false)
  // OPT_OUT, BOT_DETECTADO etc. nunca são segurados
  assert.equal(manterAntesDoInteresse({ statusAtual: 'INICIO', novoStatus: 'OPT_OUT', textosIn: robo, temDados: false }), false)
  assert.equal(manterAntesDoInteresse({ statusAtual: 'INICIO', novoStatus: 'BOT_DETECTADO', textosIn: robo, temDados: false }), false)
})
