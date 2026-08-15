// TETHER — game/events.js
// Presentation-only event detection / SFX decisions, driven by real sim
// deltas. Pure functions: they read the post-step state and a pre-step
// snapshot (snapEvents) and fire the matching audio.sfx callbacks. They never
// mutate the sim and need no DOM, so they are directly unit-testable in Node
// (tests/events.test.js).
//
// THE PRE-STEP SNAPSHOT MUST INCLUDE `deaths`. fireEvents() compares
// `state.deaths === prev.deaths` to decide whether a tether recall is a real
// recall (play tetherRecall) or a death (deaths incremented — suppress recall
// in favour of the death SFX). If `deaths` is missing from the snapshot,
// prev.deaths is undefined and the recall SFX is silently suppressed on every
// tick (the bug this module exists to keep out).

export function lanternOverlap(s) {
  const p = s.player;
  for (const l of s.lanterns) {
    if (p.x < l.x + l.w && p.x + p.w > l.x && p.y < l.y + l.h && p.y + p.h > l.y) return true;
  }
  return false;
}

// Snapshot the presentation-relevant sim deltas BEFORE a step, so fireEvents()
// can detect transitions after the step. Never mutates the sim.
export function snapEvents(s) {
  const p = s.player;
  return {
    grounded: p.grounded,
    jumpsUsed: p.jumpsUsed,
    tether: !!s.tether,
    collected: s.collectedCount,
    gateOpen: s.gateOpen,
    onLantern: lanternOverlap(s),
    deaths: s.deaths,
    tick: s.tick,
  };
}

// Fire the authored SFX set on state transitions (recommended #7 — only
// death/win played before; jump/double-jump/land/tether/mote/gate/lantern are
// now wired to real sim deltas). `state` is the post-step state, `prev` the
// pre-step snapshot from snapEvents(), `sfx` the audio.sfx surface.
export function fireEvents(state, prev, sfx = {}) {
  const p = state.player;
  if (p.jumpsUsed > prev.jumpsUsed) {
    if (p.jumpsUsed >= 2) sfx.doubleJump && sfx.doubleJump();
    else sfx.jump && sfx.jump();
  }
  if (p.grounded && !prev.grounded) sfx.land && sfx.land();
  if (state.tether && !prev.tether) sfx.tetherPlace && sfx.tetherPlace();
  // Recall SFX only on a genuine recall: anchor removed AND no death this tick.
  // On a death tick deaths incremented, so this is false and only the death
  // path (handled by the loop, not here) plays.
  else if (!state.tether && prev.tether && state.deaths === prev.deaths) sfx.tetherRecall && sfx.tetherRecall();
  if (state.collectedCount > prev.collected) sfx.mote && sfx.mote();
  if (state.gateOpen && !prev.gateOpen) sfx.gateOpen && sfx.gateOpen();
  // lantern SFX on the rising edge of touching a lantern (not on natural
  // cooldown expiry)
  if (lanternOverlap(state) && !prev.onLantern) sfx.lantern && sfx.lantern();
}
