import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidirRodada, textoPausa, ehUltimaRodada, textoResumoDia, entregaIndisponivel, marcarResultados, textoStatusDisparo, textoRetomado, textoPausadoAgora, textoJaPausado, inicioEfetivoDaAmostra, chaveDaFatia, guardaBarata, teaserPausa, teaserResumo, teaserQuebrou, chaveQuebrou, textoQuebrou,
  chaveDaPausa, ehPausaAutomatica, textoPausaLembrete, teaserPausaLembrete, cabeResumo, lotesTravados, chaveTravado, textoTravado, teaserTravado,
  lotePifou, textoPifou, teaserPifou,
  textoBotaoDisparo, PREFIXO_LOCK_MANUAL, MOTIVO_PAUSA_PAINEL, lockEhDoProprioClique, JANELA_LOCK_PROPRIO_MS,
  JANELA_PAUSA_MS, MIN_RESTANTE_RESUMO_MS,
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

test('ehUltimaRodada: só a rodada das 18h57 BRT (cron a cada 5 min) — 18h47 e 18h52 não, nem 17h57 e 8h57', () => {
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T21:57:00Z')), true)
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T21:47:00Z')), false)
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T21:52:00Z')), false)
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T20:57:00Z')), false)
  assert.equal(ehUltimaRodada(Date.parse('2026-10-12T11:57:00Z')), false)
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

test('chaveDaFatia (5 min): 11:07Z e 11:09Z → mesma fatia 1; 11:12Z → fatia 2; 21:57Z → disparo:2026-10-13T18:11', () => {
  const k07 = chaveDaFatia(Date.parse('2026-10-13T11:07:00Z'))
  assert.equal(k07, 'disparo:2026-10-13T08:1')
  assert.equal(chaveDaFatia(Date.parse('2026-10-13T11:09:00Z')), k07)
  assert.equal(chaveDaFatia(Date.parse('2026-10-13T11:12:00Z')), 'disparo:2026-10-13T08:2')
  assert.equal(chaveDaFatia(Date.parse('2026-10-13T11:02:00Z')), 'disparo:2026-10-13T08:0')
  assert.equal(chaveDaFatia(Date.parse('2026-10-13T21:57:00Z')), 'disparo:2026-10-13T18:11')
  // dia BRT, não UTC: 02:07Z de 14/10 ainda é 13/10 às 23h BRT
  assert.equal(chaveDaFatia(Date.parse('2026-10-14T02:07:00Z')), 'disparo:2026-10-13T23:1')
})

test('fatiaOcupada → nada, motivo fatia_ocupada, antes do orçamento', () => {
  assert.deepEqual(decidirRodada({ ...base(), fatiaOcupada: true }), { acao: 'nada', motivo: 'fatia_ocupada' })
  // antes do alerta e do orçamento: nem pausa nem olha o teto
  assert.deepEqual(decidirRodada({ ...base(), fatiaOcupada: true, entrega: ALERTA }), { acao: 'nada', motivo: 'fatia_ocupada' })
  assert.deepEqual(decidirRodada({ ...base(), fatiaOcupada: true, jaSaiuHoje: 500 }), { acao: 'nada', motivo: 'fatia_ocupada' })
  // omitido = livre
  assert.equal(decidirRodada(base()).acao, 'disparar')
})

test('guardaBarata: devolve o primeiro motivo barato, ou null num dia útil normal', () => {
  const b = { agoraMs: SEG_10H, pausado: false, fatiaOcupada: false }
  assert.equal(guardaBarata(b), null)
  assert.equal(guardaBarata({ agoraMs: SAB_10H, pausado: false }), 'fim_de_semana')
  assert.equal(guardaBarata({ ...b, agoraMs: Date.parse('2026-11-02T14:00:00Z') }), 'feriado')
  assert.equal(guardaBarata({ ...b, agoraMs: SEG_7H }), 'fora_da_janela')
  assert.equal(guardaBarata({ ...b, pausado: true }), 'pausado')
  assert.equal(guardaBarata({ ...b, fatiaOcupada: true }), 'fatia_ocupada')
  // ordem: tudo ligado ao mesmo tempo em feriado → feriado; em dia útil → pausado antes de fatia ocupada
  assert.equal(guardaBarata({ agoraMs: Date.parse('2026-11-02T10:00:00Z'), pausado: true, fatiaOcupada: true }), 'feriado')
  assert.equal(guardaBarata({ ...b, pausado: true, fatiaOcupada: true }), 'pausado')
})

// --- Teasers do HSM 48 ({{2}}): UMA linha, sem quebra de linha, <= 160 chars ---

const PARADO_AGORA: Entrega = { estado: 'alerta', taxa: 0.78, amostra: 40, entregues: 31, motivo: '31 de 40 entregues (78%) no dia, MAS os 10 envios mais recentes: NENHUM entregue' }
const uma = (t: string) => assert.ok(!/[\r\n\t]/.test(t) && t.length <= 160, `não é uma linha de até 160: ${JSON.stringify(t)} (${t.length})`)

test('teaserPausa: uma linha, sem \n, cita a taxa e manda responder /retomar', () => {
  const t = teaserPausa(ALERTA, 120)
  uma(t)
  assert.match(t, /12%/)
  assert.match(t, /pausad/i)
  assert.ok(t.endsWith('responda /retomar'), t)
  // "parou agora": cita o motivo (não o piso) e também fecha com /retomar
  const t2 = teaserPausa(PARADO_AGORA, 300)
  uma(t2)
  assert.match(t2, /NENHUM entregue/)
  assert.ok(t2.endsWith('responda /retomar'), t2)
})

test('teaserResumo: uma linha com saiu/restante', () => {
  const r: Resumo = { saiuHoje: 480, restante: 20, filaPendente: 3300, pausado: false, entrega: OK }
  const t = teaserResumo(r)
  uma(t)
  assert.match(t, /saíram 480 de 500/)
  assert.match(t, /fila 3300/)
  assert.match(teaserResumo({ ...r, pausado: true }), /PAUSADO/)
})

test('teaserQuebrou: uma linha com o motivo truncado em 120 chars', () => {
  const curto = teaserQuebrou('sdr_mensagens: timeout')
  uma(curto)
  assert.equal(curto, '🚨 disparo AIVA quebrou: sdr_mensagens: timeout')
  const longo = teaserQuebrou('x'.repeat(500))
  uma(longo)
  assert.equal(longo.replace('🚨 disparo AIVA quebrou: ', '').length, 120)
  assert.ok(longo.endsWith('…'))
})

test('teasers nunca contêm \n mesmo com motivo multilinha', () => {
  const sujo: Entrega = { ...ALERTA, motivo: '3 de 25\nentregues\r\n(12%)\tmuito\n\nruim' }
  for (const t of [
    teaserQuebrou('linha 1\nlinha 2\r\n\tlinha 3\n\n' + 'y'.repeat(300)),
    teaserPausa(sujo, 10),
    teaserPausa({ ...PARADO_AGORA, motivo: 'z'.repeat(400) }, 10),
    teaserResumo({ saiuHoje: 1, restante: 499, filaPendente: 9, pausado: false, entrega: OK }),
  ]) uma(t)
})

test('chaveQuebrou: uma por hora BRT; textoQuebrou traz rota, hora, erro e o vigia', () => {
  // 13:07Z = 10:07 BRT; 13:47Z = 10:47 BRT (mesma hora); 14:07Z = 11:07 BRT
  assert.equal(chaveQuebrou(Date.parse('2026-10-19T13:07:00Z')), 'disparo_quebrou:2026-10-19T10')
  assert.equal(chaveQuebrou(Date.parse('2026-10-19T13:47:00Z')), 'disparo_quebrou:2026-10-19T10')
  assert.equal(chaveQuebrou(Date.parse('2026-10-19T14:07:00Z')), 'disparo_quebrou:2026-10-19T11')
  // 02:30Z do dia 20 ainda é 23:30 BRT do dia 19
  assert.equal(chaveQuebrou(Date.parse('2026-10-20T02:30:00Z')), 'disparo_quebrou:2026-10-19T23')
  const t = textoQuebrou('sdr_mensagens: timeout', Date.parse('2026-10-19T13:07:00Z'))
  assert.match(t, /\/api\/sdr\/disparo-diario/)
  assert.match(t, /2026-10-19 10:07/)
  assert.match(t, /sdr_mensagens: timeout/)
  assert.match(t, /vigia das 17h/)
  assert.ok(textoQuebrou('e'.repeat(5000), SEG_10H).length < 1000)
})

// ── rodada final de revisão (11/10 noite): lembrete de pausa, resumo com folga, alerta de travamento ──

test('chaveDaPausa: amarra o aviso à pausa (pausado_em); janela de 30 dias', () => {
  assert.equal(chaveDaPausa('2026-10-19T13:07:00.000Z'), 'disparo_pausa:2026-10-19T13:07:00.000Z')
  assert.notEqual(chaveDaPausa('2026-10-19T13:07:00.000Z'), chaveDaPausa('2026-10-20T13:07:00.000Z'))
  assert.equal(JANELA_PAUSA_MS, 30 * 24 * 3_600_000)
})

test('ehPausaAutomatica: só o motivo da própria rodada; "pausado por …" (WhatsApp) e vazio não', () => {
  assert.equal(ehPausaAutomatica('3 de 25 entregues (12%) — piso é 30%.'), true)
  assert.equal(ehPausaAutomatica('31 de 40 entregues (78%) no dia, MAS os 10 envios mais recentes: NENHUM entregue.'), true)
  assert.equal(ehPausaAutomatica('pausado por 5547996085000 pelo WhatsApp'), false)
  assert.equal(ehPausaAutomatica(null), false)
  assert.equal(ehPausaAutomatica(''), false)
})

const PAUSA_AUTO = { motivo: '3 de 25 entregues (12%) — piso é 30%.', pausado_em: '2026-10-12T14:32:00Z' }

test('textoPausaLembrete: diz que SEGUE pausado, desde quando, o motivo, a fatura e /retomar', () => {
  const t = textoPausaLembrete(PAUSA_AUTO)
  for (const trecho of ['PAUSADO', '12/10', '11:32', '12%', 'fatura', '/retomar']) assert.ok(t.includes(trecho), `faltou "${trecho}" em: ${t}`)
  assert.ok(!t.includes('null') && !t.includes('undefined'), t)
  assert.ok(!textoPausaLembrete({ motivo: null, pausado_em: null }).includes('null'))
})

test('teaserPausaLembrete: uma linha <= 160, cita desde quando e o diagnóstico, fecha com /retomar', () => {
  const t = teaserPausaLembrete(PAUSA_AUTO)
  uma(t)
  assert.match(t, /12\/10/)
  assert.match(t, /12%/)
  assert.ok(t.endsWith('responda /retomar'), t)
  // motivo gigante e multilinha: continua uma linha, o fim (a ação) nunca é cortado
  const longo = teaserPausaLembrete({ motivo: 'linha 1\nlinha 2\t' + 'z'.repeat(400), pausado_em: '2026-10-12T14:32:00Z' })
  uma(longo)
  assert.ok(longo.endsWith('responda /retomar'), longo)
  uma(teaserPausaLembrete({ motivo: null, pausado_em: null }))
})

test('cabeResumo: o resumo das 18h47 só começa com >= 40 s sobrando do teto de 240 s', () => {
  assert.equal(MIN_RESTANTE_RESUMO_MS, 40_000)
  assert.equal(cabeResumo(40_000), true)
  assert.equal(cabeResumo(39_999), false)
  assert.equal(cabeResumo(-5_000), false)
  assert.equal(cabeResumo(TETO_TEMPO_MS), true)
})

test('lotesTravados: só quando NENHUM lead chegou ao envio (tudo PENDENTE) — falha, duplicado ou enviado desmentem', () => {
  assert.equal(lotesTravados({ processados: 10, enviados: 0, falhas: 0, duplicados: 0 }), true)
  assert.equal(lotesTravados({ processados: 0, enviados: 0, falhas: 0, duplicados: 0 }), false) // nada processado (cortado/sem fila)
  assert.equal(lotesTravados({ processados: 10, enviados: 1, falhas: 0, duplicados: 0 }), false)
  assert.equal(lotesTravados({ processados: 10, enviados: 0, falhas: 3, duplicados: 0 }), false) // ERRO por lead: o send-initial rodou
  assert.equal(lotesTravados({ processados: 10, enviados: 0, falhas: 0, duplicados: 2 }), false) // DUPLICADO: o send-initial respondeu
})

test('chaveTravado: uma por hora BRT (disparo_travado:<dia>T<HH>)', () => {
  assert.equal(chaveTravado(Date.parse('2026-10-19T13:07:00Z')), 'disparo_travado:2026-10-19T10')
  assert.equal(chaveTravado(Date.parse('2026-10-19T13:47:00Z')), 'disparo_travado:2026-10-19T10')
  assert.equal(chaveTravado(Date.parse('2026-10-19T14:07:00Z')), 'disparo_travado:2026-10-19T11')
  assert.equal(chaveTravado(Date.parse('2026-10-20T02:30:00Z')), 'disparo_travado:2026-10-19T23')
})

test('textoTravado / teaserTravado: quantos ficaram, o erro cortado, e que a próxima rodada tenta de novo', () => {
  const t = textoTravado(10, 'send-initial HTTP 504')
  for (const trecho of ['10', 'send-initial HTTP 504', 'PENDENTE', 'próxima rodada']) assert.ok(t.includes(trecho), `faltou "${trecho}" em: ${t}`)
  assert.ok(textoTravado(10, 'e'.repeat(5000)).length < 1000)
  assert.ok(!textoTravado(3, null).includes('null'))
  const tz = teaserTravado(10)
  uma(tz)
  assert.match(tz, /travad/i)
  assert.match(tz, /10/)
})

// ── C1: breaker quando o send-initial falha POR LEAD (Evo 5xx/401/200-com-erro) ──────────────────
const ok = (t: string) => ({ telefone: t, ok: true })
const er = (t: string, erro: string) => ({ telefone: t, ok: false, erro })

test('lotePifou: 3+ erros que não são bloqueado_* e nenhum ok → pifou, com n e o 1º erro', () => {
  const r = lotePifou([er('1', 'Evo 503'), er('2', 'Evo 503'), er('3', 'fetch failed'), er('4', 'Evo 503'), er('5', 'Evo 503')])
  assert.deepEqual(r, { pifou: true, n: 5, erro: 'Evo 503' })
  assert.equal(lotePifou([er('1', 'x'), er('2', 'y'), er('3', 'z')]).pifou, true) // exatamente 3
})

test('lotePifou: qualquer ok → NÃO pifou (falha isolada é normal)', () => {
  assert.equal(lotePifou([ok('1'), er('2', 'Evo 503'), er('3', 'Evo 503'), er('4', 'Evo 503'), er('5', 'Evo 503')]).pifou, false)
})

test('lotePifou: só bloqueado_* (já está na base) → NÃO pifou, mesmo sem nenhum ok', () => {
  const r = lotePifou([er('1', 'bloqueado_inicio'), er('2', 'bloqueado_interessado'), er('3', 'bloqueado_inicio'), er('4', 'bloqueado_inicio'), er('5', 'bloqueado_inicio')])
  assert.equal(r.pifou, false)
  // bloqueado_* não conta para os 3: 2 erros reais + 3 bloqueados → não pifou
  assert.equal(lotePifou([er('1', 'Evo 503'), er('2', 'Evo 503'), er('3', 'bloqueado_inicio'), er('4', 'bloqueado_inicio'), er('5', 'bloqueado_inicio')]).pifou, false)
})

test('lotePifou: só 2 erros (lote pequeno) → NÃO pifou; lote vazio → NÃO pifou', () => {
  assert.equal(lotePifou([er('1', 'Evo 503'), er('2', 'Evo 503')]).pifou, false)
  assert.deepEqual(lotePifou([]), { pifou: false, n: 0, erro: null })
})

test('lotePifou: 100% numero_sem_whatsapp num lote CHEIO (LOTE) → pifou (Evo devolvendo 200 com erro parece "sem WhatsApp")', () => {
  const cheio = Array.from({ length: LOTE }, (_, i) => er(String(i), 'numero_sem_whatsapp'))
  assert.deepEqual(lotePifou(cheio), { pifou: true, n: LOTE, erro: 'numero_sem_whatsapp' })
  // cheio, mas um deles saiu: é número morto de verdade
  assert.equal(lotePifou([ok('x'), ...cheio.slice(1)]).pifou, false)
})

test('lotePifou: cauda CURTA da fila (1–4) toda numero_sem_whatsapp NÃO pausa o dia', () => {
  for (let n = 1; n < LOTE; n++) {
    const cauda = Array.from({ length: n }, (_, i) => er(String(i), 'numero_sem_whatsapp'))
    assert.equal(lotePifou(cauda).pifou, false, `lote de ${n} sem WhatsApp pausou`)
  }
  // misturado com bloqueado_* também não é "100% sem whatsapp"
  assert.equal(lotePifou([er('1', 'numero_sem_whatsapp'), er('2', 'bloqueado_inicio')]).pifou, false)
})

test('lotePifou: numero_sem_whatsapp não entra na regra dos 3 erros (só na regra do lote cheio)', () => {
  assert.equal(lotePifou([er('1', 'numero_sem_whatsapp'), er('2', 'numero_sem_whatsapp'), er('3', 'numero_sem_whatsapp'), er('4', 'numero_sem_whatsapp')]).pifou, false)
  // 3 erros reais de envio continuam pifando, com sem_whatsapp no meio
  assert.equal(lotePifou([er('1', 'Evo 503'), er('2', 'Evo 503'), er('3', 'Evo 503'), er('4', 'numero_sem_whatsapp')]).pifou, true)
})

test('textoPifou / teaserPifou: n, o 1º erro cortado, pausa, PENDENTE, /retomar; teaser em uma linha', () => {
  const t = textoPifou(5, 'Evo 503')
  for (const trecho of ['5', 'Evo 503', 'PAUSADO', 'PENDENTE', '/retomar']) assert.ok(t.includes(trecho), `faltou "${trecho}" em: ${t}`)
  assert.ok(textoPifou(5, 'e'.repeat(5000)).length < 1100)
  assert.ok(!textoPifou(5, null).includes('null'))
  const tz = teaserPifou(5)
  uma(tz)
  assert.match(tz, /5/)
  assert.match(tz, /pausad/i)
  assert.ok(tz.endsWith('responda /retomar'), tz)
})

test('lembrete de uma pausa por falha do send-initial NÃO manda olhar a fatura da Meta', () => {
  const e = { motivo: 'send-initial falhou 5/5: Evo 503', pausado_em: '2026-10-12T14:32:00Z' }
  const t = textoPausaLembrete(e)
  assert.ok(!/fatura/i.test(t) && /Evo/.test(t) && t.includes('/retomar'), t)
  const tz = teaserPausaLembrete(e)
  uma(tz)
  assert.ok(!/fatura/i.test(tz) && tz.endsWith('responda /retomar'), tz)
})

// --- botão "Disparar agora" da página /disparos (15/10/2026) ---

test('chaveDaFatia: a trava do botão tem prefixo próprio — não colide com a do cron, mas dois cliques na mesma fatia sim', () => {
  const cron = chaveDaFatia(Date.parse('2026-10-15T14:07:00Z'))
  const manual = chaveDaFatia(Date.parse('2026-10-15T14:07:00Z'), PREFIXO_LOCK_MANUAL)
  assert.notEqual(manual, cron)
  assert.equal(manual, 'disparo-manual:2026-10-15T11:1')
  // segundo toque 2 min depois: MESMA chave (anti duplo clique no celular)
  assert.equal(chaveDaFatia(Date.parse('2026-10-15T14:09:00Z'), PREFIXO_LOCK_MANUAL), manual)
  // 5 min depois: chave nova, pode mandar outro lote
  assert.notEqual(chaveDaFatia(Date.parse('2026-10-15T14:12:00Z'), PREFIXO_LOCK_MANUAL), manual)
})

test('MOTIVO_PAUSA_PAINEL não é pausa automática (não fica repetindo aviso no WhatsApp)', () => {
  assert.equal(ehPausaAutomatica(MOTIVO_PAUSA_PAINEL), false)
})

test('textoBotaoDisparo: lote que saiu, com e sem destravar a pausa', () => {
  const r = { acao: 'disparar' as const, motivo: null, enviados: 5, falhas: 0, saiuHoje: 125 }
  assert.equal(textoBotaoDisparo(r, false), '5 lojas saíram agora — 125 de 500 no dia. O cron segue com o resto até as 19h.')
  assert.match(textoBotaoDisparo(r, true), /^Pausa destravada\. 5 lojas saíram agora/)
  assert.match(textoBotaoDisparo({ ...r, enviados: 1 }, false), /^1 loja saíram agora/)
  assert.match(textoBotaoDisparo({ ...r, falhas: 2 }, false), /2 falhas\./)
})

test('textoBotaoDisparo: cada motivo de "nada" vira frase de gente', () => {
  const base = { acao: 'nada' as const, enviados: 0, falhas: 0, saiuHoje: 500 }
  assert.match(textoBotaoDisparo({ ...base, motivo: 'fora_da_janela' }, false), /de 8h às 19h/)
  assert.match(textoBotaoDisparo({ ...base, motivo: 'fim_de_semana' }, false), /segunda a sexta/)
  assert.match(textoBotaoDisparo({ ...base, motivo: 'feriado' }, false), /Feriado/)
  assert.match(textoBotaoDisparo({ ...base, motivo: 'orcamento_gasto' }, false), /Teto do dia batido: as 500/)
  assert.match(textoBotaoDisparo({ ...base, motivo: 'fila_vazia' }, false), /fila está vazia/)
  assert.match(textoBotaoDisparo({ ...base, motivo: 'fatia_ocupada' }, false), /últimos 5 minutos/)
  // motivo novo que ninguém mapeou não pode virar tela em branco
  assert.match(textoBotaoDisparo({ ...base, motivo: 'motivo_novo' }, false), /motivo_novo/)
})

test('textoBotaoDisparo: a rodada pausou no meio do clique (entrega abaixo do piso)', () => {
  const t = textoBotaoDisparo({ acao: 'pausar', motivo: 'entrega 20% abaixo do piso', enviados: 0, falhas: 0, saiuHoje: 22 }, true)
  assert.match(t, /^Pausa destravada\. O robô pausou o disparo agora: entrega 20% abaixo do piso\.$/)
})

test('textoBotaoDisparo: lote tentado e nenhuma saiu', () => {
  assert.match(textoBotaoDisparo({ acao: 'disparar', motivo: null, enviados: 0, falhas: 5, saiuHoje: 10 }, false), /Nenhuma saiu agora \(5 falhas\)\. O cron tenta de novo/)
})

test('lockEhDoProprioClique: chave de segundos atrás é do próprio clique; a de um toque anterior não', () => {
  const agora = Date.parse('2026-10-15T16:35:10.000Z')
  const iso = (deltaMs: number) => new Date(agora - deltaMs).toISOString()
  // gravada no mesmo instante da pergunta (o caso de 15/10) e dentro da folga
  assert.equal(lockEhDoProprioClique(iso(0), agora), true)
  assert.equal(lockEhDoProprioClique(iso(JANELA_LOCK_PROPRIO_MS - 1), agora), true)
  // toque anterior de gente: a resposta do primeiro já tinha voltado (~60 s) → segue barrado
  assert.equal(lockEhDoProprioClique(iso(JANELA_LOCK_PROPRIO_MS + 1), agora), false)
  assert.equal(lockEhDoProprioClique(iso(60_000), agora), false)
  // relógio do banco 1 s adiantado ainda conta como nossa; 2 s não
  assert.equal(lockEhDoProprioClique(iso(-1_000), agora), true)
  assert.equal(lockEhDoProprioClique(iso(-2_000), agora), false)
  // sem data legível, o conservador é recusar
  assert.equal(lockEhDoProprioClique(null, agora), false)
  assert.equal(lockEhDoProprioClique(undefined, agora), false)
  assert.equal(lockEhDoProprioClique('ontem', agora), false)
})
