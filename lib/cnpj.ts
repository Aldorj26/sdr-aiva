/**
 * lib/cnpj.ts — consulta pública de CNPJ via BrasilAPI (dados da Receita).
 *
 * Origem: curadoria 2026-07-27 — três travas do portal UME podem ser
 * antecipadas no chat com o dado oficial da Receita:
 *   1. CNPJ com menos de 1 ano (regra de corte — hoje depende da resposta do lojista)
 *   2. Empresa sem quadro societário (portal exige sócio e trava o empresário individual)
 *   3. Situação cadastral irregular (baixada/inapta/suspensa)
 *
 * API: https://brasilapi.com.br/api/cnpj/v1/{cnpj} — gratuita, sem chave.
 * Best-effort: qualquer falha (timeout, 404, rate limit) retorna null e o
 * fluxo segue normal — a consulta NUNCA pode travar o webhook.
 */

export interface CNPJInfo {
  cnpj: string
  razaoSocial: string | null
  nomeFantasia: string | null
  abertura: string | null      // YYYY-MM-DD
  idadeAnos: number | null     // ex.: 0.7, 3.2
  situacao: string | null      // ATIVA | BAIXADA | INAPTA | SUSPENSA | NULA
  cnae: string | null          // código principal
  cnaeDescricao: string | null
  qsaCount: number             // sócios no quadro societário
  endereco: string | null      // logradouro, nº, bairro, município/UF, CEP
}

/**
 * Por que o status importa (bug ICONNECT, 11/08/2026): 404 NÃO é falha técnica —
 * é informação. CNPJ que não está na base pública da Receita é (a) recém-aberto,
 * ainda sem sincronizar, ou (b) número errado. Nos dois casos o lead NÃO pode ser
 * pré-aprovado. Antes o 404 caía no mesmo `null` de timeout/rate-limit, o fluxo
 * seguia normal e a regra de corte de 1 ano nunca era avaliada: a iconnect (CNPJ
 * com ~1 mês) foi pré-aprovada e só travou depois, no portal da AIVA.
 *
 * 'indisponivel' (timeout, 5xx, rate limit) continua fail-open de propósito —
 * instabilidade nossa não pode barrar lojista bom.
 */
export type StatusCNPJ = 'ok' | 'invalido' | 'nao_encontrado' | 'indisponivel'

/**
 * Dígitos verificadores do CNPJ. Checado ANTES de bater na API (bug JL Cell
 * 11/08/2026): o lojista mandou 64.171.715/0001-66, cujos DVs corretos são 95.
 * A BrasilAPI responde 400 nesse caso — que caía no mesmo balde de "instabilidade"
 * e liberava o lead. Número que não fecha a conta é erro de digitação ou invenção;
 * não precisa de internet pra saber disso.
 */
export function cnpjDvValido(valor: string): boolean {
  const c = (valor ?? '').replace(/\D/g, '')
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false
  const calc = (base: string, pesos: number[]): number => {
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i]
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return String(d1) === c[12] && String(d2) === c[13]
}

export async function consultarCNPJDetalhado(
  cnpjRaw: string,
): Promise<{ info: CNPJInfo | null; status: StatusCNPJ }> {
  // holder por chamada — nada de estado de módulo aqui: o webhook processa
  // vários leads em paralelo e uma variável compartilhada trocaria os status.
  const ref: { status: StatusCNPJ } = { status: 'indisponivel' }
  const info = await consultarCNPJInterno(cnpjRaw, ref)
  return { info, status: info ? 'ok' : ref.status }
}

export async function consultarCNPJ(cnpjRaw: string): Promise<CNPJInfo | null> {
  return consultarCNPJInterno(cnpjRaw, { status: 'indisponivel' })
}

async function consultarCNPJInterno(
  cnpjRaw: string,
  ref: { status: StatusCNPJ },
): Promise<CNPJInfo | null> {
  const cnpj = (cnpjRaw ?? '').replace(/\D/g, '')
  if (cnpj.length !== 14 || !cnpjDvValido(cnpj)) {
    // nem chama a API — número que não fecha o DV não existe em lugar nenhum
    ref.status = 'invalido'
    return null
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'sdr-aiva/1.0' },
    })
    clearTimeout(timer)
    if (!res.ok) {
      console.log(`[CNPJ] BrasilAPI ${res.status} pra ${cnpj}`)
      // 400 = a API também recusou o número (formato/DV). 404 = não existe na base.
      // Só 5xx/timeout/rate-limit contam como problema nosso e liberam o lead.
      ref.status = res.status === 400 ? 'invalido' : res.status === 404 ? 'nao_encontrado' : 'indisponivel'
      return null
    }
    const data = (await res.json()) as Record<string, unknown>

    const abertura = typeof data.data_inicio_atividade === 'string' ? data.data_inicio_atividade : null
    let idadeAnos: number | null = null
    if (abertura) {
      const dt = new Date(`${abertura}T12:00:00Z`)
      if (!isNaN(dt.getTime())) {
        idadeAnos = Math.round(((Date.now() - dt.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10
      }
    }
    const qsa = Array.isArray(data.qsa) ? data.qsa : []

    let partesEnd = [
      [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(' '),
      data.numero,
      data.bairro,
      [data.municipio, data.uf].filter(Boolean).join('/'),
      data.cep ? `CEP ${data.cep}` : null,
    ].filter((p) => typeof p === 'string' && p.trim())

    // FALLBACK DE ENDEREÇO (caso PlanetPhone 2026-07-29): alguns CNPJs vêm da
    // BrasilAPI SEM logradouro/número (registro incompleto na fonte deles).
    // A publica.cnpj.ws costuma ter o cartão CNPJ completo — consulta lá só
    // quando faltar a rua. Best-effort (rate público 3 req/min, uso raro).
    if (!String(data.logradouro ?? '').trim()) {
      try {
        const c2 = new AbortController()
        const t2 = setTimeout(() => c2.abort(), 6000)
        const r2 = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
          signal: c2.signal,
          headers: { accept: 'application/json', 'user-agent': 'sdr-aiva/1.0' },
        })
        clearTimeout(t2)
        if (r2.ok) {
          const est = ((await r2.json()) as Record<string, unknown>).estabelecimento as Record<string, unknown> | undefined
          if (est && String(est.logradouro ?? '').trim()) {
            partesEnd = [
              [est.tipo_logradouro, est.logradouro].filter(Boolean).join(' '),
              est.numero,
              est.bairro,
              [data.municipio ?? '', data.uf ?? ''].filter(Boolean).join('/'),
              (est.cep ?? data.cep) ? `CEP ${est.cep ?? data.cep}` : null,
            ].filter((p) => typeof p === 'string' && p.trim()) as string[]
            console.log(`[CNPJ] Endereço completado via cnpj.ws pra ${cnpj}`)
          }
        }
      } catch { /* segue com o endereço parcial da BrasilAPI */ }
    }

    return {
      endereco: partesEnd.length ? partesEnd.join(', ') : null,
      cnpj,
      razaoSocial: typeof data.razao_social === 'string' ? data.razao_social : null,
      nomeFantasia: typeof data.nome_fantasia === 'string' && data.nome_fantasia ? data.nome_fantasia : null,
      abertura,
      idadeAnos,
      situacao: typeof data.descricao_situacao_cadastral === 'string' ? data.descricao_situacao_cadastral.toUpperCase() : null,
      cnae: data.cnae_fiscal != null ? String(data.cnae_fiscal) : null,
      cnaeDescricao: typeof data.cnae_fiscal_descricao === 'string' ? data.cnae_fiscal_descricao : null,
      qsaCount: qsa.length,
    }
  } catch (err) {
    console.log(`[CNPJ] Falha na consulta de ${cnpj}:`, err instanceof Error ? err.message : err)
    return null
  }
}

/** Serializa o resultado como marcador pra observacoes do lead. */
export function cnpjInfoMarker(info: CNPJInfo): string {
  const partes = [
    `cnpj=${info.cnpj}`,
    info.abertura ? `abertura=${info.abertura}` : null,
    info.idadeAnos != null ? `idade=${info.idadeAnos}` : null,
    info.situacao ? `situacao=${info.situacao}` : null,
    `socios=${info.qsaCount}`,
  ].filter(Boolean)
  return `[CNPJ_RECEITA:${partes.join('|')}]`
}
