/**
 * lib/disparo-diario-calc.ts — decisão PURA do disparo D+0 diário da AIVA.
 *
 * Até aqui o lote de 500 saía só com o PC do Aldo ligado e um script rodado na
 * mão. O cron da Vercel passa a chamar a rota de hora em hora e CADA rodada pergunta
 * aqui: "o que faço agora?". Sem IO — a rota lê o estado (pausa, quanto saiu hoje,
 * fila, entrega da Meta) e executa a decisão.
 *
 * Ordem das guardas (os testes fixam): fim de semana → feriado → janela → pausado →
 * fatia ocupada → entrega em alerta → orçamento → fila.
 *
 * A pausa NÃO expira na virada do dia: "só volta quando alguém destravar" (Aldo).
 * Pausa que se limpa à meia-noite seria retomada automática com outro nome.
 */
import { PISO_TAXA, pct } from './entrega-meta-calc.ts'
import { ehFeriado } from './business-time.ts'
import { diaBrt } from './retomada-interessado-calc.ts'

export const TETO_DIA = 500
export const ROTULO = 'aiva_campanha'
/** Janela em horas BRT: roda de `de` (inclusive) até `ate` (exclusive). */
export const JANELA = { de: 8, ate: 19 }
/** A função morre em 300s; parar aos 240s deixa folga pra gravar o log. */
export const TETO_TEMPO_MS = 240_000
export const LOTE = 5
/** O resumo das 18h47 faz 3 consultas ao banco + avisarEquipe (até ~35 s): só começa com folga. */
export const MIN_RESTANTE_RESUMO_MS = 40_000
/** O aviso da pausa automática segura a chave por 30 dias: a chave carrega o `pausado_em`, então uma
 *  pausa NOVA tem chave nova — a janela longa só garante que a MESMA pausa não avise duas vezes. */
export const JANELA_PAUSA_MS = 30 * 24 * 3_600_000

/** Mesma forma do veredito de `lib/entrega-meta-calc.ts`, achatada pra rota. */
export type Entrega = {
  estado: 'ok' | 'alerta' | 'sem_dados'
  taxa: number | null
  amostra: number
  entregues: number
  motivo: string
}

export type Decisao =
  | { acao: 'disparar'; quantidade: number }
  | { acao: 'pausar'; motivo: string }
  | { acao: 'nada'; motivo: MotivoBarato | 'orcamento_gasto' | 'fila_vazia' }

/** Os motivos de `nada` que se decidem SEM consultar nada além do relógio, da pausa e do lock. */
export type MotivoBarato = 'fim_de_semana' | 'feriado' | 'fora_da_janela' | 'pausado' | 'fatia_ocupada'

/** O que `resumoDoDia()` devolve e `textoResumoDia` formata. */
export type Resumo = {
  saiuHoje: number
  restante: number
  filaPendente: number
  pausado: boolean
  entrega: Entrega
}

/** Hora (0-23) e dia da semana no fuso de São Paulo.
 *  ⚠️ Via Intl, nunca `TZ=`: no Git Bash `TZ=America/Sao_Paulo` devolve UTC. */
function relogioBrt(ms: number): { hora: number; minuto: number; diaSemana: string } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date(ms))
  const pega = (t: string) => partes.find(p => p.type === t)?.value ?? ''
  return { hora: Number(pega('hour')), minuto: Number(pega('minute')), diaSemana: pega('weekday') }
}

/** Prefixos das chaves de lock (`sdr_avisos_chave`). O botão "Disparar agora" da página
 *  `/disparos` usa um prefixo PRÓPRIO: a fatia do cron e a do clique são chaves diferentes, então o
 *  clique não espera o cron nem é barrado por ele — mas dois cliques na mesma fatia de 5 min caem na
 *  MESMA chave e o segundo não manda nada (anti duplo clique no celular). */
export const PREFIXO_LOCK_CRON = 'disparo'
export const PREFIXO_LOCK_MANUAL = 'disparo-manual'

/** Chave do lock de fatia: `disparo:<YYYY-MM-DD>T<HH>:<fatia>` com dia e hora em BRT e
 *  `fatia = floor(minuto / 5)`. O cron roda a cada 5 min em :02/:07/:12…:57 (uma rodada por
 *  fatia de 5 min: :07 e :09 → 1, :12 → 2, :57 → 11); duas rodadas na mesma fatia geram a MESMA
 *  chave. Ritmo de 13/10 (Aldo): rodadas de 4 min encostadas, como o script local fazia.
 *  ⚠️ Acoplado ao cron de vercel.json, como `ehUltimaRodada`. */
export function chaveDaFatia(agoraMs: number, prefixo: string = PREFIXO_LOCK_CRON): string {
  const { hora, minuto } = relogioBrt(agoraMs)
  return `${prefixo}:${diaBrt(agoraMs)}T${String(hora).padStart(2, '0')}:${Math.floor(minuto / 5)}`
}

/** As cinco guardas BARATAS, na ordem: fim de semana → feriado → janela → pausado → fatia ocupada.
 *  Devolve o primeiro motivo que pega, ou `null`. Pura e sem custo: o IO chama ANTES de medir a
 *  entrega (Evo, ~20 s), pra rodada que não vai fazer nada não pagar por isso. O IO chama primeiro
 *  com `fatiaOcupada: false` (as quatro guardas do relógio e da pausa, SEM reservar o lock) e só
 *  depois de passar por elas reserva a fatia. `decidirRodada` chama a mesma função, então a ordem
 *  existe num lugar só. */
export function guardaBarata(e: { agoraMs: number; pausado: boolean; fatiaOcupada?: boolean }): MotivoBarato | null {
  const { hora, diaSemana } = relogioBrt(e.agoraMs)
  if (diaSemana === 'Sat' || diaSemana === 'Sun') return 'fim_de_semana'
  if (ehFeriado(diaBrt(e.agoraMs))) return 'feriado'
  if (hora < JANELA.de || hora >= JANELA.ate) return 'fora_da_janela'
  if (e.pausado) return 'pausado'
  // Antes do alerta e do orçamento: rodada duplicada (entrega dupla do cron, curl manual durante
  // o cron) não pode pausar de novo nem mandar as mesmas lojas outra vez. Depois de `pausado`
  // porque "pausado" é o motivo que o operador precisa ver.
  if (e.fatiaOcupada) return 'fatia_ocupada'
  return null
}

export function decidirRodada(e: {
  agoraMs: number
  pausado: boolean
  jaSaiuHoje: number
  filaPendente: number
  entrega: Entrega
  /** Outra rodada já reservou esta fatia de 5 min (ver `chaveDaFatia`). Omitido = livre. */
  fatiaOcupada?: boolean
}): Decisao {
  const barata = guardaBarata(e)
  if (barata) return { acao: 'nada', motivo: barata }
  // sem_dados NÃO bloqueia: de manhã não há envio do dia pra medir, e Evo fora
  // do ar não é prova de bloqueio da Meta. Só o alerta (taxa abaixo do piso) pausa.
  if (e.entrega.estado === 'alerta') {
    return { acao: 'pausar', motivo: diagnosticoDaPausa(e.entrega) }
  }
  const orcamento = TETO_DIA - e.jaSaiuHoje
  if (orcamento <= 0) return { acao: 'nada', motivo: 'orcamento_gasto' }
  if (e.filaPendente <= 0) return { acao: 'nada', motivo: 'fila_vazia' }
  return { acao: 'disparar', quantidade: Math.min(orcamento, e.filaPendente) }
}

/** A linha de diagnóstico da pausa — FONTE ÚNICA do `motivo` gravado em `sdr_disparo_estado`
 *  e do texto do alerta. Parte de `entrega.motivo`, que já diz qual dos dois gatilhos disparou:
 *  "3 de 25 entregues (12%)" (dia abaixo do piso) ou "31 de 40 entregues (78%) no dia, MAS os 10
 *  envios mais recentes: NENHUM entregue" (parou agora). O piso só entra quando o DIA está
 *  abaixo dele; "78% — piso é 30%" parecia bug e convidava a um /retomar reflexo. */
export function diagnosticoDaPausa(entrega: Entrega): string {
  const abaixoDoPiso = entrega.taxa != null && entrega.taxa < PISO_TAXA
  return abaixoDoPiso ? `${entrega.motivo} — piso é ${pct(PISO_TAXA)}.` : `${entrega.motivo}.`
}

/** Começo da amostra de entrega: o MAIOR entre a meia-noite BRT de hoje e o `/retomar` de hoje.
 *  Sem isso, depois do /retomar a rodada seguinte mede as MESMAS mensagens da manhã (nenhum D+0
 *  novo saiu durante a pausa), dá alerta de novo e re-pausa em 20 min — com o operador já tendo
 *  pago a fatura. Retomada de dia anterior ou ilegível não encurta nada. Devolve ISO UTC. */
export function inicioEfetivoDaAmostra(agoraMs: number, retomadoEm: string | null): string {
  const brt = new Date(agoraMs - 3 * 3_600_000)
  const inicioDia = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()) + 3 * 3_600_000
  const retomadoMs = retomadoEm ? Date.parse(retomadoEm) : NaN
  return new Date(Number.isFinite(retomadoMs) && retomadoMs > inicioDia ? retomadoMs : inicioDia).toISOString()
}

/** O aviso que sai na hora, pra Aldo e Nei, quando a rodada pausa.
 *  A fatura vem primeiro DE PROPÓSITO: no apagão de 21/09 a investigação levou horas
 *  olhando qualidade, status e modelos (tudo verde) enquanto a causa era cobrança recusada. */
export function textoPausa(entrega: Entrega, jaSaiuHoje: number): string {
  return [
    '🛑 Disparo AIVA pausado',
    `Entrega: ${diagnosticoDaPausa(entrega)}`,
    `Saíram ${jaSaiuHoje} de ${TETO_DIA} hoje. Não vou disparar mais até alguém destravar.`,
    '',
    'Primeiro: confira a fatura da Meta (foi isso em 21/09).',
    'Depois, responda /retomar aqui.',
  ].join('\n')
}

/** Chave de dedupe do aviso da pausa AUTOMÁTICA: `disparo_pausa:<pausado_em>`. O alerta original e
 *  o lembrete das rodadas seguintes usam a MESMA chave; como `avisarEquipe` só a segura quando pelo
 *  menos um coringa (HSM 48) saiu, a pausa reavisa a cada rodada até um chegar e depois cala. */
export function chaveDaPausa(pausadoEm: string): string {
  return `disparo_pausa:${pausadoEm}`
}

/** Pausa da própria rodada (entrega abaixo do piso) × pausa de gente (`/pausar` grava
 *  "pausado por <telefone> pelo WhatsApp"; o botão da `/disparos` grava `MOTIVO_PAUSA_PAINEL`, com o
 *  mesmo prefixo). Só a automática ganha lembrete: quem pausou na mão sabe.
 *  Motivo ausente = linha antiga, origem desconhecida → não insiste. */
export function ehPausaAutomatica(motivo: string | null): boolean {
  return !!motivo && !motivo.startsWith('pausado por')
}

/** Prefixo do motivo da pausa do breaker (`pausar('send-initial falhou <n>/<m>: <1º erro>')`). */
export const PREFIXO_PAUSA_ENVIO = 'send-initial falhou'
/** Pausa causada pelo envio (Evo/send-initial) em vez da entrega da Meta: o lembrete muda o conselho. */
export function ehPausaPorEnvio(motivo: string | null): boolean {
  return !!motivo && motivo.startsWith(PREFIXO_PAUSA_ENVIO)
}

/** A última rodada do dia manda o resumo. ⚠️ Acoplado ao minuto do cron em vercel.json
 *  (`2,7,12,…,57 11-21 * * 1-5` = 8h02…18h57 BRT, a cada 5 min): são 12 rodadas na hora das 18h,
 *  e só a das 18h57 (minuto ≥ 55) é a última. Mudar os minutos do cron exige mudar este corte. */
export function ehUltimaRodada(agoraMs: number): boolean {
  const { hora, minuto } = relogioBrt(agoraMs)
  return hora === JANELA.ate - 1 && minuto >= 55
}

export function textoResumoDia(r: Resumo): string {
  const medida = r.entrega.taxa == null
    ? 'Entrega do dia: sem medida confiável ainda.'
    : `Entrega do dia: ${pct(r.entrega.taxa)} (${r.entrega.entregues} de ${r.entrega.amostra} confirmados).`
  return [
    `📊 Disparo AIVA — resumo do dia${r.pausado ? ' (PAUSADO)' : ''}`,
    `Saíram ${r.saiuHoje} de ${TETO_DIA}. Restam ${r.restante} no orçamento de hoje.`,
    `Fila: ${r.filaPendente} pendentes.`,
    medida,
  ].join('\n')
}

// --- Teasers: o {{2}} do HSM 48 ("Olá {{1}}, {{2}}") ---------------------------------------------
// O texto longo (textoPausa/textoResumoDia/textoQuebrou) vai por texto livre e a Meta o descarta
// fora da janela de 24 h; o teaser vai pelo coringa, que atravessa a janela. Regra: UMA linha,
// sem quebra de linha nem tab (a Meta rejeita em variável), <= 160 caracteres.

const LIMITE_TEASER = 160
const umaLinha = (s: string): string => s.replace(/\s+/g, ' ').trim()
const semPontoFinal = (s: string): string => s.replace(/[.\s]+$/, '')
/** Corta em `max` caracteres (a reticência conta). */
const cortar = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`)

/** Pausa: o diagnóstico (taxa ou "parou agora") é o miolo; o fim ("responda /retomar") é a única
 *  coisa que o operador precisa fazer, então nunca é cortado. O "saíram N de 500" só entra se couber
 *  (o texto longo já traz), e o diagnóstico só é cortado em último caso (motivos reais ~85 chars). */
export function teaserPausa(entrega: Entrega, jaSaiuHoje: number): string {
  const fim = ' — confira a fatura da Meta e responda /retomar'
  const diag = semPontoFinal(umaLinha(diagnosticoDaPausa(entrega)))
  const comSaida = `🛑 disparo AIVA pausado (saíram ${jaSaiuHoje} de ${TETO_DIA}): ${diag}${fim}`
  if (comSaida.length <= LIMITE_TEASER) return comSaida
  const ini = '🛑 disparo AIVA pausado: '
  return `${ini}${cortar(diag, LIMITE_TEASER - ini.length - fim.length)}${fim}`
}

/** Lembrete da pausa automática, repetido a cada rodada até UM coringa chegar (ver `chaveDaPausa`).
 *  Mesmo desenho do teaser da pausa, mas com o "desde quando" (a pausa pode ter horas) no lugar do
 *  "saíram N de 500"; a ação ("responda /retomar") nunca é cortada, o diagnóstico sim, em último caso. */
export function teaserPausaLembrete(e: { motivo: string | null; pausado_em: string | null }): string {
  const fim = ehPausaPorEnvio(e.motivo) ? ' — confira o Evo e responda /retomar' : ' — confira a fatura da Meta e responda /retomar'
  const ini = `🛑 disparo AIVA segue pausado desde ${quandoBrt(e.pausado_em)}: `
  const diag = semPontoFinal(umaLinha(e.motivo ?? 'motivo não registrado'))
  return `${ini}${cortar(diag, LIMITE_TEASER - ini.length - fim.length)}${fim}`
}

export function teaserResumo(r: Resumo): string {
  return `📊 disparo AIVA: saíram ${r.saiuHoje} de ${TETO_DIA}, fila ${r.filaPendente}${r.pausado ? ' (PAUSADO)' : ''}`
}

/** Rodada que LANÇOU. O motivo é mensagem de erro (pode ter quebra de linha e stack): colapsa e corta em 120. */
export function teaserQuebrou(motivo: string): string {
  return `🚨 disparo AIVA quebrou: ${cortar(umaLinha(motivo), 120)}`
}

/** Chave de dedupe do alerta "rodada quebrou": UMA por hora BRT (`disparo_quebrou:<YYYY-MM-DD>T<HH>`).
 *  Rota que falha a cada 20 min avisa uma vez por hora, não três. */
export function chaveQuebrou(agoraMs: number): string {
  return `disparo_quebrou:${diaBrt(agoraMs)}T${String(relogioBrt(agoraMs).hora).padStart(2, '0')}`
}

/** A versão LONGA do alerta de rodada quebrada (texto livre; o teaser vai pelo coringa).
 *  O erro cru entra cortado em 500 caracteres: mensagem de banco/rede pode vir enorme. */
export function textoQuebrou(msg: string, agoraMs: number): string {
  const { hora, minuto } = relogioBrt(agoraMs)
  const hhmm = `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
  return [
    '🚨 Disparo AIVA: a rodada QUEBROU',
    `Rota: /api/sdr/disparo-diario · ${diaBrt(agoraMs)} ${hhmm} (Brasília)`,
    `Erro: ${cortar(msg.trim(), 500)}`,
    '',
    'Nada foi enviado nesta rodada; a próxima tenta de novo sozinha. Se o erro se repetir, o lote do dia não fecha.',
    'Este aviso sai no máximo 1× por hora. O vigia das 17h também vai cobrar.',
  ].join('\n')
}

/** A versão LONGA do lembrete (texto livre). Diz que é repetição: o aviso original pode ter caído
 *  fora da janela de 24 h do WhatsApp, e é por isso que o time está lendo isto de novo. */
export function textoPausaLembrete(e: { motivo: string | null; pausado_em: string | null }): string {
  return [
    '🛑 Disparo AIVA: continua PAUSADO',
    `Desde ${quandoBrt(e.pausado_em)}: ${e.motivo ?? 'motivo não registrado'}`,
    ehPausaPorEnvio(e.motivo)
      ? 'Pausa automática: o envio (send-initial / Evo) falhou. Repito o aviso porque o primeiro pode não ter chegado.'
      : 'Pausa automática pela entrega da Meta. Repito o aviso porque o primeiro pode não ter chegado.',
    '',
    ...(ehPausaPorEnvio(e.motivo)
      ? ['Primeiro: confira o Evo (chave, instância, fora do ar) e o deploy do send-initial.']
      : ['Primeiro: confira a fatura da Meta (foi isso em 21/09).']),
    'Depois, responda /retomar aqui.',
  ].join('\n')
}

/** O resumo das 18h47 só começa se ainda sobra folga do teto de 240 s da rodada. Sem folga ele
 *  seria cortado pelo relógio da função (300 s) com o disparo já feito; pular custa pouco: o vigia
 *  das 17h do dia seguinte enxerga o dia anterior. */
export function cabeResumo(restanteMs: number): boolean {
  return restanteMs >= MIN_RESTANTE_RESUMO_MS
}

/** "Travou" = a rodada tentou lotes e NENHUM lead chegou ao envio: todos ficaram PENDENTE (HTTP 5xx,
 *  timeout ou resposta sem `resultados` — `marcarResultados` não acha o telefone). Qualquer ERRO por
 *  lead, DUPLICADO ou envio prova que o `send-initial` rodou e respondeu, então não é travamento.
 *  `processados = 0` (cortado pelo tempo, fila vazia) também não: não houve tentativa. */
export function lotesTravados(c: { processados: number; enviados: number; falhas: number; duplicados: number }): boolean {
  return c.processados > 0 && c.enviados === 0 && c.falhas === 0 && c.duplicados === 0
}

/** Chave de dedupe do alerta "lotes travados": UMA por hora BRT (`disparo_travado:<YYYY-MM-DD>T<HH>`). */
export function chaveTravado(agoraMs: number): string {
  return `disparo_travado:${diaBrt(agoraMs)}T${String(relogioBrt(agoraMs).hora).padStart(2, '0')}`
}

/** `n` = leads que ficaram PENDENTES; `erro` = o último erro de HTTP/timeout visto (cortado em 300). */
export function textoTravado(n: number, erro: string | null): string {
  return [
    '🚨 Disparo AIVA: os lotes TRAVARAM',
    `${n} lead(s) ficaram PENDENTES e NENHUM chegou ao envio nesta rodada.`,
    `Último erro: ${erro ? cortar(umaLinha(erro), 300) : 'sem resposta do send-initial'}`,
    '',
    'Nada se perde: os leads seguem na fila e a próxima rodada tenta de novo sozinha.',
    'Se repetir, o lote do dia não fecha. Confira o Evo e o deploy do send-initial. Este aviso sai no máximo 1× por hora.',
  ].join('\n')
}

export function teaserTravado(n: number): string {
  return `🚨 disparo AIVA travado: ${n} lead(s) sem resposta do envio, nenhum saiu nesta rodada`
}

/** Breaker do lote: o `send-initial` cria o lead ANTES de mandar o template, e quando o Evo erra
 *  rápido (5xx, 401 depois de rotação de chave, ou 200 com corpo de erro — que o envio lê como
 *  `numero_sem_whatsapp`) cada lead falha em ~1 s e uma só rodada queimaria o orçamento do dia inteiro
 *  marcando tudo como ERRO. `pifou` = nenhum `ok` E uma de duas:
 *  (1) 3+ erros de ENVIO (nem `bloqueado_*`, nem `numero_sem_whatsapp`); ou
 *  (2) um lote CHEIO (`LOTE` resultados) 100% `numero_sem_whatsapp`, que num lote real é bloqueio e não azar.
 *  `bloqueado_*` é "já está na base": prova de que o send-initial respondeu direito, nunca conta.
 *  `numero_sem_whatsapp` fica fora da regra (1) e a (2) exige lote cheio de propósito: a cauda da fila
 *  (1–4 números mortos) é normal e não pode pausar o dia. */
export function lotePifou(resultados: ResultadoEnvio[]): { pifou: boolean; n: number; erro: string | null } {
  const naoBloqueados = resultados.filter((r) => !r.ok && !(r.erro ?? '').startsWith('bloqueado_'))
  const deEnvio = naoBloqueados.filter((r) => r.erro !== 'numero_sem_whatsapp')
  const algumOk = resultados.some((r) => r.ok)
  const loteCheioSemWhatsapp = resultados.length >= LOTE && resultados.every((r) => !r.ok && r.erro === 'numero_sem_whatsapp')
  const pifou = !algumOk && (deEnvio.length >= 3 || loteCheioSemWhatsapp)
  const primeiro = deEnvio[0] ?? naoBloqueados[0]
  return { pifou, n: naoBloqueados.length, erro: primeiro ? (primeiro.erro ?? 'erro sem detalhe') : null }
}

/** `n` = leads do lote que falharam; `erro` = o primeiro erro (cortado em 300). */
export function textoPifou(n: number, erro: string | null): string {
  return [
    '🛑 Disparo AIVA PAUSADO: o envio falhou no lote inteiro',
    `${n} lead(s) do lote falharam no send-initial e NENHUM saiu. Primeiro erro: ${erro ? cortar(umaLinha(erro), 300) : 'sem detalhe'}`,
    'Os leads do lote voltaram para PENDENTE (nada foi queimado) e o disparo ficou pausado até alguém destravar.',
    '',
    'Primeiro: confira o Evo (chave, instância, fora do ar) e o deploy do send-initial.',
    'Depois, responda /retomar aqui.',
  ].join('\n')
}

export function teaserPifou(n: number): string {
  return `🛑 disparo AIVA pausado: envio falhou em ${n} lead(s) do lote, nenhum saiu — confira o Evo e responda /retomar`
}

/** "12/10 às 11:32" em Brasília. Via Intl (nunca `TZ=`). Vazio/ilegível → "data desconhecida". */
function quandoBrt(iso: string | null): string {
  const ms = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(ms)) return 'data desconhecida'
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const pega = (t: string) => partes.find(p => p.type === t)?.value ?? ''
  return `${pega('day')}/${pega('month')} às ${pega('hour')}:${pega('minute')}`
}

/** Resposta do `/disparo`: onde o dia está e se o robô está solto ou travado. */
export function textoStatusDisparo(r: Resumo & { pausado_em: string | null; motivo: string | null }): string {
  const medida = r.entrega.taxa == null
    ? 'Entrega: ainda não dá pra medir (sem envio confirmado hoje).'
    : `Entrega: ${pct(r.entrega.taxa)} (${r.entrega.entregues} de ${r.entrega.amostra} confirmados).`
  const linhas = [
    r.pausado ? '🛑 Disparo AIVA — PAUSADO' : '✅ Disparo AIVA — ativo',
    `Saíram ${r.saiuHoje} de ${TETO_DIA} hoje. Restam ${r.restante}.`,
    `Fila: ${r.filaPendente} pendentes.`,
    medida,
  ]
  if (r.pausado) {
    linhas.push(`Pausado desde ${quandoBrt(r.pausado_em)}${r.motivo ? ` — ${r.motivo}` : ''}.`)
    linhas.push('Pra voltar a disparar: /retomar')
  }
  return linhas.join('\n')
}

/** `/pausar` quando acabou de pausar. */
export function textoPausadoAgora(): string {
  return [
    '🛑 Disparo AIVA pausado.',
    'Nenhuma rodada vai disparar até alguém responder /retomar.',
  ].join('\n')
}

/** `/pausar` repetido: já estava pausado, então diz o estado real em vez de fingir que pausou agora. */
export function textoJaPausado(e: { pausado_em: string | null; motivo: string | null }): string {
  return [
    '🛑 O disparo já estava pausado — nada mudou.',
    `Desde ${quandoBrt(e.pausado_em)}${e.motivo ? `: ${e.motivo}` : ''}.`,
    'Pra voltar a disparar: /retomar',
  ].join('\n')
}

/** `/retomar`: `estavaPausado` é o retorno de `retomar()`. Repetir o comando cai no `false`. */
export function textoRetomado(estavaPausado: boolean): string {
  return estavaPausado
    ? ['▶️ Disparo AIVA retomado.', 'A próxima rodada agendada volta a disparar.'].join('\n')
    : ['O disparo não estava pausado — nada a retomar.', 'Pra ver o dia: /disparo'].join('\n')
}

/** Evo fora do ar: não dá pra medir, e isso não é bloqueio da Meta → não pausa. */
export function entregaIndisponivel(): Entrega {
  return { estado: 'sem_dados', taxa: null, amostra: 0, entregues: 0, motivo: 'Evo indisponível — entrega não medida' }
}

/** O que o `send-initial` devolve por telefone. */
export type ResultadoEnvio = { telefone: string; ok: boolean; erro?: string }
export type Marca = { id: string; status: 'DISPARADO' | 'DUPLICADO' | 'ERRO' | 'PENDENTE'; detalhe: string | null }

/** Cruza o lote enviado com a resposta do `send-initial` e diz como marcar a fila.
 *  Lead SEM linha na resposta (lote que estourou o tempo, HTTP 5xx, timeout) fica
 *  PENDENTE de propósito: a próxima rodada reprocessa. Se na verdade a mensagem
 *  saiu, o `send-initial` recusa o lead já existente — duplicata não passa. */
export function marcarResultados(lote: Array<{ id: string; telefone: string }>, resultados: ResultadoEnvio[]): Marca[] {
  return lote.map((l): Marca => {
    const r = resultados.find(x => x.telefone === l.telefone)
    if (!r) return { id: l.id, status: 'PENDENTE', detalhe: null }
    if (r.ok) return { id: l.id, status: 'DISPARADO', detalhe: null }
    // `bloqueado_*` = o send-initial recusou porque o telefone JÁ está na base. É também o
    // caminho de recuperação do lote abortado (a mensagem saiu, a resposta se perdeu): o
    // lead não é falha, é DUPLICADO — o mesmo status de scripts/disparar-fila.mjs.
    if (r.erro?.startsWith('bloqueado_')) return { id: l.id, status: 'DUPLICADO', detalhe: r.erro }
    return { id: l.id, status: 'ERRO', detalhe: r.erro ?? 'erro sem detalhe' }
  })
}

/** Folga em que uma chave de trava MANUAL recém-gravada só pode ser do próprio clique que está
 *  perguntando. Veio de 15/10/2026: o primeiro clique em produção gravou a chave da fatia e ao mesmo
 *  tempo recebeu 23505 por ela (duas gravações no mesmo centésimo de segundo, uma só requisição no
 *  log) — e respondeu "já saiu um lote" sem ter mandado nada. Um segundo toque de gente nunca cai
 *  aqui: o botão fica travado enquanto a requisição corre, e a rodada leva ~60 s. */
export const JANELA_LOCK_PROPRIO_MS = 10_000

/** A chave da trava manual que o banco acusou como duplicada é do PRÓPRIO clique em curso?
 *  `ultimoAviso` ausente ou ilegível = não dá pra afirmar que é nossa → trata como de outro clique
 *  (o conservador aqui é recusar). Tolera 1 s de relógio adiantado entre o banco e a função. */
export function lockEhDoProprioClique(ultimoAviso: string | null | undefined, agoraMs: number): boolean {
  if (!ultimoAviso) return false
  const t = Date.parse(ultimoAviso)
  if (Number.isNaN(t)) return false
  const idade = agoraMs - t
  return idade >= -1_000 && idade <= JANELA_LOCK_PROPRIO_MS
}

/** Motivo gravado em `sdr_disparo_estado` quando a pausa vem do botão da página `/disparos`.
 *  ⚠️ COMEÇA com "pausado por" de propósito: é assim que `ehPausaAutomatica` sabe que foi gente
 *  (igual ao `/pausar` do WhatsApp) e as rodadas seguintes não ficam repetindo aviso — quem pausou sabe. */
export const MOTIVO_PAUSA_PAINEL = 'pausado por alguém no painel (/disparos)'

/** A frase que a página `/disparos` mostra depois de um clique. PURA: recebe o resultado achatado da
 *  rodada (os mesmos campos de `ResultadoRodada`) e devolve o que o Aldo lê no celular.
 *  `destravou` = o clique tirou o disparo de uma pausa (o caso do dia 14/10). */
export function textoBotaoDisparo(
  r: { acao: Decisao['acao']; motivo: string | null; enviados: number; falhas: number; saiuHoje: number },
  destravou: boolean
): string {
  const prefixo = destravou ? 'Pausa destravada. ' : ''
  if (r.acao === 'pausar') {
    return `${prefixo}O robô pausou o disparo agora: ${r.motivo ?? 'entrega abaixo do piso'}.`
  }
  if (r.acao === 'nada') {
    const porque: Record<string, string> = {
      fim_de_semana: 'Fim de semana — o disparo só roda de segunda a sexta.',
      feriado: 'Feriado — o disparo não roda hoje.',
      fora_da_janela: `Fora da janela: o disparo roda de ${JANELA.de}h às ${JANELA.ate}h (BRT). Nada foi enviado.`,
      pausado: 'O disparo está pausado — toque em Retomar primeiro.',
      fatia_ocupada: 'Já saiu um lote nos últimos 5 minutos. O cron segue de onde parou.',
      orcamento_gasto: `Teto do dia batido: as ${TETO_DIA} já saíram.`,
      fila_vazia: 'A fila está vazia — não há loja nova pra enviar.',
    }
    return prefixo + (porque[r.motivo ?? ''] ?? `Nada foi enviado (${r.motivo ?? 'sem motivo'}).`)
  }
  if (r.enviados === 0) {
    return `${prefixo}Nenhuma saiu agora${r.falhas ? ` (${r.falhas} falha${r.falhas > 1 ? 's' : ''})` : ''}. O cron tenta de novo em até 5 min.`
  }
  const falhas = r.falhas ? ` ${r.falhas} falha${r.falhas > 1 ? 's' : ''}.` : ''
  return `${prefixo}${r.enviados} loja${r.enviados > 1 ? 's' : ''} saíram agora — ${r.saiuHoje} de ${TETO_DIA} no dia.${falhas} O cron segue com o resto até as ${JANELA.ate}h.`
}
