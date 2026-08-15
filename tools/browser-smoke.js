// TETHER — tools/browser-smoke.js
// Tier-2 browser smoke gate (plan ship gate #2: "zero console errors in
// browser"). Drives the REAL page in headless Chrome with REAL keyboard events
// and asserts the sim responds — this is the gate that would have caught B1
// (broken keyboard input).
//
// Optional (not part of the Docker `verify` gate — that must stay zero-dep):
//   npm run smoke
//
// Requires a global puppeteer install (host/tier-2 tooling only):
//   NODE_PATH=$(npm root -g) npm run smoke
// If Chrome is not found, it exits 0 with a SKIP note (documented manual
// checklist in README covers this environment).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch {
  console.log('browser-smoke: SKIP — puppeteer not resolvable (host tier-2 tool).');
  console.log('              Manual checklist in README ("Browser smoke / manual checklist").');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

// --- minimal static server ---
async function serve(dir, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = join(dir, path);
      if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(port, r));
  const addr = server.address();
  return { server, url: `http://127.0.0.1:${addr.port}/` };
}

let passed = 0;
let failed = 0;
const failures = [];
const assert = (cond, msg) => {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; failures.push(msg); console.error('  ✗ ' + msg); }
};

const { server, url } = await serve(root);

let browser;
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepTicks = async (page, ticks) => { await wait((ticks / 120) * 1000 + 60); };

try {
  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--mute-audio'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  console.log('\nbrowser-smoke: loading ' + url);
  await page.goto(url, { waitUntil: 'load' });

  // title screen must be visible
  await page.waitForSelector('#overlay-title', { visible: true, timeout: 5000 });
  assert(true, 'title overlay rendered');

  // start level 1
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__tetherDebug && window.__tetherDebug() && window.__tetherDebug().tick > 5, { timeout: 8000 });
  const s0 = await page.evaluate(() => window.__tetherDebug());
  assert(s0.level === 0, 'level 1 started (debug hook sees tick=' + s0.tick + ')');

  // --- B1 regression: real keyboard Space must produce a jump ---
  const before = await page.evaluate(() => window.__tetherDebug());
  await page.keyboard.down('Space');
  await sleepTicks(page, 6);
  await page.keyboard.up('Space');
  await sleepTicks(page, 6);
  const after = await page.evaluate(() => window.__tetherDebug());
  assert(after.tick > before.tick, 'sim advances (tick ' + before.tick + ' -> ' + after.tick + ')');
  assert(after.jumpsUsed >= before.jumpsUsed && (after.jumpsUsed > 0), 'jump registered (jumpsUsed=' + before.jumpsUsed + ' -> ' + after.jumpsUsed + ')');
  assert(after.grounded === false, 'player airborne after jump (grounded=' + after.grounded + ')');

  // --- B1 regression: tether press (X) must place an anchor ---
  await page.keyboard.down('X');
  await sleepTicks(page, 3);
  await page.keyboard.up('X');
  await sleepTicks(page, 2);
  const t = await page.evaluate(() => window.__tetherDebug());
  assert(t.hasTether === true, 'tether anchor placed by real X keydown');

  // --- movement: ArrowRight must move the player right ---
  const m0 = await page.evaluate(() => window.__tetherDebug());
  await page.keyboard.down('ArrowRight');
  await sleepTicks(page, 20);
  await page.keyboard.up('ArrowRight');
  await sleepTicks(page, 2);
  const m1 = await page.evaluate(() => window.__tetherDebug());
  assert(m1.px > m0.px, 'player moved right under ArrowRight (x ' + m0.px + ' -> ' + m1.px + ')');

  // --- pause / resume / restart / mute buttons must not error ---
  await page.click('#btn-pause');
  await page.waitForSelector('#overlay-pause', { visible: true, timeout: 3000 });
  assert(true, 'pause overlay opens');
  await page.click('#btn-resume');
  await page.waitForSelector('#overlay-pause', { visible: false, timeout: 3000 });
  assert(true, 'pause overlay closes on resume');
  await page.click('#btn-pause');
  await page.click('#btn-restart'); // restart lives inside the pause overlay
  await page.waitForSelector('#overlay-pause', { visible: false, timeout: 3000 });
  await sleepTicks(page, 5);
  assert(true, 'restart button restarts the level and closes pause');
  await page.click('#btn-mute');
  await sleepTicks(page, 2);
  assert(true, 'mute toggle clickable');

  // --- zero console errors throughout ---
  await wait(300);
  assert(errors.length === 0, 'zero console/page errors (' + (errors.length ? errors.join('; ') : 'none') + ')');

  console.log(`\nbrowser-smoke: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailures:\n' + failures.map((f) => ' - ' + f).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('browser-smoke: OK — page loads, real keyboard drives the sim, zero errors');
  }
} catch (e) {
  failed++;
  console.error('\n  ✗ browser-smoke failed: ' + e.message);
  if (errors.length) console.error('     page errors: ' + errors.join(' | '));
  process.exitCode = 1;
} finally {
  try { await browser.close(); } catch { /* */ }
  server.close();
}
