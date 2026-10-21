/**
 * laco-bot-calc.ts — corta o PINGUE-PONGUE entre a VictorIA e o robô de uma loja (Aldo 21/10/2026).
 *
 * Caso: Papo Reto Cell Peças, 21/10 08:06–08:52 BRT — o WhatsApp da loja é um bot (de IA, texto sempre
 * diferente) que responde a TUDO; a VictorIA respondeu 77 vezes em 46 minutos. O detector antigo depende
 * de a própria VictorIA marcar `atendimento_automatico_detectado` (contador [BOT_TROCAS] até 10), e ela
 * não marcou: achou que conversava com gente. Em 06/10 (Papo Reto, 114 respostas/h) e 08/10 (BF Tec
 * Mazza, 42/h, 2 textos distintos) foi igual.
 *
 * Regra determinística, independente do modelo, medida em sdr_mensagens desde 01/10/2026:
 *   - conversa HUMANA mais intensa: 24 respostas da VictorIA em 60 min (Novacell, 06/10);
 *   - laços: 43, 76 e 126 em 60 min corridos (replay 01–21/10: só esses três cortam).
 * Então: ≥ TETO_RESPOSTAS respostas da VictorIA nos últimos 60 min = laço, sem olhar texto. E, pra cortar
 * mais cedo o bot "burro" que repete a mesma frase: ≥ REPETICOES do MESMO texto do lojista na janela.
 *
 * Parte pura (node --test, `npm run test:laco`). Quem lê o banco e aplica é o webhook.
 */

export type MsgJanela = { direcao: 'in' | 'out' | string; conteudo: string | null; template_hsm?: string | null; enviado_em: string }

export const JANELA_MIN = 60
/** Respostas da VictorIA (out sem template) na janela a partir das quais é laço. Humano máximo medido: 24 em 60 min corridos; laços: 43, 76, 126. */
export const TETO_RESPOSTAS = 35
/** Mesmo texto do lojista (normalizado) repetido este tanto na janela = robô. Humano máximo medido: 5. */
export const REPETICOES = 6
/** Pausa gravada no lead quando o laço é cortado numa etapa que não vira BOT_DETECTADO. */
export const PAUSA_HORAS = 24
/** Etapas em que o laço vira BOT_DETECTADO (lead ainda não é cliente): fora delas só pausa. */
export const STATUS_VIRA_BOT: ReadonlySet<string> = new Set(['INICIO', 'SEM_RESPOSTA', 'INTERESSADO', 'AGUARDANDO'])

/** Texto comparável: minúsculas, sem acento, só letras/dígitos, até 80 caracteres. */
export function normalizar(t: string | null | undefined): string {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80)
}

export type Laco = { laco: false; respostas: number; repeticaoMax: number } | { laco: true; motivo: 'teto_respostas' | 'repeticao'; respostas: number; repeticaoMax: number }

export function detectarLaco(msgs: ReadonlyArray<MsgJanela>, agora: number | Date = Date.now()): Laco {
  const t = typeof agora === 'number' ? agora : agora.getTime()
  const desde = t - JANELA_MIN * 60_000
  let respostas = 0
  const rep = new Map<string, number>()
  for (const m of msgs) {
    const em = Date.parse(m.enviado_em)
    if (Number.isNaN(em) || em < desde || em > t) continue
    if (m.direcao === 'out' && !m.template_hsm) respostas++
    if (m.direcao === 'in') {
      const n = normalizar(m.conteudo)
      if (n) rep.set(n, (rep.get(n) ?? 0) + 1)
    }
  }
  const repeticaoMax = Math.max(0, ...rep.values())
  if (respostas >= TETO_RESPOSTAS) return { laco: true, motivo: 'teto_respostas', respostas, repeticaoMax }
  if (repeticaoMax >= REPETICOES) return { laco: true, motivo: 'repeticao', respostas, repeticaoMax }
  return { laco: false, respostas, repeticaoMax }
}

/** Observações do lead depois do corte: marcador do laço + pausa de 24h (trocados, não empilhados). */
export function obsComLaco(obs: string | null | undefined, l: Extract<Laco, { laco: true }>, agora = new Date()): string {
  const base = (obs ?? '').replace(/\s*\[LACO_BOT:[^\]]*\]/g, '').replace(/\s*\[PAUSA_ATE:[^\]]*\]/g, '').trim()
  const ate = new Date(agora.getTime() + PAUSA_HORAS * 3600_000).toISOString()
  return `${base} [LACO_BOT:${l.motivo}:${l.respostas}r:${l.repeticaoMax}x:${agora.toISOString()}] [PAUSA_ATE:${ate}]`.trim()
}

/**
 * Espelho de mensagem nossa vinda pelo webhook (fromMe): é eco/duplicata se o MESMO texto já está entre
 * as saídas dos últimos `minutos`. O dedup antigo olhava só a ÚLTIMA saída em 30 s — com webhooks
 * concorrentes gravou 219 cópias de 12 textos no caso de 21/10.
 */
export function ehSaidaRepetida(texto: string, saidasRecentes: ReadonlyArray<MsgJanela>, agora: number | Date = Date.now(), minutos = 10): boolean {
  const t = typeof agora === 'number' ? agora : agora.getTime()
  const alvo = normalizar(texto)
  if (!alvo) return true
  return saidasRecentes.some((m) => m.direcao === 'out' && t - Date.parse(m.enviado_em) < minutos * 60_000 && normalizar(m.conteudo) === alvo)
}
