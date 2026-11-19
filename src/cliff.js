// The second map, as far as the fighting is concerned: a round rock plateau high above the clouds.
// A low fence runs along the rim, but in three places it is gone and nothing stops a body from
// going over; a bronze bell hangs in its frame, and striking it shakes everyone near it.
// What it looks like is in cliffscape.js, which draws over the plain shapes built here.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Arena, WALL_R } from './arena.js';
import { G, materials, setGroup } from './physics.js';

/** Where the rock ends. The fence stands a little inside of it. */
export const EDGE_R = 15.0;
export const RAIL_H = 1.3;
const SEG = 36, STEP = Math.PI * 2 / SEG;
/** The open stretches of the rim, as fence segments left out: [first segment, how many]. */
const OPEN = [[5, 3], [23, 3], [35, 3]];
/** The same as angles: [centre, half width]. As everywhere: x = sin(a), z = cos(a). */
export const GAPS = OPEN.map(([i, n]) => [((i + (n - 1) / 2) * STEP) % (Math.PI * 2), n * STEP / 2]);
export const BELL = { x: 6.7, z: -6.0, y: 1.55, reach: 6.5, cd: 10 };
/** The boulder to climb, and the step up to it. */
export const ROCK = { x: -7.1, z: 4.7, w: 2.6, top: 2.6, step: { dx: 1.85, w: 1.1, d: 1.6, top: 0.95 } };
/** Where the maples stand. */
export const TREES = [1.9, 3.6, 5.0].map((a) => [Math.sin(a) * 11.4, Math.cos(a) * 11.4]);
const VOID_Y = -40;          // what has fallen this far is left lying there, out of sight
const HOLD_R = 13.9;         // nobody who is not the player walks closer to an open edge than this
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const isOpenSeg = (i) => OPEN.some(([i0, n]) => ((i - i0 + SEG) % SEG) < n);

const SPOTS = [
  ['crate', -5.0, 7.3], ['crate', -5.8, 7.8], ['crate', -5.4, 7.5, { stack: 0.71 }],
  ['barrel', 3.9, -10.6], ['barrel', 4.7, -10.9], ['barrel', 8.2, -9.2], ['barrel', 10.6, 3.4],
  ['pot', -2.6, -11.3], ['pot', 2.7, -11.4], ['pot', -10.2, -2.6], ['pot', -10.7, -2.0], ['pot', 9.9, -1.0],
  ['screen', 4.9, 9.4, { rot: 0.45 }], ['screen', -9.6, 1.4, { rot: -1.4 }],
];

export class CliffBase extends Arena {
  get key() { return 'cliff'; }
  /** There is an edge to fall off here. */
  get abyss() { return true; }
  get spots() { return SPOTS; }
  get looks() {
    // clear mountain light: a morning above the clouds instead of the yard's dusk
    return {
      dusk: { name: 'Morgen über den Wolken', hemi: [0xb4c4e8, 0x6a5a4a, 1.15], sun: [0xffd2a0, 2.3], fog: [0xb8c0d4, 0.007], sky: [1.25, 0.75, 0], exposure: 1.05, env: 0.8, bloom: 0.3 },
      rain: { fog: [0x4a525e, 0.034] },
      snow: { fog: [0xb4bccb, 0.028] },
    };
  }
  matSpots() {
    return { straw: [[-3.2, 9.4], [-4.6, 8.2], [3.8, -9.6]], bamboo: [[-9.9, -1.2], [-10.4, -0.6], [-9.7, -0.4], [8.9, 2.6], [9.5, 2.2], [9.2, 3.1]] };
  }

  solidAt(x, z) { return x * x + z * z < EDGE_R * EDGE_R; }

  /** Is the rim open in this direction? `margin` widens the opening by that many metres on each side. */
  openAt(x, z, margin = 0) {
    const r = Math.hypot(x, z) || 1, a = Math.atan2(x, z);
    for (const [c, hw] of GAPS) if (angDiff(a, c) < hw + margin / r) return true;
    return false;
  }

  /** Is this point within `d` metres of an open edge? */
  nearEdge(x, z, d = 2.2) { return Math.hypot(x, z) > EDGE_R - d && this.openAt(x, z, 0.3); }

  // ---------------------------------------------------------------- ground and rim
  buildGround(scene, world) {
    // the floor is the same endless plane as in the yard, but in a group of its own: whatever is
    // out beyond the edge stops colliding with it (see step) and falls
    const gb = this.addGroundPlane(world);
    gb.collisionFilterGroup = G.GROUND;
    this.drawGround(scene);
  }

  buildWall(scene, staticBox) {
    const segLen = STEP * WALL_R + 0.06;
    this.rail = [];
    for (let i = 0; i < SEG; i++) {
      if (isOpenSeg(i)) continue;
      const a = i * STEP;
      staticBox(segLen, RAIL_H, 0.9, Math.sin(a) * WALL_R, RAIL_H / 2, Math.cos(a) * WALL_R, a, 'wood');
      this.rail.push(a);
    }
    this.drawRim(scene);
  }

  buildScenery(scene) { this.drawScenery(scene); }

  buildTrees(scene, staticBox) {
    this.treeSpots = TREES.map(([x, z]) => [x, z]);
    for (const [x, z] of TREES) {
      staticBox(0.5, 3, 0.5, x, 1.5, z, 0, 'wood');
      this.obstacles.push([x, z, 0.85]);
    }
    this.drawTrees(scene);
  }

  buildVerge(scene) { this.drawVerge(scene); }
  buildBanners(scene) { this.drawBanners(scene); }

  // ---------------------------------------------------------------- the bell
  buildExtras(scene, staticBox) {
    const { x, z, y } = BELL;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) staticBox(0.26, 3.4, 0.26, x + sx * 1.15, 1.7, z + sz * 1.15, 0, 'wood');
    const b = new CANNON.Body({ mass: 0, material: materials.metal });
    b.addShape(new CANNON.Cylinder(0.5, 0.62, 1.15, 12));
    b.position.set(x, y, z);
    b.hs = { type: 'static', kind: 'stone', bell: true };
    setGroup(b, 'STATIC');
    this.game.world.addBody(b);
    this.bell = { x, z, y, body: b, cd: 0, swing: 0, swingV: 0, dirX: 1, dirZ: 0, pivot: this.drawBell(scene) };
    this.obstacles.push([x, z, 1.75]);
  }

  /**
   * A blade (or anything swung hard) has struck the bell. Rung properly, it staggers everyone
   * near it who is not on the striker's side. Returns whether it rang out.
   */
  ringBell(who, speed, dir) {
    const g = this.game, B = this.bell;
    if (dir) { const l = Math.hypot(dir.x, dir.z) || 1; B.dirX = dir.x / l; B.dirZ = dir.z / l; }
    B.swingV += Math.min(1, speed / 9) * 2.2;
    if (B.cd > 0 || speed < 5) { g.audio.bell?.(0.2); return false; }
    B.cd = BELL.cd;
    g.audio.bell?.(1);
    g.shake = Math.max(g.shake, 0.45);
    const at = new THREE.Vector3(B.x, 1.2, B.z), dv = new THREE.Vector3();
    g.effects.dust(at.clone().setY(0.05), 26, 3.2);
    let n = 0;
    for (const k of g.fighters) {
      if (k === who || (who && k.team === who.team) || k.state !== 'active' || k.dead || k.mountH > 0) continue;
      const p = k.core.position, dx = p.x - B.x, dz = p.z - B.z, d = Math.hypot(dx, dz);
      if (d > BELL.reach) continue;
      const f = 1 - 0.55 * d / BELL.reach;
      k.stagger(dv.set(dx / (d || 1) * 2.4 * f, 0, dz / (d || 1) * 2.4 * f), at.set(p.x, p.y + 0.3, p.z), 0.35 * f, 0.5 + 0.7 * f);
      k.addPosture(k.postureMax * (k.isPlayer ? 0.35 : 0.6) * f);
      k.brain?.dazed?.(0.9 + 1.3 * f);
      n++;
    }
    g.callout('DIE GLOCKE DRÖHNT!', new THREE.Vector3(B.x, 2.6, B.z), 'parry');
    if (n && who?.isPlayer) g.ach?.add('bell');
    return true;
  }

  // ---------------------------------------------------------------- the edge
  /** Everyone but the player keeps his feet away from an open edge, as long as he has them under him. */
  holdBack(k) {
    const b = k.core, p = b.position, r = Math.hypot(p.x, p.z);
    if (r < HOLD_R - 0.7 || !this.openAt(p.x, p.z, 0.5)) return;
    const ox = p.x / r, oz = p.z / r, mv = k.intent.move;
    const d = mv.x * ox + mv.z * oz;
    if (d > 0) { mv.x -= ox * d; mv.z -= oz * d; }
    if (r > HOLD_R) {
      const v = b.velocity, dv = v.x * ox + v.z * oz;
      if (dv > 0) { v.x -= ox * dv; v.z -= oz * dv; }
    }
  }

  /** Before every physics step: what is out over the edge no longer rests on the floor. */
  step() {
    const R2 = EDGE_R * EDGE_R;
    for (const b of this.game.world.bodies) {
      if (b.mass <= 0) continue;
      const p = b.position;
      if (p.x * p.x + p.z * p.z > R2) {
        if (b.collisionFilterMask & G.GROUND) b.collisionFilterMask &= ~G.GROUND;
        b.overVoid = true;
        if (p.y < VOID_Y) { p.y = VOID_Y; b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0); }
      } else if (b.overVoid) {
        // back over the rock (a body that swung out and in again), unless it is already below it
        if (p.y > -0.25) { b.overVoid = false; b.collisionFilterMask |= G.GROUND; }
        else {
          if (b.collisionFilterMask & G.GROUND) b.collisionFilterMask &= ~G.GROUND;
          if (p.y < VOID_Y) { p.y = VOID_Y; b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0); }
        }
      }
    }
  }

  /** The boulder to climb: the same two standable boxes as the yard's podium, somewhere else. */
  buildPlatforms() {
    const list = [], R = ROCK;
    const box = (cx, cz, w, d, top) => {
      this.staticBox(w, top, d, cx, top / 2, cz, 0, 'stone');
      list.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, top });
    };
    box(R.x, R.z, R.w, R.w, R.top);
    box(R.x + R.step.dx, R.z, R.step.w, R.step.d, R.step.top);
    this.obstacles.push([R.x, R.z, 1.95]);
    this.drawRock(this.game.scene);
    return list;
  }

  update(dt) {
    super.update(dt);
    const B = this.bell;
    B.cd = Math.max(0, B.cd - dt);
    B.swingV += (-B.swing * 14 - B.swingV * 0.9) * dt;
    B.swing += B.swingV * dt;
    if (B.pivot) B.pivot.rotation.set(B.dirZ * B.swing * 0.16, 0, -B.dirX * B.swing * 0.16);
  }

  // ---------------------------------------------------------------- plain shapes (cliffscape.js draws the real thing)
  drawGround(scene) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(EDGE_R, EDGE_R - 2, 30, 48), this.M.stone);
    m.position.y = -15;
    m.receiveShadow = true;
    scene.add(m);
  }

  drawRim(scene) {
    for (const a of this.rail) {
      const m = this.sh(new THREE.Mesh(new THREE.BoxGeometry(STEP * WALL_R, RAIL_H, 0.2), this.M.vermilion));
      m.position.set(Math.sin(a) * (WALL_R - 0.35), RAIL_H / 2, Math.cos(a) * (WALL_R - 0.35));
      m.rotation.y = a;
      scene.add(m);
    }
  }

  drawScenery() {}
  drawVerge() {}
  drawBanners() {}

  drawTrees(scene) {
    for (const [x, z] of TREES) {
      const m = this.sh(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 3, 10), this.M.bark));
      m.position.set(x, 1.5, z);
      scene.add(m);
    }
  }

  /** Returns the group that swings when the bell is struck (its origin is where the bell hangs from). */
  drawBell(scene) {
    const { x, z, y } = BELL;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = this.sh(new THREE.Mesh(new THREE.BoxGeometry(0.26, 3.4, 0.26), this.M.darkWood));
      post.position.set(x + sx * 1.15, 1.7, z + sz * 1.15);
      scene.add(post);
    }
    const pivot = new THREE.Group();
    pivot.position.set(x, 3.3, z);
    const bell = this.sh(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.15, 20), this.M.iron));
    bell.position.y = y - 3.3;
    pivot.add(bell);
    scene.add(pivot);
    return pivot;
  }

  drawRock(scene) {
    const R = ROCK;
    const a = this.sh(new THREE.Mesh(new THREE.BoxGeometry(R.w, R.top, R.w), this.M.stone));
    a.position.set(R.x, R.top / 2, R.z);
    const b = this.sh(new THREE.Mesh(new THREE.BoxGeometry(R.step.w, R.step.top, R.step.d), this.M.stone));
    b.position.set(R.x + R.step.dx, R.step.top / 2, R.z);
    scene.add(a, b);
  }
}
