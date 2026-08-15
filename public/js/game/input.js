// TETHER — game/input.js
// Routes keyboard / touch (two-thumb) / gamepad into a per-tick intent layer.
// The sim only ever reads the produced `intent` object; input never touches sim
// state directly.

import { makeInput } from '../core/sim.js';

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down',
  ArrowUp: 'up', KeyW: 'up', Space: 'jump', KeyZ: 'jump',
  KeyX: 'tether', KeyK: 'tether',
  KeyP: 'pause', Escape: 'pause',
  KeyR: 'restart',
  KeyM: 'mute',
};

export function createInput(callbacks) {
  const keys = new Set();
  const pressQueue = [];      // one-shot presses consumed once per tick
  let consume = false;

  // expose a way for the loop to know whether a one-shot is pending
  const api = {
    keys,
    consume: () => (consume ? 1 : 0),
    clear: () => { keys.clear(); pressQueue.length = 0; },
    setConsume: (v) => { consume = v; },
  };

  window.addEventListener('keydown', (e) => {
    const code = e.code;
    const mapped = KEYMAP[code];
    if (mapped === 'left' || mapped === 'right' || mapped === 'down' || mapped === 'up') e.preventDefault();
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

  // --- touch (two-thumb: left/right zones + jump/tether buttons) ---
  const touches = { left: false, right: false, jump: false, tether: false, down: false };
  let jumpQueued = false;
  let tetherQueued = false;

  const onTouchStart = (e) => {
    e.preventDefault();
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY;
      if (x < w / 2) { touches.left = x < w * 0.5; touches.down = y > h * 0.82; }
      else touches.right = true;
      // right-thumb action buttons
      if (x > w * 0.62 && y > h * 0.6 && y < h * 0.78) { tetherQueued = true; touches.tether = true; }
      else if (x > w * 0.82 && y > h * 0.6) { jumpQueued = true; touches.jump = true; }
      else if (x > w * 0.5) { touches.right = true; }
    }
  };
  const onTouchEnd = (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const x = t.clientX;
      if (x < window.innerWidth / 2) { touches.left = false; touches.down = false; }
      else { touches.right = false; touches.jump = false; touches.tether = false; }
    }
  };
  const el = document.getElementById('stage') || window;
  el.addEventListener('touchstart', onTouchStart, { passive: false });
  el.addEventListener('touchmove', onTouchStart, { passive: false });
  el.addEventListener('touchend', onTouchEnd, { passive: false });
  el.addEventListener('touchcancel', onTouchEnd, { passive: false });

  // --- gamepad ---
  let padIndex = -1;
  let padJumpPrev = false; // edge-detect A/B so holding jump never re-triggers
  window.addEventListener('gamepadconnected', (e) => { padIndex = e.gamepad.index; });
  window.addEventListener('gamepaddisconnected', () => { padIndex = -1; });

  // --- read intent for the current tick ---
  api.read = () => {
    let left = keys.has('left') || touches.left;
    let right = keys.has('right') || touches.right;
    const down = keys.has('down') || touches.down;

    // One-shot presses: drained exactly once per tick. `consume` is set true by
    // the game loop before each read() (main.js), so the press queue empties
    // once per tick and a keypress never latches into later ticks.
    let jumpPressed = false;
    let jumpHeld = keys.has('jump') || touches.jump;
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
