/* Een toestel dat al vastzit op een oude build moet zichzelf herstellen.

   Dit is het geval dat in september misging: sw.js was tussen twee
   opleveringen byte voor byte gelijk, dus de browser zag geen nieuwe service
   worker, draaide geen activate, ruimde geen cache op, en serveerde app.js
   voorgoed uit budget-v7-shell. De telefoon bleef op de oude build staan
   terwijl de pc allang bij was.

   De test bouwt die oude build na, laat een echte browser hem installeren,
   verwisselt daarna de map onder dezelfde server, en eist dat er zonder
   enige handeling van de gebruiker een nieuwe versie op het scherm komt. */

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'budget');
const fails = [], ok = [];
const check = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  <<< ' + JSON.stringify(x)));

/* De service worker zoals hij wás: eigen bestanden alleen uit de cache, nooit
   verversen. Bewust voluit hier neergezet in plaats van uit git gehaald, zodat
   deze test niet aan een commit vastzit. */
const OLD_SW = `
const VERSION = "budget-v7";
const SHELL = VERSION + "-shell";
const RUNTIME = VERSION + "-runtime";
const SHELL_FILES = ["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c =>
    Promise.all(SHELL_FILES.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => null)))));
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match("./index.html");
      const fresh = fetch(req).then(r => { if (r && r.ok) cache.put("./index.html", r.clone()); return r; }).catch(() => null);
      return cached || (await fresh) || new Response("<h1>Offline</h1>", { headers: { "Content-Type": "text/html" } });
    })());
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;                 /* hier zat de klem */
      try {
        const r = await fetch(req);
        if (r && r.ok) (await caches.open(RUNTIME)).put(req, r.clone());
        return r;
      } catch (err) { return Response.error(); }
    })());
  }
});
`;

/* De oude build: dezelfde app, maar met adressen zonder versienummer en met
   de service worker van hierboven. */
function buildOld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-oud-'));
  fs.cpSync(SRC, dir, { recursive: true });
  const strip = f => {
    const p = path.join(dir, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\?v=\d+/g, ''));
  };
  strip('index.html');
  fs.writeFileSync(path.join(dir, 'sw.js'), OLD_SW);
  const app = path.join(dir, 'app.js');
  fs.writeFileSync(app, fs.readFileSync(app, 'utf8')
    .replace(/const APP_VERSION="[^"]*";/, 'const APP_VERSION="v7 · oude build";'));
  return dir;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png'
};

(async () => {
  const oldDir = buildOld();
  let root = oldDir;                              /* de map die geserveerd wordt */

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        /* zoals netlify.toml en _headers het live ook doen */
        'Cache-Control': 'public, max-age=0, must-revalidate'
      });
      res.end(body);
    });
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  /* Eén context van begin tot eind: de service worker en zijn caches horen bij
     het profiel, net als op de telefoon van een gebruiker. */
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  const version = async () => {
    if (!(await page.isVisible('#menuveil.open'))) await page.click('#menuBtn');
    const v = await page.textContent('#appVer');
    await page.keyboard.press('Escape');
    return v;
  };
  const cacheNames = () => page.evaluate(() => window.caches.keys());
  const boot = async () => {
    await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0,
      null, { timeout: 8000 });
  };

  // ---- 1. de oude build installeren, precies zoals hij op een telefoon stond
  await page.goto(URL_);
  await boot();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8000 });
  // de schil wordt tijdens install gevuld; even wachten tot app.js erin zit
  await page.waitForFunction(async () => {
    const c = await window.caches.open('budget-v7-shell');
    return (await c.keys()).some(r => new URL(r.url).pathname.endsWith('/app.js'));
  }, null, { timeout: 8000 });

  check('vooraf: de oude service worker bedient de pagina',
    (await cacheNames()).includes('budget-v7-shell'), await cacheNames());
  check('vooraf: de lade meldt de oude versie', (await version()) === 'v7 · oude build', await version());

  // ---- 2. de nieuwe build komt live, zonder dat de gebruiker iets doet
  root = SRC;

  // Eerste opening na de deploy. De oude worker geeft index.html uit zijn
  // cache en haalt de nieuwe pas op de achtergrond binnen, dus hier hoort
  // nog de oude versie te staan. Dat is geen fout, dat is de klem zelf.
  await page.goto(URL_);
  await boot();
  const na1 = await version();
  console.log('  info  na de eerste opening staat er: ' + na1);

  // Tweede opening. Nu serveert de oude worker de nieuwe index.html, en die
  // vraagt app.js?v=8. Een ander adres is een andere sleutel, dus de cache
  // mist en het bestand komt vers van de server.
  await page.goto(URL_);
  await boot();
  const na2 = await version();
  check('herstel: na twee openingen draait de nieuwe versie', /v8/.test(na2), na2);
  check('herstel: en dat zonder de knop Vernieuwen aan te raken', /v8/.test(na2), na2);

  // ---- 3. de nieuwe service worker neemt het over
  // app.js vraagt de browser uitdrukkelijk om naar een nieuwe sw.js te kijken.
  // Zonder die aanroep gebeurt dat niet: gemeten in Chromium werd sw.js na een
  // deploy geen enkele keer opnieuw opgevraagd, en bleef de oude cache staan.
  // Met opzet een eigen lus in plaats van waitForFunction: die herhaalt een
  // async voorwaarde met caches.keys() niet betrouwbaar.
  for (let i = 0; i < 20; i++) {
    if ((await cacheNames()).some(n => n.startsWith('budget-v8'))) break;
    await page.waitForTimeout(1000);
  }
  const left = await cacheNames();
  console.log('  info  caches na herstel: ' + JSON.stringify(left));
  check('herstel: de nieuwe service worker heeft zichzelf gecachet',
    left.some(k => k.startsWith('budget-v8')), left);

  // De melding hoort te zeggen dat er een nieuwe versie klaarstaat, en geen
  // alarm te slaan over de oude cache die ernaast ligt.
  const note = await page.evaluate(async () => {
    document.getElementById('menuBtn').click();
    await new Promise(r => setTimeout(r, 600));
    const el = document.getElementById('swNote');
    return { tekst: el.textContent, alarm: el.classList.contains('warn') };
  });
  console.log('  info  melding in de lade: ' + note.tekst);
  check('herstel: geen vals alarm over de oude cache', note.alarm === false, note);
  await page.keyboard.press('Escape');

  // ---- 4. en de app doet het gewoon nog
  check('herstel: de app werkt en toont een maand',
    (await page.textContent('#mname')).length > 3, await page.textContent('#mname'));
  check('geen fouten in de console', errors.length === 0, errors);

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);

  await browser.close();
  server.close();
  fs.rmSync(oldDir, { recursive: true, force: true });
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
