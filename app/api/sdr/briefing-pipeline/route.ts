/**
 * briefing-pipeline/route.ts (AIVA — Victoria)
 *
 * Cron diário 5h BRT seg-sex que envia o briefing do PIPELINE AIVA pelo
 * WhatsApp pra Aldo + Nei. A lógica de montagem fica em lib/pipeline-briefing
 * (compartilhada com o comando /pipeline do admin).
 *
 * ENTREGA GARANTIDA (independe da janela 24h):
 *   1) dispara o template HSM "enviar info" (AIVA_REATIVACAO_TEMPLATE_ID) com
 *      uma linha curta → HSM entrega SEMPRE e REABRE a janela de 24h.
 *   2) manda o briefing detalhado como texto livre → cai dentro da janela
 *      recém-reaberta.
 * (O briefing tem muitas quebras de linha, então NÃO cabe num parâmetro de
 *  template — a Meta rejeita \n em variável, erro #132018 — por isso vai como
 *  texto livre após o HSM reabrir a janela.)
 *
 * Schedule: `0 8 * * 1-5` UTC = 5h BRT seg-sex
 * Auth: Bearer WEBHOOK_SECRET ou CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendText, sendTemplate } from '@/lib/evotalks'
import { buildBriefingCompleto, briefingDestinos, brtNow, salvarBriefingFollowup } from '@/lib/pipeline-briefing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Template HSM "enviar info" (mesmo da reativação): corpo "Olá {{1}}, {{2}}".
const REOPEN_TEMPLATE_ID = Number(process.env.AIVA_REATIVACAO_TEMPLATE_ID ?? 0)

function nomeDestino(num: string): string {
  if (num === process.env.ALDO_WHATSAPP) return 'Aldo'
  if (num === process.env.NEI_WHATSAPP) return 'Nei'
  return 'time'
}

/**
 * Entrega o briefing pra um destino.
 *
 * O QUE IMPORTA (resumo com os números) vai DENTRO do HSM → entrega SEMPRE,
 * independe da janela de 24h. Um template disparado pela empresa NÃO reabre a
 * janela (só msg do cliente abre) — por isso o texto livre detalhado é só BÔNUS:
 * entra quando a janela já está aberta (Aldo/Nei mandaram algo nas últimas 24h),
 * e quando está fechada a Meta descarta sem erro. Por isso ele é best-effort e
 * NUNCA derruba a entrega: o essencial já foi no HSM.
 *
 * Retorna hsmOk (caminho crítico) e textoOk (bônus) pra log/auditoria honestos.
 */
async function entregarBriefing(
  num: string,
  detalhado: string,
  compacto: string,
): Promise<{ destino: string; hsmOk: boolean; erro?: string }> {
  const destino = nomeDestino(num)

  // Sem template de reabertura configurado: só resta o texto livre (depende da
  // janela; pode cair sem erro). Mantém o comportamento antigo como degradação.
  if (!REOPEN_TEMPLATE_ID) {
    try {
      await sendText(num, detalhado)
      return { destino, hsmOk: false }
    } catch (err) {
      return { destino, hsmOk: false, erro: err instanceof Error ? err.message : String(err) }
    }
  }

  // CAMINHO CRÍTICO: HSM carrega o resumo compacto. Se isto lançar, o destino falhou.
  await sendTemplate(num, REOPEN_TEMPLATE_ID, [destino, compacto])

  // Guarda o briefing DETALHADO do dia. Ele NÃO é enviado agora (o HSM não abre a
  // janela 24h). Quando o admin RESPONDER o HSM, o webhook dispara este texto — aí
  // a janela já está aberta pela resposta dele. Ver consumirBriefingFollowup.
  try {
    await salvarBriefingFollowup(num, detalhado)
  } catch (err) {
    console.error(`[briefing-pipeline] falha ao guardar followup p/ ${destino}:`, err instanceof Error ? err.message : err)
  }
  return { destino, hsmOk: true }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { dia, nomeDia } = brtNow()
  if (dia < 1 || dia > 5) {
    return NextResponse.json({ ok: true, ignorado: 'fim_de_semana', dia: nomeDia })
  }

  try {
    const { detalhado, compacto } = await buildBriefingCompleto()
    const destinos = briefingDestinos()

    const resultados = await Promise.allSettled(
      destinos.map((num) => entregarBriefing(num, detalhado, compacto)),
    )

    // Sucesso = HSM entregue (caminho crítico). O texto livre é bônus e não conta.
    const entregas = resultados.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { destino: '?', hsmOk: false, erro: String((r as PromiseRejectedResult).reason) },
    )
    const sucesso = entregas.filter((e) => e.hsmOk).length

    return NextResponse.json({
      ok: sucesso === destinos.length,
      ts: new Date().toISOString(),
      destinos: destinos.length,
      sucesso,
      falha: destinos.length - sucesso,
      reopenTemplate: REOPEN_TEMPLATE_ID || null,
      entregas,
      previewCompacto: compacto,
      preview: detalhado,
    })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: errMsg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return GET(req)
}
