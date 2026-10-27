const CACHE_PREFIX = 'traxing-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_FILES = [
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/bybit.js',
  './src/indicators.js',
  './src/chart.js',
  './src/forecast-journal.js',
  './icons/traxing-192.png',
  './icons/traxing-512.png',
];

function scopedUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES.map(scopedUrl));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      const cachedResponse = await cache.match(request);
      if (cachedResponse) return cachedResponse;
      if (request.mode === 'navigate') {
        return (await cache.match(scopedUrl('./index.html'))) || Response.error();
      }
      return Response.error();
    }
  })());
});
