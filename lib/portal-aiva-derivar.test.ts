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
