import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  materials, setGroup, G, MASK, toC, toT, qToT, quatError, worldInertiaMul, clamp, dampFactor, smooth, rand,
  interpPos, interpQuat, snapPrev,
} from './physics.js';
import { Weapon } from './weapons.js';
import { Injuries } from './injury.js';
import { buildParts, SHOULDER } from './figure.js';
import { L, POSTURE } from './combat.js';

export const STAND_H = 0.98;
const UP = new THREE.Vector3(0, 1, 0);

const WAIST_Y = 0.08;                        // torso origin relative to pelvis
const ARM = { upper: 0.3, fore: 0.3 };
const LEG = { hipX: 0.1, hipY: -0.05, thigh: 0.46, shin: 0.46 };

// Ragdoll description: centre offset (from the part's joint origin), collision shape, mass.
const PART_DEFS = {
  pelvis: { co: [0, 0, 0], box: [0.16, 0.1, 0.11], mass: 12 },
  torso: { co: [0, 0.25, 0], box: [0.19, 0.24, 0.12], mass: 24 },
  head: { co: [0, 0.15, 0], sphere: 0.13, mass: 5 },
  uArmR: { co: [0, -0.15, 0], box: [0.05, 0.15, 0.05], mass: 3 },
  uArmL: { co: [0, -0.15, 0], box: [0.05, 0.15, 0.05], mass: 3 },
  fArmR: { co: [0, -0.15, 0], box: [0.045, 0.15, 0.045], mass: 2.2 },
  fArmL: { co: [0, -0.15, 0], box: [0.045, 0.15, 0.045], mass: 2.2 },
  thighR: { co: [0, -0.23, 0], box: [0.07, 0.22, 0.07], mass: 8 },
  thighL: { co: [0, -0.23, 0], box: [0.07, 0.22, 0.07], mass: 8 },
  shinR: { co: [0, -0.23, 0], box: [0.055, 0.23, 0.055], mass: 4.5 },
  shinL: { co: [0, -0.23, 0], box: [0.055, 0.23, 0.055], mass: 4.5 },
};
const PART_NAMES = Object.keys(PART_DEFS);

// [child, parent, axisA (parent-local), axisB (child-local), cone angle, twist, hinge side]
// Elbows and knees are hinges (0..~115° in one plane only); "hinge side" is the anatomical bend
// axis along the parent's local x (+1 elbow: forearm swings forward, -1 knee: shin swings back).
const JOINTS = [
  ['torso', 'pelvis', [0, 1, 0], [0, 1, 0], 0.45, 0.3],
  ['head', 'torso', [0, 1, 0], [0, 1, 0], 0.55, 0.5],
  ['uArmR', 'torso', [0, -1, 0], [0, -1, 0], 1.9, 0.7],
  ['uArmL', 'torso', [0, -1, 0], [0, -1, 0], 1.9, 0.7],
  ['fArmR', 'uArmR', [0, -0.5, -0.87], [0, -1, 0], 1.0, 0.1, 1],
  ['fArmL', 'uArmL', [0, -0.5, -0.87], [0, -1, 0], 1.0, 0.1, 1],
  ['thighR', 'pelvis', [0, -0.87, -0.5], [0, -1, 0], 0.9, 0.3],
  ['thighL', 'pelvis', [0, -0.87, -0.5], [0, -1, 0], 0.9, 0.3],
  ['shinR', 'thighR', [0, -0.5, 0.87], [0, -1, 0], 1.0, 0.1, -1],
  ['shinL', 'thighL', [0, -0.5, 0.87], [0, -1, 0], 1.0, 0.1, -1],
];
const HINGE_AXIS = new CANNON.Vec3();
const KICK_DUR = 0.46;
const ARM_SHAPES = ['uArmR', 'fArmR', 'uArmL', 'fArmL'];
/** What comes off when a part is severed (the part plus everything below it). */
export const SEVER_CHAIN = {
  head: ['head'], uArmR: ['uArmR', 'fArmR'], fArmR: ['fArmR'], uArmL: ['uArmL', 'fArmL'], fArmL: ['fArmL'],
  thighR: ['thighR', 'shinR'], shinR: ['shinR'], thighL: ['thighL', 'shinL'], shinL: ['shinL'],
};
const PARENT_OF = Object.fromEntries(JOINTS.map(([c, p]) => [c, p]));
export const ZONE_OF_PART = {
  head: 'head', torso: 'torso', pelvis: 'torso',
  uArmR: 'limb', uArmL: 'limb', fArmR: 'limb', fArmL: 'limb',
  thighR: 'leg', thighL: 'leg', shinR: 'leg', shinL: 'leg',
};

// ------------------------------------------------------------------ IK helpers
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

function solveTwoBone(root, target, a, b, pole, outMid, outEnd) {
  _d.copy(target).sub(root);
  let dist = _d.length();
  if (dist < 1e-5) { _d.set(0, -1, 0); dist = 1e-5; }
  _d.divideScalar(dist);
  dist = clamp(dist, Math.abs(a - b) + 0.02, a + b - 0.002);
  const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, 0, -1);
  _p.normalize();
  outMid.copy(root).addScaledVector(_d, a * cosA).addScaledVector(_p, a * sinA);
  outEnd.copy(root).addScaledVector(_d, dist);
}

/** Orient a limb group so its -Y axis runs from start to end, with +Z biased towards `backHint`. */
function placeLimb(obj, start, end, backHint) {
  _y.copy(start).sub(end);
  if (_y.lengthSq() < 1e-10) _y.set(0, 1, 0);
  _y.normalize();
  _z.copy(backHint).addScaledVector(_y, -backHint.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m4.makeBasis(_x, _y, _z);
  obj.position.copy(start);
  obj.quaternion.setFromRotationMatrix(_m4);
}

// scratch
const T = {
  pos: new THREE.Vector3(), q: new THREE.Quaternion(), yawQ: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(),
  a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), e: new THREE.Vector3(),
  fwd: new THREE.Vector3(), right: new THREE.Vector3(), back: new THREE.Vector3(),
  mid: new THREE.Vector3(), end: new THREE.Vector3(), eul: new THREE.Euler(),
};
const C = { v: new CANNON.Vec3(), v2: new CANNON.Vec3(), q: new CANNON.Quaternion() };

const WOUND_GEO = new THREE.SphereGeometry(1, 10, 6);
const WOUND_MAT = {
  blood: new THREE.MeshStandardMaterial({ color: 0x4a0404, roughness: 0.22, metalness: 0.1 }),
  bruise: new THREE.MeshStandardMaterial({ color: 0x1c1a1a, roughness: 0.6, metalness: 0.5 }),
};
const T_INV = new THREE.Matrix4();

let fighterIdCounter = 1;

export class Samurai {
  constructor(game, opts) {
    this.game = game;
    this.id = fighterIdCounter++;
    this.isPlayer = !!opts.isPlayer;
    this.team = opts.team ?? (this.isPlayer ? 0 : 1);   // 0 = the player's side, 1 = opponents
    this.kind = opts.kind ?? null;                      // roster entry (opponents)
    this.name = opts.name ?? '';
    this.style = opts.style;
    this.speedMul = opts.speedMul ?? 1;
    this.posture = 0;           // pressure on the guard, breaks at postureMax
    this.postureMax = opts.posture ?? 1;
    this.postureIdle = 9;
    this.brokenT = 0;           // guard broken: staggered and open to a finishing blow
    this.guardT = 0;            // how long the guard has been up
    this.aiDeflect = false;     // AI: the current guard is a perfect deflection
    this.iframeT = 0;           // untouchable while slipping out of the way
    this.attackPhase = null;    // 'wind' | 'strike' | 'recover', set by the controller
    this.liveT = 0;             // > 0 during and just after a strike: the blade cuts at full force
    this.sprinting = false;
    this.runLean = 0;
    this.crouch = 0.05;         // how deep the fighter sits in the stance
    this.dyingT = 0;            // muscles let go over this time after a killing blow
    this.kickT = 0;             // front kick in progress
    this.kickCd = 0;
    this.kickPower = 1;
    this.kickHit = false;
    this.ghostT = 0;            // rushing through opponents (dash-cut)
    this.crawling = false;      // down, awake, dragging himself away
    this.crawlPhase = Math.random() * 6;
    this.crawlDir = new THREE.Vector3(0, 0, 1);
    this.crawlT = 0;
    this.crawlRest = false;
    this.trailT = 0;
    this.blendDur = 0.55;
    this.inj = new Injuries(opts.armor ?? 0.8);
    this.wounds = [];
    this.dripT = 0;
    this.wobble = new THREE.Vector3();
    this.wobbleT = 0;
    this.severed = new Set();
    this.jointPivots = {};
    this.airborne = false;
    this.dashT = 0;
    this.dashCd = 0;
    this.balance = 1;
    this.state = 'active';     // 'active' | 'ragdoll'
    this.dead = false;
    this.ragTime = 0;
    this.getUpAt = 0;
    this.blendT = 1;
    this.blendFrom = null;
    this.staggerT = 0;
    this.hitFlash = 0;

    const { parts, mats } = buildParts(this.style);
    this.parts = parts;
    this.mats = mats;
    for (const n of PART_NAMES) game.scene.add(parts[n]);

    // intent written by controller (player input / AI)
    this.intent = {
      move: new THREE.Vector3(),          // desired world-space horizontal velocity
      yaw: opts.yaw ?? 0,                 // desired facing
      hand: L(0.16, 0.36, 0.42),          // control point, character-local
      mode: 'guard',                      // guard | swing | parry | thrust
      bladeDir: null,                     // optional local blade direction override
      edgeHint: null,                     // optional local edge direction
      edgeExact: false,                   // edge must lead exactly along edgeHint (a deliberate cut)
      power: 1,
    };
    this.edgeLocal = new THREE.Vector3(0, 1, 0);
    this.prevHandLocal = this.intent.hand.clone();
    this.handVelLocal = new THREE.Vector3();
    this.twist = 0;
    this.lean = 0;
    this.gaitPhase = Math.random() * 6;
    this.weaponTarget = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), angVel: new THREE.Vector3() };
    this.prevTargetPos = null;
    this.prevTargetQuat = new THREE.Quaternion();
    this.weaponStuckT = 0;
    this.yawActual = this.intent.yaw;

    this.createCore(opts.position, this.intent.yaw);
    this.weapon = null;
    this.setWeapon(opts.weapon ?? 'longsword');
    this.ragBodies = null;
    this.ragConstraints = null;
    this.updateActivePose(0);
  }

  // ---------------------------------------------------------------- physics body
  createCore(pos, yaw) {
    const b = new CANNON.Body({ mass: 80, material: materials.body, linearDamping: 0.05, angularDamping: 0.15 });
    b.addShape(new CANNON.Box(new CANNON.Vec3(0.17, 0.1, 0.12)), new CANNON.Vec3(0, 0, 0));
    b.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 0.24, 0.13)), new CANNON.Vec3(0, 0.33, 0));
    b.addShape(new CANNON.Sphere(0.14), new CANNON.Vec3(0, 0.73, 0));
    b.addShape(new CANNON.Box(new CANNON.Vec3(0.13, 0.24, 0.1)), new CANNON.Vec3(0, -0.36, 0));
    // arm colliders follow the IK pose every frame, so blades can hit the arms
    for (const n of ARM_SHAPES) b.addShape(new CANNON.Box(new CANNON.Vec3(0.055, 0.15, 0.055)), new CANNON.Vec3(0, 0.3, -0.3));
    const tags = [['pelvis', 'torso'], ['torso', 'torso'], ['head', 'head'], ['thigh', 'leg'], ...ARM_SHAPES.map((n) => [n, n.endsWith('R') ? 'armR' : 'armL'])];
    b.shapes.forEach((sh, i) => { sh.hsPart = tags[i][0]; sh.hsZone = tags[i][1]; });
    b.position.set(pos.x, STAND_H, pos.z);
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
    b.hs = { type: 'core', knight: this };
    setGroup(b, this.team === 0 ? 'PCORE' : 'ECORE');
    snapPrev(b);
    this.core = b;
    this.airborne = false;
    this.yawActual = yaw;
    this.game.world.addBody(b);
  }

  /** World-space position (THREE) - fresh copy. */
  getPos(out = new THREE.Vector3()) {
    const b = this.state === 'active' ? this.core : this.ragBodies.pelvis;
    return out.set(b.position.x, b.position.y, b.position.z);
  }
  getHeadPos(out = new THREE.Vector3()) {
    return out.copy(this.parts.head.position).add(T.a.set(0, 0.16, 0).applyQuaternion(this.parts.head.quaternion));
  }

  setWeapon(key) {
    if (this.weapon) this.weapon.dispose();
    this.weapon = new Weapon(this.game, key, this);
    this.weapon.attach();
    this.computeWeaponTarget(0);
    this.weapon.teleport(this.weaponTarget.pos, this.weaponTarget.quat);
    this.prevTargetPos = null;
  }

  // ---------------------------------------------------------------- frames
  yawQuat(out = T.yawQ) {
    return out.setFromAxisAngle(UP, this.yawActual);
  }
  /** character-local (yaw-only frame) → world, anchored on the core. */
  localToWorld(local, out) {
    const p = this.core.position;
    return out.copy(local).applyQuaternion(this.yawQuat()).add(T.e.set(p.x, p.y, p.z));
  }

  // ---------------------------------------------------------------- per-frame logic
  computeWeaponTarget(dt) {
    const it = this.intent;
    const hand = T.a.copy(it.hand);
    // keep the control point within reach of the shoulders
    const sh = T.b.set(this.weapon?.def.twoHanded ? 0.05 : 0.17, WAIST_Y + SHOULDER.y, 0);
    const reach = it.mode === 'thrust' ? 0.95 : 0.72;
    const off = T.c.copy(hand).sub(sh);
    if (off.length() > reach) hand.copy(sh).add(off.setLength(reach));
    // weak / wounded arms can't hold the weapon up
    const armStr = this.inj.armStrength(this.weapon?.def.twoHanded, this.offHanded);
    hand.y -= (1 - armStr) * 0.35;
    if (this.brokenT > 0) { hand.y -= 0.28; hand.z += 0.1; }   // guard broken: the blade sags
    if (this.dizzyAmt > 0) hand.addScaledVector(this.wobble, 0.12 * this.dizzyAmt);
    if (hand.y < -0.35) hand.y = -0.35;

    // blade direction (local)
    let d = T.b;
    if (it.bladeDir) d.copy(it.bladeDir).normalize();
    else {
      d.copy(hand).sub(L(0, 0.3, -0.15)).normalize();
      d.y += clamp(0.62 + 0.35 * (hand.y - 0.35), 0.05, 0.9) * (this.weapon?.def.upBias ?? 1);
      d.normalize();
    }
    // edge direction: follow swing direction (sign-agnostic, both edges cut)
    if (dt > 0) {
      this.handVelLocal.copy(hand).sub(this.prevHandLocal).divideScalar(dt);
      this.prevHandLocal.copy(hand);
    }
    let target;
    if (it.edgeHint) target = T.e.copy(it.edgeHint);
    else {
      target = T.e.copy(this.handVelLocal).addScaledVector(d, -this.handVelLocal.dot(d));
      if (target.length() < 0.6) target.copy(this.edgeLocal);
    }
    target.addScaledVector(d, -target.dot(d));
    if (target.lengthSq() < 1e-6) target.set(0, 1, 0).addScaledVector(d, -d.y);
    target.normalize();
    // curved single-edged blades lead with the edge; straight ones cut either way
    const exact = it.edgeExact || (!!this.weapon?.def.curve && !it.edgeHint);
    if (!exact && target.dot(this.edgeLocal) < 0) target.negate();
    if (exact && target.dot(this.edgeLocal) < -0.3) this.edgeLocal.addScaledVector(T.c.crossVectors(d, target), 0.35);
    this.edgeLocal.lerp(target, dt > 0 ? dampFactor(exact ? 18 : it.edgeHint ? 14 : 7, dt) : 1);
    this.edgeLocal.addScaledVector(d, -this.edgeLocal.dot(d));
    if (this.edgeLocal.lengthSq() < 1e-6) this.edgeLocal.copy(target);
    this.edgeLocal.normalize();

    _x.copy(this.edgeLocal);
    _y.copy(d);
    _z.crossVectors(_x, _y);
    _m4.makeBasis(_x, _y, _z);
    const wt = this.weaponTarget;
    wt.quat.setFromRotationMatrix(_m4).premultiply(this.yawQuat());
    this.localToWorld(hand, wt.pos);

    if (dt > 0 && this.prevTargetPos) {
      wt.vel.copy(wt.pos).sub(this.prevTargetPos).divideScalar(dt);
      if (wt.vel.length() > 22) wt.vel.setLength(22);
      quatError(wt.quat, this.prevTargetQuat, wt.angVel).divideScalar(dt);
      if (wt.angVel.length() > 30) wt.angVel.setLength(30);
    } else {
      wt.vel.set(0, 0, 0); wt.angVel.set(0, 0, 0);
      this.prevTargetPos = new THREE.Vector3();
    }
    this.prevTargetPos.copy(wt.pos);
    this.prevTargetQuat.copy(wt.quat);

    // torso twist / lean follow the hands
    const k = dt > 0 ? dampFactor(8, dt) : 1;
    this.twist += (clamp(-hand.x * 0.75, -0.5, 0.5) - this.twist) * k;
    this.lean += (clamp((-hand.z - 0.4) * 0.5, -0.1, 0.25) - this.lean) * k;
  }

  update(dt) {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    const inj = this.inj;
    const wasDead = this.dead;
    inj.update(dt);
    if (inj.dead && !wasDead) {
      this.dead = true;
      if (this.state === 'active') this.goRagdoll(null, null, true);
      this.game.onFighterDeath?.(this, null);
    }
    this.dizzyAmt = inj.dizzy;
    // slow random wobble when dazed
    this.wobbleT -= dt;
    if (this.wobbleT <= 0) { this.wobbleT = rand(0.3, 0.8); this.wobbleTarget = new THREE.Vector3(rand(-1, 1), rand(-1, 0.3), 0); }
    if (this.wobbleTarget) this.wobble.lerp(this.wobbleTarget, dampFactor(2, dt));
    this.bleedDrip(dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.iframeT = Math.max(0, this.iframeT - dt);
    this.kickCd = Math.max(0, this.kickCd - dt);
    if (this.state === 'active') {
      if (this.ghostT > 0) {
        this.ghostT -= dt;
        this.core.collisionFilterMask = this.ghostT > 0 ? MASK.PCORE & ~G.ECORE : MASK.PCORE;
      }
      if (this.kickT > 0) {
        this.kickT -= dt;
        if (!this.kickHit && this.kickT < KICK_DUR * 0.6) { this.kickHit = true; this.game.onKick(this); }
      }
    }
    this.liveT = this.attackPhase === 'strike' ? 0.22 : Math.max(0, this.liveT - dt);
    // kamae: sit into the knees with a blade in hand, deeper while cutting, taller when running
    // a broken guard drops a fighter almost to one knee
    const sit = this.brokenT > 0 ? 0.34 : !this.weapon?.attached ? 0.02 : this.sprinting ? 0.03 : this.attackPhase === 'strike' ? 0.12 : this.attackPhase ? 0.09 : 0.07;
    this.crouch += (sit - this.crouch) * dampFactor(9, dt);
    this.brokenT = Math.max(0, this.brokenT - dt);
    const guardUp = this.guarding;
    this.guardT = guardUp ? this.guardT + dt : 0;
    this.postureIdle += dt;
    if (this.postureIdle > POSTURE.regenDelay && this.posture > 0) {
      const rate = POSTURE.regen * this.postureMax * (0.35 + 0.65 * inj.vitality) * (guardUp ? 1.7 : 1);
      this.posture = Math.max(0, this.posture - dt * rate);
    }
    if (this.state === 'active') {
      if (!inj.canStand) { this.goRagdoll(null, null, this.dead); return; }
      // read actual yaw from body
      T.fwd.set(0, 0, -1).applyQuaternion(qToT(this.core.quaternion, T.q));
      this.yawActual = Math.atan2(-T.fwd.x, -T.fwd.z);
      const legs = inj.legStrength;
      const balCap = 0.3 + 0.7 * Math.min(1, legs * 1.15) * (1 - 0.5 * this.dizzyAmt);
      this.balance = Math.min(balCap, this.balance + dt * (this.staggerT > 0 ? 0.15 : 0.55) * (0.3 + 0.7 * legs));
      this.staggerT = Math.max(0, this.staggerT - dt);
      if (this.weapon && this.weapon.attached) {
        this.computeWeaponTarget(dt);
        // weapon jammed far away? snap it back into the hands
        const cp = this.weapon.worldPoint(this.weapon.ctrlLocal, T.pos);
        if (cp.distanceTo(this.weaponTarget.pos) > 1.4) this.weaponStuckT += dt; else this.weaponStuckT = 0;
        if (this.weaponStuckT > 0.6) { this.weapon.teleport(this.weaponTarget.pos, this.weaponTarget.quat); this.weaponStuckT = 0; }
      }
      // fall over when tilted too far
      T.b.set(0, 1, 0).applyQuaternion(qToT(this.core.quaternion, T.q));
      const tilt = Math.acos(clamp(T.b.y, -1, 1));
      if (tilt > 0.85 || (tilt > 0.5 && this.balance < 0.25)) this.goRagdoll(null, null, false);
      else if (this.core.position.y < -3) this.resetTo(new THREE.Vector3(0, 0, 0));
    } else {
      this.ragTime += dt;
      // dragging a bleeding body leaves a trail
      if (this.crawling && !this.crawlRest && inj.bleeding > 0.05 && this.game.effects) {
        this.trailT -= dt;
        const tp = this.ragBodies.torso?.position;
        if (this.trailT <= 0 && tp) { this.trailT = 0.3; this.game.effects.decal(tp.x + rand(-0.1, 0.1), tp.z + rand(-0.1, 0.1), rand(0.18, 0.34)); }
      }
      const pel = this.ragBodies.pelvis.position;
      if (pel.y < -5) for (const n in this.ragBodies) { this.ragBodies[n].position.y += 6; this.ragBodies[n].velocity.setZero(); }
      if (!this.dead && this.getUpAt > 0 && this.ragTime > this.getUpAt && inj.canStand && inj.consciousness > 0.25) this.getUp();
    }
  }

  physicsStep(h) {
    if (this.state !== 'active') { this.ragdollMuscles(); this.crawlStep(h); return; }
    const b = this.core;
    const m = b.mass;
    const bal = this.balance;
    const legs = this.inj.legStrength;
    // --- vertical support ("legs"): wounded legs sag and buckle
    const y = b.position.y;
    if (this.airborne && y <= STAND_H + 0.02 && b.velocity.y <= 0) {
      this.airborne = false;
      this.game.onFighterLand?.(this, -b.velocity.y);
    }
    if (!this.airborne && y < STAND_H + 0.35) {
      const support = (0.35 + 0.65 * bal) * (0.55 + 0.45 * legs);
      const standH = STAND_H - 0.09 * (1 - legs) - this.crouch;
      let ay = ((standH - y) * 260 - b.velocity.y * 26) * support + 9.82;
      ay = clamp(ay, 0, 45);
      C.v.set(0, m * ay, 0);
      b.applyForce(C.v);
    }
    // --- horizontal locomotion
    const mv = this.intent.move;
    const mob = 0.2 + 0.8 * legs;
    let ax = (mv.x * mob - b.velocity.x) * 14, az = (mv.z * mob - b.velocity.z) * 14;
    let maxA = 34 * (0.25 + 0.75 * bal) * (0.4 + 0.6 * legs);
    if (this.airborne) maxA *= 0.45;
    if (this.dashT > 0) maxA = 0;
    const al = Math.hypot(ax, az);
    if (al > maxA) { ax *= maxA / al; az *= maxA / al; }
    C.v.set(m * ax, 0, m * az);
    b.applyForce(C.v);
    // --- upright + facing (PD torque)
    T.q2.setFromAxisAngle(UP, this.intent.yaw);
    quatError(T.q2, qToT(b.quaternion, T.q), T.e);
    const kt = 240 * (0.12 + 0.88 * bal), ky = 340 * (0.3 + 0.7 * bal);
    const w = b.angularVelocity;
    T.a.set(T.e.x * kt - w.x * 26, T.e.y * ky - w.y * 36, T.e.z * kt - w.z * 26);
    if (this.dizzyAmt > 0.05) { // swaying when dazed
      const dz = this.dizzyAmt * 9;
      T.a.x += this.wobble.y * dz; T.a.z += this.wobble.x * dz;
    }
    worldInertiaMul(b, T.a, C.v);
    b.torque.vadd(C.v, b.torque);

    // --- weapon
    const wpn = this.weapon;
    if (wpn && wpn.attached) {
      const wt = this.weaponTarget;
      const armStr = this.inj.armStrength(wpn.def.twoHanded, this.offHanded);
      const F = wpn.drive(wt.pos, wt.vel, wt.quat, wt.angVel,
        this.intent.power * (0.55 + 0.45 * bal) * (0.18 + 0.82 * armStr) * (this.brokenT > 0 ? 0.35 : 1), 0.3 + 0.7 * armStr);
      // reaction: heavy weapons pull the knight around
      C.v2.set(-F.x * 0.28, -(F.y - wpn.body.mass * 9.82) * 0.28, -F.z * 0.28);
      this.localToWorld(T.a.set(0, WAIST_Y + SHOULDER.y, 0), T.b);
      C.v.set(T.b.x - b.position.x, T.b.y - b.position.y, T.b.z - b.position.z);
      b.applyForce(C.v2, C.v);
    }
  }

  // ---------------------------------------------------------------- hits
  stagger(dv, worldPoint, balanceLoss, duration = 0.5) {
    if (this.state !== 'active') return;
    const b = this.core;
    C.v.set(dv.x * b.mass, dv.y * b.mass * 0.3, dv.z * b.mass);
    C.v2.set(worldPoint.x - b.position.x, (worldPoint.y - b.position.y) * 0.6, worldPoint.z - b.position.z);
    b.applyImpulse(C.v, C.v2);
    this.balance = Math.max(0, this.balance - balanceLoss);
    this.staggerT = Math.max(this.staggerT, duration);
  }

  // ---------------------------------------------------------------- ragdoll
  goRagdoll(dv, hitPart, dead) {
    if (this.state === 'ragdoll') { if (dead) this.dead = true; return; }
    this.updateActivePose(0);
    const world = this.game.world;
    const core = this.core;
    const bodies = {};
    for (const n of PART_NAMES) {
      if (this.severed.has(n)) continue;
      const d = PART_DEFS[n];
      const part = this.parts[n];
      const body = new CANNON.Body({ mass: d.mass, material: materials.body, linearDamping: 0.08, angularDamping: 0.5 });
      body.addShape(d.sphere ? new CANNON.Sphere(d.sphere) : new CANNON.Box(new CANNON.Vec3(...d.box)));
      T.a.set(...d.co).applyQuaternion(part.quaternion).add(part.position);
      body.position.set(T.a.x, T.a.y, T.a.z);
      body.quaternion.set(part.quaternion.x, part.quaternion.y, part.quaternion.z, part.quaternion.w);
      // inherit velocity of the core at this point
      const r = T.b.set(T.a.x - core.position.x, T.a.y - core.position.y, T.a.z - core.position.z);
      const w = core.angularVelocity;
      body.velocity.set(
        core.velocity.x + w.y * r.z - w.z * r.y,
        core.velocity.y + w.z * r.x - w.x * r.z,
        core.velocity.z + w.x * r.y - w.y * r.x,
      );
      if (dv) {
        const k = n === hitPart ? 1.6 : (n === 'torso' || n === 'pelvis' || n === 'head') ? 1.0 : 0.8;
        body.velocity.x += dv.x * k; body.velocity.y += dv.y * k; body.velocity.z += dv.z * k;
      }
      body.hs = { type: 'rag', knight: this, part: n };
      setGroup(body, 'RAG');
      snapPrev(body);
      world.addBody(body);
      bodies[n] = body;
    }
    const cons = [];
    for (const [child, parent, aA, aB, angle, twist, hinge] of JOINTS) {
      const bc = bodies[child], bp = bodies[parent];
      if (!bc || !bp) continue;
      const jw = this.parts[child].position;
      const pivotA = bp.pointToLocalFrame(new CANNON.Vec3(jw.x, jw.y, jw.z));
      this.jointPivots[child] = { parent, pivot: pivotA.clone() };
      const pivotB = bc.pointToLocalFrame(new CANNON.Vec3(jw.x, jw.y, jw.z));
      let axisA = new CANNON.Vec3(...aA).unit();
      if (hinge) {
        // Bend axis from the pose the limb is in right now, so the hinge starts without error;
        // a straight limb falls back to the anatomical axis.
        const up = bp.quaternion.vmult(new CANNON.Vec3(0, -1, 0)), lo = bc.quaternion.vmult(new CANNON.Vec3(0, -1, 0));
        const ax = up.cross(lo);
        if (ax.length() < 0.12) bp.quaternion.vmult(HINGE_AXIS.set(hinge, 0, 0), ax);
        ax.normalize();
        const hA = bp.vectorToLocalFrame(ax), hB = bc.vectorToLocalFrame(ax);
        const h = new CANNON.HingeConstraint(bp, bc, { pivotA: pivotA.clone(), pivotB: pivotB.clone(), axisA: hA, axisB: hB, collideConnected: false });
        world.addConstraint(h);
        cons.push(h);
        // cone centred at 57° of flexion in that same plane → the joint moves between ~0° and ~115°
        const q = new CANNON.Quaternion().setFromAxisAngle(hA, 1.0);
        axisA = q.vmult(new CANNON.Vec3(0, -1, 0));
      }
      const c = new CANNON.ConeTwistConstraint(bp, bc, {
        pivotA, pivotB, axisA, axisB: new CANNON.Vec3(...aB).unit(),
        angle, twistAngle: twist, collideConnected: false,
      });
      world.addConstraint(c);
      cons.push(c);
    }
    world.removeBody(core);
    this.ragBodies = bodies;
    this.ragConstraints = cons;
    this.state = 'ragdoll';
    this.ragTime = 0;
    this.dead = this.dead || !!dead;
    // the worse the shape they are in, the longer they stay down
    this.getUpAt = this.dead ? 0 : rand(1.8, 2.6) + (1 - this.inj.vitality) * 2.5;
    this.ghostT = 0;
    this.kickT = 0;
    this.crawling = false;
    this.dyingT = this.dead && !this.severed.has('head') ? 1.1 : 0;
    if (this.weapon) {
      this.weapon.drop();
      if (dv) { const v = this.weapon.body.velocity; v.x += dv.x * 0.6; v.y += dv.y * 0.6; v.z += dv.z * 0.6; }
    }
    this.brokenT = 0;
    this.attackPhase = null;
    this.game.onFighterDown(this);
  }

  getUp() {
    const pel = this.ragBodies.pelvis.position;
    const tq = qToT(this.ragBodies.torso.quaternion, T.q);
    T.fwd.set(0, 0, -1).applyQuaternion(tq);
    if (Math.abs(T.fwd.y) > 0.8) T.fwd.set(0, 1, 0).applyQuaternion(tq).negate();
    const yaw = Math.atan2(-T.fwd.x, -T.fwd.z);
    this.blendFrom = {};
    for (const n of PART_NAMES) {
      this.blendFrom[n] = { p: this.parts[n].position.clone(), q: this.parts[n].quaternion.clone() };
    }
    this.removeRagdoll();
    const r = Math.hypot(pel.x, pel.z);
    const s = r > 12.5 ? 12.5 / r : 1;
    this.createCore(new THREE.Vector3(pel.x * s, 0, pel.z * s), yaw);
    this.intent.yaw = yaw;
    this.state = 'active';
    this.balance = 0.4;
    this.staggerT = 0.6;
    this.blendT = 0;
    this.blendDur = 0.6 + (1 - this.inj.vitality) * 0.7;      // the wounded struggle to their feet
    this.crawling = false;
    this.tryRegrab(2.2);
    this.game.onFighterUp(this);
  }

  removeRagdoll() {
    if (!this.ragBodies) return;
    for (const c of this.ragConstraints) this.game.world.removeConstraint(c);
    for (const n in this.ragBodies) this.game.world.removeBody(this.ragBodies[n]);
    this.ragBodies = null;
    this.ragConstraints = null;
  }

  resetTo(pos, yaw = 0) {
    if (this.state === 'ragdoll') this.removeRagdoll();
    else this.game.world.removeBody(this.core);
    this.createCore(pos, yaw);
    this.intent.yaw = yaw;
    this.state = 'active';
    this.dead = false;
    this.inj.reset();
    this.clearWounds();
    this.restoreLimbs();
    this.balance = 1;
    this.posture = 0;
    this.brokenT = 0;
    this.blendT = 1;
    if (this.weapon) {
      this.weapon.attach();
      this.prevTargetPos = null;
      this.computeWeaponTarget(0);
      this.weapon.teleport(this.weaponTarget.pos, this.weaponTarget.quat);
    }
  }

  // ---------------------------------------------------------------- moves
  /** Quick evasive step in a world direction. */
  dash(dir) {
    if (this.state !== 'active' || this.dashCd > 0 || this.airborne) return false;
    const legs = this.inj.legStrength;
    if (legs < 0.35) return false;
    const b = this.core;
    const sp = 10 * this.speedMul * (0.5 + 0.5 * legs);
    b.velocity.x = dir.x * sp;
    b.velocity.z = dir.z * sp;
    // lean into the dash
    b.angularVelocity.x += dir.z * -2.2;
    b.angularVelocity.z += dir.x * 2.2;
    this.dashT = 0.19;
    this.iframeT = 0.28;
    this.dashCd = this.isPlayer ? 0.42 : 1.2;
    this.game.onFighterDash?.(this, dir);
    return true;
  }

  jump() {
    if (this.state !== 'active' || this.airborne || this.inj.legStrength < 0.45) return false;
    this.core.velocity.y = 5.3 * (0.6 + 0.4 * this.inj.legStrength);
    this.airborne = true;
    return true;
  }

  /** Living ragdolls keep some muscle tone: they don't flop like rag dolls. */
  ragdollMuscles() {
    if (!this.ragBodies) return;
    let tone;
    if (this.dead) {
      // a dying body does not go limp at once: the muscles let go over about a second
      if (this.dyingT <= 0 || this.severed.has('head')) return;
      this.dyingT -= 1 / 120;
      tone = 0.6 * Math.max(0, this.dyingT);
    } else tone = this.inj.consciousness > 0.05 ? 0.25 + 0.5 * this.inj.vitality : 0.08;
    // awake and in pain: they writhe
    const writhe = !this.dead && this.inj.consciousness > 0.2 && (!this.inj.canStand || this.inj.shock > 0.3);
    for (const [child, parent] of JOINTS) {
      const bc = this.ragBodies[child], bp = this.ragBodies[parent];
      if (!bc || !bp) continue;
      quatError(qToT(bp.quaternion, T.q), qToT(bc.quaternion, T.q2), T.e);
      const wc = bc.angularVelocity, wp = bp.angularVelocity;
      const I = bc.mass * 0.03;
      const k = 140 * tone, d = 6 * tone;
      C.v.set((T.e.x * k - (wc.x - wp.x) * d) * I, (T.e.y * k - (wc.y - wp.y) * d) * I, (T.e.z * k - (wc.z - wp.z) * d) * I);
      bc.torque.vadd(C.v, bc.torque);
      bp.torque.vsub(C.v, bp.torque);
      if (writhe && Math.random() < 0.012) {
        C.v2.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).scale(I * 250, C.v2);
        bc.torque.vadd(C.v2, bc.torque);
      }
    }
  }

  /** Too hurt to stand but awake: drag yourself away from the enemy on your arms. */
  crawlStep(h) {
    const rb = this.ragBodies, inj = this.inj;
    if (!rb || this.dead || this.isPlayer || this.ragTime < 1.8 || inj.consciousness < 0.25 || inj.canStand || !rb.torso) { this.crawling = false; return; }
    this.crawling = true;
    this.crawlT -= h;
    const tp = rb.torso.position;
    if (this.crawlT <= 0) {
      this.crawlT = 0.6;
      let fx = 0, fz = 0, bd = Infinity;
      for (const f of this.game.fighters) {
        if (f.team === this.team || f.dead || f.state !== 'active') continue;
        const p = f.core.position, d = Math.hypot(p.x - tp.x, p.z - tp.z);
        if (d < bd) { bd = d; fx = tp.x - p.x; fz = tp.z - p.z; }
      }
      const r = Math.hypot(tp.x, tp.z);
      if (r > 11.5) { fx = -tp.z; fz = tp.x; }           // at the wall: along it
      const l = Math.hypot(fx, fz);
      if (l > 1e-3) this.crawlDir.set(fx / l, 0, fz / l);
      this.crawlRest = bd > 9;                            // far enough away: lie there, spent
    }
    if (this.crawlRest) return;
    const vit = 0.35 + 0.65 * inj.vitality;
    this.crawlPhase += h * 2.4 * vit;
    const pull = Math.max(0, Math.sin(this.crawlPhase));  // one arm stroke
    const g = this.crawlDir, vt = 0.55 * pull * vit;
    for (const [name, share] of [['torso', 1], ['pelvis', 0.8]]) {
      const b = rb[name];
      if (!b) continue;
      let ax = (g.x * vt - b.velocity.x) * 14, az = (g.z * vt - b.velocity.z) * 14;
      const al = Math.hypot(ax, az), cap = 22 * pull;
      if (al > cap) { ax *= cap / al; az *= cap / al; }
      b.applyForce(C.v.set(b.mass * ax * share, name === 'torso' ? b.mass * 3.5 * pull : 0, b.mass * az * share));
    }
    // between strokes the other arm reaches ahead
    const arm = rb[Math.sin(this.crawlPhase * 0.5) > 0 ? 'fArmR' : 'fArmL'];
    if (arm) { const k = (1 - pull) * arm.mass; arm.applyForce(C.v.set(g.x * 30 * k, 14 * k, g.z * 30 * k)); }
    if (rb.head) rb.head.applyForce(C.v.set(0, rb.head.mass * 5, 0));
  }

  /** Where the joint of `part` is right now (for stump bleeding). */
  jointWorld(part, out) {
    if (this.state === 'ragdoll' && this.jointPivots[part]) {
      const jp = this.jointPivots[part];
      const pb = this.ragBodies?.[jp.parent];
      if (pb) return toT(pb.pointToWorldFrame(jp.pivot, C.v), out);
    }
    return out.copy(this.parts[part].position);
  }

  /** Cut off a body part (and everything hanging from it). Returns the loose limb bodies. */
  sever(part, dir, speed) {
    const chain = SEVER_CHAIN[part];
    if (!chain || this.severed.has(part)) return null;
    // part must still be attached
    let p = PARENT_OF[part];
    while (p) { if (this.severed.has(p)) return null; p = PARENT_OF[p]; }
    const world = this.game.world;
    const bodies = {}, meshes = {}, cons = [];
    const stumpParent = PARENT_OF[part];
    if (this.state === 'ragdoll' && this.ragBodies[part]) {
      // detach the existing ragdoll limb
      for (let i = this.ragConstraints.length - 1; i >= 0; i--) {
        const c = this.ragConstraints[i];
        const cb = c.bodyB.hs.part, pb = c.bodyA.hs.part;
        if (chain.includes(cb) && chain.includes(pb)) { cons.push(c); this.ragConstraints.splice(i, 1); }
        else if (chain.includes(cb)) { world.removeConstraint(c); this.ragConstraints.splice(i, 1); }
      }
      for (const n of chain) {
        const b = this.ragBodies[n];
        if (!b) continue;
        delete this.ragBodies[n];
        bodies[n] = b;
      }
    } else {
      // active: spawn the limb from the current pose
      this.updateActivePose(0);
      const core = this.core;
      for (const n of chain) {
        const d = PART_DEFS[n], part = this.parts[n];
        const b = new CANNON.Body({ mass: d.mass, material: materials.body, linearDamping: 0.08, angularDamping: 0.3 });
        b.addShape(d.sphere ? new CANNON.Sphere(d.sphere) : new CANNON.Box(new CANNON.Vec3(...d.box)));
        T.a.set(...d.co).applyQuaternion(part.quaternion).add(part.position);
        b.position.set(T.a.x, T.a.y, T.a.z);
        b.quaternion.set(part.quaternion.x, part.quaternion.y, part.quaternion.z, part.quaternion.w);
        b.velocity.copy(core.velocity);
        snapPrev(b);
        world.addBody(b);
        bodies[n] = b;
      }
      for (const [child, parent, aA, aB, angle, twist] of JOINTS) {
        if (!bodies[child] || !bodies[parent]) continue;
        const jw = this.parts[child].position;
        const c = new CANNON.ConeTwistConstraint(bodies[parent], bodies[child], {
          pivotA: bodies[parent].pointToLocalFrame(new CANNON.Vec3(jw.x, jw.y, jw.z)),
          pivotB: bodies[child].pointToLocalFrame(new CANNON.Vec3(jw.x, jw.y, jw.z)),
          axisA: new CANNON.Vec3(...aA).unit(), axisB: new CANNON.Vec3(...aB).unit(), angle, twistAngle: twist,
        });
        world.addConstraint(c);
        cons.push(c);
      }
    }
    for (const n of chain) {
      const b = bodies[n];
      if (!b) continue;
      b.hs = { type: 'limb', part: n };
      setGroup(b, 'RAG');
      const k = n === part ? 1 : 0.6;
      b.velocity.x += dir.x * speed * 0.35 * k + rand(-1, 1);
      b.velocity.y += 1.5 + speed * 0.12;
      b.velocity.z += dir.z * speed * 0.35 * k + rand(-1, 1);
      b.angularVelocity.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      const m = this.parts[n].clone();
      this.game.scene.add(m);
      meshes[n] = m;
      this.parts[n].visible = false;
      this.severed.add(n);
    }
    // arm colliders of the core go away with the arm
    if (this.core) this.core.shapes.forEach((sh) => { if (this.severed.has(sh.hsPart)) sh.collisionFilterMask = 0; });
    const limb = { bodies, meshes, constraints: cons, cutPart: part, t: 0 };
    this.game.addLimb?.(limb, this, part, stumpParent);
    return limb;
  }

  // ---------------------------------------------------------------- injuries
  /** Which body zone / visual part a contact on our body hit. */
  zoneFromContact(body, shape, worldPoint) {
    if (body.hs.type === 'rag') {
      const part = body.hs.part;
      const zone = part === 'head' ? 'head' : part === 'torso' || part === 'pelvis' ? 'torso'
        : part.includes('Arm') ? (part.endsWith('R') ? 'armR' : 'armL') : (part.endsWith('R') ? 'legR' : 'legL');
      return { zone, part };
    }
    let part = shape?.hsPart || 'torso';
    let zone = shape?.hsZone || 'torso';
    if (zone === 'leg') {
      const lp = this.core.pointToLocalFrame(C.v.set(worldPoint.x, worldPoint.y, worldPoint.z), C.v2);
      zone = lp.x >= 0 ? 'legR' : 'legL';
      part = 'thigh' + (lp.x >= 0 ? 'R' : 'L');
    }
    return { zone, part };
  }

  addWound(part, worldPoint, dir, sev, kind) {
    const obj = this.parts[part];
    if (!obj) return;
    obj.updateMatrixWorld();
    const local = obj.worldToLocal(worldPoint.clone());
    const blunt = kind === 'blunt';
    const m = new THREE.Mesh(WOUND_GEO, blunt && sev < 0.35 ? WOUND_MAT.bruise : WOUND_MAT.blood);
    const r = clamp(0.025 + sev * 0.07, 0.025, 0.09);
    m.scale.set(r * (kind === 'cut' ? 1.8 : 1), r * 0.35, r);
    m.position.copy(local);
    const n = T.a.copy(dir).negate().transformDirection(T_INV.copy(obj.matrixWorld).invert());
    m.quaternion.setFromUnitVectors(UP, n.normalize());
    m.rotateY(Math.random() * Math.PI);
    obj.add(m);
    this.wounds.push({ part, mesh: m, sev });
    if (this.wounds.length > 24) { const w = this.wounds.shift(); w.mesh.parent?.remove(w.mesh); }
  }

  restoreLimbs() {
    for (const n of this.severed) this.parts[n].visible = true;
    this.severed.clear();
    if (this.core) this.core.shapes.forEach((sh) => { sh.collisionFilterMask = -1; });
  }

  clearWounds() {
    for (const w of this.wounds) w.mesh.parent?.remove(w.mesh);
    this.wounds = [];
  }

  /** Blood drips from open wounds, leaving a trail. */
  bleedDrip(dt) {
    const b = this.inj.bleeding;
    if (b < 0.06 || !this.wounds.length || !this.game.effects || this.inj.blood <= 0) return;
    this.dripT -= dt * Math.min(6, b * 3);
    if (this.dripT > 0) return;
    this.dripT = rand(0.25, 0.7);
    const w = this.wounds[Math.floor(Math.random() * this.wounds.length)];
    w.mesh.getWorldPosition(T.pos);
    this.game.effects.blood(T.pos, T.a.set(0, -1, 0), 1 + Math.round(Math.min(3, b)));
  }

  /** Pick the dropped weapon back up if it is within reach. */
  tryRegrab(range = 1.3) {
    const w = this.weapon;
    if (!w || w.attached || this.state !== 'active') return false;
    if (this.armless) return false;
    const p = this.core.position, q = w.body.position;
    if (Math.hypot(p.x - q.x, p.z - q.z) > range || q.y > 2.2) return false;
    w.attach();
    this.inj.disarmed = false;
    this.prevTargetPos = null;
    this.computeWeaponTarget(0);
    if (range > 1.5) w.teleport(this.weaponTarget.pos, this.weaponTarget.quat);
    return true;
  }

  disarm(dv) {
    const w = this.weapon;
    if (!w || !w.attached) return;
    w.drop();
    if (dv) { const v = w.body.velocity; v.x += dv.x; v.y += dv.y + 1.5; v.z += dv.z; }
    this.inj.disarmed = true;
  }

  // ---------------------------------------------------------------- posture & guard
  /** Guard is up and usable. */
  get guarding() {
    return this.state === 'active' && this.intent.mode === 'parry' && this.brokenT <= 0 && !!this.weapon?.attached;
  }

  /** The sword arm is cut off or useless: the left hand has to do it. */
  get offHanded() { return this.severed.has('uArmR') || this.severed.has('fArmR') || this.inj.parts.armR >= 1; }
  /** No arm left to hold a weapon. */
  get armless() {
    return this.offHanded && (this.severed.has('uArmL') || this.severed.has('fArmL') || this.inj.parts.armL >= 1);
  }

  /** Front kick. `power` > 1 for a running kick. The hit itself lands a moment later (game.onKick). */
  startKick(power = 1) {
    if (this.state !== 'active' || this.kickT > 0 || this.kickCd > 0 || this.airborne || this.brokenT > 0 || this.inj.legStrength < 0.4) return false;
    this.kickT = KICK_DUR;
    this.kickPower = power;
    this.kickHit = false;
    this.kickCd = 0.85;
    return true;
  }

  /** Unit forward vector (world, horizontal). */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yawActual), 0, -Math.cos(this.yawActual));
  }

  /** Pressure on the guard. Returns true when it breaks. */
  addPosture(amount) {
    if (this.state !== 'active' || this.brokenT > 0 || this.dead) return false;
    this.posture += amount;
    this.postureIdle = 0;
    if (this.posture < this.postureMax) return false;
    this.posture = 0;
    this.brokenT = this.isPlayer ? 1.1 : 2.6;
    this.staggerT = Math.max(this.staggerT, this.brokenT);
    this.balance = Math.max(0.3, this.balance - 0.25);
    return true;
  }

  /** Swap the outfit (player skins). */
  setStyle(style, armor) {
    this.clearWounds();
    const { parts, mats } = buildParts(style);
    for (const n of PART_NAMES) {
      const g = this.parts[n];
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      g.clear();
      for (const c of [...parts[n].children]) g.add(c);
    }
    this.style = style;
    this.mats = mats;
    if (armor != null) this.inj.armor = armor;
  }

  // ---------------------------------------------------------------- visuals
  updateActivePose(dt) {
    const P = this.parts;
    const cp = interpPos(this.core, T.pos);
    const cq = interpQuat(this.core, T.q);
    P.pelvis.position.copy(cp);
    P.pelvis.quaternion.copy(cq);
    // torso
    P.torso.position.set(0, WAIST_Y, 0).applyQuaternion(cq).add(cp);
    P.torso.quaternion.copy(cq).multiply(T.q2.setFromEuler(T.eul.set(-this.lean - this.runLean, this.twist, 0, 'YXZ')));
    const tq = P.torso.quaternion;
    P.head.position.set(0, 0.5, 0).applyQuaternion(tq).add(P.torso.position);
    P.head.quaternion.copy(tq).multiply(T.q2.setFromEuler(T.eul.set((this.lean + this.runLean) * 0.6, -this.twist * 0.6, 0, 'YXZ')));

    // frame vectors
    const yq = this.yawQuat();
    T.fwd.set(0, 0, -1).applyQuaternion(yq);
    T.right.set(1, 0, 0).applyQuaternion(yq);
    T.back.copy(T.fwd).negate();

    // ---- arms
    const shR = T.a.set(SHOULDER.x, SHOULDER.y, 0).applyQuaternion(tq).add(P.torso.position).clone();
    const shL = T.a.set(-SHOULDER.x, SHOULDER.y, 0).applyQuaternion(tq).add(P.torso.position).clone();
    const w = this.weapon;
    let handR, handL;
    if (w && w.attached) {
      if (this.offHanded) handL = w.worldPoint(w.handR);        // sword arm gone: the left hand takes the grip
      else {
        handR = w.worldPoint(w.handR);
        if (w.def.twoHanded && !this.severed.has('fArmL') && this.inj.parts.armL < 1) handL = w.worldPoint(w.handL);
      }
    }
    if (!handR) handR = this.localToWorld(L(0.25, 0.12, 0.12), new THREE.Vector3());
    // a free hand goes to a bad body wound
    if (!handL) handL = this.localToWorld(this.inj.parts.torso > 0.45 ? L(-0.06, 0.2, 0.2) : L(-0.27, 0.16, 0.1), new THREE.Vector3());
    const poleR = T.b.copy(T.right).multiplyScalar(0.7).add(T.e.set(0, -0.7, 0)).addScaledVector(T.back, 0.3);
    solveTwoBone(shR, handR, ARM.upper, ARM.fore, poleR, T.mid, T.end);
    placeLimb(P.uArmR, shR, T.mid, T.back);
    placeLimb(P.fArmR, T.mid, T.end, T.back);
    const poleL = T.b.copy(T.right).multiplyScalar(-0.7).add(T.e.set(0, -0.7, 0)).addScaledVector(T.back, 0.3);
    solveTwoBone(shL, handL, ARM.upper, ARM.fore, poleL, T.mid, T.end);
    placeLimb(P.uArmL, shL, T.mid, T.back);
    placeLimb(P.fArmL, T.mid, T.end, T.back);
    this.syncArmShapes(cp, cq);

    // ---- legs (procedural gait, planted on the floor)
    const vx = this.core.velocity.x, vz = this.core.velocity.z;
    const speed = Math.hypot(vx, vz);
    const run = clamp((speed - 4) / 4, 0, 1);
    this.gaitPhase += dt * (2.5 + speed * 2.7) * (speed > 0.15 ? 1 : 0);
    // lean: into the run, back for a kick, hunched over a body wound
    const leanTo = this.kickT > 0 ? -0.24 : (this.sprinting ? 0.32 : 0.06) * clamp(speed / 6, 0, 1) + 0.2 * Math.min(1, this.inj.parts.torso);
    if (dt > 0) this.runLean += (leanTo - this.runLean) * dampFactor(this.kickT > 0 ? 16 : 6, dt);
    const s = clamp(speed / 3, 0, 1);
    const mdx = speed > 0.05 ? vx / speed : 0, mdz = speed > 0.05 ? vz / speed : 0;
    for (const [side, name, stance] of [[1, 'R', 0.2], [-1, 'L', -0.2]]) {
      const hip = T.a.set(side * LEG.hipX, LEG.hipY, 0).applyQuaternion(cq).add(cp).clone();
      const ph = this.gaitPhase + (side > 0 ? 0 : Math.PI);
      const foot = T.e.set(cp.x, 0, cp.z)
        .addScaledVector(T.right, side * 0.15)
        .addScaledVector(T.fwd, stance * (1 - s));
      const legDmg = Math.min(1, this.inj.parts['leg' + name]);
      const stride = (0.3 + 0.16 * run) * (1 - 0.6 * legDmg);
      foot.x += mdx * Math.sin(ph) * stride * s;
      foot.z += mdz * Math.sin(ph) * stride * s;
      foot.y = 0.085 + Math.max(0, Math.cos(ph)) * (0.13 + 0.1 * run) * s * (1 - 0.7 * legDmg);
      if (this.airborne || cp.y > STAND_H + 0.08) {
        foot.copy(hip).addScaledVector(T.fwd, side > 0 ? -0.12 : 0.18);
        foot.y = hip.y - 0.62;
      }
      const kicking = side > 0 && this.kickT > 0;
      if (kicking) {
        // chamber the knee, snap the foot out at belly height, pull it back
        const u = 1 - this.kickT / KICK_DUR;
        const ext = u < 0.4 ? smooth(u / 0.4) : 1 - smooth((u - 0.4) / 0.6);
        foot.copy(hip).addScaledVector(T.fwd, 0.18 + 0.7 * ext);
        foot.y = hip.y - 0.5 + 0.48 * ext;
      }
      const pole = T.b.copy(T.fwd).addScaledVector(T.right, side * 0.15);
      if (kicking) pole.y += 1.2;
      solveTwoBone(hip, foot, LEG.thigh, LEG.shin, pole, T.mid, T.end);
      placeLimb(P['thigh' + name], hip, T.mid, T.back);
      placeLimb(P['shin' + name], T.mid, T.end, T.back);
    }

    // ---- blend in after getting up
    if (this.blendT < 1 && this.blendFrom) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      const k = smooth(this.blendT);
      for (const n of PART_NAMES) {
        const f = this.blendFrom[n];
        P[n].position.lerpVectors(f.p, P[n].position, k);
        P[n].quaternion.slerpQuaternions(f.q, P[n].quaternion, k);
      }
    }
  }

  /** Move the core's arm collision boxes to where the IK put the arms. */
  syncArmShapes(cp, cq) {
    const b = this.core;
    if (!b || b.shapes.length < 8) return;
    T.q2.copy(cq).invert();
    ARM_SHAPES.forEach((n, i) => {
      if (this.severed.has(n)) return;
      const part = this.parts[n];
      const c = T.a.set(0, -0.15, 0).applyQuaternion(part.quaternion).add(part.position).sub(cp).applyQuaternion(T.q2);
      b.shapeOffsets[4 + i].set(c.x, c.y, c.z);
      const q = T.q3.copy(T.q2).multiply(part.quaternion);
      b.shapeOrientations[4 + i].set(q.x, q.y, q.z, q.w);
    });
    b.updateBoundingRadius();
    b.aabbNeedsUpdate = true;
  }

  syncVisuals(dt) {
    if (this.state === 'active') this.updateActivePose(dt);
    else {
      for (const n of PART_NAMES) {
        const b = this.ragBodies[n];
        if (!b) continue;
        const part = this.parts[n];
        interpQuat(b, part.quaternion);
        part.position.set(...PART_DEFS[n].co).applyQuaternion(part.quaternion).negate()
          .add(interpPos(b, T.a));
      }
    }
    if (this.weapon) this.weapon.sync(dt);
    const e = this.hitFlash;
    for (const m of this.mats.flash) m.emissive.setRGB(e * e * 0.3, 0, 0);
  }

  dispose() {
    if (this.state === 'ragdoll') this.removeRagdoll();
    else this.game.world.removeBody(this.core);
    for (const n of PART_NAMES) this.game.scene.remove(this.parts[n]);
    if (this.weapon) this.weapon.dispose();
    for (const n of PART_NAMES) this.parts[n].traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    // materials are shared with severed limb clones; let GC handle them
  }
}
