import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidir, lerMarcadores, remontarObs, miolo, montarFila, soRespostaAutomatica, saudacaoRetomada, SILENCIO_MAX_DIAS, ORCAMENTO_DIA, ROTULO, restanteHoje,
  MIOLOS_COM_DADOS, MIOLOS_SEM_DADOS, SILENCIO_DIAS, DIAS_ENTRE_TOQUES, MAX_TOQUES,
  MIOLOS_OFERTA, perfilQuente, SILENCIO_DESCARTE_DIAS, DIAS_DESCARTE_POS_T3,
} from './retomada-interessado-calc.ts'

const DIA = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-09-18T14:00:00Z')   // 11h BRT
const iso = (ms: number) => new Date(ms).toISOString()

test('miolos: 2 toques de cada tipo, uma linha, sem link', () => {
  for (const lista of [MIOLOS_COM_DADOS, MIOLOS_SEM_DADOS]) {
    assert.equal(lista.length, MAX_TOQUES)
    for (const m of lista) { assert.doesNotMatch(m, /\n/); assert.doesNotMatch(m, /https?:\/\//); assert.ok(m.length < 320) }
  }
})

test('conversa viva nao e tocada', () => {
  const m = lerMarcadores(null, T0)
  assert.deepEqual(decidir(m, 0, T0), { acao: 'nada', motivo: 'conversa_viva' })
  assert.deepEqual(decidir(m, SILENCIO_DIAS - 1, T0), { acao: 'nada', motivo: 'conversa_viva' })
  assert.deepEqual(decidir(m, SILENCIO_DIAS, T0), { acao: 'enviar', toque: 1 })
})

test('dois toques e acabou — nunca vira cutucada eterna', () => {
  const o1 = remontarObs(null, { toque: 1 }, new Date(T0))
  // logo depois do toque 1 nao manda de novo
  assert.deepEqual(decidir(lerMarcadores(o1, T0 + DIA), 30, T0 + DIA), { acao: 'nada', motivo: `aguardando D+${DIAS_ENTRE_TOQUES}` })
  const t2 = T0 + DIAS_ENTRE_TOQUES * DIA
  assert.deepEqual(decidir(lerMarcadores(o1, t2), 30, t2), { acao: 'enviar', toque: 2 })
  const o2 = remontarObs(o1, { toque: 2 }, new Date(t2))
  const t3 = t2 + 30 * DIA
  assert.deepEqual(decidir(lerMarcadores(o2, t3), 40, t3), { acao: 'encerrar' })
  const o3 = remontarObs(o2, { encerrar: true })
  // encerrado e não quente: só espera chegar aos 60 dias de silêncio (22/10/2026)
  assert.deepEqual(decidir(lerMarcadores(o3, t3), 40, t3), { acao: 'nada', motivo: 'esperando_60d' })
})

// ---- 22/10/2026: toque 3 (oferta diferente) e descarte dos esgotados ----

test('oferta: miolos em uma linha, sem link, < 320', () => {
  for (const m of [MIOLOS_OFERTA.comDados, MIOLOS_OFERTA.semDados]) { assert.doesNotMatch(m, /\n/); assert.doesNotMatch(m, /https?:\/\//); assert.ok(m.length < 320) }
  assert.equal(miolo(3, true), MIOLOS_OFERTA.comDados); assert.equal(miolo(3, false), MIOLOS_OFERTA.semDados)
})

test('perfil quente: dados coletados OU 3+ mensagens do lojista', () => {
  assert.equal(perfilQuente('[DADOS_COLETADOS:nome_socio=Ana]', 1), true)
  assert.equal(perfilQuente(null, 3), true); assert.equal(perfilQuente(null, 2), false)
})

test('esgotado e quente: toque 3 so depois de D+8 do toque 2 e com silencio >= 7', () => {
  const obs = remontarObs(remontarObs(null, { toque: 2 }, new Date(T0)), { encerrar: true })
  const q = { quente: true, ultimaInMs: T0 - 20 * DIA }
  assert.deepEqual(decidir(lerMarcadores(obs, T0 + DIA), 20, T0 + DIA, q), { acao: 'nada', motivo: `aguardando D+${DIAS_ENTRE_TOQUES}` })
  assert.deepEqual(decidir(lerMarcadores(obs, T0 + 8 * DIA), 28, T0 + 8 * DIA, q), { acao: 'enviar', toque: 3 })
  assert.deepEqual(decidir(lerMarcadores(obs, T0 + 8 * DIA), 28, T0 + 8 * DIA, { quente: false, ultimaInMs: null }), { acao: 'nada', motivo: 'esperando_60d' })
  // conversa viva segura mesmo o quente
  assert.deepEqual(decidir(lerMarcadores(obs, T0 + 8 * DIA), 3, T0 + 8 * DIA, q), { acao: 'nada', motivo: 'conversa_viva' })
})

test('esgotado e mudo ha mais de 60 dias: descarta, quente ou nao', () => {
  const obs = remontarObs(null, { encerrar: true })
  for (const quente of [true, false]) assert.deepEqual(decidir(lerMarcadores(obs, T0), SILENCIO_DESCARTE_DIAS + 1, T0, { quente, ultimaInMs: null }), { acao: 'descartar', motivo: 'mudo_60d' })
  assert.notEqual(decidir(lerMarcadores(obs, T0), SILENCIO_DESCARTE_DIAS, T0, { quente: false, ultimaInMs: null }).acao, 'descartar')
})

test('depois do toque 3: 15 dias calado descarta; resposta ao toque 3 nao descarta', () => {
  const obs = remontarObs(remontarObs(null, { encerrar: true }), { toque3: true }, new Date(T0))
  const t = T0 + DIAS_DESCARTE_POS_T3 * DIA
  assert.deepEqual(decidir(lerMarcadores(obs, t), 30, t, { quente: true, ultimaInMs: T0 - DIA }), { acao: 'descartar', motivo: 'sem_resposta_oferta' })
  assert.deepEqual(decidir(lerMarcadores(obs, t - DIA), 29, t - DIA, { quente: true, ultimaInMs: T0 - DIA }), { acao: 'nada', motivo: 'aguardando_oferta' })
  assert.deepEqual(decidir(lerMarcadores(obs, t), 10, t, { quente: true, ultimaInMs: T0 + 2 * DIA }), { acao: 'nada', motivo: 'respondeu_oferta' })
})

test('marcadores novos: toque3 e descarte gravam uma vez e sao lidos de volta', () => {
  const o = remontarObs(remontarObs('[RETOM_INT_FIM]', { toque3: true }, new Date(T0)), { descartar: true }, new Date(T0 + DIA))
  const m = lerMarcadores(o, T0 + DIA)
  assert.equal(m.toque3Ms, T0); assert.equal(m.descartado, true); assert.equal(m.encerrado, true)
  assert.deepEqual(decidir(m, 90, T0 + DIA, { quente: true, ultimaInMs: null }), { acao: 'nada', motivo: 'descartado' })
  assert.equal((o.match(/\[DESCARTE_RETOMADA:/g) ?? []).length, 1)
  assert.equal((remontarObs(o, { toque3: true }, new Date(T0 + DIA)).match(/\[RETOM_INT3:/g) ?? []).length, 1)
})

test('montarFila: oferta tem teto proprio e vem depois das outras', () => {
  const it = (status: string, dias: number, temDados = false) => ({ status, dias, temDados })
  const fila = montarFila([it('OFERTA', 10, true), it('OFERTA', 40), it('OFERTA', 20, true), it('INTERESSADO', 9)], 5, 5, 2)
  assert.deepEqual(fila.map((f) => [f.status, f.dias]), [['INTERESSADO', 9], ['OFERTA', 20], ['OFERTA', 10]])
  assert.equal(montarFila([it('OFERTA', 10)], 5, 5).length, 0)
})

test('chamada antiga de decidir (3 parametros) continua igual', () => {
  assert.deepEqual(decidir(lerMarcadores(null, T0), SILENCIO_DIAS, T0), { acao: 'enviar', toque: 1 })
  assert.deepEqual(decidir(lerMarcadores(remontarObs(null, { encerrar: true }), T0), 30, T0), { acao: 'nada', motivo: 'esperando_60d' })
})

test('se o lojista VOLTAR a falar, a regua para de tocar nele', () => {
  const o1 = remontarObs(null, { toque: 1 }, new Date(T0))
  const t2 = T0 + DIAS_ENTRE_TOQUES * DIA
  // respondeu ontem → silencio = 1 dia
  assert.deepEqual(decidir(lerMarcadores(o1, t2), 1, t2), { acao: 'nada', motivo: 'conversa_viva' })
})

test('pausa e optout bloqueiam', () => {
  const pausa = `[PAUSA_ATE:${iso(T0 + 30 * DIA)}]`
  assert.deepEqual(decidir(lerMarcadores(pausa, T0), 30, T0), { acao: 'nada', motivo: 'pausa' })
  assert.deepEqual(decidir(lerMarcadores('[CONSULTORIA_OPTOUT]', T0), 30, T0), { acao: 'nada', motivo: 'optout' })
})

test('quem ja deu dados ouve "retomo de onde paramos"; quem nao deu, a abordagem', () => {
  assert.match(miolo(1, true), /de onde paramos/)
  assert.match(miolo(2, true), /falta pouco/)
  assert.doesNotMatch(miolo(1, false), /de onde paramos/)
  assert.match(miolo(2, false), /não te incomodo mais/)
})

test('remontarObs nao duplica marcador', () => {
  const a = remontarObs('[X] nota', { toque: 1 }, new Date(T0))
  const b = remontarObs(a, { toque: 2 }, new Date(T0 + DIA))
  assert.equal((b.match(/\[RETOM_INT:/g) ?? []).length, 1)
  assert.match(b, /\[RETOM_INT:2:/)
  assert.match(b, /^\[X\] nota/)
})

test('teto de silêncio: acima de 90 dias não manda (protege a nota do número)', () => {
  const m = lerMarcadores('')
  assert.equal(decidir(m, 90).acao, 'enviar')
  assert.deepEqual(decidir(m, 91), { acao: 'nada', motivo: 'frio_demais' })
  assert.deepEqual(decidir(m, 160), { acao: 'nada', motivo: 'frio_demais' })
  assert.equal(SILENCIO_MAX_DIAS, 90)
})

test('AGUARDANDO tem orçamento próprio — interessado novo não o deixa sem vaga', () => {
  // o caso real: o disparo gera interessados todo dia; com fila única o
  // AGUARDANDO nunca seria atendido
  const itens = [
    ...Array.from({ length: 100 }, (_, i) => ({ status: 'INTERESSADO', dias: 8 + (i % 13), temDados: false })),
    ...Array.from({ length: 50 }, (_, i) => ({ status: 'AGUARDANDO', dias: 22 + i, temDados: false })),
  ]
  const fila = montarFila(itens, 60, 30)
  assert.equal(fila.filter((f) => f.status === 'INTERESSADO').length, 60)
  assert.equal(fila.filter((f) => f.status === 'AGUARDANDO').length, 30)
  // o interessado vem antes: se a rota bater o teto de tempo, é ele que sai
  assert.equal(fila[0].status, 'INTERESSADO')
  assert.equal(fila[fila.length - 1].status, 'AGUARDANDO')
})

test('orçamento zero desliga a etapa', () => {
  const itens = [{ status: 'INTERESSADO', dias: 9, temDados: false }, { status: 'AGUARDANDO', dias: 30, temDados: true }]
  assert.deepEqual(montarFila(itens, 60, 0).map((f) => f.status), ['INTERESSADO'])
  assert.deepEqual(montarFila(itens, 0, 30).map((f) => f.status), ['AGUARDANDO'])
})

test('INTERESSADO mantém a ordem aprovada: mais frio primeiro', () => {
  const fila = montarFila([
    { status: 'INTERESSADO', dias: 8, temDados: false },
    { status: 'INTERESSADO', dias: 20, temDados: false },
    { status: 'INTERESSADO', dias: 12, temDados: false },
  ], 60, 30)
  assert.deepEqual(fila.map((f) => f.dias), [20, 12, 8])
})

test('AGUARDANDO: quem deu dados primeiro, depois o MENOS frio', () => {
  const fila = montarFila([
    { status: 'AGUARDANDO', dias: 80, temDados: false },
    { status: 'AGUARDANDO', dias: 25, temDados: false },
    { status: 'AGUARDANDO', dias: 70, temDados: true },
    { status: 'AGUARDANDO', dias: 30, temDados: true },
  ], 60, 30)
  // com dados (30, 70) antes dos sem dados (25, 80); dentro de cada, menos frio primeiro
  assert.deepEqual(fila.map((f) => `${f.temDados ? 'D' : '-'}${f.dias}`), ['D30', 'D70', '-25', '-80'])
})

test('orçamento diário: cada rodada gasta só o que sobrou', () => {
  assert.equal(ORCAMENTO_DIA.INTERESSADO, 200)
  assert.equal(ORCAMENTO_DIA.AGUARDANDO, 120)
  assert.equal(restanteHoje(150, 0), 150)
  assert.equal(restanteHoje(150, 40), 110)   // 1ª rodada mandou 40 (teto de tempo)
  assert.equal(restanteHoje(150, 150), 0)    // estourou: as rodadas seguintes não mandam nada
  assert.equal(restanteHoje(150, 170), 0)    // nunca negativo
  assert.equal(restanteHoje(30, -5), 30)     // contagem suja não aumenta o orçamento
})

test('rótulo próprio por etapa — não se confunde com a cobrança nem com a biometria', () => {
  assert.notEqual(ROTULO.INTERESSADO, ROTULO.AGUARDANDO)
  for (const r of Object.values(ROTULO)) {
    assert.notEqual(r, 'aiva_reativacao_48h', 'era o rótulo compartilhado com 9 rotinas')
    assert.match(r, /^aiva_retomada_/)
  }
})

test('25/09: quem já deu dados vem primeiro também no INTERESSADO', () => {
  const f = montarFila([
    { status: 'INTERESSADO', dias: 80, temDados: false, id: 'frio' },
    { status: 'INTERESSADO', dias: 10, temDados: true, id: 'dados-morno' },
    { status: 'INTERESSADO', dias: 40, temDados: true, id: 'dados-frio' },
  ], 2, 0)
  assert.deepEqual(f.map((x) => x.id), ['dados-frio', 'dados-morno'])
})

test('só resposta automática da loja fica fora; qualquer fala de pessoa segura', () => {
  assert.equal(soRespostaAutomatica(['GMCELL agradece seu contato. Como podemos ajudar?']), true)
  assert.equal(soRespostaAutomatica(['Olá! Seja bem-vindo à Bellou Cell.', 'Nosso horário de atendimento é das 9h às 18h']), true)
  assert.equal(soRespostaAutomatica(['Olá, esse é o canal de atendimento da loja Vivo Pantanal']), true)
  assert.equal(soRespostaAutomatica(['Seja bem-vindo!', 'Sim, quero saber mais']), false)
  assert.equal(soRespostaAutomatica(['Como funciona e qual custo seria ?']), false)
  assert.equal(soRespostaAutomatica([]), false)          // nunca falou é outro motivo
  assert.equal(soRespostaAutomatica(['', '  ']), false)
})

test('saudação: sigla vira o começo do nome da loja; nome de verdade não muda', () => {
  assert.equal(saudacaoRetomada('Jf', 'JF Celulares e Eletrônicos'), 'JF Celulares')
  assert.equal(saudacaoRetomada('Hr', 'HR celulares assistência técnica'), 'HR Celulares')
  assert.equal(saudacaoRetomada('Mp', 'MP CELL assistência e acessórios'), 'MP CELL')
  assert.equal(saudacaoRetomada('W.', 'W. Cell'), 'W. Cell')
  assert.equal(saudacaoRetomada('3d', '3D Tech Assistência'), '3D Tech')
  assert.equal(saudacaoRetomada('Rf', 'RF'), 'lojista')
  assert.equal(saudacaoRetomada('La', 'La Ca sa do Celular'), 'lojista')
  assert.equal(saudacaoRetomada('Jennifer', 'WL Imports'), 'Jennifer')
  assert.equal(saudacaoRetomada('Ana', 'AF Celulares'), 'Ana')
})
