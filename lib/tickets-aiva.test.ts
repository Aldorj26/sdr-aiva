import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerMotivoRepasse, lerMotivoFilial, classificarAbertura, mensagemFilial, eventosDoTicket, avisoLojista, gravarTicketNoLead, lerTicketsDoLead, blocoPromptTickets, type TicketApi } from './tickets-aiva.ts'

test('motivo de repasse: vendas com e sem valor, observação; vazio = null', () => {
  assert.deepEqual(lerMotivoRepasse('abrir_ticket_repasse: vendas=123456:950,40;789012 | obs=não caiu'), { vendas: [{ numero: '123456', valor: '950,40' }, { numero: '789012' }], observacoes: 'não caiu' })
  assert.deepEqual(lerMotivoRepasse('abrir_ticket_repasse: obs=valor veio menor'), { vendas: [], observacoes: 'valor veio menor' })
  assert.equal(lerMotivoRepasse('abrir_ticket_repasse:'), null)
  assert.equal(lerMotivoRepasse('outra_coisa'), null)
})

test('motivo de filial: CNPJ com pontuação e número; sem número = null', () => {
  assert.deepEqual(lerMotivoFilial('Abrir_Ticket_Filial: cnpj=60.854.022/0002-21 | numero=150 | complemento=sala 2'), { cnpj: '60854022000221', numero: '150', complemento: 'sala 2' })
  assert.equal(lerMotivoFilial('abrir_ticket_filial: cnpj=60854022000221'), null)
})

test('respostas de abertura', () => {
  assert.equal(classificarAbertura(201, { ticket_number: 1042 }).tipo, 'criado')
  assert.deepEqual(classificarAbertura(409, { ticket_number: 1042, error: 'já existe' }), { tipo: 'ja_existe', numero: 1042 })
  assert.equal(classificarAbertura(422, { error: 'filial com raiz diferente da matriz' }).tipo, 'recusado')
  assert.equal(classificarAbertura(422, { error: 'varejo não elegível' }).tipo, 'nao_elegivel')
  assert.equal(classificarAbertura(404, { error: 'varejo não encontrado' }).tipo, 'nao_elegivel')
  assert.equal(classificarAbertura(503, { error: 'Receita indisponível' }).tipo, 'falha')
  assert.match(mensagemFilial({ tipo: 'recusado', erro: '422 raiz diferente' }, '60854022000221'), /outra empresa/)
})

test('acompanhamento: resolvido avisa o lojista uma vez; resposta da AIVA só vira evento', () => {
  const t: TicketApi = { id: 'x', number: 1036, type: 'Acesso ao Painel Financeiro', status: 'resolvido', retailer_id: '5904', cnpj: null, created_at: '', updated_at: '', messages: [{ id: 'm', from: 'aiva', body: 'liberado', created_at: '2026-10-13' }] }
  const ev = eventosDoTicket(t, { status: 'aberto', msgsAiva: 0 })
  assert.equal(ev[0].tipo, 'resolvido')
  assert.match(avisoLojista(t, ev[0])!, /painel financeiro.*e-mail/)
  assert.deepEqual(eventosDoTicket(t, { status: 'resolvido', msgsAiva: 1 }), [])
  const aguard = { ...t, status: 'aguardando_parceiro' }
  assert.equal(eventosDoTicket(aguard, { status: 'aberto', msgsAiva: 0 })[0].tipo, 'aguardando')
  assert.equal(avisoLojista(aguard, { tipo: 'aguardando' }), null)
})

test('marcador do lead e bloco da VictorIA', () => {
  let o = gravarTicketNoLead('[X:1]', { number: 1042, type: 'Cadastro de filial', status: 'aberto', msgsAiva: 0 })
  o = gravarTicketNoLead(o, { number: 1042, type: 'Cadastro de filial', status: 'em_analise', msgsAiva: 1 })
  assert.equal(lerTicketsDoLead(o).get(1042)?.status, 'em_analise')
  assert.equal((o.match(/TICKET_AIVA:1042/g) ?? []).length, 1)
  assert.match(blocoPromptTickets(o)!, /ticket nº 1042 \(Cadastro de filial\): em análise/)
  assert.equal(blocoPromptTickets('[X:1]'), null)
})
