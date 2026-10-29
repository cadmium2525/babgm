importScripts('./range.js');
const CACHE = 'yoru-bgm-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './range.js', './fade-worker.js', './audio/water.wav', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('yoru-bgm-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(url.href, {ignoreSearch: true});
    if (cached) return cachedMediaResponse(cached, request.headers.get('Range'));
    try { return await fetch(request); }
    catch (error) {
      if (request.mode === 'navigate' && url.pathname.startsWith(new URL(self.registration.scope).pathname)) return await cache.match('./index.html');
      throw error;
    }
  })());
});
