import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLUNAS_FILIAL_AIVA, montarLinhaFilial, telefone55, pendenciasDaLinha } from './filiais-aiva.ts'

const receita = {
  cep: '38600-422', logradouro: 'JOAQUIM MURTINHO', numero: 21, complemento: '', bairro: 'AMOREIRAS',
  municipio: 'PARACATU', uf: 'MG', razao_social: 'FONEEXPRESS LTDA', descricao_situacao_cadastral: 'ATIVA',
}

test('a linha sai na ORDEM e na grafia do modelo do Mauricio', () => {
  const l = montarLinhaFilial({ cnpjFilial: '68182669000185', receita })
  // colar na aba depende dessa ordem: se mudar, a planilha embaralha
  assert.deepEqual(Object.keys(l), [...COLUNAS_FILIAL_AIVA])
})

test('endereço vem da Receita e o CNPJ sai só com dígitos', () => {
  const l = montarLinhaFilial({
    cnpjFilial: '68.182.669/0001-85', cnpjMatriz: '65.870.629/0001-38',
    nomeLoja: 'FONEEXPRESS PARACATU', receita,
  })
  assert.equal(l['CEP'], '38600422')
  assert.equal(l['BAIRRO'], 'AMOREIRAS')
  assert.equal(l['NÚMERO'], '21')
  assert.equal(l['CNPJ DA FILIAL'], '68182669000185')
  assert.equal(l['CNPJ DA MATRIZ'], '65870629000138')
})

test('sem Receita, endereço fica VAZIO — nunca inventado', () => {
  const l = montarLinhaFilial({ cnpjFilial: '68182669000185', nomeLoja: 'X', receita: null })
  for (const c of ['CEP', 'LOGRADOURO', 'NÚMERO', 'COMPLEMENTO', 'BAIRRO', 'CIDADE', 'UF']) assert.equal(l[c], '')
})

test('nome da loja cai pro nome da Receita quando a gente não tem', () => {
  assert.equal(montarLinhaFilial({ cnpjFilial: '68182669000185', receita })['NOME DA LOJA'], 'FONEEXPRESS LTDA')
})

test('telefone vira 55DDD…', () => {
  assert.equal(telefone55('5538999132729'), '5538999132729')   // já vem do Evo assim
  assert.equal(telefone55('38999132729'), '5538999132729')     // digitado sem o 55
  assert.equal(telefone55('(38) 99913-2729'), '5538999132729')
  assert.equal(telefone55(''), '')
})

test('pendências dizem o que impede o envio — CPF é a que sempre aparece', () => {
  const l = montarLinhaFilial({
    cnpjFilial: '68182669000185', cnpjMatriz: '65870629000138', nomeLoja: 'FONEEXPRESS',
    nomeOperador: 'Conrado Alves Pacheco', email: 'x@y.com', telefone: '5538999132729', receita,
  })
  const p = pendenciasDaLinha(l, true)
  assert.equal(p.length, 1)
  assert.match(p[0], /CPF/)
  // com CPF, a linha fica pronta
  const ok = pendenciasDaLinha({ ...l, 'CPF (SÓ NUMEROS)': '11832778657' }, true)
  assert.deepEqual(ok, [])
})

test('Receita fora do ar entra como pendência própria', () => {
  const l = montarLinhaFilial({ cnpjFilial: '68182669000185', cnpjMatriz: '65870629000138', nomeLoja: 'X',
    nomeOperador: 'Y', cpf: '11832778657', email: 'x@y.com', telefone: '5538999132729', receita: null })
  assert.match(pendenciasDaLinha(l, false).join(' '), /endereço não veio da Receita/)
})
