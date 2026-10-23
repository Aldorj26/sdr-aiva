import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnosticar, somarPorDia, gargaloDe, comLink, pct, type RetratoDia } from './relatorio-loja-calc.ts'

const REDE = { aprovacao: 0.23, conversao: 0.21 }
const d = (data: string, consultas: number, aprovados: number, vendas: number, valor = vendas * 1300): RetratoDia => ({ data, consultas, aprovados, vendas, valor_vendas: valor })

test('funil do mês, semana e eventos saem do retrato acumulado', () => {
  const serie = [
    d('2026-10-05', 3, 1, 0), d('2026-10-08', 6, 2, 1), d('2026-10-12', 9, 3, 1), d('2026-10-15', 12, 3, 1), d('2026-10-19', 16, 5, 2),
    d('2026-09-30', 40, 9, 4), // mês anterior: ignorado no funil
  ]
  const r = diagnosticar(serie, 'vende_pouco', REDE)!
  assert.equal(r.data, '2026-10-19'); assert.equal(r.mes, 'outubro')
  assert.deepEqual([r.consultas, r.aprovados, r.vendas, r.valor], [16, 5, 2, 2600])
  assert.equal(pct(r.txAprovacao!), '31%'); assert.equal(pct(r.txConversao!), '40%')
  // ~7 dias antes de 19/10 → base 12/10
  assert.deepEqual(r.semana, { desde: '2026-10-12', consultas: 7, aprovados: 2, vendas: 1, valor: 1300 })
  assert.deepEqual(r.eventos.map((e) => [e.data, e.aprovacoes, e.vendas]), [['2026-10-19', 2, 1], ['2026-10-12', 1, 0], ['2026-10-08', 1, 1], ['2026-10-05', 1, 0]])
  assert.equal(r.gargalo, 'crescer')
})

test('relatório não promete a comissão de R$ 10 ao vendedor (vale só no 1º mês; a página é de toda loja)', () => {
  for (const seg of ['parou', 'vende_firme', 'vende_pouco'] as const) {
    const r = diagnosticar([d('2026-10-19', 16, 5, 2), d('2026-10-05', 3, 1, 0)], seg, REDE)!
    const tudo = JSON.stringify(r)
    assert.doesNotMatch(tudo, /R\$ 10/)
  }
})

test('mês novo compara com zero; serie vazia = null', () => {
  const r = diagnosticar([d('2026-11-03', 4, 1, 0)], 'aprova_nao_vende', REDE)!
  assert.deepEqual(r.semana, { desde: '2026-11-01', consultas: 4, aprovados: 1, vendas: 0, valor: 0 })
  assert.equal(r.gargalo, 'fechar')
  assert.equal(diagnosticar([], null, REDE), null)
})

test('vários CNPJs do mesmo dia são somados', () => {
  const s = somarPorDia([d('2026-10-19', 2, 1, 0), d('2026-10-19', 3, 0, 0), d('2026-10-18', 1, 0, 0)])
  assert.deepEqual(s.map((x) => [x.data, x.consultas, x.aprovados]), [['2026-10-18', 1, 0], ['2026-10-19', 5, 1]])
})

test('gargalo segue a leitura do bloco NÚMEROS DA LOJA, refinada pelo mês', () => {
  assert.equal(gargaloDe(d('2026-10-19', 0, 0, 0), 'sem_uso'), 'consultar')
  assert.equal(gargaloDe(d('2026-10-19', 0, 0, 0), 'parou'), 'retomar')
  assert.equal(gargaloDe(d('2026-10-19', 3, 0, 0), 'parou'), 'aprovar')          // voltou a consultar: sai de "retomar"
  assert.equal(gargaloDe(d('2026-10-19', 5, 0, 0), 'sem_uso'), 'aprovar')
  assert.equal(gargaloDe(d('2026-10-19', 5, 2, 0), 'aprova_nao_vende'), 'fechar')
  assert.equal(gargaloDe(d('2026-10-19', 5, 2, 1), 'vende_pouco'), 'crescer')
  assert.equal(gargaloDe(d('2026-10-02', 0, 0, 0), 'vende_firme'), 'crescer')    // mês começou ontem: não vira "nunca consultou"
  assert.equal(gargaloDe(d('2026-10-02', 2, 0, 0), 'vende_pouco'), 'crescer')
  assert.equal(gargaloDe(d('2026-10-19', 5, 0, 0), null), 'aprovar')             // sem leitura: só o mês
})

test('variância só pra loja com poucas consultas; retomar não usa variância', () => {
  const pouca = diagnosticar([d('2026-10-19', 7, 0, 0)], 'sem_uso', REDE)!
  const muita = diagnosticar([d('2026-10-19', 25, 0, 0)], 'sem_uso', REDE)!
  assert.match(pouca.explicacao, /primeiras reprovações são normais/)
  assert.doesNotMatch(muita.explicacao, /primeiras reprovações/)
  const parou = diagnosticar([d('2026-10-19', 0, 0, 0)], 'parou', REDE)!
  assert.doesNotMatch(parou.dicas.join(' '), /primeiras reprovações/)
  assert.match(parou.dicas.join(' '), /o sócio pede o login dele no formulário de Login de operadores/)
})

test('textos: cada gargalo tem título, explicação com os números e 3+ dicas sem link', () => {
  const casos: [RetratoDia, 'sem_uso' | 'parou' | 'aprova_nao_vende' | 'vende_firme', RegExp][] = [
    [d('2026-10-19', 0, 0, 0), 'sem_uso', /ainda não consultou/],
    [d('2026-10-19', 0, 0, 0), 'parou', /vendia pela AIVA e parou/],
    [d('2026-10-19', 7, 0, 0), 'sem_uso', /7 consultas e nenhuma aprovação.*média das lojas AIVA: 23%/],
    [d('2026-10-19', 7, 2, 0), 'aprova_nao_vende', /2 clientes aprovados.*29% das consultas/],
    [d('2026-10-19', 7, 2, 2), 'vende_firme', /2 vendas este mês, fechando 100% dos aprovados/],
  ]
  for (const [r, seg, re] of casos) {
    const x = diagnosticar([r], seg, REDE)!
    assert.match(`${x.titulo} ${x.explicacao}`, re)
    assert.ok(x.dicas.length >= 3, x.gargalo)
    for (const t of x.dicas) { assert.doesNotMatch(t, /https?:\/\//); assert.doesNotMatch(t, /parcelex/i) }
  }
  const semRede = diagnosticar([d('2026-10-19', 7, 0, 0)], 'sem_uso', { aprovacao: null, conversao: null })!
  assert.doesNotMatch(semRede.explicacao, /média/)
})

test('comLink: uma linha, com o link, cabe no HSM', () => {
  const t = comLink('sua loja já está liberada na AIVA e ainda não vi nenhuma consulta de CPF por aqui. Me conta o que travou?', 'https://sdr-aiva.vercel.app/r/AbCdEfGhJkLmNpQr')
  assert.doesNotMatch(t, /\n'/); assert.match(t, /https:\/\/sdr-aiva\.vercel\.app\/r\/AbCdEfGhJkLmNpQr$/)
  assert.ok(t.length < 400)
})
