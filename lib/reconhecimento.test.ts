import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehSoReconhecimento } from './reconhecimento.ts'

test('aceno puro: não responde nada', () => {
  for (const t of ['ok', 'Ok', 'OK!', 'ok.', 'blz', 'beleza', 'certo', 'entendi', 'tá bom',
                   'tranquilo', 'show', 'perfeito', 'obrigado', 'vlw', 'ok obrigado',
                   'blz vlw', 'ok então', '👍', '✅', '👍👍', 'ok 👍']) {
    assert.equal(ehSoReconhecimento(t), true, `deveria ser aceno: ${t}`)
  }
})

test('resposta de verdade NÃO é aceno — "sim" responde pergunta fechada', () => {
  for (const t of ['sim', 'já fiz', 'fiz sim', 'preenchi', 'não', 'ainda não', 'já recebi',
                   'consegui entrar', 'não consegui', 'ok, mas não recebi a senha',
                   'já fiz o treinamento', '3', 'segunda',
                   // achados do revisor 17/09: cada uma responde "já fez o treinamento?"
                   'isso', 'isso mesmo', 'exato', 'certinho', 'confere',
                   'tudo certo', 'tudo ok', 'vou ver', 'nada']) {
    assert.equal(ehSoReconhecimento(t), false, `NÃO deveria ser aceno: ${t}`)
  }
})

test('frase longa nunca é aceno, mesmo começando com ok', () => {
  assert.equal(ehSoReconhecimento('ok vou tentar de novo aqui e te falo depois'), false)
})

test('vazio não conta como aceno (áudio/imagem caem em outro caminho)', () => {
  assert.equal(ehSoReconhecimento(''), false)
  assert.equal(ehSoReconhecimento(null), false)
})
