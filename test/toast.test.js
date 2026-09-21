/* De melding met "Ongedaan maken": staat bovenin, vangt nooit een tik af,
   verdwijnt na vier seconden of zodra je iets anders doet. */
const { chromium } = require('playwright');

const URL = process.env.BUDGET_URL || 'http://127.0.0.1:8765/index.html';
const fails = [], ok = [];
const check = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  <<< ' + JSON.stringify(x)));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  // Spaardoelen staan onder "Categorie toevoegen", dus die geven de pagina
  // ruimte om die knop tot boven aan het scherm te kunnen scrollen. Dat is
  // nodig om hem onder de melding te krijgen voor de doorklik-test verderop.
  const SEED = {
    v: 8, theme: 'system', lastExport: null, income: [], expenses: [], months: {},
    categories: [{ id: 'c1', label: 'Boodschappen', budget: 0 }],
    savings: Array.from({ length: 8 }, (_, i) => ({
      id: 's' + i, label: 'Spaardoel ' + (i + 1), goal: 1000, kind: 'free',
      amount: 100 + i, termMonths: 12, movements: []
    }))
  };
  await page.goto(URL);
  await page.evaluate(s => { localStorage.clear(); localStorage.setItem('budget_v8', JSON.stringify(s)); }, SEED);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);

  const shown = () => page.isVisible('#toast.show');
  // Een boeking maken geeft geen melding; hem weggooien wel, mét undo-knop.
  const book = async label => {
    await page.fill('#txDesc', label);
    await page.fill('#txAmt', '10');
    await page.click('#txAdd');
  };
  const raiseToast = async () => {
    await book('Testboeking');
    await page.click('#txList .x');
  };

  // ---- positie
  await raiseToast();
  check('toast: verschijnt', await shown());
  const box = await page.locator('#toast').boundingBox();
  check('toast: staat in het bovenste kwart van het scherm', box.y + box.height < 900 / 4, box);
  check('toast: gebruikt de volle breedte, geen smalle kolom', box.width > 300, box);
  const varTop = (await page.locator('#varTot').boundingBox()).y;
  check('toast: staat boven de variabele uitgaven', box.y < varTop, [box.y, varTop]);

  // ---- de tik die hem oproept sluit hem niet
  check('toast: blijft staan na de eigen tik', await shown());

  // ---- hij vangt geen tikken af
  const under = await page.evaluate(() => {
    const b = document.getElementById('toast').getBoundingClientRect();
    const el = document.elementFromPoint(b.left + 8, b.top + b.height / 2);
    return el ? (el.closest('#toast') ? '#toast' : el.tagName) : null;
  });
  check('toast: laat tikken erdoorheen', under !== '#toast', under);

  // Dit is de eigenlijke regressietest. Scrol een knop pal onder de melding en
  // tik hem aan op ruwe schermcoördinaten, zonder Playwright ergens heen te
  // laten scrollen. Zonder pointer-events:none ving de melding die tik af.
  await page.waitForTimeout(TOAST_GRACE_WAIT());
  const target = await page.evaluate(() => {
    const el = document.getElementById('addCat');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24);
    const t = document.getElementById('toast').getBoundingClientRect();
    const b = el.getBoundingClientRect();
    /* links in de melding, ruim naast "Ongedaan maken": die knop hoort de tik
       juist wel te vangen en is dus geen goed proefpunt */
    const x = t.left + 8, y = b.top + b.height / 2;
    return {
      x: x, y: y,
      inToast: x > t.left && x < t.right && y > t.top && y < t.bottom,
      onButton: b.left < x && x < b.right,
      hit: (document.elementFromPoint(x, y) || {}).id
    };
  });
  check('toast: het proefpunt ligt in de melding én op de knop', target.inToast && target.onButton, target);
  check('toast: het raakpunt levert de knop op, niet de melding', target.hit === 'addCat', target);
  await page.mouse.click(target.x, target.y);
  check('toast: de knop eronder reageert gewoon', await page.isVisible('#veil.open'), target);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.scrollTo(0, 0));

  // ---- weg zodra je iets anders doet
  await raiseToast();
  check('toast: staat er weer', await shown());
  await page.waitForTimeout(TOAST_GRACE_WAIT());
  await page.click('#addCat');
  check('toast: weg bij de volgende handeling', !(await shown()));
  check('toast: die handeling is wel gewoon uitgevoerd', await page.isVisible('#veil.open'));
  await page.keyboard.press('Escape');

  // ---- ongedaan maken werkt nog
  await raiseToast();
  check('undo: boeking is weg', !(await page.textContent('#txList')).includes('Testboeking'));
  await page.click('#toastAct');
  check('undo: knop in de melding werkt', (await page.textContent('#txList')).includes('Testboeking'));
  check('undo: melding verdwijnt erna', !(await shown()));
  await page.click('#txList .x');
  await page.waitForTimeout(TOAST_GRACE_WAIT());
  await page.click('#prevM');
  await page.click('#jumpNow');

  // ---- verdwijnt vanzelf na vier seconden
  await raiseToast();
  await page.waitForTimeout(3000);
  check('toast: na 3 seconden nog zichtbaar', await shown());
  await page.waitForTimeout(1600);
  check('toast: na 4,5 seconden weg', !(await shown()));

  // ---- de melding over een andere maand overleeft het toetsenbord
  // (na het boeken springt de focus terug naar #txDesc; dat mag hem niet sluiten)
  const nextIso = await page.evaluate(() => {
    const n = new Date(), nx = new Date(n.getFullYear(), n.getMonth() + 1, 15), p = x => String(x).padStart(2, '0');
    return nx.getFullYear() + '-' + p(nx.getMonth() + 1) + '-15';
  });
  await page.fill('#txDesc', 'Volgende maand');
  await page.fill('#txAmt', '25');
  await page.click('#txDate');
  await page.click('#cNext');
  await page.click('.cal button[data-iso="' + nextIso + '"]');
  await page.click('#txAdd');
  check('toast: de melding over een andere maand blijft staan', await shown());
  check('toast: met de knop om erheen te gaan', (await page.textContent('#toastAct')) === 'Ga erheen',
    await page.textContent('#toastAct'));
  check('toast: de focus staat weer in het omschrijvingsveld',
    (await page.evaluate(() => document.activeElement.id)) === 'txDesc');

  check('geen fouten in de console', errors.length === 0, errors);

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });

// iets langer dan de marge in app.js waarbinnen een tik de melding negeert
function TOAST_GRACE_WAIT() { return 600; }
