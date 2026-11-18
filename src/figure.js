// Procedural samurai figures. One group per body part (origin at the proximal joint), built from
// many small pieces — faces, woven cloth, rows of laced lamellae, tiered helmets — and then baked
// into one mesh per material so a detailed fighter still costs only a few dozen draw calls.
import * as THREE from 'three';

export const SHOULDER = { x: 0.21, y: 0.44 };      // relative to torso origin (waist)
export const PART_NAMES = ['pelvis', 'torso', 'head', 'uArmR', 'uArmL', 'fArmR', 'fArmL', 'thighR', 'thighL', 'shinR', 'shinL'];
const SKIN_TONES = [0xd8a680, 0xcb9a74, 0xe0b18c, 0xbd8d68, 0xd2a07a];

// ------------------------------------------------------------------ textures (cached by colour)
const texCache = new Map();
const css = (hex) => '#' + hex.toString(16).padStart(6, '0');
function shade(hex, f) {
  const r = Math.min(255, ((hex >> 16) & 255) * f), g = Math.min(255, ((hex >> 8) & 255) * f), b = Math.min(255, (hex & 255) * f);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);

/** Rows of small lacquered plates, each row overlapping the next, tied with coloured lacing. */
const lamellarTex = (base, lace) => canvasTex(`lam${base}_${lace}`, 128, 128, (g, w, h) => {
  const rows = 4, rh = h / rows, pw = 16;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    const gr = g.createLinearGradient(0, y, 0, y + rh);
    gr.addColorStop(0, shade(base, 1.5)); gr.addColorStop(0.25, shade(base, 1.1)); gr.addColorStop(0.85, shade(base, 0.8)); gr.addColorStop(1, shade(base, 0.25));
    g.fillStyle = gr;
    g.fillRect(0, y, w, rh);
    for (let x = 0; x < w; x += pw) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, y, 1.5, rh);
      g.fillStyle = css(lace);
      g.fillRect(x + 4, y + 3, 2.5, 9);
      g.fillRect(x + 10, y + 3, 2.5, 9);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x + 4, y + 12, 2.5, 1.5);
      g.fillRect(x + 10, y + 12, 2.5, 1.5);
    }
    g.fillStyle = css(lace);
    g.fillRect(0, y + 15, w, 2);
  }
});

/** Woven cloth. kind: plain | pleat (hakama folds) | kasuri (small woven crosses) | stripe. */
const clothTex = (color, kind = 'plain') => canvasTex(`cl${color}_${kind}`, 128, 128, (g, w, h) => {
  g.fillStyle = css(color);
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
    if (Math.random() < 0.5) g.fillRect(rnd(0, w), rnd(0, h), rnd(4, 14), 1); else g.fillRect(rnd(0, w), rnd(0, h), 1, rnd(4, 14));
  }
  if (kind === 'pleat') {
    for (let x = 0; x < w; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(0.2, 'rgba(0,0,0,0.05)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 16, h);
    }
  } else if (kind === 'kasuri') {
    g.fillStyle = 'rgba(255,255,255,0.22)';
    for (let y = 8; y < h; y += 16) for (let x = (y / 16 % 2) * 8 + 4; x < w; x += 16) { g.fillRect(x - 2, y, 5, 1); g.fillRect(x, y - 2, 1, 5); }
  } else if (kind === 'stripe') {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 2, h);
  }
});

/** Iron splints sewn onto cloth (kote, suneate) / ridged helmet bowl. */
const splintTex = (base, cloth) => canvasTex(`sp${base}_${cloth}`, 64, 64, (g, w, h) => {
  g.fillStyle = shade(cloth, 0.8);
  g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) {
    const gr = g.createLinearGradient(x, 0, x + 12, 0);
    gr.addColorStop(0, shade(base, 0.6)); gr.addColorStop(0.4, shade(base, 1.6)); gr.addColorStop(1, shade(base, 0.7));
    g.fillStyle = gr;
    g.fillRect(x + 1, 0, 11, h);
  }
});

const strawTex = () => canvasTex('straw', 128, 64, (g, w, h) => {
  g.fillStyle = '#b79a5c';
  g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(${rnd(40, 90)},${rnd(30, 60)},10,${rnd(0.1, 0.45)})`; g.fillRect(x, 0, 1, h); }
  g.fillStyle = 'rgba(60,40,10,0.35)';
  for (let y = 6; y < h; y += 12) g.fillRect(0, y, w, 1.5);
});

/**
 * A face painted onto the head sphere: the front of the head is at u = 0.75.
 * Coordinates are in millimetres from the point between the eyes (x right, y down).
 */
const faceTex = (skin, o = {}) => canvasTex(`face${skin}_${o.beard || 0}_${o.stern ? 1 : 0}_${o.scar ? 1 : 0}`, 512, 512, (g, W, H) => {
  const X = (mm) => 0.75 * W + mm / 2.4 * (W / 256), Y = (mm) => 0.44 * H + mm / 1.42 * (H / 256);
  const sx = (W / 256) / 2.4, sy = (H / 256) / 1.42;
  g.fillStyle = css(skin);
  g.fillRect(0, 0, W, H);
  const soft = (x, y, rx, ry, col) => {
    g.save(); g.translate(X(x), Y(y)); g.scale(rx * sx, ry * sy);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); g.restore();
  };
  // modelling: eye sockets, cheeks, under the lip, temples
  for (const s of [-1, 1]) {
    soft(s * 31, 2, 22, 13, 'rgba(60,25,15,0.34)');
    soft(s * 38, 34, 26, 22, 'rgba(190,80,60,0.13)');
    soft(s * 62, 20, 22, 60, 'rgba(50,25,15,0.2)');
  }
  soft(0, 62, 22, 8, 'rgba(60,25,15,0.3)');
  soft(0, -34, 60, 22, 'rgba(255,235,210,0.1)');
  for (const s of [-1, 1]) {
    // eye: white, iris, upper lid, lower shadow
    g.save(); g.translate(X(s * 31), Y(0)); g.scale(sx, sy);
    g.fillStyle = '#efe7da';
    g.beginPath(); g.moveTo(-13, 1); g.quadraticCurveTo(0, -7.5, 13, 0); g.quadraticCurveTo(0, 5.5, -13, 1); g.fill();
    g.fillStyle = '#2a170e';
    g.beginPath(); g.ellipse(0, -0.6, 5.6, 4.6, 0, 0, 7); g.fill();
    g.fillStyle = '#060303';
    g.beginPath(); g.ellipse(0, -0.6, 2.6, 2.4, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath(); g.ellipse(-1.8 * s, -2, 1.1, 0.9, 0, 0, 7); g.fill();
    g.strokeStyle = '#150b07'; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-14, 1.5); g.quadraticCurveTo(0, -8.5, 14, 0); g.stroke();
    g.strokeStyle = 'rgba(70,30,20,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-11, 3); g.quadraticCurveTo(0, 6.5, 12, 1.5); g.stroke();
    // brow
    g.strokeStyle = '#120a08'; g.lineWidth = 4.2;
    g.beginPath();
    if (o.stern) { g.moveTo(-15 * s, -9); g.quadraticCurveTo(0, -15, 17 * s, -15.5); }
    else { g.moveTo(-15 * s, -11.5); g.quadraticCurveTo(0, -16, 17 * s, -12.5); }
    g.stroke();
    g.restore();
  }
  // nose: side shadows and nostrils (the bridge itself is geometry)
  g.save(); g.translate(X(0), Y(0)); g.scale(sx, sy);
  g.strokeStyle = 'rgba(70,30,18,0.35)'; g.lineWidth = 3;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 7, 6); g.quadraticCurveTo(s * 9, 30, s * 15, 40); g.stroke(); }
  g.fillStyle = 'rgba(40,15,10,0.75)';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 7, 44, 4.2, 2.4, 0, 0, 7); g.fill(); }
  // mouth
  g.fillStyle = 'rgba(150,62,52,0.8)';
  g.beginPath(); g.moveTo(-21, 62); g.quadraticCurveTo(-7, 56.5, 0, 59); g.quadraticCurveTo(7, 56.5, 21, 62); g.quadraticCurveTo(0, 71, -21, 62); g.fill();
  g.strokeStyle = '#3a1410'; g.lineWidth = 1.8;
  g.beginPath(); g.moveTo(-22, 62); g.quadraticCurveTo(0, 64.5, 22, 62); g.stroke();
  g.strokeStyle = 'rgba(70,30,18,0.3)'; g.lineWidth = 2;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 19, 40); g.quadraticCurveTo(s * 30, 52, s * 28, 66); g.stroke(); }
  if (o.scar) {
    g.strokeStyle = 'rgba(120,40,35,0.8)'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(22, -24); g.lineTo(44, 38); g.stroke();
  }
  if (o.beard) {
    g.fillStyle = 'rgba(15,10,8,0.5)';
    const n = o.beard > 1 ? 2600 : 1100;
    for (let i = 0; i < n; i++) {
      const x = rnd(-62, 62), y = rnd(46, 118);
      if (Math.abs(x) < 20 && y < 56) continue;
      if (Math.abs(x) < 24 && y > 57 && y < 70) continue;
      g.fillRect(x, y, 1.6, rnd(1.5, o.beard > 1 ? 6 : 3));
    }
    g.strokeStyle = 'rgba(15,10,8,0.8)'; g.lineWidth = 3.4;
    g.beginPath(); g.moveTo(-23, 55); g.quadraticCurveTo(0, 49, 23, 55); g.stroke();
  }
  g.restore();
});

// ------------------------------------------------------------------ materials
export function makeMaterials(style) {
  const armored = style.armor != null;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const skin = style.skin ?? SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
  const lac = armored ? style.armor : style.cloth, lace = style.lace ?? 0xd9b25a;
  const m = {
    armor: std({ map: armored ? lamellarTex(lac, lace) : clothTex(lac), metalness: armored ? 0.35 : 0, roughness: armored ? 0.36 : 0.9, side: THREE.DoubleSide }),
    plate: std({ color: lac, metalness: armored ? 0.5 : 0, roughness: armored ? 0.26 : 0.9, side: THREE.DoubleSide }),
    splint: std({ map: splintTex(armored ? lac : 0x3a3a3e, style.cloth), metalness: 0.4, roughness: 0.42, side: THREE.DoubleSide }),
    lace: std({ color: lace, roughness: 0.8 }),
    cloth: std({ map: clothTex(style.cloth, style.pattern || 'plain'), roughness: 0.93, side: THREE.DoubleSide }),
    hakama: std({ map: clothTex(style.hakama ?? style.cloth, 'pleat'), roughness: 0.95, side: THREE.DoubleSide }),
    trim: std({ color: style.trim ?? 0xc9a14f, metalness: 0.8, roughness: 0.32, side: THREE.DoubleSide }),
    skin: std({ color: skin, roughness: 0.72 }),
    face: std({ map: faceTex(skin, { beard: style.beard || 0, stern: armored || style.stern, scar: style.scar }), roughness: 0.7 }),
    hair: std({ color: style.hair ?? 0x0d0a0a, roughness: 0.55 }),
    straw: std({ map: strawTex(), roughness: 0.95, side: THREE.DoubleSide }),
    white: std({ color: 0xe6e1d6, roughness: 0.9, side: THREE.DoubleSide }),
    dark: std({ color: 0x15120f, metalness: 0.3, roughness: 0.35 }),
    menpo: std({ color: style.menpo ?? 0x3a0c0c, metalness: 0.45, roughness: 0.3, side: THREE.DoubleSide }),
    flag: std({ color: style.sashimono ?? 0xffffff, roughness: 0.9, side: THREE.DoubleSide }),
  };
  m.flash = [m.armor, m.plate, m.cloth, m.hakama, m.skin, m.face];
  return m;
}

// ------------------------------------------------------------------ baking
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
/** Merge every mesh under `src` into one mesh per material (transforms baked into the vertices). */
function bake(src) {
  src.updateMatrixWorld(true);
  const buckets = new Map();
  src.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    let b = buckets.get(o.material);
    if (!b) buckets.set(o.material, b = { p: [], n: [], u: [] });
    _nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      b.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
      b.n.push(_v.x, _v.y, _v.z);
      if (uv) b.u.push(uv.getX(i), uv.getY(i)); else b.u.push(0, 0);
    }
    if (geo !== o.geometry) geo.dispose();
    o.geometry.dispose();
  });
  const out = new THREE.Group();
  for (const [mat, b] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

// ------------------------------------------------------------------ the figure
export function buildParts(style) {
  const m = makeMaterials(style);
  const armored = style.armor != null;
  const P = {};
  const add = (part, mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); part.add(mesh); return mesh; };
  const uvs = (geo, su, sv) => { const a = geo.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * su, a.getY(i) * sv); return geo; };
  const box = (w, h, d, mat, su = 1, sv = 1) => new THREE.Mesh(uvs(new THREE.BoxGeometry(w, h, d), su, sv), mat);
  const cyl = (rt, rb, h, mat, seg = 16, open = false, ts = 0, tl = Math.PI * 2, su = 1, sv = 1) =>
    new THREE.Mesh(uvs(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, ts, tl), su, sv), mat);
  const sph = (r, mat, ws = 16, hs = 12, ps = 0, pl = Math.PI) => new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, ps, pl), mat);
  /** Surface of revolution from [radius, y] pairs (bottom → top). */
  const lathe = (pts, mat, su = 1, sv = 1, seg = 18) =>
    new THREE.Mesh(uvs(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), su, sv), mat);
  /** One lamellar strip (a single laced row). */
  const lame = (w, h, d = 0.018) => box(w, h, d, m.armor, Math.max(1, Math.round(w / 0.035)), 0.25);

  // ---------------- pelvis (origin at hip centre): hakama, obi, kusazuri, swords
  P.pelvis = new THREE.Group();
  add(P.pelvis, cyl(0.165, 0.2, 0.2, m.hakama, 18, false, 0, Math.PI * 2, 6, 1), 0, -0.01, 0).scale.set(1, 1, 0.72);
  add(P.pelvis, cyl(0.2, 0.3, 0.4, m.hakama, 22, true, 0, Math.PI * 2, 8, 1), 0, -0.2, 0).scale.set(1, 1, 0.78);
  add(P.pelvis, cyl(0.185, 0.185, 0.085, m.lace, 18), 0, 0.075, 0).scale.set(1, 1, 0.74);
  add(P.pelvis, box(0.13, 0.075, 0.05, m.lace), 0, 0.08, 0.145);
  add(P.pelvis, box(0.028, 0.11, 0.012, m.white), 0.035, 0.02, -0.142);
  add(P.pelvis, box(0.028, 0.09, 0.012, m.white), -0.02, 0.03, -0.142).rotation.z = 0.25;
  if (armored) {
    for (const a of [0.42, -0.42, 1.2, -1.2, 2.1, -2.1, Math.PI]) {
      const pivot = new THREE.Group();
      pivot.position.y = -0.02;
      pivot.rotation.y = -a;
      const R = 0.2 * (Math.abs(Math.cos(a)) * 0.76 + Math.abs(Math.sin(a))) + 0.018;
      for (let i = 0; i < 4; i++) {
        const l = lame(0.135, 0.064);
        l.position.set(0, -0.055 - i * 0.058, -(R + i * 0.014));
        l.rotation.x = -0.14 - i * 0.03;
        pivot.add(l);
      }
      P.pelvis.add(pivot);
    }
  }
  if (style.saya !== false) {
    add(P.pelvis, cyl(0.016, 0.013, 0.78, m.dark, 8), -0.21, -0.04, 0.17).rotation.set(1.15, 0, 0.12);
    add(P.pelvis, cyl(0.019, 0.019, 0.03, m.trim, 8), -0.172, 0.118, -0.18).rotation.set(1.15, 0, 0.12);
    if (armored) {     // daishō: the short sword stays in the belt
      add(P.pelvis, cyl(0.014, 0.012, 0.46, m.dark, 8), -0.185, 0.02, 0.06).rotation.set(1.3, 0, 0.22);
      add(P.pelvis, cyl(0.016, 0.017, 0.15, m.lace, 8), -0.135, 0.1, -0.23).rotation.set(1.3, 0, 0.22);
      add(P.pelvis, cyl(0.03, 0.03, 0.006, m.dark, 12), -0.153, 0.08, -0.155).rotation.set(1.3, 0, 0.22);
    }
  }

  // ---------------- torso (origin at waist, extends up): kimono, dō, sode
  P.torso = new THREE.Group();
  add(P.torso, lathe([[0.172, 0], [0.18, 0.1], [0.195, 0.24], [0.2, 0.34], [0.185, 0.41], [0.12, 0.455], [0.07, 0.48]], m.cloth, 6, 3)).scale.set(1, 1, 0.7);
  add(P.torso, cyl(0.05, 0.058, 0.1, m.skin, 12), 0, 0.5, 0);
  for (const s of [-1, 1]) {
    add(P.torso, box(0.03, 0.27, 0.01, m.white), s * 0.038, 0.375, -0.132).rotation.set(-0.12, 0, s * 0.36);
    add(P.torso, box(0.05, 0.31, 0.014, m.cloth), s * 0.078, 0.335, -0.13).rotation.set(-0.1, 0, s * 0.36);
    add(P.torso, sph(0.095, m.cloth, 14, 10), s * 0.2, SHOULDER.y + 0.005, 0).scale.set(1.12, 0.74, 1.05);
  }
  if (armored) {
    add(P.torso, lathe([[0.19, 0.0], [0.202, 0.1], [0.214, 0.22], [0.217, 0.33], [0.203, 0.385]], m.armor, 6, 1.25, 20)).scale.set(1, 1, 0.74);
    add(P.torso, box(0.21, 0.06, 0.02, m.plate), 0, 0.405, -0.143).rotation.x = 0.16;
    add(P.torso, box(0.24, 0.06, 0.02, m.plate), 0, 0.4, 0.15).rotation.x = -0.12;
    for (const s of [-1, 1]) {
      add(P.torso, box(0.06, 0.028, 0.27, m.plate), s * 0.125, 0.478, 0);
      add(P.torso, cyl(0.016, 0.016, 0.01, m.trim, 8), s * 0.125, 0.44, -0.158).rotation.x = Math.PI / 2;
    }
    add(P.torso, new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 5, 10), m.lace), 0, 0.3, 0.168);
  }
  if (style.sode) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.247, SHOULDER.y + 0.07, 0);
      pivot.rotation.z = s * 0.2;
      for (let i = 0; i < 6; i++) {
        const l = lame(0.2, 0.052);
        l.rotation.y = Math.PI / 2;
        l.position.set(s * (0.006 + i * 0.007), -0.03 - i * 0.047, 0);
        pivot.add(l);
      }
      P.torso.add(pivot);
    }
  }
  if (style.sashimono != null) {
    add(P.torso, cyl(0.008, 0.008, 1.25, m.dark, 6), 0, 0.82, 0.16);
    add(P.torso, new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.8), m.flag), 0.165, 1.03, 0.16);
    add(P.torso, cyl(0.006, 0.006, 0.34, m.dark, 6), 0.16, 1.44, 0.16).rotation.z = Math.PI / 2;
  }

  // ---------------- head (origin at neck)
  P.head = new THREE.Group();
  add(P.head, sph(0.105, m.face, 28, 20), 0, 0.155, 0).scale.set(0.9, 1.12, 1);
  add(P.head, sph(0.07, m.skin, 14, 10), 0, 0.087, -0.02).scale.set(1, 0.74, 1.05);
  add(P.head, box(0.017, 0.04, 0.022, m.skin), 0, 0.156, -0.104).rotation.x = -0.32;
  add(P.head, sph(0.0125, m.skin, 8, 6), 0, 0.139, -0.113);
  for (const s of [-1, 1]) add(P.head, sph(0.023, m.skin, 8, 6), s * 0.094, 0.155, 0.006).scale.set(0.4, 1, 0.7);
  const hairCap = () => {
    const h = add(P.head, sph(0.111, m.hair, 16, 10, 0, Math.PI * 0.56), 0, 0.16, 0.01);
    h.scale.set(0.93, 1.12, 1.03);
    h.rotation.x = 0.3;
    for (const s of [-1, 1]) add(P.head, box(0.012, 0.05, 0.03, m.hair), s * 0.093, 0.16, -0.035);
  };
  const topknot = () => {
    add(P.head, cyl(0.022, 0.03, 0.05, m.hair, 8), 0, 0.285, 0.04);
    add(P.head, cyl(0.016, 0.02, 0.1, m.hair, 8), 0, 0.3, 0.0).rotation.x = Math.PI / 2 - 0.15;
    add(P.head, cyl(0.024, 0.024, 0.012, m.white, 8), 0, 0.292, 0.04);
  };
  switch (style.head) {
    case 'kabuto': {
      add(P.head, new THREE.Mesh(uvs(new THREE.SphereGeometry(0.128, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 6, 1), m.splint), 0, 0.172, 0).scale.set(1, 1, 1.08);
      add(P.head, cyl(0.022, 0.032, 0.022, m.trim, 10), 0, 0.302, 0);
      for (let i = 0; i < 3; i++) {
        add(P.head, cyl(0.14 + i * 0.036, 0.178 + i * 0.04, 0.052, m.armor, 22, true, -2.25, 4.5, 6, 0.25), 0, 0.128 - i * 0.043, 0);
      }
      add(P.head, box(0.19, 0.012, 0.075, m.plate), 0, 0.197, -0.142).rotation.x = 0.4;
      for (const s of [-1, 1]) {
        add(P.head, box(0.055, 0.075, 0.012, m.plate), s * 0.128, 0.152, -0.088).rotation.y = -s * 0.9;
        add(P.head, cyl(0.012, 0.012, 0.008, m.trim, 8), s * 0.136, 0.155, -0.1).rotation.set(Math.PI / 2, 0, s * 0.9);
        add(P.head, box(0.006, 0.14, 0.006, m.lace), s * 0.083, 0.1, -0.062).rotation.x = 0.28;
      }
      if (style.crest === 'kuwagata') {
        for (const s of [-1, 1]) {
          const sh = new THREE.Shape();
          sh.moveTo(0, 0); sh.quadraticCurveTo(s * 0.06, 0.11, s * 0.045, 0.25); sh.quadraticCurveTo(s * 0.1, 0.12, s * 0.036, 0); sh.closePath();
          add(P.head, new THREE.Mesh(new THREE.ShapeGeometry(sh), m.trim), s * 0.012, 0.215, -0.152).rotation.x = -0.12;
        }
        add(P.head, cyl(0.032, 0.032, 0.006, m.trim, 14), 0, 0.232, -0.155).rotation.x = Math.PI / 2;
      } else if (style.crest === 'moon') {
        add(P.head, new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.011, 6, 20, Math.PI), m.trim), 0, 0.31, -0.148).rotation.z = Math.PI;
      } else if (style.crest === 'horns') {
        for (const s of [-1, 1]) add(P.head, new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.2, 8), m.white), s * 0.118, 0.325, -0.04).rotation.z = -s * 0.65;
      }
      break;
    }
    case 'kasa':
      hairCap();
      add(P.head, new THREE.Mesh(uvs(new THREE.ConeGeometry(0.32, 0.14, 28, 1, true), 10, 1), m.straw), 0, 0.3, 0);
      add(P.head, new THREE.Mesh(new THREE.TorusGeometry(0.318, 0.006, 5, 28), m.straw), 0, 0.231, 0).rotation.x = Math.PI / 2;
      add(P.head, cyl(0.012, 0.03, 0.03, m.straw, 8), 0, 0.378, 0);
      for (const s of [-1, 1]) add(P.head, box(0.005, 0.17, 0.005, m.white), s * 0.088, 0.14, -0.03).rotation.z = s * 0.12;
      break;
    case 'jingasa':
      hairCap();
      add(P.head, new THREE.Mesh(new THREE.ConeGeometry(0.245, 0.09, 22), m.plate), 0, 0.292, 0);
      add(P.head, cyl(0.035, 0.035, 0.005, m.trim, 12), 0, 0.3, -0.115).rotation.x = Math.PI / 2 - 0.36;
      for (const s of [-1, 1]) add(P.head, box(0.005, 0.15, 0.005, m.lace), s * 0.088, 0.15, -0.03).rotation.z = s * 0.1;
      break;
    case 'hood':
      add(P.head, sph(0.113, m.cloth, 18, 10, 0, Math.PI * 0.46), 0, 0.157, 0.002).scale.set(0.93, 1.13, 1.03);
      add(P.head, sph(0.11, m.cloth, 18, 8, Math.PI * 0.57, Math.PI * 0.43), 0, 0.155, 0).scale.set(0.93, 1.14, 1.04);
      add(P.head, cyl(0.075, 0.085, 0.1, m.cloth, 12), 0, 0.05, 0.005);
      for (const s of [-1, 1]) add(P.head, box(0.03, 0.18, 0.004, m.cloth), s * 0.02, 0.07, 0.125).rotation.set(0.3, 0, s * 0.15);
      break;
    case 'band':
      hairCap();
      add(P.head, cyl(0.02, 0.008, 0.3, m.hair, 8), 0, 0.14, 0.145).rotation.x = 0.45;
      add(P.head, cyl(0.107, 0.107, 0.028, m.white, 18, true), 0, 0.208, 0.002).scale.set(0.92, 1, 1.02);
      for (const s of [-1, 1]) add(P.head, box(0.026, 0.2, 0.004, m.white), s * 0.022, 0.13, 0.128).rotation.set(0.38, 0, s * 0.14);
      break;
    default:
      hairCap(); topknot();
  }
  if (style.menpo != null) {
    add(P.head, sph(0.109, m.menpo, 16, 8, Math.PI * 0.53, Math.PI * 0.36), 0, 0.153, -0.004).scale.set(0.93, 1.13, 1.05);
    add(P.head, new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 6), m.menpo), 0, 0.142, -0.122).rotation.x = -Math.PI / 2;
    for (const s of [-1, 1]) {
      add(P.head, box(0.05, 0.012, 0.008, m.white), s * 0.03, 0.118, -0.112).rotation.z = -s * 0.35;
      add(P.head, box(0.012, 0.018, 0.006, m.white), s * 0.014, 0.093, -0.108);
    }
    add(P.head, cyl(0.1, 0.135, 0.075, m.armor, 12, true, Math.PI - 0.95, 1.9, 3, 0.25), 0, 0.03, 0.0);
  }

  // ---------------- limbs: origin at the proximal joint, extending down -Y
  const kote = style.kote ?? armored;
  const upper = () => {
    const g = new THREE.Group();
    add(g, lathe([[0.05, -0.3], [0.07, -0.26], [0.068, -0.1], [0.06, 0]], m.cloth, 3, 2, 12));
    return g;
  };
  const fore = () => {
    const g = new THREE.Group();
    if (kote) {
      add(g, lathe([[0.04, -0.27], [0.05, -0.15], [0.056, -0.02]], m.splint, 3, 1, 12));
      add(g, sph(0.052, m.plate, 10, 8), 0, -0.012, 0.005).scale.set(1, 0.7, 1);
      add(g, cyl(0.043, 0.043, 0.02, m.lace, 10), 0, -0.262, 0);
    } else {
      add(g, lathe([[0.062, -0.15], [0.067, -0.05], [0.062, 0]], m.cloth, 3, 1, 12));
      add(g, cyl(0.042, 0.036, 0.16, m.skin, 10), 0, -0.2, 0);
      add(g, cyl(0.039, 0.039, 0.05, m.white, 10), 0, -0.255, 0);
    }
    add(g, sph(0.046, m.skin, 10, 8), 0, -0.305, 0).scale.set(0.82, 1, 0.92);
    add(g, box(0.022, 0.05, 0.026, m.skin), 0.0, -0.3, -0.04);
    return g;
  };
  const thigh = () => {
    const g = new THREE.Group();
    add(g, lathe([[0.118, -0.46], [0.115, -0.3], [0.105, -0.12], [0.098, 0]], m.hakama, 5, 1, 14));
    if (armored) for (let i = 0; i < 3; i++) add(g, lame(0.15, 0.078), 0, -0.1 - i * 0.072, -0.11 - i * 0.004);
    return g;
  };
  const shin = () => {
    const g = new THREE.Group();
    if (style.suneate) {
      add(g, lathe([[0.047, -0.43], [0.06, -0.25], [0.066, -0.08], [0.06, 0]], m.splint, 4, 1, 12));
      add(g, box(0.1, 0.1, 0.02, m.plate), 0, 0.0, -0.068).rotation.x = -0.1;
      add(g, cyl(0.067, 0.067, 0.016, m.lace, 10), 0, -0.1, 0);
      add(g, cyl(0.052, 0.052, 0.016, m.lace, 10), 0, -0.38, 0);
    } else {
      add(g, lathe([[0.135, -0.3], [0.128, -0.15], [0.118, 0]], m.hakama, 5, 1, 14));
      add(g, cyl(0.045, 0.04, 0.17, m.white, 10), 0, -0.375, 0);
    }
    add(g, box(0.085, 0.055, 0.17, m.white), 0, -0.478, -0.04);
    add(g, sph(0.045, m.white, 10, 8), 0, -0.482, -0.13).scale.set(0.95, 0.6, 1.1);
    add(g, box(0.097, 0.014, 0.255, m.straw), 0, -0.512, -0.062);
    add(g, box(0.092, 0.008, 0.012, m.straw), 0, -0.452, -0.1);
    add(g, box(0.012, 0.008, 0.1, m.straw), 0, -0.455, -0.14).rotation.x = -0.3;
    return g;
  };
  P.uArmR = upper(); P.uArmL = upper();
  P.fArmR = fore(); P.fArmL = fore();
  P.thighR = thigh(); P.thighL = thigh();
  P.shinR = shin(); P.shinL = shin();
  for (const n of PART_NAMES) P[n] = bake(P[n]);
  return { parts: P, mats: m };
}
