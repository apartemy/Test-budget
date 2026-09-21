/* Budget service worker
   Strategie:
   - app shell wordt bij installatie in de cache gezet
   - navigaties: eerst cache, daarna op de achtergrond verversen
   - lettertypen van Google: runtime cache, faalt stil zonder internet
   Verhoog VERSION bij elke deploy zodat de oude cache wordt opgeruimd. */

const VERSION = "budget-v6";
const SHELL = VERSION + "-shell";
const RUNTIME = VERSION + "-runtime";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-32.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL).then(cache =>
      /* per bestand, zodat één misser de hele installatie niet sloopt */
      Promise.all(SHELL_FILES.map(url =>
        cache.add(new Request(url, { cache: "reload" })).catch(() => null)
      ))
    )
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

function isFontHost(url) {
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  /* navigatie: cache eerst, netwerk op de achtergrond */
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match("./index.html");
      const fresh = fetch(req).then(res => {
        if (res && res.ok) cache.put("./index.html", res.clone());
        return res;
      }).catch(() => null);
      return cached || (await fresh) || new Response(
        "<h1>Offline</h1><p>Open de app eerst een keer met internet.</p>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    })());
    return;
  }

  /* lettertypen en eigen bestanden: cache eerst, anders netwerk en bewaren */
  if (url.origin === self.location.origin || isFontHost(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(RUNTIME);
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return cached || Response.error();
      }
    })());
  }
});
