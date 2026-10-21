import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectarLaco, ehSaidaRepetida, obsComLaco, normalizar, TETO_RESPOSTAS, REPETICOES, type MsgJanela } from './laco-bot-calc.ts'

const T0 = Date.parse('2026-10-21T11:52:00Z')
const min = (n: number) => new Date(T0 - n * 60_000).toISOString()
const out = (n: number, texto = `resposta ${n}`): MsgJanela => ({ direcao: 'out', conteudo: texto, template_hsm: null, enviado_em: min(n) })
const inn = (n: number, texto: string): MsgJanela => ({ direcao: 'in', conteudo: texto, enviado_em: min(n) })

test('bot de IA (texto sempre diferente): corta pelo teto de respostas na hora', () => {
  // Papo Reto Cell 21/10: 77 respostas em 46 min, textos todos distintos
  const msgs: MsgJanela[] = []
  for (let i = 0; i < 46; i++) { msgs.push(inn(i, `E aí, tudo certo? variação ${i} só PEÇAS`)); msgs.push(out(i, `Entendi ${i}`)) }
  const r = detectarLaco(msgs, T0)
  assert.equal(r.laco, true); assert.equal(r.laco && r.motivo, 'teto_respostas')
  // só as respostas da VictorIA contam: template/manual_humano não
  const soEspelho = msgs.map((m) => (m.direcao === 'out' ? { ...m, template_hsm: 'manual_humano' } : m))
  assert.equal(detectarLaco(soEspelho, T0).laco, false)
})

test('bot burro (mesma frase): corta pela repetição mesmo com poucas respostas', () => {
  const msgs = [inn(1, 'Olá! Em que posso ajudar?'), inn(3, 'ola em que posso ajudar'), inn(5, 'Olá!! Em que posso ajudar?'), inn(7, 'Olá! Em que posso ajudar?'), inn(9, 'Olá! Em que posso ajudar?'), inn(11, 'Olá! Em que posso ajudar?'), out(2), out(4), out(6), out(8), out(10)]
  const r = detectarLaco(msgs, T0)
  assert.equal(r.laco, true); assert.equal(r.laco && r.motivo, 'repeticao'); assert.equal(r.repeticaoMax, REPETICOES)
})

test('conversa humana intensa NÃO é laço (23 respostas/h, textos distintos, ok repetido 5x)', () => {
  const msgs: MsgJanela[] = []
  for (let i = 0; i < 23; i++) { msgs.push(inn(i * 2, i % 5 === 0 ? 'ok' : `dado ${i}`)); msgs.push(out(i * 2 + 1)) }
  const r = detectarLaco(msgs, T0)
  assert.equal(r.laco, false); assert.equal(r.respostas, 23); assert.equal(r.repeticaoMax, 5)
})

test('janela de 60 min: o que é mais velho não conta', () => {
  const velhas: MsgJanela[] = []
  for (let i = 0; i < TETO_RESPOSTAS; i++) velhas.push(out(61 + i))
  assert.equal(detectarLaco(velhas, T0).laco, false)
  const novas: MsgJanela[] = []
  for (let i = 0; i < TETO_RESPOSTAS; i++) novas.push(out(i))
  assert.equal(detectarLaco(novas, T0).laco, true)
})

test('obsComLaco grava marcador + pausa de 24h e troca os antigos', () => {
  const l = detectarLaco(Array.from({ length: TETO_RESPOSTAS }, (_, i) => out(i)), T0)
  assert.equal(l.laco, true)
  if (!l.laco) return
  const o1 = obsComLaco('[X] [PAUSA_ATE:2026-01-01T00:00:00.000Z]', l, new Date(T0))
  assert.match(o1, /^\[X\] \[LACO_BOT:teto_respostas:35r:0x:2026-10-21T11:52:00.000Z\] \[PAUSA_ATE:2026-10-22T11:52:00.000Z\]$/)
  const o2 = obsComLaco(o1, l, new Date(T0 + 60_000))
  assert.equal((o2.match(/PAUSA_ATE/g) ?? []).length, 1); assert.equal((o2.match(/LACO_BOT/g) ?? []).length, 1)
})

test('ehSaidaRepetida: mesmo texto nos últimos 10 min, em qualquer posição, é eco', () => {
  const saidas = [out(1, 'Oi, tudo bem? Sou a VictorIA'), out(0, 'outra coisa'), out(2, 'terceira')]
  assert.equal(ehSaidaRepetida('Oi, tudo bem? Sou a VictorIA', saidas, T0), true)   // não é a última: o dedup antigo deixava passar
  assert.equal(ehSaidaRepetida('texto novo', saidas, T0), false)
  assert.equal(ehSaidaRepetida('Oi, tudo bem? Sou a VictorIA', [out(11, 'Oi, tudo bem? Sou a VictorIA')], T0), false)  // 11 min: já não é eco
  assert.equal(normalizar('Olá!! Em que posso ajudar?'), 'olaemquepossoajudar')
})
