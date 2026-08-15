// TETHER — game/save.js
// Fault-tolerant localStorage persistence. Blocked/corrupted storage degrades
// to session-only progress and never throws.

const KEY = 'tether.save.v1';

export function loadSave() {
  const blank = { unlocked: 1, best: {}, muted: false, reducedMotion: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank;
    const data = JSON.parse(raw);
    return {
      unlocked: Number.isInteger(data.unlocked) ? Math.max(1, data.unlocked) : 1,
      best: (data.best && typeof data.best === 'object') ? data.best : {},
      muted: !!data.muted,
      reducedMotion: !!data.reducedMotion,
    };
  } catch {
    return blank;
  }
}

export function writeSave(patch) {
  try {
    const cur = loadSave();
    const next = { ...cur, ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage blocked — degrade silently */ }
}

export function recordBest(unlocked, levelIndex, deaths, par) {
  try {
    const cur = loadSave();
    const id = 'level' + levelIndex;
    const prev = cur.best[id];
    const better = !prev || deaths < prev.deaths;
    if (better) cur.best[id] = { deaths, par };
    writeSave({ unlocked: Math.max(cur.unlocked, unlocked), best: cur.best });
  } catch { /* no-op */ }
}

export function isUnlocked(index) {
  return index < loadSave().unlocked;
}
