/**
 * Senha do lojista pendente na AIVA — parte PURA.
 *
 * O portal registra em `login_sends` quando o acesso foi SOLICITADO
 * (permission_requested_at) e quando a senha foi ENVIADA (credentials_sent_at).
 * Em 16/09/2026 havia 25 lojas com pedido feito e senha nunca enviada — a mais
 * antiga de 19/08. Ninguém olhava isso: o lojista some e a loja não opera.
 *
 * Regra (prazo do Edu/AIVA, 14/09): a senha sai em até 2 dias. Passou de 2 dias
 * ÚTEIS sem envio → avisa o time; segue pendente → reavisa a cada 7 dias, sem
 * spam. Quando a senha finalmente sai, o marcador é limpo.
 *
 * Marcadores em observacoes do lead:
 *   [SENHA_PENDENTE_DESDE:ISO]   pedido feito nessa data e ainda sem senha
 *   [SENHA_PENDENTE_AVISO:ISO]   último aviso ao time
 */

export const DIAS_UTEIS_PRAZO = 2
export const DIAS_REAVISO = 7
const DIA_MS = 24 * 60 * 60 * 1000

/** Dias úteis (seg–sex, horário de Brasília) inteiros entre dois instantes. Não considera feriado. */
export function diasUteisEntre(deMs: number, ateMs: number): number {
  if (ateMs <= deMs) return 0
  const diaBrt = (ms: number) => { const d = new Date(ms - 3 * 60 * 60 * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) }
  let cursor = diaBrt(deMs)
  const fim = diaBrt(ateMs)
  let uteis = 0
  while (cursor < fim) {
    cursor += DIA_MS
    const dow = new Date(cursor).getUTCDay()
    if (dow !== 0 && dow !== 6) uteis++
  }
  return uteis
}

export type Estado = { pedidoMs: number; avisoMs: number | null }
export type Decisao = { acao: 'avisar' | 'reavisar' | 'nada'; diasUteis: number }

export function decidir(e: Estado, agora = Date.now()): Decisao {
  const diasUteis = diasUteisEntre(e.pedidoMs, agora)
  if (diasUteis < DIAS_UTEIS_PRAZO) return { acao: 'nada', diasUteis }
  if (e.avisoMs == null) return { acao: 'avisar', diasUteis }
  if (agora - e.avisoMs >= DIAS_REAVISO * DIA_MS) return { acao: 'reavisar', diasUteis }
  return { acao: 'nada', diasUteis }
}

export const lerPendenteDesde = (obs: string | null | undefined): number | null => {
  const iso = (obs ?? '').match(/\[SENHA_PENDENTE_DESDE:([^\]]+)\]/)?.[1]
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : null
}
export const lerUltimoAviso = (obs: string | null | undefined): number | null => {
  const iso = (obs ?? '').match(/\[SENHA_PENDENTE_AVISO:([^\]]+)\]/)?.[1]
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : null
}

/** Grava/atualiza os marcadores sem duplicar. `limpar` remove os dois (senha chegou). */
export function remontarObs(obs: string | null | undefined, patch: { desde?: string; aviso?: string; limpar?: boolean }): string {
  let base = (obs ?? '')
    .replace(/\s*\[SENHA_PENDENTE_DESDE:[^\]]*\]/g, '')
    .replace(/\s*\[SENHA_PENDENTE_AVISO:[^\]]*\]/g, '')
    .trim()
  if (patch.limpar) return base
  if (patch.desde) base = `${base} [SENHA_PENDENTE_DESDE:${patch.desde}]`.trim()
  if (patch.aviso) base = `${base} [SENHA_PENDENTE_AVISO:${patch.aviso}]`.trim()
  return base.trim()
}

/** Linha do digest ao time. */
export function linhaAlerta(x: { loja: string; telefone: string | null; cnpj: string | null; rid: string; diasUteis: number; pedidoBrt: string }): string {
  const contato = x.telefone && !x.telefone.startsWith('000') ? ` (${x.telefone})` : ''
  return `• ${x.loja}${contato} — pedido em ${x.pedidoBrt}, ${x.diasUteis} dia(s) útil(eis) sem senha · RID ${x.rid}${x.cnpj ? ` · CNPJ ${x.cnpj}` : ''}`
}
