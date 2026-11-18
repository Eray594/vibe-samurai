// Things in the yard that can be smashed: crates, sake barrels, clay jars, paper screens and the
// stone lanterns. Each has a little toughness; blades, clubs and bodies thrown into them wear it
// down until the object comes apart into loose physical pieces.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeStatic } from './perf.js';
import { materials, setGroup, rand, snapPrev, syncMesh } from './physics.js';

const KINDS = {
  crate: { hp: 28, mass: 22, dynamic: true, impact: 5.5, sound: 'wood', chip: [0.34, 0.22, 0.12] },
  barrel: { hp: 26, mass: 28, dynamic: true, impact: 5.5, sound: 'wood', chip: [0.62, 0.52, 0.3] },
  pot: { hp: 8, mass: 14, dynamic: true, impact: 3, sound: 'clay', chip: [0.5, 0.3, 0.2] },
  screen: { hp: 9, mass: 0, dynamic: false, sound: 'wood', chip: [0.85, 0.82, 0.72] },
  lantern: { hp: 60, mass: 0, dynamic: false, sound: 'stone', chip: [0.45, 0.44, 0.42] },
};

const SPOTS = [
  ['crate', -9.5, 6], ['crate', -9.6, 6.9], ['crate', -9.2, 6.4, { stack: 0.71 }],
  ['barrel', 9.8, 4], ['barrel', 9.1, 4.8], ['barrel', 9.6, 4.5, { stack: 0.81 }], ['barrel', -4.2, 10.4], ['barrel', 10.4, -2.5],
  ['crate', 4.6, 10.6],
  ['pot', 5.6, 9.7], ['pot', 6.2, 10.1], ['pot', 6.9, 9.6], ['pot', -6.5, 9.9], ['pot', -7.2, 9.4], ['pot', 3.1, -11.2], ['pot', -3.2, -11.3],
  ['screen', 5.4, -10.4, { rot: -0.42 }], ['screen', 10.3, 1.4, { rot: 1.25 }], ['screen', -10.4, 0.6, { rot: -1.35 }],
];

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

export class Breakables {
  constructor(game, arena) {
    this.game = game;
    this.arena = arena;
    this.items = [];
    this.pending = [];       // damage from collisions, applied after the physics step
    const M = arena.M;
    this.mat = {
      paper: new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.95, side: THREE.DoubleSide, emissive: 0x3a3020, emissiveIntensity: 0.35 }),
      clay: new THREE.MeshStandardMaterial({ color: 0x8a5236, roughness: 0.6, side: THREE.DoubleSide }),
      glaze: new THREE.MeshStandardMaterial({ color: 0x2c2a3c, roughness: 0.25, metalness: 0.2, side: THREE.DoubleSide }),
      wood: M.wood, dark: M.darkWood, straw: M.straw, stone: M.stone, glow: M.glow, plaster: M.plaster,
    };
    this.geo = {
      crate: new THREE.BoxGeometry(0.7, 0.7, 0.7),
      crateEdge: new THREE.BoxGeometry(0.72, 0.08, 0.72),
      panel: new THREE.BoxGeometry(0.68, 0.68, 0.04),
      barrel: new THREE.CylinderGeometry(0.3, 0.26, 0.8, 14),
      stave: new THREE.BoxGeometry(0.21, 0.78, 0.03),
      lid: new THREE.CylinderGeometry(0.27, 0.27, 0.03, 14),
      rope: new THREE.TorusGeometry(0.295, 0.016, 6, 20),
      pot: new THREE.LatheGeometry([[0.07, 0], [0.15, 0.08], [0.17, 0.2], [0.13, 0.32], [0.08, 0.36], [0.1, 0.4]].map(([r, y]) => new THREE.Vector2(r * 1.9, (y - 0.2) * 1.9)), 16),     // waist-high storage jar
      shard: new THREE.BoxGeometry(0.22, 0.26, 0.03),
      paper: new THREE.BoxGeometry(0.38, 0.52, 0.012),
      stick: new THREE.BoxGeometry(0.04, 1.7, 0.05),
      rail: new THREE.BoxGeometry(1.64, 0.04, 0.05),
      lBase: new THREE.CylinderGeometry(0.3, 0.36, 0.2, 6),
      lPost: new THREE.CylinderGeometry(0.11, 0.14, 0.9, 8),
      lPlat: new THREE.CylinderGeometry(0.32, 0.18, 0.14, 6),
      lLamp: new THREE.BoxGeometry(0.3, 0.3, 0.3),
      lRoof: new THREE.ConeGeometry(0.5, 0.3, 6),
    };
    this.spawnAll();
  }

  spawnAll() {
    for (const [kind, x, z, o] of SPOTS) this.add(kind, x, z, o);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      this.add('lantern', Math.sin(a) * 12.1, Math.cos(a) * 12.1, { rot: a });
    }
  }

  get lanterns() { return this.items.filter((i) => i.kind === 'lantern' && !i.broken); }

  /** How many lanterns actually light the yard (the rest only glow): every light costs on every pixel. */
  setLightBudget(n) {
    this.lightBudget = n;
    const all = this.items.filter((i) => i.kind === 'lantern' && i.light);
    const step = all.length > n ? Math.round(all.length / n) : 1;
    all.forEach((it, i) => { it.lit = i % step === 0; it.light.visible = it.lit; it.boost = all.length > n ? 1.5 : 1; });
  }

  // ------------------------------------------------------------------ building
  add(kind, x, z, o = {}) {
    const K = KINDS[kind], G = this.geo, M = this.mat, { scene, world } = this.game;
    const mesh = new THREE.Group();
    const part = (geo, mat, px = 0, py = 0, pz = 0) => { const m = sh(new THREE.Mesh(geo, mat)); m.position.set(px, py, pz); mesh.add(m); return m; };
    const body = new CANNON.Body({ mass: K.mass, material: kind === 'lantern' ? materials.ground : materials.wood, linearDamping: 0.1, angularDamping: 0.2 });
    let y = 0;
    const item = { kind, K, hp: K.hp, mesh, body, broken: false, light: null, phase: Math.random() * 100 };
    if (kind === 'crate') {
      part(G.crate, M.wood); part(G.crateEdge, M.dark);
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.35, 0.35, 0.35)));
      y = 0.35;
    } else if (kind === 'barrel') {
      part(G.barrel, M.straw);
      for (const ry of [-0.26, 0, 0.26]) part(G.rope, M.dark, 0, ry, 0).rotation.x = Math.PI / 2;
      part(G.lid, M.plaster, 0, 0.4, 0);
      body.addShape(new CANNON.Cylinder(0.3, 0.28, 0.8, 12));
      y = 0.4;
    } else if (kind === 'pot') {
      part(G.pot, Math.random() < 0.5 ? M.clay : M.glaze);
      body.addShape(new CANNON.Cylinder(0.29, 0.23, 0.72, 10));
      y = 0.38;
    } else if (kind === 'screen') {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) part(G.paper, M.paper, -0.6 + i * 0.4, -0.55 + j * 0.55, 0);
      for (let i = 0; i < 5; i++) part(G.stick, M.dark, -0.8 + i * 0.4, 0, 0);
      for (let j = 0; j < 4; j++) part(G.rail, M.dark, 0, -0.83 + j * 0.553, 0);
      for (const s of [-1, 1]) part(new THREE.BoxGeometry(0.07, 0.07, 0.5), M.dark, s * 0.8, -0.82, 0);
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.82, 0.85, 0.04)));
      y = 0.86;
    } else {
      part(G.lBase, M.stone, 0, 0.1, 0);
      item.upper = [
        part(G.lPost, M.stone, 0, 0.65, 0), part(G.lPlat, M.stone, 0, 1.17, 0),
        part(G.lLamp, M.glow, 0, 1.39, 0), part(G.lRoof, M.stone, 0, 1.7, 0),
      ];
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.95, 0.3)), new CANNON.Vec3(0, 0.95, 0));
      item.light = new THREE.PointLight(0xff9a48, 10, 0, 2);
      item.light.position.set(x * 0.95, 1.5, z * 0.95);
      scene.add(item.light);
      this.arena.obstacles.push([x, z, 0.75]);
    }
    body.position.set(x, y + (o.stack || 0), z);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), o.rot ?? rand(0, 1.5));
    body.hs = { type: K.dynamic ? 'prop' : 'static', kind: kind === 'lantern' ? 'stone' : 'wood', breakable: item };
    setGroup(body, K.dynamic ? 'PROP' : 'STATIC');
    snapPrev(body);
    if (K.dynamic) {
      // being thrown, kicked over or fallen on hurts too
      body.addEventListener('collide', (e) => {
        if (item.broken || e.body.hs?.type === 'weapon') return;
        const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (v > K.impact) this.pending.push([item, (v - K.impact) * (kind === 'pot' ? 4 : 5), null, null]);
      });
    }
    world.addBody(body);
    if (kind === 'screen' || kind === 'barrel') mergeStatic(mesh);      // dozens of slats and panes: one draw call per material
    scene.add(mesh);
    syncMesh(mesh, body);
    this.items.push(item);
    return item;
  }

  // ------------------------------------------------------------------ damage
  /** A weapon struck the object. */
  weaponHit(item, weapon, point, dir, speed) {
    if (item.broken || speed < 4) return;
    const def = weapon.def;
    let dmg = speed * Math.sqrt(def.mass) * (def.type === 'club' ? 2 : 1);
    if (item.kind === 'lantern' && def.type !== 'club') dmg *= 0.5;       // steel on stone mostly ruins the edge
    if (def.thrown) dmg *= 0.3;
    this.damage(item, dmg, point, dir);
  }

  damage(item, dmg, point, dir) {
    if (item.broken) return;
    item.hp -= dmg;
    const p = point || _v.set(item.body.position.x, item.body.position.y, item.body.position.z).clone();
    const d = dir || new THREE.Vector3(rand(-1, 1), 0.3, rand(-1, 1)).normalize();
    if (item.hp > 0) {
      this.game.effects.splinters(p, d, 5, ...item.K.chip);
      return;
    }
    this.shatter(item, p, d);
  }

  shatter(item, point, dir) {
    const { game } = this, { scene, world } = game, G = this.geo, M = this.mat;
    item.broken = true;
    const b = item.body;
    const origin = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
    const quat = new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    const pieces = [];      // [geometry, material, local position, local euler, mass, half extents]
    const P = (geo, mat, x, y, z, rx, ry, rz, mass, hx, hy, hz) => pieces.push([geo, mat, new THREE.Vector3(x, y, z), new THREE.Euler(rx, ry, rz), mass, [hx, hy, hz]]);
    if (item.kind === 'crate') {
      for (const s of [-1, 1]) {
        P(G.panel, M.wood, 0, 0, s * 0.33, 0, 0, 0, 2.5, 0.34, 0.34, 0.02);
        P(G.panel, M.wood, s * 0.33, 0, 0, 0, Math.PI / 2, 0, 2.5, 0.34, 0.34, 0.02);
        P(G.panel, M.wood, 0, s * 0.33, 0, Math.PI / 2, 0, 0, 2.5, 0.34, 0.34, 0.02);
      }
    } else if (item.kind === 'barrel') {
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        P(G.stave, M.straw, Math.sin(a) * 0.27, 0, Math.cos(a) * 0.27, 0, a, 0, 1.6, 0.105, 0.39, 0.015);
      }
      P(G.lid, M.plaster, 0, 0.38, 0, 0, 0, 0, 1.5, 0.19, 0.015, 0.19);
      P(G.lid, M.dark, 0, -0.38, 0, 0, 0, 0, 1.5, 0.19, 0.015, 0.19);
    } else if (item.kind === 'pot') {
      const mat = item.mesh.children[0].material;
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9;
        P(G.shard, mat, Math.sin(a) * 0.22, rand(-0.28, 0.28), Math.cos(a) * 0.22, rand(-0.4, 0.4), a, rand(-0.4, 0.4), 0.9, 0.11, 0.13, 0.015);
      }
    } else if (item.kind === 'screen') {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) P(G.paper, M.paper, -0.6 + i * 0.4, -0.55 + j * 0.55, 0, 0, 0, 0, 0.25, 0.19, 0.26, 0.012);
      for (let i = 0; i < 5; i++) P(G.stick, M.dark, -0.8 + i * 0.4, 0, 0, 0, 0, 0, 0.9, 0.02, 0.85, 0.025);
      for (let j = 0; j < 4; j++) P(G.rail, M.dark, 0, -0.83 + j * 0.553, 0, 0, 0, 0, 0.9, 0.82, 0.02, 0.025);
    } else {
      // lantern: everything above the foot comes down; the light dies
      P(G.lPost, M.stone, 0, 0.65, 0, 0, 0, 0, 30, 0.1, 0.45, 0.1);
      P(G.lPlat, M.stone, 0, 1.17, 0, 0, 0, 0, 14, 0.22, 0.07, 0.22);
      P(G.lLamp, M.stone, 0, 1.39, 0, 0, 0, 0, 12, 0.15, 0.15, 0.15);
      P(G.lRoof, M.stone, 0, 1.7, 0, 0, 0, 0, 22, 0.33, 0.12, 0.33);
      for (const m of item.upper) item.mesh.remove(m);
      if (item.light) { scene.remove(item.light); item.light = null; }
    }
    world.removeBody(b);
    if (item.kind === 'lantern') {
      // the foot stays as a low obstacle
      const foot = new CANNON.Body({ mass: 0, material: materials.ground });
      foot.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.1, 0.3)));
      foot.position.set(origin.x, 0.1, origin.z);
      foot.hs = { type: 'static', kind: 'stone' };
      setGroup(foot, 'STATIC');
      world.addBody(foot);
      item.body = foot;
    } else {
      scene.remove(item.mesh);
      item.body = null;
    }
    const heavy = item.kind === 'lantern';
    for (const [geo, mat, lp, le, mass, he] of pieces) {
      const mesh = sh(new THREE.Mesh(geo, mat));
      const body = new CANNON.Body({ mass, material: heavy ? materials.ground : materials.wood, linearDamping: 0.1, angularDamping: 0.25 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(...he)));
      const wp = lp.clone().applyQuaternion(quat).add(origin);
      const wq = _q.setFromEuler(le).premultiply(quat);
      body.position.set(wp.x, wp.y, wp.z);
      body.quaternion.set(wq.x, wq.y, wq.z, wq.w);
      const out = _v.copy(wp).sub(origin).setY(0).normalize();
      const k = heavy ? 0.5 : 1;
      body.velocity.set((dir.x * rand(1, 3) + out.x * rand(0.5, 2)) * k, rand(0.5, 2.5) * k, (dir.z * rand(1, 3) + out.z * rand(0.5, 2)) * k);
      body.angularVelocity.set(rand(-6, 6) * k, rand(-6, 6) * k, rand(-6, 6) * k);
      body.hs = { type: 'prop', kind: heavy ? 'stone' : 'wood' };
      setGroup(body, 'PROP');
      snapPrev(body);
      world.addBody(body);
      scene.add(mesh);
      this.arena.addDebris(mesh, body);
    }
    // what it sounds and looks like
    const fx = game.effects, au = game.audio, c = item.K.chip;
    fx.splinters(point, dir, item.kind === 'pot' ? 14 : 30, ...c);
    fx.dust(origin, heavy ? 22 : 10, heavy ? 1.6 : 1);
    if (item.kind === 'barrel') fx.splinters(origin, new THREE.Vector3(0, 1, 0), 60, 0.82, 0.86, 0.9);    // the sake
    if (item.K.sound === 'wood') au.wood(1.3, true);
    else { au.thud(heavy ? 1.2 : 0.5); au.clank(heavy ? 0.5 : 0.35, heavy ? 0.4 : 1.6); }
    if (heavy) game.shake = Math.max(game.shake, 0.4);
  }

  // ------------------------------------------------------------------ per frame
  update() {
    if (this.pending.length) {
      const list = this.pending;
      this.pending = [];
      for (const [item, dmg, p, d] of list) this.damage(item, dmg, p, d);
    }
    const t = this.arena.time;
    for (const it of this.items) {
      if (it.broken) continue;
      if (it.K.dynamic) syncMesh(it.mesh, it.body);
      if (it.light) {
        const f = 0.85 + Math.sin(t * 9 + it.phase) * 0.06 + Math.sin(t * 21.7 + it.phase * 2) * 0.04 + Math.random() * 0.05;
        it.light.intensity = 11 * f * (it.boost || 1);
      }
    }
  }

  reset() {
    const { scene, world } = this.game;
    for (const it of this.items) {
      if (it.body) world.removeBody(it.body);
      scene.remove(it.mesh);
      if (it.light) scene.remove(it.light);
    }
    this.items = [];
    this.pending = [];
    this.arena.obstacles = this.arena.obstacles.filter((o) => o[2] !== 0.75);
    this.spawnAll();
    if (this.lightBudget) this.setLightBudget(this.lightBudget);
  }
}
