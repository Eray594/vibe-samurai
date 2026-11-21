// Everything that flies, glows, splashes or stains. Three pooled layers carry nearly all of it:
//   sprites  one instanced draw call of camera-facing / velocity-stretched / ground-flat quads cut from a generated
//            atlas (lit puffs, droplets, spray, sparks, embers, flares, shock rings); premultiplied blending, so
//            lit smoke and additive fire share the call
//   chips    one instanced draw call of small tumbling solids (splinters, gore, gravel)
//   decals   one instanced draw call of blood stains on the floor (irregular shapes that splat out, then dry)
// plus one ribbon per weapon that is actually swinging. A layer with nothing alive is not drawn at all.
import * as THREE from 'three';
import { rand } from './physics.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const TAU = Math.PI * 2;
/** True for a real, finite number (NaN and ±Infinity fail). */
const fin = (x) => x - x === 0;
const finV = (v) => !!v && fin(v.x) && fin(v.y) && fin(v.z);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const pick = (a) => a[(Math.random() * a.length) | 0];

// ------------------------------------------------------------------ generated textures
// (plain data textures: no canvas, no image files; a fixed seed so the shapes are the same every run)
let _seed = 20241;
const rng = () => { _seed = (Math.imul(_seed, 1664525) + 1013904223) | 0; return (_seed >>> 8) / 16777216; };
const rr = (a, b) => a + (b - a) * rng();
const NOISE_N = 64;
const NOISE = new Float32Array(NOISE_N * NOISE_N);
for (let i = 0; i < NOISE.length; i++) NOISE[i] = rng();
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = xi & 63, x1 = (xi + 1) & 63, y0 = (yi & 63) * NOISE_N, y1 = ((yi + 1) & 63) * NOISE_N;
  const a = NOISE[y0 + x0], b = NOISE[y0 + x1], c = NOISE[y1 + x0], d = NOISE[y1 + x1];
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
}
function fbm(x, y, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x, y); n += a; a *= 0.5; x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; }
  return s / n;
}

const CELL = 128, GRID = 4, TEX = CELL * GRID;
function dataTexture(data) {
  const t = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
/** Fill one atlas cell: fn(x, y, out) with x, y in -1..1 (y up) writes r, g, b, a in 0..1 into out. */
function fillCell(data, cell, fn) {
  const cx = (cell % GRID) * CELL, cy = Math.floor(cell / GRID) * CELL, out = [0, 0, 0, 0];
  for (let j = 0; j < CELL; j++) {
    for (let i = 0; i < CELL; i++) {
      out[0] = out[1] = out[2] = out[3] = 0;
      fn((i + 0.5) / CELL * 2 - 1, (j + 0.5) / CELL * 2 - 1, out);
      const o = ((cy + j) * TEX + cx + i) * 4;
      data[o] = clamp01(out[0]) * 255; data[o + 1] = clamp01(out[1]) * 255; data[o + 2] = clamp01(out[2]) * 255; data[o + 3] = clamp01(out[3]) * 255;
    }
  }
}

// atlas cells of the sprite sheet
const C_PUFF = [0, 1, 2, 3], C_WISP = [14, 15], C_CLOUD = [0, 1, 2, 3, 14, 15];
const C_DROP = [4, 5], C_SPRAY = [6, 7];
const C_STREAK = 8, C_GLOW = 9, C_FLARE = 10, C_RING = 11, C_DUSTRING = 12, C_EMBER = 13;

/**
 * The sprite sheet. Lit cells: r = shade, g/b = the surface normal's x/y (so a puff has a lit and a dark side),
 * a = density. Glowing cells: r = 1, a = brightness. Every cell fades to nothing before its border.
 */
function makeSpriteAtlas() {
  const data = new Uint8Array(TEX * TEX * 4);
  const puff = (cell, wispy) => {
    const ox = rr(0, 50), oy = rr(0, 50);
    const dens = (x, y) => {
      const r = Math.hypot(x, y);
      if (r >= 1) return 0;
      let n;
      if (wispy) {
        const wx = x + (fbm(x * 1.6 + ox + 9, y * 1.6 + oy, 3) - 0.5) * 1.1, wy = y + (fbm(x * 1.6 + ox, y * 1.6 + oy + 5, 3) - 0.5) * 1.1;
        n = fbm(wx * 2.6 + ox, wy * 2.6 + oy, 5);
        return sstep(0.02, 0.6, (1 - r * 1.1) * 0.8 + (n - 0.5) * 1.2) * sstep(1, 0.55, r);
      }
      n = fbm(x * 2.1 + ox, y * 2.1 + oy, 5);
      return sstep(0, 0.7, (1 - r * 1.05) + (n - 0.5) * 0.8) * sstep(1, 0.6, r);
    };
    // thickness: a rounded body with billows; its slope gives the normal
    const H = (x, y) => Math.sqrt(Math.max(0, 1 - (x * x + y * y) * 0.9)) * 0.55 * dens(x, y) + fbm(x * 3.2 + ox + 3, y * 3.2 + oy + 3, 4) * 0.4 * dens(x, y);
    const e = 2 / CELL;
    fillCell(data, cell, (x, y, o) => {
      const d = dens(x, y);
      if (d <= 0) { o[1] = o[2] = 0.5; return; }
      const gx = (H(x + e, y) - H(x - e, y)) / (2 * e), gy = (H(x, y + e) - H(x, y - e)) / (2 * e);
      let nx = -gx * 1.2, ny = -gy * 1.2;
      const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
      o[0] = 0.5 + 0.3 * fbm(x * 5 + ox, y * 5 + oy, 3);
      o[1] = nx * 0.5 + 0.5; o[2] = ny * 0.5 + 0.5;
      o[3] = d;
    });
  };
  for (const c of C_PUFF) puff(c, false);
  for (const c of C_WISP) puff(c, true);

  // droplets: a bead with a highlight; the second one is a little lopsided
  C_DROP.forEach((cell, k) => fillCell(data, cell, (x, y, o) => {
    let d = Math.hypot(x, y) - 0.78;
    if (k) d = Math.min(Math.hypot(x * 1.15, y + 0.12) - 0.62, Math.hypot(x - 0.1, y - 0.3) - 0.4) + (vnoise(x * 4 + 3, y * 4) - 0.5) * 0.08;
    o[3] = sstep(0.06, -0.06, d);
    const hl = Math.exp(-((x + 0.26) ** 2 + (y - 0.3) ** 2) / 0.035);
    o[0] = 0.5 + 0.2 * sstep(0, -0.5, d) + hl * 0.5;
    o[1] = o[2] = 0.5;
  }));

  // fine spray: a cloud of pin-point drops over a faint haze
  for (const cell of C_SPRAY) {
    const dots = [];
    const n = 90 + Math.floor(rr(0, 50));
    for (let i = 0; i < n; i++) {
      const a = rr(0, TAU), d = Math.pow(rng(), 0.7) * 0.82;
      dots.push(Math.cos(a) * d, Math.sin(a) * d, 0.008 + 0.035 * Math.pow(rng(), 3));
    }
    const ox = rr(0, 40);
    fillCell(data, cell, (x, y, o) => {
      const r = Math.hypot(x, y);
      let a = 0;
      for (let i = 0; i < dots.length; i += 3) {
        const dx = x - dots[i], dy = y - dots[i + 1], rad = dots[i + 2];
        if (dx > 0.08 || dx < -0.08 || dy > 0.08 || dy < -0.08) continue;
        a = Math.max(a, sstep(rad + 0.012, rad - 0.012, Math.hypot(dx, dy)));
      }
      const haze = sstep(1, 0.2, r) * fbm(x * 2.5 + ox, y * 2.5, 3) * 0.3;
      o[3] = Math.max(a * 0.95, haze) * sstep(1, 0.85, r);
      o[0] = 0.62; o[1] = o[2] = 0.5;
    });
  }

  // spark streak: head at the top, thinning to nothing at the tail
  fillCell(data, C_STREAK, (x, y, o) => {
    const t = (y + 1) / 2;                                   // 0 tail .. 1 head
    const w = 0.05 + 0.3 * t * t;
    const core = Math.exp(-(x * x) / (w * w)) * sstep(0, 0.45, t) * sstep(1, 0.86, t);
    const halo = Math.exp(-(x * x) / 0.35) * 0.16 * sstep(0.1, 0.7, t) * sstep(1, 0.8, t) * sstep(1, 0.5, Math.abs(x));
    o[0] = 1; o[3] = Math.min(1, core + halo);
  });
  fillCell(data, C_GLOW, (x, y, o) => {
    const r = Math.hypot(x, y);
    o[0] = 1; o[3] = (Math.exp(-r * r * 5) * 0.75 + Math.exp(-r * r * 40) * 0.5) * sstep(1, 0.55, r);
  });
  // flare: a hot core with uneven rays
  {
    const rays = [];
    for (let i = 0, n = 9; i < n; i++) rays.push(rr(0, TAU), rr(0.03, 0.09), rr(0.35, 1), rr(0.4, 1));
    fillCell(data, C_FLARE, (x, y, o) => {
      const r = Math.hypot(x, y), a = Math.atan2(y, x);
      let s = Math.exp(-r * r * 26) * 1.2 + Math.exp(-r * r * 5) * 0.22;
      for (let i = 0; i < rays.length; i += 4) {
        let da = Math.abs(a - rays[i]); if (da > Math.PI) da = TAU - da;
        const wid = rays[i + 1] * (0.35 + r * 0.2) / Math.max(0.08, r);
        s += Math.exp(-(da * da) / (wid * wid)) * Math.exp(-r * 3.2 / rays[i + 2]) * rays[i + 3] * 0.9;
      }
      o[0] = 1; o[3] = Math.min(1, s) * sstep(1, 0.6, r);
    });
  }
  // shock ring: thin, broken, with a breath of haze inside
  fillCell(data, C_RING, (x, y, o) => {
    const r = Math.hypot(x, y), a = Math.atan2(y, x);
    const brk = sstep(0.36, 0.7, fbm(Math.cos(a) * 2.6 + 7, Math.sin(a) * 2.6 + 3, 3));
    const rad = 0.74 + (fbm(Math.cos(a) * 1.8 + 20, Math.sin(a) * 1.8, 3) - 0.5) * 0.3;
    const ring = Math.exp(-((r - rad) ** 2) / 0.0016) * brk + Math.exp(-((r - rad) ** 2) / 0.02) * 0.2 * brk;
    o[0] = 1; o[3] = Math.min(1, ring + sstep(rad, 0.1, r) * 0.05) * sstep(1, 0.93, r);
  });
  // dust ring, lying on the ground: wide, soft, ragged
  fillCell(data, C_DUSTRING, (x, y, o) => {
    const r = Math.hypot(x, y);
    const n = fbm(x * 3 + 11, y * 3 + 4, 4);
    const ring = Math.exp(-((r - 0.66 - (n - 0.5) * 0.2) ** 2) / 0.03);
    o[3] = clamp01(ring * (0.35 + 1.1 * n) - 0.1) * sstep(1, 0.85, r);
    o[0] = 0.6 + 0.2 * n; o[1] = o[2] = 0.5;
  });
  fillCell(data, C_EMBER, (x, y, o) => {
    const r = Math.hypot(x, y);
    o[0] = 1; o[3] = (sstep(0.32, 0.18, r) + Math.exp(-r * r * 7) * 0.3) * sstep(1, 0.6, r);
  });
  return dataTexture(data);
}

// cells of the stain sheet
const D_POOL = [0, 1, 2, 3, 4, 5], D_STREAK = [6, 7, 8, 9], D_SPATTER = [10, 11, 12, 13], D_DRIP = [14, 15];

/** Blood stains: r = how thick the blood lies (raised rim, for the bump), a = coverage. Streaks travel towards +y. */
function makeStainAtlas() {
  const data = new Uint8Array(TEX * TEX * 4);
  const draw = (cell, circles, warp) => {
    const ox = rr(0, 60), oy = rr(0, 60);
    fillCell(data, cell, (x, y, o) => {
      const wx = x + (fbm(x * 2.4 + ox, y * 2.4 + oy, 3) - 0.5) * warp + (vnoise(x * 11 + ox, y * 11) - 0.5) * 0.035;
      const wy = y + (fbm(x * 2.4 + ox + 31, y * 2.4 + oy + 17, 3) - 0.5) * warp + (vnoise(x * 11, y * 11 + oy) - 0.5) * 0.035;
      let d = 9;
      for (let i = 0; i < circles.length; i += 3) {
        const di = Math.hypot(wx - circles[i], wy - circles[i + 1]) - circles[i + 2];
        // (smooth union, so lobes run into the body instead of meeting it at a crease)
        const h = clamp01(0.5 + 0.5 * (d - di) / 0.05);
        d = d + (di - d) * h - 0.05 * h * (1 - h);
      }
      const edge = sstep(1, 0.93, Math.max(Math.abs(x), Math.abs(y)));
      o[3] = sstep(0.018, -0.018, d) * edge;
      o[0] = Math.pow(clamp01(-d / 0.09), 0.6) * (0.8 + 0.2 * vnoise(x * 7 + ox, y * 7 + oy));
    });
  };
  for (const cell of D_POOL) {
    const c = [], r0 = rr(0.26, 0.36);
    c.push(0, 0, r0);
    for (let i = 0, n = 5 + Math.floor(rr(0, 5)); i < n; i++) { const a = rr(0, TAU), d = r0 * rr(0.6, 1.05); c.push(Math.cos(a) * d, Math.sin(a) * d, r0 * rr(0.25, 0.5)); }
    for (let i = 0, n = 3 + Math.floor(rr(0, 4)); i < n; i++) {          // fingers running out
      const a = rr(0, TAU), len = rr(0.15, 0.4);
      for (let k = 0; k < 4; k++) { const d = r0 + len * (k / 3); c.push(Math.cos(a) * d, Math.sin(a) * d, r0 * 0.2 * (1 - k / 4.5)); }
      if (rng() < 0.6) { const d = r0 + len + rr(0.05, 0.12); c.push(Math.cos(a) * d, Math.sin(a) * d, rr(0.015, 0.035)); }
    }
    for (let i = 0, n = 6 + Math.floor(rr(0, 8)); i < n; i++) { const a = rr(0, TAU), d = rr(0.5, 0.86); c.push(Math.cos(a) * d, Math.sin(a) * d, 0.01 + 0.04 * rng() ** 2); }
    draw(cell, c, 0.16);
  }
  for (const cell of D_STREAK) {
    const c = [], wob = rr(-0.06, 0.06), fat = rr(0.14, 0.2);
    for (let k = 0; k <= 10; k++) { const t = k / 10, y = -0.62 + t * 0.7; c.push(wob * Math.sin(t * 3), y, fat * Math.sqrt(Math.max(0.06, 1 - (t * 2 - 0.75) ** 2 * 0.75))); }
    for (let k = 0; k <= 7; k++) { const t = k / 7; c.push(wob * (1 - t), 0.08 + t * rr(0.4, 0.5), 0.075 * (1 - t) + 0.014); }
    c.push(rr(-0.03, 0.03), rr(0.7, 0.8), rr(0.03, 0.05));
    if (rng() < 0.7) c.push(rr(-0.05, 0.05), 0.88, rr(0.012, 0.022));
    for (let i = 0, n = 2 + Math.floor(rr(0, 4)); i < n; i++) c.push(rr(-0.4, 0.4), rr(-0.5, 0.8), 0.008 + 0.03 * rng() ** 2);
    draw(cell, c, 0.07);
  }
  for (const cell of D_SPATTER) {
    const c = [];
    for (let i = 0, n = 10 + Math.floor(rr(0, 16)); i < n; i++) {
      const a = rr(0, TAU), d = Math.sqrt(rng()) * 0.84, r = 0.012 + 0.075 * rng() ** 3, x = Math.cos(a) * d, y = Math.sin(a) * d;
      c.push(x, y, r);
      if (rng() < 0.35) c.push(x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2, r * 0.6);
    }
    draw(cell, c, 0.05);
  }
  for (const cell of D_DRIP) {
    const c = [], r0 = rr(0.26, 0.34);
    c.push(0, 0, r0);
    for (let i = 0, n = 9 + Math.floor(rr(0, 5)); i < n; i++) { const a = (i / n) * TAU + rr(-0.2, 0.2); c.push(Math.cos(a) * r0 * 1.02, Math.sin(a) * r0 * 1.02, r0 * rr(0.1, 0.24)); }
    for (let i = 0, n = 3 + Math.floor(rr(0, 4)); i < n; i++) { const a = rr(0, TAU), d = r0 * rr(1.5, 2.6); c.push(Math.cos(a) * d, Math.sin(a) * d, rr(0.012, 0.04)); }
    draw(cell, c, 0.06);
  }
  return dataTexture(data);
}

// ------------------------------------------------------------------ sprites
const SPRITE_VS = `
attribute vec3 iPos;
attribute vec3 iAxis;      // stretched sprites: from tail to head, in world space
attribute vec4 iA;         // half size, rotation, atlas cell + 16 * mode, alpha
attribute vec4 iB;         // colour, additive share
uniform float uPx;         // world units one pixel covers at distance 1
varying vec2 vUv;
varying vec4 vCol;
varying float vAdd;
varying vec2 vRot;
varying vec3 vGround;      // world height of this corner, half size, 1 = no ground fade
varying float vDepth;
void main() {
  float mode = floor(iA.z / 16.0 + 0.01);
  float cell = iA.z - mode * 16.0;
  vec2 c = position.xy;
  float size = iA.x, alpha = iA.w;
  vec3 centre = mode > 0.5 && mode < 1.5 ? iPos - iAxis * 0.5 : iPos;
  vec4 mv = viewMatrix * vec4(centre, 1.0);
  // never thinner than about a pixel and a half: a far spark dims instead of flickering in and out
  float minS = uPx * max(0.05, -mv.z) * 0.75;
  if (size < minS) { alpha *= max(0.15, size / minS); size = minS; }
  float cs = cos(iA.y), sn = sin(iA.y);
  vRot = vec2(1.0, 0.0);
  float wy = centre.y;
  float noFade = 0.0;
  if (mode > 1.5) {                      // lying flat on the ground
    vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
    mv = viewMatrix * vec4(centre + vec3(r.x, 0.0, r.y), 1.0);
    noFade = 1.0;
  } else if (mode > 0.5) {               // stretched along its motion, as seen from here
    vec3 ax = (viewMatrix * vec4(iAxis, 0.0)).xyz * 0.5;
    float l = length(ax.xy);
    vec2 d = l > 1e-6 ? ax.xy / l : vec2(0.0, 1.0);
    vec2 o = d * (c.y * (l + size)) + vec2(-d.y, d.x) * (c.x * size);
    mv.xy += o;
    wy += dot(vec2(viewMatrix[0].y, viewMatrix[1].y), o);
  } else {                               // facing the camera, turned by its own angle
    vec2 o = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
    mv.xy += o;
    wy += dot(vec2(viewMatrix[0].y, viewMatrix[1].y), o);
    vRot = vec2(cs, sn);
  }
  vGround = vec3(wy, size, noFade);
  vUv = (vec2(mod(cell, 4.0), floor(cell / 4.0)) + c * 0.5 + 0.5) * 0.25;
  vCol = vec4(iB.rgb, alpha);
  vAdd = iB.a;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const SPRITE_FS = `
uniform sampler2D uAtlas;
uniform vec3 uSun;         // sun colour reaching a surface
uniform vec3 uSunDir;      // towards the sun, in view space
uniform vec3 uAmb;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec4 vCol;
varying float vAdd;
varying vec2 vRot;
varying vec3 vGround;
varying float vDepth;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  // sink softly into the floor instead of being cut off by it
  float ground = max(vGround.z, smoothstep(-0.3 * vGround.y, 0.6 * vGround.y, vGround.x));
  float a = t.a * vCol.a * ground;
  if (a < 0.003) discard;
  vec2 n2 = (t.gb - 0.5) * 2.0;
  n2 = vec2(n2.x * vRot.x - n2.y * vRot.y, n2.x * vRot.y + n2.y * vRot.x);
  vec3 n = vec3(n2, sqrt(max(0.0, 1.0 - dot(n2, n2))));
  float wrap = clamp(dot(n, uSunDir) * 0.6 + 0.4, 0.0, 1.0);          // light wraps round a cloud
  float back = clamp(-uSunDir.z, 0.0, 1.0);                           // looking into the sun: it shines through, brightest where thin
  vec3 light = uAmb + uSun * (wrap + back * back * 1.5 * (1.0 - t.a));
  vec3 lit = vCol.rgb * t.r * light + smoothstep(0.86, 1.0, t.r) * (uSun + uAmb) * 0.6;   // (wet highlight on droplets)
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  lit = mix(lit, uFogColor, fog);
  vec3 col = mix(lit, vCol.rgb * t.r, vAdd);
  gl_FragColor = vec4(col * a, a * (1.0 - vAdd));
}`;

// what a sprite does while it lives
const K_SOFT = 0, K_BLOOD = 1, K_SPARK = 2, K_EMBER = 3, K_FLASH = 4, K_DROP = 5, K_DEBRIS = 6;
// per-sprite state
const SP = 24, PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, LIFE = 6, MAX = 7, SIZE = 8, GROW = 9, ROT = 10, SPIN = 11, CELLF = 12,
  A0 = 13, CR = 14, CG = 15, CB = 16, GRAV = 17, DRAG = 18, KIND = 19, STREAK = 20, ADD = 21, AUX = 22, MODE = 23;
const GS = 14;      // floats per sprite sent to the GPU

class Sprites {
  constructor(scene, cap) {
    this.cap = cap;
    this.count = 0;
    this.S = new Float32Array(cap * SP);
    this.G = new Float32Array(cap * GS);
    this.steal = 0;
    this.busy = false;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = new THREE.InstancedInterleavedBuffer(this.G, GS).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    g.setAttribute('iAxis', new THREE.InterleavedBufferAttribute(this.buf, 3, 3));
    g.setAttribute('iA', new THREE.InterleavedBufferAttribute(this.buf, 4, 6));
    g.setAttribute('iB', new THREE.InterleavedBufferAttribute(this.buf, 4, 10));
    g.instanceCount = 0;
    this.geo = g;
    this.uniforms = {
      uAtlas: { value: makeSpriteAtlas() }, uPx: { value: 0.0016 },
      uSun: { value: new THREE.Color(0.6, 0.45, 0.3) }, uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
      uAmb: { value: new THREE.Color(0.25, 0.22, 0.25) }, uFogColor: { value: new THREE.Color(0, 0, 0) }, uFogDensity: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VS, fragmentShader: SPRITE_FS, uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.pxH = 720;
    this.sun = null; this.hemi = null; this.scan = 0;
    // the light the scene has right now, and the size of a pixel, are read at draw time
    this.mesh.onBeforeRender = (renderer, sc, camera) => {
      const u = this.uniforms;
      if ((!this.sun || !this.sun.parent) && this.scan-- <= 0) {
        this.scan = 240; this.sun = this.hemi = null;
        sc.traverse((o) => { if (o.isDirectionalLight && !this.sun) this.sun = o; else if (o.isHemisphereLight && !this.hemi) this.hemi = o; });
      }
      if (this.sun) {
        u.uSun.value.copy(this.sun.color).multiplyScalar(this.sun.intensity / Math.PI);
        _v.setFromMatrixPosition(this.sun.matrixWorld).sub(_p.setFromMatrixPosition(this.sun.target.matrixWorld));
        if (_v.lengthSq() > 1e-8) u.uSunDir.value.copy(_v).transformDirection(camera.matrixWorldInverse);
      }
      if (this.hemi) u.uAmb.value.copy(this.hemi.color).add(this.hemi.groundColor).multiplyScalar(this.hemi.intensity * 0.5 * 3.2 / Math.PI);
      if (sc.fog?.isFogExp2) { u.uFogColor.value.copy(sc.fog.color); u.uFogDensity.value = sc.fog.density; } else u.uFogDensity.value = 0;
      if (camera.isPerspectiveCamera) u.uPx.value = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(120, this.pxH);
    };
    scene.add(this.mesh);
  }

  /** How full the pool is, as a factor for how much more to emit (1 while there is room, down to 0.3). */
  room() { const l = this.count / this.cap; return l < 0.5 ? 1 : Math.max(0.3, 1.5 - l); }

  /**
   * A new sprite; returns where its state starts in `S` (the caller fills in what differs from the defaults)
   * or -1 if the input is not finite. A full pool recycles a slot, except in the middle of an update.
   */
  spawn(kind, x, y, z, vx, vy, vz, life) {
    if (!(fin(x) && fin(y) && fin(z) && fin(vx) && fin(vy) && fin(vz) && life > 0 && fin(life))) return -1;
    let i;
    if (this.count < this.cap) i = this.count++;
    else if (this.busy) return -1;
    else { i = this.steal; this.steal = (this.steal + 61) % this.cap; }
    const S = this.S, o = i * SP;
    S[o + PX] = x; S[o + PY] = y; S[o + PZ] = z; S[o + VX] = vx; S[o + VY] = vy; S[o + VZ] = vz;
    S[o + LIFE] = S[o + MAX] = life;
    S[o + SIZE] = 0.1; S[o + GROW] = 0; S[o + ROT] = Math.random() * TAU; S[o + SPIN] = 0; S[o + CELLF] = 0;
    S[o + A0] = 1; S[o + CR] = S[o + CG] = S[o + CB] = 1; S[o + GRAV] = 0; S[o + DRAG] = 0;
    S[o + KIND] = kind; S[o + STREAK] = 0; S[o + ADD] = 0; S[o + AUX] = 0; S[o + MODE] = 0;
    return o;
  }

  update(dt, fx) {
    const S = this.S, G = this.G;
    let w = 0;
    this.busy = true;
    for (let i = 0; i < this.count; i++) {
      const o = i * SP;
      let life = S[o + LIFE] - dt;
      const kind = S[o + KIND];
      if (life > 0) {
        const dr = Math.exp(-S[o + DRAG] * dt);
        S[o + VX] *= dr; S[o + VY] = S[o + VY] * dr - S[o + GRAV] * dt; S[o + VZ] *= dr;
        S[o + PX] += S[o + VX] * dt; S[o + PY] += S[o + VY] * dt; S[o + PZ] += S[o + VZ] * dt;
        S[o + SIZE] = Math.max(0, S[o + SIZE] + S[o + GROW] * dt);
        S[o + ROT] += S[o + SPIN] * dt;
        if (!(fin(S[o + PX]) && fin(S[o + PY]) && fin(S[o + PZ]))) life = 0;
        else if (kind !== K_SOFT && kind !== K_FLASH && S[o + VY] < 0) {
          const fl = fx.floorAt(S[o + PX], S[o + PZ], S[o + PY] - S[o + VY] * dt);      // (asked from where it was a moment ago: it may have passed through the top since)
          if (S[o + PY] < fl + 0.012) life = fx.landed(S, o, kind, life, fl);
        }
      }
      if (life <= 0) continue;
      S[o + LIFE] = life;
      if (w !== i) S.copyWithin(w * SP, o, o + SP);
      const s = w * SP, g = w * GS, f = life / S[s + MAX];
      let a = S[s + A0], r = S[s + CR], gg = S[s + CG], b = S[s + CB], size = S[s + SIZE];
      if (kind === K_SOFT) a *= f * Math.min(1, (1 - f) * 8 + 0.2);
      else if (kind === K_FLASH) a *= f;
      else if (kind === K_SPARK || kind === K_EMBER) {
        // cooling metal: white-yellow, then orange, then a dull red
        let t = f * S[s + AUX];
        if (kind === K_EMBER) { t *= 0.5; a *= 0.55 + 0.45 * Math.sin(fx.time * 31 + i * 1.7); }
        if (t > 0.55) { const k = Math.min(1, (t - 0.55) / 0.3); r = 5 + 2 * k; gg = 1.9 + 3.6 * k; b = 0.3 + 2.7 * k; }
        else { const k = t / 0.55; r = 1.4 + 3.6 * k; gg = 0.12 + 1.78 * k; b = 0.02 + 0.28 * k; }
        a *= Math.min(1, f * 5);
        size *= 0.55 + 0.45 * f;
      } else a *= Math.min(1, f * 6);
      if (!fin(a + r + gg + b + size + S[s + ROT])) continue;      // (whatever got in: never hand the GPU a non-number)
      G[g] = S[s + PX]; G[g + 1] = S[s + PY]; G[g + 2] = S[s + PZ];
      const st = S[s + STREAK];
      let mode = S[s + MODE];
      if (st > 0) { G[g + 3] = S[s + VX] * st; G[g + 4] = S[s + VY] * st; G[g + 5] = S[s + VZ] * st; mode = 1; } else G[g + 3] = G[g + 4] = G[g + 5] = 0;
      G[g + 6] = size; G[g + 7] = S[s + ROT]; G[g + 8] = S[s + CELLF] + 16 * mode; G[g + 9] = a;
      G[g + 10] = r; G[g + 11] = gg; G[g + 12] = b; G[g + 13] = S[s + ADD];
      w++;
    }
    this.busy = false;
    this.count = w;
    this.geo.instanceCount = w;
    this.mesh.visible = w > 0;
    if (w > 0) {
      this.buf.clearUpdateRanges?.();
      this.buf.addUpdateRange?.(0, w * GS);
      this.buf.needsUpdate = true;
    }
  }

  clear() { this.count = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

/** The old soft-particle interface (`effects.mist.emit`, `effects.glow.emit`), now feeding the sprite layer. */
class SoftEmitter {
  constructor(sprites, additive) { this.sprites = sprites; this.additive = additive; }
  emit(p, v, { size = 0.2, grow = 0.5, life = 1, alpha = 0.6, color = 0xffffff, grav = 0, drag = 1, cell = -1 } = {}) {
    if (!finV(p) || !finV(v)) return;
    const sp = this.sprites, o = sp.spawn(K_SOFT, p.x, p.y, p.z, v.x, v.y, v.z, life);
    if (o < 0) return;
    const S = sp.S;
    _c.set(color);
    S[o + CR] = _c.r; S[o + CG] = _c.g; S[o + CB] = _c.b;
    // (sizes here are diameters of a blob that is mostly transparent towards its rim)
    S[o + SIZE] = (fin(size) ? size : 0.2) * 0.62; S[o + GROW] = (fin(grow) ? grow : 0) * 0.62;
    S[o + A0] = fin(alpha) ? alpha : 0.5; S[o + GRAV] = fin(grav) ? grav : 0; S[o + DRAG] = fin(drag) ? drag : 0;
    S[o + CELLF] = cell >= 0 ? cell : pick(C_CLOUD);
    S[o + SPIN] = rand(-0.7, 0.7);
    if (this.additive) { S[o + ADD] = 1; S[o + CR] *= 1.25; S[o + CG] *= 1.25; S[o + CB] *= 1.25; } else S[o + A0] *= 1.15;
  }
}

// ------------------------------------------------------------------ chips (small tumbling solids)
const CH = 24, C_LIFE = 6, C_MAX = 7, C_SX = 8, C_Q = 11, C_AX = 15, C_SPIN = 18, C_KIND = 19, C_COL = 20, C_REST = 23;
const CHIP_WOOD = 0, CHIP_GORE = 1, CHIP_STONE = 2;

function makeChipGeometry() {
  // a knocked-about icosahedron: every corner pushed in or out, the same way for each face that shares it
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.attributes.position, seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, rr(0.55, 1.2));
    const k = seen.get(key);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

class Chips {
  constructor(scene, cap) {
    this.cap = cap; this.count = 0; this.steal = 0;
    this.S = new Float32Array(cap * CH);
    this.mesh = new THREE.InstancedMesh(makeChipGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, flatShading: true }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  spawn(kind, x, y, z, vx, vy, vz, life, sx, sy, sz, r, g, b) {
    if (!(fin(x) && fin(y) && fin(z) && fin(vx) && fin(vy) && fin(vz) && fin(r) && fin(g) && fin(b))) return;
    let i;
    if (this.count < this.cap) i = this.count++;
    else { i = this.steal; this.steal = (this.steal + 37) % this.cap; }
    const S = this.S, o = i * CH;
    S[o] = x; S[o + 1] = y; S[o + 2] = z; S[o + 3] = vx; S[o + 4] = vy; S[o + 5] = vz;
    S[o + C_LIFE] = S[o + C_MAX] = life;
    S[o + C_SX] = sx; S[o + C_SX + 1] = sy; S[o + C_SX + 2] = sz;
    _q.set(rand(-1, 1), rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    S[o + C_Q] = _q.x; S[o + C_Q + 1] = _q.y; S[o + C_Q + 2] = _q.z; S[o + C_Q + 3] = _q.w;
    _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    S[o + C_AX] = _v.x; S[o + C_AX + 1] = _v.y; S[o + C_AX + 2] = _v.z;
    S[o + C_SPIN] = rand(8, 30); S[o + C_KIND] = kind;
    S[o + C_COL] = r; S[o + C_COL + 1] = g; S[o + C_COL + 2] = b; S[o + C_REST] = 0;
  }
  update(dt, fx) {
    const S = this.S, M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array;
    let w = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * CH;
      const life = S[o + C_LIFE] - dt;
      if (!(life > 0) || !(fin(S[o]) && fin(S[o + 1]) && fin(S[o + 2]))) continue;
      S[o + C_LIFE] = life;
      if (!S[o + C_REST]) {
        S[o + 4] -= 9.8 * dt;
        S[o] += S[o + 3] * dt; S[o + 1] += S[o + 4] * dt; S[o + 2] += S[o + 5] * dt;
        _q.set(S[o + C_Q], S[o + C_Q + 1], S[o + C_Q + 2], S[o + C_Q + 3]);
        _q2.setFromAxisAngle(_v.set(S[o + C_AX], S[o + C_AX + 1], S[o + C_AX + 2]), S[o + C_SPIN] * dt);
        _q.premultiply(_q2).normalize();
        S[o + C_Q] = _q.x; S[o + C_Q + 1] = _q.y; S[o + C_Q + 2] = _q.z; S[o + C_Q + 3] = _q.w;
        const base = S[o + 4] < 0 ? fx.floorAt(S[o], S[o + 2], S[o + 1] - S[o + 4] * dt) : 0;
        const floor = base + Math.min(S[o + C_SX], S[o + C_SX + 2]) * 0.8 + 0.003;
        if (S[o + 1] < floor && S[o + 4] < 0) {
          if (S[o + C_KIND] === CHIP_GORE && S[o + 4] < -1.5) fx.stain(S[o], S[o + 2], rand(0.1, 0.25), 0, 0, 1, D_POOL, base);
          S[o + 1] = floor;
          if (S[o + 4] > -0.9) { S[o + C_REST] = 1; S[o + 3] = S[o + 4] = S[o + 5] = 0; }      // comes to lie where it is
          else { S[o + 3] *= 0.5; S[o + 4] *= -rand(0.2, 0.4); S[o + 5] *= 0.5; S[o + C_SPIN] *= 0.6; }
        }
      }
      if (w !== i) S.copyWithin(w * CH, o, o + CH);
      const s = w * CH, k = Math.min(1, life / 0.3);
      _q.set(S[s + C_Q], S[s + C_Q + 1], S[s + C_Q + 2], S[s + C_Q + 3]);
      _m.compose(_p.set(S[s], S[s + 1], S[s + 2]), _q, _s.set(S[s + C_SX] * k, S[s + C_SX + 1] * k, S[s + C_SX + 2] * k));
      _m.toArray(M, w * 16);
      C[w * 3] = S[s + C_COL]; C[w * 3 + 1] = S[s + C_COL + 1]; C[w * 3 + 2] = S[s + C_COL + 2];
      w++;
    }
    this.count = w;
    this.mesh.count = w;
    this.mesh.visible = w > 0;
    if (w > 0) {
      const im = this.mesh.instanceMatrix, ic = this.mesh.instanceColor;
      im.clearUpdateRanges?.(); im.addUpdateRange?.(0, w * 16); im.needsUpdate = true;
      ic.clearUpdateRanges?.(); ic.addUpdateRange?.(0, w * 3); ic.needsUpdate = true;
    }
  }
  clear() { this.count = 0; this.mesh.count = 0; this.mesh.visible = false; }
}

// ------------------------------------------------------------------ weapon trails
const TRAIL_VS = `
attribute vec3 color;
attribute vec2 tr;         // across the ribbon (0 inner edge .. 1 tip), age (0 newest .. 1 oldest)
varying vec3 vCol;
varying vec2 vTr;
void main() {
  vCol = color; vTr = tr;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const TRAIL_FS = `
varying vec3 vCol;
varying vec2 vTr;
void main() {
  float age = vTr.y;
  // the ribbon narrows towards its tail: the inner edge closes in on the path of the tip
  float inner = mix(0.05, 0.9, age);
  float w = (vTr.x - inner) / (1.0 - inner);
  if (w <= 0.0) discard;
  float body = smoothstep(0.0, 1.0, w); body *= body * body;
  float line = exp(-pow((w - 0.9) / 0.06, 2.0));                               // the path of the edge itself
  float streaks = 0.7 + 0.3 * sin(vTr.x * 83.0 + sin(vTr.x * 29.0) * 4.0);     // drawn out along the sweep
  float edge = smoothstep(1.0, 0.94, w);
  float along = pow(1.0 - age, 1.7) * smoothstep(0.0, 0.05, age);
  float k = (body * 0.55 * streaks + line * 1.25) * edge * along;
  // air bent by the blade: a cool fringe outside, warm inside
  vec3 col = vCol * k * mix(vec3(1.12, 0.98, 0.84), vec3(0.84, 0.98, 1.2), w);
  gl_FragColor = vec4(col, 1.0);
}`;
let trailMat = null;

class Trail {
  constructor(owner, scene, color, n = 18, sub = 3) {
    this.owner = owner;
    this.n = n; this.sub = sub;
    this.base = []; this.tip = [];
    for (let i = 0; i < n; i++) { this.base.push(new THREE.Vector3()); this.tip.push(new THREE.Vector3()); }
    this.int = new Float32Array(n);
    this.len = 0;
    const verts = (n - 1) * sub + 1;
    this.verts = verts;
    this.pos = new Float32Array(verts * 2 * 3);
    this.col = new Float32Array(verts * 2 * 3);
    const tr = new Float32Array(verts * 2 * 2);
    const idx = [];
    for (let i = 0; i < verts; i++) {
      tr[i * 4] = 0; tr[i * 4 + 1] = tr[i * 4 + 3] = i / (verts - 1); tr[i * 4 + 2] = 1;
      if (i < verts - 1) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tr', new THREE.BufferAttribute(tr, 2));
    g.setIndex(idx);
    this.color = new THREE.Color(color);
    trailMat ??= new THREE.ShaderMaterial({
      vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, trailMat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.scene = scene;
    // blood on the blade (for drips and cast-off), and where the blade is and how it moves
    this.wet = 0; this.fresh = false; this.dripAcc = 0;
    this.tipVel = new THREE.Vector3();
    scene.add(this.mesh);
  }
  push(base, tip, intensity) {
    if (!finV(base) || !finV(tip)) return;
    if (!fin(intensity)) intensity = 0;
    // newest first: the oldest pair of points is reused for the newest
    const b = this.base.pop(), t = this.tip.pop();
    if (this.len > 0) this.tipVel.copy(tip).sub(this.tip[0]); else this.tipVel.set(0, 0, 0);
    this.base.unshift(b.copy(base)); this.tip.unshift(t.copy(tip));
    this.int.copyWithin(1, 0, this.n - 1); this.int[0] = intensity;
    if (this.len < this.n) this.len++;
    this.fresh = true;
    let hot = false;
    for (let i = 0; i < this.len; i++) if (this.int[i] > 0.002) { hot = true; break; }
    this.mesh.visible = hot;
    if (hot) this.rebuild();
  }
  rebuild() {
    const L = this.len;
    let v = 0;
    const cr = (p0, p1, p2, p3, t, out) => {
      const t2 = t * t, t3 = t2 * t;
      return out.set(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      );
    };
    const pos = this.pos, col = this.col, c = this.color;
    for (let i = 0; i < this.n - 1; i++) {
      for (let s = 0; s < this.sub; s++) {
        if (i === this.n - 2 && s > 0) break;
        const t = s / this.sub;
        if (i + 1 >= L) { col.fill(0, v * 6, v * 6 + 6); v++; continue; }
        const i0 = Math.max(0, i - 1), i2 = Math.min(L - 1, i + 1), i3 = Math.min(L - 1, i + 2);
        cr(this.base[i0], this.base[i], this.base[i2], this.base[i3], t, _p);
        pos[v * 6] = _p.x; pos[v * 6 + 1] = _p.y; pos[v * 6 + 2] = _p.z;
        cr(this.tip[i0], this.tip[i], this.tip[i2], this.tip[i3], t, _p);
        pos[v * 6 + 3] = _p.x; pos[v * 6 + 4] = _p.y; pos[v * 6 + 5] = _p.z;
        const k = this.int[i] * (1 - t) + this.int[i2] * t;
        col[v * 6] = col[v * 6 + 3] = c.r * k; col[v * 6 + 1] = col[v * 6 + 4] = c.g * k; col[v * 6 + 2] = col[v * 6 + 5] = c.b * k;
        v++;
      }
    }
    for (; v < this.verts; v++) col.fill(0, v * 6, v * 6 + 6);
    const a = this.mesh.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = true;
  }
  dispose() { this.owner?.trails.delete(this); this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}

// ------------------------------------------------------------------ the effects themselves
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.noBlood = false;

    this.sprites = new Sprites(scene, 4096);
    this.chips = new Chips(scene, 1024);
    this.mist = new SoftEmitter(this.sprites, false);
    this.glow = new SoftEmitter(this.sprites, true);

    // blood stains on the floor: a ring of 700, the oldest is painted over
    this.decalN = 700;
    this.decalNext = 0;
    this.decalHigh = 0;
    this.decalBudget = 0;
    this.decalTime = { value: 0 };
    const stains = makeStainAtlas();
    const dg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decalAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.decalN * 4), 4).setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute('aDecal', this.decalAttr);      // atlas cell offset (x, y), time of birth, tone
    const dm = new THREE.MeshStandardMaterial({
      bumpMap: stains, bumpScale: 1.6, transparent: true, depthWrite: false, roughness: 0.15, metalness: 0,
      color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2,
    });
    dm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.decalTime;
      sh.vertexShader = `attribute vec4 aDecal;\nuniform float uTime;\nvarying vec2 vStain;\n${sh.vertexShader}`
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vBumpMapUv = uv * 0.25 + aDecal.xy;
          vStain = vec2(uTime - aDecal.z, aDecal.w);`)
        // it hits and spreads: most of its size within a fifth of a second, the rest creeping out as it soaks in
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float stAge = max(0.0, uTime - aDecal.z);
          transformed.xz *= mix(0.45, 0.94, 1.0 - exp(-stAge * 14.0)) + 0.06 * (1.0 - exp(-stAge * 0.5));`);
      sh.fragmentShader = `varying vec2 vStain;\n${sh.fragmentShader}`
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 stain = texture2D(bumpMap, vBumpMapUv);
          float dry = 1.0 - exp(-max(0.0, vStain.x) * 0.1);
          // fresh: bright and wet; later: dark, brown, sunk into the ground (thin edges dry first)
          float dryHere = clamp(dry * (1.6 - 0.6 * stain.r), 0.0, 1.0);
          diffuseColor.rgb = mix(vec3(0.27, 0.005, 0.007), vec3(0.05, 0.009, 0.006), dryHere) * vStain.y * (1.15 - 0.4 * stain.r);
          diffuseColor.a *= stain.a * mix(0.6, 1.0, stain.r) * mix(0.96, 0.82, dry);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(0.07, 0.62, dryHere);`);
    };
    dm.customProgramCacheKey = () => 'blood-stain';
    this.decalMesh = new THREE.InstancedMesh(dg, dm, this.decalN);
    this.decalMesh.receiveShadow = true;
    this.decalMesh.frustumCulled = false;
    this.decalMesh.renderOrder = 1;
    this.decalMesh.count = 0; this.decalMesh.visible = false;
    scene.add(this.decalMesh);

    this.flash = new THREE.PointLight(0xffb060, 0, 8, 2);
    scene.add(this.flash);
    this.flashI = 0;
    this.spurts = [];
    this.trails = new Set();
  }

  createTrail(color) {
    const t = new Trail(this, this.scene, color);
    this.trails.add(t);
    return t;
  }

  // ---------------------------------------------------------------- blood
  /** One flying drop of blood (stretched along its flight by the shader). */
  _drop(x, y, z, vx, vy, vz, size, life, secondary = 0) {
    const sp = this.sprites, o = sp.spawn(K_BLOOD, x, y, z, vx, vy, vz, life);
    if (o < 0) return;
    const S = sp.S;
    S[o + SIZE] = size; S[o + CELLF] = pick(C_DROP); S[o + STREAK] = 0.02 + size * 0.5;
    S[o + CR] = rand(0.3, 0.52); S[o + CG] = 0.004; S[o + CB] = 0.01;
    S[o + GRAV] = 9.8; S[o + DRAG] = 0.35 + 0.004 / size;      // fine drops are slowed more by the air
    S[o + AUX] = secondary;
  }

  /** Droplets that streak along their velocity, with a fine spray at the wound. */
  blood(point, dir, count, force = 1) {
    if (this.noBlood || !finV(point) || !finV(dir) || !fin(count) || !fin(force)) return;
    const room = this.sprites.room();
    count = Math.min(220, Math.round(count));
    const n = Math.round(count * room);
    for (let k = 0; k < n; k++) {
      // mostly fine drops, a few heavy ones; the fine ones leave faster
      const big = Math.random() ** 3, size = 0.0045 + 0.02 * big;
      const sp = rand(1, 5.5) * force * (1.15 - 0.4 * big);
      this._drop(point.x + rand(-0.02, 0.02), point.y + rand(-0.02, 0.02), point.z + rand(-0.02, 0.02),
        dir.x * sp * 0.7 + rand(-1.8, 1.8), dir.y * sp * 0.4 + rand(0.3, 3.4), dir.z * sp * 0.7 + rand(-1.8, 1.8),
        size, rand(0.8, 1.7));
    }
    if (count >= 5) {
      const S = this.sprites.S, mists = Math.min(9, 1 + count / 12) * room;
      for (let k = 0; k < mists; k++) {
        // spray: a burst of pin-point drops thrown out along the cut ...
        const sp = rand(1.5, 5) * Math.min(1.6, force);
        let o = this.sprites.spawn(K_SOFT, point.x, point.y, point.z, dir.x * sp + rand(-1.2, 1.2), dir.y * sp * 0.5 + rand(-0.2, 1.4), dir.z * sp + rand(-1.2, 1.2), rand(0.3, 0.6));
        if (o >= 0) {
          S[o + SIZE] = rand(0.04, 0.09); S[o + GROW] = rand(0.35, 0.8); S[o + CELLF] = pick(C_SPRAY); S[o + A0] = 0.95;
          S[o + CR] = rand(0.32, 0.5); S[o + CG] = 0.005; S[o + CB] = 0.01; S[o + GRAV] = 2.5; S[o + DRAG] = 5; S[o + SPIN] = rand(-2, 2);
        }
        // ... and a thin red haze that hangs for a moment
        if (k % 2) continue;
        o = this.sprites.spawn(K_SOFT, point.x, point.y, point.z, dir.x * rand(0.3, 1.2) + rand(-0.4, 0.4), rand(0, 0.6), dir.z * rand(0.3, 1.2) + rand(-0.4, 0.4), rand(0.5, 1.0));
        if (o >= 0) {
          S[o + SIZE] = rand(0.05, 0.11); S[o + GROW] = rand(0.2, 0.4); S[o + CELLF] = pick(C_CLOUD); S[o + A0] = 0.42;
          S[o + CR] = 0.36; S[o + CG] = 0.008; S[o + CB] = 0.014; S[o + GRAV] = 0.3; S[o + DRAG] = 2.5; S[o + SPIN] = rand(-1, 1);
        }
      }
      // a blade passing through the wound comes away wet
      for (const t of this.trails) {
        if (!t.fresh || t.len < 1) continue;
        const b = t.base[0], d = _v.copy(t.tip[0]).sub(b), l2 = d.lengthSq();
        const u = l2 > 1e-6 ? clamp01(_p.copy(point).sub(b).dot(d) / l2) : 0;
        if (_p.copy(b).addScaledVector(d, u).distanceToSquared(point) < 0.1) t.wet = Math.min(1, t.wet + count / 50);
      }
    }
  }

  /** Chunks of flesh/armour flying off a severed limb. */
  gore(point, dir, count) {
    if (this.noBlood || !finV(point) || !finV(dir) || !fin(count)) return;
    count = Math.min(60, count);
    for (let k = 0; k < count; k++) {
      const s = rand(0.012, 0.03);
      this.chips.spawn(CHIP_GORE, point.x, point.y, point.z, dir.x * rand(1, 4) + rand(-2, 2), rand(1, 4.5), dir.z * rand(1, 4) + rand(-2, 2),
        rand(1.6, 3), s, s * rand(0.6, 1.3), s * rand(0.7, 1.2), rand(0.2, 0.36), rand(0.004, 0.03), 0.02);
    }
  }

  /** Arterial spray from a stump: pulsing jet for a few seconds. */
  addSpurt(getPos, getDir, duration = 5) {
    if (this.noBlood || typeof getPos !== 'function' || typeof getDir !== 'function') return;
    this.spurts.push({ getPos, getDir, t: 0, duration: fin(duration) ? duration : 5, acc: 0 });
    if (this.spurts.length > 12) this.spurts.shift();
  }

  /**
   * A stain on the floor. `dx, dz` (optional) is the direction the blood was travelling, `stretch` how much longer
   * than wide it lands (a drop coming in flat leaves a long mark with a tail).
   */
  stain(x, z, size, dx = 0, dz = 0, stretch = 1, cells = D_POOL, y = 0) {
    if (this.noBlood || !(fin(x) && fin(z) && size > 0 && fin(size))) return;
    if (this.solidAt && !this.solidAt(x, z)) return;      // nothing to stain out over the edge
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % this.decalN;
    if (this.decalHigh < this.decalNext || this.decalNext === 0) this.decalHigh = this.decalNext === 0 ? this.decalN : this.decalNext;
    const dirOk = fin(dx) && fin(dz) && dx * dx + dz * dz > 1e-8;
    _q.setFromAxisAngle(Y, dirOk ? Math.atan2(-dx, -dz) : Math.random() * TAU);
    const st = fin(stretch) ? Math.min(5, Math.max(1, stretch)) : 1;
    if (st > 1) _s.set(size * 0.75, 1, size * st); else _s.set(size, 1, size * rand(0.7, 1.25));
    _m.compose(_p.set(x, (fin(y) ? y : 0) + 0.004 + i * 0.00001, z), _q, _s);
    this.decalMesh.setMatrixAt(i, _m);
    const cell = pick(cells), a = this.decalAttr.array;
    a[i * 4] = (cell % GRID) / GRID; a[i * 4 + 1] = Math.floor(cell / GRID) / GRID; a[i * 4 + 2] = this.decalTime.value; a[i * 4 + 3] = rand(0.75, 1.1);
    this.decalAttr.needsUpdate = true;
    this.decalMesh.instanceMatrix.needsUpdate = true;
    this.decalMesh.count = this.decalHigh;
    this.decalMesh.visible = true;
  }

  /** A pool-shaped stain of the given size (see `stain` for marks with a direction). `y`: how high the body it runs from lies. */
  decal(x, z, size, y = 0) { this.stain(x, z, size * 1.25, 0, 0, 1, D_POOL, y > 0.3 ? this.floorAt(x, z, y) : 0); }

  /** Height of whatever lies under a point at height `y` (the floor, or the top of something that can be stood on). */
  floorAt(x, z, y) {
    if (!this.surfaceAt || !(y > 0.3)) return 0;
    const f = this.surfaceAt(x, z, y);
    return fin(f) && f > 0 ? f : 0;
  }

  /** A sprite has reached the floor (at height `fl`); returns the life it has left (0 = gone). */
  landed(S, o, kind, life, fl = 0) {
    if (kind === K_BLOOD) {
      const s = S[o + SIZE], vx = S[o + VX], vy = S[o + VY], vz = S[o + VZ], h = Math.hypot(vx, vz);
      if (this.decalBudget > 0 && (s > 0.009 || Math.random() < 0.55)) {
        this.decalBudget--;
        const flat = h / Math.max(0.5, -vy);          // how flat it came in
        if (flat > 0.55) this.stain(S[o + PX], S[o + PZ], s * rand(9, 15), vx, vz, Math.min(4.5, 1 + flat * 1.4), D_STREAK, fl);
        else if (s < 0.009) this.stain(S[o + PX], S[o + PZ], s * rand(14, 26), 0, 0, 1, D_SPATTER, fl);
        else this.stain(S[o + PX], S[o + PZ], s * rand(9, 16), 0, 0, 1, Math.random() < 0.5 ? D_DRIP : D_POOL, fl);
      }
      // a heavy drop throws up a crown of small ones
      if (s > 0.013 && vy < -2.5 && !S[o + AUX]) {
        const x = S[o + PX], z = S[o + PZ];
        for (let k = 0, n = 2 + (Math.random() * 3 | 0); k < n; k++) {
          this._drop(x, fl + 0.02, z, vx * 0.25 + rand(-0.9, 0.9), rand(0.6, 1.6), vz * 0.25 + rand(-0.9, 0.9), s * rand(0.22, 0.4), rand(0.3, 0.6), 1);
        }
      }
      return 0;
    }
    if (kind === K_DROP) return 0;
    if (kind === K_EMBER) {       // lies where it fell and burns out
      S[o + PY] = fl + 0.008; S[o + VX] = S[o + VY] = S[o + VZ] = 0; S[o + GRAV] = 0;
      return life;
    }
    // sparks and debris skip off the ground, losing heat; a hot one may burst in two
    S[o + PY] = fl + 0.012;
    S[o + VY] *= -rand(0.3, 0.6); S[o + VX] *= 0.62; S[o + VZ] *= 0.62;
    if (kind === K_SPARK && S[o + AUX] > 0.75 && life > 0.12 && Math.random() < 0.3) {
      const c = this.sprites.spawn(K_SPARK, S[o + PX], fl + 0.014, S[o + PZ], S[o + VX] + rand(-1.2, 1.2), S[o + VY] * rand(0.5, 1.3), S[o + VZ] + rand(-1.2, 1.2), life * rand(0.5, 0.9));
      if (c >= 0) { S[c + SIZE] = S[o + SIZE] * 0.7; S[c + CELLF] = C_STREAK; S[c + STREAK] = 0.03; S[c + ADD] = 1; S[c + GRAV] = 7; S[c + DRAG] = 1; S[c + AUX] = S[o + AUX] * 0.8; }
    }
    S[o + AUX] *= 0.85;
    return life * 0.8;
  }

  // ---------------------------------------------------------------- wood, stone, dust
  splinters(point, dir, count, r = 0.32, g = 0.2, b = 0.1) {
    if (!finV(point) || !finV(dir) || !fin(count) || !fin(r + g + b)) return;
    const S = this.sprites.S;
    count = Math.min(80, Math.round(count));
    if (b >= r && r > 0.6) {
      // something pale and bluish is no wood but a splash (the sake of a broken barrel): drops, not chips
      for (let k = 0; k < count; k++) {
        const o = this.sprites.spawn(K_DROP, point.x + rand(-0.1, 0.1), point.y + rand(-0.05, 0.1), point.z + rand(-0.1, 0.1),
          dir.x * 2 + rand(-2.5, 2.5), rand(0.5, 4), dir.z * 2 + rand(-2.5, 2.5), rand(0.8, 1.6));
        if (o < 0) continue;
        S[o + SIZE] = 0.005 + 0.016 * Math.random() ** 2; S[o + CELLF] = pick(C_DROP); S[o + STREAK] = 0.028;
        S[o + CR] = r; S[o + CG] = g; S[o + CB] = b; S[o + A0] = 0.55; S[o + GRAV] = 9.8; S[o + DRAG] = 0.5;
      }
      return;
    }
    const dark = r + g + b < 0.45;
    for (let k = 0; k < count; k++) {
      // long thin splinters, short chunky chips, and the odd bright one (fresh wood from inside)
      const long = Math.random() < 0.6, th = rand(0.004, 0.011), tone = Math.random() < 0.2 && !dark ? rand(1.3, 1.7) : rand(0.65, 1.15);
      this.chips.spawn(dark ? CHIP_STONE : CHIP_WOOD, point.x + rand(-0.03, 0.03), point.y + rand(-0.03, 0.03), point.z + rand(-0.03, 0.03),
        dir.x * 2 + rand(-2.5, 2.5), dir.y * 1.2 + rand(0.5, 3.5), dir.z * 2 + rand(-2.5, 2.5), rand(1.8, 3.6),
        th * rand(1, 2.2), long ? rand(0.025, 0.075) : rand(0.008, 0.02), th, r * tone, g * tone, b * tone);
    }
    // the fine stuff: a breath of sawdust
    for (let k = 0, n = Math.min(4, count / 8) * this.sprites.room(); k < n; k++) {
      const o = this.sprites.spawn(K_SOFT, point.x, point.y, point.z, dir.x * rand(0.2, 1) + rand(-0.5, 0.5), rand(0.1, 0.8), dir.z * rand(0.2, 1) + rand(-0.5, 0.5), rand(0.5, 1.1));
      if (o < 0) continue;
      S[o + SIZE] = rand(0.06, 0.12); S[o + GROW] = rand(0.25, 0.5); S[o + CELLF] = pick(C_CLOUD); S[o + A0] = 0.22;
      S[o + CR] = r * 1.6 + 0.1; S[o + CG] = g * 1.6 + 0.1; S[o + CB] = b * 1.6 + 0.1; S[o + DRAG] = 2.4; S[o + GRAV] = 0.2; S[o + SPIN] = rand(-1, 1);
    }
  }

  /** Dust kicked up from the ground: low puffs rolling outward, a ring for anything heavy, grit for a hard scrape. */
  dust(point, count, spread = 1) {
    if (!finV(point) || !fin(count) || !fin(spread)) return;
    const sp = this.sprites, S = sp.S, room = sp.room();
    const gy = this.floorAt(point.x, point.z, point.y - 0.5);      // (asked for with the middle of a body: its feet are a metre lower)
    const n = Math.min(40, count) * room, heavy = count >= 8;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, v = rand(0.5, 1.9) * spread, ca = Math.cos(a), sa = Math.sin(a);
      const o = sp.spawn(K_SOFT, point.x + ca * rand(0, 0.18), gy + rand(0.04, 0.12), point.z + sa * rand(0, 0.18), ca * v, rand(0.04, 0.4), sa * v, rand(0.7, 1.5));
      if (o < 0) continue;
      const tone = rand(0.75, 1.15);
      S[o + SIZE] = rand(0.14, 0.26) * (0.85 + 0.15 * spread); S[o + GROW] = rand(0.35, 0.7); S[o + CELLF] = pick(C_CLOUD); S[o + A0] = rand(0.2, 0.38);
      S[o + CR] = 0.62 * tone; S[o + CG] = 0.53 * tone; S[o + CB] = 0.45 * tone;
      S[o + GRAV] = -0.06; S[o + DRAG] = 2.4; S[o + SPIN] = rand(-0.9, 0.9);
    }
    if (heavy) {
      // the ring that runs out along the ground from a landing
      const o = sp.spawn(K_SOFT, point.x, gy + 0.03, point.z, 0, 0, 0, rand(0.45, 0.6));
      if (o >= 0) {
        S[o + SIZE] = 0.22 * spread; S[o + GROW] = 2.1 * spread; S[o + CELLF] = C_DUSTRING; S[o + MODE] = 2; S[o + A0] = Math.min(0.5, 0.2 + count * 0.012);
        S[o + CR] = 0.6; S[o + CG] = 0.52; S[o + CB] = 0.43;
      }
    }
    if (heavy || spread >= 1.2) {
      for (let k = 0, g = Math.min(9, 1 + count / 3); k < g; k++) {
        const a = Math.random() * TAU, v = rand(0.8, 2.6) * spread, s = rand(0.004, 0.011), tone = rand(0.5, 1);
        this.chips.spawn(CHIP_STONE, point.x + Math.cos(a) * 0.1, gy + 0.03, point.z + Math.sin(a) * 0.1, Math.cos(a) * v, rand(0.6, 2.4), Math.sin(a) * v,
          rand(1.5, 3), s, s * rand(0.5, 0.9), s * rand(0.7, 1.2), 0.3 * tone, 0.27 * tone, 0.24 * tone);
      }
    }
  }

  // ---------------------------------------------------------------- steel on steel
  sparksAt(point, count, strength = 1) {
    if (!finV(point) || !fin(count) || !fin(strength)) return;
    const sp = this.sprites, S = sp.S;
    count = Math.min(90, Math.round(count));
    const n = Math.round(count * sp.room());
    // sparks leave in a sheet thrown one way, not evenly all round
    const ax = rand(-1, 1), ay = rand(0.1, 1), az = rand(-1, 1), al = Math.hypot(ax, ay, az) || 1;
    for (let k = 0; k < n; k++) {
      if (Math.random() < 0.65) _v.set(ax / al + rand(-0.5, 0.5), ay / al + rand(-0.5, 0.5), az / al + rand(-0.5, 0.5));
      else _v.set(rand(-1, 1), rand(-0.3, 1.3), rand(-1, 1));
      _v.normalize().multiplyScalar((2 + 7.5 * Math.random() ** 1.6) * strength);
      const o = sp.spawn(K_SPARK, point.x, point.y, point.z, _v.x, _v.y, _v.z, Math.random() < 0.12 ? rand(0.6, 1.0) : rand(0.16, 0.55));
      if (o < 0) continue;
      S[o + SIZE] = rand(0.0035, 0.008); S[o + CELLF] = C_STREAK; S[o + STREAK] = rand(0.022, 0.036); S[o + ADD] = 1;
      S[o + GRAV] = 7; S[o + DRAG] = rand(0.6, 1.8); S[o + AUX] = rand(0.7, 1);
    }
    // a few glowing crumbs that drift down and lie smouldering
    for (let k = 0, e = count >= 6 ? Math.min(8, count / 7) : 0; k < e; k++) {
      const o = sp.spawn(K_EMBER, point.x, point.y, point.z, rand(-1.5, 1.5) * strength, rand(0, 2.2), rand(-1.5, 1.5) * strength, rand(1.1, 2.6));
      if (o < 0) continue;
      S[o + SIZE] = rand(0.006, 0.011); S[o + CELLF] = C_EMBER; S[o + ADD] = 1; S[o + GRAV] = 5; S[o + DRAG] = 1.6; S[o + AUX] = rand(0.6, 0.95);
    }
    const big = Math.min(1, count / 8);
    let o = sp.spawn(K_FLASH, point.x, point.y, point.z, 0, 0, 0, 0.12);
    if (o >= 0) { S[o + SIZE] = 0.3 * strength; S[o + GROW] = 0.9; S[o + CELLF] = C_GLOW; S[o + ADD] = 1; S[o + A0] = 0.9 * big; S[o + CR] = 2.4; S[o + CG] = 1.5; S[o + CB] = 0.7; }
    o = sp.spawn(K_FLASH, point.x, point.y, point.z, 0, 0.2, 0, 0.35);
    if (o >= 0) { S[o + SIZE] = 0.14; S[o + GROW] = 0.25; S[o + CELLF] = C_GLOW; S[o + ADD] = 1; S[o + A0] = 0.5 * big; S[o + CR] = 1.6; S[o + CG] = 0.45; S[o + CB] = 0.1; }
    if (count >= 8) {
      o = sp.spawn(K_FLASH, point.x, point.y, point.z, 0, 0, 0, 0.075);
      if (o >= 0) { S[o + SIZE] = 0.2 * strength; S[o + GROW] = 2.5 * strength; S[o + CELLF] = C_FLARE; S[o + ADD] = 1; S[o + CR] = 4; S[o + CG] = 3.2; S[o + CB] = 2; }
    }
    this.flash.position.copy(point);
    this.flashI = Math.min(40, this.flashI + 12 * strength);
  }

  /** The white-hot instant of a heavy blow: a flare, a thin ring racing outward, flecks thrown clear. */
  impact(point, strength = 1) {
    if (!finV(point) || !fin(strength)) return;
    const sp = this.sprites, S = sp.S;
    let o = sp.spawn(K_FLASH, point.x, point.y, point.z, 0, 0, 0, 0.09);
    if (o >= 0) { S[o + SIZE] = 0.16 * strength; S[o + GROW] = 2.2 * strength; S[o + CELLF] = C_FLARE; S[o + ADD] = 1; S[o + A0] = 0.9; S[o + CR] = 2.6; S[o + CG] = 2.3; S[o + CB] = 1.9; }
    o = sp.spawn(K_FLASH, point.x, point.y, point.z, 0, 0, 0, 0.11);
    if (o >= 0) { S[o + SIZE] = 0.22 * strength; S[o + GROW] = 1.2 * strength; S[o + CELLF] = C_GLOW; S[o + ADD] = 1; S[o + A0] = 0.55; S[o + CR] = 1.6; S[o + CG] = 1.4; S[o + CB] = 1.15; }
    o = sp.spawn(K_FLASH, point.x, point.y, point.z, 0, 0, 0, 0.14);
    if (o >= 0) { S[o + SIZE] = 0.07 * strength; S[o + GROW] = 2.3 * strength; S[o + CELLF] = C_RING; S[o + ADD] = 1; S[o + A0] = 0.4; S[o + CR] = 1.5; S[o + CG] = 1.35; S[o + CB] = 1.15; S[o + SPIN] = rand(-2, 2); }
    for (let k = 0, n = Math.min(12, 4 + strength * 4) * sp.room(); k < n; k++) {
      _v.set(rand(-1, 1), rand(-0.6, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 8) * Math.min(1.6, strength));
      o = sp.spawn(K_DEBRIS, point.x, point.y, point.z, _v.x, _v.y, _v.z, rand(0.1, 0.24));
      if (o < 0) continue;
      S[o + SIZE] = rand(0.003, 0.006); S[o + CELLF] = C_STREAK; S[o + STREAK] = 0.03; S[o + ADD] = 1; S[o + A0] = 0.8;
      S[o + CR] = 1.5; S[o + CG] = 1.4; S[o + CB] = 1.2; S[o + GRAV] = 5; S[o + DRAG] = 3;
    }
    if (strength > 1) {
      o = sp.spawn(K_SOFT, point.x, point.y, point.z, 0, 0.15, 0, rand(0.4, 0.6));
      if (o >= 0) { S[o + SIZE] = 0.1 * strength; S[o + GROW] = 0.5; S[o + CELLF] = pick(C_CLOUD); S[o + A0] = 0.14; S[o + CR] = 0.75; S[o + CG] = 0.72; S[o + CB] = 0.68; S[o + DRAG] = 2; }
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    if (!(dt > 0) || !fin(dt)) return;
    this.time += dt;
    this.decalTime.value = this.time;
    this.decalBudget = 26;

    // stump spurts
    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const s = this.spurts[i];
      s.t += dt;
      if (s.t > s.duration) { this.spurts.splice(i, 1); continue; }
      const pulse = 0.5 + 0.5 * Math.sin(s.t * 9);
      const fade = 1 - s.t / s.duration;
      s.acc += dt * 70 * pulse * fade;
      if (s.acc < 1) continue;
      const n = Math.min(12, Math.floor(s.acc)); s.acc -= Math.floor(s.acc);
      const p = s.getPos(), d = s.getDir();
      if (!finV(p) || !finV(d)) continue;
      for (let k = 0; k < n; k++) {
        const sp = rand(2, 4.5) * (0.4 + 0.6 * fade) * (0.5 + pulse);
        this._drop(p.x, p.y, p.z, d.x * sp + rand(-0.4, 0.4), d.y * sp + rand(0, 0.8), d.z * sp + rand(-0.4, 0.4), 0.005 + 0.012 * Math.random() ** 2, rand(0.6, 1.2));
      }
    }

    // wet blades: slow drips while held still, drops flung off the tip in a swing
    for (const t of this.trails) {
      if (t.wet <= 0) continue;
      t.wet -= dt / 9;
      if (!t.fresh || this.noBlood) { t.fresh = false; continue; }
      t.fresh = false;
      const speed = t.tipVel.length() / dt;
      t.dripAcc += dt * t.wet * (1.6 + Math.min(40, speed * 1.4));
      if (t.dripAcc < 1) continue;
      t.dripAcc = 0;
      const u = speed > 5 ? rand(0.7, 1) : rand(0.25, 1), k = speed > 5 ? 0.55 * u / dt : 0;
      _p.copy(t.base[0]).lerp(t.tip[0], u);
      this._drop(_p.x, _p.y, _p.z, t.tipVel.x * k + rand(-0.15, 0.15), t.tipVel.y * k + rand(-0.2, 0.1), t.tipVel.z * k + rand(-0.15, 0.15), rand(0.005, 0.011), 1.4);
      if (speed > 5) t.wet -= 0.03;
    }

    this.sprites.update(dt, this);
    this.chips.update(dt, this);

    this.flashI = Math.max(0, this.flashI - dt * 160);
    this.flash.intensity = this.flashI;
  }

  /** Height of the picture in real pixels (so the thinnest sparks can be kept from vanishing between them). */
  setPixelScale(h) { if (h > 0 && fin(h)) this.sprites.pxH = h; }

  clear() {
    this.sprites.clear();
    this.chips.clear();
    for (let i = 0; i < this.decalN; i++) this.decalMesh.setMatrixAt(i, HIDE);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    this.decalNext = 0; this.decalHigh = 0;
    this.decalMesh.count = 0; this.decalMesh.visible = false;
    for (const t of this.trails) { t.wet = 0; t.dripAcc = 0; }
    this.spurts = [];
    this.flashI = 0; this.flash.intensity = 0;
  }
}
