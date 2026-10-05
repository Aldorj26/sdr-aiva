import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chaveTelefone, variantesTelefone, candidatos, vinculos } from './vinculo-portal-calc.ts'

test('telefone: 55, +, e nono dígito não mudam a chave', () => {
  assert.equal(chaveTelefone('+5511984441488'), '1184441488')
  assert.equal(chaveTelefone('5511984441488'), '1184441488')
  assert.equal(chaveTelefone('1184441488'), '1184441488')
  assert.equal(chaveTelefone('554288258679'), '4288258679')
  assert.equal(chaveTelefone(null), null)
  assert.equal(chaveTelefone('0000000000'), null)
  assert.deepEqual(variantesTelefone('+5511984441488'), ['551184441488', '5511984441488'])
})

const onb = (cnpj: string, phone: string | null, stage: string, rid: string | null = null) => ({ cnpj, phone_number: phone, stage, retailer_id: rid, legal_name: 'RAZAO' })

test('candidato: só CNPJ sem registro, com telefone, e cadastro que andou', () => {
  const reg = new Set(['33363773000191'])
  const c = candidatos([
    onb('33.363.773/0001-91', '+5511984441488', 'cadastro_finalizado', '1'),   // já registrado
    onb('61255811000128', '+5511984441488', 'cadastro_finalizado', '6798'),    // Gfourr
    onb('11111111000111', '+5511999990000', 'dados_varejo'),                    // só pré-cadastro
    onb('22222222000122', null, 'cadastro_finalizado', '9'),                    // sem telefone
    onb('33333333000133', '+5519983000619', 'biometria'),
  ], reg)
  assert.deepEqual(c.map((x) => x.cnpj), ['61255811000128', '33333333000133'])
})

test('vincula quando o telefone casa com UM lead vivo', () => {
  const cands = [onb('61255811000128', '+5511984441488', 'cadastro_finalizado', '6798')]
  const v = vinculos(cands, [{ id: 'L1', telefone: '5511984441488', status: 'EM_ANALISE_AIVA' }])
  assert.deepEqual(v, [{ leadId: 'L1', telefone: '5511984441488', cnpj: '61255811000128', rid: '6798', loja: 'RAZAO' }])
})

test('não vincula: telefone ambíguo, lead fora do funil ou sem lead', () => {
  const cands = [onb('61255811000128', '+5511984441488', 'cadastro_finalizado', '6798')]
  assert.equal(vinculos(cands, [{ id: 'A', telefone: '5511984441488', status: 'TREINAR' }, { id: 'B', telefone: '551184441488', status: 'INTERESSADO' }]).length, 0)
  assert.equal(vinculos(cands, [{ id: 'A', telefone: '5511984441488', status: 'DESCARTADO' }]).length, 0)
  assert.equal(vinculos(cands, [{ id: 'A', telefone: '5521984441488', status: 'TREINAR' }]).length, 0)
})
