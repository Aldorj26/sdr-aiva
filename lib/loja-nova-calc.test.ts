import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  raizCnpj, classificar, ridDaRaiz, ehAtalhoNovaLoja, elegibilidade, deveAbrirFluxo, lerMotivoLojaNova,
  marcadorLojaNova, blocoPromptLojaNova, textoLinkLojaNova, textoLojaCriada, seloRegistroFila,
  ehMotivoLojaNova, cnpjsDasObs, lerMarcadorLojaNova, semMarcadorLojaNova, comMarcadorLojaNova, cnpjsParaConferir,
  marcadorPedido, jaPedido, avaliarPedidoLojaNova, resumoElegibilidade, avisoLojaNovaFila, instrucaoAtalhoLojaNova,
  deveInstruirAtalho, planoAlertaCnpjNovo, cadastroPrincipalAberto, reconferiveisDoLead, conferenciaParaFilial, fraseMotivoLojista,
  pendentesLink, pendentesCriada, recusadas, filaParadaLojaNova, chaveFilaParada, chaveLinkLojaNova, chaveCriadaLojaNova,
  chaveRecusadaLojaNova, colunaLojaNovaAusente, lojaTemplateLojaNova, utilLojaCriada, utilLinkLojaNova,
  type RegLojaNova, type RegLojaNovaFila, ehSocioMesmo, ridDaLojaPrincipal, linhaCuraLojaNova, blocoCuraLojaNova, avisoEscaladaLojaNova,
  decidirFalhaEnvio, rejeicaoClara, tentativasDe, chaveTentativaLojaNova, chaveRetidoLojaNova, TENTATIVAS_LOJA_NOVA, FLUXO_LOJA_NOVA,
  textoRecusadaLojaNova, utilRecusadaLojaNova, chaveRecusaAvisadaLojaNova, rotuloEnvioLojaNova,
} from './loja-nova-calc.ts'
import { montar } from './template-utilidade-calc.ts'
import { FLUXO_LOJA_NOVA_REG } from './espelho-portal-calc.ts'

const T0 = Date.parse('2026-11-19T13:00:00Z')
const MK_OK = marcadorLojaNova('59218413000190', { ok: true }, '2026-11-19T12:00:00Z')

test('motivo do fluxo é reconhecido pelo prefixo (o bloco de ticket não o trata)', () => {
  assert.ok(ehMotivoLojaNova(' Loja_Nova_Empresa: cnpj=1 | acao=x'))
  assert.ok(!ehMotivoLojaNova('abrir_ticket_filial: cnpj=59218413000190'))
  assert.ok(!ehMotivoLojaNova(null))
})
test('CNPJs conhecidos das observações ignoram o marcador do fluxo e o motivo cru', () => {
  const obs = `[DADOS_COLETADOS:cnpj_matriz=32.306.162/0001-49] ${MK_OK} loja_nova_empresa: cnpj=11222333000181 | acao=confirmar [FILIAL_AIVA:32306162000220]`
  assert.deepEqual(cnpjsDasObs(obs).sort(), ['32306162000149', '32306162000220'])
  assert.deepEqual(cnpjsDasObs(null), [])
})
test('marcador: leitura, remoção e troca por CNPJ', () => {
  const obs = `a ${MK_OK} ${marcadorLojaNova('11222333000181', { ok: false, motivo: 'odres', detalhe: 'base Odres/UME' }, '2026-11-18T12:00:00Z')} b`
  assert.deepEqual(lerMarcadorLojaNova(obs, '59.218.413/0001-90'), { sit: 'ok', det: '', t: Date.parse('2026-11-19T12:00:00Z') })
  assert.equal(lerMarcadorLojaNova(obs, '11222333000181')?.sit, 'odres')
  assert.equal(lerMarcadorLojaNova(obs, '99999999000191'), null)
  const sem = semMarcadorLojaNova(obs, '59218413000190')
  assert.equal(lerMarcadorLojaNova(sem, '59218413000190'), null)
  assert.ok(lerMarcadorLojaNova(sem, '11222333000181'))
  assert.match(sem, /^a \[LOJA_NOVA:cnpj=11222333000181.* b$/)
  const troca = comMarcadorLojaNova(obs, '59218413000190', marcadorLojaNova('59218413000190', { ok: false, motivo: 'nao_ativa', detalhe: 'BAIXADA' }, '2026-11-20T12:00:00Z'))
  assert.equal(troca.match(/cnpj=59218413000190/g)?.length, 1)
  assert.equal(lerMarcadorLojaNova(troca, '59218413000190')?.sit, 'nao_ativa')
  assert.equal(comMarcadorLojaNova(null, '59218413000190', MK_OK), MK_OK)
})
test('o que conferir antes do modelo: outra empresa, etapa certa, fora do repasse e sem marcador recente', () => {
  const base = { status: 'LOJA_FINALIZADA_E_VENDENDO', cnpjsMensagem: ['59218413000190'], cnpjsDoLead: ['32306162000149'], contextoRepasse: false, obs: '', agora: T0 }
  assert.deepEqual(cnpjsParaConferir(base), ['59218413000190'])
  assert.deepEqual(cnpjsParaConferir({ ...base, contextoRepasse: true }), [])                          // (a) papo de repasse
  assert.deepEqual(cnpjsParaConferir({ ...base, status: 'EM_ANALISE_AIVA' }), [])
  assert.deepEqual(cnpjsParaConferir({ ...base, cnpjsMensagem: ['32306162000220'] }), [])             // filial: fluxo de hoje
  assert.deepEqual(cnpjsParaConferir({ ...base, cnpjsDoLead: ['32306162000149', '59218413000190'] }), []) // já conhecido
  assert.deepEqual(cnpjsParaConferir({ ...base, obs: MK_OK }), [])                                     // (d) marcador < 7 dias
  const velho = marcadorLojaNova('59218413000190', { ok: true }, '2026-11-01T12:00:00Z')
  assert.deepEqual(cnpjsParaConferir({ ...base, obs: velho }), ['59218413000190'])                    // > 7 dias: confere de novo
  const semReceita = marcadorLojaNova('59218413000190', { ok: false, motivo: 'receita_indisponivel', detalhe: 'Receita sem resposta' }, '2026-11-19T12:00:00Z')
  assert.deepEqual(cnpjsParaConferir({ ...base, obs: semReceita }), ['59218413000190'])               // Receita fora: confere de novo
  assert.deepEqual(cnpjsParaConferir({ ...base, obs: marcadorPedido('59218413000190', '2026-11-19T12:00:00Z') }), []) // já pedido
  assert.deepEqual(cnpjsParaConferir({ ...base, cnpjsMensagem: ['59218413000190', '59218413000190', '11222333000181', '45997418000153', '06990590000123'] }).length, 3)
})
test('pedido já registrado', () => {
  const m = marcadorPedido('59.218.413/0001-90', '2026-11-19T12:00:00Z')
  assert.equal(m, '[LOJA_NOVA_PEDIDA:cnpj=59218413000190|2026-11-19T12:00:00Z]')
  assert.ok(jaPedido(`x ${m}`, '59218413000190'))
  assert.ok(!jaPedido(`x ${m}`, '11222333000181'))
  // o pedido registrado não conta como marcador do fluxo
  assert.equal(lerMarcadorLojaNova(m, '59218413000190'), null)
})
test('avaliar o motivo devolvido pelo modelo', () => {
  const falas = 'quero cadastrar 59.218.413/0001-90 sim sou eu'
  const conf = 'loja_nova_empresa: cnpj=59218413000190 | acao=confirmar | socio=mesmo'
  assert.deepEqual(avaliarPedidoLojaNova({ motivo: conf, obs: MK_OK, falasDoLojista: falas, agora: T0 }).tipo, 'registrar')
  assert.equal(avaliarPedidoLojaNova({ motivo: 'loja_nova_empresa: cnpj=59 | acao=x', obs: MK_OK, falasDoLojista: falas, agora: T0 }).tipo, 'escalar')
  assert.equal(avaliarPedidoLojaNova({ motivo: conf, obs: MK_OK, falasDoLojista: 'sim', agora: T0 }).tipo, 'escalar')   // CNPJ não escrito
  assert.equal(avaliarPedidoLojaNova({ motivo: conf, obs: '', falasDoLojista: falas, agora: T0 }).tipo, 'escalar')       // sem marcador
  const ruim = marcadorLojaNova('59218413000190', { ok: false, motivo: 'odres', detalhe: 'x' }, '2026-11-19T12:00:00Z')
  assert.equal(avaliarPedidoLojaNova({ motivo: conf, obs: ruim, falasDoLojista: falas, agora: T0 }).tipo, 'escalar')     // inelegível
  assert.equal(avaliarPedidoLojaNova({ motivo: conf, obs: MK_OK, falasDoLojista: falas, agora: T0 + 8 * 86400000 }).tipo, 'escalar') // vencido
  assert.equal(avaliarPedidoLojaNova({ motivo: conf, obs: `${marcadorPedido('59218413000190', '2026-11-19T12:30:00Z')}`, falasDoLojista: falas, agora: T0 }).tipo, 'ignorar') // repetido
  // (b) cancelar: remove o marcador, mesmo sem o CNPJ na janela
  assert.equal(avaliarPedidoLojaNova({ motivo: 'loja_nova_empresa: cnpj=59218413000190 | acao=cancelar', obs: MK_OK, falasDoLojista: 'não quero', agora: T0 }).tipo, 'cancelar')
  assert.equal(avaliarPedidoLojaNova({ motivo: 'loja_nova_empresa: cnpj=59218413000190 | acao=cancelar', obs: '', falasDoLojista: 'não', agora: T0 }).tipo, 'ignorar')
})
test('resumo da elegibilidade e aviso da fila', () => {
  assert.match(resumoElegibilidade({ ok: true }), /elegível/)
  assert.match(resumoElegibilidade({ ok: false, motivo: 'menos_de_1_ano', detalhe: '0,4 ano' }), /menos de 1 ano.*0,4 ano/)
  assert.match(resumoElegibilidade(null), /não conferida/)
  const a = avisoLojaNovaFila({ loja: 'Loja X', telefone: '5547999990000', cnpj: '59218413000190', razao: 'ACME LTDA', socioNome: null, socioTelefone: null, colunasFaltando: false })
  assert.match(a, /^🏪 \*LOJA NOVA DE CLIENTE ATIVO — na fila de pré-cadastro\*/)
  assert.match(a, /59\.218\.413\/0001-90 — ACME LTDA/); assert.match(a, /mesmo sócio/); assert.match(a, /\/atendimento/)
  assert.doesNotMatch(a, /colunas/)
  const b = avisoLojaNovaFila({ loja: 'Loja X', telefone: '5547999990000', cnpj: '59218413000190', razao: null, socioNome: 'Maria', socioTelefone: '5521965002926', colunasFaltando: true })
  assert.match(b, /Maria \(5521965002926\)/); assert.match(b, /colunas.*não existem/)
})
test('lead sem CNPJ conhecido não abre o fluxo pro próprio CNPJ', () => {
  const base = { status: 'LOGIN', cnpjsMensagem: ['59218413000190'], cnpjsDoLead: [] as string[], contextoRepasse: false, obs: '', agora: T0 }
  assert.deepEqual(cnpjsParaConferir(base), [])
  assert.deepEqual(cnpjsParaConferir({ ...base, cnpjsDoLead: ['', '123'] }), [])
})
test('cancelar depois de confirmado escala; escalada de confirmação avisa que o lojista já ouviu "Registrei"', () => {
  const pedida = marcadorPedido('59218413000190', '2026-11-19T12:30:00Z')
  const d = avaliarPedidoLojaNova({ motivo: 'loja_nova_empresa: cnpj=59218413000190 | acao=cancelar', obs: pedida, falasDoLojista: 'desisti', agora: T0 })
  assert.equal(d.tipo, 'escalar'); assert.match((d as any).porque, /já está na fila de pré-cadastro/)
  const e = avaliarPedidoLojaNova({ motivo: 'loja_nova_empresa: cnpj=59218413000190 | acao=confirmar | socio=mesmo', obs: '', falasDoLojista: '59218413000190', agora: T0 })
  assert.equal(e.tipo, 'escalar'); assert.match((e as any).porque, /já disse ao lojista que registrou/)
  const f = avaliarPedidoLojaNova({ motivo: 'loja_nova_empresa: lixo', obs: '', falasDoLojista: '', agora: T0 })
  assert.match((f as any).porque, /pode já ter dito/)
})
test('atalho não repete com fluxo aberto ou pedido recente', () => {
  assert.ok(deveInstruirAtalho('quero abrir nova loja', '', T0))
  assert.ok(!deveInstruirAtalho('oi', '', T0))
  assert.ok(!deveInstruirAtalho('nova loja', MK_OK, T0))
  assert.ok(!deveInstruirAtalho('nova loja', marcadorPedido('59218413000190', '2026-11-19T12:30:00Z'), T0))
  assert.ok(deveInstruirAtalho('nova loja', MK_OK, T0 + 8 * 86400000))
  assert.ok(deveInstruirAtalho('nova loja', marcadorPedido('59218413000190', '2026-11-01T12:30:00Z'), T0))
})
test('alerta de CNPJ novo: texto de outra empresa só no fluxo e com conferência; linha de Filiais como antes fora do fluxo', () => {
  const o = (cnpj: string, conferido = true) => ({ cnpj, classe: 'outra_empresa' as const, conferido })
  const f = (cnpj: string) => ({ cnpj, classe: 'filial' as const, conferido: false })
  // no fluxo, conferido: título novo, sem linha de Filiais
  assert.deepEqual(planoAlertaCnpjNovo({ status: 'LOGIN', novos: [o('A')], dvRuim: 0 }), { textoOutraEmpresa: true, linhaFiliais: [] })
  // no fluxo, conferência falhou: texto de hoje, mas ainda sem linha (outra empresa no fluxo nunca vira filial)
  assert.deepEqual(planoAlertaCnpjNovo({ status: 'LOGIN', novos: [o('A', false)], dvRuim: 0 }), { textoOutraEmpresa: false, linhaFiliais: [] })
  // fora do fluxo (CADASTRO_RECEBIDO/EM_ANALISE_AIVA): regra atual — texto de hoje e linha gerada
  assert.deepEqual(planoAlertaCnpjNovo({ status: 'EM_ANALISE_AIVA', novos: [o('A')], dvRuim: 0 }), { textoOutraEmpresa: false, linhaFiliais: ['A'] })
  assert.deepEqual(planoAlertaCnpjNovo({ status: 'CADASTRO_RECEBIDO', novos: [o('A'), f('B')], dvRuim: 0 }), { textoOutraEmpresa: false, linhaFiliais: ['A', 'B'] })
  // mistura no fluxo: texto de hoje; filial ganha linha
  assert.deepEqual(planoAlertaCnpjNovo({ status: 'LOJA_FINALIZADA_E_VENDENDO', novos: [o('A'), f('B')], dvRuim: 0 }), { textoOutraEmpresa: false, linhaFiliais: ['B'] })
  // DV ruim junto: texto de hoje
  assert.equal(planoAlertaCnpjNovo({ status: 'LOGIN', novos: [o('A')], dvRuim: 1 }).textoOutraEmpresa, false)
  assert.equal(planoAlertaCnpjNovo({ status: 'LOGIN', novos: [], dvRuim: 1 }).textoOutraEmpresa, false)
})
test('atalho: instrução de pedir o CNPJ', () => {
  assert.match(instrucaoAtalhoLojaNova(), /peça o CNPJ dela \(14 dígitos\)/)
})

test('raiz e classificação', () => {
  assert.equal(raizCnpj('32.306.162/0001-49'), '32306162')
  assert.equal(raizCnpj('123'), '')
  assert.equal(classificar('59218413000190', ['32306162000149']), 'outra_empresa')
  assert.equal(classificar('32306162000220', ['32306162000149']), 'filial')
  assert.equal(classificar('32306162000149', ['32306162000149']), 'conhecido')
})
test('filial da segunda empresa usa o RID da mesma raiz', () => {
  const regs = [{ cnpj: '32306162000149', rid: '7933', tipo: 'matriz' }, { cnpj: '59218413000190', rid: '9001', tipo: 'adicional' }]
  assert.equal(ridDaRaiz('59218413000271', regs), '9001')
  assert.equal(ridDaRaiz('32306162000220', regs), '7933')
  assert.equal(ridDaRaiz('11111111000191', regs), null)
})
test('atalho', () => {
  for (const t of ['NOVA LOJA', 'nova loja', ' Nova  Loja! ', 'quero nova loja']) assert.ok(ehAtalhoNovaLoja(t), t)
  for (const t of ['a loja nova do vizinho fechou e eu comprei o estoque todo dele ontem', '', null]) assert.ok(!ehAtalhoNovaLoja(t), String(t))
})
test('elegibilidade', () => {
  assert.deepEqual(elegibilidade({ situacao: 'ATIVA', idadeAnos: 3, odres: false, jaNaAiva: null }), { ok: true })
  assert.equal((elegibilidade({ situacao: 'INAPTA', idadeAnos: 3, odres: false, jaNaAiva: null }) as any).motivo, 'nao_ativa')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 0.4, odres: false, jaNaAiva: null }) as any).motivo, 'menos_de_1_ano')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 3, odres: true, jaNaAiva: null }) as any).motivo, 'odres')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 3, odres: false, jaNaAiva: 'biometria' }) as any).motivo, 'ja_na_aiva')
  assert.equal((elegibilidade({ situacao: null, idadeAnos: null, odres: false, jaNaAiva: null }) as any).motivo, 'receita_indisponivel')
})
test('só abre com loja principal criada, outra empresa e fora do papo de repasse', () => {
  assert.ok(deveAbrirFluxo({ status: 'LOJA_FINALIZADA_E_VENDENDO', classe: 'outra_empresa', contextoRepasse: false }))
  assert.ok(!deveAbrirFluxo({ status: 'LOJA_FINALIZADA_E_VENDENDO', classe: 'outra_empresa', contextoRepasse: true }))
  assert.ok(!deveAbrirFluxo({ status: 'EM_ANALISE_AIVA', classe: 'outra_empresa', contextoRepasse: false }))
  assert.ok(!deveAbrirFluxo({ status: 'LOGIN', classe: 'filial', contextoRepasse: false }))
})
test('motivo', () => {
  assert.deepEqual(lerMotivoLojaNova('loja_nova_empresa: cnpj=59.218.413/0001-90 | acao=confirmar | socio=mesmo'),
    { cnpj: '59218413000190', acao: 'confirmar', socioNome: null, socioTelefone: null })
  assert.deepEqual(lerMotivoLojaNova('loja_nova_empresa: cnpj=59218413000190 | acao=confirmar | socio=Maria Souza | tel=(21) 96500-2926'),
    { cnpj: '59218413000190', acao: 'confirmar', socioNome: 'Maria Souza', socioTelefone: '5521965002926' })
  assert.equal(lerMotivoLojaNova('loja_nova_empresa: cnpj=59218413000190 | acao=cancelar')?.acao, 'cancelar')
  assert.equal(lerMotivoLojaNova('loja_nova_empresa: cnpj=123 | acao=confirmar'), null)
  assert.equal(lerMotivoLojaNova('abrir_ticket_filial: cnpj=59218413000190 | numero=1'), null)
})
test('bloco do prompt: elegível pede confirmação e sócio; inelegível proíbe pedido; sem marcador = null', () => {
  const ok = blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: true }, '2026-11-19T12:00:00Z')}`, Date.parse('2026-11-19T13:00:00Z'))!
  assert.match(ok, /59\.218\.413\/0001-90/); assert.match(ok, /loja_nova_empresa: cnpj=/); assert.doesNotMatch(ok, /retail-onboarding-hub/)
  const ruim = blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: false, motivo: 'menos_de_1_ano', detalhe: '0,4 ano' }, '2026-11-19T12:00:00Z')}`, Date.parse('2026-11-19T13:00:00Z'))!
  assert.match(ruim, /NÃO abra pedido/i)
  assert.equal(blocoPromptLojaNova('sem nada'), null)
  // marcador com mais de 7 dias não instrui mais
  assert.equal(blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: true }, '2026-11-01T12:00:00Z')}`, Date.parse('2026-11-19T13:00:00Z')), null)
})
test('textos ao lojista: link com o CNPJ, sem prazo', () => {
  const t = textoLinkLojaNova('59218413000190', 'ACME LTDA')
  assert.match(t, /https:\/\/retail-onboarding-hub\.vercel\.app\//); assert.match(t, /59\.218\.413\/0001-90/)
  for (const s of [t, textoLojaCriada('ACME LTDA')]) assert.doesNotMatch(s, /\b(hoje|amanhã|\d+ ?(h|horas|dias))\b/i)
})
test('selo da fila: só o fluxo ganha selo; sócio nulo = mesmo sócio', () => {
  assert.equal(seloRegistroFila({ fluxo: null }), null)
  assert.equal(seloRegistroFila({}), null)
  assert.deepEqual(seloRegistroFila({ fluxo: 'loja_nova_empresa' }), { selo: 'loja nova de cliente ativo', socio: 'mesmo sócio' })
  assert.equal(seloRegistroFila({ fluxo: 'loja_nova_empresa', socio_nome: 'Maria', socio_telefone: '5521965002926' })?.socio, 'sócio: Maria (5521965002926)')
  assert.equal(seloRegistroFila({ fluxo: 'loja_nova_empresa', socio_nome: 'Maria' })?.socio, 'sócio: Maria')
})

// ─── Task 4: espelho — link, loja criada, recusada e fila parada (por CNPJ) ─────────────────────
const reg = (p: Partial<RegLojaNova> = {}): RegLojaNova => ({ id: 1, lead_id: 'a', cnpj: '59218413000190', fluxo: 'loja_nova_empresa', link_enviado_em: null, criada_avisada_em: null, ...p })
test('link: só fluxo loja nova, em dados_varejo, ainda sem link', () => {
  const o = [{ cnpj: '59218413000190', stage: 'dados_varejo' }]
  assert.equal(pendentesLink([reg()], o).length, 1)
  assert.equal(pendentesLink([reg({ link_enviado_em: '2026-11-19T12:00:00Z' })], o).length, 0)
  assert.equal(pendentesLink([reg({ fluxo: null })], o).length, 0)
  assert.equal(pendentesLink([reg()], []).length, 0)                                   // pré-cadastro ainda não chegou
  assert.equal(pendentesLink([reg()], [{ cnpj: '59218413000190', stage: 'not_approved', pre_cadastro_status: 'not_approved' }]).length, 0)
})
test('recusada pela AIVA aparece só em recusadas', () => {
  const o = [{ cnpj: '59218413000190', stage: 'not_approved', pre_cadastro_status: 'not_approved' }]
  assert.equal(recusadas([reg()], o).length, 1); assert.equal(pendentesCriada([reg()], o).length, 0)
})
test('loja criada: retailer_id presente, um aviso só', () => {
  const o = [{ cnpj: '59218413000190', stage: 'cadastro_finalizado', retailer_id: 9001, legal_name: 'ACME' }]
  assert.equal(pendentesCriada([reg()], o).length, 1)
  assert.equal(pendentesCriada([reg({ criada_avisada_em: '2026-11-20T12:00:00Z' })], o).length, 0)
})
test('seleção: CNPJ formatado casa, linha sem lead fica fora, recusada nunca vira link nem criada', () => {
  const o = [{ cnpj: '59.218.413/0001-90', stage: 'dados_varejo' }]
  assert.equal(pendentesLink([reg()], o)[0].onb.stage, 'dados_varejo')
  assert.equal(pendentesLink([reg({ lead_id: '' })], o).length, 0)
  // loja já criada: não manda mais o link
  assert.equal(pendentesLink([reg({ criada_avisada_em: '2026-11-20T12:00:00Z' })], o).length, 0)
  // recusada com retailer_id (lixo do portal) não vira "loja criada"
  const rec = [{ cnpj: '59218413000190', stage: 'not_approved', retailer_id: 9001 }]
  assert.equal(pendentesCriada([reg()], rec).length, 0)
  assert.equal(recusadas([reg()], rec).length, 1)
  // recusa só pelo pre_cadastro_status também conta
  assert.equal(recusadas([reg()], [{ cnpj: '59218413000190', stage: 'dados_varejo', pre_cadastro_status: 'not_approved' }]).length, 1)
  assert.equal(pendentesLink([reg()], [{ cnpj: '59218413000190', stage: 'dados_varejo', pre_cadastro_status: 'not_approved' }]).length, 0)
  // outro onboarding vivo do mesmo CNPJ: não é recusada
  assert.equal(recusadas([reg()], [...rec, { cnpj: '59218413000190', stage: 'dados_varejo' }]).length, 0)
  assert.equal(recusadas([reg({ fluxo: null })], rec).length, 0)
})
test('fila parada: sem clique há 24h+ pelo criado_em; clicado e não chegou pelo enviado_em; no portal ou com link, nada', () => {
  const agora = Date.parse('2026-11-21T15:00:00Z')
  const f = (p: Partial<RegLojaNovaFila> = {}): RegLojaNovaFila => ({ ...reg(), enviado: false, criado_em: '2026-11-20T14:00:00Z', enviado_em: null, ...p })
  assert.deepEqual(filaParadaLojaNova([f()], [], agora).map((x) => [x.motivo, x.horas]), [['sem_clique', 25]])
  assert.equal(filaParadaLojaNova([f({ criado_em: '2026-11-20T16:00:00Z' })], [], agora).length, 0)            // 23h
  assert.deepEqual(filaParadaLojaNova([f({ enviado: true, enviado_em: '2026-11-20T10:00:00Z' })], [], agora).map((x) => x.motivo), ['nao_chegou'])
  assert.equal(filaParadaLojaNova([f({ enviado: true, enviado_em: '2026-11-21T10:00:00Z' })], [], agora).length, 0) // clicado há 5h
  assert.equal(filaParadaLojaNova([f({ enviado: true, enviado_em: null })], [], agora)[0].motivo, 'nao_chegou')     // sem enviado_em: criado_em
  assert.equal(filaParadaLojaNova([f()], [{ cnpj: '59218413000190', stage: 'dados_varejo' }], agora).length, 0)  // chegou
  assert.equal(filaParadaLojaNova([f({ link_enviado_em: '2026-11-20T15:00:00Z' })], [], agora).length, 0)
  assert.equal(filaParadaLojaNova([f({ fluxo: null })], [], agora).length, 0)
  assert.equal(filaParadaLojaNova([f({ criado_em: null })], [], agora).length, 0)
})
test('chaves por CNPJ; a da fila parada vira à meia-noite de Brasília', () => {
  assert.equal(chaveLinkLojaNova('59.218.413/0001-90'), 'loja_nova_link:59218413000190')
  assert.equal(chaveCriadaLojaNova('59218413000190'), 'loja_nova_criada:59218413000190')
  assert.equal(chaveRecusadaLojaNova('59218413000190'), 'loja_nova_recusada:59218413000190')
  assert.equal(chaveFilaParada('59218413000190', Date.parse('2026-11-21T02:59:00Z')), 'loja_nova_parada:59218413000190:2026-11-20')
  assert.equal(chaveFilaParada('59218413000190', Date.parse('2026-11-21T03:00:00Z')), 'loja_nova_parada:59218413000190:2026-11-21')
})
test('coluna ausente: 42703 no select, PGRST204 na escrita; outros erros não', () => {
  assert.ok(colunaLojaNovaAusente({ code: '42703', message: 'column sdr_registros_cnpj.fluxo does not exist' }))
  assert.ok(colunaLojaNovaAusente({ code: 'PGRST204', message: "Could not find the 'link_enviado_em' column" }))
  assert.ok(!colunaLojaNovaAusente({ code: '57014', message: 'canceling statement due to statement timeout' }))
  assert.ok(!colunaLojaNovaAusente(null))
})
test('template 86: loja com a razão e o CNPJ em até 60 caracteres; loja criada sem prazo', () => {
  assert.equal(lojaTemplateLojaNova('59218413000190', 'ACME LTDA'), 'ACME LTDA (CNPJ 59.218.413/0001-90)')
  assert.equal(lojaTemplateLojaNova('59218413000190', null), 'CNPJ 59.218.413/0001-90')
  const longa = lojaTemplateLojaNova('59218413000190', 'COMERCIO DE TELEFONIA CELULAR E ACESSORIOS DO VALE LTDA')
  assert.ok(longa.length <= 60, longa); assert.match(longa, /\(CNPJ 59\.218\.413\/0001-90\)$/)
  const u = utilLojaCriada()
  assert.equal(u.tipo, 'etapa'); assert.match(u.etapa, /criada na AIVA/)
  assert.doesNotMatch(`${u.etapa} ${u.situacao}`, /\b(hoje|amanhã|\d+ ?(h|horas|dias))\b/i)
})

test('template 86 do link de loja nova: etapa é a abertura do cadastro, não "aprovação"; lembra o CNPJ novo; sem prazo', () => {
  const u = utilLinkLojaNova('https://retail-onboarding-hub.vercel.app/')
  assert.equal(u.tipo, 'etapa')
  assert.equal(u.etapa, 'abertura do cadastro da loja nova na AIVA.')
  assert.equal(u.situacao, 'falta preencher o cadastro neste link: https://retail-onboarding-hub.vercel.app/ Use o CNPJ da loja nova, não o da loja que já opera. Assim que finalizar, me avisa por aqui.')
  assert.doesNotMatch(`${u.etapa} ${u.situacao}`, /aprova/i)
  assert.doesNotMatch(`${u.etapa} ${u.situacao}`, /\b(hoje|amanhã|\d+ ?(h|horas|dias))\b/i)
  assert.doesNotMatch(`${u.etapa} ${u.situacao}`, /[\r\n\t]| {4,}/)
})

// ─── polimento (itens estacionados) ─────────────────────────────────────────────────────────────
test('elegibilidade: idade com no máximo 1 casa decimal', () => {
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 0.4166666, odres: false, jaNaAiva: null }) as any).detalhe, '0,4 ano')
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 0.96, odres: false, jaNaAiva: null }) as any).detalhe, '0,9 ano') // trunca: nunca "1 ano" pra quem tem menos de 1
  assert.equal((elegibilidade({ situacao: 'ATIVA', idadeAnos: 0.5, odres: false, jaNaAiva: null }) as any).detalhe, '0,5 ano')
})
test('dois marcadores do mesmo CNPJ: o mais recente vence', () => {
  const velho = marcadorLojaNova('59218413000190', { ok: true }, '2026-11-18T12:00:00Z')
  const novo = marcadorLojaNova('59218413000190', { ok: false, motivo: 'odres', detalhe: 'base Odres/UME' }, '2026-11-19T12:00:00Z')
  assert.equal(lerMarcadorLojaNova(`${novo} ${velho}`, '59218413000190')?.sit, 'odres')
  assert.equal(lerMarcadorLojaNova(`${velho} ${novo}`, '59218413000190')?.sit, 'odres')
  assert.match(blocoPromptLojaNova(`${novo} ${velho}`, T0)!, /NÃO ELEGÍVEL/)
})
test('detalhe com | ou ] é limpo no marcador e não quebra a leitura', () => {
  const m = marcadorLojaNova('59218413000190', { ok: false, motivo: 'nao_ativa', detalhe: 'BAIXADA | por ] omissão' }, '2026-11-19T12:00:00Z')
  assert.equal(m, '[LOJA_NOVA:cnpj=59218413000190|sit=nao_ativa|det=BAIXADA por omissão|2026-11-19T12:00:00Z]')
  assert.deepEqual(lerMarcadorLojaNova(`x ${m} y`, '59218413000190'), { sit: 'nao_ativa', det: 'BAIXADA por omissão', t: Date.parse('2026-11-19T12:00:00Z') })
})
test('atalho: "nova loja" só como palavras inteiras', () => {
  for (const t of ['renova loja', 'nova lojas', 'inova loja']) assert.ok(!ehAtalhoNovaLoja(t), t)
  for (const t of ['nova loja.', '(nova loja)', 'NOVA-LOJA']) assert.ok(ehAtalhoNovaLoja(t), t)
})

// ─── revisão Task 4, rodada 1 ───────────────────────────────────────────────────────────────────
test('o filtro do card usa o mesmo valor de fluxo', () => {
  assert.equal(FLUXO_LOJA_NOVA_REG, FLUXO_LOJA_NOVA)
})
test('falha de envio: só rejeição clara solta a chave; ambígua segura; 3 rejeições = desiste', () => {
  const r400 = 'Error: Evo Talks /int/sendWaTemplate → 400: {"error":"template inválido"}'
  assert.ok(rejeicaoClara(r400))
  assert.ok(rejeicaoClara('Error: Evo Talks /int/sendMessageToChat → 404: chat'))
  assert.ok(rejeicaoClara('Error: Evo Talks /int/sendWaTemplate → 429: rate'))
  for (const amb of ['Error: Evo Talks /int/sendWaTemplate → 500: oops', 'Error: Evo Talks /int/sendWaTemplate → 408: timeout',
    'TypeError: fetch failed', 'AbortError: The operation was aborted', 'SyntaxError: Unexpected token < in JSON', 'qualquer coisa']) {
    assert.ok(!rejeicaoClara(amb), amb)
    assert.deepEqual(decidirFalhaEnvio(amb, 0), { acao: 'segurar', conta: false })
  }
  assert.deepEqual(decidirFalhaEnvio(r400, 0), { acao: 'tentar_de_novo', conta: true })
  assert.deepEqual(decidirFalhaEnvio(r400, 1), { acao: 'tentar_de_novo', conta: true })
  assert.deepEqual(decidirFalhaEnvio(r400, 2), { acao: 'desistir', conta: true })   // 3ª rejeição
  assert.equal(TENTATIVAS_LOJA_NOVA, 3)
  // silêncio de envio é pausa deliberada: bloqueado antes de sair, tenta depois e não gasta tentativa
  assert.deepEqual(decidirFalhaEnvio('Error: SILENCIO_GLOBAL: envio bloqueado (/int/sendWaTemplate)', 2), { acao: 'tentar_de_novo', conta: false })
  assert.deepEqual(decidirFalhaEnvio('Error: SILENCIO_TEMPLATES: template bloqueado (templateId 86)', 2), { acao: 'tentar_de_novo', conta: false })
})
test('chaves de tentativa e de retenção por CNPJ e tipo', () => {
  assert.equal(chaveTentativaLojaNova('link', '59.218.413/0001-90', 2), 'loja_nova_tentativa:link:59218413000190:2')
  assert.equal(chaveRetidoLojaNova('criada', '59218413000190'), 'loja_nova_retido:criada:59218413000190')
  const ch = ['loja_nova_tentativa:link:59218413000190:1', 'loja_nova_tentativa:link:59218413000190:2', 'loja_nova_tentativa:criada:59218413000190:1', 'loja_nova_tentativa:link:11222333000181:1']
  assert.equal(tentativasDe(ch, 'link', '59218413000190'), 2)
  assert.equal(tentativasDe(ch, 'criada', '59218413000190'), 1)
  assert.equal(tentativasDe([], 'link', '59218413000190'), 0)
})
test('CNPJ duplicado na API (um sem RID em dados_varejo, outro com RID): só "loja criada", nunca os dois', () => {
  const o = [{ cnpj: '59218413000190', stage: 'dados_varejo' }, { cnpj: '59218413000190', stage: 'cadastro_finalizado', retailer_id: 9001 }]
  assert.equal(pendentesLink([reg()], o).length, 0)
  assert.equal(pendentesCriada([reg()], o).length, 1)
})
test('loja criada não promete acesso, ativação nem próximos passos por aqui; sem prazo (revisão final, item 3)', () => {
  const u = utilLojaCriada()
  for (const t of [textoLojaCriada('ACME LTDA'), textoLojaCriada(null), `${u.etapa} ${u.situacao}`]) {
    assert.doesNotMatch(t, /acess|login|senha|liberad|ativ|operar|vender/i, t)
    assert.match(t, /criada na AIVA/)
    assert.match(t, /[Qq]ualquer dúvida sobre ela, é só me chamar por aqui\./)
    assert.doesNotMatch(t, /próximos passos|chegam por|WhatsApp/i, t)
    assert.doesNotMatch(t, /\b(hoje|amanhã|\d+ ?(h|horas|dias))\b/i)
  }
  assert.equal(textoLojaCriada('ACME LTDA'), 'A loja nova ACME LTDA foi criada na AIVA. 🎉 Qualquer dúvida sobre ela, é só me chamar por aqui.')
  assert.equal(textoLojaCriada(null), 'A loja nova foi criada na AIVA. 🎉 Qualquer dúvida sobre ela, é só me chamar por aqui.')
  // variável de utilidade: sem emoji, uma linha, cabe no limite de 60
  assert.doesNotMatch(u.situacao, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  assert.ok(u.situacao.length <= 60, u.situacao)
})
test('idade abaixo de 0,1 ano vira meses', () => {
  const det = (idadeAnos: number) => (elegibilidade({ situacao: 'ATIVA', idadeAnos, odres: false, jaNaAiva: null }) as any).detalhe
  assert.equal(det(0.04), 'menos de 1 mês')
  assert.equal(det(0), 'menos de 1 mês')
  assert.equal(det(0.09), '1 mês')
  assert.equal(det(0.1), '0,1 ano')
  assert.equal(det(0.4166666), '0,4 ano')
})

// ─── revisão Task 5, rodada 1 ────────────────────────────────────────────────────────────────────
const bloco = (motivo: string, det: string) =>
  blocoPromptLojaNova(`x ${marcadorLojaNova('59218413000190', { ok: false, motivo, detalhe: det } as never, '2026-11-19T12:00:00Z')}`, T0)!

test('item 3/7: motivo pro lojista sem "base", sem promessa da equipe e sem a etapa; o time mantém o detalhe', () => {
  const od = bloco('odres', 'base Odres/UME')
  assert.match(od, /já é atendido pela AIVA\/Odres por outro canal \(fora da Track\)/)
  assert.match(od, /⛔ Não fale em "base"/)
  assert.doesNotMatch(od, /tratada manualmente/)
  const ja = bloco('ja_na_aiva', 'biometria_pendente')
  assert.match(ja, /cadastro aberto ou analisado na AIVA/); assert.match(ja, /Não cite a etapa/)
  assert.doesNotMatch(ja, /biometria_pendente/)
  // aviso ao time continua com a base e a etapa
  assert.match(resumoElegibilidade({ ok: false, motivo: 'odres', detalhe: 'base Odres/UME' }), /base Odres\/UME/)
  assert.match(resumoElegibilidade({ ok: false, motivo: 'ja_na_aiva', detalhe: 'biometria_pendente' }), /biometria_pendente/)
})
test('item 6: Receita fora do ar não vira recusa — pede o CNPJ de novo mais tarde', () => {
  const b = bloco('receita_indisponivel', 'Receita sem resposta')
  assert.match(b, /NÃO abra pedido/); assert.match(b, /mandar o CNPJ de novo mais tarde/); assert.match(b, /Sem prazo/)
  assert.doesNotMatch(b, /NÃO ELEGÍVEL/); assert.doesNotMatch(b, /não pode seguir por aqui/)
})
test('item 8: formato do motivo no bloco não usa o separador como "ou"', () => {
  const ok = blocoPromptLojaNova(`x ${MK_OK}`, T0)!
  assert.match(ok, /socio=<mesmo OU nome do sócio> \| tel=<WhatsApp do sócio, só se não for ele>/)
  assert.doesNotMatch(ok, /socio=mesmo\|/)
})
test('item 4: cadastro da loja principal aberto no portal ([ONB_ETAPA:…]) não abre o fluxo nem o atalho', () => {
  const onb = '[ONB_ETAPA:dados_varejo:2026-11-19T10:00:00Z]'
  assert.ok(cadastroPrincipalAberto(onb)); assert.ok(!cadastroPrincipalAberto('')); assert.ok(!cadastroPrincipalAberto(null))
  assert.ok(!deveAbrirFluxo({ status: 'TREINAR', classe: 'outra_empresa', contextoRepasse: false, cadastroAberto: true }))
  const base = { status: 'TREINAR', cnpjsMensagem: ['59218413000190'], cnpjsDoLead: ['32306162000149'], contextoRepasse: false, obs: onb, agora: T0 }
  assert.deepEqual(cnpjsParaConferir(base), [])
  assert.deepEqual(cnpjsParaConferir({ ...base, obs: '' }), ['59218413000190'])
  assert.ok(!deveInstruirAtalho('nova loja', onb, T0))
  assert.ok(deveInstruirAtalho('nova loja', '', T0))
})
test('item 2: CNPJ que só existe pela linha da captura (conferência falhou, sem marcador) é conferido de novo no reenvio', () => {
  const regs = [
    { cnpj: '32306162000149', tipo: 'matriz', status: 'credenciada' },
    { cnpj: '59218413000190', tipo: 'adicional', status: 'informada' },
    { cnpj: '11222333000181', tipo: 'adicional', status: 'enviada' },
  ]
  assert.deepEqual(reconferiveisDoLead(regs, ''), ['59218413000190'])
  // CNPJ que também está nas observações é conhecido de verdade
  assert.deepEqual(reconferiveisDoLead(regs, '[DADOS_COLETADOS:cnpj=59.218.413/0001-90]'), [])
  const base = { status: 'LOGIN', cnpjsMensagem: ['59218413000190'], cnpjsDoLead: regs.map((r) => r.cnpj), contextoRepasse: false, obs: '', agora: T0 }
  assert.deepEqual(cnpjsParaConferir(base), [])                                                   // sem a regra: "conhecido"
  assert.deepEqual(cnpjsParaConferir({ ...base, reconferiveis: reconferiveisDoLead(regs, '') }), ['59218413000190'])
  // com marcador recente ou pedido registrado continua sem repetir
  assert.deepEqual(cnpjsParaConferir({ ...base, reconferiveis: ['59218413000190'], obs: MK_OK }), [])
  assert.deepEqual(cnpjsParaConferir({ ...base, reconferiveis: ['59218413000190'], obs: marcadorPedido('59218413000190', '2026-11-19T12:00:00Z') }), [])
  // filial (mesma raiz de outro CNPJ do lead) reconferível não vira outra empresa
  assert.deepEqual(cnpjsParaConferir({ ...base, cnpjsMensagem: ['32306162000220'], cnpjsDoLead: [...base.cnpjsDoLead, '32306162000220'], reconferiveis: ['32306162000220'] }), [])
  // única linha do lead é a da captura: sem outro CNPJ, não classifica
  assert.deepEqual(cnpjsParaConferir({ ...base, cnpjsDoLead: ['59218413000190'], reconferiveis: ['59218413000190'] }), [])
})
test('item 2: conferência levada à mensagem de filial recusada por raiz', () => {
  assert.deepEqual(conferenciaParaFilial({ ok: true }), { ok: true })
  assert.equal(conferenciaParaFilial(null), null)
  assert.equal(conferenciaParaFilial({ ok: false, motivo: 'receita_indisponivel', detalhe: 'Receita sem resposta' }), null)
  assert.deepEqual(conferenciaParaFilial({ ok: false, motivo: 'menos_de_1_ano', detalhe: '0,4 ano' }), { ok: false, frase: 'Esse CNPJ tem menos de 1 ano de abertura (0,4 ano).' })
  const od = conferenciaParaFilial({ ok: false, motivo: 'odres', detalhe: 'base Odres/UME' })
  assert.ok(od && !od.ok && !/base|⛔/.test(od.frase))
  assert.equal(fraseMotivoLojista('xyz', ''), 'Esse CNPJ não pôde ser aceito como loja nova.')
})
test('item 13: link sem razão social diz "do CNPJ"', () => {
  assert.equal(textoLinkLojaNova('59218413000190', null), 'O cadastro do CNPJ 59.218.413/0001-90 já está aberto na AIVA. Para concluir, acesse https://retail-onboarding-hub.vercel.app/ e informe esse CNPJ. Qualquer dúvida, é só me chamar por aqui.')
  assert.match(textoLinkLojaNova('59218413000190', 'ACME LTDA'), /^O cadastro de ACME LTDA \(CNPJ 59\.218\.413\/0001-90\) já está aberto na AIVA\./)
})

// ─── revisão final da branch ─────────────────────────────────────────────────────────────────────
test('final item 1: o bloco afirma fato (não intenção), tem escopo do CNPJ, condiciona a conduta e não repete', () => {
  const ok = blocoPromptLojaNova(`x ${MK_OK}`, T0)!
  const ruim = bloco('menos_de_1_ano', '0,4 ano')
  const pend = bloco('receita_indisponivel', 'Receita sem resposta')
  for (const b of [ok, ruim, pend]) {
    assert.doesNotMatch(b, /pediu para cadastrar/)
    assert.match(b, /O lojista mandou o CNPJ 59\.218\.413\/0001-90, que é de OUTRA empresa \(raiz diferente das lojas dele\)\./)
    assert.match(b, /Este bloco vale SÓ para o CNPJ 59\.218\.413\/0001-90\. Outro CNPJ que ele mandar segue a regra normal \(o sistema classifica de novo\)\./)
    assert.match(b, /o assunto for outro \(troca de CNPJ de loja existente, usuário\/login, dúvida, CNPJ de terceiro\), ignore este bloco e siga a regra daquele assunto\./)
    assert.match(b, /já tratou disso nesta conversa e ele não voltou ao assunto, não repita\./)
  }
  assert.match(ok, /Se ele quer cadastrá-la como loja nova na AIVA: siga os passos abaixo/)
  // inelegível: o motivo só é explicado se ele estiver pedindo pra cadastrar esse CNPJ
  assert.match(ruim, /Só se ele estiver pedindo para cadastrá-la como loja nova na AIVA: explique o motivo/)
  assert.doesNotMatch(ruim, /Explique ao lojista/)
  assert.match(ruim, /Motivo: Esse CNPJ tem menos de 1 ano de abertura \(0,4 ano\)\./)
  // literais que outras regras usam continuam
  assert.match(ok, /4\. Diga: "Registrei a loja nova; assim que o cadastro dela abrir na AIVA eu te mando o link por aqui\."/)
  assert.match(ok, /loja_nova_empresa: cnpj=59218413000190 \| acao=confirmar \| socio=<mesmo OU nome do sócio> \| tel=/)
  assert.match(pend, /NÃO abra pedido agora\. Se ele quer cadastrá-la como loja nova na AIVA: diga que não deu pra consultar/)
})
test('final item 7: "eu mesmo", "eu", "sou eu", "o mesmo" são o próprio lojista, não nome de sócio', () => {
  for (const s of ['mesmo', 'Mesmo', 'eu mesmo', 'Eu mesmo.', 'eu', 'EU', 'sou eu', 'Sou eu!', 'o mesmo', 'a mesma', 'eu mesma', 'sou eu mesmo']) {
    const p = lerMotivoLojaNova(`loja_nova_empresa: cnpj=59218413000190 | acao=confirmar | socio=${s} | tel=(21) 96500-2926`)
    assert.equal(p?.socioNome, null, s); assert.equal(p?.socioTelefone, null, s)
    assert.ok(ehSocioMesmo(s), s)
  }
  for (const s of ['Eunice', 'Maria Souza', 'Eu e o João', 'Mesmo Ltda']) assert.ok(!ehSocioMesmo(s), s)
  assert.equal(lerMotivoLojaNova('loja_nova_empresa: cnpj=59218413000190 | acao=confirmar | socio=Eunice | tel=21965002926')?.socioNome, 'Eunice')
})
test('final item 2: RID da loja principal — matriz, a mais antiga, nunca a linha do fluxo', () => {
  const F = FLUXO_LOJA_NOVA
  // matriz presente vence, mesmo mais nova
  assert.equal(ridDaLojaPrincipal([
    { rid: 'A1', tipo: 'adicional', criado_em: '2026-01-01T00:00:00Z' },
    { rid: 'M1', tipo: 'matriz', criado_em: '2026-05-01T00:00:00Z' },
  ]), 'M1')
  // dois RIDs, sem matriz, linha do fluxo mais nova: a principal (mais antiga) vence — em qualquer ordem de leitura
  const principal = { rid: 'P1', tipo: 'adicional', fluxo: null, criado_em: '2026-03-01T00:00:00Z' }
  const doFluxo = { rid: 'N1', tipo: 'adicional', fluxo: F, criado_em: '2026-11-20T00:00:00Z' }
  assert.equal(ridDaLojaPrincipal([principal, doFluxo]), 'P1')
  assert.equal(ridDaLojaPrincipal([doFluxo, principal]), 'P1')
  // sem a coluna fluxo (SQL não aplicado): ordem por criado_em decide
  assert.equal(ridDaLojaPrincipal([{ rid: 'N1', tipo: 'adicional', criado_em: '2026-11-20T00:00:00Z' }, { rid: 'P1', tipo: 'adicional', criado_em: '2026-03-01T00:00:00Z' }]), 'P1')
  // linha do fluxo com RID e a principal sem RID: não há RID da loja principal
  assert.equal(ridDaLojaPrincipal([{ rid: null, tipo: 'adicional', fluxo: null, criado_em: '2026-03-01T00:00:00Z' }, doFluxo]), null)
  assert.equal(ridDaLojaPrincipal([]), null)
  assert.equal(ridDaLojaPrincipal([{ rid: '  ', tipo: 'matriz' }]), null)
  assert.equal(ridDaLojaPrincipal([{ rid: 9001, tipo: 'matriz' }]), '9001')
})
test('final item 5: cura avisa o time com CNPJ e mensagem', () => {
  const l = linhaCuraLojaNova('Cell Center', '59218413000190', 'link')
  assert.equal(l, '• Cell Center — CNPJ 59.218.413/0001-90 · link do cadastro · carimbado como enviado sem confirmação — conferir com o lojista')
  assert.match(linhaCuraLojaNova('X', '59218413000190', 'criada'), /aviso de loja criada/)
  const b = blocoCuraLojaNova([l])
  assert.match(b, /^⚠️ \*Loja nova de cliente ativo: carimbado como enviado sem confirmação\* \(1\)\n• Cell Center/)
  assert.match(b, /NÃO reenvia/)
})
test('recusa da AIVA ao lojista (23/11): texto sem motivo nem prazo, e a loja que opera não muda', () => {
  const t = textoRecusadaLojaNova('59218413000190', 'EDUARDO CELL LTDA')
  assert.equal(t, 'A AIVA analisou o cadastro da loja nova de EDUARDO CELL LTDA (CNPJ 59.218.413/0001-90) e ele não foi aprovado. A loja que você já opera segue normal, sem nenhuma mudança. Qualquer dúvida, é só me chamar por aqui.')
  assert.match(textoRecusadaLojaNova('59218413000190', null), /loja nova do CNPJ 59\.218\.413\/0001-90 e ele não foi aprovado/)
  for (const x of [t, utilRecusadaLojaNova().etapa, utilRecusadaLojaNova().situacao]) {
    assert.doesNotMatch(x, /prazo|dias|horas|reanálise|motivo|porque|https?:/i)
  }
  // pelo modelo 86 (janela fechada) o lojista lê a mesma coisa
  const m = montar('Eduardo', lojaTemplateLojaNova('59218413000190', 'EDUARDO CELL LTDA'), utilRecusadaLojaNova())
  assert.match(m.texto, /teve uma etapa concluída: análise do cadastro da loja nova pela AIVA\.\n\nSituação: o cadastro da loja nova não foi aprovado\. A loja que já opera segue normal/)
  assert.equal(m.vars.length, 4)
})
test('recusa da AIVA: chaves e rótulo nos avisos ao time', () => {
  assert.equal(chaveRecusaAvisadaLojaNova('59.218.413/0001-90'), 'loja_nova_recusa_avisada:59218413000190')
  assert.notEqual(chaveRecusaAvisadaLojaNova('59218413000190'), chaveRecusadaLojaNova('59218413000190'))
  assert.equal(chaveRetidoLojaNova('recusada', '59218413000190'), 'loja_nova_retido:recusada:59218413000190')
  assert.equal(rotuloEnvioLojaNova('recusada'), 'aviso de recusa da AIVA')
  assert.match(linhaCuraLojaNova('X', '59218413000190', 'recusada'), /aviso de recusa da AIVA · carimbado como enviado sem confirmação/)
  assert.equal(tentativasDe(['loja_nova_tentativa:recusada:59218413000190:1', 'loja_nova_tentativa:link:59218413000190:1'], 'recusada', '59218413000190'), 1)
})
test('final item 6: escalada direta leva o porquê, o motivo e a última mensagem', () => {
  const t = avisoEscaladaLojaNova({ loja: 'Cell Center', telefone: '5547999990000', status: 'LOGIN', motivo: 'loja_nova_empresa: cnpj=1', porque: 'sem conferência recente', ultimaMensagem: 'sim' })
  assert.match(t, /^🏪 \*LOJA NOVA DE CLIENTE ATIVO — pedido NÃO registrado, conferir\* — Cell Center \(5547999990000 — etapa LOGIN\)/)
  assert.match(t, /⚠️ sem conferência recente/); assert.match(t, /Motivo devolvido: loja_nova_empresa: cnpj=1/); assert.match(t, /"sim"/)
})
test('final item 9: elegibilidade não conferida cita o cadastro da loja principal aberto', () => {
  assert.equal(resumoElegibilidade(null), 'elegibilidade não conferida (etapa fora do fluxo, cadastro da loja principal ainda aberto na AIVA ou consulta falhou)')
})
