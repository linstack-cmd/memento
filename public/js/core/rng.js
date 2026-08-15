// TETHER — core/rng.js
// Seeded deterministic PRNG. The sim may draw from this; the presentation
// layer uses it for procedural atmosphere. Same seed -> same stream everywhere.
// DOM-free, dependency-free.

// mulberry32 — tiny, fast, decent quality, fully deterministic across engines.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic integer in [0, n)
export function randInt(rng, n) {
  return Math.floor(rng() * n);
}

// Deterministic float in [a, b)
export function randRange(rng, a, b) {
  return a + rng() * (b - a);
}

// Deterministic pick from an array
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Normal-ish distribution via summing two uniforms (Irwin–Hall), range [a, b)
export function randBias(rng, a, b) {
  return a + (rng() + rng()) * 0.5 * (b - a);
}
