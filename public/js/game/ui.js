// TETHER — game/ui.js
// Presentation-only DOM/HUD/overlay management. Reads game state, never mutates it.

const $ = (id) => document.getElementById(id);

export function createUI() {
  const els = {
    hud: $('hud'),
    hudLevel: $('hud-level'),
    hudMotes: $('hud-motes'),
    hudCooldown: $('hud-cooldown'),
    hudDeaths: $('hud-deaths'),
    btnMute: $('btn-mute'),
    btnPause: $('btn-pause'),
    touchControls: $('touch-controls'),
    title: $('overlay-title'),
    intro: $('overlay-levelintro'),
    complete: $('overlay-complete'),
    end: $('overlay-end'),
    pause: $('overlay-pause'),
    introName: $('intro-name'),
    introHint: $('intro-hint'),
    completeTitle: $('complete-title'),
    completeStats: $('complete-stats'),
    endStats: $('end-stats'),
    titleProgress: $('title-progress'),
    btnPlay: $('btn-play'),
    btnContinue: $('btn-continue'),
    btnNext: $('btn-next'),
    btnReplay: $('btn-replay'),
    btnResume: $('btn-resume'),
    btnRestart: $('btn-restart'),
    btnMotion: $('btn-motion'),
    btnQuit: $('btn-quit'),
  };

  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  function bind(id, fn) {
    const el = $(id);
    if (el) el.addEventListener('click', fn);
  }

  function setHUD(levelName, collected, total, gateOpen) {
    els.hudLevel.textContent = levelName;
    els.hudMotes.textContent = `Motes ${collected}/${total}` + (gateOpen ? '  ✦ gate open' : '');
  }

  function setCooldown(ready, remainingTicks, tickRate) {
    const el = els.hudCooldown;
    if (ready) {
      el.textContent = 'Tether ready';
      el.className = 'hud-chip ready';
    } else {
      el.textContent = `Tether ${(remainingTicks / tickRate).toFixed(1)}s`;
      el.className = 'hud-chip cooling';
    }
  }

  function setDeaths(deaths) {
    els.hudDeaths.textContent = `falls ${deaths}`;
  }

  function renderTitleProgress(unlocked, totalLevels) {
    let html = '';
    for (let i = 0; i < totalLevels; i++) {
      html += `<span class="dot${i < unlocked ? ' unlocked' : ''}"></span>`;
    }
    els.titleProgress.innerHTML = `Wings relit: ${html}`;
  }

  function showIntro(level) {
    els.introName.textContent = `${level.world}.${level.index} — ${level.name}`;
    els.introHint.textContent = level.hint;
    show(els.intro);
  }
  function hideIntro() { hide(els.intro); }

  function showComplete(stats) {
    els.completeTitle.textContent = stats.final ? 'The Sky, Relit' : 'Level Complete';
    els.completeStats.textContent = stats.text;
    show(els.complete);
  }
  function hideComplete() { hide(els.complete); }

  function showEnd(stats) {
    els.endStats.textContent = stats.text;
    show(els.end);
  }
  function hideEnd() { hide(els.end); }

  function showTitle() { show(els.title); }
  function hideTitle() { hide(els.title); }
  function showHUD() { show(els.hud); }
  function hideHUD() { hide(els.hud); }
  // Touch controls (◀ ▶ JUMP TETHER) are shown only during live gameplay.
  function setTouchControlsVisible(on) {
    if (els.touchControls) {
      if (on) els.touchControls.classList.remove('hidden');
      else els.touchControls.classList.add('hidden');
    }
  }
  function showPause() { show(els.pause); }
  function hidePause() { hide(els.pause); }
  function isPauseVisible() { return !els.pause.classList.contains('hidden'); }

  return {
    els, bind, setHUD, setCooldown, setDeaths, renderTitleProgress,
    showIntro, hideIntro, showComplete, hideComplete, showEnd, hideEnd,
    showTitle, hideTitle, showHUD, hideHUD, setTouchControlsVisible,
    showPause, hidePause, isPauseVisible,
  };
}
