import { NextRequest, NextResponse } from 'next/server'

// Protege o painel (/, /api/leads/*) com um cookie simples.
// Webhooks e crons (/api/sdr/*, /api/wh) NÃO são protegidos — eles usam
// seus próprios segredos (x-internal-secret / Bearer).
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const cookie = req.cookies.get('dash_auth')?.value
  const expected = process.env.DASHBOARD_PASSWORD

  // Se não tem senha configurada, libera tudo (não quebra dev)
  if (!expected) return NextResponse.next()

  // Já autenticado
  if (cookie === expected) return NextResponse.next()

  // Não autenticado → manda pro login, preservando redirect
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('from', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  // Protege só o painel e a API de leads. O matcher exclui:
  // - /api/sdr/* (webhooks/crons com próprios segredos)
  // - /api/wh (re-export do webhook)
  // - /api/login (própria rota de login)
  // - /login (página de login)
  // - /_next/* (assets do Next)
  // - arquivos estáticos (favicon, etc)
  matcher: [
    '/',
    '/campanha',
    '/campanhas',
    '/api/leads/:path*',
  ],
}
