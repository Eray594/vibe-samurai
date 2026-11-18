// Shared sword work: stances, the cuts and the runner that plays them.
// Every pose is a hand position plus an explicit blade direction, so the sword is carried and
// cut with deliberately — the blade body itself is still driven physically and has its weight.
import * as THREE from 'three';
import { clamp, smooth, dampFactor, angleDiff } from './physics.js';

/** Character-local point: x = right, y = up, f = forward (local -Z). */
export const L = (x, y, f) => new THREE.Vector3(x, y, -f);
/** Character-local unit direction. */
export const D = (x, y, f) => new THREE.Vector3(x, y, -f).normalize();
const pose = (hand, dir) => ({ hand, dir });

export const POSES = {
  guard: pose(L(0.03, 0.16, 0.36), D(0, 0.42, 1)),          // chūdan: hands at the navel, point at the throat
  guardPole: pose(L(0.06, 0.12, 0.3), D(0, 0.1, 1)),         // spear levelled
  block: pose(L(0.1, 0.42, 0.4), D(-0.85, 0.5, 0.15)),       // blade across the body, edge out
  carry: pose(L(0.26, 0.02, 0.05), D(0.15, -0.45, -1)),      // waki: blade trailing low while running
  broken: pose(L(0.28, 0.0, 0.25), D(0.5, -0.8, 0.3)),       // guard smashed, blade hanging
  recoil: pose(L(0.32, 0.55, 0.1), D(0.6, 0.8, -0.2)),       // blade knocked wide
  jodan: pose(L(0.06, 0.74, 0.08), D(0.05, 0.9, -0.5)),      // high stance: blade above the head
  gedan: pose(L(0.1, 0.02, 0.32), D(0.12, -0.5, 1)),         // low stance: point at the knees
  iai: pose(L(-0.27, 0.08, 0.1), D(-0.2, -0.22, -1)),        // sheathed at the left hip, coiled for the draw
  bind: pose(L(0.0, 0.52, 0.5), D(-0.62, 0.75, 0.15)),       // blades locked, pushing
};
export const GUARD = POSES.guard.hand;
export const BLOCK_EDGE = L(0, 0.25, 1).normalize();
export const guardFor = (def) => (def.type === 'polearm' ? POSES.guardPole : POSES.guard);

/** Kamae: low is quick and light, high is slow and crushing. Index 1 (chūdan) is the default. */
export const STANCES = [
  { key: 'gedan', name: 'Gedan (tief)', wind: 0.76, power: 0.9, move: 1.08, posture: 0.85, pose: POSES.gedan },
  { key: 'chudan', name: 'Chūdan', wind: 1, power: 1, move: 1, posture: 1, pose: null },
  { key: 'jodan', name: 'Jōdan (hoch)', wind: 1.24, power: 1.28, move: 0.92, posture: 1.4, pose: POSES.jodan },
];

/** A cut: where the hands and the blade are when coiled, and where they stop. */
const cut = (label, wind, windDir, end, endDir, extra = {}) => {
  // the edge leads along the path the middle of the blade travels
  const edge = end.clone().addScaledVector(endDir, 0.45).sub(wind.clone().addScaledVector(windDir, 0.45)).normalize();
  return { label, wind, windDir, end, endDir, edge, ...extra };
};

export const ATTACKS = {
  kesaR: cut('Kesagiri', L(0.28, 0.62, 0.12), D(0.25, 1, -0.45), L(-0.18, 0.02, 0.5), D(-0.55, -0.35, 1)),     // right shoulder → left hip
  kesaL: cut('Gyaku-Kesa', L(-0.22, 0.62, 0.12), D(-0.25, 1, -0.45), L(0.2, 0.02, 0.5), D(0.55, -0.35, 1)),
  shomen: cut('Shōmen', L(0.02, 0.78, 0.02), D(0, 0.75, -1), L(0.02, 0.1, 0.55), D(0, -0.15, 1)),              // straight down the centre line
  yokoR: cut('Yoko', L(0.42, 0.3, 0.12), D(1, 0.1, -0.5), L(-0.3, 0.28, 0.42), D(-0.9, 0, 0.6)),               // level, right → left
  yokoL: cut('Yoko', L(-0.4, 0.3, 0.12), D(-1, 0.1, -0.5), L(0.32, 0.28, 0.42), D(0.9, 0, 0.6)),
  ashi: cut('Ashi-Barai', L(0.4, 0.35, 0.1), D(0.9, 0.5, -0.3), L(-0.25, -0.05, 0.5), D(-0.7, -0.75, 0.7), { low: true }),     // at the legs: jump it
  age: cut('Kiriage', L(0.3, -0.05, 0.15), D(0.6, -0.8, -0.2), L(-0.15, 0.6, 0.45), D(-0.5, 0.8, 0.5)),         // rising
  // kaiten: the blade is held out level and the whole body turns once — cuts everyone around
  spin: cut('Kaiten', L(0.5, 0.3, 0.1), D(1, 0.1, -0.4), L(0.6, 0.3, 0.25), D(1, 0, 0.15), { spin: true, strikeDur: 0.46, edge: L(0, 0, 1) }),
  // nukiuchi: a drawing cut while rushing straight past the opponent
  nuki: cut('Nukiuchi', L(0.36, 0.26, 0.1), D(1, 0.05, -0.35), L(-0.32, 0.3, 0.4), D(-0.9, 0.05, 0.5), { pass: true }),
  // iai: the blade leaves the scabbard already cutting, from the left hip up across the body
  iai: cut('Iai', L(-0.3, 0.1, 0.06), D(-0.3, -0.2, -1), L(0.42, 0.5, 0.42), D(0.9, 0.35, 0.45), { pass: true }),
  tsuki: cut('Tsuki', L(0.12, 0.22, 0.08), D(0, 0.05, 1), L(0.03, 0.3, 0.78), D(0, 0.05, 1), { thrust: true }),
  tsukiLow: cut('Tsuki', L(0.12, 0.16, 0.08), D(0, -0.1, 1), L(0.03, 0.12, 0.78), D(0, -0.22, 1), { thrust: true }),
};

export const MOVESETS = {
  katana: { combo: ['kesaR', 'kesaL', 'yokoR', 'spin', 'age', 'shomen'], sprint: 'nuki', air: 'shomen', counter: 'kesaL', ai: ['kesaR', 'kesaL', 'shomen', 'tsuki', 'ashi', 'yokoR', 'age', 'spin'] },
  wakizashi: { combo: ['kesaR', 'kesaL', 'tsuki', 'yokoL', 'spin', 'kesaR'], sprint: 'nuki', air: 'shomen', counter: 'tsuki', ai: ['kesaR', 'kesaL', 'tsuki', 'yokoL', 'ashi'] },
  nodachi: { combo: ['kesaR', 'yokoL', 'spin', 'shomen'], sprint: 'nuki', air: 'shomen', counter: 'age', ai: ['kesaR', 'kesaL', 'shomen', 'yokoR', 'ashi', 'spin'] },
  yari: { combo: ['tsuki', 'tsukiLow', 'tsuki', 'yokoR'], sprint: 'tsuki', air: 'tsukiLow', ai: ['tsuki', 'tsuki', 'tsukiLow', 'yokoR'] },
  naginata: { combo: ['yokoR', 'yokoL', 'spin', 'ashi', 'shomen'], sprint: 'tsuki', air: 'shomen', counter: 'yokoL', ai: ['yokoR', 'yokoL', 'kesaR', 'ashi', 'shomen', 'tsuki', 'spin'] },
  kanabo: { combo: ['kesaR', 'kesaL', 'spin', 'shomen'], sprint: 'yokoR', air: 'shomen', counter: 'kesaL', ai: ['kesaR', 'shomen', 'shomen', 'kesaL', 'yokoR'] },
};

const CHARGE_TIME = 0.45;
const HOLD = 0.28;                                   // share of the recovery spent frozen at the end of the cut (zanshin)
const PIVOT = new THREE.Vector3(0.03, 0.5, 0);       // between the shoulders: hands travel on arcs around it
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Move a hand from a to b along an arc around the shoulders instead of a straight line. */
function arcLerp(out, a, b, t) {
  _a.copy(a).sub(PIVOT); _b.copy(b).sub(PIVOT);
  const la = _a.length(), lb = _b.length();
  if (la < 1e-4 || lb < 1e-4) return out.lerpVectors(a, b, t);
  _a.divideScalar(la).lerp(_b.divideScalar(lb), t);
  if (_a.lengthSq() < 1e-6) return out.lerpVectors(a, b, t);
  return out.copy(_a.normalize()).multiplyScalar(la + (lb - la) * t).add(PIVOT);
}
/** Turn a direction from a to b (normalised lerp: slow at the ends, fastest in the middle). */
function turn(out, a, b, t) {
  out.lerpVectors(a, b, t);
  if (out.lengthSq() < 1e-6) out.copy(b);
  return out.normalize();
}

/**
 * Plays one cut: wind-up → strike → hold → recovery. Writes hand target, blade direction, edge and
 * power into a fighter's intent. Holding during the wind-up charges a heavy blow.
 */
export class AttackRunner {
  constructor() {
    this.hand = POSES.guard.hand.clone();
    this.bdir = POSES.guard.dir.clone();
    this.a = null;
  }

  get phase() { return this.a ? this.a.phase : null; }
  get busy() { return !!this.a; }
  /** Wind-up or strike: the part of a cut an opponent should react to. */
  get threatening() { return !!this.a && this.a.phase !== 'recover'; }

  start(name, def, o = {}) {
    const sw = def.swing;
    this.a = {
      name, ...ATTACKS[name], phase: 'wind', t: 0, from: this.hand.clone(), fromDir: this.bdir.clone(), home: guardFor(def),
      windDur: o.wind ?? sw.wind, strikeDur: o.strike ?? ATTACKS[name].strikeDur ?? sw.strike, recoverDur: o.recover ?? sw.recover,
      power: o.power ?? 1.15, heavy: !!o.heavy, charge: 0,
    };
    return this.a;
  }

  cancel() { this.a = null; }

  /** Advance. Returns 'strike' | 'recover' | 'done' on the frame a phase begins/ends, else null. */
  update(dt, it, holding = false) {
    const a = this.a;
    if (!a) return null;
    a.t += dt;
    let ev = null;
    it.mode = a.thrust ? 'thrust' : 'swing';
    it.edgeHint = a.thrust ? null : a.edge;
    it.edgeExact = !a.thrust;
    it.power = 1;
    if (a.phase === 'wind') {
      const u = smooth(clamp(a.t / a.windDur, 0, 1));
      arcLerp(this.hand, a.from, a.wind, u);
      turn(this.bdir, a.fromDir, a.windDir, u);
      if (a.t >= a.windDur) {
        if (holding && a.charge < 1) a.charge = Math.min(1, (a.t - a.windDur) / CHARGE_TIME);   // coiled, blade held back
        else {
          if (a.charge > 0.5) a.heavy = true;
          a.power += 0.45 * a.charge;
          a.phase = 'strike'; a.t = 0; ev = 'strike';
        }
      }
    } else if (a.phase === 'strike') {
      const u = smooth(clamp(a.t / a.strikeDur, 0, 1));
      arcLerp(this.hand, a.wind, a.end, u);
      turn(this.bdir, a.windDir, a.endDir, u);
      it.power = a.power;
      if (a.t >= a.strikeDur) { a.phase = 'recover'; a.t = 0; ev = 'recover'; }
    } else {
      const u = clamp(a.t / a.recoverDur, 0, 1);
      const v = smooth(clamp((u - HOLD) / (1 - HOLD), 0, 1));
      arcLerp(this.hand, a.end, a.home.hand, v);
      turn(this.bdir, a.endDir, a.home.dir, v);
      if (v > 0) { it.edgeHint = null; it.edgeExact = false; }
      if (u >= 1) { this.a = null; ev = 'done'; }
    }
    it.hand.copy(this.hand);
    it.bladeDir = this.bdir;
    return ev;
  }

  /** Not cutting: settle into a pose. */
  rest(dt, it, p = POSES.guard, rate = 6) {
    const k = dampFactor(rate, dt);
    this.hand.lerp(p.hand, k);
    this.bdir.lerp(p.dir, k).normalize();
    it.hand.copy(this.hand);
    it.bladeDir = this.bdir;
    it.edgeHint = null;
    it.edgeExact = false;
  }
}

/**
 * Spinning cut: while it lasts, returns the yaw the body should turn to (always a bit ahead of
 * where it is, until one full turn is done), else null.
 */
export function spinYaw(a, k) {
  if (!a || !a.spin || a.phase !== 'strike') return null;
  if (a.lastYaw != null) a.spun = (a.spun || 0) + Math.abs(angleDiff(a.lastYaw, k.yawActual));
  a.lastYaw = k.yawActual;
  const rem = Math.PI * 2 - (a.spun || 0);
  if (rem <= 0.05) return null;
  // drive the turn itself: one full revolution in well under half a second
  if (k.state === 'active' && k.core.angularVelocity.y < 15) k.core.angularVelocity.y = 15;
  return k.yawActual + Math.min(rem, 1.6);
}

// ---- posture ("Haltung") tuning, shared by everyone
export const DEFLECT_WINDOW = 0.22;     // seconds after raising the guard in which a block is a deflection
export const POSTURE = {
  block: 0.34,          // posture damage to the defender per blocked blow (× weapon postureDmg × speed factor)
  deflected: 0.32,      // posture damage to the attacker when deflected
  deflector: 0.05,      // what the deflector still takes
  wound: 0.9,           // posture damage per unit of wound severity
  regen: 0.16,          // per second, after a pause, scaled by vitality
  regenDelay: 1.3,
};
