import { test } from 'node:test'
import assert from 'node:assert/strict'
import { faseDe, montarPainel, mesAnterior, segundaDaSemana, movimentoPorCnpj, type Onb, type Perf, type Entradas } from './jornada-aiva-calc.ts'

const AGORA = Date.parse('2026-09-24T18:00:00Z')   // qui 24/09 15h BRT
const C1 = '11111111000111', C2 = '22222222000122', C3 = '33333333000133'
const vazio = new Map<string, string>()

function entradas(p: Partial<Entradas>): Entradas {
  return { onbs: [], perf: [], senhaEnviada: new Map(), senhaPedida: new Map(), leadPorCnpj: new Map(), stagePorOpp: new Map(), agora: AGORA, ...p }
}

test('stage do portal sozinho mente: biometria + aprovado = esperando a AIVA', () => {
  assert.equal(faseDe({ stage: 'biometria', biometry_status: 'pendente' }, undefined, vazio), 'biometria')
  assert.equal(faseDe({ stage: 'biometria', biometry_status: 'aprovado' }, undefined, vazio), 'aguardando_aiva')
  assert.equal(faseDe({ stage: 'biometria', biometry_status: 'negado' }, undefined, vazio), 'biometria_negada')
  assert.equal(faseDe({ stage: 'dados_varejo' }, undefined, vazio), 'formulario')
  assert.equal(faseDe({ stage: 'not_approved' }, undefined, vazio), 'reprovado')
  assert.equal(faseDe({ stage: 'dados_varejo', pre_cadastro_status: 'declined' }, undefined, vazio), 'pre_recusado')
})

test('loja criada: sem senha x com senha é o login_sends que decide', () => {
  const o: Onb = { stage: 'cadastro_finalizado', retailer_id: '7021' }
  assert.equal(faseDe(o, undefined, vazio), 'sem_senha')
  assert.equal(faseDe(o, undefined, new Map([['7021', '2026-09-20T12:00:00Z']])), 'sem_movimento')
})

test('VENDA vence o stage — o lote importado está em dados_varejo e vende há meses', () => {
  const vendeu = { vendasTotal: 12, consultasTotal: 30, vendasMes: 2, vendasMesAnt: 5, valorMes: 3000, ultimoMesComVenda: '2026-09' }
  assert.equal(faseDe({ stage: 'dados_varejo' }, vendeu, vazio), 'vendendo')
  // vendeu no passado, nada nos dois últimos meses → parou
  assert.equal(faseDe({ stage: 'cadastro_finalizado', retailer_id: '1' }, { ...vendeu, vendasMes: 0, vendasMesAnt: 0, ultimoMesComVenda: '2026-06' }, vazio), 'parou')
  // consulta sem venda
  assert.equal(faseDe({ stage: 'cadastro_finalizado', retailer_id: '1' }, { ...vendeu, vendasTotal: 0, vendasMes: 0, vendasMesAnt: 0 }, vazio), 'consultando')
})

test('mesAnterior vira o ano', () => {
  assert.equal(mesAnterior('2026-01'), '2025-12')
  assert.equal(mesAnterior('2026-09'), '2026-08')
})

test('segundaDaSemana usa o dia de Brasília', () => {
  assert.equal(segundaDaSemana(AGORA), '2026-09-21')
  // domingo 27/09 01h UTC ainda é sábado 26 em BRT → mesma semana
  assert.equal(segundaDaSemana(Date.parse('2026-09-27T01:00:00Z')), '2026-09-21')
})

test('desempenho sem CNPJ na linha é resolvido pelo RID do cadastro', () => {
  const onbs: Onb[] = [{ cnpj: '11.111.111/0001-11', retailer_id: 55 }]
  const perf: Perf[] = [{ retailer_id: '55', cnpj: null, mes: '2026-09-01', n_vendas: 3, n_consultas: 4 }]
  const m = movimentoPorCnpj(perf, onbs, '2026-09')
  assert.equal(m.get(C1)?.vendasMes, 3)
})

test('fila do Nei: AIVA devendo loja e senha, com o mais antigo primeiro', () => {
  const p = montarPainel(entradas({
    onbs: [
      { cnpj: C1, legal_name: 'LOJA A', stage: 'biometria', biometry_status: 'aprovado', updated_at: '2026-09-20T12:00:00Z' },
      { cnpj: C2, legal_name: 'LOJA B', stage: 'biometria', biometry_status: 'aprovado', updated_at: '2026-09-22T12:00:00Z' },
      { cnpj: C3, legal_name: 'LOJA C', stage: 'cadastro_finalizado', retailer_id: '9', retailer_registered_at: '2026-09-15T12:00:00Z' },
    ],
    senhaPedida: new Map([['9', '2026-09-16T12:00:00Z']]),
  }), new Map())
  const aiva = p.acoes.find((a) => a.chave === 'aguardando_aiva')!
  assert.deepEqual(aiva.lojas.map((l) => l.loja), ['LOJA A', 'LOJA B'])
  const senha = p.acoes.find((a) => a.chave === 'sem_senha')!
  assert.equal(senha.lojas.length, 1)
  assert.match(senha.lojas[0].detalhe ?? '', /pedida há 8 dia/)
})

test('loja só no desempenho entra na jornada (senão "Vendendo" fica menor que o portal)', () => {
  const p = montarPainel(entradas({
    perf: [{ retailer_id: '77', cnpj: C1, retailer_name: 'ANTIGA', mes: '2026-09-01', n_vendas: 4, valor_vendas: 5000 }],
  }), new Map())
  assert.equal(p.total, 1)
  assert.equal(p.lojas[0].fase, 'vendendo')
  assert.equal(p.desempenho.vendasMes, 4)
  assert.equal(p.desempenho.lojasComVendaMes, 1)
})

test('card do Evo atrás do portal aparece; lateral (bot/93/94/95) não', () => {
  const lead = (opp: number) => ({ id: 'x', nome: 'L', status: 'EM_ANALISE_AIVA', opp })
  const p = montarPainel(entradas({
    onbs: [
      { cnpj: C1, stage: 'cadastro_finalizado', retailer_id: '1' },      // loja criada → 70
      { cnpj: C2, stage: 'cadastro_finalizado', retailer_id: '2' },
    ],
    leadPorCnpj: new Map([[C1, lead(100)], [C2, lead(200)]]),
    stagePorOpp: new Map([[100, 49], [200, 95]]),
  }), new Map([[49, 1], [95, 1]]))
  assert.equal(p.evo.atrasados.length, 1)
  assert.equal(p.evo.atrasados[0].etapaCard, 49)
  assert.equal(p.evo.atrasados[0].etapaEsperada, 70)
  assert.equal(p.evo.totalCards, 2)
})

test('CNPJ ruim na Receita: quem VENDE vem primeiro', () => {
  const p = montarPainel(entradas({
    onbs: [
      { cnpj: C1, legal_name: 'PARADA', stage: 'dados_varejo', cnpj_check_status: 'inapta' },
      { cnpj: C2, legal_name: 'VENDE', stage: 'cadastro_finalizado', retailer_id: '2', cnpj_check_status: 'invalid' },
      { cnpj: C3, stage: 'dados_varejo', cnpj_check_status: 'pending' },   // pending NÃO é irregular
    ],
    perf: [{ retailer_id: '2', cnpj: C2, mes: '2026-09-01', n_vendas: 1 }],
  }), new Map())
  assert.deepEqual(p.cnpjProblema.map((l) => l.loja), ['VENDE', 'PARADA'])
  assert.equal(p.cnpjProblema[0].detalhe, 'dígito verificador inválido')
})

test('nome do slug do portal vira nome legível', async () => {
  const { nomeDoSlug } = await import('./jornada-aiva-calc.ts')
  assert.equal(nomeDoSlug('gotech-45705247000141'), 'GOTECH')
  assert.equal(nomeDoSlug('andre-cell-mauriti-57252321000109'), 'ANDRE CELL MAURITI')
  assert.equal(nomeDoSlug(null), '')
})
