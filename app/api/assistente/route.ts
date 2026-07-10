import { NextRequest, NextResponse } from 'next/server'
import { responderAssistente, type MsgChat } from '@/lib/assistente'

export const maxDuration = 60 // loop de tools pode levar alguns segundos

export async function POST(req: NextRequest) {
  const { mensagem, historico } = (await req.json()) as {
    mensagem?: string
    historico?: MsgChat[]
  }

  if (!mensagem?.trim()) {
    return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 })
  }

  try {
    // Limita o histórico enviado (as últimas 20 trocas bastam de contexto)
    const resposta = await responderAssistente(mensagem.trim(), (historico ?? []).slice(-20))
    return NextResponse.json({ resposta })
  } catch (err) {
    console.error('[assistente] erro:', err)
    return NextResponse.json({ error: 'Erro ao processar' }, { status: 500 })
  }
}
