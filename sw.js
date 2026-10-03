/* Service worker · ot-ia-v39
   Navegación: red primero, con el index.html de la caché como respaldo sin señal.
   Todo lo demás: caché primero, guardado SIEMPRE bajo su propia URL.

   Corrige una falla seria de v34: el manifest.json se trataba como documento y su
   contenido se guardaba bajo la llave del index.html, de modo que sin señal la app
   mostraba el JSON del manifest en lugar de la aplicación. */
const CACHE = 'ot-ia-v39';
const BASE = self.registration.scope;
const PROPIOS = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];
// La app ya viene compilada: solo hacen falta React y ReactDOM (antes también
// Babel, de casi 3 MB, que con datos móviles impedía abrir la primera vez).
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await Promise.all(PROPIOS.map(f => c.add(BASE + f).catch(() => {})));
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: 'no-cors' })).catch(() => {})));
  }));
});

// La app avisa y, si el ingeniero acepta, pide el relevo con este mensaje
self.addEventListener('message', e => {
  if (e.data === 'actualizar') self.skipWaiting();
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

  // Solo una navegación real puede refrescar la copia del index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(BASE + 'index.html', copia)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(BASE + 'index.html').then(r => r || caches.match(BASE)))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
      }
      return res;
    }).catch(() => hit))
  );
});
