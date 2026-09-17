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

/** Cada rota e como ler "tem fila" e "faria algo" da resposta do ?dry dela. */
type Alvo = { rota: string; fila: (j: Record<string, unknown>) => number; acao: (j: Record<string, unknown>) => number }
const n = (v: unknown) => (typeof v === 'number' ? v : 0)
const ALVOS: Alvo[] = [
  { rota: 'cobranca-formulario', fila: (j) => n(j.formulario_pendente), acao: (j) => n(j.enviar) + n(j.iniciar) + n(j.esgotar) },
  { rota: 'biometria', fila: (j) => n(j.leads_em_analise), acao: (j) => n(j.enviar) + n(j.esgotar) },
  { rota: 'senha-pendente', fila: (j) => n(j.pendentes_portal), acao: (j) => n(j.avisar) + n(j.resolvidos) },
  { rota: 'retomada-interessado', fila: (j) => n(j.elegiveis), acao: (j) => n(j.enviar) + n(j.encerrar) },
  { rota: 'fase3-destravada', fila: (j) => n(j.ativos), acao: (j) => n(j.presos) },
  // o espelho é diferente: fila 0 é o estado NORMAL (tudo espelhado). Aqui a gente
  // vigia só se ele responde e se o login do portal está de pé.
  { rota: 'espelho-portal', fila: () => 0, acao: (j) => n(j.onboardings) },
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

  const diag: Array<{ rota: string; http: number; fila: number; acao: number; seguidos: number; estado: string }> = []
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
    diag.push({ rota: alvo.rota, http, fila, acao, seguidos: agora, estado })

    if (!dry) {
      // regrava o contador (chave "vigia:<rota>:<n>"): apaga a antiga e põe a nova
      const antigas = (memoria ?? []).filter((m) => m.chave.startsWith(`vigia:${alvo.rota}`)).map((m) => m.chave)
      if (antigas.length) await supabaseAdmin.from('sdr_avisos_chave').delete().in('chave', antigas)
      if (agora > 0) await supabaseAdmin.from('sdr_avisos_chave').upsert({ chave: `vigia:${alvo.rota}:${agora}`, ultimo_aviso: new Date().toISOString() }, { onConflict: 'chave' })
    }

    // avisa no dia em que bate o limite — e não todo dia depois disso
    if (agora === DIAS_PARA_GRITAR) {
      problemas.push(estado !== 'ok'
        ? `• *${alvo.rota}* — ${estado} (${DIAS_PARA_GRITAR} dias seguidos)`
        : `• *${alvo.rota}* — ${fila} na fila e nenhuma ação há ${DIAS_PARA_GRITAR} dias`)
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
