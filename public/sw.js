/**
 * sw.js — service worker do PWA do painel (Aldo 17/10/2026).
 *
 * ⚠️ DE PROPÓSITO ELE QUASE NÃO FAZ NADA. Este painel mostra estado de produção — lead, fila de
 * disparo, etapa de card. Service worker que guarda resposta em cache mostraria número velho com
 * cara de número novo, e isso é pior do que não abrir. Então:
 *   - nada de /api é tocado: passa direto pra rede, sempre;
 *   - navegação é REDE PRIMEIRO; só se a rede falhar (celular sem sinal) mostra a página offline;
 *   - o único cache é a casca: a própria página offline e os ícones.
 *
 * Versione CACHE ao mudar qualquer coisa aqui — o activate apaga as versões antigas.
 */
const CACHE = 'sdr-aiva-v1'
const CASCA = ['/offline.html', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  // só GET do próprio domínio; POST (login, ações do painel) nunca passa por aqui
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  // API e webhooks: rede pura, sem interceptação
  if (url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')))
    return
  }
  // ícones e afins: rede primeiro, cache só como rede de segurança
  if (CASCA.includes(url.pathname)) {
    e.respondWith(fetch(req).catch(() => caches.match(req)))
  }
})
