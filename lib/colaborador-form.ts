/**
 * lib/colaborador-form.ts — ⛔ FLUXO DESATIVADO EM 2026-08-27 (aviso do Edu/AIVA:
 * o formulário foi desligado; o sócio cria usuários pelo Live Chat da plataforma).
 * enviarColaboradorAoForm tem guard e não posta mais. Histórico abaixo:
 * lançava colaboradores no Google Form "Colaborador AIVA" (pedido do Aldo 2026-07-28).
 *
 * Contexto: pra equipe da loja receber acesso à plataforma AIVA, cada colaborador
 * precisa ser cadastrado no formulário. A VictorIA já coleta esses dados no chat
 * (fluxo "está vendendo?" — motivo_humano "dados_colaborador_coletados | ...").
 * Este módulo faz o parse do motivo e envia cada colaborador ao formulário,
 * um por vez. Testado 2026-07-28: o form aceita POST anônimo (HTTP 200 ✓),
 * diferente do form de pré-cadastro (que exige login).
 *
 * Campos do form (entry IDs inspecionados em 2026-07-28):
 *   Nome da Loja | CNPJ Matriz | CNPJ da Loja | Nome | CPF | E-mail | Telefone
 *   | Indicação Comercial (fixo: "Parceria Track - Aldo/Nei")
 */

const FORM_ID = '1FAIpQLScyDeNVwoEdG_ZcPrRP8rCIeoVoIk06MPbgRRSLoEqbY9xX5w'
const FORM_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`
const VIEW_URL = `https://docs.google.com/forms/d/e/${FORM_ID}/viewform`

const ENTRIES = {
  nomeLoja: 'entry.1065031111',
  cnpjMatriz: 'entry.1090203268',
  cnpjLoja: 'entry.935092301',
  nome: 'entry.871401129',
  cpf: 'entry.6220258',
  email: 'entry.1343692842',
  telefone: 'entry.1616565767',
  indicacao: 'entry.1581597442',
} as const

const INDICACAO_TRACK = 'Parceria Track - Aldo/Nei'

export interface Colaborador {
  cnpjMatriz: string
  cnpjLoja: string
  nome: string
  cpf: string
  email: string
  telefone: string
}

/**
 * Faz o parse do motivo_humano "dados_colaborador_coletados | [Loja] |
 * Colaborador 1: CNPJ matriz=..., CNPJ loja=..., nome=..., CPF=..., email=...,
 * telefone=... | Colaborador 2: ...". Tolerante a variações de espaçamento e
 * pontuação nos números. Só devolve colaboradores com TODOS os campos válidos.
 */
export function parseColaboradores(motivo: string): { validos: Colaborador[]; incompletos: number } {
  // Aceita "Colaborador 1:", "Colaborador:", "Colaboradora 2:" etc. — bug Diana
  // Upstore 2026-07-29: a VictorIA escreveu "Colaborador:" sem número e o split
  // antigo (que exigia dígito) não reconhecia nada.
  let blocos = motivo.split(/Colaborador(?:a)?(?:\s*\d+)?\s*:/i).slice(1)
  // Rede de segurança: nenhum cabeçalho "Colaborador" mas o motivo tem os
  // campos (CPF=/email=)? Trata o texto após o nome da loja como bloco único.
  if (blocos.length === 0 && /CPF\s*=/i.test(motivo)) {
    blocos = [motivo]
  }
  const validos: Colaborador[] = []
  let incompletos = 0

  for (const bloco of blocos) {
    const campo = (rotulo: RegExp): string => {
      const m = bloco.match(rotulo)
      return m ? m[1].trim().replace(/[|,]+$/, '').trim() : ''
    }
    const soDigitos = (s: string) => s.replace(/\D/g, '')

    const cnpjMatriz = soDigitos(campo(/CNPJ\s*matriz\s*=\s*([^,|]+)/i))
    const cnpjLojaRaw = soDigitos(campo(/CNPJ\s*loja\s*=\s*([^,|]+)/i))
    const nome = campo(/nome\s*=\s*([^,|]+)/i)
    const cpf = soDigitos(campo(/CPF\s*=\s*([^,|]+)/i))
    const email = campo(/e-?mail\s*=\s*([^,|\s]+)/i)
    const telefone = soDigitos(campo(/telefone\s*=\s*([^,|]+)/i))

    const cnpjLoja = cnpjLojaRaw.length === 14 ? cnpjLojaRaw : cnpjMatriz

    const ok =
      cnpjMatriz.length === 14 &&
      cnpjLoja.length === 14 &&
      nome.length >= 5 && nome.includes(' ') &&
      cpf.length === 11 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
      telefone.length >= 10 && telefone.length <= 13

    if (ok) validos.push({ cnpjMatriz, cnpjLoja, nome, cpf, email, telefone })
    else incompletos++
  }
  return { validos, incompletos }
}

/** Envia UM colaborador ao formulário. Retorna true se o Google registrou. */
export async function enviarColaboradorAoForm(nomeLoja: string, c: Colaborador): Promise<boolean> {
  // ⛔ DESATIVADO 2026-08-27 (aviso do Edu/AIVA): o formulário de colaboradores
  // foi desligado — os logins de vendedores agora são solicitados pelo próprio
  // sócio no Live Chat da plataforma (Cadastrar/Remover Usuário). Este guard
  // impede POST num form morto se algum fluxo legado ainda emitir o motivo
  // "dados_colaborador_coletados" (a VictorIA foi instruída a não emitir mais).
  console.warn(`[COLAB_FORM_DESATIVADO] tentativa de lançar colaborador ${c.nome ?? '?'} (${nomeLoja}) — fluxo aposentado 27/08, nada enviado`)
  if (true) return false

  try {
    const body = new URLSearchParams({
      [ENTRIES.nomeLoja]: nomeLoja,
      [ENTRIES.cnpjMatriz]: c.cnpjMatriz,
      [ENTRIES.cnpjLoja]: c.cnpjLoja,
      [ENTRIES.nome]: c.nome,
      [ENTRIES.cpf]: c.cpf,
      [ENTRIES.email]: c.email,
      [ENTRIES.telefone]: c.telefone,
      [ENTRIES.indicacao]: INDICACAO_TRACK,
    })
    const res = await fetch(FORM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'user-agent': 'sdr-aiva/1.0' },
      body: body.toString(),
      redirect: 'follow',
    })
    if (!res.ok) console.error(`[COLAB_FORM] ${c.nome} (CPF ${c.cpf}) → HTTP ${res.status}`)
    return res.ok
  } catch (err) {
    console.error(`[COLAB_FORM] Falha ao enviar ${c.nome}:`, err)
    return false
  }
}

/** Link pré-preenchido (fallback manual quando o envio automático falhar). */
export function linkColaboradorPreenchido(nomeLoja: string, c: Colaborador): string {
  const q = new URLSearchParams({
    usp: 'pp_url',
    [ENTRIES.nomeLoja]: nomeLoja,
    [ENTRIES.cnpjMatriz]: c.cnpjMatriz,
    [ENTRIES.cnpjLoja]: c.cnpjLoja,
    [ENTRIES.nome]: c.nome,
    [ENTRIES.cpf]: c.cpf,
    [ENTRIES.email]: c.email,
    [ENTRIES.telefone]: c.telefone,
    [ENTRIES.indicacao]: INDICACAO_TRACK,
  })
  return `${VIEW_URL}?${q.toString()}`
}
