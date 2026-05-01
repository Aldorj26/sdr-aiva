import { NextRequest, NextResponse } from 'next/server'
import { sendText } from '@/lib/evotalks'

/**
 * Endpoint de teste pra diagnosticar envio de alertas via Evo Talks.
 * Chama sendText diretamente e captura o erro completo — útil pra debugar
 * números que não estão recebendo alertas (alertHuman engole o erro).
 *
 * Uso:
 *   GET /api/admin/test-alert?number=5548991555655&secret=track2026segredo
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const number = url.searchParams.get('number')
  if (!number) {
    return NextResponse.json({ error: 'Falta param number' }, { status: 400 })
  }

  const msg = `🧪 Teste de alerta AIVA — ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`

  try {
    await sendText(number, msg)
    return NextResponse.json({ ok: true, number, mensagem_enviada: msg })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const errStack = err instanceof Error ? err.stack : undefined
    return NextResponse.json({
      ok: false,
      number,
      erro: errMsg,
      stack: errStack?.substring(0, 500),
    }, { status: 500 })
  }
}
