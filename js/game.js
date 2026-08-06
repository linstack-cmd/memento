/* ============================================================
   MEMENTO — a small platformer about collecting the light
   ============================================================ */

(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const hud = document.getElementById('hud');
  const hudOrbs = document.getElementById('hud-orbs');
  const hudLevel = document.getElementById('hud-level');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySub = document.getElementById('overlay-sub');
  const overlayBtn = document.getElementById('overlay-btn');

  /* ---------------- config ---------------- */
  const TILE = 42;
  const GRAVITY = 2100;
  const MOVE_SPEED = 330;
  const ACCEL = 2800;
  const FRICTION = 2400;
  const AIR_ACCEL = 1900;
  const JUMP_V = -640;
  const DOUBLE_JUMP_V = -560;
  const COYOTE = 0.1;
  const JUMP_BUFFER = 0.12;
  const MAX_FALL = 900;

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

  /* ---------------- levels ---------------- */
  // legend:  # solid   . empty   o fragment   P player   E exit
  //          ^ spike    ~ drifting platform (moves)   * big fragment
  const LEVELS = [
    [ // Level I — gentle intro
      '........................',
      '........................',
      '........................',
      '....o...................',
      '...###..................',
      '........................',
      '..........o.............',
      '.........###............',
      '................o.......',
      '...............###......',
      '.....o..................',
      '....###.........o......E',
      '..P............####..###',
      '######..^^^^...########',
      '######..####...########',
    ],
    [ // Level II — gaps and spikes
      '..........................',
      '..........................',
      '......o...................',
      '.....###..................',
      '..........................',
      '..P......o........o.......',
      '####....###......###......',
      '..........................',
      '.....o..........o........E',
      '....###........###......###',
      '..........................',
      '..o........................',
      '.###....^^^^....o.........',
      '####....####...###........',
      '####....####...####.......',
    ],
    [ // Level III — drifting platforms
      '............................',
      '............................',
      '...o........................',
      '..###.......................',
      '............................',
      '........~...................',
      '............................',
      '..P.............o...........',
      '####............###.........',
      '............................',
      '......~...........~.........',
      '............................',
      '.....o.............o.......E',
      '....###...........###....###',
      '..^^^^^^^^....^^^^^^^^....##',
      '..######....######......###',
    ],
    [ // Level IV — the descent
      '..............................',
      '...P......o..................*',
      '..###....###..................',
      '..............................',
      '..........~...................',
      '..............................',
      '.....o.........o..............',
      '....###.......###.............',
      '..............................',
      '........^^^^.........o........',
      '........####.......###........',
      '..............................',
      '...............~.............E',
      '............................###',
      '..o.........................###',
      '.###....^^^^^^....^^^^^^....##',
    ],
  ];

  /* ---------------- audio (WebAudio, no assets) ---------------- */
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function tone(freq, dur, type = 'sine', vol = 0.12, slideTo = null) {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, audioCtx.currentTime + dur);
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }
  const sfx = {
    jump:   () => tone(320, 0.12, 'square', 0.05, 520),
    djump:  () => tone(440, 0.14, 'square', 0.05, 720),
    orb:    () => { tone(880, 0.1, 'sine', 0.08); tone(1320, 0.18, 'sine', 0.06); },
    big:    () => { tone(660, 0.12, 'sine', 0.09); tone(990, 0.2, 'sine', 0.07); tone(1320, 0.3, 'sine', 0.05); },
    hurt:   () => tone(180, 0.25, 'sawtooth', 0.09, 60),
    portal: () => { tone(523, 0.15, 'sine', 0.07); setTimeout(() => tone(659, 0.15, 'sine', 0.07), 90); setTimeout(() => tone(784, 0.3, 'sine', 0.08), 180); },
    land:   () => tone(140, 0.06, 'sine', 0.04),
  };

  /* ---------------- state ---------------- */
  const state = {
    mode: 'title',       // title | play | levelDone | gameDone | dead
    levelIndex: 0,
    deaths: 0,
    level: null,
    player: null,
    camera: { x: 0, y: 0 },
    orbs: [],
    platforms: [],
    exit: null,
    collected: 0,
    totalOrbs: 0,
    particles: [],
    stars: [],
    shake: 0,
    time: 0,
    fadeAlpha: 1,        // fade in
    fadeDir: -1,
    levelStartTime: 0,
  };

  /* ---------------- input ---------------- */
  const keys = {};
  window.addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (state.player) state.player.jumpBuffered = JUMP_BUFFER;
    }
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  const left  = () => keys['ArrowLeft'] || keys['KeyA'];
  const right = () => keys['ArrowRight'] || keys['KeyD'];
  const jumpHeld = () => keys['Space'] || keys['ArrowUp'] || keys['KeyW'];

  /* ---------------- level construction ---------------- */
  function loadLevel(idx) {
    const rows = LEVELS[idx];
    state.levelIndex = idx;
    state.orbs = [];
    state.platforms = [];
    state.exit = null;
    state.collected = 0;
    state.totalOrbs = 0;
    state.particles = [];
    state.player = makePlayer(0, 0);

    const solids = [];
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const c = row[rx];
        const x = rx * TILE, y = ry * TILE;
        switch (c) {
          case '#': solids.push({ x, y, w: TILE, h: TILE }); break;
          case '^': solids.push({ x, y, w: TILE, h: TILE, spike: true }); break;
          case 'o': state.orbs.push({ x: x + TILE / 2, y: y + TILE / 2, big: false, got: false, phase: Math.random() * 6.28 }); state.totalOrbs++; break;
          case '*': state.orbs.push({ x: x + TILE / 2, y: y + TILE / 2, big: true, got: false, phase: Math.random() * 6.28 }); state.totalOrbs++; break;
          case 'P': state.player.x = x; state.player.y = y; break;
          case 'E': state.exit = { x: x + TILE / 2, y: y + TILE / 2, open: false, swirl: 0 }; break;
          case '~': state.platforms.push({ x, y, w: TILE * 3, h: 14, ox: x, range: TILE * 3, speed: 0.6 + Math.random() * 0.4, phase: Math.random() * 6.28 }); break;
        }
      }
    });
    state.solids = solids;

    // build starfield
    state.stars = [];
    const w = rows[0].length * TILE, h = rows.length * TILE;
    for (let i = 0; i < 90; i++) {
      state.stars.push({
        x: Math.random() * w, y: Math.random() * h,
        depth: 0.15 + Math.random() * 0.5,
        r: Math.random() * 1.4 + 0.3,
        tw: Math.random() * 6.28,
      });
    }
    state.camera.x = state.player.x - canvas.width / 2;
    state.camera.y = state.player.y - canvas.height / 2;
    state.fadeAlpha = 1; state.fadeDir = -1;
    state.levelStartTime = state.time;
    updateHud();
  }

  function makePlayer(x, y) {
    return {
      x, y, w: 22, h: 26,
      vx: 0, vy: 0,
      grounded: false, coyote: 0, jumpBuffered: 0,
      jumps: 0, maxJumps: 2,
      facing: 1, dead: false,
      trail: [],
    };
  }

  /* ---------------- physics ---------------- */
  function updatePlayer(p, dt) {
    if (p.dead) return;

    // horizontal
    let dir = 0;
    if (left()) dir -= 1;
    if (right()) dir += 1;
    const accel = p.grounded ? ACCEL : AIR_ACCEL;
    if (dir !== 0) {
      p.vx += dir * accel * dt;
      p.facing = dir;
      p.vx = Math.max(-MOVE_SPEED, Math.min(MOVE_SPEED, p.vx));
    } else {
      const f = (p.grounded ? FRICTION : FRICTION * 0.4) * dt;
      if (p.vx > 0) p.vx = Math.max(0, p.vx - f);
      else if (p.vx < 0) p.vx = Math.min(0, p.vx + f);
    }

    // jump buffering & coyote
    p.jumpBuffered = Math.max(0, p.jumpBuffered - dt);
    p.coyote = Math.max(0, p.coyote - dt);

    const wantJump = p.jumpBuffered > 0;
    if (wantJump) {
      if (p.grounded || p.coyote > 0) {
        p.vy = JUMP_V; p.grounded = false; p.coyote = 0; p.jumpBuffered = 0; p.jumps = 1;
        sfx.jump(); burst(p.x + p.w / 2, p.y + p.h, 6, 'rgba(159,232,255,');
      } else if (p.jumps < p.maxJumps) {
        p.vy = DOUBLE_JUMP_V; p.jumpBuffered = 0; p.jumps++;
        sfx.djump(); burst(p.x + p.w / 2, p.y + p.h, 10, 'rgba(255,217,138,');
      }
    }
    // variable jump height
    if (!jumpHeld() && p.vy < -200) p.vy = -200;

    // gravity
    p.vy += GRAVITY * dt;
    if (p.vy > MAX_FALL) p.vy = MAX_FALL;

    // integrate + collide
    moveAxis(p, p.vx * dt, 0);
    const wasGrounded = p.grounded;
    p.grounded = false;
    moveAxis(p, 0, p.vy * dt);
    if (p.grounded && !wasGrounded && p.vy >= 0) sfx.land();

    // moving platforms carry player
    for (const pl of state.platforms) {
      if (onPlatform(p, pl)) {
        p.x += pl.dx || 0;
        p.grounded = true;
        p.coyote = COYOTE;
        p.jumps = 0;
      }
    }

    if (p.grounded) { p.coyote = COYOTE; p.jumps = 0; }

    // trail
    p.trail.push({ x: p.x + p.w / 2, y: p.y + p.h / 2, life: 1 });
    if (p.trail.length > 22) p.trail.shift();
    p.trail.forEach(t => t.life -= dt * 2.2);

    // fell into the void
    const worldH = LEVELS[state.levelIndex].length * TILE;
    if (p.y > worldH + TILE * 2) killPlayer();

    // spikes
    for (const s of state.solids) {
      if (s.spike && rectOverlap(p, s, 6)) { killPlayer(); break; }
    }
  }

  function moveAxis(p, dx, dy) {
    p.x += dx; p.y += dy;
    for (const s of state.solids) {
      if (s.spike) continue;
      if (!rectOverlap(p, s)) continue;
      if (dx > 0) p.x = s.x - p.w;
      else if (dx < 0) p.x = s.x + s.w;
      if (dy > 0) { p.y = s.y - p.h; p.vy = 0; p.grounded = true; }
      else if (dy < 0) { p.y = s.y + s.h; p.vy = 0; }
      if (dx !== 0) p.vx = 0;
    }
  }

  function onPlatform(p, pl) {
    const px = p.x + p.w / 2;
    const py = p.y + p.h;
    return px > pl.x && px < pl.x + pl.w && Math.abs(py - pl.y) < 10 && p.vy >= 0;
  }

  function rectOverlap(a, b, pad = 0) {
    return a.x + pad < b.x + b.w && a.x + a.w - pad > b.x &&
           a.y + pad < b.y + b.h && a.y + a.h - pad > b.y;
  }

  function killPlayer() {
    const p = state.player;
    if (p.dead) return;
    p.dead = true;
    state.deaths++;
    state.shake = 0.4;
    sfx.hurt();
    burst(p.x + p.w / 2, p.y + p.h / 2, 24, 'rgba(159,232,255,');
    setTimeout(() => { if (state.mode === 'play') loadLevel(state.levelIndex); }, 700);
  }

  /* ---------------- orbs & exit ---------------- */
  function updateOrbs(dt) {
    const p = state.player;
    if (p.dead) return;
    for (const o of state.orbs) {
      if (o.got) continue;
      o.phase += dt * 2.4;
      const dx = (p.x + p.w / 2) - o.x;
      const dy = (p.y + p.h / 2) - o.y;
      const dist = Math.hypot(dx, dy);
      const rad = o.big ? 34 : 26;
      if (dist < rad) {
        o.got = true;
        state.collected++;
        if (o.big) sfx.big(); else sfx.orb();
        burst(o.x, o.y, o.big ? 22 : 12, 'rgba(255,217,138,');
        updateHud();
        if (state.collected >= state.totalOrbs && state.exit) {
          state.exit.open = true;
          sfx.portal();
        }
      }
    }
    // exit
    if (state.exit) {
      state.exit.swirl += dt * 3;
      if (state.exit.open && !p.dead) {
        const dx = (p.x + p.w / 2) - state.exit.x;
        const dy = (p.y + p.h / 2) - state.exit.y;
        if (Math.hypot(dx, dy) < 34) completeLevel();
      }
    }
  }

  function completeLevel() {
    if (state.mode !== 'play') return;
    const isLast = state.levelIndex >= LEVELS.length - 1;
    state.mode = isLast ? 'gameDone' : 'levelDone';
    sfx.portal();
    burst(state.exit.x, state.exit.y, 30, 'rgba(159,232,255,');
    const secs = Math.floor(state.time - state.levelStartTime);
    setTimeout(() => {
      if (isLast) {
        showOverlay('REMEMBERED', `every fragment, gathered home.<br/>you restored the light in ${formatTotal()}.<br/><br/><span style="font-size:13px;color:#4a4560">deaths along the way: ${state.deaths}</span>`, 'begin again');
      } else {
        showOverlay(`DEPTH ${ROMAN[state.levelIndex + 1]}`, `depth ${ROMAN[state.levelIndex]} cleared in ${secs}s.<br/>the light remembers you.`, 'descend');
      }
    }, 650);
  }

  function formatTotal() {
    const t = Math.floor(state.time - state.totalStartTime);
    const m = Math.floor(t / 60), s = t % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  /* ---------------- particles ---------------- */
  function burst(x, y, n, colorPrefix) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      const sp = 40 + Math.random() * 180;
      state.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0.5 + Math.random() * 0.5,
        maxLife: 1, size: 2 + Math.random() * 3,
        color: colorPrefix,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vy += 300 * dt;
      pt.life -= dt;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
  }

  /* ---------------- camera ---------------- */
  function updateCamera(dt) {
    const p = state.player;
    const targetX = p.x + p.w / 2 - canvas.width / 2;
    const targetY = p.y + p.h / 2 - canvas.height / 2;
    const lerp = 1 - Math.pow(0.001, dt);
    state.camera.x += (targetX - state.camera.x) * lerp;
    state.camera.y += (targetY - state.camera.y) * lerp;
    const worldW = LEVELS[state.levelIndex][0].length * TILE;
    const worldH = LEVELS[state.levelIndex].length * TILE;
    state.camera.x = Math.max(0, Math.min(worldW - canvas.width, state.camera.x));
    state.camera.y = Math.max(-TILE * 3, Math.min(worldH - canvas.height + TILE, state.camera.y));
    state.shake = Math.max(0, state.shake - dt);
  }

  /* ---------------- rendering ---------------- */
  function render() {
    const w = canvas.width, h = canvas.height;
    // background gradient
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a0a18');
    g.addColorStop(0.6, '#08080f');
    g.addColorStop(1, '#050508');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const sx = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 22 : 0;
    const sy = state.shake > 0 ? (Math.random() - 0.5) * state.shake * 22 : 0;
    const cx = state.camera.x + sx, cy = state.camera.y + sy;

    // parallax stars
    for (const s of state.stars) {
      const px = s.x - cx * s.depth;
      const py = s.y - cy * s.depth;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(state.time * 1.5 + s.tw));
      ctx.globalAlpha = tw * 0.7;
      ctx.fillStyle = '#cfeaff';
      ctx.beginPath();
      ctx.arc(((px % w) + w) % w, ((py % h) + h) % h, s.r, 0, 6.28);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(-cx, -cy);

    drawPlatformsDrift(cx);
    drawSolids();
    drawOrbs();
    drawExit();
    drawPlayer();
    drawParticles();

    ctx.restore();

    // fade
    if (state.fadeAlpha > 0) {
      ctx.fillStyle = `rgba(4,4,10,${state.fadeAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function drawSolids() {
    for (const s of state.solids) {
      if (s.spike) {
        ctx.fillStyle = '#1a1530';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + s.h);
        ctx.lineTo(s.x + s.w / 2, s.y + 6);
        ctx.lineTo(s.x + s.w, s.y + s.h);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,120,140,0.35)';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#151226';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.strokeStyle = 'rgba(159,232,255,0.07)';
        ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
        // subtle top highlight
        ctx.fillStyle = 'rgba(159,232,255,0.05)';
        ctx.fillRect(s.x, s.y, s.w, 3);
      }
    }
  }

  function drawPlatformsDrift() {
    for (const pl of state.platforms) {
      ctx.fillStyle = '#1c1836';
      ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
      ctx.fillStyle = 'rgba(255,217,138,0.25)';
      ctx.fillRect(pl.x, pl.y, pl.w, 2);
    }
  }

  function drawOrbs() {
    for (const o of state.orbs) {
      if (o.got) continue;
      const bob = Math.sin(o.phase) * 4;
      const r = o.big ? 11 : 7;
      const glow = ctx.createRadialGradient(o.x, o.y + bob, 0, o.x, o.y + bob, r * 3.4);
      const col = o.big ? '255,217,138' : '255,232,180';
      glow.addColorStop(0, `rgba(${col},0.9)`);
      glow.addColorStop(0.4, `rgba(${col},0.25)`);
      glow.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(o.x, o.y + bob, r * 3.4, 0, 6.28);
      ctx.fill();
      ctx.fillStyle = '#fff4d6';
      ctx.beginPath();
      ctx.arc(o.x, o.y + bob, r, 0, 6.28);
      ctx.fill();
    }
  }

  function drawExit() {
    const e = state.exit;
    if (!e) return;
    const alpha = e.open ? 0.9 : 0.18;
    const r = e.open ? 26 + Math.sin(e.swirl) * 3 : 18;
    const glow = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * 2.6);
    glow.addColorStop(0, `rgba(159,232,255,${alpha})`);
    glow.addColorStop(1, 'rgba(159,232,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 2.6, 0, 6.28);
    ctx.fill();
    // swirl ring
    ctx.strokeStyle = `rgba(159,232,255,${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, e.swirl, e.swirl + 4.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 0.6, -e.swirl * 1.4, -e.swirl * 1.4 + 3.4);
    ctx.stroke();
  }

  function drawPlayer() {
    const p = state.player;
    if (p.dead) return;
    // trail
    for (const t of p.trail) {
      if (t.life <= 0) continue;
      ctx.fillStyle = `rgba(159,232,255,${t.life * 0.16})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 6 * t.life, 0, 6.28);
      ctx.fill();
    }
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    // aura
    const aura = ctx.createRadialGradient(px, py, 0, px, py, 34);
    aura.addColorStop(0, 'rgba(159,232,255,0.5)');
    aura.addColorStop(1, 'rgba(159,232,255,0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(px, py, 34, 0, 6.28);
    ctx.fill();
    // body
    ctx.fillStyle = '#eaffff';
    ctx.beginPath();
    ctx.ellipse(px, py, p.w / 2, p.h / 2, 0, 0, 6.28);
    ctx.fill();
    // eye
    ctx.fillStyle = '#0a0a18';
    ctx.beginPath();
    ctx.arc(px + p.facing * 5, py - 3, 3, 0, 6.28);
    ctx.fill();
  }

  function drawParticles() {
    for (const pt of state.particles) {
      const a = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color + (a * 0.9) + ')';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * a, 0, 6.28);
      ctx.fill();
    }
  }

  /* ---------------- HUD & overlay ---------------- */
  function updateHud() {
    hudOrbs.textContent = `${state.collected} / ${state.totalOrbs}`;
    hudLevel.textContent = ROMAN[state.levelIndex] || '·';
  }
  function showOverlay(title, subHtml, btnText) {
    overlayTitle.textContent = title;
    overlaySub.innerHTML = subHtml;
    overlayBtn.textContent = btnText;
    overlay.classList.remove('hidden');
  }

  overlayBtn.addEventListener('click', () => {
    ensureAudio();
    overlay.classList.add('hidden');
    if (state.mode === 'title') {
      state.deaths = 0;
      state.totalStartTime = state.time;
      loadLevel(0);
      state.mode = 'play';
      hud.classList.add('visible');
    } else if (state.mode === 'levelDone') {
      loadLevel(state.levelIndex + 1);
      state.mode = 'play';
    } else if (state.mode === 'gameDone') {
      state.deaths = 0;
      state.totalStartTime = state.time;
      loadLevel(0);
      state.mode = 'play';
      hud.classList.add('visible');
    }
  });

  /* ---------------- resize ---------------- */
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------------- main loop ---------------- */
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    state.time += dt;

    // fade
    if (state.fadeDir < 0) {
      state.fadeAlpha = Math.max(0, state.fadeAlpha - dt * 1.4);
    }

    if (state.mode === 'play' || state.mode === 'levelDone' || state.mode === 'gameDone') {
      // update drifting platforms
      for (const pl of state.platforms) {
        const t = state.time * pl.speed + pl.phase;
        const nx = pl.ox + Math.sin(t) * pl.range;
        pl.dx = nx - pl.x;
        pl.x = nx;
      }
      updatePlayer(state.player, dt);
      updateOrbs(dt);
      updateParticles(dt);
      updateCamera(dt);
    } else {
      updateParticles(dt);
    }

    render();
    requestAnimationFrame(loop);
  }

  // start at title
  showOverlay('MEMENTO', 'the world went dark, and the memories scattered.<br/>you are the last light left.', 'begin');
  requestAnimationFrame(loop);
})();
