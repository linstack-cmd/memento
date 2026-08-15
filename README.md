# TETHER

**The last light-moth ascending a derelict greenhouse.**

A polished browser platformer. Place a single anchor of light, explore, and
press the button again to *recall* back to it — every risky jump becomes a
reversible commitment. Ascend four strata of a mile-high glasshouse, feed the
light-fountains, and relight the sky.

- **Stack:** vanilla JS ES modules, Canvas 2D, no build step, no runtime
  dependencies, no external assets (all visuals + WebAudio are procedural).
- **Core mechanic:** one-button tether — place / recall a light anchor with a
  short cooldown; lanterns refresh the cooldown; motes open the gate.
- **Move set:** run, variable-height jump, double jump, coyote time, jump
  buffering, one-way platforms (drop-through), moving platforms with exact-delta
  rider carry, spikes, pits.
- **Content:** 20 levels (4 worlds × 5), each provably completable.

## Architecture

```
public/js/
  core/    PURE, DOM-free deterministic simulation (runs headless in Node)
    config.js      every constant — single source of truth
    rng.js         seeded PRNG (mulberry32)
    sim.js         fixed-step state machine (step(), createState, ...)
    leveldata.js   bundled levels (generated — do not edit by hand)
  game/    presentation only; consumes sim state, never mutates it
    main.js loop.js-free bootstrap + fixed-timestep accumulator
    input.js keyboard / touch (two-thumb) / gamepad → intent
    camera.js lookahead + smoothing + trauma shake
    render.js tiles, entities, moth, tether, particles, parallax
    audio.js procedural WebAudio (SFX + seeded ambient bed)
    ui.js HUD + title/complete/end/pause overlays
    save.js localStorage progress (fault-tolerant)
levels/  authored ASCII grids + entities (source of truth)
tools/   Node verification tools (zero npm deps)
    bundle.js        levels/*.json → public/js/core/leveldata.js
    validate.js      schema + invariant validation
    headless.js      seeded fuzz + invariants + perf budget
    reachability.js  solver executing the PRODUCTION step function
    determinism.js   run-twice hash comparison
tests/   physics edge-case assertions
dev/     dev-only level generator (not part of the shipped toolchain)
```

## Verification

```
npm run verify
```

Runs, in order (this is the Docker build gate — any failure aborts the build):

1. **bundle** — regenerate `leveldata.js` from `levels/`.
2. **validate** — schema + invariants for all 20 levels.
3. **headless** — deterministic fuzz of every level, zero errors/NaNs, invariants,
   and a per-step perf budget (well under the 8.3 ms @ 120 Hz frame).
4. **solve** — the reachability solver proves, for every level: exit reachable,
   every mote reachable, all-motes→exit, and ≥3-tick timing slack (a "slow-player"
   re-search that delays every grounded action by 3 ticks must still win; the
   winning trace is additionally re-simulated with ±1-tick per-press jitter +
   initial perturbation — reported per level as a trace-robustness diagnostic).
   The solver executes the *production* step. **Soft-lock is reported honestly:**
   `soft:exact` (full no-soft-lock proof) when the reachability closure completes;
   for capped levels, `soft:probed(n)` means every reached node was checked for
   win-or-death reachability (graph reverse-reachability + a bounded per-node
   probe) and `m unproven` means m nodes could not be proven escapable within the
   probe budget — those levels are NOT claimed "no soft-lock". Solver budgets are
   machine-independent (derived from measured step throughput), so the gate is
   stable across hosts and Docker.
5. **determinism** — two identical runs produce identical state hashes.
6. **test** — physics edge-case suite (one-way, carry, corners, tether, cooldown,
   one-way side-snag) plus a DOM-mock keyboard harness (regression for the input
   pipeline).

### Browser smoke (tier-2, optional)

```
NODE_PATH=$(npm root -g) npm run smoke
```

Loads the real page in headless Chrome, drives **real keyboard events** (Space
jump, X tether, arrows move), clicks pause/restart/mute, and asserts zero console
errors. This is the gate that catches input-pipeline regressions. Requires a
global `puppeteer` on the host; it is NOT part of the Docker `verify` gate (that
must stay zero-dependency). If puppeteer is missing it prints a SKIP note and
exits 0.

### Manual checklist (use when browser automation is unavailable)

- Title → Begin the Ascent → level 1 intro appears and gameplay starts.
- Space jumps; holding Space rises higher; releasing early cuts the jump;
  double-tap Space in mid-air for a double jump.
- X places a light anchor; X again recalls to it; the HUD shows "Tether cooling"
  for ~0.3 s after a recall and "Tether ready" after.
- Touch a lantern to make the tether ready again immediately.
- ↓+Space drops through a one-way platform; you cannot land on one from below
  or snag its side while jumping up through it.
- Riding a moving platform carries you (no jitter, no tunneling).
- Spikes kill; falling below the level kills; motes persist across death.
- Collect all motes → the gate opens → touch the gate → Level Complete.
- P/Esc pauses and resumes; R restarts; M mutes; pause menu buttons work.
- Resize the window — the game letterboxes, never breaks.

## Controls

| Action | Keys | Gamepad |
| --- | --- | --- |
| Move | ← → / A D | Left stick |
| Jump / double jump | Space / Z / W / ↑ | A / B |
| Tether (place / recall) | X / K | X |
| Drop through one-way | ↓ + jump | — |
| Pause | P / Esc | Start |
| Restart level | R | — |
| Mute | M | — |

## Deploy

Docker multi-stage: `node:20-alpine` runs `npm run verify` (build gate), then
`nginx:1.27-alpine` serves `public/` only. nginx.conf provides gzip, cache
headers, and a healthcheck.

```
docker build -t tether .
```
