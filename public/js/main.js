// TETHER — main.js
// Bootstrap + game loop. Wires the pure sim (core/) to the presentation (game/).
// Fixed 120 Hz sim step (accumulator), rAF render. Sim NEVER reads wall-clock.

import { LEVELS } from './core/leveldata.js';
import { createState, step } from './core/sim.js';
import { TICK_RATE } from './core/config.js';
import { createInput } from './game/input.js';
import { createCamera } from './game/camera.js';
import { createRenderer } from './game/render.js';
import { createAudio } from './game/audio.js';
import { createUI } from './game/ui.js';
import { fireEvents, snapEvents } from './game/events.js';
import * as save from './game/save.js';

const TICK_MS = 1000 / TICK_RATE;
const MAX_FRAME = 120; // accumulator cap (no death spiral)

// ---------------------------------------------------------------------------
// Canvas / letterbox
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const VIEW_W = 960, VIEW_H = 540;

function fitCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  const scale = Math.min(availW / VIEW_W, availH / VIEW_H);
  const cssW = Math.round(VIEW_W * scale);
  const cssH = Math.round(VIEW_H * scale);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr * (canvas.width / VIEW_W / dpr), 0, 0, dpr * (canvas.height / VIEW_H / dpr), 0, 0);
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const saveData = save.loadSave();
const ui = createUI();
const audio = createAudio(() => saveData);
const camera = createCamera();
const input = createInput({
  onPauseToggle: () => { if (playing && !levelCompleteShown) togglePause(); },
  onRestart: () => { if (playing) startLevel(currentIndex, true); },
  onMute: () => { const m = !audio.isMuted(); audio.setMuted(m); save.writeSave({ muted: m }); },
  onBlur: () => { if (playing && !paused) pauseGame(); },
});

let renderer = null;
let state = null;
let currentLevel = null;
let currentIndex = 0;
let playing = false;
let paused = false;
let levelCompleteShown = false;
let prevDeaths = 0;
let prevWon = false;
let time = 0;              // presentation clock (render/atmosphere only)
let accumulator = 0;
let lastFrame = performance.now();
let introTimer = 0;

// ---------------------------------------------------------------------------
// Touch gating (items 11, 12) — gameplay touch zones live ONLY while
// playing && !paused && no overlay && past the level intro. The DOM touch
// buttons are shown/hidden to match. Called whenever the gating inputs change
// and on resize/orientation.
// ---------------------------------------------------------------------------
function updateTouchGate() {
  const active = playing && !paused && !levelCompleteShown && introTimer <= 0;
  input.setTouchEnabled(active);
  ui.setTouchControlsVisible(active);
  updateRotatePrompt();
}

// Portrait "rotate device" prompt (item 9): shown only in portrait on
// coarse-pointer devices while actively playing. pointer-events:none in CSS so
// it can never block input.
function updateRotatePrompt() {
  const el = document.getElementById('rotate-prompt');
  if (!el) return;
  const portrait = !!(window.matchMedia && window.matchMedia('(orientation: portrait)').matches);
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const show = portrait && coarse && playing && !paused && !levelCompleteShown && introTimer <= 0;
  el.classList.toggle('hidden', !show);
}

// Wire a button so it fires on BOTH 'click' (mouse/keyboard) and 'pointerup'
// (touch) — item 11: a preventDefault regression can never re-brick the
// critical buttons. A touch pointerup handles it first; the synthesized click
// that follows is deduped.
function bindTap(el, fn) {
  if (!el) return;
  let lastPointerUp = -Infinity; // never set yet → clicks are never wrongly deduped
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') { lastPointerUp = performance.now(); fn(e); }
  });
  el.addEventListener('click', (e) => {
    if (performance.now() - lastPointerUp < 400) return;
    fn(e);
  });
}

window.addEventListener('resize', () => { updateTouchGate(); });
window.addEventListener('orientationchange', () => { updateTouchGate(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing && !paused) pauseGame();
});

// ---------------------------------------------------------------------------
// Presentation-only event detection (SFX / feedback). These read state deltas
// and never mutate the sim. The snap/fire logic lives in game/events.js so it
// is unit-testable in Node; fireEvents(state, prev, audio.sfx) is called each
// tick after step(). snapEvents() includes `deaths` — without it, prev.deaths
// is undefined and the tether-recall SFX would be suppressed every tick.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Level lifecycle
// ---------------------------------------------------------------------------
function startLevel(index, forceRestart = false) {
  currentIndex = Math.max(0, Math.min(index, LEVELS.length - 1));
  currentLevel = LEVELS[currentIndex];
  state = createState(currentLevel, 4242 + currentIndex);
  renderer = createRenderer(canvas, camera, currentIndex, saveData);
  renderer.setPalette(currentLevel);
  camera.c.x = 0; camera.c.y = 0;
  camera.c.trauma = 0;
  prevDeaths = 0;
  prevWon = false;
  levelCompleteShown = false;
  audio.setLevelAmbient(currentLevel.audioSeed);
  ui.hideComplete(); ui.hideEnd(); ui.hidePause(); ui.hideIntro();
  ui.showHUD();
  ui.setHUD(currentLevel.name, 0, state.totalMotes, false);
  if (!forceRestart) {
    ui.showIntro(currentLevel);
    introTimer = 55; // ticks of intro before gameplay begins
  }
  paused = false;
  playing = true;
  input.clear();
  updateTouchGate();
}

function completeLevel() {
  playing = false;
  levelCompleteShown = true;
  ui.hideHUD();
  updateTouchGate(); // touch zones + rotate prompt off
  audio.sfx.win();
  const final = currentIndex >= LEVELS.length - 1;
  const par = currentLevel.par || 60;
  const stats = `Falls: ${state.deaths}   ·   Motes: ${state.collectedCount}/${state.totalMotes}`;
  save.recordBest(currentIndex + 2, currentIndex, state.deaths, par);
  if (final) {
    ui.showEnd({ text: `${stats}\n\nYou relit the sky of the glasshouse.` });
  } else {
    ui.showComplete({ final: false, text: `${stats}\n\nWorld ${currentLevel.world} — Level ${currentIndex + 1} of 20` });
  }
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
function togglePause() {
  if (paused) resumeGame();
  else pauseGame();
}
function pauseGame() {
  if (!playing || levelCompleteShown) return;
  paused = true;
  ui.showPause();
  updateTouchGate(); // zones + touch buttons + rotate prompt off while paused
}
function resumeGame() {
  paused = false;
  ui.hidePause();
  input.clear();
  lastFrame = performance.now();
  updateTouchGate();
}

function tick() {
  if (!playing || paused) return;

  if (introTimer > 0) {
    introTimer--;
    if (introTimer === 0) {
      ui.hideIntro();
      updateTouchGate(); // gameplay zones go live once the intro overlay clears
    }
  }

  // B1: drain the one-shot press queue exactly once per tick — without this,
  // jumpPressed/tetherPressed are never consumed and stay false.
  input.setConsume(true);
  const prev = snapEvents(state);
  const intent = input.read();
  step(state, intent, currentLevel);

  // presentation-only event SFX (never mutates the sim)
  fireEvents(state, prev, audio.sfx);

  // death detection (deaths counter increments on death → reset)
  if (state.deaths > prevDeaths) {
    camera.addTrauma(0.7);
    audio.sfx.death();
    input.clear(); // item 6: held touches/keys must not leak across respawn
    renderer.burst(state.player.x + state.player.w / 2, state.player.y + state.player.h / 2, 'spark', 18, { color: '#ff9b6a', life: 24 });
  }
  prevDeaths = state.deaths;

  // win detection
  if (state.won && !prevWon) {
    prevWon = true;
    completeLevel();
    return;
  }
  prevWon = state.won;

  // events (presentation-only, derived from state deltas)
  camera.update(state, currentLevel, 1 / TICK_RATE);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(now - lastFrame, MAX_FRAME);
  lastFrame = now;
  time += dt;

  // fixed-step simulation
  accumulator += dt;
  while (accumulator >= TICK_MS) {
    tick();
    accumulator -= TICK_MS;
    if (paused || !playing) { accumulator = 0; break; }
  }

  // render
  if (renderer && state && currentLevel) {
    const shake = camera.shakeOffset(renderer.rng);
    renderer.render(state, currentLevel, time, {
      reducedMotion: saveData.reducedMotion,
      shake,
    });

    // HUD
    if (playing && !levelCompleteShown) {
      const p = state.player;
      // B2: cooldown now lives on state; "cooling" is reachable after every recall.
      const ready = state.tick >= state.cooldownUntilTick;
      const rem = Math.max(0, state.cooldownUntilTick - state.tick);
      ui.setCooldown(ready, rem, TICK_RATE);
      ui.setDeaths(state.deaths);
      ui.setHUD(currentLevel.name, state.collectedCount, state.totalMotes, state.gateOpen);
    }
  }
}

// ---------------------------------------------------------------------------
// Title / flow wiring — every button is wired via bindTap() so it responds to
// touch pointerup as well as click (item 11).
// ---------------------------------------------------------------------------
ui.renderTitleProgress(saveData.unlocked, LEVELS.length);
bindTap(ui.els.btnPlay, () => {
  audio.unlock();
  startLevel(saveData.unlocked - 1);
  ui.hideTitle();
});
bindTap(ui.els.btnContinue, () => {
  audio.unlock();
  const resumeIndex = Math.min(saveData.unlocked - 1, LEVELS.length - 1);
  startLevel(resumeIndex);
  ui.hideTitle();
});
bindTap(ui.els.btnNext, () => {
  ui.hideComplete();
  startLevel(currentIndex + 1);
});
bindTap(ui.els.btnReplay, () => {
  ui.hideEnd();
  save.writeSave({ unlocked: 1 });
  ui.renderTitleProgress(1, LEVELS.length);
  ui.showTitle();
  playing = false;
  updateTouchGate();
});
bindTap(ui.els.btnResume, resumeGame);
bindTap(ui.els.btnMotion, () => {
  saveData.reducedMotion = !saveData.reducedMotion;
  save.writeSave({ reducedMotion: saveData.reducedMotion });
  ui.els.btnMotion.textContent = 'Reduce Motion: ' + (saveData.reducedMotion ? 'On' : 'Off');
});
bindTap(ui.els.btnRestart, () => startLevel(currentIndex, true));
bindTap(ui.els.btnQuit, () => {
  playing = false;
  paused = false;
  ui.hidePause(); ui.hideHUD();
  ui.renderTitleProgress(save.loadSave().unlocked, LEVELS.length);
  ui.showTitle();
  updateTouchGate();
});
ui.els.btnMotion.textContent = 'Reduce Motion: ' + (saveData.reducedMotion ? 'On' : 'Off');
bindTap(ui.els.btnMute, () => {
  const m = !audio.isMuted(); audio.setMuted(m); save.writeSave({ muted: m });
  ui.els.btnMute.textContent = m ? '∅' : '♪';
});
bindTap(ui.els.btnPause, togglePause);

// unlock audio on any first gesture
const unlockOnce = () => { audio.unlock(); };
window.addEventListener('pointerdown', unlockOnce, { once: true });
window.addEventListener('keydown', unlockOnce, { once: true });

fitCanvas();
updateTouchGate(); // start with touch zones off (title screen)
requestAnimationFrame(frame);

// Read-only debug/test hook — used by tools/browser-smoke.js (tier-2 browser
// gate). Exposes a snapshot of sim state; never mutates the sim.
window.__tetherDebug = () => (state ? {
  tick: state.tick,
  px: Math.round(state.player.x),
  py: Math.round(state.player.y),
  vy: Math.round(state.player.vy * 100) / 100,
  grounded: state.player.grounded,
  jumpsUsed: state.player.jumpsUsed,
  hasTether: !!state.tether,
  cooldown: state.cooldownUntilTick,
  collected: state.collectedCount,
  total: state.totalMotes,
  gateOpen: state.gateOpen,
  deaths: state.deaths,
  won: state.won,
  level: currentIndex,
  touch: { enabled: input.isTouchEnabled(), zones: [...input.getTouchZones().values()] },
} : null);
