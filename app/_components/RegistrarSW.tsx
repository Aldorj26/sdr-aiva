'use client'

import { useEffect } from 'react'

/**
 * Registra o service worker do PWA (Aldo 17/10/2026).
 *
 * Só em produção: em dev o SW atrapalha o hot reload e deixa o navegador servindo página velha
 * depois de um `npm run dev`. O registro é best-effort — se falhar, o painel funciona igual, só
 * não dá pra instalar.
 *
 * O que ele guarda está em public/sw.js: nada de API, nada de dado do painel.
 */
export default function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    const id = setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[pwa] registro falhou:', e))
    }, 1500) // depois da primeira pintura, pra não disputar banda com o carregamento
    return () => clearTimeout(id)
  }, [])
  return null
}
