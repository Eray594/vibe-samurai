// Things in the yard that can be smashed: crates, sake barrels, clay jars, paper screens and the
// stone lanterns. Each has a little toughness; blades, clubs and bodies thrown into them wear it
// down until the object comes apart into loose physical pieces.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeStatic } from './perf.js';
import { materials, setGroup, rand, snapPrev, syncMesh } from './physics.js';
import { bake, fbmField, sstep, rbox, put, tint, turnUV, scaleUV, mergeGeos } from './envkit.js';

/** Fired clay with throwing rings; with `glazed`, a dark glaze poured over the shoulder and run down in tongues. */
function potMaps(glazed) {
  const S = 256, speck = fbmField(S, S, 64, 64, 2, 301), blot = fbmField(S, S, 5, 5, 4, 302), run = fbmField(S, S, 14, 1, 3, 303);
  return bake(S, S, (x, y, o) => {
    const i = y * S + x, v = 1 - y / S, ring = Math.sin(v * 110 + blot[i] * 3) * 0.5 + 0.5;
    const k = 0.84 + 0.05 * ring + 0.26 * (blot[i] - 0.5) + 0.14 * (speck[i] - 0.5);
    const gl = glazed ? sstep(-0.02, 0.02, v - 0.36 - run[i] * 0.3) : 0, lip = glazed ? sstep(0.06, 0.0, Math.abs(v - 0.36 - run[i] * 0.3)) : 0;
    o[0] = (168 * (1 - gl) + 44 * gl + lip * 70) * k; o[1] = (108 * (1 - gl) + 44 * gl + lip * 80) * k; o[2] = (80 * (1 - gl) + 66 * gl + lip * 70) * k;
    o[3] = ring * 0.1 + speck[i] * 0.25 + blot[i] * 0.3 + gl * 0.3;
    o[4] = 0.85 - gl * 0.68;
  }, { bump: 2.2, rough: true });
}

/** The head of a sake cask: pale boards with the brewer's mark brushed on. */
function lidTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d9c7a0'; g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x++) { g.fillStyle = `rgba(90,60,30,${0.05 + 0.1 * Math.abs(Math.sin(x * 0.7 + Math.sin(x * 0.13) * 3))})`; g.fillRect(x, 0, 1, 128); }
  g.fillStyle = 'rgba(60,40,20,0.5)';
  for (const x of [32, 64, 96]) g.fillRect(x, 0, 1.5, 128);
  g.strokeStyle = '#8c1c16'; g.lineWidth = 7;
  g.beginPath(); g.arc(64, 64, 30, 0, 6.3); g.stroke();
  g.strokeStyle = '#1c1612'; g.lineWidth = 8; g.lineCap = 'round';
  g.beginPath(); g.moveTo(48, 54); g.lineTo(80, 54); g.moveTo(64, 44); g.lineTo(64, 84); g.moveTo(50, 70); g.lineTo(78, 70); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Crisp facets on a turned shape (a six-sided lantern roof must not shade like a cone). */
const faceted = (geo) => { const g = geo.toNonIndexed(); g.computeVertexNormals(); return g; };

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
    const M = arena.M, T = arena.T;
    const white = (g) => tint(g, 1, 1, 1), dark = (g) => tint(g, 0.42, 0.37, 0.34);
    this.mat = {
      paper: new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.95, side: THREE.DoubleSide, emissive: 0x3a3020, emissiveIntensity: 0.35, normalMap: T.plaster.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) }),
      clay: new THREE.MeshStandardMaterial({ ...potMaps(false), roughness: 1, side: THREE.DoubleSide }),
      glaze: new THREE.MeshStandardMaterial({ ...potMaps(true), roughness: 1, metalness: 0.05, side: THREE.DoubleSide }),
      // boards and battens of a crate, straw and rope of a cask: one material each, the darker parts tinted per vertex
      crate: new THREE.MeshStandardMaterial({ ...T.plank, color: 0xb09880, roughness: 0.88, vertexColors: true }),
      cask: new THREE.MeshStandardMaterial({ ...T.strawWrap, color: 0xd8c9a0, roughness: 0.95, vertexColors: true }),
      lid: new THREE.MeshStandardMaterial({ map: lidTexture(), normalMap: T.wood.normalMap, roughness: 0.8 }),
      wood: M.wood, dark: M.darkWood, straw: M.straw, stone: M.stone, glow: M.glow, plaster: M.plaster,
    };
    // ---- a crate: boarded sides inside a frame of battens with a brace across each face
    const crate = [white(rbox(0.66, 0.66, 0.66, 0.01, 1))];
    for (let f = 0; f < 6; f++) {
      const face = [];
      for (const s of [-1, 1]) {
        face.push(put(turnUV(rbox(0.7, 0.085, 0.03, 0.008, 1), 1, 0.25), 0, s * 0.3075, 0.335));
        face.push(put(scaleUV(rbox(0.085, 0.53, 0.03, 0.008, 1), 0.25, 1), s * 0.3075, 0, 0.335));
      }
      face.push(put(turnUV(rbox(0.74, 0.075, 0.026, 0.008, 1), 1, 0.25), 0, 0, 0.332, 0, 0, f % 2 ? 0.785 : -0.785));
      for (const g of face) { if (f < 4) g.rotateY(f * Math.PI / 2); else g.rotateX(f === 4 ? Math.PI / 2 : -Math.PI / 2); crate.push(dark(g)); }
    }
    // ---- a sake cask in its straw coat, lashed with rope
    const caskProfile = [[0.2, -0.4], [0.262, -0.395], [0.288, -0.2], [0.3, 0.05], [0.298, 0.3], [0.285, 0.4], [0.2, 0.4]];
    const cask = [white(new THREE.LatheGeometry(caskProfile.map(([r, y]) => new THREE.Vector2(r, y)), 24))];
    for (const [ry, rr] of [[-0.27, 0.288], [-0.22, 0.292], [0.02, 0.303], [0.07, 0.303], [0.28, 0.3], [0.33, 0.296]]) cask.push(tint(put(new THREE.TorusGeometry(rr, 0.017, 6, 28), 0, ry, 0, Math.PI / 2), 0.5, 0.4, 0.27));
    for (let k = 0; k < 6; k++) {      // the cords running up between the hoops
      const a = k * Math.PI / 3;
      cask.push(tint(put(new THREE.CylinderGeometry(0.012, 0.012, 0.56, 5), Math.sin(a) * 0.305, 0.03, Math.cos(a) * 0.305, 0, 0, 0), 0.5, 0.4, 0.27));
    }
    // ---- a stone lantern (ishidōrō): six-sided, a fire box on a pillar under a heavy roof
    const lv = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    const lPost = lv([[0.13, -0.45], [0.145, -0.4], [0.115, -0.2], [0.105, 0.1], [0.115, 0.36], [0.15, 0.45]], 14);
    const lPlat = faceted(lv([[0.15, -0.07], [0.3, 0.0], [0.33, 0.04], [0.33, 0.07], [0.0, 0.07]], 6));
    const lFrame = mergeGeos([
      ...[0, 1, 2, 3, 4, 5].map((k) => put(rbox(0.05, 0.3, 0.05, 0.008, 1), Math.sin(k * Math.PI / 3 + Math.PI / 6) * 0.165, 0, Math.cos(k * Math.PI / 3 + Math.PI / 6) * 0.165, 0, k * Math.PI / 3 + Math.PI / 6, 0)),
      // two of the six sides are closed, carved with a moon and a sun window in the real thing
      ...[1, 4].map((k) => put(rbox(0.17, 0.3, 0.03, 0.006, 1), Math.sin(k * Math.PI / 3) * 0.145, 0, Math.cos(k * Math.PI / 3) * 0.145, 0, k * Math.PI / 3, 0)),
    ]);
    const lRoof = mergeGeos([
      faceted(lv([[0.2, -0.15], [0.5, -0.13], [0.52, -0.08], [0.36, -0.02], [0.2, 0.06], [0.09, 0.15], [0.0, 0.15]], 6)),
      lv([[0.09, 0.14], [0.05, 0.15], [0.07, 0.19], [0.085, 0.25], [0.05, 0.31], [0.0, 0.33]], 10),      // the jewel on top
    ]);
    this.geo = {
      crate: mergeGeos(crate, true),
      panel: white(rbox(0.68, 0.68, 0.04, 0.008, 1)),
      barrel: mergeGeos(cask, true),
      stave: white(scaleUV(rbox(0.21, 0.78, 0.03, 0.008, 1), 0.3, 1)),
      lid: new THREE.CylinderGeometry(0.262, 0.262, 0.03, 24),
      pot: new THREE.LatheGeometry([[0.0, 0.004], [0.07, 0], [0.105, 0.02], [0.15, 0.08], [0.168, 0.14], [0.17, 0.2], [0.158, 0.26], [0.13, 0.32], [0.096, 0.35], [0.082, 0.365], [0.088, 0.39], [0.104, 0.4], [0.098, 0.408], [0.08, 0.395], [0.07, 0.37]]
        .map(([r, y]) => new THREE.Vector2(r * 1.9, (y - 0.2) * 1.9)), 28),     // waist-high storage jar
      shard: rbox(0.22, 0.26, 0.03, 0.01, 1),
      paper: new THREE.BoxGeometry(0.38, 0.52, 0.012),
      stick: new THREE.BoxGeometry(0.04, 1.7, 0.05),
      rail: new THREE.BoxGeometry(1.64, 0.04, 0.05),
      lBase: mergeGeos([faceted(lv([[0.38, -0.1], [0.38, -0.02], [0.33, 0.0], [0.3, 0.06], [0.2, 0.1], [0.0, 0.1]], 6))]),
      lPost, lPlat, lRoof,
      lLamp: lFrame,
      // everything above the foot as one piece while the lantern stands
      lUpper: mergeGeos([put(lPost.clone(), 0, 0.65, 0), put(lPlat.clone(), 0, 1.17, 0), put(lFrame.clone(), 0, 1.39, 0), put(lPlat.clone(), 0, 1.6, 0, Math.PI, 0, 0, 0.8), put(lRoof.clone(), 0, 1.7, 0)]),
      lGlow: new THREE.CylinderGeometry(0.135, 0.135, 0.28, 6),
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
      part(G.crate, M.crate);
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.35, 0.35, 0.35)));
      y = 0.35;
    } else if (kind === 'barrel') {
      part(G.barrel, M.cask);
      part(G.lid, M.lid, 0, 0.392, 0);
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
      item.upper = [part(G.lUpper, M.stone), part(G.lGlow, M.glow, 0, 1.39, 0)];
      item.upper[1].castShadow = false;
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
    if (kind === 'screen') mergeStatic(mesh);      // dozens of slats and panes: one draw call per material
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
        P(G.panel, M.crate, 0, 0, s * 0.33, 0, 0, 0, 2.5, 0.34, 0.34, 0.02);
        P(G.panel, M.crate, s * 0.33, 0, 0, 0, Math.PI / 2, 0, 2.5, 0.34, 0.34, 0.02);
        P(G.panel, M.crate, 0, s * 0.33, 0, Math.PI / 2, 0, 0, 2.5, 0.34, 0.34, 0.02);
      }
    } else if (item.kind === 'barrel') {
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        P(G.stave, M.cask, Math.sin(a) * 0.27, 0, Math.cos(a) * 0.27, 0, a, 0, 1.6, 0.105, 0.39, 0.015);
      }
      P(G.lid, M.lid, 0, 0.38, 0, 0, 0, 0, 1.5, 0.19, 0.015, 0.19);
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
        // a flame behind paper: slow swells with a quicker tremble on top, never a jump
        const f = 0.9 + Math.sin(t * 2.3 + it.phase) * 0.055 + Math.sin(t * 5.7 + it.phase * 2) * 0.035 + Math.sin(t * 13.1 + it.phase * 3) * 0.014;
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
