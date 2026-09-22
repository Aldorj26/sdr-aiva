/**
 * vigia/route.ts (AIVA) — item 3 do plano de 18/09/2026 (Aldo)
 *
 * POR QUE EXISTE: em 17/09 uma varredura achou QUATRO defeitos em produção — o
 * status `pending` marcando loja boa como CNPJ irregular, o `desmarcar()` que
 * nunca removeu marcador e mesmo assim reportava sucesso, a cobrança do
 * formulário saindo um dia atrasada e o alerta de senha repetindo todo dia útil.
 * Nenhum deles apareceu sozinho. Todos foram achados porque alguém foi olhar.
 *
 * O sinal que teria pego a maioria é simples: **a automação tem fila e não faz
 * nada**. Este cron pergunta isso a cada rota, todo dia, pelo ?dry (que não
 * envia nem move nada), e grita quando a resposta é estranha:
 *   - HTTP != 200 → a rota está quebrada ou a dependência caiu (o 502 silencioso
 *     da biometria quando o login do portal falhava era exatamente isto)
 *   - fila > 0 e ação = 0 por DIAS_PARA_GRITAR dias seguidos → parou de funcionar
 *
 * A contagem de dias seguidos vive em `sdr_avisos_chave` (chave "vigia:<rota>"),
 * a mesma tabela do alerta de senha sem lead.
 *
 * VIGIA 2 — A META ESTÁ ENTREGANDO? (22/09/2026): a pergunta acima ("a automação
 * fez algo?") respondia OK no dia 22/09 e mesmo assim nada chegava em ninguém.
 * O cartão da conta Meta tinha sido recusado em 21/09 e, sem pagamento válido,
 * ela recusa toda conversa iniciada pela empresa (erro 131042) — a Evo devolvia
 * "success", o wamid era gerado, e 415 disparos + 84 lembretes foram pro vazio
 * por 24h com TODOS os painéis verdes. Por isso a segunda checagem olha o recibo
 * da Meta (clientrcvtime) numa amostra do que saiu hoje. Ela avisa NO MESMO DIA,
 * sem contador de dias seguidos: um dia de entrega zerada já é um dia perdido.
 *
 * Params: ?dry (só mostra o diagnóstico, não avisa ninguém)
 * Schedule (vercel.json): `0 20 * * 1-5` UTC = 17h BRT, seg–sex — depois de todos
 * os outros crons do dia terem rodado. GET obrigatório.
 */
import { NextRequest, NextResponse } from 'next/server'
import { alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { flag } from '@/lib/req-flags'
import { conferirEntregaHoje } from '@/lib/entrega-meta'
import { textoAlerta } from '@/lib/entrega-meta-calc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Quantos dias seguidos de "tem fila e não faz nada" antes de avisar. Um dia só
 *  gera falso positivo demais (fim de semana, feriado, fila que zerou sozinha). */
const DIAS_PARA_GRITAR = 3

/** Cada rota, como ler "tem fila" e "faria algo" do ?dry dela, e quantos dias ela
 *  pode legitimamente ficar quieta com fila cheia.
 *
 *  ⚠️ Essa tolerância não é detalhe: sem ela o vigia gritaria à toa. A biometria
 *  fica parada até 5 dias esperando o toque D+5, e o alerta de senha só reavisa a
 *  cada 7 dias — as duas apareceram como "fila cheia, ação zero" no primeiro dry,
 *  e as duas estavam certas. Vigia que grita errado é pior que vigia nenhum. */
type Alvo = {
  rota: string
  fila: (j: Record<string, unknown>) => number
  acao: (j: Record<string, unknown>) => number
  /** dias de silêncio NORMAL dessa régua; só grita depois disso */
  tolerancia: number
}
const n = (v: unknown) => (typeof v === 'number' ? v : 0)
const ALVOS: Alvo[] = [
  // cobra todo dia útil enquanto houver fila: 3 dias quieta já é estranho
  { rota: 'cobranca-formulario', tolerancia: 3, fila: (j) => n(j.formulario_pendente), acao: (j) => n(j.enviar) + n(j.iniciar) + n(j.esgotar) },
  // toques em D0/D+2/D+5 → pode ficar até 5 dias sem nada a fazer
  { rota: 'biometria', tolerancia: 6, fila: (j) => n(j.leads_em_analise), acao: (j) => n(j.enviar) + n(j.esgotar) },
  // reaviso a cada 7 dias → uma semana quieta é o normal dela
  { rota: 'senha-pendente', tolerancia: 8, fila: (j) => n(j.pendentes_portal), acao: (j) => n(j.avisar) + n(j.resolvidos) },
  // 2 toques com 8 dias entre eles
  { rota: 'retomada-interessado', tolerancia: 9, fila: (j) => n(j.elegiveis), acao: (j) => n(j.enviar) + n(j.encerrar) },
  // rede de segurança: fila 0 é o estado saudável, então nunca grita por silêncio
  { rota: 'fase3-destravada', tolerancia: 999, fila: () => 0, acao: (j) => n(j.ativos) },
  // espelho: fila 0 é NORMAL (tudo espelhado); o que se vigia é ele responder
  { rota: 'espelho-portal', tolerancia: 999, fila: () => 0, acao: (j) => n(j.onboardings) },
]

const BASE = 'https://sdr-aiva.vercel.app/api/sdr'

async function executar(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const segredo = process.env.WEBHOOK_SECRET ?? ''
  if (auth !== `Bearer ${segredo}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dry = flag(new URL(req.url).searchParams, 'dry')

  // Contador de dias seguidos: mora no PRÓPRIO NOME da chave ("vigia:<rota>:<n>"),
  // porque sdr_avisos_chave só tem chave + timestamp. Simples e sem migração nova.
  const { data: memoria } = await supabaseAdmin.from('sdr_avisos_chave').select('chave').like('chave', 'vigia:%')
  const contador = new Map<string, number>()
  for (const m of memoria ?? []) {
    const partes = String(m.chave).split(':')
    if (partes.length === 3) contador.set(partes[1], Number(partes[2]) || 0)
  }

  // ⚠️ ESTA CHECAGEM VEM PRIMEIRO de propósito: o laço de rotas abaixo faz 6
  // chamadas com timeout de 120s cada e a função morre em 300s. Se uma rota
  // travar, o alerta mais urgente do dia ("saiu, foi cobrado e não chegou")
  // precisa já ter saído.
  // ─── VIGIA 2: a Meta entregou o que saiu hoje? ─────────────────────────────
  // Diferente do laço de rotas logo abaixo: lá a pergunta é "a régua parou de
  // agir?", que tolera dias de silêncio antes de gritar. Aqui é "saiu, foi
  // cobrado e não chegou em ninguém" — isso não espera nem um dia.
  let entrega: Awaited<ReturnType<typeof conferirEntregaHoje>> | { estado: string; erro: string }
  try {
    // Teto de 60s: o `post()` do Evo não tem AbortSignal, então uma chamada
    // pendurada esperaria o default do undici (~300s) e mataria o vigia INTEIRO,
    // levando junto os 6 dry das rotas. O veredito vale 60s de espera, não 5 min.
    entrega = await Promise.race([
      conferirEntregaHoje(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('checagem de entrega passou de 60s')), 60_000)),
    ])
  } catch (e) {
    entrega = { estado: 'falhou', erro: String(e).slice(0, 140) }
    console.error('[vigia] checagem de entrega falhou:', e)
  }
  if (!dry && entrega.estado === 'alerta') {
    const v = entrega as Extract<Awaited<ReturnType<typeof conferirEntregaHoje>>, { estado: 'alerta' }>
    const texto = textoAlerta(v, v.enviados_hoje) + (v.exemplos.length ? `\n\nExemplos: ${v.exemplos.join(' · ')}` : '')
    for (const tel of [process.env.ALDO_WHATSAPP, process.env.NEI_WHATSAPP].filter(Boolean) as string[]) {
      try { await alertHuman(tel, texto) } catch (e) { console.error('[vigia] aviso de entrega falhou:', e) }
    }
  }
  // ⚠️ "NÃO CONSEGUI CONFERIR" TAMBÉM É NOTÍCIA. Se só o estado 'alerta' avisasse,
  // esta checagem viraria mais um cron morto e silencioso — exatamente o defeito
  // que este arquivo existe pra impedir (o /followup passou meses devolvendo 405
  // sem ninguém ver). Em dia de volume alto, amostra que não fecha ou Evo fora do
  // ar entram na lista de problemas, com texto mais brando que o do apagão.
  const volumeAlto = 'enviados_hoje' in entrega && (entrega as { enviados_hoje: number }).enviados_hoje >= 100

  const diag: Array<{ rota: string; http: number; fila: number; acao: number; seguidos: number; tolerancia: number; estado: string }> = []
  const problemas: string[] = []
  if (entrega.estado === 'falhou') {
    problemas.push(`• *entrega* — a checagem de entrega quebrou: ${(entrega as { erro: string }).erro}`)
  } else if (volumeAlto && entrega.estado === 'sem_dados') {
    const d = entrega as Awaited<ReturnType<typeof conferirEntregaHoje>>
    problemas.push(
      `• *entrega* — saíram ${d.enviados_hoje} templates hoje e eu NÃO consegui conferir se chegaram ` +
      `(${d.motivo}). Confira na mão antes de disparar de novo.`,
    )
  }

  for (const alvo of ALVOS) {
    let http = 0, fila = 0, acao = 0, estado = 'ok'
    try {
      const r = await fetch(`${BASE}/${alvo.rota}?dry`, { headers: { authorization: `Bearer ${segredo}` }, signal: AbortSignal.timeout(120_000) })
      http = r.status
      if (r.ok) {
        const j = (await r.json()) as Record<string, unknown>
        fila = alvo.fila(j); acao = alvo.acao(j)
        if (alvo.rota === 'espelho-portal' && acao === 0) estado = 'portal sem responder'
      } else {
        estado = `HTTP ${http}`
      }
    } catch (e) {
      estado = `não respondeu (${String(e).slice(0, 60)})`
    }

    const paradaHoje = estado !== 'ok' || (fila > 0 && acao === 0)
    const antes = contador.get(alvo.rota) ?? 0
    const agora = paradaHoje ? antes + 1 : 0
    diag.push({ rota: alvo.rota, http, fila, acao, seguidos: agora, tolerancia: alvo.tolerancia, estado })

    if (!dry) {
      // regrava o contador (chave "vigia:<rota>:<n>"): apaga a antiga e põe a nova
      const antigas = (memoria ?? []).filter((m) => m.chave.startsWith(`vigia:${alvo.rota}`)).map((m) => m.chave)
      if (antigas.length) await supabaseAdmin.from('sdr_avisos_chave').delete().in('chave', antigas)
      if (agora > 0) await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: `vigia:${alvo.rota}:${agora}`, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
    }

    // avisa no dia em que bate o limite DA ROTA — e não todo dia depois disso
    const limite = estado !== 'ok' ? DIAS_PARA_GRITAR : alvo.tolerancia
    if (agora === limite) {
      problemas.push(estado !== 'ok'
        ? `• *${alvo.rota}* — ${estado} (${limite} dias seguidos)`
        : `• *${alvo.rota}* — ${fila} na fila e nenhuma ação há ${limite} dias`)
    }
  }

  if (!dry && problemas.length) {
    // A explicação só vale pros itens que vêm do laço de rotas. O item de
    // entrega tem causa diferente, então o rodapé só aparece quando há item de rota
    // — senão o aviso explicaria a coisa errada.
    const temItemDeRota = problemas.some((p) => !p.startsWith('• *entrega*'))
    const texto =
      `🚨 *ALGO PAROU DE FUNCIONAR*\n\n${problemas.join('\n')}\n\n` +
      (temItemDeRota
        ? `O vigia compara, todo dia, o que cada automação TEM na fila com o que ela FARIA. ` +
          `Fila cheia e ação zero por ${DIAS_PARA_GRITAR} dias seguidos — ou a rota fora do ar.\n`
        : '') +
      `Vale olhar o log do cron no Vercel antes de mexer em qualquer coisa.`
    for (const tel of [process.env.ALDO_WHATSAPP].filter(Boolean) as string[]) {
      try { await alertHuman(tel, texto) } catch (e) { console.error('[vigia] aviso falhou:', e) }
    }
  }

  console.log(`[vigia] ${diag.map((d) => `${d.rota}:${d.estado === 'ok' ? `${d.fila}/${d.acao}` : d.estado}`).join(' · ')} | entrega:${entrega.estado}`)
  return NextResponse.json({ ok: true, dry, dias_para_gritar: DIAS_PARA_GRITAR, diagnostico: diag, entrega, problemas })
}

export const GET = executar
export const POST = executar
