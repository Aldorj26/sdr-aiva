/**
 * consultoria-vendas/route.ts (AIVA — Victoria, Fase 5)
 *
 * Cron diário que faz a CONSULTORIA DE VENDAS pós-ativação. Para cada loja em
 * "Loja Finalizada e Vendendo" (status LOJA_FINALIZADA_E_VENDENDO), dispara
 * abordagens quinzenais com 1 pilar do playbook por vez:
 *
 *   Toque 1 → D+7 da entrada na etapa  (Preparar a loja)
 *   Toque 2 → +15d                     (Do CPF ao fechamento)
 *   Toque 3 → +15d                     (Aproveitar cada real aprovado)
 *   Toque 4 → +15d                     (Atrair fluxo) — encerra a série
 *
 * ENTREGA: o opener vai NO PRÓPRIO template HSM 48 ("Olá {{1}}, {{2}}"), uma
 * frase por toque. Como é HSM, entrega SEMPRE (não depende da janela 24h) e
 * reabre a conversa — quando o lojista responde, a VictorIA conduz a consultoria
 * (Fase 5 do prompt). Não mandamos texto livre aqui (falhava em janela fria e
 * não escala com o atraso necessário).
 *
 * Flags em sdr_leads.observacoes:
 *   [CONSULTORIA_INICIO:ISO] | [CONSULTORIA_COUNT:n] | [CONSULTORIA_ULTIMA:ISO]
 *   [CONSULTORIA_OPTOUT]  → não toca mais
 *
 * Overrides (disparo manual): ?force=true (ignora espera) | ?max=N (lote)
 * Schedule: `0 17 * * 1-5` UTC = 14h BRT seg-sex
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizaNome } from '@/lib/text'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const REOPEN_TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const MAX_TOQUES = 4
const DIA_MS = 24 * 60 * 60 * 1000
const MAX_POR_EXECUCAO = 40

// Openers por pilar = conteúdo do {{2}} do template HSM (UMA linha, sem \n).
// Cada um abre com diagnóstico e enquadra o pilar do toque; a VictorIA conduz
// a partir da resposta do lojista.
const ABERTURAS: string[] = [
  // Toque 1 — Preparar a loja (+ guia de vendas com prova e certificado)
  'tudo bem? Vi que sua loja já está ativa e vendendo no crediário, parabéns! 🎉 Nas próximas semanas vou te dar umas dicas pra vender ainda mais (se não quiser, é só me falar). Já te deixo um presente: nosso treinamento completo de vendas no crediário — passa pra sua equipe estudar, no final tem prova e certificado 😉 sdr-aiva.vercel.app/treinamento-vendas.html — E me conta: como estão as primeiras vendas, e o pessoal que entra na loja já sabe que aí dá pra parcelar o celular?',
  // Toque 2 — Do CPF ao fechamento
  'como estão as vendas no crediário? 😊 Tô com uma dica boa pra você fechar mais — às vezes o cliente chega e acaba não levando. Me conta como tá aí que eu te ajudo a converter melhor.',
  // Toque 3 — Aproveitar cada real aprovado
  'e aí, como vão as vendas no parcelado? 😊 A dica de hoje é pra aumentar o ticket de cada venda — você tem conseguido vender acessório junto com o aparelho? Me conta que eu te passo umas sacadas.',
  // Toque 4 — Atrair fluxo (encerra a série)
  'essa é a última dica da nossa série 😊 hoje é sobre atrair mais cliente pra loja. Como está o movimento aí? Me conta que eu te passo umas ideias pra encher mais a loja de gente querendo parcelar.',
]

// ─── Flags em observacoes ───────────────────────────────────────────────────
function parseFlagDate(obs: string, key: string): Date | null {
  const m = obs.match(new RegExp(`\\[${key}:([^\\]]+)\\]`))
  if (!m) return null
  const d = new Date(m[1])
  return isNaN(d.getTime()) ? null : d
}
function getCount(obs: string): number {
  const m = obs.match(/\[CONSULTORIA_COUNT:(\d+)\]/)
  return m ? parseInt(m[1], 10) : 0
}
function setFlags(obs: string, count: number, ultimaISO: string): string {
  const base = (obs ?? '')
    .replace(/\s*\[CONSULTORIA_COUNT:\d+\]\s*/g, ' ')
    .replace(/\s*\[CONSULTORIA_ULTIMA:[^\]]+\]\s*/g, ' ')
    .trim()
  return `${base} [CONSULTORIA_COUNT:${count}] [CONSULTORIA_ULTIMA:${ultimaISO}]`.trim()
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

  // Overrides p/ disparo manual controlado:
  //   ?force=true  → ignora a espera (7d/15d) e dispara o próximo toque devido agora
  //   ?max=N       → limita quantos envios nesta chamada (lote teste)
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'
  const maxRun = Math.min(Number(url.searchParams.get('max')) || MAX_POR_EXECUCAO, MAX_POR_EXECUCAO)

  // Guarda de horário comercial BRT (8h–18h) — pulada em disparo forçado
  const horasBRT = new Date().getUTCHours() - 3
  if (!force && (horasBRT < 8 || horasBRT >= 18)) {
    return NextResponse.json({ ok: true, ignorado: 'fora_horario_comercial', horasBRT })
  }

  const { data: leads, error } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, observacoes')
    .eq('status', 'LOJA_FINALIZADA_E_VENDENDO')
    .eq('produto', 'AIVA')
    .order('criado_em', { ascending: true })
    .limit(200)

  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  }

  const agora = Date.now()
  let enviados = 0
  let backfill = 0
  const resultados: Array<{ telefone: string; toque: number }> = []

  for (const lead of leads ?? []) {
    if (enviados >= maxRun) break
    const obs = lead.observacoes ?? ''

    if (/\[CONSULTORIA_OPTOUT\]/.test(obs)) continue

    // Sem data de início (loja que já estava ativa antes da Fase 5) → inicia o relógio agora.
    const inicio = parseFlagDate(obs, 'CONSULTORIA_INICIO')
    if (!inicio) {
      const novaObs = `${obs.trim()} [CONSULTORIA_INICIO:${new Date().toISOString()}] [CONSULTORIA_COUNT:0]`.trim()
      await supabaseAdmin.from('sdr_leads').update({ observacoes: novaObs }).eq('id', lead.id)
      backfill++
      continue
    }

    const count = getCount(obs)
    if (count >= MAX_TOQUES) continue

    const ultima = parseFlagDate(obs, 'CONSULTORIA_ULTIMA')
    const referencia = count === 0 ? inicio : (ultima ?? inicio)
    const diasNecessarios = count === 0 ? 7 : 15
    const venceu = agora - referencia.getTime() >= diasNecessarios * DIA_MS
    // force adianta APENAS o 1º toque (kick-off do lote); NUNCA atropela a cadência
    // de 15 dias dos toques seguintes (senão lojas já tocadas pulariam pro próximo).
    const forcarPrimeiro = force && count === 0
    if (!venceu && !forcarPrimeiro) continue

    const socio = nomeSocioDeObs(obs)
    const nome = (socio ? normalizaNome(socio) : normalizaNome(lead.nome)) ?? 'lojista'
    const abertura = ABERTURAS[count]

    try {
      if (!REOPEN_TEMPLATE_ID) throw new Error('AIVA_REATIVACAO_TEMPLATE_ID não configurado')
      // Opener vai no próprio HSM (entrega garantida, reabre a janela).
      await sendTemplate(lead.telefone, REOPEN_TEMPLATE_ID, [nome, abertura])

      // Toque 1 menciona o Guia de Vendas, mas a URL em parâmetro de HSM não
      // vira link clicável — marca [GUIA_VENDAS_ENVIADO] pro webhook mandar a
      // mensagem-link separada (encaminhável) na primeira resposta do lojista.
      const obsComGuia =
        count === 0 && !obs.includes('[GUIA_VENDAS_ENVIADO')
          ? `${obs.trim()} [GUIA_VENDAS_ENVIADO:${new Date().toISOString()}]`.trim()
          : obs
      const novaObs = setFlags(obsComGuia, count + 1, new Date().toISOString())
      await supabaseAdmin
        .from('sdr_leads')
        .update({ observacoes: novaObs, data_ultimo_contato: new Date().toISOString() })
        .eq('id', lead.id)
      await supabaseAdmin.from('sdr_mensagens').insert([
        { lead_id: lead.id, direcao: 'out', conteudo: `[Consultoria de Vendas — toque ${count + 1}/4 enviado]`, template_hsm: 'aiva_reativacao_48h' },
        { lead_id: lead.id, direcao: 'out', conteudo: `Olá ${nome}, ${abertura}` },
      ])
      enviados++
      resultados.push({ telefone: lead.telefone, toque: count + 1 })
    } catch (err) {
      console.error(`[consultoria-vendas] falha lead ${lead.telefone}:`, err)
    }
  }

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    candidatos: leads?.length ?? 0,
    enviados,
    backfill,
    resultados,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
