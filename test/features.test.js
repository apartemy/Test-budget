/* Wat in de tweede ronde is toegevoegd: boekingen bij hun eigen maand, de
   weekendregel voor vaste lasten, de weergavekeuze, de exportherinnering,
   vegen tussen maanden en de eigen bevestigingsvensters. */
const { chromium } = require('playwright');

const URL = process.env.BUDGET_URL || 'http://127.0.0.1:8765/index.html';
const fails = [], ok = [];
const check = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  <<< ' + JSON.stringify(x)));

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
  'augustus', 'september', 'oktober', 'november', 'december'];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  const boot = async seed => {
    await page.goto(URL);
    await page.evaluate(s => {
      localStorage.clear();
      if (s) localStorage.setItem('budget_v8', JSON.stringify(s));
    }, seed || null);
    await page.goto(URL);
    await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);
  };
  const monthLabel = () => page.textContent('#mname');
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('budget_v8')));

  // ---- a booking lands in the month of its own date, not the month on screen
  await boot();
  const { thisMonth, nextMonth, nextKey } = await page.evaluate(() => {
    const n = new Date();
    const nx = new Date(n.getFullYear(), n.getMonth() + 1, 15);
    const p = x => String(x).padStart(2, '0');
    return {
      thisMonth: n.getFullYear() + '_' + p(n.getMonth() + 1),
      nextMonth: nx.getFullYear() + '-' + p(nx.getMonth() + 1) + '-15',
      nextKey: nx.getFullYear() + '_' + p(nx.getMonth() + 1)
    };
  });
  // De kiezer laat de lopende maand niet meer los, dus er kan niets meer
  // buiten beeld terechtkomen.
  await page.click('#txDate');
  check('datumkiezer: geen maandpijlen bij het boeken',
    (await page.locator('#cPrev').evaluate(el => getComputedStyle(el).visibility)) === 'hidden');
  check('datumkiezer: de kalender staat op de huidige maand',
    (await page.textContent('#cTitle')).includes(MONTHS[new Date().getMonth()]), await page.textContent('#cTitle'));
  check('datumkiezer: geen enkele dag uit een andere maand te kiezen',
    (await page.locator('.cal button[data-iso]').evaluateAll(
      (els, m) => els.every(e => e.dataset.iso.slice(0, 7) === m), thisMonth.replace('_', '-'))));
  await page.click('.cal button[data-iso$="-15"]');
  await page.fill('#txDesc', 'Deze maand');
  await page.fill('#txAmt', '25');
  await page.click('#txAdd');
  const s1 = await stored();
  check('tx date: geboekt in de maand op het scherm', !!(s1.months[thisMonth] || {}).tx?.length, Object.keys(s1.months));
  check('tx date: niets in een andere maand beland', !(s1.months[nextKey] || { tx: [] }).tx.length, s1.months[nextKey]);
  check('tx date: de boeking is gewoon zichtbaar', (await page.textContent('#txList')).includes('Deze maand'));

  // ---- old data that was filed under the wrong month gets moved on load
  const stray = {
    v: 8, income: [], expenses: [], savings: [], categories: [{ id: 'c1', label: 'Test', budget: 0 }],
    months: {
      '2026_01': {
        start: null, paid: {}, recv: {}, exc: {}, skip: {}, oneoff: [],
        tx: [{ id: 'a', label: 'Hoort in maart', amount: 10, cat: 'c1', date: '2026-03-04', pay: 'digital' },
             { id: 'b', label: 'Hoort hier', amount: 20, cat: 'c1', date: '2026-01-09', pay: 'digital' }]
      }
    }
  };
  await boot(stray);
  const s2 = await stored();
  check('migration: stray booking moved to March', (s2.months['2026_03'] || { tx: [] }).tx.map(t => t.id).join() === 'a', s2.months['2026_03']);
  check('migration: the right one stayed in January', s2.months['2026_01'].tx.map(t => t.id).join() === 'b', s2.months['2026_01'].tx);

  // ---- weekend rule now also applies to fixed costs
  await boot();
  await page.click('#addExpR');
  await page.fill('#pLabel', 'Hypotheek');
  await page.fill('#pAmount', '1200');
  await page.click('#pDay');
  await page.click('.cal button[data-day="1"]');
  check('weekend: the rule is offered for a fixed cost', await page.isVisible('#fShift'));
  await page.click('#segSY');
  await page.click('#pSave');
  check('weekend: the row says it shifts', (await page.textContent('#expList')).includes('schuift bij weekend'));
  const s3 = await stored();
  check('weekend: stored on the expense', s3.expenses[0].shift === true, s3.expenses[0]);
  // en de datum die de app toont valt niet in het weekend
  const weekday = await page.evaluate(() => {
    const sub = document.querySelector('#expList .rsub').textContent;
    const day = parseInt(sub, 10);
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), day).getDay();
  });
  check('weekend: the shown date is a weekday', weekday !== 0 && weekday !== 6, weekday);

  // ---- display setting
  await page.click('#menuBtn');
  check('theme: system is the default', (await page.getAttribute('#thSystem', 'class')).includes('on'));
  await page.click('#thDark');
  check('theme: attribute set', (await page.getAttribute('html', 'data-theme')) === 'dark');
  const deep = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('theme: meta colour follows', (await page.getAttribute('#themeColor', 'content')).toLowerCase() === '#210710',
    await page.getAttribute('#themeColor', 'content'));
  await page.click('#thLight');
  const standard = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('theme: standard differs from deep', standard !== deep, [standard, deep]);
  check('theme: meta colour follows again', (await page.getAttribute('#themeColor', 'content')).toLowerCase() === '#2e0b14');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);
  check('theme: survives a reload', (await page.getAttribute('html', 'data-theme')) === 'light');
  await page.click('#menuBtn');
  await page.click('#thSystem');
  check('theme: system clears the attribute', (await page.getAttribute('html', 'data-theme')) === null);

  // ---- export reminder
  // Het bolletje staat voor alles wat nog moet gebeuren, dus eerst de
  // openstaande vaste last afvinken; wat overblijft gaat puur over exporteren.
  await page.click('#menuClose');
  await page.click('#expList .check');
  await page.click('#menuBtn');
  check('export: nudge shows while nothing was exported', await page.isVisible('#setNudge'));
  check('export: note says never', (await page.textContent('#exportNote')).includes('Nog nooit'), await page.textContent('#exportNote'));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('budget_v8'));
    s.lastExport = new Date().toISOString().slice(0, 10);
    localStorage.setItem('budget_v8', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);
  await page.click('#menuBtn');
  check('export: nudge gone after exporting', !(await page.isVisible('#setNudge')));
  check('export: note shows the date', (await page.textContent('#exportNote')).includes('Laatst geëxporteerd'));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('budget_v8'));
    const d = new Date(); d.setDate(d.getDate() - 95);
    s.lastExport = d.toISOString().slice(0, 10);
    localStorage.setItem('budget_v8', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);
  await page.click('#menuBtn');
  check('export: nudge returns when it goes stale', await page.isVisible('#setNudge'));

  // ---- wipe asks in the app, not through the browser
  let nativeDialog = false;
  page.on('dialog', async d => { nativeDialog = true; await d.dismiss(); });
  await page.click('#wipeBtn');
  check('wipe: asks in an in-app dialog', await page.isVisible('#askveil.open'));
  check('wipe: no browser confirm used', !nativeDialog);
  await page.click('#askNo');
  check('wipe: cancelling keeps the data', (await page.textContent('#expList')).includes('Hypotheek'));
  await page.click('#wipeBtn');
  await page.keyboard.press('Escape');
  check('wipe: Escape also cancels', !(await page.isVisible('#askveil.open')) && (await page.textContent('#expList')).includes('Hypotheek'));
  await page.click('#wipeBtn');
  await page.click('#askYes');
  check('wipe: confirming clears the data', (await page.textContent('#expList')).includes('Nog geen vaste lasten'));
  await page.click('#toastAct');
  check('wipe: undo brings it back', (await page.textContent('#expList')).includes('Hypotheek'));

  check('no page errors', errors.length === 0, errors);

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
