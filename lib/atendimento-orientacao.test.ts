import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orientar, resumirFala, haQuanto } from './atendimento-orientacao.ts'

test('codigo do prompt: situacao e acao proprias', () => {
  const o = orientar('acesso_flexfone_nao_chegou')
  assert.match(o.situacao, /senha do s.cio n.o chegou/i)
  assert.match(o.acao, /Cobrar a AIVA/)
  assert.match(orientar('portal_nao_atualizou_cadastro').acao, /painel da AIVA/)
  assert.match(orientar('cadastro_caf_confirmado').acao, /Marcar Atendido/)
})

test('detalhe depois dos dois pontos vai junto da situacao', () => {
  const o = orientar('cliente_final_bloqueio_indevido: Thalita, comprou ha 2 meses')
  assert.match(o.situacao, /cliente final/i)
  assert.match(o.situacao, /Thalita, comprou ha 2 meses$/)
})

test('codigo inventado cai na familia certa e mostra o que ela escreveu', () => {
  const o = orientar('erro_vinculo_societario_persistente_apos_multiplas_tentativas')
  assert.match(o.situacao, /n.o reconhece o s.cio/)
  assert.match(o.situacao, /erro vinculo societario persistente/)
  assert.match(orientar('biometria_nao_abre_apos_multiplas_tentativas').acao, /Ligar e tentar junto/)
  assert.match(orientar('onboarding_travado_na_etapa_endereco').acao, /abrir com a AIVA/)
  assert.match(orientar('login_senha_corretos_mas_nao_entra').situacao, /login/i)
  assert.match(orientar('contato_transferido_para_socio').acao, /pessoa indicada/)
})

test('texto livre: mostra o texto e escolhe a acao', () => {
  const a = orientar('lead pediu contato por telefone/meet')
  assert.equal(a.situacao, 'Lead pediu contato por telefone/meet')
  assert.equal(a.acao, 'Ligar pro lojista.')
  const v = orientar('lead pediu visita presencial / consultor na loja: Geisa, Souza Celulares')
  assert.match(v.acao, /n.o fazemos visita/)
  assert.match(v.situacao, /Geisa, Souza Celulares$/)
})

test('sem motivo e motivo desconhecido', () => {
  assert.match(orientar('').situacao, /sem registrar o motivo/)
  assert.match(orientar(null).acao, /marcar Atendido/)
  const x = orientar('coisa_totalmente_nova')
  assert.equal(x.situacao, 'Coisa totalmente nova')
  assert.match(x.acao, /Ler a conversa/)
})

test('fala resumida e parado ha', () => {
  assert.equal(resumirFala('[LEAD_ENVIOU_IMAGEM:123]'), '📷 enviou uma imagem')
  assert.equal(resumirFala('  oi\n tudo   bem '), 'oi tudo bem')
  assert.equal(resumirFala('x'.repeat(200)).length, 110)
  const T = Date.parse('2026-10-05T15:00:00Z')
  assert.equal(haQuanto('2026-10-05T14:40:00Z', T), '20 min')
  assert.equal(haQuanto('2026-10-04T15:00:00Z', T), '24 h')
  assert.equal(haQuanto('2026-09-25T15:00:00Z', T), '10 dias')
  assert.equal(haQuanto(null, T), '—')
})
