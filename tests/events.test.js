// TETHER — tests/events.test.js
// SFX decision logic (game/events.js) driven by REAL sim deltas. Verifies the
// recall-SFX fix end-to-end with the production step():
//   - placing the anchor fires tetherPlace
//   - a genuine (non-death) recall fires tetherRecall
//   - a death tick with an anchor placed does NOT fire tetherRecall (deaths
//     incremented in the snapshot suppresses it — only the loop's death path
//     plays), i.e. fireEvents contributes nothing on a death tick
//   - jump / double-jump / mote / lantern SFX still fire on their transitions
//
//   node tests/events.test.js

import { createState, step, makeInput } from '../public/js/core/sim.js';
import { TILE } from '../public/js/core/config.js';
import { fireEvents, snapEvents } from '../public/js/game/events.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error('  ✗ ' + msg); }
}

function ok(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; failures.push(name + ': ' + e.message); console.error('  ✗ ' + name + ' — ' + e.message); }
}

// ---------------------------------------------------------------------------
// Fixture helpers (same pattern as physics.test.js)
// ---------------------------------------------------------------------------
function mkLevel(grid, entities = []) {
  return { id: 'fixture', name: 'fixture', world: 0, index: 0, palette: 'moss', audioSeed: 1, grid, entities, par: 60 };
}
function fresh(level) { return createState(level, 7); }

// Empty (spy) sfx surface — records every call in order.
function makeSfxSpy() {
  const calls = [];
  const sfx = {};
  for (const name of ['jump', 'doubleJump', 'land', 'tetherPlace', 'tetherRecall', 'mote', 'gateOpen', 'lantern', 'death', 'win']) {
    sfx[name] = () => calls.push(name);
  }
  return { calls, sfx };
}

// The exact main.js pattern: snapshot BEFORE the step, step, then fireEvents.
function fire(lvl, s, ticks, input) {
  const prev = snapEvents(s);
  for (let i = 0; i < ticks; i++) step(s, input, lvl);
  const spy = makeSfxSpy();
  fireEvents(s, prev, spy.sfx);
  return { prev, calls: spy.calls };
}

// Level with an open right pit (cols 10-11) so the player can die.
const pitGrid = [
  'P...........',
  '...........G',
  '............',
  '............',
  '##########..',
];

// ---------------------------------------------------------------------------
// Tether SFX: place / recall / death-suppression
// ---------------------------------------------------------------------------
console.log('\nTether SFX:');

ok('placing the anchor fires tetherPlace', () => {
  const lvl = mkLevel(pitGrid);
  const s = fresh(lvl);
  const { calls } = fire(lvl, s, 1, makeInput({ tetherPressed: true }));
  assert(s.tether !== null, 'anchor placed on tether press');
  assert(calls.includes('tetherPlace'), 'tetherPlace fired on placement');
  assert(!calls.includes('tetherRecall'), 'tetherRecall NOT fired on placement');
});

ok('a genuine (non-death) recall fires tetherRecall', () => {
  const lvl = mkLevel(pitGrid);
  const s = fresh(lvl);
  step(s, makeInput({ tetherPressed: true }), lvl); // place
  assert(s.tether !== null, 'anchor placed');
  const { prev, calls } = fire(lvl, s, 1, makeInput({ tetherPressed: true })); // recall
  assert(s.tether === null, 'anchor consumed by recall');
  assert(s.deaths === prev.deaths, 'no death occurred on the recall tick (deaths unchanged)');
  assert(calls.includes('tetherRecall'), 'tetherRecall fired on non-death recall');
});

ok('a death tick with an anchor placed suppresses tetherRecall', () => {
  const lvl = mkLevel(pitGrid);
  const s = fresh(lvl);
  step(s, makeInput({ tetherPressed: true }), lvl); // place anchor
  assert(s.tether !== null, 'anchor placed');
  // Throw the player into the open right pit and step until the death tick,
  // keeping the snapshot that was taken BEFORE the death tick.
  s.player.x = 11 * TILE; s.player.y = 3 * TILE; s.player.vy = 0;
  let prev = snapEvents(s);
  let died = false;
  for (let i = 0; i < 600; i++) {
    step(s, makeInput(), lvl);
    if (s.deaths > prev.deaths) { died = true; break; }
    prev = snapEvents(s);
  }
  assert(died, 'player died in the pit');
  assert(prev.tether === true, 'anchor was placed in the pre-death snapshot');
  assert(s.tether === null, 'tether cleared by death reset');
  assert(s.deaths === prev.deaths + 1, 'deaths incremented on the death tick');
  const spy = makeSfxSpy();
  fireEvents(s, prev, spy.sfx);
  assert(!spy.calls.includes('tetherRecall'), 'tetherRecall NOT fired on a death tick');
  assert(spy.calls.length === 0, 'fireEvents contributes nothing on a death tick (death SFX lives in the loop)');
});

// ---------------------------------------------------------------------------
// Other transitions still fire
// ---------------------------------------------------------------------------
console.log('\nOther transitions:');

ok('jump fires jump SFX (not doubleJump)', () => {
  const lvl = mkLevel(pitGrid);
  const s = fresh(lvl);
  s.player.x = 2 * TILE; s.player.y = 4 * TILE - 24; s.player.grounded = true; // stand on the floor
  const { calls } = fire(lvl, s, 1, makeInput({ jumpPressed: true, jumpHeld: true }));
  assert(s.player.jumpsUsed === 1, 'ground jump consumed (jumpsUsed=1)');
  assert(s.player.vy < 0, 'player is rising after jump');
  assert(calls.includes('jump'), 'jump SFX fired');
  assert(!calls.includes('doubleJump'), 'doubleJump NOT fired for a single jump');
});

ok('double jump fires doubleJump SFX', () => {
  const lvl = mkLevel(pitGrid);
  const s = fresh(lvl);
  s.player.x = 2 * TILE; s.player.y = 3 * TILE; s.player.grounded = false; s.player.jumpsUsed = 1; // airborne after first jump
  const { calls } = fire(lvl, s, 1, makeInput({ jumpPressed: true, jumpHeld: true }));
  assert(s.player.jumpsUsed === 2, 'double jump consumed (jumpsUsed=2)');
  assert(calls.includes('doubleJump'), 'doubleJump SFX fired');
});

ok('mote collection fires mote SFX', () => {
  // Two motes so collecting one does not open the gate in the same tick.
  const lvl = mkLevel([
    'P..M.....M.G',
    '############',
  ]);
  const s = fresh(lvl);
  s.player.x = 3 * TILE; s.player.y = 0 * TILE; s.player.grounded = true;
  const { calls } = fire(lvl, s, 1, makeInput());
  assert(s.collectedCount === 1, 'mote collected');
  assert(!s.gateOpen, 'gate stays closed (1 of 2 motes)');
  assert(calls.includes('mote'), 'mote SFX fired');
});

ok('lantern contact fires lantern SFX on the rising edge', () => {
  const lvl = mkLevel([
    'P....L...G',
    '##########',
  ]);
  const s = fresh(lvl);
  // Stand just left of the lantern: right edge == lantern left edge, so the
  // first rightward step creates a clean rising edge (not already touching).
  s.player.x = 146; s.player.y = 8; s.player.grounded = true;
  const first = fire(lvl, s, 1, makeInput({ right: true }));
  assert(first.prev.onLantern === false, 'rising edge: not touching before the step');
  assert(first.calls.includes('lantern'), 'lantern SFX fired on first contact');
  // Still touching on the next tick: no rising edge, no lantern SFX.
  const second = fire(lvl, s, 1, makeInput({ right: true }));
  assert(!second.calls.includes('lantern'), 'lantern SFX NOT repeated while still touching');
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.error('\nFailures:\n' + failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
console.log('events: OK — tether-recall SFX fires; death-suppression verified');
