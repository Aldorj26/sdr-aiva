import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidirRodada, textoPausa, ehUltimaRodada, textoResumoDia, entregaIndisponivel, marcarResultados, textoStatusDisparo, textoRetomado, textoPausadoAgora, textoJaPausado, inicioEfetivoDaAmostra, chaveDaFatia,
  TETO_DIA, ROTULO, JANELA, TETO_TEMPO_MS, LOTE,
  type Entrega, type Resumo,
} from './disparo-diario-calc.ts'
import { FERIADOS, ehFeriado } from './business-time.ts'

// BRT = UTC-3 (sem horário de verão desde 2019). 2026-10-19 é segunda-feira; a de 12/10 é feriado, por isso não serve de base.
const SEG_10H = Date.parse('2026-10-19T13:00:00Z')
const SEG_7H = Date.parse('2026-10-19T10:00:00Z')
const SEG_19H = Date.parse('2026-10-19T22:00:00Z')
const SEG_8H00 = Date.parse('2026-10-19T11:00:00Z')
const SEG_18H59 = Date.parse('2026-10-19T21:59:00Z')
const TER_10H = Date.parse('2026-10-20T13:00:00Z')
const SAB_10H = Date.parse('2026-10-17T13:00:00Z')
const DOM_10H = Date.parse('2026-10-18T13:00:00Z')

const OK: Entrega = { estado: 'ok', taxa: 0.87, amostra: 30, entregues: 26, motivo: '26 de 30 entregues (87%)' }
const ALERTA: Entrega = { estado: 'alerta', taxa: 0.12, amostra: 25, entregues: 3, motivo: '3 de 25 entregues (12%)' }

// Caso base: dia útil, 10h BRT, não pausado, nada enviado, 1000 na fila, entrega ok. Cada teste muda um campo.
const base = () => ({ agoraMs: SEG_10H, pausado: false, jaSaiuHoje: 0, filaPendente: 1000, entrega: OK })

test('constantes do disparo', () => {
  assert.equal(TETO_DIA, 500)
  assert.equal(ROTULO, 'aiva_campanha')
  assert.deepEqual(JANELA, { de: 8, ate: 19 })
  assert.equal(TETO_TEMPO_MS, 240_000)
  assert.equal(LOTE, 5)
})

test('dia útil dentro da janela, nada enviado → dispara o teto do dia', () => {
  assert.deepEqual(decidirRodada(base()), { acao: 'disparar', quantidade: 500 })
})

test('fora da janela (7h BRT e 19h BRT) → nada', () => {
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: SEG_7H }), { acao: 'nada', motivo: 'fora_da_janela' })
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: SEG_19H }), { acao: 'nada', motivo: 'fora_da_janela' })
})

test('bordas da janela: 8h00 BRT (inclusive) e 18h59 BRT disparam', () => {
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: SEG_8H00 }), { acao: 'disparar', quantidade: 500 })
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: SEG_18H59 }), { acao: 'disparar', quantidade: 500 })
})

test('sábado e domingo → nada', () => {
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: SAB_10H }), { acao: 'nada', motivo: 'fim_de_semana' })
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: DOM_10H }), { acao: 'nada', motivo: 'fim_de_semana' })
})

test('pausado → nada, mesmo com fila e orçamento', () => {
  assert.deepEqual(decidirRodada({ ...base(), pausado: true }), { acao: 'nada', motivo: 'pausado' })
})

test('pausado continua pausado depois da virada do dia', () => {
  assert.deepEqual(decidirRodada({ ...base(), pausado: true, agoraMs: TER_10H }), { acao: 'nada', motivo: 'pausado' })
})

test('orçamento do dia já gasto → nada', () => {
  assert.deepEqual(decidirRodada({ ...base(), jaSaiuHoje: 500 }), { acao: 'nada', motivo: 'orcamento_gasto' })
})

test('orçamento parcial → dispara só o que falta', () => {
  assert.deepEqual(decidirRodada({ ...base(), jaSaiuHoje: 460 }), { acao: 'disparar', quantidade: 40 })
})

test('fila vazia → nada', () => {
  assert.deepEqual(decidirRodada({ ...base(), filaPendente: 0 }), { acao: 'nada', motivo: 'fila_vazia' })
})

test('fila menor que o orçamento → dispara o tamanho da fila', () => {
  assert.deepEqual(decidirRodada({ ...base(), filaPendente: 12, jaSaiuHoje: 200 }), { acao: 'disparar', quantidade: 12 })
})

test('entrega em alerta → pausar, com a taxa no motivo', () => {
  const d = decidirRodada({ ...base(), entrega: ALERTA })
  assert.equal(d.acao, 'pausar')
  assert.ok(d.acao === 'pausar' && d.motivo.includes('12%'), 'motivo deve citar a taxa')
})

test('entrega sem_dados → DISPARA (regressão: de manhã não há o que medir)', () => {
  const semDados: Entrega = { estado: 'sem_dados', taxa: null, amostra: 4, entregues: 1, motivo: 'só 4 envios confiáveis hoje (mínimo 12)' }
  assert.deepEqual(decidirRodada({ ...base(), entrega: semDados }), { acao: 'disparar', quantidade: 500 })
})

test('ordem das guardas: fim de semana > feriado > janela > pausado > fatia ocupada > alerta > orçamento > fila', () => {
  const pior = { ...base(), pausado: true, fatiaOcupada: true, entrega: ALERTA, jaSaiuHoje: 500, filaPendente: 0 }
  assert.deepEqual(decidirRodada({ ...pior, agoraMs: SAB_10H }), { acao: 'nada', motivo: 'fim_de_semana' })
  // feriado em dia de semana vence janela e todo o resto (02/11 é segunda; 07h BRT também é fora da janela)
  assert.deepEqual(decidirRodada({ ...pior, agoraMs: Date.parse('2026-11-02T10:00:00Z') }), { acao: 'nada', motivo: 'feriado' })
  assert.deepEqual(decidirRodada({ ...pior, agoraMs: SEG_7H }), { acao: 'nada', motivo: 'fora_da_janela' })
  assert.deepEqual(decidirRodada(pior), { acao: 'nada', motivo: 'pausado' })
  // fatia ocupada vence alerta/orçamento/fila (e não repete o alerta de pausa)
  assert.deepEqual(decidirRodada({ ...pior, pausado: false }), { acao: 'nada', motivo: 'fatia_ocupada' })
  // já pausado não repete o alerta; despausado com alerta pausa antes de olhar o orçamento
  assert.equal(decidirRodada({ ...pior, pausado: false, fatiaOcupada: false }).acao, 'pausar')
  assert.deepEqual(decidirRodada({ ...pior, pausado: false, fatiaOcupada: false, entrega: OK }), { acao: 'nada', motivo: 'orcamento_gasto' })
})

test('textoPausa cita a taxa, quanto saiu, a fatura da Meta e /retomar', () => {
  const t = textoPausa(ALERTA, 180)
  for (const trecho of ['12%', '180', 'fatura', '/retomar']) assert.ok(t.includes(trecho), `faltou "${trecho}" em: ${t}`)
})

// alerta de "parou agora": o dia está BEM (78%) mas os últimos envios não entregaram nada
const ALERTA_PAROU: Entrega = { estado: 'alerta', taxa: 0.78, amostra: 40, entregues: 31, motivo: '31 de 40 entregues (78%) no dia, MAS os 10 mais recentes: NENHUM entregue' }

test('textoPausa no "parou agora": usa o motivo da medição e NÃO apresenta 78% como abaixo do piso', () => {
  const t = textoPausa(ALERTA_PAROU, 180)
  assert.ok(t.includes(ALERTA_PAROU.motivo), `faltou o motivo em: ${t}`)
  assert.ok(!/78%.*piso/i.test(t), `78% aparece como abaixo do piso: ${t}`)
  for (const trecho of ['180', 'fatura', '/retomar']) assert.ok(t.includes(trecho), `faltou "${trecho}" em: ${t}`)
})

test('textoPausa na queda do dia: o motivo traz a taxa e o piso de 30% aparece', () => {
  const t = textoPausa(ALERTA, 180)
  assert.ok(t.includes(ALERTA.motivo) && /piso/.test(t), t)
})

test('decidirRodada: o motivo da pausa vem de entrega.motivo (não repete "Entrega em 78%... piso")', () => {
  const d = decidirRodada({ ...base(), entrega: ALERTA_PAROU })
  assert.equal(d.acao, 'pausar')
  assert.ok(d.acao === 'pausar' && d.motivo.includes('NENHUM entregue'), 'motivo deve trazer o diagnóstico real')
  assert.ok(d.acao === 'pausar' && !/78%.*piso/i.test(d.motivo), `78% como abaixo do piso: ${d.acao === 'pausar' && d.motivo}`)
})

// 2026-10-19 10h BRT = SEG_10H; meia-noite BRT desse dia = 03:00Z
const DIA_INICIO = '2026-10-19T03:00:00.000Z'
test('inicioEfetivoDaAmostra: sem retomada → começo do dia BRT', () => {
  assert.equal(inicioEfetivoDaAmostra(SEG_10H, null), DIA_INICIO)
})

test('inicioEfetivoDaAmostra: retomada de ONTEM ou ilegível não encurta a amostra', () => {
  assert.equal(inicioEfetivoDaAmostra(SEG_10H, '2026-10-18T20:00:00.000Z'), DIA_INICIO)
  assert.equal(inicioEfetivoDaAmostra(SEG_10H, 'lixo'), DIA_INICIO)
})

test('inicioEfetivoDaAmostra: retomada de HOJE vira o começo da amostra (max com o início do dia)', () => {
  assert.equal(inicioEfetivoDaAmostra(SEG_10H, '2026-10-19T12:15:00.000Z'), '2026-10-19T12:15:00.000Z')
})

test('inicioEfetivoDaAmostra: 21h BRT de ontem (00h UTC de hoje) ainda é ontem no Brasil', () => {
  assert.equal(inicioEfetivoDaAmostra(SEG_10H, '2026-10-19T01:00:00.000Z'), DIA_INICIO)
})

test('entregaIndisponivel devolve sem_dados — Evo fora não é bloqueio da Meta', () => {
  const e = entregaIndisponivel()
  assert.equal(e.estado, 'sem_dados')
  assert.equal(e.taxa, null)
  assert.deepEqual(decidirRodada({ ...base(), entrega: e }), { acao: 'disparar', quantidade: 500 })
})

test('ehUltimaRodada: só a rodada das 18h47 BRT (cron 7,27,47) — 18h27 e 18h37 não, nem 17h47 e 8h47', () => {
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T21:47:00Z')), true)
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T21:27:00Z')), false)
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T21:37:00Z')), false)
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T20:47:00Z')), false)
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T11:47:00Z')), false)
})

test('textoResumoDia traz saiu, restante, fila e a taxa do dia', () => {
  const r: Resumo = { saiuHoje: 480, restante: 20, filaPendente: 3300, pausado: false, entrega: OK }
  const t = textoResumoDia(r)
  for (const trecho of ['480', '20', '3300', '87%']) assert.ok(t.includes(trecho), `faltou "${trecho}" em: ${t}`)
  const semMedida = textoResumoDia({ ...r, entrega: entregaIndisponivel() })
  assert.ok(!semMedida.includes('null') && !semMedida.includes('NaN'), semMedida)
})

test('marcarResultados: resultado ok → DISPARADO; ok=false → ERRO com detalhe', () => {
  const lote = [{ id: 'a', telefone: '5511911111111' }, { id: 'b', telefone: '5511922222222' }]
  const r = marcarResultados(lote, [
    { telefone: '5511911111111', ok: true },
    { telefone: '5511922222222', ok: false, erro: 'numero_sem_whatsapp' },
  ])
  assert.deepEqual(r, [
    { id: 'a', status: 'DISPARADO', detalhe: null },
    { id: 'b', status: 'ERRO', detalhe: 'numero_sem_whatsapp' },
  ])
})

test('marcarResultados: lead sem linha em resultados fica PENDENTE (lote que estourou)', () => {
  const lote = [{ id: 'a', telefone: '5511911111111' }, { id: 'b', telefone: '5511922222222' }]
  const r = marcarResultados(lote, [{ telefone: '5511911111111', ok: true }])
  assert.deepEqual(r, [
    { id: 'a', status: 'DISPARADO', detalhe: null },
    { id: 'b', status: 'PENDENTE', detalhe: null },
  ])
  // lote inteiro sem resposta (HTTP 5xx / timeout): ninguém é marcado, a próxima rodada reprocessa
  assert.ok(marcarResultados(lote, []).every(x => x.status === 'PENDENTE'))
})

test('marcarResultados: bloqueado_* (já está na base) → DUPLICADO com o detalhe, não ERRO', () => {
  const lote = [{ id: 'a', telefone: '5511911111111' }, { id: 'b', telefone: '5511922222222' }, { id: 'c', telefone: '5511933333333' }]
  const r = marcarResultados(lote, [
    { telefone: '5511911111111', ok: false, erro: 'bloqueado_inicio' },
    { telefone: '5511922222222', ok: false, erro: 'numero_sem_whatsapp' },
    { telefone: '5511933333333', ok: false, erro: 'bloqueado_interessado' },
  ])
  assert.deepEqual(r, [
    { id: 'a', status: 'DUPLICADO', detalhe: 'bloqueado_inicio' },
    { id: 'b', status: 'ERRO', detalhe: 'numero_sem_whatsapp' },
    { id: 'c', status: 'DUPLICADO', detalhe: 'bloqueado_interessado' },
  ])
})

const SEM_PAUSA = { pausado_em: null, motivo: null }
const SEM_DADOS: Entrega = { estado: 'sem_dados', taxa: null, amostra: 0, entregues: 0, motivo: 'sem envio do dia' }

test('textoStatusDisparo: ativo mostra saiu/restante/fila e a taxa de entrega', () => {
  const t = textoStatusDisparo({ saiuHoje: 480, restante: 20, filaPendente: 3300, pausado: false, entrega: OK, ...SEM_PAUSA })
  assert.ok(t.includes('480 de 500'), t)
  assert.ok(t.includes('Restam 20'), t)
  assert.ok(t.includes('Fila: 3300'), t)
  assert.ok(t.includes('87%') && t.includes('26 de 30'), t)
  assert.ok(!t.includes('PAUSADO') && !t.includes('/retomar'), t)
})

test('textoStatusDisparo: sem_dados diz que a entrega não é mensurável, nunca 0%', () => {
  const t = textoStatusDisparo({ saiuHoje: 0, restante: 500, filaPendente: 3300, pausado: false, entrega: SEM_DADOS, ...SEM_PAUSA })
  assert.ok(!t.includes('0%') && !t.includes('null') && !t.includes('NaN'), t)
  assert.ok(/ainda/i.test(t), t)
})

test('textoStatusDisparo: pausado diz desde quando, o motivo e manda usar /retomar', () => {
  // 2026-10-12T14:32:00Z = 11h32 em Brasília
  const t = textoStatusDisparo({
    saiuHoje: 200, restante: 300, filaPendente: 3300, pausado: true, entrega: ALERTA,
    pausado_em: '2026-10-12T14:32:00Z', motivo: 'pausado por 5547996085000 pelo WhatsApp',
  })
  assert.ok(t.includes('PAUSADO'), t)
  assert.ok(t.includes('12/10') && t.includes('11:32'), t)
  assert.ok(t.includes('pausado por 5547996085000 pelo WhatsApp'), t)
  assert.ok(t.includes('/retomar'), t)
  // pausado sem registro de quando/por quê (linha antiga): não imprime null
  const velho = textoStatusDisparo({ saiuHoje: 0, restante: 500, filaPendente: 1, pausado: true, entrega: OK, ...SEM_PAUSA })
  assert.ok(velho.includes('/retomar') && !velho.includes('null'), velho)
})

test('textoRetomado: confirma e diz que a próxima rodada volta a disparar', () => {
  const t = textoRetomado(true)
  assert.ok(/retomad/i.test(t), t)
  assert.ok(/próxima rodada/i.test(t), t)
  assert.ok(t.split('\n').length <= 4, t)
})

test('textoRetomado quando já estava ativo: diz que não estava pausado', () => {
  const t = textoRetomado(false)
  assert.ok(/não estava pausado/i.test(t), t)
  assert.ok(t.split('\n').length <= 4, t)
})

test('textoPausadoAgora e textoJaPausado: o repetido diz que nada mudou e mostra desde quando/por quê', () => {
  assert.ok(/pausado/i.test(textoPausadoAgora()) && textoPausadoAgora().includes('/retomar'))
  const j = textoJaPausado({ pausado_em: '2026-10-12T14:32:00Z', motivo: 'pausado por 5547996085000 pelo WhatsApp' })
  assert.ok(/já estava pausado/i.test(j), j)
  assert.ok(j.includes('12/10') && j.includes('11:32') && j.includes('pelo WhatsApp') && j.includes('/retomar'), j)
  assert.ok(!textoJaPausado({ pausado_em: null, motivo: null }).includes('null'))
})

// ── feriados e lock de fatia (adendo de 11/10 noite) ─────────────────────────────────────────
test('02/11/2026 (segunda, Finados) → nada, motivo feriado', () => {
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: Date.parse('2026-11-02T14:00:00Z') }), { acao: 'nada', motivo: 'feriado' })
})

test('03/11/2026 (terça) → dispara normalmente', () => {
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: Date.parse('2026-11-03T14:00:00Z') }), { acao: 'disparar', quantidade: 500 })
})

test('ehFeriado usa o dia civil BRT: 2026-11-02T02:30:00Z ainda é 01/11', () => {
  assert.equal(ehFeriado('2026-11-02'), true)
  assert.equal(ehFeriado('2026-11-03'), false)
  // 02:30Z = 23:30 BRT de 01/11 (domingo): dia civil BRT não é feriado, mesmo com a data UTC sendo 02/11
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: Date.parse('2026-11-02T02:30:00Z') }), { acao: 'nada', motivo: 'fim_de_semana' })
  // o inverso: 03/11 02:30Z = 23:30 BRT de 02/11 → ainda é o feriado, embora a data UTC seja 03/11
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: Date.parse('2026-11-03T02:30:00Z') }), { acao: 'nada', motivo: 'feriado' })
  // 02/11 11:00Z = 08:00 BRT: dentro da janela, é o feriado
  assert.deepEqual(decidirRodada({ ...base(), agoraMs: Date.parse('2026-11-02T11:00:00Z') }), { acao: 'nada', motivo: 'feriado' })
  // o conjunto é o do plano, literal
  assert.deepEqual([...FERIADOS].sort(), ['2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25', '2027-01-01'])
})

test('chaveDaFatia: 11:07Z e 11:19Z → mesma fatia 0; 11:27Z → fatia 1; 21:47Z → disparo:2026-10-13T18:2', () => {
  const k07 = chaveDaFatia(Date.parse('2026-10-13T11:07:00Z'))
  assert.equal(k07, 'disparo:2026-10-13T08:0')
  assert.equal(chaveDaFatia(Date.parse('2026-10-13T11:19:00Z')), k07)
  assert.equal(chaveDaFatia(Date.parse('2026-10-13T11:27:00Z')), 'disparo:2026-10-13T08:1')
  assert.equal(chaveDaFatia(Date.parse('2026-10-13T21:47:00Z')), 'disparo:2026-10-13T18:2')
  // dia BRT, não UTC: 02:07Z de 14/10 ainda é 13/10 às 23h BRT
  assert.equal(chaveDaFatia(Date.parse('2026-10-14T02:07:00Z')), 'disparo:2026-10-13T23:0')
})

test('fatiaOcupada → nada, motivo fatia_ocupada, antes do orçamento', () => {
  assert.deepEqual(decidirRodada({ ...base(), fatiaOcupada: true }), { acao: 'nada', motivo: 'fatia_ocupada' })
  // antes do alerta e do orçamento: nem pausa nem olha o teto
  assert.deepEqual(decidirRodada({ ...base(), fatiaOcupada: true, entrega: ALERTA }), { acao: 'nada', motivo: 'fatia_ocupada' })
  assert.deepEqual(decidirRodada({ ...base(), fatiaOcupada: true, jaSaiuHoje: 500 }), { acao: 'nada', motivo: 'fatia_ocupada' })
  // omitido = livre
  assert.equal(decidirRodada(base()).acao, 'disparar')
})
