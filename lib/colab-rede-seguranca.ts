/**
 * lib/colab-rede-seguranca.ts — rede de segurança para dados de colaborador.
 *
 * Por que existe (11/08/2026): a captura dependia 100% da VictorIA emitir
 * "dados_colaborador_coletados". Em 04-10/08 sete colaboradores de quatro lojas
 * (Lojas Migui, WL Elétron, SpeedCell, MBS) mandaram nome+CPF+e-mail+telefone no
 * chat e ela não emitiu — ficaram sem acesso e ninguém percebeu. Ajustar o prompt
 * resolveu parte dos casos, mas não todos (teste da WL continuou falhando), então
 * a garantia passa a ser determinística: regex + validação, sem depender do modelo.
 *
 * A rede é CONSERVADORA de propósito — só captura o que tem cara inequívoca de
 * colaborador. Falso negativo aqui é aceitável (o fluxo normal ainda pega);
 * falso positivo não é (criaria acesso pra pessoa errada).
 */

export interface ColaboradorCapturado {
  nome: string
  cpf: string
  email: string
  telefone: string
}

/** CPF com dígito verificador — sem isso, telefone de 11 dígitos vira "CPF". */
export function cpfValido(valor: string): boolean {
  const c = (valor ?? '').replace(/\D/g, '')
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false
  const n = c.split('').map(Number)
  const dv = (qtd: number): number => {
    let soma = 0
    for (let i = 0; i < qtd; i++) soma += n[i] * (qtd + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === n[9] && dv(10) === n[10]
}

// Contextos que TÊM CPF mas NÃO são colaborador — casos reais vistos na varredura:
// dados bancários da loja ("Razão Social: FULANO 026... CNPJ ... Titular"), CPF do
// sócio citado na qualificação, e leitura de CNH pela VictorIA.
const CONTEXTO_PROIBIDO = /\b(banco|ag[êe]ncia|conta|pix|titular|raz[ãa]o social|cnh|rg\b|s[óo]cio|contrato|dep[óo]sito|transfer[êe]ncia)\b/i

/**
 * Extrai UM colaborador de uma mensagem do lojista. Exige, na MESMA mensagem:
 * CPF válido + e-mail + telefone + sobra de texto que sirva como nome.
 */
export function capturarColaborador(texto: string, cpfDoSocio?: string | null): ColaboradorCapturado | null {
  const txt = String(texto ?? '')
  if (!txt.trim() || CONTEXTO_PROIBIDO.test(txt)) return null

  const email = txt.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0]
  if (!email) return null

  // Sem \s na classe! Com espaço, "00973171286 97984136133" (CPF + telefone
  // colados por um espaço) virava UM número de 22 dígitos e nada era encontrado —
  // foi o que derrubou Fabíola e Milena no teste da rede.
  const numeros = txt.match(/\d[\d.\-/]{8,}\d/g)?.map((s) => s.replace(/\D/g, '')) ?? []
  const cpf = numeros.find((n) => n.length === 11 && cpfValido(n))
  if (!cpf) return null
  if (cpfDoSocio && cpf === String(cpfDoSocio).replace(/\D/g, '')) return null // é o dono, não colaborador

  // telefone: 10 ou 11 dígitos que não seja o CPF (celular tem 11 e pode colidir
  // no tamanho — por isso o CPF é escolhido primeiro, pelo dígito verificador)
  const telefone = numeros.find((n) => n !== cpf && (n.length === 10 || n.length === 11 || (n.length === 13 && n.startsWith('55'))))
  if (!telefone) return null

  // Nome — duas estratégias, nessa ordem:
  // 1) rótulo explícito ("Nome completo; FULANO", "Nome: FULANO"). Sem isso, a
  //    lista numerada do lojista ("1. CNPJ da loja onde ele trabalha 2. Nome...")
  //    contaminava o nome com pedaços da pergunta (caso Lojas Migui).
  // 2) sobra da mensagem, quando ele manda tudo solto ("Fulano 000... a@b.com 62...").
  const RUIDO = /\b(nome completo|nome|cpf|e-?mail|gmail|telefone|tel|celular|whats(app)?|contato|cnpj|loja|matriz|ddd|n[úu]mero|onde|ele|ela|trabalha|d[ao]s?)\b/gi
  const soLetras = (s: string) =>
    s.replace(/[^A-Za-zÀ-ÿ'\s]/g, ' ').replace(/\s{2,}/g, ' ').trim().split(' ')
      .filter((p) => /^[A-Za-zÀ-ÿ']{2,}$/.test(p))

  let palavras: string[] = []
  // No caminho rotulado NÃO passo o RUIDO: o rótulo já isola o nome, e o filtro
  // comia preposição ("VICTOR GABRIEL FERREIRA DA COSTA" virava "...FERREIRA COSTA").
  const rotulado = txt.match(/nome(?:\s+completo)?\s*[:;]\s*([^\d\n|]{4,80})/i)?.[1]
  // corta no próximo rótulo: "Nome: João ... CPF: 036..." capturava o "CPF" junto,
  // porque o recorte só para no primeiro dígito.
  if (rotulado) palavras = soLetras(rotulado.split(/\b(?:cpf|e-?mail|gmail|telefone|tel|celular|whats(?:app)?|contato|cnpj)\b/i)[0])
  if (palavras.length < 2) {
    const sobra = txt
      .replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
      .replace(/\d[\d.\-/]{8,}\d/g, ' ')
      .replace(RUIDO, ' ')
    palavras = soLetras(sobra)
  }
  if (palavras.length < 2) return null

  return {
    nome: palavras.slice(0, 6).join(' '),
    cpf,
    email: email.toLowerCase(),
    telefone: telefone.replace(/^55(?=\d{10,11}$)/, ''),
  }
}

/** Varre as mensagens recebidas e devolve os colaboradores ainda não registrados. */
export function colaboradoresNaoRegistrados(
  mensagensIn: Array<{ conteudo: string }>,
  cpfsJaRegistrados: string[],
  cpfDoSocio?: string | null,
): ColaboradorCapturado[] {
  const registrados = new Set(cpfsJaRegistrados.map((c) => String(c).replace(/\D/g, '').padStart(11, '0')))
  const achados = new Map<string, ColaboradorCapturado>()
  for (const m of mensagensIn) {
    const c = capturarColaborador(m.conteudo, cpfDoSocio)
    if (!c) continue
    if (registrados.has(c.cpf)) continue
    if (!achados.has(c.cpf)) achados.set(c.cpf, c)
  }
  return [...achados.values()]
}
