import type { Metadata } from 'next'
import './globals.css'
import Sidebar from './_components/Sidebar'
import AssistenteWidget from './_components/AssistenteWidget'

export const metadata: Metadata = {
  title: 'SDR Agent AIVA',
  description: 'Agente SDR autônomo para prospecção AIVA — Track Tecnologia',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="app-shell">
          <Sidebar />
          <div className="app-main">{children}</div>
        </div>
        <AssistenteWidget />
      </body>
    </html>
  )
}
