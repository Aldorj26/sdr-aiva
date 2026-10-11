/**
 * lib/disparo-diario.ts — o IO do disparo D+0 diário da AIVA (a decisão está no -calc).
 *
 * Até 11/10/2026 o lote de 500 saía só com o PC do Aldo ligado e um script rodado na
 * mão. O cron da Vercel chama a rota de hora em hora; CADA rodada lê o estado,
 * pergunta a `decidirRodada` o que fazer e executa. A rota (`app/api/sdr/disparo-diario`)
 * só autentica e chama `rodada()`.
 *
 * Estado da pausa: tabela `sdr_disparo_estado` (uma linha, id = 1, RLS ligada sem
 * policy — só o service_role lê/escreve). A contagem do dia NÃO é guardada em lugar
 * nenhum: deriva de `sdr_mensagens` (rótulo `aiva_campanha`), como a retomada faz.
 *
 * ⚠️ Falha de leitura (estado, contagens) LANÇA em vez de seguir: sem saber se está
 * pausado ou quanto já saiu, disparar às cegas pode estourar o orçamento do dia.
 * Já a medição de entrega, ao falhar, vira `sem_dados` — Evo fora do ar não prova
 * bloqueio da Meta e não pode nem pausar nem matar a rodada.
 */
import { supabaseAdmin } from './supabase'
import { avisarEquipe } from './alerta-equipe'
import { conferirEntregaHoje } from './entrega-meta'
import { diaBrt } from './retomada-interessado-calc'
import {
  decidirRodada, guardaBarata, chaveDaFatia, textoPausa, teaserPausa, inicioEfetivoDaAmostra, ehUltimaRodada, textoResumoDia, teaserResumo, entregaIndisponivel, marcarResultados,
  lotePifou, textoPifou, teaserPifou, PREFIXO_PAUSA_ENVIO,
  chaveDaPausa, ehPausaAutomatica, textoPausaLembrete, teaserPausaLembrete, cabeResumo, lotesTravados, chaveTravado, textoTravado, teaserTravado,
  TETO_DIA, ROTULO, TETO_TEMPO_MS, LOTE, JANELA_PAUSA_MS,
  type Entrega, type Resumo, type Decisao, type ResultadoEnvio,
} from './disparo-diario-calc'

/** O D+0 leva ~10–13 s POR LEAD (medido em produção, 01–09/10/2026): o `send-initial` cria o
 *  lead, abre a oportunidade no Evo e só então manda o template. Lote de 5 = 48–75 s, e 100%
 *  das janelas passaram de 45 s (o timeout fixo de 45 s da 1ª versão abortava todo lote real).
 *  Por isso: (1) só começa lote se restarem ≥ 100 s na rodada (pior caso medido, com folga) e
 *  (2) o timeout do lote é o que sobra até o teto da rodada, no máximo 120 s. */
const MIN_RESTANTE_LOTE_MS = 100_000
const TIMEOUT_LOTE_MAX_MS = 120_000
/** `conferirEntregaHoje` faz até ~40 chamadas à Evo sem timeout próprio: Evo pendurado
 *  queimaria os 300 s da função sem enviar nada. */
const TIMEOUT_ENTREGA_MS = 60_000

export type Estado = { pausado: boolean; motivo: string | null; pausado_em: string | null; retomado_em: string | null }

export async function lerEstado(): Promise<Estado> {
  const { data, error } = await supabaseAdmin
    .from('sdr_disparo_estado').select('pausado, motivo, pausado_em, retomado_em').eq('id', 1).maybeSingle()
  if (error) throw new Error(`sdr_disparo_estado: ${error.message}`)
  return { pausado: data?.pausado ?? false, motivo: data?.motivo ?? null, pausado_em: data?.pausado_em ?? null, retomado_em: data?.retomado_em ?? null }
}

/** Idempotente: se já está pausado, não mexe em `pausado_em` nem no motivo
 *  (o filtro `pausado = false` faz isso de forma atômica, sem ler antes).
 *  Devolve o `pausado_em` VIGENTE: o que acabou de gravar, ou o da pausa que já existia (duas rodadas
 *  pausando juntas ficam com a mesma chave de aviso — ver `chaveDaPausa`). */
export async function pausar(motivo: string): Promise<string> {
  const pausadoEm = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('sdr_disparo_estado')
    .update({ pausado: true, pausado_em: pausadoEm, motivo })
    .eq('id', 1).eq('pausado', false).select('pausado_em')
  if (error) throw new Error(`sdr_disparo_estado: ${error.message}`)
  if (data?.length) return data[0].pausado_em ?? pausadoEm
  return (await lerEstado()).pausado_em ?? pausadoEm
}

/** `false` se já estava ativo (nada a destravar). */
export async function retomar(porTelefone: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('sdr_disparo_estado')
    .update({ pausado: false, retomado_em: new Date().toISOString(), retomado_por: porTelefone })
    .eq('id', 1).eq('pausado', true).select('id')
  if (error) throw new Error(`sdr_disparo_estado: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/** Quanto já saiu hoje (meia-noite de Brasília, não UTC) pelo rótulo da campanha. */
async function contarSaiuHoje(agora: number): Promise<number> {
  const inicioDia = `${diaBrt(agora)}T03:00:00.000Z`
  const { count, error } = await supabaseAdmin.from('sdr_mensagens')
    .select('id', { count: 'exact', head: true })
    .eq('direcao', 'out').eq('template_hsm', ROTULO).gte('enviado_em', inicioDia)
  if (error) throw new Error(`sdr_mensagens: ${error.message}`)
  return count ?? 0
}

async function contarFilaPendente(): Promise<number> {
  const { count, error } = await supabaseAdmin.from('sdr_fila_disparo')
    .select('id', { count: 'exact', head: true }).eq('status', 'PENDENTE')
  if (error) throw new Error(`sdr_fila_disparo: ${error.message}`)
  return count ?? 0
}

/** Reserva a fatia de 20 min desta rodada em `sdr_avisos_chave` (PK `chave`): o `insert` simples
 *  falha com 23505 se outra rodada da mesma fatia já passou. `true` = ocupada. Qualquer outro
 *  erro LANÇA: sem saber se a fatia é nossa, mandar às cegas é o duplicado que o lock evita. */
async function fatiaJaOcupada(agora: number): Promise<boolean> {
  const { error } = await supabaseAdmin.from('sdr_avisos_chave')
    .insert({ chave: chaveDaFatia(agora), ultimo_aviso: new Date().toISOString() })
  if (!error) return false
  if (error.code === '23505') return true
  throw new Error(`sdr_avisos_chave: ${error.message}`)
}

/** Evo fora do ar OU pendurado (timeout de 60 s) vira `sem_dados` — nunca derruba nem pausa a rodada.
 *  `retomadoEm`: depois de um /retomar de HOJE a amostra começa nele (ver `inicioEfetivoDaAmostra`),
 *  senão a rodada re-mede os envios que causaram a pausa e re-pausa na hora. */
async function medirEntrega(agora: number, retomadoEm: string | null): Promise<Entrega> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<Entrega>((resolve) => {
    timer = setTimeout(() => {
      console.error(`[disparo-diario] conferirEntregaHoje: timeout de ${TIMEOUT_ENTREGA_MS / 1000}s — seguindo como sem_dados`)
      resolve(entregaIndisponivel())
    }, TIMEOUT_ENTREGA_MS)
  })
  const medir = conferirEntregaHoje(new Date(agora), inicioEfetivoDaAmostra(agora, retomadoEm)).then(({ estado, taxa, amostra, entregues, motivo }): Entrega => ({ estado, taxa, amostra, entregues, motivo }))
  try {
    return await Promise.race([medir, timeout])
  } catch (err) {
    console.error('[disparo-diario] conferirEntregaHoje falhou — seguindo como sem_dados:', err)
    return entregaIndisponivel()
  } finally {
    clearTimeout(timer)
  }
}

/** A foto do dia. `entrega` opcional: a rodada já mediu no começo e não repete a
 *  ida à Evo (~20 s) no fim, quando o relógio da função já está apertado. */
export async function resumoDoDia(agora = Date.now(), entrega?: Entrega): Promise<Resumo> {
  const estadoP = lerEstado()
  const [estado, saiuHoje, filaPendente, entregaDia] = await Promise.all([
    estadoP, contarSaiuHoje(agora), contarFilaPendente(),
    entrega ?? estadoP.then((e) => medirEntrega(agora, e.retomado_em)),
  ])
  return {
    saiuHoje, restante: Math.max(0, TETO_DIA - saiuHoje), filaPendente, pausado: estado.pausado, entrega: entregaDia,
  }
}

/** Pausa, resumo e travamento saem por DOIS caminhos (ver lib/alerta-equipe): o texto longo livre e o
 *  teaser pelo coringa HSM 48, que atravessa a janela de 24 h. Aldo e Nei em paralelo, 20 s cada.
 *  `opts.chaveDedupe`: só segura a chave se ao menos um coringa saiu — sem isso o aviso é refeito. */
async function avisarTime(texto: string, teaser: string, opts?: { chaveDedupe: string; janelaMs: number }): Promise<void> {
  const { enviados, falhas } = await avisarEquipe(texto, teaser, opts)
  if (falhas) console.error(`[disparo-diario] aviso à equipe: ${enviados} entregue(s), ${falhas} falha(s)`)
}

type LinhaFila = { id: string; nome: string; telefone: string; cidade: string | null }

/** Manda um lote ao `send-initial`. Qualquer falha devolve `resultados: []` → o lote inteiro fica
 *  PENDENTE, e `erro` diz por quê (vai no alerta de travamento: ver `lotesTravados`). */
async function enviarLote(lote: LinhaFila[], timeoutMs: number): Promise<{ resultados: ResultadoEnvio[]; erro: string | null }> {
  const base = process.env.APP_URL ?? 'https://sdr-aiva.vercel.app'
  try {
    const res = await fetch(`${base}/api/sdr/send-initial`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      // nome aparado no 1º separador (os nomes do Maps vêm com sufixo de
      // marketing: "RT Iphones - Loja de Celulares - IPhone - Xiaomi...") — igual a scripts/disparar-fila.mjs
      body: JSON.stringify({
        leads: lote.map((l) => ({
          nome: String(l.nome).split(/\s*[|–—-]\s+/)[0].slice(0, 48).trim() || l.nome,
          telefone: l.telefone, cidade: l.cidade ?? undefined,
        })),
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) console.error(`[disparo-diario] send-initial HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`)
    const resultados: ResultadoEnvio[] = Array.isArray(j.resultados) ? j.resultados : []
    return { resultados, erro: resultados.length ? null : (res.ok ? 'send-initial respondeu sem resultados' : `send-initial HTTP ${res.status}`) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[disparo-diario] lote falhou:', msg)
    return { resultados: [], erro: msg }
  }
}

/** Pausa AUTOMÁTICA que continua de pé: repete o aviso a cada rodada até um coringa (HSM 48) chegar.
 *  O aviso original (no momento da pausa) e este usam a mesma chave `disparo_pausa:<pausado_em>`, e o
 *  `avisarEquipe` só a segura quando um coringa saiu — então isto É o retry: uma rodada com a chave
 *  solta tenta de novo, com a chave segura não faz nada. Pausa manual (`/pausar`) não é lembrada.
 *  O lock de fatia evita que uma rodada duplicada mande o lembrete duas vezes. Nunca lança: é
 *  conforto sobre uma rodada que já ia devolver "nada", e erro de banco aqui não vira "quebrou". */
async function lembrarPausaAutomatica(estado: Estado, agora: number): Promise<void> {
  if (!ehPausaAutomatica(estado.motivo)) return
  if (!estado.pausado_em) { console.warn('[disparo-diario] pausa automática sem pausado_em — sem chave pro lembrete'); return }
  try {
    if (await fatiaJaOcupada(agora)) return
    await avisarTime(textoPausaLembrete(estado), teaserPausaLembrete(estado), { chaveDedupe: chaveDaPausa(estado.pausado_em), janelaMs: JANELA_PAUSA_MS })
  } catch (err) {
    console.error('[disparo-diario] lembrete da pausa falhou:', err instanceof Error ? err.message : err)
  }
}

export type ResultadoRodada = {
  ok: true
  acao: Decisao['acao']
  motivo: string | null
  enviados: number
  falhas: number
  saiu_hoje: number
  restante: number
  fila_pendente: number
  entrega: { estado: Entrega['estado']; taxa: number | null; amostra: number }
  cortado_por_tempo: boolean
}

/** Uma rodada: lê estado → conta o dia e a fila → mede a entrega → decide → executa.
 *  `dry` passa pela MESMA decisão e não envia nem grava nada (dry que diverge mente).
 *  `qtd` limita a rodada manual, nunca acima do que a decisão permite (o restante do dia). */
export async function rodada(opts: { dry?: boolean; qtd?: number | null; agora?: number } = {}): Promise<ResultadoRodada> {
  const agora = opts.agora ?? Date.now()
  const inicio = Date.now()

  const estado = await lerEstado()

  // Ordem (F4): estado → guardas do relógio e da pausa → SÓ ENTÃO o lock de fatia. O lock é uma
  // escrita em `sdr_avisos_chave`; rodada que vai responder "nada" (pausado, feriado, fim de semana,
  // fora da janela) não tem por que gravar nada nem arriscar um erro de banco nessa escrita. Também
  // lê as contagens ANTES do lock: leitura que lança não deixa uma fatia reservada sem rodada.
  // As contagens são REAIS mesmo quando a guarda pega (duas consultas ao Supabase, custo nulo): o
  // vigia das 17h precisa enxergar uma pausa que atravessa dias — fila cheia + zero envios alarma.
  const barata = guardaBarata({ agoraMs: agora, pausado: estado.pausado, fatiaOcupada: false })
  const [jaSaiuHoje, filaPendente] = await Promise.all([contarSaiuHoje(agora), contarFilaPendente()])
  const devolverNada = (motivo: string): ResultadoRodada => {
    console.log(`[disparo-diario] nada:${motivo} enviados=0 falhas=0`)
    const e = entregaIndisponivel()
    return {
      ok: true, acao: 'nada', motivo, enviados: 0, falhas: 0,
      saiu_hoje: jaSaiuHoje, restante: Math.max(0, TETO_DIA - jaSaiuHoje), fila_pendente: filaPendente,
      entrega: { estado: e.estado, taxa: e.taxa, amostra: e.amostra }, cortado_por_tempo: false,
    }
  }
  // Guardas baratas NÃO medem a Evo (~20 s) e NÃO mandam resumo do dia (nem às 18h47: duplicata ou
  // feriado mandaria um "Saíram 0 de 500" que parece dia quebrado).
  if (barata) {
    if (barata === 'pausado' && !opts.dry) await lembrarPausaAutomatica(estado, agora)
    return devolverNada(barata)
  }

  // Lock de fatia. `?dry` NUNCA reserva a chave (um ensaio não pode bloquear a rodada real que vem
  // depois) e por isso não enxerga duplicidade.
  const fatiaOcupada = opts.dry ? false : await fatiaJaOcupada(agora)
  if (fatiaOcupada) return devolverNada('fatia_ocupada')

  // Só agora mede a entrega e decide com todas as guardas (a função pura continua completa).
  const entrega = await medirEntrega(agora, estado.retomado_em)
  const decisao = decidirRodada({ agoraMs: agora, pausado: estado.pausado, jaSaiuHoje, filaPendente, entrega, fatiaOcupada })

  const montar = (extra: { enviados?: number; falhas?: number; cortado?: boolean; motivo?: string } = {}): ResultadoRodada => {
    const enviados = extra.enviados ?? 0
    return {
      ok: true,
      acao: decisao.acao,
      motivo: extra.motivo ?? (decisao.acao === 'disparar' ? null : decisao.motivo),
      enviados, falhas: extra.falhas ?? 0,
      saiu_hoje: jaSaiuHoje + enviados,
      restante: Math.max(0, TETO_DIA - jaSaiuHoje - enviados),
      fila_pendente: Math.max(0, filaPendente - enviados),
      entrega: { estado: entrega.estado, taxa: entrega.taxa, amostra: entrega.amostra },
      cortado_por_tempo: extra.cortado ?? false,
    }
  }

  if (opts.dry) return montar()

  if (decisao.acao === 'pausar') {
    const pausadoEm = await pausar(decisao.motivo)
    // Chave amarrada a ESTA pausa: se nenhum coringa chegar, as rodadas seguintes repetem o aviso
    // (`lembrarPausaAutomatica`) até um chegar; depois disso a chave segura e a pausa fica calada.
    await avisarTime(textoPausa(entrega, jaSaiuHoje), teaserPausa(entrega, jaSaiuHoje), { chaveDedupe: chaveDaPausa(pausadoEm), janelaMs: JANELA_PAUSA_MS })
    console.log(`[disparo-diario] PAUSADO: ${decisao.motivo}`)
    return montar()
  }

  let enviados = 0
  let falhas = 0
  let cortado = false
  let pifou = false // breaker: lote inteiro falhou por lead → pausa, alerta e a rodada para (C1)
  if (decisao.acao === 'disparar') {
    const quantidade = Math.min(decisao.quantidade, opts.qtd == null ? Infinity : Math.max(0, opts.qtd))
    if (quantidade > 0) {
      // mesma ordem de scripts/disparar-fila.mjs: mais avaliados no Maps primeiro
      const { data, error } = await supabaseAdmin.from('sdr_fila_disparo')
        .select('id, nome, telefone, cidade')
        .eq('status', 'PENDENTE')
        .order('avaliacoes', { ascending: false, nullsFirst: false })
        .order('criado_em', { ascending: true })
        .limit(quantidade)
      if (error) throw new Error(`sdr_fila_disparo: ${error.message}`)
      const fila = (data ?? []) as LinhaFila[]

      let processados = 0
      let duplicados = 0
      let ultimoErroLote: string | null = null
      for (let i = 0; i < fila.length; i += LOTE) {
        const restanteMs = TETO_TEMPO_MS - (Date.now() - inicio)
        if (restanteMs < MIN_RESTANTE_LOTE_MS) { cortado = true; break }
        const lote = fila.slice(i, i + LOTE)
        const { resultados, erro: erroLote } = await enviarLote(lote, Math.min(TIMEOUT_LOTE_MAX_MS, restanteMs))
        if (erroLote) ultimoErroLote = erroLote
        // Breaker (C1): lote em que NENHUM lead saiu e os erros são do envio (Evo 5xx/401/200-com-erro),
        // não de cada número. Falha transitória não pode queimar a fila: o que era ERRO volta a PENDENTE
        // (com o 1º erro no `detalhe`); só o `bloqueado_*` (já está na base) segue DUPLICADO.
        const quebra = lotePifou(resultados)
        const marcas = marcarResultados(lote, resultados).map((m) =>
          quebra.pifou && m.status === 'ERRO' ? { ...m, status: 'PENDENTE' as const, detalhe: quebra.erro } : m)
        for (const m of marcas) {
          if (m.status === 'PENDENTE' && m.detalhe == null) continue // sem resposta: fica na fila, a próxima rodada reprocessa
          const { error: erroMarca } = await supabaseAdmin.from('sdr_fila_disparo')
            .update(m.status === 'DISPARADO'
              ? { status: 'DISPARADO', disparado_em: new Date().toISOString() }
              : { status: m.status, detalhe: m.detalhe })
            .eq('id', m.id).eq('status', 'PENDENTE') // guarda: nunca sobrescreve linha que alguém tirou da fila durante a rodada
          // a mensagem JÁ saiu; falhar em marcar só reaparece como duplicata (barrada pelo send-initial)
          if (erroMarca) console.error(`[disparo-diario] não marcou ${m.id}: ${erroMarca.message}`)
          if (m.status === 'DISPARADO') enviados++
          else if (m.status === 'DUPLICADO') duplicados++ // já está na base: não é falha
          else if (m.status === 'ERRO') falhas++
        }
        processados += marcas.length
        if (quebra.pifou) {
          pifou = true
          cortado = true
          const motivoPausa = `${PREFIXO_PAUSA_ENVIO} ${quebra.n}/${lote.length}: ${(quebra.erro ?? 'sem detalhe').replace(/\s+/g, ' ').slice(0, 200)}`
          console.error(`[disparo-diario] BREAKER: ${motivoPausa} — pausando`)
          // Mesma chave da pausa (`chaveDaPausa`): o aviso é UM só, tentado de novo pelo lembrete das rodadas
          // seguintes até um coringa chegar, e depois cala (não duplica com o lembrete).
          const pausadoEm = await pausar(motivoPausa) // idempotente
          await avisarTime(textoPifou(quebra.n, quebra.erro), teaserPifou(quebra.n), { chaveDedupe: chaveDaPausa(pausadoEm), janelaMs: JANELA_PAUSA_MS })
          break
        }
      }
      // lote que ficou PENDENTE (estouro/HTTP) sem ter sido cortado pelo tempo: não é erro, a próxima rodada continua
      const pendentes = processados - enviados - falhas - duplicados
      if (duplicados) console.log(`[disparo-diario] ${duplicados} já estavam na base (DUPLICADO)`)
      if (!cortado && pendentes > 0) console.log(`[disparo-diario] ${pendentes} ficam PENDENTES pra próxima rodada`)

      // Lotes tentados e NENHUM lead chegou ao envio (HTTP 5xx/timeout em todos): a rodada devolve 200
      // com enviados=0, e sem isto o time só descobriria às 17h pelo vigia. Uma vez por hora BRT; a
      // chave só fica presa se um coringa saiu (avisarEquipe), então um alerta perdido tenta de novo.
      if (!pifou && lotesTravados({ processados, enviados, falhas, duplicados })) {
        console.error(`[disparo-diario] TRAVADO: ${processados} lead(s) tentados, nenhum chegou ao envio (${ultimoErroLote ?? 'sem erro'})`)
        await avisarTime(textoTravado(processados, ultimoErroLote), teaserTravado(processados), { chaveDedupe: chaveTravado(agora), janelaMs: 3_600_000 })
      }
    }
  }

  console.log(`[disparo-diario] ${decisao.acao}${decisao.acao === 'nada' ? `:${decisao.motivo}` : ''} enviados=${enviados} falhas=${falhas}${cortado ? ' (teto de tempo)' : ''}`)

  // O resumo do dia sai na última rodada, se ela não pausou (pausa já avisou). Reaproveita a
  // entrega medida acima: refazer a ida à Evo aqui comeria o fim dos 300 s.
  // ⚠️ O resumo é conforto: os lotes JÁ saíram e foram marcados. Se ele falhar (banco, Evo) não pode
  // devolver 500 nem disparar o "quebrou" — por isso o try/catch próprio, que só registra. E só
  // começa com folga (≥ 40 s do teto de 240 s): sem folga o watchdog da rota o cortaria no meio;
  // o vigia das 17h do dia seguinte cobre o buraco.
  if (ehUltimaRodada(agora) && !pifou) { // pifou: a rodada acabou de pausar e avisar, o resumo repetiria
    const sobraMs = TETO_TEMPO_MS - (Date.now() - inicio)
    if (!cabeResumo(sobraMs)) {
      console.warn(`[disparo-diario] resumo do dia pulado: só ${Math.round(sobraMs / 1000)}s de folga no teto da rodada`)
    } else {
      try {
        const resumo = await resumoDoDia(agora, entrega)
        await avisarTime(textoResumoDia(resumo), teaserResumo(resumo))
      } catch (err) {
        console.error('[disparo-diario] resumo do dia falhou (lotes já enviados, rodada segue ok):', err instanceof Error ? err.message : err)
      }
    }
  }

  return montar({ enviados, falhas, cortado, ...(pifou ? { motivo: 'send_initial_falhou' } : {}) })
}
