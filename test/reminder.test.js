/* De herinneringsbalk: wat eraan komt binnen zeven dagen, wat nog openstaat,
   en het oranje bolletje op de hamburger. Draait op een nepklok zodat de
   datums vastliggen. */
const { chromium } = require('playwright');

const URL = process.env.BUDGET_URL || 'http://127.0.0.1:8765/index.html';
const fails = [], ok = [];
const check = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  <<< ' + JSON.stringify(x)));

// 10 maart 2027, ruim in de maand zodat er dagen voor en na zijn.
const TODAY = new Date('2027-03-10T09:00:00');
const MONTH = '2027_03';

const expense = (id, label, day, amount) =>
  ({ id: id, label: label, amount: amount, day: day, pay: 'digital', shift: false });

const seed = expenses => ({
  v: 8, theme: 'system', lastExport: '2027-03-01', categories: [], savings: [], income: [],
  expenses: expenses,
  months: { [MONTH]: { start: { d: 5000, c: 0 }, paid: {}, recv: {}, exc: {}, skip: {}, oneoff: [], tx: [] } }
});

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.clock.install({ time: TODAY });

  const boot = async data => {
    await page.goto(URL);
    await page.evaluate(s => { localStorage.clear(); localStorage.setItem('budget_v8', JSON.stringify(s)); }, data);
    await page.goto(URL);
    await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);
  };
  const bar = () => page.textContent('#todoBar');
  const barShown = () => page.isVisible('#todoBar');

  // ---- de drempel van zeven dagen
  await boot(seed([
    expense('e1', 'Binnen zes dagen', 16, 100),   // 16 maart = zes dagen vooruit
    expense('e2', 'Over acht dagen', 18, 200),    // 18 maart = acht dagen vooruit
    expense('e3', 'Precies zeven dagen', 17, 300) // 17 maart = de grens zelf
  ]));
  check('balk: verschijnt', await barShown());
  check('balk: zes dagen vooruit staat erin', (await bar()).includes('Binnen zes dagen'), await bar());
  check('balk: de zevende dag telt nog mee', (await bar()).includes('Precies zeven dagen'), await bar());
  check('balk: acht dagen vooruit blijft erbuiten', !(await bar()).includes('Over acht dagen'), await bar());
  check('balk: kop zegt dat het eraan komt', (await bar()).includes('Komt eraan'), await bar());
  check('balk: telt de bedragen op', (await bar()).includes('400,00'), await bar());
  check('bolletje: brandt niet voor iets wat nog moet komen', !(await page.isVisible('#setNudge')));

  // ---- wat al voorbij is en niet is afgevinkt
  await boot(seed([
    expense('e1', 'Huur', 1, 800),        // 1 maart, voorbij
    expense('e2', 'Verzekering', 16, 150) // 16 maart, komt eraan
  ]));
  check('balk: een voorbije last staat als open', (await bar()).includes('Staat nog open'), await bar());
  check('balk: met de naam erbij', (await bar()).includes('Huur'));
  check('balk: en wat eraan komt staat er apart onder', (await bar()).includes('Komt eraan'), await bar());
  check('balk: open staat boven wat nog moet komen',
    (await bar()).indexOf('Staat nog open') < (await bar()).indexOf('Komt eraan'));
  check('bolletje: brandt wel voor iets wat openstaat', await page.isVisible('#setNudge'));

  // ---- het menu vertelt waar het bolletje over gaat
  await page.click('#menuBtn');
  check('menu: meldt wat er openstaat', await page.isVisible('#todoLink'));
  check('menu: met de maand erbij', (await page.textContent('#todoLink')).includes('maart'),
    await page.textContent('#todoLink'));
  await page.click('#todoLink');
  check('menu: de verwijzing sluit het menu', !(await page.isVisible('#menuveil.open')));
  check('menu: en brengt je naar die maand', (await page.textContent('#mname')).includes('maart'));

  // ---- afvinken vanuit de balk
  const before = await page.evaluate(() => calc(view = '2027_03').available);
  await page.click('#todoBar .check');
  check('afvinken: de regel verdwijnt uit de balk', !(await bar()).includes('Huur'), await bar());
  check('afvinken: wat eraan komt blijft staan', (await bar()).includes('Verzekering'));
  const after = await page.evaluate(() => calc('2027_03').available);
  check('afvinken: het saldo beweegt mee', before - after === 800, { before, after });
  check('afvinken: het bolletje gaat uit', !(await page.isVisible('#setNudge')));

  // ---- de balk hoort bij de maand die je bekijkt
  await page.click('#nextM');
  check('balk: april heeft zijn eigen openstaande posten',
    (await barShown()) ? !(await bar()).includes('Staat nog open') : true, await barShown() ? await bar() : 'verborgen');
  await page.click('#prevM');

  // ---- niets te doen, dan ook geen balk
  await boot(seed([expense('e1', 'Ver weg', 28, 90)])); // 28 maart, ruim buiten de zeven dagen
  check('balk: blijft weg als er niets speelt', !(await barShown()));

  check('geen fouten in de console', errors.length === 0, errors);

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
