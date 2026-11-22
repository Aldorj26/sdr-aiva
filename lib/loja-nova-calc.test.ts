import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  raizCnpj, classificar, ridDaRaiz, ehAtalhoNovaLoja, elegibilidade, deveAbrirFluxo, lerMotivoLojaNova,
  marcadorLojaNova, blocoPromptLojaNova, textoLinkLojaNova, textoLojaCriada, seloRegistroFila,
} from './loja-nova-calc.ts'

test('raiz e classificação', () => {
  assert.equal(raizCnpj('32.306.162/0001-49'), '32306162')
  assert.equal(raizCnpj('123'), '')
  assert.equal(classificar('59218413000190', ['32306162000149']), 'outra_empresa')
  assert.equal(classificar('32306162000220', ['32306162000149']), 'filial')
  assert.equal(classificar('32306162000149', ['32306162000149']), 'conhecido')
})
test('filial da segunda empresa usa o RID da mesma raiz', () => {
  const regs = [{ cnpj: '32306162000149', rid: '7933', tipo: 'matriz' }, { cnpj: '59218413000190', rid: '9001', tipo: 'adicional' }]
  assert.equal(ridDaRaiz('59218413000271', regs), '9001')
  assert.equal(ridDaRaiz('32306162000220', regs), '7933')
  assert.equal(ridDaRaiz('11111111000191', regs), null)
})
test('atalho', () => {
  for (const t of ['NOVA LOJA', 'nova loja', ' Nova  Loja! ', 'quero nova loja']) assert.ok(ehAtalhoNovaLoja(t), t)
  for (const t of ['a loja nova do vizinho fechou e eu comprei o estoque todo dele ontem', '', null]) assert.ok(!ehAtalhoNovaLoja(t), String(t))
})
test('elegibilidade', () => {
  assert.deepEqual(elegibilidade({ situacao: 'ATIVA', idadeAnos: 3, odres: false, jaNaAiva: null }), { ok: true })
  assert.equal((elegibilidade({ situacao: 'INAPTA', idadeAnos: 3, odres: false, jaNaAiva: null }) as any).motivo, 'nao_ativa')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 0.4, odres: false, jaNaAiva: null }) as any).motivo, 'menos_de_1_ano')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 3, odres: true, jaNaAiva: null }) as any).motivo, 'odres')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 3, odres: false, jaNaAiva: 'biometria' }) as any).motivo, 'ja_na_aiva')
  assert.equal((elegibilidade({ situacao: null, idadeAnos: null, odres: false, jaNaAiva: null }) as any).motivo, 'receita_indisponivel')
})
test('só abre com loja principal criada, outra empresa e fora do papo de repasse', () => {
  assert.ok(deveAbrirFluxo({ status: 'LOJA_FINALIZADA_E_VENDENDO', classe: 'outra_empresa', contextoRepasse: false }))
  assert.ok(!deveAbrirFluxo({ status: 'LOJA_FINALIZADA_E_VENDENDO', classe: 'outra_empresa', contextoRepasse: true }))
  assert.ok(!deveAbrirFluxo({ status: 'EM_ANALISE_AIVA', classe: 'outra_empresa', contextoRepasse: false }))
  assert.ok(!deveAbrirFluxo({ status: 'LOGIN', classe: 'filial', contextoRepasse: false }))
})
test('motivo', () => {
  assert.deepEqual(lerMotivoLojaNova('loja_nova_empresa: cnpj=59.218.413/0001-90 | acao=confirmar | socio=mesmo'),
    { cnpj: '59218413000190', acao: 'confirmar', socioNome: null, socioTelefone: null })
  assert.deepEqual(lerMotivoLojaNova('loja_nova_empresa: cnpj=59218413000190 | acao=confirmar | socio=Maria Souza | tel=(21) 96500-2926'),
    { cnpj: '59218413000190', acao: 'confirmar', socioNome: 'Maria Souza', socioTelefone: '5521965002926' })
  assert.equal(lerMotivoLojaNova('loja_nova_empresa: cnpj=59218413000190 | acao=cancelar')?.acao, 'cancelar')
  assert.equal(lerMotivoLojaNova('loja_nova_empresa: cnpj=123 | acao=confirmar'), null)
  assert.equal(lerMotivoLojaNova('abrir_ticket_filial: cnpj=59218413000190 | numero=1'), null)
})
test('bloco do prompt: elegível pede confirmação e sócio; inelegível proíbe pedido; sem marcador = null', () => {
  const ok = blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: true }, '2026-11-19T12:00:00Z')}`, Date.parse('2026-11-19T13:00:00Z'))!
  assert.match(ok, /59\.218\.413\/0001-90/); assert.match(ok, /loja_nova_empresa: cnpj=/); assert.doesNotMatch(ok, /retail-onboarding-hub/)
  const ruim = blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: false, motivo: 'menos_de_1_ano', detalhe: '0,4 ano' }, '2026-11-19T12:00:00Z')}`, Date.parse('2026-11-19T13:00:00Z'))!
  assert.match(ruim, /NÃO abra pedido/i)
  assert.equal(blocoPromptLojaNova('sem nada'), null)
  // marcador com mais de 7 dias não instrui mais
  assert.equal(blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: true }, '2026-11-01T12:00:00Z')}`, Date.parse('2026-11-19T13:00:00Z')), null)
})
test('textos ao lojista: link com o CNPJ, sem prazo', () => {
  const t = textoLinkLojaNova('59218413000190', 'ACME LTDA')
  assert.match(t, /https:\/\/retail-onboarding-hub\.vercel\.app\//); assert.match(t, /59\.218\.413\/0001-90/)
  for (const s of [t, textoLojaCriada('ACME LTDA')]) assert.doesNotMatch(s, /\b(hoje|amanhã|\d+ ?(h|horas|dias))\b/i)
})
test('selo da fila: só o fluxo ganha selo; sócio nulo = mesmo sócio', () => {
  assert.equal(seloRegistroFila({ fluxo: null }), null)
  assert.equal(seloRegistroFila({}), null)
  assert.deepEqual(seloRegistroFila({ fluxo: 'loja_nova_empresa' }), { selo: 'loja nova de cliente ativo', socio: 'mesmo sócio' })
  assert.equal(seloRegistroFila({ fluxo: 'loja_nova_empresa', socio_nome: 'Maria', socio_telefone: '5521965002926' })?.socio, 'sócio: Maria (5521965002926)')
  assert.equal(seloRegistroFila({ fluxo: 'loja_nova_empresa', socio_nome: 'Maria' })?.socio, 'sócio: Maria')
})
