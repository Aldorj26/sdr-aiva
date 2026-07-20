import { NextRequest, NextResponse } from 'next/server'
import { generateDownloadUrl } from '@/lib/evotalks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Proxy de mídia do Evo Talks para o painel.
 *
 * O painel exibe imagens/arquivos que o lojista mandou na conversa. O arquivo
 * mora no Evo e a URL de download tem um token que EXPIRA — por isso não dá pra
 * guardar a URL no banco. Guardamos só o fileId (no marcador da mensagem) e este
 * endpoint gera a URL fresca na hora e redireciona.
 *
 * Protegido pelo middleware (rota /api/leads/*), então só quem tem o cookie do
 * painel acessa. Imagens carregadas via <img src> same-origin já mandam o cookie.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params
  const id = Number(fileId)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'fileId inválido' }, { status: 400 })
  }

  try {
    const url = await generateDownloadUrl(id)
    if (!url) return NextResponse.json({ error: 'arquivo não encontrado' }, { status: 404 })
    // Redirect 302 pra URL fresca do Evo (com token válido no momento).
    return NextResponse.redirect(url, 302)
  } catch (err) {
    console.error(`[media proxy] falha ao gerar URL do fileId=${id}:`, err)
    return NextResponse.json({ error: 'falha ao gerar link' }, { status: 502 })
  }
}
