import { removeFonesNaoOficiais } from '../lib/text'

const casos: Array<[string, string[]]> = [
  // caso real do bug — deve remover a sentença com o fone alucinado
  ['Consegue me mandar por texto?\n\nSe preferir, pode também me ligar: (31) 3360-0197. O que achar melhor!', []],
  // fone oficial — deve manter intacto
  ['Pra boleto do cliente final, chama o WhatsApp 22 2029-0100, ta?', []],
  // fone dito pelo lead — deve manter intacto
  ['Recebi seu telefone: 91 98711-8292. Agora me passa o CNPJ?', ['91987118292']],
  // CNPJ e protocolo — não pode mexer
  ['CNPJ 48.156.249/0001-17 confirmado! Protocolo 17840300848326268.', []],
  // valor monetário — não pode mexer
  ['Faturamento anual: R$ 720.000 (R$ 60.000 por mes)', []],
]

for (const [msg, extras] of casos) {
  const { texto, removidos } = removeFonesNaoOficiais(msg, extras)
  console.log('removidos:', JSON.stringify(removidos), '| resultado:', JSON.stringify(texto.slice(0, 110)))
}
