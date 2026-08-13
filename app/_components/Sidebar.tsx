'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

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
      { label: 'Registros AIVA', href: '/registros', icon: '📋' },
      { label: 'Alertas', href: '/alertas', icon: '🔔' },
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
    items: [
      { label: 'Curadoria', href: '/curadoria', icon: '✍️' },
      { label: 'Simulador VictorIA', href: '/chat', icon: '💬' },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  // Menu mobile (hambúrguer) — fecha ao navegar e trava o scroll do fundo
  const [aberto, setAberto] = useState(false)
  useEffect(() => { setAberto(false) }, [pathname])
  useEffect(() => {
    document.body.style.overflow = aberto ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [aberto])

  // Login e chat (simulador full-screen) não têm sidebar
  if (pathname === '/login' || pathname === '/chat') return null

  function isActive(href: string): boolean {
    const path = href.split('?')[0]
    if (path === '/') return pathname === '/'
    return pathname === path || pathname.startsWith(path + '/')
  }

  return (
    <>
      {/* Barra fixa do mobile — só aparece em telas pequenas (CSS) */}
      <div className="mobile-topbar">
        <button
          className="mobile-menu-btn"
          onClick={() => setAberto((v) => !v)}
          aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
        >
          {aberto ? '✕' : '☰'}
        </button>
        <img className="mobile-topbar-logo" src="/logo-track.png" alt="Track" />
        <strong className="mobile-topbar-title">SDR AIVA</strong>
      </div>

      {/* Fundo escuro ao abrir o menu no mobile */}
      {aberto && <div className="sidebar-backdrop" onClick={() => setAberto(false)} />}

      <aside className={`sidebar${aberto ? ' open' : ''}`}>
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
    </>
  )
}
