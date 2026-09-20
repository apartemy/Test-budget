/* Maakt de afbeeldingen die Android in het installatievenster laat zien.
   Draai dit opnieuw als de vormgeving verandert:
       cd test && CHROMIUM_PATH=... node screenshots.js
   Het start zelf een server op budget/ en schrijft naar budget/screenshots/. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'budget');
const OUT = path.join(ROOT, 'screenshots');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

// Voorbeeldmaand die de app van zijn beste kant laat zien.
const DEMO = {
  v: 8, theme: 'system', lastExport: new Date().toISOString().slice(0, 10),
  income: [
    { id: 'i1', label: 'Salaris', amount: 2450, day: 25, kind: 'digital', shift: true },
    { id: 'i2', label: 'Bijles', amount: 160, day: null, kind: 'cash' }
  ],
  expenses: [
    { id: 'e1', label: 'Huur', amount: 985, day: 1, pay: 'digital', shift: false },
    { id: 'e2', label: 'Zorgverzekering', amount: 149.5, day: 3, pay: 'digital', shift: false },
    { id: 'e3', label: 'Sportschool', amount: 32.5, day: 5, pay: 'cash', shift: false }
  ],
  categories: [
    { id: 'c_bood', label: 'Boodschappen', budget: 320 },
    { id: 'c_uit', label: 'Uitgaan', budget: 120 },
    { id: 'c_verv', label: 'Vervoer', budget: 90 },
    { id: 'c_rest', label: 'Overig', budget: 60 }
  ],
  savings: [
    { id: 's1', label: 'Buffer', goal: 5000, kind: 'free', amount: 1850, termMonths: 12, movements: [] },
    { id: 's2', label: 'Deposito', goal: 0, kind: 'term', amount: 0, termMonths: 12, deposits: [] }
  ],
  months: {}
};

function fillMonth() {
  const n = new Date(), p = x => String(x).padStart(2, '0');
  const key = n.getFullYear() + '_' + p(n.getMonth() + 1);
  const iso = d => n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(d);
  DEMO.months[key] = {
    start: { d: 2450, c: 120 }, paid: { e1: true, e2: true }, recv: { i2: true }, exc: {}, skip: {},
    oneoff: [{ id: 'o1', kind: 'expense', label: 'Tandarts', amount: 118.4, date: iso(12), pay: 'digital' }],
    tx: [
      { id: 't1', label: 'Albert Heijn', amount: 62.15, cat: 'c_bood', date: iso(3), pay: 'digital' },
      { id: 't2', label: 'Markt', amount: 18.5, cat: 'c_bood', date: iso(6), pay: 'cash' },
      { id: 't3', label: 'Café Zwart', amount: 34, cat: 'c_uit', date: iso(8), pay: 'digital' },
      { id: 't4', label: 'Treinkaartje', amount: 27.4, cat: 'c_verv', date: iso(9), pay: 'digital' }
    ]
  };
  DEMO.savings[1].deposits = [{ id: 'd1', amount: 500, date: iso(2), pay: 'digital' }];
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
});

server.listen(0, '127.0.0.1', async () => {
  fillMonth();
  fs.mkdirSync(OUT, { recursive: true });
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  // Android wil minstens één smalle en één brede afbeelding.
  const shots = [
    { name: 'narrow.png', width: 540, height: 1170 },
    { name: 'wide.png', width: 1280, height: 800 }
  ];
  for (const shot of shots) {
    const ctx = await browser.newContext({ viewport: { width: shot.width, height: shot.height } });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.evaluate(s => localStorage.setItem('budget_v8', JSON.stringify(s)), DEMO);
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById('mname').textContent.length > 0);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, shot.name) });
    await ctx.close();
    console.log('wrote', shot.name, shot.width + 'x' + shot.height);
  }
  await browser.close();
  server.close();
});
