import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chaveRepeticao, contarRodadas, detectarRepeticao, linhaRepetido, type LinhaLog, type MovimentoChave } from './espelho-repeticao-calc.ts'

/** linha de sdr_etapa_log; `min` = minutos atrás (quanto maior, mais antiga) */
const log = (opp: number, de: number, para: number, min: number): LinhaLog =>
  ({ opp, de, para, criado_em: new Date(Date.now() - min * 60_000).toISOString() })
const mov = (p: Partial<MovimentoChave> = {}): MovimentoChave =>
  ({ lead_id: 'a', nome: 'TeamVL', opp: 29936, de: 70, para: 51, motivo: 'venda ou consulta registrada no portal (RID 7)', ...p })

test('contarRodadas conta a rodada de agora e só as repetições SEGUIDAS', () => {
  const m = { opp: 29936, de: 70, para: 51 }
  assert.equal(contarRodadas(m, []), 1, 'primeira vez = 1 rodada')
  assert.equal(contarRodadas(m, [log(29936, 70, 51, 15)]), 2)
  assert.equal(contarRodadas(m, [log(29936, 70, 51, 15), log(29936, 70, 51, 30), log(29936, 70, 51, 45)]), 4)
  // ordem de chegada das linhas não importa: a regra ordena pelo carimbo
  assert.equal(contarRodadas(m, [log(29936, 70, 51, 45), log(29936, 70, 51, 15), log(29936, 70, 51, 30)]), 4)
  // o card andou no meio (49 → 70 há 30 min): a repetição mais velha não conta, a corrida é só a atual
  assert.equal(contarRodadas(m, [log(29936, 70, 51, 15), log(29936, 49, 70, 30), log(29936, 70, 51, 45)]), 2)
  assert.equal(contarRodadas(m, [log(29936, 49, 70, 15), log(29936, 70, 51, 30)]), 1)
  // trilha de outra opp não conta
  assert.equal(contarRodadas(m, [log(111, 70, 51, 15), log(111, 70, 51, 30)]), 1)
})

test('o movimento repetido em 4 rodadas vira aviso — o defeito de 15/10/2026 (opp #29936 TeamVL)', () => {
  const historico = [log(29936, 70, 51, 15), log(29936, 70, 51, 30), log(29936, 70, 51, 45)]
  const r = detectarRepeticao({ movimentos: [mov()], historico, chavesExistentes: [] })
  assert.equal(r.repetidos.length, 1)
  assert.deepEqual(
    { opp: r.repetidos[0].opp, rodadas: r.repetidos[0].rodadas, chave: r.repetidos[0].chave, jaAvisado: r.repetidos[0].jaAvisado },
    { opp: 29936, rodadas: 4, chave: 'espelho_repete:29936', jaAvisado: false },
  )
  assert.deepEqual(r.novos.map((x) => x.opp), [29936])
  assert.deepEqual(r.vivas, ['espelho_repete:29936'])
  assert.deepEqual(r.mortas, [])
  assert.match(linhaRepetido(r.repetidos[0]), /TeamVL.*#29936.*70 → 51.*4 rodadas/)
})

test('abaixo do limite não avisa (3 rodadas ≈ 45 min ainda é normal)', () => {
  const r = detectarRepeticao({ movimentos: [mov()], historico: [log(29936, 70, 51, 15), log(29936, 70, 51, 30)], chavesExistentes: [] })
  assert.deepEqual([r.repetidos.length, r.novos.length, r.vivas], [0, 0, []])
})

test('limite configurável', () => {
  const uma = detectarRepeticao({ movimentos: [mov()], historico: [], chavesExistentes: [], rodadas: 1 })
  assert.equal(uma.repetidos.length, 1)
  const seis = detectarRepeticao({ movimentos: [mov()], historico: [log(29936, 70, 51, 15), log(29936, 70, 51, 30), log(29936, 70, 51, 45)], chavesExistentes: [], rodadas: 6 })
  assert.equal(seis.repetidos.length, 0)
})

test('avisa UMA vez por opp: chave já gravada não vira aviso novo, mas segue viva', () => {
  const historico = [log(29936, 70, 51, 15), log(29936, 70, 51, 30), log(29936, 70, 51, 45)]
  const r = detectarRepeticao({ movimentos: [mov()], historico, chavesExistentes: ['espelho_repete:29936'] })
  assert.equal(r.repetidos[0].jaAvisado, true)
  assert.deepEqual(r.novos, [])
  assert.deepEqual(r.vivas, ['espelho_repete:29936'])
  assert.deepEqual(r.mortas, [], 'o movimento continua travado: a chave não pode ser solta')
})

test('movimento que destravou solta a chave, pro próximo travamento voltar a avisar', () => {
  // o card andou: nesta rodada não há mais movimento nenhum pra esta opp
  const r = detectarRepeticao({ movimentos: [], historico: [log(29936, 70, 51, 15)], chavesExistentes: ['espelho_repete:29936', 'espelho_repete:111'] })
  assert.deepEqual(r.repetidos, [])
  assert.deepEqual(r.vivas, [])
  assert.deepEqual(r.mortas.sort(), ['espelho_repete:111', 'espelho_repete:29936'])
})

test('card que vai e volta entre duas etapas (bloco AIVA) não acusa travamento', () => {
  // 98 → 70 numa rodada, 70 → 98 na outra: o par de/para alterna, então nunca são 4 seguidas
  const historico = [log(500, 70, 98, 15), log(500, 98, 70, 30), log(500, 70, 98, 45), log(500, 98, 70, 60)]
  const r = detectarRepeticao({ movimentos: [mov({ opp: 500, de: 98, para: 70 })], historico, chavesExistentes: [] })
  assert.deepEqual(r.repetidos, [])
})

test('duas opps travadas e uma linha por opp', () => {
  const historico = [
    log(29936, 70, 51, 15), log(29936, 70, 51, 30), log(29936, 70, 51, 45),
    log(777, 50, 96, 15), log(777, 50, 96, 30), log(777, 50, 96, 45),
  ]
  const r = detectarRepeticao({
    // o mesmo lead com dois movimentos pra mesma opp não duplica o aviso
    movimentos: [mov(), mov(), mov({ lead_id: 'b', nome: 'Outra', opp: 777, de: 50, para: 96 })],
    historico, chavesExistentes: [],
  })
  assert.deepEqual(r.repetidos.map((x) => x.opp), [29936, 777])
  assert.deepEqual(r.vivas, [chaveRepeticao(29936), chaveRepeticao(777)])
})

test('linha sem carimbo não some da contagem (vale como a mais antiga)', () => {
  const m = { opp: 1, de: 70, para: 51 }
  assert.equal(contarRodadas(m, [{ opp: 1, de: 70, para: 51, criado_em: null }]), 2)
  assert.equal(contarRodadas(m, [{ opp: 1, de: 70, para: 51 }, log(1, 70, 51, 15)]), 3)
})
