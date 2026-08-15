// TETHER — tests/input.dom.test.js
// DOM-mock harness for game/input.js (B1 regression test).
//
// Drives REAL keydown/keyup events through the actual module and asserts the
// intent the game loop consumes:
//   - jumpPressed is true on the tick that consumes the press, false next tick
//   - tetherPressed is true on the press tick, false next tick
//   - jumpHeld is true while Space is held, false after keyup (no latching)
//   - movement keys latch while held and clear on keyup
//   - W / ↑ are jump keys (previously mapped to a dead 'up' intent) with the
//     same press/hold/auto-repeat semantics as Space
//
//   node tests/input.dom.test.js

// --- DOM mock (set BEFORE importing the module) ---
const winHandlers = {};
global.window = {
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  addEventListener: (type, fn) => {
    winHandlers[type] = winHandlers[type] || [];
    winHandlers[type].push(fn);
  },
};
const stageHandlers = {};
global.document = {
  getElementById: () => ({
    addEventListener: (type, fn) => {
      stageHandlers[type] = stageHandlers[type] || [];
      stageHandlers[type].push(fn);
    },
  }),
};
const { createInput } = await import('../public/js/game/input.js');

let passed = 0;
let failed = 0;
const failures = [];
const assert = (cond, msg) => {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error('  ✗ ' + msg); }
};

function dispatch(handlers, type, code, extra = {}) {
  for (const fn of (handlers[type] || [])) fn({ code, repeat: false, preventDefault() {}, ...extra });
}

const input = createInput({
  onPauseToggle() {}, onRestart() {}, onMute() {}, onBlur() {},
});

// Simulate one game tick: B1 fix — main.js sets consume=true before read().
const tick = () => { input.setConsume(true); return input.read(); };

// --- B1: keyboard one-shot presses are consumed once per tick ---
console.log('\nB1 — keyboard press queue drains once per tick:');

dispatch(winHandlers, 'keydown', 'Space');
const r1 = tick();
assert(r1.jumpPressed === true, 'jumpPressed true on the tick that consumes the press');
const r2 = tick();
assert(r2.jumpPressed === false, 'jumpPressed false on the next tick (queue drained)');

dispatch(winHandlers, 'keydown', 'KeyX');
const r3 = tick();
assert(r3.tetherPressed === true, 'tetherPressed true on the press tick');
const r4 = tick();
assert(r4.tetherPressed === false, 'tetherPressed false on the next tick');

// --- B1: keyup clears jump/tether from keys (no latching) ---
console.log('\nB1 — keyup clears jump/tether (no held latch):');

dispatch(winHandlers, 'keydown', 'Space');
const r5 = tick();
assert(r5.jumpHeld === true && r5.jumpPressed === true, 'jumpHeld true while held (first tick)');
const r6 = tick();
assert(r6.jumpHeld === true && r6.jumpPressed === false, 'jumpHeld persists, press already drained');
dispatch(winHandlers, 'keyup', 'Space');
const r7 = tick();
assert(r7.jumpHeld === false, 'jumpHeld false after keyup (does not latch)');

dispatch(winHandlers, 'keydown', 'KeyX');
tick();
dispatch(winHandlers, 'keyup', 'KeyX');
// keyup of tether must not affect jump; and tether has no "held" latch to leak
const r8 = tick();
assert(r8.tetherPressed === false && r8.jumpHeld === false, 'tether keyup clean, no cross-leak');

// --- movement keys still latch while held and clear on keyup ---
console.log('\nMovement keys:');

dispatch(winHandlers, 'keydown', 'ArrowRight');
const r9 = tick();
assert(r9.right === true, 'right true while held');
dispatch(winHandlers, 'keyup', 'ArrowRight');
const r10 = tick();
assert(r10.right === false, 'right false after keyup');

// --- W / ↑ map to jump (Fix: the old 'up' intent was advertised but never
// consumed by read(); now W and ↑ are real jump keys with Space semantics) ---
console.log('\nW / ↑ as jump:');

dispatch(winHandlers, 'keydown', 'KeyW');
const r11 = tick();
assert(r11.jumpPressed === true && r11.jumpHeld === true, 'KeyW fires jump (press + hold)');
assert(r11.left === false && r11.right === false, 'KeyW is not a move key');
dispatch(winHandlers, 'keyup', 'KeyW');
const r11b = tick();
assert(r11b.jumpPressed === false && r11b.jumpHeld === false, 'KeyW jump drains and clears on keyup');

dispatch(winHandlers, 'keydown', 'ArrowUp');
const r11c = tick();
assert(r11c.jumpPressed === true && r11c.jumpHeld === true, 'ArrowUp fires jump (press + hold)');
assert(r11c.left === false && r11c.right === false, 'ArrowUp is not a move key');
dispatch(winHandlers, 'keyup', 'ArrowUp');
const r11d = tick();
assert(r11d.jumpPressed === false && r11d.jumpHeld === false, 'ArrowUp jump drains and clears on keyup');

// holding ↑ must not auto-repeat into extra jumps (same guard as Space)
dispatch(winHandlers, 'keydown', 'ArrowUp', { repeat: true });
const r11e = tick();
assert(r11e.jumpPressed === false, 'auto-repeat ArrowUp does not re-queue a press');
dispatch(winHandlers, 'keyup', 'ArrowUp');

// --- repeat presses queue correctly (two presses = two jumps across ticks) ---
console.log('\nRapid presses:');

dispatch(winHandlers, 'keydown', 'Space');
dispatch(winHandlers, 'keydown', 'Space'); // second press before a tick
const r12 = tick();
const r13 = tick();
assert(r12.jumpPressed === true && r13.jumpPressed === true, 'two rapid presses fire on consecutive ticks');
const r14 = tick();
assert(r14.jumpPressed === false, 'queue fully drained after both presses');
dispatch(winHandlers, 'keyup', 'Space');

// --- keydown with e.repeat must NOT re-queue a press ---
console.log('\nKey repeat:');

dispatch(winHandlers, 'keydown', 'Space', { repeat: true });
const r15 = tick();
assert(r15.jumpPressed === false, 'auto-repeat keydown does not produce a press');
dispatch(winHandlers, 'keyup', 'Space');

// --- blur clears all held state ---
console.log('\nBlur:');

dispatch(winHandlers, 'keydown', 'Space');
dispatch(winHandlers, 'keydown', 'ArrowLeft');
tick();
input.clear(); // what main.js calls on pause/blur resume
const r16 = tick();
assert(r16.jumpHeld === false && r16.left === false && r16.jumpPressed === false, 'clear() empties held keys and the press queue');
dispatch(winHandlers, 'keyup', 'Space');
dispatch(winHandlers, 'keyup', 'ArrowLeft');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.error('\nFailures:\n' + failures.map((f) => ' - ' + f).join('\n')); process.exit(1); }
console.log('input.dom: OK — keyboard press/hold semantics verified');
