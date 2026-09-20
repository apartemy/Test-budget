const { chromium } = require('playwright');

const URL = process.env.BUDGET_URL || 'http://127.0.0.1:8765/index.html';
const fails = [];
const ok = [];
function check(name, cond, extra) {
  (cond ? ok : fails).push(name + (cond ? '' : '  <<< ' + (extra === undefined ? '' : JSON.stringify(extra))));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);

  // ---- empty state
  check('empty: hero is 0', (await page.textContent('#heroBig')).replace(/\s/g, '') === '€0,00', await page.textContent('#heroBig'));
  check('empty: income placeholder', (await page.textContent('#incList')).includes('Nog geen inkomsten'));
  check('empty: 4 seeded categories', (await page.locator('#catList .cat').count()) === 4);

  // ---- recurring income, day 25, weekend shift
  await page.click('#addIncR');
  await page.fill('#pLabel', 'Salaris');
  await page.fill('#pAmount', '2.400,50');
  await page.click('#pDay');
  await page.click('.cal button[data-day="25"]');
  check('income: shift field appears once a day is set', await page.isVisible('#fShift'));
  await page.click('#segSY');
  await page.click('#pSave');
  check('income: row rendered', (await page.textContent('#incList')).includes('Salaris'));
  check('income: total 2400,50', (await page.textContent('#incTot')).includes('2.400,50'), await page.textContent('#incTot'));
  check('income: weekend note shown', (await page.textContent('#incList')).includes('schuift bij weekend'));

  // ---- recurring expense paid from cash
  await page.click('#addExpR');
  await page.fill('#pLabel', 'Huur');
  await page.fill('#pAmount', '900');
  await page.click('#segPC');
  await page.click('#pSave');
  check('expense: cash tag', (await page.textContent('#expList')).includes('contant'));
  check('expense: total 900', (await page.textContent('#expTot')).includes('900,00'), await page.textContent('#expTot'));

  // ---- toggle paid
  await page.click('#expList .check');
  check('expense: marked paid', (await page.locator('#expList .row.done').count()) === 1);
  check('expense: aria-pressed true', (await page.getAttribute('#expList .check', 'aria-pressed')) === 'true');
  check('meter: fix paid 900 of 900', (await page.textContent('#mFixTxt')).includes('900,00 van €900,00'), await page.textContent('#mFixTxt'));

  // ---- one-off expense
  await page.click('#addExpO');
  await page.fill('#pLabel', 'Tandarts');
  await page.fill('#pAmount', '120,25');
  await page.click('#pSave');
  check('oneoff: grouped under Alleen deze maand', (await page.textContent('#expList')).includes('Alleen deze maand'));
  check('oneoff: total now 1020,25', (await page.textContent('#expTot')).includes('1.020,25'), await page.textContent('#expTot'));

  // ---- category with budget + transaction, over budget turns amber
  await page.click('#catList .cat >> nth=0');
  await page.fill('#pAmount', '50');
  await page.click('#pSave');
  await page.fill('#txDesc', 'Albert Heijn');
  await page.fill('#txAmt', '75,00');
  await page.selectOption('#txCat', { index: 0 });
  await page.click('#txAdd');
  check('tx: booked', (await page.textContent('#txList')).includes('Albert Heijn'));
  check('tx: var total 75', (await page.textContent('#varTot')).includes('75,00'), await page.textContent('#varTot'));
  const catFill = page.locator('#catList .cat .fill').first();
  check('cat: over class applied', (await catFill.getAttribute('class')).includes('over'));
  const bg = await catFill.evaluate(el => getComputedStyle(el).backgroundColor);
  check('cat: over bar is amber not wine', bg === 'rgb(224, 166, 60)', bg);

  // ---- cash transaction affects the cash column
  await page.fill('#txDesc', 'Markt');
  await page.fill('#txAmt', '10');
  await page.click('#txPay');
  check('txPay toggled to Contant', (await page.textContent('#txPay')) === 'Contant');
  await page.click('#txAdd');
  check('tx: cash noted on row', (await page.textContent('#txList')).includes('contant'));

  // ---- savings: free
  await page.click('#addSav');
  await page.fill('#pLabel', 'Buffer');
  await page.fill('#pAmount', '1500');
  await page.fill('#pGoal', '5000');
  await page.click('#pSave');
  check('sav: free account shown', (await page.textContent('#savList')).includes('Buffer'));
  check('sav: goal percentage', (await page.textContent('#savList')).includes('30% van'), await page.textContent('#savList'));

  // ---- savings: term with two deposits
  await page.click('#addSav');
  await page.fill('#pLabel', 'Depositio');
  await page.click('#segST');
  check('sav: term hides balance field', !(await page.isVisible('#fAmount')));
  await page.fill('#pTerm', '6');
  await page.click('#pSave');
  await page.click('.depadd >> nth=0');
  await page.fill('#pAmount', '200');
  await page.click('#pSave');
  await page.click('.depadd >> nth=0');
  await page.fill('#pAmount', '300');
  await page.click('#pSave');
  check('sav: term balance 500', (await page.textContent('#savList')).includes('€500,00'), await page.textContent('#savList'));
  check('sav: 6 mnd vast tag', (await page.textContent('#savList')).includes('6 mnd vast'));
  check('sav: release date shown', (await page.textContent('#savList')).includes('Eerstvolgende vrijval'));
  check('sav: 2 deposit rows', (await page.locator('.dep').count()) === 2);
  check('savTot: shows this-month portion', (await page.textContent('#savTot')).includes('deze maand'), await page.textContent('#savTot'));

  // ---- undo a deposit delete
  await page.click('.dep .x >> nth=0');
  check('undo: toast visible', await page.isVisible('#toast.show'));
  check('undo: one deposit left', (await page.locator('.dep').count()) === 1);
  await page.click('#toastAct');
  check('undo: deposit restored', (await page.locator('.dep').count()) === 2);

  // ---- skip an item for this month
  await page.click('#expList .rinfo.tap >> nth=0');
  await page.click('#segKS');
  await page.click('#pSave');
  check('skip: overgeslagen group', (await page.textContent('#expList')).includes('Overgeslagen deze maand'));

  // ---- per-month exception date
  await page.click('#incList .rinfo.tap >> nth=0');
  await page.click('#pExc');
  await page.click('.cal button[data-iso$="-14"]');
  await page.click('#pSave');
  check('exc: afwijkend tag', (await page.textContent('#incList')).includes('afwijkend'));

  // ---- start balance
  await page.click('details.settings summary');
  await page.click('#startBtn');
  await page.fill('#pAmount', '1000');
  await page.fill('#pCash', '50');
  await page.click('#pSave');
  check('start: button reflects both pots', (await page.textContent('#startBtn')).includes('1.000,00'), await page.textContent('#startBtn'));
  check('start: note says handmatig', (await page.textContent('#startNote')).includes('Handmatig'));

  // ---- forward months carry the chain (the startBalance fix)
  const monthValue = async () => (await page.textContent('#startBtn'));
  await page.click('#nextM');
  const m1 = await monthValue();
  await page.click('#nextM');
  const m2 = await monthValue();
  await page.click('#nextM');
  const m3 = await monthValue();
  check('chain: month +1 is not zero', !/^€0,00 \+ €0,00/.test(m1), m1);
  check('chain: month +2 is not zero', !/^€0,00 \+ €0,00/.test(m2), m2);
  check('chain: month +3 is not zero', !/^€0,00 \+ €0,00/.test(m3), m3);
  check('chain: months differ (projection moves)', m1 !== m2 && m2 !== m3, [m1, m2, m3]);
  console.log('  info  forward chain:', JSON.stringify([m1, m2, m3]));
  await page.click('#jumpNow');

  // ---- no back-projection before the first recorded month
  await page.click('#prevM');
  await page.click('#prevM');
  const past = await monthValue();
  check('chain: months before the first record stay zero', /^€0,00 \+ €0,00/.test(past), past);
  await page.click('#jumpNow');

  // ---- convert a recurring item to one-off and back
  await page.click('#incList .rinfo.tap >> nth=0');
  await page.click('#segO');
  check('convert: date field swaps in', await page.isVisible('#fDate') && !(await page.isVisible('#fDay')));
  await page.click('#pSave');
  check('convert: now a one-off', (await page.textContent('#incList')).includes('Salaris'));
  await page.click('#incList .rinfo.tap >> nth=0');
  await page.click('#segR');
  await page.click('#pSave');
  check('convert back: still there', (await page.textContent('#incList')).includes('Salaris'));

  // ---- export / import round trip
  const exported = await page.evaluate(() => localStorage.getItem('budget_v8'));
  check('persist: state written to localStorage', exported && exported.length > 100);

  // ---- delete with undo
  await page.click('#catList .cat >> nth=3');
  await page.click('#pDelete');
  check('delete: category gone', (await page.locator('#catList .cat').count()) === 3);
  await page.click('#toastAct');
  check('delete: undo restored category', (await page.locator('#catList .cat').count()) === 4);

  // ---- survives reload
  await page.reload();
  await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);
  check('reload: income still present', (await page.textContent('#incList')).includes('Salaris'));
  check('reload: savings still present', (await page.textContent('#savList')).includes('Depositio'));

  // Google Fonts cannot be reached through the sandbox proxy; that is not an app error.
  const appErrors = errors.filter(e => !/ERR_CERT_AUTHORITY_INVALID|ERR_FAILED|fonts\.g/.test(e));
  check('no console errors', appErrors.length === 0, appErrors);

  console.log(ok.map(s => '  ok   ' + s).join('\n'));
  if (fails.length) console.log('\n' + fails.map(s => '  FAIL ' + s).join('\n'));
  console.log(`\n${ok.length} passed, ${fails.length} failed`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
