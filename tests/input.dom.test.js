// TETHER — tests/input.dom.test.js
// DOM-mock harness for game/input.js.
//
// Keyboard (B1 regression): drives REAL keydown/keyup events through the actual
// module and asserts the intent the game loop consumes:
//   - jumpPressed is true on the tick that consumes the press, false next tick
//   - tetherPressed is true on the press tick, false next tick
//   - jumpHeld is true while Space is held, false after keyup (no latching)
//   - movement keys latch while held and clear on keyup
//   - W / ↑ are jump keys with Space press/hold semantics
//
// Touch (mobile fix): drives pointer events on the canvas mock and asserts:
//   - a touch classifies into EXACTLY one zone; jump/tether taps never set right
//   - jump and tether are exclusive per spec (tether 0.62w..0.82w, jump >0.82w)
//   - per-pointer tracking: only the ending finger's zone is cleared
//   - touchmove never re-queues one-shot presses
//   - input.clear() resets touches + one-shot queues
//   - zones derive from the canvas bounding rect (letterbox-safe)
//   - DOM touch buttons (◀ ▶ JUMP TETHER) feed the same zone system
//   - gameplay touch zones are gated off outside live play
//
//   node tests/input.dom.test.js

// --- DOM mock (set BEFORE importing the module) ---
const winHandlers = {};
const elements = {};

function makeEl(id) {
  const handlers = {};
  const el = {
    id,
    addEventListener: (type, fn) => { handlers[type] = handlers[type] || []; handlers[type].push(fn); },
    dispatch: (type, ev) => { for (const fn of (handlers[type] || [])) fn(ev); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 }),
    setPointerCapture: () => {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
  el._handlers = handlers;
  return el;
}
const getEl = (id) => { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; };

global.window = {
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  PointerEvent: class PointerEvent {},
  addEventListener: (type, fn) => {
    winHandlers[type] = winHandlers[type] || [];
    winHandlers[type].push(fn);
  },
};
global.document = { getElementById: getEl };
const { createInput } = await import('../public/js/game/input.js');

let passed = 0;
let failed = 0;
const failures = [];
const assert = (cond, msg) => {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error('  ✗ ' + msg); }
};

function dispatchWin(type, code, extra = {}) {
  for (const fn of (winHandlers[type] || [])) fn({ code, repeat: false, preventDefault() {}, ...extra });
}

const input = createInput({
  onPauseToggle() {}, onRestart() {}, onMute() {}, onBlur() {},
});

// Simulate one game tick: main.js sets consume=true before read().
const tick = () => { input.setConsume(true); return input.read(); };

// Build a pointer event object for the canvas/buttons.
function ptr(id, x, y, extra = {}) {
  return {
    pointerId: id,
    clientX: x,
    clientY: y,
    pointerType: 'touch',
    isPrimary: true,
    preventDefault() {},
    ...extra,
  };
}

// --- B1: keyboard one-shot presses are consumed once per tick ---
console.log('\nB1 — keyboard press queue drains once per tick:');

dispatchWin('keydown', 'Space');
const r1 = tick();
assert(r1.jumpPressed === true, 'jumpPressed true on the tick that consumes the press');
const r2 = tick();
assert(r2.jumpPressed === false, 'jumpPressed false on the next tick (queue drained)');

dispatchWin('keydown', 'KeyX');
const r3 = tick();
assert(r3.tetherPressed === true, 'tetherPressed true on the press tick');
const r4 = tick();
assert(r4.tetherPressed === false, 'tetherPressed false on the next tick');

// --- B1: keyup clears jump/tether from keys (no latching) ---
console.log('\nB1 — keyup clears jump/tether (no held latch):');

dispatchWin('keydown', 'Space');
const r5 = tick();
assert(r5.jumpHeld === true && r5.jumpPressed === true, 'jumpHeld true while held (first tick)');
const r6 = tick();
assert(r6.jumpHeld === true && r6.jumpPressed === false, 'jumpHeld persists, press already drained');
dispatchWin('keyup', 'Space');
const r7 = tick();
assert(r7.jumpHeld === false, 'jumpHeld false after keyup (does not latch)');

dispatchWin('keydown', 'KeyX');
tick();
dispatchWin('keyup', 'KeyX');
// keyup of tether must not affect jump; and tether has no "held" latch to leak
const r8 = tick();
assert(r8.tetherPressed === false && r8.jumpHeld === false, 'tether keyup clean, no cross-leak');

// --- movement keys still latch while held and clear on keyup ---
console.log('\nMovement keys:');

dispatchWin('keydown', 'ArrowRight');
const r9 = tick();
assert(r9.right === true, 'right true while held');
dispatchWin('keyup', 'ArrowRight');
const r10 = tick();
assert(r10.right === false, 'right false after keyup');

// --- W / ↑ map to jump ---
console.log('\nW / ↑ as jump:');

dispatchWin('keydown', 'KeyW');
const r11 = tick();
assert(r11.jumpPressed === true && r11.jumpHeld === true, 'KeyW fires jump (press + hold)');
assert(r11.left === false && r11.right === false, 'KeyW is not a move key');
dispatchWin('keyup', 'KeyW');
const r11b = tick();
assert(r11b.jumpPressed === false && r11b.jumpHeld === false, 'KeyW jump drains and clears on keyup');

dispatchWin('keydown', 'ArrowUp');
const r11c = tick();
assert(r11c.jumpPressed === true && r11c.jumpHeld === true, 'ArrowUp fires jump (press + hold)');
assert(r11c.left === false && r11c.right === false, 'ArrowUp is not a move key');
dispatchWin('keyup', 'ArrowUp');
const r11d = tick();
assert(r11d.jumpPressed === false && r11d.jumpHeld === false, 'ArrowUp jump drains and clears on keyup');

// holding ↑ must not auto-repeat into extra jumps (same guard as Space)
dispatchWin('keydown', 'ArrowUp', { repeat: true });
const r11e = tick();
assert(r11e.jumpPressed === false, 'auto-repeat ArrowUp does not re-queue a press');
dispatchWin('keyup', 'ArrowUp');

// --- repeat presses queue correctly ---
console.log('\nRapid presses:');

dispatchWin('keydown', 'Space');
dispatchWin('keydown', 'Space'); // second press before a tick
const r12 = tick();
const r13 = tick();
assert(r12.jumpPressed === true && r13.jumpPressed === true, 'two rapid presses fire on consecutive ticks');
const r14 = tick();
assert(r14.jumpPressed === false, 'queue fully drained after both presses');
dispatchWin('keyup', 'Space');

// --- keydown with e.repeat must NOT re-queue a press ---
console.log('\nKey repeat:');

dispatchWin('keydown', 'Space', { repeat: true });
const r15 = tick();
assert(r15.jumpPressed === false, 'auto-repeat keydown does not produce a press');
dispatchWin('keyup', 'Space');

// --- blur clears all held state ---
console.log('\nBlur:');

dispatchWin('keydown', 'Space');
dispatchWin('keydown', 'ArrowLeft');
tick();
input.clear(); // what main.js calls on pause/blur resume
const r16 = tick();
assert(r16.jumpHeld === false && r16.left === false && r16.jumpPressed === false, 'clear() empties held keys and the press queue');
dispatchWin('keyup', 'Space');
dispatchWin('keyup', 'ArrowLeft');

// ---------------------------------------------------------------------------
// Touch — gameplay zones. Simulate in-game state explicitly.
// ---------------------------------------------------------------------------
input.setTouchEnabled(true);
const canvas = getEl('game');

console.log('\nTouch — zone classification is exclusive (no right-drift on action taps):');

// jump zone: x >= 0.82w, y >= 0.6h  (canvas 960x540 → x=864, y=378)
canvas.dispatch('pointerdown', ptr(10, 864, 378));
const t1 = tick();
assert(t1.jumpPressed === true, 'jump-zone tap fires jump');
assert(t1.right === false, 'jump-zone tap does NOT set right (no right-drift)');
assert(t1.left === false, 'jump-zone tap does not set left');
canvas.dispatch('pointerup', ptr(10, 864, 378));
tick();

// tether zone: 0.62w..0.82w, 0.6h..0.78h → x=672, y=378
canvas.dispatch('pointerdown', ptr(11, 672, 378));
const t2 = tick();
assert(t2.tetherPressed === true, 'tether-zone tap fires tether');
assert(t2.right === false, 'tether-zone tap does NOT set right');
assert(t2.jumpPressed === false, 'tether-zone tap does not also fire jump');
canvas.dispatch('pointerup', ptr(11, 672, 378));
tick();

// move zones
canvas.dispatch('pointerdown', ptr(12, 100, 300)); // x < 0.5w → left
const t3 = tick();
assert(t3.left === true && t3.right === false, 'left-zone touch moves left');
canvas.dispatch('pointerup', ptr(12, 100, 300));

canvas.dispatch('pointerdown', ptr(13, 600, 300)); // 0.5w..0.62w → right
const t4 = tick();
assert(t4.right === true && t4.left === false && t4.jumpPressed === false, 'right-zone touch moves right only');
canvas.dispatch('pointerup', ptr(13, 600, 300));
tick();

console.log('\nTouch — jump and tether are exclusive per spec:');

// x=0.9w, y=0.68h (inside the OLD tether band) must be JUMP, not tether (Iris B3)
canvas.dispatch('pointerdown', ptr(14, 864, 367.2));
const t5 = tick();
assert(t5.jumpPressed === true, 'x>0.82w in tether band jumps (tether no longer shadows jump)');
assert(t5.tetherPressed === false, 'x>0.82w does not also place a tether');
canvas.dispatch('pointerup', ptr(14, 864, 367.2));
tick();

// tether has an upper x bound: x=0.85w must not be tether
canvas.dispatch('pointerdown', ptr(15, 816, 378));
const t6 = tick();
assert(t6.tetherPressed === false, 'tether does not extend past 0.82w (x=816 is jump)');
assert(t6.jumpPressed === true, 'x=816 (>=0.82w) is the jump zone');
canvas.dispatch('pointerup', ptr(15, 816, 378));
tick();

console.log('\nTouch — per-pointer tracking (item 3):');

// move left + jump concurrently, then release ONLY jump → left must persist
canvas.dispatch('pointerdown', ptr(16, 100, 300));   // left
canvas.dispatch('pointerdown', ptr(17, 864, 378));   // jump
const t7 = tick();
assert(t7.left === true && t7.jumpPressed === true, 'move + jump concurrently both fire');
canvas.dispatch('pointerup', ptr(17, 864, 378));     // release jump finger
const t8 = tick();
assert(t8.jumpHeld === false, 'releasing the jump finger clears jump hold');
assert(t8.left === true, 'left still held after the OTHER finger lifts (only ending finger cleared)');
canvas.dispatch('pointerup', ptr(16, 100, 300));
const t9 = tick();
assert(t9.left === false, 'left clears when its own finger lifts');

// B4 regression: lift at a right-side coordinate must not leave left stuck
canvas.dispatch('pointerdown', ptr(18, 100, 300));   // starts left
const t10 = tick();
assert(t10.left === true, 'left held');
canvas.dispatch('pointerup', ptr(18, 900, 500));     // lifts on the right side
const t11 = tick();
assert(t11.left === false, 'cross-half lift clears the finger that started it (no stuck-left)');

console.log('\nTouch — no re-queue on touchmove (item 5):');

canvas.dispatch('pointerdown', ptr(19, 864, 378));   // jump
const t12 = tick();
assert(t12.jumpPressed === true, 'jump press queued on pointerdown');
canvas.dispatch('pointermove', ptr(19, 860, 380));   // finger jitter
canvas.dispatch('pointermove', ptr(19, 870, 370));
const t13 = tick();
assert(t13.jumpPressed === false, 'touchmove does NOT re-queue a one-shot press');
assert(t13.jumpHeld === true, 'zone stays held through moves');
canvas.dispatch('pointerup', ptr(19, 864, 378));
tick();

console.log('\nTouch — clear() resets touches and queues (item 6):');

canvas.dispatch('pointerdown', ptr(20, 864, 378));   // jump
canvas.dispatch('pointerdown', ptr(21, 100, 300));   // left
const t14 = tick();
assert(t14.jumpPressed === true && t14.left === true, 'both active before clear');
input.clear();
const t15 = tick();
assert(t15.jumpPressed === false && t15.jumpHeld === false, 'clear() drains the jump queue + hold');
assert(t15.left === false, 'clear() clears held touch zones');
assert(input.getTouchZones().size === 0, 'clear() empties the per-pointer zone map');
canvas.dispatch('pointerup', ptr(20, 864, 378));
canvas.dispatch('pointerup', ptr(21, 100, 300));

console.log('\nTouch — zones derive from the canvas rect (letterbox-safe, item 7):');

// Portrait letterbox: canvas strip at top=312.5, h=219 on a 390x844 viewport.
canvas.getBoundingClientRect = () => ({ left: 0, top: 312.5, width: 390, height: 219, right: 390, bottom: 531.5 });
input.recomputeZones();
// Window tap at (351, 465.8) → canvas-relative (351, 153.3) → jump zone
canvas.dispatch('pointerdown', ptr(22, 351, 465.8));
const t16 = tick();
assert(t16.jumpPressed === true && t16.right === false, 'jump tap inside the letterboxed canvas still jumps (no drift)');
canvas.dispatch('pointerup', ptr(22, 351, 465.8));
tick();
// Tap in the upper-left of the strip → left
canvas.dispatch('pointerdown', ptr(23, 60, 340));
const t17 = tick();
assert(t17.left === true && t17.right === false, 'move-left tap inside the letterboxed canvas moves left');
canvas.dispatch('pointerup', ptr(23, 60, 340));
tick();
// restore
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 });
input.recomputeZones();

console.log('\nTouch — DOM buttons feed the same zone system (item 8):');

const btnJump = getEl('btn-jump');
const btnLeft = getEl('btn-left');
const btnTether = getEl('btn-tether');
btnJump.dispatch('pointerdown', ptr(30, 0, 0));
const t18 = tick();
assert(t18.jumpPressed === true && t18.right === false, 'JUMP button fires jump (no right-drift)');
btnJump.dispatch('pointerup', ptr(30, 0, 0));
const t19 = tick();
assert(t19.jumpHeld === false, 'JUMP button releases cleanly');
btnLeft.dispatch('pointerdown', ptr(31, 0, 0));
const t20 = tick();
assert(t20.left === true && t20.right === false, '◀ button moves left only');
btnLeft.dispatch('pointerup', ptr(31, 0, 0));
btnTether.dispatch('pointerdown', ptr(32, 0, 0));
const t21 = tick();
assert(t21.tetherPressed === true && t21.right === false, 'TETHER button fires tether (no right-drift)');
btnTether.dispatch('pointerup', ptr(32, 0, 0));
tick();

console.log('\nTouch — zones are gated off outside live play (item 11):');

input.setTouchEnabled(false);
canvas.dispatch('pointerdown', ptr(40, 864, 378));
const t22 = tick();
assert(t22.jumpPressed === false && t22.right === false, 'jump-zone tap ignored when touch is gated off');
assert(input.getTouchZones().size === 0, 'no zone registered while gated off');
btnJump.dispatch('pointerdown', ptr(41, 0, 0));
const t23 = tick();
assert(t23.jumpPressed === false, 'JUMP button ignored when gated off');
btnJump.dispatch('pointerup', ptr(41, 0, 0));
input.setTouchEnabled(true);
canvas.dispatch('pointerdown', ptr(42, 864, 378));
const t24 = tick();
assert(t24.jumpPressed === true, 'zones live again once enabled');
canvas.dispatch('pointerup', ptr(42, 864, 378));
tick();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.error('\nFailures:\n' + failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
console.log('input.dom: OK — keyboard press/hold + touch zone semantics verified');
