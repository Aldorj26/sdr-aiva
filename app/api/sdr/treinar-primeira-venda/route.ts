/**
 * treinar-primeira-venda/route.ts (AIVA)
 *
 * DISPARO ÚNICO (sob demanda, NÃO está no vercel.json) que pergunta às lojas
 * paradas na etapa "Treinar" (stage 70 do Evo, pipeline 15) se já fizeram a
 * primeira venda no crediário AIVA — e se oferece pra destravar quem ainda não.
 *
 * Fonte da verdade = ETAPA do Evo Talks (stage 70). Cruza com o Supabase pelo
 * telefone (variações do 9º dígito) pra dedup + histórico.
 *
 * Entrega: HSM reabridor (AIVA_REATIVACAO_TEMPLATE_ID = 48), corpo "Oi {{1}}, tudo bem?".
 * O conteúdo da pergunta vai NO PRÓPRIO {{2}} (uma linha, sem \n) — entrega
 * garantida mesmo com a janela de 24h fechada (que é o caso da maioria em Treinar).
 * NADA de texto livre separado (falharia fora da janela).
 *
 * Dedup: flag [FUP_TREINAR_VENDA:ISO] em observacoes — re-disparar não duplica.
 * Overrides: ?dry=true (só lista, não envia) · ?force=true (ignora dedup) · ?max=N.
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendTemplate } from '@/lib/evotalks'
import { supabaseAdmin, getLeadByTelefone } from '@/lib/supabase'
import { fetchOpps } from '@/lib/pipeline-briefing'
import { normalizaNome } from '@/lib/text'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const REOPEN_TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)
const STAGE_TREINAR = 70
const FLAG = 'FUP_TREINAR_VENDA'

// {{2}} do template "Oi {{1}}, tudo bem?" — uma linha só, sem \n (a Meta rejeita
// quebra de linha em variável). NÃO repete saudação (o corpo já abre com "Oi, tudo bem?").
const MIOLO =
  'aqui é a Victoria, da AIVA 🙌 Você já passou pelo treinamento e tá liberado pra vender. ' +
  'Me conta: já saiu a primeira venda no crediário AIVA? Se ainda não, me diz o que tá faltando que eu te ajudo a destravar 🚀'

/** Nome pra saudação: prioriza nome do sócio coletado, depois nome do lead, depois o título da loja. */
function nomeContato(obs: string | null, leadNome: string | null, oppTitle: string): string {
  const m = (obs ?? '').match(/nome_socio=([^|\]]+)/)
  return (
    normalizaNome(m?.[1]) ||
    normalizaNome(leadNome) ||
    normalizaNome(oppTitle) ||
    'lojista'
  )
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!REOPEN_TEMPLATE_ID) {
    return NextResponse.json({ ok: false, error: 'AIVA_REATIVACAO_TEMPLATE_ID não configurado' }, { status: 500 })
  }

  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === 'true'
  const force = url.searchParams.get('force') === 'true'
  const maxRun = Math.min(Number(url.searchParams.get('max')) || 60, 60)

  const naEtapa = (await fetchOpps()).filter((o) => o.fkStage === STAGE_TREINAR)

  let enviados = 0
  let pulados = 0
  let semLeadSupabase = 0
  const resultados: Array<{ telefone: string; nome?: string; acao: string }> = []

  for (const o of naEtapa) {
    if (enviados >= maxRun) break
    const telefone = (o.mainphone || '').replace(/\D/g, '')
    if (!telefone) {
      resultados.push({ telefone: '?', acao: `sem_telefone (opp ${o.id})` })
      continue
    }

    const lead = await getLeadByTelefone(telefone)
    const obs = lead?.observacoes ?? ''

    // Dedup: já recebeu este follow-up?
    if (!force && new RegExp(`\\[${FLAG}(:[^\\]]*)?\\]`).test(obs)) {
      pulados++
      resultados.push({ telefone, acao: 'ja_recebeu' })
      continue
    }

    const nome = nomeContato(obs, lead?.nome ?? null, o.title)

    if (dry) {
      resultados.push({ telefone, nome, acao: lead?.id ? 'dry' : 'dry_sem_lead_supabase' })
      continue
    }

    try {
      await sendTemplate(telefone, REOPEN_TEMPLATE_ID, [nome, MIOLO])

      if (lead?.id) {
        const novaObs = `[${FLAG}:${new Date().toISOString()}] ${obs
          .replace(new RegExp(`\\s*\\[${FLAG}(:[^\\]]*)?\\]\\s*`, 'g'), ' ')
          .trim()}`.trim()
        await supabaseAdmin
          .from('sdr_leads')
          .update({ observacoes: novaObs, data_ultimo_contato: new Date().toISOString() })
          .eq('id', lead.id)
        await supabaseAdmin.from('sdr_mensagens').insert([
          { lead_id: lead.id, direcao: 'out', conteudo: '[Follow-up Treinar — primeira venda]', template_hsm: 'aiva_reativacao_48h' },
          { lead_id: lead.id, direcao: 'out', conteudo: `Oi ${nome}, tudo bem? ${MIOLO}` },
        ])
      } else {
        semLeadSupabase++
      }

      enviados++
      resultados.push({ telefone, nome, acao: lead?.id ? 'enviado' : 'enviado_sem_lead_supabase' })
    } catch (err) {
      resultados.push({ telefone, nome, acao: `erro: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    etapa: 'Treinar (stage 70)',
    total_na_etapa: naEtapa.length,
    enviados,
    pulados_ja_receberam: pulados,
    enviados_sem_lead_supabase: semLeadSupabase,
    dry,
    resultados,
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
