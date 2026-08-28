/* Service worker · v2
   HTML y manifest: primero la red (para que una versión nueva llegue siempre).
   Librerías del CDN: primero la caché (para abrir sin señal). */
const CACHE = 'ot-ia-v7';
const BASE = self.registration.scope;
const CDN = [
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.24.7/babel.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.add(BASE + 'index.html').catch(() => {});
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: 'no-cors' })).catch(() => {})));
    self.skipWaiting();
  }));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = req.url;
  if (req.method !== 'GET') return;
  if (url.indexOf('script.google') !== -1 || url.indexOf('googleusercontent') !== -1) return;

  const esDocumento = req.mode === 'navigate' ||
    url.indexOf(BASE) === 0 && /\.(html|json)$/.test(url.split('?')[0]) ||
    url === BASE;

  if (esDocumento) {                       // red primero, caché de respaldo
    e.respondWith(
      fetch(req).then(res => {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(BASE + 'index.html', copia)).catch(() => {});
        return res;
      }).catch(() => caches.match(BASE + 'index.html'))
    );
    return;
  }

  e.respondWith(                            // caché primero para lo demás
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copia = res.clone();
      caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
      return res;
    }))
  );
});
