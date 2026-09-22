import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirDescarte, type Sinais } from './descarte-calc.ts'

const base: Sinais = { temRegistro: true, temCard: true, enviosNossos: 5, silencioDias: null, etapaCard: 53, nomeEtapa: 'Sem resposta' }
const rec = (s: Partial<Sinais>) => decidirDescarte({ ...base, ...s }).recomendacao

test('sem sinal nenhum de vida → pode descartar', () => {
  assert.equal(rec({}), 'PODE DESCARTAR')
  assert.equal(rec({ temRegistro: false, temCard: false }), 'PODE DESCARTAR')
})

test('loja operando trava o descarte em qualquer variação', () => {
  assert.equal(rec({ vendas: 3 }), 'NÃO DESCARTAR')
  assert.equal(rec({ consultas: 12 }), 'NÃO DESCARTAR')
  assert.equal(rec({ rid: '5819' }), 'NÃO DESCARTAR')
  assert.equal(rec({ registroAtiva: true }), 'NÃO DESCARTAR')
  assert.equal(rec({ biometria: 'aprovado' }), 'NÃO DESCARTAR')
  assert.equal(rec({ stagePortal: 'cadastro_finalizado' }), 'NÃO DESCARTAR')
  assert.equal(rec({ statusLead: 'LOJA_FINALIZADA_E_VENDENDO' }), 'NÃO DESCARTAR')
})

test('"dados_varejo" NÃO é avanço — é o formulário parado', () => {
  assert.equal(rec({ stagePortal: 'dados_varejo' }), 'PODE DESCARTAR')
})

test('AS DUAS LISTAS PRECISAM CONCORDAR, e avanço real ≠ card parado', () => {
  // a divergência de 22/09: um script tratava 50 como viva, o outro não, e a
  // mesma loja saía "PODE DESCARTAR" numa planilha e "CONFERIR" na outra.
  // ⚠️ Mas 50 não é avanço: o card entra ali e FICA até alguém mover, então
  // lojista que sumiu há 4 meses continua em 50. É CONFERIR, não trava.
  // ⚠️ E card em curso só pesa com esforço investido junto (dados entregues ou
  // conversa recente). Sozinho, marcava 166 de 230 como "conferir" — e card
  // parado em "Em Análise AIVA" é a DEFINIÇÃO daquela lista, não um sinal.
  assert.equal(rec({ etapaCard: 50, nomeEtapa: 'Em Análise AIVA' }), 'PODE DESCARTAR')
  assert.equal(rec({ etapaCard: 50, nomeEtapa: 'Em Análise AIVA', deuOsDados: true }), 'CONFERIR')
  assert.equal(rec({ etapaCard: 50, nomeEtapa: 'Em Análise AIVA', silencioDias: 40 }), 'CONFERIR')
  assert.equal(rec({ etapaCard: 47, nomeEtapa: 'Interessado', deuOsDados: true }), 'CONFERIR')
  assert.equal(rec({ etapaCard: 54, nomeEtapa: 'Pré Aprovação', deuOsDados: true }), 'CONFERIR')
  // dados entregues há muito tempo, sem conversa: não segura mais nada
  assert.equal(rec({ etapaCard: 53, nomeEtapa: 'Sem resposta', deuOsDados: true, silencioDias: 120 }), 'PODE DESCARTAR')
  // avanço de verdade trava
  assert.equal(rec({ etapaCard: 51, nomeEtapa: 'Vendendo' }), 'NÃO DESCARTAR')
  assert.equal(rec({ etapaCard: 71, nomeEtapa: 'Login' }), 'NÃO DESCARTAR')
  assert.equal(rec({ etapaCard: 70, nomeEtapa: 'Treinar' }), 'NÃO DESCARTAR')
  assert.equal(rec({ etapaCard: 49, nomeEtapa: 'Cadastro Recebido' }), 'NÃO DESCARTAR')
  // etapas finais não travam
  for (const [e, n] of [[53, 'Sem resposta'], [95, 'Descartada pela Aiva'], [94, 'CNPJ Irregular']] as const) {
    assert.equal(rec({ etapaCard: e, nomeEtapa: n }), 'PODE DESCARTAR', `etapa ${n}`)
  }
})

test('encerramento enviado desfaz a trava do card, mas manda mover o card', () => {
  // card em etapa AVANÇADA + despedida: deixa de ser trava e vira "mover o card"
  const v = decidirDescarte({ ...base, etapaCard: 70, nomeEtapa: 'Treinar', despedidaEm: '2026-09-15T01:40:00Z', silencioDias: 45 })
  assert.equal(v.recomendacao, 'CONFERIR')
  assert.equal(v.cardPrecisaMover, true)
  assert.match(v.motivos.join(' '), /mover o card/)
  // sem despedida, o mesmo caso é trava
  const semDespedida = decidirDescarte({ ...base, etapaCard: 70, nomeEtapa: 'Treinar', silencioDias: 45 })
  assert.equal(semDespedida.recomendacao, 'NÃO DESCARTAR')
  assert.equal(semDespedida.cardPrecisaMover, false)
  // o caso real dos 35: encerrado e parado em Em Análise AIVA
  const real = decidirDescarte({ ...base, etapaCard: 50, nomeEtapa: 'Em Análise AIVA', despedidaEm: '2026-09-15T01:40:00Z', silencioDias: 45, stagePortal: 'dados_varejo' })
  assert.equal(real.recomendacao, 'CONFERIR')
  assert.equal(real.cardPrecisaMover, true)
})

test('silêncio: até 3 dias trava, de 4 a 30 confere, acima disso não pesa', () => {
  assert.equal(rec({ silencioDias: 0 }), 'NÃO DESCARTAR')
  assert.equal(rec({ silencioDias: 3 }), 'NÃO DESCARTAR')
  assert.equal(rec({ silencioDias: 4 }), 'CONFERIR')
  assert.equal(rec({ silencioDias: 30 }), 'CONFERIR')
  assert.equal(rec({ silencioDias: 31 }), 'PODE DESCARTAR')
  assert.equal(rec({ silencioDias: 160 }), 'PODE DESCARTAR')
})

test('filial de lojista que já vende nunca é descarte automático', () => {
  assert.equal(rec({ outraLojaAtiva: ['12345678000199'] }), 'NÃO DESCARTAR')
})

test('funil 19, base Odres e CNPJ inválido pedem olho humano', () => {
  assert.equal(rec({ noFunil19: ['#18557'] }), 'CONFERIR')
  assert.equal(rec({ baseOdres: true }), 'CONFERIR')
  assert.equal(rec({ dvInvalido: true }), 'CONFERIR')
  assert.equal(rec({ achadoSoPorTelefone: true }), 'CONFERIR')
})

test('trava vence conferir quando os dois aparecem', () => {
  const v = decidirDescarte({ ...base, vendas: 2, noFunil19: ['#1'], dvInvalido: true })
  assert.equal(v.recomendacao, 'NÃO DESCARTAR')
  assert.ok(v.motivos.length >= 3, 'todos os motivos são registrados, não só o vencedor')
})

test('o motivo do "pode descartar" diz por quê, sem inventar', () => {
  assert.match(decidirDescarte({ ...base, temRegistro: false, temCard: false }).motivos.join(' '), /não é oportunidade nossa/)
  assert.match(decidirDescarte({ ...base, enviosNossos: 0 }).motivos.join(' '), /nunca trabalhado/)
  assert.match(decidirDescarte({ ...base, enviosNossos: 9, silencioDias: 90 }).motivos.join(' '), /9 mensagens nossas.*90 dias/)
})
