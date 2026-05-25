const CACHE_NAME = 'agent-network-dashboard-shell-v1';
const SHELL_URLS = ['/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') return;
  if (req.headers.get('accept')?.includes('text/event-stream')) return;
  if (!url.pathname.startsWith('/_next/') && !url.pathname.endsWith('.svg') && !url.pathname.endsWith('.png')) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => undefined);
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
