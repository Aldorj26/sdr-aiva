import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avaliarEntrega, entregaDoChat, textoAlerta, MIN_AMOSTRA } from './entrega-meta-calc.ts'

const DE = '2026-09-22T03:00:00Z'
const ATE = '2026-09-22T20:00:00Z'

test('amostra pequena não vira alerta (nem ok)', () => {
  assert.equal(avaliarEntrega(0, 0).estado, 'sem_dados')
  assert.equal(avaliarEntrega(MIN_AMOSTRA - 1, 0).estado, 'sem_dados')
  // 0 de 11 é assustador, mas 11 envios não é amostra — dia de fila vazia não grita
  assert.equal(avaliarEntrega(11, 0).taxa, null)
})

test('lote saudável passa; apagão de 21/09 grita', () => {
  assert.equal(avaliarEntrega(30, 27).estado, 'ok')       // 90% — dia normal
  assert.equal(avaliarEntrega(30, 26).estado, 'ok')       // 87% — dia normal
  assert.equal(avaliarEntrega(30, 15).estado, 'ok')       // 50% cravado ainda passa
  assert.equal(avaliarEntrega(30, 14).estado, 'alerta')   // abaixo do piso
  assert.equal(avaliarEntrega(30, 0).estado, 'alerta')    // 22/09: zero entregue
})

test('entregaDoChat: recibo da Meta é clientrcvtime', () => {
  const entregue = [{ direction: 2, srvrcvtime: '2026-09-22T12:33:50.000Z', clientrcvtime: '2026-09-22T12:33:52.000Z' }]
  const barrado = [{ direction: 2, srvrcvtime: '2026-09-22T12:33:50.000Z', clientrcvtime: null }]
  assert.equal(entregaDoChat(entregue, DE, ATE), 'entregue')
  assert.equal(entregaDoChat(barrado, DE, ATE), 'nao_entregue')
  assert.equal(entregaDoChat([], DE, ATE), 'sem_template')
})

test('mensagem do lojista (direction 1) e do atendente (3) não contam', () => {
  const msgs = [
    { direction: 1, srvrcvtime: '2026-09-22T13:00:00.000Z', clientrcvtime: '2026-09-22T13:00:00.000Z' },
    { direction: 3, srvrcvtime: '2026-09-22T13:01:00.000Z', clientrcvtime: null },
  ]
  assert.equal(entregaDoChat(msgs, DE, ATE), 'sem_template')
})

test('template de ONTEM não entra na janela de hoje', () => {
  const ontem = [{ direction: 2, srvrcvtime: '2026-09-21T16:00:00.000Z', clientrcvtime: null }]
  assert.equal(entregaDoChat(ontem, DE, ATE), 'sem_template')
})

test('reenvio no mesmo dia conta como entregue — senão o conserto vira falha', () => {
  // foi o caso real de 22/09: barrado de manhã, reenviado à tarde depois do pagamento
  const msgs = [
    { direction: 2, srvrcvtime: '2026-09-22T12:33:50.000Z', clientrcvtime: null },
    { direction: 2, srvrcvtime: '2026-09-22T17:56:55.000Z', clientrcvtime: '2026-09-22T17:57:08.000Z' },
  ]
  assert.equal(entregaDoChat(msgs, DE, ATE), 'entregue')
})

test('o alerta manda olhar a fatura antes da qualidade do número', () => {
  const v = avaliarEntrega(30, 0)
  assert.equal(v.estado, 'alerta')
  const t = textoAlerta(v as Extract<ReturnType<typeof avaliarEntrega>, { estado: 'alerta' }>, 415)
  assert.match(t, /Cobrança e pagamentos/)
  assert.match(t, /131042/)
  assert.ok(t.indexOf('Cobrança e pagamentos') < t.indexOf('Qualidade'), 'fatura tem que vir antes da qualidade')
  assert.match(t, /0 de 30 entregues \(0%\)/)
  assert.match(t, /415 templates/)
})

test('apagão que começa no meio do dia NÃO pode ser mascarado pelo template da manhã', () => {
  // é o dia 1 da falha — o dia que importa. Com `.some()` isto dava "entregue".
  const msgs = [
    { direction: 2, srvrcvtime: '2026-09-22T12:00:00.000Z', clientrcvtime: '2026-09-22T12:00:03.000Z' },
    { direction: 2, srvrcvtime: '2026-09-22T18:00:00.000Z', clientrcvtime: null },
  ]
  assert.equal(entregaDoChat(msgs, DE, ATE), 'nao_entregue')
})

test('ordem embaralhada não muda o veredito (ordena por srvrcvtime)', () => {
  const msgs = [
    { direction: 2, srvrcvtime: '2026-09-22T18:00:00.000Z', clientrcvtime: '2026-09-22T18:00:02.000Z' },
    { direction: 2, srvrcvtime: '2026-09-22T12:00:00.000Z', clientrcvtime: null },
  ]
  assert.equal(entregaDoChat(msgs, DE, ATE), 'entregue')
})
