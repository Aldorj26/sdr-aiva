import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumir, blocoPrompt, blocoPromptSemNumeros, numerosCongelados, intervaloDias, SEMANAS_JANELA, comissaoVendedor, COMISSAO_VENDEDOR_DIAS } from './desempenho-loja-calc.ts'

const ULT = '2026-09-21'
const MES = '2026-10'
const s = (semana: string, aprovados: number, vendas: number, valor = vendas * 1300) => ({ semana, aprovados, vendas, valor_vendas: valor })
const m = (mes: string, consultas: number, aprovados: number, vendas: number) => ({ mes, consultas, aprovados, vendas, valor_vendas: vendas * 1300 })

test('semana sem linha vira zero e a janela tem sempre o mesmo tamanho', () => {
  const r = resumir([s('2026-09-07', 3, 2)], [], ULT, MES)
  assert.equal(r.semanas.length, SEMANAS_JANELA)
  assert.deepEqual(r.semanas.map((x) => x.semana), ['2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31'])
  assert.equal(r.semanas[0].vendas, 0)
  assert.equal(r.semanas[2].vendas, 2)
})

test('parada ha 2 semanas nao parece vendendo so porque a ultima linha dela tem venda', () => {
  const r = resumir([s('2026-09-07', 5, 4)], [m('2026-09', 40, 5, 4)], ULT, MES)
  assert.equal(r.segmento, 'parou')
  assert.equal(intervaloDias(r.segmento), 7) // semanal pra todos desde 20/10/2026
})

test('varios CNPJs somam por semana', () => {
  const r = resumir([s(ULT, 2, 1), s(ULT, 3, 2), s('2026-09-14', 1, 1)], [], ULT, MES)
  assert.equal(r.semanas[0].vendas, 3)
  assert.equal(r.vendas2, 4)
  assert.equal(r.segmento, 'vende_firme')
  assert.equal(intervaloDias(r.segmento), 7)
})

test('segmentos', () => {
  assert.equal(resumir([s(ULT, 4, 1)], [], ULT, MES).segmento, 'vende_pouco')
  assert.equal(resumir([s(ULT, 6, 0)], [], ULT, MES).segmento, 'aprova_nao_vende')
  assert.equal(resumir([], [], ULT, MES).segmento, 'sem_uso')
  assert.equal(intervaloDias('sem_uso'), 7)
  assert.equal(intervaloDias('aprova_nao_vende'), 7)
})

test('venda no mes corrente (semana ainda aberta) tira do parado', () => {
  const r = resumir([], [m(MES, 10, 2, 1)], ULT, MES)
  assert.equal(r.segmento, 'vende_pouco')
})

test('mes anterior atravessa o ano', () => {
  const r = resumir([], [m('2026-12', 5, 1, 1)], '2026-12-28', '2027-01')
  assert.equal(r.mesAnterior?.mes, '2026-12')
})

test('bloco do prompt: numeros, datas e as travas', () => {
  const r = resumir([s(ULT, 6, 2, 2600)], [m('2026-09', 120, 30, 9), m(MES, 8, 2, 0)], ULT, MES)
  const b = blocoPrompt(r)
  assert.match(b, /semana de 21\/09: 6 aprovados · 2 vendas/)
  assert.match(b, /120 consultas · 30 aprovados · 9 vendas \(30% dos aprovados\)/)
  assert.match(b, /ACREDITE nele/)
  assert.match(b, /Nunca invente/)
})

// 23/10/2026 (Aldo): a comissão de R$ 10/venda ao vendedor vale SÓ no primeiro mês da loja. A Loja André Cell
// (criada 25/08) ouviu da VictorIA em 21/10 que a comissão era "garantida, todo mês".
test('comissão do vendedor: vigente nos primeiros 30 dias da loja, encerrada depois, desconhecida sem data', () => {
  assert.equal(COMISSAO_VENDEDOR_DIAS, 30)
  assert.deepEqual(comissaoVendedor('2026-08-25', '2026-09-23'), { estado: 'vigente', ate: '2026-09-23' })
  assert.deepEqual(comissaoVendedor('2026-08-25', '2026-09-24'), { estado: 'encerrada', ate: '2026-09-23' })
  assert.deepEqual(comissaoVendedor('2026-08-25', '2026-10-21'), { estado: 'encerrada', ate: '2026-09-23' })
  assert.deepEqual(comissaoVendedor(null, '2026-10-21'), { estado: 'desconhecida', ate: null })
})

test('resumir guarda a data de criação da loja (a mais antiga entre os CNPJs)', () => {
  const r = resumir([], [{ ...m('2026-10', 1, 0, 0), cadastro_em: '2026-09-02' }, { ...m('2026-09', 1, 0, 0), cadastro_em: '2026-08-25' }], ULT, MES)
  assert.equal(r.cadastroEm, '2026-08-25')
  assert.equal(resumir([], [m('2026-10', 1, 0, 0)], ULT, MES).cadastroEm, null)
})

test('bloco do prompt diz se a comissão do vendedor ainda vale — e manda não prometer fora do 1º mês', () => {
  const velha = resumir([], [{ ...m('2026-10', 1, 0, 0), cadastro_em: '2026-08-25' }], ULT, MES)
  const bv = blocoPrompt(velha, '2026-10-23')
  assert.match(bv, /Comissão de R\$ 10 por venda ao VENDEDOR[^\n]*ENCERRADA[^\n]*25\/08[^\n]*23\/09/)
  assert.match(bv, /não diga "todo mês"/)
  assert.match(bv, /duvida_comissao_vendedor/)
  const nova = resumir([], [{ ...m('2026-10', 1, 0, 0), cadastro_em: '2026-10-10' }], ULT, MES)
  assert.match(blocoPrompt(nova, '2026-10-23'), /Comissão de R\$ 10 por venda ao VENDEDOR[^\n]*VIGENTE até 08\/11/)
  const semData = resumir([], [m('2026-10', 1, 0, 0)], ULT, MES)
  assert.match(blocoPrompt(semData, '2026-10-23'), /Comissão de R\$ 10 por venda ao VENDEDOR[^\n]*data de criação DESCONHECIDA[^\n]*não prometa/)
})

// 17/11/2026: a coleta do portal morreu em 26/10 e não volta. Semana fechada velha não entra como atual.
test('numeros congelados: semana fechada com mais de ~4 semanas = fonte parada', () => {
  assert.equal(numerosCongelados('2026-10-19', '2026-10-27'), false) // fechou ontem
  assert.equal(numerosCongelados('2026-10-19', '2026-11-16'), false) // 28 dias: ainda aceita
  assert.equal(numerosCongelados('2026-10-19', '2026-11-17'), true)  // 29 dias: congelado
  assert.equal(numerosCongelados(null, '2026-11-17'), true)
  assert.equal(numerosCongelados('lixo', '2026-11-17'), true)
})

test('bloco sem numeros: mantem o nome do bloco e a linha da comissao, e nao traz numero nenhum', () => {
  const r = resumir([s('2026-10-19', 6, 2, 2600)], [{ ...m('2026-10', 120, 30, 9), cadastro_em: '2026-08-25' }], '2026-10-19', '2026-11')
  const b = blocoPromptSemNumeros(r, '2026-11-17')
  assert.match(b, /\[INSTRUÇÃO DO SISTEMA — NÚMEROS DA LOJA NO PORTAL DA AIVA\]/)
  assert.match(b, /NÚMEROS INDISPONÍVEIS/)
  assert.match(b, /💰/) // a linha da comissão/Black November continua vindo: o resto do prompt aponta pra ela
  assert.ok(!/120 consultas|6 aprovados|semana de 19\/10|Leitura:/.test(b))
  assert.ok(!/um novo chega toda semana/.test(b))
})
