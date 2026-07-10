'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  label: string
  href: string
  icon: string
}

interface NavSection {
  label: string
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  {
    label: 'Funil',
    items: [
      { label: 'Pipeline', href: '/', icon: '📊' },
      { label: 'Clientes', href: '/clientes', icon: '🏪' },
    ],
  },
  {
    label: 'Performance',
    items: [
      { label: 'Funil de conversão', href: '/funil', icon: '📈' },
      { label: 'Consumo de tokens', href: '/metricas/tokens', icon: '🪙' },
    ],
  },
  {
    label: 'Disparos',
    items: [
      { label: 'Nova campanha', href: '/campanha', icon: '➕' },
      { label: 'Campanhas', href: '/campanhas', icon: '🗂️' },
    ],
  },
  {
    label: 'Configurações',
    items: [{ label: 'Curadoria', href: '/curadoria', icon: '✍️' }],
  },
]

export default function Sidebar() {
  const pathname = usePathname()

  // Login e chat (simulador full-screen) não têm sidebar
  if (pathname === '/login' || pathname === '/chat') return null

  function isActive(href: string): boolean {
    const path = href.split('?')[0]
    if (path === '/') return pathname === '/'
    return pathname === path || pathname.startsWith(path + '/')
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img className="sidebar-logo-mark" src="/logo-track.png" alt="Track" />
        <div className="sidebar-logo-text">
          <strong>SDR AIVA</strong>
          <span>Track Tecnologia</span>
        </div>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.label} className="sidebar-section">
          <div className="sidebar-section-label">{section.label}</div>
          {section.items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`sidebar-link${isActive(item.href) ? ' active' : ''}`}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      ))}

      <div className="sidebar-footer">VictorIA · SDR autônomo</div>
    </aside>
  )
}
