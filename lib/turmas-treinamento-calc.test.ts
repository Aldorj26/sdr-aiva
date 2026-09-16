import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarFallback, futuras, rotulo, resumoDias, linhasTurmas, blocoTurmasPrompt, calendarLink, type Turma } from './turmas-treinamento-calc.ts'

const t = (iso: string, id = 'vou-gpmy-rtp'): Turma => ({ startsAt: iso, inviteId: id, link: `https://meet.google.com/${id}`, label: null })

test('fallback: seg/qua/sex 9h30 BRT a partir de agora, com a turma de hoje se ainda não passou', () => {
  // quarta 23/09/2026 08:00 BRT = 11:00Z → a turma de hoje (12:30Z) entra
  const f = gerarFallback(new Date('2026-09-23T11:00:00Z'), 3)
  assert.deepEqual(f.map(rotulo), ['quarta 23/09, 9h30', 'sexta 25/09, 9h30', 'segunda 28/09, 9h30'])
  // quarta 23/09 às 12h BRT (15:00Z) → a de hoje já passou (>90 min)
  const g = gerarFallback(new Date('2026-09-23T15:00:00Z'), 2)
  assert.deepEqual(g.map(rotulo), ['sexta 25/09, 9h30', 'segunda 28/09, 9h30'])
})

test('rotulo/dia em horário de Brasília e resumo de dias distintos', () => {
  const turmas = [t('2026-09-17T12:30:00+00:00', 'hqn-vcrr-dxo'), t('2026-09-21T12:30:00+00:00'), t('2026-09-23T12:30:00+00:00'), t('2026-09-25T12:30:00+00:00'), t('2026-09-28T12:30:00+00:00')]
  assert.equal(rotulo(turmas[0]), 'quinta 17/09, 9h30')
  assert.equal(resumoDias(turmas), 'quinta, segunda, quarta e sexta')
  assert.equal(resumoDias(turmas.slice(1)), 'segunda, quarta e sexta')
  assert.equal(resumoDias([turmas[1]]), 'segunda')
  assert.equal(resumoDias([]), 'nos dias da agenda')
})

test('futuras: ordena, corta o passado (com 90 min de tolerância) e limita', () => {
  const agora = new Date('2026-09-17T13:30:00Z') // quinta 10h30 BRT: turma das 9h30 ainda dentro da tolerância
  const turmas = [t('2026-09-21T12:30:00Z'), t('2026-09-17T12:30:00Z', 'hqn-vcrr-dxo'), t('2026-09-14T12:30:00Z', 'gdh-ppvw-nmp')]
  assert.deepEqual(futuras(turmas, agora, 5).map((x) => x.inviteId), ['hqn-vcrr-dxo', 'vou-gpmy-rtp'])
  assert.equal(futuras(turmas, new Date('2026-09-17T14:30:00Z'), 5)[0].inviteId, 'vou-gpmy-rtp')
})

test('linhas do WhatsApp e bloco do prompt trazem cada turma com seu link', () => {
  const turmas = [t('2026-09-21T12:30:00Z'), t('2026-09-23T12:30:00Z')]
  assert.deepEqual(linhasTurmas(turmas), ['🔗 segunda 21/09, 9h30 👉 meet.google.com/vou-gpmy-rtp', '🔗 quarta 23/09, 9h30 👉 meet.google.com/vou-gpmy-rtp'])
  const b = blocoTurmasPrompt(turmas, 'portal')
  assert.match(b, /segunda 21\/09, 9h30 \(Brasília\) → https:\/\/meet\.google\.com\/vou-gpmy-rtp/)
  assert.doesNotMatch(b, /portal indisponível/)
  assert.match(blocoTurmasPrompt(turmas, 'fallback'), /portal indisponível/)
  assert.match(blocoTurmasPrompt([], 'portal'), /nenhuma turma publicada/)
})

test('calendarLink: 1h de duração no formato do Google', () => {
  const l = calendarLink(t('2026-09-21T12:30:00Z'))
  assert.match(l, /dates=20260921T123000Z\/20260921T133000Z/)
  assert.match(l, /location=https%3A%2F%2Fmeet\.google\.com%2Fvou-gpmy-rtp/)
})
