importScripts('./asset-manifest.js');
const BASE = new URL('./', self.location.href);
const PREFIX = 'domus3:' + BASE.pathname + ':';
const CACHE = PREFIX + self.DOMUS3_BUILD;
const ASSETS = self.DOMUS3_ASSETS.map(file => new URL(file, BASE).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (!BASE.pathname.endsWith('/domus-3/')) throw new Error('DOMUS 3 requiere su directorio independiente /domus-3/');
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  // Only static shell assets; no API responses, documents or token-bearing cache keys.
  const asset = new URL(url.pathname === BASE.pathname ? 'index.html' : url.pathname, BASE).href;
  if (!ASSETS.includes(asset)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), stored = await cache.match(asset);
    if (stored) return stored;
    return fetch(request);
  })());
});
