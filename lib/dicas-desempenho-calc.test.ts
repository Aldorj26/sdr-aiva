import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerMarcadores, decidir, textoDica, remontarObs, PRIORIDADE, prioridade } from './dicas-desempenho-calc.ts'
import { resumir, type Segmento } from './desempenho-loja-calc.ts'

const DIA = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-10-06T13:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

test('1a dica so 7 dias depois de entrar na etapa; loja antiga sem data esta liberada', () => {
  assert.deepEqual(decidir(lerMarcadores(`[CONSULTORIA_INICIO:${iso(T0 - 3 * DIA)}]`), 'sem_uso', null, T0), { acao: 'nada', motivo: 'menos_de_7_dias_na_etapa' })
  assert.deepEqual(decidir(lerMarcadores(`[CONSULTORIA_INICIO:${iso(T0 - 8 * DIA)}]`), 'sem_uso', null, T0), { acao: 'enviar' })
  assert.deepEqual(decidir(lerMarcadores(''), 'vende_firme', null, T0), { acao: 'enviar' })
})

test('semanal pra quem vende, quinzenal pra parado', () => {
  const obs = `[CONSULTORIA_INICIO:${iso(T0 - 60 * DIA)}] [DICAS_ULTIMA:${iso(T0 - 7 * DIA + 3600_000)}]`
  assert.equal(decidir(lerMarcadores(obs), 'vende_pouco', null, T0).acao, 'enviar')        // 7 dias menos 1h: folga de 12h
  assert.equal(decidir(lerMarcadores(obs), 'aprova_nao_vende', null, T0).acao, 'enviar')
  assert.deepEqual(decidir(lerMarcadores(obs), 'parou', null, T0), { acao: 'nada', motivo: 'aguardando_intervalo' })
  const obs14 = `[DICAS_ULTIMA:${iso(T0 - 14 * DIA)}]`
  assert.equal(decidir(lerMarcadores(obs14), 'sem_uso', null, T0).acao, 'enviar')
})

test('travas', () => {
  const ok = (o: string, fala: number | null = null) => decidir(lerMarcadores(o), 'vende_pouco', fala, T0)
  assert.deepEqual(ok('[CONSULTORIA_OPTOUT]'), { acao: 'nada', motivo: 'optout' })
  assert.deepEqual(ok('[DICAS_OPTOUT]'), { acao: 'nada', motivo: 'optout' })
  assert.deepEqual(ok(`[SENHA_PENDENTE_DESDE:${iso(T0)}]`), { acao: 'nada', motivo: 'sem_acesso' })
  assert.deepEqual(ok('[ONB_ETAPA:dados_varejo:2026-10-01]'), { acao: 'nada', motivo: 'sem_acesso' })
  assert.deepEqual(ok('[PORTAL_REPROVADO_CONFERIR]'), { acao: 'nada', motivo: 'reprovado' })
  assert.deepEqual(ok(`[PAUSA_ATE:${iso(T0 + DIA)}]`), { acao: 'nada', motivo: 'pausa' })
  assert.deepEqual(ok('', T0 - 20 * 3600_000), { acao: 'nada', motivo: 'conversa_viva' })
  assert.deepEqual(ok(`[CONSULTORIA_ULTIMA:${iso(T0 - 2 * DIA)}]`), { acao: 'nada', motivo: 'consultoria_recente' })
  assert.deepEqual(ok(`[CHECK_VENDA_ULTIMA:${iso(T0 - 1 * DIA)}]`), { acao: 'nada', motivo: 'check_venda_recente' })
})

test('textos: uma linha, sem link, cabem no HSM, numeros certos', () => {
  const casos: Record<Segmento, ReturnType<typeof resumir>> = {
    vende_firme: resumir([{ semana: '2026-09-28', aprovados: 9, vendas: 4, valor_vendas: 5200 }, { semana: '2026-09-21', aprovados: 5, vendas: 2, valor_vendas: 2600 }], [], '2026-09-28', '2026-10'),
    vende_pouco: resumir([{ semana: '2026-09-28', aprovados: 3, vendas: 1, valor_vendas: 1300 }], [], '2026-09-28', '2026-10'),
    aprova_nao_vende: resumir([{ semana: '2026-09-28', aprovados: 1, vendas: 0, valor_vendas: 0 }], [], '2026-09-28', '2026-10'),
    parou: resumir([], [{ mes: '2026-09', consultas: 10, aprovados: 2, vendas: 1, valor_vendas: 1300 }], '2026-09-28', '2026-10'),
    sem_uso: resumir([], [], '2026-09-28', '2026-10'),
  }
  for (const [seg, r] of Object.entries(casos)) {
    assert.equal(r.segmento, seg)
    for (let c = 0; c < 3; c++) {
      const t = textoDica(r, c)
      assert.doesNotMatch(t, /\n/); assert.doesNotMatch(t, /https?:\/\//)
      assert.ok(t.length < 330, `${seg}/${c}: ${t.length}`)
      assert.doesNotMatch(t, /\b(8x|10x|sem entrada)\b/i)
    }
  }
  assert.match(textoDica(casos.vende_firme, 0), /semana de 28\/09 sua loja fez 4 vendas pela AIVA \(R\$\s5\.200\)/)
  assert.match(textoDica(casos.aprova_nao_vende, 0), /1 cliente aprovado pela AIVA/)
  assert.match(textoDica(casos.vende_pouco, 0), /3 clientes aprovados e 1 venda/)
  assert.equal(textoDica(casos.parou, 3), textoDica(casos.parou, 0))
})

test('marcadores sao trocados, nao empilhados', () => {
  const o1 = remontarObs('x [CONSULTORIA_INICIO:2026-09-01T00:00:00Z]', 1, 'parou', new Date(T0))
  const o2 = remontarObs(o1, 2, 'vende_pouco', new Date(T0 + DIA))
  assert.equal((o2.match(/\[DICAS_COUNT:/g) ?? []).length, 1)
  assert.match(o2, /\[DICAS_COUNT:2\] \[DICAS_ULTIMA:2026-10-07T13:00:00.000Z\] \[DICAS_SEG:vende_pouco\]$/)
  assert.match(o2, /CONSULTORIA_INICIO/)
  assert.equal(lerMarcadores(o2).count, 2)
})

test('prioridade: aprovado que nao fecha vem primeiro', () => {
  const ord = (Object.keys(PRIORIDADE) as Segmento[]).sort((a, b) => PRIORIDADE[a] - PRIORIDADE[b])
  assert.equal(ord[0], 'aprova_nao_vende')
})

test('loja nova sem consulta vai na frente de todo mundo; sem_uso antigo continua por ultimo', () => {
  assert.ok(prioridade('sem_uso', 12) < prioridade('aprova_nao_vende', 100))
  assert.equal(prioridade('sem_uso', 45), PRIORIDADE.sem_uso)
  assert.equal(prioridade('sem_uso', null), PRIORIDADE.sem_uso)
  assert.equal(prioridade('vende_pouco', 5), PRIORIDADE.vende_pouco)
})
