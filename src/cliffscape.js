// What the second map looks like. cliff.js builds everything that matters to the fighting and
// draws plain stand-ins; this class draws over them: a shrine yard on the flat head of a rock spire,
// a vermilion fence along its rim, maples in autumn red, a bronze bell under its own roof, and all
// round it a sea of cloud in the morning sun with other peaks standing out of it.
// As everywhere: an angle a points along x = sin(a), z = cos(a); the player first looks towards a = 180°.
import * as THREE from 'three';
import { CliffBase, EDGE_R, RAIL_H, GAPS, BELL, ROCK, TREES } from './cliff.js';
import { growCherry, hipRoof, bentBar, cardsGeo, makeBannerTexture, makeNoise, place } from './arena.js';
import {
  rng, sstep, fbmField, rbox, put, tint, turnUV, scaleUV, mergeGeos, tube, rockGeo, foliageMaterial, foliageDepth,
  noise3, pavingMaps, cliffMaps, mapleTexture,
} from './envkit.js';
import { rand } from './physics.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
/** The morning sun: higher than the yard's dusk sun, a little left of where the player first looks. */
const SUN = new THREE.Vector3(-0.38, 0.36, -1).normalize();
const FENCE_R = 14.56;           // the line the fence stands on (its collision boxes begin at 14.35)
const CLOUD_Y = -10.5;           // the middle height of the cloud sea
const STEP = TAU / 36;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** 1 inside half of `hw` round `c`, falling to 0 at `hw`. */
const win = (a, c, hw) => sstep(hw, hw * 0.5, angDiff(a, c));
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const _c = new THREE.Color();

// What sinks into the cloud takes its colour: the spire itself (the cloud lies in a hollow round it) and the far peaks.
const MIST_COL = new THREE.Color(0.6, 0.65, 0.75);
const MIST_NEAR = { uMistCol: { value: MIST_COL }, uMistTop: { value: -8.5 }, uMistDepth: { value: 8.5 } };
const MIST_FAR = { uMistCol: { value: MIST_COL }, uMistTop: { value: -5.5 }, uMistDepth: { value: 5.5 } };
function mistMaterial(m, U, key = 'mist') {
  const before = m.onBeforeCompile;                 // (a foliage material has its own changes to the shader: those first)
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (sh, renderer) => {
    before.call(m, sh, renderer);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWy;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWy = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
        #else
          vWy = (modelMatrix * vec4(transformed, 1.0)).y;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWy; uniform vec3 uMistCol; uniform float uMistTop, uMistDepth;')
      .replace('#include <fog_fragment>', `#include <fog_fragment>
        {
          float mk = smoothstep(uMistTop, uMistTop - uMistDepth, vWy) * 0.96;
          #ifdef USE_FOG
            gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(uMistCol, fogColor, fogFactor), mk);
          #else
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistCol, mk);
          #endif
        }`);
  };
  return m;
}

// ------------------------------------------------------------------ the outline of the rock
/** The spur behind the fence in the north that carries the little shrine. */
const SPUR = { a: Math.PI, hw: 0.36, out: 5.6 };
/** How far the head of the rock reaches in a direction. At the openings exactly as far as there is ground to stand on. */
function lipR(a) {
  let open = 0;
  for (const [c, hw] of GAPS) open = Math.max(open, sstep(hw + 0.1, hw - 0.02, angDiff(a, c)));
  const n = 0.5 + 0.28 * Math.sin(a * 5 + 1.3) + 0.2 * Math.sin(a * 11 + 0.4) + 0.12 * Math.sin(a * 23 + 2.1);
  const closed = 15.55 + 0.55 * n + SPUR.out * sstep(SPUR.hw, SPUR.hw * 0.3, angDiff(a, SPUR.a));
  return closed + (EDGE_R + 0.06 - closed) * open;
}

/** Read a field made by fbmField: u wraps, v is clamped. */
function samp(F, W, H, u, v) {
  const fx = (((u % 1) + 1) % 1) * W, fy = Math.min(0.9999, Math.max(0, v)) * (H - 1);
  const x0 = fx | 0, y0 = fy | 0, x1 = (x0 + 1) % W, y1 = Math.min(H - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
  const a = F[y0 * W + x0], b = F[y0 * W + x1], c = F[y1 * W + x0], d = F[y1 * W + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * A skin of rings: `fn(a, j, o, i)` gives ring j at angle a its place (o.x, o.y, o.z), texture (o.u, o.v)
 * and colour (o.r, o.g, o.b). Ring after ring going outwards on top or downwards on a face looks outwards.
 */
function lattice(NA, NJ, fn) {
  const n = (NA + 1) * (NJ + 1), pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  const idx = new (n > 65535 ? Uint32Array : Uint16Array)(NA * NJ * 6);
  const o = { x: 0, y: 0, z: 0, u: 0, v: 0, r: 1, g: 1, b: 1 };
  for (let j = 0, k = 0; j <= NJ; j++) for (let i = 0; i <= NA; i++, k++) {
    o.r = o.g = o.b = 1;
    fn((i / NA) * TAU, j, o, i);
    pos[k * 3] = o.x; pos[k * 3 + 1] = o.y; pos[k * 3 + 2] = o.z;
    uv[k * 2] = o.u; uv[k * 2 + 1] = o.v;
    col[k * 3] = o.r; col[k * 3 + 1] = o.g; col[k * 3 + 2] = o.b;
  }
  for (let j = 0, k = 0; j < NJ; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + NA + 1; idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // where the skin closes on itself the two edges share their normals
  const nor = g.attributes.normal;
  for (let j = 0; j <= NJ; j++) {
    const a = j * (NA + 1), b = a + NA;
    const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b), l = Math.hypot(x, y, z) || 1;
    nor.setXYZ(a, x / l, y / l, z / l); nor.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

/** Moss and scrub where a rock skin lies flat enough to hold them: `veg(x, y, z)` gives the colour to grow there. */
function greenTops(g, veg, from = 0.5, to = 0.85) {
  const nor = g.attributes.normal, col = g.attributes.color, pos = g.attributes.position;
  for (let i = 0; i < col.count; i++) {
    const k = sstep(from, to, nor.getY(i));
    if (k <= 0) continue;
    const c = veg(pos.getX(i), pos.getY(i), pos.getZ(i));
    col.setXYZ(i, col.getX(i) + (c[0] - col.getX(i)) * k, col.getY(i) + (c[1] - col.getY(i)) * k, col.getZ(i) + (c[2] - col.getZ(i)) * k);
  }
  return g;
}

/**
 * A pillar of rock standing out of the cloud: a peaked head on fluted walls that fall almost sheer, with
 * a shoulder or two on the way down. Built round the origin; `capY(x, z)` is the height of its head at a
 * point (for what stands on it), `ledges` are places on its shoulders.
 */
function peakGeo(seed, { rad, top, sx = 1, crown = 0.4, bottom = -22, NA = 20, autumn = 0.5 }) {
  const R = rng(seed), F = fbmField(64, 32, 4, 2, 4, seed + 1), RB = fbmField(64, 16, 9, 1, 3, seed + 2, 0.6);
  const l0 = R() * 6.28, l1 = R() * 6.28, k0 = R.range(0.1, 0.28), k1 = R.range(0.06, 0.2), slope = R.range(0.03, 0.09), cr = rad * crown;
  const ox = R.range(-0.3, 0.3) * rad, oz = R.range(-0.3, 0.3) * rad;                 // the summit is not in the middle
  const ta = R() * TAU, tk = R.range(0.1, 0.4) * rad * (crown > 0.2 ? 1 : 0);           // and the whole head lies aslant
  const flute = (u, d) => 1 - Math.abs(samp(RB, 64, 16, u, d / 90) * 2 - 1);
  const rim = (a) => rad * (1 + k0 * Math.sin(2 * a + l0) + k1 * Math.sin(3 * a + l1) + 0.5 * (flute(a / TAU, 0) - 0.5));
  const head = (a, f) => top + cr * Math.pow(1 - f, 1.3) * (1 + f * (samp(F, 64, 32, a / TAU, f) - 0.5) * 1.2);
  const cap = [0, 0.25, 0.5, 0.78, 0.95], deps = [0.25];
  // shoulders: [depth, how far out, direction, half width]
  const sh = [];
  for (let k = 0, d = R.range(0.15, 0.4) * (top - bottom); k < 2 && top - d > -4; k++, d += R.range(0.15, 0.3) * (top - bottom)) sh.push([d, rad * R.range(0.25, 0.6), R() * TAU, R.range(1.0, 2.6)]);
  for (let d = 1.3; top - d > bottom; d += 1.1 + d * 0.38) deps.push(d);
  for (const q of sh) deps.push(q[0] - 0.1, q[0] + 0.5);
  deps.sort((a, b) => a - b);
  const off = deps.map(() => R.range(-0.5, 0.5) * Math.min(1, rad / 6));
  const uRep = Math.max(2, Math.round(TAU * rad * sx / 9));
  const wall = (a, d, j) => {
    let r = rim(a) + 0.3 * sstep(0, 1.5, d) + slope * d + (flute(a / TAU, d) - 0.5) * (0.22 * rad + 0.04 * d) * sstep(0, 3, d)
      + (samp(F, 64, 32, a / TAU, d / 50) - 0.5) * rad * 0.3 * sstep(0, 5, d) + off[j];
    for (const [sd, w, sa, hw] of sh) r += w * win(a, sa, hw) * sstep(sd - 0.1, sd + 0.5, d);
    return r;
  };
  const g = lattice(NA, cap.length + deps.length - 1, (a, j, o, i) => {
    const u = a / TAU, sa = Math.sin(a), ca = Math.cos(a);
    if (j < cap.length) {
      const f = cap[j], r = rim(a) * f, lift = 1 - f;
      o.x = (sa * r + ox * lift) * sx; o.z = ca * r + oz * lift; o.y = head(a, f) + tk * f * Math.cos(a - ta);
      o.u = o.x / 70; o.v = o.z / 70;                  // (the head is turf and scrub: the beds of the rock must not show on it)
      const k = 0.85 + 0.4 * samp(F, 64, 32, u + f * 0.3, 0.5);
      o.r = k; o.g = k * 0.98; o.b = k * 0.95;
      return;
    }
    const jj = j - cap.length, d = deps[jj], r = wall(a, d, jj), fl = flute(u, d);
    o.x = sa * r * sx; o.z = ca * r; o.y = head(a, 1) + tk * Math.cos(a - ta) - d;
    o.u = (i / NA) * uRep; o.v = -d / 9;
    const k = (0.8 + 0.4 * samp(F, 64, 32, u, d / 30)) * (0.62 + 0.5 * fl);
    o.r = k * 1.03; o.g = k * 0.99; o.b = k * 0.95;
  });
  // scrub on the head and on every shoulder: pine green, with patches of autumn red and gold
  const vz = noise3(seed + 5);
  greenTops(g, (x, y, z) => {
    const n = vz.fbm(x * 0.11, y * 0.11, z * 0.11, 2), au = sstep(1 - autumn - 0.12, 1 - autumn + 0.1, n * 1.3), gold = sstep(0.4, 0.6, vz(z * 0.2, x * 0.2, 3));
    const dark = 0.75 + 0.5 * vz(x * 0.5, y * 0.5, z * 0.5);
    return [(0.3 + au * (0.75 + 0.3 * gold)) * dark, (0.5 + au * (-0.2 + 0.42 * gold)) * dark, (0.22 - au * 0.1) * dark];
  }, 0.5, 0.82);
  const capY = (x, z) => {
    // (close enough: the head as if its summit stood in the middle)
    const a = Math.atan2(x / sx, z), f = Math.min(1, Math.hypot(x / sx, z) / rim(a));
    return head(a, f) + tk * f * Math.cos(a - ta);
  };
  const ledges = sh.map(([sd, w, sa]) => { const r = rim(sa) + slope * sd + w * 0.55; return [Math.sin(sa) * r * sx, head(sa, 1) - sd - 0.2, Math.cos(sa) * r]; });
  return { geo: g, capY, ledges };
}

/** A torii as the yard has it, `s` times its size (about 7.3 m high at 1), standing at the origin across x. */
function toriiGeos(s) {
  const red = [], black = [];
  for (const sd of [-1, 1]) {
    red.push(put(new THREE.CylinderGeometry(0.29, 0.37, 7, 14, 3), sd * 3.3, 3.5, 0, 0, 0, -sd * 0.04));
    black.push(put(new THREE.CylinderGeometry(0.4, 0.44, 0.75, 14), sd * 3.42, 0.37, 0));
  }
  const lift = (x) => 0.55 * Math.pow(Math.abs(x) / 4.35, 2.6);
  red.push(put(turnUV(rbox(7.9, 0.42, 0.32, 0.03, 1), 3, 1), 0, 5.35, 0));
  red.push(put(bentBar([[-0.26, -0.2], [0.26, -0.2], [0.26, 0.2], [-0.26, 0.2]], 8.7, 14, lift), 0, 6.75, 0));
  red.push(put(rbox(0.5, 1.0, 0.2, 0.02, 1), 0, 6.05, 0));
  black.push(put(bentBar([[-0.38, -0.14], [0.38, -0.14], [0.44, 0.02], [0, 0.2], [-0.44, 0.02]], 9.6, 14, lift), 0, 7.09, 0));
  for (const g of red) tint(g.scale(s, s, s), (x, y) => { const k = 0.66 + 0.34 * sstep(0.1 * s, 2.4 * s, y); return [k, k * 0.95, k * 0.95]; });
  for (const g of black) g.scale(s, s, s);
  return { red, black };
}

/** A square cap with four crisp faces (on the fence posts). */
function capGeo(w, h) {
  const g = new THREE.ConeGeometry(w * 0.72, h, 4, 1).rotateY(Math.PI / 4).translate(0, h / 2, 0).toNonIndexed();
  g.computeVertexNormals();
  return g;
}

/** A fir for the far peaks: the yard's conifer with fewer boughs (it is never seen close). Trunk and all, to be instanced. */
function firGeo(R) {
  const C = new Cards(), H = 9, Y0 = 1.7, TIERS = 5;
  for (let t = 0; t < TIERS; t++) {
    const f = t / (TIERS - 1), y = Y0 + (H - Y0 - 1.3) * Math.pow(f, 0.9), L0 = 2.9 * (1 - f) + 0.75, nb = f < 0.4 ? 5 : 4, a0 = R() * 6.28;
    for (let b = 0; b < nb; b++) {
      const a = a0 + (b / nb) * 6.283 + R.range(-0.25, 0.25), L = L0 * R.range(0.8, 1.12), sa = Math.sin(a), ca = Math.cos(a), base = C.pos.length / 3;
      const rise = 0.22 + 0.55 * f, droop = 0.7 - 0.35 * f, hw = L * 0.42, tone = R.range(0.78, 1.08), yy = y + R.range(-0.25, 0.25);
      for (let j = 0; j <= 2; j++) {
        const s = j / 2, out = L * s * (1 - 0.12 * s), h = yy + L * (rise * s - droop * s * s);
        for (const side of [-1, 1]) {
          C.pos.push(sa * out + ca * side * hw, h - 0.04 * L, ca * out - sa * side * hw);
          const nx = sa * 0.55 + ca * side * 0.25, nz = ca * 0.55 - sa * side * 0.25, l = Math.hypot(nx, 0.8, nz);
          C.nor.push(nx / l, 0.8 / l, nz / l);
          C.uv.push(side * 0.5 + 0.5, 0.03 + 0.97 * s);
          const k = (0.5 + 0.5 * s) * tone;
          C.col.push(k, k, k);
        }
      }
      for (let j = 0; j < 2; j++) { const p = base + j * 2; C.idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
    }
  }
  for (const a of [0, Math.PI / 2]) {
    const base = C.pos.length / 3, sa = Math.sin(a), ca = Math.cos(a);
    for (const [sx, y, vv] of [[-1, H - 2.2, 0.03], [1, H - 2.2, 0.03], [-1, H + 0.25, 1], [1, H + 0.25, 1]]) { C.pos.push(ca * sx * 0.7, y, -sa * sx * 0.7); C.nor.push(sa * 0.3, 0.9, ca * 0.3); C.uv.push(sx * 0.5 + 0.5, vv); C.col.push(0.9, 0.9, 0.9); }
    C.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  // a dark core and the trunk, both painted from the picture's solid corner
  const cone = (y0, y1, r0, r1, c, seg) => {
    const base = C.pos.length / 3;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * 6.2832, sa = Math.sin(a), ca = Math.cos(a);
      C.pos.push(sa * r0, y0, ca * r0, sa * r1, y1, ca * r1); C.nor.push(sa * 0.9, 0.4, ca * 0.9, sa * 0.9, 0.4, ca * 0.9); C.uv.push(0.02, 0.01, 0.02, 0.01); C.col.push(...c, ...c);
    }
    for (let j = 0; j < seg; j++) { const p = base + j * 2; C.idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
  };
  cone(Y0 + 0.2, H - 0.6, 0.95, 0.05, [0.05, 0.085, 0.04], 6);
  cone(0, H - 1, 0.24, 0.04, [0.2, 0.15, 0.11], 5);
  return C.geo();
}

/** Cut-out cards gathered into one geometry. */
class Cards {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * A mountain pine that has had to fight for its place: a trunk bent out from the rock and up, a few
 * level limbs, and at the end of each a flat cushion of needles. `out` is the direction away from the rock.
 */
function growPine(R, wood, C, root, out, s) {
  const ox = Math.sin(out), oz = Math.cos(out), tx = oz, tz = -ox;
  const P = (o, u, t) => V3(root.x + (ox * o + tx * t) * s, root.y + u * s, root.z + (oz * o + tz * t) * s);
  const b = R.range(-0.7, 0.7), lean = R.range(0.7, 1.3);
  const T = [P(-0.35, -0.3, 0), P(0.45 * lean, 0.2, b * 0.15), P(1.0 * lean, 0.95, b * 0.5), P(1.05 * lean, 1.9, b), P(1.55 * lean, 2.7, b * 0.75), P(1.4 * lean, 3.45, b * 0.3)];
  wood.push(tint(tube(T, [0.19 * s, 0.17 * s, 0.14 * s, 0.11 * s, 0.075 * s, 0.035 * s], 6, { vScale: 0.6, steps: 12, flare: 0.3 }), 0.86, 0.74, 0.66));
  const pad = (c, rad) => {
    for (let layer = 0; layer < 2; layer++) {
      const n = layer ? 4 : 6, a0 = R() * 6.28, lr = rad * (layer ? 0.62 : 1), ly = c.y + layer * rad * 0.2;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * TAU + R.range(-0.3, 0.3), L = lr * R.range(0.85, 1.15), hw = L * 0.4, tone = R.range(0.72, 1.08);
        const dx = Math.sin(a), dz = Math.cos(a), base = C.pos.length / 3;
        for (let j = 0; j <= 2; j++) {
          const f = j / 2, o = L * (f - 0.1), h = ly + L * 0.3 * f * (1.5 - f) + R.range(-0.04, 0.04) * rad;
          for (const side of [-1, 1]) {
            C.pos.push(c.x + dx * o + dz * side * hw, h - 0.04 * L, c.z + dz * o - dx * side * hw);
            const nx = dx * 0.4 + dz * side * 0.22, nz = dz * 0.4 - dx * side * 0.22, l = Math.hypot(nx, 0.86, nz);
            C.nor.push(nx / l, 0.86 / l, nz / l);
            C.uv.push(side * 0.5 + 0.5, 0.03 + 0.97 * f);
            const q = (0.55 + 0.45 * f) * tone;
            C.col.push(q * 0.62, q * 0.78, q * 0.6);
          }
        }
        for (let j = 0; j < 2; j++) { const p = base + j * 2; C.idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
      }
    }
  };
  const limbs = [[2, 0.9, 0.05, -1.0, 1.15], [3, -0.5, 0.1, 1.1, 1.05], [3, 1.1, 0.25, 0.5, 0.95], [4, 0.2, 0.15, -0.9, 0.85], [4, -0.6, 0.3, 0.5, 0.7]];
  for (const [at, o, u, t, rad] of limbs) {
    if (R() < 0.18) continue;
    const from = T[at], oo = o * R.range(0.8, 1.2), tt = t * R.range(0.8, 1.2);
    const end = V3(from.x + (ox * oo + tx * tt) * s, from.y + u * s, from.z + (oz * oo + tz * tt) * s);
    const mid = from.clone().lerp(end, 0.5); mid.y -= 0.08 * s;
    wood.push(tint(tube([from, mid, end], [0.06 * s, 0.045 * s, 0.02 * s], 4, { vScale: 0.6, steps: 4 }), 0.8, 0.7, 0.62));
    pad(end, rad * s * 0.85);
  }
  pad(T[5], 0.8 * s);
}

/**
 * A tor that fills a box of w × h × d without looking like one: slabs of granite lying on one another,
 * each with its own outline, its corners broken off at different angles and its edges weathered round,
 * the top one split across. `cuts` are the heights of the joints. Centred on the origin, standing on
 * y = 0, flat on top; it stays inside the box except for a little at its foot.
 */
function torGeo(nz, seed, w, h, d, cuts) {
  const R = rng(seed), NA = w > 2 ? 64 : 40, ox = R() * 40, oz = R() * 40;
  const diag = Math.hypot(w / 2, d / 2), ca = Math.atan2(d, w), sc = Math.min(1, Math.min(w, d) / 2);
  const levels = [0, ...cuts, h];
  const slabs = levels.slice(0, -1).map((y0, n) => {
    // the planes that bound a slab: the four faces of the box, pushed in and turned a little, and a cut across every corner
    const top = n === levels.length - 2;
    const planes = [[0, w / 2], [Math.PI / 2, d / 2], [Math.PI, w / 2], [-Math.PI / 2, d / 2]].map(([a, dist]) => [a + R.range(-0.05, 0.05), dist - (top ? R.range(0, 0.02) : R.range(0.0, 0.09)), R.range(-0.03, 0.05)]);
    const deep = Math.floor(R() * 4);
    [ca, Math.PI - ca, Math.PI + ca, -ca].forEach((a, k) => {
      const big = k === deep || (k === (deep + 2) % 4 && R() < 0.6);
      planes.push([a + R.range(-0.3, 0.3), diag - (big ? R.range(0.26, 0.46) : R.range(0.08, 0.17)) * sc, R.range(0.0, big ? 0.1 : 0.04)]);
      if (big) planes.push([a + R.range(-0.6, 0.6), diag - R.range(0.1, 0.2) * sc, R.range(0.0, 0.08)]);
    });
    return { y0, y1: levels[n + 1], planes, tilt: R.range(0.03, 0.07) * (n ? 1 : 0), dir: R() * TAU, tone: R.range(0.9, 1.08) };
  });
  const split = R() * Math.PI, ys = [];
  slabs.forEach((s, n) => {
    const H = s.y1 - s.y0, top = n === slabs.length - 1;
    for (const t of [0, 0.035, 0.09, 0.18]) ys.push([n, t / H]);
    for (let k = 1, m = Math.max(1, Math.round((H - 0.36) / 0.22)); k < m; k++) ys.push([n, (0.18 + (H - 0.36) * k / m) / H]);
    for (const t of top ? [0.13, 0.06, 0.018, 0] : [0.18, 0.09, 0.035, 0]) ys.push([n, 1 - t / H]);
  });
  const side = ys.length, cap = [0.97, 0.9, 0.78, 0.62, 0.45, 0.28, 0.12, 0];
  const cleft = (a) => Math.max(Math.exp(-Math.pow(angDiff(a, split) / 0.06, 2)), Math.exp(-Math.pow(angDiff(a, split + Math.PI + 0.3) / 0.06, 2)));
  const out = (a, n, t) => {
    const s = slabs[n], top = n === slabs.length - 1, H = s.y1 - s.y0;
    let r = 99, which = 0;
    s.planes.forEach(([pa, dist, lean], k) => { const c = Math.cos(a - pa); if (c > 0.05) { const q = (dist - lean * t) / c; if (q < r) { r = q; which = k; } } });
    // the joints do not lie level
    const ya = s.y0 + (n ? slabs[n].tilt * Math.cos(a - s.dir) * (1 - t) : 0), yb = s.y1 + (top ? 0 : slabs[n + 1].tilt * Math.cos(a - slabs[n + 1].dir) * t);
    const y = ya + (yb - ya) * t, x = Math.cos(a) * r, z = Math.sin(a) * r;
    let inset = 0.01 + 0.045 * nz.fbm(x * 0.8 + ox, y * 0.8, z * 0.8 + oz, 3) + 0.018 * nz(x * 3.3 + ox, y * 3.3, z * 3.3 + oz);
    // edges weathered round: deep where two slabs meet, slight on top (that edge is hung from)
    const eb = Math.max(0, 1 - t * H / 0.18), et = Math.max(0, 1 - (1 - t) * H / (top ? 0.13 : 0.18));
    const groove = (n ? eb * eb : 0) + (top ? 0 : et * et);
    inset += 0.13 * groove + (top ? 0.06 * et * et : 0);
    if (!n) inset -= 0.1 * (1 - sstep(0, 0.4, y)) * (0.3 + nz(x * 1.7, 0, z * 1.7));        // spreads at the foot
    const cf = top ? cleft(a) * sstep(0, 0.3, t) : 0;
    inset += 0.1 * cf;
    return [r - inset, y, which, Math.min(1, groove + cf)];
  };
  const per = Math.max(1, Math.round((w + d) / 1.6)), face = new Uint8Array((NA + 1) * side);
  const g = lattice(NA, side + cap.length - 1, (a, j, o, i) => {                            // (rings going up, turning this way: the skin faces outwards)
    if (j < side) {
      const [n, t] = ys[j], [r, y, which, dark] = out(a, n, t);
      face[j * (NA + 1) + i] = which;
      o.x = Math.cos(a) * r; o.z = Math.sin(a) * r; o.y = y;
      o.u = (i / NA) * per * 2; o.v = y / 0.8;
      // every face its own tone, rain streaks down it, dark in the joints and towards the ground
      const streak = nz(Math.cos(a) * 5 + ox, y * 0.35, Math.sin(a) * 5 + oz);
      const k = (0.9 + 0.22 * nz.fbm(o.x * 0.9 + ox, y * 0.9, o.z * 0.9 + oz, 2)) * (0.84 + 0.24 * streak) * (0.78 + 0.22 * sstep(0, 0.6, y)) * (0.93 + 0.12 * ((which * 37) % 5) / 4) * slabs[n].tone * (1 - 0.55 * dark);
      o.r = k; o.g = k; o.b = k * 0.98;
    } else {
      const f = cap[j - side], [r] = out(a, slabs.length - 1, 1);
      o.x = Math.cos(a) * r * f; o.z = Math.sin(a) * r * f;
      const dl = Math.abs(o.x * Math.sin(split) - o.z * Math.cos(split)), cf = Math.exp(-Math.pow(dl / 0.06, 2)) * sstep(0.0, 0.15, f);
      o.y = h - 0.012 + (nz(o.x * 2.2 + ox, 3, o.z * 2.2 + oz) - 0.5) * 0.04 * (1 - f * f) - 0.05 * cf;
      o.u = o.x / 0.8; o.v = o.z / 0.8;
      const k = (0.96 + 0.22 * nz(o.x * 1.5 + ox, 7, o.z * 1.5 + oz)) * (1 - 0.5 * cf);
      o.r = k; o.g = k; o.b = k * 0.97;
    }
  });
  // the faces are planes: each keeps its own normal away from the joints, so the edges between them stay edges
  const nor = g.attributes.normal;
  for (let j = 0; j < side; j++) {
    const [n, t] = ys[j], H = slabs[n].y1 - slabs[n].y0, flat = sstep(0.05, 0.2, Math.min(t, 1 - t) * H) * 0.8;
    for (let i = 0; i <= NA; i++) {
      const k = j * (NA + 1) + i, pa = slabs[n].planes[face[k]][0];
      const nx = Math.cos(pa) * flat + nor.getX(k) * (1 - flat), ny = nor.getY(k) * (1 - flat), nzz = Math.sin(pa) * flat + nor.getZ(k) * (1 - flat), l = Math.hypot(nx, ny, nzz) || 1;
      nor.setXYZ(k, nx / l, ny / l, nzz / l);
    }
  }
  greenTops(g, (x, y, z) => { const m = sstep(0.4, 0.6, nz.fbm(x * 1.4 + ox, 2, z * 1.4 + oz, 2)) * sstep(0.3, 0.6, y / h + 0.3); return [1 - 0.6 * m, 1 - 0.32 * m, 0.96 - 0.68 * m]; }, 0.55, 0.9);
  return g;
}

// ------------------------------------------------------------------ shaders
const MORNING_SKY = {
  vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 sunDir, haze; uniform float dim, sat, stars, time; varying vec3 vDir;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;
      float s = max(dot(d, sunDir), 0.0);
      float az = dot(normalize(d.xz + 1e-5), normalize(sunDir.xz)) * 0.5 + 0.5;
      // the vault: pale over the cloud, clear blue above it, deep blue overhead
      vec3 c = mix(vec3(0.50, 0.70, 0.98), vec3(0.14, 0.38, 0.88), smoothstep(0.0, 0.2, h));
      c = mix(c, vec3(0.03, 0.14, 0.52), smoothstep(0.15, 0.9, h));
      // gold low down on the sun's side, and a wide glow round the sun itself
      c = mix(c, vec3(1.0, 0.78, 0.5), exp(-max(h, 0.0) * 7.0) * (0.06 + 0.74 * pow(az, 4.0)));
      c += vec3(1.0, 0.68, 0.38) * pow(s, 6.0) * 0.3;
      c += vec3(1.0, 0.86, 0.62) * pow(s, 60.0) * 0.85;
      // thin cloud very high up, combed out by the wind; it closes in when the weather turns
      float thr = mix(0.36, 0.6, smoothstep(0.2, 1.0, sat));
      vec2 uv = d.xz / (max(h, 0.0) + 0.24);
      float n = fbm(uv * vec2(0.7, 2.4) + vec2(time * 0.006, 0.0)) * 0.72 + fbm(uv * vec2(2.0, 5.5) - vec2(time * 0.004, 1.7)) * 0.4;
      float dens = smoothstep(thr, thr + 0.3, n) * smoothstep(0.02, 0.22, h);
      vec3 cl = mix(vec3(0.94, 0.96, 1.0), vec3(1.5, 1.16, 0.82), pow(s, 2.0));
      c = mix(c, cl, dens * 0.72);
      c += vec3(3.2, 2.5, 1.7) * smoothstep(0.9990, 0.9994, s) * (1.0 - dens * 0.5) * smoothstep(0.3, 0.7, sat) * (1.0 - stars);       // (no sun through the overcast, none at night)
      c = mix(vec3(dot(c, vec3(0.3, 0.5, 0.2))), c, sat) * dim;
      if (stars > 0.0) {
        vec3 sq = d * 150.0, g = floor(sq);
        float sn = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float clear = 1.0 - dens * 0.9;
        float pt = smoothstep(0.42 * (0.4 + fract(sn * 91.7)), 0.0, length(fract(sq) - 0.5));
        float tw = 0.75 + 0.25 * sin(time * (1.5 + fract(sn * 37.3) * 3.0) + sn * 600.0);
        c += mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), fract(sn * 13.1)) * step(0.992, sn) * pt * tw * 1.6 * stars * smoothstep(0.02, 0.3, h) * clear;
        float m = max(dot(d, normalize(vec3(0.45, 0.5, 0.74))), 0.0);
        c += vec3(0.9, 0.93, 1.0) * (smoothstep(0.9982, 0.9987, m) + pow(m, 60.0) * 0.25) * stars * (0.35 + 0.65 * clear);
        c += vec3(0.5, 0.56, 0.75) * dens * pow(m, 6.0) * 0.12 * stars;
      }
      // the far cloud is lost in haze, and the sky comes down into the same haze
      c = mix(c, haze, max(smoothstep(0.03, -0.03, h), exp(-max(h, 0.0) * 26.0) * 0.75));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// The cloud sea is drawn as a body with two thin veils over it: a veil shows only where the cloud stands
// at least that high, with soft edges, so the heads are woolly at their rims instead of cut out.
const CLOUD_SEA = {
  vertexShader: `
    uniform sampler2D uNoise; uniform float uTime, uLayer;
    varying vec3 vWp; varying vec3 vN; varying float vWell;
    #include <fog_pars_vertex>
    // the body of the cloud: long swells with round heads on them (read coarsely: the mesh could not carry more)
    float body(vec2 q, float lod, float far, float well) {
      float big = textureLod(uNoise, q * 0.0058 + uTime * vec2(0.0011, 0.0005), lod - 1.0).r - 0.5;
      float b = textureLod(uNoise, q * 0.0085 - uTime * vec2(0.0009, -0.0012), lod).g;
      return (big * 6.0 + min(1.0, abs(2.0 * b - 1.0) * 2.6) * 4.0) * far * (1.0 - well) - 5.0 * well;
    }
    void main() {
      vec3 p = position;
      float r = length(p.xz), well = exp(-max(r - 15.0, 0.0) / 6.5);
      float far = 1.0 + 1.7 * smoothstep(24.0, 130.0, r);                  // further out the heads tower, and show over the rim
      float lod = 3.0 + log2(1.0 + r / 40.0), e = 7.0 + r * 0.1;
      float h = body(p.xz, lod, far, well);
      // (the slope is read more coarsely still, or every ring of the mesh would show as a band of light)
      float h0 = body(p.xz, lod + 1.5, far, well);
      vN = normalize(vec3(h0 - body(p.xz + vec2(e, 0.0), lod + 1.5, far, well), e, h0 - body(p.xz + vec2(0.0, e), lod + 1.5, far, well)));
      p.y += h + uLayer * 2.4 * far;
      vWell = exp(-max(r - 15.0, 0.0) / 5.0);
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vWp = wp.xyz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform sampler2D uNoise; uniform float uTime, uLayer; uniform vec3 uSun, uSky, uSunDir, uMistCol;
    varying vec3 vWp; varying vec3 vN; varying float vWell;
    #include <fog_pars_fragment>
    // how high the cloud stands here, 0..1: round heads with creases between them, as cumulus has
    vec2 heads(vec2 q) {
      float b = texture2D(uNoise, q * 0.017 - uTime * vec2(0.0015, -0.002)).g;
      float c = texture2D(uNoise, q * 0.052 + uTime * vec2(0.0045, 0.003)).b;
      float d = texture2D(uNoise, q * 0.16 - uTime * vec2(0.006, 0.008)).r;
      float hb = min(1.0, pow(abs(2.0 * b - 1.0) * 2.6, 1.5)), hc = min(1.0, pow(abs(2.0 * c - 1.0) * 2.6, 1.5));
      return vec2(hb * 0.25 + hc * 0.55 + d * 0.3, hb * 0.5 + hc * 0.4 + d * 0.16);
    }
    void main() {
      vec2 q = vWp.xz;
      vec2 H = heads(q);
      float a = uLayer > 0.0 ? smoothstep(uLayer - 0.22, uLayer + 0.3, H.x) * (1.0 - vWell) * 0.7 : 1.0;
      if (a < 0.004) discard;
      vec2 s = normalize(uSunDir.xz);
      // which side looks at the sun: of the swell as a whole, and of the small heads on it
      float lit = smoothstep(-0.25, 0.6, dot(normalize(vN), uSunDir)) * 0.6 + smoothstep(-0.14, 0.16, H.y - heads(q + s * 3.5).y) * 0.4;
      vec3 V = normalize(cameraPosition - vWp);
      float fwd = pow(max(dot(-V, uSunDir), 0.0), 5.0);                    // looking into the light: the heads glow
      float ao = smoothstep(0.1, 0.8, H.y * 0.75 + H.x * 0.3);             // the hollows lie in shade
      vec3 col = uSky * (0.4 + 0.46 * ao) + uSun * (lit * (0.3 + 0.7 * ao) * 0.66 + fwd * 0.3);
      col = mix(col, uMistCol, vWell);
      gl_FragColor = vec4(col, a);
      #include <fog_fragment>
    }`,
};

/**
 * The floor: flagstones in the middle, a strip of dressed slabs from the head of the old stair to the
 * shrine, bare jointed rock towards the rim, moss where it is damp, the maples' leaves lying under
 * them, and in the rain a wet sheen with standing puddles.
 */
function plateauShader(mat, U) {
  mat.customProgramCacheKey = () => 'plateau';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vGp = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vGp; uniform sampler2D uNoise, uRock, uRockN; uniform vec3 uTree[3], uGap[3]; uniform float uTime;
        float pHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <map_fragment>', `
        float gR = length(vGp);
        vec4 gN = texture2D(uNoise, vGp * 0.031);
        vec4 gN2 = texture2D(uNoise, vGp * 0.13 + 0.37);
        float gWet = 1.0 - smoothstep(0.3, 0.9, roughness);
        float gCourt = 1.0 - smoothstep(11.9, 12.7, gR + (gN2.g - 0.5) * 2.4 + (gN.r - 0.5) * 1.5);
        vec2 gUvB = mat2(0.8, -0.6, 0.6, 0.8) * vGp * 0.098;
        vec3 gPav = texture2D(map, vMapUv).rgb;
        vec3 gBig = texture2D(map, gUvB).rgb;
        // where the fence is gone the rock at the brink is bare and pale: trodden, and newly broken
        float gOpen = 0.0;
        for (int i = 0; i < 3; i++) gOpen = max(gOpen, smoothstep(uGap[i].z - 0.012, uGap[i].z + 0.006, dot(vGp / max(gR, 0.01), uGap[i].xy)));
        gOpen *= smoothstep(12.6, 14.3, gR + (gN2.r - 0.5) * 1.2);
        vec3 gRk = texture2D(uRock, vGp * 0.47).rgb * (0.55 + 0.9 * texture2D(uRock, vGp * 0.041 + 0.3).g);
        vec3 gBed = gRk * vec3(0.44, 0.415, 0.38) * (0.4 + 0.8 * dot(gBig, vec3(0.6))) * (1.0 + 0.45 * gOpen);
        vec2 gS = vec2((vGp.x + 1.38) / 0.92, vGp.y / 1.38);
        gS.x += 0.5 * mod(floor(gS.y), 2.0);
        vec2 gId = floor(gS), gE = min(fract(gS), 1.0 - fract(gS)) * vec2(0.92, 1.38);
        float gPath = (1.0 - smoothstep(1.37, 1.39, abs(vGp.x))) * smoothstep(-11.02, -11.0, vGp.y) * (1.0 - smoothstep(14.9, 14.95, vGp.y));
        float gJ = max(1.0 - smoothstep(0.006, 0.026, min(gE.x, gE.y)), 1.0 - smoothstep(0.0, 0.035, 1.38 - abs(vGp.x)));
        vec3 gSlab = mix(vec3(0.62), texture2D(uRock, vGp * 0.31 + gId * 0.37).rgb, 0.6) * vec3(0.6, 0.585, 0.56) * (0.8 + 0.32 * pHash(gId)) * (1.0 - 0.8 * gJ);
        vec3 gCol = mix(mix(gBed, gPav, gCourt), gSlab, gPath);
        diffuseColor.rgb *= gCol * (0.8 + 0.42 * gN.r) * 1.2;
        float gTr = 99.0;
        for (int i = 0; i < 3; i++) gTr = min(gTr, length(vGp - uTree[i].xy));
        float gMoss = smoothstep(0.59, 0.74, gN2.b * 0.62 + gN.b * 0.5 + smoothstep(10.5, 14.6, gR) * 0.14 - gPath * 0.1 - gOpen * 0.3 + (1.0 - smoothstep(0.35, 1.3, gTr)) * 0.5) * (0.55 + 0.45 * smoothstep(0.3, 0.7, gN2.r));
        gMoss = max(gMoss, smoothstep(15.15, 15.6, gR + (gN2.r - 0.5) * 0.5) * 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * vec3(0.105, 0.14, 0.05) * (0.5 + gN2.b) * (0.5 + 1.1 * gBig.g + 1.3 * gPav.g), gMoss * 0.92);
        float gFall = 1.0 - smoothstep(0.8, 4.8, gTr);
        vec4 gL = texture2D(uNoise, mat2(0.6, 0.8, -0.8, 0.6) * vGp * 2.9 + 0.11) * 0.6 + texture2D(uNoise, vGp * 4.7 + 0.5) * 0.4;
        float gLeaf = smoothstep(0.64 - 0.09 * gFall, 0.66 - 0.09 * gFall, gL.r) * smoothstep(0.0, 0.25, gFall);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * mix(vec3(0.4, 0.035, 0.02), vec3(0.72, 0.27, 0.03), smoothstep(0.42, 0.6, gL.b)), gLeaf * 0.92);
        float gPud = gWet * smoothstep(0.5, 0.58, gN.g + (gN2.r - 0.5) * 0.12) * (1.0 - gMoss) * (1.0 - smoothstep(14.0, 14.8, gR));
        diffuseColor.rgb *= mix(1.0, 0.72, gWet) * mix(1.0, 0.55, gPud);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 1.0, max(gMoss, gLeaf) * (1.0 - gWet * 0.5));
        roughnessFactor = mix(roughnessFactor, mix(0.5, 0.04, gPud), gWet);`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec2 nA = texture2D(normalMap, vNormalMapUv).xy * 2.0 - 1.0;
          vec2 nB = mat2(0.8, 0.6, -0.6, 0.8) * (texture2D(normalMap, gUvB).xy * 2.0 - 1.0);
          vec2 nn = mix(nB * 1.5 + (texture2D(uRockN, vGp * 0.47).xy * 2.0 - 1.0) * 0.8, nA, gCourt) * normalScale;
          nn = mix(nn, nn * 0.12 + (vec2(pHash(gId + 3.1), pHash(gId + 7.7)) - 0.5) * 0.06, gPath);
          nn *= (1.0 - 0.7 * gMoss) * (1.0 - 0.6 * gWet);
          normal = normalize(normal + (viewMatrix * vec4(nn.x, 0.0, nn.y, 0.0)).xyz);
          if (gPud > 0.0) {
            vec2 rip = texture2D(uNoise, vGp * 2.3 + uTime * vec2(0.13, 0.09)).rg + texture2D(uNoise, vGp * 3.1 - uTime * vec2(0.08, 0.15)).gb - 1.0;
            vec3 flat_ = (viewMatrix * vec4(rip.x * 0.12, 1.0, rip.y * 0.12, 0.0)).xyz;
            normal = normalize(mix(normal, flat_, gPud));
          }
        }`);
  };
}

// ------------------------------------------------------------------ the map
export class CliffArena extends CliffBase {
  get sunDir() { return SUN; }

  /** Static geometry is gathered by material while everything is built, and becomes one mesh each at the end. */
  add(key, ...geos) { for (const g of geos) this.acc[key].push(g); }

  // ---------------------------------------------------------------- sky and cloud
  buildSky(scene) {
    scene.background = new THREE.Color(0x9aa8c0);
    scene.fog = new THREE.FogExp2(0xb8c0d4, 0.009);
    const uniforms = { sunDir: { value: SUN }, haze: { value: new THREE.Color(0xb8c0d4) }, dim: { value: 1 }, sat: { value: 1 }, stars: { value: 0 }, time: { value: 0 } };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(232, 32, 16), new THREE.ShaderMaterial({ ...MORNING_SKY, uniforms, side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10;
    scene.add(sky);
    this.sky = sky;
  }

  buildClouds(scene) {
    const radii = [];
    for (let r = 12.5; r < 236; r += 1.2 + r * 0.095) radii.push(r);
    radii.push(236);
    const g = lattice(96, radii.length - 1, (a, j, o) => { o.x = Math.sin(a) * radii[j]; o.z = Math.cos(a) * radii[j]; o.y = 0; });
    g.deleteAttribute('color'); g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const shared = this.cloudU = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uNoise: this.groundU.uNoise, uTime: { value: 0 }, uSun: { value: new THREE.Color() }, uSky: { value: new THREE.Color() },
      uSunDir: { value: SUN }, uMistCol: { value: MIST_COL },
    };
    const SHEETS = 2;
    for (let k = 0; k <= SHEETS; k++) {
      const m = new THREE.ShaderMaterial({ ...CLOUD_SEA, uniforms: { ...shared, uLayer: { value: [0, 0.42, 0.8][k] } }, fog: true, side: THREE.DoubleSide, transparent: k > 0, depthWrite: k === 0 });
      const sea = new THREE.Mesh(g, m);
      sea.position.y = CLOUD_Y - 3.0;
      sea.frustumCulled = false;
      sea.renderOrder = k - 8;                 // from the bottom up, and before anything else that is see-through
      scene.add(sea);
    }
    // whatever lies deeper is the same grey as the cloud seen from inside
    const floor = new THREE.Mesh(new THREE.CircleGeometry(236, 24).rotateX(-Math.PI / 2), mistMaterial(new THREE.MeshBasicMaterial({ color: 0x808080 }), { uMistCol: { value: MIST_COL }, uMistTop: { value: 0 }, uMistDepth: { value: 1 } }));
    floor.position.y = -47;
    scene.add(floor);
  }

  // ---------------------------------------------------------------- the head of the rock and its faces
  drawGround(scene) {
    const M = this.M, T = this.T;
    this.acc = { red: [], black: [], stone: [], wood: [], pale: [], plaster: [], straw: [], gold: [], copper: [], redFar: [], blackFar: [], stoneFar: [], plasterFar: [], goldFar: [], stoneLow: [] };
    this.nz = noise3(77);
    const N = (s) => new THREE.Vector2(s, s);
    M.crag = mistMaterial(new THREE.MeshStandardMaterial({ ...cliffMaps(), roughness: 1, vertexColors: true, normalScale: N(1.7) }), MIST_NEAR);
    M.cragFar = mistMaterial(new THREE.MeshStandardMaterial({ map: M.crag.map, normalMap: M.crag.normalMap, roughness: 1, vertexColors: true, normalScale: N(1.7) }), MIST_FAR);
    // the floor: the weather changes this.M.floor, so the new one takes its place before the weather first looks
    M.floor = new THREE.MeshStandardMaterial({ ...pavingMaps(), roughness: 0.96, normalScale: N(1.15) });
    this.groundU = {
      uNoise: { value: makeNoise() }, uRock: { value: T.stone.map }, uRockN: { value: T.stone.normalMap }, uTime: { value: 0 },
      uTree: { value: TREES.map(([x, z]) => V3(x, z, 0)) }, uGap: { value: GAPS.map(([c, hw]) => V3(Math.sin(c), Math.cos(c), Math.cos(hw + 0.02))) },
    };
    plateauShader(M.floor, this.groundU);

    const nz = this.nz, NA = 160, flat = [0, 6, 11, 13.6, 14.9], outer = [0.25, 0.5, 0.75, 0.9, 1];
    const top = new THREE.Mesh(lattice(NA, flat.length + outer.length - 1, (a, j, o) => {
      let r = flat[j], y = 0;
      if (j >= flat.length) {
        const t = outer[j - flat.length], L = lipR(a) - 0.02;
        r = 14.9 + (L - 14.9) * t;
        // rough ground only where the rock goes on beyond the fence
        y = sstep(0.3, 1.0, L - 15.25) * sstep(15.3, 15.9, r) * (nz.fbm(Math.sin(a) * r * 0.5, 0, Math.cos(a) * r * 0.5, 2) * 0.5 - 0.17) - (t === 1 ? 0.13 : t > 0.8 ? 0.03 : 0);
      }
      o.x = Math.sin(a) * r; o.z = Math.cos(a) * r; o.y = y;
      o.u = o.x / 3.6; o.v = o.z / 3.6;
    }), M.floor);
    top.geometry.deleteAttribute('color');
    top.receiveShadow = true;
    scene.add(top);

    // ---- the faces: beds lying one on another, ribs and gullies, shelves; steep, but leaning out so that
    // looking down over the edge shows rock falling away into the cloud
    const R = rng(4100);
    const N1 = fbmField(256, 64, 5, 2, 4, 4101), RB = fbmField(256, 32, 11, 1, 3, 4102, 0.6);
    const beds = [];
    for (let d = 0.3; d < 13;) { const h = R.range(0.7, 1.7); beds.push([d, d + h, R.range(-0.24, 0.24)]); d += h; }
    const bedOff = (d) => { for (const b of beds) if (d >= b[0] && d < b[1]) return b[2]; return 0; };
    // shelves: [direction, half width, depth, how far out]. Pines stand on them.
    const shelves = this.shelves = [
      [60 * DEG, 0.2, 6.2, 2.0], [240 * DEG, 0.16, 5.0, 1.6], [8 * DEG, 0.1, 7.5, 1.5], [222 * DEG, 0.09, 8.5, 1.6], [75 * DEG, 0.08, 3.8, 1.2],
      [118 * DEG, 0.07, 2.2, 1.3], [300 * DEG, 0.07, 2.4, 1.3], [96 * DEG, 0.06, 3.0, 1.1], [332 * DEG, 0.07, 2.0, 1.2], [140 * DEG, 0.12, 9, 2.2], [275 * DEG, 0.12, 11, 2.4],
    ];
    const spireR = this.spireR = (a, d) => {
      const u = a / TAU, rib = 1 - Math.abs(samp(RB, 256, 32, u, d / 46) * 2 - 1);
      let r = lipR(a) - 0.1 + 0.2 * sstep(0, 0.4, d) + 0.15 * d
        + (rib - 0.5) * (0.5 + 0.045 * d) * sstep(0.1, 1.5, d)
        + (samp(N1, 256, 64, u, d / 46) - 0.5) * 1.7 * sstep(0.3, 4, d)
        + bedOff(d) * sstep(0.2, 1.0, d);
      for (const [sa, hw, sd, w] of shelves) { const k = win(a, sa, hw); if (k > 0) r += w * k * sstep(sd - 0.06, sd + 0.2, d); }
      return r;
    };
    let deps = [0.05, 0.2];
    for (const b of beds) deps.push(b[0] + 0.05, b[1] - 0.05);
    for (const s of shelves) deps.push(s[2] - 0.06, s[2] + 0.2);
    deps.push(14.5, 17, 21, 26, 33, 47);
    deps.sort((a, b) => a - b);
    deps = deps.filter((d, i) => i === 0 || d - deps[i - 1] > 0.09);
    const face = lattice(NA, deps.length - 1, (a, j, o, i) => {
      const d = deps[j], r = spireR(a, d), u = a / TAU;
      o.x = Math.sin(a) * r; o.z = Math.cos(a) * r; o.y = -d;
      o.u = (i / NA) * 16; o.v = -d / 5.8;
      const rib = 1 - Math.abs(samp(RB, 256, 32, u, d / 46) * 2 - 1);
      const k = (0.8 + 0.42 * samp(N1, 256, 64, u + 0.3, d / 30)) * (0.68 + 0.42 * rib) * (1 + 0.12 * sstep(3, 0, d));
      // (where the lip broke away in the west the rock is still fresh)
      const fresh = win(a, 240 * DEG, 0.2) * sstep(5, 0.5, d) * 0.22;
      o.r = k * 1.03 + fresh; o.g = k * 0.98 + fresh; o.b = k * 0.92 + fresh * 0.9;
    });
    greenTops(face, (x, y, z) => { const m = 0.55 + 0.5 * nz(x * 0.4, y * 0.4, z * 0.4), k = 0.5 + 0.5 * nz(x * 1.3, y * 1.3, z * 1.3); return [0.42 * m + 0.4 * (1 - k), 0.56 * m + 0.38 * (1 - k), 0.26 * m + 0.34 * (1 - k)]; }, 0.45, 0.85);
    scene.add(new THREE.Mesh(face, M.crag));
    this.buildClouds(scene);
  }

  // ---------------------------------------------------------------- the fence (tamagaki) on its kerb
  drawRim() {
    const R = rng(5200), H = RAIL_H, A = this.acc;
    const has = new Set(this.rail.map((a) => Math.round(a / STEP) % 36));
    const pl = (geo, a, r, y, yaw = 0) => put(geo, Math.sin(a) * r, y, Math.cos(a) * r, 0, a + yaw, 0);
    // vermilion that has stood in the weather: darker and dirtier towards the ground, each piece its own tone
    const red = (geo) => { const t = R.range(0.88, 1.06); A.red.push(tint(geo, (x, y) => { const k = t * (0.7 + 0.3 * sstep(0.2, 1.1, y)); return [k, k * 0.96, k * 0.96]; })); };
    const half = STEP * FENCE_R / 2;
    for (const a of this.rail) {
      const i = Math.round(a / STEP) % 36, endL = !has.has((i + 35) % 36), endR = !has.has((i + 1) % 36);
      // posts: at the left end and in the middle of every stretch (and at the right end where the fence stops)
      for (const t of endR ? [-0.5, 0, 0.5] : [-0.5, 0]) {
        const pa = a + t * STEP, main = t !== 0, w = main ? 0.15 : 0.11, h = main ? H - 0.06 : H - 0.2;
        const lean = (t === -0.5 && endL) || t === 0.5 ? R.range(0.03, 0.09) : R.range(-0.012, 0.012);       // the last post leans out over the drop
        const post = (main ? rbox(w, h - 0.2, w, 0.012, 1) : new THREE.BoxGeometry(w, h - 0.2, w)).translate(0, (h - 0.2) / 2, 0), cap = capGeo(w + 0.05, main ? 0.1 : 0.07).translate(0, h - 0.2, 0);
        const shoe = new THREE.BoxGeometry(w + 0.03, 0.09, w + 0.03).translate(0, 0.045, 0);
        for (const g of [post, cap, shoe]) pl(g.rotateX(lean), pa, FENCE_R, 0.2);
        red(post); A.black.push(cap, shoe);
      }
      for (const s of [-1, 1]) {
        const ma = a + s * STEP / 4, mr = FENCE_R * Math.cos(STEP / 4);
        // a sill on the kerb and two rails threaded through the posts
        red(pl(turnUV(new THREE.BoxGeometry(half + 0.02, 0.07, 0.09), 2, 1), ma, mr, 0.245));
        for (const y of [0.52, 1.0]) red(pl(turnUV(new THREE.BoxGeometry(half + 0.03, 0.085, 0.05), 2, 1), ma, mr, y + R.range(-0.004, 0.004)));
        // the pickets between
        for (let k = 1; k <= 7; k++) {
          const pa = a + s * (STEP / 2) * (k / 8), ph = 0.9 + R.range(-0.012, 0.012);
          red(pl(new THREE.BoxGeometry(0.042, ph, 0.042), pa, FENCE_R + 0.002, 0.28 + ph / 2));
        }
      }
      // the kerb: three stones to a stretch, none quite like the next
      for (const k of [-1, 0, 1]) {
        const kh = R.range(0.19, 0.215), kd = R.range(0.42, 0.5), end = (k === -1 && endL) || (k === 1 && endR);
        const g = scaleUV(rbox(STEP * FENCE_R / 3 - R.range(0.012, 0.03), kh, kd, 0.028, 1), 0.5, 0.25);
        if (end) g.rotateZ(R.range(-0.07, 0.07)).rotateY(R.range(-0.1, 0.1));
        A.stoneLow.push(tint(pl(g, a + k * STEP / 3, FENCE_R + R.range(-0.012, 0.012) + (end ? 0.05 : 0), kh / 2 - (end ? 0.02 : 0), R.range(-0.008, 0.008)), R.range(0.82, 1.05), R.range(0.82, 1.03), R.range(0.8, 1)));
      }
      // where the fence stops it has been torn off: the rails stand out splintered, and what came down lies about
      for (const dir of [endL ? -1 : 0, endR ? 1 : 0]) {
        if (!dir) continue;
        const ea = a + dir * STEP / 2;
        for (const y of [0.52, 1.0]) {
          const L = R.range(0.16, 0.5), droop = R.range(0.05, 0.3) * -dir;
          const stub = new THREE.BoxGeometry(L, 0.085, 0.05).translate(dir * L / 2, 0, 0);
          const tip = new THREE.ConeGeometry(0.036, 0.2, 4).rotateZ(-dir * Math.PI / 2).translate(dir * (L + 0.08), 0.012, 0);
          for (const g of [stub, tip]) red(pl(g.rotateZ(droop), ea + dir * 0.07 / FENCE_R, FENCE_R, y));
        }
        // a picket hanging from the lower rail, a rail and pickets on the ground, a kerb stone knocked out of line
        red(pl(new THREE.BoxGeometry(0.042, 0.7, 0.042).translate(0, -0.3, 0).rotateZ(dir * 0.5).rotateX(0.2), ea + dir * 0.28 / FENCE_R, FENCE_R, 0.55));
        const lie = (geo, da, r, yaw, y = 0.03) => red(pl(geo.rotateZ(R.range(-0.04, 0.04)), ea + dir * da / r, r, y, yaw));
        lie(new THREE.BoxGeometry(1.3, 0.085, 0.05), 0.85, 14.25, dir * R.range(0.3, 0.7));
        lie(new THREE.BoxGeometry(0.9, 0.042, 0.042), 0.55, 13.9, R.range(-1.2, 1.2));
        lie(new THREE.BoxGeometry(0.9, 0.042, 0.042), 1.3, 14.6, R.range(-1.2, 1.2));
        lie(new THREE.BoxGeometry(0.62, 0.042, 0.042), 1.05, 13.75, R.range(-1.2, 1.2));
        A.stone.push(tint(pl(scaleUV(rbox(0.8, 0.2, 0.44, 0.03, 1), 0.5, 0.25).rotateX(R.range(0.25, 0.5)).rotateY(R.range(-0.5, 0.5)), ea + dir * 0.62 / 14.7, 14.72, 0.1), 0.9, 0.9, 0.88));
      }
    }
  }

  // ---------------------------------------------------------------- beyond the rim
  drawScenery(scene) {
    const M = this.M, A = this.acc, R = rng(6100), nz = this.nz;

    // ---- the peaks that stand out of the cloud, each a cluster of pillars round a main one:
    // [direction°, distance, radius, height of the head, lesser pillars, what it carries]
    const PEAKS = [
      [60, 46, 6.5, 0.4, 3, 'gate'], [160, 72, 9, 5, 4, 'pagoda'], [0, 24.6, 3.0, -3.4, 0, 'stair'],
      [232, 80, 8, 15, 5], [218, 150, 16, 30, 4], [248, 36, 2.6, 4, 1], [176, 125, 12, 20, 4], [128, 42, 2.8, 8, 2], [104, 92, 10, 16, 4],
      [268, 56, 5.5, 9, 3], [300, 98, 12, 20, 5], [331, 62, 5, 11, 3], [24, 88, 10, 14, 4], [36, 48, 3.4, 9, 2], [82, 66, 5, 13, 3],
      [284, 134, 15, 26, 4], [138, 118, 11, 18, 4], [352, 126, 14, 22, 4], [200, 66, 3, 6, 1],
    ];
    const quarters = [[], [], [], []], firs = [], sites = {};
    PEAKS.forEach(([deg, dist, rad, top, sats, what], n) => {
      const cx = Math.sin(deg * DEG) * dist, cz = Math.cos(deg * DEG) * dist, q = quarters[Math.floor(((deg + 45) % 360) / 90)];
      const pillar = (px, pz, prad, ptop, main, seed) => {
        const yaw = R() * TAU, sx = R.range(1, main ? 1.5 : 1.3), far = dist > 100;
        const pk = peakGeo(seed, { rad: prad, top: ptop, sx, crown: main && what ? 0.08 : R.range(0.5, 1.2), NA: main ? (far ? 14 : 20) : (far ? 9 : 12), autumn: R.range(0.3, 0.6) });
        q.push(pk.geo.rotateY(yaw).translate(px, 0, pz));
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        /** A point on the head, given in the pillar's own frame, as a place in the world. */
        const at = (lx, lz) => V3(px + lx * cy + lz * sy, pk.capY(lx, lz), pz - lx * sy + lz * cy);
        if (main && what) sites[what] = { cx, cz, at, top };
        if (what === 'stair') return;
        // firs: a few on the head, one on each shoulder
        const size = Math.min(1.1, 0.34 + prad / 22) * (far ? 1.25 : 1);
        for (let k = 0, nf = main ? Math.min(4, Math.round(prad * 0.5)) : (prad > 3 ? 1 : 0); k < nf; k++) {
          const a = R() * TAU, f = main && what ? R.range(0.55, 0.85) : Math.sqrt(R()) * 0.6, lx = Math.sin(a) * f * prad * sx, lz = Math.cos(a) * f * prad, p = at(lx, lz);
          firs.push([p.x, p.y - 0.4, p.z, size * R.range(0.7, 1.1)]);
        }
        for (const [lx, ly, lz] of pk.ledges) if (ly > -3 && R() < 0.55) firs.push([px + lx * cy + lz * sy, ly - 0.3, pz - lx * sy + lz * cy, size * R.range(0.6, 1)]);
      };
      pillar(cx, cz, rad, top, true, 7000 + n * 31);
      for (let k = 0; k < sats; k++) {
        const a = R() * TAU, off = rad * R.range(0.9, 1.6), prad = rad * R.range(0.28, 0.55), tall = R() < 0.25 && !what;
        pillar(cx + Math.sin(a) * off, cz + Math.cos(a) * off, prad, top - (tall ? -0.15 : R.range(0.25, 0.75)) * Math.max(8, top + 12), false, 7000 + n * 31 + k + 1);
      }
    });
    for (const q of quarters) if (q.length) scene.add(new THREE.Mesh(mergeGeos(q, true), M.cragFar));
    const firM = mistMaterial(foliageMaterial(this.T.bough, { sway: '0.012 * length(position.xz) + 0.003 * position.y', through: 0.5, alphaTest: 0.5, roughness: 1, beyond: true }), MIST_FAR, 'foliage-mist');
    const firMesh = new THREE.InstancedMesh(firGeo(rng(78)), firM, firs.length);
    const c = new THREE.Color();
    firs.forEach(([x, y, z, s], i) => {
      place(firMesh, i, x, y, z, R.range(-0.04, 0.04), R() * 6.28, R.range(-0.04, 0.04), s * R.range(0.9, 1.15), s, s * R.range(0.9, 1.15));
      firMesh.setColorAt(i, c.setHSL(R.range(0.2, 0.34), R.range(0.15, 0.4), R.range(0.6, 0.9)).multiplyScalar(1.6));
    });
    scene.add(firMesh);

    // ---- far ranges, only shapes in the haze, and a great snow peak behind them
    const far = [];
    const range = (r0, r1, hMax, seed, base, crest, snowAt, NA = 150, NR = 5) => {
      const n1 = fbmField(512, 32, 7, 2, 6, seed, 0.55), n2 = fbmField(512, 32, 3, 1, 3, seed + 1);
      far.push(lattice(NA, NR, (a, j, o, i) => {
        const t = 1 - j / NR, px = Math.floor((i % NA) / NA * 512), py = Math.min(31, Math.floor(t * 31));
        const ridge = 1 - Math.abs(n1[py * 512 + px] * 2 - 1);
        const h = hMax * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.2 + 1.1 * ridge * ridge) * (0.35 + 1.2 * n2[py * 512 + px]) - 16;
        const r = r0 + (r1 - r0) * t;
        o.x = Math.sin(a) * r; o.z = Math.cos(a) * r; o.y = h;
        const k = sstep(-10, hMax * 0.8, h), sn = sstep(snowAt, snowAt + 7, h + (n2[py * 512 + px] - 0.5) * 10);
        o.r = base[0] + (crest[0] - base[0]) * k + sn; o.g = base[1] + (crest[1] - base[1]) * k + sn; o.b = base[2] + (crest[2] - base[2]) * k + sn;
      }));
    };
    range(150, 205, 46, 541, [0.2, 0.24, 0.3], [0.4, 0.4, 0.44], 30);
    range(108, 150, 26, 551, [0.16, 0.2, 0.2], [0.34, 0.33, 0.3], 60, 120, 4);
    scene.add(new THREE.Mesh(mergeGeos(far, true), mistMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), MIST_FAR)));

    // ---- the gate peak in the east, where the rope bridge went over: a torii, and the bridge's far posts
    {
      const S = sites.gate, inA = 240 * DEG, t = toriiGeos(0.62), p = S.at(0, 0);
      for (const g of t.red) A.redFar.push(g.rotateY(inA).translate(p.x, p.y - 0.1, p.z));
      for (const g of t.black) A.blackFar.push(g.rotateY(inA).translate(p.x, p.y - 0.1, p.z));
    }
    this.drawBridge(sites.gate);
    this.drawStair(sites.stair);
    this.drawPagoda(sites.pagoda);
    this.drawShrine();
    this.drawPines(scene);
  }

  /** The rope bridge to the gate peak, cut: its stakes stand low at the lip, and what is left of it hangs down the face. */
  drawBridge(site) {
    const A = this.acc, R = rng(6200), a0 = 60 * DEG;
    const ropeAt = [];
    for (const s of [-1, 1]) {
      const a = a0 + s * 0.058, x = Math.sin(a), z = Math.cos(a);
      // a short stake driven in askew, bound round with rope
      A.wood.push(put(new THREE.CylinderGeometry(0.06, 0.075, 0.62, 8), x * 14.72, 0.27, z * 14.72, 0.22 * z, 0, -0.22 * x));
      A.straw.push(put(new THREE.TorusGeometry(0.085, 0.022, 5, 10), x * 14.75, 0.4, z * 14.75, Math.PI / 2 + 0.22 * z, 0, -0.22 * x));
      const pts = [V3(x * 14.76, 0.4, z * 14.76), V3(x * 15.0, 0.06, z * 15.0), V3(x * 15.14, -0.25, z * 15.14)];
      for (const d of [1.2, 2.4, 3.6, 4.8, 6.0]) { const aa = a - s * 0.004 * d, r = this.spireR(aa, d) + 0.13; pts.push(V3(Math.sin(aa) * r, -d, Math.cos(aa) * r)); }
      A.straw.push(tube(pts, [0.036, 0.036], 5, { vScale: 3, steps: 22 }));
      ropeAt.push(pts);
    }
    // the planks that still hang between the two ropes, some askew, some gone
    for (let d = 0.9; d < 5.9; d += 0.36) {
      if (R() < 0.3) continue;
      const k = (d - 1.2) / 1.2 + 3, i0 = Math.max(2, Math.min(6, Math.floor(k))), f = Math.max(0, Math.min(1, k - i0));
      const p = ropeAt[0][i0].clone().lerp(ropeAt[0][i0 + 1], f).add(ropeAt[1][i0].clone().lerp(ropeAt[1][i0 + 1], f)).multiplyScalar(0.5);
      A.pale.push(turnUV(new THREE.BoxGeometry(1.75, 0.045, 0.24), 2, 1).rotateZ(R.range(-0.16, 0.16)).rotateX(Math.PI / 2 - 0.16 + R.range(-0.2, 0.2)).rotateY(a0).translate(p.x, p.y, p.z));
    }
    // over there: two tall posts at the brink with the rope ends blowing from them
    for (const s of [-1, 1]) {
      const p = site.at(s * 0.95, -5.6), q = site.at(s * 0.95, -6.4);
      A.wood.push(put(new THREE.CylinderGeometry(0.09, 0.11, 2.0, 8), p.x, p.y + 0.8, p.z));
      A.straw.push(tube([V3(p.x, p.y + 1.6, p.z), V3(q.x, p.y + 0.7, q.z), V3(q.x * 0.985, p.y - 1.6, q.z * 0.985), V3(q.x * 0.98, p.y - 4.5, q.z * 0.98)], [0.035, 0.035], 5, { vScale: 3, steps: 10 }));
    }
  }

  /**
   * The old way up came from the south. The rock that carried the stair has gone: two broken steps are
   * left at the lip, and out in the void a needle still holds a few steps and the gate they led through.
   */
  drawStair(site) {
    const A = this.acc, R = rng(6300);
    const slab = (key) => (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => A[key].push(tint(put(scaleUV(rbox(w, h, d, 0.03, 1), 0.6, 0.4), x, y, z, rx, ry, rz), R.range(0.85, 1.02), R.range(0.85, 1), R.range(0.82, 0.98)));
    const step = slab('stone'), far = slab('stoneFar');
    // at the lip (below it: the ground ends where the rock does): the first step, and what is left of the
    // second, cracked through and tipping
    step(1.9, 0.5, 0.34, 0.02, -0.46, 15.22, 0.02);
    step(1.05, 0.5, 0.36, -0.42, -0.7, 15.54, 0.1, 0.04, -0.03);
    step(0.66, 0.46, 0.34, 0.56, -0.8, 15.52, 0.24, -0.12, 0.1);
    // on the needle: the foot of the flight, climbing towards a plateau it no longer reaches
    const base = site.at(0, 0), y0 = base.y;
    for (let k = 0; k < 5; k++) far(1.8 + (k === 4 ? -0.5 : 0), 0.2 * (k + 1) + 0.5, 0.36, R.range(-0.03, 0.03) + (k === 4 ? 0.3 : 0), y0 - 0.5 + (0.2 * (k + 1) + 0.5) / 2, site.cz - 1.0 - k * 0.34, 0, R.range(-0.03, 0.03), k === 4 ? 0.06 : 0);
    const t = toriiGeos(0.6);
    for (const g of t.red) A.redFar.push(g.translate(0, y0 - 0.1, site.cz + 0.5));
    for (const g of t.black) A.blackFar.push(g.translate(0, y0 - 0.1, site.cz + 0.5));
  }

  /** A three-storey pagoda on its own peak. */
  drawPagoda(site) {
    const A = this.acc, yaw = 0.5;
    const plasterG = [], timber = [], tiles = [], gold = [];
    let y = 0;
    for (let i = 0; i < 3; i++) {
      const w = 4.6 - i * 0.8, hw = w / 2, last = i === 2;
      plasterG.push(put(new THREE.BoxGeometry(w, 2.2, w), 0, y + 1.1, 0));
      for (let s = 0; s < 4; s++) {
        const a = s * Math.PI / 2;
        for (const t of [-1, -0.33, 0.33, 1]) timber.push(put(new THREE.BoxGeometry(0.24, 2.2, 0.24), t * hw, y + 1.1, hw).rotateY(a));
        for (const yy of [0.12, 1.85, 2.1]) timber.push(put(turnUV(new THREE.BoxGeometry(w + 0.3, 0.18, 0.18), 2, 1), 0, y + yy, hw + 0.02).rotateY(a));
        if (i > 0) timber.push(put(turnUV(new THREE.BoxGeometry(w + 1.2, 0.08, 0.08), 2, 1), 0, y + 0.7, hw + 0.55).rotateY(a));
      }
      const top = last ? 0.08 : (w - 0.8) / 2 + 0.25, eave = hw + 1.35, rise = last ? 2.1 : 1.1, ry = y + 2.1 + rise;
      tiles.push(put(hipRoof(eave, top, rise, 0.5), 0, ry, 0));
      timber.push(put(hipRoof(eave - 0.02, top, rise, 0.5, true), 0, ry, 0));
      y += 3.0;
    }
    y += 1.2;
    gold.push(put(new THREE.CylinderGeometry(0.045, 0.1, 3.6, 6), 0, y + 1.6, 0), put(new THREE.SphereGeometry(0.36, 10, 6), 0, y - 0.05, 0, 0, 0, 0, 1, 0.6, 1), put(new THREE.SphereGeometry(0.14, 8, 6), 0, y + 3.45, 0));
    for (let k = 0; k < 6; k++) gold.push(put(new THREE.TorusGeometry(0.3 - k * 0.03, 0.03, 5, 12), 0, y + 0.7 + k * 0.4, 0, Math.PI / 2, 0, 0));
    const p = site.at(0, 0);
    const set = (list, key) => { for (const g of list) A[key].push(g.rotateY(yaw).translate(p.x, p.y - 0.15, p.z)); };
    set(plasterG, 'plasterFar'); set(timber, 'redFar'); set(tiles, 'blackFar'); set(gold, 'goldFar');
  }

  /** The little shrine (hokora) on the spur behind the fence: what the fence is there to keep apart. */
  drawShrine() {
    const A = this.acc, R = rng(6400), Z = -18.3;
    const stone = (g, k = 1) => A.stone.push(tint(g, k * R.range(0.86, 1.02), k * R.range(0.86, 1), k * R.range(0.82, 0.98)));
    // a podium of dressed blocks with a wider slab on top, and three steps up to it from the yard side
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) stone(put(scaleUV(rbox(1.02, 0.5, 1.22, 0.035, 1), 0.5, 0.5), sx * 1.03, 0.2, Z + sz * 0.62, 0, R.range(-0.012, 0.012), 0));
    stone(put(scaleUV(rbox(3.3, 0.14, 2.7, 0.03, 1), 1.2, 1), 0, 0.52, Z));
    for (let k = 0; k < 3; k++) stone(put(scaleUV(rbox(1.5, 0.17, 0.36, 0.03, 1), 0.6, 0.2), R.range(-0.02, 0.02), 0.44 - k * 0.17 - 0.085, Z + 1.52 + k * 0.33, 0, R.range(-0.015, 0.015), 0));
    const y0 = 0.59, W = 1.5, D = 1.25, Hh = 1.3;
    // the floor standing out as a gallery all round, the cell of white panels between red posts, doors of dark lattice
    A.pale.push(put(turnUV(rbox(2.3, 0.07, 2.0, 0.012, 1), 2, 1), 0, y0 + 0.2, Z));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      A.red.push(put(new THREE.CylinderGeometry(0.065, 0.065, Hh + 0.2, 10), sx * W / 2, y0 + (Hh + 0.2) / 2, Z + sz * D / 2));
      A.pale.push(put(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8), sx * 1.05, y0 + 0.1, Z + sz * 0.9));
    }
    for (const sz of [-1, 1]) for (const y of [0.3, Hh + 0.12]) A.red.push(put(turnUV(rbox(W + 0.3, 0.1, 0.1, 0.012, 1), 2, 1), 0, y0 + y, Z + sz * D / 2));
    for (const sx of [-1, 1]) for (const y of [0.3, Hh + 0.12]) A.red.push(put(turnUV(rbox(D + 0.3, 0.1, 0.1, 0.012, 1), 2, 1), sx * W / 2, y0 + y, Z, 0, Math.PI / 2, 0));
    A.plaster.push(put(new THREE.BoxGeometry(W - 0.06, Hh - 0.1, D - 0.06), 0, y0 + 0.3 + (Hh - 0.1) / 2, Z));
    A.wood.push(put(rbox(0.9, Hh - 0.3, 0.05, 0.01, 1), 0, y0 + 0.36 + (Hh - 0.3) / 2, Z + D / 2 + 0.005));
    for (let k = -3; k <= 3; k++) A.pale.push(put(new THREE.BoxGeometry(0.022, Hh - 0.36, 0.02), k * 0.125, y0 + 0.36 + (Hh - 0.3) / 2, Z + D / 2 + 0.04));
    for (let k = 0; k < 5; k++) A.pale.push(put(new THREE.BoxGeometry(0.88, 0.022, 0.02), 0, y0 + 0.5 + k * 0.2, Z + D / 2 + 0.042));
    A.gold.push(put(new THREE.BoxGeometry(0.035, 0.16, 0.03), 0, y0 + 0.85, Z + D / 2 + 0.055));
    // the roof: a long sweep down over the steps in front, a short one behind (nagare-zukuri), green with age
    const roofY = y0 + Hh + 0.2, rise = 0.95, halfF = 1.75, halfB = 1.05, ridgeX = 0.35, Zc = Z + 0.25, rz = Zc - ridgeX;
    const roof = bentBar([[-1.3, 0], [1.3, 0], [1.3, 0.1], [-1.3, 0.1]], halfF + halfB, 18, (x) => {
      const s = x - ridgeX, t = Math.min(1, s < 0 ? -s / halfF : s / halfB);
      return rise * Math.pow(1 - t, 1.55) - (s < 0 ? 0.12 * t : 0);
    });
    // (turned a quarter, the bar's length lies along z with its long front end towards the yard)
    A.copper.push(scaleUV(roof.rotateY(Math.PI / 2).translate(0, roofY, Zc), 1.6, 1.6));
    A.wood.push(put(turnUV(rbox(2.9, 0.14, 0.2, 0.02, 1), 3, 1), 0, roofY + rise + 0.13, rz));
    for (const x of [-0.9, 0, 0.9]) { A.wood.push(put(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), x, roofY + rise + 0.27, rz, Math.PI / 2, 0, 0)); for (const s of [-1, 1]) A.gold.push(put(new THREE.CylinderGeometry(0.073, 0.073, 0.03, 8), x, roofY + rise + 0.27, rz + s * 0.25, Math.PI / 2, 0, 0)); }
    for (const sx of [-1, 1]) for (const s of [-1, 1]) A.wood.push(put(rbox(0.06, 1.5, 0.1, 0.01, 1), sx * 1.33, roofY + rise + 0.3, rz, s * 0.72, 0, 0));
    // gable boards under the roof ends, the straw rope with its paper streamers across the front
    for (const sx of [-1, 1]) A.plaster.push(put(new THREE.BoxGeometry(0.04, 0.5, 0.9), sx * (W / 2 - 0.02), roofY + 0.3, Z - 0.1));
    const sag = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6 * 2 - 1; sag.push(V3(t * 0.82, y0 + Hh - 0.02 - 0.13 * (1 - t * t), Z + D / 2 + 0.13)); }
    A.straw.push(tube(sag, [0.022, 0.04, 0.05, 0.04, 0.022], 6, { vScale: 4, steps: 14 }));
    for (const t of [-0.5, 0, 0.5]) for (let k = 0; k < 3; k++) A.plaster.push(put(new THREE.BoxGeometry(0.06, 0.07, 0.006), t * 0.82 + (k % 2 ? 0.022 : -0.012), y0 + Hh - 0.1 - 0.13 * (1 - t * t) - k * 0.065, Z + D / 2 + 0.14, 0, 0, 0.1 * (k % 2 ? 1 : -1)));
  }

  /** Pines: on the shelves of the faces, at the rim where their heads show over the fence, one beside the shrine. */
  drawPines(scene) {
    const R = rng(6500), M = this.M, T = this.T;
    const needles = foliageMaterial(T.bough, { sway: '0.02', through: 0.3, alphaTest: 0.45, roughness: 1 });
    const set = (grow, shadows) => {
      const wood = [], C = new Cards();
      grow(wood, C);
      const a = new THREE.Mesh(mergeGeos(wood, true), M.bark), b = new THREE.Mesh(C.geo(), needles);
      if (shadows) { this.sh(a); this.sh(b); b.customDepthMaterial = foliageDepth(T.bough, 0.45); }
      scene.add(a, b);
    };
    set((wood, C) => {
      for (const [deg, d, s] of [[118, 2.2, 1.5], [300, 2.4, 1.45], [96, 3.0, 1.2], [332, 2.0, 1.35], [60, 6.2, 1.25], [240, 5.0, 1.2], [8, 7.5, 1.3], [222, 8.5, 1.5], [75, 3.8, 1.0], [140, 9, 1.6], [275, 11, 1.7]]) {
        const a = deg * DEG, r = this.spireR(a, d + 0.25) - 0.25;
        growPine(R, wood, C, V3(Math.sin(a) * r, -d, Math.cos(a) * r), a + R.range(-0.4, 0.4), s);
      }
    }, false);
    // (the two by the shrine stand against the sun: their shadows fall into the yard)
    set((wood, C) => { growPine(R, wood, C, V3(-3.5, 0.05, -17.6), 300 * DEG, 1.55); growPine(R, wood, C, V3(3.6, 0.0, -19.4), 150 * DEG, 1.1); }, true);
  }

  // ---------------------------------------------------------------- maples
  drawTrees(scene) {
    const M = this.M, R = rng(4343);
    const tex = mapleTexture();
    M.maple = foliageMaterial(tex, { sway: '0.03', through: 1.0, alphaTest: 0.36 });
    M.maple.emissive.set(0x3a0c04); M.maple.emissiveIntensity = 0.16;
    // crimson, flame orange, and one already turning to gold
    const hues = [[1.0, 0.5, 0.42], [1.0, 0.86, 0.6], [1.0, 1.0, 0.78]];
    const wood = [], pos = [], nor = [], uv = [], col = [], idx = [];
    const u = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3(), o = new THREE.Vector3();
    TREES.forEach(([x, z], t) => {
      const limbs = [], anchors = [], s = [1.08, 1.0, 1.12][t], hue = hues[t];
      growCherry(R, s, 4, limbs, anchors);
      const yaw = R() * 6.28, cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const l of limbs) wood.push(l.rotateY(yaw).translate(x, 0, z));
      let cx = 0, cyy = 0, cz = 0, rad = 0;
      for (const a of anchors) { const ax = a[0] * cy + a[2] * sy, az = -a[0] * sy + a[2] * cy; a[0] = ax + x; a[2] = az + z; cx += a[0]; cyy += a[1]; cz += a[2]; }
      cx /= anchors.length; cyy /= anchors.length; cz /= anchors.length;
      for (const a of anchors) rad = Math.max(rad, Math.hypot(a[0] - cx, a[1] - cyy, a[2] - cz));
      for (const a of anchors) {
        const d = Math.hypot(a[0] - cx, a[1] - cyy, a[2] - cz) / rad;
        const size = R.range(0.55, 0.92) * s, pale = R();
        const ao = (0.55 + 0.45 * sstep(0.15, 0.85, d)) * (0.8 + 0.2 * sstep(-0.6, 0.6, (a[1] - cyy) / rad));
        const cr = hue[0] * ao, cg = (hue[1] + 0.22 * pale) * ao, cb = (hue[2] + 0.1 * pale) * ao;
        for (let k = 0; k < 3; k++) {
          if (k < 2) { const an = R() * 3.14 + k * 1.57; u.set(Math.cos(an), R.range(-0.25, 0.25), Math.sin(an)).normalize(); v.set(R.range(-0.25, 0.25), 1, R.range(-0.25, 0.25)).normalize(); }
          else { const an = R() * 6.28; u.set(Math.cos(an), R.range(-0.3, 0.3), Math.sin(an)).normalize(); v.set(-Math.sin(an), R.range(-0.3, 0.3), Math.cos(an)).normalize(); }
          const base = pos.length / 3, h = size * 0.5;
          for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            o.set(a[0], a[1], a[2]).addScaledVector(u, su * h).addScaledVector(v, sv * h);
            pos.push(o.x, o.y, o.z);
            n.set(o.x - cx, (o.y - cyy) * 0.8 + rad * 0.45, o.z - cz).normalize();
            nor.push(n.x, n.y, n.z);
            uv.push(su * 0.5 + 0.5, sv * 0.5 + 0.5);
            col.push(cr, cg, cb);
          }
          idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const trunks = this.sh(new THREE.Mesh(mergeGeos(wood, true), M.bark)), leaves = this.sh(new THREE.Mesh(g, M.maple));
    leaves.customDepthMaterial = foliageDepth(tex, 0.36);
    scene.add(trunks, leaves);
  }

  // ---------------------------------------------------------------- what grows and lies along the rim
  drawVerge(scene) {
    const M = this.M, R = rng(919), spots = [];
    const open = (a, m = 0) => GAPS.some(([c, hw]) => angDiff(a, c) < hw + m);
    // grass: at the foot of the kerb, thick on the rough ground beyond the fence, a little in the joints of the bare rock
    for (let i = 0; i < 300; i++) { const a = R() * TAU; if (open(a, 0.03)) continue; spots.push([a, 14.3 - Math.pow(R(), 2) * 0.5, R.range(0.16, 0.36)]); }
    for (let i = 0; i < 520; i++) { const a = R() * TAU, L = lipR(a); if (L < 15.5) continue; spots.push([a, R.range(15.0, L - 0.12), R.range(0.25, 0.55)]); }
    for (let i = 0; i < 90; i++) { const a = R() * TAU, r = R.range(12.6, 13.9); if (open(a) && r > 13.3) continue; spots.push([a, r, R.range(0.1, 0.2)]); }
    for (const [x, z] of TREES) for (let i = 0; i < 12; i++) { const a = R() * 6.28, r = R.range(0.3, 0.7); spots.push([Math.atan2(x + Math.sin(a) * r, z + Math.cos(a) * r), Math.hypot(x + Math.sin(a) * r, z + Math.cos(a) * r), R.range(0.14, 0.28)]); }
    for (let i = 0; i < 26; i++) { const a = R() * 6.28, r = R.range(1.45, 1.9); const x = ROCK.x + 0.4 + Math.sin(a) * r * 1.25, z = ROCK.z + Math.cos(a) * r; spots.push([Math.atan2(x, z), Math.hypot(x, z), R.range(0.14, 0.3)]); }
    const tufts = new THREE.InstancedMesh(cardsGeo(3, false), M.tuft, spots.length);
    const c = new THREE.Color();
    spots.forEach(([a, r, s], i) => {
      const y = r > 15.3 ? -0.06 : -0.01;
      place(tufts, i, Math.sin(a) * r, y, Math.cos(a) * r, R.range(-0.12, 0.12), R() * 6.28, R.range(-0.12, 0.12), s * R.range(1, 1.6), s, s * R.range(1, 1.6));
      // the grass of a mountain in autumn: some of it still green, much of it gone to straw
      const dry = R();
      tufts.setColorAt(i, c.setHSL(dry > 0.55 ? R.range(0.1, 0.15) : R.range(0.17, 0.27), R.range(0.3, 0.55), R.range(0.5, 0.82)));
    });
    tufts.receiveShadow = true;
    scene.add(tufts);
    // loose stones: along the kerb, and thick where the rim has broken away
    const list = [];
    for (let i = 0; i < 46; i++) { const a = R() * TAU; if (open(a, 0.04)) continue; list.push([a, R.range(13.9, 14.28), Math.pow(R(), 2) * 0.16 + 0.05]); }
    for (const [c0, hw] of GAPS) for (let i = 0; i < 16; i++) {
      const edge = R() < 0.7, a = c0 + (edge ? (R() < 0.5 ? -1 : 1) * (hw - R() * 0.07) : R.range(-hw, hw));
      list.push([a, edge ? R.range(13.7, 14.95) : R.range(14.5, 14.98), Math.pow(R(), 2) * (edge ? 0.14 : 0.06) + 0.035]);
    }
    for (let i = 0; i < 40; i++) { const a = R() * TAU, L = lipR(a); if (L < 15.6) continue; list.push([a, R.range(15.3, L - 0.1), Math.pow(R(), 2) * 0.3 + 0.07]); }
    const rocks = new THREE.InstancedMesh(rockGeo(5, 1), M.stone, list.length);
    list.forEach(([a, r, s], i) => place(rocks, i, Math.sin(a) * r, s * 0.22, Math.cos(a) * r, R.range(-0.4, 0.4), R() * 6.28, R.range(-0.4, 0.4), s * R.range(0.9, 1.5), s * R.range(0.55, 0.9), s));
    rocks.receiveShadow = true;
    scene.add(rocks);
  }

  // ---------------------------------------------------------------- nobori on the rim
  drawBanners(scene) {
    const M = this.M, A = this.acc;
    const looks = [['#e9e2cf', '#a81c16'], ['#a81c16', '#efe6cf'], ['#232c4e', '#e9e2cf']].map(([bg, crest]) => new THREE.MeshStandardMaterial({ map: makeBannerTexture(bg, crest), side: THREE.DoubleSide, roughness: 0.95 }));
    const cloth = new THREE.PlaneGeometry(0.7, 2.8, 4, 12), cp = cloth.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i) + 0.35, y = cp.getY(i); cp.setZ(i, Math.sin(y * 2.6 + x * 3) * 0.035 * (0.3 + x * 2) + Math.sin(y * 5.1) * 0.012); }
    cloth.computeVertexNormals();
    const arm = new THREE.CylinderGeometry(0.014, 0.014, 0.78, 5).rotateZ(Math.PI / 2);
    // (they stand on the closed stretches, flanking the openings)
    [28, 92, 150, 210, 272, 332].forEach((deg, k) => {
      const a = deg * DEG, px = Math.sin(a) * 14.05, pz = Math.cos(a) * 14.05;
      A.wood.push(put(new THREE.CylinderGeometry(0.024, 0.032, 4.6, 8), px, 2.3, pz), put(new THREE.SphereGeometry(0.045, 8, 6), px, 4.63, pz), put(new THREE.CylinderGeometry(0.06, 0.075, 0.1, 8), px, 0.05, pz));
      const pivot = new THREE.Group();
      pivot.position.set(px, 4.5, pz);
      pivot.rotation.y = a + Math.PI / 2;
      const ban = new THREE.Mesh(cloth, looks[k % 3]);
      ban.position.set(0.39, -1.45, 0);
      ban.castShadow = true;
      const rod = new THREE.Mesh(arm, M.darkWood);
      rod.position.set(0.39, -0.04, 0);
      pivot.add(ban, rod);
      scene.add(pivot);
      this.banners.push({ pivot, base: a + Math.PI / 2, phase: rand(0, 10) });
    });
  }

  /** Everything gathered so far becomes one mesh per material. */
  flush(scene) {
    const M = this.M, A = this.acc;
    const red = M.vermilion.clone(); red.vertexColors = true; red.roughness = 0.78;
    const stone = M.stone.clone(); stone.vertexColors = true;
    const mats = {
      red, stone, black: M.tile, wood: M.darkWood, pale: M.wood, plaster: M.plaster, straw: M.straw,
      gold: new THREE.MeshStandardMaterial({ color: 0x9a7a34, metalness: 0.9, roughness: 0.4 }),
      copper: new THREE.MeshStandardMaterial({ color: 0x6f9c8a, metalness: 0.25, roughness: 0.75, normalMap: this.T.tile.normalMap, normalScale: new THREE.Vector2(0.8, 0.8) }),
    };
    for (const k in A) {
      if (!A[k].length) continue;
      // (what stands on the far peaks throws no shadow into the yard)
      // (and the kerb is too low for its shadow to be missed)
      const far = k.endsWith('Far'), low = k.endsWith('Low'), base = far || low ? k.slice(0, -3) : k;
      const m = new THREE.Mesh(mergeGeos(A[k], base === 'red' || base === 'stone'), mats[base]);
      if (low) m.receiveShadow = true; else if (!far) this.sh(m);
      scene.add(m);
      A[k] = [];
    }
  }

  // ---------------------------------------------------------------- the bell (bonshō) in its tower (shōrō)
  drawBell(scene) {
    const { x, z } = BELL, M = this.M, A = this.acc, HANG = 2.95;
    const P = (g, px, py, pz, ry = 0) => put(g, x + px, py, z + pz, 0, ry, 0);
    // a floor of dressed slabs, four posts on round footings, ties through them at two heights
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      A.stone.push(P(new THREE.CylinderGeometry(0.23, 0.29, 0.1, 14), sx * 1.15, 0.07, sz * 1.15));
      A.wood.push(P(rbox(0.26, 3.3, 0.26, 0.022, 1), sx * 1.15, 1.75, sz * 1.15));
      A.wood.push(P(rbox(0.4, 0.15, 0.4, 0.03, 1), sx * 1.15, 3.47, sz * 1.15));
      A.gold.push(P(new THREE.BoxGeometry(0.275, 0.1, 0.275), sx * 1.15, 0.22, sz * 1.15));          // (a metal shoe round the foot of each post)
    }
    for (const turn of [0, 1]) for (const s of [-1, 1]) {
      const beam = (len, h, w, y, off = 1.15) => A.wood.push(P(turnUV(rbox(len, h, w, 0.015, 1), 3, 1), turn ? s * off : 0, y, turn ? 0 : s * off, turn ? Math.PI / 2 : 0));
      beam(2.9, 0.18, 0.11, 2.6);
      beam(3.0, 0.24, 0.15, 3.22);
      beam(3.5, 0.2, 0.22, 3.64);
    }
    A.wood.push(P(turnUV(rbox(2.5, 0.26, 0.22, 0.02, 1), 3, 1), 0, HANG + 0.13, 0));       // the beam the bell hangs from
    // the roof: tiles swept up at the corners, boarded underneath, with a jewel on top
    const eave = 2.15, rise = 1.3, lift = 0.45, ry = 3.72 + rise;
    A.black.push(P(hipRoof(eave, 0.14, rise, lift), 0, ry, 0));
    A.wood.push(P(hipRoof(eave - 0.03, 0.14, rise, lift, true), 0, ry, 0));
    // (the edge of the eaves: a board closing the gap between the tiles and the boarding)
    {
      const pos = [], uv = [], idx = [], SEG = 8;
      for (let side = 0; side < 4; side++) {
        const ca = Math.cos(side * Math.PI / 2), sa = Math.sin(side * Math.PI / 2), base = pos.length / 3;
        for (let i = 0; i <= SEG; i++) {
          const s = (i / SEG) * 2 - 1, px = s * eave, y = -rise + lift * Math.pow(Math.abs(s), 3);
          for (const dy of [0.01, -0.17]) { pos.push(px * ca + eave * sa, y + dy, -px * sa + eave * ca); uv.push(px, dy * 3); }
        }
        for (let i = 0; i < SEG; i++) { const p = base + i * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      A.wood.push(P(g, 0, ry, 0));
    }
    // rafters showing under the eaves
    for (let side = 0; side < 4; side++) for (let k = -4; k <= 4; k++) {
      const s = k / 5.6, g = new THREE.BoxGeometry(0.07, 0.07, 1.05).rotateX(0.42).translate(s * eave * 0.92, -rise + 0.1 + lift * Math.pow(Math.abs(s), 3) * 0.6, eave - 0.62).rotateY(side * Math.PI / 2);
      A.wood.push(P(g, 0, ry, 0));
    }
    A.gold.push(P(new THREE.CylinderGeometry(0.17, 0.24, 0.16, 4).rotateY(Math.PI / 4), 0, ry + 0.06, 0), P(new THREE.SphereGeometry(0.15, 12, 8), 0, ry + 0.25, 0, 0), P(new THREE.ConeGeometry(0.07, 0.2, 8), 0, ry + 0.45, 0));
    this.flush(scene);

    // ---- the bell: turned on a lathe, three raised bands and four upright ones, the fields of bosses
    // (chi) under the shoulder, the two lotus seats where it is struck, the dragon loop it hangs by
    const Y0 = BELL.y - 1.15 / 2 - HANG;                       // its lip, seen from where it hangs
    const prof = [[0.5, 0.0], [0.585, 0.0], [0.618, 0.02], [0.622, 0.06], [0.602, 0.1], [0.59, 0.16], [0.598, 0.2], [0.598, 0.25], [0.582, 0.275],
      [0.566, 0.45], [0.577, 0.48], [0.577, 0.53], [0.556, 0.555], [0.536, 0.76], [0.547, 0.84], [0.547, 0.885], [0.526, 0.905],
      [0.5, 0.985], [0.445, 1.07], [0.34, 1.125], [0.18, 1.148], [0, 1.15]];
    const bodyR = (y) => 0.59 - (0.59 - 0.524) * (y - 0.16) / 0.745;
    const parts = [new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40)];
    parts.push(new THREE.CylinderGeometry(0.45, 0.5, 0.9, 24, 1, true).translate(0, 0.45, 0).scale(-1, 1, 1));       // the inside, seen from below
    const slope = (0.59 - 0.524) / 0.745;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      // upright bands
      parts.push(rbox(0.07, 0.62, 0.02, 0.006, 1).rotateX(-slope).translate(0, 0.59, bodyR(0.59) + 0.002).rotateY(a));
      // sixteen bosses to a field
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const y = 0.61 + j * 0.06, aa = a + Math.PI / 4 + (i - 1.5) * 0.15;
        parts.push(new THREE.SphereGeometry(0.019, 5, 3).translate(0, y, bodyR(y) + 0.004).rotateY(aa));
      }
    }
    for (const a of [0, Math.PI]) {
      parts.push(new THREE.SphereGeometry(0.085, 14, 8).scale(1, 1, 0.3).translate(0, 0.37, bodyR(0.37)).rotateY(a + Math.PI / 2));
      parts.push(new THREE.TorusGeometry(0.105, 0.016, 6, 20).translate(0, 0.37, bodyR(0.37) + 0.004).rotateY(a + Math.PI / 2));
      for (let p = 0; p < 8; p++) parts.push(new THREE.SphereGeometry(0.03, 6, 4).scale(1, 1, 0.4).translate(Math.cos(p * Math.PI / 4) * 0.105, 0.37 + Math.sin(p * Math.PI / 4) * 0.105, bodyR(0.37) + 0.012).rotateY(a + Math.PI / 2));
    }
    parts.push(new THREE.TorusGeometry(0.1, 0.034, 8, 16, Math.PI).translate(0, 1.14, 0));
    for (const s of [-1, 1]) parts.push(new THREE.SphereGeometry(0.05, 8, 6).scale(1.3, 0.8, 1).translate(s * 0.115, 1.165, 0));
    const nz = this.nz;
    const bronze = tint(mergeGeos(parts), (px, py, pz) => {
      // verdigris where the rain runs and stands: under the bands, on the shoulder, in streaks down the waist
      const n = nz.fbm(px * 5, py * 2.2, pz * 5, 3), g = Math.min(1, sstep(0.52, 0.7, n) * 0.75 + sstep(0.9, 1.1, py) * 0.5);
      return [0.86 - 0.5 * g, 0.8 - 0.1 * g, 0.66 + 0.1 * g];
    }).translate(0, Y0, 0);
    // the iron hanger: a hook through the loop, a strap over the beam
    const iron = [new THREE.TorusGeometry(0.075, 0.02, 6, 14).translate(0, Y0 + 1.3, 0).rotateY(Math.PI / 2)];
    iron.push(new THREE.CylinderGeometry(0.022, 0.022, -Y0 - 1.36, 6).translate(0, (Y0 + 1.36) / 2, 0));
    iron.push(new THREE.BoxGeometry(0.1, 0.3, 0.26).translate(0, 0.14, 0));
    const pivot = new THREE.Group();
    pivot.position.set(x, HANG, z);
    const bell = new THREE.Mesh(bronze, new THREE.MeshStandardMaterial({ color: 0xb09a68, metalness: 0.6, roughness: 0.5, emissive: 0x171208, vertexColors: true, normalMap: this.T.stone.normalMap, normalScale: new THREE.Vector2(0.25, 0.25) }));
    bell.receiveShadow = true;             // (it hangs in the shade of its own roof: a shadow of its own would not show)
    pivot.add(bell, new THREE.Mesh(mergeGeos(iron), M.iron));
    scene.add(pivot);
    return pivot;
  }

  // ---------------------------------------------------------------- the boulder (a sacred rock, roped round)
  drawRock(scene) {
    const R = ROCK, M = this.M, nz = this.nz, D = rng(8100);
    const parts = [
      torGeo(nz, 811, R.w, R.top, R.w, [0.95, 1.9]).translate(R.x, 0, R.z),
      torGeo(nz, 823, R.step.w + 0.14, R.step.top, R.step.d, [0.5]).translate(R.x + R.step.dx - 0.07, 0, R.z),
    ];
    const rock = this.sh(new THREE.Mesh(mergeGeos(parts, true), new THREE.MeshStandardMaterial({ ...this.T.stone, color: 0xb4b2ad, roughness: 1, vertexColors: true, normalScale: new THREE.Vector2(0.8, 0.8) })));
    // smaller stones against its foot
    const small = [];
    for (const [dx, dz, s] of [[-1.5, 0.7, 0.34], [-1.42, -0.5, 0.22], [0.2, -1.5, 0.3], [-0.8, 1.5, 0.26], [1.0, 1.42, 0.2], [2.5, 0.55, 0.2], [2.45, -0.5, 0.15], [1.7, -1.0, 0.2]]) {
      small.push(put(rockGeo(830 + small.length, 2), R.x + dx, s * 0.3, R.z + dz, D.range(-0.3, 0.3), D() * 6.28, D.range(-0.3, 0.3), s * D.range(1, 1.4), s * 0.75, s));
    }
    const stones = this.sh(new THREE.Mesh(mergeGeos(small), M.stone));
    // the rope (shimenawa) with its paper streamers and straw tassels
    const y = 2.25, pts = [], straw = [], paper = [];
    const hold = (a) => { const c = Math.cos(a), s = Math.sin(a), n = 5; return (R.w / 2 + 0.03) / Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(s), n), 1 / n); };
    for (let i = 0; i <= 28; i++) { const a = (i / 28) * TAU + 0.6, r = hold(a); pts.push(V3(R.x + Math.cos(a) * r, y + 0.05 * Math.sin(a * 3 + 1), R.z + Math.sin(a) * r)); }
    straw.push(tube(pts, [0.05, 0.05], 7, { vScale: 3, steps: 84 }));
    for (let i = 1; i < 28; i += 3) {
      const p = pts[i], a = (i / 28) * TAU + 0.6, ox = Math.cos(a) * 0.055, oz = Math.sin(a) * 0.055, ry = -a + Math.PI / 2;
      if (i % 2) for (let k = 0; k < 3; k++) paper.push(put(new THREE.BoxGeometry(0.1, 0.11, 0.008), p.x + ox + (k % 2 ? 0.03 : -0.02) * Math.sin(a), p.y - 0.11 - k * 0.1, p.z + oz - (k % 2 ? 0.03 : -0.02) * Math.cos(a), 0, ry, 0.12 * (k % 2 ? 1 : -1)));
      else straw.push(put(new THREE.ConeGeometry(0.05, 0.3, 7), p.x + ox, p.y - 0.19, p.z + oz, Math.PI, 0, 0));
    }
    scene.add(rock, stones, this.sh(new THREE.Mesh(mergeGeos(straw), M.straw)), this.sh(new THREE.Mesh(mergeGeos(paper), M.plaster)));
  }

  // ---------------------------------------------------------------- what drifts through the air
  /** Maple leaves instead of petals. */
  buildPetals(scene) {
    super.buildPetals(scene);
    const shape = new THREE.Shape(), lobes = [[-1.9, 0.6], [-0.95, 0.92], [0, 1.08], [0.95, 0.92], [1.9, 0.6]], r = 0.05;
    shape.moveTo(0, -0.012);
    for (const [a, l] of lobes) {
      shape.lineTo(Math.sin(a - 0.47) * r * 0.32, Math.cos(a - 0.47) * r * 0.32);
      shape.lineTo(Math.sin(a) * r * l, Math.cos(a) * r * l);
    }
    this.petalMesh.geometry.dispose();
    this.petalMesh.geometry = new THREE.ShapeGeometry(shape);
    this.petalMesh.material.emissive.set(0x3a0e04);
    const c = new THREE.Color();
    for (let i = 0; i < this.petalN; i++) this.petalMesh.setColorAt(i, c.setHSL(rand(0.0, 0.11), rand(0.75, 0.95), rand(0.36, 0.54)));
    this.petalMesh.instanceColor.needsUpdate = true;
  }

  /** By day only motes of dust in the sun; at night they are fireflies as in the yard. */
  buildFireflies(scene) {
    super.buildFireflies(scene);
    this.flies.material.color.set(0x6a5c44);
    this.flies.material.size = 0.045;
  }

  update(dt) {
    super.update(dt);
    const U = this.cloudU, g = this.game;
    if (!U) return;
    U.uTime.value = this.time;
    // the cloud takes its light from the same sun and sky as everything else, whatever the weather
    U.uSun.value.copy(this.sunLight.color).multiplyScalar(this.sunLight.intensity / Math.PI);
    U.uSky.value.copy(this.hemi.color).multiplyScalar(this.hemi.intensity / Math.PI);
    MIST_COL.copy(U.uSun.value).multiplyScalar(0.3).add(_c.copy(U.uSky.value).multiplyScalar(0.95));
    this.sky.material.uniforms.haze.value.copy(g.scene.fog.color);
    const night = g.weather?.key === 'night';
    if (night !== this._night) {
      this._night = night;
      this.flies.material.color.set(night ? 0xe6ff8a : 0x6a5c44);
      this.flies.material.size = night ? 0.11 : 0.045;
    }
  }
}
