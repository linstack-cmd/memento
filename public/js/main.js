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
}

function completeLevel() {
  playing = false;
  levelCompleteShown = true;
  ui.hideHUD();
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
}
function resumeGame() {
  paused = false;
  ui.hidePause();
  input.clear();
  lastFrame = performance.now();
}

function tick() {
  if (!playing || paused) return;

  if (introTimer > 0) {
    introTimer--;
    if (introTimer === 0) ui.hideIntro();
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
// Title / flow wiring
// ---------------------------------------------------------------------------
ui.renderTitleProgress(saveData.unlocked, LEVELS.length);
ui.els.btnPlay.addEventListener('click', () => {
  audio.unlock();
  startLevel(saveData.unlocked - 1);
  ui.hideTitle();
});
ui.els.btnContinue.addEventListener('click', () => {
  audio.unlock();
  const resumeIndex = Math.min(saveData.unlocked - 1, LEVELS.length - 1);
  startLevel(resumeIndex);
  ui.hideTitle();
});
ui.els.btnNext.addEventListener('click', () => {
  ui.hideComplete();
  startLevel(currentIndex + 1);
});
ui.els.btnReplay.addEventListener('click', () => {
  ui.hideEnd();
  save.writeSave({ unlocked: 1 });
  ui.renderTitleProgress(1, LEVELS.length);
  ui.showTitle();
  playing = false;
});
ui.els.btnResume.addEventListener('click', resumeGame);
ui.els.btnMotion.addEventListener('click', () => {
  saveData.reducedMotion = !saveData.reducedMotion;
  save.writeSave({ reducedMotion: saveData.reducedMotion });
  ui.els.btnMotion.textContent = 'Reduce Motion: ' + (saveData.reducedMotion ? 'On' : 'Off');
});
ui.els.btnRestart.addEventListener('click', () => startLevel(currentIndex, true));
ui.els.btnQuit.addEventListener('click', () => {
  playing = false;
  paused = false;
  ui.hidePause(); ui.hideHUD();
  ui.renderTitleProgress(save.loadSave().unlocked, LEVELS.length);
  ui.showTitle();
});
ui.els.btnMotion.textContent = 'Reduce Motion: ' + (saveData.reducedMotion ? 'On' : 'Off');
ui.els.btnMute.addEventListener('click', () => {
  const m = !audio.isMuted(); audio.setMuted(m); save.writeSave({ muted: m });
  ui.els.btnMute.textContent = m ? '∅' : '♪';
});
ui.els.btnPause.addEventListener('click', togglePause);

// unlock audio on any first gesture
const unlockOnce = () => { audio.unlock(); };
window.addEventListener('pointerdown', unlockOnce, { once: true });
window.addEventListener('keydown', unlockOnce, { once: true });

fitCanvas();
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
} : null);
