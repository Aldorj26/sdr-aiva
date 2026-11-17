import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classificar, trilhaDoLead, lerMarcadores, decidir, camposToque, camposReconhecimento, dataConferencia,
  gravarEstado, encerrarEstado, renderToque, limparCampo, intervaloDias, normalizarMotivo, marcaMotivo, lerMotivo, blocoPromptRegua, type Contexto, type Trilha,
} from './regua-alerta-calc.ts'

const DIA = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-11-17T14:00:00Z') // 11h BRT
const iso = (ms: number) => new Date(ms).toISOString()
const ctx = (p: Partial<Contexto> = {}): Contexto => ({ trilhaAtual: 'B', boardColumn: 'primeira_venda', ultimaFalaLojista: null, ultimoOutroTemplate: null, filaHumana: false, bloqueadaLimite: false, ...p })
const marca = (trilha: Trilha, toque: number, diasAtras: number | null) => gravarEstado('nome_socio=Carlos', trilha, toque, diasAtras === null ? null : new Date(T0 - diasAtras * DIA))

test('alerta + coluna do quadro viram trilha', () => {
  assert.equal(classificar('baixa_performance', 'primeiro_acesso', '2026-09-01'), 'A')
  assert.equal(classificar('baixa_performance', 'primeira_venda', null), 'A')
  assert.equal(classificar('antigo_sem_engajamento', 'primeira_venda', null), 'B')
  assert.equal(classificar('antigo_sem_engajamento', 'primeiro_acesso', null), 'C')
  assert.equal(classificar('novo_sem_engajamento', 'pronto_para_operar', '2026-11-10T12:00:00Z'), 'C') // consultou: primeiro_acesso_em
  assert.equal(classificar('novo_sem_engajamento', 'cadastro_finalizado', null), 'D')
  assert.equal(classificar('antigo_sem_engajamento', 'pronto_para_operar', null), 'D')
})

test('lojista com varias filiais em alerta: vale a trilha mais prioritaria', () => {
  assert.equal(trilhaDoLead(['D', 'B', 'C']), 'B')
  assert.equal(trilhaDoLead(['C', 'A']), 'A')
  assert.equal(trilhaDoLead([]), null)
})

test('loja que entra no alerta recebe o toque 1 na hora (regua permanente)', () => {
  assert.deepEqual(decidir(lerMarcadores('nome_socio=Carlos'), ctx(), T0), { acao: 'toque', trilha: 'B', toque: 1, ligar: false })
})

test('cadencia: semanal ate o 4o toque, depois mensal', () => {
  assert.equal(intervaloDias(1), 7)
  assert.equal(intervaloDias(3), 7)
  assert.equal(intervaloDias(4), 30)
  assert.deepEqual(decidir(lerMarcadores(marca('C', 1, 5)), ctx({ trilhaAtual: 'C', boardColumn: 'primeiro_acesso' }), T0), { acao: 'nada', motivo: 'aguardando_intervalo' })
  assert.deepEqual(decidir(lerMarcadores(marca('C', 1, 7)), ctx({ trilhaAtual: 'C', boardColumn: 'primeiro_acesso' }), T0), { acao: 'toque', trilha: 'C', toque: 2, ligar: false })
  // 7 dias menos 1h: a folga de 12h deixa passar (o cron roda em hora fixa)
  assert.equal(decidir(lerMarcadores(gravarEstado('', 'C', 1, new Date(T0 - 7 * DIA + 3600_000))), ctx({ trilhaAtual: 'C' }), T0).acao, 'toque')
  assert.deepEqual(decidir(lerMarcadores(marca('C', 4, 10)), ctx({ trilhaAtual: 'C' }), T0), { acao: 'nada', motivo: 'aguardando_intervalo' })
  assert.deepEqual(decidir(lerMarcadores(marca('C', 4, 30)), ctx({ trilhaAtual: 'C' }), T0), { acao: 'toque', trilha: 'C', toque: 5, ligar: false })
})

test('lista de ligacao: so trilhas A e B, a partir do 3o toque', () => {
  assert.deepEqual(decidir(lerMarcadores(marca('B', 2, 7)), ctx(), T0), { acao: 'toque', trilha: 'B', toque: 3, ligar: true })
  assert.deepEqual(decidir(lerMarcadores(marca('A', 2, 7)), ctx({ trilhaAtual: 'A' }), T0), { acao: 'toque', trilha: 'A', toque: 3, ligar: true })
  assert.deepEqual(decidir(lerMarcadores(marca('B', 1, 7)), ctx(), T0), { acao: 'toque', trilha: 'B', toque: 2, ligar: false })
  assert.deepEqual(decidir(lerMarcadores(marca('D', 2, 7)), ctx({ trilhaAtual: 'D' }), T0), { acao: 'toque', trilha: 'D', toque: 3, ligar: false })
})

test('travas', () => {
  const d = (obs: string, p: Partial<Contexto> = {}) => decidir(lerMarcadores(obs), ctx(p), T0)
  assert.deepEqual(d('[DICAS_OPTOUT]'), { acao: 'nada', motivo: 'optout' })
  assert.deepEqual(d('[REGUA_OPTOUT]'), { acao: 'nada', motivo: 'optout' })
  assert.deepEqual(d('[PORTAL_REPROVADO:x]'), { acao: 'nada', motivo: 'reprovado' })
  assert.deepEqual(d(`[SENHA_PENDENTE_DESDE:${iso(T0)}]`), { acao: 'nada', motivo: 'sem_acesso' })
  assert.deepEqual(d(`[PAUSA_ATE:${iso(T0 + DIA)}]`), { acao: 'nada', motivo: 'pausa' })
  assert.equal(d(`[PAUSA_ATE:${iso(T0 - DIA)}]`).acao, 'toque')
  assert.deepEqual(d('', { filaHumana: true }), { acao: 'nada', motivo: 'fila_humano' })
  assert.deepEqual(d('', { bloqueadaLimite: true }), { acao: 'nada', motivo: 'bloqueada_limite' })
  assert.deepEqual(d('', { ultimaFalaLojista: T0 - 6 * DIA }), { acao: 'nada', motivo: 'respondeu_recente' })
  assert.equal(d('', { ultimaFalaLojista: T0 - 8 * DIA }).acao, 'toque')
  assert.deepEqual(d('', { ultimoOutroTemplate: T0 - 2 * DIA }), { acao: 'nada', motivo: 'outro_template_recente' })
  assert.equal(d('', { ultimoOutroTemplate: T0 - 4 * DIA }).acao, 'toque')
})

test('saiu do alerta: reconhecimento uma vez; quem nunca foi tocado so perde a marca', () => {
  assert.deepEqual(decidir(lerMarcadores('nome_socio=Carlos'), ctx({ trilhaAtual: null }), T0), { acao: 'nada', motivo: 'fora_do_alerta' })
  assert.deepEqual(decidir(lerMarcadores(marca('B', 2, 3)), ctx({ trilhaAtual: null }), T0), { acao: 'reconhecer', variante: 'saiu', novaTrilha: null })
  assert.deepEqual(decidir(lerMarcadores(marca('C', 1, 3)), ctx({ trilhaAtual: null, boardColumn: 'primeira_venda' }), T0), { acao: 'reconhecer', variante: 'primeira_venda', novaTrilha: null })
  assert.deepEqual(decidir(lerMarcadores(marca('D', 0, null)), ctx({ trilhaAtual: null }), T0), { acao: 'encerrar' })
  // depois do reconhecimento a marca some: a rodada seguinte nao reconhece de novo
  const depois = encerrarEstado(marca('B', 2, 3), new Date(T0))
  assert.equal(lerMarcadores(depois).estado, null)
  assert.deepEqual(decidir(lerMarcadores(depois), ctx({ trilhaAtual: null }), T0 + DIA), { acao: 'nada', motivo: 'fora_do_alerta' })
  // lojista conversando agora: nao atravessa a conversa com template
  assert.deepEqual(decidir(lerMarcadores(marca('B', 2, 3)), ctx({ trilhaAtual: null, ultimaFalaLojista: T0 - DIA }), T0), { acao: 'nada', motivo: 'conversa_viva' })
})

test('voltou a entrar no alerta depois de sair: recomeca do toque 1', () => {
  const depois = encerrarEstado(marca('B', 3, 10), new Date(T0 - 20 * DIA))
  assert.deepEqual(decidir(lerMarcadores(depois), ctx(), T0), { acao: 'toque', trilha: 'B', toque: 1, ligar: false })
})

test('mudou de trilha: voltar a consultar e reconhecido; as outras trocas sao silenciosas', () => {
  assert.deepEqual(decidir(lerMarcadores(marca('B', 2, 3)), ctx({ trilhaAtual: 'A' }), T0), { acao: 'reconhecer', variante: 'voltou_consultar', novaTrilha: 'A' })
  assert.deepEqual(decidir(lerMarcadores(marca('D', 1, 3)), ctx({ trilhaAtual: 'C' }), T0), { acao: 'trocar_trilha', trilha: 'C' })
  assert.deepEqual(decidir(lerMarcadores(marca('A', 1, 3)), ctx({ trilhaAtual: 'B' }), T0), { acao: 'trocar_trilha', trilha: 'B' })
  // trocou sem nunca ter sido tocada: nada a reconhecer
  assert.deepEqual(decidir(lerMarcadores(marca('C', 0, null)), ctx({ trilhaAtual: 'A' }), T0), { acao: 'trocar_trilha', trilha: 'A' })
})

test('marca nas observacoes: grava, le e preserva o resto', () => {
  const o = gravarEstado('nome_socio=Carlos [DICAS_COUNT:3]', 'A', 2, new Date(T0))
  assert.equal(o, `nome_socio=Carlos [DICAS_COUNT:3] [REGUA_ALERTA:trilha=A|toque=2|ultima=${iso(T0)}]`)
  assert.deepEqual(lerMarcadores(o).estado, { trilha: 'A', toque: 2, ultima: T0, reconhecidoEm: null })
  const o2 = gravarEstado(o, 'A', 3, new Date(T0 + DIA))
  assert.equal((o2.match(/REGUA_ALERTA/g) ?? []).length, 1)
  assert.equal(encerrarEstado(o2, null), 'nome_socio=Carlos [DICAS_COUNT:3]')
})

test('data da conferencia: hoje + 7 dias (BRT); depois do 4o toque, + 30', () => {
  assert.equal(dataConferencia(1, T0), '24/11')
  assert.equal(dataConferencia(4, T0), '17/12')
  // 23h BRT de 17/11 ainda e dia 17 no Brasil (02h UTC do dia 18)
  assert.equal(dataConferencia(1, Date.parse('2026-11-18T02:00:00Z')), '24/11')
})

test('textos: sem numero, sem argumento de venda, sem quebra de linha nos campos', () => {
  for (const t of ['A', 'B', 'C', 'D'] as Trilha[]) {
    for (let n = 1; n <= 5; n++) {
      const c = camposToque(t, n, T0)
      assert.ok(c.prazo.startsWith('conferência em '), `${t}${n}`)
      for (const campo of [c.pendencia, c.prazo]) {
        assert.ok(!/[\n\t]/.test(campo) && !/ {4,}/.test(campo), `${t}${n} campo invalido pra Meta`)
        assert.ok(!/R\$|Black November|comiss|concorrente|bônus|bonus/i.test(campo), `${t}${n} tem argumento de venda`)
        assert.ok(campo.length <= 220, `${t}${n} longo demais`)
      }
    }
    // o 5o toque (mensal) volta ao texto do 1o
    assert.equal(camposToque(t, 5, T0).pendencia, camposToque(t, 1, T0).pendencia)
  }
  for (const v of ['saiu', 'voltou_consultar', 'primeira_venda'] as const) {
    const c = camposReconhecimento(v)
    assert.ok(!/[\n\t]/.test(c.etapa + c.situacao))
  }
  assert.equal(
    renderToque('Carlos', 'Cell Center', camposToque('B', 1, T0)),
    'Olá Carlos, aqui é a VictorIA da Track.\n\nA loja Cell Center tem uma pendência registrada: sem consulta de CPF registrada nos últimos dias. A loja já vendeu pela AIVA antes.\n\nPrazo: conferência em 24/11. Me conta o que mudou: equipe, acesso ou aprovação dos clientes.\n\nDúvidas, responda esta mensagem.',
  )
})

test('motivo declarado: so os 6 codigos, tolerando acento e maiuscula', () => {
  assert.equal(normalizarMotivo('reprovacao'), 'reprovacao')
  assert.equal(normalizarMotivo(' Reprovação '), 'reprovacao')
  assert.equal(normalizarMotivo('entrada/limite'), 'entrada_limite')
  assert.equal(normalizarMotivo('Entrada Limite'), 'entrada_limite')
  assert.equal(normalizarMotivo('preguica'), null)
  assert.equal(normalizarMotivo(null), null)
  assert.equal(normalizarMotivo(3), null)
  const obs = `${marca('B', 1, 2)} ${marcaMotivo('equipe', new Date(T0))}`
  assert.deepEqual(lerMotivo(obs), { motivo: 'equipe', em: T0 })
  assert.equal(lerMotivo('nada'), null)
})

test('bloco do prompt: so pra loja que ja recebeu toque; sem numero; com a trilha certa', () => {
  assert.equal(blocoPromptRegua('nome_socio=Carlos', T0), null)
  assert.equal(blocoPromptRegua(marca('B', 0, null), T0), null) // trocou de trilha sem toque: a loja nem sabe do aviso
  const b = blocoPromptRegua(marca('B', 2, 2), T0)!
  assert.ok(b.startsWith('[INSTRUÇÃO DO SISTEMA — LOJA NA RÉGUA DE ALERTA DA AIVA]') && b.endsWith('[FIM INSTRUÇÃO DO SISTEMA]'))
  assert.ok(b.includes('JÁ VENDEU pela AIVA e parou de consultar'))
  assert.ok(b.includes('Em 15/11') && b.includes('aviso nº 2') && b.includes('conferência em 22/11'))
  assert.ok(b.includes('é provável que ele esteja respondendo a esse aviso'))
  assert.ok(b.includes('"motivo_alerta"'))
  assert.ok(b.includes('OBJETIVO desta conversa: descobrir o MOTIVO') && !b.includes('MOTIVO JÁ CONHECIDO'))
  // aviso antigo: nao presume que a conversa e sobre ele
  assert.ok(!blocoPromptRegua(marca('B', 2, 20), T0)!.includes('é provável que ele esteja respondendo'))
  // motivo ja registrado aparece pro modelo nao repetir
  // motivo ja registrado: troca o objetivo — nao repergunta (revisor 17/11)
  const conhecido = blocoPromptRegua(`${marca('A', 1, 2)} ${marcaMotivo('reprovacao', new Date(T0))}`, T0)!
  assert.ok(conhecido.includes('MOTIVO JÁ CONHECIDO: ele já disse que o motivo é "reprovacao"') && !conhecido.includes('OBJETIVO desta conversa'))
  // senha pendente / cadastro aberto: o sistema ja sabe o motivo, a regua nao entra na conversa
  assert.equal(blocoPromptRegua(`${marca('D', 1, 2)} [SENHA_PENDENTE_DESDE:${iso(T0)}]`, T0), null)
  // em LOGIN a pergunta do motivo e a do acesso (uma so)
  assert.ok(blocoPromptRegua(marca('D', 1, 2), T0, 'LOGIN')!.includes('faça só essa, não duas'))
  assert.ok(!blocoPromptRegua(marca('D', 1, 2), T0, 'TREINAR')!.includes('faça só essa, não duas'))
  // o aviso nao pode prometer que ela resolve acesso ou reenvia senha sozinha
  for (const t of ['A', 'B', 'C', 'D'] as Trilha[]) for (let n = 1; n <= 4; n++) assert.ok(!/eu resolvo|eu peço o reenvio/.test(camposToque(t, n, T0).prazo))
  for (const t of ['A', 'B', 'C', 'D'] as Trilha[]) assert.ok(!/R\$|Black November|comiss/i.test(blocoPromptRegua(marca(t, 1, 1), T0)!))
})

test('nome da loja vai limpo pro campo do template', () => {
  assert.equal(limparCampo('  Cell\nCenter   Matriz '), 'Cell Center Matriz')
  assert.equal(limparCampo('x'.repeat(80)).length, 60)
})
