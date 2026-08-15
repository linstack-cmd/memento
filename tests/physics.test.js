// TETHER — tests/physics.test.js
// Edge-case assertions on the PRODUCTION simulation (zero npm deps).
//   node tests/physics.test.js
// Covers: one-way platforms (land-above, pass-below, drop-through), moving
// platform exact-delta carry + no-tunneling, corner penetration thresholds,
// tether overlap/recall resolution, and cooldown / lantern refresh.

import { createState, step, makeInput, cloneState, stateHash } from '../public/js/core/sim.js';
import {
  TILE, COYOTE_TICKS, TETHER_COOLDOWN_TICKS,
} from '../public/js/core/config.js';

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
// Fixture helpers
// ---------------------------------------------------------------------------
function mkLevel(grid, entities = []) {
  return {
    id: 'fixture', name: 'fixture', world: 0, index: 0, palette: 'moss',
    audioSeed: 1, grid, entities, par: 60,
  };
}

// run the sim `ticks` times with a fixed input
function run(state, level, input, ticks) {
  for (let i = 0; i < ticks; i++) step(state, input, level);
  return state;
}

function fresh(level) { return createState(level, 7); }

// ---------------------------------------------------------------------------
// 1. One-way platforms
// ---------------------------------------------------------------------------
console.log('\nOne-way platforms:');

const owGrid = [
  '................',
  'P..............G',
  '................',
  '................',
  '================',
  '################',
];
// row 4 is one-way at y=128; row 5 solid at y=160

ok('lands from above only', () => {
  const s = fresh(mkLevel(owGrid));
  s.player.x = 5 * TILE; s.player.y = 20; // above the one-way, falling
  run(s, mkLevel(owGrid), makeInput(), 120);
  assert(s.player.grounded, 'player is grounded after falling onto one-way');
  assert(Math.abs(s.player.y - (4 * TILE - 24)) < 0.01, 'feet rest exactly on one-way top');
});

ok('passes through from below', () => {
  const s = fresh(mkLevel(owGrid));
  // start on the solid floor below, jump upward through the one-way
  s.player.x = 5 * TILE;
  s.player.y = 5 * TILE - 24; // feet on solid floor row 5
  s.player.grounded = true;
  const lvl = mkLevel(owGrid);
  run(s, lvl, makeInput({ jumpPressed: true, jumpHeld: true }), 1);
  // find max height over a long run; must rise ABOVE the one-way (bottom < 128)
  let minBottom = s.player.y + s.player.h;
  for (let i = 0; i < 60; i++) { step(s, makeInput({ jumpHeld: true }), lvl); minBottom = Math.min(minBottom, s.player.y + s.player.h); }
  assert(minBottom < 4 * TILE, 'jump passes through one-way from below (bottom ' + minBottom + ')');
});

ok('drop-through with down+jump', () => {
  const lvl = mkLevel(owGrid);
  const s = fresh(lvl);
  s.player.x = 5 * TILE; s.player.y = 4 * TILE - 24; s.player.grounded = true;
  run(s, lvl, makeInput({ down: true, jumpPressed: true }), 1);
  // within the drop window the player must be airborne and pass the one-way top
  run(s, lvl, makeInput(), 4);
  assert(!s.player.grounded, 'player is airborne after drop-through');
  assert(s.player.y + s.player.h > 4 * TILE, 'feet have fallen below the one-way top');
  // and they must NOT have landed back on the one-way later (they reach the floor below)
  run(s, lvl, makeInput(), 40);
  assert(s.player.grounded, 'player eventually lands on the solid floor below');
});

ok('no landing on one-way from the side/underneath while rising', () => {
  // rising into the one-way must never set grounded
  const s = fresh(mkLevel(owGrid));
  s.player.x = 5 * TILE; s.player.y = 3 * TILE + 10; s.player.vy = -6; s.player.grounded = false;
  run(s, mkLevel(owGrid), makeInput(), 5);
  assert(!s.player.grounded, 'not grounded while rising through one-way');
});

// ---------------------------------------------------------------------------
// 2. Moving platforms — exact-delta carry + no tunneling
// ---------------------------------------------------------------------------
console.log('\nMoving platforms:');

function carryGrid() {
  return mkLevel([
    '................',
    'P..............G',
    '................',
    '................',
    '................',
    '................',
    '################',
  ], [{
    type: 'platform', id: 'pl', x: 2, y: 4, w: 2, h: 1,
    path: [[2, 4], [2, 2]], period: 80, phase: 0,
  }]);
}

ok('rider carried by exact platform delta', () => {
  const lvl = carryGrid();
  const s = fresh(lvl);
  const pl = s.platforms[0];
  // stand on the platform
  s.player.x = pl.x + 8; s.player.y = pl.y - 24; s.player.grounded = true; s.player.onPlatform = pl.id;
  const before = { x: s.player.x, y: s.player.y, platX: pl.x, platY: pl.y };
  step(s, makeInput(), lvl);
  const dx = pl.x - before.platX, dy = pl.y - before.platY;
  assert(Math.abs((s.player.x - before.x) - dx) < 1e-6, 'player x delta == platform delta');
  assert(Math.abs((s.player.y - before.y) - dy) < 1e-6, 'player y delta == platform delta');
  assert(Math.abs(s.player.y - (pl.y - 24)) < 1e-6, 'rider stays snapped to platform top');
});

ok('rider stays grounded through a full platform cycle', () => {
  const lvl = carryGrid();
  const s = fresh(lvl);
  const pl = s.platforms[0];
  s.player.x = pl.x + 8; s.player.y = pl.y - 24; s.player.grounded = true; s.player.onPlatform = pl.id;
  let groundedCount = 0;
  for (let i = 0; i < pl.period; i++) { step(s, makeInput(), lvl); if (s.player.grounded) groundedCount++; }
  assert(groundedCount === pl.period, 'rider grounded on every tick of the cycle (' + groundedCount + '/' + pl.period + ')');
});

ok('no tunneling: platform pushing rider into a wall clamps (never overlaps)', () => {
  const lvl = mkLevel([
    '........#######.',
    'P......########G',
    '........#######.',
    '................',
    '................',
    '################',
  ], [{
    type: 'platform', id: 'pl', x: 6, y: 4, w: 2, h: 1,
    path: [[6, 4], [8, 4]], period: 120, phase: 0,
  }]);
  // the platform path pushes right into a solid wall column at x=9
  const s = fresh(lvl);
  const pl = s.platforms[0];
  s.player.x = pl.x + 8; s.player.y = pl.y - 24; s.player.grounded = true; s.player.onPlatform = pl.id;
  let minWallDist = Infinity;
  for (let i = 0; i < 200; i++) {
    step(s, makeInput(), lvl);
    const wallLeft = 9 * TILE;
    minWallDist = Math.min(minWallDist, wallLeft - (s.player.x + s.player.w));
  }
  assert(minWallDist >= -0.01, 'player never penetrates the wall (min clearance ' + minWallDist.toFixed(2) + 'px)');
});

// ---------------------------------------------------------------------------
// 3. Corners / penetration threshold
// ---------------------------------------------------------------------------
console.log('\nCorners & edges:');

ok('walking off a ledge grants coyote time, not instant fall grounding', () => {
  const lvl = mkLevel([
    '............',
    'P..........G',
    '####........',
    '###########.',
  ]);
  const s = fresh(lvl);
  // stand on the ledge (row 2, solid cols 0..3) near its right edge
  s.player.x = 88; // center 95, over col 2
  s.player.y = 2 * TILE - 24; s.player.grounded = true;
  // walk right off the ledge
  run(s, lvl, makeInput({ right: true }), 14);
  assert(!s.player.grounded, 'no longer grounded after walking off edge');
  assert(s.player.coyoteTicks > 0, 'coyote timer is active after leaving ledge (ticks=' + s.player.coyoteTicks + ')');
});

ok('no corner-grab false positive (1px overhang does not land)', () => {
  const lvl = mkLevel([
    '............',
    'P..........G',
    '####........',
    '###########.',
  ]);
  const s = fresh(lvl);
  // hang 1px over the ledge edge while falling
  s.player.x = 8 * TILE + (TILE - 14) / 2 - 2;
  s.player.y = 2 * TILE - 24 - 30; s.player.vy = 6; s.player.grounded = false;
  run(s, lvl, makeInput(), 12);
  // center column is NOT over the ledge, so it must not land there
  assert(!s.player.grounded || s.player.y + s.player.h > 2 * TILE + 0.5, '1px overhang does not register as grounded on the ledge');
});

ok('lands on a narrow 1-tile platform only when centered', () => {
  const lvl = mkLevel([
    'P...........G',
    '.....=......',
    '............',
    '############',
  ]);
  const s = fresh(lvl);
  // drop dead-center onto the 1-tile one-way at column 5 (top y=32)
  s.player.x = 5 * TILE + (TILE - 14) / 2;
  s.player.y = 5; s.player.grounded = false;
  run(s, lvl, makeInput(), 40);
  assert(s.player.grounded, 'centered landing on 1-tile platform works');
  assert(Math.abs(s.player.y - (1 * TILE - 24)) < 0.01, 'feet rest on the one-way top');
});

// ---------------------------------------------------------------------------
// 4. Tether: placement, overlap, recall resolution, cooldown
// ---------------------------------------------------------------------------
console.log('\nTether:');

const tetherGrid = [
  'P...........',
  '...........G',
  '............',
  '............',
  '##########..',
];

ok('place anchor at free position', () => {
  const lvl = mkLevel(tetherGrid);
  const s = fresh(lvl);
  run(s, lvl, makeInput({ tetherPressed: true }), 1);
  assert(s.tether !== null, 'anchor placed on tether press');
  assert(s.tether.active, 'anchor is active');
});

ok('recall resolves to a non-overlapping valid position', () => {
  const lvl = mkLevel([
    'P..........',
    '..........G',
    '#..........',
    '#..........',
    '###########',
  ]);
  const s = fresh(lvl);
  // Anchor parked 5px right of the wall's right edge (x=32): the direct player
  // AABB pokes 2px into the wall. The resolver must nudge to the nearest free
  // spot (offset [+2,0]) — never overlapping geometry.
  s.cooldownUntilTick = s.tick;
  s.tether = { x: 37, y: 112, active: true, placedTick: 0 };
  s.player.x = 0 * TILE; s.player.y = 4 * TILE - 24; s.player.grounded = true;
  run(s, lvl, makeInput({ tetherPressed: true }), 1);
  const p = s.player;
  assert(s.tether === null, 'recall consumed the anchor');
  assert(p.vx === 0 && p.vy === 0, 'recall zeroes velocity');
  // Must not overlap the wall (col 0, rows 2..3)
  const wallRight = 32;
  const overlapsWall = p.x < wallRight && p.y + p.h > 2 * TILE;
  assert(!overlapsWall, 'recalled player does not overlap the wall (x=' + p.x + ', y=' + p.y + ')');
  // Must have resolved to the expected free offset position
  assert(Math.abs(p.x - 32) < 0.01, 'resolved x = wall edge + 0 (got ' + p.x + ')');
  assert(Math.abs(p.y - 100) < 0.01, 'resolved y = anchor top (got ' + p.y + ')');
});

ok('fully blocked recall fails safe (keeps anchor)', () => {
  // Anchor buried under a full-width ceiling with no free pocket around it.
  const lvl = mkLevel([
    'P..........',
    '..........G',
    '############',
    '############',
  ]);
  const s = fresh(lvl);
  s.cooldownUntilTick = s.tick;
  s.tether = { x: 5 * TILE + TILE / 2, y: 3 * TILE + TILE / 2, active: true, placedTick: 0 };
  s.player.x = 0 * TILE; s.player.y = 0 * TILE; s.player.grounded = true;
  run(s, lvl, makeInput({ tetherPressed: true }), 1);
  assert(s.tether !== null, 'blocked recall no-ops and retains the anchor');
});

ok('recall is cooldown-gated (exercises real state, no hand-poking)', () => {
  const lvl = mkLevel(tetherGrid);
  const s = fresh(lvl);
  run(s, lvl, makeInput({ tetherPressed: true }), 1); // place (placement is free)
  assert(s.tether !== null, 'anchor placed');
  run(s, lvl, makeInput({ tetherPressed: true }), 1); // recall -> cooldown written to STATE
  assert(s.tether === null, 'anchor consumed on recall');
  assert(s.cooldownUntilTick === s.tick + TETHER_COOLDOWN_TICKS, 'cooldown written to state.cooldownUntilTick on recall');
  // While cooling, a press must not place AND must not recall (both are gated).
  const cd = s.cooldownUntilTick;
  run(s, lvl, makeInput({ tetherPressed: true }), 1);
  assert(s.tether === null, 'placement blocked while cooling (press no-ops)');
  assert(s.cooldownUntilTick === cd, 'cooldown unchanged by a blocked press');
  // Let the cooldown expire by idling past it.
  const wait = cd - s.tick + 1;
  run(s, lvl, makeInput(), wait);
  assert(s.tick >= s.cooldownUntilTick, 'cooldown has elapsed');
  // Now a press places a fresh anchor again.
  run(s, lvl, makeInput({ tetherPressed: true }), 1);
  assert(s.tether !== null, 'placement allowed once cooldown has elapsed');
});

ok('tether clears on death', () => {
  const lvl = mkLevel([
    'P...........',
    '...........G',
    '............',
    '............',
    '##########..',
  ]);
  const s = fresh(lvl);
  run(s, lvl, makeInput({ tetherPressed: true }), 1);
  assert(s.tether !== null, 'anchor placed');
  // fall into the pit (right side is open) to die
  s.player.x = 11 * TILE; s.player.y = 3 * TILE; s.player.vy = 0;
  run(s, lvl, makeInput(), 200);
  // death -> deterministic reset back to spawn (dead is transient within a tick;
  // the deaths counter is the observable). x stays at spawn.x (no steering).
  assert(s.deaths === 1, 'player died in pit (deaths=' + s.deaths + ')');
  assert(s.player.x === s.spawn.x, 'player reset to spawn x after death');
  assert(s.tether === null, 'tether cleared on death');
});

ok('lantern refreshes tether cooldown', () => {
  const lvl = mkLevel([
    'P....L...G',
    '##########',
  ]);
  const s = fresh(lvl);
  run(s, lvl, makeInput({ tetherPressed: true }), 1); // place
  run(s, lvl, makeInput({ tetherPressed: true }), 1); // recall -> cooldown set on state
  assert(s.tether === null && s.cooldownUntilTick > s.tick, 'cooling after recall (state-level cooldown)');
  // place the player directly on the lantern (col 5) and step
  s.player.x = 5 * TILE; s.player.y = 0 * TILE; s.player.grounded = true;
  run(s, lvl, makeInput(), 1);
  assert(s.cooldownUntilTick <= s.tick, 'lantern refreshed the state-level cooldown to immediate');
});

// ---------------------------------------------------------------------------
// 4b. One-way platforms — no side-snag (recommended #5)
// ---------------------------------------------------------------------------
console.log('\nOne-way side-snag:');

ok('no side-snag: rising through a one-way while moving sideways', () => {
  // One-way spans row 3 cols 0..3; the player starts beneath it, rising fast
  // and holding right. Before the fix, horizontal collision treated the
  // one-way as solid and snapped x to its left edge (vx zeroed).
  const lvl = mkLevel([
    '................',
    'P..............G',
    '................',
    '====...........=',
    '................',
    '################',
  ]);
  const s = fresh(lvl);
  s.player.x = 1 * TILE + 6;
  s.player.y = 4 * TILE + 12;
  s.player.vy = -10;
  s.player.grounded = false;
  const startX = s.player.x;
  run(s, lvl, makeInput({ right: true, jumpHeld: true }), 16);
  assert(s.player.y + s.player.h < 3 * TILE + 1, 'player rose above the one-way top (bottom=' + (s.player.y + s.player.h).toFixed(1) + ')');
  assert(s.player.x > startX + 5, 'player kept moving right through the one-way (x=' + s.player.x.toFixed(1) + ', start=' + startX + ')');
  assert(Math.abs(s.player.vx) > 0.5, 'horizontal velocity not zeroed by the one-way');
});

ok('no side-snag: drop-through with sideways motion does not jerk', () => {
  const lvl = mkLevel([
    'P..............G',
    '................',
    '====...........=',
    '................',
    '################',
  ]);
  const s = fresh(lvl);
  // Stand on the one-way at row 2 and drop through while holding right.
  s.player.x = 2 * TILE + 6; s.player.y = 2 * TILE - 24; s.player.grounded = true;
  const startX = s.player.x;
  run(s, lvl, makeInput({ down: true, jumpPressed: true, right: true }), 1);
  run(s, lvl, makeInput({ down: true, right: true }), 8);
  assert(!s.player.grounded, 'player is airborne after drop-through');
  assert(s.player.y + s.player.h > 2 * TILE, 'player has fallen below the one-way top');
  assert(s.player.x >= startX - 1, 'no horizontal snap during drop-through (x=' + s.player.x.toFixed(1) + ')');
});

// ---------------------------------------------------------------------------
// 5. Determinism sanity (run-twice hash equal)
// ---------------------------------------------------------------------------
console.log('\nDeterminism:');

ok('identical runs produce identical hashes', () => {
  const lvl = mkLevel([
    'P.......L..',
    '.........G',
    '=====......',
    '..........',
    '##########',
  ], [{
    type: 'platform', id: 'pl', x: 2, y: 1, w: 2, h: 1,
    path: [[2, 1], [4, 1], [4, 0], [2, 0]], period: 96, phase: 0,
  }]);
  const inputs = [];
  for (let i = 0; i < 600; i++) {
    const r = ((i * 2654435761) >>> 0) % 1000 / 1000;
    inputs.push(makeInput({
      right: r < 0.35, left: r >= 0.35 && r < 0.5,
      jumpPressed: r >= 0.5 && r < 0.55,
      jumpHeld: r >= 0.5 && r < 0.7,
      tetherPressed: r >= 0.7 && r < 0.73,
    }));
  }
  const a = fresh(lvl), b = fresh(lvl);
  for (const inp of inputs) { step(a, inp, lvl); step(b, inp, lvl); }
  assert(stateHash(a) === stateHash(b), 'two runs with identical seeds/inputs hash identically');
  assert(!Number.isNaN(a.player.x) && !Number.isNaN(a.player.y), 'no NaN in player position');
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.error('\nFailures:\n' + failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
