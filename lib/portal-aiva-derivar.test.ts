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
