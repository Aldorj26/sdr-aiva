import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATALOGO, TIPOS, avisoVelho, RODAPE_PAINEL } from './avisos-painel-calc.ts'

test('aviso continua aberto enquanto o lead está na mesma etapa', () => {
  assert.equal(avisoVelho('EM_ANALISE_AIVA', 'EM_ANALISE_AIVA'), null)
  assert.equal(avisoVelho(null, 'TREINAR'), null)                 // sem etapa gravada: só fecha na mão
  assert.equal(avisoVelho('TREINAR', null), null)                 // lead não encontrado: não fecha sozinho
})

test('aviso fecha sozinho quando a etapa anda ou o lead sai do funil', () => {
  assert.match(avisoVelho('EM_ANALISE_AIVA', 'TREINAR')!, /etapa mudou \(EM_ANALISE_AIVA → TREINAR\)/)
  for (const s of ['DESCARTADO', 'OPT_OUT', 'NAO_QUALIFICADO']) assert.match(avisoVelho('EM_ANALISE_AIVA', s)!, /saiu do funil/)
  assert.match(avisoVelho(null, 'DESCARTADO')!, /saiu do funil/)
  // aviso pelo marcador: etapa mudar NÃO fecha; marcador sair fecha
  assert.equal(avisoVelho('TREINAR', 'LOJA_FINALIZADA_E_VENDENDO', 'cnpj_irregular', 'x [CNPJ_IRREGULAR_AIVA:inapta:2026-10-01]'), null)
  assert.match(avisoVelho('TREINAR', 'TREINAR', 'cnpj_irregular', 'x [CNPJ_CORRIGIDO:1]')!, /marcador saiu/)
  assert.match(avisoVelho('TREINAR', 'DESCARTADO', 'cnpj_invalido', '[CNPJ_PORTAL_INVALIDO:invalid:1]')!, /saiu do funil/)
})

test('catálogo: todo tipo tem título, o-que e ação, com ordem única', () => {
  const ordens = new Set<number>()
  for (const t of TIPOS) {
    const c = CATALOGO[t]
    assert.ok(c.titulo && c.oque && c.acao, t)
    assert.ok(!ordens.has(c.ordem), `ordem repetida em ${t}`)
    ordens.add(c.ordem)
  }
  assert.match(RODAPE_PAINEL, /\/atendimento$/)
})
