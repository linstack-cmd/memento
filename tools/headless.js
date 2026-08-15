// TETHER — tools/headless.js
// Deterministic fuzz simulation over every level + invariant assertions +
// per-step perf measurement. Zero npm deps.
//
//   node tools/headless.js
//
// Ship gate #1: "zero JS errors headless" and invariant #9 (perf budget).

import { LEVELS } from '../public/js/core/leveldata.js';
import { createState, step, makeInput, stateHash } from '../public/js/core/sim.js';
import { mulberry32 } from '../public/js/core/rng.js';
import { TICK_RATE, TILE } from '../public/js/core/config.js';

const FUZZ_SECONDS = 5;             // simulated seconds per level (smoke fuzz)
const SEED = 0xC0FFEE;
const PERF_BUDGET_US_PER_STEP = 200; // well under the 8.3 ms/120Hz frame budget

let errors = 0;
const fail = (levelId, msg) => { errors++; console.error(`  ✗ [${levelId}] ${msg}`); };

function assertInvariants(level, s) {
  const p = s.player;
  if (Number.isNaN(p.x) || Number.isNaN(p.y) || Number.isNaN(p.vx) || Number.isNaN(p.vy)) {
    fail(level.id, 'NaN in player state'); return;
  }
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { fail(level.id, 'non-finite player position'); return; }
  if (p.x < -1000 || p.x > (s.W + 40) * TILE) fail(level.id, `player x out of reasonable range (${p.x})`);
  if (p.y > s.H * TILE + 4000) fail(level.id, `player y absurdly below level (${p.y})`);
  for (const pl of s.platforms) {
    if (Number.isNaN(pl.x) || Number.isNaN(pl.y)) { fail(level.id, 'NaN in platform position'); return; }
  }
  let collected = 0;
  for (const m of s.motes) if (m.collected) collected++;
  if (collected !== s.collectedCount) fail(level.id, `collectedCount (${s.collectedCount}) != collected motes (${collected})`);
  if (s.collectedCount > s.totalMotes) fail(level.id, 'collectedCount exceeds totalMotes');
  if (s.gateOpen && s.collectedCount < s.totalMotes) fail(level.id, 'gateOpen without all motes');
}

function fuzzLevel(level) {
  const rng = mulberry32(SEED + level.world * 1000 + level.index);
  const s = createState(level, SEED);
  const totalTicks = FUZZ_SECONDS * TICK_RATE;

  // Perf: run a burst of steps with a fixed input to measure steady-state cost.
  const warm = makeInput({ right: true });
  for (let i = 0; i < 1000; i++) step(s, warm, level);
  const perfStart = process.hrtime.bigint();
  const PERF_SAMPLES = 5000;
  for (let i = 0; i < PERF_SAMPLES; i++) step(s, warm, level);
  const perfNs = Number(process.hrtime.bigint() - perfStart);
  const usPerStep = perfNs / PERF_SAMPLES / 1000;
  if (usPerStep > PERF_BUDGET_US_PER_STEP) fail(level.id, `perf: ${usPerStep.toFixed(1)} µs/step > budget ${PERF_BUDGET_US_PER_STEP}`);

  // Deterministic pseudo-random fuzz (seeded — reproducible failures).
  for (let t = 0; t < totalTicks; t++) {
    const r = rng();
    const inp = makeInput({
      right: r < 0.30,
      left: r >= 0.30 && r < 0.50,
      down: r >= 0.50 && r < 0.56,
      jumpPressed: r >= 0.56 && r < 0.60,
      jumpHeld: r >= 0.56 && r < 0.70,
      tetherPressed: r >= 0.70 && r < 0.73,
    });
    step(s, inp, level);
    if (t % 1200 === 0) assertInvariants(level, s);
  }
  assertInvariants(level, s);

  // sanity: state hash is stable + finite
  const h = stateHash(s);
  if (Number.isNaN(h)) fail(level.id, 'state hash NaN');

  return { usPerStep, deaths: s.deaths, ticks: totalTicks };
}

console.log(`headless: fuzzing ${LEVELS.length} levels, ${FUZZ_SECONDS}s each (seeded ${SEED})`);
let totalUs = 0;
for (const level of LEVELS) {
  const r = fuzzLevel(level);
  totalUs += r.usPerStep;
  console.log(`  ${level.id.padEnd(6)} ${(r.usPerStep).toFixed(1).padStart(7)} µs/step   deaths=${r.deaths}`);
}
const avgUs = totalUs / LEVELS.length;
console.log(`\nheadless: avg ${avgUs.toFixed(1)} µs/step (budget ${PERF_BUDGET_US_PER_STEP} µs — 120 Hz frame = 8333 µs)`);

if (errors) { console.error(`\nheadless: FAILED (${errors} issue(s))`); process.exit(1); }
console.log('headless: OK — no errors, no NaNs, invariants hold, perf within budget');
