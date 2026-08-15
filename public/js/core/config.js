// TETHER — core/config.js
// Single source of truth for every simulation constant.
// Imported by the pure sim (browser + Node) AND by the verification tools.
// This module must remain DOM-free and dependency-free.

// ---------------------------------------------------------------------------
// World / timing
// ---------------------------------------------------------------------------
export const TICK_RATE = 120;        // fixed sim timestep (Hz). Wall clock never enters the sim.
export const TILE = 32;              // world units per grid cell

// ---------------------------------------------------------------------------
// Player AABB (moth body)
// ---------------------------------------------------------------------------
export const PLAYER_W = 14;
export const PLAYER_H = 24;

// ---------------------------------------------------------------------------
// Movement tuning (per-tick units, 120 Hz)
// ---------------------------------------------------------------------------
export const MOVE_ACCEL = 0.55;      // ground horizontal acceleration (px/tick^2)
export const AIR_ACCEL = 0.34;       // air control acceleration
export const FRICTION = 0.8;         // ground deceleration when not steering (px/tick^2)
export const AIR_DRAG = 0.10;        // small air drag so max run holds in air
export const MAX_RUN = 3.4;          // top horizontal speed (px/tick ≈ 408 px/s)

export const GRAVITY = 0.55;         // downward acceleration (px/tick^2)
export const MAX_FALL = 12;          // terminal fall speed — strictly < TILE so no tunneling

export const JUMP_V = 9.6;           // ground jump impulse (upward magnitude)
export const DOUBLE_JUMP_V = 8.6;    // double-jump impulse
export const JUMP_HOLD_TICKS = 3;    // ticks jump velocity is maintained while held (variable height)
export const JUMP_CUT_FACTOR = 0.5;  // velocity multiplier when jump released early

export const COYOTE_TICKS = 12;      // ~100 ms of post-ledge jump grace
export const JUMP_BUFFER_TICKS = 12; // ~100 ms of pre-landing jump buffer
export const DROP_THROUGH_TICKS = 7; // one-way platform ignore window after drop-through

// ---------------------------------------------------------------------------
// Tether (light anchor)
// ---------------------------------------------------------------------------
export const TETHER_COOLDOWN_TICKS = 40; // ~333 ms cooldown between recalls
export const ANCHOR_SIZE = 10;           // anchor bloom radius (px)
export const RECALL_OFFSET_SEARCH = [
  { x: 0, y: 0 }, { x: 0, y: -1 }, { x: 0, y: -2 }, { x: 0, y: -3 },
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 2, y: 0 }, { x: -2, y: 0 },
  { x: 1, y: -1 }, { x: -1, y: -1 }, { x: 0, y: -4 },
  { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 0, y: 2 },
]; // deterministic candidate offsets, in px, for recall position resolution

// ---------------------------------------------------------------------------
// Level / hazards
// ---------------------------------------------------------------------------
export const DEATH_Y_MARGIN = 80;        // px below level bottom that counts as falling into a pit

export const MIN_MOTES = 3;              // a level must require at least this many motes
export const MAX_MOTES = 5;
export const MAX_MOVING_PLATFORMS = 3;   // authoring cap (keeps the solver tractable)

// ---------------------------------------------------------------------------
// Derived feel targets (documented for the "manual feel checklist")
// ---------------------------------------------------------------------------
export const FEEL = {
  jumpApexTiles: (JUMP_V * JUMP_V) / (2 * GRAVITY) / TILE,      // ≈ 2.6 tiles
  jumpAirTicks: Math.ceil((2 * JUMP_V) / GRAVITY),              // ≈ 35 ticks
  coyoteMs: Math.round((COYOTE_TICKS / TICK_RATE) * 1000),      // ≈ 100 ms
  bufferMs: Math.round((JUMP_BUFFER_TICKS / TICK_RATE) * 1000), // ≈ 100 ms
  runPxPerSec: MAX_RUN * TICK_RATE,                             // ≈ 408 px/s
};

// ---------------------------------------------------------------------------
// Grid legend (levels/*.json)
// ---------------------------------------------------------------------------
export const CHARS = {
  EMPTY: ['.', ' '],
  SOLID: '#',
  ONEWAY: '=',
  SPIKE: '^',
  MOTE: 'M',
  LANTERN: 'L',
  SPAWN: 'P',
  GATE: 'G',
};
