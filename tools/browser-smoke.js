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

  // -------------------------------------------------------------------------
  // Mobile touch smoke (Iris diagnosis): real touch events dispatched at the
  // jump/tether/move coordinates; asserts the right intents fire, UI buttons
  // are tappable, and action taps never drift the player right.
  // -------------------------------------------------------------------------
  console.log('\nbrowser-smoke: mobile touch smoke (portrait 390x844 @3x)');
  const mpage = await browser.newPage();
  const merrors = [];
  mpage.on('console', (m) => { if (m.type() === 'error') merrors.push('console.error: ' + m.text()); });
  mpage.on('pageerror', (e) => merrors.push('pageerror: ' + e.message));
  await mpage.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await mpage.goto(url, { waitUntil: 'load' });
  await mpage.waitForSelector('#overlay-title', { visible: true, timeout: 5000 });
  assert(true, 'touch: title overlay rendered');

  // item 9: on a coarse-pointer device the title shows touch instructions
  const touchKeysShown = await mpage.evaluate(() => {
    const el = document.querySelector('.touch-keys');
    return !!el && getComputedStyle(el).display !== 'none';
  });
  assert(touchKeysShown, 'touch: title shows touch instructions (coarse pointer)');

  // item 1 + 11: the Begin button must be tappable with a real touch tap
  const begin = await mpage.evaluate(() => {
    const r = document.getElementById('btn-play').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await mpage.touchscreen.tap(begin.x, begin.y);
  await mpage.waitForFunction(() => {
    const d = window.__tetherDebug && window.__tetherDebug();
    return d && d.tick > 5 && d.touch && d.touch.enabled;
  }, { timeout: 8000 });
  assert(true, 'touch: Begin tap starts the level (UI button tappable)');

  // item 8/10/11: touch controls + rotate prompt visible during gameplay
  const mobileVis = await mpage.evaluate(() => {
    const tc = document.getElementById('touch-controls');
    const rp = document.getElementById('rotate-prompt');
    const hudPause = document.getElementById('btn-pause').getBoundingClientRect();
    return {
      touchControls: tc && !tc.classList.contains('hidden'),
      rotatePrompt: rp && !rp.classList.contains('hidden'),
      pauseInViewport: hudPause.right <= window.innerWidth && hudPause.left >= 0,
      pauseWidth: hudPause.width,
    };
  });
  assert(mobileVis.touchControls === true, 'touch: ◀ ▶ JUMP TETHER controls visible during gameplay');
  assert(mobileVis.rotatePrompt === true, 'touch: portrait rotate prompt shown during gameplay');
  assert(mobileVis.pauseInViewport === true, 'touch: pause button is inside the narrow viewport (item 10)');

  const mcdp = await mpage.createCDPSession();
  const canvasRect = await mpage.evaluate(() => {
    const r = document.getElementById('game').getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height };
  });
  const tap = async (x, y, holdMs = 40) => {
    await mcdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await wait(holdMs);
    await mcdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const hold = async (x, y) => {
    await mcdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  };
  const release = async () => {
    await mcdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const debug = () => mpage.evaluate(() => window.__tetherDebug());

  // item 4: jump zone (x>=0.82w, y>=0.6h) — tap must fire a jump, and the tap
  // must NOT drift the player right (item 2). Read state WHILE the jump is
  // airborne (a finished tap may already have landed and reset jumpsUsed).
  const jx = canvasRect.left + canvasRect.w * 0.9;
  const jy = canvasRect.top + canvasRect.h * 0.7;
  const jb = await debug();
  await hold(jx, jy);
  await wait(160); // ~19 ticks — enough to be airborne mid-jump
  const ja = await debug();
  await release();
  await wait(60);
  assert(ja.jumpsUsed >= 1 && ja.grounded === false, 'touch: jump-zone tap fires a jump (jumpsUsed=' + ja.jumpsUsed + ')');
  assert(Math.abs(ja.px - jb.px) < 6, 'touch: jump tap does NOT drift the player right (px ' + jb.px + ' -> ' + ja.px + ')');

  // item 4: the tether band 0.62w..0.82w must place a tether, never jump
  const tx = canvasRect.left + canvasRect.w * 0.72;
  const ty = canvasRect.top + canvasRect.h * 0.7;
  const tb = await debug();
  await tap(tx, ty, 50);
  await wait(80);
  const ta = await debug();
  assert(ta.hasTether === true, 'touch: tether-zone tap places the anchor');
  assert(Math.abs(ta.px - tb.px) < 6, 'touch: tether tap does NOT drift the player right (px ' + tb.px + ' -> ' + ta.px + ')');

  // item 2/7: move-left hold moves the player left (letterbox-safe zone)
  const lx = canvasRect.left + canvasRect.w * 0.3;
  const ly = canvasRect.top + canvasRect.h * 0.5;
  const mb = await debug();
  await hold(lx, ly);
  await wait(320);
  await release();
  await wait(60);
  const ma = await debug();
  assert(ma.px < mb.px, 'touch: move-left hold moves the player left (px ' + mb.px + ' -> ' + ma.px + ')');

  // item 8: the DOM JUMP button also fires a jump (button handler, no drift)
  const btnJump = await mpage.evaluate(() => {
    const r = document.getElementById('btn-jump').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const jbj = await debug();
  await hold(btnJump.x, btnJump.y);
  await wait(160);
  const jaj = await debug();
  await release();
  await wait(60);
  assert(jaj.jumpsUsed >= 1 && jaj.grounded === false, 'touch: DOM JUMP button fires a jump (jumpsUsed=' + jaj.jumpsUsed + ')');
  assert(Math.abs(jaj.px - jbj.px) < 6, 'touch: DOM JUMP button does not drift the player right');

  // item 1 + 11: HUD pause button tappable, and Resume tappable (pointerup fallback)
  const pauseBtn = await mpage.evaluate(() => {
    const r = document.getElementById('btn-pause').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await tap(pauseBtn.x, pauseBtn.y, 50);
  await wait(200);
  const pauseOpen = await mpage.evaluate(() => !document.getElementById('overlay-pause').classList.contains('hidden'));
  assert(pauseOpen === true, 'touch: HUD pause button opens the pause overlay');
  const resumeBtn = await mpage.evaluate(() => {
    const r = document.getElementById('btn-resume').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await tap(resumeBtn.x, resumeBtn.y, 50);
  await wait(200);
  const pauseClosed = await mpage.evaluate(() => document.getElementById('overlay-pause').classList.contains('hidden'));
  assert(pauseClosed === true, 'touch: Resume button (overlay) closes pause and resumes');

  await wait(200);
  assert(merrors.length === 0, 'touch: zero console/page errors (' + (merrors.length ? merrors.join('; ') : 'none') + ')');

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
