import * as THREE from 'three';
import { rand, clamp, dampFactor, angleLerp, angleDiff } from './physics.js';
import { POSES, guardFor, BLOCK_EDGE, MOVESETS, AttackRunner, spinYaw } from './combat.js';
import { pick } from './roster.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h = new THREE.Vector3();
const _me = new THREE.Vector3();
const _a = new THREE.Vector3();
const _r = new THREE.Vector3();
const ARENA_KEEP = 12;
const ATTACK_THRUST = new Set(['tsuki', 'tsukiLow']);

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
    this.tele = null;           // what the wind-up announces: 'thrust' | 'sweep' | 'heavy' | 'arrow' | 'gun'
    this.fearT = 0;             // shaken by what just happened to a comrade
    this.shotCd = rand(1.5, 3.5);
    this.aimPoint = new THREE.Vector3();
    this.aimLocked = false;
    this.pushT = 0;
    this.climbCd = 0;
    this.climbing = false;
    this.post = null;           // hired soldiers: the spot to hold ...
    this.leash = 6;             // ... how far from it they will go for someone ...
    this.follow = false;        // ... or whether they stay at the player's side instead
    this.raider = false;        // defense: goes for the shrine rather than for people
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

  /** Where a hired soldier belongs: at his post, or at the player's side. */
  anchor() { return this.post ? (this.follow ? this.game.player.getPos(_a) : this.post) : null; }

  pickTarget() {
    const me = this.k.getPos(_me);
    const anchor = this.anchor(), leash = this.follow ? Math.min(this.leash, 7) : this.leash;
    let best = null, bd = Infinity;
    for (const f of this.game.fighters) {
      if (f.team === this.k.team || f.state !== 'active' || f.dead || f.disposed) continue;
      const p = f.getPos(_w);
      if (anchor && Math.hypot(p.x - anchor.x, p.z - anchor.z) > leash) continue;       // not his to chase
      const d = Math.hypot(p.x - me.x, p.z - me.z) * (f === this.target ? 0.8 : 1);   // a little loyalty to the current target
      if (d < bd) { bd = d; best = f; }
    }
    const def = this.game.defense;
    if (def?.active && this.k.team === 1) return def.chooseTarget(this, best, bd, me);
    return best;
  }

  startAttack(first, vit) {
    const k = this.k, def = k.weapon.def, type = this.type;
    let name = pick(MOVESETS[def.key].ai);
    if (name === 'spin' && type.combo < 3) name = 'kesaR';      // only seasoned fighters spin
    if (k.mountH > 0) name = def.key === 'yari' ? 'tsuki' : pick(['yokoR', 'yokoL', 'kesaR']);
    // training: the partner does exactly what the drill is about
    const drill = this.game.training?.drill;
    if (drill === 'thrust') name = 'tsuki';
    else if (drill === 'sweep') name = 'ashi';
    else if (drill === 'cut' || drill === 'heavy') name = pick(['kesaR', 'kesaL', 'shomen', 'yokoR']);
    const weight = 0.75 + def.swing.wind * 1.25;
    // now and then a slow blow with everything behind it: it goes straight through a guard
    const heavy = drill && drill !== 'free' ? drill === 'heavy'
      : first && k.mountH <= 0 && Math.random() < (type.heavy || 0) && !ATTACK_THRUST.has(name) && name !== 'spin';
    const a = this.runner.start(name, def, {
      wind: rand(0.3, 0.55) / this.aggr * type.windMul * weight * (1.6 - 0.6 * vit) * (first ? 1 : 0.6) * (heavy ? 1.7 : 1),
      strike: def.swing.strike / (0.55 + 0.45 * vit),
      recover: def.swing.recover + 0.15 + (heavy ? 0.25 : 0),
      power: heavy ? 1.55 : 1.15, heavy,
    });
    a.unblockable = heavy;
    this.tele = heavy ? 'heavy' : a.thrust ? 'thrust' : a.low ? 'sweep' : 'cut';
    this.game.onTelegraph?.(k, this.tele);
    if (first) this.comboLeft = Math.floor(Math.random() * type.combo);
    else this.comboLeft--;
  }

  update(dt) {
    const k = this.k;
    const it = k.intent;
    const game = this.game;
    if (k.state !== 'active') { this.runner.cancel(); it.move.set(0, 0, 0); k.attackPhase = null; k.atk = null; k.aimT = 0; this.tele = null; return; }
    this.fearT = Math.max(0, this.fearT - dt);
    k.atk = this.runner.a;
    if (this.runner.phase !== 'wind' && k.aimT <= 0) this.tele = null;
    // ---------- held by the collar or locked blade on blade: nothing to decide
    if (k.heldBy || k.bound) {
      this.runner.cancel();
      this.blockT = 0;
      it.move.set(0, 0, 0);
      it.mode = 'guard';
      it.bladeDir = null; it.edgeHint = null; it.edgeExact = false; it.power = k.bound ? 1.6 : 0.5;
      this.runner.rest(dt, it, k.bound ? POSES.bind : POSES.broken, k.bound ? 16 : 7);
      if (k.bound && this.target) { const tp = this.target.getPos(_w), me = k.getPos(_me); it.yaw = Math.atan2(-(tp.x - me.x), -(tp.z - me.z)); }
      k.attackPhase = null; k.atk = null; k.aimT = 0;
      return;
    }

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
    if (k.stuckT > 0) { this.recoilT = Math.max(this.recoilT, k.stuckT); this.runner.cancel(); }       // blade caught: nothing to do but pull
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
    const afraid = this.flee || this.fearT > 0;
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
      const home = this.anchor();
      if (home && k.mountH <= 0) {
        // back to the post (or to the player's heel)
        const hx = home.x - me.x, hz = home.z - me.z, hd = Math.hypot(hx, hz);
        if (hd > (this.follow ? 2.6 : 0.6)) {
          const sp = Math.min(4 * def.moveMul, hd * 2 + 0.6);
          this.steer((hx / hd) * sp, (hz / hd) * sp, me, home);
          it.yaw = angleLerp(it.yaw, Math.atan2(-it.move.x, -it.move.z), dampFactor(5, dt));
        }
      }
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
    if (k.mountH > 0) { this.rideUpdate(dt, tgt, dist, fx, fz, wantYaw, me, vit); return; }
    it.yaw = angleLerp(it.yaw, wantYaw, dampFactor(this.striking ? 2.5 : 5, dt));
    if (this.type.ranged && !afraid && k.weapon.attached && this.shootUpdate(dt, tgt, dist, fx, fz, me, vit)) return;
    k.aimT = 0;

    // badly hurt fighters get cautious
    const wounded = vit < 0.45;
    const ideal = def.reach + 0.05 + (wounded ? 0.5 : 0);

    // ---------- locomotion
    let fwd = 0, side = 0;
    const speed = 4.0 * def.moveMul * this.aggr;
    if (afraid && dist < (this.fearT > 0 ? 11 : 8) && !(this.flee && k.weapon.attached && dist < ideal)) {
      fwd = -speed * (this.fearT > 0 ? 0.95 : 0.75);              // giving ground, eyes on the blade
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
    // the target stands on something higher: go straight at it and climb after
    this.climbCd -= dt;
    this.climbing = tgt.groundY > k.groundY + 0.5 || (k.airborne && this.climbing);
    if (this.climbing && !afraid) {
      fwd = speed; side = 0;
      if (!k.airborne && this.climbCd <= 0 && k.staggerT <= 0 && game.wallNear(k, 1.15)?.top) { if (k.jump(1.2)) { this.climbCd = 1.6; game.onJump(k); } }
    }
    this.steer(fx * fwd + rx * side, fz * fwd + rz * side, me, tp);
    if (game.training?.drill === 'passive') { this.cooldown = 1; this.threatSeen = true; this.kickCd = 5; }

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
        k.aiDeflect = Math.random() < Math.min(0.6, this.type.deflect * 1.3);       // blades meet more often
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
    if (!this.runner.busy && canAttack && this.cooldown <= 0 && dist < ideal + 0.5 && !(afraid && dist > ideal) && this.fearT <= 0
        && Math.random() < 0.3 + 0.7 * vit && game.attackTokens(k.team) < game.maxTokens(k.team)) {
      if (dist > ideal + 0.2 && k.dashCd <= 0 && Math.random() < 0.35) k.dash(_v.set(fx, 0, fz));
      this.startAttack(true, vit);
    }

    if (this.blockT > 0) {
      it.mode = 'parry';
      const s = this.blockSide, bp = this.pose;
      bp.hand.set(0.12 * s, 0.42, -0.4);
      bp.dir.set(-0.85 * s, 0.5, -0.15).normalize();
      this.runner.rest(dt, it, bp, 24);
      it.edgeHint = BLOCK_EDGE;
      it.power = 1.4;
    } else if (this.runner.busy) {
      const spin = spinYaw(this.runner.a, k);
      if (spin != null) it.yaw = spin;
      const ev = this.runner.update(dt, it);
      if (ev === 'strike') { game.onSwing(k); if (tgt.isStructure && dist < ideal + 1.1) game.defense.hitStructure(tgt, k, !!this.runner.a?.unblockable); }
      if (ev === 'recover' && !tgt.isStructure && game.checkWhiff(k, this.runner.a, null)) { this.comboLeft = 0; this.recoilT = Math.max(this.recoilT, 0.55); }
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
    k.atk = this.runner.a;
  }

  /** Move intent with room kept between comrades and the wall. */
  steer(mx, mz, me, goal) {
    const k = this.k;
    // defense: the palisade is in the way, so head for a gate instead
    const fort = this.game.defense;
    if (goal && fort?.active) {
      const sp = Math.hypot(mx, mz);
      if (sp > 0.5 && mx * (goal.x - me.x) + mz * (goal.z - me.z) > 0) {
        const dir = fort.route(me, goal, _r);
        if (dir) { mx = dir.x * sp; mz = dir.z * sp; }
      }
    }
    for (const o of this.game.fighters) {
      if (o === k || o.team !== k.team || o.state !== 'active') continue;
      const op = o.core.position;
      const sx = me.x - op.x, sz = me.z - op.z;
      const d = Math.hypot(sx, sz);
      if (d < 1.7 && d > 0.001) { mx += (sx / d) * (1.7 - d) * 2.5; mz += (sz / d) * (1.7 - d) * 2.5; }
    }
    const r = Math.hypot(me.x, me.z);
    if (r > ARENA_KEEP) { mx -= (me.x / r) * (r - ARENA_KEEP) * 3; mz -= (me.z / r) * (r - ARENA_KEEP) * 3; }
    k.intent.move.set(mx, 0, mz);
  }

  /**
   * Archers and gunners: keep their distance, draw, loose. Returns false when the target is close
   * enough that the short sword has to do (the normal melee logic then takes over).
   */
  shootUpdate(dt, tgt, dist, fx, fz, me, vit) {
    const k = this.k, it = k.intent, gun = this.type.ranged === 'gun';
    if (dist < 3.2 && k.aimT <= 0) return false;
    const fort = this.game.defense, holds = this.post && !this.follow;       // a hired archer shoots from where he was put
    // defense: no shooting through the palisade; come in (or out) through a gate first
    if (fort?.active && k.aimT <= 0 && !holds && (Math.hypot(me.x, me.z) < 6.2) !== (Math.hypot(tgt.core.position.x, tgt.core.position.z) < 6.2)) {
      this.runner.cancel(); this.blockT = 0; k.attackPhase = null; k.atk = null;
      it.mode = 'guard';
      this.runner.rest(dt, it, POSES.carry, 6);
      const sp = 3.6 * this.aggr;
      this.steer(fx * sp, fz * sp, me, tgt.core.position);
      return true;
    }
    this.runner.cancel();
    this.blockT = 0;
    k.attackPhase = null; k.atk = null;
    it.mode = 'guard';
    this.runner.rest(dt, it, POSES.carry, 6);
    const speed = 3.6 * this.aggr;
    const rx = -fz, rz = fx;
    if (k.aimT > 0) {
      // drawn: stand still, follow the target until the last moment, then let fly
      k.aimT -= dt;
      it.move.set(0, 0, 0);
      const lockAt = gun ? 0.32 : 0.12;
      if (!this.aimLocked) {
        const tv = tgt.state === 'active' ? tgt.core.velocity : null;
        const lead = gun ? 0 : dist / 30 * 0.85;
        this.aimPoint.copy(tgt.parts.torso.position);
        this.aimPoint.y += 0.25;
        if (tv) { this.aimPoint.x += tv.x * lead; this.aimPoint.z += tv.z * lead; }
        if (k.aimT <= lockAt) this.aimLocked = true;
      }
      if (k.aimT <= 0 || dist < 2.2) {
        if (k.aimT <= 0) {
          if (gun) this.game.fireGun(k, this.aimPoint); else this.game.fireArrow(k, this.aimPoint);
          if (tgt.isStructure) this.game.defense.hitStructure(tgt, k, false, gun ? 1.5 : 0.75);
        }
        k.aimT = 0;
        this.tele = null;
        this.shotCd = (gun ? rand(5, 7.5) : rand(2.4, 4)) / this.aggr;
      }
      return true;
    }
    let fwd = 0, side = 0;
    if (dist < 7) fwd = -speed * 0.85;
    else if (dist > 12.5) fwd = speed * 0.8;
    else side = 1.1 * this.strafe;
    if (holds) { fwd = 0; side = 0; }
    this.steer(fx * fwd + rx * side, fz * fwd + rz * side, me);
    this.shotCd -= dt * (0.5 + 0.5 * vit);
    if (this.shotCd <= 0 && dist < 17 && k.staggerT <= 0) {
      k.aimT = (gun ? 1.6 : 0.95) / (0.6 + 0.4 * vit);
      this.aimLocked = false;
      this.tele = gun ? 'gun' : 'arrow';
      this.game.onTelegraph?.(k, this.tele);
    }
    return true;
  }

  /** On horseback: gallop past in wide arcs and cut on the way through. */
  rideUpdate(dt, tgt, dist, fx, fz, wantYaw, me, vit) {
    const k = this.k, it = k.intent, def = k.weapon.def, game = this.game;
    const r = Math.hypot(me.x, me.z);
    let aimYaw = wantYaw;
    // past the target: keep going a while before wheeling round; near the wall: turn back in
    const ahead = Math.cos(angleDiff(it.yaw, wantYaw));
    if (dist < 4 && ahead < 0.2) aimYaw = it.yaw;
    if (r > 9.5) aimYaw = Math.atan2(me.x, me.z) + (this.strafe > 0 ? 0.5 : -0.5);
    const turn = dampFactor(r > 9.5 ? 3.2 : 1.9, dt);
    it.yaw = angleLerp(it.yaw, aimYaw, turn);
    const sp = (k.staggerT > 0 ? 4 : 8.6) * this.aggr * (0.5 + 0.5 * vit);
    it.move.set(-Math.sin(it.yaw) * sp, 0, -Math.cos(it.yaw) * sp);
    it.bladeDir = null; it.edgeHint = null; it.edgeExact = false; it.power = 1;
    const canAttack = k.staggerT <= 0 && k.weapon.attached && this.recoilT <= 0;
    if (!this.runner.busy && canAttack && this.cooldown <= 0 && dist < def.reach + 2.6 && ahead > 0.3) this.startAttack(true, vit);
    if (this.runner.busy) {
      const ev = this.runner.update(dt, it);
      if (ev === 'strike') game.onSwing(k);
      else if (ev === 'done') this.cooldown = rand(1.2, 2.2);
    } else {
      it.mode = 'guard';
      this.runner.rest(dt, it, POSES.carry, 5);
    }
    k.attackPhase = this.runner.phase;
    k.atk = this.runner.a;
  }
}
