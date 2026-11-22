// Procedural sound and music via the Web Audio API — everything is synthesised, no samples.
//
// Signal path:   sfx bus ─┬────────────────┐
//                         └─► yard reverb ─┤
//                music ───┴────────────────┼─► pre ─► compressor ─► limiter ─► soft clip ─► volume ─► out
//                ambience (wind, rain, blade air) ─┘
//
// Every public method is a no-op while there is no running AudioContext, one-shots are rate-limited
// per kind and capped in number, and the score is scheduled a little ahead on the audio clock.
import { rand, clamp } from './physics.js';

const MAX_VOICES = 40;          // one-shots sounding at once (each is a handful of nodes)
const MAX_MINOR = 24;           // ... of which footsteps, breaths and the like may only fill this much
const MUSIC_GAIN = 0.45;

// in-sen on D: D Eb G A C
const KOTO = [146.83, 155.56, 196.0, 220.0, 261.63, 293.66, 311.13, 392.0, 440.0, 523.25, 587.33];
// two-bar koto motifs: [sixteenth 0..31, index into KOTO, loudness]
const MOTIFS = [
  [[0, 5, 1], [4, 8, 0.8], [6, 7, 0.6], [8, 6, 0.8], [12, 5, 0.9], [20, 3, 0.7], [24, 5, 0.9]],
  [[0, 8, 1], [2, 9, 0.6], [4, 10, 0.9], [8, 8, 0.7], [12, 7, 0.7], [16, 6, 0.9], [18, 5, 0.7], [24, 3, 0.9]],
  [[0, 3, 0.9], [2, 5, 0.7], [4, 6, 1], [6, 5, 0.6], [8, 3, 0.8], [16, 7, 0.8], [20, 8, 0.9], [24, 5, 1]],
  [[0, 10, 1], [4, 9, 0.7], [6, 8, 0.7], [8, 7, 0.9], [12, 8, 0.6], [16, 6, 0.9], [20, 5, 0.8], [28, 3, 0.8]],
  [[0, 5, 0.9], [3, 5, 0.5], [6, 6, 0.9], [8, 8, 1], [14, 7, 0.6], [16, 8, 0.8], [22, 10, 0.7], [24, 8, 0.9]],
  [[0, 0, 1], [4, 3, 0.8], [8, 5, 0.9], [10, 6, 0.7], [12, 5, 0.8], [16, 4, 0.7], [20, 3, 0.9], [24, 0, 1]],
];
// two-bar flute phrases: [sixteenth, Hz, length in sixteenths]
const FLUTE = [
  [[0, 440.0, 10], [12, 523.25, 5], [18, 587.33, 12]],
  [[2, 587.33, 8], [11, 622.25, 3], [14, 587.33, 6], [22, 440.0, 9]],
  [[0, 392.0, 6], [7, 440.0, 14], [24, 293.66, 7]],
  [[4, 783.99, 5], [10, 622.25, 4], [14, 587.33, 14]],
  [[0, 293.66, 12], [14, 311.13, 4], [18, 392.0, 12]],
];
const DON = [
  [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0],
];
const KA = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1];
const SHIME = [0.8, 0.3, 0.5, 0.3];
const FILL = { 8: 0.5, 10: 0.6, 12: 0.7, 13: 0.8, 14: 0.9, 15: 1 };
// the driving low string under a fight, in eighths
const OST = [
  [73.42, 146.83, 110.0, 146.83, 98.0, 146.83, 110.0, 130.81],
  [73.42, 146.83, 110.0, 146.83, 155.56, 146.83, 130.81, 110.0],
];
// free-bar modes of a steel blade
const BLADE = [1, 2.76, 5.4, 8.93, 13.34];
const BLADE_AMP = [1, 0.8, 0.6, 0.42, 0.3];
const BLADE_DEC = [1.1, 0.85, 0.55, 0.36, 0.22];

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.music = true;           // the score (N toggles it)
    this.volume = undefined;
    this.offline = false;        // rendering into an OfflineAudioContext (sanity checks)
    this.lead = 0;               // offline only: start one-shots this far into the buffer
    this.last = Object.create(null);
    this.ends = [];
    this.heat = 0;               // blades are meeting right now
    this.cmbTarget = 0;          // how much of a fight there is (0 calm .. 1 pitched battle)
    this.cmb = 0;
    this.duck = 1;
    this.track = new WeakMap();  // per fighter: what it was doing last frame
    this.breathT = 0;
    this.mu = { next: 0, step: 0, motif: 0, flute: 0, vary: null };
  }

  /** Called on user gestures: makes the context on the first one, wakes it on later ones. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume?.()?.catch?.(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try { ctx = new AC(); } catch { return; }
    this.attach(ctx);
  }

  /** Build the whole graph on a context (a real one, or an offline one for checks). */
  attach(ctx, offline = false) {
    this.ctx = ctx;
    this.offline = offline;
    this.ksCache = new Map();

    // output: volume last, so the clipper in front of it guarantees |out| <= 0.9 * volume
    this.master = ctx.createGain();
    this.master.gain.value = 0.9 * (this.volume ?? 1);
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < 1025; i++) { const x = i / 512 - 1; curve[i] = 1.5 * x - 0.5 * x * x * x; }
    clip.curve = curve;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 2.5; comp.attack.value = 0.006; comp.release.value = 0.22;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -7; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.09;
    this.pre = ctx.createGain();
    this.pre.gain.value = 0.4;
    this.pre.connect(comp).connect(lim).connect(clip).connect(this.master).connect(ctx.destination);

    // the yard: a few early echoes off the walls and a short, darkening tail
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.25, 0.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.3;
    this.reverb.connect(this.wet).connect(this.pre);
    this.bus = ctx.createGain();                 // sound effects
    this.bus.connect(this.pre);
    this.bus.connect(this.reverb);
    this.amb = ctx.createGain();                 // steady beds: dry
    this.amb.connect(this.pre);
    this.mus = ctx.createGain();                 // the score
    this.mus.gain.value = 0;
    this.musLvl = 0;
    this.mus.connect(this.pre);
    const send = ctx.createGain();
    send.gain.value = 1.5;
    this.mus.connect(send).connect(this.reverb);

    // white noise
    const len = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.startWhoosh();
    this.startAmbience();
    this.startDrone();
    if (this.rainWanted) this.setRain(true);
    this.pumpAt = ctx.currentTime;
    this.cricketAt = ctx.currentTime + 1;
    this.mu.next = 0;
    if (!offline) this.timer = setInterval(() => { try { this.pump(); } catch { /* never let the clock die */ } }, 70);
  }

  /** True when sound can actually be made right now. */
  ready() {
    const c = this.ctx;
    return !!c && (c.state === 'running' || this.offline);
  }

  /**
   * Ask for a one-shot: the start time, or null when this kind just played, too much is sounding
   * already, or there is no running context.
   */
  begin(key, gap, dur, minor = false) {
    if (!this.ready()) return null;
    const t = this.ctx.currentTime, ends = this.ends;
    const was = this.last[key];
    if (was !== undefined && t - was < gap && t >= was) return null;
    let n = 0;
    for (let i = 0; i < ends.length; i++) if (ends[i] > t) ends[n++] = ends[i];
    ends.length = n;
    if (n >= (minor ? MAX_MINOR : MAX_VOICES)) return null;
    this.last[key] = t;
    ends.push(t + dur);
    return t + this.lead;
  }

  makeImpulse(seconds, tau) {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const pre = Math.floor(sr * 0.012);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const a = 0.07 + 0.6 * Math.exp(-t * 4);            // the tail loses its top as it dies
        lp += a * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-t / tau) * (0.4 + 0.6 * Math.min(1, t / 0.05));
      }
      // walls at different distances, not the same left and right
      for (let k = 0; k < 6; k++) {
        const at = Math.floor(sr * (0.014 + k * 0.013 + Math.random() * 0.009));
        if (at < n) d[at] += (Math.random() < 0.5 ? -1 : 1) * 0.55 * Math.pow(0.72, k);
      }
      for (let i = n - 256; i < n; i++) d[i] *= (n - i) / 256;
    }
    return buf;
  }

  // ---------------------------------------------------------------- building blocks
  /** A stretch of noise starting at `t` (random place in the buffer, so no two are alike). */
  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    if (t !== undefined) { s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02); }
    return s;
  }

  osc(type, freq, t, stop) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t); o.stop(stop);
    return o;
  }

  filt(type, freq, q = 0.707) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  /** A gain node with a percussive envelope. */
  env(t, peak, attack, decay) {
    const node = this.ctx.createGain(), g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return node;
  }

  /** A falling sine: the body of every thump. */
  thump(t, f0, f1, fall, peak, decay, out) {
    const o = this.osc('sine', f0, t, t + decay + 0.06);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + fall);
    o.connect(this.env(t, peak, 0.004, decay)).connect(out);
  }

  /** A burst of filtered noise. */
  burst(t, type, freq, q, peak, attack, decay, out) {
    const f = this.filt(type, freq, q);
    this.noiseSrc(t, attack + decay).connect(f).connect(this.env(t, peak, attack, decay)).connect(out);
    return f;
  }

  /** A few short ticks of filtered noise: plates rattling, gravel, splinters, cloth. */
  grains(t, n, gapLo, gapHi, amp, dec, type, freq, q, out) {
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    let ti = t;
    for (let i = 0; i < n; i++) {
      g.gain.setValueAtTime(Math.max(0.0002, amp * rand(0.6, 1) * (1 - i / (n + 1))), ti);
      g.gain.exponentialRampToValueAtTime(0.0001, ti + dec);
      ti += dec + rand(gapLo, gapHi);
    }
    this.noiseSrc(t, ti - t).connect(this.filt(type, freq, q)).connect(g).connect(out);
  }

  /** Where a sound goes: the effects bus, through a panner when it comes from one side. */
  panned(pan) {
    const ctx = this.ctx;
    if (!pan || Math.abs(pan) < 0.06 || !ctx.createStereoPanner) return this.bus;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(this.bus);
    return p;
  }

  // ---------------------------------------------------------------- steel, flesh, wood
  /**
   * Metal on metal. `pitch` also says how freely the steel rings: 1.1 and up is edge on edge, around
   * 0.9 a blade stopped by a guard, below that armour and heavy dull things.
   */
  clank(intensity = 1, pitch = 1) {
    const I = clamp(intensity, 0.08, 1.4);
    const damp = clamp((1.05 - pitch) / 0.5, 0, 1);
    const ring = (0.25 + 0.75 * Math.min(1, I)) * (1 - 0.72 * damp);
    const t = this.begin('clank', 0.045, ring + 0.15);
    if (t === null) return;
    this.heat = Math.min(1, this.heat + 0.1 + 0.1 * I);
    const base = rand(760, 1120) * pitch;
    let out = this.bus;
    if (damp > 0.05) { out = this.filt('lowpass', 9000 - 6500 * damp); out.connect(this.bus); }
    const n = I < 0.25 || damp > 0.6 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const f = base * BLADE[i] * rand(0.985, 1.015);
      if (f > 15000) break;
      const dec = ring * rand(0.7, 1.25) * BLADE_DEC[i];
      const twin = i < 2 && damp < 0.5 && I > 0.3;          // two close partials beat: the shimmer of a blade
      const g = this.env(t, 0.2 * I * BLADE_AMP[i] * (twin ? 0.62 : 1), 0.0015, dec);
      g.connect(out);
      this.osc('sine', f, t, t + dec + 0.05).connect(g);
      if (twin) this.osc('sine', f * rand(1.004, 1.011), t, t + dec + 0.05).connect(g);
    }
    // the strike itself: a hard, very short click
    this.burst(t, 'highpass', 3600 - 1800 * damp, 0.7, 0.55 * I, 0.0008, 0.03 + 0.03 * (1 - damp), out);
    if (damp > 0.3) this.thump(t, rand(160, 190), 90, 0.07, 0.32 * I * damp, 0.09, this.bus);
  }

  /**
   * A cut stopped on a guard: not the free ring of two edges meeting, but steel held in two pairs of hands. The bite
   * of the edges, both blades sounding short and at their own pitch, the edge grinding down the other, the jolt in the arms.
   */
  block(intensity = 1, heavy = false) {
    const t = this.begin('block', 0.05, 0.5);
    if (t === null) return;
    const I = clamp(intensity, 0.2, 1.4), bus = this.bus, low = heavy ? 0.62 : 1;
    this.heat = Math.min(1, this.heat + 0.1 + 0.1 * I);
    this.burst(t, 'highpass', 5200 * low, 0.7, 0.75 * I, 0.0005, 0.012, bus);
    for (const base of [rand(1250, 1650) * low, rand(1900, 2500) * low]) {
      for (let i = 0; i < 4; i++) {
        const f = base * BLADE[i] * rand(0.99, 1.01);
        if (f > 14000) break;
        const dec = (0.13 + 0.09 * I) * BLADE_DEC[i];
        const o = this.osc('sine', f, t, t + dec + 0.05);
        o.frequency.setValueAtTime(f * 1.014, t);                       // struck hard, a bar sounds a hair sharp at first
        o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
        o.connect(this.env(t, 0.1 * I * BLADE_AMP[i], 0.001, dec)).connect(bus);
      }
    }
    const sc = this.burst(t + 0.008, 'bandpass', 6500, 3, 0.2 * I, 0.004, 0.08 + 0.05 * I, bus);
    sc.frequency.setValueAtTime(rand(6000, 7800) * low, t + 0.008);
    sc.frequency.exponentialRampToValueAtTime(rand(2600, 3400) * low, t + 0.13);
    this.thump(t, heavy ? 110 : 140, 75, 0.05, (heavy ? 0.4 : 0.24) * I, 0.07, bus);
  }

  /** A blade leaving its scabbard (`out`) or going home into it: steel sliding along wood, and the click of the guard on the mouth. */
  scabbard(out = true) {
    const t = this.begin('scabbard', 0.2, 0.45, true);
    if (t === null) return;
    const bus = this.bus, len = out ? 0.2 : 0.3;
    const s = this.burst(t, 'bandpass', 3000, 2.2, out ? 0.2 : 0.13, len * 0.5, len * 0.6, bus);
    s.frequency.setValueAtTime(out ? rand(2200, 2700) : rand(5200, 6000), t);
    s.frequency.exponentialRampToValueAtTime(out ? rand(6500, 8000) : rand(2000, 2500), t + len);
    if (out) { const f = rand(2900, 3500); this.osc('sine', f, t + len * 0.8, t + len + 0.5).connect(this.env(t + len * 0.8, 0.035, 0.004, 0.4)).connect(bus); }
    else { this.burst(t + len + 0.03, 'bandpass', 1400, 2, 0.22, 0.0008, 0.02, bus); this.thump(t + len + 0.03, 210, 120, 0.02, 0.12, 0.03, bus); }
  }

  /** Weapon into a body: wet low thump, the smack, plates rattling (duller and heavier when blunt). */
  hit(intensity = 1, blunt = false, armored = false) {
    const t = this.begin('hit', 0.03, 0.35);
    if (t === null) return;
    const I = clamp(intensity, 0.1, 1.5), bus = this.bus;
    this.thump(t, rand(120, 150) * (blunt ? 0.8 : 1), 42, 0.16, 0.8 * I, 0.2, bus);
    this.burst(t, 'lowpass', blunt ? 700 : 1300, 0.7, 0.55 * I, 0.002, blunt ? 0.16 : 0.1, bus);
    // the wet part: a narrow band sliding down, a hair late
    const w = this.burst(t + 0.012, 'bandpass', 2200, 2.5, 0.34 * I * (blunt ? 0.5 : 1), 0.006, 0.11, bus);
    w.frequency.setValueAtTime(rand(1900, 2500), t + 0.012);
    w.frequency.exponentialRampToValueAtTime(rand(450, 600), t + 0.13);
    this.grains(t + 0.008, 2, 0.012, 0.03, 0.1 * I, 0.016, 'bandpass', rand(1400, 2600), 3, bus);
    if (blunt) this.grains(t + 0.004, 2, 0.01, 0.025, 0.2 * I, 0.02, 'bandpass', rand(700, 1000), 2, bus);
    if (armored) {
      // plates and lacing take part of it: a short, dull ring and the rattle of the rows against each other
      const f = rand(1500, 2300);
      for (const [m, a, d] of [[1, 0.1, 0.07], [1.83, 0.06, 0.05], [2.9, 0.035, 0.035]]) this.osc('sine', f * m, t, t + d + 0.05).connect(this.env(t, a * I, 0.001, d)).connect(bus);
      this.grains(t + 0.015, 4, 0.01, 0.03, 0.14 * I, 0.014, 'bandpass', rand(2600, 3800), 4, bus);
    } else if (!blunt) {
      // cloth and flesh: the slap of it, and cloth tearing
      this.burst(t, 'bandpass', rand(700, 950), 1.2, 0.3 * I, 0.002, 0.06, bus);
      if (I > 0.5) this.grains(t + 0.01, 3, 0.008, 0.02, 0.1 * I, 0.02, 'highpass', 3200, 0.7, bus);
    }
    this.heat = Math.min(1, this.heat + 0.15);
  }

  /** A bone giving way: a dry crack, a second smaller one, and the dull knock under it. */
  bone(intensity = 1) {
    const t = this.begin('bone', 0.12, 0.25);
    if (t === null) return;
    const I = clamp(intensity, 0.2, 1.3), bus = this.bus;
    this.burst(t, 'highpass', 1800, 0.7, 0.75 * I, 0.0006, 0.022, bus);
    this.burst(t + rand(0.028, 0.05), 'bandpass', rand(2400, 3400), 2, 0.45 * I, 0.0006, 0.018, bus);
    for (const f of [rand(520, 640), rand(980, 1250)]) this.osc('sine', f, t, t + 0.08).connect(this.env(t, 0.22 * I, 0.001, 0.035)).connect(bus);
    this.thump(t, 150, 70, 0.05, 0.4 * I, 0.08, bus);
  }

  /** A weapon let go of, landing on stone: it rings, bounces, and lies still. */
  clatter(intensity = 1, heavy = false, pan = 0) {
    const t = this.begin('clatter', 0.25, 0.7, true);
    if (t === null) return;
    const I = clamp(intensity, 0.1, 1), out = this.panned(pan), base = (heavy ? rand(380, 520) : rand(900, 1300));
    let at = t + rand(0.18, 0.3), amp = 0.16 * I;
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 3; i++) {
        const f = base * BLADE[i] * rand(0.97, 1.03), dec = (heavy ? 0.12 : 0.22) * BLADE_DEC[i] * (1 - k * 0.2);
        this.osc('sine', f, at, at + dec + 0.05).connect(this.env(at, amp * BLADE_AMP[i], 0.001, dec)).connect(out);
      }
      this.burst(at, 'highpass', 3000, 0.7, amp * 1.6, 0.0006, 0.02, out);
      at += rand(0.09, 0.16) * (1 - k * 0.25); amp *= 0.5;
    }
  }

  wood(intensity = 1, crack = false) {
    const t = this.begin('wood', 0.03, crack ? 0.45 : 0.2);
    if (t === null) return;
    const I = clamp(intensity, 0.1, 1.5), bus = this.bus;
    const f0 = crack ? rand(240, 320) : rand(170, 230);
    [1, 2.71, 5.15].forEach((r, i) => {
      const dec = (crack ? 0.07 : 0.11) / (1 + i * 0.8);
      this.osc('sine', f0 * r * rand(0.97, 1.03), t, t + dec + 0.05).connect(this.env(t, 0.45 * I / (1 + i), 0.001, dec)).connect(bus);
    });
    this.burst(t, 'bandpass', crack ? rand(1500, 2100) : rand(500, 700), 1.4, 0.8 * I, 0.001, crack ? 0.05 : 0.09, bus);
    if (crack) this.grains(t + 0.03, 4, 0.02, 0.07, 0.3 * I, 0.02, 'highpass', 2000, 0.7, bus);
  }

  /** Wet, tearing cut for dismemberment. */
  slash() {
    const t = this.begin('slash', 0.05, 0.5);
    if (t === null) return;
    const ctx = this.ctx, bus = this.bus;
    const bp = this.filt('bandpass', 3600, 0.9);
    bp.frequency.setValueAtTime(rand(3400, 4200), t);
    bp.frequency.exponentialRampToValueAtTime(450, t + 0.22);
    // torn rather than hissed: the band is chopped at the rate of ripping cloth
    const am = ctx.createGain();
    am.gain.value = 0.65;
    const lg = ctx.createGain();
    lg.gain.value = 0.35;
    this.osc('square', rand(45, 70), t, t + 0.34).connect(lg).connect(am.gain);
    this.noiseSrc(t, 0.32).connect(bp).connect(this.env(t, 0.85, 0.004, 0.26)).connect(am).connect(bus);
    this.thump(t, 75, 32, 0.35, 0.75, 0.38, bus);
    this.grains(t + 0.08, 3, 0.03, 0.06, 0.22, 0.03, 'bandpass', rand(700, 1100), 4, bus);
  }

  /** Short cloth/air rush for dashes and big moves. */
  whooshBurst(intensity = 1) {
    const t = this.begin('wb', 0.04, 0.35);
    if (t === null) return;
    const I = clamp(intensity, 0.05, 1.5), bus = this.bus;
    const bp = this.burst(t, 'bandpass', 280, 1.3, 0.8 * I, 0.035, 0.24, bus);
    bp.frequency.setValueAtTime(rand(240, 320), t);
    bp.frequency.exponentialRampToValueAtTime(rand(1200, 1700), t + 0.11);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.26);
    this.grains(t + 0.02, 3, 0.02, 0.04, 0.3 * I, 0.03, 'lowpass', rand(600, 800), 0.7, bus);
  }

  /** A body or something heavy going down. */
  thud(intensity = 1) {
    const t = this.begin('thud', 0.04, 0.45);
    if (t === null) return;
    const I = clamp(intensity, 0.1, 1.5), bus = this.bus;
    this.thump(t, rand(80, 100), 34, 0.28, 0.8 * I, 0.34, bus);
    this.burst(t, 'lowpass', 280, 0.7, 0.6 * I, 0.004, 0.18, bus);
    this.grains(t + 0.01, 3, 0.012, 0.03, 0.11 * I, 0.016, 'bandpass', rand(1400, 2400), 3, bus);       // armour
    if (I > 0.5) this.grains(t + 0.03, 3, 0.02, 0.05, 0.1 * I, 0.03, 'bandpass', rand(2200, 3200), 1, bus);  // gravel
  }

  /** Perfect deflection: a bright, ringing "kin!". */
  deflect() {
    const t = this.begin('deflect', 0.06, 0.9);
    if (t === null) return;
    const k = rand(0.97, 1.03);
    for (const [f, a, d] of [[2350, 0.24, 0.8], [3520, 0.16, 0.55], [5210, 0.085, 0.35]]) {
      const g = this.env(t, a, 0.001, d);
      g.connect(this.bus);
      this.osc('sine', f * k, t, t + d + 0.05).connect(g);
      this.osc('sine', f * k * rand(1.003, 1.007), t, t + d + 0.05).connect(g);
    }
    this.last.clank = undefined;
    this.clank(1.1, 1.5);
  }

  /** Deep drum hit: kills, new waves. */
  taiko(intensity = 1) {
    const t = this.begin('taiko', 0.05, 0.9);
    if (t === null) return;
    this.drum('don', t, clamp(intensity, 0.05, 1.3), this.bus);
  }

  drum(kind, t, vel, out) {
    if (kind === 'don') {
      const f = rand(92, 104);
      this.thump(t, f, 48, 0.35, 0.9 * vel, 0.75, out);
      this.thump(t, f * 1.59, f * 1.1, 0.12, 0.28 * vel, 0.2, out);
      this.burst(t, 'lowpass', 900, 0.7, 0.42 * vel, 0.0015, 0.05, out);
    } else if (kind === 'ka') {                                    // stick on the rim
      for (const f of [820, 1310]) this.osc('sine', f * rand(0.97, 1.03), t, t + 0.08).connect(this.env(t, 0.16 * vel, 0.001, 0.035)).connect(out);
      this.burst(t, 'highpass', 2000, 0.7, 0.16 * vel, 0.0008, 0.014, out);
    } else {                                                       // shime: small and tight
      this.thump(t, rand(320, 345), 285, 0.05, 0.26 * vel, 0.09, out);
      this.burst(t, 'bandpass', 2500, 1, 0.18 * vel, 0.001, 0.045, out);
    }
  }

  /** The big bronze bell: a low strike tone with slow, slightly detuned partials that beat against each other. */
  bell(intensity = 1) {
    const t = this.begin('bell', 0.12, 5);
    if (t === null) return;
    const v = clamp(intensity, 0.05, 1), out = this.bus, f = 98;
    for (const [m, a, d] of [[1, 0.42, 5.2], [1.012, 0.26, 4.6], [2.0, 0.24, 3.6], [2.76, 0.17, 2.4], [4.07, 0.1, 1.6], [5.43, 0.06, 0.9]]) {
      this.osc('sine', f * m, t, t + d * (0.4 + 0.6 * v) + 0.1).connect(this.env(t, a * v, 0.006, d * (0.4 + 0.6 * v))).connect(out);
    }
    this.burst(t, 'bandpass', 640, 0.8, 0.3 * v, 0.002, 0.07, out);      // the beam meeting the bronze
    this.thump(t, 70, 44, 0.2, 0.3 * v, 0.5, out);
  }

  /** Soft click: lock-on, telegraphs, UI. */
  tick() {
    const t = this.begin('tick', 0.03, 0.1);
    if (t === null) return;
    const k = rand(0.96, 1.04);
    this.osc('triangle', 1180 * k, t, t + 0.1).connect(this.env(t, 0.11, 0.002, 0.06)).connect(this.bus);
    this.osc('sine', 2950 * k, t, t + 0.06).connect(this.env(t, 0.04, 0.001, 0.025)).connect(this.bus);
  }

  // ---------------------------------------------------------------- bodies: feet, breath, voice
  /** One foot coming down on gravel (splashier in the rain). */
  step(speed = 3, wet = false, level = 1, pan = 0, own = false) {
    const t = this.begin(own ? 'stepP' : 'step', own ? 0.09 : 0.05, 0.14, true);
    if (t === null) return;
    const a = level * clamp(0.25 + speed / 9, 0.25, 1) * (own ? 1.3 : 1);
    const out = this.panned(pan), src = this.noiseSrc(t, 0.16);
    src.connect(this.filt('lowpass', rand(160, 240))).connect(this.env(t, a, 0.004, 0.06)).connect(out);      // heel
    const g = this.ctx.createGain();                                                                          // then the stones
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setValueAtTime(a * 0.5, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    g.gain.setValueAtTime(a * rand(0.2, 0.36), t + rand(0.04, 0.055));
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(this.filt('bandpass', rand(1800, 3400), 0.8)).connect(g).connect(out);
    if (wet) src.connect(this.filt('highpass', 4500)).connect(this.env(t, a * 0.35, 0.008, 0.09)).connect(out);
  }

  /** Both feet back on the ground after a jump or a drop. */
  land(intensity = 1, pan = 0) {
    const t = this.begin('land', 0.06, 0.3);
    if (t === null) return;
    const I = clamp(intensity, 0.1, 1.4), out = this.panned(pan);
    this.thump(t, rand(100, 120), 45, 0.12, 0.55 * I, 0.16, out);
    this.burst(t, 'lowpass', 320, 0.7, 0.45 * I, 0.003, 0.1, out);
    this.grains(t + 0.006, 3, 0.012, 0.035, 0.16 * I, 0.028, 'bandpass', rand(2000, 3200), 0.9, out);
    this.grains(t + 0.015, 2, 0.012, 0.03, 0.06 * I, 0.016, 'bandpass', rand(1500, 2400), 3, out);
  }

  /** Dodge step (a quick flick of cloth) or roll (longer, with the shoulder meeting the ground). */
  swish(roll = false, level = 1, pan = 0) {
    const t = this.begin('swish', 0.08, roll ? 0.45 : 0.25, true);
    if (t === null) return;
    const out = this.panned(pan), len = roll ? 0.34 : 0.17;
    const bp = this.burst(t, 'bandpass', 400, 1.8, 0.45 * level, len * 0.3, len * 0.8, out);
    bp.frequency.setValueAtTime(rand(350, 450), t);
    bp.frequency.exponentialRampToValueAtTime(rand(1900, 2500), t + len * 0.4);
    bp.frequency.exponentialRampToValueAtTime(600, t + len);
    if (roll) {
      this.thump(t + 0.14, 95, 50, 0.1, 0.3 * level, 0.12, out);
      this.grains(t + 0.1, 4, 0.02, 0.05, 0.1 * level, 0.03, 'bandpass', rand(1800, 2800), 0.9, out);
    }
  }

  /**
   * A short voiced sound: 'effort' (the shout that goes with a heavy cut) or 'pain' (the grunt of
   * someone hit hard). A buzzing source and some breath through three formants; kept low in the mix.
   */
  voice(kind = 'effort', intensity = 1, pan = 0) {
    const pain = kind === 'pain';
    const dur = pain ? rand(0.18, 0.3) : rand(0.14, 0.22);
    const t = this.begin('voice', 0.14, dur + 0.1, true);
    if (t === null) return;
    const ctx = this.ctx, I = clamp(intensity, 0.2, 1.2), out = this.panned(pan);
    const f0 = pain ? rand(85, 120) : rand(100, 145);
    const o = this.osc('sawtooth', f0, t, t + dur + 0.08);
    o.frequency.setValueAtTime(f0 * (pain ? 1.2 : 1), t);
    if (!pain) o.frequency.linearRampToValueAtTime(f0 * 1.3, t + 0.04);
    o.frequency.exponentialRampToValueAtTime(f0 * (pain ? 0.7 : 0.85), t + dur);
    const mix = ctx.createGain();
    o.connect(mix);
    const ng = ctx.createGain();
    ng.gain.value = pain ? 0.5 : 0.7;
    this.noiseSrc(t, dur + 0.06).connect(ng).connect(mix);
    const e = this.env(t, 0.8 * I, 0.02, dur);
    e.connect(out);
    const vowel = pain ? [[520, 1], [950, 0.6], [2400, 0.15]] : Math.random() < 0.5 ? [[780, 1], [1250, 0.6], [2600, 0.25]] : [[450, 1], [1900, 0.5], [2600, 0.3]];
    const shift = rand(0.92, 1.1);
    for (const [f, a] of vowel) {
      const g = ctx.createGain();
      g.gain.value = a;
      mix.connect(this.filt('bandpass', f * shift, 7)).connect(g).connect(e);
    }
  }

  /**
   * A human voice in a bad moment. `kind`: 'scream' (a limb gone, a deep wound), 'fall' (going over the edge: long,
   * fading), 'death' (the last sound, sinking), 'moan' (lying wounded), 'kiai' (the shout that goes with a blow).
   * `pitch` is the man's own voice (0.7 deep .. 1.3 high). Each kind is rate-limited, so a melee does not turn into a choir.
   */
  cry(kind = 'scream', { pitch = 1, level = 1, pan = 0 } = {}) {
    // (a voice made of oscillators soon sounds like a machine: these are mostly breath forced through the throat,
    // with only as much tone as a strained voice has, and they are short)
    const K = {
      scream: { gap: 1.2, dur: [0.28, 0.5], f: [165, 230], up: 1.3, end: 0.68, rough: [34, 60, 0.6], noise: 1.6, tone: 0.5, vow: [[760, 1], [1250, 0.7], [2700, 0.4]], amp: 0.34 },
      fall: { gap: 1.2, dur: [0.9, 1.3], f: [180, 240], up: 1.2, end: 0.62, rough: [28, 50, 0.45], noise: 1.2, tone: 0.6, vow: [[760, 1], [1200, 0.7], [2700, 0.3]], amp: 0.36 },
      death: { gap: 0.8, dur: [0.45, 0.8], f: [110, 150], up: 1.04, end: 0.55, rough: [16, 30, 0.7], noise: 2.0, tone: 0.3, vow: [[520, 1], [950, 0.5], [2300, 0.2]], amp: 0.3 },
      moan: { gap: 2.6, dur: [0.6, 1.0], f: [95, 130], up: 1.05, end: 0.85, rough: [8, 14, 0.3], noise: 1.1, tone: 0.45, vow: [[450, 1], [900, 0.4], [2200, 0.12]], amp: 0.22 },
      kiai: { gap: 0.8, dur: [0.12, 0.2], f: [150, 200], up: 1.2, end: 1.05, rough: [40, 70, 0.5], noise: 1.8, tone: 0.45, vow: [[700, 1], [1150, 0.6], [2500, 0.35]], amp: 0.26 },
    }[kind];
    if (!K) return false;
    const dur = rand(K.dur[0], K.dur[1]);
    const t = this.begin('cry-' + kind, K.gap, dur + 0.15, kind === 'moan');
    if (t === null) return false;
    const ctx = this.ctx, p = clamp(pitch, 0.6, 1.4), L = clamp(level, 0, 1.2), out = this.panned(pan);
    if (L < 0.02) return false;
    const f0 = rand(K.f[0], K.f[1]) * p, end = t + dur;
    // the cords: two saws a hair apart, the pitch thrown up at the start and sagging as the breath runs out
    const mix = ctx.createGain();
    for (const det of [1, 1.007]) {
      const o = this.osc('sawtooth', f0, t, end + 0.1), fr = o.frequency;
      fr.setValueAtTime(f0 * 0.85 * det, t);
      fr.linearRampToValueAtTime(f0 * K.up * det, t + Math.min(0.09, dur * 0.3));
      fr.exponentialRampToValueAtTime(f0 * K.end * det, end);
      // (no voice holds a pitch under strain: it wavers)
      const jl = ctx.createGain(); jl.gain.value = f0 * 0.03;
      this.osc('sine', rand(5, 8), t, end + 0.1).connect(jl).connect(fr);
      const tg = ctx.createGain(); tg.gain.value = K.tone;
      o.connect(tg).connect(mix);
    }
    const ng = ctx.createGain(); ng.gain.value = K.noise;
    this.noiseSrc(t, dur + 0.1).connect(ng).connect(mix);
    // the throat tearing at it: the loudness itself shakes
    const am = ctx.createGain(); am.gain.value = 1 - K.rough[2] * 0.5;
    const rl = ctx.createGain(); rl.gain.value = K.rough[2] * 0.5;
    this.osc('square', rand(K.rough[0], K.rough[1]), t, end + 0.1).connect(rl).connect(am.gain);
    const e = ctx.createGain(), g = e.gain, peak = K.amp * L;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + (kind === 'moan' ? 0.12 : 0.025));
    if (kind === 'fall') g.exponentialRampToValueAtTime(peak * 0.04, end);
    else { g.setValueAtTime(peak, t + dur * 0.55); g.exponentialRampToValueAtTime(0.0001, end); }
    g.setValueAtTime(0.0001, end + 0.02);
    const shift = rand(0.94, 1.08) * (0.9 + 0.1 * p);
    for (const [f, a] of K.vow) {
      const fg = ctx.createGain(); fg.gain.value = a;
      mix.connect(this.filt('bandpass', f * shift, 6)).connect(fg).connect(am);
    }
    am.connect(e).connect(out);
    if (kind === 'death') {       // the breath going out of him after the voice has gone
      const b = this.burst(end - 0.1, 'bandpass', 900, 1.1, 0.12 * L, 0.08, 0.5, out);
      b.frequency.setValueAtTime(1000, end - 0.1); b.frequency.exponentialRampToValueAtTime(420, end + 0.45);
    }
    return true;
  }

  /** One hard breath in and out; `tired` 0..1 sets how loud. */
  breath(tired = 1) {
    const t = this.begin('breath', 0.3, 0.8, true);
    if (t === null) return;
    const a = clamp(tired, 0, 1), out = this.bus;
    const i = this.burst(t, 'bandpass', 1700, 1.4, 0.12 * a, 0.14, 0.2, out);
    i.frequency.setValueAtTime(1500, t);
    i.frequency.linearRampToValueAtTime(2300, t + 0.3);
    const x = t + 0.36;
    const e = this.burst(x, 'bandpass', 1100, 1.2, 0.2 * a, 0.06, 0.3, out);
    e.frequency.setValueAtTime(rand(1050, 1250), x);
    e.frequency.exponentialRampToValueAtTime(650, x + 0.34);
  }

  /**
   * Once per frame: follows what the fighters' bodies do (steps, landings, dodges, the player's
   * breathing) and tells the score how much of a fight is going on.
   */
  update(dt, game) {
    if (!game) return;
    const halted = !!(game.paused || game.mainMenu);
    this.duck = game.mainMenu ? 0.5 : game.paused ? 0.3 : 1;
    if (halted) this.cmbTarget = 0;
    if (!this.ready() || halted || !(dt > 0)) return;
    const P = game.player, list = game.fighters;
    if (!P || !P.core || !list) return;
    const px = P.core.position.x, pz = P.core.position.z;
    const cam = game.camera?.matrixWorld?.elements;
    const rx = cam ? cam[0] : 1, rz = cam ? cam[2] : 0;
    const wet = (game.grip ?? 1) < 1;
    let foes = 0, near = 1e9;
    for (let i = 0; i < list.length; i++) {
      const k = list[i], b = k.core;
      if (!b) continue;
      const dx = b.position.x - px, dz = b.position.z - pz, d = Math.hypot(dx, dz);
      if (k.team !== P.team && !k.dead && k.state === 'active') { foes++; if (d < near) near = d; }
      if (d > 15 && !k.isPlayer) { this.track.delete(k); continue; }
      let s = this.track.get(k);
      const half = Math.floor(k.gaitPhase / Math.PI);          // one foot comes down every half cycle
      if (!s) { this.track.set(k, { half, air: !!k.airborne, dash: k.dashT || 0, vy: 0 }); continue; }
      if (k.state === 'active') {
        const level = k.isPlayer ? 1 : 1 / (1 + d * d * 0.03);
        const pan = k.isPlayer ? 0 : clamp((dx * rx + dz * rz) / Math.max(d, 1.5) * 0.8, -0.8, 0.8);
        if (half !== s.half && !k.airborne && !(k.dashT > 0) && !(k.rollT > 0) && !(k.slideT > 0) && !(k.mountH > 0) && !k.hang) {
          const sp = Math.hypot(b.velocity.x, b.velocity.z);
          if (sp > 0.6) this.step(sp, wet, level, pan, !!k.isPlayer);
        }
        if (s.air && !k.airborne) this.land(clamp(-s.vy / 9, 0.15, 1.3) * level, pan);
        if ((k.dashT || 0) > s.dash + 0.05) this.swish(k.rollT > 0, level, pan);
      }
      s.half = half; s.air = !!k.airborne; s.dash = k.dashT || 0; s.vy = b.velocity.y;
    }
    this.cmbTarget = foes ? clamp(0.4 + 0.07 * foes + (near < 7 ? 0.25 : near < 12 ? 0.1 : 0), 0, 1) : 0;

    // out of breath: the more tired, the faster and louder
    const tired = P.state === 'active' && !P.dead ? clamp(P.tired || 0, 0, 1) : 0;
    if (tired > 0.3) {
      this.breathT -= dt;
      if (this.breathT <= 0) { this.breath((tired - 0.2) / 0.8); this.breathT = 1.55 - 0.75 * tired; }
    } else this.breathT = 0.3;
  }

  // ---------------------------------------------------------------- steady beds
  // continuous blade air, driven by the player's tip speed
  startWhoosh() {
    const ctx = this.ctx, n = this.noiseSrc();
    this.whooshF = this.filt('bandpass', 400, 1.2);       // the body of the sound
    this.whooshG = ctx.createGain();
    this.whooshG.gain.value = 0;
    this.whooshA = this.filt('highpass', 3000);           // the thin hiss a fast edge adds on top
    this.whooshAG = ctx.createGain();
    this.whooshAG.gain.value = 0;
    n.connect(this.whooshF).connect(this.whooshG).connect(this.amb);
    n.connect(this.whooshA).connect(this.whooshAG).connect(this.amb);
    n.start();
    this.whV = 0;
  }

  setWhoosh(speed, heavy = false) {
    if (!this.ready()) return;
    const v = clamp((speed - 3.5) / 14, 0, 1);
    if (Math.abs(v - this.whV) < 0.012 && !(v === 0 && this.whV !== 0)) return;
    this.whV = v;
    const t = this.ctx.currentTime;
    this.whooshG.gain.setTargetAtTime(v * v * 0.3, t, 0.025);
    this.whooshF.frequency.setTargetAtTime((heavy ? 200 : 300) + v * (heavy ? 520 : 950), t, 0.025);
    this.whooshF.Q.setTargetAtTime(1.1 + v * 1.4, t, 0.05);
    this.whooshAG.gain.setTargetAtTime(v * v * v * (heavy ? 0.06 : 0.12), t, 0.02);
    this.whooshA.frequency.setTargetAtTime(2500 + v * 2500, t, 0.03);
  }

  startAmbience() {
    const ctx = this.ctx;
    // low wind, and a higher strand that comes and goes
    const n = this.noiseSrc();
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg).connect(g.gain);
    n.connect(this.filt('lowpass', 260)).connect(g).connect(this.amb);
    const g2 = ctx.createGain();
    g2.gain.value = 0.012;
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.113;
    const lg2 = ctx.createGain();
    lg2.gain.value = 0.01;
    lfo2.connect(lg2).connect(g2.gain);
    n.connect(this.filt('bandpass', 620, 0.8)).connect(g2).connect(this.amb);
    n.start(); lfo.start(); lfo2.start();
  }

  /** Evening crickets: a short train of high chirps (scheduled from pump()). */
  cricket(t) {
    const f = rand(3900, 4700), n = Math.floor(rand(3, 7)), a = rand(0.006, 0.014);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < n; i++) {
      g.gain.linearRampToValueAtTime(a, t + i * 0.055 + 0.008);
      g.gain.linearRampToValueAtTime(0.0001, t + i * 0.055 + 0.04);
      g.gain.setValueAtTime(0.0001, t + (i + 1) * 0.055);
    }
    this.osc('sine', f, t, t + n * 0.055 + 0.02).connect(g).connect(this.amb);
  }

  /** Steady rain on gravel and roof tiles. */
  setRain(on) {
    this.rainWanted = !!on;
    if (!this.ctx) return;
    if (!this.rainG) {
      if (!on) return;
      const ctx = this.ctx, n = this.noiseSrc();
      const hp = this.filt('highpass', 900), lp = this.filt('lowpass', 5200);
      this.rainG = ctx.createGain();
      this.rainG.gain.value = 0;
      n.connect(hp).connect(lp).connect(this.rainG).connect(this.amb);
      const roof = ctx.createGain();                       // the duller drumming on the tiles
      roof.gain.value = 0.55;
      n.connect(this.filt('bandpass', 340, 0.7)).connect(roof).connect(this.rainG);
      n.start();
    }
    const t = this.ctx.currentTime;
    this.rainG.gain.cancelScheduledValues(t);
    this.rainG.gain.setTargetAtTime(on ? 0.11 : 0, t, 0.6);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0.9 * v, t, 0.05);
    }
  }

  // ---------------------------------------------------------------- instruments
  /**
   * A plucked string, rendered once per pitch with a Karplus-Strong loop and then played as a buffer:
   * 'koto' rings long and round, 'sham' is the short, snappy string that drives a fight.
   */
  ks(freq, kind = 'koto') {
    const key = kind + Math.round(freq * 8);
    let e = this.ksCache.get(key);
    if (e) return e;
    if (this.ksCache.size > 80) this.ksCache.clear();
    const ctx = this.ctx, sr = ctx.sampleRate, sham = kind === 'sham';
    const s = sham ? 0.5 : clamp(0.5 + (freq - 150) / 1400, 0.5, 0.8);      // higher strings lose less top per turn
    const N = Math.max(4, Math.round(sr / freq + (1 - s)));
    const rate = freq * (N - (1 - s)) / sr;                                 // playback rate that puts it exactly in tune
    const T = sham ? 0.9 : clamp(520 / freq, 1.4, 2.6);
    const len = Math.floor(sr * T);
    const damp = Math.pow(10, -3 / (freq * T));
    const line = new Float32Array(N), x = new Float32Array(N);
    const bright = sham ? 0.85 : 0.55, p = Math.max(1, Math.floor(N * (sham ? 0.08 : 0.13)));
    let lp = 0, mean = 0;
    for (let i = 0; i < N; i++) { lp += bright * ((Math.random() * 2 - 1) - lp); x[i] = lp; }
    for (let i = 0; i < N; i++) { line[i] = x[i] - 0.9 * x[(i - p + N) % N]; mean += line[i]; }      // plucked near the bridge
    mean /= N;
    for (let i = 0; i < N; i++) line[i] -= mean;
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    let idx = 0, peak = 1e-6;
    for (let i = 0; i < len; i++) {
      const nx = idx + 1 === N ? 0 : idx + 1, y = line[idx];
      d[i] = y;
      if (y > peak) peak = y; else if (-y > peak) peak = -y;
      line[idx] = damp * (s * y + (1 - s) * line[nx]);
      idx = nx;
    }
    const fade = Math.floor(sr * 0.03), k = 0.9 / peak;
    for (let i = 0; i < len; i++) d[i] *= k * (i > len - fade ? (len - i) / fade : 1);
    e = { buf, rate };
    this.ksCache.set(key, e);
    return e;
  }

  /** Play a plucked string. opts: kind ('koto'|'sham'), dur (damp it after this long), bend (pressed string). */
  string(freq, t, vel, out, opts) {
    const ctx = this.ctx, kind = opts?.kind || 'koto', dur = opts?.dur;
    const { buf, rate } = this.ks(freq, kind);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const r = rate * rand(0.9985, 1.0015);
    if (opts?.bend) {
      s.playbackRate.setValueAtTime(r * 0.972, t);
      s.playbackRate.linearRampToValueAtTime(r, t + 0.14);
    } else s.playbackRate.value = r;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    const full = buf.duration / r;
    let stop = t + full;
    if (dur && dur + 0.25 < full) { g.gain.setTargetAtTime(0.0001, t + dur, 0.04); stop = t + dur + 0.25; }
    s.connect(this.filt('lowpass', 1800 + 7000 * Math.min(1, vel * 1.4))).connect(g).connect(out);     // soft notes are rounder
    s.start(t); s.stop(stop);
  }

  /** A single plucked note on the effects bus (bow strings and the like). */
  pluck(freq, t) {
    if (!this.ready() || !(freq > 20)) return;
    const now = this.ctx.currentTime;
    if (this.begin('pluck', 0.02, 1.2) === null) return;
    this.string(freq, Math.max(now, t ?? now), 0.32, this.bus);
  }

  /** Shakuhachi-like: a breathy tone that scoops up into the note, swells, and gains vibrato late. */
  flute(freq, t, dur, vel, out) {
    const ctx = this.ctx, end = t + dur;
    const tone = ctx.createGain(), g = tone.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(vel * 0.6, t + 0.09);
    g.linearRampToValueAtTime(vel, t + dur * 0.5);
    g.setTargetAtTime(0.0001, end - 0.12, 0.08);
    tone.connect(out);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + dur * 0.3);
    lg.gain.linearRampToValueAtTime(rand(10, 18), t + dur * 0.75);
    this.osc('sine', rand(4.4, 5.2), t, end + 0.5).connect(lg);
    const scoop = -rand(50, 110);
    for (const [mul, amp] of [[1, 1], [2, 0.3], [3, 0.1]]) {
      const o = this.osc('sine', freq * mul, t, end + 0.5);
      o.detune.setValueAtTime(scoop, t);
      o.detune.linearRampToValueAtTime(0, t + 0.11);
      o.detune.setTargetAtTime(-45, end - 0.1, 0.12);
      lg.connect(o.detune);
      const og = ctx.createGain();
      og.gain.value = amp * 0.75;
      o.connect(og).connect(tone);
    }
    // the breath: a chiff at the start, then air riding along
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(vel * 0.5, t + 0.03);
    bg.gain.setTargetAtTime(vel * 0.11, t + 0.04, 0.07);
    bg.gain.setTargetAtTime(0.0001, end - 0.1, 0.07);
    this.noiseSrc(t, dur + 0.4).connect(this.filt('bandpass', freq * 2.1, 0.9)).connect(bg).connect(out);
  }

  /** Low drone under everything: a fifth on D, breathing slowly. */
  startDrone() {
    const ctx = this.ctx;
    this.droneG = ctx.createGain();
    this.droneG.gain.value = 0.07;
    const lp = this.filt('lowpass', 420);
    lp.connect(this.droneG).connect(this.mus);
    for (const [f, type, a] of [[73.42, 'sine', 1], [73.42 * 1.004, 'triangle', 0.5], [110.0, 'sine', 0.3], [146.83 * 0.997, 'triangle', 0.22]]) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lg = ctx.createGain();
    lg.gain.value = 0.025;
    lfo.connect(lg).connect(this.droneG.gain);
    lfo.start();
  }

  // ---------------------------------------------------------------- the score
  /**
   * The clock of the score: schedules everything due within `horizon` seconds on the audio clock.
   * Runs from a timer; when the timer was held up (hidden tab) the missed stretch is skipped, not caught up.
   */
  pump(horizon = 0.4) {
    if (!this.ready()) return;
    const ctx = this.ctx, now = ctx.currentTime, m = this.mu;
    const dt = clamp(now - this.pumpAt, 0, 0.5);
    this.pumpAt = now;
    this.heat = Math.max(0, this.heat - dt * 0.2);
    const target = this.duck < 1 ? 0 : Math.max(this.cmbTarget, this.heat * 0.9);
    this.cmb += clamp(target - this.cmb, -dt * 0.22, dt * 0.7);
    const lvl = this.music ? this.duck * MUSIC_GAIN : 0;
    if (lvl !== this.musLvl) {
      this.musLvl = lvl;
      this.mus.gain.cancelScheduledValues(now);
      this.mus.gain.setTargetAtTime(lvl, now, 0.35);
    }
    if (this.cricketAt < now) this.cricketAt = now + 0.05;
    while (this.cricketAt < now + horizon) {
      if (!this.rainWanted) this.cricket(this.cricketAt);
      this.cricketAt += rand(0.3, 1.7);
    }
    if (!this.music) { m.next = 0; return; }
    if (m.next < now + 0.03) m.next = now + 0.08;
    while (m.next < now + horizon) {
      const sd = 15 / (80 + 30 * this.cmb);              // a sixteenth; the pulse quickens with the fight
      this.musicStep(m.step, m.next, sd);
      m.next += sd;
      m.step = (m.step + 1) & 127;
    }
  }

  /** One sixteenth of the eight-bar form: koto statement, flute answer, koto again (varied), flute and close. */
  musicStep(step, t, sd) {
    const m = this.mu, c = this.cmb, out = this.mus;
    const bar = step >> 4, s16 = step & 15, s32 = step & 31;
    if (step === 0 || !m.vary) {
      let k;
      do k = Math.floor(Math.random() * MOTIFS.length); while (k === m.motif && MOTIFS.length > 1);
      m.motif = k;
      m.flute = Math.floor(Math.random() * FLUTE.length);
      m.vary = MOTIFS[k].map(() => (Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0));
    }
    const h = t + Math.random() * 0.008;                  // a human hand is never exactly on the grid
    // koto
    if (bar < 2 || bar === 4 || bar === 5) {
      const motif = MOTIFS[m.motif], second = bar >= 4;
      for (let i = 0; i < motif.length; i++) {
        const n = motif[i];
        if (n[0] !== s32) continue;
        const deg = clamp(n[1] + (second ? m.vary[i] : 0), 0, KOTO.length - 1);
        const vel = n[2] * (0.5 - 0.15 * c) * rand(0.85, 1);
        if (Math.random() < 0.14 && deg + 1 < KOTO.length) {              // grace note from above
          this.string(KOTO[deg + 1], h, vel * 0.5, out, { dur: 0.07 });
          this.string(KOTO[deg], h + 0.07, vel, out);
        } else this.string(KOTO[deg], h, vel, out, Math.random() < 0.12 ? { bend: true } : undefined);
        if (second && i === motif.length - 1 && deg >= 5) this.string(KOTO[deg - 5], h + 0.012, vel * 0.7, out);
      }
      if (s32 === 0) this.string(bar === 0 ? 73.42 : 110.0, h, 0.42, out);
    }
    if (bar === 7 && s16 === 8 && c < 0.4 && Math.random() < 0.4) {
      for (let i = 0; i < 6; i++) this.string(KOTO[10 - i], h + i * 0.05, 0.3 - i * 0.02, out);       // a falling run to close
    }
    // flute
    if ((bar === 2 || bar === 3 || bar === 6 || bar === 7) && c < 0.5) {
      const fs = ((bar & 1) << 4) | s16;
      for (const n of FLUTE[m.flute]) if (n[0] === fs) this.flute(n[1], h, n[2] * sd * 0.95, 0.2 * (1 - c), out);
    }
    // the fight: drums and the driving string
    if (c > 0.12) {
      if (bar === 7 && s16 >= 8) { if (FILL[s16]) this.drum('don', t, c * FILL[s16], out); }
      else if (DON[bar & 1][s16]) this.drum('don', t, c * (s16 === 0 ? 1 : 0.72), out);
      if (c > 0.3 && KA[s16]) this.drum('ka', h, c * 0.7, out);
      if (c > 0.6) this.drum('shime', h, c * SHIME[s16 & 3], out);
      if (c > 0.3) {
        if (!(s16 & 1)) this.string(OST[bar & 1][s16 >> 1], h, 0.5 * c, out, { kind: 'sham', dur: sd * 1.8 });
        else if (c > 0.75) this.string(146.83, h, 0.2 * c, out, { kind: 'sham', dur: sd * 0.9 });
      }
    }
  }

  /** A short musical mark: 'kill' (two quick rising notes) or 'wave' (a falling run, drum and a flute call). */
  sting(kind = 'kill') {
    const wave = kind === 'wave';
    const t = this.begin(wave ? 'stingW' : 'sting', wave ? 1.5 : 0.35, wave ? 1.5 : 0.5);
    if (t === null) return;
    const out = this.bus;
    if (wave) {
      this.drum('don', t + 0.34, 1, out);
      if (!this.music) return;
      for (let i = 0; i < 6; i++) this.string(KOTO[10 - i], t + i * 0.055, 0.42 - i * 0.025, out);
      this.string(73.42, t + 0.34, 0.5, out);
      this.flute(587.33, t + 0.4, 1.1, 0.16, out);
    } else {
      this.drum('shime', t, 0.9, out);
      if (!this.music) return;
      this.string(440.0, t, 0.36, out);
      this.string(587.33, t + 0.09, 0.42, out, { bend: true });
    }
  }
}
