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
import { alertHuman } from './evotalks'
import { conferirEntregaHoje } from './entrega-meta'
import { diaBrt } from './retomada-interessado-calc'
import {
  decidirRodada, textoPausa, ehUltimaRodada, textoResumoDia, entregaIndisponivel, marcarResultados,
  TETO_DIA, ROTULO, TETO_TEMPO_MS, LOTE,
  type Entrega, type Resumo, type Decisao, type ResultadoEnvio,
} from './disparo-diario-calc'

/** Timeout de UM lote: 5 envios a ~6 s (até 12 s) cabem folgados; sem isso um fetch
 *  pendurado passaria os 300 s da função e perderia o log e o resumo do dia. */
const TIMEOUT_LOTE_MS = 45_000

export type Estado = { pausado: boolean; motivo: string | null; pausado_em: string | null }

export async function lerEstado(): Promise<Estado> {
  const { data, error } = await supabaseAdmin
    .from('sdr_disparo_estado').select('pausado, motivo, pausado_em').eq('id', 1).maybeSingle()
  if (error) throw new Error(`sdr_disparo_estado: ${error.message}`)
  return { pausado: data?.pausado ?? false, motivo: data?.motivo ?? null, pausado_em: data?.pausado_em ?? null }
}

/** Idempotente: se já está pausado, não mexe em `pausado_em` nem no motivo
 *  (o filtro `pausado = false` faz isso de forma atômica, sem ler antes). */
export async function pausar(motivo: string): Promise<void> {
  const { error } = await supabaseAdmin.from('sdr_disparo_estado')
    .update({ pausado: true, pausado_em: new Date().toISOString(), motivo })
    .eq('id', 1).eq('pausado', false)
  if (error) throw new Error(`sdr_disparo_estado: ${error.message}`)
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

/** Evo fora do ar vira `sem_dados` — nunca derruba nem pausa a rodada. */
async function medirEntrega(): Promise<Entrega> {
  try {
    const { estado, taxa, amostra, entregues, motivo } = await conferirEntregaHoje()
    return { estado, taxa, amostra, entregues, motivo }
  } catch (err) {
    console.error('[disparo-diario] conferirEntregaHoje falhou — seguindo como sem_dados:', err)
    return entregaIndisponivel()
  }
}

/** A foto do dia. `entrega` opcional: a rodada já mediu no começo e não repete a
 *  ida à Evo (~20 s) no fim, quando o relógio da função já está apertado. */
export async function resumoDoDia(agora = Date.now(), entrega?: Entrega): Promise<Resumo> {
  const [estado, saiuHoje, filaPendente, entregaDia] = await Promise.all([
    lerEstado(), contarSaiuHoje(agora), contarFilaPendente(), entrega ?? medirEntrega(),
  ])
  return {
    saiuHoje, restante: Math.max(0, TETO_DIA - saiuHoje), filaPendente, pausado: estado.pausado, entrega: entregaDia,
  }
}

/** Aldo e Nei, cada envio no seu try/catch: um número fora do ar não bloqueia o outro. */
async function avisarTime(texto: string): Promise<void> {
  for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean) as string[]) {
    try {
      const r = await alertHuman(tel, texto)
      if (!r.ok) console.error(`[disparo-diario] aviso não entregue a ${tel}: ${r.error}`)
    } catch (err) {
      console.error(`[disparo-diario] aviso falhou para ${tel}:`, err)
    }
  }
}

type LinhaFila = { id: string; nome: string; telefone: string; cidade: string | null }

/** Manda um lote ao `send-initial`. Qualquer falha devolve [] → o lote inteiro fica PENDENTE. */
async function enviarLote(lote: LinhaFila[]): Promise<ResultadoEnvio[]> {
  const base = process.env.APP_URL ?? 'https://sdr-aiva.vercel.app'
  try {
    const res = await fetch(`${base}/api/sdr/send-initial`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_LOTE_MS),
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
    return Array.isArray(j.resultados) ? j.resultados : []
  } catch (err) {
    console.error('[disparo-diario] lote falhou:', err instanceof Error ? err.message : err)
    return []
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
  const [jaSaiuHoje, filaPendente] = await Promise.all([contarSaiuHoje(agora), contarFilaPendente()])
  const entrega = await medirEntrega()
  const decisao = decidirRodada({ agoraMs: agora, pausado: estado.pausado, jaSaiuHoje, filaPendente, entrega })

  const montar = (extra: { enviados?: number; falhas?: number; cortado?: boolean } = {}): ResultadoRodada => {
    const enviados = extra.enviados ?? 0
    return {
      ok: true,
      acao: decisao.acao,
      motivo: decisao.acao === 'disparar' ? null : decisao.motivo,
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
    await pausar(decisao.motivo)
    await avisarTime(textoPausa(entrega, jaSaiuHoje))
    console.log(`[disparo-diario] PAUSADO: ${decisao.motivo}`)
    return montar()
  }

  let enviados = 0
  let falhas = 0
  let cortado = false
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
      for (let i = 0; i < fila.length; i += LOTE) {
        if (Date.now() - inicio > TETO_TEMPO_MS) { cortado = true; break }
        const lote = fila.slice(i, i + LOTE)
        const marcas = marcarResultados(lote, await enviarLote(lote))
        for (const m of marcas) {
          if (m.status === 'PENDENTE') continue // fica na fila; a próxima rodada reprocessa
          const { error: erroMarca } = await supabaseAdmin.from('sdr_fila_disparo')
            .update(m.status === 'DISPARADO'
              ? { status: 'DISPARADO', disparado_em: new Date().toISOString() }
              : { status: 'ERRO', detalhe: m.detalhe })
            .eq('id', m.id)
          // a mensagem JÁ saiu; falhar em marcar só reaparece como duplicata (barrada pelo send-initial)
          if (erroMarca) console.error(`[disparo-diario] não marcou ${m.id}: ${erroMarca.message}`)
          if (m.status === 'DISPARADO') enviados++; else falhas++
        }
        processados += marcas.length
      }
      // lote que ficou PENDENTE (estouro/HTTP) sem ter sido cortado pelo tempo: não é erro, a próxima rodada continua
      if (!cortado && processados > enviados + falhas) {
        console.log(`[disparo-diario] ${processados - enviados - falhas} ficam PENDENTES pra próxima rodada`)
      }
    }
  }

  console.log(`[disparo-diario] ${decisao.acao}${decisao.acao === 'nada' ? `:${decisao.motivo}` : ''} enviados=${enviados} falhas=${falhas}${cortado ? ' (teto de tempo)' : ''}`)

  // O resumo do dia sai na última rodada, se ela não pausou (pausa já avisou). Reaproveita a
  // entrega medida acima: refazer a ida à Evo aqui comeria o fim dos 300 s.
  if (ehUltimaRodada(agora)) await avisarTime(textoResumoDia(await resumoDoDia(agora, entrega)))

  return montar({ enviados, falhas, cortado })
}
