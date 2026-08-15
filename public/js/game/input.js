// TETHER — game/input.js
// Routes keyboard / touch (two-thumb) / gamepad into a per-tick intent layer.
// The sim only ever reads the produced `intent` object; input never touches sim
// state directly.

import { makeInput } from '../core/sim.js';

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down',
  // W / ↑ map straight to jump. The old 'up' intent was advertised (title,
  // README: "Space / W / ↑ jump") but read() never consumed it, so W/↑ were
  // dead keys. Remapping to 'jump' gives W/↑ the exact same press+hold
  // semantics as Space/Z.
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump',
  KeyX: 'tether', KeyK: 'tether',
  KeyP: 'pause', Escape: 'pause',
  KeyR: 'restart',
  KeyM: 'mute',
};

// DOM touch buttons (item 8) map into the same per-pointer zone system, so a
// held button and a canvas-zone touch both feed the one `touches` Map.
const TOUCH_BUTTONS = [
  { id: 'btn-left', zone: 'left' },
  { id: 'btn-right', zone: 'right' },
  { id: 'btn-jump', zone: 'jump' },
  { id: 'btn-tether', zone: 'tether' },
];

export function createInput(callbacks) {
  const keys = new Set();
  const pressQueue = [];      // one-shot presses consumed once per tick
  let consume = false;

  // --- touch state ---------------------------------------------------------
  // Per-pointer zone map (Iris B3/B4 + items 2,3): exactly ONE zone per active
  // pointer, and only the ending pointer's zone is cleared. Action pointers
  // (jump/tether) NEVER also set directional movement (Iris B2 + item 2).
  // One-shot presses are queued only on pointer DOWN (item 5) — move events
  // never re-classify or re-queue.
  const touches = new Map();   // pointerId -> zone ('left'|'right'|'down'|'jump'|'tether')
  let jumpQueued = false;
  let tetherQueued = false;
  let touchEnabled = false;    // gated to in-game: playing && !paused && no overlay (item 11)
  let zones = null;            // cached canvas bounding rect (item 7)

  const getCanvas = () => (typeof document !== 'undefined' ? document.getElementById('game') : null);

  // Zones are computed from the CANVAS bounding rect, not the window, so they
  // survive letterboxing (item 7). Recomputed on resize/orientation (item 12).
  function computeZones() {
    const c = getCanvas();
    if (!c || typeof c.getBoundingClientRect !== 'function') { zones = null; return; }
    const r = c.getBoundingClientRect();
    zones = { left: r.left, top: r.top, w: r.width, h: r.height };
  }

  // Classify a canvas-relative point into EXACTLY ONE non-overlapping zone.
  //   left half  -> 'left', or 'down' (drop-through) when y > 0.82h
  //   right half -> 'jump'   (x >= 0.82w, y >= 0.6h)
  //                 'tether' (0.62w <= x < 0.82w, 0.6h <= y < 0.78h)
  //                 'right'  (everything else on the right half)
  // Order matters: jump is checked before tether so the two are exclusive
  // (Iris B3 + item 4) — tapping the documented jump zone actually jumps.
  function classifyZone(x, y) {
    if (!zones || zones.w === 0 || zones.h === 0) return null;
    const w = zones.w, h = zones.h;
    if (x < w * 0.5) return y > h * 0.82 ? 'down' : 'left';
    if (x >= w * 0.82 && y >= h * 0.6) return 'jump';
    if (x >= w * 0.62 && y >= h * 0.6 && y < h * 0.78) return 'tether';
    return 'right';
  }

  function queueAction(zone) {
    if (zone === 'jump') jumpQueued = true;
    else if (zone === 'tether') tetherQueued = true;
  }

  // Shared pointer/touch "down" logic (pointer events primary, touch fallback).
  function handleDown(id, clientX, clientY, pointerType) {
    if (!touchEnabled) return;                    // item 11: zones only live in-game
    const c = getCanvas();
    if (!c || typeof c.getBoundingClientRect !== 'function') return;
    const rect = c.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    zones = { left: rect.left, top: rect.top, w: rect.width, h: rect.height };
    const zone = classifyZone(clientX - rect.left, clientY - rect.top);
    if (!zone) return;
    touches.set(id, zone);
    queueAction(zone);
  }

  const onPointerDown = (e) => {
    // Ignore non-primary mouse pointers (multi-button / synthetic) but allow
    // every touch pointer.
    if (e.pointerType === 'mouse' && !e.isPrimary) return;
    handleDown(e.pointerId, e.clientX, e.clientY, e.pointerType);
    if (touches.has(e.pointerId)) {
      // Safe: this handler is canvas-only, so it never runs over buttons,
      // overlays, or the HUD (item 1) — no click is ever swallowed.
      e.preventDefault();
      try { getCanvas().setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };
  const onPointerMove = () => { /* zone fixed per pointer at DOWN (item 5) */ };
  const onPointerUp = (e) => { touches.delete(e.pointerId); };  // only the ending finger (item 3)

  // Touch-event fallback for browsers without PointerEvent.
  const onTouchStart = (e) => {
    for (const t of e.changedTouches) handleDown(t.identifier, t.clientX, t.clientY, 'touch');
    if (touchEnabled) e.preventDefault();
  };
  const onTouchEnd = (e) => { for (const t of e.changedTouches) touches.delete(t.identifier); };

  function attachCanvas() {
    const c = getCanvas();
    if (!c || typeof c.addEventListener !== 'function') return;
    if (window.PointerEvent) {
      c.addEventListener('pointerdown', onPointerDown);
      c.addEventListener('pointermove', onPointerMove);
      c.addEventListener('pointerup', onPointerUp);
      c.addEventListener('pointercancel', onPointerUp);
      c.addEventListener('lostpointercapture', onPointerUp);
    } else {
      c.addEventListener('touchstart', onTouchStart, { passive: false });
      c.addEventListener('touchmove', () => {}, { passive: false });
      c.addEventListener('touchend', onTouchEnd, { passive: false });
      c.addEventListener('touchcancel', onTouchEnd, { passive: false });
    }
  }

  // DOM touch-control buttons (◀ ▶ JUMP TETHER) — item 8. They feed the same
  // per-pointer zone map with synthetic ids, so movement + action work together.
  function bindTouchButtons() {
    for (const { id, zone } of TOUCH_BUTTONS) {
      const el = document.getElementById(id);
      if (!el || typeof el.addEventListener !== 'function') continue;
      if (window.PointerEvent) {
        const down = (e) => {
          if (!touchEnabled) return;              // item 11
          e.preventDefault();                     // button-level only; never global
          try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
          touches.set('btn:' + zone, zone);
          queueAction(zone);
        };
        const up = () => touches.delete('btn:' + zone);
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('lostpointercapture', up);
      } else {
        const down = (e) => { if (!touchEnabled) return; e.preventDefault(); touches.set('btn:' + zone, zone); queueAction(zone); };
        const up = () => touches.delete('btn:' + zone);
        el.addEventListener('touchstart', down, { passive: false });
        el.addEventListener('touchend', up, { passive: false });
        el.addEventListener('touchcancel', up, { passive: false });
      }
    }
  }

  attachCanvas();
  bindTouchButtons();
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', computeZones);           // item 12
    window.addEventListener('orientationchange', computeZones);
  }
  computeZones();

  // expose a way for the loop to know whether a one-shot is pending
  const api = {
    keys,
    consume: () => (consume ? 1 : 0),
    clear: () => {
      keys.clear();
      pressQueue.length = 0;
      // item 6: reset per-pointer touches + one-shot queues too, so held
      // touches never leak across pause/restart/level transitions.
      touches.clear();
      jumpQueued = false;
      tetherQueued = false;
    },
    setConsume: (v) => { consume = v; },
    setTouchEnabled: (v) => { touchEnabled = !!v; },
    isTouchEnabled: () => touchEnabled,
    recomputeZones: computeZones,
    // test hook (browser-smoke / DOM-mock): copy of active touch zones
    getTouchZones: () => new Map(touches),
  };

  window.addEventListener('keydown', (e) => {
    const code = e.code;
    const mapped = KEYMAP[code];
    // preventDefault on movement + jump so arrows/Space never scroll the page
    // ('up' no longer exists as an intent — ArrowUp is now 'jump').
    if (mapped === 'left' || mapped === 'right' || mapped === 'down' || mapped === 'jump') e.preventDefault();
    if (mapped === 'jump' && e.repeat) return;
    if (mapped === 'tether' && e.repeat) return;
    if (mapped) {
      if (mapped === 'jump' || mapped === 'tether') pressQueue.push(mapped);
      else if (mapped === 'pause') { callbacks.onPauseToggle && callbacks.onPauseToggle(); return; }
      else if (mapped === 'restart') { callbacks.onRestart && callbacks.onRestart(); return; }
      else if (mapped === 'mute') { callbacks.onMute && callbacks.onMute(); return; }
      keys.add(mapped);
    }
  });

  window.addEventListener('keyup', (e) => {
    const mapped = KEYMAP[e.code];
    // Delete every mapped key on release — including 'jump'/'tether' (B1:
    // without this, jumpHeld latches true forever after the first Space press).
    if (mapped) keys.delete(mapped);
  });

  window.addEventListener('blur', () => {
    api.clear();
    callbacks.onBlur && callbacks.onBlur();
  });

  // --- gamepad ---
  let padIndex = -1;
  let padJumpPrev = false; // edge-detect A/B so holding jump never re-triggers
  window.addEventListener('gamepadconnected', (e) => { padIndex = e.gamepad.index; });
  window.addEventListener('gamepaddisconnected', () => { padIndex = -1; });

  // --- read intent for the current tick ---
  api.read = () => {
    const zoneActive = (z) => { for (const v of touches.values()) if (v === z) return true; return false; };

    let left = keys.has('left') || zoneActive('left');
    let right = keys.has('right') || zoneActive('right');
    const down = keys.has('down') || zoneActive('down');

    // One-shot presses: drained exactly once per tick. `consume` is set true by
    // the game loop before each read() (main.js), so the press queue empties
    // once per tick and a keypress never latches into later ticks.
    let jumpPressed = false;
    let jumpHeld = keys.has('jump') || zoneActive('jump');
    if (consume && pressQueue.includes('jump')) {
      jumpPressed = true;
      pressQueue.splice(pressQueue.indexOf('jump'), 1);
    }
    if (jumpQueued) { jumpPressed = true; jumpQueued = false; }

    let tetherPressed = false;
    if (consume && pressQueue.includes('tether')) {
      tetherPressed = true;
      pressQueue.splice(pressQueue.indexOf('tether'), 1);
    }
    if (tetherQueued) { tetherPressed = true; tetherQueued = false; }

    // gamepad (standard mapping, hot-plug safe)
    if (padIndex >= 0) {
      try {
        const gp = navigator.getGamepads()[padIndex];
        if (gp) {
          const lx = gp.axes[0] || 0;
          const ly = gp.axes[1] || 0;
          if (lx < -0.4) left = true;
          if (lx > 0.4) right = true;
          if (ly > 0.4 || (gp.buttons[13] && gp.buttons[13].pressed)) down = true; // dpad down
          const aPressed = !!(gp.buttons[0] && gp.buttons[0].pressed) || !!(gp.buttons[1] && gp.buttons[1].pressed);
          if (aPressed && !padJumpPrev) { jumpPressed = true; }
          padJumpPrev = aPressed;
          if (aPressed) jumpHeld = true;
          if (gp.buttons[2] && gp.buttons[2].pressed) tetherPressed = true;
        } else {
          padJumpPrev = false;
        }
      } catch { /* gamepad read failed — ignore */ }
    }

    return makeInput({ left, right, down, jumpPressed, jumpHeld, tetherPressed });
  };

  return api;
}
