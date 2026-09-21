/* Het saldo dat van maand naar maand doorrolt: één ijkpunt, daarna vanzelf,
   en een voorbije maand die doorrolt met wat er werkelijk is gebeurd. */
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

  // Inkomsten en lasten op dag 1, zodat "vandaag" nooit bepaalt of ze meetellen.
  // Vandaag geëxporteerd, zodat het bolletje op de hamburger in deze suite
  // alleen over openstaande posten gaat en niet ook over de export.
  const SEED = {
    v: 8, theme: 'system', lastExport: new Date().toISOString().slice(0, 10),
    categories: [], savings: [], months: {},
    income: [{ id: 'i1', label: 'Salaris', amount: 2000, day: 1, kind: 'digital', shift: false }],
    expenses: [{ id: 'e1', label: 'Huur', amount: 800, day: 1, pay: 'digital', shift: false }]
  };
  const boot = async seed => {
    await page.goto(URL);
    await page.evaluate(s => { localStorage.clear(); localStorage.setItem('budget_v8', JSON.stringify(s)); }, seed);
    await page.goto(URL);
    await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);
  };
  // maandsleutel n maanden vanaf nu, zoals de app ze opslaat
  const key = n => page.evaluate(n => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n);
    return d.getFullYear() + '_' + String(d.getMonth() + 1).padStart(2, '0');
  }, n);
  const startAt = async n => page.evaluate(k => { const c = calc(k); return { d: c.start.d, c: c.start.c }; }, await key(n));
  const endAt = async n => page.evaluate(k => { const c = calc(k); return { free: c.free, avail: c.available }; }, await key(n));

  await boot(SEED);

  // ---- de prompt vraagt één keer, niet elke maand
  check('prompt: zichtbaar zolang er nergens een ijkpunt staat', await page.isVisible('#startPrompt'));
  await page.click('#nextM');
  check('prompt: niet op een andere maand', !(await page.isVisible('#startPrompt')));
  await page.click('#jumpNow');

  // ---- ijkpunt zetten
  await page.click('#startPrompt');
  await page.fill('#pAmount', '1000');
  await page.click('#pSave');
  check('prompt: verdwijnt zodra er een ijkpunt is', !(await page.isVisible('#startPrompt')));
  check('ledger: meldt dat het saldo is vastgezet',
    (await page.textContent('#carryRow')).includes('ijkpunt'), await page.textContent('#carryRow'));

  // ---- en dan rolt het door, zonder dat er iets wordt ingevuld
  check('deze maand begint op het ijkpunt', (await startAt(0)).d === 1000, await startAt(0));
  // elke maand levert 2000 op en kost 800, dus +1200 per maand
  check('volgende maand begint 1200 hoger', (await startAt(1)).d === 2200, await startAt(1));
  check('twee maanden verder nog eens 1200', (await startAt(2)).d === 3400, await startAt(2));
  check('drie maanden verder ook', (await startAt(3)).d === 4600, await startAt(3));

  await page.click('#nextM');
  check('ledger: een volgende maand meldt dat het is meegenomen',
    (await page.textContent('#carryRow')).includes('Meegenomen uit'), await page.textContent('#carryRow'));
  check('ledger: met het juiste bedrag',
    (await page.textContent('#carryAmt')).includes('2.200,00'), await page.textContent('#carryAmt'));
  await page.click('#jumpNow');

  // ---- opnieuw ijken halverwege pakt de keten daarvandaan op
  const seedWithAnchor = await page.evaluate(() => JSON.parse(localStorage.getItem('budget_v8')));
  const k2 = await key(2);
  seedWithAnchor.months[k2] = { start: { d: 500, c: 0 }, paid: {}, recv: {}, exc: {}, skip: {}, oneoff: [], tx: [] };
  await boot(seedWithAnchor);
  check('bijgesteld: die maand begint op het nieuwe bedrag', (await startAt(2)).d === 500, await startAt(2));
  check('bijgesteld: de maand erna rolt daarvandaan door', (await startAt(3)).d === 1700, await startAt(3));
  check('bijgesteld: de maanden ervoor blijven ongemoeid', (await startAt(1)).d === 2200, await startAt(1));

  // ---- een voorbije maand rolt door op werkelijke bedragen
  const past = JSON.parse(JSON.stringify(SEED));
  const kPrev = await key(-1), kNow = await key(0);
  past.months[kPrev] = { start: { d: 1000, c: 0 }, paid: {}, recv: {}, exc: {}, skip: {}, oneoff: [], tx: [] };
  await boot(past);
  // vorige maand: 1000 + 2000 ontvangen, huur staat nog open dus die 800 staat er nog
  check('voorbije maand: niet-afgevinkte last blijft op het saldo staan',
    (await startAt(0)).d === 3000, await startAt(0));
  // Twee open posten: de huur van vorige maand én die van deze maand, want
  // dag 1 is allang geweest en geen van beide is afgevinkt.
  const openBefore = await page.evaluate(() => openWork().map(o => o.ym + ' ' + o.item.label));
  check('beide onafgevinkte huren staan geregistreerd als open', openBefore.length === 2, openBefore);
  check('de oudste staat vooraan', openBefore[0] < openBefore[1], openBefore);
  check('het bolletje op de hamburger brandt', await page.isVisible('#setNudge'));

  // nu afvinken in de vorige maand en kijken of alles erna meezakt
  await page.click('#prevM');
  check('de balk toont de openstaande last',
    (await page.textContent('#todoBar')).includes('Huur'), await page.textContent('#todoBar'));
  await page.click('#todoBar .check');
  check('de balk is leeg na afvinken', !(await page.isVisible('#todoBar')));
  await page.click('#jumpNow');
  check('afvinken haalt de 800 alsnog van het saldo', (await startAt(0)).d === 2200, await startAt(0));
  check('en van elke maand erna', (await startAt(2)).d === 4600, await startAt(2));
  check('het bolletje brandt nog zolang deze maand ook openstaat', await page.isVisible('#setNudge'));
  await page.click('#todoBar .check');
  check('het bolletje gaat uit als alles is afgevinkt', !(await page.isVisible('#setNudge')));

  // ---- een komende maand rolt door op geplande bedragen
  // Voor een maand die nog moet komen is "beschikbaar" betekenisloos: er is
  // nog niets ontvangen of betaald. Het beginsaldo van de maand daarna moet
  // dus gelijk zijn aan het verwachte eind, niet aan het beschikbare.
  const ahead = await endAt(2);
  check('een komende maand rekent met alle lasten, afgevinkt of niet',
    (await startAt(3)).d === ahead.free, { start3: await startAt(3), ahead });
  check('en niet met wat er toevallig is afgevinkt', ahead.free !== ahead.avail, ahead);

  check('geen fouten in de console', errors.length === 0, errors);

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
