import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRespostaJson, escaparControlesEmStrings } from './claude-json.ts'

const N = String.fromCharCode(10)   // newline cru
const T = String.fromCharCode(9)    // tab cru

test('JSON válido passa intocado e não é marcado como consertado', () => {
  const r = parseRespostaJson<{ mensagem: string }>('{"mensagem":"oi","acionar_humano":false}')
  assert.equal(r.valor.mensagem, 'oi')
  assert.equal(r.consertado, false)
})

test('o caso real: quebra de linha CRUA dentro da mensagem', () => {
  // MY CASE, 22/09/2026 — "Bad control character in string literal at position 81"
  const bruto = `{${N}  "mensagem": "Olá!${N}${N}Sou a VictorIA, da Track.",${N}  "novo_status": "INTERESSADO"${N}}`
  assert.throws(() => JSON.parse(bruto), /control character/i)
  const r = parseRespostaJson<{ mensagem: string; novo_status: string }>(bruto)
  assert.equal(r.consertado, true)
  assert.equal(r.valor.novo_status, 'INTERESSADO')
  // as quebras SOBREVIVEM como quebras de verdade — é o que vai pro WhatsApp
  assert.equal(r.valor.mensagem, `Olá!${N}${N}Sou a VictorIA, da Track.`)
})

test('tab e retorno de carro também', () => {
  const r = parseRespostaJson<{ m: string }>(`{"m":"a${T}b"}`)
  assert.equal(r.valor.m, `a${T}b`)
  const r2 = parseRespostaJson<{ m: string }>(`{"m":"a${String.fromCharCode(13)}b"}`)
  assert.equal(r2.valor.m, `a${String.fromCharCode(13)}b`)
})

test('quebra de linha FORA de string (indentação) não é tocada', () => {
  const bonito = `{${N}  "a": 1,${N}  "b": 2${N}}`
  assert.equal(escaparControlesEmStrings(bonito), bonito)
  assert.equal(parseRespostaJson<{ a: number }>(bonito).consertado, false)
})

test('aspas escapadas dentro da string não confundem o contador', () => {
  // o \" não pode alternar "dentro/fora de string", senão o newline seguinte
  // seria tratado como fora e não seria escapado
  const bruto = `{"m":"ele disse \\"oi\\"${N}e sumiu"}`
  const r = parseRespostaJson<{ m: string }>(bruto)
  assert.equal(r.valor.m, `ele disse "oi"${N}e sumiu`)
})

test('barra invertida escapada (\\\\) no fim da string não engole a aspa', () => {
  const bruto = `{"m":"caminho C:\\\\pasta\\\\","n":"depois${N}quebra"}`
  const r = parseRespostaJson<{ m: string; n: string }>(bruto)
  assert.equal(r.valor.m, 'caminho C:\\pasta\\')
  assert.equal(r.valor.n, `depois${N}quebra`)
})

test('emoji e acento sobrevivem (são multi-byte, não controle)', () => {
  const r = parseRespostaJson<{ m: string }>(`{"m":"Olá 😊 ✨${N}tudo certo"}`)
  assert.equal(r.valor.m, `Olá 😊 ✨${N}tudo certo`)
})

test('defeito que NÃO é de controle continua estourando — com o erro original', () => {
  // JSON truncado por limite de tokens: precisa continuar falhando alto, senão
  // a gente esconde um problema real do prompt
  assert.throws(() => parseRespostaJson('{"mensagem":"resposta cortada no meio'), /JSON/i)
  assert.throws(() => parseRespostaJson('{"a":1,,}'), /JSON/i)
  assert.throws(() => parseRespostaJson('não é json'), /JSON/i)
})

test('mensagem longa com vários parágrafos crus', () => {
  const corpo = ['Oi!', '', 'Primeiro ponto.', 'Segundo ponto.', '', 'Abraço 👋'].join(N)
  const r = parseRespostaJson<{ mensagem: string; acionar_humano: boolean }>(
    `{"mensagem":"${corpo}","acionar_humano":false,"motivo_humano":null}`,
  )
  assert.equal(r.valor.mensagem, corpo)
  assert.equal(r.valor.acionar_humano, false)
})
