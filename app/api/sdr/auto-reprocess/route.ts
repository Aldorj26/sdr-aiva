import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * Detecta leads com mensagem IN sem resposta OUT e retrigga o webhook.
 * Roda a cada 5 minutos via cron ou scheduled task.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  // Busca leads INTERESSADO ou AGUARDANDO com última msg IN sem resposta OUT
  const { data: stuck } = await supabaseAdmin.rpc('get_stuck_leads')

  if (!stuck || stuck.length === 0) {
    return NextResponse.json({ ok: true, reprocessados: 0, mensagem: 'Nenhum lead travado' })
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://sdr-agent-nine.vercel.app'

  let sucesso = 0
  let falha = 0

  for (const lead of stuck) {
    try {
      const res = await fetch(`${baseUrl}/api/sdr/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.WEBHOOK_SECRET ?? '',
        },
        body: JSON.stringify({
          event: 'messages.upsert',
          data: {
            key: { fromMe: false, remoteJid: `${lead.telefone}@s.whatsapp.net` },
            message: { conversation: lead.ultima_msg_in },
          },
        }),
      })

      const data = await res.json()
      if (data.ok) {
        console.log(`Auto-reprocess: ${lead.nome} (${lead.telefone}) — OK`)
        sucesso++
      } else {
        console.error(`Auto-reprocess: ${lead.telefone} — falhou:`, data)
        falha++
      }
    } catch (err) {
      console.error(`Auto-reprocess: erro ${lead.telefone}:`, err)
      falha++
    }

    // Rate limit entre reprocessamentos
    await new Promise(r => setTimeout(r, 2000))
  }

  return NextResponse.json({ ok: true, reprocessados: stuck.length, sucesso, falha })
}

// GET também funciona (pra cron Vercel)
export async function GET(req: NextRequest) {
  // Cron Vercel não manda Authorization header, usa query param
  const fakeReq = new NextRequest(req.url, {
    method: 'POST',
    headers: new Headers({
      'authorization': `Bearer ${process.env.WEBHOOK_SECRET}`,
    }),
  })
  return POST(fakeReq)
}
