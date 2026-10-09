/**
 * check-primeira-venda/route.ts (AIVA — check de realidade da etapa final)
 *
 * Origem: curadoria 2026-07-27 — várias lojas em "Loja Finalizada e Vendendo"
 * relataram que NUNCA operaram ("não tenho login", "ainda não começamos",
 * "não fizemos vendas"). A etapa final do funil não reflete a realidade e
 * essas lojas ficam ~12 dias sem interação — comissão que não vem.
 *
 * O que faz: cron semanal que pergunta diretamente às lojas QUIETAS da etapa
 * final se a primeira venda já saiu. Envia via template HSM 48 reabridor
 * ("Olá {{1}}, {{2}}") — entrega garantida mesmo com janela 24h fechada.
 * Quando o lojista responde:
 *   - se revelar que não opera → detector no webhook dispara alerta 🚩 pro Nei
 *     e a VictorIA aciona humano (motivo loja_finalizada_sem_operar)
 *   - se estiver vendendo → a VictorIA segue a consultoria (Fase 5)
 *
 * Regras anti-spam:
 *   - Só lojas sem interação há 7+ dias (quem conversa ativo não precisa)
 *   - Máx 2 checks por loja, com 30 dias entre eles
 *   - Pula quem está em toque recente da consultoria (<10d) — ela já pergunta
 *   - Pula [CONSULTORIA_OPTOUT] e acionar_humano=true
 *
 * Flags em observacoes: [CHECK_VENDA_N:n] [CHECK_VENDA_ULTIMA:ISO]
 *
 * Params: ?dry=true (preview sem enviar) | ?max=N (lote, default 30)
 * Schedule: 0 13 * * 2 UTC = terças 10h BRT
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'
import { flag } from '@/lib/req-flags'
import { leadsBloqueadosPorLimite } from '@/lib/limite-originacao'
import { cnpjsComPrimeiroAcesso } from '@/lib/primeiro-acesso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const REOPEN_TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const DIA_MS = 24 * 60 * 60 * 1000
const MAX_CHECKS = 2
const COOLDOWN_DIAS = 30

// {{2}} do template HSM — UMA linha, sem \n (regra da Meta pra parâmetro).
const MIOLO_CHECK =
  'tudo certo por aí? Passando pra confirmar: vocês já conseguiram fazer a primeira venda pela AIVA? 😊 Se ainda não saiu — seja acesso, sistema ou movimento — me conta o que travou que eu te ajudo a destravar!'

function parseFlagDate(obs: string, key: string): Date | null {
  const m = obs.match(new RegExp(`\\[${key}:([^\\]]+)\\]`))
  if (!m) return null
  const d = new Date(m[1])
  return isNaN(d.getTime()) ? null : d
}

function nomeSocioDeObs(obs: string): string | null {
  const m = obs.match(/nome_socio=([^|\]]+)/)
  return m ? m[1].trim() : null
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dry = flag(url.searchParams, 'dry')
  const max = Math.min(Number(url.searchParams.get('max')) || 30, 50)

  const seteDiasAtras = new Date(Date.now() - 7 * DIA_MS).toISOString()
  const agora = Date.now()

  const { data: lojas, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, status, observacoes, data_ultimo_contato')
    .eq('produto', 'AIVA')
    // + LOGIN em "Primeiro acesso" (entrou e não vendeu — Aldo 08/10/2026), filtrado logo abaixo
    .in('status', ['LOJA_FINALIZADA_E_VENDENDO', 'LOGIN'])
    .eq('acionar_humano', false)
    .lte('data_ultimo_contato', seteDiasAtras)
    .order('data_ultimo_contato', { ascending: true })

  if (error) {
    console.error('[CHECK_VENDA] Erro ao buscar lojas:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // loja travada pelo limite de originação da AIVA não recebe "como estão as vendas?" (06/10/2026)
  const bloqueados = await leadsBloqueadosPorLimite()
  // LOGIN só se o CNPJ já teve primeiro acesso no portal (lib/primeiro-acesso.ts)
  const loginIds = (lojas ?? []).filter((l) => l.status === 'LOGIN').map((l) => l.id)
  const emPrimeiroAcesso = new Set<string>()
  if (loginIds.length) {
    const comAcesso = await cnpjsComPrimeiroAcesso()
    const { data: regs } = await supabaseAdmin.from('sdr_registros_cnpj').select('lead_id,cnpj').in('lead_id', loginIds)
    const cnpjsDe = new Map<string, string[]>()
    for (const r of regs ?? []) cnpjsDe.set(r.lead_id, [...(cnpjsDe.get(r.lead_id) ?? []), String(r.cnpj).replace(/\D/g, '')])
    for (const l of (lojas ?? []).filter((x) => x.status === 'LOGIN')) {
      const matriz = ((l.observacoes ?? '').match(/cnpj_matriz=([0-9./-]+)/)?.[1] ?? '').replace(/\D/g, '')
      if ([matriz, ...(cnpjsDe.get(l.id) ?? [])].some((c) => comAcesso.has(c))) emPrimeiroAcesso.add(l.id)
    }
  }
  const candidatas = (lojas ?? []).filter((l) => {
    const obs = l.observacoes ?? ''
    if (l.status === 'LOGIN' && !emPrimeiroAcesso.has(l.id)) return false
    if (/\[CAMP_ATIV_PLACAR:[^\]]*\|fim=0\|/.test(obs)) return false // campanha de boas-vindas em curso
    if (bloqueados.has(l.id)) return false
    if (obs.includes('[CONSULTORIA_OPTOUT]')) return false
    // Consultoria mandou toque há menos de 10 dias → ela já perguntou das vendas
    const ultConsultoria = parseFlagDate(obs, 'CONSULTORIA_ULTIMA')
    if (ultConsultoria && agora - ultConsultoria.getTime() < 10 * DIA_MS) return false
    // dica de desempenho (substituta da consultoria, 05/10/2026) — mesma folga
    const ultDica = parseFlagDate(obs, 'DICAS_ULTIMA')
    if (ultDica && agora - ultDica.getTime() < 10 * DIA_MS) return false
    // Máximo de checks e cooldown entre eles
    const n = parseInt(obs.match(/\[CHECK_VENDA_N:(\d+)\]/)?.[1] ?? '0', 10)
    if (n >= MAX_CHECKS) return false
    const ultCheck = parseFlagDate(obs, 'CHECK_VENDA_ULTIMA')
    if (ultCheck && agora - ultCheck.getTime() < COOLDOWN_DIAS * DIA_MS) return false
    return true
  }).slice(0, max)

  let enviados = 0
  let falhas = 0
  const previews: Array<{ nome: string; telefone: string }> = []

  for (const loja of candidatas) {
    const obs = loja.observacoes ?? ''
    let nome = normalizaNome(nomeSocioDeObs(obs)) || normalizaNome(loja.nome) || 'Lojista'
    // Nome curto demais ou truncado ("Dr.") fica estranho na saudação do HSM
    if (nome.replace(/[^\p{L}]/gu, '').length < 3) nome = 'Lojista'

    if (dry) {
      previews.push({ nome, telefone: loja.telefone })
      continue
    }
    if (!REOPEN_TEMPLATE_ID) { falhas++; continue }

    try {
      await sendTemplate(loja.telefone, REOPEN_TEMPLATE_ID, [nome, MIOLO_CHECK])

      const n = parseInt(obs.match(/\[CHECK_VENDA_N:(\d+)\]/)?.[1] ?? '0', 10) + 1
      const novaObs = `${obs
        .replace(/\s*\[CHECK_VENDA_N:\d+\]\s*/g, ' ')
        .replace(/\s*\[CHECK_VENDA_ULTIMA:[^\]]+\]\s*/g, ' ')
        .trim()} [CHECK_VENDA_N:${n}] [CHECK_VENDA_ULTIMA:${new Date().toISOString()}]`.trim()

      await supabaseAdmin
        .from('sdr_leads')
        .update({ observacoes: novaObs, data_ultimo_contato: new Date().toISOString() })
        .eq('id', loja.id)
      await supabaseAdmin.from('sdr_mensagens').insert([
        { lead_id: loja.id, direcao: 'out', conteudo: '[Check primeira venda enviado]', template_hsm: 'aiva_reativacao_48h' },
        { lead_id: loja.id, direcao: 'out', conteudo: `Olá ${nome}, ${MIOLO_CHECK}` },
      ])
      enviados++
    } catch (err) {
      console.error(`[CHECK_VENDA] Falha ao enviar pra ${loja.telefone}:`, err)
      falhas++
    }
  }

  return NextResponse.json({
    ok: true,
    dry,
    candidatas: candidatas.length,
    enviados,
    falhas,
    ...(dry ? { previews } : {}),
  })
}
