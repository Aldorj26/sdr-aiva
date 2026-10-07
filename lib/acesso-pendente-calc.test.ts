import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidir, lerMarcas, remontarObs, limparMarcas, texto } from './acesso-pendente-calc.ts'

const D = 86_400_000
const agora = Date.parse('2026-10-07T14:00:00Z') // quarta

test('toque 1 só depois de 2 dias úteis na coluna Pronto para operar', () => {
  const m = lerMarcas('')
  assert.deepEqual(decidir(m, agora - 1 * D, null, agora), { acao: 'nada', motivo: 'aguardando_2_dias_uteis' })
  assert.deepEqual(decidir(m, agora - 3 * D, null, agora), { acao: 'toque', toque: 1 })
  assert.deepEqual(decidir(m, null, null, agora), { acao: 'toque', toque: 1 })   // cadastro antigo sem data
})

test('toque 2 três dias depois; esgota dois dias depois do toque 2', () => {
  const t1 = lerMarcas(`[ACESSO_COBRANCA:1:${new Date(agora - 2 * D).toISOString()}]`)
  assert.equal(decidir(t1, null, null, agora).acao, 'nada')
  const t1b = lerMarcas(`[ACESSO_COBRANCA:1:${new Date(agora - 3 * D).toISOString()}]`)
  assert.deepEqual(decidir(t1b, null, null, agora), { acao: 'toque', toque: 2 })
  const t2 = lerMarcas(`[ACESSO_COBRANCA:2:${new Date(agora - 2 * D).toISOString()}]`)
  assert.deepEqual(decidir(t2, null, null, agora), { acao: 'esgotar' })
})

test('optout, pausa, esgotado e conversa viva não tocam', () => {
  assert.equal((decidir(lerMarcas('[DICAS_OPTOUT]'), null, null, agora) as { motivo: string }).motivo, 'optout')
  assert.equal((decidir(lerMarcas('[ACESSO_ESGOTADO:2026-10-01]'), null, null, agora) as { motivo: string }).motivo, 'esgotado')
  assert.equal((decidir(lerMarcas('[PAUSA_ATE:2026-10-09T00:00:00Z]'), null, null, agora) as { motivo: string }).motivo, 'pausa')
  assert.equal((decidir(lerMarcas(''), null, agora - 3600_000, agora) as { motivo: string }).motivo, 'conversa_viva')
})

test('marcadores: remonta um só e limpa quando acessou', () => {
  const o = remontarObs('x [ACESSO_COBRANCA:1:2026-10-01T00:00:00Z]', 2, new Date(agora))
  assert.equal((o.match(/ACESSO_COBRANCA/g) ?? []).length, 1)
  assert.match(o, /\[ACESSO_COBRANCA:2:/)
  assert.equal(limparMarcas('a [ACESSO_COBRANCA:2:x] [ACESSO_ESGOTADO:y]'), 'a')
  assert.equal(limparMarcas('a'), null)
})

test('textos sem quebra de linha (variável do HSM)', () => {
  for (const t of [texto(1), texto(2)]) assert.ok(!t.includes('\n'))
})
