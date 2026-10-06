import { blocoPromptBloqueio } from '@/lib/limite-originacao'
import { NextRequest, NextResponse } from 'next/server'
import { processarMensagem } from '@/lib/claude'
import type { Mensagem } from '@/lib/supabase'
import { desempenhoPorCnpjs } from '@/lib/desempenho-loja'
import { blocoPrompt } from '@/lib/desempenho-loja-calc'

export const runtime = 'nodejs'
export const maxDuration = 60

// Simulador de chat: roda a VictorIA contra uma conversa fake (sem tocar o
// banco nem o Evo). Serve pra testar o comportamento/prompt do agente no painel.
// O cliente devolve `dados` acumulados a cada turno pra simular o
// [DADOS_COLETADOS:] que o webhook real mantém em observacoes.
export async function POST(req: NextRequest) {
  const { mensagem, historico, nome, status, dados, teste_abertura, cnpj_desempenho, onb_etapa, biometria_link, pre_cadastro_nao_chegou, bloqueio_limite } = await req.json()

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

  const STATUS_VALIDOS = ['INTERESSADO', 'PRE_APROVACAO', 'CADASTRO_RECEBIDO', 'EM_ANALISE_AIVA', 'TREINAR', 'LOGIN', 'LOJA_FINALIZADA_E_VENDENDO']
  const statusAtual = STATUS_VALIDOS.includes(status) ? status : 'INTERESSADO'

  try {
    // `cnpj_desempenho`: simula os números de uma loja real do portal (só leitura)
    const cnpjDes = String(cnpj_desempenho ?? '').replace(/\D/g, '')
    const r = cnpjDes.length === 14 ? await desempenhoPorCnpjs([cnpjDes]) : null
    const resposta = await processarMensagem(
      mensagem,
      msgs,
      nome || 'Visitante',
      statusAtual,
      'AIVA',
      dados && typeof dados === 'object' ? dados : undefined,
      // teste A/B da abertura (lib/teste-abertura.ts): `teste_abertura: 'B'` simula a variante B
      undefined, undefined, undefined, undefined, undefined,
      // `biometria_link` e `onb_etapa` simulam o que o espelho leu no portal (dados_varejo | biometria | biometria_negada | aguardando_aiva)
      typeof biometria_link === 'string' ? biometria_link : undefined,
      undefined, undefined,
      typeof onb_etapa === 'string' ? onb_etapa : undefined,
      undefined,
      teste_abertura === 'B' ? 'B' : null,
      r ? blocoPrompt(r) : null,
      pre_cadastro_nao_chegou === true,
      bloqueio_limite ? blocoPromptBloqueio({ rid: '0', cnpj: null, desde: typeof bloqueio_limite === 'string' ? bloqueio_limite : null }) : null,
    )
    return NextResponse.json(resposta)
  } catch (err) {
    console.error('[chat] erro:', err)
    return NextResponse.json({ error: 'Erro ao processar' }, { status: 500 })
  }
}
