import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  montar, limpar, lojaDe, FORMULARIO, cadastroIncompleto, biometria, acessoPendente, treinamentoGenerico, treinamentoLembrete,
  treinamentoPosTurma, ticketResolvido, AVISO_ETAPA_UTIL, PRE_APROVADA_UTIL, alertaInterno, LOJA_INTERNA, type MsgUtilidade,
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
