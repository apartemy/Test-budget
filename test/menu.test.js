/* De instellingenlade: openen met de hamburger of een veeg vanaf de
   linkerrand, sluiten met de knop, de sluier, Escape of een veeg naar links,
   en alle instellingen die erin zitten. */
const { chromium } = require('playwright');

const URL = process.env.BUDGET_URL || 'http://127.0.0.1:8765/index.html';
const fails = [], ok = [];
const check = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  <<< ' + JSON.stringify(x)));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);

  const open = () => page.isVisible('#menuveil.open');
  const locked = () => page.evaluate(() => document.body.classList.contains('locked'));
  const active = () => page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
  // Playwright kent geen veeggebaar, dus stuur de twee aanrakingen zelf.
  const swipe = async (x0, x1, target = '.wrap', y1 = 300) => {
    await page.evaluate(([x0, x1, sel, y1]) => {
      const el = document.querySelector(sel);
      const at = (x, y) => [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })];
      el.dispatchEvent(new TouchEvent('touchstart', { touches: at(x0, 300), changedTouches: at(x0, 300), bubbles: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: at(x1, y1), bubbles: true }));
    }, [x0, x1, target, y1]);
  };

  // ---- openen en sluiten met de knop
  // De maandknop moet zijn maand ook aan een schermlezer noemen; een vaste
  // aria-label zou die tekst juist wegduwen.
  const mLabel = await page.getAttribute('#mname', 'aria-label');
  const nu = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli',
    'augustus', 'september', 'oktober', 'november', 'december'][new Date().getMonth()];
  check('maandknop: de naam noemt de maand', (mLabel || '').includes(nu), mLabel);
  check('maandknop: en zegt dat je kunt kiezen', /kiez/i.test(mLabel || ''), mLabel);
  await page.click('#nextM');
  check('maandknop: de naam schuift mee', !(await page.getAttribute('#mname', 'aria-label')).includes(nu + ' '),
    await page.getAttribute('#mname', 'aria-label'));
  await page.click('#jumpNow');

  check('lade: begint dicht', !(await open()));
  check('hamburger: aria-expanded staat uit', (await page.getAttribute('#menuBtn', 'aria-expanded')) === 'false');
  await page.click('#menuBtn');
  check('lade: hamburger opent hem', await open());
  check('hamburger: aria-expanded staat aan', (await page.getAttribute('#menuBtn', 'aria-expanded')) === 'true');
  check('lade: focus zit in het venster', (await active()) === 'menuBox', await active());
  check('lade: achtergrond op slot', await locked());
  check('lade: schuift van links in', (await page.locator('#menuBox').boundingBox()).x < 2,
    await page.locator('#menuBox').boundingBox());
  check('lade: role=dialog', (await page.getAttribute('#menuBox', 'role')) === 'dialog');

  await page.click('#menuClose');
  check('lade: kruisje sluit hem', !(await open()));
  check('lade: slot eraf', !(await locked()));
  check('lade: focus terug op de hamburger', (await active()) === 'menuBtn', await active());
  check('hamburger: aria-expanded weer uit', (await page.getAttribute('#menuBtn', 'aria-expanded')) === 'false');

  // ---- Escape en de sluier
  await page.click('#menuBtn');
  await page.keyboard.press('Escape');
  check('lade: Escape sluit hem', !(await open()));
  await page.click('#menuBtn');
  await page.mouse.click(400, 450);
  check('lade: tik naast de lade sluit hem', !(await open()));

  // ---- focus blijft binnen
  await page.click('#menuBtn');
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  check('lade: Tab blijft binnen het venster',
    await page.evaluate(() => document.getElementById('menuBox').contains(document.activeElement)), await active());
  await page.keyboard.press('Escape');

  // ---- vegen
  await swipe(8, 200);
  check('veeg: vanaf de linkerrand opent de lade', await open());
  await swipe(240, 40, '#menuveil');
  check('veeg: naar links sluit hem weer', !(await open()));
  await swipe(200, 340);
  check('veeg: midden op het scherm opent niets', !(await open()));
  await swipe(8, 30);
  check('veeg: een te korte veeg opent niets', !(await open()));
  await swipe(8, 200, '.wrap', 700);
  check('veeg: een overwegend verticale beweging opent niets', !(await open()));
  await page.click('#addCat');
  await swipe(8, 200);
  check('veeg: genegeerd terwijl een ander venster open staat', !(await open()));
  check('veeg: dat andere venster staat er nog', await page.isVisible('#veil.open'));
  await page.keyboard.press('Escape');

  // ---- de instellingen werken vanuit de lade
  await page.click('#menuBtn');
  check('lade: het beginsaldo staat erin', await page.isVisible('#startBtn'));
  check('lade: de weergavekeuze staat erin', await page.isVisible('#thSystem'));
  check('lade: exporteren en importeren staan erin',
    (await page.isVisible('#expBtn')) && (await page.isVisible('#impBtn')));
  check('lade: alles wissen staat erin', await page.isVisible('#wipeBtn'));

  await page.click('#thDark');
  check('lade: de weergave is meteen aangepast', (await page.getAttribute('html', 'data-theme')) === 'dark');

  await page.click('#startBtn');
  check('lade: het beginsaldo opent zijn eigen venster', await page.isVisible('#veil.open'));
  await page.fill('#pAmount', '750');
  await page.click('#pSave');
  check('beginsaldo: overgenomen', (await page.textContent('#startBtn')).includes('750,00'), await page.textContent('#startBtn'));
  check('lade: staat daarna nog open', await open());

  // ---- het stipje zit op de hamburger
  check('stipje: zichtbaar zolang er niet geëxporteerd is', await page.isVisible('#setNudge'));
  const onBurger = await page.evaluate(() =>
    document.getElementById('menuBtn').contains(document.getElementById('setNudge')));
  check('stipje: zit op de hamburger, niet in de lade', onBurger);

  await page.keyboard.press('Escape');
  check('lade: weer dicht', !(await open()));

  check('geen fouten in de console', errors.length === 0, errors);

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
