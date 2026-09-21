/* Budget service worker
   Strategie:
   - app shell wordt bij installatie in de cache gezet
   - navigaties: eerst cache, daarna op de achtergrond verversen
   - lettertypen van Google: runtime cache, faalt stil zonder internet
   Verhoog VERSION bij elke deploy zodat de oude cache wordt opgeruimd. */

const VERSION = "budget-v8";
const SHELL = VERSION + "-shell";
const RUNTIME = VERSION + "-runtime";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.css?v=8",
  "./app.js?v=8",
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

  /* lettertypen en eigen bestanden: uit de cache, en tegelijk op de
     achtergrond verversen.
     Eerder stond hier "cache eerst en verder niets". Dat zette app.js en
     app.css voorgoed vast: zolang VERSION gelijk bleef draaide er geen
     activate, werd er geen cache opgeruimd, en kreeg het toestel dus nooit
     een nieuw bestand te zien. Nu is het antwoord nog steeds meteen uit de
     cache, maar de kopie in de cache loopt bij elke laadbeurt bij. */
  if (url.origin === self.location.origin || isFontHost(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const fresh = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          /* in de schil bijwerken als het bestand daar hoort, anders runtime,
             zodat een opgeruimde schil niet stilletjes leegloopt */
          caches.open(SHELL).then(async shell => {
            const target = (await shell.match(req)) ? shell : await caches.open(RUNTIME);
            target.put(req, copy);
          }).catch(() => {});
        }
        return res;
      }).catch(() => null);
      /* event.waitUntil houdt de verversing in leven als de cache het
         antwoord al heeft gegeven en de fetch nog loopt */
      event.waitUntil(fresh);
      return cached || (await fresh) || Response.error();
    })());
  }
});
