import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inicioCampanha, progresso, proximaMensagem, textoMensagem, remontarObs, lerMarcas, blocoPromptCampanha, type Retrato } from './campanha-ativacao-calc.ts'

// série: retrato diário com o acumulado do MÊS; o retrato do dia D conta até D-1
function serie(diario: Record<string, [number, number]>, rid = '1'): Retrato[] {
  const dias = Object.keys(diario).sort()
  const out: Retrato[] = []
  let c = 0, v = 0, mes = ''
  for (const d of dias) {
    const m = d.slice(0, 7) + '-01'
    // virada do mês: o retrato do dia 1º ainda traz o mês anterior fechado (o cron coleta mais de um mês)
    if (m !== mes) { if (mes) out.push({ data_ref: d, retailer_id: rid, mes, consultas: c, vendas: v }); mes = m; c = 0; v = 0 }
    out.push({ data_ref: d, retailer_id: rid, mes, consultas: c, vendas: v }) // retrato da manhã: até ontem
    c += diario[d][0]; v += diario[d][1]
  }
  return out
}
const dias = (de: string, n: number, f: (i: number) => [number, number]) => Object.fromEntries(Array.from({ length: n }, (_, i) => [new Date(Date.parse(de + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10), f(i)]))

test('início: primeiro acesso em outubro antes do lançamento começa no lançamento; antes de outubro não entra', () => {
  assert.equal(inicioCampanha('2026-10-05T13:00:00Z'), '2026-10-09')
  assert.equal(inicioCampanha('2026-10-12T15:00:00Z'), '2026-10-12')
  assert.equal(inicioCampanha('2026-09-28T15:00:00Z'), null)
  assert.equal(inicioCampanha(null), null)
})

test('semana 1 batida com 30 consultas; vendas acumulam desde o início, inclusive na virada do mês', () => {
  // 5 consultas/dia de 26/10 a 30/11, 1 venda a cada 5 dias
  const s = serie(dias('2026-10-20', 42, (i) => [i >= 6 ? 5 : 0, i >= 6 && i % 5 === 0 ? 1 : 0]))
  const p = progresso('2026-10-26', s, '2026-11-24')
  assert.equal(p.semanas[0].consultas, 35)
  assert.equal(p.semanas[0].batida, true)
  assert.equal(p.semanas[1].consultas, 35) // atravessa 01/11 (acumulado do mês zera) sem perder nada
  assert.ok(p.semanas[2].vendasAcum >= 2)
  assert.equal(p.semanas[3].fechada, true)
  assert.equal(p.semanaAtual, 5)
})

test('prêmio: R$ 80 por semana fechada batida; tudo batido vira R$ 500', () => {
  const tudo = serie(dias('2026-10-09', 30, () => [6, 1]))
  const p = progresso('2026-10-09', tudo, '2026-11-07')
  assert.equal(p.completa, true)
  assert.equal(p.premioGarantido, 500)
  const meio = progresso('2026-10-09', tudo, '2026-10-24')
  assert.equal(meio.premioGarantido, 160)
  const semVenda = serie(dias('2026-10-09', 30, () => [6, 0]))
  const q = progresso('2026-10-09', semVenda, '2026-11-07')
  assert.equal(q.semanas[2].batida, false) // semana 3 exige 2 vendas acumuladas
  assert.equal(q.premioGarantido, 160)
})

test('mensagens: boas-vindas → parcial no dia 4 → resultado na virada; cada uma uma vez', () => {
  const s = serie(dias('2026-10-09', 30, () => [2, 0]))
  const env = new Set<string>()
  let p = progresso('2026-10-09', s, '2026-10-09')
  assert.equal(proximaMensagem(p, env), 'boas_vindas'); env.add('boas_vindas')
  p = progresso('2026-10-09', s, '2026-10-11')
  assert.equal(proximaMensagem(p, env), null)
  p = progresso('2026-10-09', s, '2026-10-12')
  assert.equal(proximaMensagem(p, env), 'meio_s1'); env.add('meio_s1')
  assert.match(textoMensagem('meio_s1', p), /6 de 30 consultas/)
  p = progresso('2026-10-09', s, '2026-10-16')
  assert.equal(proximaMensagem(p, env), 'fim_s1'); env.add('fim_s1')
  assert.match(textoMensagem('fim_s1', p), /não deu/)
  assert.equal(proximaMensagem(p, env), null)
})

test('marcadores e bloco da VictorIA', () => {
  const s = serie(dias('2026-10-09', 10, () => [5, 0]))
  const p = progresso('2026-10-09', s, '2026-10-13')
  const obs = remontarObs('[X:1]', '2026-10-09', p, 'meio_s1', new Date('2026-10-13T14:00:00Z'))
  const m = lerMarcas(obs)
  assert.equal(m.inicio, '2026-10-09')
  assert.ok(m.enviadas.has('meio_s1'))
  const b = blocoPromptCampanha(obs)!
  assert.match(b, /semana 1 de 4/)
  assert.match(b, /20 de 30 consultas/)
  assert.equal(blocoPromptCampanha('[X:1]'), null)
})

test('bloco: encerrada não vira argumento e some 14 dias depois do fim', () => {
  const obs = '[CAMP_ATIV:2026-10-09] [CAMP_ATIV_PLACAR:s=4|c=30|v=6|g=500|ct=120|fim=1|d=2026-11-07]'
  assert.match(blocoPromptCampanha(obs, '2026-11-10')!, /ENCERRADA/)
  assert.doesNotMatch(blocoPromptCampanha(obs, '2026-11-10')!, /ao dar dica/)
  assert.equal(blocoPromptCampanha(obs, '2026-11-21'), null)
  assert.match(blocoPromptCampanha(obs.replace('fim=1', 'fim=0'), '2026-10-20')!, /ESTÁ PARTICIPANDO/)
})
