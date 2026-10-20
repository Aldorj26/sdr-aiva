/**
 * /r/<token> — relatório semanal da loja ativa, aberto pelo lojista no celular (lib/relatorio-loja.ts).
 *
 * É PÚBLICO de propósito (o matcher do middleware é lista explícita e /r não entra nela): o token
 * aleatório de 16 caracteres é a autenticação, e a página mostra só a loja daquele link. Devolve
 * HTML cru — e não uma page.tsx — porque o layout raiz traz o menu do painel, que não pode
 * aparecer para lojista.
 */
import { NextRequest } from 'next/server'
import { relatorioDoToken, htmlRelatorio, htmlNaoEncontrado } from '@/lib/relatorio-loja'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const cabecalhos = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const r = await relatorioDoToken(token)
  if (!r || !r.d) return new Response(htmlNaoEncontrado(), { status: 404, headers: cabecalhos })
  return new Response(htmlRelatorio(r), { headers: cabecalhos })
}
