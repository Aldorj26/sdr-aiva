/**
 * lib/entrega-meta-calc.ts — "a Meta está ENTREGANDO o que a gente manda?"
 *
 * POR QUE EXISTE: em 21/09/2026, às 13h BRT, a Meta parou de entregar tudo que
 * iniciava conversa nova. O cartão da conta tinha sido recusado naquele dia e,
 * sem pagamento válido, ela recusa toda conversa iniciada pela empresa (a paga) —
 * erro 131042. Só que NADA disso aparece: a Evo respondia `{"message":"success"}`,
 * a Meta gerava o wamid, o número seguia "Conectado/qualidade Alta", os 13
 * modelos "Ativos", limite de 10.000/dia. 415 disparos e 84 lembretes saíram pro
 * vazio e **ninguém percebeu por 24 horas** — o sinal foi o Aldo estranhar o
 * painel de conversas parado.
 *
 * O recibo existe e é barato de ler: `/int/getChatMessages` devolve o template
 * como `direction: 2` com `clientrcvtime` (a Meta ENTREGOU) e `clientreadtime`
 * (o lojista abriu). Lote saudável dá 87–90% de clientrcvtime; o apagão deu 0/30.
 *
 * Aqui mora só a DECISÃO (pura, testável). O IO — ler sdr_mensagens, achar o
 * chat, chamar a Evo — fica em lib/entrega-meta.ts.
 */

/** Abaixo disso a amostra não diz nada: um dia de 5 envios pode dar 2/5 por acaso. */
export const MIN_AMOSTRA = 12

/** Piso da taxa de entrega. Saudável é 87–90%; 50% é longe demais pra ser azar.
 *  Número baixo de propósito: alarme falso ensina o time a ignorar alerta. */
export const PISO_TAXA = 0.5

/** Recibo só chega segundos depois, mas template mandado agora ainda pode estar
 *  em trânsito. Ignora os últimos 15 min pra não contar pendente como falha. */
export const CARENCIA_MS = 15 * 60_000

export type Veredito =
  | { estado: 'sem_dados'; amostra: number; entregues: number; taxa: null; motivo: string }
  | { estado: 'ok'; amostra: number; entregues: number; taxa: number; motivo: string }
  | { estado: 'alerta'; amostra: number; entregues: number; taxa: number; motivo: string }

/**
 * Decide o que a amostra significa.
 * `amostra` = templates cuja entrega dava pra conferir (tinha chat e a mensagem
 * apareceu lá). `entregues` = quantos tinham clientrcvtime.
 */
export function avaliarEntrega(amostra: number, entregues: number): Veredito {
  if (amostra < MIN_AMOSTRA) {
    return { estado: 'sem_dados', amostra, entregues, taxa: null, motivo: `só ${amostra} envios confiráveis hoje (mínimo ${MIN_AMOSTRA})` }
  }
  const taxa = entregues / amostra
  if (taxa < PISO_TAXA) {
    return { estado: 'alerta', amostra, entregues, taxa, motivo: `${entregues} de ${amostra} entregues (${pct(taxa)})` }
  }
  return { estado: 'ok', amostra, entregues, taxa, motivo: `${entregues} de ${amostra} entregues (${pct(taxa)})` }
}

export const pct = (t: number) => `${Math.round(t * 100)}%`

/** Uma mensagem de template como a Evo devolve (só o que importa pro recibo). */
export type MsgEvo = { direction: number; srvrcvtime?: string | null; clientrcvtime?: string | null }

/**
 * Do histórico de UM chat, o veredito daquele envio.
 * Pega o ÚLTIMO template (direction 2) dentro da janela — reenvio no mesmo dia
 * conta como o envio válido, senão o reenvio bem-sucedido seria contado como falha.
 */
export function entregaDoChat(msgs: MsgEvo[], deISO: string, ateISO: string): 'entregue' | 'nao_entregue' | 'sem_template' {
  const tpls = msgs
    .filter((m) => m.direction === 2 && typeof m.srvrcvtime === 'string' && m.srvrcvtime >= deISO && m.srvrcvtime <= ateISO)
    .sort((a, b) => String(a.srvrcvtime).localeCompare(String(b.srvrcvtime)))
  if (!tpls.length) return 'sem_template'
  // O ÚLTIMO, não "algum". Com `some` o apagão que começa no meio do dia ficava
  // escondido: entregou de manhã + falhou às 15h contaria como entregue, e o dia
  // em que a falha começa é exatamente o dia que importa. O último também resolve
  // o reenvio (falhou de manhã, reenviado à tarde → entregue).
  return tpls[tpls.length - 1].clientrcvtime ? 'entregue' : 'nao_entregue'
}

/** Texto do alerta. Diz onde olhar PRIMEIRO — a fatura — porque foi exatamente
 *  o lugar que ninguém olhou em 21/09 (todos os painéis de qualidade estavam verdes). */
export function textoAlerta(v: Extract<Veredito, { estado: 'alerta' }>, enviadosHoje: number): string {
  return (
    `🚨 *A META NÃO ESTÁ ENTREGANDO OS TEMPLATES*\n\n` +
    `Hoje saíram ${enviadosHoje} templates. Na amostra conferida: *${v.entregues} de ${v.amostra} entregues (${pct(v.taxa)})*.\n` +
    `Lote normal fica entre 87% e 90%.\n\n` +
    `*Olhe nesta ordem:*\n` +
    `1️⃣ Cobrança e pagamentos da Meta — cartão recusado derruba TUDO que inicia conversa ` +
    `(foi o caso em 21/09: erro 131042, 24h de disparo perdido).\n` +
    `2️⃣ WhatsApp Manager → Gerenciar modelos → abrir um modelo → "Mensagens de erro". ` +
    `É o único lugar que mostra o motivo real.\n` +
    `3️⃣ Qualidade/limite do número (se os dois acima estiverem ok).\n\n` +
    `⛔ *Não dispare mais nada até resolver* — sai, é cobrado e não chega em ninguém.`
  )
}
