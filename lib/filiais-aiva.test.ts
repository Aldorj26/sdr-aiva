import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLUNAS_FILIAL_AIVA, montarLinhaFilial, telefone55, pendenciasDaLinha, cidadeUf } from './filiais-aiva.ts'

const receita = {
  cep: '38600-422', logradouro: 'JOAQUIM MURTINHO', numero: 21, complemento: '', bairro: 'AMOREIRAS',
  municipio: 'PARACATU', uf: 'MG', razao_social: 'FONEEXPRESS LTDA', descricao_situacao_cadastral: 'ATIVA',
}
const completo = {
  cnpjFilial: '68.182.669/0001-85', cnpjMatriz: '65.870.629/0001-38', nomeLoja: 'FONEEXPRESS PARACATU',
  nomeOperador: 'Conrado Alves Pacheco', cpf: '11832778657', email: 'drconradoalves@gmail.com',
  telefone: '5538999132729', receita,
}

test('a linha sai na ORDEM e na grafia da aba Filiais', () => {
  // o Apps Script só faz append do array nessa ordem: se mudar, a planilha embaralha
  assert.deepEqual(Object.keys(montarLinhaFilial(completo)), [...COLUNAS_FILIAL_AIVA])
})

test('CNPJ e CPF saem só com dígitos; Cidade/UF vem da Receita', () => {
  const l = montarLinhaFilial(completo)
  assert.equal(l['CNPJ da Filial'], '68182669000185')
  assert.equal(l['CNPJ da Matriz'], '65870629000138')
  assert.equal(l['CPF'], '11832778657')
  assert.equal(l['Cidade/UF'], 'PARACATU/MG')
})

test('linha completa não tem pendência', () => {
  assert.equal(montarLinhaFilial(completo)['Pendencias'], '')
})

test('sem CPF, a pendência aparece na própria linha — é o campo que o fluxo não coleta', () => {
  const l = montarLinhaFilial({ ...completo, cpf: null })
  assert.match(l['Pendencias'], /falta CPF do operador/)
})

test('CNPJ irregular na Receita vira pendência (a AIVA reprova)', () => {
  const l = montarLinhaFilial({ ...completo, receita: { ...receita, descricao_situacao_cadastral: 'INAPTA' } })
  assert.match(l['Pendencias'], /INAPTA/)
})

test('CNPJ que não consta na Receita também avisa, e Cidade/UF fica vazia', () => {
  const l = montarLinhaFilial({ ...completo, receita: null })
  assert.equal(l['Cidade/UF'], '')
  assert.match(l['Pendencias'], /não encontrado na Receita/)
})

test('nome da loja cai pro nome da Receita quando a gente não tem', () => {
  assert.equal(montarLinhaFilial({ ...completo, nomeLoja: '' })['Loja'], 'FONEEXPRESS LTDA')
})

test('telefone vira 55DDD…', () => {
  assert.equal(telefone55('5538999132729'), '5538999132729')   // já vem do Evo assim
  assert.equal(telefone55('38999132729'), '5538999132729')     // digitado sem o 55
  assert.equal(telefone55('(38) 99913-2729'), '5538999132729')
  assert.equal(telefone55(''), '')
})

test('cidadeUf aguenta metade do dado', () => {
  assert.equal(cidadeUf({ municipio: 'BRUSQUE' }), 'BRUSQUE')
  assert.equal(cidadeUf(null), '')
})

test('pendenciasDaLinha lista tudo que falta, não só a primeira', () => {
  const p = pendenciasDaLinha({ cnpjFilial: '68182669000185', receita }, true)
  assert.ok(p.length >= 4, p.join(' | '))
})
