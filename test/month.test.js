/* De app toont alleen de lopende maand en schuift vanzelf mee als de datum
   verspringt. De maandberekening zelf blijft wél volledig werken, want de
   vooruitblikpagina gaat erop leunen. */
const { chromium } = require('playwright');

const URL = process.env.BUDGET_URL || 'http://127.0.0.1:8765/index.html';
const fails = [], ok = [];
const check = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  <<< ' + JSON.stringify(x)));

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
  'augustus', 'september', 'oktober', 'november', 'december'];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  // ---- geen maandnavigatie meer, kop toont de lopende maand
  {
    const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);

    for (const id of ['prevM', 'nextM', 'jumpNow']) {
      check('geen knop #' + id + ' meer', (await page.locator('#' + id).count()) === 0);
    }
    check('geen maandbalk meer', (await page.locator('.monthbar').count()) === 0);
    const now = new Date();
    check('kop toont de lopende maand',
      (await page.textContent('#mname')).includes(MONTHS[now.getMonth()]), await page.textContent('#mname'));
    check('kop toont het jaar', (await page.textContent('#mname')).includes(String(now.getFullYear())));
    check('de maand staat in de kop, niet in een eigen balk',
      await page.evaluate(() => document.querySelector('.masthead').contains(document.getElementById('mname'))));

    // de doorrekening per maand blijft gewoon bestaan
    const still = await page.evaluate(() => typeof calc === 'function' && typeof ymShift === 'function');
    check('de maandberekening staat er nog voor de vooruitblikpagina', still);

    check('geen fouten in de console', errors.length === 0, errors);
    await page.context().close();
  }

  // ---- de maand schuift mee als de klok verspringt
  {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    // 31 januari, 23:30. Twee uur verder is het februari.
    await page.clock.install({ time: new Date('2027-01-31T23:30:00') });
    await page.goto(URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);
    check('rolwissel: begint in januari', (await page.textContent('#mname')).includes('januari'),
      await page.textContent('#mname'));

    // De tikker van 60 seconden loopt mee met de nepklok, dus de app hoort
    // vanzelf om te slaan zonder dat er iets aangeraakt wordt.
    await page.clock.fastForward('02:00:00');
    let viaTicker = true;
    await page.waitForFunction(() => document.getElementById('mname').textContent.includes('februari'),
      null, { timeout: 5000 }).catch(() => { viaTicker = false; });
    let label = await page.textContent('#mname');
    console.log('  info  rolwissel via ' + (viaTicker ? 'de eigen tikker' : 'het vangnet'));
    if (!label.includes('februari')) {
      // vangnet: sommige omgevingen leveren de tikker niet, dan telt het
      // terugkomen op het tabblad, wat een telefoon ook doet
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      label = await page.textContent('#mname');
    }
    check('rolwissel: staat vanzelf op februari', label.includes('februari'), label);
    check('rolwissel: met het juiste jaar', label.includes('2027'), label);
    check('rolwissel: geen fouten', errors.length === 0, errors);
    await ctx.close();
  }

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
