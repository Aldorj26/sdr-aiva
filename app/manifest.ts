import type { MetadataRoute } from 'next'

/**
 * Manifest do PWA (Aldo 17/10/2026) — serve /manifest.webmanifest.
 *
 * ⚠️ NÃO entra no matcher do middleware: o navegador busca o manifest e os ícones ANTES do login
 * (às vezes sem cookie nenhum), e com 401 o Android simplesmente não oferece "Instalar app".
 * O conteúdo aqui é público por natureza — nome, cor e ícone. O que é privado continua atrás do
 * cookie, porque as PÁGINAS seguem protegidas.
 *
 * `start_url: '/'` cai na home do painel; quem não tem cookie é mandado pro /login pelo middleware,
 * que é o comportamento certo também quando aberto pelo ícone da tela inicial.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SDR AIVA — Track',
    short_name: 'SDR AIVA',
    description: 'Painel do agente SDR da AIVA: atendimento, registros, jornada e desempenho.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f6f8',
    theme_color: '#242450',
    lang: 'pt-BR',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Atendimento', short_name: 'Atendimento', url: '/atendimento' },
      { name: 'Registros AIVA', short_name: 'Registros', url: '/registros' },
      { name: 'Disparos', short_name: 'Disparos', url: '/disparos' },
    ],
  }
}
