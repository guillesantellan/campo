/* Service worker: es lo que hace que la app funcione sin internet.

   VERSION la reescribe herramientas/publicar.py en cada publicación. Cuando cambia, el
   navegador tira el caché viejo y se baja todo de nuevo: así el encuestador que ya tenía
   la app instalada recibe la corrección sin hacer nada (basta con abrirla con internet).

   Dos estrategias a propósito (igual que la app de los sábados):
   - el armazón (html, iconos, manifest) va de caché primero: abre instantáneo y anda sin señal.
   - los estudios van de red primero: si hay internet trae la última versión; si no, la guardada.
*/
const VERSION = "20260928210738";
const CACHE = "encuestas-" + VERSION;
const ARMAZON = ["./", "./index.html", "./estilos.css", "./comun.js", "./app.js",
                 "./receptor.html", "./receptor.js", "./manifest.webmanifest",
                 "./icono-192.png", "./icono-512.png", "./icono-180.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ARMAZON))
    .then(() => self.skipWaiting())
    .catch(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.includes("/estudios/")) {
    e.respondWith(
      fetch(req, {cache: "no-cache"}).then(r => {
        const copia = r.clone();
        caches.open(CACHE).then(c => c.put(req, copia));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req).then(r => {
      const copia = r.clone();
      caches.open(CACHE).then(c => c.put(req, copia));
      return r;
    }))
  );
});
