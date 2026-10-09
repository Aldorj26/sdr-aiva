import assert from 'node:assert/strict'
import test from 'node:test'

import { conferir, parseDescricaoOpp, type ContaFunil11, type LinhaComissao } from './comissoes.ts'

const conta = (id: number, title: string, rid?: number, cnpj?: string): ContaFunil11 => ({
  id, title, mainphone: '',
  description: [rid != null ? `UME_RID: ${rid}` : '', cnpj ? `CNPJ: ${cnpj}` : ''].filter(Boolean).join('\n'),
})

const linha = (rid: number | null, cnpj: string | null, varejo: string, comissao = 100): LinhaComissao => ({
  retailer_id: rid, cnpj, varejo, grupo: 'INSIDE_SALES',
  contratos: 1, originacao: 1000, mdr: 100, comissao,
})

const vendeu = (cnpj: string, vendas: number) => ({ cnpj, aprovados: vendas, vendas, valor_vendas: vendas * 1000 })

test('parseDescricaoOpp lê UME_RID e CNPJ, cru ou com máscara', () => {
  assert.deepEqual(parseDescricaoOpp('UME_RID: 6433\nCNPJ: 55511062000150'),
    { umeRid: 6433, cnpj: '55511062000150' })
  assert.deepEqual(parseDescricaoOpp('CNPJ: 44.520.850/0001-96'),
    { umeRid: null, cnpj: '44520850000196' })
  assert.deepEqual(parseDescricaoOpp(null), { umeRid: null, cnpj: null })
})

test('conta que casa com o relatório fica comissionada', () => {
  const r = conferir([conta(1, 'Loja A', 10, '11111111111111')], [linha(10, '11111111111111', 'LOJA A')], [])
  assert.equal(r[0].estado, 'comissionada')
  assert.equal(r[0].divergencia, false)
  assert.equal(r[0].irmaComissionada, false)
})

test('conta sem linha e sem venda no portal é sem_venda, não divergência', () => {
  const r = conferir([conta(1, 'Loja A', 10, '11111111111111')], [], [])
  assert.equal(r[0].estado, 'sem_venda')
  assert.equal(r[0].divergencia, false)
})

test('conta sem linha MAS com venda no portal é divergência', () => {
  const r = conferir([conta(1, 'Loja A', 10, '11111111111111')], [], [vendeu('11111111111111', 3)])
  assert.equal(r[0].divergencia, true, 'omissão real da UME precisa acender o vermelho')
  assert.equal(r[0].irmaComissionada, false)
})

test('card gêmeo do mesmo Retailer ID NÃO é divergência (regressão set/26)', () => {
  // Goat/Caldas/Eletrocel e os cards duplicados: duas contas, um Retailer ID,
  // uma linha só no relatório. A linha fica com a primeira; a segunda ficava 🔴
  // mesmo com a loja comissionada. Em set/26 foram 10 alarmes falsos.
  const contas = [
    conta(1, 'Loja A - Loja 1', 10, '11111111111111'),
    conta(2, 'Loja A - Loja 2', 10, '22222222222222'),
  ]
  const r = conferir(contas, [linha(10, '11111111111111', 'LOJA A')], [vendeu('22222222222222', 5)])
  const gemeo = r.find((x) => x.opp?.id === 2)!
  assert.equal(gemeo.divergencia, false, 'a loja está no relatório, só sob o card irmão')
  assert.equal(gemeo.irmaComissionada, true)
  // e a comissão continua contada UMA vez
  assert.equal(r.filter((x) => x.estado === 'comissionada').length, 1)
})

test('gêmeo por CNPJ também não acende vermelho', () => {
  const contas = [conta(1, 'Loja B', 20, '33333333333333'), conta(2, 'Loja B duplicada', undefined, '33333333333333')]
  const r = conferir(contas, [linha(20, '33333333333333', 'LOJA B')], [vendeu('33333333333333', 2)])
  assert.equal(r.filter((x) => x.divergencia).length, 0)
})

test('linha do relatório sem conta nenhuma vira so_relatorio', () => {
  const r = conferir([], [linha(99, '44444444444444', 'SÓ NO RELATÓRIO')], [])
  assert.equal(r.length, 1)
  assert.equal(r[0].estado, 'so_relatorio')
  assert.equal(r[0].divergencia, false)
})

test('Retailer ID divergente impede o casamento por CNPJ (guarda Fone Express)', () => {
  // matriz e filial com o MESMO CNPJ e retailers diferentes: a matriz não pode
  // consumir a linha da irmã.
  const contas = [conta(1, 'Fone Express', 5167, '55555555555555')]
  const r = conferir(contas, [linha(5166, '55555555555555', 'PIRAPORA')], [])
  assert.equal(r[0].estado, 'sem_venda')
  assert.equal(r.some((x) => x.estado === 'so_relatorio'), true)
})

test('CNPJ pago sob OUTRO retailer não é divergência (regressão Dr. Reparo, set/26)', () => {
  // Nosso card diz 5334; a UME paga o mesmo CNPJ no retailer 6413, e a linha
  // não foi reivindicada por ninguém. A loja recebeu — o cadastro é que mente.
  const contas = [conta(1, 'Dr. Reparo Smart - Loja 2', 5334, '66980944000180')]
  const r = conferir(contas, [linha(6413, '66980944000180', 'KAIO ROMAO BOTELHO', 36)], [vendeu('66980944000180', 1)])
  const c = r.find((x) => x.opp?.id === 1)!
  assert.equal(c.divergencia, false, 'não mandar o time cobrar comissão que já foi paga')
  assert.equal(c.retailerDaUme, 6413, 'e dizer qual retailer a UME usa, pra corrigir o cadastro')
})

test('a guarda Fone Express continua valendo quando a linha irmã JÁ foi consumida', () => {
  // matriz 5167 e filial 5166 com o mesmo CNPJ: a linha da filial é da filial.
  const contas = [conta(1, 'Fone Express', 5167, '55555555555555'), conta(2, 'Pirapora', 5166, '55555555555555')]
  const r = conferir(contas, [linha(5166, '55555555555555', 'PIRAPORA')], [])
  const pirapora = r.find((x) => x.opp?.id === 2)!
  assert.equal(pirapora.estado, 'comissionada')
  const matriz = r.find((x) => x.opp?.id === 1)!
  assert.equal(matriz.retailerDaUme, null, 'linha já consumida pela dona não vira "outro retailer"')
})
