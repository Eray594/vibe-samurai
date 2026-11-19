// The courtyard: a walled dōjō yard at dusk. Raked gravel, plaster walls with tiled copings, stone
// lanterns, cherry trees shedding petals, a torii and a pagoda beyond the wall, straw mats to cut.
// All of it is built here from code: textures are baked on canvases (envkit.js), the trees grow
// from a branching rule, and what never moves is merged into a handful of meshes.
import * as THREE from 'three';
import { mergeStatic } from './perf.js';
import * as CANNON from 'cannon-es';
import { materials, setGroup, rand, snapPrev, syncMesh } from './physics.js';
import { buildWeaponModel, WEAPONS, WEAPON_ORDER } from './weapons.js';
import { Breakables } from './breakables.js';
import {
  rng, sstep, fbmField, bake, tiled, gravelMaps, woodMaps, plankMaps, barkMaps, plasterMaps, stoneMaps, ashlarMaps, tileMaps, strawMaps,
  blossomTexture, boughTexture, grassTexture, bambooLeafTexture, rbox, put, tint, turnUV, scaleUV, mergeGeos, tube, sweep, orient, rockGeo,
  foliageUniforms, foliageMaterial, foliageDepth, beyondWall,
} from './envkit.js';

export const ARENA_R = 13.2;       // walkable radius
export const WALL_R = 14.8;
export const SUN_DIR = new THREE.Vector3(-0.38, 0.17, -1).normalize();

// ------------------------------------------------------------------ procedural textures
/** Rolled tatami: woven straw with binding cords. */
export function makeStraw() {
  const W = 128, H = 512;
  const fib = fbmField(W, H, 2, 128, 2, 201), blot = fbmField(W, H, 4, 8, 3, 202);
  return bake(W, H, (x, y, o) => {
    const i = y * W + x;
    let k = 0.66 + 0.36 * fib[i] + 0.18 * (blot[i] - 0.5), h = fib[i];
    let r = 205, g = 184, b = 122;
    for (const cy of [60, 200, 340, 472]) {                          // the cords it is tied with
      const d = Math.abs(y - cy);
      if (d < 6) { const t = Math.sin((x * 0.5 + y * 0.9)) * 0.5 + 0.5; r = 104; g = 84; b = 50; k = 0.6 + 0.4 * t; h = 1.4 - d * 0.06; }
    }
    o[0] = r * k; o[1] = g * k; o[2] = b * k; o[3] = h;
  }, { bump: 2.5 });
}

/** A green bamboo culm: nodes every quarter of the picture. */
export function makeBamboo() {
  const W = 64, H = 256, str = fbmField(W, H, 16, 1, 2, 211);
  return bake(W, H, (x, y, o) => {
    const i = y * W + x, s = (y / H * 4) % 1, d = Math.min(s, 1 - s) * (H / 4);        // px to the nearest node
    let k = 0.82 + 0.3 * str[i], h = 0.5;
    if (d < 2) { k *= 0.45; h = 0.2; } else if (d < 5) { k *= 1.25; h = 0.9; }
    else k *= 1 - 0.12 * Math.exp(-(d - 5) * 0.12);
    o[0] = 150 * k; o[1] = 186 * k; o[2] = 86 * k; o[3] = h;
  }, { bump: 3 });
}

/** Moss and trodden grass for the ground beyond the wall. */
export function makeTurf() {
  const S = 256, a = fbmField(S, S, 6, 6, 5, 221), b = fbmField(S, S, 64, 64, 2, 222);
  return bake(S, S, (x, y, o) => {
    const i = y * S + x, k = 0.6 + 0.5 * a[i] + 0.3 * (b[i] - 0.5), dry = sstep(0.55, 0.75, a[i]);
    o[0] = (62 + 50 * dry) * k; o[1] = (88 + 14 * dry) * k; o[2] = (42 + 8 * dry) * k; o[3] = b[i];
  }, { bump: 2, repeat: [140, 140] });
}

/** Three unrelated smooth noises in one tileable picture: the ground shader reads its large patterns from it. */
export function makeNoise() {
  const S = 256, a = fbmField(S, S, 4, 4, 5, 231), b = fbmField(S, S, 5, 5, 5, 232), c2 = fbmField(S, S, 7, 7, 4, 233);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { img.data[i * 4] = a[i] * 255; img.data[i * 4 + 1] = b[i] * 255; img.data[i * 4 + 2] = c2[i] * 255; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Tall nobori banner with a simple crest (mon), on woven cloth. */
export function makeBannerTexture(color, crest) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 512);
  g.fillStyle = crest;
  g.strokeStyle = crest;
  g.lineWidth = 9;
  g.beginPath(); g.arc(64, 122, 40, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
    g.beginPath(); g.arc(64 + Math.cos(a) * 17, 122 + Math.sin(a) * 17, 11, 0, Math.PI * 2); g.fill();
  }
  g.fillRect(27, 254, 74, 12);
  g.fillRect(27, 286, 74, 12);
  g.fillRect(27, 318, 74, 12);
  // the weave, a few creases and the sewn-on loops along the pole side
  for (let y = 0; y < 512; y += 2) { g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`; g.fillRect(0, y, 128, 1); }
  for (let x = 0; x < 128; x += 2) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(x, 0, 1, 512); }
  for (let i = 0; i < 7; i++) { const y = 30 + i * 70 + Math.random() * 20; const gr = g.createLinearGradient(0, y - 8, 0, y + 8); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.13)'); gr.addColorStop(1, 'rgba(255,255,255,0.04)'); g.fillStyle = gr; g.fillRect(0, y - 8, 128, 16); }
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, 4, 512); g.fillRect(0, 0, 128, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export const SKY = {
  uniforms: { sunDir: { value: SUN_DIR }, dim: { value: 1 }, sat: { value: 1 }, stars: { value: 0 }, time: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 sunDir; uniform float dim, sat, stars, time; varying vec3 vDir;
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
      // the vault: ember at the horizon, rose above it, violet, then night blue overhead
      vec3 c = mix(vec3(1.0, 0.50, 0.20), vec3(0.66, 0.29, 0.33), smoothstep(0.0, 0.17, h));
      c = mix(c, vec3(0.24, 0.17, 0.38), smoothstep(0.10, 0.42, h));
      c = mix(c, vec3(0.05, 0.06, 0.16), smoothstep(0.34, 0.95, h));
      // the sky opposite the sun is cooler and darker
      c *= mix(vec3(0.62, 0.66, 0.86), vec3(1.0), smoothstep(-0.6, 0.7, dot(normalize(d.xz + 1e-5), normalize(sunDir.xz))));
      // haze lying on the horizon, glowing where the sun is
      c = mix(c, vec3(1.0, 0.62, 0.36), exp(-max(h, 0.0) * 11.0) * (0.12 + 0.5 * pow(s, 3.0)));
      c += vec3(1.0, 0.45, 0.15) * pow(s, 10.0) * 0.5;
      c += vec3(1.0, 0.75, 0.45) * pow(s, 90.0) * 1.1;
      // clouds on a flat layer high above: lit gold and pink from below on the sun's side, slate where thick
      float thr = mix(0.26, 0.5, smoothstep(0.2, 1.0, sat));
      vec2 uv = d.xz / (max(h, 0.0) + 0.16);
      float n = fbm(uv * vec2(0.9, 1.5) + vec2(time * 0.008, 0.0)) + 0.3 * fbm(uv * 3.3 - vec2(time * 0.005, 3.0)) - 0.15;
      float dens = smoothstep(thr, thr + 0.24, n) * smoothstep(0.0, 0.1, h);
      float thick = smoothstep(thr + 0.08, thr + 0.42, n);
      vec3 lit = mix(vec3(0.92, 0.46, 0.44), vec3(1.6, 0.86, 0.42), pow(s, 2.5));
      lit = mix(lit, vec3(0.42, 0.32, 0.5), smoothstep(0.1, 0.7, h));
      vec3 cl = mix(lit, vec3(0.2, 0.16, 0.28), thick * 0.75);
      c = mix(c, cl, dens * 0.9);
      c += vec3(2.4, 1.5, 0.8) * smoothstep(0.9988, 0.9992, s) * (1.0 - dens * 0.7);
      c = mix(c, vec3(0.05, 0.045, 0.07), smoothstep(0.0, -0.08, h));
      c = mix(vec3(dot(c, vec3(0.3, 0.5, 0.2))), c, sat) * dim;
      if (stars > 0.0) {
        vec3 sq = d * 150.0, g = floor(sq);
        float sn = fract(sin(dot(g, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float clear = 1.0 - dens * 0.9;
        // round points of different sizes that twinkle, not lit cells
        float pt = smoothstep(0.42 * (0.4 + fract(sn * 91.7)), 0.0, length(fract(sq) - 0.5));
        float tw = 0.75 + 0.25 * sin(time * (1.5 + fract(sn * 37.3) * 3.0) + sn * 600.0);
        c += mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), fract(sn * 13.1)) * step(0.992, sn) * pt * tw * 1.6 * stars * smoothstep(0.02, 0.3, h) * clear;
        float m = max(dot(d, normalize(vec3(0.45, 0.5, 0.74))), 0.0);
        c += vec3(0.9, 0.93, 1.0) * (smoothstep(0.9982, 0.9987, m) + pow(m, 60.0) * 0.25) * stars * (0.35 + 0.65 * clear);
        c += vec3(0.5, 0.56, 0.75) * dens * (1.0 - thick) * pow(m, 6.0) * 0.12 * stars;       // moonlit cloud edges
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * The gravel reads its fine grain from the tiled texture; this adds what does not repeat: rake
 * lines (straight, and in rings round the trees), large soft blotches, moss creeping in from
 * the wall, and in the rain a wet sheen with standing puddles.
 */
export function groundShader(mat, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vGp = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGp; uniform sampler2D uNoise; uniform vec3 uRing[4]; uniform float uTime;')
      .replace('#include <map_fragment>', `
        float gR = length(vGp);
        vec4 gN = texture2D(uNoise, vGp * 0.031);
        vec4 gN2 = texture2D(uNoise, vGp * 0.13 + 0.37);
        float gWet = 1.0 - smoothstep(0.3, 0.9, roughness);
        vec2 gDir = normalize(vec2(0.0875 * cos(vGp.x * 0.35), 1.0));
        float gPh = vGp.y + 0.25 * sin(vGp.x * 0.35);
        float gAmp = 1.0, gTree = 9.0;
        for (int i = 0; i < 4; i++) {
          vec2 dd = vGp - uRing[i].xy; float dl = length(dd), rr = uRing[i].z;
          if (dl < rr) { gPh = dl; gDir = dd / max(dl, 0.001); }
          gAmp *= smoothstep(0.0, 0.16, abs(dl - rr)) * smoothstep(0.7, 1.0, dl);
          gTree = min(gTree, dl);
        }
        gPh *= 6.2832 / 0.115;
        gAmp *= 1.0 - smoothstep(0.45, 1.3, fwidth(gPh));                       // too fine to draw far away: fade out
        gAmp *= 1.0 - smoothstep(11.9, 12.8, gR);
        gAmp *= max(smoothstep(0.75, 1.15, abs(vGp.x)), smoothstep(3.7, 4.3, vGp.y));   // the path of stepping stones is trodden flat
        gAmp *= 0.35 + 0.65 * smoothstep(0.34, 0.56, gN2.r);                    // scuffed in places
        float gS = sin(gPh), gC = cos(gPh);
        #include <map_fragment>
        diffuseColor.rgb *= 0.8 + 0.42 * gN.r;
        diffuseColor.rgb *= 1.0 - 0.13 * gAmp * (0.5 - 0.5 * gS);
        float gMoss = max(smoothstep(12.5, 14.1, gR + (gN2.g - 0.5) * 2.6), 1.0 - smoothstep(0.3, 0.95, gTree + (gN2.b - 0.5) * 0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * vec3(0.17, 0.2, 0.07) * (0.55 + gN2.b), gMoss * 0.92);
        float gPud = gWet * smoothstep(0.5, 0.58, gN.g + (gN2.r - 0.5) * 0.12) * (1.0 - gMoss);
        diffuseColor.rgb *= mix(1.0, 0.72, gWet) * mix(1.0, 0.55, gPud);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 1.0, gMoss * (1.0 - gWet * 0.5));
        roughnessFactor = mix(roughnessFactor, mix(0.5, 0.04, gPud), gWet);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(-gC * gDir.x, 0.0, -gC * gDir.y, 0.0)).xyz * (0.45 * gAmp * (1.0 - 0.65 * gWet)));
        if (gPud > 0.0) {
          vec2 rip = texture2D(uNoise, vGp * 2.3 + uTime * vec2(0.13, 0.09)).rg + texture2D(uNoise, vGp * 3.1 - uTime * vec2(0.08, 0.15)).gb - 1.0;
          vec3 flat_ = (viewMatrix * vec4(rip.x * 0.12, 1.0, rip.y * 0.12, 0.0)).xyz;
          normal = normalize(mix(normal, flat_, gPud));
        }`);
  };
}

// ------------------------------------------------------------------ shapes
/**
 * A beam along x with the given cross-section ([z, y] corners), lifted by `bend(x)`: the curved
 * lintels of the torii. Hard edges between the faces, as planed timber has.
 */
export function bentBar(profile, len, nseg, bend) {
  const pos = [], uv = [], idx = [], m = profile.length;
  let acc = 0;
  for (let k = 0; k < m; k++) {
    const a = profile[k], b = profile[(k + 1) % m], base = pos.length / 3, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let i = 0; i <= nseg; i++) {
      const x = (i / nseg - 0.5) * len, dy = bend(x);
      pos.push(x, a[1] + dy, a[0], x, b[1] + dy, b[0]);
      uv.push(acc, x * 0.4, acc + l, x * 0.4);
    }
    for (let i = 0; i < nseg; i++) { const p = base + i * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
    acc += l;
  }
  for (const sg of [-1, 1]) {
    const base = pos.length / 3, x = sg * len / 2, dy = bend(x);
    for (let k = 0; k < m; k++) { pos.push(x, profile[k][1] + dy, profile[k][0]); uv.push(profile[k][0], profile[k][1]); }
    for (let k = 1; k < m - 1; k++) idx.push(base, base + k, base + k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  let cy = 0, cz = 0;
  for (const p of profile) { cz += p[0] / m; cy += p[1] / m; }
  return orient(g, (c, w) => { if (Math.abs(c.x) > len / 2 - 1e-3) w.set(Math.sign(c.x), 0, 0); else w.set(0, c.y - cy - bend(c.x), c.z - cz); });
}

/**
 * A pagoda roof: four curved faces falling from a small square at the top to wide eaves, the
 * corners swept upwards. y = 0 is the top. With `under`, the same surface seen from below.
 */
export function hipRoof(eave, top, rise, lift, under = false, segs = 8, rows = 5) {
  const pos = [], uv = [], idx = [];
  for (let side = 0; side < 4; side++) {
    const base = pos.length / 3, ca = Math.cos(side * Math.PI / 2), sa = Math.sin(side * Math.PI / 2);
    for (let j = 0; j <= rows; j++) {
      const t = j / rows, hw = top + (eave - top) * t;
      for (let i = 0; i <= segs; i++) {
        const s = (i / segs) * 2 - 1, x = s * hw, z = hw;
        const y = -rise * (1 - Math.pow(1 - t, 1.9)) + lift * Math.pow(Math.abs(s), 3) * t * t - (under ? 0.06 + 0.1 * t : 0);
        pos.push(x * ca + z * sa, y, -x * sa + z * ca);
        uv.push(x / 0.8, t * 1.34);
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < segs; i++) { const a = base + j * (segs + 1) + i, b = a + segs + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return orient(g, (c, w) => w.set(0, under ? -1 : 1, 0));
}

/** Rule for a cherry tree: a short trunk forking into arching limbs, each forking again down to twigs. */
export function growCherry(R, s, maxDepth, limbs, anchors) {
  const RADIAL = [12, 8, 6, 5, 4];
  const u = new THREE.Vector3(), v = new THREE.Vector3();
  const branch = (p0, dir, len, r0, depth) => {
    const n = depth === 0 ? 5 : 4, pts = [p0.clone()], d = dir.clone(), p = p0.clone();
    for (let i = 1; i <= n; i++) {
      const w = depth === 0 ? 0.1 : 0.24;
      d.x += R.range(-w, w); d.z += R.range(-w, w);
      d.y += depth === 0 ? 0.05 : depth >= 3 ? R.range(-0.2, 0.02) : R.range(-0.04, 0.12);     // limbs reach up, twigs sag under their load
      d.normalize();
      p.addScaledVector(d, len / n);
      pts.push(p.clone());
    }
    const r1 = r0 * (depth === 0 ? 0.74 : 0.58);
    const shade = depth === 0 ? 1 : 1 - depth * 0.07;
    limbs.push(tint(tube(pts, [r0, r0 * 0.86 + r1 * 0.14, (r0 + r1) / 2, r1], RADIAL[Math.min(4, depth + (maxDepth < 4 ? 1 : 0))],
      { flare: depth === 0 ? 0.85 : 0, uRep: depth < 2 ? 2 : 1, vScale: 0.5, steps: n * (depth < 2 ? 2 : 1) }), shade, shade * 0.97, shade * 0.95));
    if (depth >= maxDepth - 1) {
      // where the blossom sits: thick along the outer branches
      const from = depth >= maxDepth ? 1 : 2;
      for (let i = from; i <= n; i++) for (let k = 0; k < (depth >= maxDepth ? 2 : 1); k++) {
        anchors.push([pts[i].x + R.range(-0.3, 0.3) * s, pts[i].y + R.range(-0.12, 0.3) * s, pts[i].z + R.range(-0.3, 0.3) * s]);
      }
    }
    if (depth >= maxDepth) return;
    const kids = depth === 0 ? 3 : (R() < 0.3 ? 3 : 2), a0 = R() * 6.28;
    u.set(1, 0, 0); if (Math.abs(d.x) > 0.8) u.set(0, 0, 1);
    u.cross(d).normalize(); v.crossVectors(d, u);
    const end = pts[n], U = u.clone(), V = v.clone(), D = d.clone();
    for (let k = 0; k < kids; k++) {
      const az = a0 + k * Math.PI * 2 / kids + R.range(-0.45, 0.45);
      const spread = depth === 0 ? R.range(0.6, 0.95) : R.range(0.42, 0.8);
      const nd = D.clone().multiplyScalar(Math.cos(spread)).addScaledVector(U, Math.cos(az) * Math.sin(spread)).addScaledVector(V, Math.sin(az) * Math.sin(spread));
      if (depth < 2) nd.y += 0.12;
      branch(end, nd.normalize(), len * R.range(0.7, 0.84) * (depth === 0 ? 0.92 : 1), r1 * (kids === 3 ? 0.74 : 0.82), depth + 1);
    }
  };
  branch(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(R.range(-0.08, 0.08), 1, R.range(-0.08, 0.08)).normalize(), 2.15 * s, 0.25 * s, 0);
}

/** One conifer, trunk and all, as a single geometry to be instanced: tiers of drooping boughs on cut-out cards round a dark core. */
export function coniferGeo(R) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const H = 9, Y0 = 1.9, TIERS = 13;
  const bough = (y, a, L, f) => {
    const sa = Math.sin(a), ca = Math.cos(a), base = pos.length / 3, ROWS = 3;
    const rise = 0.22 + 0.55 * f, droop = 0.7 - 0.35 * f, hw = L * 0.34, tone = R.range(0.78, 1.08);
    for (let j = 0; j <= ROWS; j++) {
      const s = j / ROWS, out = L * s * (1 - 0.12 * s), h = y + L * (rise * s - droop * s * s);
      for (const side of [-1, 1]) {
        pos.push(sa * out + ca * side * hw, h - Math.abs(side) * 0.04 * L, ca * out - sa * side * hw);
        const nx = sa * 0.55 + ca * side * 0.25, nz = ca * 0.55 - sa * side * 0.25, ny = 0.8, l = Math.hypot(nx, ny, nz);
        nor.push(nx / l, ny / l, nz / l);
        uv.push(side * 0.5 + 0.5, 0.03 + 0.97 * s);
        const k = (0.5 + 0.5 * s) * tone;
        col.push(k, k, k);
      }
    }
    for (let j = 0; j < ROWS; j++) { const p = base + j * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
  };
  for (let t = 0; t < TIERS; t++) {
    const f = t / (TIERS - 1), y = Y0 + (H - Y0 - 0.9) * Math.pow(f, 0.92);
    const L = 2.7 * (1 - f) + 0.55, nb = f < 0.45 ? 8 : f < 0.8 ? 6 : 5, a0 = R() * 6.28;
    for (let b = 0; b < nb; b++) bough(y + R.range(-0.2, 0.2), a0 + (b / nb) * 6.283 + R.range(-0.25, 0.25), L * R.range(0.78, 1.12), f);
  }
  // the leader: two crossed cards standing up at the top
  for (const a of [0, Math.PI / 2]) {
    const base = pos.length / 3, sa = Math.sin(a), ca = Math.cos(a);
    for (const [sx, y, vv] of [[-1, H - 1.9, 0.03], [1, H - 1.9, 0.03], [-1, H + 0.25, 1], [1, H + 0.25, 1]]) {
      pos.push(ca * sx * 0.6, y, -sa * sx * 0.6); nor.push(sa * 0.3, 0.9, ca * 0.3); uv.push(sx * 0.5 + 0.5, vv); col.push(0.9, 0.9, 0.9);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  // dark core (stops the eye going straight through) and the trunk, both painted from the texture's solid corner
  const cone = (y0, y1, r0, r1, c, seg) => {
    const base = pos.length / 3;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * 6.2832, sa = Math.sin(a), ca = Math.cos(a);
      pos.push(sa * r0, y0, ca * r0, sa * r1, y1, ca * r1);
      nor.push(sa * 0.9, 0.4, ca * 0.9, sa * 0.9, 0.4, ca * 0.9);
      uv.push(0.02, 0.01, 0.02, 0.01);
      col.push(...c, ...c);
    }
    for (let j = 0; j < seg; j++) { const p = base + j * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
  };
  cone(Y0 + 0.2, H - 0.6, 0.85, 0.05, [0.05, 0.085, 0.04], 7);
  cone(0, H - 1, 0.24, 0.04, [0.2, 0.15, 0.11], 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** A few upright cards crossed at the root (grass), or hanging from it (leaf sprays). */
export function cardsGeo(n, hang) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI, sa = Math.sin(a), ca = Math.cos(a), base = pos.length / 3;
    for (const [sx, vy] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
      pos.push(ca * sx * 0.5, hang ? vy - 1 : vy, sa * sx * 0.5);
      nor.push(0, 1, 0); uv.push(sx * 0.5 + 0.5, vy);
      const c = hang ? 0.7 + 0.3 * vy : 0.55 + 0.45 * vy;
      col.push(c, c, c);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _p4 = new THREE.Vector3(), _s4 = new THREE.Vector3();
export const place = (im, i, x, y, z, rx, ry, rz, sx, sy = sx, sz = sx) => im.setMatrixAt(i, _m4.compose(_p4.set(x, y, z), _q4.setFromEuler(_e4.set(rx, ry, rz)), _s4.set(sx, sy, sz)));
/** The torii must stay in view from the yard: nothing tall straight behind it. */
const inToriiGap = (a) => Math.abs(Math.sin(a)) < 0.33 && Math.cos(a) < 0;

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

    this.buildSky(scene);

    // ---- lights: low sun, cool sky fill
    this.hemi = new THREE.HemisphereLight(0x8c7fb0, 0x4a3628, 1.0);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xffa56a, 2.1);
    sun.position.copy(this.sunDir).multiplyScalar(45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -19; sc.right = 19; sc.top = 19; sc.bottom = -19; sc.near = 1; sc.far = 110;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    this.sunLight = sun;

    // ---- materials (textures are shared; a second tiling of one is a cheap copy of the same picture)
    const gravel = gravelMaps();
    for (const k in gravel) gravel[k].repeat.set(14, 14);
    const wood = woodMaps(), stone = stoneMaps(), tile = tileMaps(), plaster = plasterMaps(512, false), bark = barkMaps(), straw = makeStraw(), bamboo = makeBamboo(), turf = makeTurf();
    const T = this.T = { wood, stone, tile, plaster, bark, plank: plankMaps(), strawWrap: strawMaps(), blossom: blossomTexture(), bough: boughTexture(), grass: grassTexture(), bambooLeaf: bambooLeafTexture() };
    const N = (s) => new THREE.Vector2(s, s);
    const M = this.M = {
      floor: new THREE.MeshStandardMaterial({ ...gravel, normalScale: N(1.1), roughness: 0.96 }),
      grass: new THREE.MeshStandardMaterial({ ...turf, roughness: 1 }),
      plaster: new THREE.MeshStandardMaterial({ ...plaster, color: 0xd2cbbd, roughness: 0.95, normalScale: N(0.7) }),
      stone: new THREE.MeshStandardMaterial({ ...stone, color: 0x9a968e, roughness: 1, normalScale: N(0.55) }),
      tile: new THREE.MeshStandardMaterial({ ...tile, color: 0x3d424c, roughness: 0.85, metalness: 0.25, normalScale: N(1.4) }),
      wood: new THREE.MeshStandardMaterial({ ...wood, color: 0xa58e7c, roughness: 0.85, normalScale: N(0.9) }),
      darkWood: new THREE.MeshStandardMaterial({ ...wood, color: 0x66544c, roughness: 0.9, normalScale: N(0.9) }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2c2c2e, metalness: 0.8, roughness: 0.5, normalMap: stone.normalMap, normalScale: N(0.35) }),
      vermilion: new THREE.MeshStandardMaterial({ map: plaster.map, normalMap: wood.normalMap, normalScale: N(0.5), color: 0xc22d20, roughness: 0.6 }),
      bark: new THREE.MeshStandardMaterial({ ...bark, color: 0xb8a69c, roughness: 1, normalScale: N(1.6), vertexColors: true }),
      straw: new THREE.MeshStandardMaterial({ ...straw, roughness: 0.95 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xffc27a, toneMapped: false }),
      bamboo: new THREE.MeshStandardMaterial({ ...bamboo, color: 0x9cb46c, roughness: 0.55, normalScale: N(0.8) }),
      far: new THREE.MeshLambertMaterial({ vertexColors: true }),
    };
    M.planks = new THREE.MeshStandardMaterial({ ...tiled(T.plank, 3, 1), color: 0xa89078, roughness: 0.9 });      // boarded sides (the podium)
    // light through petals and needles, and a breath of wind in them
    M.blossom = foliageMaterial(T.blossom, { sway: '0.035', through: 1.0, alphaTest: 0.34 });
    M.blossom.emissive.set(0x2c1620); M.blossom.emissiveIntensity = 0.14;
    M.blossomFar = foliageMaterial(T.blossom, { sway: '0.035', through: 1.0, alphaTest: 0.34, beyond: true });
    M.leaf = foliageMaterial(T.bough, { sway: '0.012 * length(position.xz) + 0.003 * position.y', through: 0.5, alphaTest: 0.5, roughness: 1, beyond: true });
    M.bambooLeaf = foliageMaterial(T.bambooLeaf, { sway: '0.07 * (1.0 - uv.y)', through: 0.3, alphaTest: 0.5, roughness: 1, beyond: true });
    M.tuft = foliageMaterial(T.grass, { sway: '0.07 * uv.y', through: 0.6, alphaTest: 0.3 });
    const sh = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
    this.sh = sh;

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

    this.buildGround(scene, world);
    this.buildWall(scene, staticBox);
    this.buildScenery(scene);
    this.buildTrees(scene, staticBox);
    this.buildVerge(scene);
    this.buildBanners(scene);
    this.buildRack(scene, staticBox);
    this.buildPetals(scene);
    this.buildFireflies(scene);
    this.buildMats(scene);
    this.buildExtras(scene, staticBox);
    this.breakables = new Breakables(game, this);
  }

  // ---------------------------------------------------------------- what a map is asked
  /** Is there ground under this point? (Always, in the yard; another map may have an edge to fall off.) */
  solidAt() { return true; }
  /** Is the rim open here, with nothing to stop a body? */
  openAt() { return false; }
  /** Is this point close to an edge with nothing to stop a body? */
  nearEdge() { return false; }
  /** Weather presets this map changes (see world.js), by weather key. */
  get looks() { return null; }
  /** Where the light comes from. */
  get sunDir() { return SUN_DIR; }
  /** Where the straw mats and the green bamboo stand: { straw: [[x, z]], bamboo: [[x, z]] }. */
  matSpots() {
    return { straw: [[-8.3, -6.1], [-6.7, -8.0], [-9.4, -3.9], [8.4, -6.0]], bamboo: [[7.2, 7.4], [7.7, 7.9], [8.2, 7.3], [-4.6, -10.9], [-3.9, -11.3], [-5.3, -11.1]] };
  }
  /** Anything a map has that the yard does not. */
  buildExtras() {}
  /** Once per physics step, before the world moves. */
  step() {}

  // ---------------------------------------------------------------- sky
  buildSky(scene) {
    scene.background = new THREE.Color(0x1a1420);
    scene.fog = new THREE.FogExp2(0x6a4250, 0.012);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(230, 32, 16), new THREE.ShaderMaterial({ ...SKY, side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10;
    scene.add(sky);
    this.sky = sky;
  }

  // ---------------------------------------------------------------- ground
  buildGround(scene, world) {
    this.groundU = { uNoise: { value: makeNoise() }, uRing: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(99, 99, 0)) }, uTime: { value: 0 } };
    groundShader(this.M.floor, this.groundU);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(WALL_R + 0.3, 64).rotateX(-Math.PI / 2), this.M.floor);
    ground.receiveShadow = true;
    scene.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(500, 500).rotateX(-Math.PI / 2), this.M.grass);
    outer.position.y = -0.03;
    outer.receiveShadow = true;
    scene.add(outer);
    this.addGroundPlane(world);
    // stepping stones from the rack to the middle: worn slabs sunk into the gravel
    const R = rng(7), slabs = [];
    for (let i = 0; i < 12; i++) {
      const r = R.range(0.44, 0.62);
      slabs.push(put(rockGeo(300 + i, 2), Math.sin(i * 1.7) * 0.28, 0.002, -10.6 + i * 1.25, 0, R.range(0, 6), 0, r, 0.036, r * R.range(0.78, 0.95)));
    }
    const stones = new THREE.Mesh(mergeGeos(slabs), this.M.stone);
    stones.receiveShadow = true;
    scene.add(stones);
  }

  /** The physical ground: one endless plane at height 0. */
  addGroundPlane(world) {
    const gb = new CANNON.Body({ mass: 0, material: materials.ground });
    gb.addShape(new CANNON.Plane());
    gb.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    gb.hs = { type: 'static', kind: 'stone' };
    setGroup(gb, 'STATIC');
    world.addBody(gb);
    return (this.groundBody = gb);
  }

  // ---------------------------------------------------------------- wall
  buildWall(scene, staticBox) {
    const M = this.M, T = this.T;
    const SEG = 36, RING = 144, R = WALL_R;
    const segLen = 2 * Math.PI * WALL_R / SEG + 0.06;
    const round = 2 * Math.PI * R;
    // one continuous ring per material instead of 36 facets: a battered stone foot, plaster with
    // the dirt of years, a timber plate, and a tiled coping with a rounded ridge
    const ashlar = ashlarMaps();
    const foot = new THREE.Mesh(sweep([[R + 0.38, 0], [R + 0.31, 0.5], [R - 0.31, 0.5], [R - 0.38, 0]], RING, { uRep: Math.round(round / 2.2), vs: [0, 1, 1, 0] }),
      new THREE.MeshStandardMaterial({ ...ashlar, color: 0x8a8680, roughness: 1, normalScale: new THREE.Vector2(1.5, 1.5) }));
    const wallMaps = plasterMaps(512, true);
    for (const k in wallMaps) { wallMaps[k].repeat.set(Math.round(round / 3.4), 1); wallMaps[k].needsUpdate = true; }
    const face = new THREE.Mesh(sweep([[R + 0.23, 0.5], [R + 0.23, 2.6], [R - 0.23, 2.6], [R - 0.23, 0.5]], RING, { uRep: 1, vs: [0, 1, 1, 0] }),
      new THREE.MeshStandardMaterial({ ...wallMaps, color: 0xd2cbbd, roughness: 0.95, normalScale: new THREE.Vector2(0.8, 0.8) }));
    const plate = new THREE.Mesh(mergeGeos([
      sweep([[R + 0.3, 2.48], [R + 0.3, 2.63], [R - 0.3, 2.63], [R - 0.3, 2.48], [R + 0.3, 2.48]], RING, { uRep: 60 }),
      // the eaves from below, and their edge
      sweep([[R - 0.68, 2.61], [R - 0.68, 2.55], [R - 0.3, 2.6]], RING, { uRep: 60 }),
      sweep([[R + 0.3, 2.6], [R + 0.68, 2.55], [R + 0.68, 2.61]], RING, { uRep: 60 }),
    ]), M.darkWood);
    const ridges = Math.round(round / 0.21 / 4);      // four cover tiles per repeat of the texture
    const roof = new THREE.Mesh(mergeGeos([
      sweep([[R + 0.68, 2.61], [R + 0.42, 2.71], [R + 0.13, 2.9]], RING, { uRep: ridges, smoothed: true, vs: [0.67, 0.3, 0] }),
      sweep([[R - 0.13, 2.9], [R - 0.42, 2.71], [R - 0.68, 2.61]], RING, { uRep: ridges, smoothed: true, vs: [0, 0.3, 0.67] }),
      sweep([[R + 0.15, 2.88], [R + 0.13, 2.97], [R + 0.07, 3.03], [R, 3.05], [R - 0.07, 3.03], [R - 0.13, 2.97], [R - 0.15, 2.88]], RING, { uRep: ridges * 2, smoothed: true, vs: [0.02, 0.05, 0.1, 0.16, 0.22, 0.27, 0.3] }),
    ]), M.tile);
    for (const m of [foot, face, roof]) m.castShadow = true;
    for (const m of [foot, face, plate, roof]) { m.receiveShadow = true; scene.add(m); }
    // round end tiles along the eave on the yard side, one under every cover tile
    const nEnd = ridges * 4;
    const ends = new THREE.InstancedMesh(scaleUV(new THREE.CylinderGeometry(0.058, 0.058, 0.035, 8).rotateX(Math.PI / 2), 0.1, 0.1), M.tile, nEnd);
    for (let i = 0; i < nEnd; i++) {
      const a = ((i + 0.5) / nEnd) * Math.PI * 2;
      place(ends, i, Math.sin(a) * (R - 0.685), 2.625, Math.cos(a) * (R - 0.685), 0, a, 0, 1);
    }
    scene.add(ends);
    // posts on the yard side, with a stone under each
    const posts = new THREE.InstancedMesh(rbox(0.2, 2.02, 0.56, 0.02, 1), M.darkWood, SEG);
    for (let i = 0; i < SEG; i++) {
      const a = ((i + 0.5) / SEG) * Math.PI * 2;
      place(posts, i, Math.sin(a) * R, 1.5, Math.cos(a) * R, 0, a, 0, 1);
    }
    posts.castShadow = true; posts.receiveShadow = true;
    scene.add(posts);
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      staticBox(segLen, 5, 0.9, Math.sin(a) * WALL_R, 2.5, Math.cos(a) * WALL_R, a, 'stone');
    }
  }

  // ---------------------------------------------------------------- beyond the wall
  buildScenery(scene) {
    const M = this.M, T = this.T, sh = this.sh;
    const R = rng(1234);

    // ---- torii on the axis the player first looks along: leaning pillars, a curved double lintel,
    // a tie beam wedged through, the tablet between them and a rice-straw rope with paper streamers
    const red = [], black = [], strawG = [], paper = [];
    const weather = (x, y, z) => { const k = 0.62 + 0.38 * sstep(0.2, 2.6, y); return [k, k * (0.92 + 0.08 * sstep(0, 2, y)), k]; };
    for (const s of [-1, 1]) {
      red.push(put(new THREE.CylinderGeometry(0.29, 0.37, 7, 20, 6), s * 3.3, 3.5, 0, 0, 0, -s * 0.04));
      black.push(put(new THREE.CylinderGeometry(0.4, 0.44, 0.75, 20), s * 3.42, 0.37, 0));
      black.push(put(new THREE.CylinderGeometry(0.62, 0.68, 0.16, 20), s * 3.42, 0.08, 0));
      for (const z of [-1, 1]) red.push(put(rbox(0.5, 0.1, 0.16, 0.02, 1), s * 3.22, 5.35 + 0.26 * z, 0.0, 0, 0, z * 0.12));     // wedges
    }
    const lift = (half) => (x) => 0.55 * Math.pow(Math.abs(x) / half, 2.6);
    red.push(put(turnUV(rbox(7.9, 0.42, 0.32, 0.03, 1), 3, 1), 0, 5.35, 0));
    red.push(put(bentBar([[-0.26, -0.2], [0.26, -0.2], [0.26, 0.2], [-0.26, 0.2]], 8.7, 18, lift(4.35)), 0, 6.75, 0));
    red.push(put(rbox(0.5, 1.0, 0.2, 0.02, 1), 0, 6.05, 0));
    black.push(put(bentBar([[-0.38, -0.14], [0.38, -0.14], [0.44, 0.02], [0, 0.2], [-0.44, 0.02]], 9.6, 18, lift(4.35)), 0, 7.09, 0));
    black.push(put(rbox(0.74, 0.98, 0.07, 0.02, 1), 0, 6.05, 0.13));       // the tablet
    // shimenawa
    const sag = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8 * 2 - 1; sag.push(new THREE.Vector3(t * 3.05, 4.92 - 0.42 * (1 - t * t), 0.34)); }
    strawG.push(tube(sag, [0.05, 0.085, 0.11, 0.085, 0.05], 8, { vScale: 3, uRep: 1, steps: 24 }));
    for (const t of [-0.66, -0.33, 0, 0.33, 0.66]) {
      const x = t * 3.05, y = 4.92 - 0.42 * (1 - t * t) - 0.1;
      if (t === 0 || Math.abs(t) > 0.5) strawG.push(put(new THREE.ConeGeometry(0.07, 0.42, 8), x, y - 0.2, 0.34, Math.PI, 0, 0));
      else for (let k = 0; k < 3; k++) paper.push(put(new THREE.BoxGeometry(0.13, 0.15, 0.01), x + (k % 2 ? 0.05 : -0.03), y - 0.08 - k * 0.14, 0.36, 0, 0, 0.1 * (k % 2 ? 1 : -1)));
    }
    const toriiRed = M.vermilion.clone();
    toriiRed.vertexColors = true;
    const torii = new THREE.Group();
    torii.add(sh(new THREE.Mesh(tint(mergeGeos(red), weather), toriiRed)), sh(new THREE.Mesh(mergeGeos(black), M.tile)),
      new THREE.Mesh(mergeGeos(strawG), M.straw), new THREE.Mesh(mergeGeos(paper), M.plaster));
    torii.position.set(0, 0, -20.5);
    scene.add(torii);

    // ---- pagoda: five storeys, each under a roof with swept-up corners, and a ringed finial
    const tiles = [], plasterG = [], timber = [], metal = [];
    let y = 0;
    for (let i = 0; i < 5; i++) {
      const w = 6.4 - i * 0.9, hw = w / 2, last = i === 4;
      plasterG.push(put(new THREE.BoxGeometry(w, 2.4, w), 0, y + 1.2, 0));
      for (let s = 0; s < 4; s++) {
        const a = s * Math.PI / 2;
        for (const t of [-1, -0.33, 0.33, 1]) timber.push(put(rbox(0.26, 2.4, 0.26, 0.03, 1), t * hw, y + 1.2, hw, 0, 0, 0).rotateY(a));
        for (const yy of [0.14, 2.0, 2.3]) timber.push(put(turnUV(rbox(w + 0.3, 0.2, 0.2, 0.02, 1), 2, 1), 0, y + yy, hw + 0.02).rotateY(a));
        if (i > 0) {
          timber.push(put(turnUV(rbox(w + 1.3, 0.08, 0.08, 0.02, 1), 2, 1), 0, y + 0.72, hw + 0.6).rotateY(a));          // balcony rail
          for (let k = -3; k <= 3; k++) timber.push(put(new THREE.BoxGeometry(0.07, 0.6, 0.07), k * (w + 1.2) / 6, y + 0.42, hw + 0.6).rotateY(a));
        }
      }
      const top = last ? 0.08 : (w - 0.9) / 2 + 0.25, eave = hw + 1.45, rise = last ? 2.3 : 1.2, ry = y + 2.3 + rise;
      tiles.push(put(hipRoof(eave, top, rise, 0.5), 0, ry, 0));
      timber.push(put(hipRoof(eave - 0.02, top, rise, 0.5, true), 0, ry, 0));
      y += 3.3;
    }
    y += 1.25;
    metal.push(put(new THREE.CylinderGeometry(0.05, 0.12, 4.6, 8), 0, y + 2.1, 0), put(new THREE.SphereGeometry(0.42, 12, 8), 0, y - 0.05, 0, 0, 0, 0, 1, 0.6, 1), put(new THREE.SphereGeometry(0.16, 10, 8), 0, y + 4.45, 0));
    for (let k = 0; k < 7; k++) metal.push(put(new THREE.TorusGeometry(0.34 - k * 0.03, 0.035, 6, 14), 0, y + 0.8 + k * 0.42, 0, Math.PI / 2, 0, 0));
    const pag = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.9, roughness: 0.4 });
    pag.add(new THREE.Mesh(mergeGeos(plasterG), M.plaster), new THREE.Mesh(mergeGeos(timber), M.vermilion), new THREE.Mesh(mergeGeos(tiles), M.tile), new THREE.Mesh(mergeGeos(metal), gold));
    pag.position.set(-27, 0, -36);
    pag.rotation.y = 0.5;
    scene.add(pag);

    // ---- the land beyond: wooded hills, two ranges of ridged mountains fading into the haze, and the great peak
    const land = [];
    const ridgeRing = (r0, r1, hMax, seed, base, crest, NA = 200, NR = 6) => {
      const n1 = fbmField(512, 32, 7, 2, 6, seed, 0.55), n2 = fbmField(512, 32, 3, 1, 3, seed + 1);
      const pos = [], col = [], idx = [];
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA) * Math.PI * 2, sx = Math.sin(a), cz = Math.cos(a), px = Math.floor((i % NA) / NA * 512);
        for (let j = 0; j <= NR; j++) {
          const t = j / NR, py = Math.min(31, Math.floor(t * 31));
          const ridge = 1 - Math.abs(n1[py * 512 + px] * 2 - 1);                     // sharp crests
          const h = hMax * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.25 + 1.1 * ridge * ridge) * (0.45 + 1.1 * n2[py * 512 + px]) - 3;
          const r = r0 + (r1 - r0) * t;
          pos.push(sx * r, h, cz * r);
          const k = sstep(0, hMax * 0.9, h);
          col.push(base[0] + (crest[0] - base[0]) * k, base[1] + (crest[1] - base[1]) * k, base[2] + (crest[2] - base[2]) * k);
        }
      }
      for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) { const p = i * (NR + 1) + j, q = p + NR + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setIndex(idx);
      return orient(g, (c, w) => w.set(0, 1, 0));
    };
    land.push(ridgeRing(42, 85, 9, 501, [0.05, 0.075, 0.05], [0.09, 0.12, 0.07], 160, 5));
    land.push(ridgeRing(95, 160, 30, 511, [0.1, 0.1, 0.14], [0.2, 0.17, 0.22]));
    land.push(ridgeRing(165, 260, 58, 521, [0.14, 0.12, 0.2], [0.3, 0.24, 0.32]));
    // the peak: a long concave cone with gullies, snow on the top third
    {
      const NA = 72, NR = 14, gul = fbmField(128, 16, 12, 2, 4, 531), pos = [], col = [], idx = [];
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA) * Math.PI * 2, px = Math.floor((i % NA) / NA * 128);
        for (let j = 0; j <= NR; j++) {
          const t = j / NR, g1 = gul[Math.min(15, Math.floor(t * 15)) * 128 + px];
          const r = (9 + 120 * Math.pow(t, 1.3)) * (0.94 + 0.12 * g1), h = 80 * Math.pow(1 - t, 1.25) - 4 + (g1 - 0.5) * 5 * Math.sin(Math.PI * t);
          pos.push(Math.sin(a) * r, h, Math.cos(a) * r);
          const snow = sstep(48 + (g1 - 0.5) * 34, 60 + (g1 - 0.5) * 22, h);
          col.push(0.15 + 0.85 * snow, 0.13 + 0.82 * snow, 0.2 + 0.74 * snow);
        }
      }
      for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) { const p = i * (NR + 1) + j, q = p + NR + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setIndex(idx);
      land.push(put(orient(g, (c, w) => w.set(c.x, 40, c.z)), 60, 0, -175));
    }
    scene.add(new THREE.Mesh(mergeGeos(land, true), M.far));

    // ---- cedars standing behind the wall, one geometry drawn many times
    const NC = 66;
    const cedars = new THREE.InstancedMesh(coniferGeo(rng(77)), M.leaf, NC);
    const c = new THREE.Color();
    for (let i = 0; i < NC; i++) {
      let a = R() * Math.PI * 2;
      while (inToriiGap(a)) a = R() * Math.PI * 2;
      const r = R.range(20, 36) + (i % 3 === 0 ? 0 : 3), k = R.range(0.8, 1.45) * (Math.abs(a - 3.78) < 0.2 ? 0.75 : 1);
      place(cedars, i, Math.sin(a) * r, -0.1, Math.cos(a) * r, R.range(-0.03, 0.03), R() * 6.28, R.range(-0.03, 0.03), k * R.range(0.85, 1.1), k, k * R.range(0.85, 1.1));
      c.setHSL(R.range(0.22, 0.36), R.range(0.15, 0.4), R.range(0.62, 0.86));
      cedars.setColorAt(i, c);
    }
    scene.add(cedars);

    // ---- bamboo in clumps close against the outside of the wall
    const NB = 84, PER = 11;
    const culmMaps = tiled({ map: M.bamboo.map, normalMap: M.bamboo.normalMap }, 1, 6);
    const stalk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.06, 1, 7, 1, true).translate(0, 0.5, 0),
      beyondWall(new THREE.MeshStandardMaterial({ ...culmMaps, color: 0x9cb46c, roughness: 0.55 })), NB);
    const spray = new THREE.InstancedMesh(cardsGeo(2, true), M.bambooLeaf, NB * PER);
    let clumpA = 0, clumpR = 0;
    for (let i = 0; i < NB; i++) {
      if (i % 6 === 0) { do { clumpA = R() * Math.PI * 2; } while (inToriiGap(clumpA) || Math.abs(clumpA - 3.78) < 0.28); clumpR = R.range(16.4, 18.6); }      // (3.78: where the pagoda stands)
      const a = clumpA + R.range(-0.07, 0.07), r = clumpR + R.range(-0.9, 0.9), h = R.range(6, 10.5);
      const x = Math.sin(a) * r, z = Math.cos(a) * r, lx = R.range(-0.09, 0.09), lz = R.range(-0.09, 0.09), th = R.range(0.8, 1.3);
      place(stalk, i, x, 0, z, lx, 0, lz, th, h, th);
      for (let k = 0; k < PER; k++) {
        const hh = h * (0.45 + 0.57 * (k + R()) / PER), s = R.range(0.9, 1.5), off = R() * 6.28;
        // (a leaning stalk carries its leaves with it: x moves with the lean about z, z with the lean about x)
        place(spray, i * PER + k, x - Math.sin(lz) * hh + Math.sin(off) * 0.3, hh + 0.25, z + Math.sin(lx) * hh + Math.cos(off) * 0.3, R.range(-0.3, 0.3), off, R.range(-0.3, 0.3), s * 1.3, s * R.range(0.8, 1.1), s * 1.3);
        c.setHSL(R.range(0.22, 0.31), R.range(0.25, 0.45), R.range(0.55, 0.85));
        spray.setColorAt(i * PER + k, c);
      }
    }
    scene.add(stalk, spray);
  }

  // ---------------------------------------------------------------- cherry trees
  buildTrees(scene, staticBox) {
    const M = this.M, T = this.T;
    const R = rng(4242);
    // Every tree grows from the same rule with its own dice. The wood of all of them is one
    // mesh, the blossom another: hundreds of small sprays on crossed cards along the outer
    // branches, shaded as if each tree's crown were one soft round mass.
    const build = (list, far) => {
      const wood = [], pos = [], nor = [], uv = [], col = [], idx = [];
      const u = new THREE.Vector3(), v = new THREE.Vector3(), n = new THREE.Vector3(), o = new THREE.Vector3();
      for (const [x, z, s, depth] of list) {
        const limbs = [], anchors = [];
        growCherry(R, s, depth, limbs, anchors);
        const yaw = R() * 6.28;
        for (const l of limbs) wood.push(l.rotateY(yaw).translate(x, 0, z));
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        let cx = 0, cyy = 0, cz = 0, rad = 0;
        for (const a of anchors) { const ax = a[0] * cy + a[2] * sy, az = -a[0] * sy + a[2] * cy; a[0] = ax + x; a[2] = az + z; cx += a[0]; cyy += a[1]; cz += a[2]; }
        cx /= anchors.length; cyy /= anchors.length; cz /= anchors.length;
        for (const a of anchors) rad = Math.max(rad, Math.hypot(a[0] - cx, a[1] - cyy, a[2] - cz));
        for (const a of anchors) {
          const d = Math.hypot(a[0] - cx, a[1] - cyy, a[2] - cz) / rad;
          const size = R.range(0.5, 0.86) * s * (depth < 4 ? 1.35 : 1);
          const pale = R(), ao = (0.58 + 0.42 * sstep(0.15, 0.85, d)) * (0.82 + 0.18 * sstep(-0.6, 0.6, (a[1] - cyy) / rad));
          const cr = (1.0 - 0.06 * pale) * ao, cg = (0.93 - 0.2 * pale) * ao, cb = (0.96 - 0.14 * pale) * ao;
          for (let k = 0; k < 3; k++) {
            // three cards per spray: two upright at an angle to each other, one lying, so it reads from below too
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
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      return [new THREE.Mesh(mergeGeos(wood, true), M.bark), new THREE.Mesh(g, far ? M.blossomFar : M.blossom)];
    };
    this.treeSpots = [];
    const yard = [], beyond = [];
    for (const a of [0.62, 2.2, 3.75, 5.5]) {
      const x = Math.sin(a) * 11.4, z = Math.cos(a) * 11.4;
      yard.push([x, z, 1, 4]);
      this.treeSpots.push([x, z]);
      staticBox(0.5, 3, 0.5, x, 1.5, z, 0, 'wood');
      this.obstacles.push([x, z, 0.85]);
    }
    this.treeSpots.forEach(([x, z], i) => this.groundU.uRing.value[i].set(x, z, 2.35));
    for (const a of [0.1, 1.2, 1.75, 2.75, 4.3, 4.9, 5.9]) { const r = R.range(18, 21); beyond.push([Math.sin(a) * r, Math.cos(a) * r, R.range(1.25, 1.6), 3]); }
    // only the trees in the yard throw shadows (the low sun would lay the far ones right across it)
    const [wood, bloom] = build(yard);
    wood.castShadow = wood.receiveShadow = bloom.castShadow = bloom.receiveShadow = true;
    bloom.customDepthMaterial = foliageDepth(T.blossom, 0.34);
    const [wood2, bloom2] = build(beyond, true);
    scene.add(wood, bloom, wood2, bloom2);
  }

  // ---------------------------------------------------------------- the strip along the wall: grass, moss, stones
  buildVerge(scene) {
    const M = this.M, R = rng(909);
    const spots = [];
    for (let i = 0; i < 560; i++) {
      const a = R() * Math.PI * 2, r = 14.42 - Math.pow(R(), 1.7) * 1.25;
      spots.push([Math.sin(a) * r, Math.cos(a) * r, R.range(0.22, 0.5) * (r > 13.9 ? 1.25 : 1)]);
    }
    for (const [x, z] of this.treeSpots) for (let i = 0; i < 16; i++) { const a = R() * 6.28, r = R.range(0.3, 0.75); spots.push([x + Math.sin(a) * r, z + Math.cos(a) * r, R.range(0.16, 0.32)]); }
    const tufts = new THREE.InstancedMesh(cardsGeo(3, false), M.tuft, spots.length);
    const c = new THREE.Color();
    spots.forEach(([x, z, s], i) => {
      place(tufts, i, x, -0.01, z, R.range(-0.12, 0.12), R() * 6.28, R.range(-0.12, 0.12), s * R.range(1, 1.6), s, s * R.range(1, 1.6));
      c.setHSL(R.range(0.18, 0.3), R.range(0.25, 0.5), R.range(0.5, 0.8));
      tufts.setColorAt(i, c);
    });
    tufts.receiveShadow = true;
    scene.add(tufts);
    const NR = 54;
    const rocks = new THREE.InstancedMesh(rockGeo(5, 2), M.stone, NR);
    for (let i = 0; i < NR; i++) {
      const a = R() * Math.PI * 2, r = R.range(13.75, 14.35), s = Math.pow(R(), 2) * 0.24 + 0.07;
      place(rocks, i, Math.sin(a) * r, s * 0.25, Math.cos(a) * r, R.range(-0.4, 0.4), R() * 6.28, R.range(-0.4, 0.4), s * R.range(0.9, 1.5), s * R.range(0.6, 0.9), s);
    }
    rocks.receiveShadow = true;
    scene.add(rocks);
  }

  // ---------------------------------------------------------------- nobori banners
  buildBanners(scene) {
    const M = this.M;
    const looks = [['#8a1418', '#e8e0cc'], ['#e8e0cc', '#16161a'], ['#1c2c4a', '#e8e0cc']];
    // cloth with a little hang in it instead of a board
    const cloth = new THREE.PlaneGeometry(0.7, 2.8, 4, 12);
    const cp = cloth.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i) + 0.35, y = cp.getY(i); cp.setZ(i, Math.sin(y * 2.6 + x * 3) * 0.035 * (0.3 + x * 2) + Math.sin(y * 5.1) * 0.012); }
    cloth.computeVertexNormals();
    const poles = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = WALL_R - 0.75;
      const [bg, crest] = looks[k % 3];
      const px = Math.sin(a) * r, pz = Math.cos(a) * r;
      poles.push(put(new THREE.CylinderGeometry(0.024, 0.032, 4.6, 8), px, 2.3, pz), put(new THREE.SphereGeometry(0.045, 8, 6), px, 4.63, pz), put(new THREE.CylinderGeometry(0.06, 0.075, 0.1, 8), px, 0.05, pz));
      const pivot = new THREE.Group();
      pivot.position.set(px, 4.5, pz);
      pivot.rotation.y = a + Math.PI / 2;
      const ban = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: makeBannerTexture(bg, crest), side: THREE.DoubleSide, roughness: 0.95 }));
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
    const poleMesh = new THREE.Mesh(mergeGeos(poles), M.darkWood);
    poleMesh.castShadow = true;
    scene.add(poleMesh);
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
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const dg = dot.getContext('2d'), gr = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = gr; dg.fillRect(0, 0, 32, 32);
    this.flies = new THREE.Points(g, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dot), color: 0xe6ff8a, size: 0.11, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
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
      // planed timber with eased edges; the grain runs along the long side
      const geo = rbox(w, h, d, 0.012, 1);
      const m = sh(new THREE.Mesh(w > h ? turnUV(geo, w * 0.6, 1) : geo, mat));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    part(2.9, 0.12, 0.62, 0, 0.06, 0, M.darkWood);
    for (const s of [-1, 1]) {
      part(0.12, 1.75, 0.12, s * 1.4, 0.95, 0.18);
      part(0.12, 1.2, 0.12, s * 1.4, 0.6, -0.18);
      part(0.16, 0.05, 0.16, s * 1.4, 1.84, 0.18, M.iron);         // caps on the posts
    }
    part(2.9, 0.09, 0.12, 0, 1.6, 0.18);
    part(2.9, 0.09, 0.12, 0, 1.1, -0.18);
    part(2.9, 0.07, 0.4, 0, 0.32, 0);
    part(3.3, 0.1, 0.5, 0, 1.86, 0.18, M.tile);
    scene.add(g);
    staticBox(3.0, 1.7, 0.7, origin.x, 0.85, origin.z, 0, 'wood');

    mergeStatic(g);
    this.rack = { origin, slots: [] };
    WEAPON_ORDER.forEach((key, i) => {
      const def = WEAPONS[key];
      const x = -1.1 + i * 0.44;
      const model = buildWeaponModel(def);
      const baseY = def.type === 'polearm' ? def.shaftBack + 0.18 : def.gripLen + 0.2;
      model.position.set(x, baseY, 0.04);
      model.rotation.x = -0.1;
      model.userData.keep = true;
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
    this.matGeo = new THREE.CylinderGeometry(0.095, 0.095, 1, 18);
    const stands = [];
    const spots = this.matSpots();
    for (const [x, z] of spots.straw) {
      for (const r of [0, Math.PI / 2]) stands.push(put(turnUV(rbox(0.7, 0.07, 0.1, 0.012, 1)), x, 0.035, z, 0, r, 0));
      stands.push(put(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 10), x, 0.25, z));
      const mesh = sh(new THREE.Mesh(this.matGeo, M.straw));
      scene.add(mesh);
      const mat = { x, z, base: 0.4, top: 1.55, full: 1.55, mesh, body: null };
      this.mats.push(mat);
      this.fitMat(mat);
    }
    scene.add(sh(new THREE.Mesh(mergeGeos(stands), M.darkWood)));
    // green bamboo: cut it wherever you like, as often as you like
    for (const [x, z] of spots.bamboo) {
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
    // wind and light for the foliage, drifting clouds, ripples in the puddles
    foliageUniforms.uTime.value = t;
    foliageUniforms.uSunDir.value.copy(this.sunDir);
    foliageUniforms.uSunCol.value.copy(this.sunLight.color).multiplyScalar(this.sunLight.intensity * 0.42);
    this.sky.material.uniforms.time.value = t;
    if (this.groundU) this.groundU.uTime.value = t;
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
