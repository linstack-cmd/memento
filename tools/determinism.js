// TETHER — tools/determinism.js
// Run-twice hash comparison. Two identical runs (same seed, same inputs) must
// produce byte-identical state hashes at every checkpoint. Zero npm deps.
//
//   node tools/determinism.js

import { LEVELS } from '../public/js/core/leveldata.js';
import { createState, step, makeInput, stateHash } from '../public/js/core/sim.js';
import { mulberry32 } from '../public/js/core/rng.js';
import { TICK_RATE } from '../public/js/core/config.js';

const RUN_TICKS = 3 * TICK_RATE; // 3 simulated seconds per level
const CHECK_EVERY = 120;         // hash at these intervals
const SEED = 0xBEEF;

let errors = 0;

function runLevel(level, rng) {
  const s = createState(level, SEED);
  const hashes = [];
  for (let t = 0; t < RUN_TICKS; t++) {
    const r = rng();
    const inp = makeInput({
      right: r < 0.32, left: r >= 0.32 && r < 0.52, down: r >= 0.52 && r < 0.58,
      jumpPressed: r >= 0.58 && r < 0.62, jumpHeld: r >= 0.58 && r < 0.72,
      tetherPressed: r >= 0.72 && r < 0.75,
    });
    step(s, inp, level);
    if (t % CHECK_EVERY === 0) hashes.push(stateHash(s));
  }
  hashes.push(stateHash(s));
  return hashes;
}

for (const level of LEVELS) {
  const a = runLevel(level, mulberry32(SEED + level.world * 31 + level.index));
  const b = runLevel(level, mulberry32(SEED + level.world * 31 + level.index));
  let same = a.length === b.length;
  if (same) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  if (!same) {
    errors++;
    console.error(`  ✗ [${level.id}] determinism mismatch (run A != run B)`);
  } else {
    console.log(`  ✓ [${level.id}] ${a.length} checkpoints identical`);
  }
}

if (errors) { console.error(`\ndeterminism: FAILED (${errors} level(s))`); process.exit(1); }
console.log('\ndeterminism: OK — identical runs, identical hashes');
