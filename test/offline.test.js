const { chromium } = require('playwright');
const URL = process.env.BUDGET_URL || 'http://127.0.0.1:8765/index.html';
const fails = [], ok = [];
const check = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  <<< ' + JSON.stringify(x)));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || true);

  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, active: !!r.active };
  });
  check('sw: registered and active', reg.active, reg);

  // De verwachte cachenaam komt uit sw.js zelf, zodat een versieverhoging
  // deze test niet omvergooit.
  const version = await page.evaluate(async u => {
    const src = await (await fetch(new URL('sw.js', u).href)).text();
    return src.match(/VERSION\s*=\s*"([^"]+)"/)[1];
  }, URL);
  const shell = version + '-shell';

  // ---- de twee versienummers mogen niet uit de pas lopen
  // APP_VERSION staat onderin de instellingenlade, VERSION bepaalt de
  // cachenaam. Verhoog ik er één en de ander niet, dan kijkt de gebruiker
  // later naar een cijfer dat niet klopt. Liever hier omvallen.
  const appVersion = await page.evaluate(async u => {
    const src = await (await fetch(new URL('app.js', u).href)).text();
    const m = src.match(/APP_VERSION\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  }, URL);
  check('versie: app.js noemt een APP_VERSION', !!appVersion, appVersion);
  const num = s => { const m = /v(\d+)/.exec(s || ''); return m ? m[1] : null; };
  check('versie: app.js en sw.js noemen hetzelfde nummer',
    num(appVersion) !== null && num(appVersion) === num(version),
    { appVersion, swVersion: version });

  // ---- en die versie is ook echt te zien in de lade
  await page.click('#menuBtn');
  check('versie: de lade toont de versie', (await page.textContent('#appVer')) === appVersion,
    await page.textContent('#appVer'));
  await page.waitForFunction(() => document.getElementById('swNote').textContent.length > 0,
    null, { timeout: 4000 }).catch(() => {});
  const swNote = await page.textContent('#swNote');
  check('versie: de regel over de service worker meldt dezelfde versie',
    swNote.includes(version.replace(/^budget-/, '')), swNote);
  check('versie: geen waarschuwing als alles gelijk loopt',
    !(await page.evaluate(() => document.getElementById('swNote').classList.contains('warn'))), swNote);
  check('versie: er staat een knop Vernieuwen', await page.isVisible('#swRefresh'));
  await page.keyboard.press('Escape');

  const caches = await page.evaluate(() => window.caches.keys());
  check('sw: shell cache for the current version exists', caches.includes(shell), { caches, shell });
  check('sw: no cache from another version left', !caches.some(c => !c.startsWith(version)), caches);

  const cached = await page.evaluate(async name => {
    const c = await window.caches.open(name);
    const keys = await c.keys();
    return keys.map(r => new URL(r.url).pathname);
  }, shell);
  for (const f of ['/index.html', '/app.css', '/app.js', '/manifest.webmanifest']) {
    check('sw: shell holds ' + f, cached.includes(f), cached);
  }

  // ---- offline: the app must still boot and keep its data
  await page.evaluate(() => localStorage.setItem('budget_v8', JSON.stringify({
    v: 8, income: [{ id: 'x', label: 'OfflineBron', amount: 10, day: 1, kind: 'digital' }],
    expenses: [], categories: [], savings: [], months: {}
  })));
  await ctx.setOffline(true);
  await page.goto(URL);
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0, null, { timeout: 8000 });
  check('offline: app boots from cache', (await page.textContent('#incList')).includes('OfflineBron'));
  check('offline: stylesheet applied', await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'));
  await ctx.setOffline(false);

  // ---- een achtergebleven cache wordt gemeld en is weg te krijgen
  // Dit is precies het geval dat van buitenaf op een verkeerd bestand lijkt:
  // de app draait v7, maar er hangt nog een oudere cache. De lade hoort dat
  // te melden, en "Vernieuwen" hoort hem op te ruimen zonder gegevensverlies.
  await page.evaluate(() => window.caches.open('budget-v1-shell'));
  await page.click('#menuBtn');
  await page.waitForFunction(() => document.getElementById('swNote').classList.contains('warn'),
    null, { timeout: 4000 }).catch(() => {});
  const warnNote = await page.textContent('#swNote');
  check('versie: een achtergebleven cache wordt gemeld', warnNote.includes('v1'), warnNote);
  check('versie: en als waarschuwing',
    await page.evaluate(() => document.getElementById('swNote').classList.contains('warn')), warnNote);

  await page.click('#swRefresh');
  // De knop herlaadt de pagina; wachten tot dat klaar is, anders lees je de
  // oude pagina uit die al aan het verdwijnen is.
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }),
    page.click('#askYes')
  ]);
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0,
    null, { timeout: 8000 });
  const left = await page.evaluate(() => window.caches.keys());
  check('vernieuwen: de oude cache is opgeruimd', !left.includes('budget-v1-shell'), left);
  check('vernieuwen: de gegevens staan er nog',
    (await page.textContent('#incList')).includes('OfflineBron'), await page.textContent('#incList'));

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
