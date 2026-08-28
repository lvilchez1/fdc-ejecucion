/*
  Service worker mínimo: solo cachea el "cascarón" de la app (HTML/CSS/JS/íconos)
  para que abra rápido incluso con señal débil dentro de un local.
  NO cachea llamadas al backend (Apps Script): esas siempre van a la red,
  para no mostrar nunca listas de clientes/SKUs desactualizadas ni fingir
  que un envío se guardó cuando no hay conexión real.
*/
const CACHE_NAME = "fdc-ejecucion-shell-v1";
const SHELL_FILES = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./assets/logo-white.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL_FILES); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  const isShellFile = SHELL_FILES.some(function (f) { return url.pathname.endsWith(f.replace("./", "/")); });
  if (!isShellFile) return; // deja pasar directo a la red (backend, geolocalización, etc.)

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      const network = fetch(event.request).then(function (resp) {
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, resp.clone()); });
        return resp;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
