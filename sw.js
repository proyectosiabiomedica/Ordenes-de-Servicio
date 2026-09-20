/* ============================================================================
 *  INGENIEROS ASOCIADOS — Service Worker de la plataforma        sw.js  v3.4
 * ----------------------------------------------------------------------------
 *  Qué resuelve:
 *
 *   1. INSTALACIÓN. Permite agregar la plataforma a la pantalla de inicio del
 *      teléfono o al escritorio, y abrirla como aplicación, sin barra del
 *      navegador.
 *
 *   2. RED DE HOSPITAL. Las librerías externas (Tailwind, Chart.js, PapaParse,
 *      la tipografía) quedan guardadas en el equipo tras la primera visita. Si
 *      el hospital bloquea o ralentiza esos dominios —cosa que pasa—, la
 *      plataforma sigue abriendo con la copia local.
 *
 *   3. TRABAJO SIN SEÑAL. Las hojas de datos se sirven primero de la red y, si
 *      no hay conexión, de la última copia guardada. El ingeniero en un sótano
 *      abre la aplicación y ve la información de la última sincronización, con
 *      el aviso correspondiente en pantalla.
 *
 *  Qué NO hace, a propósito:
 *   · No guarda respuestas de envíos (POST): dar de alta usuarios, mandar
 *     correos o guardar seguimientos siempre exige conexión real. Servir una
 *     respuesta vieja de esas operaciones sería peligroso.
 *   · No sirve una versión vieja de la página cuando hay red: la página
 *     siempre se busca primero en línea, para que una actualización llegue
 *     el mismo día. La copia local es el respaldo, no la fuente.
 * ==========================================================================*/

const VERSION = 'v4.2';
const CACHE_APP    = 'ia-app-' + VERSION;     // la página y sus iconos
const CACHE_LIBS   = 'ia-libs-' + VERSION;    // librerías externas
const CACHE_DATOS  = 'ia-datos-' + VERSION;   // últimas hojas descargadas

const ARCHIVOS_APP = [
  './',
  './index.html',
  './manifest.json',
  './icono-192.png',
  './icono-512.png',
  './icono-maskable-512.png',
  './apple-touch-icon.png'
];

const LIBRERIAS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'
];

/* v3.9: SheetJS se carga solo al exportar a Excel, así que no va en la
   precarga: se guarda en el mismo caché la primera vez que se use, y de ahí
   en adelante la exportación funciona aunque el hospital bloquee el dominio.
   (El interceptor de librerías ya cubre cdnjs, así que no hace falta más.) */

/* ------------------------------ INSTALACIÓN ----------------------------- */

self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cacheApp = await caches.open(CACHE_APP);
    // Uno por uno: si un archivo falta, no debe tumbar toda la instalación
    await Promise.all(ARCHIVOS_APP.map(async (url) => {
      try { await cacheApp.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[SW] no se pudo guardar', url, e); }
    }));

    const cacheLibs = await caches.open(CACHE_LIBS);
    await Promise.all(LIBRERIAS.map(async (url) => {
      try {
        const r = await fetch(url, { mode: 'cors' });
        if (r.ok) { await cacheLibs.put(url, r.clone()); return; }
      } catch (e) { /* se intenta sin CORS abajo */ }
      try {
        const r2 = await fetch(url, { mode: 'no-cors' });
        await cacheLibs.put(url, r2.clone());
      } catch (e) { console.warn('[SW] librería no guardada', url); }
    }));
  })());
});

/* -------------------------------- ACTIVACIÓN ---------------------------- */

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.map((n) => {
      const vigente = (n === CACHE_APP || n === CACHE_LIBS || n === CACHE_DATOS);
      return vigente ? null : caches.delete(n);
    }));
    await self.clients.claim();
  })());
});

// La página pide activar la versión nueva cuando el usuario acepta
self.addEventListener('message', (evento) => {
  if (evento.data === 'ACTIVAR_AHORA') self.skipWaiting();
});

/* --------------------------------- UTILES ------------------------------- */

const esDatos = (url) =>
  url.hostname.indexOf('docs.google.com') > -1 ||
  url.hostname.indexOf('script.google.com') > -1 ||
  url.hostname.indexOf('script.googleusercontent.com') > -1;

const esLibreria = (url) =>
  url.hostname.indexOf('cdn.tailwindcss.com') > -1 ||
  url.hostname.indexOf('cdn.jsdelivr.net') > -1 ||
  url.hostname.indexOf('cdnjs.cloudflare.com') > -1 ||
  url.hostname.indexOf('fonts.googleapis.com') > -1 ||
  url.hostname.indexOf('fonts.gstatic.com') > -1;

/* La página agrega '&t=<milisegundos>' para saltarse el caché del navegador.
   Eso vuelve única cada dirección, así que sin normalizar nunca habría copia
   que servir sin señal y el almacenamiento crecería sin fin. Aquí se quitan
   los parámetros de refresco para que la llave sea siempre la misma. */
function llaveDatos(url) {
  const limpia = new URL(url.href);
  limpia.searchParams.delete('t');
  limpia.searchParams.delete('fresco');
  return limpia.href;
}

/* -------------------------------- PETICIONES ---------------------------- */

self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Los envíos nunca se guardan ni se responden desde copia
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. La página: primero la red, para que las actualizaciones lleguen solas
  if (req.mode === 'navigate') {
    evento.respondWith((async () => {
      try {
        const r = await fetch(req);
        const cache = await caches.open(CACHE_APP);
        cache.put('./index.html', r.clone());
        return r;
      } catch (e) {
        const cache = await caches.open(CACHE_APP);
        return (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               new Response('Sin conexión y sin copia guardada de la plataforma.',
                            { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // 2. Librerías externas: primero la copia local (arranque rápido y a prueba
  //    de bloqueos de red), y se refresca en segundo plano.
  if (esLibreria(url)) {
    evento.respondWith((async () => {
      const cache = await caches.open(CACHE_LIBS);
      const guardada = await cache.match(req, { ignoreVary: true });
      const enRed = fetch(req).then((r) => {
        if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
        return r;
      }).catch(() => null);
      return guardada || (await enRed) ||
             new Response('', { status: 504 });
    })());
    return;
  }

  // 3. Hojas de datos: primero la red; sin señal, la última copia
  if (esDatos(url)) {
    evento.respondWith((async () => {
      const cache = await caches.open(CACHE_DATOS);
      const llave = llaveDatos(url);
      try {
        const r = await fetch(req);
        if (r && r.ok) cache.put(llave, r.clone());
        return r;
      } catch (e) {
        const guardada = await cache.match(llave);
        if (guardada) return guardada;
        throw e;   // que la página muestre su propio aviso de error
      }
    })());
    return;
  }

  // 4. Resto de archivos propios (iconos): copia local si existe
  if (url.origin === self.location.origin) {
    evento.respondWith((async () => {
      const cache = await caches.open(CACHE_APP);
      const guardada = await cache.match(req);
      if (guardada) return guardada;
      try {
        const r = await fetch(req);
        if (r && r.ok) cache.put(req, r.clone());
        return r;
      } catch (e) {
        return new Response('', { status: 504 });
      }
    })());
  }
});
