import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapearCnpjWs } from './cnpj-ws-calc.ts'

// Recorte do payload real da DB Tecnologia (55.817.303/0001-93), o caso de
// 14/10/2026 em que a BrasilAPI respondeu 500 e o cnpj.ws respondeu 200.
const PAYLOAD = {
  cnpj_raiz: '55817303',
  razao_social: 'DB COMERCIO ELETRONICOS LTDA',
  socios: [{ nome: 'FULANO DE TAL' }],
  estabelecimento: {
    cnpj: '55817303000193',
    nome_fantasia: 'DB TECNOLOGIA',
    situacao_cadastral: 'Ativa',
    data_inicio_atividade: '2024-07-05',
    tipo_logradouro: 'RUA',
    logradouro: 'LETACIO MONTENEGRO',
    numero: '8',
    bairro: 'CENTRO',
    cep: '55540000',
    cidade: { nome: 'Palmares' },
    estado: { sigla: 'PE' },
    atividade_principal: {
      id: '4752100',
      descricao: 'Comércio varejista especializado de equipamentos de telefonia e comunicação',
    },
  },
}

const AGORA = new Date('2026-10-14T12:00:00Z')

test('mapeia o payload do cnpj.ws no mesmo CNPJInfo da BrasilAPI', () => {
  const info = mapearCnpjWs('55817303000193', PAYLOAD, AGORA)
  assert.ok(info)
  assert.equal(info.cnpj, '55817303000193')
  assert.equal(info.razaoSocial, 'DB COMERCIO ELETRONICOS LTDA')
  assert.equal(info.nomeFantasia, 'DB TECNOLOGIA')
  assert.equal(info.abertura, '2024-07-05')
  assert.equal(info.idadeAnos, 2.3)
  assert.equal(info.cnae, '4752100')
  assert.equal(info.municipio, 'Palmares')
  assert.equal(info.uf, 'PE')
  assert.equal(info.cidadeUf, 'Palmares/PE')
  assert.equal(info.qsaCount, 1)
  assert.equal(info.endereco, 'RUA LETACIO MONTENEGRO, 8, CENTRO, Palmares/PE, CEP 55540000')
})

test('situação vem em maiúsculo — a trava de situação compara assim', () => {
  const ativa = mapearCnpjWs('55817303000193', PAYLOAD, AGORA)
  assert.equal(ativa?.situacao, 'ATIVA')

  const baixada = mapearCnpjWs('55817303000193', {
    ...PAYLOAD,
    estabelecimento: { ...PAYLOAD.estabelecimento, situacao_cadastral: 'Baixada' },
  }, AGORA)
  assert.equal(baixada?.situacao, 'BAIXADA')
})

test('CNPJ novo demais: a idade sai do payload, não de um palpite', () => {
  const info = mapearCnpjWs('55817303000193', {
    ...PAYLOAD,
    estabelecimento: { ...PAYLOAD.estabelecimento, data_inicio_atividade: '2026-08-20' },
  }, AGORA)
  assert.equal(info?.idadeAnos, 0.2) // ~55 dias — bem abaixo do corte de 1 ano
})

test('payload que não serve vira null — não inventa dado faltante', () => {
  assert.equal(mapearCnpjWs('55817303000193', null, AGORA), null)
  assert.equal(mapearCnpjWs('55817303000193', {}, AGORA), null)
  assert.equal(
    mapearCnpjWs('55817303000193', { ...PAYLOAD, estabelecimento: { cnpj: '55817303000193' } }, AGORA),
    null,
    'sem data de abertura não dá pra avaliar a regra de 1 ano',
  )
})
