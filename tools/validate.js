// TETHER — tools/validate.js
// Full schema + invariant validation of levels/*.json (zero npm deps).
//
//   node tools/validate.js
//
// Exits non-zero (build gate) on any violation.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TILE, CHARS, MIN_MOTES, MAX_MOTES, MAX_MOVING_PLATFORMS } from '../public/js/core/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const levelsDir = join(root, 'levels');

const PALETTES = new Set(['moss', 'turquoise', 'ember', 'pale-gold']);
const GRID_CHARS = new Set(['#', '=', '^', 'M', 'L', 'P', 'G', '.', ' ']);
const ENTITY_TYPES = new Set(['mote', 'lantern', 'spike', 'platform']);

let errors = 0;
const seenIds = new Set();
const report = (levelId, msg) => { errors++; console.error(`  ✗ [${levelId}] ${msg}`); };

function validateLevel(level, file) {
  const tag = level.id || file;

  if (typeof level.id !== 'string' || !/^w[1-4]-[1-5]$/.test(level.id)) report(tag, 'id must match /^w[1-4]-[1-5]$/');
  if (seenIds.has(level.id)) report(tag, `duplicate id "${level.id}"`);
  if (level.id) seenIds.add(level.id);

  if (!Number.isInteger(level.world) || level.world < 1 || level.world > 4) report(tag, 'world must be integer 1..4');
  if (!Number.isInteger(level.index) || level.index < 1 || level.index > 5) report(tag, 'index must be integer 1..5');
  if (typeof level.name !== 'string' || level.name.length === 0) report(tag, 'name required');
  if (!PALETTES.has(level.palette)) report(tag, `palette must be one of ${[...PALETTES].join(', ')}`);
  if (typeof level.audioSeed !== 'number' || !Number.isFinite(level.audioSeed)) report(tag, 'audioSeed must be a finite number');
  if (typeof level.par !== 'number' || level.par <= 0) report(tag, 'par must be a positive number');
  if (typeof level.hint !== 'string') report(tag, 'hint (string) required for UI');

  // --- grid ---
  if (!Array.isArray(level.grid) || level.grid.length === 0) return report(tag, 'grid must be a non-empty array');
  const W = level.grid[0].length;
  if (W < 12 || W > 90) report(tag, `grid width ${W} out of bounds [12, 90]`);
  if (level.grid.length < 8 || level.grid.length > 40) report(tag, `grid height ${level.grid.length} out of bounds [8, 40]`);
  const flat = [];
  for (const row of level.grid) {
    if (typeof row !== 'string') return report(tag, 'grid rows must be strings');
    if (row.length !== W) return report(tag, `ragged grid: row length ${row.length} != ${W}`);
    for (const ch of row) {
      if (!GRID_CHARS.has(ch)) return report(tag, `unexpected char "${ch}"`);
      flat.push(ch);
    }
  }

  const count = (c) => flat.filter((x) => x === c).length;
  if (count('P') !== 1) report(tag, `exactly one spawn (P) required, found ${count('P')}`);
  if (count('G') !== 1) report(tag, `exactly one gate (G) required, found ${count('G')}`);
  const gridMotes = count('M');
  const ent = Array.isArray(level.entities) ? level.entities : [];

  // --- entities ---
  if (!Array.isArray(level.entities)) report(tag, 'entities must be an array (may be empty)');
  for (const e of ent) {
    if (!e || !ENTITY_TYPES.has(e.type)) return report(tag, `unknown entity type "${e && e.type}"`);
    const H = level.grid.length;
    const bx = e.x >= 0 && e.x + TILE <= W * TILE;
    const by = e.y >= 0 && e.y + TILE <= H * TILE;
    if (!bx || !by) report(tag, `entity ${e.type} out of bounds (${e.x},${e.y})`);
    if (e.type === 'platform') {
      if (!Array.isArray(e.path) || e.path.length < 2) return report(tag, 'platform needs path of >= 2 tile points');
      for (const pt of e.path) {
        if (!Array.isArray(pt) || pt.length !== 2) return report(tag, 'platform path point must be [x, y]');
        if (pt[0] < 0 || pt[0] + 1 > W || pt[1] < 0 || pt[1] + 1 > H) report(tag, `platform path point (${pt}) out of bounds`);
      }
      if (!Number.isInteger(e.period) || e.period < 40 || e.period > 400) report(tag, `platform period must be integer 40..400 (got ${e.period})`);
      if (!Number.isFinite(e.phase || 0) || e.phase < 0) report(tag, 'platform phase must be >= 0');
      if (!Number.isInteger(e.w) || e.w < 1 || e.w > 5) report(tag, `platform width tiles must be 1..5 (got ${e.w})`);
      if (!Number.isInteger(e.h) || e.h < 1 || e.h > 2) report(tag, `platform height tiles must be 1..2 (got ${e.h})`);
      // Guardrail: platform paths must be HORIZONTAL (constant y). There is no
      // rider-crush clamp in the sim, so vertical paths could embed a carried
      // player in solid geometry. Reject them until a clamp is added.
      const y0 = e.path[0][1];
      if (e.path.some((pt) => pt[1] !== y0)) report(tag, `platform ${e.id} path is vertical — only horizontal paths are safe (no crush clamp)`);
    }
  }

  const totalMotes = gridMotes + ent.filter((e) => e.type === 'mote').length;
  if (totalMotes < MIN_MOTES || totalMotes > MAX_MOTES) report(tag, `motes must be ${MIN_MOTES}-${MAX_MOTES} (found ${totalMotes})`);
  const platforms = ent.filter((e) => e.type === 'platform');
  if (platforms.length > MAX_MOVING_PLATFORMS) report(tag, `too many moving platforms: ${platforms.length} (max ${MAX_MOVING_PLATFORMS})`);

  // --- gate must not be buried under solid ---
  const gIdx = flat.indexOf('G');
  const gy = Math.floor(gIdx / W);
  const gx = gIdx % W;
  if (gy > 0 && level.grid[gy - 1][gx] === '#') report(tag, 'gate buried: solid tile directly above gate');

  // lantern presence encouraged from world 2+
  if (level.world >= 2 && count('L') === 0 && ent.filter((e) => e.type === 'lantern').length === 0) {
    report(tag, 'world >= 2 should include at least one lantern (cooldown valve)');
  }
}

const files = readdirSync(levelsDir).filter((f) => f.endsWith('.json')).sort();
if (files.length !== 20) {
  errors++;
  console.error(`  ✗ expected 20 levels, found ${files.length}`);
}
for (const f of files) {
  const level = JSON.parse(readFileSync(join(levelsDir, f), 'utf8'));
  validateLevel(level, f);
}

// check world x index coverage: exactly 4 worlds x 5
for (let w = 1; w <= 4; w++) {
  for (let i = 1; i <= 5; i++) {
    const id = `w${w}-${i}`;
    if (!seenIds.has(id)) { errors++; console.error(`  ✗ missing level ${id}`); }
  }
}

if (errors) {
  console.error(`\nvalidate: FAILED (${errors} error(s))`);
  process.exit(1);
}
console.log(`validate: OK (${files.length} levels, schema + invariants clean)`);
