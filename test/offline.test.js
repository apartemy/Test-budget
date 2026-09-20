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

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
