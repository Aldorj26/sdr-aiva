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
