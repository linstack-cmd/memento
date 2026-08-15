// TETHER — game/camera.js
// Presentation-only camera: consumes sim state, never mutates it.
// Lookahead + smoothing + trauma-decay shake. World coords → screen (960x540).

export function createCamera() {
  const c = {
    x: 0, y: 0,
    targetX: 0, targetY: 0,
    trauma: 0,
    prevPlayerX: 0,
  };

  const VIEW_W = 960;
  const VIEW_H = 540;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Update camera to follow the player within the level bounds.
  function update(state, level, dt) {
    const p = state.player;
    const size = { w: state.W * 32, h: state.H * 32 };

    // Lookahead: bias the focus in the facing direction.
    const lookahead = p.facing * 70;
    const focusX = p.x + p.w / 2 + lookahead;
    const focusY = p.y + p.h / 2 - 40;

    const halfW = VIEW_W / 2;
    const halfH = VIEW_H / 2;
    const minX = halfW, maxX = Math.max(halfW, size.w - halfW);
    const minY = halfH, maxY = Math.max(halfH, size.h - halfH);

    c.targetX = clamp(focusX - halfW, minX - halfW, maxX - halfW);
    c.targetY = clamp(focusY - halfH, minY - halfH, maxY - halfH);

    // Smoothing (frame-rate independent-ish, dt in seconds at 120Hz sim).
    const k = 1 - Math.pow(0.0015, dt * 120);
    c.x += (c.targetX - c.x) * k;
    c.y += (c.targetY - c.y) * k;

    // Shake: decay trauma over time.
    c.trauma = Math.max(0, c.trauma - dt * 1.6);
  }

  function addTrauma(amount) {
    c.trauma = Math.min(1, c.trauma + amount);
  }

  // Shake offset applied at render time (does not affect the sim).
  function shakeOffset(rng) {
    const s = c.trauma * c.trauma; // quadratic falloff
    return {
      x: (rng() * 2 - 1) * 14 * s,
      y: (rng() * 2 - 1) * 10 * s,
    };
  }

  return { c, update, addTrauma, shakeOffset, VIEW_W, VIEW_H };
}
