// The courtyard: a walled dōjō yard at dusk. Raked gravel, plaster walls with tiled copings, stone
// lanterns, cherry trees shedding petals, a torii and a pagoda beyond the wall, straw mats to cut.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { materials, setGroup, rand, snapPrev, syncMesh } from './physics.js';
import { buildWeaponModel, WEAPONS, WEAPON_ORDER } from './weapons.js';
import { Breakables } from './breakables.js';

export const ARENA_R = 13.2;       // walkable radius
const WALL_R = 14.8;
export const SUN_DIR = new THREE.Vector3(-0.38, 0.17, -1).normalize();

// ------------------------------------------------------------------ procedural textures
function heightToNormal(height, S, strength) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const h = (x, y) => height[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * S + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Fine gravel with faint rake lines. */
function makeGravel(S = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#9a8e7c';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < S * 90; i++) {
    const l = rand(38, 66);
    g.fillStyle = `hsl(${rand(26, 40)}, ${rand(8, 18)}%, ${l}%)`;
    g.fillRect(Math.random() * S, Math.random() * S, rand(1, 3.2), rand(1, 3.2));
  }
  g.strokeStyle = 'rgba(40,30,20,0.10)';
  g.lineWidth = 3;
  for (let y = 8; y < S; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  const img = g.getImageData(0, 0, S, S);
  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) height[i] = (img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2]) / 765;
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(heightToNormal(height, S, 5));
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(14, 14); }
  return { map, normalMap };
}

function makeWood(S = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#4a311c';
  g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x++) {
    const v = Math.sin(x * 0.25 + Math.sin(x * 0.03) * 4) * 0.5 + 0.5;
    g.fillStyle = `rgba(${20 + v * 30},${12 + v * 18},${6 + v * 8},0.55)`;
    g.fillRect(x, 0, 1, S);
  }
  for (let i = 0; i < 400; i++) {
    g.fillStyle = 'rgba(15,8,3,0.25)';
    g.fillRect(Math.random() * S, Math.random() * S, 1, rand(10, 60));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Rolled tatami: woven straw with binding cords. */
function makeStraw() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b9a56c';
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 2) {
    g.fillStyle = `rgba(${rand(60, 110)},${rand(50, 90)},20,${rand(0.1, 0.3)})`;
    g.fillRect(0, y, 64, 1);
  }
  g.fillStyle = '#5a4a2a';
  for (const y of [30, 100, 170, 236]) g.fillRect(0, y, 64, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tall nobori banner with a simple crest (mon). */
function makeBannerTexture(color, crest) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 96, 384);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < 384; y += 24) g.fillRect(0, y, 96, 2);
  g.fillStyle = crest;
  g.strokeStyle = crest;
  g.lineWidth = 7;
  g.beginPath(); g.arc(48, 92, 30, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
    g.beginPath(); g.arc(48 + Math.cos(a) * 13, 92 + Math.sin(a) * 13, 8, 0, Math.PI * 2); g.fill();
  }
  g.fillRect(20, 190, 56, 9);
  g.fillRect(20, 214, 56, 9);
  g.fillRect(20, 238, 56, 9);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SKY = {
  uniforms: { sunDir: { value: SUN_DIR }, dim: { value: 1 }, sat: { value: 1 }, stars: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 sunDir; uniform float dim, sat, stars; varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 c = mix(vec3(1.0, 0.52, 0.22), vec3(0.62, 0.27, 0.34), smoothstep(0.0, 0.2, h));
      c = mix(c, vec3(0.16, 0.13, 0.34), smoothstep(0.12, 0.5, h));
      c = mix(c, vec3(0.03, 0.04, 0.12), smoothstep(0.4, 1.0, h));
      float s = max(dot(d, sunDir), 0.0);
      c += vec3(1.0, 0.45, 0.15) * pow(s, 10.0) * 0.55;
      c += vec3(1.0, 0.75, 0.45) * pow(s, 90.0) * 1.2;
      c += vec3(2.4, 1.5, 0.8) * smoothstep(0.9988, 0.9992, s);
      // thin cloud bands near the horizon
      float band = sin(h * 70.0 + sin(d.x * 5.0 + d.z * 3.0) * 2.2) * 0.5 + 0.5;
      c = mix(c, c * vec3(0.55, 0.42, 0.55), smoothstep(0.7, 1.0, band) * smoothstep(0.3, 0.04, h) * smoothstep(0.0, 0.03, h) * 0.6);
      c = mix(c, vec3(0.05, 0.045, 0.07), smoothstep(0.0, -0.08, h));
      c = mix(vec3(dot(c, vec3(0.3, 0.5, 0.2))), c, sat) * dim;
      if (stars > 0.0) {
        vec3 g = floor(d * 140.0);
        float n = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        c += vec3(0.8, 0.85, 1.0) * step(0.9965, n) * stars * smoothstep(0.02, 0.3, h);
        float m = max(dot(d, normalize(vec3(0.45, 0.5, 0.74))), 0.0);
        c += vec3(0.9, 0.93, 1.0) * (smoothstep(0.9982, 0.9987, m) + pow(m, 60.0) * 0.25) * stars;
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// ------------------------------------------------------------------ arena
export class Arena {
  constructor(game) {
    this.game = game;
    const { scene, world } = game;
    this.props = [];
    this.debris = [];
    this.mats = [];
    this.lanterns = [];
    this.banners = [];
    this.obstacles = [];     // [x, z, radius] the camera should stay out of
    this.time = 0;

    scene.background = new THREE.Color(0x1a1420);
    scene.fog = new THREE.FogExp2(0x6a4250, 0.012);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(230, 32, 16), new THREE.ShaderMaterial({ ...SKY, side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10;
    scene.add(sky);
    this.sky = sky;

    // ---- lights: low sun, cool sky fill
    this.hemi = new THREE.HemisphereLight(0x8c7fb0, 0x4a3628, 1.0);
    scene.add(this.hemi);
    
    const sun = new THREE.DirectionalLight(0xffa56a, 2.1);
    sun.position.copy(SUN_DIR).multiplyScalar(45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -19; sc.right = 19; sc.top = 19; sc.bottom = -19; sc.near = 1; sc.far = 110;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    this.sunLight = sun;

    // ---- materials
    const gravel = makeGravel();
    const wood = makeWood();
    const M = this.M = {
      floor: new THREE.MeshStandardMaterial({ map: gravel.map, normalMap: gravel.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.96 }),
      grass: new THREE.MeshStandardMaterial({ color: 0x33452a, roughness: 1 }),
      plaster: new THREE.MeshStandardMaterial({ color: 0xc9c2b4, roughness: 0.95 }),
      stone: new THREE.MeshStandardMaterial({ color: 0x6a665f, roughness: 0.95 }),
      tile: new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.55, metalness: 0.25 }),
      wood: new THREE.MeshStandardMaterial({ map: wood, color: 0x8a6a50, roughness: 0.85 }),
      darkWood: new THREE.MeshStandardMaterial({ map: wood, color: 0x4a3626, roughness: 0.9 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2c2c2e, metalness: 0.8, roughness: 0.5 }),
      vermilion: new THREE.MeshStandardMaterial({ color: 0xb3261c, roughness: 0.6 }),
      bark: new THREE.MeshStandardMaterial({ color: 0x2c1f1a, roughness: 1 }),
      blossom: new THREE.MeshStandardMaterial({ color: 0xf3a9c4, roughness: 0.9, flatShading: true, emissive: 0x4a1a2a, emissiveIntensity: 0.5 }),
      straw: new THREE.MeshStandardMaterial({ map: makeStraw(), roughness: 0.95 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffc27a, toneMapped: false }),
      bamboo: new THREE.MeshStandardMaterial({ color: 0x5a7a34, roughness: 0.7 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x5f8a3a, roughness: 0.9, flatShading: true, emissive: 0x1a2a10, emissiveIntensity: 0.6 }),
      far: new THREE.MeshBasicMaterial({ color: 0x2c2440 }),
    };
    const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
    this.sh = sh;

    // ---- ground
    const ground = new THREE.Mesh(new THREE.CircleGeometry(WALL_R + 0.3, 64).rotateX(-Math.PI / 2), M.floor);
    ground.receiveShadow = true;
    scene.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500).rotateX(-Math.PI / 2), M.grass);
    outer.position.y = -0.03;
    outer.receiveShadow = true;
    scene.add(outer);
    const gb = new CANNON.Body({ mass: 0, material: materials.ground });
    gb.addShape(new CANNON.Plane());
    gb.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    gb.hs = { type: 'static', kind: 'stone' };
    setGroup(gb, 'STATIC');
    world.addBody(gb);
    // stepping stones from the rack to the middle
    for (let i = 0; i < 12; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(rand(0.42, 0.6), rand(0.45, 0.62), 0.03, 9), M.stone);
      st.position.set(Math.sin(i * 1.7) * 0.28, 0.012, -10.6 + i * 1.25);
      st.rotation.y = rand(0, 3);
      st.receiveShadow = true;
      scene.add(st);
    }

    const staticBox = this.staticBox = (w, h, d, x, y, z, rotY, kind) => {
      const b = new CANNON.Body({ mass: 0, material: kind === 'wood' ? materials.wood : materials.ground });
      b.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
      b.position.set(x, y, z);
      b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotY);
      b.hs = { type: 'static', kind };
      setGroup(b, 'STATIC');
      world.addBody(b);
      return b;
    };

    this.buildWall(scene, staticBox);
    this.buildScenery(scene);
    this.buildTrees(scene, staticBox);
    this.buildBanners(scene);
    this.buildRack(scene, staticBox);
    this.buildPetals(scene);
    this.buildFireflies(scene);
    this.buildMats(scene);
    this.breakables = new Breakables(game, this);
  }

  // ---------------------------------------------------------------- wall
  buildWall(scene, staticBox) {
    const M = this.M;
    const SEG = 36;
    const segLen = 2 * Math.PI * WALL_R / SEG + 0.06;
    const layers = [
      [new THREE.BoxGeometry(segLen, 0.5, 0.62), M.stone, 0.25],
      [new THREE.BoxGeometry(segLen, 2.1, 0.46), M.plaster, 1.55],
      [new THREE.BoxGeometry(segLen + 0.12, 0.1, 1.2), M.tile, 2.66],
      [new THREE.BoxGeometry(segLen + 0.12, 0.12, 0.78), M.tile, 2.76],
      [new THREE.BoxGeometry(segLen + 0.12, 0.16, 0.26), M.tile, 2.9],
      [new THREE.BoxGeometry(0.2, 2.1, 0.52), M.darkWood, 1.55],
    ];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    layers.forEach(([geo, mat, y], li) => {
      const im = new THREE.InstancedMesh(geo, mat, SEG);
      for (let i = 0; i < SEG; i++) {
        // the last layer (posts) sits on the joints between segments
        const a = ((i + (li === layers.length - 1 ? 0.5 : 0)) / SEG) * Math.PI * 2;
        m4.compose(p.set(Math.sin(a) * WALL_R, y, Math.cos(a) * WALL_R), q.setFromAxisAngle(Y, a), s);
        im.setMatrixAt(i, m4);
      }
      im.castShadow = true; im.receiveShadow = true;
      scene.add(im);
    });
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      staticBox(segLen, 5, 0.9, Math.sin(a) * WALL_R, 2.5, Math.cos(a) * WALL_R, a, 'stone');
    }
  }

  // ---------------------------------------------------------------- beyond the wall
  buildScenery(scene) {
    const M = this.M, sh = this.sh;
    // torii on the axis the player first looks along
    const torii = new THREE.Group();
    for (const s of [-1, 1]) {
      const pillar = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 7, 14), M.vermilion));
      pillar.position.set(s * 3.3, 3.5, 0);
      pillar.rotation.z = -s * 0.04;
      torii.add(pillar);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.48, 0.5, 14), M.tile);
      foot.position.set(s * 3.42, 0.25, 0);
      torii.add(foot);
    }
    const beam = (w, h, d, y, mat) => { const b = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)); b.position.y = y; torii.add(b); return b; };
    beam(7.4, 0.42, 0.34, 5.35, M.vermilion);
    beam(8.6, 0.42, 0.5, 6.75, M.vermilion);
    beam(9.4, 0.3, 0.72, 7.1, M.tile);
    beam(0.5, 1.0, 0.2, 6.05, M.vermilion);
    for (const s of [-1, 1]) {       // upswept ends
      const tip = sh(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 0.72), M.tile));
      tip.position.set(s * 5.1, 7.24, 0);
      tip.rotation.z = s * 0.28;
      torii.add(tip);
    }
    torii.position.set(0, 0, -20.5);
    scene.add(torii);

    // pagoda
    const pag = new THREE.Group();
    let y = 0;
    for (let i = 0; i < 5; i++) {
      const w = 6.4 - i * 0.9;
      const body = sh(new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, w), i === 0 ? M.darkWood : M.plaster));
      body.position.y = y + 1.2;
      pag.add(body);
      const roof = sh(new THREE.Mesh(new THREE.ConeGeometry(w * 1.06, 1.5, 4), M.tile));
      roof.position.y = y + 3.0;
      roof.rotation.y = Math.PI / 4;
      pag.add(roof);
      y += 3.3;
    }
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 4.5, 6), M.iron);
    spire.position.y = y + 1.9;
    pag.add(spire);
    pag.position.set(-27, 0, -36);
    scene.add(pag);

    // far mountains
    const mk = (x, z, r, h) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), M.far);
      m.position.set(x, h / 2 - 2, z);
      m.rotation.y = rand(0, 3);
      scene.add(m);
    };
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand(-0.12, 0.12), d = rand(120, 165);
      mk(Math.sin(a) * d, Math.cos(a) * d, rand(35, 70), rand(22, 50));
    }
    mk(60, -175, 85, 78);

    // bamboo grove hugging the outside of the wall
    const N = 110;
    const stalk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.075, 1, 6), M.bamboo, N);
    const tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), M.leaf, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      let a = rand(0, Math.PI * 2);
      if (Math.abs(Math.sin(a)) < 0.35 && Math.cos(a) < 0) a += 0.8;      // keep the view to the torii open
      const r = rand(16.5, 24), h = rand(6, 10.5);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      q.setFromEuler(e.set(rand(-0.06, 0.06), rand(0, 3), rand(-0.06, 0.06)));
      m4.compose(p.set(x, h / 2, z), q, s.set(1, h, 1));
      stalk.setMatrixAt(i, m4);
      m4.compose(p.set(x, h - 0.6, z), q, s.set(rand(0.7, 1.2), rand(2.4, 3.6), rand(0.7, 1.2)));
      tuft.setMatrixAt(i, m4);
    }
    stalk.castShadow = true;
    scene.add(stalk, tuft);
  }

  // ---------------------------------------------------------------- cherry trees
  buildTrees(scene, staticBox) {
    const M = this.M, sh = this.sh;
    const blob = new THREE.IcosahedronGeometry(1, 1);
    const tree = (x, z, scale, collide) => {
      const g = new THREE.Group();
      const trunk = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.3 * scale, 3 * scale, 8), M.bark));
      trunk.position.y = 1.5 * scale;
      trunk.rotation.z = rand(-0.12, 0.12);
      g.add(trunk);
      for (let i = 0; i < 4; i++) {
        const a = rand(0, 6.28), len = rand(1.4, 2.2) * scale;
        const br = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.04 * scale, 0.1 * scale, len, 6), M.bark));
        br.position.set(Math.sin(a) * len * 0.3, 2.7 * scale + rand(0, 0.5), Math.cos(a) * len * 0.3);
        br.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
        g.add(br);
      }
      for (let i = 0; i < 9; i++) {
        const b = sh(new THREE.Mesh(blob, M.blossom));
        const a = rand(0, 6.28), r = rand(0, 1.9) * scale;
        b.position.set(Math.sin(a) * r, (3.4 + rand(0, 1.5)) * scale, Math.cos(a) * r);
        b.scale.set(rand(0.9, 1.5) * scale, rand(0.6, 0.95) * scale, rand(0.9, 1.5) * scale);
        b.rotation.set(rand(0, 3), rand(0, 3), 0);
        g.add(b);
      }
      g.position.set(x, 0, z);
      scene.add(g);
      if (collide) { staticBox(0.5, 3, 0.5, x, 1.5, z, 0, 'wood'); this.obstacles.push([x, z, 0.85]); }
    };
    this.treeSpots = [];
    for (const a of [0.62, 2.2, 3.75, 5.5]) {
      const x = Math.sin(a) * 11.4, z = Math.cos(a) * 11.4;
      tree(x, z, 1, true);
      this.treeSpots.push([x, z]);
    }
    for (const a of [0.1, 1.2, 1.75, 2.75, 4.3, 4.9, 5.9]) tree(Math.sin(a) * rand(18, 21), Math.cos(a) * rand(18, 21), rand(1.25, 1.6), false);
  }

  // ---------------------------------------------------------------- nobori banners
  buildBanners(scene) {
    const M = this.M;
    const looks = [['#8a1418', '#e8e0cc'], ['#e8e0cc', '#16161a'], ['#1c2c4a', '#e8e0cc']];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = WALL_R - 0.75;
      const [bg, crest] = looks[k % 3];
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 4.6, 6), M.darkWood);
      pole.position.set(Math.sin(a) * r, 2.3, Math.cos(a) * r);
      pole.castShadow = true;
      scene.add(pole);
      const pivot = new THREE.Group();
      pivot.position.set(Math.sin(a) * r, 4.5, Math.cos(a) * r);
      pivot.rotation.y = a + Math.PI / 2;
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 2.8), new THREE.MeshStandardMaterial({ map: makeBannerTexture(bg, crest), side: THREE.DoubleSide, roughness: 0.95 }));
      ban.position.set(0.39, -1.45, 0);
      ban.castShadow = true;
      pivot.add(ban);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.78, 5), M.darkWood);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(0.39, -0.04, 0);
      pivot.add(arm);
      scene.add(pivot);
      this.banners.push({ pivot, base: a + Math.PI / 2, phase: rand(0, 10) });
    }
  }

  // ---------------------------------------------------------------- falling petals
  buildPetals(scene) {
    const n = this.petalN = 420;
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.028); shape.quadraticCurveTo(0.03, 0, 0, 0.032); shape.quadraticCurveTo(-0.03, 0, 0, -0.028);
    this.petalMesh = new THREE.InstancedMesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, emissive: 0x3a1420, emissiveIntensity: 0.4 }), n);
    this.petalMesh.frustumCulled = false;
    this.petals = [];
    this.wind = new THREE.Vector3(1.3, 0, 0.6);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.petals.push(this.spawnPetal({}, true));
      c.setHSL(rand(0.92, 0.98), rand(0.55, 0.9), rand(0.74, 0.9));
      this.petalMesh.setColorAt(i, c);
    }
    scene.add(this.petalMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1); this._p = new THREE.Vector3();
  }

  spawnPetal(l, anywhere) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 13;
    l.x = Math.sin(a) * r; l.z = Math.cos(a) * r;
    if (!anywhere) { l.x -= this.wind.x * 4; l.z -= this.wind.z * 4; }
    l.y = anywhere ? rand(0, 6) : rand(4.5, 7);
    l.vy = -rand(0.3, 0.7);
    l.rx = rand(0, 6); l.ry = rand(0, 6); l.rz = rand(0, 6);
    l.sx = rand(-3, 3); l.sy = rand(-3, 3);
    l.ph = rand(0, 10);
    l.ground = 0;
    l.sc = rand(0.7, 1.3);
    return l;
  }

  updatePetals(dt) {
    const t = this.time;
    const gust = 1 + Math.sin(t * 0.4) * 0.5 + Math.sin(t * 1.3) * 0.25;
    for (let i = 0; i < this.petalN; i++) {
      const l = this.petals[i];
      if (l.y > 0.01) {
        l.x += (this.wind.x * gust + Math.sin(t * 1.7 + l.ph) * 0.6) * dt;
        l.z += (this.wind.z * gust + Math.cos(t * 1.3 + l.ph) * 0.6) * dt;
        l.y += (l.vy + Math.sin(t * 3 + l.ph) * 0.3) * dt;
        l.rx += l.sx * dt; l.ry += l.sy * dt;
      } else {
        l.y = 0.006;
        l.ground += dt;
        l.rx = Math.PI / 2;
        if (gust > 1.5 && Math.random() < dt * 0.5) l.y = 0.3;     // a gust lifts it again
        if (l.ground > 14) this.spawnPetal(l, false);
      }
      if (Math.hypot(l.x, l.z) > 14.3) this.spawnPetal(l, false);
      this._q.setFromEuler(this._e.set(l.rx, l.ry, l.rz));
      this._m.compose(this._p.set(l.x, l.y, l.z), this._q, this._s.setScalar(l.sc));
      this.petalMesh.setMatrixAt(i, this._m);
    }
    this.petalMesh.instanceMatrix.needsUpdate = true;
  }

  /** A swirl of petals kicked up at a point (dashes, bodies hitting the ground). */
  stirPetals(x, z, radius = 1.6) {
    for (const l of this.petals) {
      if (l.y > 0.01) continue;
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < radius && Math.random() < 0.7) { l.y = rand(0.15, 0.7); l.vy = -rand(0.3, 0.6); l.ground = 0; }
    }
  }

  // ---------------------------------------------------------------- fireflies
  buildFireflies(scene) {
    const n = this.flyN = 70;
    this.flyBase = new Float32Array(n * 4);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.28), r = rand(6, 13.5);
      this.flyBase.set([Math.sin(a) * r, rand(0.4, 2.6), Math.cos(a) * r, rand(0, 20)], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.flies = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xe6ff8a, size: 0.07, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    this.flies.frustumCulled = false;
    scene.add(this.flies);
  }

  // ---------------------------------------------------------------- weapon rack (katana-kake)
  buildRack(scene, staticBox) {
    const M = this.M, sh = this.sh;
    const g = new THREE.Group();
    const origin = new THREE.Vector3(0, 0, -12.1);
    g.position.copy(origin);
    const part = (w, h, d, x, y, z, mat = M.wood) => {
      const m = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    part(2.9, 0.12, 0.62, 0, 0.06, 0, M.darkWood);
    for (const s of [-1, 1]) {
      part(0.12, 1.75, 0.12, s * 1.4, 0.95, 0.18);
      part(0.12, 1.2, 0.12, s * 1.4, 0.6, -0.18);
    }
    part(2.9, 0.09, 0.12, 0, 1.6, 0.18);
    part(2.9, 0.09, 0.12, 0, 1.1, -0.18);
    part(2.9, 0.07, 0.4, 0, 0.32, 0);
    part(3.3, 0.1, 0.5, 0, 1.86, 0.18, M.tile);
    scene.add(g);
    staticBox(3.0, 1.7, 0.7, origin.x, 0.85, origin.z, 0, 'wood');

    this.rack = { origin, slots: [] };
    WEAPON_ORDER.forEach((key, i) => {
      const def = WEAPONS[key];
      const x = -1.1 + i * 0.44;
      const model = buildWeaponModel(def);
      const baseY = def.type === 'polearm' ? def.shaftBack + 0.18 : def.gripLen + 0.2;
      model.position.set(x, baseY, 0.04);
      model.rotation.x = -0.1;
      g.add(model);
      this.rack.slots.push({ key, mesh: model, world: origin.clone().add(new THREE.Vector3(x, 0, 0.7)) });
    });
  }

  /** Hide the rack copy of the weapon the player is currently holding. */
  showRack(currentKey) {
    for (const s of this.rack.slots) s.mesh.visible = s.key !== currentKey;
  }

  // ---------------------------------------------------------------- tameshigiri: straw mats to cut
  buildMats(scene) {
    const M = this.M, sh = this.sh;
    this.matGeo = new THREE.CylinderGeometry(0.095, 0.095, 1, 14);
    for (const [x, z] of [[-8.3, -6.1], [-6.7, -8.0], [-9.4, -3.9], [8.4, -6.0]]) {
      const stand = new THREE.Group();
      for (const r of [0, Math.PI / 2]) {
        const foot = sh(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.1), M.darkWood));
        foot.position.y = 0.035; foot.rotation.y = r;
        stand.add(foot);
      }
      const peg = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 8), M.darkWood));
      peg.position.y = 0.25;
      stand.add(peg);
      stand.position.set(x, 0, z);
      scene.add(stand);
      const mesh = sh(new THREE.Mesh(this.matGeo, M.straw));
      scene.add(mesh);
      const mat = { x, z, base: 0.4, top: 1.55, full: 1.55, mesh, body: null };
      this.mats.push(mat);
      this.fitMat(mat);
    }
    // green bamboo: cut it wherever you like, as often as you like
    for (const [x, z] of [[7.2, 7.4], [7.7, 7.9], [8.2, 7.3], [-4.6, -10.9], [-3.9, -11.3], [-5.3, -11.1]]) {
      const mesh = sh(new THREE.Mesh(this.matGeo, M.bamboo));
      scene.add(mesh);
      const top = rand(2.2, 2.9);
      const mat = { x, z, base: 0, top, full: top, mesh, body: null, k: 0.5, material: M.bamboo };
      this.mats.push(mat);
      this.fitMat(mat);
    }
  }

  fitMat(mat) {
    const world = this.game.world;
    if (mat.body) world.removeBody(mat.body);
    const h = mat.top - mat.base;
    mat.mesh.visible = h > 0.05;
    const k = mat.k || 1;
    mat.mesh.scale.set(k, Math.max(0.01, h), k);
    mat.mesh.position.set(mat.x, (mat.top + mat.base) / 2, mat.z);
    const b = new CANNON.Body({ mass: 0, material: materials.wood });
    b.addShape(new CANNON.Cylinder(0.1 * k, 0.1 * k, Math.max(0.1, mat.top), 8));
    b.position.set(mat.x, Math.max(0.1, mat.top) / 2, mat.z);
    b.hs = { type: 'static', kind: 'wood', mat };
    setGroup(b, 'STATIC');
    world.addBody(b);
    mat.body = b;
  }

  /** A clean cut takes the top off the mat. Returns true if it cut. */
  cutMat(mat, point, dir, speed) {
    const y = point.y;
    if (y < mat.base + 0.12 || y > mat.top - 0.06) return false;
    const h = mat.top - y;
    const k = mat.k || 1;
    const mesh = this.sh(new THREE.Mesh(this.matGeo, mat.material || this.M.straw));
    mesh.scale.set(k, h, k);
    this.game.scene.add(mesh);
    const body = new CANNON.Body({ mass: 1.2 + h * 3, material: materials.wood, linearDamping: 0.1, angularDamping: 0.2 });
    body.addShape(new CANNON.Cylinder(0.095 * k, 0.095 * k, h, 8));
    body.position.set(mat.x, y + h / 2 + 0.02, mat.z);
    body.velocity.set(dir.x * 1.6, 1.2, dir.z * 1.6);
    body.angularVelocity.set(dir.z * 4 + rand(-1, 1), rand(-2, 2), -dir.x * 4 + rand(-1, 1));
    body.hs = { type: 'prop', kind: 'wood' };
    setGroup(body, 'PROP');
    snapPrev(body);
    this.game.world.addBody(body);
    this.addDebris(mesh, body);
    mat.top = y;
    this.fitMat(mat);
    return true;
  }

  /** Loose wreckage; the oldest pieces are swept away once the yard gets too cluttered. */
  addDebris(mesh, body) {
    this.debris.push({ mesh, body });
    while (this.debris.length > 90) {
      const d = this.debris.shift();
      this.game.world.removeBody(d.body);
      this.game.scene.remove(d.mesh);
    }
  }

  resetProps() {
    this.breakables.reset();
    for (const d of this.debris) { this.game.world.removeBody(d.body); this.game.scene.remove(d.mesh); }
    this.debris = [];
    for (const m of this.mats) { m.top = m.full; this.fitMat(m); }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.breakables.update();
    for (const b of this.banners) {
      b.pivot.rotation.y = b.base + Math.sin(t * 0.9 + b.phase) * 0.22 + Math.sin(t * 2.3 + b.phase) * 0.06;
      b.pivot.rotation.x = Math.sin(t * 1.4 + b.phase) * 0.03;
    }
    const fp = this.flies.geometry.attributes.position;
    for (let i = 0; i < this.flyN; i++) {
      const j = i * 4, ph = this.flyBase[j + 3];
      fp.setXYZ(i,
        this.flyBase[j] + Math.sin(t * 0.5 + ph) * 0.9,
        this.flyBase[j + 1] + Math.sin(t * 0.9 + ph * 2) * 0.35,
        this.flyBase[j + 2] + Math.cos(t * 0.4 + ph) * 0.9);
    }
    fp.needsUpdate = true;
    this.flies.material.opacity = 0.65 + Math.sin(t * 3) * 0.25;
    for (const d of this.debris) syncMesh(d.mesh, d.body);
    this.updatePetals(dt);
  }
}
