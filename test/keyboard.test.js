const { chromium } = require('playwright');
const URL = process.env.BUDGET_URL || 'http://127.0.0.1:8765/index.html';
const fails = [], ok = [];
const check = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  <<< ' + JSON.stringify(x)));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);

  const active = () => page.evaluate(() => document.activeElement.id || document.activeElement.className || document.activeElement.tagName);
  const locked = () => page.evaluate(() => document.body.classList.contains('locked'));

  // ---- panel: open, focus, scroll lock, Escape, focus restore
  await page.click('#addIncR');
  check('panel: focus moves into the dialog', (await active()) === 'panelBox', await active());
  check('panel: background scroll locked', await locked());
  check('panel: role=dialog', (await page.getAttribute('#panelBox', 'role')) === 'dialog');
  await page.keyboard.press('Escape');
  check('panel: Escape closes', !(await page.isVisible('#veil.open')));
  check('panel: scroll lock released', !(await locked()));
  check('panel: focus restored to opener', (await active()) === 'addIncR', await active());

  // ---- Tab stays inside the panel
  await page.click('#addIncR');
  const seen = new Set();
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); seen.add(await active()); }
  const escaped = await page.evaluate(() => !document.getElementById('panelBox').contains(document.activeElement));
  check('panel: Tab never leaves the dialog', !escaped, [...seen]);
  const backIn = await (async () => {
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+Tab');
    return page.evaluate(() => document.getElementById('panelBox').contains(document.activeElement));
  })();
  check('panel: Shift+Tab also stays inside', backIn);

  // ---- calendar stacks on top of the panel and returns focus to its own opener
  await page.click('#pDay');
  check('cal: focus moves into the calendar', (await active()) === 'calBox', await active());
  check('cal: still locked', await locked());
  await page.keyboard.press('Escape');
  check('cal: Escape closes the calendar only', !(await page.isVisible('#calveil.open')) && (await page.isVisible('#veil.open')));
  check('cal: focus back on the day button', (await active()) === 'pDay', await active());
  check('cal: lock stays while the panel is open', await locked());

  // ---- Enter submits the panel
  await page.fill('#pLabel', 'Toeslag');
  await page.fill('#pAmount', '300');
  await page.keyboard.press('Enter');
  check('panel: Enter saves', (await page.textContent('#incList')).includes('Toeslag'));
  check('panel: closed after Enter', !(await page.isVisible('#veil.open')));
  check('panel: lock released', !(await locked()));

  // ---- Enter submits the transaction form
  await page.fill('#txDesc', 'Koffie');
  await page.fill('#txAmt', '3,50');
  await page.keyboard.press('Enter');
  check('tx: Enter books the line', (await page.textContent('#txList')).includes('Koffie'));
  check('tx: focus returns to the description field', (await active()) === 'txDesc', await active());

  // ---- toast is announced
  check('toast: aria-live', (await page.getAttribute('#toast', 'aria-live')) === 'polite');

  // ---- clicking the backdrop still closes and unlocks
  await page.click('#addCat');
  await page.mouse.click(210, 60);
  check('backdrop: click closes the panel', !(await page.isVisible('#veil.open')));
  check('backdrop: lock released', !(await locked()));

  check('no page errors', errors.length === 0, errors);

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
