import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export const FIXED_DT = 1 / 120;

// Collision groups
export const G = {
  STATIC: 1,
  PCORE: 2,    // player team active bodies (player + allies)
  ECORE: 4,    // enemy team active bodies
  PWEAP: 8,    // player team weapons
  EWEAP: 16,   // enemy weapons
  RAG: 32,     // ragdoll limbs
  PROP: 64,    // crates, barrels, dropped weapons, thrown kunai
};
const ALL = 0xffff;
export const MASK = {
  STATIC: ALL,
  PCORE: G.STATIC | G.PCORE | G.ECORE | G.EWEAP | G.RAG | G.PROP,
  ECORE: G.STATIC | G.PCORE | G.ECORE | G.PWEAP | G.RAG | G.PROP,
  PWEAP: G.STATIC | G.ECORE | G.EWEAP | G.RAG | G.PROP,
  EWEAP: G.STATIC | G.PCORE | G.PWEAP | G.RAG | G.PROP,
  RAG: G.STATIC | G.PCORE | G.ECORE | G.PWEAP | G.EWEAP | G.PROP | G.RAG,
  PROP: ALL,
};

export const materials = {
  ground: new CANNON.Material('ground'),
  metal: new CANNON.Material('metal'),
  body: new CANNON.Material('body'),
  wood: new CANNON.Material('wood'),
};

export function createWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;
  world.solver.iterations = 14;
  world.solver.tolerance = 0.0005;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.05;
  const m = materials;
  const add = (a, b, friction, restitution) =>
    world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
  add(m.metal, m.metal, 0.15, 0.35);
  add(m.metal, m.ground, 0.5, 0.15);
  add(m.metal, m.body, 0.3, 0.05);
  add(m.metal, m.wood, 0.4, 0.1);
  add(m.body, m.ground, 0.9, 0.0);
  add(m.body, m.body, 0.4, 0.0);
  add(m.wood, m.ground, 0.7, 0.05);
  add(m.wood, m.wood, 0.5, 0.05);
  add(m.body, m.wood, 0.5, 0.0);
  return world;
}

export function setGroup(body, groupName) {
  body.collisionFilterGroup = G[groupName];
  body.collisionFilterMask = MASK[groupName];
}

// ---------- vector helpers ----------
export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const toC = (v, out = new CANNON.Vec3()) => out.set(v.x, v.y, v.z);
export const toT = (v, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
export const qToT = (q, out = new THREE.Quaternion()) => out.set(q.x, q.y, q.z, q.w);
export const qToC = (q, out = new CANNON.Quaternion()) => out.set(q.x, q.y, q.z, q.w);

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
/** Rotation vector (axis * angle) that rotates `cur` onto `target` (both THREE quaternions). */
export function quatError(target, cur, out = new THREE.Vector3()) {
  _qa.copy(cur).invert();
  _qb.copy(target).multiply(_qa);
  if (_qb.w < 0) { _qb.x = -_qb.x; _qb.y = -_qb.y; _qb.z = -_qb.z; _qb.w = -_qb.w; }
  const s = Math.sqrt(_qb.x * _qb.x + _qb.y * _qb.y + _qb.z * _qb.z);
  if (s < 1e-6) return out.set(0, 0, 0);
  const angle = 2 * Math.atan2(s, _qb.w);
  return out.set(_qb.x / s * angle, _qb.y / s * angle, _qb.z / s * angle);
}

const _l = new CANNON.Vec3();
const _cq = new CANNON.Quaternion();
/** Multiply a world-space angular acceleration by the body's inertia (in local frame). */
export function worldInertiaMul(body, accWorld, out = new CANNON.Vec3()) {
  toC(accWorld, out);
  body.quaternion.conjugate(_cq);
  _cq.vmult(out, _l);
  _l.x *= body.inertia.x; _l.y *= body.inertia.y; _l.z *= body.inertia.z;
  body.quaternion.vmult(_l, out);
  return out;
}

/** Velocity of a world point attached to a body. */
export function pointVelocity(body, worldPoint, out = new THREE.Vector3()) {
  const rx = worldPoint.x - body.position.x, ry = worldPoint.y - body.position.y, rz = worldPoint.z - body.position.z;
  const w = body.angularVelocity, v = body.velocity;
  return out.set(
    v.x + (w.y * rz - w.z * ry),
    v.y + (w.z * rx - w.x * rz),
    v.z + (w.x * ry - w.y * rx),
  );
}

export function clampLen(v, max) {
  const l = v.length();
  if (l > max) v.multiplyScalar(max / l);
  return v;
}

export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export function dampFactor(rate, dt) { return 1 - Math.exp(-rate * dt); }
/** Shortest signed difference between two angles. */
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const angleLerp = (a, b, t) => a + angleDiff(a, b) * t;

// ---------- render interpolation (smooth visuals between 120 Hz physics steps)
export const RENDER = { alpha: 1 };
const _ip = new CANNON.Vec3();
const _iq = new CANNON.Quaternion();
export function interpPos(body, out = new THREE.Vector3()) {
  body.previousPosition.lerp(body.position, RENDER.alpha, _ip);
  return out.set(_ip.x, _ip.y, _ip.z);
}
export function interpQuat(body, out = new THREE.Quaternion()) {
  body.previousQuaternion.slerp(body.quaternion, RENDER.alpha, _iq);
  return out.set(_iq.x, _iq.y, _iq.z, _iq.w).normalize();
}
/** After teleporting a body, stop it from interpolating from the old spot. */
export function snapPrev(body) {
  body.previousPosition.copy(body.position);
  body.previousQuaternion.copy(body.quaternion);
}
export function syncMesh(mesh, body) {
  interpPos(body, mesh.position);
  interpQuat(body, mesh.quaternion);
}
