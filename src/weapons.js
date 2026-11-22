import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeStatic } from './perf.js';
import {
  materials, setGroup, toC, toT, qToT, quatError, worldInertiaMul, pointVelocity, clampLen,
  snapPrev, syncMesh,
} from './physics.js';

// ------------------------------------------------------------------
// Weapon definitions. All lengths in metres, "handle space":
//   sword / club : y = 0 at the tsuba (top of the grip), blade towards +y
//   polearm      : y = 0 between the hands, shaft runs -shaftBack .. +shaftFore, blade beyond
// ------------------------------------------------------------------
export const WEAPONS = {
  katana: {
    key: 'katana', name: 'Katana', type: 'sword', curve: 0.03,
    bladeLen: 0.74, bladeW: 0.034, gripLen: 0.3, mass: 1.35, ycom: 0.07,
    pd: { kp: 600, kd: 46, maxF: 1150, rkp: 460, rkd: 36, maxT: 230 },
    swing: { wind: 0.2, strike: 0.13, recover: 0.3 },
    damage: 1.35, armorMul: 1.1, knock: 0.75, launchUp: 0.1, reach: 1.35, moveMul: 1.0,
    postureDmg: 1.0, sever: 1.0, twoHanded: true, ito: 0x5a1218,
    desc: 'schnell, rasiermesserscharf',
  },
  wakizashi: {
    key: 'wakizashi', name: 'Wakizashi', type: 'sword', curve: 0.022,
    bladeLen: 0.5, bladeW: 0.03, gripLen: 0.2, mass: 0.9, ycom: 0.05,
    pd: { kp: 700, kd: 52, maxF: 900, rkp: 520, rkd: 40, maxT: 150 },
    swing: { wind: 0.15, strike: 0.11, recover: 0.22 },
    damage: 1.05, armorMul: 1.1, knock: 0.5, launchUp: 0.05, reach: 1.1, moveMul: 1.12,
    postureDmg: 0.65, sever: 1.25, twoHanded: false, ito: 0x1a2a4a,
    desc: 'Kurzschwert – blitzschnelle Kombos',
  },
  nodachi: {
    key: 'nodachi', name: 'Nōdachi', type: 'sword', curve: 0.035,
    bladeLen: 1.2, bladeW: 0.042, gripLen: 0.42, mass: 3.1, ycom: 0.14,
    pd: { kp: 300, kd: 26, maxF: 1400, rkp: 200, rkd: 16, maxT: 320 },
    swing: { wind: 0.32, strike: 0.22, recover: 0.45 },
    damage: 1.5, knock: 2.2, launchUp: 0.4, reach: 1.8, moveMul: 0.86,
    postureDmg: 1.5, sever: 0.72, twoHanded: true, ito: 0x16161c,
    desc: 'Feldschwert – trennt Glieder, bricht die Haltung',
  },
  yari: {
    key: 'yari', name: 'Yari', type: 'polearm',
    shaftBack: 0.75, shaftFore: 1.15, bladeLen: 0.32, bladeW: 0.04, mass: 2.3, ycom: 0.3,
    pd: { kp: 420, kd: 36, maxF: 1300, rkp: 240, rkd: 22, maxT: 300 },
    swing: { wind: 0.22, strike: 0.15, recover: 0.34 },
    damage: 1.25, knock: 1.0, launchUp: 0.1, reach: 2.3, moveMul: 0.95, upBias: 0.3,
    postureDmg: 0.9, twoHanded: true, shaft: 0x4a1410,
    desc: 'Speer – Reichweite, Stiche finden Rüstungslücken',
  },
  naginata: {
    key: 'naginata', name: 'Naginata', type: 'polearm', curve: 0.07,
    shaftBack: 0.7, shaftFore: 0.85, bladeLen: 0.52, bladeW: 0.046, mass: 2.9, ycom: 0.3,
    pd: { kp: 360, kd: 30, maxF: 1350, rkp: 200, rkd: 18, maxT: 310 },
    swing: { wind: 0.28, strike: 0.19, recover: 0.4 },
    damage: 1.4, knock: 1.5, launchUp: 0.25, reach: 2.05, moveMul: 0.92, upBias: 0.45,
    postureDmg: 1.25, sever: 0.85, twoHanded: true, shaft: 0x1c1512,
    desc: 'Schwertlanze – weite, mähende Hiebe',
  },
  kanabo: {
    key: 'kanabo', name: 'Kanabō', type: 'club',
    bladeLen: 1.1, gripLen: 0.4, mass: 5.2, ycom: 0.38,
    pd: { kp: 220, kd: 19, maxF: 1450, rkp: 130, rkd: 10, maxT: 330 },
    swing: { wind: 0.36, strike: 0.24, recover: 0.5 },
    damage: 1.6, knock: 3.0, launchUp: 0.55, reach: 1.55, moveMul: 0.84,
    postureDmg: 2.0, twoHanded: true,
    desc: 'Eisenkeule – Wucht geht durch jede Rüstung',
  },
  // thrown, never held
  kunai: {
    key: 'kunai', name: 'Kunai', type: 'sword', thrown: true,
    bladeLen: 0.15, bladeW: 0.032, gripLen: 0.09, mass: 0.3, ycom: 0.03,
    pd: { kp: 0, kd: 0, maxF: 0, rkp: 0, rkd: 0, maxT: 0 },
    damage: 0.3, knock: 0.3, launchUp: 0, reach: 0, moveMul: 1, postureDmg: 0.5,
  },
  arrow: {
    key: 'arrow', name: 'Pfeil', type: 'sword', thrown: true, arrow: true,
    bladeLen: 0.09, bladeW: 0.024, gripLen: 0.66, mass: 0.14, ycom: -0.2,
    pd: { kp: 0, kd: 0, maxF: 0, rkp: 0, rkd: 0, maxT: 0 },
    damage: 0.62, knock: 0.3, launchUp: 0, reach: 0, moveMul: 1, postureDmg: 0.6,
  },
};
// Tempo of the sword work as a whole: quicker to the top, quicker back to the guard, so cuts chain fluidly.
for (const w of Object.values(WEAPONS)) { if (!w.swing) continue; w.swing.wind *= 0.82; w.swing.strike *= 0.93; w.swing.recover *= 0.78; }

export const WEAPON_ORDER = ['katana', 'wakizashi', 'nodachi', 'yari', 'naginata', 'kanabo'];

// ------------------------------------------------------------------
// Shared materials
// ------------------------------------------------------------------
const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0xd2dae2, metalness: 0.95, roughness: 0.16 }),
  hamon: new THREE.MeshStandardMaterial({ color: 0x8a949e, metalness: 0.9, roughness: 0.38 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 0.85, roughness: 0.35 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x34363a, metalness: 0.8, roughness: 0.5 }),
  same: new THREE.MeshStandardMaterial({ color: 0xd8d2c0, metalness: 0.0, roughness: 0.8 }), // ray skin under the wrap
  rope: new THREE.MeshStandardMaterial({ color: 0x8a7a55, metalness: 0.0, roughness: 0.95 }),
};
const STEEL_COLOR = new THREE.Color(0xd2dae2);
const BLOOD_COLOR = new THREE.Color(0x5a0508);
const _lacquerCache = new Map();
function lacquer(color) {
  if (!_lacquerCache.has(color)) _lacquerCache.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.55 }));
  return _lacquerCache.get(color);
}

function shadowed(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

/** Straight double-edged blade (yari, kunai). */
function straightBladeGeometry(len, w) {
  const s = new THREE.Shape();
  s.moveTo(-w * 0.3, 0);
  s.lineTo(w * 0.3, 0);
  s.lineTo(w * 0.5, len * 0.3);
  s.lineTo(0, len);
  s.lineTo(-w * 0.5, len * 0.3);
  s.closePath();
  const depth = 0.005;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.005, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/** Single-edged curved blade with a kissaki tip. Edge on +x, spine curving back along -x. */
function curvedBladeGeometry(len, w, curve) {
  const s = new THREE.Shape();
  const N = 14;
  const cx = (y) => -curve * Math.pow(y / len, 2) * len * 1.6;
  s.moveTo(w / 2 + cx(0), 0);
  for (let i = 1; i <= N; i++) { const y = len * 0.9 * i / N; s.lineTo(w / 2 + cx(y), y); }
  s.lineTo(cx(len) - w * 0.15, len);
  for (let i = N; i >= 0; i--) { const y = len * 0.86 * i / N; s.lineTo(-w / 2 + cx(y), y); }
  const depth = 0.004;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

function buildSword(g, def, bladeMat) {
  g.add(shadowed(new THREE.Mesh(curvedBladeGeometry(def.bladeLen, def.bladeW, def.curve), bladeMat)));
  const hamon = new THREE.Mesh(new THREE.BoxGeometry(0.006, def.bladeLen * 0.85, 0.0125), MAT.hamon);
  hamon.position.set(def.bladeW * 0.32, def.bladeLen * 0.43, 0);
  g.add(hamon);
  const habaki = new THREE.Mesh(new THREE.BoxGeometry(def.bladeW + 0.01, 0.035, 0.018), MAT.brass);
  habaki.position.y = 0.018;
  g.add(habaki);
  const tr = 0.03 + def.bladeW * 0.4;
  g.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(tr, tr, 0.008, 18), MAT.iron)));
  const tsuka = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, def.gripLen, 8), MAT.same));
  tsuka.scale.set(1, 1, 0.75);
  tsuka.position.y = -def.gripLen / 2;
  g.add(tsuka);
  const n = Math.max(4, Math.round(def.gripLen / 0.042));
  const ito = lacquer(def.ito ?? 0x15151c);
  for (let i = 0; i < n; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.014, 0.031), ito);
    d.position.y = -0.03 - i * (def.gripLen - 0.05) / (n - 0.5);
    d.rotation.y = i % 2 ? 0.6 : -0.6;
    g.add(d);
  }
  const kashira = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.017, 0.022, 10), MAT.iron);
  kashira.position.y = -def.gripLen - 0.008;
  g.add(kashira);
}

function buildPolearm(g, def, bladeMat) {
  const len = def.shaftBack + def.shaftFore;
  const shaft = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, len, 10), lacquer(def.shaft ?? 0x2a1a10)));
  shaft.position.y = (def.shaftFore - def.shaftBack) / 2;
  g.add(shaft);
  const blade = shadowed(new THREE.Mesh(
    def.curve ? curvedBladeGeometry(def.bladeLen, def.bladeW, def.curve) : straightBladeGeometry(def.bladeLen, def.bladeW), bladeMat));
  blade.position.y = def.shaftFore;
  g.add(blade);
  const collar = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.024, 0.16, 10), MAT.brass));
  collar.position.y = def.shaftFore - 0.08;
  g.add(collar);
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.018, 10), MAT.iron);
    band.position.y = def.shaftFore - 0.24 - i * 0.09;
    g.add(band);
  }
  if (def.curve) {
    const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.008, 14), MAT.iron);
    tsuba.position.y = def.shaftFore;
    g.add(tsuba);
  }
  const butt = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 8), MAT.iron));
  butt.rotation.x = Math.PI;
  butt.position.y = -def.shaftBack - 0.04;
  g.add(butt);
}

function buildClub(g, def) {
  const len = def.bladeLen;
  const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.03, len, 8), MAT.iron));
  body.position.y = len / 2;
  g.add(body);
  const studGeo = new THREE.ConeGeometry(0.013, 0.028, 5);
  studGeo.rotateZ(-Math.PI / 2);
  for (let r = 0; r < 9; r++) {
    const y = len * 0.34 + r * (len * 0.62 / 9);
    const rad = 0.03 + 0.028 * (y / len) + 0.008;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + (r % 2) * Math.PI / 4;
      const st = new THREE.Mesh(studGeo, MAT.brass);
      st.position.set(Math.cos(a) * rad, y, -Math.sin(a) * rad);
      st.rotation.y = a;
      g.add(st);
    }
  }
  const grip = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.024, def.gripLen, 10), MAT.rope));
  grip.position.y = -def.gripLen / 2;
  g.add(grip);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), MAT.iron);
  ring.position.y = -def.gripLen - 0.03;
  g.add(ring);
}

function buildKunai(g, def, bladeMat) {
  g.add(shadowed(new THREE.Mesh(straightBladeGeometry(def.bladeLen, def.bladeW), bladeMat)));
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, def.gripLen, 6), MAT.rope);
  grip.position.y = -def.gripLen / 2;
  g.add(grip);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 5, 10), MAT.iron);
  ring.position.y = -def.gripLen - 0.012;
  g.add(ring);
}

/** Visual model in handle space (not shifted by ycom). */
const MODELS = new Map(), BLADE = new THREE.MeshStandardMaterial();      // (BLADE: stands for "this weapon's own blade material")
export function buildWeaponModel(def, bladeMat = MAT.steel) {
  // modelled once per kind of weapon (the blade alone is an extrusion of dozens of points); every further one shares the geometry
  let tpl = MODELS.get(def.key);
  if (!tpl) {
    const g = new THREE.Group();
    if (def.thrown) buildKunai(g, def, BLADE);
    else if (def.type === 'sword') buildSword(g, def, BLADE);
    else if (def.type === 'polearm') buildPolearm(g, def, BLADE);
    else buildClub(g, def);
    mergeStatic(g);
    tpl = [];
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.updateWorldMatrix(true, false);
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      geo.userData.shared = true;
      tpl.push([geo, o.material, o.castShadow, o.receiveShadow]);
      o.geometry.dispose();
    });
    MODELS.set(def.key, tpl);
  }
  const out = new THREE.Group();
  for (const [geo, mat, cast, recv] of tpl) { const mesh = new THREE.Mesh(geo, mat === BLADE ? bladeMat : mat); mesh.castShadow = cast; mesh.receiveShadow = recv; out.add(mesh); }
  return out;
}

/** Collision shapes, tagged so a hit with the shaft or grip counts as a blunt knock, not a cut. */
function buildShapes(def, body) {
  const off = (y) => new CANNON.Vec3(0, y - def.ycom, 0);
  const add = (shape, y, tag) => { shape.hsPart = tag; body.addShape(shape, off(y)); };
  if (def.type === 'sword') {
    add(new CANNON.Box(new CANNON.Vec3(Math.max(0.02, def.bladeW * 0.5), def.bladeLen * 0.5, 0.02)), def.bladeLen * 0.5, 'blade');
    add(new CANNON.Box(new CANNON.Vec3(0.025, def.gripLen * 0.5, 0.025)), -def.gripLen * 0.5, 'grip');
  } else if (def.type === 'polearm') {
    const len = def.shaftBack + def.shaftFore;
    add(new CANNON.Box(new CANNON.Vec3(0.022, len * 0.5, 0.022)), (def.shaftFore - def.shaftBack) / 2, 'shaft');
    add(new CANNON.Box(new CANNON.Vec3(def.bladeW * 0.5 + 0.005, def.bladeLen * 0.5, 0.02)), def.shaftFore + def.bladeLen * 0.5, 'blade');
  } else {
    add(new CANNON.Box(new CANNON.Vec3(0.05, def.bladeLen * 0.5, 0.05)), def.bladeLen * 0.5, 'blade');
    add(new CANNON.Box(new CANNON.Vec3(0.026, def.gripLen * 0.5, 0.026)), -def.gripLen * 0.5, 'grip');
  }
}

const _cp = new CANNON.Vec3();
const _rel = new CANNON.Vec3();
const _F = new CANNON.Vec3();
const _tau = new CANNON.Vec3();
const P = new THREE.Vector3();
const V = new THREE.Vector3();
const A = new THREE.Vector3();
const E = new THREE.Vector3();
const W = new THREE.Vector3();
const Q = new THREE.Quaternion();

let weaponIdCounter = 1;

export class Weapon {
  constructor(game, key, owner) {
    this.game = game;
    this.id = weaponIdCounter++;
    this.def = WEAPONS[key];
    this.owner = owner; // Samurai or null
    this.attached = !!owner;
    const def = this.def;

    // ---- visuals (own blade material so it can get bloody)
    this.bladeMat = MAT.steel.clone();
    this.bloody = 0;
    this.mesh = new THREE.Group();
    const model = buildWeaponModel(def, this.bladeMat);
    model.position.y = -def.ycom;
    this.mesh.add(model);
    game.scene.add(this.mesh);

    // ---- physics
    const body = new CANNON.Body({ mass: def.mass, material: materials.metal, linearDamping: 0.01, angularDamping: 0.04 });
    buildShapes(def, body);
    body.hs = { type: 'weapon', weapon: this };
    this.body = body;
    this.applyGroup();
    game.world.addBody(body);
    body.addEventListener('collide', (e) => game.queueContact(this, e.body, e.contact));

    // ---- grip points (body-local)
    const h = (y) => new CANNON.Vec3(0, y - def.ycom, 0);
    if (def.type === 'polearm') {
      this.handR = h(0.28);
      this.handL = h(-0.3);
      this.ctrlLocal = h(0);
      this.tipLocal = h(def.shaftFore + def.bladeLen);
      this.trailBase = h(def.shaftFore - 0.05);
    } else {
      this.handR = h(-0.06);
      this.handL = h(-def.gripLen + 0.07);
      this.ctrlLocal = h(-def.gripLen * 0.45);
      this.tipLocal = h(def.bladeLen);
      this.trailBase = h(def.bladeLen * (def.type === 'club' ? 0.3 : 0.15));
    }
    this.lastHit = new Map();
    this.blockedUntil = 0;      // after being blocked/deflected the swing is dead for a moment
    this.prevTip = new THREE.Vector3();
    this.tipSpeed = 0;
    this.born = game.time;
    this.trail = def.thrown ? null : game.effects?.createTrail(0xdfe6ee) ?? null;
  }

  applyGroup() {
    if (!this.attached || !this.owner) setGroup(this.body, 'PROP');
    else setGroup(this.body, this.owner.team === 0 ? 'PWEAP' : 'EWEAP');
  }

  /** Place the weapon so its control point sits at `pos` with orientation `quat` (THREE). */
  teleport(pos, quat) {
    const b = this.body;
    b.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    b.quaternion.vmult(this.ctrlLocal, _rel);
    b.position.set(pos.x - _rel.x, pos.y - _rel.y, pos.z - _rel.z);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    snapPrev(b);
    this.sync();
  }

  /** Smear the blade (0..1). */
  bloodUp(amount) {
    this.bloody = Math.min(1, this.bloody + amount);
    this.bladeMat.color.lerpColors(STEEL_COLOR, BLOOD_COLOR, Math.min(0.85, this.bloody));
  }

  drop() {
    if (!this.attached) return;
    this.attached = false;
    this.applyGroup();
    this.body.angularDamping = 0.2;
  }

  attach() {
    this.attached = true;
    this.thrower = null;
    this.thrownAt = -9;
    this.applyGroup();
    this.body.angularDamping = 0.04;
  }

  /** PD drive towards a target. Returns the applied force (CANNON.Vec3, reused). */
  drive(tPos, tVel, tQuat, tAngVel, power = 1, gravScale = 1) {
    const b = this.body;
    const d = this.def.pd;
    b.pointToWorldFrame(this.ctrlLocal, _cp);
    toT(_cp, P);
    pointVelocity(b, P, V);
    A.copy(tPos).sub(P).multiplyScalar(d.kp * power);
    A.x += (tVel.x - V.x) * d.kd; A.y += (tVel.y - V.y) * d.kd; A.z += (tVel.z - V.z) * d.kd;
    A.multiplyScalar(b.mass);
    A.y += b.mass * 9.82 * gravScale;
    clampLen(A, d.maxF * Math.max(power, 0.35));
    toC(A, _F);
    _rel.set(P.x - b.position.x, P.y - b.position.y, P.z - b.position.z);
    b.applyForce(_F, _rel);

    quatError(tQuat, qToT(b.quaternion, Q), E);
    W.set(
      E.x * d.rkp * power + (tAngVel.x - b.angularVelocity.x) * d.rkd,
      E.y * d.rkp * power + (tAngVel.y - b.angularVelocity.y) * d.rkd,
      E.z * d.rkp * power + (tAngVel.z - b.angularVelocity.z) * d.rkd,
    );
    worldInertiaMul(b, W, _tau);
    const tl = _tau.length();
    const mt = d.maxT * power;
    if (tl > mt) _tau.scale(mt / tl, _tau);
    b.torque.vadd(_tau, b.torque);
    return _F;
  }

  worldPoint(local, out = new THREE.Vector3()) {
    this.body.pointToWorldFrame(local, _cp);
    return toT(_cp, out);
  }

  sync(dt = 0) {
    const b = this.body;
    syncMesh(this.mesh, b);
    if (dt > 0) {
      // blood on the blade slowly runs off
      if (this.bloody > 0.001) {
        this.bloody = Math.max(0, this.bloody - dt * 0.02);
        this.bladeMat.color.lerpColors(STEEL_COLOR, BLOOD_COLOR, Math.min(0.85, this.bloody));
        this.bladeMat.roughness = 0.16 + 0.3 * Math.min(1, this.bloody);
      }
      const tip = P.copy(toT(this.tipLocal)).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
      this.tipSpeed = tip.distanceTo(this.prevTip) / dt;
      this.prevTip.copy(tip);
      if (this.trail) {
        const base = A.copy(toT(this.trailBase)).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
        const k = this.def.type === 'club' ? 0.6 : 1;
        this.trail.push(base, tip, this.attached ? Math.min(1, Math.max(0, (this.tipSpeed - 9) / 14)) * 0.4 * k : 0);
      }
    }
  }

  dispose() {
    this.game.world.removeBody(this.body);
    this.game.scene.remove(this.mesh);
    this.bladeMat.dispose();
    this.trail?.dispose();
  }
}
