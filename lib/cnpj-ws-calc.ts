/**
 * lib/cnpj-ws-calc.ts — traduz o cartão CNPJ do publica.cnpj.ws para o mesmo
 * `CNPJInfo` que a BrasilAPI produz.
 *
 * Por que existe (14/10/2026): a BrasilAPI é a única fonte da consulta e, quando
 * ela cai (500/503 vindos da Receita), a pré-aprovação sai sem conferir idade e
 * situação — fail-open de propósito, mas vira conferência na mão do Nei. O
 * cnpj.ws já era consultado aqui como tapa-buraco de endereço e tem os mesmos
 * campos; esta função é o que permite usá-lo como fonte inteira.
 *
 * Pura: recebe o JSON cru e a data de referência, não faz rede. O IO (fetch,
 * timeout, decisão de quando usar) fica em `lib/cnpj.ts`.
 */

import type { CNPJInfo } from './cnpj.ts'

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/**
 * `bruto` é a resposta de https://publica.cnpj.ws/cnpj/{cnpj}. Devolve null
 * quando o payload não serve pra decidir — sem estabelecimento ou sem data de
 * abertura não dá pra avaliar a regra de 1 ano, e pré-aprovar com dado pela
 * metade é pior que cair no fail-open de sempre.
 */
export function mapearCnpjWs(cnpj: string, bruto: unknown, agora: Date = new Date()): CNPJInfo | null {
  if (!bruto || typeof bruto !== 'object') return null
  const raiz = bruto as Record<string, unknown>
  const est = raiz.estabelecimento as Record<string, unknown> | undefined
  if (!est || typeof est !== 'object') return null

  const abertura = texto(est.data_inicio_atividade)
  if (!abertura) return null

  const dt = new Date(`${abertura}T12:00:00Z`)
  if (isNaN(dt.getTime())) return null
  const idadeAnos = Math.round(((agora.getTime() - dt.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10

  const cidade = est.cidade as Record<string, unknown> | undefined
  const estado = est.estado as Record<string, unknown> | undefined
  const municipio = texto(cidade?.nome)
  const uf = texto(estado?.sigla)

  const atividade = est.atividade_principal as Record<string, unknown> | undefined
  const socios = Array.isArray(raiz.socios) ? raiz.socios : []

  const partesEnd = [
    [texto(est.tipo_logradouro), texto(est.logradouro)].filter(Boolean).join(' '),
    texto(est.numero),
    texto(est.bairro),
    [municipio, uf].filter(Boolean).join('/'),
    texto(est.cep) ? `CEP ${texto(est.cep)}` : null,
  ].filter((p): p is string => typeof p === 'string' && p.trim() !== '')

  return {
    cnpj,
    razaoSocial: texto(raiz.razao_social),
    nomeFantasia: texto(est.nome_fantasia),
    abertura,
    idadeAnos,
    // o cnpj.ws escreve "Ativa"/"Baixada"; a trava de situação compara em maiúsculo
    situacao: texto(est.situacao_cadastral)?.toUpperCase() ?? null,
    cnae: texto(atividade?.id),
    cnaeDescricao: texto(atividade?.descricao),
    qsaCount: socios.length,
    endereco: partesEnd.length ? partesEnd.join(', ') : null,
    municipio,
    uf,
    cidadeUf: [municipio, uf].filter(Boolean).join('/') || null,
  }
}
