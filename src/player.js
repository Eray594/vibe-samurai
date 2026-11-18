import * as THREE from 'three';
import { clamp, dampFactor, angleLerp } from './physics.js';
import { POSES, guardFor, BLOCK_EDGE, GUARD, MOVESETS, AttackRunner, DEFLECT_WINDOW, spinYaw } from './combat.js';

const SENS_LOOK = 0.0022;
const SENS_HAND = 0.0027;
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

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
  }

  reset() {
    this.runner.cancel();
    this.runner.hand.copy(GUARD);
    this.finisher = null;
    this.lock = null;
    this.buffer = 0;
    this.comboI = 0;
    this.heals = 3;
  }

  /** Called while the player is down: only the camera moves. */
  lookOnly(frame) {
    this.yaw -= frame.dx * SENS_LOOK;
    this.pitch = clamp(this.pitch - frame.dy * SENS_LOOK, -0.9, 0.55);
    this.runner.cancel();
    this.finisher = null;
    this.k.attackPhase = null;
    this.k.sprinting = false;
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
    let name, o = {};
    this.sprintAttack = false;
    if (this.counterT > 0) {
      // riposte straight out of a deflection: no wind-up to speak of, and it bites deep
      name = ms.counter; o = { wind: 0.07, power: 1.5, heavy: true };
      this.counterT = 0; this.comboI = 1;
      game.onCounter(k);
    } else if (k.airborne) { name = ms.air; o = { power: 1.4, heavy: true }; }
    else if (k.sprinting) {
      name = ms.sprint; o = { power: 1.3, wind: def.swing.wind * 0.8 }; this.sprintAttack = true; this.comboI = 0;
      if (name === 'nuki') o = { power: 1.45, wind: 0.12, heavy: true };
    } else {
      if (this.comboT > 0.9) this.comboI = 0;
      name = ms.combo[this.comboI % ms.combo.length];
      if (this.comboI > 0) o.wind = def.swing.wind * Math.max(0.55, 0.85 - 0.07 * this.comboI);   // the chain speeds up
      this.comboI++;
    }
    this.runner.start(name, def, o);
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
    if (name === 'nuki') {
      // rush straight through the opponent, cutting on the way past
      if (this.aim) { const ap = this.aim.getPos(_q), me = k.getPos(_p); this.faceYaw = Math.atan2(-(ap.x - me.x), -(ap.z - me.z)); }
      k.dashCd = 0;
      let d0 = 3;
      if (this.aim) { const ap = this.aim.getPos(_q), me = k.getPos(_p); d0 = Math.hypot(ap.x - me.x, ap.z - me.z); }
      if (k.dash(_v.set(-Math.sin(this.faceYaw), 0, -Math.cos(this.faceYaw)))) {
        // speed chosen so the blade crosses the opponent in the middle of the cut, then carry on past
        const a = this.runner.a, sp = clamp((d0 - 0.9) / (a.windDur + a.strikeDur * 0.5), 6, 16);
        k.core.velocity.x = -Math.sin(this.faceYaw) * sp;
        k.core.velocity.z = -Math.cos(this.faceYaw) * sp;
        k.dashT = 0.32; k.ghostT = 0.4; k.iframeT = 0.44;
      }
    }
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
    if (!freeSwing) {
      this.yaw -= dx * SENS_LOOK;
      this.pitch = clamp(this.pitch - dy * SENS_LOOK, -0.9, 0.55);
    } else this.yaw -= dx * SENS_LOOK * 0.28;

    // ---------- lock-on
    if (pressed.has('Tab') || frame.mmbPressed) {
      this.lock = this.lock ? null : this.findTarget();
      if (this.lock) game.audio.tick?.();
    }
    if (this.lock && !this.valid(this.lock)) this.lock = this.findTarget(10);
    if (this.lock && wheel && !freeSwing) this.lock = this.findTarget(18, this.lock) || this.lock;
    const me = k.getPos(_p).clone();
    if (this.lock) {
      const lp = this.lock.getPos(_q);
      this.yaw = angleLerp(this.yaw, Math.atan2(-(lp.x - me.x), -(lp.z - me.z)), dampFactor(4.5, dt));
    }

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
    if ((pressed.has('ShiftLeft') || pressed.has('ShiftRight')) && !broken) {
      const d = moving ? _v.set(mx, 0, mz) : k.forward(_v).negate();
      if (k.dash(d)) {
        if (this.runner.phase !== 'strike') this.runner.cancel();
        this.finisher = null;
      }
    }
    if (pressed.has('Space') && !broken) {
      if (k.jump()) game.onJump(k);
    }
    const shift = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const wantGuard = inp.rmb && armed && !broken && !this.finisher;
    if (frame.rmbPressed) {
      // mashing the guard shrinks the deflection window
      k.deflectWindow = this.guardPressT < 0.4 ? DEFLECT_WINDOW * 0.45 : DEFLECT_WINDOW;
      this.guardPressT = 0;
    }
    this.guardPressT += dt;
    this.counterT -= dt;
    this.spinTo = null;
    this.buffer -= dt;
    if (frame.lmbPressed && !this.free) this.buffer = 0.3;
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
    } else if (freeSwing) {
      // ----- free blade: the hands follow the mouse, the sword follows with its weight
      if (this.mode !== 'free') this.handRaw.copy(this.runner.hand);
      this.runner.cancel();
      this.mode = 'free';
      this.reachAdd = clamp(this.reachAdd - wheel * 0.0009, -0.18, 0.34);
      this.reachAdd *= Math.exp(-dt * 1.6);
      const r = this.handRaw;
      r.x = clamp(r.x + dx * SENS_HAND, -0.62, 0.66);
      r.y = clamp(r.y - dy * SENS_HAND, -0.28, 1.0);
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
      if (this.buffer > 0 && !wantGuard && k.kickT <= 0) {
        const a = this.runner.a;
        if (!a) this.startAttack(mx, mz, moving);
        else if (a.phase === 'recover' && a.t > a.recoverDur * 0.2 && !this.finisher) this.startAttack(mx, mz, moving);
      }
      if (this.runner.busy) {
        const a = this.runner.a;
        const ev = this.runner.update(dt, it, inp.lmb && !this.finisher && !this.sprintAttack);
        this.mode = a.charge > 0.05 && a.phase === 'wind' ? 'charge' : 'swing';
        this.comboT = 0;
        k.attackPhase = this.runner.phase;
        if (ev === 'strike') game.onSwing(k, a.heavy);
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
        this.runner.rest(dt, it, POSES.block, 20);
        it.edgeHint = BLOCK_EDGE;
        it.power = 1.5;
        speedMul = 0.5;
      } else {
        this.finisher = null;
        this.mode = 'guard';
        it.mode = 'guard';
        this.runner.rest(dt, it, k.sprinting ? POSES.carry : guardFor(def), k.sprinting ? 8 : 6);
      }
    }

    // ---------- sprint
    const sprint = shift && moving && k.dashT <= 0 && this.mode === 'guard' && !broken && !k.airborne;
    k.sprinting = sprint;
    if (sprint) speedMul *= 1.62;

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
    let speed = 5.0 * def.moveMul * k.speedMul * speedMul * (armed ? 1 : 1.08);
    if (this.lock && !sprint && mf < 0) speed *= 0.82;
    if (moveOn) it.move.set(moveX * speed, 0, moveZ * speed);
    else it.move.set(0, 0, 0);

    // ---------- tools
    if (pressed.has('KeyF') && !broken && this.runner.phase !== 'strike' && !this.finisher) {
      if (k.startKick(k.sprinting ? 1.6 : 1)) this.runner.cancel();
    }
    if (k.kickT > 0 && k.kickPower <= 1) it.move.multiplyScalar(0.15);
    if (pressed.has('KeyQ') && this.kunaiCd <= 0 && !broken) {
      this.kunaiCd = 0.45;
      game.throwKunai(k, this.lock, this.yaw, this.pitch);
    }
    if (pressed.has('KeyC')) game.playerHeal();
  }
}
