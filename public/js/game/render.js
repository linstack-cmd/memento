// TETHER — game/render.js
// Presentation-only renderer. Consumes sim state; NEVER mutates it.
// Fixed internal resolution 960x540, scaled to the letterboxed canvas.

import { mulberry32 } from '../core/rng.js';
import { TILE, ANCHOR_SIZE } from '../core/config.js';

const PALETTES = {
  moss:      { skyTop: '#0a1f2a', skyBottom: '#17353a', tile: '#2c4f42', tileEdge: '#4a7560', oneway: '#5f9c7a', accent: '#a8e6c0' },
  turquoise: { skyTop: '#06202c', skyBottom: '#14505c', tile: '#1f4a56', tileEdge: '#3d7f8a', oneway: '#57a8b0', accent: '#9be8e8' },
  ember:     { skyTop: '#1a0f14', skyBottom: '#4a2416', tile: '#5a3026', tileEdge: '#9c5a36', oneway: '#d0823f', accent: '#ffb36b' },
  'pale-gold': { skyTop: '#0d1420', skyBottom: '#3a3a24', tile: '#4a4a2e', tileEdge: '#8c8a52', oneway: '#cfc46a', accent: '#ffe9a8' },
};

export function createRenderer(canvas, camera, levelIndex, save) {
  const ctx = canvas.getContext('2d');
  const VIEW_W = camera.VIEW_W;
  const VIEW_H = camera.VIEW_H;
  const W = VIEW_W, H = VIEW_H;

  const rng = mulberry32(1234 + levelIndex * 777);
  const particles = [];
  const MAX_PARTICLES = 260;

  // parallax atmosphere state
  const spores = [];
  for (let i = 0; i < 46; i++) spores.push({ x: rng() * W, y: rng() * H, s: 0.6 + rng() * 2.2, drift: 0.4 + rng() * 1.2, wob: rng() * 6.28, glow: 0.3 + rng() * 0.5 });
  const fireflies = [];
  for (let i = 0; i < 18; i++) fireflies.push({ x: rng() * W, y: rng() * H, phase: rng() * 6.28, speed: 0.3 + rng() * 0.5 });
  const rain = [];
  for (let i = 0; i < 60; i++) rain.push({ x: rng() * W, y: rng() * H, len: 8 + rng() * 10, sp: 6 + rng() * 8 });

  // cached sky gradient
  let skyGrad = null;
  function sky(level) {
    if (!skyGrad) {
      const pal = PALETTES[level.palette] || PALETTES.moss;
      skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      skyGrad.addColorStop(0, pal.skyTop);
      skyGrad.addColorStop(1, pal.skyBottom);
    }
    return skyGrad;
  }

  function setPalette(level) {
    skyGrad = null; // rebuild for a new level palette
  }

  // ---------------- particles ----------------
  function spawn(x, y, kind, opts = {}) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push({
      x, y, kind,
      vx: opts.vx || 0, vy: opts.vy || 0,
      life: opts.life || 30, maxLife: opts.life || 30,
      size: opts.size || 2, color: opts.color || '#ffe9a8',
      grav: opts.grav || 0,
    });
  }

  function burst(x, y, kind, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const sp = 0.4 + rng() * 1.4;
      spawn(x, y, kind, { ...opts, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1 });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.vy += (p.grav || 0) * dt * 60;
      p.vx *= 0.96;
    }
  }

  function drawParticles(cam) {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      const sx = p.x - cam.c.x, sy = p.y - cam.c.y;
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, p.size * a, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- parallax atmosphere ----------------
  function drawAtmosphere(level, time, reduced, cam) {
    const pal = PALETTES[level.palette] || PALETTES.moss;
    const par = 0.18; // parallax factor
    // drifting spores (closer layer)
    for (const s of spores) {
      const sx = (s.x + s.drift * time * 0.01 - cam.c.x * 0.35) % (W + 40) - 20;
      const sy = s.y + Math.sin(time * 0.003 + s.wob) * 14;
      ctx.globalAlpha = 0.25 * s.glow;
      ctx.fillStyle = pal.accent;
      ctx.beginPath(); ctx.arc(sx, sy, s.s * 0.7, 0, 6.283); ctx.fill();
    }
    // fireflies
    if (!reduced) {
      for (const f of fireflies) {
        const fx = f.x + Math.sin(time * 0.002 + f.phase) * 40 - cam.c.x * 0.5;
        const fy = f.y + Math.cos(time * 0.003 + f.phase) * 30;
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.01 + f.phase);
        ctx.globalAlpha = 0.5 * pulse;
        ctx.fillStyle = '#fff3b0';
        ctx.beginPath(); ctx.arc(fx, fy, 2.2, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 0.16 * pulse;
        ctx.beginPath(); ctx.arc(fx, fy, 7, 0, 6.283); ctx.fill();
      }
    }
    // rain streaks
    if (level.palette === 'ember' || level.palette === 'pale-gold') {
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = '#9fd8e8';
      ctx.lineWidth = 1;
      for (const r of rain) {
        const rx = (r.x - cam.c.x * 0.3) % (W + 40) - 20;
        const ry = (r.y + time * 0.05 * r.sp) % (H + 40) - 20;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 2, ry + r.len);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------- world drawing ----------------
  function tileChar(level, tx, ty) {
    if (ty < 0 || ty >= level.grid.length) return null;
    const row = level.grid[ty];
    if (tx < 0 || tx >= row.length) return null;
    return row[tx];
  }

  function drawWorld(state, level, cam) {
    const pal = PALETTES[level.palette] || PALETTES.moss;
    const x0 = Math.floor(cam.c.x / TILE) - 1;
    const x1 = Math.ceil((cam.c.x + W) / TILE) + 1;
    const y0 = Math.floor(cam.c.y / TILE) - 1;
    const y1 = Math.ceil((cam.c.y + H) / TILE) + 1;

    // solid tiles
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = tileChar(level, tx, ty);
        if (!c || c === '.' || c === ' ') continue;
        const sx = tx * TILE - cam.c.x;
        const sy = ty * TILE - cam.c.y;
        if (c === '#') {
          ctx.fillStyle = pal.tile;
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = pal.tileEdge;
          ctx.fillRect(sx, sy, TILE, 2);
          ctx.fillRect(sx, sy + TILE - 2, TILE, 2);
        } else if (c === '=') {
          ctx.fillStyle = pal.oneway;
          ctx.fillRect(sx, sy + TILE - 4, TILE, 4);
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(sx, sy + TILE - 4, TILE, 1);
        } else if (c === '^') {
          drawSpike(sx, sy, pal);
        }
      }
    }

    // gate
    drawGate(state, cam, pal);
  }

  function drawSpike(sx, sy, pal) {
    ctx.fillStyle = '#b8433a';
    ctx.strokeStyle = '#e88b6a';
    ctx.lineWidth = 1;
    const n = 3;
    const w = TILE / n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(sx + i * w, sy + TILE);
      ctx.lineTo(sx + i * w + w / 2, sy);
      ctx.lineTo(sx + (i + 1) * w, sy + TILE);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawGate(state, cam, pal) {
    const g = state.gate;
    if (!g) return;
    const sx = g.x - cam.c.x, sy = g.y - cam.c.y;
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.006);
    if (state.gateOpen) {
      ctx.globalAlpha = 0.5 * pulse;
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(sx + 2, sy + 2, g.w - 4, g.h - 4);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, g.w, g.h);
    } else {
      ctx.fillStyle = 'rgba(60,90,80,0.6)';
      ctx.fillRect(sx, sy, g.w, g.h);
      ctx.strokeStyle = pal.oneway;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, g.w, g.h);
      // lock icon
      ctx.fillStyle = '#ffe9a8';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✦', sx + g.w / 2, sy + g.h / 2 + 6);
    }
  }

  // ---------------- entities ----------------
  function drawEntities(state, cam) {
    // lanterns
    for (const l of state.lanterns) {
      const sx = l.x + TILE / 2 - cam.c.x, sy = l.y + TILE / 2 - cam.c.y;
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.005 + l.x);
      ctx.globalAlpha = 0.5 * pulse;
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.15;
      ctx.beginPath(); ctx.arc(sx, sy, 18, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#c98a3a';
      ctx.fillRect(sx - 2, sy - 14, 4, 8);
    }

    // motes
    for (const m of state.motes) {
      const cx = m.x + TILE / 2 - cam.c.x, cy = m.y + TILE / 2 - cam.c.y;
      if (m.collected) continue;
      const pulse = 0.75 + 0.25 * Math.sin(performance.now() * 0.008 + m.id.charCodeAt(0));
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.3 * pulse;
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // moving platforms
    for (const p of state.platforms) {
      const sx = p.x - cam.c.x, sy = p.y - cam.c.y;
      ctx.fillStyle = '#3d6b57';
      ctx.fillRect(sx, sy, p.w, p.h);
      ctx.fillStyle = '#7fb896';
      ctx.fillRect(sx, sy, p.w, 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sy, p.w, p.h);
      // motes riding platform indicator
      ctx.fillStyle = 'rgba(255,233,168,0.5)';
      ctx.fillRect(sx + 4, sy + p.h / 2, p.w - 8, 2);
    }
  }

  // ---------------- tether ----------------
  function drawTether(state, cam) {
    const p = state.player;
    const pcx = p.x + p.w / 2 - cam.c.x;
    const pcy = p.y + p.h / 2 - cam.c.y;
    if (state.tether) {
      const t = state.tether;
      const tx = t.x - cam.c.x, ty = t.y - cam.c.y;
      const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.01);
      // tether line
      ctx.strokeStyle = `rgba(160,240,255,${0.5 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pcx, pcy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      // anchor bloom
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#c8f6ff';
      ctx.beginPath(); ctx.arc(tx, ty, ANCHOR_SIZE * 0.6 * pulse, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(tx, ty, ANCHOR_SIZE * 1.4, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ---------------- the moth ----------------
  function drawMoth(state, cam, time) {
    const p = state.player;
    const cx = p.x + p.w / 2 - cam.c.x;
    const cy = p.y + p.h / 2 - cam.c.y;
    const flap = Math.sin(time * 0.04 + (p.grounded ? 0 : 6)) * (p.grounded ? 0.3 : 1);
    const dir = p.facing;

    ctx.save();
    ctx.translate(cx, cy);

    // warm glow
    const glow = 0.12 + (state.tether ? 0.06 : 0);
    ctx.globalAlpha = glow;
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;

    // wings
    ctx.fillStyle = 'rgba(210,240,220,0.75)';
    ctx.strokeStyle = 'rgba(255,233,168,0.9)';
    ctx.lineWidth = 1;
    for (const s of [-1, 1]) {
      const wing = s * (5 + flap * 5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(wing * 0.5, -12, wing * 0.9, -4);
      ctx.quadraticCurveTo(wing * 0.55, 2, 0, 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // body
    ctx.fillStyle = '#e8f5ee';
    ctx.beginPath();
    ctx.ellipse(0, 0, 4, 6, 0, 0, 6.283);
    ctx.fill();

    // eyes
    ctx.fillStyle = '#3a6a55';
    ctx.beginPath();
    ctx.arc(dir * 2, -3, 1.6, 0, 6.283);
    ctx.fill();

    ctx.restore();
  }

  // ---------------- vignette ----------------
  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------------- main render ----------------
  function render(state, level, time, opts = {}) {
    const { reducedMotion = false, shake = { x: 0, y: 0 } } = opts;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = sky(level);
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(shake.x, shake.y);

    drawAtmosphere(level, time, reducedMotion, camera);
    drawWorld(state, level, camera);
    drawEntities(state, camera);
    drawTether(state, camera);
    drawMoth(state, camera, time);
    updateParticles(1);
    drawParticles(camera);

    ctx.restore();
    drawVignette();
  }

  return { render, spawn, burst, setPalette, rng };
}
