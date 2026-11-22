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
  assert.equal(
    mensagemFilial({ tipo: 'recusado', erro: '422 raiz diferente' }, '60854022000221', { ok: true }),
    'O CNPJ 60.854.022/0002-21 é de outra empresa — aí o caminho é o cadastro de loja nova. Quer que eu registre essa empresa como nova loja na AIVA?',
  )
})

test('filial recusada por raiz: o texto segue a conferência de loja nova (elegível, não elegível, sem conferência)', () => {
  const rec = { tipo: 'recusado' as const, erro: '422 raiz diferente' }
  const nao = mensagemFilial(rec, '60854022000221', { ok: false, frase: 'Esse CNPJ tem menos de 1 ano de abertura (0,4 ano).' })
  assert.equal(nao, 'O CNPJ 60.854.022/0002-21 é de outra empresa, então não entra como filial — e, pela conferência, ele também não pode seguir como loja nova por aqui agora. Esse CNPJ tem menos de 1 ano de abertura (0,4 ano).')
  assert.doesNotMatch(nao, /Quer que eu registre/)
  const sem = mensagemFilial(rec, '60854022000221', null)
  assert.equal(sem, 'O CNPJ 60.854.022/0002-21 é de outra empresa, então não entra como filial. Me manda esse CNPJ de novo daqui a pouco que eu confiro se ele pode entrar como loja nova.')
  assert.equal(mensagemFilial(rec, '60854022000221'), sem) // sem conferência informada = reenviar
  // recusa que não é por raiz não muda
  assert.match(mensagemFilial({ tipo: 'recusado', erro: '422 CEP inválido' }, '60854022000221', { ok: true }), /endereço completo/)
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
