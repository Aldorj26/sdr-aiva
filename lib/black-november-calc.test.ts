import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLACK_NOVEMBER, blackNovemberAtivo, grupoDoStatus, linhaComissaoBlackNovember, textoComunicado } from './black-november-calc.ts'
import { linhaComissaoVendedor, resumir } from './desempenho-loja-calc.ts'
import { textoDica } from './dicas-desempenho-calc.ts'

test('campanha vale de 01 a 30/11/2026, nem antes nem depois', () => {
  assert.equal(blackNovemberAtivo('2026-10-31'), false)
  assert.equal(blackNovemberAtivo('2026-11-01'), true)
  assert.equal(blackNovemberAtivo('2026-11-30'), true)
  assert.equal(blackNovemberAtivo('2026-12-01'), false)
})

test('grupo do comunicado: etapa 50 em diante; antes disso ninguém', () => {
  assert.equal(grupoDoStatus('EM_ANALISE_AIVA'), 'cadastro')
  for (const s of ['TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']) assert.equal(grupoDoStatus(s), 'vendendo')
  for (const s of ['INTERESSADO', 'PRE_APROVACAO', 'CADASTRO_RECEBIDO', 'NAO_QUALIFICADO', null]) assert.equal(grupoDoStatus(s), null)
})

test('textos: uma linha, com os valores e a condição do bônus; loja criada ouve "avise o time", cadastro ouve "falta a etapa"', () => {
  for (const g of ['vendendo', 'cadastro'] as const) {
    const t = textoComunicado(g)
    assert.doesNotMatch(t, /\n/)
    assert.match(t, /R\$ 20 garantidos/)
    assert.match(t, /R\$ 30 de bônus/)
    assert.match(t, /inadimplência da carteira da sua loja/)
    assert.match(t, /1 a 30\/11/)
    assert.ok(t.includes(BLACK_NOVEMBER.arte))
    assert.doesNotMatch(t, /^(Oi|Olá)/) // o template já sauda
    assert.ok(t.length < 520, `texto do grupo ${g} com ${t.length} chars`)
  }
  assert.match(textoComunicado('vendendo'), /avise seu time/)
  assert.match(textoComunicado('cadastro'), /em que pé está o seu cadastro/)
  assert.doesNotMatch(textoComunicado('cadastro'), /falta só|este mês/) // não diz que falta algo dele nem dá prazo da AIVA
  assert.doesNotMatch(textoComunicado('cadastro'), /avise seu time/)
})

test('bloco NÚMEROS DA LOJA: em novembro a linha 💰 é a da campanha pra loja velha e nova; em dezembro volta a regra do 1º mês', () => {
  assert.match(linhaComissaoVendedor({ cadastroEm: '2026-08-25' }, '2026-11-15'), /BLACK NOVEMBER/)
  assert.match(linhaComissaoVendedor({ cadastroEm: null }, '2026-11-01'), /BLACK NOVEMBER/)
  assert.match(linhaComissaoVendedor({ cadastroEm: '2026-08-25' }, '2026-12-01'), /ENCERRADA[^]*BLACK NOVEMBER[^]*NÃO é "encerrou"/)
  assert.match(linhaComissaoVendedor({ cadastroEm: null }, '2027-01-15'), /DESCONHECIDA[^]*BLACK NOVEMBER/)
  assert.doesNotMatch(linhaComissaoVendedor({ cadastroEm: '2026-08-25' }, '2027-02-01'), /BLACK NOVEMBER/)
  assert.match(linhaComissaoVendedor({ cadastroEm: '2026-08-25' }, '2026-10-31'), /ENCERRADA/)
})

test('dicas semanais em novembro citam a campanha (até R$ 50) e nunca os R$ 10 do 1º mês', () => {
  const nov = Date.parse('2026-11-16T14:00:00Z'), out = Date.parse('2026-10-23T14:00:00Z')
  const firme = resumir([{ semana: '2026-11-09', aprovados: 9, vendas: 4, valor_vendas: 5200 }, { semana: '2026-11-02', aprovados: 5, vendas: 2, valor_vendas: 2600 }], [], '2026-11-09', '2026-11')
  const parou = resumir([], [{ mes: '2026-10', consultas: 10, aprovados: 2, vendas: 1, valor_vendas: 1300 }], '2026-11-09', '2026-11')
  for (const r of [firme, parou]) {
    const comCampanha = [0, 1, 2, 3].map((c) => textoDica(r, c, nov))
    assert.ok(comCampanha.some((t) => /Black November/.test(t)), 'alguma variante cita a campanha')
    for (const t of comCampanha) { assert.doesNotMatch(t, /R\$ 10/); assert.ok(t.length < 330, `${t.length}`) }
    for (let c = 0; c < 4; c++) assert.doesNotMatch(textoDica(r, c, out), /Black November/)
  }
})

test('linha 💰 da campanha: até R$ 50, bônus condicionado, volta aos R$ 10 em dezembro, escalada por cobrança', () => {
  const l = linhaComissaoBlackNovember()
  assert.match(l, /BLACK NOVEMBER/)
  assert.match(l, /até R\$ 50/)
  assert.match(l, /SÓ se a inadimplência/)
  assert.match(l, /independe do primeiro mês/)
  assert.match(l, /dezembro volta a regra normal \(R\$ 10/)
  assert.match(l, /duvida_comissao_vendedor/)
})
