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
 * Params: ?dry (só mostra o diagnóstico, não avisa ninguém)
 * Schedule (vercel.json): `0 20 * * 1-5` UTC = 17h BRT, seg–sex — depois de todos
 * os outros crons do dia terem rodado. GET obrigatório.
 */
import { NextRequest, NextResponse } from 'next/server'
import { alertHuman } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { flag } from '@/lib/req-flags'

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

  const diag: Array<{ rota: string; http: number; fila: number; acao: number; seguidos: number; tolerancia: number; estado: string }> = []
  const problemas: string[] = []

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
    const texto =
      `🚨 *AUTOMAÇÃO PAROU DE FAZER EFEITO*\n\n${problemas.join('\n')}\n\n` +
      `O vigia compara, todo dia, o que cada automação TEM na fila com o que ela FARIA. ` +
      `Isso aqui é fila cheia e ação zero por ${DIAS_PARA_GRITAR} dias seguidos — ou a rota fora do ar.\n` +
      `Vale olhar o log do cron no Vercel antes de mexer em qualquer coisa.`
    for (const tel of [process.env.ALDO_WHATSAPP].filter(Boolean) as string[]) {
      try { await alertHuman(tel, texto) } catch (e) { console.error('[vigia] aviso falhou:', e) }
    }
  }

  console.log(`[vigia] ${diag.map((d) => `${d.rota}:${d.estado === 'ok' ? `${d.fila}/${d.acao}` : d.estado}`).join(' · ')}`)
  return NextResponse.json({ ok: true, dry, dias_para_gritar: DIAS_PARA_GRITAR, diagnostico: diag, problemas })
}

export const GET = executar
export const POST = executar
