import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  montar, limpar, lojaDe, FORMULARIO, cadastroIncompleto, biometria, acessoPendente, treinamentoGenerico, treinamentoLembrete,
  treinamentoPosTurma, ticketResolvido, AVISO_ETAPA_UTIL, PRE_APROVADA_UTIL, alertaInterno, LOJA_INTERNA, type MsgUtilidade,
  retomada, campanha, generico, painelInfo, painelFollowup, disparoInicial, linkCadastro, treinamentoLiberado, NOME_D0,
} from './template-utilidade-calc.ts'

const URL = 'https://liveness.exemplo/abc'
const TODAS: Array<[string, MsgUtilidade]> = [
  ...FORMULARIO.map((m, i): [string, MsgUtilidade] => [`formulario ${i + 1}`, m]),
  ['cadastro', cadastroIncompleto('o seu melhor e-mail')],
  ...[1, 2, 3].map((t): [string, MsgUtilidade] => [`biometria ${t}`, biometria(t, URL)]),
  ...[1, 2].map((t): [string, MsgUtilidade] => [`biometria negada ${t}`, biometria(t, URL, true)]),
  ...[1, 2].map((t): [string, MsgUtilidade] => [`acesso ${t}`, acessoPendente(t)]),
  ['treino generico', treinamentoGenerico(['quinta 19/11, 9h30', 'sexta 20/11, 9h30'])],
  ['treino generico sem agenda', treinamentoGenerico([])],
  ['treino lembrete', treinamentoLembrete('quinta 19/11, 9h30', 'https://meet.google.com/vou-gpmy-rtp')],
  ['treino pos', treinamentoPosTurma('quarta 18/11, 9h30', 'sexta 20/11, 9h30')],
  ['treino pos sem proxima', treinamentoPosTurma('quarta 18/11, 9h30', null)],
  ...['Acesso ao Painel Financeiro', 'Problemas com repasse', 'Cadastro de filial', 'Outro'].map((t): [string, MsgUtilidade] => [`ticket ${t}`, ticketResolvido(t, 1040, 'https://painel', 'https://video')]),
  ...[97, 99, 71].map((e): [string, MsgUtilidade] => [`etapa ${e}`, AVISO_ETAPA_UTIL[e]]),
  ['pre-aprovada', PRE_APROVADA_UTIL],
  ...[1, 2, 3].flatMap((tq): Array<[string, MsgUtilidade]> => [[`retomada ${tq} com dados`, retomada(tq, true)], [`retomada ${tq} sem dados`, retomada(tq, false)]]),
  ['painel info', painelInfo('o reenvio da senha já foi pedido pra AIVA 😊')],
  ['painel follow-up', painelFollowup('ainda dá pra continuar de onde paramos. consegue retornar pra finalizarmos?')],
  ['generico', generico('vi que a loja já consultou na AIVA 👏 me conta como foi?')],
]

test('todo campo cabe numa variavel da Meta: uma linha, sem tab, sem 4 espacos, tamanho razoavel', () => {
  for (const [nome, m] of TODAS) {
    const { vars, texto } = montar('Carlos', 'Cell Center', m)
    assert.equal(vars.length, 4, nome)
    for (const v of vars) {
      assert.ok(v.length > 0, `${nome}: campo vazio`)
      assert.ok(!/[\r\n\t]/.test(v) && !/ {4,}/.test(v), `${nome}: campo invalido`)
    }
    assert.ok(texto.length <= 1000, `${nome}: corpo passa de 1000 caracteres (${texto.length})`)
  }
})

test('texto de utilidade nao leva argumento de venda nem emoji (risco de a Meta reclassificar)', () => {
  for (const [nome, m] of TODAS) {
    const campos = m.tipo === 'pendencia' ? [m.pendencia, m.prazo] : [m.etapa, m.situacao]
    for (const c of campos) {
      assert.ok(!/R\$|Black November|comiss|pr[êe]mio|promocional|concorrente|parcelad|credi[áa]rio/i.test(c), `${nome}: argumento de venda`)
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(c), `${nome}: emoji`)
    }
  }
})

test('cada rotina cai no template certo: pendencia (87) ou etapa concluida (86)', () => {
  assert.ok(FORMULARIO.every((m) => m.tipo === 'pendencia') && FORMULARIO.length === 4)
  assert.equal(biometria(1, URL).tipo, 'pendencia')
  assert.equal(acessoPendente(1).tipo, 'pendencia')
  assert.equal(treinamentoLembrete('x', 'y').tipo, 'pendencia')
  assert.equal(ticketResolvido('repasse', 1, 'a', 'b').tipo, 'etapa')
  assert.equal(AVISO_ETAPA_UTIL[97].tipo, 'etapa')
  assert.equal(PRE_APROVADA_UTIL.tipo, 'etapa')
})

test('o que nao pode sumir na conversao: link da biometria, link do treino, numero do ticket, login', () => {
  for (const t of [1, 2, 3]) assert.ok(biometria(t, URL).prazo.includes(URL))
  for (const t of [1, 2]) assert.ok(biometria(t, URL, true).prazo.includes(URL))
  assert.ok(treinamentoLembrete('quinta 19/11, 9h30', 'https://meet.google.com/x').prazo.includes('https://meet.google.com/x'))
  assert.ok(treinamentoLembrete('quinta 19/11, 9h30', 'https://meet.google.com/x').prazo.startsWith('quinta 19/11, 9h30'))
  assert.ok(ticketResolvido('Acesso ao Painel Financeiro', 1040, 'https://painel', 'https://video').situacao.includes('https://painel'))
  assert.ok(ticketResolvido('repasse', 1040, 'a', 'b').etapa.includes('ticket nº 1040'))
  assert.ok(acessoPendente(1).prazo.includes('https://vendas.flexfone.com.br/login') && acessoPendente(1).prazo.includes('+55 21 4020-2024'))
  assert.ok(AVISO_ETAPA_UTIL[71].situacao.includes('https://vendas.flexfone.com.br/login'))
  assert.ok(cadastroIncompleto('o CNPJ da loja').pendencia.includes('o CNPJ da loja'))
  assert.ok(treinamentoPosTurma('quarta 18/11, 9h30', 'sexta 20/11, 9h30').prazo.includes('sexta 20/11, 9h30'))
})

test('corpo montado espelha o template aprovado', () => {
  assert.equal(
    montar('Carlos', 'Cell Center', acessoPendente(2)).texto,
    'Olá Carlos, aqui é a VictorIA da Track.\n\nA loja Cell Center tem uma pendência registrada: o acesso da loja na AIVA segue sem uso.\n\nPrazo: assim que puder. Se a senha não chegou ou ficou em outro número, me avisa aqui que eu te ajudo.\n\nDúvidas, responda esta mensagem.',
  )
  assert.equal(
    montar('Carlos', 'Cell Center', AVISO_ETAPA_UTIL[97]).texto.split('\n\n')[1],
    'A loja Cell Center teve uma etapa concluída: biometria aprovada pela AIVA.',
  )
})

test('nome e loja: limpos, com reserva quando faltam', () => {
  assert.equal(lojaDe('Loja do Lead', '[DADOS_COLETADOS:nome_socio=Carlos|nome_varejo=Cell Center|cnpj_matriz=1]'), 'Cell Center')
  assert.equal(lojaDe('Loja do Lead', null), 'Loja do Lead')
  assert.equal(lojaDe(null, null), 'sua loja')
  assert.equal(lojaDe('x'.repeat(80), null).length, 60)
  assert.equal(limpar('  a\n b\t  c  '), 'a b c')
  assert.deepEqual(montar('', '', acessoPendente(1)).vars.slice(0, 2), ['lojista', 'sua loja'])
})

test('aviso interno: o teaser de uma linha vira a pendencia', () => {
  const m = montar('Aldo', LOJA_INTERNA, alertaInterno('⚠️ entrega AIVA baixa (saíram 120 de 500): 22% — disparo SEGUE; se for apagão, /pausar'))
  assert.equal(m.vars[1], 'Track (aviso interno)')
  assert.ok(m.vars[2].includes('/pausar'))
  assert.equal(m.vars[3], 'verificar hoje.')
})

// 18/11/2026 — Aldo: "não quero que saia mais nada pelo coringa 48".
test('retomada de interessado: 6 variantes, todas pendencia, com a pergunta no fim', () => {
  const todas = [1, 2, 3].flatMap((tq) => [retomada(tq, true), retomada(tq, false)])
  assert.equal(new Set(todas.map((m) => m.pendencia + m.prazo)).size, 6)
  assert.ok(todas.every((m) => m.tipo === 'pendencia'))
  assert.match(retomada(1, true).prazo, /de onde paramos/)
  assert.match(retomada(2, false).prazo, /não te incomodo mais/)
  assert.match(retomada(3, true).prazo, /turmas ao vivo/)
})

test('texto livre: tira emoji, comeca com maiuscula e preserva o conteudo', () => {
  assert.equal(painelInfo('o reenvio da senha já foi pedido 😊').prazo, 'assim que puder. O reenvio da senha já foi pedido')
  assert.equal(painelFollowup('consegue retornar pra finalizarmos?').prazo, 'assim que puder. Consegue retornar pra finalizarmos?')
  assert.equal(generico('vi que a loja já consultou 👏 me conta como foi?').prazo, 'assim que puder. Vi que a loja já consultou me conta como foi?')
})

test('campanha de boas-vindas: sai pelo 86, com o rotulo do momento e o placar antigo como situacao', () => {
  // unica rotina que leva premio em R$ num template de utilidade — decisao do Aldo, risco avisado
  assert.equal(campanha('boas_vindas', 'sua loja entrou na campanha 🎁 vale R$ 80').etapa, 'entrada da loja na campanha de boas-vindas da AIVA.')
  assert.equal(campanha('meio_s2', 'x').etapa, 'placar parcial da semana 2 da campanha de boas-vindas da AIVA.')
  assert.equal(campanha('fim_s1', 'x').etapa, 'fechamento da semana 1 da campanha de boas-vindas da AIVA.')
  assert.equal(campanha('fim_s4', 'x').etapa, 'encerramento da campanha de boas-vindas da AIVA.')
  const m = campanha('meio_s1', 'passando o placar 📊 Semana 1: 6 de 30 consultas. Faltam 24 pra ganhar mais R$ 80.')
  assert.equal(m.tipo, 'etapa')
  assert.equal(m.situacao, 'Passando o placar Semana 1: 6 de 30 consultas. Faltam 24 pra ganhar mais R$ 80.')
  assert.equal(montar('Carlos', 'Cell Center', m).vars.length, 4)
})

// 17/11/2026 (2ª ordem do Aldo): D+0, link de cadastro e treinamento também saem por utilidade.
test('disparo inicial (D+0): etapa concluida (86), sem nome de pessoa, sem prometer aprovacao', () => {
  const m = disparoInicial()
  assert.equal(m.tipo, 'etapa')
  assert.match(m.situacao, /Quer que eu te explique como funciona\?$/)
  assert.ok(!/aprovad[ao]\b/i.test(m.etapa), 'nao pode dizer que a loja foi aprovada no 1o contato')
  const { vars, texto } = montar(NOME_D0, 'Cell Center', m)
  assert.equal(vars[0], 'pessoal')
  assert.ok(texto.startsWith('Olá pessoal, aqui é a VictorIA da Track.\n\nA loja Cell Center teve uma etapa concluída: seleção para o convite da parceria AIVA'))
  assert.ok(texto.endsWith('Quer que eu te explique como funciona?\n\nDúvidas, responda esta mensagem.'))
  assert.ok(texto.length <= 1000)
})

test('link de cadastro: etapa concluida, com o link dentro', () => {
  const m = linkCadastro('https://retail-onboarding-hub.vercel.app/')
  assert.equal(m.tipo, 'etapa')
  assert.equal(m.etapa, 'aprovação da loja pela AIVA.')
  assert.ok(m.situacao.includes('https://retail-onboarding-hub.vercel.app/'))
})

test('treinamento liberado: turmas, materiais e acesso cabem num corpo so', () => {
  const turmas = ['quarta 18/11, 9h30 https://meet.google.com/vou-gpmy-rtp', 'sexta 20/11, 9h30 https://meet.google.com/vou-gpmy-rtp', 'segunda 23/11, 9h30 https://meet.google.com/vou-gpmy-rtp']
  const DRIVE = 'https://drive.google.com/drive/folders/1t0WpRYg7b5TIb7Hbbkjg9oyMI1bGXe-w', FORM = 'https://forms.gle/izjwzRDXzYWDvtEt6'
  const com = treinamentoLiberado(turmas, DRIVE, false, FORM)
  assert.equal(com.tipo, 'etapa')
  for (const x of [...turmas, DRIVE, FORM, '+55 21 4020-2024']) assert.ok(com.situacao.includes(x), x)
  const corpo = montar('Carlos Eduardo', 'Cell Center Assistência e Acessórios', com).texto
  assert.ok(corpo.length <= 1000, `corpo com ${corpo.length} caracteres`)
  // loja ainda nao criada pela AIVA: sem formulario de vendedores
  const sem = treinamentoLiberado(turmas, DRIVE, true, FORM)
  assert.ok(!sem.situacao.includes(FORM) && sem.situacao.includes('assim que a AIVA concluir a criação da loja'))
  // sem agenda: nao inventa data
  assert.match(treinamentoLiberado([], DRIVE, false, FORM).situacao, /me responde aqui que eu te passo a data e o link/)
})
