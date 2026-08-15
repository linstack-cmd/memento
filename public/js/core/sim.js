// TETHER — core/sim.js
// Pure, DOM-free, deterministic fixed-step simulation.
//
// HARD INVARIANTS (violating any of these fails the build):
//  1. step() depends ONLY on `state.tick`, `input`, and `level` data — never
//     on Date.now/performance.now, DOM, or global mutable state.
//  2. Rendering/audio/camera/particles consume the state produced by step();
//     they never call step() and never mutate the state that step() reads.
//  3. Every mutation flows through createState() -> step() -> resetState().
//  4. The reachability solver executes THIS step function (it is not a
//     reimplementation).
//
// This module imports nothing but config.js and rng.js, so it runs identically
// in the browser and in Node (tools/*.js and tests/*.js import it directly).

import {
  TILE, PLAYER_W, PLAYER_H,
  MOVE_ACCEL, AIR_ACCEL, FRICTION, AIR_DRAG, MAX_RUN,
  GRAVITY, MAX_FALL, JUMP_V, DOUBLE_JUMP_V, JUMP_HOLD_TICKS, JUMP_CUT_FACTOR,
  COYOTE_TICKS, JUMP_BUFFER_TICKS, DROP_THROUGH_TICKS,
  TETHER_COOLDOWN_TICKS, ANCHOR_SIZE, RECALL_OFFSET_SEARCH,
  DEATH_Y_MARGIN, CHARS,
} from './config.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const isSolidChar = (c) => c === CHARS.SOLID;
const isOneWayChar = (c) => c === CHARS.ONEWAY;

export function levelSize(level) {
  return { w: level.grid[0].length * TILE, h: level.grid.length * TILE };
}

// Character at tile coordinates (or null out of bounds).
export function tileAt(level, tx, ty) {
  if (ty < 0 || ty >= level.grid.length) return null;
  const row = level.grid[ty];
  if (tx < 0 || tx >= row.length) return null;
  return row[tx];
}

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------
function parseGrid(level) {
  // Parse the ASCII grid into entity lists. Entities (motes, lanterns, spikes,
  // spawn, gate) may also be declared in level.entities with explicit px
  // positions; grid chars are the primary authoring format.
  const grid = level.grid;
  const H = grid.length;
  const W = grid[0].length;
  const motes = [];
  const lanterns = [];
  const spikes = [];
  let spawn = null;
  let gate = null;

  for (let ty = 0; ty < H; ty++) {
    const row = grid[ty];
    for (let tx = 0; tx < W; tx++) {
      const c = row[tx];
      const cx = tx * TILE + TILE / 2;
      const cy = ty * TILE + TILE / 2;
      if (c === CHARS.MOTE) motes.push({ id: `m${moteIdCounter++}`, x: tx * TILE, y: ty * TILE, w: TILE, h: TILE, collected: false });
      else if (c === CHARS.LANTERN) lanterns.push({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE });
      else if (c === CHARS.SPIKE) spikes.push({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE });
      else if (c === CHARS.SPAWN) spawn = { x: tx * TILE + (TILE - PLAYER_W) / 2, y: ty * TILE + (TILE - PLAYER_H) };
      else if (c === CHARS.GATE) gate = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    }
  }

  // Explicit entity declarations (px coordinates) supplement the grid.
  const ent = level.entities || [];
  for (const e of ent) {
    if (e.type === 'mote') motes.push({ id: e.id || `m${moteIdCounter++}`, x: e.x + TILE / 2, y: e.y + TILE / 2, w: TILE, h: TILE, collected: false });
    else if (e.type === 'lantern') lanterns.push({ x: e.x, y: e.y, w: TILE, h: TILE });
    else if (e.type === 'spike') spikes.push({ x: e.x, y: e.y, w: TILE, h: TILE });
  }

  if (!spawn) throw new Error(`level ${level.id}: missing spawn (P)`);
  if (!gate) throw new Error(`level ${level.id}: missing gate (G)`);

  return { motes, lanterns, spikes, spawn, gate, W, H };
}

let moteIdCounter = 0;

// Build moving platform run state from level.entities (platform type).
function parsePlatforms(level) {
  const platforms = [];
  const ent = level.entities || [];
  for (const e of ent) {
    if (e.type !== 'platform') continue;
    const path = (e.path || []).map((p) => ({ x: p[0] * TILE, y: p[1] * TILE }));
    if (path.length < 2) throw new Error(`level ${level.id}: platform needs >= 2 path points`);
    const period = e.period || (path.length - 1) * 60;
    const phase = e.phase || 0;
    const start = posAt(path, 0, period, phase);
    platforms.push({
      id: e.id || `plat${platforms.length}`,
      x: start.x, y: start.y,
      w: (e.w || 1) * TILE, h: (e.h || 1) * TILE,
      path, period, phase,
      prevX: start.x, prevY: start.y,
    });
  }
  return platforms;
}

// Piecewise-linear loop interpolation along a path. `tick` is the sim tick.
export function posAt(path, tick, period, phase) {
  if (period <= 0) return { x: path[0].x, y: path[0].y };
  const N = path.length;
  const p = ((tick + (phase || 0)) % period) / period; // 0..1
  const s = p * N;                                     // 0..N (loop closes)
  let i = Math.floor(s) % N;
  const frac = s - Math.floor(s);
  const a = path[i];
  const b = path[(i + 1) % N];
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
}

export function createState(level, seed = 1) {
  const parsed = parseGrid(level);
  const platforms = parsePlatforms(level);
  return {
    tick: 0,
    seed,
    player: {
      x: parsed.spawn.x, y: parsed.spawn.y,
      w: PLAYER_W, h: PLAYER_H,
      vx: 0, vy: 0,
      grounded: false, onPlatform: null,
      coyoteTicks: 0, jumpBufferTicks: 0,
      jumpsUsed: 0, facing: 1,
      dropThroughTicks: 0, jumpHoldTicks: 0,
    },
    tether: null,
    cooldownUntilTick: 0, // tether cooldown lives on STATE (B2) — set on recall, gates place+recall
    motes: parsed.motes,
    lanterns: parsed.lanterns,
    spikes: parsed.spikes,
    platforms,
    gate: parsed.gate,
    gateOpen: false,
    collectedCount: 0,
    totalMotes: parsed.motes.length,
    dead: false,
    won: false,
    deaths: 0,
    spawn: parsed.spawn,
    W: parsed.W, H: parsed.H,
  };
}

// The single deterministic reset path (level start, death, restart).
export function resetPlayer(state, keepMotes = true) {
  const p = state.player;
  p.x = state.spawn.x; p.y = state.spawn.y;
  p.vx = 0; p.vy = 0;
  p.grounded = false; p.onPlatform = null;
  p.coyoteTicks = 0; p.jumpBufferTicks = 0;
  p.jumpsUsed = 0; p.facing = 1;
  p.dropThroughTicks = 0; p.jumpHoldTicks = 0;
  state.tether = null;          // tether clears on death
  state.cooldownUntilTick = state.tick; // cooldown resets on the reset path (B2)
  state.dead = false;
  if (!keepMotes) {
    for (const m of state.motes) m.collected = false;
    state.collectedCount = 0;
  }
  state.deaths++;
}

// ---------------------------------------------------------------------------
// Collision
// ---------------------------------------------------------------------------
function rectOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Is a tile solid for HORIZONTAL collision? One-way platforms are NEVER solid
// from the side (recommended #5) — jumping up through a one-way while moving
// sideways must not snag the player; they only ever block landing from above.
function solidForX(level, tx, ty) {
  const c = tileAt(level, tx, ty);
  return c !== null && isSolidChar(c);
}

// Move player horizontally against solid tiles (thin-edge sweep, sub-TILE speeds).
function moveX(state, level) {
  const p = state.player;
  p.x += p.vx;

  // World-boundary clamp (item 13): the player must never leave the level.
  // Without this, walking left from a spawn near the edge pushed the AABB
  // center column out of bounds, the floor vanished, and the moth fell into
  // the left-edge void death. Clamp BEFORE the `vx === 0` early-out so a
  // clamped player at the exact boundary is always resolved.
  const maxX = state.W * TILE - p.w;
  if (p.x < 0) { p.x = 0; p.vx = 0; }
  else if (p.x > maxX) { p.x = maxX; p.vx = 0; }

  if (p.vx === 0) return;

  const top = Math.floor(p.y / TILE);
  const bottom = Math.floor((p.y + p.h - 1) / TILE);
  if (p.vx > 0) {
    const tx = Math.floor((p.x + p.w) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      if (solidForX(level, tx, ty)) {
        p.x = tx * TILE - p.w - 0.001;
        p.vx = 0;
        break;
      }
    }
  } else {
    const tx = Math.floor(p.x / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      if (solidForX(level, tx, ty)) {
        p.x = (tx + 1) * TILE + 0.001;
        p.vx = 0;
        break;
      }
    }
  }
}

// Is there a one-way platform tile directly under the feet?
function oneWayBelow(level, p) {
  const txL = Math.floor(p.x / TILE);
  const txR = Math.floor((p.x + p.w - 1) / TILE);
  // The tile whose top the feet rest on (add a hair so an exact boundary
  // resolves to the tile below the feet).
  const ty = Math.floor((p.y + p.h + 0.001) / TILE);
  for (let tx = txL; tx <= txR; tx++) {
    if (isOneWayChar(tileAt(level, tx, ty))) return true;
  }
  return false;
}

// Move player vertically; land on solid tiles, one-way platforms (from above
// only), and moving platform tops. Returns true if landed this tick.
function moveY(state, level) {
  const p = state.player;
  const prevBottom = p.y + p.h;
  p.y += p.vy;

  if (p.vy > 0) {
    // --- tiles ---
    // Land only when the AABB CENTER column sits over a supporting tile
    // (penetration threshold) — this kills corner-grab false positives.
    const ty = Math.floor((p.y + p.h) / TILE);
    const centerTx = Math.floor((p.x + p.w / 2) / TILE);
    const c = tileAt(level, centerTx, ty);
    if (c !== null) {
      if (isSolidChar(c)) {
        p.y = ty * TILE - p.h;
        p.vy = 0;
        p.grounded = true;
        p.onPlatform = null;
        return true;
      }
      if (isOneWayChar(c)) {
        const prevFeet = prevBottom;
        if (prevFeet <= ty * TILE + 0.001 && p.dropThroughTicks <= 0) {
          p.y = ty * TILE - p.h;
          p.vy = 0;
          p.grounded = true;
          p.onPlatform = null;
          return true;
        }
      }
    }

    // --- moving platforms (require >= 6 px horizontal overlap to land) ---
    for (const plat of state.platforms) {
      const prevFeet = prevBottom;
      if (prevFeet <= plat.y + 0.001 && p.y + p.h >= plat.y && p.y + p.h <= plat.y + plat.h + p.vy + 1) {
        const overlapLeft = p.x + p.w - plat.x;
        const overlapRight = plat.x + plat.w - p.x;
        if (overlapLeft >= 6 && overlapRight >= 6) {
          p.y = plat.y - p.h;
          p.vy = 0;
          p.grounded = true;
          p.onPlatform = plat.id;
          return true;
        }
      }
    }
  } else if (p.vy < 0) {
    // --- ceiling ---
    const ty = Math.floor(p.y / TILE);
    const txL = Math.floor(p.x / TILE);
    const txR = Math.floor((p.x + p.w - 1) / TILE);
    for (let tx = txL; tx <= txR; tx++) {
      if (isSolidChar(tileAt(level, tx, ty))) {
        p.y = (ty + 1) * TILE + 0.001;
        p.vy = 0;
        break;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tether
// ---------------------------------------------------------------------------
function placeTether(state, level) {
  const p = state.player;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  // Place only where the player AABB fits free space (faithful to the plan).
  const probe = { x: cx - ANCHOR_SIZE / 2, y: cy - ANCHOR_SIZE / 2, w: ANCHOR_SIZE, h: ANCHOR_SIZE };
  if (!aabbFree(state, level, probe)) return false;
  state.tether = {
    x: cx, y: cy,
    active: true,
    placedTick: state.tick,
  };
  return true;
}

function aabbFree(state, level, a) {
  // Not inside a solid tile and not overlapping a spike or moving platform.
  const top = Math.floor(a.y / TILE);
  const bottom = Math.floor((a.y + a.h - 1) / TILE);
  const left = Math.floor(a.x / TILE);
  const right = Math.floor((a.x + a.w - 1) / TILE);
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      const c = tileAt(level, tx, ty);
      if (c !== null && isSolidChar(c)) return false;
    }
  }
  for (const s of state.spikes) if (rectOverlap(a, s)) return false;
  for (const pl of state.platforms) if (rectOverlap(a, pl)) return false;
  return true;
}

function recallTether(state, level) {
  const t = state.tether;
  if (!t) return false;
  const p = state.player;
  const anchorCx = t.x;
  const anchorCy = t.y;
  // Resolve to a valid non-overlapping position via deterministic offset search.
  for (const off of RECALL_OFFSET_SEARCH) {
    const probe = {
      x: anchorCx - p.w / 2 + off.x,
      y: anchorCy - p.h / 2 + off.y,
      w: p.w, h: p.h,
    };
    // Must be fully inside the level and free of solids/spikes/platforms.
    if (probe.x < 0 || probe.y < 0 || probe.x + probe.w > state.W * TILE || probe.y + probe.h > state.H * TILE) continue;
    if (!aabbFree(state, level, probe)) continue;
    p.x = probe.x; p.y = probe.y;
    p.vx = 0; p.vy = 0;
    p.grounded = false; p.onPlatform = null;
    p.coyoteTicks = 0; p.jumpBufferTicks = 0;
    p.dropThroughTicks = 0;
    // B2: cooldown lives on STATE — the anchor object is discarded on recall,
    // so writing it there would be lost. Store it on the state instead.
    state.cooldownUntilTick = state.tick + TETHER_COOLDOWN_TICKS;
    state.tether = null; // recall consumes the anchor -> clean place/recall loop
    return true;
  }
  return false; // fully blocked: fail safe, keep anchor
}

function processTether(state, level) {
  // B2: both placement AND recall are gated on the state-level cooldown.
  // While cooling, a press no-ops (prevents spam place→recall→place).
  if (state.tick < state.cooldownUntilTick) return;
  if (state.tether) {
    recallTether(state, level);
  } else {
    placeTether(state, level);
  }
}

// ---------------------------------------------------------------------------
// Death / reset
// ---------------------------------------------------------------------------
function checkDeath(state, level) {
  const p = state.player;
  const size = levelSize(level);
  // Pit: fell below the level (or beyond it to the sides is clamped, so only down matters).
  if (p.y > size.h + DEATH_Y_MARGIN) return true;
  // Spikes / thorns
  for (const s of state.spikes) {
    const hurt = { x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 4 };
    if (rectOverlap(hurt, s)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main step — one fixed tick.
// ---------------------------------------------------------------------------
export function step(state, input, level) {
  if (state.dead || state.won) return;
  const p = state.player;

  state.tick++;

  // --- timers ---
  p.coyoteTicks = p.grounded ? COYOTE_TICKS : Math.max(0, p.coyoteTicks - 1);
  if (input.jumpPressed) p.jumpBufferTicks = JUMP_BUFFER_TICKS;
  else p.jumpBufferTicks = Math.max(0, p.jumpBufferTicks - 1);
  p.dropThroughTicks = Math.max(0, p.dropThroughTicks - 1);
  if (p.jumpHoldTicks > 0) p.jumpHoldTicks--;

  // --- moving platforms advance first; exact-delta rider carry ---
  for (const plat of state.platforms) {
    plat.prevX = plat.x; plat.prevY = plat.y;
    const np = posAt(plat.path, state.tick, plat.period, plat.phase);
    plat.x = np.x; plat.y = np.y;
    if (p.grounded && p.onPlatform === plat.id) {
      const dx = plat.x - plat.prevX;
      const dy = plat.y - plat.prevY;
      p.x += dx;
      p.y += dy;
    }
  }

  // --- horizontal control ---
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const accel = p.grounded ? MOVE_ACCEL : AIR_ACCEL;
  if (dir !== 0) {
    p.vx = clamp(p.vx + dir * accel, -MAX_RUN, MAX_RUN);
    p.facing = dir;
  } else {
    const drag = p.grounded ? FRICTION : AIR_DRAG;
    if (p.vx > 0) p.vx = Math.max(0, p.vx - drag);
    else if (p.vx < 0) p.vx = Math.min(0, p.vx + drag);
  }
  moveX(state, level);

  // --- jump / double jump / drop-through ---
  if (p.jumpBufferTicks > 0) {
    const canGroundJump = p.grounded || p.coyoteTicks > 0;
    if (canGroundJump && p.dropThroughTicks <= 0) {
      if (input.down && oneWayBelow(level, p)) {
        // drop through a one-way platform
        p.dropThroughTicks = DROP_THROUGH_TICKS;
        p.grounded = false;
        p.onPlatform = null;
        p.vy = Math.max(p.vy, 1);
        p.y += 2;
        p.jumpBufferTicks = 0;
      } else {
        p.vy = -JUMP_V;
        p.jumpHoldTicks = JUMP_HOLD_TICKS;
        p.grounded = false;
        p.onPlatform = null;
        p.coyoteTicks = 0;
        p.jumpBufferTicks = 0;
        p.jumpsUsed = 1;
      }
    } else if (!p.grounded && p.jumpsUsed < 2 && p.jumpBufferTicks === JUMP_BUFFER_TICKS) {
      // double jump — only on a fresh press (never from a stale buffered press)
      p.vy = -DOUBLE_JUMP_V;
      p.jumpHoldTicks = 2;
      p.jumpsUsed = 2;
      p.jumpBufferTicks = 0;
    }
  }

  // variable-height: hold keeps rising; early release cuts
  if (!input.jumpHeld && p.vy < 0 && p.jumpHoldTicks > 0) {
    p.vy *= JUMP_CUT_FACTOR;
    p.jumpHoldTicks = 0;
  }

  // --- gravity ---
  p.vy = Math.min(p.vy + GRAVITY, MAX_FALL);

  // --- vertical resolve ---
  const wasGrounded = p.grounded;
  const landed = moveY(state, level);
  if (landed) p.jumpsUsed = 0; // landing refills the double jump
  if (!landed) {
    p.grounded = false;
    p.onPlatform = null;
  } else if (p.grounded && wasGrounded && p.vy === 0) {
    // already fine
  }

  // --- tether ---
  if (input.tetherPressed) processTether(state, level);

  // --- pickups ---
  const pb = { x: p.x, y: p.y, w: p.w, h: p.h };
  // Motes are collected generously (padded box) so a grazing pass always picks
  // them up — no frame-perfect collection, and the ±3-tick slack guarantee holds.
  for (const m of state.motes) {
    if (!m.collected) {
      const box = { x: m.x - 16, y: m.y - 16, w: m.w + 32, h: m.h + 32 };
      if (rectOverlap(pb, box)) {
        m.collected = true;
        state.collectedCount++;
      }
    }
  }
  for (const l of state.lanterns) {
    if (rectOverlap(pb, l)) {
      // Lanterns refresh the tether cooldown (B2): touching one lowers the
      // state-level cooldown to the current tick, making the tether ready.
      if (state.cooldownUntilTick > state.tick) state.cooldownUntilTick = state.tick;
    }
  }
  if (!state.gateOpen && state.collectedCount >= state.totalMotes) state.gateOpen = true;

  // --- gate ---
  if (state.gateOpen) {
    // Forgiving trigger: the gate box extends downward so standing on the
    // surface below the gate tile still completes the level.
    const gb = { x: state.gate.x - 8, y: state.gate.y - 8, w: state.gate.w + 16, h: state.gate.h + 32 };
    if (rectOverlap(pb, gb)) {
      state.won = true;
      return;
    }
  }

  // --- death ---
  if (checkDeath(state, level)) {
    state.dead = true;
    resetPlayer(state, true); // keep collected motes; tether clears
  }
}

// ---------------------------------------------------------------------------
// Deterministic hashing (for determinism.js, headless invariants, solver)
// ---------------------------------------------------------------------------
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function stateHash(state) {
  const p = state.player;
  const parts = [
    state.tick,
    Math.round(p.x * 64), Math.round(p.y * 64),
    Math.round(p.vx * 256), Math.round(p.vy * 256),
    p.grounded ? 1 : 0, p.onPlatform || 'n',
    p.coyoteTicks, p.jumpBufferTicks, p.jumpsUsed, p.dropThroughTicks,
    state.tether ? `${Math.round(state.tether.x * 64)},${Math.round(state.tether.y * 64)}` : 'none',
    state.cooldownUntilTick,
    state.gateOpen ? 1 : 0,
    state.collectedCount,
    state.dead ? 1 : 0, state.won ? 1 : 0, state.deaths,
  ];
  for (const pl of state.platforms) parts.push(Math.round(pl.x * 64), Math.round(pl.y * 64));
  return fnv1a(parts.join('|'));
}

// ---------------------------------------------------------------------------
// Cloning (for the solver / replay harness)
// ---------------------------------------------------------------------------
export function cloneState(state) {
  // Player/tether/motes/platforms mutate during step; spikes, lanterns, gate,
  // spawn and the grid are immutable after createState, so they are SHARED
  // (never deep-cloned) — keeps the solver's per-macro clone cheap.
  return {
    tick: state.tick,
    seed: state.seed,
    player: { ...state.player },
    tether: state.tether ? { ...state.tether } : null,
    cooldownUntilTick: state.cooldownUntilTick,
    motes: state.motes.map((m) => ({ ...m })),
    lanterns: state.lanterns,
    spikes: state.spikes,
    platforms: state.platforms.map((pl) => ({ ...pl, path: pl.path.map((pt) => ({ ...pt })) })),
    gate: state.gate,
    gateOpen: state.gateOpen,
    collectedCount: state.collectedCount,
    totalMotes: state.totalMotes,
    dead: state.dead,
    won: state.won,
    deaths: state.deaths,
    spawn: state.spawn,
    W: state.W, H: state.H,
  };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
export function makeInput(o = {}) {
  return {
    left: !!o.left,
    right: !!o.right,
    down: !!o.down,
    jumpPressed: !!o.jumpPressed,
    jumpHeld: !!o.jumpHeld,
    tetherPressed: !!o.tetherPressed,
  };
}
