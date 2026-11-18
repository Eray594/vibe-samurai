import * as THREE from 'three';
import { rand, clamp, dampFactor, angleLerp } from './physics.js';
import { POSES, guardFor, BLOCK_EDGE, MOVESETS, AttackRunner, spinYaw } from './combat.js';
import { pick } from './roster.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h = new THREE.Vector3();
const _me = new THREE.Vector3();
const ARENA_KEEP = 12;

/** Opponent / ally mind: picks a target on the other side, closes in, circles, cuts, guards, evades. */
export class Brain {
  constructor(game, fighter, type) {
    this.game = game;
    this.k = fighter;
    this.type = type;
    this.runner = new AttackRunner();
    this.target = null;
    this.targetT = 0;
    this.cooldown = rand(0.9, 1.8);
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = rand(1.5, 3.5);
    this.aggr = rand(type.aggr[0], type.aggr[1]);
    this.blockSkill = rand(type.block[0], type.block[1]);
    this.blockT = 0;
    this.blockSide = 1;
    this.threatSeen = false;
    this.recoilT = 0;
    this.comboLeft = 0;
    this.pickT = 0;
    this.kickCd = rand(2, 6);
    this.flee = false;          // lost heart (maimed or bleeding out): backs away instead of pressing
    this.fleeRolled = false;
    this.pose = { hand: new THREE.Vector3(), dir: new THREE.Vector3() };   // scratch pose (guard side, breathing)
  }

  get attacking() { return this.runner.threatening; }
  get striking() { return this.runner.phase === 'strike'; }

  /** My cut was deflected: the blade is knocked wide, I'm open. */
  onParried() {
    this.runner.cancel();
    this.comboLeft = 0;
    this.recoilT = 0.8;
    this.cooldown = rand(0.8, 1.4);
    this.runner.hand.copy(POSES.recoil.hand);
    this.runner.bdir.copy(POSES.recoil.dir);
  }

  onHit(sev = 0.2) {
    // pain interrupts the wind-up; serious wounds make them back off
    if (sev > 0.25) this.recoilT = Math.max(this.recoilT, 0.4 + sev);
    if (this.runner.busy && this.runner.phase !== 'recover' && Math.random() < 0.5 + sev) {
      this.runner.cancel();
      this.comboLeft = 0;
      this.cooldown = rand(0.5, 1.0);
    }
    this.blockSkill = Math.min(0.85, this.blockSkill + 0.04);
  }

  pickTarget() {
    const me = this.k.getPos(_me);
    let best = null, bd = Infinity;
    for (const f of this.game.fighters) {
      if (f.team === this.k.team || f.state !== 'active' || f.dead || f.disposed) continue;
      const p = f.getPos(_w);
      const d = Math.hypot(p.x - me.x, p.z - me.z) * (f === this.target ? 0.8 : 1);   // a little loyalty to the current target
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  startAttack(first, vit) {
    const k = this.k, def = k.weapon.def, type = this.type;
    let name = pick(MOVESETS[def.key].ai);
    if (name === 'spin' && type.combo < 3) name = 'kesaR';      // only seasoned fighters spin
    const weight = 0.75 + def.swing.wind * 1.25;
    this.runner.start(name, def, {
      wind: rand(0.3, 0.55) / this.aggr * type.windMul * weight * (1.6 - 0.6 * vit) * (first ? 1 : 0.6),
      strike: def.swing.strike / (0.55 + 0.45 * vit),
      recover: def.swing.recover + 0.15,
      power: 1.15,
    });
    if (first) this.comboLeft = Math.floor(Math.random() * type.combo);
    else this.comboLeft--;
  }

  update(dt) {
    const k = this.k;
    const it = k.intent;
    const game = this.game;
    if (k.state !== 'active') { this.runner.cancel(); it.move.set(0, 0, 0); k.attackPhase = null; return; }

    this.targetT -= dt;
    const t0 = this.target;
    if (this.targetT <= 0 || !t0 || t0.state !== 'active' || t0.dead || t0.disposed) {
      this.target = this.pickTarget();
      this.targetT = 0.7;
    }
    const tgt = this.target;
    const def = k.weapon.def;
    const me = k.getPos(_me);
    const inj = k.inj;
    const vit = inj.vitality;

    this.cooldown -= dt;
    this.recoilT = Math.max(0, this.recoilT - dt);
    this.blockT = Math.max(0, this.blockT - dt);
    this.strafeT -= dt;
    if (this.strafeT < 0) { this.strafe *= -1; this.strafeT = rand(1.2, 3.5); }

    it.bladeDir = null;
    it.edgeHint = null;
    it.edgeExact = false;
    it.power = 1;

    // ---------- guard broken: reeling, wide open
    if (k.brokenT > 0) {
      this.runner.cancel();
      this.comboLeft = 0;
      this.blockT = 0;
      it.move.set(0, 0, 0);
      it.mode = 'guard';
      this.runner.rest(dt, it, POSES.broken, 7);
      k.attackPhase = null;
      this.cooldown = Math.max(this.cooldown, 0.6);
      return;
    }

    // ---------- disarmed: go and pick the weapon back up
    if (!this.fleeRolled && (k.armless || vit < 0.28)) { this.fleeRolled = true; this.flee = k.armless || Math.random() < 0.5; }
    if (!k.weapon.attached && !k.armless) {
      const wp = k.weapon.body.position;
      const wx = wp.x - me.x, wz = wp.z - me.z, wd = Math.hypot(wx, wz);
      it.yaw = angleLerp(it.yaw, Math.atan2(-wx, -wz), dampFactor(4, dt));
      it.move.set(wx / (wd || 1), 0, wz / (wd || 1)).multiplyScalar(wd > 0.6 ? 2.2 : 0);
      it.mode = 'guard';
      this.runner.cancel();
      this.runner.rest(dt, it, guardFor(def));
      k.attackPhase = null;
      this.pickT += dt;
      if (wd < 1.1 && this.pickT > 0.5) { k.tryRegrab(1.2); this.pickT = 0; }
      return;
    }

    // ---------- nobody left to fight
    if (!tgt) {
      it.move.set(0, 0, 0);
      if (this.runner.busy) this.runner.update(dt, it);
      else { it.mode = 'guard'; this.runner.rest(dt, it, guardFor(def)); }
      k.attackPhase = this.runner.phase;
      return;
    }

    const tp = tgt.getPos(_w);
    const dx = tp.x - me.x, dz = tp.z - me.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const fx = dx / dist, fz = dz / dist;
    const wantYaw = Math.atan2(-fx, -fz);
    it.yaw = angleLerp(it.yaw, wantYaw, dampFactor(this.striking ? 2.5 : 5, dt));

    // badly hurt fighters get cautious
    const wounded = vit < 0.45;
    const ideal = def.reach + 0.05 + (wounded ? 0.5 : 0);

    // ---------- locomotion
    let fwd = 0, side = 0;
    const speed = 4.0 * def.moveMul * this.aggr;
    if (this.flee && dist < 8 && !(k.weapon.attached && dist < ideal)) {
      fwd = -speed * 0.75;                                        // giving ground, eyes on the blade
    } else if (this.striking) {
      fwd = dist > def.reach * 0.7 ? 2.2 : 0.4;
    } else if (this.recoilT > 0 || k.staggerT > 0) {
      fwd = -0.6;
    } else if (dist > ideal + 0.35) {
      fwd = dist > ideal + 2.5 ? speed : speed * 0.6;
      if (dist > 5 && k.dashCd <= 0 && Math.random() < dt * 0.6) k.dash(_v.set(fx, 0, fz));
    } else if (dist < ideal - 0.4) {
      fwd = -1.4;
    } else {
      side = 1.4 * this.strafe;
    }
    const rx = -fz, rz = fx;
    let mx = fx * fwd + rx * side, mz = fz * fwd + rz * side;
    // keep some room between comrades
    for (const o of game.fighters) {
      if (o === k || o.team !== k.team || o.state !== 'active') continue;
      const op = o.core.position;
      const sx = me.x - op.x, sz = me.z - op.z;
      const d = Math.hypot(sx, sz);
      if (d < 1.7 && d > 0.001) { mx += (sx / d) * (1.7 - d) * 2.5; mz += (sz / d) * (1.7 - d) * 2.5; }
    }
    // stay inside the courtyard
    const r = Math.hypot(me.x, me.z);
    if (r > ARENA_KEEP) { mx -= (me.x / r) * (r - ARENA_KEEP) * 3; mz -= (me.z / r) * (r - ARENA_KEEP) * 3; }
    it.move.set(mx, 0, mz);

    // ---------- reading the opponent: evade, guard or (rarely) deflect
    const tw = tgt.weapon;
    let threat = false;
    if (tw && tw.attached && dist < tw.def.reach + 1.6) {
      if (tgt.attackPhase === 'wind' || tgt.attackPhase === 'strike') threat = true;
      else if (tw.tipSpeed > 7.5 && tw.worldPoint(tw.tipLocal, _h).distanceTo(k.getHeadPos(_v)) < 2.0) threat = true;
    }
    if (!threat) this.threatSeen = false;
    else if (!this.threatSeen && !this.striking && this.recoilT <= 0) {       // a blade just knocked wide cannot answer
      this.threatSeen = true;       // one decision per incoming attack
      const sober = (0.4 + 0.6 * vit) * (1 - inj.dizzy);
      if (k.dashCd <= 0 && Math.random() < 0.14 * sober) {
        const sd = Math.random() < 0.5 ? 1 : -1;
        k.dash(_v.set(-fx + rx * sd * 0.8, 0, -fz + rz * sd * 0.8).normalize());
      } else if (Math.random() < this.blockSkill * sober) {
        this.blockT = rand(0.55, 0.9);
        k.aiDeflect = Math.random() < this.type.deflect;
        this.runner.cancel();
        this.comboLeft = 0;
        const tip = tw.worldPoint(tw.tipLocal, _h).sub(me).applyQuaternion(k.yawQuat().clone().invert());
        this.blockSide = tip.x >= 0 ? 1 : -1;
      }
    }

    // ---------- attacks
    const canAttack = this.blockT <= 0 && this.recoilT <= 0 && k.staggerT <= 0 && k.kickT <= 0 && k.weapon.attached;
    // a kick: to break open a turtle, or just to make room
    this.kickCd -= dt;
    if (!this.runner.busy && canAttack && this.kickCd <= 0 && dist < 1.55 && (tgt.guardT > 0.7 || Math.random() < dt * 0.3)) {
      if (k.startKick(1)) this.kickCd = rand(4, 8);
    }
    if (!this.runner.busy && canAttack && this.cooldown <= 0 && dist < ideal + 0.5 && !(this.flee && dist > ideal)
        && Math.random() < 0.3 + 0.7 * vit && game.attackTokens(k.team) < game.maxTokens(k.team)) {
      if (dist > ideal + 0.2 && k.dashCd <= 0 && Math.random() < 0.35) k.dash(_v.set(fx, 0, fz));
      this.startAttack(true, vit);
    }

    if (this.blockT > 0) {
      it.mode = 'parry';
      const s = this.blockSide, bp = this.pose;
      bp.hand.set(0.12 * s, 0.42, -0.4);
      bp.dir.set(-0.85 * s, 0.5, -0.15).normalize();
      this.runner.rest(dt, it, bp, 16);
      it.edgeHint = BLOCK_EDGE;
      it.power = 1.4;
    } else if (this.runner.busy) {
      const spin = spinYaw(this.runner.a, k);
      if (spin != null) it.yaw = spin;
      const ev = this.runner.update(dt, it);
      if (ev === 'strike') game.onSwing(k);
      if (ev === 'recover' && this.comboLeft > 0 && canAttack && dist < ideal + 0.9) this.startAttack(false, vit);
      else if (ev === 'done') this.cooldown = rand(0.5, 1.6) / this.aggr;
    } else {
      it.mode = 'guard';
      const g = guardFor(def), ip = this.pose;
      ip.hand.copy(g.hand).y += Math.sin(performance.now() * 0.002 + k.id) * 0.012;   // breathing
      ip.dir.copy(g.dir);
      this.runner.rest(dt, it, ip, this.recoilT > 0 ? 2 : 5);
    }
    k.attackPhase = this.runner.phase;
  }
}
