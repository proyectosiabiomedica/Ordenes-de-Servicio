/* Service worker · ot-ia-v41

   Abrir la app: primero la copia guardada, al instante, y la red se consulta en
   segundo plano para la siguiente vez. Antes era al revés —red primero— y con
   una red inestable la petición podía quedarse colgada sin fallar: pantalla en
   blanco aunque hubiera una copia buena en el teléfono.

   La primera apertura no tiene copia, así que depende de la red. Por eso todo
   viene en un solo archivo: una descarga a un servidor, sin librerías externas. */
const CACHE = 'ot-ia-v41';
const BASE = self.registration.scope;
const PROPIOS = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(PROPIOS.map(f => c.add(BASE + f).catch(() => {})))));
});

// La app avisa de la versión nueva y, si el ingeniero acepta, pide el relevo
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

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const guardada = await cache.match(BASE + 'index.html');
      const red = fetch(req).then(res => {
        if (res && res.ok) cache.put(BASE + 'index.html', res.clone());
        return res;
      });
      if (guardada) {
        e.waitUntil(red.catch(() => {}));      // refrescar sin hacer esperar a nadie
        return guardada;
      }
      return red;                               // primera vez: no hay otra opción
    })());
    return;
  }

  // Archivos propios (iconos, manifest): caché primero, cada uno bajo su URL
  if (url.indexOf(BASE) === 0) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {});
        }
        return res;
      }))
    );
  }
});
