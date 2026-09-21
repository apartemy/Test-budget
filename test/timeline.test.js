/* De tijdlijn: het saldo op je rekening regel voor regel vooruit, wat nog
   openstaat, waar het diepste punt ligt, en wat er aan het eind overblijft.
   Neemt het werk over van de oude herinneringsbalk. Draait op een nepklok
   zodat de datums vastliggen. */
const { chromium } = require('playwright');

const URL = process.env.BUDGET_URL || 'http://127.0.0.1:8765/index.html';
const fails = [], ok = [];
const check = (n, c, x) => (c ? ok : fails).push(n + (c ? '' : '  <<< ' + JSON.stringify(x)));

// 10 maart 2027, ruim in de maand zodat er dagen voor en na zijn.
const TODAY = new Date('2027-03-10T09:00:00');
const MONTH = '2027_03';

const seed = (expenses, income, startD) => ({
  v: 8, theme: 'system', lastExport: '2027-03-01', categories: [], savings: [],
  income: (income || []).map(i => Object.assign({ from: MONTH, kind: 'digital' }, i)),
  expenses: expenses.map(e => Object.assign({ from: MONTH, pay: 'digital', shift: false }, e)),
  months: { [MONTH]: { start: { d: startD === undefined ? 1000 : startD, c: 0 },
    paid: {}, recv: {}, exc: {}, skip: {}, oneoff: [], tx: [] } }
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
  // de tijdlijn als leesbare rijen: [naam, bedrag, saldo]
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#flow .fl')].map(el => {
    const edge = el.classList.contains('edge');
    return {
      naam: edge ? el.children[0].textContent.trim() : el.querySelector('.fn').textContent,
      bedrag: edge ? '' : el.querySelector('.fm').textContent,
      saldo: (edge ? el.children[1] : el.querySelector('.fb')).textContent,
      sub: edge ? '' : el.querySelector('.fd').textContent,
      open: el.classList.contains('open'), laag: el.classList.contains('low')
    };
  }));

  // ---- opbouw en doorlopend saldo
  await boot(seed(
    [{ id: 'e1', label: 'Huur', amount: 600, day: 1 },
     { id: 'e2', label: 'Energie', amount: 180, day: 18 }],
    [{ id: 'i1', label: 'Salaris', amount: 1500, day: 28 }], 400));
  let r = await rows();
  check('tijdlijn: verschijnt', await page.isVisible('#flow'));
  check('tijdlijn: begint bij vandaag', r[0].naam.startsWith('vandaag'), r[0]);
  check('tijdlijn: zegt welke pot hij volgt', r[0].naam.includes('op rekening'), r[0].naam);
  check('tijdlijn: startpunt is het beschikbare saldo', r[0].saldo.includes('400,00'), r[0]);
  check('tijdlijn: eindregel staat onderaan', r[r.length - 1].naam.startsWith('eind van de maand'), r[r.length - 1]);

  const namen = r.map(x => x.naam);
  check('tijdlijn: posten staan op datum', namen.indexOf('Huur') < namen.indexOf('Energie') &&
    namen.indexOf('Energie') < namen.indexOf('Salaris'), namen);
  check('tijdlijn: saldo loopt door na de huur', r[1].saldo.includes('−€200,00'), r[1]);
  check('tijdlijn: en na de energie', r[2].saldo.includes('−€380,00'), r[2]);
  check('tijdlijn: en veert op na het salaris', r[3].saldo.includes('€1.120,00'), r[3]);
  check('tijdlijn: uitgaven met een min', r[1].bedrag.includes('−'), r[1].bedrag);
  check('tijdlijn: inkomsten met een plus', r[3].bedrag.includes('+'), r[3].bedrag);

  // ---- wat al voorbij is en niet is afgevinkt
  check('tijdlijn: de huur van 1 maart staat als open gemarkeerd', r[1].open, r[1]);
  check('tijdlijn: met uitleg erbij', r[1].sub.includes('staat nog open'), r[1].sub);
  check('tijdlijn: een post die nog moet komen niet', !r[3].open, r[3]);

  // ---- het diepste punt
  const laag = r.filter(x => x.laag);
  check('tijdlijn: precies één laagste punt', laag.length === 1, laag);
  check('tijdlijn: dat is de energie op 18 maart', laag[0] && laag[0].naam === 'Energie', laag[0]);
  check('tijdlijn: met uitleg in de regel', laag[0] && laag[0].sub.includes('laagste punt'), laag[0]);

  // ---- de eindregel sluit aan op de volgende maand
  const eind = r[r.length - 1].saldo;
  const volgende = await page.evaluate(() => calc('2027_04').start.d);
  check('tijdlijn: het eind is het begin van de volgende maand',
    eind.includes(volgende.toLocaleString('nl-NL', { minimumFractionDigits: 2 })), { eind, volgende });

  // ---- afvinken vanuit de tijdlijn
  const voor = await page.evaluate(() => calc(view = '2027_03').available);
  await page.click('#flow .fl.open .check');
  const na = await page.evaluate(() => calc('2027_03').available);
  check('afvinken: het saldo beweegt mee', voor - na === 600, { voor, na });
  r = await rows();
  check('afvinken: de post verdwijnt uit de tijdlijn', !r.some(x => x.naam === 'Huur'), r.map(x => x.naam));
  check('afvinken: het bolletje op de hamburger gaat uit', !(await page.isVisible('#setNudge')));

  // ---- posten zonder vaste dag staan apart
  await boot(seed(
    [{ id: 'e1', label: 'Huur', amount: 600, day: 1 }],
    [{ id: 'i1', label: 'Salaris', amount: 1500, day: 28 },
     { id: 'i2', label: 'Bijklussen', amount: 200, day: null }], 400));
  r = await rows();
  const kop = r.find(x => x.naam === 'Zonder vaste dag');
  check('zonder datum: eigen kopje', !!kop, r.map(x => x.naam));
  check('zonder datum: de post staat eronder', r.some(x => x.naam === 'Bijklussen'));
  check('zonder datum: staat vóór de eindregel',
    r.findIndex(x => x.naam === 'Bijklussen') < r.length - 1);
  check('zonder datum: telt wel mee in de eindregel',
    r[r.length - 1].saldo.includes('1.500,00'), r[r.length - 1]);

  // ---- contant hoort niet in een lijst op datum
  await boot(seed(
    [{ id: 'e1', label: 'Huur', amount: 600, day: 1 }],
    [{ id: 'i1', label: 'Zakgeld', amount: 300, day: 5, kind: 'cash' }], 400));
  r = await rows();
  check('contant: staat niet in de tijdlijn', !r.some(x => x.naam === 'Zakgeld'), r.map(x => x.naam));
  check('contant: wel als eigen bedrag in de kaart',
    (await page.textContent('#sCash')).includes('300,00') || (await page.textContent('#sCash')).includes('0,00'),
    await page.textContent('#sCash'));

  // ---- een komende maand begint bij het meegenomen saldo
  await boot(seed([{ id: 'e1', label: 'Huur', amount: 600, day: 1 }],
    [{ id: 'i1', label: 'Salaris', amount: 1500, day: 28 }], 400));
  await page.click('#nextM');
  r = await rows();
  check('komende maand: begint bij het begin van de maand', r[0].naam.startsWith('begin van de maand'), r[0]);
  const aprilStart = await page.evaluate(() => calc('2027_04').start.d);
  check('komende maand: met het meegenomen bedrag',
    r[0].saldo.includes(aprilStart.toLocaleString('nl-NL', { minimumFractionDigits: 2 })), { r0: r[0], aprilStart });
  check('komende maand: niets staat er als open', !r.some(x => x.open), r.filter(x => x.open));
  check('komende maand: het label zegt verwacht',
    (await page.textContent('#digLbl')).includes('Verwacht'), await page.textContent('#digLbl'));

  check('geen fouten in de console', errors.length === 0, errors);

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
