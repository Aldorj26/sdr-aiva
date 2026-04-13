import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, saveMensagem } from '@/lib/supabase'
import { getChatMessages } from '@/lib/evotalks'

/**
 * Detecta leads travados e reprocessa.
 *
 * Estratégia dupla:
 * 1. Busca leads no Supabase com msg IN sem resposta OUT (get_stuck_leads)
 * 2. Para leads INTERESSADO/AGUARDANDO com chatId, consulta Evo Talks
 *    pra detectar mensagens que nem chegaram no Supabase
 *
 * Roda a cada 5 minutos via scheduled task.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://sdr-agent-nine.vercel.app'

  let sucesso = 0
  let falha = 0
  const processados: string[] = []

  // ─── Estratégia 1: leads travados no Supabase ─────────────────────────────
  const { data: stuck } = await supabaseAdmin.rpc('get_stuck_leads')

  if (stuck && stuck.length > 0) {
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
          console.log(`Auto-reprocess [supabase]: ${lead.nome} (${lead.telefone}) — OK`)
          processados.push(lead.telefone)
          sucesso++
        } else {
          console.error(`Auto-reprocess [supabase]: ${lead.telefone} — falhou:`, data)
          falha++
        }
      } catch (err) {
        console.error(`Auto-reprocess [supabase]: erro ${lead.telefone}:`, err)
        falha++
      }
      await new Promise(r => setTimeout(r, 1500))
    }
  }

  // ─── Estratégia 2: polling Evo Talks pra mensagens perdidas ───────────────
  // Busca leads ativos com chatId que não foram pegos na estratégia 1
  const { data: activeLeads } = await supabaseAdmin
    .from('sdr_leads')
    .select('id, nome, telefone, evotalks_chat_id')
    .in('status', ['INTERESSADO', 'AGUARDANDO'])
    .not('evotalks_chat_id', 'is', null)
    .order('data_ultimo_contato', { ascending: false })
    .limit(30)

  if (activeLeads) {
    for (const lead of activeLeads) {
      // Pula se já processado na estratégia 1
      if (processados.includes(lead.telefone)) continue

      try {
        const chatId = Number(lead.evotalks_chat_id)
        const evoMsgs = await getChatMessages(chatId, 5)

        // Pega a última mensagem IN do Evo Talks (direction=1)
        const lastEvoIn = evoMsgs
          .filter(m => m.direction === 1)
          .sort((a, b) => b.messagetimestamp - a.messagetimestamp)[0]

        if (!lastEvoIn) continue

        // Pega a última mensagem OUT do Evo Talks (direction=3)
        const lastEvoOut = evoMsgs
          .filter(m => m.direction === 3)
          .sort((a, b) => b.messagetimestamp - a.messagetimestamp)[0]

        // Se última IN é mais recente que última OUT → lead travado
        if (!lastEvoOut || lastEvoIn.messagetimestamp > lastEvoOut.messagetimestamp) {
          // Verifica se essa mensagem já está no Supabase
          const { data: existing } = await supabaseAdmin
            .from('sdr_mensagens')
            .select('id')
            .eq('lead_id', lead.id)
            .eq('direcao', 'in')
            .eq('conteudo', lastEvoIn.message)
            .limit(1)

          // Se não está no Supabase, salva primeiro
          if (!existing || existing.length === 0) {
            await saveMensagem(lead.id, 'in', lastEvoIn.message)
            console.log(`Auto-reprocess [evo]: msg perdida salva — ${lead.nome}: "${lastEvoIn.message.substring(0, 50)}"`)
          }

          // Retrigga o webhook
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
                message: { conversation: lastEvoIn.message },
              },
            }),
          })

          const data = await res.json()
          if (data.ok) {
            console.log(`Auto-reprocess [evo]: ${lead.nome} (${lead.telefone}) — OK`)
            sucesso++
          } else {
            console.error(`Auto-reprocess [evo]: ${lead.telefone} — falhou:`, data)
            falha++
          }

          await new Promise(r => setTimeout(r, 1500))
        }
      } catch (err) {
        // Silencia erros de polling individual pra não quebrar o loop
        console.error(`Auto-reprocess [evo]: erro ${lead.telefone}:`, err)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    sucesso,
    falha,
    estrategia1: stuck?.length ?? 0,
    estrategia2_verificados: activeLeads?.length ?? 0,
  })
}

// GET pra cron Vercel
export async function GET(req: NextRequest) {
  const fakeReq = new NextRequest(req.url, {
    method: 'POST',
    headers: new Headers({
      'authorization': `Bearer ${process.env.WEBHOOK_SECRET}`,
    }),
  })
  return POST(fakeReq)
}
