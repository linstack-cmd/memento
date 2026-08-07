/* ============================================================
   MEMENTO — a small 3D platformer about collecting the light
   ============================================================ */

(() => {
  'use strict';

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const hud = document.getElementById('hud');
  const hudOrbs = document.getElementById('hud-orbs');
  const hudLevel = document.getElementById('hud-level');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySub = document.getElementById('overlay-sub');
  const overlayBtn = document.getElementById('overlay-btn');
  const fadeEl = document.getElementById('fade');

  // ---------- physics config (identical to 2D version) ----------
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
  const S = 0.05; // world units per physics px

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

  const LEVELS = [
    [
        "........................",
        "........................",
        "........................",
        "....o...................",
        "...###..................",
        "........................",
        "..........o.............",
        ".........###............",
        "................o.......",
        "...............###......",
        ".....o..................",
        "....###.........o......E",
        "..P............####..###",
        "######..^^^^...########",
        "######..####...########"
    ],
    [
        "..........................",
        "..........................",
        "......o...................",
        ".....###..................",
        "..........................",
        "..P......o........o.......",
        "####....###......###......",
        "..........................",
        ".....o..........o........E",
        "....###........###......###",
        "..........................",
        "..o........................",
        ".###....^^^^....o..###.....",
        "####....####...###........",
        "####....####...####......."
    ],
    [
        "............................",
        "............................",
        "...o........................",
        "..###.......................",
        "............................",
        "........~...................",
        "............................",
        "..P.............o...........",
        "####............###.........",
        "............................",
        "......~...........~.........",
        "............................",
        ".....o.............o.......E",
        "....###...........###....###",
        "..^^^^^^^^....^^^^^^^^....##",
        "..######....######......###"
    ],
    [
        "...............................",
        "...P.....o.....................",
        "..###...###....................",
        "...............o...............",
        "..............###..............",
        "...............................",
        "...................o...........",
        "..................###..........",
        "...............................",
        ".......................o.......",
        "......................###......",
        "...........................*...",
        ".............................E.",
        "...........................###.",
        "...............................",
        "###...^^^^^^....^^^^^^.......##"
    ]
];

  // ---------- audio ----------
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

  // ---------- three.js scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05050a);
  scene.fog = new THREE.Fog(0x05050a, 24, 70);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, 0, 17.5);

  scene.add(new THREE.AmbientLight(0x30304d, 2.4));
  const dirLight = new THREE.DirectionalLight(0x8ea2ff, 0.8);
  dirLight.position.set(-8, 14, 12);
  scene.add(dirLight);

  // halo sprite texture
  function makeHaloTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }
  const haloTex = makeHaloTexture();

  // stars
  const starCount = 340;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 160;
    starPos[i * 3 + 1] = (Math.random() - 0.5) * 120;
    starPos[i * 3 + 2] = -30 - Math.random() * 60;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xcfeaff, size: 0.14, transparent: true, opacity: 0.7, sizeAttenuation: true });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // shared geometry/materials
  const blockGeo = new THREE.BoxGeometry(TILE * S, TILE * S, TILE * S * 0.6);
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x1b1533, roughness: 0.92, metalness: 0.08, emissive: 0x070512 });
  const blockEdgesGeo = new THREE.EdgesGeometry(blockGeo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x6a5fae, transparent: true, opacity: 0.3 });
  const spikeGeo = new THREE.ConeGeometry(TILE * S * 0.42, TILE * S * 0.85, 4);
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xff5d7a, roughness: 0.6, emissive: 0x3a0f1c });
  const orbGeo = new THREE.SphereGeometry(0.36, 20, 20);
  const orbMat = new THREE.MeshBasicMaterial({ color: 0xfff2cf });
  const bigOrbGeo = new THREE.SphereGeometry(0.55, 20, 20);
  const platGeo = new THREE.BoxGeometry(TILE * 3 * S, 14 * S, TILE * S * 0.5);
  const platMat = new THREE.MeshStandardMaterial({ color: 0x2a2148, roughness: 0.85, emissive: 0x0d0a1f });
  const platStripMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.5 });

  // player rig
  const playerGroup = new THREE.Group();
  const playerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 24), new THREE.MeshBasicMaterial({ color: 0xeaffff }));
  const playerHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0x9fe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  playerHalo.scale.set(4.4, 4.4, 1);
  const playerLight = new THREE.PointLight(0x9fe8ff, 16, 13);
  playerLight.position.set(0, 0, 1.4);
  playerGroup.add(playerMesh, playerHalo, playerLight);
  playerGroup.visible = false;
  scene.add(playerGroup);

  // exit rig (created per level, stored in state)

  // particles pool
  const particlePool = [];
  const particles = [];
  const particleGeo = new THREE.SphereGeometry(0.09, 6, 6);
  for (let i = 0; i < 200; i++) {
    const m = new THREE.Mesh(particleGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    m.visible = false;
    scene.add(m);
    particlePool.push(m);
  }
  function burst(px, py, n, hex) {
    for (let i = 0; i < n; i++) {
      const mesh = particlePool.find(m => !m.visible) || particlePool[Math.floor(Math.random() * particlePool.length)];
      mesh.visible = true;
      mesh.material.color.setHex(hex);
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 180;
      particles.push({
        x: px, y: py, z: (Math.random() - 0.5) * 1.5,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, vz: (Math.random() - 0.5) * 2,
        life: 0.5 + Math.random() * 0.5, maxLife: 1, size: 1 + Math.random() * 1.6, mesh,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      pt.vy += 300 * dt;
      pt.life -= dt;
      if (pt.life <= 0) { pt.mesh.visible = false; particles.splice(i, 1); continue; }
      const a = pt.life / pt.maxLife;
      pt.mesh.position.set(pt.x * S, -pt.y * S, pt.z);
      pt.mesh.scale.setScalar(pt.size * a * S * 6);
      pt.mesh.material.opacity = a;
    }
  }

  // trail pool
  const trailPool = [];
  const trails = [];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    trailPool.push(m);
  }
  let trailTimer = 0;
  function pushTrail(px, py) {
    const mesh = trailPool.find(m => !m.visible) || null;
    if (!mesh) return;
    mesh.visible = true;
    mesh.position.set(px * S, -py * S, 0);
    trails.push({ life: 1, mesh });
  }
  function updateTrails(dt) {
    for (let i = trails.length - 1; i >= 0; i--) {
      const t = trails[i];
      t.life -= dt * 2.4;
      if (t.life <= 0) { t.mesh.visible = false; trails.splice(i, 1); continue; }
      t.mesh.scale.setScalar(t.life);
      t.mesh.material.opacity = t.life * 0.35;
    }
  }

  // ---------- state ----------
  const state = {
    mode: 'title',
    levelIndex: 0,
    deaths: 0,
    level: null,
    player: null,
    solids: [],
    orbs: [],
    platforms: [],
    exit: null,
    collected: 0,
    totalOrbs: 0,
    shake: 0,
    time: 0,
    levelStartTime: 0,
    totalStartTime: 0,
    world: null,
    orbObjs: [],
    exitObj: null,
    platMeshes: [],
  };
  let camX = 0, camY = 0;

  // ---------- level building ----------
  function makePlayer(x, y) {
    return {
      x, y, w: 22, h: 26,
      vx: 0, vy: 0,
      grounded: false, coyote: 0, jumpBuffered: 0,
      jumps: 0, maxJumps: 2,
      facing: 1, dead: false,
    };
  }

  function addBlock(group, x, y) {
    const m = new THREE.Mesh(blockGeo, blockMat);
    m.position.set(x * S, -y * S, 0);
    group.add(m);
    const e = new THREE.LineSegments(blockEdgesGeo, edgeMat);
    e.position.copy(m.position);
    group.add(e);
  }
  function addSpike(group, x, y) {
    const m = new THREE.Mesh(spikeGeo, spikeMat);
    m.position.set(x * S, -(y * S) + TILE * S * 0.08, TILE * S * 0.2);
    group.add(m);
  }
  function addOrb(group, x, y, big) {
    const g = new THREE.Group();
    const sphere = new THREE.Mesh(big ? bigOrbGeo : orbGeo, orbMat);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: big ? 0xffd98a : 0xfff2cf, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(big ? 4.6 : 3.2, big ? 4.6 : 3.2, 1);
    const light = new THREE.PointLight(big ? 0xffd98a : 0xfff2cf, big ? 10 : 6, 7);
    g.add(sphere, halo, light);
    g.position.set(x * S, -y * S, 0.4);
    group.add(g);
    return g;
  }
  function addExit(group, x, y) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.06, 10, 48), mat);
    const torus2 = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.045, 10, 48), mat.clone());
    torus2.material.opacity = 0.6;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0x9fe8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
    halo.scale.set(6, 6, 1);
    const light = new THREE.PointLight(0x9fe8ff, 6, 9);
    g.add(torus, torus2, halo, light);
    g.position.set(x * S, -y * S, 0.3);
    group.add(g);
    return g;
  }
  function addPlatform(group, x, y) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(platGeo, platMat);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(TILE * 3 * S, 0.08, TILE * S * 0.5), platStripMat);
    strip.position.set(0, 14 * S * 0.5, 0);
    g.add(body, strip);
    g.position.set(x * S, -(y + 7) * S, 0);
    group.add(g);
    return g;
  }

  function loadLevel(idx) {
    const rows = LEVELS[idx];
    state.levelIndex = idx;
    state.orbs = [];
    state.platforms = [];
    state.exit = null;
    state.collected = 0;
    state.totalOrbs = 0;
    state.orbObjs = [];
    state.exitObj = null;
    state.platMeshes = [];
    state.player = makePlayer(0, 0);

    if (state.world) { scene.remove(state.world); }
    const world = new THREE.Group();
    state.world = world;
    scene.add(world);

    const solids = [];
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const c = row[rx];
        const x = rx * TILE, y = ry * TILE;
        switch (c) {
          case '#': solids.push({ x, y, w: TILE, h: TILE }); addBlock(world, x + TILE / 2, y + TILE / 2); break;
          case '^': solids.push({ x, y, w: TILE, h: TILE, spike: true }); addSpike(world, x + TILE / 2, y + TILE / 2); break;
          case 'o': state.orbs.push({ x: x + TILE / 2, y: y + TILE / 2, big: false, got: false, phase: Math.random() * 6.28 }); state.totalOrbs++; state.orbObjs.push(addOrb(world, x + TILE / 2, y + TILE / 2, false)); break;
          case '*': state.orbs.push({ x: x + TILE / 2, y: y + TILE / 2, big: true, got: false, phase: Math.random() * 6.28 }); state.totalOrbs++; state.orbObjs.push(addOrb(world, x + TILE / 2, y + TILE / 2, true)); break;
          case 'P': state.player.x = x; state.player.y = y; break;
          case 'E': state.exit = { x: x + TILE / 2, y: y + TILE / 2, open: false, swirl: 0 }; state.exitObj = addExit(world, x + TILE / 2, y + TILE / 2); break;
          case '~': {
            state.platforms.push({ x, y, w: TILE * 3, h: 14, ox: x, range: TILE * 3, speed: 0.6 + Math.random() * 0.4, phase: Math.random() * 6.28 });
            state.platMeshes.push(addPlatform(world, x + TILE * 1.5, y));
            break;
          }
        }
      }
    });
    state.solids = solids;

    // void glow under the level
    const h = rows.length * TILE;
    const voidPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 30),
      new THREE.MeshBasicMaterial({ color: 0x0d0a1e, transparent: true, opacity: 0.9 })
    );
    voidPlane.position.set(rows[0].length * TILE * S / 2, -(h * S) - 6, -8);
    world.add(voidPlane);

    playerGroup.visible = true;
    camX = (state.player.x + state.player.w / 2) * S;
    camY = -(state.player.y + state.player.h / 2) * S + 1.6;
    fadeEl.style.opacity = '1';
    requestAnimationFrame(() => { fadeEl.style.opacity = '0'; });
    state.levelStartTime = state.time;
    updateHud();
  }

  // ---------- input ----------
  const keys = {};
  window.addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (state.player) state.player.jumpBuffered = JUMP_BUFFER;
    }
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  const left = () => keys['ArrowLeft'] || keys['KeyA'];
  const right = () => keys['ArrowRight'] || keys['KeyD'];
  const jumpHeld = () => keys['Space'] || keys['ArrowUp'] || keys['KeyW'];

  // ---------- physics (identical to 2D version) ----------
  function rectOverlap(a, b, pad = 0) {
    return a.x + pad < b.x + b.w && a.x + a.w - pad > b.x &&
           a.y + pad < b.y + b.h && a.y + a.h - pad > b.y;
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
  function updatePlayer(p, dt) {
    if (!p || p.dead) return;

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

    p.jumpBuffered = Math.max(0, p.jumpBuffered - dt);
    p.coyote = Math.max(0, p.coyote - dt);

    if (p.jumpBuffered > 0) {
      if (p.grounded || p.coyote > 0) {
        p.vy = JUMP_V; p.grounded = false; p.coyote = 0; p.jumpBuffered = 0; p.jumps = 1;
        sfx.jump(); burst(p.x + p.w / 2, p.y + p.h, 6, 0x9fe8ff);
      } else if (p.jumps < p.maxJumps) {
        p.vy = DOUBLE_JUMP_V; p.jumpBuffered = 0; p.jumps++;
        sfx.djump(); burst(p.x + p.w / 2, p.y + p.h, 10, 0xffd98a);
      }
    }
    if (!jumpHeld() && p.vy < -200) p.vy = -200;

    p.vy += GRAVITY * dt;
    if (p.vy > MAX_FALL) p.vy = MAX_FALL;

    moveAxis(p, p.vx * dt, 0);
    const wasGrounded = p.grounded;
    const prevBottom = p.y + p.h;
    p.grounded = false;
    moveAxis(p, 0, p.vy * dt);
    if (p.grounded && !wasGrounded && p.vy >= 0) sfx.land();

    // one-way drifting platforms
    for (const pl of state.platforms) {
      const px = p.x + p.w / 2;
      if (px < pl.x - 2 || px > pl.x + pl.w + 2) continue;
      const bottom = p.y + p.h;
      if (p.vy >= 0 && prevBottom <= pl.y + 2 && bottom >= pl.y - 2) {
        p.y = pl.y - p.h;
        p.vy = 0;
        p.grounded = true;
        if (!wasGrounded) sfx.land();
      }
    }
    if (p.grounded) {
      for (const pl of state.platforms) {
        const px = p.x + p.w / 2;
        if (px < pl.x - 2 || px > pl.x + pl.w + 2) continue;
        if (Math.abs((p.y + p.h) - pl.y) < 3) {
          p.y = pl.y - p.h;
          p.vy = 0;
          p.x += pl.dx || 0;
          break;
        }
      }
      p.coyote = COYOTE;
      p.jumps = 0;
    }

    const worldH = LEVELS[state.levelIndex].length * TILE;
    if (p.y > worldH + TILE * 2) killPlayer();

    for (const s of state.solids) {
      if (s.spike && rectOverlap(p, s, 6)) { killPlayer(); break; }
    }
  }
  function killPlayer() {
    const p = state.player;
    if (!p || p.dead) return;
    p.dead = true;
    state.deaths++;
    state.shake = 0.4;
    sfx.hurt();
    burst(p.x + p.w / 2, p.y + p.h / 2, 26, 0x9fe8ff);
    playerGroup.visible = false;
    setTimeout(() => { if (state.mode === 'play') loadLevel(state.levelIndex); }, 700);
  }

  function updateOrbs(dt) {
    const p = state.player;
    if (!p || p.dead) return;
    for (let i = 0; i < state.orbs.length; i++) {
      const o = state.orbs[i];
      if (o.got) continue;
      o.phase += dt * 2.4;
      const dx = (p.x + p.w / 2) - o.x;
      const dy = (p.y + p.h / 2) - o.y;
      const dist = Math.hypot(dx, dy);
      const rad = o.big ? 34 : 26;
      if (dist < rad) {
        o.got = true;
        state.collected++;
        const obj = state.orbObjs[i];
        if (obj) obj.visible = false;
        if (o.big) sfx.big(); else sfx.orb();
        burst(o.x, o.y, o.big ? 22 : 12, 0xffd98a);
        updateHud();
        if (state.collected >= state.totalOrbs && state.exit) {
          state.exit.open = true;
          sfx.portal();
        }
      }
    }
    if (state.exit && state.exitObj) {
      state.exit.swirl += dt * 3;
      const e = state.exit;
      const g = state.exitObj;
      g.children[0].rotation.z = e.swirl;
      g.children[1].rotation.z = -e.swirl * 1.4;
      const pulse = e.open ? 1 + Math.sin(state.time * 6) * 0.12 : 0.85;
      g.scale.setScalar(pulse);
      g.children[2].material.opacity = e.open ? 0.95 : 0.45;
      g.children[3].intensity = e.open ? 14 : 5;
      if (e.open && !p.dead) {
        const dx = (p.x + p.w / 2) - e.x;
        const dy = (p.y + p.h / 2) - e.y;
        if (Math.hypot(dx, dy) < 34) completeLevel();
      }
    }
  }

  function completeLevel() {
    if (state.mode !== 'play') return;
    const isLast = state.levelIndex >= LEVELS.length - 1;
    state.mode = isLast ? 'gameDone' : 'levelDone';
    sfx.portal();
    if (state.exitObj) burst(state.exit.x, state.exit.y, 30, 0x9fe8ff);
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

  // ---------- camera ----------
  function updateCamera(dt) {
    const p = state.player;
    if (!p) return;
    const tx = (p.x + p.w / 2) * S;
    const ty = -(p.y + p.h / 2) * S + 1.6;
    const k = 1 - Math.pow(0.001, dt);
    camX += (tx - camX) * k;
    camY += (ty - camY) * k;

    // clamp horizontally to level bounds when possible
    const rows = LEVELS[state.levelIndex];
    const worldW = rows[0].length * TILE * S;
    const halfView = 17.5 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    let useX = camX;
    if (worldW > halfView * 2) useX = Math.max(halfView - 1, Math.min(worldW - halfView + 1, camX));
    else useX = worldW / 2;

    let sx = 0, sy = 0;
    if (state.shake > 0) {
      sx = (Math.random() - 0.5) * state.shake * 1.2;
      sy = (Math.random() - 0.5) * state.shake * 1.2;
    }
    camera.position.set(useX + sx - p.vx * 0.003, camY + sy + 0.9, 17.5);
    camera.lookAt(useX + sx, camY + sy - 1.1, 0);
    state.shake = Math.max(0, state.shake - dt);
  }

  // ---------- mesh sync ----------
  function syncMeshes(dt) {
    const p = state.player;
    if (p && !p.dead) {
      playerGroup.visible = true;
      playerGroup.position.set((p.x + p.w / 2) * S, -(p.y + p.h / 2) * S, 0);
      const pulse = 1 + Math.sin(state.time * 6) * 0.05;
      playerMesh.scale.setScalar(pulse);
      playerLight.intensity = 16 + Math.sin(state.time * 6) * 2;
      trailTimer -= dt;
      if (trailTimer <= 0 && (Math.abs(p.vx) > 40 || Math.abs(p.vy) > 40)) {
        pushTrail(p.x + p.w / 2, p.y + p.h / 2);
        trailTimer = 0.03;
      }
    } else {
      playerGroup.visible = false;
    }
    // platforms
    for (let i = 0; i < state.platforms.length; i++) {
      const pl = state.platforms[i];
      const mesh = state.platMeshes[i];
      if (mesh) mesh.position.x = (pl.x + pl.w / 2) * S;
    }
    // orbs bob + halo pulse
    for (let i = 0; i < state.orbs.length; i++) {
      const o = state.orbs[i];
      if (o.got) continue;
      const g = state.orbObjs[i];
      if (!g) continue;
      const bob = Math.sin(o.phase) * 4;
      g.position.y = -(o.y + bob) * S;
      const s = 1 + Math.sin(state.time * 3 + o.phase) * 0.08;
      g.children[1].scale.setScalar((o.big ? 4.6 : 3.2) * s);
    }
    starMat.opacity = 0.55 + Math.sin(state.time * 1.2) * 0.15;
  }

  // ---------- HUD & overlay ----------
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

  // ---------- resize ----------
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // ---------- main loop ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    state.time += dt;

    if (state.mode === 'play' || state.mode === 'levelDone' || state.mode === 'gameDone') {
      for (const pl of state.platforms) {
        const t = state.time * pl.speed + pl.phase;
        const nx = pl.ox + Math.sin(t) * pl.range;
        pl.dx = nx - pl.x;
        pl.x = nx;
      }
      updatePlayer(state.player, dt);
      updateOrbs(dt);
      updateParticles(dt);
      updateTrails(dt);
      syncMeshes(dt);
    } else {
      updateParticles(dt);
      updateTrails(dt);
    }

    updateCamera(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  showOverlay('MEMENTO', 'the world went dark, and the memories scattered.<br/>you are the last light left.', 'begin');
  resize();
  requestAnimationFrame(loop);
})();
