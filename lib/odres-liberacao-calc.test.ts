import { test } from 'node:test'
import assert from 'node:assert/strict'
import { odresLiberada, blocoOdresPrompt, ODRES_LIBERACAO_INICIO } from './odres-liberacao-calc.ts'

test('a virada acontece no primeiro dia da semana de liberação', () => {
  assert.equal(ODRES_LIBERACAO_INICIO, '2026-09-22')
  assert.equal(odresLiberada('2026-09-17'), false)   // hoje, quinta
  assert.equal(odresLiberada('2026-09-21'), false)   // domingo, véspera
  assert.equal(odresLiberada('2026-09-22'), true)    // segunda, libera
  assert.equal(odresLiberada('2026-10-05'), true)
})

test('ANTES: "não estou vendo" é esperado — acolhe, sem print e sem acionar', () => {
  const b = blocoOdresPrompt('2026-09-17')
  assert.match(b, /AINDA NÃO chegou/)
  assert.match(b, /NÃO peça print/)
  assert.match(b, /Só acione humano \(motivo_humano = "duvida_odres"\) se ele\nCOBRAR prazo/)
  assert.doesNotMatch(b, /JÁ ESTÁ VALENDO/)
})

test('DEPOIS: a mesma frase do lojista vira defeito — print e acionamento', () => {
  const b = blocoOdresPrompt('2026-09-22')
  assert.match(b, /JÁ ESTÁ VALENDO/)
  assert.match(b, /problema de\nverdade/)
  assert.match(b, /regra 📸/)
  assert.doesNotMatch(b, /é ESPERADO/)
})

test('nenhum dos dois estados entrega a data ao lojista', () => {
  for (const dia of ['2026-09-17', '2026-09-30']) {
    const b = blocoOdresPrompt(dia)
    // a data nunca aparece escrita: ela serve pra decidir o estado, não pra ser dita
    assert.doesNotMatch(b, /22\/09|2026-09-22/)
    // "semana que vem" só pode existir dentro da PROIBIÇÃO de dar prazo
    for (const linha of b.split('\n')) {
      if (linha.includes('semana que vem')) assert.match(linha, /NUNCA|Nem "/)
    }
  }
})

test('antes da liberação, o argumento continua liberado para a prospecção', () => {
  const b = blocoOdresPrompt('2026-09-17')
  assert.match(b, /Prospecção \(Fases 1-3\)/)
  assert.match(b, /vale INTEIRO aqui/)
})
