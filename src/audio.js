// Procedural sound effects via the Web Audio API — no samples needed.
import { rand, clamp } from './physics.js';

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.lastClank = 0;
    this.lastHit = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    // open courtyard: a short, airy tail
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.6, 3.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.2;
    this.reverb.connect(this.wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(this.reverb);

    // white noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startWhoosh();
    this.startAmbience();
    if (this.rainWanted) this.setRain(true);
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    if (!loop) s.loopStart = 0;
    return s;
  }

  env(gainNode, t, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Metal on metal: inharmonic partials + bright noise transient. */
  clank(intensity = 1, pitch = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastClank < 0.03) return;
    this.lastClank = t;
    const I = clamp(intensity, 0.08, 1.4);
    const base = rand(620, 980) * pitch;
    const ratios = [1, 2.32, 4.25, 6.63, 9.38];
    ratios.forEach((r, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = base * r * rand(0.985, 1.015);
      const g = ctx.createGain();
      this.env(g, t, 0.22 * I / (1 + i * 0.6), 0.002, rand(0.35, 1.1) / (1 + i * 0.35));
      o.connect(g).connect(this.bus);
      o.start(t); o.stop(t + 1.4);
    });
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass'; bp.frequency.value = 2500;
    const g = ctx.createGain();
    this.env(g, t, 0.5 * I, 0.001, 0.06);
    n.connect(bp).connect(g).connect(this.bus);
    n.start(t, Math.random()); n.stop(t + 0.1);
  }

  /** Weapon into a body: dull thump + muffled rattle of lacquered plates (+ crunch for blunt). */
  hit(intensity = 1, blunt = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastHit < 0.025) return;
    this.lastHit = t;
    const I = clamp(intensity, 0.1, 1.5);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(blunt ? 120 : 150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const g = ctx.createGain();
    this.env(g, t, 0.9 * I, 0.003, 0.22);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.3);

    const n = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = blunt ? 900 : 1700;
    const g2 = ctx.createGain();
    this.env(g2, t, 0.7 * I, 0.002, blunt ? 0.18 : 0.12);
    n.connect(lp).connect(g2).connect(this.bus);
    n.start(t, Math.random()); n.stop(t + 0.3);
    this.clank(0.35 * I, 0.55);
  }

  wood(intensity = 1, crack = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const I = clamp(intensity, 0.1, 1.5);
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = crack ? 1400 : 520; bp.Q.value = 1.6;
    const g = ctx.createGain();
    this.env(g, t, 1.0 * I, 0.002, crack ? 0.35 : 0.14);
    n.connect(bp).connect(g).connect(this.bus);
    n.start(t, Math.random()); n.stop(t + 0.5);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(crack ? 260 : 190, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.12);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.5 * I, 0.002, 0.12);
    o.connect(g2).connect(this.bus);
    o.start(t); o.stop(t + 0.2);
  }

  /** Wet, tearing cut for dismemberment. */
  slash() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.25);
    const g = ctx.createGain();
    this.env(g, t, 1.1, 0.004, 0.3);
    n.connect(bp).connect(g).connect(this.bus);
    n.start(t, Math.random()); n.stop(t + 0.4);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const g2 = ctx.createGain();
    this.env(g2, t, 1.0, 0.004, 0.4);
    o.connect(g2).connect(this.bus);
    o.start(t); o.stop(t + 0.5);
  }

  /** Short cloth/air rush for dashes. */
  whooshBurst(intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    const g = ctx.createGain();
    this.env(g, t, 0.45 * intensity, 0.03, 0.22);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t, Math.random()); n.stop(t + 0.35);
  }

  thud(intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const I = clamp(intensity, 0.1, 1.5);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const g = ctx.createGain();
    this.env(g, t, 0.9 * I, 0.004, 0.35);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.45);
    this.clank(0.25 * I, 0.45);
  }

  // continuous blade whoosh, driven by the player's tip speed
  startWhoosh() {
    const ctx = this.ctx;
    const n = this.noiseSrc(true);
    this.whooshF = ctx.createBiquadFilter();
    this.whooshF.type = 'bandpass'; this.whooshF.Q.value = 1.2; this.whooshF.frequency.value = 400;
    this.whooshG = ctx.createGain();
    this.whooshG.gain.value = 0;
    n.connect(this.whooshF).connect(this.whooshG).connect(this.master);
    n.start();
  }

  setWhoosh(speed, heavy = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = clamp((speed - 4) / 14, 0, 1);
    this.whooshG.gain.setTargetAtTime(v * v * 0.55, t, 0.03);
    this.whooshF.frequency.setTargetAtTime((heavy ? 220 : 320) + v * (heavy ? 500 : 900), t, 0.03);
  }

  startAmbience() {
    const ctx = this.ctx;
    // low wind
    const n = this.noiseSrc(true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg).connect(g.gain);
    n.connect(lp).connect(g).connect(this.master);
    n.start(); lfo.start();
    // evening crickets: short trains of high chirps
    const cricket = () => {
      const t = ctx.currentTime;
      const f = rand(3900, 4700), n = Math.floor(rand(3, 7));
      for (let i = 0; i < n; i++) {
        const o = ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const cg = ctx.createGain();
        this.env(cg, t + i * 0.055, rand(0.006, 0.014), 0.008, 0.03);
        o.connect(cg).connect(this.master);
        o.start(t + i * 0.055); o.stop(t + i * 0.055 + 0.06);
      }
      setTimeout(cricket, rand(250, 1600));
    };
    cricket();
    this.music = true;
    this.pluckLoop();
  }

  /** Sparse koto-like notes on the in-sen scale. Toggle with `music`. */
  pluckLoop() {
    const scale = [146.83, 155.56, 196.0, 220.0, 261.63, 293.66, 311.13, 392.0, 440.0];
    const step = () => {
      if (this.music && this.ctx.state === 'running') {
        const n = Math.random() < 0.3 ? 2 : 1;
        for (let i = 0; i < n; i++) this.pluck(scale[Math.floor(Math.random() * scale.length)], this.ctx.currentTime + i * rand(0.18, 0.4));
      }
      setTimeout(step, rand(1400, 4200));
    };
    setTimeout(step, 1500);
  }

  pluck(freq, t) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.env(g, t, 0.09, 0.004, 1.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 1.2);
    for (const [mul, type, amp] of [[1, 'triangle', 1], [2, 'sine', 0.35], [3.01, 'sine', 0.12]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq * mul * 1.012, t);
      o.frequency.exponentialRampToValueAtTime(freq * mul, t + 0.08);   // slight bend, like a pressed string
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(lp);
      o.start(t); o.stop(t + 2);
    }
    lp.connect(g).connect(this.bus);
  }

  /** Perfect deflection: a bright, ringing "kin!". */
  deflect() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [f, a, d] of [[2350, 0.3, 0.7], [3520, 0.2, 0.5], [5210, 0.1, 0.3]]) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f * rand(0.99, 1.01);
      const g = ctx.createGain();
      this.env(g, t, a, 0.001, d);
      o.connect(g).connect(this.bus);
      o.start(t); o.stop(t + d + 0.1);
    }
    this.lastClank = 0;
    this.clank(1.1, 1.5);
  }

  /** Deep drum hit: kills, new waves. */
  taiko(intensity = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.5);
    const g = ctx.createGain();
    this.env(g, t, 1.0 * intensity, 0.004, 0.9);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 1.1);
    const n = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500;
    const g2 = ctx.createGain();
    this.env(g2, t, 0.5 * intensity, 0.002, 0.08);
    n.connect(lp).connect(g2).connect(this.bus);
    n.start(t, Math.random()); n.stop(t + 0.15);
  }

  /** Soft click for lock-on. */
  /** Steady rain on gravel and roof tiles. */
  setRain(on) {
    if (!this.ctx) { this.rainWanted = on; return; }
    if (!this.rainG) {
      const ctx = this.ctx, n = this.noiseSrc(true);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
      this.rainG = ctx.createGain();
      this.rainG.gain.value = 0;
      n.connect(hp).connect(lp).connect(this.rainG).connect(this.master);
      n.start();
    }
    this.rainG.gain.setTargetAtTime(on ? 0.11 : 0, this.ctx.currentTime, 0.6);
  }

  tick() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = 1250;
    const g = ctx.createGain();
    this.env(g, t, 0.12, 0.002, 0.07);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }
}
