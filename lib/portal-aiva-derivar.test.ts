import { test } from 'node:test'
import assert from 'node:assert/strict'
import { somarDias, ultimoDiaDoMes, mesDe, mtdEm, type LinhaDiaria } from './portal-aiva-derivar.ts'

export const linha = (p: Partial<LinhaDiaria> & { data_ref: string; retailer_id: string; mes: string }): LinhaDiaria => ({
  cnpj: '11111111000191', nome_varejo: 'Loja', consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0,
  inadimplencia_aiva: null, inadimplencia_odres: null, foto_fora_pct: null, status: 'Ativo', cadastro_em: null,
  ...p,
})

test('somarDias e ultimoDiaDoMes trabalham em texto YYYY-MM-DD sem fuso', () => {
  assert.equal(somarDias('2026-08-31', 1), '2026-09-01')
  assert.equal(somarDias('2026-09-01', -8), '2026-08-24')
  assert.equal(ultimoDiaDoMes('2026-09-01'), '2026-09-30')
  assert.equal(ultimoDiaDoMes('2026-02-15'), '2026-02-28')
  assert.equal(mesDe('2026-09-13'), '2026-09-01')
})

test('mtdEm devolve o retrato mais recente até a data, ou zeros se não há retrato', () => {
  const serie = [
    linha({ data_ref: '2026-09-05', retailer_id: 'r1', mes: '2026-09-01', vendas: 2, aprovados: 5, consultas: 9, valor_vendas: 100 }),
    linha({ data_ref: '2026-09-07', retailer_id: 'r1', mes: '2026-09-01', vendas: 4, aprovados: 7, consultas: 12, valor_vendas: 250 }),
    linha({ data_ref: '2026-09-07', retailer_id: 'r2', mes: '2026-09-01', vendas: 1 }),
  ]
  assert.deepEqual(mtdEm(serie, 'r1', '2026-09-01', '2026-09-06'), { consultas: 9, aprovados: 5, vendas: 2, valor_vendas: 100 })
  assert.deepEqual(mtdEm(serie, 'r1', '2026-09-01', '2026-09-07'), { consultas: 12, aprovados: 7, vendas: 4, valor_vendas: 250 })
  assert.deepEqual(mtdEm(serie, 'r1', '2026-09-01', '2026-09-04'), { consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 })
  assert.deepEqual(mtdEm(serie, 'r1', '2026-08-01', '2026-09-07'), { consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 })
})

import { classificarAtencao } from './portal-aiva-derivar.ts'

test('classificarAtencao espelha a aba "Precisam de atenção" do portal', () => {
  const hoje = '2026-09-09'
  // novo (14 dias), 0 vendas, 2 aprovados → novo sem engajamento
  assert.equal(classificarAtencao({ cadastro: '2026-08-26', hoje, vendasDesdeCadastro: 0, aprovadosDesdeCadastro: 2, vendas30d: 0 }), 'novo_sem_engajamento')
  // novo demais (5 dias) → ainda não conta
  assert.equal(classificarAtencao({ cadastro: '2026-09-04', hoje, vendasDesdeCadastro: 0, aprovadosDesdeCadastro: 0, vendas30d: 0 }), null)
  // novo com 4 aprovados → engajou
  assert.equal(classificarAtencao({ cadastro: '2026-08-26', hoje, vendasDesdeCadastro: 0, aprovadosDesdeCadastro: 4, vendas30d: 0 }), null)
  // novo que vendeu → ok
  assert.equal(classificarAtencao({ cadastro: '2026-08-26', hoje, vendasDesdeCadastro: 1, aprovadosDesdeCadastro: 1, vendas30d: 1 }), null)
  // base (83 dias) sem venda em 30d → baixa performance
  assert.equal(classificarAtencao({ cadastro: '2026-06-18', hoje, vendasDesdeCadastro: 3, aprovadosDesdeCadastro: 20, vendas30d: 0 }), 'baixa_performance')
  // base vendendo → ok
  assert.equal(classificarAtencao({ cadastro: '2026-06-18', hoje, vendasDesdeCadastro: 3, aprovadosDesdeCadastro: 20, vendas30d: 2 }), null)
  // cadastro desconhecido = trata como base
  assert.equal(classificarAtencao({ cadastro: null, hoje, vendasDesdeCadastro: 0, aprovadosDesdeCadastro: 0, vendas30d: 0 }), 'baixa_performance')
})

import { agregarMensal } from './portal-aiva-derivar.ts'

test('agregarMensal usa o último retrato do mês e soma lojas do mesmo CNPJ', () => {
  const serie = [
    // retrato antigo (deve ser ignorado)
    linha({ data_ref: '2026-09-05', retailer_id: 'r1', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Multicell 1', vendas: 1, aprovados: 3, consultas: 5, valor_vendas: 100 }),
    // último retrato
    linha({ data_ref: '2026-09-08', retailer_id: 'r1', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Multicell 1', vendas: 2, aprovados: 6, consultas: 10, valor_vendas: 300, status: 'Inativo', inadimplencia_aiva: 0.02 }),
    linha({ data_ref: '2026-09-08', retailer_id: 'r2', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Multicell 2', vendas: 5, aprovados: 8, consultas: 12, valor_vendas: 900, status: 'Ativo', inadimplencia_aiva: 0.05, cadastro_em: '2026-06-01' }),
    linha({ data_ref: '2026-09-08', retailer_id: 'r3', mes: '2026-09-01', cnpj: '22222222000191', nome_varejo: 'Zerada', consultas: 0, aprovados: 0, vendas: 0, valor_vendas: 0 }),
    // mês anterior do r3 (vendeu em agosto → não é baixa performance ainda no dia 9)
    linha({ data_ref: '2026-08-31', retailer_id: 'r3', mes: '2026-08-01', cnpj: '22222222000191', nome_varejo: 'Zerada', vendas: 1, aprovados: 2, consultas: 3, valor_vendas: 50 }),
  ]
  const primeira = new Map([['r1', '2026-05-01'], ['r2', '2026-06-01'], ['r3', '2026-05-01']])
  const rows = agregarMensal(serie, '2026-09-01', '2026-09-09', primeira)
  assert.equal(rows.length, 2)

  const multi = rows.find((r) => r.cnpj === '11111111000191')!
  assert.equal(multi.mes, '2026-09')
  assert.equal(multi.consultas, 22)
  assert.equal(multi.aprovados, 14)
  assert.equal(multi.vendas, 7)
  assert.equal(multi.valor_vendas, 1200)
  assert.equal(multi.loja, 'Multicell 2')      // a que mais vendeu
  assert.equal(multi.rid, 'r2')
  assert.equal(multi.status_portal, 'Ativo')  // qualquer loja ativa
  assert.equal(multi.inadimplencia_aiva, 0.05) // a maior
  assert.equal(multi.cadastro_em, '2026-06-01')
  assert.equal(multi.conversao, 7 / 14)
  assert.equal(multi.ticket_medio, 1200 / 7)
  assert.equal(multi.sem_venda, false)
  assert.equal(multi.sem_consulta, false)
  assert.equal(multi.atencao, null)

  const zerada = rows.find((r) => r.cnpj === '22222222000191')!
  assert.equal(zerada.sem_venda, true)
  assert.equal(zerada.sem_consulta, true)     // consultas = 0 de verdade, não aprovados = 0
  assert.equal(zerada.ticket_medio, null)
  assert.equal(zerada.conversao, 0)
  assert.equal(zerada.cadastro_em, '2026-05-01') // sem coluna do portal → primeira aparição
  assert.equal(zerada.atencao, null)           // vendeu em agosto, dentro dos 30 dias
})

test('agregarMensal marca baixa performance quando não vende há 30 dias', () => {
  const serie = [
    linha({ data_ref: '2026-09-08', retailer_id: 'r3', mes: '2026-09-01', cnpj: '22222222000191', vendas: 0 }),
    linha({ data_ref: '2026-08-31', retailer_id: 'r3', mes: '2026-08-01', cnpj: '22222222000191', vendas: 0, aprovados: 1 }),
  ]
  const rows = agregarMensal(serie, '2026-09-01', '2026-09-09', new Map([['r3', '2026-05-01']]))
  assert.equal(rows[0].atencao, 'baixa_performance')
})

import { derivarSemana } from './portal-aiva-derivar.ts'

const L = (data_ref: string, retailer_id: string, mes: string, m: Partial<LinhaDiaria>) =>
  linha({ data_ref, retailer_id, mes, cnpj: retailer_id.padStart(14, '0'), nome_varejo: 'Loja ' + retailer_id, ...m })

test('derivarSemana: semana normal = domingo menos domingo anterior', () => {
  const serie = [
    L('2026-09-06', 'r1', '2026-09-01', { consultas: 10, aprovados: 4, vendas: 1, valor_vendas: 100 }),
    L('2026-09-13', 'r1', '2026-09-01', { consultas: 25, aprovados: 9, vendas: 3, valor_vendas: 450 }),
  ]
  const { linhas, avisos } = derivarSemana(serie, '2026-09-07', new Map())
  assert.equal(avisos.length, 0)
  assert.equal(linhas.length, 1)
  assert.deepEqual(
    { ...linhas[0] },
    { semana: '2026-09-07', cnpj: '000000000000r1', rid: 'r1', nome_varejo: 'Loja r1', loja: 'Loja r1', uf: null, cidade: null, consultas: 15, aprovados: 5, vendas: 2, valor_vendas: 350 },
  )
})

test('derivarSemana: virada de mês soma o fim do mês antigo com o começo do novo', () => {
  // semana 31/08 (seg) a 06/09 (dom): agosto fecha em 31/08, setembro começa em 01/09
  const serie = [
    L('2026-08-30', 'r1', '2026-08-01', { vendas: 10, aprovados: 20, consultas: 30, valor_vendas: 1000 }),
    L('2026-08-31', 'r1', '2026-08-01', { vendas: 12, aprovados: 22, consultas: 33, valor_vendas: 1200 }),
    L('2026-09-06', 'r1', '2026-08-01', { vendas: 12, aprovados: 22, consultas: 33, valor_vendas: 1200 }), // agosto ainda vem no retrato
    L('2026-09-06', 'r1', '2026-09-01', { vendas: 3, aprovados: 5, consultas: 8, valor_vendas: 300 }),
  ]
  const { linhas } = derivarSemana(serie, '2026-08-31', new Map())
  assert.equal(linhas[0].vendas, 2 + 3)
  assert.equal(linhas[0].aprovados, 2 + 5)
  assert.equal(linhas[0].consultas, 3 + 8)
  assert.equal(linhas[0].valor_vendas, 200 + 300)
})

test('derivarSemana: dia sem coleta usa o retrato anterior; delta negativo vira 0 com aviso', () => {
  const serie = [
    L('2026-09-05', 'r1', '2026-09-01', { vendas: 4, aprovados: 4, consultas: 4, valor_vendas: 400 }), // não tem 06/09
    L('2026-09-13', 'r1', '2026-09-01', { vendas: 3, aprovados: 6, consultas: 9, valor_vendas: 300 }), // AIVA cancelou 1 venda
  ]
  const { linhas, avisos } = derivarSemana(serie, '2026-09-07', new Map())
  assert.equal(linhas[0].vendas, 0)
  assert.equal(linhas[0].valor_vendas, 0)
  assert.equal(linhas[0].aprovados, 2)
  assert.equal(avisos.length, 1)
  assert.match(avisos[0], /negativo/)
})

test('derivarSemana: quem entra — atividade na semana ou venda na semana anterior', () => {
  const serie = [
    L('2026-09-06', 'r1', '2026-09-01', { vendas: 2 }),
    L('2026-09-13', 'r1', '2026-09-01', { vendas: 2 }),          // zerada nesta semana, mas vendeu na anterior → entra (segmento C)
    L('2026-09-06', 'r2', '2026-09-01', {}),
    L('2026-09-13', 'r2', '2026-09-01', {}),                     // zerada nas duas → fora
    L('2026-09-06', 'r3', '2026-09-01', {}),
    L('2026-09-13', 'r3', '2026-09-01', { consultas: 1 }),       // só consultou → entra (segmento A)
  ]
  const vendasAnt = new Map([['000000000000r1', 2]])
  const { linhas } = derivarSemana(serie, '2026-09-07', vendasAnt)
  assert.deepEqual(linhas.map((l) => l.rid).sort(), ['r1', 'r3'])
  assert.equal(linhas.find((l) => l.rid === 'r1')!.vendas, 0)
})

test('derivarSemana: sem retrato de domingo usa o de segunda com aviso; sem nenhum, erro', () => {
  const serie = [
    L('2026-09-06', 'r1', '2026-09-01', { vendas: 1 }),
    L('2026-09-14', 'r1', '2026-09-01', { vendas: 4 }),
  ]
  const { linhas, avisos } = derivarSemana(serie, '2026-09-07', new Map())
  assert.equal(linhas[0].vendas, 3)
  assert.match(avisos[0], /segunda/)
  assert.throws(() => derivarSemana([L('2026-09-06', 'r1', '2026-09-01', {})], '2026-09-07', new Map()), /retrato/)
})

test('derivarSemana: duas lojas do mesmo CNPJ viram uma linha (RID da que mais vendeu)', () => {
  const serie = [
    linha({ data_ref: '2026-09-06', retailer_id: 'a', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Loja A' }),
    linha({ data_ref: '2026-09-13', retailer_id: 'a', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Loja A', vendas: 1, valor_vendas: 100 }),
    linha({ data_ref: '2026-09-06', retailer_id: 'b', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Loja B' }),
    linha({ data_ref: '2026-09-13', retailer_id: 'b', mes: '2026-09-01', cnpj: '11111111000191', nome_varejo: 'Loja B', vendas: 3, valor_vendas: 300 }),
  ]
  const { linhas } = derivarSemana(serie, '2026-09-07', new Map())
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].vendas, 4)
  assert.equal(linhas[0].rid, 'b')
  assert.equal(linhas[0].loja, 'Loja B')
})
