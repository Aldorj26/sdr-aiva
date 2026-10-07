/**
 * Loja com senha enviada e que NUNCA ACESSOU a ferramenta (Karol/AIVA, 07/10/2026) — parte pura.
 *
 * A AIVA expôs `primeiro_acesso_em` e a coluna `primeiro_acesso` no quadro. Em 07/10 eram 71 lojas criadas pela Track
 * sem nenhum acesso (36 já com senha enviada; 11 das 14 criadas em outubro). A régua:
 *   - coluna `pronto_para_operar` (senha enviada) há 2+ dias úteis e sem primeiro acesso → toque 1 (HSM 48);
 *   - 3 dias corridos depois, ainda sem acesso → toque 2;
 *   - 2 dias depois do toque 2, ainda sem acesso → aviso no painel do Atendimento pro Nei ligar ([ACESSO_ESGOTADO]).
 * Quando o acesso aparece, os marcadores saem (a rota limpa) e o aviso do painel fecha.
 * Marcadores no lead: [ACESSO_COBRANCA:<n>:<ISO>] e [ACESSO_ESGOTADO:<ISO>].
 */
import { diasUteisEntre } from './senha-pendente-calc.ts'

export const ROTULO = 'aiva_acesso_pendente'
export const CONVERSA_VIVA_HORAS = 48
const DIA = 86_400_000

export type Marcas = { n: number; ultima: number | null; esgotado: boolean; optout: boolean; pausaAte: number | null }

export function lerMarcas(obs: string | null | undefined): Marcas {
  const o = obs ?? ''
  const m = o.match(/\[ACESSO_COBRANCA:(\d+):([^\]]+)\]/)
  const pausa = o.match(/\[PAUSA_ATE:([^\]]+)\]/)?.[1]
  return {
    n: m ? Number(m[1]) : 0,
    ultima: m ? Date.parse(m[2]) || null : null,
    esgotado: o.includes('[ACESSO_ESGOTADO'),
    optout: /\[(ACESSO_OPTOUT|CONSULTORIA_OPTOUT|DICAS_OPTOUT)/.test(o),
    pausaAte: pausa ? Date.parse(pausa) || null : null,
  }
}

export type Decisao = { acao: 'toque'; toque: 1 | 2 } | { acao: 'esgotar' } | { acao: 'nada'; motivo: string }

/** `desde` = board_column_since da coluna pronto_para_operar (null em cadastro antigo = já venceu o prazo). */
export function decidir(m: Marcas, desde: number | null, ultimaFalaLojista: number | null, agora: number): Decisao {
  if (m.optout) return { acao: 'nada', motivo: 'optout' }
  if (m.esgotado) return { acao: 'nada', motivo: 'esgotado' }
  if (m.pausaAte && m.pausaAte > agora) return { acao: 'nada', motivo: 'pausa' }
  if (ultimaFalaLojista && agora - ultimaFalaLojista < CONVERSA_VIVA_HORAS * 3600_000) return { acao: 'nada', motivo: 'conversa_viva' }
  if (m.n === 0) {
    if (desde != null && diasUteisEntre(desde, agora) < 2) return { acao: 'nada', motivo: 'aguardando_2_dias_uteis' }
    return { acao: 'toque', toque: 1 }
  }
  const desdeUltima = m.ultima ? agora - m.ultima : Infinity
  if (m.n === 1) return desdeUltima >= 3 * DIA ? { acao: 'toque', toque: 2 } : { acao: 'nada', motivo: 'aguardando_toque_2' }
  return desdeUltima >= 2 * DIA ? { acao: 'esgotar' } : { acao: 'nada', motivo: 'aguardando_esgotar' }
}

/** {{2}} do HSM 48 ("Olá {{1}}, {{2}}") — UMA linha: a Meta recusa quebra de linha em variável. */
export function texto(toque: 1 | 2): string {
  return toque === 1
    ? 'passando pra saber se você já conseguiu entrar na AIVA 🙂 O login e a senha vêm pelo WhatsApp do número +55 21 4020-2024, e o acesso é em https://vendas.flexfone.com.br/login. Se não achou a mensagem ou travou em algum passo, me responde aqui que eu te ajudo!'
    : 'vi que o acesso da sua loja na AIVA ainda não foi usado. Quer uma ajuda pra entrar? Se a senha não chegou ou ficou em outro número, me avisa aqui que eu resolvo com você.'
}

export function remontarObs(obs: string | null | undefined, n: number, agora: Date): string {
  const limpo = (obs ?? '').replace(/\s*\[ACESSO_COBRANCA:[^\]]*\]/g, '').trim()
  return `${limpo} [ACESSO_COBRANCA:${n}:${agora.toISOString()}]`.trim()
}

/** Tira os marcadores da régua (o lojista acessou). Devolve null se não havia nada pra tirar. */
export function limparMarcas(obs: string | null | undefined): string | null {
  const o = obs ?? ''
  const limpo = o.replace(/\s*\[(ACESSO_COBRANCA|ACESSO_ESGOTADO):[^\]]*\]/g, '').trim()
  return limpo === o.trim() ? null : limpo
}
