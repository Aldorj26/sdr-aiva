import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COLUNA_PARA_ETAPA, COLUNA_SEM_ETAPA, calcularEspelho, colunaDesconhecida, etapaDesejada, preCadastroNaoChegou, situacaoOnb, type Entrada, type OnbApi, type RegistroCnpj } from './espelho-portal-calc.ts'

const onb = (p: Partial<OnbApi> & { cnpj: string }): OnbApi => ({ stage: 'dados_varejo', pre_cadastro_status: 'approved', retailer_id: null, legal_name: 'LOJA X', ...p })
const base = (p: Partial<Entrada> = {}): Entrada => ({
  onboardings: [], loginEnviado: new Set(), vendeu: new Set(), registros: [], leads: [], stageAtual: new Map(), ...p,
})
const lead = (id: string, opp: number | null, status = 'CADASTRO_RECEBIDO', observacoes: string | null = null) =>
  ({ id, nome: `Lead ${id}`, status, evotalks_opportunity_id: opp, observacoes })

test('etapaDesejada: escada do portal', () => {
  const l = new Set(['5']), v = new Set(['9'])
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'pre_cadastro' }), l, v), null)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'not_approved' }), l, v), null)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'dados_varejo' }), l, v), 50)
  // sem board_column (cadastro antigo): biometria tem etapa própria desde 07/10/2026
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'biometria' }), l, v), 96)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'biometria', biometry_status: 'pendente' }), l, v), 96)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'biometria', biometry_status: 'negado' }), l, v), 96)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'biometria', biometry_status: 'aprovado' }), l, v), 97)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', retailer_id: 7 }), l, v), 70)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', retailer_id: '5' }), l, v), 71)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', retailer_id: '9' }), l, v), 51)
})

test('board_column manda: cada coluna da AIVA vira a etapa do Evo; venda vence', () => {
  const l = new Set<string>(), v = new Set(['9'])
  const col = (board_column: string, retailer_id: string | null = null) => etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', board_column, retailer_id }), l, v)
  assert.equal(col('not_approved'), null)
  assert.equal(col('pre_cadastro'), null)
  assert.equal(col('dados_varejo'), 50)
  assert.equal(col('biometria_pendente'), 96)
  assert.equal(col('biometria_aprovada'), 97)
  // 19/10/2026: loja já criada (RID) com a coluna atrasada em 50/96/97 → 70 (ARPF tech, RID 7910)
  assert.equal(col('biometria_aprovada', '7910'), 70)
  assert.equal(col('biometria_pendente', '7910'), 70)
  assert.equal(col('dados_varejo', '7910'), 70)
  assert.equal(col('cadastro_finalizado', '7'), 70)
  assert.equal(col('treinamento_agendado', '7'), 98)
  assert.equal(col('pronto_para_operar', '7'), 71)
  assert.equal(col('pronto_para_operar', '9'), 51)   // consultou/vendeu
})

test('Treinamento agendado volta pra Cadastro finalizado junto com a AIVA (sem passar por nada)', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '7', board_column: 'cadastro_finalizado' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100, 'TREINAR')],
    stageAtual: new Map([[100, 98]]),
  }))
  assert.deepEqual({ de: r.movimentos[0].de, para: r.movimentos[0].para, via: r.movimentos[0].via }, { de: 98, para: 70, via: [] })
})

test('Vendendo (51) com consulta/venda nunca volta pra coluna da AIVA', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '7', board_column: 'pronto_para_operar' })],
    vendeu: new Set(['7']),
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100, 'LOJA_FINALIZADA_E_VENDENDO')],
    stageAtual: new Map([[100, 51]]),
  }))
  assert.equal(r.movimentos.length, 0)
})

test('Vendendo (51) SEM consulta nem venda volta pra coluna real (Karol, 07/10/2026)', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '7', board_column: 'pronto_para_operar' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100, 'LOJA_FINALIZADA_E_VENDENDO')],
    stageAtual: new Map([[100, 51]]),
  }))
  assert.deepEqual({ de: r.movimentos[0].de, para: r.movimentos[0].para, via: r.movimentos[0].via }, { de: 51, para: 71, via: [] })
})

test('primeiro_acesso vira a etapa 99', () => {
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', retailer_id: '7', board_column: 'primeiro_acesso' }), new Set(), new Set()), 99)
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', retailer_id: '7', primeiro_acesso_em: '2026-10-05T13:00:00Z' }), new Set(), new Set()), 99)
})

test('Formulário → Biometria aprovada não passa por Cadastro finalizado', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'biometria', biometry_status: 'aprovado', board_column: 'biometria_aprovada' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100, 'EM_ANALISE_AIVA')],
    stageAtual: new Map([[100, 50]]),
  }))
  assert.deepEqual({ para: r.movimentos[0].para, via: r.movimentos[0].via }, { para: 97, via: [] })
})

test('avança 49 → 50 quando o portal está em dados_varejo', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '46.618.959/0002-77' })],
    registros: [{ id: 1, cnpj: '46618959000277', lead_id: 'a', status: 'informada' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 49]]),
  }))
  assert.equal(r.movimentos.length, 1)
  assert.deepEqual({ opp: r.movimentos[0].opp, de: r.movimentos[0].de, para: r.movimentos[0].para, via: r.movimentos[0].via }, { opp: 100, de: 49, para: 50, via: [] })
  assert.deepEqual(r.registrosEnviados, [1])
})

test('fica em silêncio quando já está na etapa da coluna (e não regride fora do bloco da AIVA)', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 50]]),
  }))
  assert.equal(r.movimentos.length, 0)
  assert.equal(r.pulados.length, 0)
  assert.equal(r.registrosEnviados.length, 0)
})

test('destino além de Treinar passa por 70 (HSM do treinamento) mas não por 50', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '5' })],
    loginEnviado: new Set(['5']),
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 49]]),
  }))
  assert.equal(r.movimentos.length, 1)
  assert.deepEqual({ para: r.movimentos[0].para, via: r.movimentos[0].via }, { para: 71, via: [70] })
})

test('já em Treinar indo pra Login não repassa por 70', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '5' })],
    loginEnviado: new Set(['5']),
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 70]]),
  }))
  assert.deepEqual({ para: r.movimentos[0].para, via: r.movimentos[0].via }, { para: 71, via: [] })
})

test('Sem Resposta (53) pode avançar; Bot/93/94 nunca; status terminal nunca', () => {
  const o = [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '5' })]
  const reg = (l: string) => ({ id: l, cnpj: '11111111000191', lead_id: l, status: 'pre_cadastro_enviado' })
  const r = calcularEspelho(base({
    onboardings: o,
    registros: [reg('semresp'), reg('bot'), reg('menos1'), reg('irreg'), reg('optout')],
    leads: [lead('semresp', 1), lead('bot', 2), lead('menos1', 3), lead('irreg', 4), lead('optout', 5, 'OPT_OUT')],
    stageAtual: new Map([[1, 53], [2, 69], [3, 93], [4, 94], [5, 49]]),
  }))
  assert.deepEqual(r.movimentos.map((m) => m.lead_id), ['semresp'])
  assert.deepEqual(r.pulados.map((p) => p.lead_id).sort(), ['bot', 'irreg', 'menos1', 'optout'])
})

test('lead sem opp ou com opp fora do funil é pulado com motivo', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: null }, { id: 2, cnpj: '11111111000191', lead_id: 'b', status: null }],
    leads: [lead('a', null), lead('b', 999)],
    stageAtual: new Map(),
  }))
  assert.equal(r.movimentos.length, 0)
  assert.equal(r.pulados.length, 2)
  assert.deepEqual(r.registrosEnviados, [1, 2])
})

test('lead com matriz e filial: vale o CNPJ mais avançado', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'dados_varejo' }), onb({ cnpj: '11111111000272', stage: 'cadastro_finalizado', retailer_id: '8' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }, { id: 2, cnpj: '11111111000272', lead_id: 'a', status: 'informada' }],
    leads: [lead('a', 100)],
    stageAtual: new Map([[100, 50]]),
  }))
  assert.equal(r.movimentos[0].para, 70)
  assert.deepEqual(r.registrosEnviados, [2])
})

test('reprovado: vai pra 95 de qualquer etapa; avisa só uma vez; não toca 95/bot/93/94 nem OPT_OUT; outro CNPJ que avança não APAGA a reprovação', () => {
  const o = [onb({ cnpj: '11111111000191', stage: 'not_approved', pre_cadastro_status: 'not_approved' })]
  const reg = (l: string) => ({ id: l, cnpj: '11111111000191', lead_id: l, status: 'pre_cadastro_enviado' })
  const r = calcularEspelho(base({
    onboardings: [...o, onb({ cnpj: '22222222000191', stage: 'dados_varejo' })],
    registros: [reg('novo'), reg('jamarcado'), reg('descartado'), reg('ja95'), reg('bot'), reg('optout'), reg('semopp'), reg('temoutro'), { id: 'x', cnpj: '22222222000191', lead_id: 'temoutro', status: 'pre_cadastro_enviado' }],
    leads: [
      lead('novo', 1), lead('jamarcado', 2, 'EM_ANALISE_AIVA', '[PORTAL_REPROVADO:2026-09-01T00:00:00Z]'), lead('descartado', 3, 'DESCARTADO'),
      lead('ja95', 5, 'NAO_QUALIFICADO', '[PORTAL_REPROVADO:2026-09-01T00:00:00Z]'), lead('bot', 6, 'BOT_DETECTADO'), lead('optout', 7, 'OPT_OUT'), lead('semopp', null), lead('temoutro', 4),
    ],
    stageAtual: new Map([[1, 50], [2, 50], [3, 53], [4, 49], [5, 95], [6, 69], [7, 50]]),
  }))
  assert.deepEqual(r.reprovados.map((x) => [x.lead_id, x.de, x.jaAvisado]), [['novo', 50, false], ['jamarcado', 50, true], ['descartado', 53, false]])
  assert.equal(r.reprovados[0].cnpj, '11111111000191')
  assert.deepEqual(r.pulados.map((p) => p.lead_id).sort(), ['optout', 'semopp'])
  assert.deepEqual(r.movimentos.map((m) => m.lead_id), ['temoutro'])
  // ⚠️ Este assert dizia `conferir.length === 0` e estava fixando um DEFEITO
  // (achado 24/09/2026): o lead `temoutro` tem um CNPJ que avança e outro
  // REPROVADO pela AIVA, e a reprovação sumia — nem como aviso. Caso real: DHtech
  // e Pulse, matriz vendendo (RID 5643) e filial recusada no portal.
  // O card continua avançando (a loja opera), mas o time PRECISA saber da recusa.
  assert.deepEqual(r.conferir.map((c) => [c.lead_id, c.cnpj]), [['temoutro', '11111111000191']])
  assert.match(r.conferir[0].motivo, /reprovado pela AIVA/)
})

test('reprovado com sinal de loja operando (card em 51, RID ou registro ativo) NÃO é movido: vai pra "conferir"', () => {
  const o = [onb({ cnpj: '11111111000191', stage: 'not_approved', pre_cadastro_status: 'not_approved' })]
  const r = calcularEspelho(base({
    onboardings: o,
    registros: [
      { id: 1, cnpj: '11111111000191', lead_id: 'vendendo', status: 'pre_cadastro_enviado' },
      { id: 2, cnpj: '11111111000191', lead_id: 'comrid', status: 'pre_cadastro_enviado', rid: '5819' },
      { id: 3, cnpj: '11111111000191', lead_id: 'ativa', status: 'ativa' },
      { id: 4, cnpj: '11111111000191', lead_id: 'normal', status: 'pre_cadastro_enviado' },
    ],
    leads: [lead('vendendo', 1, 'LOJA_FINALIZADA_E_VENDENDO'), lead('comrid', 2, 'TREINAR'), lead('ativa', 3, 'LOGIN', '[PORTAL_REPROVADO_CONFERIR:2026-09-16T00:00:00Z]'), lead('normal', 4, 'TREINAR')],
    stageAtual: new Map([[1, 51], [2, 70], [3, 71], [4, 70]]),
  }))
  assert.deepEqual(r.conferir.map((c) => [c.lead_id, c.de, c.jaAvisado]), [['vendendo', 51, false], ['comrid', 70, false], ['ativa', 71, true]])
  assert.match(r.conferir[0].motivo, /Vendendo/)
  assert.match(r.conferir[1].motivo, /RID 5819/)
  assert.deepEqual(r.reprovados.map((x) => x.lead_id), ['normal'])
})

// A selfie aprovada com o cadastro parado em `biometria` é a loja esperando a
// AIVA criar o ID — NÃO é biometria pendente. Confundir os dois faz o sistema
// cobrar de novo quem já fez tudo (LT CELL IMPORTS, 18/09/2026).
test('situacaoOnb separa o que falta ao lojista do que falta à AIVA', () => {
  assert.equal(situacaoOnb('dados_varejo', 'pendente'), 'dados_varejo')
  assert.equal(situacaoOnb('biometria', 'pendente'), 'biometria')
  assert.equal(situacaoOnb('biometria', 'aprovado'), 'aguardando_aiva')
  assert.equal(situacaoOnb('biometria', 'negado'), 'biometria_negada')
  assert.equal(situacaoOnb('biometria', null), 'biometria')
  assert.equal(situacaoOnb('cadastro_finalizado', 'aprovado'), null)
  assert.equal(situacaoOnb('not_approved', 'pendente'), null)
})

test('lojista com DOIS CNPJs reprovados e nenhum avançando: vai pra 95 uma vez só', () => {
  const r = calcularEspelho(base({
    onboardings: [
      onb({ cnpj: '11111111000191', stage: 'not_approved', pre_cadastro_status: 'not_approved' }),
      onb({ cnpj: '22222222000191', stage: 'not_approved', pre_cadastro_status: 'not_approved' }),
    ],
    registros: [
      { id: 'a', cnpj: '11111111000191', lead_id: 'dois', status: 'pre_cadastro_enviado' },
      { id: 'b', cnpj: '22222222000191', lead_id: 'dois', status: 'pre_cadastro_enviado' },
    ],
    leads: [lead('dois', 1)],
    stageAtual: new Map([[1, 50]]),
  }))
  assert.equal(r.reprovados.length, 1, 'um lead, um movimento pra 95')
  assert.equal(r.conferir.length, 0, 'sem CNPJ avançando, não é caso de conferir')
})

test('loja que OPERA com outro CNPJ reprovado: card não é movido pra 95, mas entra em conferir', () => {
  // o caso DHtech e Pulse (24/09/2026): matriz vendendo, filial recusada
  const r = calcularEspelho(base({
    onboardings: [
      onb({ cnpj: '11111111000191', stage: 'not_approved', pre_cadastro_status: 'not_approved' }),
      onb({ cnpj: '22222222000191', stage: 'cadastro_finalizado', biometry_status: 'aprovado', retailer_id: 5643 }),
    ],
    registros: [
      { id: 'a', cnpj: '11111111000191', lead_id: 'opera', status: 'pre_cadastro_enviado' },
      { id: 'b', cnpj: '22222222000191', lead_id: 'opera', status: 'ativa', rid: '5643' },
    ],
    leads: [lead('opera', 1)],
    stageAtual: new Map([[1, 70]]),
  }))
  assert.equal(r.reprovados.length, 0, 'loja que opera NUNCA é jogada pra 95 sozinha')
  assert.deepEqual(r.conferir.map((c) => c.cnpj), ['11111111000191'])
})

test('loja antiga fora da API que consulta pelo RID do registro não regride por causa da filial nova (Fone Express, 13/10/2026)', () => {
  // matriz 5167 opera mas não está nos onboardings; só a filial nova aparece, em dados_varejo
  const entrada = {
    onboardings: [onb({ cnpj: '68182669000185', stage: 'dados_varejo', board_column: 'dados_varejo' })],
    vendeu: new Set(['5167']),
    registros: [
      { id: 1, cnpj: '65870629000138', lead_id: 'a', status: 'ativa', rid: '5167' },
      { id: 2, cnpj: '68182669000185', lead_id: 'a', status: 'pre_cadastro_enviado', rid: null },
    ],
  }
  const em51 = calcularEspelho(base({ ...entrada, leads: [lead('a', 100, 'LOJA_FINALIZADA_E_VENDENDO')], stageAtual: new Map([[100, 51]]) }))
  assert.equal(em51.movimentos.length, 0)
  // quem já foi levado pra 50 pelo defeito volta pra 51 — SEM passar pela 70: a loja já vende, e a entrada
  // na 70 mandaria "liberada para o treinamento" (foi o que a Fone Express recebeu em 13/10; Aldo 20/10/2026)
  const em50 = calcularEspelho(base({ ...entrada, leads: [lead('a', 100, 'EM_ANALISE_AIVA')], stageAtual: new Map([[100, 50]]) }))
  assert.deepEqual({ para: em50.movimentos[0]?.para, via: em50.movimentos[0]?.via }, { para: 51, via: [] })
})

// ─── lacuna 1 da auditoria de 15/10/2026: coluna do portal sem mapeamento ──────

test('primeira_venda vira 51 mesmo sem o retailer_performance (auditoria 15/10/2026)', () => {
  const l = new Set<string>(), v = new Set<string>()   // nenhuma venda conhecida: o sinal do portal é SÓ a coluna
  // antes de 15/10 isto devolvia null e a loja congelava onde estava
  assert.equal(etapaDesejada(onb({ cnpj: '1', stage: 'cadastro_finalizado', board_column: 'primeira_venda', retailer_id: '7' }), l, v), 51)
  // e o card anda de verdade
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '11111111000191', stage: 'cadastro_finalizado', retailer_id: '7', board_column: 'primeira_venda' })],
    registros: [{ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado' }],
    leads: [lead('a', 100, 'TREINAR')],
    stageAtual: new Map([[100, 70]]),
  }))
  assert.deepEqual(r.movimentos.map((m) => ({ para: m.para, via: m.via })), [{ para: 51, via: [] }])
})

test('todas as colunas vistas em produção têm destino (mapeada ou fora de propósito)', () => {
  // retrato do portal em 15/10/2026 (786 onboardings)
  const vistas = ['dados_varejo', 'primeiro_acesso', 'primeira_venda', 'pronto_para_operar', 'biometria_pendente',
    'not_approved', 'cadastro_finalizado', 'pre_cadastro', 'treinamento_agendado']
  for (const c of vistas) {
    assert.equal(colunaDesconhecida(c), null, `coluna ${c} sem destino`)
    assert.ok(c in COLUNA_PARA_ETAPA || COLUNA_SEM_ETAPA.has(c), `coluna ${c} nem mapeada nem excluída`)
  }
  assert.equal(colunaDesconhecida('coluna_nova_da_aiva'), 'coluna_nova_da_aiva')
  assert.equal(colunaDesconhecida(null), null)
  assert.equal(colunaDesconhecida(''), null)
})

test('coluna NOVA do portal cai na dedução pelo stage em vez de congelar o card', () => {
  const l = new Set(['5']), v = new Set<string>()
  const o = (board_column: string, p: Partial<OnbApi> = {}) => etapaDesejada(onb({ cnpj: '1', stage: 'dados_varejo', board_column, ...p }), l, v)
  assert.equal(o('coluna_que_ninguem_mapeou'), 50)                                  // stage dados_varejo
  assert.equal(o('coluna_que_ninguem_mapeou', { stage: 'cadastro_finalizado', retailer_id: '5' }), 71)
  // as duas colunas que ficam fora DE PROPÓSITO continuam fora (não caem na dedução)
  assert.equal(o('pre_cadastro', { stage: 'cadastro_finalizado', retailer_id: '5' }), null)
  assert.equal(o('not_approved', { stage: 'cadastro_finalizado', retailer_id: '5' }), null)
})

// ── passo 11: pré-cadastro marcado como enviado que não chegou ao portal ──────────────
// A regra morava solta em lib/espelho-portal.ts (IO) e não tinha teste nenhum; veio pra cá
// em 15/10/2026 junto com a correção do relógio (enviado_em, não criado_em).
{
  const AGORA = Date.parse('2026-10-15T20:00:00Z')
  const h = (n: number) => new Date(AGORA - n * 3_600_000).toISOString()
  const reg = (p: Partial<RegistroCnpj> = {}): RegistroCnpj =>
    ({ id: 1, cnpj: '11111111000191', lead_id: 'a', status: 'pre_cadastro_enviado', ...p })
  const leadA = (status = 'CADASTRO_RECEBIDO') => [lead('a', 1, status)]
  const travados = (registros: RegistroCnpj[], onboardings: OnbApi[] = [], leads = leadA()) =>
    preCadastroNaoChegou(onboardings, registros, leads, AGORA).travados

  test('pré-cadastro não chegou: o relógio é o clique (enviado_em), não a captura do CNPJ', () => {
    // o furo de 15/10: CNPJ capturado há 8 dias e clicado agora disparava na primeira rodada
    assert.equal(travados([reg({ criado_em: h(192), enviado_em: h(1) })]).size, 0)
    // clicado há 25h: aí sim o formulário não foi
    assert.equal(travados([reg({ criado_em: h(192), enviado_em: h(25) })]).size, 1)
    // exatamente 24h já conta
    assert.equal(travados([reg({ criado_em: h(192), enviado_em: h(24) })]).size, 1)
  })

  test('pré-cadastro não chegou: sem enviado_em (linha antiga) o relógio cai em criado_em', () => {
    assert.equal(travados([reg({ criado_em: h(25) })]).size, 1)
    assert.equal(travados([reg({ criado_em: h(2) })]).size, 0)
    assert.equal(travados([reg({ criado_em: h(25), enviado_em: null })]).size, 1)
    // sem data nenhuma não dá pra afirmar nada: não trava
    assert.equal(travados([reg()]).size, 0)
  })

  test('pré-cadastro não chegou: CNPJ no portal, outra etapa ou não marcado não travam', () => {
    const velho = reg({ criado_em: h(48), enviado_em: h(48) })
    // apareceu no portal → chegou
    assert.equal(travados([velho], [onb({ cnpj: '11111111000191' })]).size, 0)
    // basta UM CNPJ do lead no portal pra inocentar o lead inteiro
    assert.equal(travados(
      [velho, reg({ id: 2, cnpj: '22222222000191', criado_em: h(48), enviado_em: h(48) })],
      [onb({ cnpj: '22222222000191' })],
    ).size, 0)
    // etapa que a regra não cobre
    assert.equal(travados([velho], [], leadA('EM_ANALISE_AIVA')).size, 0)
    assert.equal(travados([velho], [], leadA('LOJA_FINALIZADA_E_VENDENDO')).size, 0)
    // vale também na pré-aprovação
    assert.equal(travados([velho], [], leadA('PRE_APROVACAO')).size, 1)
    // registro ainda não marcado como enviado
    assert.equal(travados([reg({ criado_em: h(48), enviado_em: h(48), status: 'informada' })]).size, 0)
    // registro sem lead
    assert.equal(travados([reg({ lead_id: null, criado_em: h(48), enviado_em: h(48) })]).size, 0)
  })

  test('pré-cadastro não chegou: com vários CNPJs vale o mais antigo e todos entram no detalhe', () => {
    const { porLead, travados: t } = preCadastroNaoChegou([], [
      reg({ id: 1, cnpj: '11111111000191', enviado_em: h(30) }),
      reg({ id: 2, cnpj: '22222222000191', enviado_em: h(2) }),
    ], leadA(), AGORA)
    assert.equal(t.has('a'), true)
    assert.deepEqual(porLead.get('a')!.cnpjs, ['11111111000191', '22222222000191'])
    assert.equal(porLead.get('a')!.maisAntigo, Date.parse(h(30)))
  })
}

// ── AIVA reconsiderou um reprovado (DG Importados, 26/10/2026) ───────────────
test('card em 95 pelo espelho ([PORTAL_REPROVADO]) e CNPJ aprovado no portal: volta pra etapa do portal, destravando', () => {
  const reg = (l: string) => ({ id: l, cnpj: '33333333000191', lead_id: l, status: 'pre_cadastro_enviado' })
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '33333333000191', stage: 'dados_varejo', board_column: 'dados_varejo' })],
    registros: [reg('reconsiderado'), reg('manual95'), reg('optout95')],
    leads: [
      lead('reconsiderado', 1, 'NAO_QUALIFICADO', '[PORTAL_REPROVADO:2026-10-08T03:01:03Z] [RETORNO_CNPJ_ALERTA:2026-10-26T17:22:15Z]'),
      // card em 95 SEM o nosso marcador = o time descartou na mão: intocado
      lead('manual95', 2, 'NAO_QUALIFICADO'),
      lead('optout95', 3, 'OPT_OUT', '[PORTAL_REPROVADO:2026-10-08T03:01:03Z]'),
    ],
    stageAtual: new Map([[1, 95], [2, 95], [3, 95]]),
  }))
  assert.deepEqual(r.movimentos.map((m) => [m.lead_id, m.de, m.para, m.via, m.reconsiderado]), [['reconsiderado', 95, 50, [], true]])
  assert.match(r.movimentos[0].motivo, /AIVA reconsiderou/)
  assert.deepEqual(r.reprovados, [])
  assert.deepEqual(r.pulados.map((p) => p.lead_id).sort(), ['manual95', 'optout95'])
})

test('reconsiderado com o portal já em cadastro finalizado passa pela 70 (HSM do treinamento)', () => {
  const r = calcularEspelho(base({
    onboardings: [onb({ cnpj: '33333333000191', stage: 'cadastro_finalizado', board_column: 'pronto_para_operar', retailer_id: '9001' })],
    registros: [{ id: 'a', cnpj: '33333333000191', lead_id: 'x', status: 'pre_cadastro_enviado' }],
    leads: [lead('x', 1, 'NAO_QUALIFICADO', '[PORTAL_REPROVADO:2026-10-08T03:01:03Z]')],
    stageAtual: new Map([[1, 95]]),
  }))
  assert.deepEqual(r.movimentos.map((m) => [m.de, m.para, m.via, m.reconsiderado]), [[95, 71, [70], true]])
})

// ── Derrubado pela AIVA: 30+ dias em formulário do varejo pendente (Aldo 28/10/2026) ──
import { DIAS_MIN_DERRUBADO, dataProvaPortal } from './espelho-portal-calc.ts'

test('derrubado: card em 50 com prova antiga do portal e CNPJ sumido volta pra 54; sem prova, novo ou importado não', () => {
  const DIA = 86_400_000
  const agora = Date.parse('2026-10-28T12:00:00Z')
  const velho = new Date(agora - 40 * DIA).toISOString()
  const novo = new Date(agora - 10 * DIA).toISOString()
  const reg = (l: string, cnpj: string) => ({ id: l, cnpj, lead_id: l, status: 'pre_cadastro_enviado' })
  const r = calcularEspelho(base({
    agora,
    onboardings: [onb({ cnpj: '99999999000191', stage: 'dados_varejo', board_column: 'dados_varejo' })],
    registros: [reg('derrubado', '11111111000191'), reg('semprova', '22222222000191'), reg('recente', '33333333000191'), reg('importado', '44444444000191'), reg('aindaNoPortal', '99999999000191'), reg('em49', '55555555000191')],
    leads: [
      lead('derrubado', 1, 'EM_ANALISE_AIVA', `[ESPELHO_PORTAL:50:${velho}] [ONB_ETAPA:dados_varejo:${novo}]`),
      lead('semprova', 2, 'EM_ANALISE_AIVA', '[CAD_ALERTADO]'),
      lead('recente', 3, 'EM_ANALISE_AIVA', `[ESPELHO_PORTAL:50:${novo}]`),
      lead('importado', 4, 'EM_ANALISE_AIVA', `[IMPORTADO_PORTAL:x] [ONB_ETAPA:dados_varejo:${velho}]`),
      lead('aindaNoPortal', 5, 'EM_ANALISE_AIVA', `[ESPELHO_PORTAL:50:${velho}]`),
      lead('em49', 6, 'CADASTRO_RECEBIDO', `[ESPELHO_PORTAL:50:${velho}]`),
    ],
    stageAtual: new Map([[1, 50], [2, 50], [3, 50], [4, 50], [5, 50], [6, 49]]),
  }))
  assert.deepEqual(r.derrubados.map((d) => [d.lead_id, d.opp, d.cnpjs, d.dias]), [['derrubado', 1, ['11111111000191'], 40]])
  // a prova mais antiga manda (ESPELHO 40 dias, não o ONB de 10)
  assert.equal(r.derrubados[0].desde, velho)
  assert.deepEqual(r.movimentos, [])
  const motivos = Object.fromEntries(r.pulados.map((p) => [p.lead_id, p.motivo]))
  assert.match(motivos.recente, /10 dia/)
  assert.match(motivos.importado, /importado/)
  assert.equal(motivos.semprova, undefined)
  assert.equal(motivos.aindaNoPortal, undefined)
  assert.equal(motivos.em49, undefined)
  assert.equal(DIAS_MIN_DERRUBADO, 25)
  assert.equal(dataProvaPortal('[X]'), null)
})
