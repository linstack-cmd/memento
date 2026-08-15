// TETHER — game/audio.js
// 100% procedural WebAudio. No assets. Autoplay-safe (context created/resumed
// only on the first user gesture), mute persisted, every call guarded so a
// failure can never break the game.

import { mulberry32 } from '../core/rng.js';

export function createAudio(getSave) {
  let ctx = null;
  let master = null;
  let muted = getSave().muted;
  let ambientNodes = null;
  let ambientTimer = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(ctx.destination);
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  // Called from any user gesture; safe to call repeatedly.
  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!ambientNodes) startAmbient();
  }

  function setMuted(m) {
    muted = m;
    if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05);
  }
  function isMuted() { return muted; }

  // -------------------------------------------------------------------------
  // One-shot SFX
  // -------------------------------------------------------------------------
  function tone({ freq = 440, end = freq, dur = 0.2, type = 'sine', gain = 0.2, when = 0, glide = 'exp' }) {
    if (!ensure() || !ctx) return;
    try {
      const t0 = ctx.currentTime + when;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (glide === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, end), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(end, t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(master);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
    } catch { /* guarded */ }
  }

  function noise({ dur = 0.15, gain = 0.1, freq = 1200, when = 0 }) {
    if (!ensure() || !ctx) return;
    try {
      const t0 = ctx.currentTime + when;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter); filter.connect(g); g.connect(master);
      src.start(t0);
    } catch { /* guarded */ }
  }

  const sfx = {
    jump: () => { tone({ freq: 320, end: 620, dur: 0.14, type: 'triangle', gain: 0.18 }); },
    doubleJump: () => { tone({ freq: 420, end: 840, dur: 0.16, type: 'triangle', gain: 0.2 }); noise({ dur: 0.08, gain: 0.05, freq: 2400 }); },
    land: () => { noise({ dur: 0.06, gain: 0.06, freq: 500 }); },
    tetherPlace: () => { tone({ freq: 700, end: 1100, dur: 0.2, type: 'sine', gain: 0.16 }); tone({ freq: 1400, end: 1400, dur: 0.3, type: 'sine', gain: 0.08, when: 0.05 }); },
    tetherRecall: () => { tone({ freq: 1100, end: 260, dur: 0.35, type: 'sine', gain: 0.22 }); noise({ dur: 0.25, gain: 0.08, freq: 3200 }); },
    mote: () => { tone({ freq: 880, end: 1760, dur: 0.22, type: 'sine', gain: 0.2 }); tone({ freq: 1320, end: 2200, dur: 0.2, type: 'sine', gain: 0.12, when: 0.06 }); },
    lantern: () => { tone({ freq: 520, end: 1040, dur: 0.3, type: 'triangle', gain: 0.18 }); tone({ freq: 780, end: 1560, dur: 0.3, type: 'sine', gain: 0.1, when: 0.08 }); },
    gateOpen: () => { tone({ freq: 220, end: 440, dur: 0.4, type: 'sawtooth', gain: 0.1 }); tone({ freq: 440, end: 880, dur: 0.5, type: 'sine', gain: 0.12, when: 0.2 }); },
    death: () => { tone({ freq: 300, end: 70, dur: 0.5, type: 'sawtooth', gain: 0.2 }); noise({ dur: 0.4, gain: 0.1, freq: 800 }); },
    win: () => {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, end: f, dur: 0.35, type: 'sine', gain: 0.18, when: i * 0.14 }));
    },
  };

  // -------------------------------------------------------------------------
  // Seeded ambient bed (per level audioSeed)
  // -------------------------------------------------------------------------
  function stopAmbient() {
    if (ambientNodes) {
      try { ambientNodes.forEach((n) => { try { n.stop(); } catch { /* */ } }); } catch { /* */ }
      ambientNodes = null;
    }
    if (ambientTimer) { clearTimeout(ambientTimer); ambientTimer = null; }
  }

  function startAmbient(seed = 7) {
    if (!ensure() || !ctx) return;
    stopAmbient();
    const rng = mulberry32(seed);
    const notes = [0, 2, 4, 5, 7, 9, 11, 12].map((s) => 220 * Math.pow(2, s / 12));
    ambientNodes = [];

    // warm pad
    try {
      const pad = ctx.createOscillator();
      const pad2 = ctx.createOscillator();
      const g = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 700;
      pad.type = 'sawtooth'; pad.frequency.value = notes[0];
      pad2.type = 'sawtooth'; pad2.frequency.value = notes[2];
      g.gain.value = 0.015;
      pad.connect(filter); pad2.connect(filter); filter.connect(g); g.connect(master);
      pad.start(); pad2.start();
      ambientNodes.push(pad, pad2);
    } catch { /* guarded */ }

    // sparse plucked arpeggios, lookahead-scheduled
    let nextTime = ctx.currentTime + 0.1;
    const schedule = () => {
      if (!ctx) return;
      while (nextTime < ctx.currentTime + 1.2) {
        if (rng() < 0.28) {
          const note = notes[Math.floor(rng() * notes.length)];
          tone({ freq: note, end: note, dur: 0.9, type: 'triangle', gain: 0.035, when: nextTime - ctx.currentTime });
        }
        nextTime += 0.32 + rng() * 0.5;
      }
      ambientTimer = setTimeout(schedule, 300);
    };
    schedule();
  }

  function setLevelAmbient(seed) {
    if (ctx) startAmbient(seed);
  }

  return { unlock, setMuted, isMuted, sfx, startAmbient, setLevelAmbient };
}
