import { test } from 'node:test'
import assert from 'node:assert/strict'
import { erroDaRespostaEvo } from './evo-resposta-calc.ts'

// O defeito que originou isto (15/10/2026): movimento recusado pelo Evo com HTTP 200 virava sucesso
// de mentira e o espelho repetia `opp #29936 70 → 51` a cada 15 min, sem nunca mover o card.

test('corpo que DECLARA falha vira mensagem', () => {
  assert.equal(erroDaRespostaEvo('{"success":false,"message":"stage not allowed"}'), 'stage not allowed')
  assert.equal(erroDaRespostaEvo('{"success":"false","msg":"opportunity closed"}'), 'opportunity closed')
  assert.equal(erroDaRespostaEvo('{"status":"error","mensagem":"fila inválida"}'), 'fila inválida')
  assert.equal(erroDaRespostaEvo('{"result":"failed","detail":"sem permissão"}'), 'sem permissão')
  assert.equal(erroDaRespostaEvo('{"ok":false,"message":"nope"}'), 'nope')
  assert.equal(erroDaRespostaEvo('{"error":"id não encontrado"}'), 'id não encontrado')
  assert.equal(erroDaRespostaEvo('{"error":{"message":"stage 51 é de fechamento"}}'), 'stage 51 é de fechamento')
})

test('falha sem mensagem legível cai no corpo aparado', () => {
  assert.equal(erroDaRespostaEvo('{"success":false}'), '{"success":false}')
  assert.equal(erroDaRespostaEvo('{"error":true}'), '{"error":true}')
  // a recusa real do /int/changeOpportunityStage (replay de 19/10/2026, opp #41530 54 → 50)
  assert.equal(erroDaRespostaEvo('{"result":false}'), '{"result":false}')
  assert.equal(erroDaRespostaEvo('{"result":"false"}'), '{"result":"false"}')
})

test('sucesso em todas as formas que a API devolve — nada vira erro', () => {
  // ⚠️ o conservadorismo é o ponto: falso positivo aqui derruba rodada que hoje funciona
  assert.equal(erroDaRespostaEvo(''), null)
  assert.equal(erroDaRespostaEvo('   '), null)
  assert.equal(erroDaRespostaEvo('OK'), null)                         // texto solto
  assert.equal(erroDaRespostaEvo('[{"id":1}]'), null)                 // lista (getPipeOpportunities)
  assert.equal(erroDaRespostaEvo('{"success":true}'), null)
  assert.equal(erroDaRespostaEvo('{"result":true}'), null)
  assert.equal(erroDaRespostaEvo('{"id":29936,"fkStage":51}'), null)  // objeto sem campo de estado
  assert.equal(erroDaRespostaEvo('{"status":"ok"}'), null)
  assert.equal(erroDaRespostaEvo('{"error":null}'), null)
  assert.equal(erroDaRespostaEvo('{"error":""}'), null)
  assert.equal(erroDaRespostaEvo('{"error":false}'), null)
  assert.equal(erroDaRespostaEvo('{"error":0}'), null)
  assert.equal(erroDaRespostaEvo('{quebrado'), null)                  // JSON inválido não acusa nada
  assert.equal(erroDaRespostaEvo('null'), null)
})
