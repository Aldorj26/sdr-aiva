import type { Metadata, Viewport } from 'next'
import './globals.css'
import Sidebar from './_components/Sidebar'
import AssistenteWidget from './_components/AssistenteWidget'
import RegistrarSW from './_components/RegistrarSW'
import SplashIOS from './_components/SplashIOS'

export const metadata: Metadata = {
  title: 'SDR Agent AIVA',
  description: 'Agente SDR autônomo para prospecção AIVA — Track Tecnologia',
  // PWA (Aldo 17/10/2026): manifest em app/manifest.ts. `appleWebApp` é o que faz o iPhone
  // abrir em tela cheia quando adicionado à tela de início — o Safari ignora o manifest pra isso.
  manifest: '/manifest.webmanifest',
  applicationName: 'SDR AIVA',
  appleWebApp: { capable: true, title: 'SDR AIVA', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
}

// viewportFit=cover respeita o notch; themeColor pinta a barra do Android.
export const viewport: Viewport = {
  themeColor: '#242450',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <SplashIOS />
      </head>
      <body>
        <div className="app-shell">
          <Sidebar />
          <div className="app-main">{children}</div>
        </div>
        <AssistenteWidget />
        <RegistrarSW />
      </body>
    </html>
  )
}
