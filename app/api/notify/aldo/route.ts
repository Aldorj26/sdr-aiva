import { NextRequest, NextResponse } from 'next/server'
import { sendText } from '@/lib/evotalks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/notify/aldo
 *
 * Endpoint estreito (blast radius nulo) pra rotina remota Claude
 * enviar mensagem pelo WhatsApp do Aldo. Auth: Bearer WEBHOOK_SECRET.
 *
 * Body: { "message": "..." }
 *
 * Validações:
 * - message obrigatório, string, ate 4000 chars (limite WhatsApp)
 * - destino fixo: process.env.ALDO_WHATSAPP (nao aceita parametro de numero,
 *   eliminando risco de spam pra qualquer telefone se o secret vazar)
 *
 * Janela WhatsApp: depende do Aldo ter mandado msg pra fila 10 nos ultimos
 * 24h. Se janela fechada, sendText falha. Aldo precisa manter contato com
 * a fila a cada 24h pra briefing chegar — ou mandar simples "oi".
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const aldoNumber = process.env.ALDO_WHATSAPP
  if (!aldoNumber) {
    return NextResponse.json({ error: 'aldo_not_configured' }, { status: 500 })
  }

  let body: { message?: string } = {}
  try {
    body = (await req.json()) as { message?: string }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!body.message || typeof body.message !== 'string') {
    return NextResponse.json({ error: 'message_required' }, { status: 400 })
  }

  if (body.message.length > 4000) {
    return NextResponse.json({ error: 'message_too_long', maxChars: 4000, got: body.message.length }, { status: 400 })
  }

  try {
    await sendText(aldoNumber, body.message)
    return NextResponse.json({ ok: true, ts: new Date().toISOString() })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[notify/aldo] sendText falhou:', errMsg)
    return NextResponse.json({ ok: false, error: errMsg }, { status: 502 })
  }
}
