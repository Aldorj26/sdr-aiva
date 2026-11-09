/**
 * frescor-portal-calc.ts — "o DADO chegou?", não "a ROTA respondeu?" (09/11/2026).
 *
 * POR QUE EXISTE: a coleta do portal AIVA (`/api/cron/portal-aiva`, 6h BRT) parou de gravar em
 * 26/10/2026 — o portal desligou o login por e-mail e senha e passou a devolver
 * `HTTP 422 email_provider_disabled`. Ficou 14 DIAS parada sem ninguém saber, com o vigia das 17h
 * rodando normalmente todo dia: ele pergunta "a automação tem fila e não faz nada?" a cada ROTA,
 * e a coleta do portal nem está na lista de rotas dele. O estrago foi silencioso e duplo —
 * a conferência de comissão de outubro ficou cega nos últimos dias do mês (a prova de venda é o
 * retrato do portal) e as dicas semanais seguiram mandando número congelado pro lojista.
 *
 * A lição: rota respondendo não é dado chegando. Uma coleta pode responder 200, logar bonito e não
 * gravar nada — ou, como aqui, falhar todo dia e avisar por um caminho que não chega. Então o sinal
 * aqui não é a rota: é a IDADE DA LINHA MAIS NOVA no banco.
 *
 * DUAS PERGUNTAS, duas fontes:
 *   1. `aiva_portal_diario` — o retrato diário. A coleta roda às 6h BRT e rotula o retrato com
 *      `data_ref = ontem` (ver cabeçalho de app/api/cron/portal-aiva/route.ts). Então, em qualquer
 *      hora de um dia saudável, o `data_ref` mais recente É ONTEM. Mais velho que ontem = parou.
 *   2. `aiva_desempenho` — o agregado mensal, que é o que o painel e as dicas leem. Mês corrente sem
 *      NENHUMA linha depois do dia 2 = o mês novo nunca foi derivado (em 09/11 `mes = 2026-11`
 *      não existia). Por que o dia 2: no dia 1º o retrato ainda é do mês passado (a coleta usa
 *      `mesDe(ontem)`), então a primeira linha do mês novo só nasce na rodada do dia 2.
 *
 * Regra pura de propósito: a suíte (`npm run test:frescor`) prende a aritmética de datas e os
 * textos, sem precisar do banco.
 *
 * E A CAUSA TEM NOME: `diagnosticarLoginPortal` (no fim do arquivo) mora aqui porque é a outra
 * metade da mesma história. O portal recusou o login com
 * `HTTP 422 {"error_code":"email_provider_disabled"}` e a coleta subiu isso como
 * `login do portal recusado: HTTP 422 ...` — um erro genérico, indistinguível de portal fora do ar,
 * que ninguém leu. Falha de ACESSO não se conserta com deploy nem passa sozinha: tem de dizer, em
 * português, que a coleta está parada até alguém arrumar o acesso.
 */

/** Dia 1º: retrato ainda é do mês passado. Dia 2: primeira rodada que deriva o mês novo.
 *  Só a partir do dia 3 a ausência do mês corrente é defeito, nunca calendário. */
export const DIA_LIMITE_MES_CORRENTE = 2

/** Quantos dias de retrato velho as DICAS aceitam antes de se recusarem a falar com o lojista.
 *  Mais folgado que o do vigia de propósito: o vigia tem de gritar no dia em que quebra (1 dia de
 *  atraso já é sinal), mas um retrato de anteontem ainda é honesto num texto que diz "esta semana".
 *  Acima disso a dica mente — e mente feio: com o retrato de 26/10 congelado, uma loja que vendeu
 *  em novembro cai em `parou`/`sem_uso` e recebe "por que você parou de vender?". */
export const DIAS_RETRATO_ACEITO_DICAS = 3

const utc = (d: string) => new Date(d + 'T00:00:00Z')
const DIA_MS = 86_400_000

/** Dias inteiros de `de` até `ate` (ambos YYYY-MM-DD). Negativo se `ate` vier antes. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((utc(ate).getTime() - utc(de).getTime()) / DIA_MS)
}

/** 26/10/2026 — como o Aldo lê data no WhatsApp. */
export function dataBr(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

export type EntradaFrescor = {
  /** Hoje em BRT (YYYY-MM-DD) — `hojeBrt()` de lib/portal-aiva. */
  hoje: string
  /** `max(data_ref)` de aiva_portal_diario; null = tabela vazia. */
  ultimoRetrato: string | null
  /** Existe pelo menos uma linha em aiva_desempenho com `mes` = mês corrente (YYYY-MM)? */
  temMesCorrente: boolean
}

export type Frescor = EntradaFrescor & {
  ok: boolean
  /** Dias desde o último retrato até hoje. Saudável = 1 (retrato de ontem). null = tabela vazia. */
  diasParados: number | null
  retratoVelho: boolean
  mesCorrenteFaltando: boolean
  mesCorrente: string
  /** Linhas prontas pro alerta, no formato do vigia (`• *rota* — ...`). Vazio = tudo fresco. */
  problemas: string[]
}

export function avaliarFrescor(e: EntradaFrescor): Frescor {
  const ontem = (() => { const d = utc(e.hoje); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })()
  const mesCorrente = e.hoje.slice(0, 7)
  const diasParados = e.ultimoRetrato ? diasEntre(e.ultimoRetrato, e.hoje) : null
  const retratoVelho = e.ultimoRetrato === null || e.ultimoRetrato < ontem
  const diaDoMes = Number(e.hoje.slice(8, 10))
  const mesCorrenteFaltando = diaDoMes > DIA_LIMITE_MES_CORRENTE && !e.temMesCorrente

  const problemas: string[] = []
  if (e.ultimoRetrato === null) {
    problemas.push('• *portal-aiva* — `aiva_portal_diario` está VAZIA: nenhum retrato do portal foi gravado.')
  } else if (retratoVelho) {
    problemas.push(
      `• *portal-aiva* — a coleta do portal PAROU: o retrato mais novo é de ${dataBr(e.ultimoRetrato)} ` +
      `(${diasParados} dias atrás; o normal é ser de ontem). A conferência de comissão e as dicas de ` +
      'desempenho estão rodando com dado congelado.',
    )
  }
  if (mesCorrenteFaltando) {
    problemas.push(
      `• *portal-aiva* — \`aiva_desempenho\` não tem NENHUMA linha de ${mesCorrente} e hoje é dia ${diaDoMes}: ` +
      'o mês corrente está invisível pro painel, pras dicas e pro bloco de números da VictorIA.',
    )
  }
  return { ...e, ok: problemas.length === 0, diasParados, retratoVelho, mesCorrenteFaltando, mesCorrente, problemas }
}

/** Uma linha (coringa HSM 48, {{2}}): sem \n e <= 160 caracteres, como os outros teasers do repo. */
export function teaserFrescor(f: Frescor): string {
  const miolo = f.ultimoRetrato === null
    ? 'nenhum retrato gravado'
    : f.retratoVelho
      ? `retrato parado em ${dataBr(f.ultimoRetrato)} (${f.diasParados}d)`
      : `sem linha de ${f.mesCorrente} em aiva_desempenho`
  return `🚨 coleta do portal AIVA parada: ${miolo} — comissão e dicas com dado congelado`.replace(/\s+/g, ' ').slice(0, 160)
}

/** As dicas podem falar com o lojista? Retrato ausente ou velho demais = não. */
export function retratoUsavelParaDicas(
  hoje: string,
  ultimoRetrato: string | null,
  limite = DIAS_RETRATO_ACEITO_DICAS,
): { ok: true; dias: number } | { ok: false; dias: number | null; motivo: string } {
  if (ultimoRetrato === null) return { ok: false, dias: null, motivo: 'sem_retrato_do_portal' }
  const dias = diasEntre(ultimoRetrato, hoje)
  if (dias > limite) return { ok: false, dias, motivo: 'retrato_velho' }
  return { ok: true, dias }
}


// ─── A CAUSA TEM NOME: o login do portal ──────────────────────────────────────

/** HTTPs em que `/auth/v1/token` está dizendo "essa credencial não serve/não vale mais" — e não
 *  "estou fora do ar". 429 e 5xx ficam de fora de propósito: esses passam sozinhos. */
const HTTP_DE_ACESSO = new Set([400, 401, 403, 404, 422])

/** Falha de CREDENCIAL/ACESSO do portal: a coleta não volta sozinha e nenhum deploy resolve.
 *  Classe própria pra quem chama poder tratar diferente de "portal fora do ar" sem casar texto. */
export class FalhaAcessoPortal extends Error {
  readonly httpStatus: number
  readonly codigo: string | null
  constructor(mensagem: string, httpStatus: number, codigo: string | null) {
    super(mensagem)
    this.name = 'FalhaAcessoPortal'
    this.httpStatus = httpStatus
    this.codigo = codigo
  }
}

/** Nunca deixar e-mail do login vazar pra log/WhatsApp, mesmo que o portal passe a ecoá-lo. */
const semEmail = (s: string) => s.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<e-mail oculto>')

/** Lê o corpo de erro do portal e devolve `{ codigo, msg }` sem explodir em corpo não-JSON. */
export function lerErroDoPortal(corpo: string): { codigo: string | null; msg: string } {
  let codigo: string | null = null
  let msg = ''
  try {
    const j = JSON.parse(corpo) as Record<string, unknown>
    const cod = j.error_code ?? j.error ?? j.code
    if (typeof cod === 'string' && cod.trim()) codigo = cod.trim()
    for (const k of ['msg', 'message', 'error_description', 'error']) {
      const v = j[k]
      if (typeof v === 'string' && v.trim()) { msg = v.trim(); break }
    }
  } catch {
    // corpo não-JSON (HTML de proxy, texto solto): segue com o trecho cru
  }
  return { codigo, msg: semEmail(msg || corpo.replace(/\s+/g, ' ').trim()).slice(0, 160) }
}

/**
 * Transforma o `!res.ok` do login do portal num erro COM NOME.
 * - `email_provider_disabled` (o caso de 26/10/2026) e qualquer 4xx de auth → `FalhaAcessoPortal`,
 *   com texto que diz o que mudou e que a coleta está parada até alguém agir.
 * - 429 / 5xx / rede → `Error` comum: portal fora do ar passa sozinho, não é acesso.
 */
export function diagnosticarLoginPortal(status: number, corpo: string): Error {
  const { codigo, msg } = lerErroDoPortal(corpo)
  const sufixo = `HTTP ${status}${codigo ? ` ${codigo}` : ''}${msg ? ` — ${msg}` : ''}`
  if (codigo === 'email_provider_disabled') {
    return new FalhaAcessoPortal(
      'ACESSO AO PORTAL AIVA: o portal DESLIGOU o login por e-mail e senha ' +
      `(${sufixo}). A coleta diária está PARADA e só volta com uma forma de acesso nova ` +
      '(chave de API ou outro método liberado pela AIVA) — não é defeito de código e nenhum deploy resolve.',
      status, codigo,
    )
  }
  if (HTTP_DE_ACESSO.has(status)) {
    return new FalhaAcessoPortal(
      `ACESSO AO PORTAL AIVA: o portal recusou a credencial da coleta (${sufixo}). ` +
      'A coleta diária está PARADA até alguém conferir o acesso — portal fora do ar devolveria 5xx, ' +
      'este é "essa credencial não serve".',
      status, codigo,
    )
  }
  return new Error(`portal AIVA fora do ar no login: ${sufixo}`)
}
