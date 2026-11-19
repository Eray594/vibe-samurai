import * as THREE from 'three';
import { clamp, dampFactor, angleLerp } from './physics.js';
import { POSES, guardFor, BLOCK_EDGE, GUARD, MOVESETS, AttackRunner, DEFLECT_WINDOW, spinYaw, STANCES } from './combat.js';

const SENS_LOOK = 0.0022;
const SENS_HAND = 0.0027;
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _bq = new THREE.Quaternion();

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.lmb = false; this.rmb = false;
    this.lmbPressed = false; this.rmbPressed = false; this.mmbPressed = false;
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.locked = false;
    addEventListener('keydown', (e) => {
      if (['Backspace', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // clamp spikes some browsers produce on pointer-lock
      this.dx += clamp(e.movementX, -250, 250);
      this.dy += clamp(e.movementY, -250, 250);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 1) { this.mmbPressed = true; e.preventDefault(); }
      if (e.button === 2) { this.rmb = true; this.rmbPressed = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) this.rmb = false;
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += e.deltaY; }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.lmb = this.rmb = false; }
    });
  }
  lock() {
    if (this.locked) return;
    try { this.canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* browser refused: user can click again */ }
  }
  down(code) { return this.keys.has(code); }
  consume() {
    const r = {
      dx: this.dx, dy: this.dy, wheel: this.wheel, pressed: this.pressed,
      lmbPressed: this.lmbPressed, rmbPressed: this.rmbPressed, mmbPressed: this.mmbPressed,
    };
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.lmbPressed = this.rmbPressed = this.mmbPressed = false;
    this.pressed = new Set();
    return r;
  }
}

/**
 * Second player: a gamepad (preferred) or the right-hand side of the keyboard, presented through the
 * same interface as `Input` so the same controller class can drive a fighter with it.
 *   stick / arrows  move        A / Enter       jump        B / -          step
 *   X, RB / ,       cut         LB / .          guard       Y / #          kick
 *   LT  iai (hold)  RT  kunai   D-pad up  stance   D-pad down  grab   D-pad ←→  weapon
 */
const PAD_BUTTONS = { 0: 'Space', 1: 'ShiftLeft', 3: 'KeyF', 6: 'KeyB', 7: 'KeyQ', 10: 'KeyX', 12: 'KeyL', 13: 'KeyG', 14: 'WeaponPrev', 15: 'WeaponNext' };
const KEYS_P2 = {
  ArrowUp: 'KeyW', ArrowDown: 'KeyS', ArrowLeft: 'KeyA', ArrowRight: 'KeyD',
  Enter: 'Space', Numpad0: 'Space', Minus: 'ShiftLeft', Slash: 'ShiftLeft', Numpad3: 'ShiftLeft',
  Backslash: 'KeyF', Numpad5: 'KeyF', Numpad7: 'KeyL', Numpad9: 'KeyG', Numpad4: 'WeaponPrev', Numpad6: 'WeaponNext',
};
const LMB_P2 = ['Comma', 'Numpad1'], RMB_P2 = ['Period', 'Numpad2'];
export class PadInput {
  constructor(keyboard) {
    this.kb = keyboard;
    this.keys = new Set();
    this.lmb = false; this.rmb = false;
    this.locked = true;
    this.connected = false;
  }
  down(code) { return this.keys.has(code); }
  consume() {
    const now = new Set();
    let lmb = false, rmb = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.connected = !!pad;
    if (pad) {
      const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
      if (y < -0.35) now.add('KeyW');
      if (y > 0.35) now.add('KeyS');
      if (x < -0.35) now.add('KeyA');
      if (x > 0.35) now.add('KeyD');
      const b = (i) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
      for (const i in PAD_BUTTONS) if (b(+i)) now.add(PAD_BUTTONS[i]);
      lmb = b(2) || b(5);
      rmb = b(4);
    }
    for (const code in KEYS_P2) if (this.kb.keys.has(code)) now.add(KEYS_P2[code]);
    lmb = lmb || LMB_P2.some((c) => this.kb.keys.has(c));
    rmb = rmb || RMB_P2.some((c) => this.kb.keys.has(c));
    const pressed = new Set();
    for (const c of now) if (!this.keys.has(c)) pressed.add(c);
    const r = { dx: 0, dy: 0, wheel: 0, pressed, lmbPressed: lmb && !this.lmb, rmbPressed: rmb && !this.rmb, mmbPressed: false };
    this.keys = now; this.lmb = lmb; this.rmb = rmb;
    return r;
  }
}

/**
 * The player's samurai. The camera orbits freely; the body turns into the direction of travel,
 * towards the locked target, or into the cut.
 *   LMB  cut (chain for combos, hold to charge)      RMB  guard (tap just in time = deflect)
 *   Shift  slip-step / hold to sprint                Space  jump
 *   Tab / MMB  lock on                               Q  kunai   C  dress wounds   V  free blade
 */
export class PlayerController {
  constructor(game, fighter, input) {
    this.game = game;
    this.k = fighter;
    this.input = input;
    this.yaw = 0;             // camera
    this.pitch = -0.2;
    this.faceYaw = 0;         // body
    this.runner = new AttackRunner();
    this.comboI = 0;
    this.comboT = 9;          // time since the last cut ended
    this.buffer = 0;          // buffered attack press
    this.aim = null;          // fighter the current cut is aimed at
    this.lock = null;
    this.finisher = null;
    this.free = false;        // free-blade mode: mouse drives the sword directly
    this.handRaw = GUARD.clone();
    this.reachAdd = 0;
    this.guardPressT = 9;
    this.kunaiCd = 0;
    this.counterT = 0;        // just deflected: the next cut is an instant counter
    this.spinTo = null;
    this.heals = 3;
    this.mode = 'guard';
    this.sprintAttack = false;
    this.stance = 1;          // index into STANCES: 0 low, 1 middle, 2 high
    this.stanceCd = 0;
    this.iaiCharge = 0;
    this.iaiCd = 0;
    this.iaiReady = false;
    this.maxHeals = 3;
    this.fixedYaw = false;    // two-player duel: the camera is not ours to turn
    this.flickX = 0;          // recent mouse travel: a flick just before the click aims the cut
    this.flickY = 0;
    this.stamina = 1;         // breath: cuts, steps, sprinting and jumps draw on it
    this.stamIdle = 9;
    this.exhaustT = 0;        // out of breath: no sprint, no step, slower cuts
    this.plunge = null;       // dropping onto someone from above
  }

  get exhausted() { return this.exhaustT > 0; }

  /** Use up breath. Running dry leaves the fighter winded for a moment. */
  spend(a) {
    this.stamina -= a;
    this.stamIdle = 0;
    if (this.stamina <= 0) {
      this.stamina = 0;
      if (this.exhaustT <= 0) {
        this.exhaustT = 1.6;
        if (this.k.isPlayer) this.game.callout('AUSSER ATEM', null, 'small');
      }
    }
  }

  /** Which cut a flick of the mouse asks for (null: no flick, the combo decides). */
  flickCut(def) {
    if (!this.game.settings.aimCuts || this.fixedYaw) return null;
    const x = this.flickX, y = this.flickY;
    if (Math.hypot(x, y) < 26) return null;
    const ax = Math.abs(x), ay = Math.abs(y);
    if (ay > ax * 2.2) return y > 0 ? 'shomen' : 'age';                 // straight down / rising
    if (ax > ay * 2.2) return x < 0 ? 'yokoR' : 'yokoL';                // level, the way the mouse went
    if (y > 0) return x < 0 ? 'kesaR' : 'kesaL';                        // diagonal down
    return 'age';
  }

  /** Where the hands rest between cuts: depends on the stance (polearms have only the one). */
  homePose(def) {
    const st = STANCES[this.stance];
    return st.pose && def.type !== 'polearm' ? st.pose : guardFor(def);
  }

  setStance(i) {
    i = clamp(i, 0, STANCES.length - 1);
    if (i === this.stance) return;
    this.stance = i;
    if (this.k.isPlayer) this.game.callout(STANCES[i].name.toUpperCase(), null, 'small');
    this.game.audio.tick?.();
  }

  /** Rush straight at / through the aim, the cut landing on the way. Used by the dash-cut and the draw. */
  /**
   * Where the blade goes when the guard is up: across the body on the side the nearest cut comes
   * from, and overhead against a blow from above. Without a threat, the plain block.
   */
  blockPose(me) {
    const k = this.k, game = this.game;
    let best = null, bd = 4.5;
    for (const f of game.fighters) {
      if (f.team === k.team || f.state !== 'active' || !f.weapon?.attached) continue;
      if (f.attackPhase !== 'wind' && f.attackPhase !== 'strike') continue;
      const p = f.core.position, d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) return POSES.block;
    const w = best.weapon;
    const tip = w.worldPoint(w.tipLocal, _v).sub(me).applyQuaternion(_bq.copy(k.yawQuat()).invert());
    if (Math.abs(tip.x) > 0.12) this.blockSide = tip.x > 0 ? 1 : -1;       // a little dead zone, so it does not flicker
    const s = this.blockSide || 1, high = best.atk?.name === 'shomen';
    const bp = this.bp || (this.bp = { hand: new THREE.Vector3(), dir: new THREE.Vector3() });
    bp.hand.set(0.1 * s, high ? 0.6 : 0.42, -0.4);
    bp.dir.set(-0.85 * s, high ? 0.2 : 0.5, -0.15).normalize();
    return bp;
  }

  rush(minSp = 6) {
    const k = this.k;
    if (this.aim) { const ap = this.aim.getPos(_q), me = k.getPos(_p); this.faceYaw = Math.atan2(-(ap.x - me.x), -(ap.z - me.z)); }
    k.dashCd = 0;
    let d0 = 3;
    if (this.aim) { const ap = this.aim.getPos(_q), me = k.getPos(_p); d0 = Math.hypot(ap.x - me.x, ap.z - me.z); }
    if (k.dash(_v.set(-Math.sin(this.faceYaw), 0, -Math.cos(this.faceYaw)))) {
      // speed chosen so the blade crosses the opponent in the middle of the cut, then carry on past
      const a = this.runner.a, sp = clamp((d0 - 0.9) / (a.windDur + a.strikeDur * 0.5), minSp, 16);
      k.core.velocity.x = -Math.sin(this.faceYaw) * sp;
      k.core.velocity.z = -Math.cos(this.faceYaw) * sp;
      k.dashT = 0.32; k.ghostT = 0.4; k.iframeT = 0.44;
    }
  }

  /** Iai: the charged draw. `c` is the charge 0..1. */
  startIai(c, moveX, moveZ, moving) {
    const k = this.k, def = k.weapon.def;
    this.buffer = 0;
    this.sprintAttack = false;
    this.comboI = 0;
    this.finisher = null;
    k.postureMul = 1.5;
    this.runner.start('iai', def, { wind: 0.06, strike: def.swing.strike * 0.85, power: 1.35 + 0.55 * c, heavy: true }).home = this.homePose(def);
    const fx = moving ? moveX : -Math.sin(this.yaw), fz = moving ? moveZ : -Math.cos(this.yaw);
    this.aim = this.pickAim(fx, fz);
    if (!this.aim) this.faceYaw = Math.atan2(-fx, -fz);
    this.rush(9);
    this.spend(0.22);
    this.iaiCd = 2.2;
    this.game.onIai?.(k, c);
  }

  reset() {
    this.runner.cancel();
    this.runner.hand.copy(GUARD);
    this.finisher = null;
    this.lock = null;
    this.buffer = 0;
    this.comboI = 0;
    this.heals = this.maxHeals;
    this.iaiCharge = 0;
    this.iaiCd = 0;
    this.stamina = 1; this.exhaustT = 0; this.plunge = null;
  }

  /** Called while the player is down: only the camera moves. */
  lookOnly(frame) {
    const sl = SENS_LOOK * this.game.settings.sens;
    this.yaw -= frame.dx * sl;
    this.pitch = clamp(this.pitch - frame.dy * sl, -0.9, 0.55);
    this.runner.cancel();
    this.finisher = null;
    this.k.attackPhase = null;
    this.k.sprinting = false;
    this.plunge = null;
    this.stamina = Math.min(1, this.stamina + 0.004);
    // knocked down: a well-timed press rolls straight back to the feet
    if (frame.pressed.has('Space') || frame.pressed.has('ShiftLeft')) this.game.tryTech(this.k, this);
  }

  valid(f) { return f && !f.disposed && !f.dead && f.state === 'active'; }

  /** Hostile closest to where the camera looks. */
  findTarget(maxDist = 18, exclude = null) {
    const me = this.k.getPos(_p);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let best = null, bs = Infinity;
    for (const f of this.game.fighters) {
      if (f.team === this.k.team || f === exclude || !this.valid(f)) continue;
      const p = f.getPos(_q);
      const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz);
      if (d > maxDist) continue;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / (d || 1), -1, 1));
      const score = ang + d * 0.04;
      if (score < bs) { bs = score; best = f; }
    }
    return best;
  }

  /** Whom a cut started now should go for: the lock, else someone close in front. */
  pickAim(dirX, dirZ) {
    if (this.valid(this.lock)) return this.lock;
    const me = this.k.getPos(_p);
    const reach = this.k.weapon.def.reach + 3;
    let best = null, bs = Infinity;
    for (const f of this.game.fighters) {
      if (f.team === this.k.team || !this.valid(f)) continue;
      const p = f.getPos(_q);
      const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz);
      if (d > reach) continue;
      const dot = (dx * dirX + dz * dirZ) / (d || 1);
      if (dot < 0.25 && d > 1.2) continue;
      const score = d - dot * 1.5;
      if (score < bs) { bs = score; best = f; }
    }
    return best;
  }

  startAttack(moveX, moveZ, moving) {
    const k = this.k, def = k.weapon.def, game = this.game;
    this.buffer = 0;
    // an opponent whose guard is broken gets the finishing blow
    const victim = game.findFinisherTarget(k);
    if (victim) {
      this.finisher = { victim, done: false };
      const p = victim.getPos(_q), me = k.getPos(_p);
      const d = _v.set(p.x - me.x, 0, p.z - me.z);
      if (d.length() > 1.5) k.dash(d.normalize());
      this.runner.start(def.type === 'sword' ? 'kesaR' : def.type === 'club' ? 'shomen' : 'tsuki', def, { wind: 0.24, power: 1.6, recover: def.swing.recover + 0.25 });
      game.onFinisherStart(k, victim);
      return;
    }
    const ms = MOVESETS[def.key];
    const st = STANCES[this.stance];
    let name, o = {};
    this.sprintAttack = false;
    k.postureMul = st.posture;
    if (k.slideT > 0) {
      // out of the slide: a cut at the legs on the way past
      name = 'ashi'; o = { wind: 0.08, power: 1.35 }; this.comboI = 0;
    } else if (this.counterT > 0) {
      // riposte straight out of a deflection: no wind-up to speak of, and it bites deep
      name = ms.counter; o = { wind: 0.07, power: 1.5, heavy: true };
      this.counterT = 0; this.comboI = 1;
      game.onCounter(k);
    } else if (k.airborne) {
      name = ms.air; o = { power: 1.4, heavy: true };
      // high above someone: come down on him
      const tgt = game.plungeTarget(k, this);
      if (tgt) {
        const t = game.startPlunge(k, tgt);
        this.plunge = { tgt, t: 0 };
        name = 'shomen'; o = { wind: Math.max(0.1, t - 0.1), power: 1.75, heavy: true };
        this.lock = this.lock || null;
      }
    }
    else if (k.sprinting) {
      name = ms.sprint; o = { power: 1.3, wind: def.swing.wind * 0.8 }; this.sprintAttack = true; this.comboI = 0;
      if (name === 'nuki') o = { power: 1.45, wind: 0.12, heavy: true };
    } else {
      if (this.comboT > 0.9) this.comboI = 0;
      name = this.flickCut(def) || ms.combo[this.comboI % ms.combo.length];
      if (this.comboI > 0) o.wind = def.swing.wind * Math.max(0.55, 0.85 - 0.07 * this.comboI);   // the chain speeds up
      this.comboI++;
      // the stance colours the plain cuts: low is quick and light, high slow and heavy
      o.wind = (o.wind ?? def.swing.wind) * st.wind;
      o.power = 1.15 * st.power;
      if (st.power > 1.1) o.heavy = true;
    }
    if (this.exhausted) o.wind = (o.wind ?? def.swing.wind) * 1.45;       // no breath: everything comes late
    this.spend(o.heavy ? 0.15 : 0.1);
    const a0 = this.runner.start(name, def, o);
    a0.home = this.homePose(def);
    if (this.plunge) a0.unblockable = true;
    // aim: lock target, else whoever stands in front of the stick / camera
    const fx = moving ? moveX : -Math.sin(this.yaw), fz = moving ? moveZ : -Math.cos(this.yaw);
    this.aim = this.pickAim(fx, fz);
    if (!this.aim) this.faceYaw = Math.atan2(-fx, -fz);
    if (o.wind === 0.07 && this.aim) {
      // counter: spring after the reeling opponent so the cut arrives in measure
      const ap = this.aim.getPos(_q), me = k.getPos(_p), d0 = Math.hypot(ap.x - me.x, ap.z - me.z);
      const a = this.runner.a;
      a.assist = true;
      this.faceYaw = Math.atan2(-(ap.x - me.x), -(ap.z - me.z));
      if (d0 > 1.2) {
        const sp = clamp((d0 - 1.0) / (a.windDur + a.strikeDur * 0.5), 0, 12);
        k.dashCd = 0;
        if (k.dash(_v.set(-Math.sin(this.faceYaw), 0, -Math.cos(this.faceYaw)))) {
          k.core.velocity.x = -Math.sin(this.faceYaw) * sp;
          k.core.velocity.z = -Math.cos(this.faceYaw) * sp;
          k.dashT = a.windDur + a.strikeDur * 0.5;
        }
      }
    }
    if (name === 'nuki') this.rush();       // rush straight through the opponent, cutting on the way past
  }

  update(dt, frame) {
    const k = this.k, inp = this.input, it = k.intent, game = this.game;
    const { dx, dy, wheel } = frame;
    const def = k.weapon.def;
    const armed = k.weapon.attached;
    const broken = k.brokenT > 0;
    const pressed = frame.pressed;

    if (pressed.has('KeyV')) { this.free = !this.free; game.callout(this.free ? 'FREIE KLINGE' : 'KAMPFSTIL', null, 'small'); }
    const freeSwing = this.free && inp.lmb && armed && !broken && !this.finisher;

    // ---------- camera
    if (this.fixedYaw) { /* set from outside */ }
    else if (!freeSwing) {
      this.yaw -= dx * SENS_LOOK * game.settings.sens;
      this.pitch = clamp(this.pitch - dy * SENS_LOOK * game.settings.sens, -0.9, 0.55);
    } else this.yaw -= dx * SENS_LOOK * game.settings.sens * 0.28;
    k.atk = this.runner.a;
    const fk = Math.exp(-dt * 11);
    this.flickX = this.flickX * fk + dx; this.flickY = this.flickY * fk + dy;
    // breath comes back after a pause (faster standing still, slower behind the guard)
    this.exhaustT = Math.max(0, this.exhaustT - dt);
    this.stamIdle += dt;
    if (this.stamIdle > 0.7) this.stamina = Math.min(1, this.stamina + dt * (inp.rmb ? 0.16 : 0.34));

    // ---------- lock-on
    if (pressed.has('Tab') || frame.mmbPressed) {
      this.lock = this.lock ? null : this.findTarget();
      if (this.lock) game.audio.tick?.();
    }
    if (this.lock && !this.valid(this.lock)) this.lock = this.findTarget(10);
    if (this.lock && wheel && !freeSwing) this.lock = this.findTarget(18, this.lock) || this.lock;
    const me = k.getPos(_p).clone();
    if (this.lock && !this.fixedYaw) {
      const lp = this.lock.getPos(_q);
      this.yaw = angleLerp(this.yaw, Math.atan2(-(lp.x - me.x), -(lp.z - me.z)), dampFactor(4.5, dt));
    }
    // ---------- stance: mouse wheel (when it is not switching targets) or L
    this.stanceCd -= dt;
    if (pressed.has('KeyL')) this.setStance((this.stance + 1) % STANCES.length);
    else if (wheel && !this.lock && !freeSwing && this.stanceCd <= 0) { this.setStance(this.stance + (wheel < 0 ? 1 : -1)); this.stanceCd = 0.18; }

    // ---------- movement input, relative to the camera
    let mf = 0, ms = 0;
    if (inp.down('KeyW')) mf += 1;
    if (inp.down('KeyS')) mf -= 1;
    if (inp.down('KeyD')) ms += 1;
    if (inp.down('KeyA')) ms -= 1;
    const moving = mf !== 0 || ms !== 0;
    const len = Math.hypot(mf, ms) || 1;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const mx = (-sy * mf + cy * ms) / len, mz = (-cy * mf - sy * ms) / len;   // unit move direction (world)

    // ---------- slip-step (Shift) & jump (Space)
    // ---------- hanging from an edge: up, or let go
    if (k.hang) {
      this.runner.cancel();
      this.finisher = null; this.plunge = null;
      this.mode = 'hang';
      it.mode = 'guard'; it.bladeDir = null; it.edgeHint = null; it.edgeExact = false; it.power = 1;
      this.runner.rest(dt, it, POSES.carry, 8);
      k.attackPhase = null; k.atk = null; k.sprinting = false;
      this.faceYaw = it.yaw;
      if (pressed.has('Space') || pressed.has('KeyW')) { if (k.climbUp()) { this.spend(0.1); game.onClimb(k); } }
      else if (pressed.has('KeyS') || pressed.has('KeyX') || pressed.has('ShiftLeft')) k.letGo();
      return;
    }
    // ---------- the blade is caught in something: wrench it free
    if (k.stuckT > 0) { this.runner.cancel(); this.buffer = Math.max(this.buffer, 0); }
    // ---------- coming down on someone from above
    if (this.plunge) {
      const pl = this.plunge, tg = pl.tgt;
      pl.t += dt;
      if (!this.valid(tg) || pl.t > 1.6) this.plunge = null;
      else {
        const tp = tg.getPos(_q);
        if (Math.hypot(tp.x - me.x, tp.z - me.z) < 1.25 && me.y - tp.y < 1.5) { this.plunge = null; game.plungeHit(k, tg, this); }
        else if (!k.airborne) this.plunge = null;
      }
    }
    // ---------- locked blade on blade: all there is to do is push
    if (k.bound) {
      this.runner.cancel();
      this.finisher = null;
      this.mode = 'bind';
      it.mode = 'guard'; it.bladeDir = null; it.edgeHint = null; it.edgeExact = false; it.power = 1.6;
      this.runner.rest(dt, it, POSES.bind, 16);
      it.move.set(0, 0, 0);
      const o = game.bind.other(k);
      if (o) { const op = o.getPos(_q); this.faceYaw = Math.atan2(-(op.x - me.x), -(op.z - me.z)); }
      it.yaw = this.faceYaw;
      k.attackPhase = null; k.atk = null; k.sprinting = false;
      if (frame.lmbPressed) game.bind.push(k);
      return;
    }
    if ((pressed.has('ShiftLeft') || pressed.has('ShiftRight')) && !broken) {
      const d = moving ? _v.set(mx, 0, mz) : k.forward(_v).negate();
      if (!this.exhausted && k.dash(d)) {
        if (this.runner.phase !== 'strike') this.runner.cancel();
        this.finisher = null;
        this.spend(0.16);
        game.onDodge(k, d, this);
      }
    }
    if (pressed.has('KeyX') && k.sprinting && !broken) {
      if (k.startSlide(_v.set(mx, 0, mz))) { this.runner.cancel(); this.spend(0.12); game.onSlide(k); }
    }
    if (pressed.has('Space') && !broken) {
      if (k.airborne) game.tryWallJump(k);
      else if (k.jump(game.wallRunBoost(k))) { this.spend(0.07); game.onJump(k); }
    }
    const shift = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const wantGuard = inp.rmb && armed && !broken && !this.finisher && !k.holding;
    if (frame.rmbPressed) {
      // mashing the guard shrinks the deflection window
      k.deflectWindow = (this.guardPressT < 0.28 ? DEFLECT_WINDOW * 0.65 : DEFLECT_WINDOW) * (k.isPlayer ? game.perk.deflect : 1) * (this.exhausted ? 0.6 : 1);
      this.guardPressT = 0;
    }
    this.iaiCd -= dt;
    this.guardPressT += dt;
    this.counterT -= dt;
    this.spinTo = null;
    this.buffer -= dt;
    if (frame.lmbPressed && !this.free) this.buffer = 0.38;
    this.comboT += dt;
    this.kunaiCd -= dt;

    // ---------- the sword
    it.bladeDir = null;
    it.edgeHint = null;
    it.edgeExact = false;
    it.power = 1;
    let speedMul = 1;
    let moveX = mx, moveZ = mz, moveOn = moving;
    k.attackPhase = null;

    if (broken || !armed) {
      this.runner.cancel();
      this.finisher = null;
      this.mode = 'guard';
      it.mode = 'guard';
      this.runner.rest(dt, it, broken ? POSES.broken : guardFor(def), 7);
      if (broken) speedMul = 0.35;
    } else if (k.holding) {
      // one hand in an opponent's collar: no cutting, but he can be thrown
      this.runner.cancel();
      this.finisher = null;
      this.mode = 'hold';
      it.mode = 'guard';
      this.runner.rest(dt, it, POSES.carry, 8);
      speedMul = 0.6;
      this.faceYaw = this.yaw;
      if (frame.lmbPressed || pressed.has('KeyG') || pressed.has('KeyF')) { game.throwHeld(k, 1); this.buffer = 0; }
    } else if (freeSwing) {
      // ----- free blade: the hands follow the mouse, the sword follows with its weight
      if (this.mode !== 'free') this.handRaw.copy(this.runner.hand);
      this.runner.cancel();
      this.mode = 'free';
      this.reachAdd = clamp(this.reachAdd - wheel * 0.0009, -0.18, 0.34);
      this.reachAdd *= Math.exp(-dt * 1.6);
      const r = this.handRaw;
      r.x = clamp(r.x + dx * SENS_HAND * game.settings.sens, -0.62, 0.66);
      r.y = clamp(r.y - dy * SENS_HAND * game.settings.sens, -0.28, 1.0);
      r.z = -(0.46 + this.reachAdd - 0.38 * Math.max(0, Math.abs(r.x) - 0.25) - 0.22 * Math.max(0, r.y - 0.7));
      this.runner.hand.lerp(r, dampFactor(32, dt));
      it.hand.copy(this.runner.hand);
      it.bladeDir = null;
      it.mode = 'swing';
      speedMul = 0.8;
      if (k.weapon.tipSpeed > 7) k.attackPhase = 'strike';
      this.faceYaw = this.yaw;
    } else {
      // guard cancels everything but a blow already on its way
      if (wantGuard && this.runner.busy && this.runner.phase !== 'strike') { this.runner.cancel(); this.buffer = 0; }
      // ----- iai: hold B to sheathe and coil, let go to draw
      const iaiKey = inp.down('KeyB') && def.type === 'sword' && this.iaiCd <= 0 && !wantGuard && !k.airborne;
      if (iaiKey && !this.runner.busy) {
        if (this.iaiCharge === 0) game.audio.tick?.();
        this.iaiCharge = Math.min(1, this.iaiCharge + dt / (0.75 * (k.isPlayer ? game.perk.iai : 1)));
        if (this.iaiCharge >= 1 && !this.iaiReady) { this.iaiReady = true; game.onIaiReady?.(k); }
        this.buffer = 0;
      } else if (this.iaiCharge > 0) {
        const c = this.iaiCharge;
        this.iaiCharge = 0; this.iaiReady = false;
        if (c > 0.3 && !this.runner.busy && !wantGuard) this.startIai(c, mx, mz, moving);
      }
      if (this.buffer > 0 && !wantGuard && k.kickT <= 0 && this.iaiCharge <= 0 && k.stuckT <= 0) {
        const a = this.runner.a;
        if (!a) this.startAttack(mx, mz, moving);
        else if (a.phase === 'recover' && a.t > a.recoverDur * 0.05 && !this.finisher) this.startAttack(mx, mz, moving);       // the next cut flows straight out of the last
      }
      if (this.runner.busy) {
        const a = this.runner.a;
        const ev = this.runner.update(dt, it, inp.lmb && !this.finisher && !this.sprintAttack);
        this.mode = a.charge > 0.05 && a.phase === 'wind' ? 'charge' : 'swing';
        this.comboT = 0;
        k.attackPhase = this.runner.phase;
        if (ev === 'strike') game.onSwing(k, a.heavy);
        if (ev === 'recover') game.checkWhiff(k, a, this);
        this.spinTo = spinYaw(a, k);
        if ((a.pass || a.assist) && !a.assisted && a.phase === 'strike' && a.t > a.strikeDur * 0.5) { a.assisted = true; game.assistCut(k, this.aim); }
        // turn into the cut and step in
        const tgt = this.finisher ? this.finisher.victim : this.aim;
        let dist = 99;
        if (this.valid(tgt)) {
          const tp = tgt.getPos(_q);
          dist = Math.hypot(tp.x - me.x, tp.z - me.z);
          if (!a.pass) this.faceYaw = Math.atan2(-(tp.x - me.x), -(tp.z - me.z));
        }
        if (a.pass) dist = 99;
        const fwdX = -Math.sin(this.faceYaw), fwdZ = -Math.cos(this.faceYaw);
        if (a.phase === 'wind') {
          if (this.finisher || this.sprintAttack) { moveX = fwdX; moveZ = fwdZ; moveOn = dist > def.reach * 0.7; speedMul = this.finisher ? 1.3 : 1.2; }
          else speedMul = 0.45;
        } else if (a.phase === 'strike') {
          moveX = fwdX; moveZ = fwdZ; moveOn = true;
          speedMul = dist > def.reach * 0.75 ? (this.sprintAttack ? 1.3 : 0.7) : 0.1;
          if (this.finisher && !this.finisher.done && a.t > a.strikeDur * 0.45) {
            this.finisher.done = true;
            game.executeFinisher(k, this.finisher.victim);
          }
        } else speedMul = 0.45;
        // too close to cut properly: give ground
        if (a.pass) { moveOn = a.phase === 'recover'; speedMul = 0.45; }
        else if (a.phase !== 'recover' && dist < def.reach * 0.5) { moveX = -fwdX; moveZ = -fwdZ; moveOn = true; speedMul = 0.5; }
        if (this.finisher) k.iframeT = Math.max(k.iframeT, 0.15);
        if (ev === 'done') { this.finisher = null; this.aim = null; }
      } else if (wantGuard) {
        this.finisher = null;
        this.mode = 'parry';
        it.mode = 'parry';
        this.runner.rest(dt, it, this.blockPose(me), 30);       // the blade goes to meet the cut that is coming
        it.edgeHint = BLOCK_EDGE;
        it.power = 1.5;
        speedMul = 0.5;
      } else if (this.iaiCharge > 0) {
        this.finisher = null;
        this.mode = 'iai';
        it.mode = 'guard';
        this.runner.rest(dt, it, POSES.iai, 12);
        speedMul = 0.45;
      } else {
        this.finisher = null;
        this.mode = 'guard';
        it.mode = 'guard';
        this.runner.rest(dt, it, k.sprinting || k.slideT > 0 ? POSES.carry : this.homePose(def), k.sprinting ? 9 : 10);
      }
    }
    k.atk = this.runner.a;

    // ---------- sprint
    const sprint = shift && moving && k.dashT <= 0 && this.mode === 'guard' && !broken && !k.airborne && k.slideT <= 0 && !this.exhausted;
    k.sprinting = sprint;
    if (sprint) { speedMul *= 1.62; this.spend(dt * 0.085); }
    if (k.stuckT > 0) speedMul *= 0.15;

    // ---------- facing
    const attacking = this.runner.busy;
    if (!attacking && this.mode !== 'free') {
      if (this.lock) {
        const lp = this.lock.getPos(_q);
        this.faceYaw = Math.atan2(-(lp.x - me.x), -(lp.z - me.z));
      } else if (this.mode === 'parry') {
        // guard turns towards whoever is closest in front of the camera, else where the camera looks
        const near = this.pickAim(-sy, -cy);
        if (near) { const np = near.getPos(_q); this.faceYaw = Math.atan2(-(np.x - me.x), -(np.z - me.z)); }
        else this.faceYaw = this.yaw;
      }
      else if (moving) this.faceYaw = Math.atan2(-mx, -mz);
    }
    it.yaw = this.spinTo ?? this.faceYaw;

    // ---------- locomotion
    let speed = 5.0 * def.moveMul * k.speedMul * speedMul * (armed ? 1 : 1.08) * STANCES[this.stance].move;
    if (this.lock && !sprint && mf < 0) speed *= 0.82;
    if (moveOn) it.move.set(moveX * speed, 0, moveZ * speed);
    else it.move.set(0, 0, 0);

    // ---------- tools
    if (pressed.has('KeyF') && !broken && this.runner.phase !== 'strike' && !this.finisher && this.mode !== 'hold') {
      if (k.startKick(k.airborne ? 1.7 : k.sprinting ? 1.6 : 1, k.airborne)) { this.runner.cancel(); this.spend(0.1); }
    }
    if (pressed.has('KeyG') && !broken && this.mode !== 'hold' && !this.runner.busy && !k.airborne) game.tryGrab(k);
    if (k.kickT > 0 && k.kickPower <= 1) it.move.multiplyScalar(0.15);
    if (pressed.has('KeyQ') && this.kunaiCd <= 0 && !broken && this.mode !== 'hold') {
      this.kunaiCd = 0.45;
      // with the guard up the weapon in hand is what flies
      if (inp.rmb && armed && !this.runner.busy) game.throwWeapon(k, this.lock, this.yaw, this.pitch);
      else game.throwKunai(k, this.lock, this.yaw, this.pitch);
    }
    if (pressed.has('KeyC') && k.isPlayer) game.playerHeal();
  }
}
