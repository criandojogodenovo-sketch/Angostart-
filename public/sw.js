/**
 * AngoStart — Service Worker (Fase 6, ponto 10 — PWA).
 *
 * Estratégia conservadora (não quebra nada):
 *  - Cache-first APENAS para estáticos imutáveis (/_next/static/, ícones).
 *  - network-first para navegações e restantes pedidos (conteúdo sempre fresco;
 *    cai para cache offline quando não há rede).
 *  - NUNCA interpola /api/ (autenticação Bearer + dados em tempo real) nem
 *    URLs externos (Vercel Blob, mapas, etc.).
 */

const CACHE_NAME = 'angostart-v1';
const OFFLINE_URLS = ['/', '/produtos'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(OFFLINE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nunca interceptar APIs, blob storage ou cross-origin
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const isStatic = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');

  if (isStatic) {
    // Cache-first para estáticos imutáveis
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // Network-first para navegações/páginas (fallback offline)
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
  }
});
