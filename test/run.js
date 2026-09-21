/* Start een statische server op de map budget/, draai beide suites en
   geef de gezamenlijke uitkomst terug. Gebruik: npm test */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', 'budget');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png'
};

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
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const suites = ['mechanics.test.js', 'features.test.js', 'month.test.js',
    'menu.test.js', 'toast.test.js', 'keyboard.test.js', 'offline.test.js'];
  let failed = 0;
  for (const suite of suites) {
    console.log(`\n=== ${suite} ===`);
    failed += await new Promise(done => {
      spawn(process.execPath, [path.join(__dirname, suite)], {
        stdio: 'inherit',
        env: { ...process.env, BUDGET_URL: url }
      }).on('exit', code => done(code ? 1 : 0));
    });
  }
  server.close();
  process.exit(failed ? 1 : 0);
});
