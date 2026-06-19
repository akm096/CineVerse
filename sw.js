const CACHE_NAME = 'cineverse-shell-v1.3.7';
const APP_SHELL = [
  '/',
  '/index.html',
  '/player.html',
  '/css/style.css',
  '/js/pwa.js',
  '/js/app.js',
  '/js/player.js',
  '/js/chat.js',
  '/js/account.js',
  '/js/subtitles.js',
  '/js/cineverse-bridge.js',
  '/manifest.webmanifest',
  '/icons/cineverse-192.png',
  '/icons/cineverse-512.png',
  '/icons/cineverse-maskable-512.png',
  '/icons/cineverse-icon.svg',
  '/icons/cineverse-maskable.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url))))
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          return (await caches.match(request))
            || (await caches.match(url.pathname.includes('player') ? '/player.html' : '/index.html'));
        })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
