import { NextRequest, NextResponse } from 'next/server'
import { processarMensagem } from '@/lib/claude'
import type { Mensagem } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

// Simulador de chat: roda a VictorIA contra uma conversa fake (sem tocar o
// banco nem o Evo). Serve pra testar o comportamento/prompt do agente no painel.
// O cliente devolve `dados` acumulados a cada turno pra simular o
// [DADOS_COLETADOS:] que o webhook real mantém em observacoes.
export async function POST(req: NextRequest) {
  const { mensagem, historico, nome, status, dados } = await req.json()

  if (!mensagem?.trim()) {
    return NextResponse.json({ error: 'Mensagem vazia' }, { status: 400 })
  }

  const msgs: Mensagem[] = (historico ?? []).map((m: { role: string; content: string }, i: number) => ({
    id: String(i),
    lead_id: '0',
    direcao: m.role === 'user' ? ('in' as const) : ('out' as const),
    conteudo: m.content,
    template_hsm: null,
    enviado_em: new Date().toISOString(),
  }))

  const STATUS_VALIDOS = ['INTERESSADO', 'PRE_APROVACAO', 'CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA']
  const statusAtual = STATUS_VALIDOS.includes(status) ? status : 'INTERESSADO'

  try {
    const resposta = await processarMensagem(
      mensagem,
      msgs,
      nome || 'Visitante',
      statusAtual,
      'AIVA',
      dados && typeof dados === 'object' ? dados : undefined,
    )
    return NextResponse.json(resposta)
  } catch (err) {
    console.error('[chat] erro:', err)
    return NextResponse.json({ error: 'Erro ao processar' }, { status: 500 })
  }
}
