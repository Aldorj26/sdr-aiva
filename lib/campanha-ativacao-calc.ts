/**
 * Campanha de ativação das lojas novas — 4 primeiras semanas no Flexfone (Aldo 09/10/2026).
 *
 * Regras (campanha da AIVA, paga junto do repasse):
 *   Semana 1: 30 consultas → R$ 80
 *   Semana 2: mais 30 consultas → R$ 80
 *   Semana 3: mais 30 consultas e 2 vendas ACUMULADAS desde a semana 1 → R$ 80
 *   Semana 4: mais 30 consultas e 6 vendas ACUMULADAS nas 4 semanas → R$ 80
 *   Fechou as 4 (120 consultas + 6 vendas): o total vira R$ 500 (as 4 × R$ 80 + R$ 180 de bônus).
 * A semana 1 começa no PRIMEIRO ACESSO da loja (portal). Quem teve o primeiro acesso em outubro antes do
 * lançamento começa no dia do lançamento.
 *
 * Fonte dos números: aiva_portal_diario — retrato diário (6h BRT) com o ACUMULADO DO MÊS por loja. O retrato
 * do dia D conta a atividade até a véspera; então a atividade de [a, b) = acumulado(retrato de b) − acumulado(retrato de a).
 */

export const LANCAMENTO = '2026-10-09'
export const PRIMEIRO_ACESSO_DESDE = '2026-10-01'
export const META_CONSULTAS = 30
export const VENDAS_ACUMULADAS: Record<number, number> = { 1: 0, 2: 0, 3: 2, 4: 6 }
export const PREMIO_SEMANA = 80
export const PREMIO_TOTAL = 500
export const SEMANAS = 4
const DIA = 86_400_000

/** Linha do retrato diário (acumulado do mês daquela loja). */
export interface Retrato { data_ref: string; retailer_id: string; mes: string; consultas: number; vendas: number }

export const somaDias = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DIA).toISOString().slice(0, 10)

/** Início da campanha da loja: o primeiro acesso, ou o lançamento pra quem entrou antes dele. */
export function inicioCampanha(primeiroAcessoEm: string | null | undefined): string | null {
  if (!primeiroAcessoEm) return null
  const dia = new Date(Date.parse(primeiroAcessoEm) - 3 * 3600_000).toISOString().slice(0, 10) // data BRT
  if (dia < PRIMEIRO_ACESSO_DESDE) return null
  return dia < LANCAMENTO ? LANCAMENTO : dia
}

/** Acumulado (consultas, vendas) até o retrato de `dia`: soma, por loja e mês, o último retrato <= dia. */
export function acumuladoAte(serie: Retrato[], dia: string): { consultas: number; vendas: number } {
  const ultimo = new Map<string, Retrato>()
  for (const r of serie) {
    if (r.data_ref > dia) continue
    const k = `${r.retailer_id}|${r.mes}`
    const u = ultimo.get(k)
    if (!u || r.data_ref > u.data_ref) ultimo.set(k, r)
  }
  let consultas = 0, vendas = 0
  for (const r of ultimo.values()) { consultas += Number(r.consultas) || 0; vendas += Number(r.vendas) || 0 }
  return { consultas, vendas }
}

export interface Semana {
  n: number; de: string; ate: string // [de, ate)
  consultas: number; vendasAcum: number
  metaVendas: number; batida: boolean; fechada: boolean
}

export interface Progresso {
  inicio: string; hoje: string
  semanaAtual: number // 1..4; 5 = campanha terminou
  diaDaSemana: number // 1..7 dentro da semana atual
  semanas: Semana[]
  consultasTotal: number; vendasTotal: number
  premioGarantido: number // R$ das semanas fechadas e batidas (+ bônus se fechou tudo)
  completa: boolean
}

/** `hoje` = data do retrato mais recente usado (o retrato de hoje conta até ontem). */
export function progresso(inicio: string, serie: Retrato[], hoje: string): Progresso {
  const base = acumuladoAte(serie, inicio)
  const semanas: Semana[] = []
  let consultasTotal = 0
  for (let n = 1; n <= SEMANAS; n++) {
    const de = somaDias(inicio, 7 * (n - 1)), ate = somaDias(inicio, 7 * n)
    const fechada = hoje >= ate
    const corte = fechada ? ate : hoje
    const a = acumuladoAte(serie, de), b = acumuladoAte(serie, corte)
    const consultas = hoje > de ? Math.max(0, b.consultas - a.consultas) : 0
    const vendasAcum = hoje > inicio ? Math.max(0, b.vendas - base.vendas) : 0
    consultasTotal += consultas
    const metaVendas = VENDAS_ACUMULADAS[n]
    semanas.push({ n, de, ate, consultas, vendasAcum, metaVendas, batida: consultas >= META_CONSULTAS && vendasAcum >= metaVendas, fechada })
  }
  const dias = Math.floor((Date.parse(hoje + 'T12:00:00Z') - Date.parse(inicio + 'T12:00:00Z')) / DIA)
  const semanaAtual = Math.min(SEMANAS + 1, Math.floor(Math.max(0, dias) / 7) + 1)
  const fechadasBatidas = semanas.filter((s) => s.fechada && s.batida).length
  const completa = semanas.every((s) => s.fechada && s.batida)
  const fim = acumuladoAte(serie, semanas[SEMANAS - 1].fechada ? semanas[SEMANAS - 1].ate : hoje)
  return {
    inicio, hoje, semanaAtual, diaDaSemana: (Math.max(0, dias) % 7) + 1, semanas,
    consultasTotal, vendasTotal: Math.max(0, fim.vendas - base.vendas),
    premioGarantido: completa ? PREMIO_TOTAL : fechadasBatidas * PREMIO_SEMANA, completa,
  }
}

// ─── Mensagens ───────────────────────────────────────────────────────────────────────────────────
// Uma por evento, cada uma UMA vez (marcador [CAMP_ATIV_MSG:<tipo>]). {{2}} do HSM 48 = UMA linha.
export type TipoMsg = 'boas_vindas' | `meio_s${number}` | `fim_s${number}`

function metaTexto(n: number): string {
  const v = VENDAS_ACUMULADAS[n]
  return v ? `${META_CONSULTAS} consultas e ${v} vendas somando desde a semana 1` : `${META_CONSULTAS} consultas`
}

/** Próxima mensagem devida (ou null). `enviadas` = tipos já mandados. Ordem: boas-vindas (só na semana 1) →
 *  resultado da semana que fechou → parcial no dia 4+ da semana atual se a meta ainda não bateu. */
export function proximaMensagem(p: Progresso, enviadas: Set<string>): TipoMsg | null {
  if (!enviadas.has('boas_vindas') && p.semanaAtual <= 1) return 'boas_vindas'
  // resultado da semana MAIS RECENTE que fechou (as anteriores perdidas não são repostas)
  const fechadas = p.semanas.filter((s) => s.fechada)
  const ultimaFechada = fechadas[fechadas.length - 1]
  if (ultimaFechada) {
    const t = `fim_s${ultimaFechada.n}` as TipoMsg
    if (!enviadas.has(t)) return t
  }
  if (p.semanaAtual > SEMANAS) return null
  const s = p.semanas[p.semanaAtual - 1]
  const t = `meio_s${s.n}` as TipoMsg
  if (p.diaDaSemana >= 4 && !s.batida && !enviadas.has(t)) return t
  return null
}

export function textoMensagem(tipo: TipoMsg, p: Progresso): string {
  if (tipo === 'boas_vindas') {
    return `sua loja entrou na campanha de boas-vindas da AIVA 🎁 Nas suas 4 primeiras semanas no Flexfone, cada semana que bater a meta vale R$ ${PREMIO_SEMANA}: semana 1 e 2 = ${META_CONSULTAS} consultas cada; semana 3 = ${META_CONSULTAS} consultas e 2 vendas somadas desde o início; semana 4 = ${META_CONSULTAS} consultas e 6 vendas somadas. Fechando tudo (120 consultas e 6 vendas), o prêmio total vira R$ ${PREMIO_TOTAL}, pago pela AIVA junto do repasse. A sua semana 1 vai até ${fmt(somaDias(p.inicio, 6))}. Dica: consulte o CPF de todo cliente que pedir preço — cada consulta conta!`
  }
  const n = Number(tipo.replace(/\D/g, ''))
  const s = p.semanas[n - 1]
  if (tipo.startsWith('meio_s')) {
    const faltaC = Math.max(0, META_CONSULTAS - s.consultas)
    const faltaV = Math.max(0, s.metaVendas - s.vendasAcum)
    const falta = [faltaC ? `${faltaC} consultas` : '', faltaV ? `${faltaV} venda${faltaV > 1 ? 's' : ''}` : ''].filter(Boolean).join(' e ')
    return `passando o placar da campanha de boas-vindas 📊 Semana ${n}: você está com ${s.consultas} de ${META_CONSULTAS} consultas${s.metaVendas ? ` e ${s.vendasAcum} de ${s.metaVendas} vendas somadas` : ''}. Faltam ${falta} até ${fmt(somaDias(s.ate, -1))} pra garantir mais R$ ${PREMIO_SEMANA}. Consulte o CPF de todo cliente que pedir preço, até de quem diz que vai pagar à vista!`
  }
  // fim_sN
  const prox = n < SEMANAS ? p.semanas[n] : null
  const garantido = p.premioGarantido
  if (n === SEMANAS) {
    return p.completa
      ? `campanha de boas-vindas concluída 🏆 Você fechou as 4 semanas: ${p.consultasTotal} consultas e ${p.vendasTotal} vendas — prêmio de R$ ${PREMIO_TOTAL}, pago pela AIVA junto do repasse. Parabéns pelo começo forte!`
      : `a campanha de boas-vindas terminou 🙌 Na semana 4 você fez ${s.consultas} consultas e chegou a ${s.vendasAcum} vendas somadas. Prêmio garantido nas 4 semanas: R$ ${garantido}, pago pela AIVA junto do repasse. Agora é manter o ritmo: consultar o CPF de todo cliente é o que faz a loja vender.`
  }
  const abertura = s.batida
    ? `semana ${n} da campanha batida ✅ ${s.consultas} consultas${s.metaVendas ? ` e ${s.vendasAcum} vendas somadas` : ''} — mais R$ ${PREMIO_SEMANA} garantidos (total até agora: R$ ${garantido}).`
    : `a semana ${n} da campanha fechou com ${s.consultas} de ${META_CONSULTAS} consultas${s.metaVendas ? ` e ${s.vendasAcum} de ${s.metaVendas} vendas` : ''} — dessa vez não deu, mas a campanha continua.`
  return `${abertura} Semana ${n + 1} começou e vai até ${fmt(somaDias(prox!.ate, -1))}: a meta é ${metaTexto(n + 1)} pra ganhar mais R$ ${PREMIO_SEMANA}. Bora!`
}

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

// ─── Marcadores no lead ──────────────────────────────────────────────────────────────────────────
// [CAMP_ATIV:<inicio>] — a loja está na campanha (o webhook mostra o placar pra VictorIA)
// [CAMP_ATIV_PLACAR:s=<n>|c=<consultas da semana>|v=<vendas acum>|g=<R$ garantido>|ct=<consultas total>|d=<retrato>]
// [CAMP_ATIV_MSG:<tipo>:<ISO>] — mensagem já enviada
export function lerMarcas(obs: string | null | undefined) {
  const o = obs ?? ''
  const inicio = o.match(/\[CAMP_ATIV:(\d{4}-\d{2}-\d{2})\]/)?.[1] ?? null
  const enviadas = new Set([...o.matchAll(/\[CAMP_ATIV_MSG:([a-z_0-9]+):/g)].map((m) => m[1]))
  const ultimaMsg = Math.max(0, ...[...o.matchAll(/\[CAMP_ATIV_MSG:[a-z_0-9]+:([^\]]+)\]/g)].map((m) => Date.parse(m[1]) || 0))
  return { inicio, enviadas, ultimaMsg: ultimaMsg || null }
}

export function placarMarcador(p: Progresso): string {
  const s = p.semanas[Math.min(p.semanaAtual, SEMANAS) - 1]
  return `[CAMP_ATIV_PLACAR:s=${Math.min(p.semanaAtual, SEMANAS)}|c=${s.consultas}|v=${s.vendasAcum}|g=${p.premioGarantido}|ct=${p.consultasTotal}|fim=${p.semanaAtual > SEMANAS ? 1 : 0}|d=${p.hoje}]`
}

export function remontarObs(obs: string | null | undefined, inicio: string, p: Progresso, msg: TipoMsg | null, agora: Date): string {
  let o = (obs ?? '').replace(/\s*\[CAMP_ATIV_PLACAR:[^\]]*\]/g, '').trim()
  if (!o.includes('[CAMP_ATIV:')) o = `${o} [CAMP_ATIV:${inicio}]`.trim()
  o = `${o} ${placarMarcador(p)}`
  if (msg) o = `${o} [CAMP_ATIV_MSG:${msg}:${agora.toISOString()}]`
  return o.trim()
}

/** Bloco dinâmico pra VictorIA (lido do marcador — sem consultar o portal no turno). */
export function blocoPromptCampanha(obs: string | null | undefined, hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)): string | null {
  const o = obs ?? ''
  const inicio = o.match(/\[CAMP_ATIV:(\d{4}-\d{2}-\d{2})\]/)?.[1]
  if (!inicio) return null
  const m = o.match(/\[CAMP_ATIV_PLACAR:s=(\d+)\|c=(\d+)\|v=(\d+)\|g=(\d+)\|ct=(\d+)\|fim=(\d)\|d=([\d-]+)\]/)
  // some 14 dias depois do fim da campanha (contado por HOJE — o placar para de ser atualizado no dia 35)
  if (hoje > somaDias(inicio, 28 + 14)) return null
  const encerrada = (m && m[6] === '1') || hoje >= somaDias(inicio, 28)
  const n = m ? Number(m[1]) : 1
  if (encerrada) {
    return `[INSTRUÇÃO DO SISTEMA — CAMPANHA DE BOAS-VINDAS]\n🎁 CAMPANHA DE BOAS-VINDAS DA AIVA — ESTA LOJA PARTICIPOU (ENCERRADA em ${fmt(somaDias(inicio, 27))}).${m ? ` Prêmio garantido: R$ ${m[4]}, pago pela AIVA junto do repasse.` : ''}\nNão use mais a campanha como argumento. Só responda se ele perguntar; dúvida de valor ou pagamento → acionar_humano = true, motivo_humano = "duvida_campanha_boas_vindas".\n[FIM INSTRUÇÃO DO SISTEMA]`
  }
  const placar = m
    ? `Placar (dados do portal até ${fmt(m[7])}, atualiza 1× por dia): semana ${n} de 4 (vai até ${fmt(somaDias(inicio, 7 * n - 1))}) — ${m[2]} de ${META_CONSULTAS} consultas${VENDAS_ACUMULADAS[n] ? `, ${m[3]} de ${VENDAS_ACUMULADAS[n]} vendas somadas desde o início` : ''}. Prêmio já garantido: R$ ${m[4]}. Consultas no total: ${m[5]}.`
    : 'Placar ainda não calculado (sai na próxima atualização diária).'
  return `[INSTRUÇÃO DO SISTEMA — CAMPANHA DE BOAS-VINDAS]
🎁 CAMPANHA DE BOAS-VINDAS DA AIVA — ESTA LOJA ESTÁ PARTICIPANDO (começou em ${fmt(inicio)}).
Regras (seção 🎁 do prompt): semanas 1 e 2 = ${META_CONSULTAS} consultas cada; semana 3 = ${META_CONSULTAS} consultas + 2 vendas somadas desde a semana 1; semana 4 = ${META_CONSULTAS} consultas + 6 vendas somadas. Cada semana batida = R$ ${PREMIO_SEMANA}; fechando tudo o total vira R$ ${PREMIO_TOTAL} (não soma com os R$ ${PREMIO_SEMANA}). Paga pela AIVA junto do repasse — NÃO é a comissão de R$ 10 por venda.
${placar}
Pra campanha use SÓ este placar (a semana da campanha não é a do bloco de números da loja). Use quando ele perguntar da campanha ou ao dar dica de vendas. ⛔ Não prometa prêmio de semana que ainda não fechou, não invente regra, data de pagamento ou exceção — dúvida que não está aqui: acionar_humano = true, motivo_humano = "duvida_campanha_boas_vindas".
[FIM INSTRUÇÃO DO SISTEMA]`
}
