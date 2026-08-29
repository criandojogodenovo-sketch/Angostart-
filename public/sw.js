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

/* ───────────────── Web Push (Fase 7) ─────────────────
   Recebe notificações do servidor (VAPID) e mostra-as ao
   utilizador mesmo com a app fechada. Clique abre o link. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'AngoStart', body: event.data ? event.data.text() : '' };
  }

  const title = String(data.title || 'AngoStart').slice(0, 120);
  const options = {
    body: String(data.body || '').slice(0, 300),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'angostart-' + Date.now(),
    data: { url: String(data.url || '/').slice(0, 200) },
    vibrate: [80, 40, 80],
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch(() => undefined)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          const path = new URL(client.url).pathname + new URL(client.url).search;
          if (path === target || client.url.endsWith(target)) {
            return client.focus();
          }
        } catch {
          /* ignora URLs inválidas */
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
