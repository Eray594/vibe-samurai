// Building blocks for the scenery: procedural textures (colour + normal + roughness baked on a
// canvas), a few geometry helpers (rounded boxes, tapering tubes, swept rings) and the shared
// foliage material. Everything is generated at start-up; nothing is loaded from disk.
import * as THREE from 'three';

// ------------------------------------------------------------------ numbers
/** Small seeded generator, so the scenery looks the same on every start. */
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.pick = (list) => list[Math.floor(f() * list.length)];
  return f;
}

const smooth = (t) => t * t * (3 - 2 * t);
export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return smooth(t); };

/** Tileable fractal value noise, W×H, values 0..1. `fx`/`fy` are the lattice cells of the first octave. */
export function fbmField(W, H, fx, fy, octaves, seed, gain = 0.5) {
  const out = new Float32Array(W * H), R = rng(seed);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = fx << o, cy = fy << o;
    if (cx > W || cy > H) break;
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = R();
    const ix = cx / W, iy = cy / H;
    for (let y = 0; y < H; y++) {
      const gy = y * iy, y0 = gy | 0, sy = smooth(gy - y0), y1 = (y0 + 1) % cy;
      for (let x = 0; x < W; x++) {
        const gx = x * ix, x0 = gx | 0, sx = smooth(gx - x0), x1 = (x0 + 1) % cx;
        const a = lat[y0 * cx + x0], b = lat[y0 * cx + x1], c = lat[y1 * cx + x0], d = lat[y1 * cx + x1];
        out[y * W + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// ------------------------------------------------------------------ textures
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function finish(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

/**
 * Bake a tileable surface. `fn(x, y, o)` fills o[0..2] colour (0..255), o[3] height (0..1) and
 * o[4] roughness (0..1). Returns { map, normalMap, roughnessMap } (the last only when asked for).
 */
export function bake(W, H, fn, { bump = 4, rough = false, repeat = null } = {}) {
  const col = mkCanvas(W, H), g = col.getContext('2d'), img = g.createImageData(W, H);
  const height = new Float32Array(W * H), rg = rough ? new Uint8ClampedArray(W * H) : null;
  const o = [0, 0, 0, 0, 1];
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      fn(x, y, o);
      img.data[i * 4] = o[0]; img.data[i * 4 + 1] = o[1]; img.data[i * 4 + 2] = o[2]; img.data[i * 4 + 3] = 255;
      height[i] = o[3];
      if (rg) rg[i] = o[4] * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const res = { map: finish(col, true, repeat), normalMap: finish(normalCanvas(height, W, H, bump), false, repeat) };
  if (rg) {
    const rc = mkCanvas(W, H), g2 = rc.getContext('2d'), im2 = g2.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { im2.data[i * 4] = 255; im2.data[i * 4 + 1] = rg[i]; im2.data[i * 4 + 2] = 0; im2.data[i * 4 + 3] = 255; }
    g2.putImageData(im2, 0, 0);
    res.roughnessMap = finish(rc, false, repeat);
  }
  return res;
}

function normalCanvas(height, W, H, strength) {
  const c = mkCanvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const yu = ((y + H - 1) % H) * W, yd = ((y + 1) % H) * W, yy = y * W;
    for (let x = 0; x < W; x++) {
      const dx = (height[yy + (x + 1) % W] - height[yy + (x + W - 1) % W]) * strength;
      const dy = (height[yd + x] - height[yu + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (yy + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** A copy of a texture set with its own tiling (the image is shared, nothing is uploaded twice... per copy). */
export function tiled(set, rx, ry) {
  const out = {};
  for (const k in set) { out[k] = set[k].clone(); out[k].repeat.set(rx, ry); out[k].needsUpdate = true; }
  return out;
}

/**
 * A cut-out texture (leaves, blossom) from a canvas drawing. The colour of the empty texels is
 * filled in with `fill`, so the edges do not go dark when the picture is scaled down.
 */
export function cutout(c, fill) {
  const W = c.width, H = c.height, src = c.getContext('2d').getImageData(0, 0, W, H).data;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const ro = (H - 1 - y) * W * 4, so = y * W * 4;       // rows flipped: v = 0 is the bottom of the drawing
    for (let x = 0; x < W * 4; x += 4) {
      const a = src[so + x + 3], k = a / 255;
      data[ro + x] = src[so + x] * k + fill[0] * (1 - k);
      data[ro + x + 1] = src[so + x + 1] * k + fill[1] * (1 - k);
      data[ro + x + 2] = src[so + x + 2] * k + fill[2] * (1 - k);
      data[ro + x + 3] = a;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Pebbles: a cell pattern, every stone with its own tint, dark in the gaps. */
export function gravelMaps(S = 1024, cells = 128) {
  const R = rng(11), n = cells * cells;
  const px = new Float32Array(n), py = new Float32Array(n), cr = new Float32Array(n), cg = new Float32Array(n), cb = new Float32Array(n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    px[i] = R(); py[i] = R();
    const k = R();
    c.setHSL(R.range(0.07, 0.12), R.range(0.06, 0.2), k < 0.08 ? R.range(0.2, 0.3) : k > 0.9 ? R.range(0.62, 0.72) : R.range(0.4, 0.58));
    cr[i] = c.r * 255; cg[i] = c.g * 255; cb[i] = c.b * 255;       // (sRGB values straight from HSL)
  }
  const tint = fbmField(S, S, 6, 6, 4, 12), grit = fbmField(S, S, 128, 128, 2, 13);
  const cs = S / cells;
  return bake(S, S, (x, y, o) => {
    const gx = x / cs, gy = y / cs, ix = gx | 0, iy = gy | 0;
    let f1 = 9, f2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = (iy + dy + cells) % cells;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = (ix + dx + cells) % cells, j = yy * cells + xx;
        const ex = ix + dx + px[j] - gx, ey = iy + dy + py[j] - gy, d = ex * ex + ey * ey;
        if (d < f1) { f2 = f1; f1 = d; id = j; } else if (d < f2) f2 = d;
      }
    }
    const edge = Math.min(1, (Math.sqrt(f2) - Math.sqrt(f1)) * 2.4);
    const dome = Math.sqrt(edge) * (1 - f1 * 0.5);
    const i = y * S + x, sh = (0.5 + 0.5 * dome) * (0.86 + 0.28 * tint[i]) * (0.92 + 0.16 * grit[i]);
    o[0] = cr[id] * sh; o[1] = cg[id] * sh; o[2] = cb[id] * sh;
    o[3] = dome * 0.8 + grit[i] * 0.2;
    o[4] = 0.98 - dome * 0.16;
  }, { bump: 3.2, rough: true });
}

/** Sawn wood, grain running along v. Light, so the material colour decides how dark it is. */
export function woodMaps(S = 512) {
  const warp = fbmField(S, S, 5, 1, 4, 21), pores = fbmField(S, S, 128, 4, 2, 22), blot = fbmField(S, S, 3, 3, 3, 23);
  return bake(S, S, (x, y, o) => {
    const i = y * S + x;
    const ring = Math.sin((x / S * 9 + warp[i] * 7) * Math.PI * 2) * 0.5 + 0.5;
    const fine = Math.sin((x / S * 60 + warp[i] * 22) * Math.PI * 2) * 0.5 + 0.5;
    const k = 0.74 + 0.12 * ring + 0.08 * fine + 0.14 * (blot[i] - 0.5) - 0.16 * Math.max(0, pores[i] - 0.55) * 2;
    o[0] = 226 * k; o[1] = 186 * k; o[2] = 140 * k;
    o[3] = ring * 0.5 + fine * 0.2 + (1 - Math.max(0, pores[i] - 0.5) * 2) * 0.3;
  }, { bump: 2.2 });
}

/** Planks side by side, with gaps, nail heads and worn edges (crates, decks). */
export function plankMaps(S = 512, planks = 4) {
  const warp = fbmField(S, S, 5, 1, 4, 31), blot = fbmField(S, S, 4, 4, 3, 32), pores = fbmField(S, S, 128, 4, 2, 33);
  const R = rng(34), tone = [], shift = [];
  for (let i = 0; i < planks; i++) { tone.push(R.range(0.82, 1.08)); shift.push(R.range(0, 9)); }
  const pw = S / planks;
  return bake(S, S, (x, y, o) => {
    const i = y * S + x, p = Math.floor(x / pw), u = (x - p * pw) / pw;
    const gap = Math.min(u, 1 - u) * pw;                              // px to the plank's edge
    const ring = Math.sin(((u + shift[p]) * 2.4 + warp[i] * 6) * Math.PI * 2) * 0.5 + 0.5;
    let k = (0.72 + 0.13 * ring + 0.16 * (blot[i] - 0.5)) * tone[p] - Math.max(0, pores[i] - 0.56) * 0.3;
    let h = 0.6 + ring * 0.25;
    if (gap < 3) { k *= 0.25 + gap * 0.2; h = gap * 0.18; }
    for (const ny of [0.07, 0.93]) {                                   // a nail at either end of every plank
      const d = Math.hypot((u - 0.5) * pw, y - ny * S);
      if (d < 5) { k = 0.3 + d * 0.03; h = 0.9; }
    }
    o[0] = 226 * k; o[1] = 186 * k; o[2] = 140 * k; o[3] = h;
  }, { bump: 3 });
}

/** Furrowed bark with pale lenticel streaks across it. */
export function barkMaps(W = 256, H = 512) {
  const fur = fbmField(W, H, 10, 3, 4, 41), fur2 = fbmField(W, H, 24, 4, 3, 42), band = fbmField(W, H, 2, 40, 2, 43), moss = fbmField(W, H, 4, 6, 3, 44);
  return bake(W, H, (x, y, o) => {
    const i = y * W + x;
    const ridge = 1 - Math.abs(fur[i] * 2 - 1);                       // sharp crests, deep furrows between
    const h = Math.pow(ridge, 1.6) * 0.75 + fur2[i] * 0.25;
    const len = band[i] > 0.68 ? (band[i] - 0.68) * 0.7 : 0;          // lenticels
    const k = 0.42 + 0.62 * h + len;
    const m = sstep(0.62, 0.8, moss[i]) * 0.35;
    o[0] = 104 * k * (1 - m) + 70 * m; o[1] = 90 * k * (1 - m) + 88 * m; o[2] = 84 * k * (1 - m) + 48 * m;
    o[3] = h;
  }, { bump: 5 });
}

/** Lime plaster. With `wall`, dirt splashed up from the ground and damp streaks under the eaves are baked in. */
export function plasterMaps(S = 512, wall = false) {
  const blot = fbmField(S, S, 4, 4, 5, 51), fine = fbmField(S, S, 96, 96, 2, 52), streak = fbmField(S, S, 48, 2, 3, 53), edge = fbmField(S, S, 12, 6, 3, 54);
  // hairline cracks: a few random walks
  const crack = new Float32Array(S * S), R = rng(55);
  for (let k = 0; k < (wall ? 7 : 4); k++) {
    let x = R() * S, y = R() * S, a = R.range(0, 6.28);
    for (let s = 0; s < R.range(60, 220); s++) {
      a += R.range(-0.5, 0.5);
      x = (x + Math.cos(a) * 1.2 + S) % S; y = (y + Math.abs(Math.sin(a)) * 1.2 + S) % S;
      crack[(y | 0) * S + (x | 0)] = 1;
    }
  }
  return bake(S, S, (x, y, o) => {
    const i = y * S + x, v = 1 - y / S;                                // v: 0 at the foot of the wall
    let k = 0.86 + 0.16 * blot[i] + 0.05 * (fine[i] - 0.5);
    let r = 236, g = 229, b = 214;
    if (wall) {
      const splash = sstep(0.34, 0.0, v - edge[i] * 0.16);            // earth and moss creeping up from below
      const damp = sstep(0.55, 1.0, v + (streak[i] - 0.5) * 0.9) * (0.3 + 0.7 * streak[i]);
      r = r * (1 - splash) + 122 * splash; g = g * (1 - splash) + 116 * splash; b = b * (1 - splash) + 88 * splash;
      k *= 1 - damp * 0.3 - splash * 0.18;
      b *= 1 - damp * 0.06;
    }
    if (crack[i]) k *= 0.72;
    o[0] = r * k; o[1] = g * k; o[2] = b * k;
    o[3] = fine[i] * 0.5 + blot[i] * 0.5 - crack[i] * 0.6;
  }, { bump: 1.6 });
}

/** Weathered granite: speckled, pitted, with lichen. */
export function stoneMaps(S = 512) {
  const big = fbmField(S, S, 4, 4, 5, 61), speck = fbmField(S, S, 128, 128, 2, 62), pit = fbmField(S, S, 40, 40, 3, 63), lichen = fbmField(S, S, 7, 7, 4, 64);
  return bake(S, S, (x, y, o) => {
    const i = y * S + x;
    const p = sstep(0.6, 0.78, pit[i]);
    const l = sstep(0.6, 0.72, lichen[i]) * 0.55;
    const k = (0.72 + 0.34 * big[i] + 0.3 * (speck[i] - 0.5)) * (1 - p * 0.35);
    o[0] = (232 * (1 - l) + 150 * l) * k; o[1] = (228 * (1 - l) + 168 * l) * k; o[2] = (220 * (1 - l) + 110 * l) * k;
    o[3] = big[i] * 0.45 + speck[i] * 0.25 + (1 - p) * 0.3;
    o[4] = 0.88 + 0.12 * speck[i];
  }, { bump: 3, rough: true });
}

/** Dressed stone blocks in two staggered courses with recessed joints (the foot of the wall). */
export function ashlarMaps(S = 512) {
  const big = fbmField(S, S, 6, 6, 5, 71), speck = fbmField(S, S, 128, 128, 2, 72), moss = fbmField(S, S, 10, 5, 4, 73);
  const R = rng(74), rows = 2, per = 4, tone = [], cut = [];
  for (let r = 0; r < rows; r++) {
    const xs = [];
    for (let k = 0; k < per; k++) { xs.push(((k + (r ? 0.5 : 0)) / per + R.range(-0.04, 0.04)) * S); tone.push(R.range(0.78, 1.1)); }
    cut.push(xs);
  }
  return bake(S, S, (x, y, o) => {
    const i = y * S + x, row = Math.min(rows - 1, Math.floor(y / (S / rows))), yy = y - row * (S / rows);
    let dj = Math.min(yy, S / rows - yy), blk = 0, best = 1e9;
    for (let k = 0; k < per; k++) {
      let d = Math.abs(x - cut[row][k]); d = Math.min(d, S - d);
      if (d < dj) dj = d;
      const after = ((x - cut[row][k]) % S + S) % S;                   // the block starts at the last joint to the left
      if (after < best) { best = after; blk = k; }
    }
    const joint = sstep(7, 1.5, dj), v = 1 - y / S;
    const m = sstep(0.48, 0.7, moss[i] + (0.5 - v) * 0.5) * 0.7;
    const k = (0.6 + 0.36 * big[i] + 0.24 * (speck[i] - 0.5)) * tone[row * per + blk] * (1 - joint * 0.6);
    o[0] = (206 * (1 - m) + 86 * m) * k; o[1] = (200 * (1 - m) + 110 * m) * k; o[2] = (190 * (1 - m) + 62 * m) * k;
    o[3] = (1 - joint) * 0.75 + big[i] * 0.15 + speck[i] * 0.1;
  }, { bump: 4 });
}

/** Kawara roof tiles: round cover tiles running down the slope over flat pan tiles, in overlapping courses. */
export function tileMaps(S = 256, ridges = 4, courses = 3) {
  const blot = fbmField(S, S, 5, 5, 4, 81), speck = fbmField(S, S, 64, 64, 2, 82);
  return bake(S, S, (x, y, o) => {
    const i = y * S + x, s = (x / S * ridges) % 1, c = 1 - (y / S * courses) % 1;      // c: 0 at the top of a course, 1 at its lower edge
    const e = (s - 0.5) / 0.24;
    const cover = Math.abs(e) < 1 ? Math.sqrt(1 - e * e) : 0;
    const pan = 0.12 * Math.abs(e) / 2;
    const lap = c < 0.1 ? 1 - c / 0.1 : 0;                            // the shadow the course above throws
    const h = Math.max(cover, pan) * 0.8 + c * 0.2;
    const k = (0.5 + 0.42 * cover + 0.22 * (blot[i] - 0.5) + 0.12 * (speck[i] - 0.5)) * (1 - lap * 0.5) * (cover > 0 ? 1 : 0.8);
    o[0] = 238 * k; o[1] = 240 * k; o[2] = 246 * k;
    o[3] = h;
    o[4] = 0.5 + 0.4 * blot[i];
  }, { bump: 5, rough: true });
}

/** Rice straw wrapping: fine fibres along v with the odd darker one. */
export function strawMaps(W = 256, H = 256) {
  const fib = fbmField(W, H, 64, 2, 2, 91), blot = fbmField(W, H, 4, 4, 3, 92);
  return bake(W, H, (x, y, o) => {
    const i = y * W + x, k = 0.62 + 0.42 * fib[i] + 0.2 * (blot[i] - 0.5);
    o[0] = 214 * k; o[1] = 190 * k; o[2] = 122 * k; o[3] = fib[i];
  }, { bump: 3 });
}

/** A spray of cherry blossom on a transparent ground. */
export function blossomTexture(S = 512) {
  const c = mkCanvas(S, S), g = c.getContext('2d'), R = rng(101);
  // a handful of flowers painted once, then stamped all over (painting each one afresh costs a second at start-up)
  const stamps = [-1, -0.4, 0.3, 1].map((tone) => {
    const sc = mkCanvas(72, 72), g = sc.getContext('2d'), r = 34;
    g.translate(36, 36);
    for (let p = 0; p < 5; p++) {
      g.rotate(Math.PI * 2 / 5);
      const gr = g.createRadialGradient(0, 0, r * 0.1, 0, -r * 0.6, r);
      gr.addColorStop(0, `hsl(${338 + tone * 8}, 72%, ${72 + tone * 5}%)`);
      gr.addColorStop(0.4, `hsl(${344 + tone * 8}, 80%, ${88 + tone * 4}%)`);
      gr.addColorStop(1, `hsl(${348 + tone * 6}, 100%, ${95 + tone * 2}%)`);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(-r * 0.62, -r * 0.3, -r * 0.5, -r * 0.95, -r * 0.08, -r);
      g.lineTo(0, -r * 0.88);                                         // the notch in the tip of a petal
      g.lineTo(r * 0.08, -r);
      g.bezierCurveTo(r * 0.5, -r * 0.95, r * 0.62, -r * 0.3, 0, 0);
      g.fill();
    }
    g.fillStyle = 'rgba(200,60,110,0.7)';
    g.beginPath(); g.arc(0, 0, r * 0.16, 0, 6.3); g.fill();
    g.fillStyle = '#ffe9a0';
    for (let k = 0; k < 6; k++) { const a = R() * 6.28, d = r * R.range(0.1, 0.3); g.fillRect(Math.cos(a) * d - 1.5, Math.sin(a) * d - 1.5, 3, 3); }
    return sc;
  });
  const flower = (x, y, r) => {
    g.save(); g.translate(x, y); g.rotate(R() * 6.28);
    g.drawImage(R.pick(stamps), -r * 1.06, -r * 1.06, r * 2.12, r * 2.12);
    g.restore();
  };
  const spot = () => { const a = R() * 6.28, d = Math.pow(R(), 0.7) * S * 0.43; return [S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d]; };
  // twigs and a few bronze young leaves underneath, then buds, then the open flowers on top
  g.strokeStyle = '#3a2620'; g.lineCap = 'round';
  for (let i = 0; i < 9; i++) { const [x, y] = spot(), [x2, y2] = spot(); g.lineWidth = R.range(2, 5); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(S / 2, S / 2, x2, y2); g.stroke(); }
  for (let i = 0; i < 16; i++) {
    const [x, y] = spot();
    g.save(); g.translate(x, y); g.rotate(R() * 6.28);
    g.fillStyle = `hsl(${R.range(18, 50)}, 45%, ${R.range(28, 40)}%)`;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(9, -16, 0, -34); g.quadraticCurveTo(-9, -16, 0, 0); g.fill();
    g.restore();
  }
  for (let i = 0; i < 70; i++) { const [x, y] = spot(); g.fillStyle = `hsl(${R.range(332, 345)}, 62%, ${R.range(62, 76)}%)`; g.beginPath(); g.arc(x, y, R.range(5, 10), 0, 6.3); g.fill(); }
  for (let i = 0; i < 150; i++) { const [x, y] = spot(); flower(x, y, R.range(17, 31)); }
  return cutout(c, [250, 214, 228]);
}

/** One conifer bough seen from above: a stem with side twigs thick with needles. Root at the bottom. */
export function boughTexture(W = 256, H = 512) {
  const c = mkCanvas(W, H), g = c.getContext('2d'), R = rng(111);
  g.lineCap = 'round';
  const needles = (x0, y0, x1, y1, n, len) => {
    const dx = x1 - x0, dy = y1 - y0, a = Math.atan2(dy, dx);
    for (let i = 0; i < n; i++) {
      const t = R(), x = x0 + dx * t, y = y0 + dy * t, s = R() < 0.5 ? -1 : 1;
      const na = a + s * R.range(0.5, 1.15), l = len * R.range(0.6, 1.1);
      g.strokeStyle = `hsl(${R.range(95, 140)}, ${R.range(28, 48)}%, ${R.range(13, 32)}%)`;
      g.lineWidth = R.range(1.6, 3);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(na) * l, y + Math.sin(na) * l); g.stroke();
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 26; i++) {
      const t = i / 26, y = H - 14 - t * (H - 40), side = i % 2 ? 1 : -1;
      const reach = (W * 0.46) * Math.sin(Math.min(1, t * 1.25 + 0.22) * Math.PI * 0.86) * R.range(0.8, 1);
      const x1 = W / 2 + side * reach, y1 = y - reach * R.range(0.5, 0.8);
      if (!pass) { g.strokeStyle = '#2a2018'; g.lineWidth = 3; g.beginPath(); g.moveTo(W / 2, y); g.lineTo(x1, y1); g.stroke(); }
      needles(W / 2, y, x1, y1, 46, pass ? 12 : 17);
    }
  }
  g.strokeStyle = '#2a2018'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 40); g.stroke();
  needles(W / 2, H - 10, W / 2, 16, 130, 15);
  g.fillStyle = '#16260f'; g.fillRect(0, H - 12, 12, 12);              // a solid dark patch for the tree's core (bottom left)
  return cutout(c, [30, 52, 26]);
}

/** A tuft of grass, rooted at the bottom middle. */
export function grassTexture(S = 256) {
  const c = mkCanvas(S, S), g = c.getContext('2d'), R = rng(121);
  for (let i = 0; i < 64; i++) {
    const x0 = S / 2 + R.range(-0.2, 0.2) * S, lean = R.range(-0.42, 0.42) * S, h = R.range(0.42, 0.97) * S, w = R.range(3, 7);
    const gr = g.createLinearGradient(0, S, 0, S - h);
    const hue = R.range(62, 105), sat = R.range(30, 52);
    gr.addColorStop(0, `hsl(${hue}, ${sat}%, 14%)`);
    gr.addColorStop(1, `hsl(${hue - 8}, ${sat + 6}%, ${R.range(32, 50)}%)`);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x0 - w, S);
    g.quadraticCurveTo(x0 - w * 0.5 + lean * 0.25, S - h * 0.6, x0 + lean, S - h);
    g.quadraticCurveTo(x0 + w * 0.5 + lean * 0.25, S - h * 0.6, x0 + w, S);
    g.fill();
  }
  return cutout(c, [70, 92, 40]);
}

/** A hanging spray of bamboo leaves, attached at the top middle. */
export function bambooLeafTexture(S = 256) {
  const c = mkCanvas(S, S), g = c.getContext('2d'), R = rng(131);
  g.strokeStyle = '#5a6a2a'; g.lineWidth = 2.5;
  const twig = (x, y, a, len, depth) => {
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
    const n = depth ? 5 : 6;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n, lx = x + (x1 - x) * t, ly = y + (y1 - y) * t;
      if (depth && R() < 0.75) twig(lx, ly, a + R.range(-0.9, 0.9), len * 0.55, depth - 1);
      for (let k = 0; k < 3; k++) {
        const la = a + R.range(-1.1, 1.1), ll = R.range(30, 52), lw = R.range(4, 7);
        g.save(); g.translate(lx, ly); g.rotate(la);
        g.fillStyle = `hsl(${R.range(70, 104)}, ${R.range(32, 50)}%, ${R.range(18, 36)}%)`;
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(ll * 0.4, -lw, ll, 0); g.quadraticCurveTo(ll * 0.4, lw, 0, 0); g.fill();
        g.restore();
      }
    }
  };
  for (const a of [0.35, 0.8, 1.2, 1.57, 1.95, 2.35, 2.8]) twig(S / 2, 4, a + R.range(-0.15, 0.15), S * R.range(0.4, 0.55), 1);
  return cutout(c, [66, 92, 40]);
}

// ------------------------------------------------------------------ geometry
/** A box with rounded edges (smooth normals over the bevel). */
export function rbox(w, h, d, r = 0.02, seg = 2) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const n = seg * 2 + 1, g = new THREE.BoxGeometry(1, 1, 1, n, n, n).toNonIndexed();
  const pos = g.attributes.position, nor = g.attributes.normal, half = 0.5 / n;
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  const bx = w / 2 - r, by = h / 2 - r, bz = d / 2 - r;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    q.set(Math.sign(v.x) * Math.max(0, Math.abs(v.x) - half), Math.sign(v.y) * Math.max(0, Math.abs(v.y) - half), Math.sign(v.z) * Math.max(0, Math.abs(v.z) - half)).normalize();
    const sx = Math.abs(v.x) > half ? Math.sign(v.x) : 0, sy = Math.abs(v.y) > half ? Math.sign(v.y) : 0, sz = Math.abs(v.z) > half ? Math.sign(v.z) : 0;
    // the middle cell of every face is the flat part; the outer cells wrap around the edge
    pos.setXYZ(i,
      (sx ? sx * bx : v.x / half * bx) + q.x * r,
      (sy ? sy * by : v.y / half * by) + q.y * r,
      (sz ? sz * bz : v.z / half * bz) + q.z * r);
    nor.setXYZ(i, q.x, q.y, q.z);
  }
  return g;
}

/** Place a geometry: returns it moved/turned/scaled (in that order: scale, rotate, move). */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function put(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return geo.applyMatrix4(_m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)));
}

/** Give every vertex one colour (or `fn(x, y, z) → [r, g, b]`). */
export function tint(geo, r, g, b) {
  const n = geo.attributes.position.count, col = new Float32Array(n * 3), pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const c = typeof r === 'function' ? r(pos.getX(i), pos.getY(i), pos.getZ(i)) : [r, g, b];
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Turn the texture a quarter on a geometry (grain along the long side of a lying beam). */
export function turnUV(geo, su = 1, sv = 1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * su, uv.getX(i) * sv);
  return geo;
}
export function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/** Many geometries as one (position, normal, uv, and colour when `colors`). The inputs are disposed. */
export function mergeGeos(list, colors = false) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = colors ? new Float32Array(nv * 3).fill(1) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, k = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array.subarray(0, c * 3), v * 3);
    nor.set(g.attributes.normal.array.subarray(0, c * 3), v * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), v * 2);
    if (col && g.attributes.color) col.set(g.attributes.color.array.subarray(0, c * 3), v * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[k++] = g.index.array[i] + v;
    else for (let i = 0; i < c; i++) idx[k++] = v + i;
    v += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * A round limb along a path of points with a radius at each (smoothly curved, tapering).
 * `flare` widens the first ring into a root collar. u wraps round the limb, v runs along it in metres × vScale.
 */
export function tube(pts, radii, radial = 8, { vScale = 0.5, uRep = 1, steps = 0, flare = 0, v0 = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const n = steps || (pts.length - 1) * 3;
  const P = curve.getPoints(n);
  const pos = [], nor = [], uv = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), prevT = new THREE.Vector3(), ax = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i <= n; i++) {
    T.copy(P[Math.min(n, i + 1)]).sub(P[Math.max(0, i - 1)]).normalize();
    if (i === 0) {
      N.set(1, 0, 0); if (Math.abs(T.x) > 0.9) N.set(0, 0, 1);
      N.sub(B.copy(T).multiplyScalar(N.dot(T))).normalize();
    } else {
      // carry the frame along without twisting it
      ax.crossVectors(prevT, T);
      const s = ax.length();
      if (s > 1e-5) N.applyAxisAngle(ax.divideScalar(s), Math.asin(Math.min(1, s)));
      N.sub(B.copy(T).multiplyScalar(N.dot(T))).normalize();
      len += P[i].distanceTo(P[i - 1]);
    }
    prevT.copy(T);
    B.crossVectors(T, N);
    const f = (i / n) * (radii.length - 1), i0 = Math.min(radii.length - 2, f | 0);
    let r = radii[i0] + (radii[i0 + 1] - radii[i0]) * (f - i0);
    if (flare) r *= 1 + flare * Math.pow(1 - Math.min(1, len / (radii[0] * 3.2)), 2.4);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const lobe = flare ? 1 + 0.16 * Math.sin(a * 5 + 1.3) * Math.pow(1 - Math.min(1, len / (radii[0] * 3.2)), 2) : 1;
      const nx = N.x * c + B.x * s, ny = N.y * c + B.y * s, nz = N.z * c + B.z * s;
      pos.push(P[i].x + nx * r * lobe, P[i].y + ny * r * lobe, P[i].z + nz * r * lobe);
      nor.push(nx, ny, nz);
      uv.push((j / radial) * uRep, v0 + len * vScale);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * A profile swept round the yard's centre (the wall and its roof as one piece instead of facets).
 * `profile` is a list of [radius, y] points; consecutive points make a band with its own flat
 * normal unless `smoothed`. u runs round (uRep times), v across the profile 0..1 (or `vs` given per point).
 */
export function sweep(profile, segs, { uRep = 1, smoothed = false, vs = null } = {}) {
  const pos = [], nor = [], uv = [], idx = [];
  let total = 0; const acc = [0];
  for (let k = 1; k < profile.length; k++) { total += Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]); acc.push(total); }
  const V = (k) => vs ? vs[k] : acc[k] / total;
  const band = (k0, k1, n0, n1) => {
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
      for (const [k, n] of [[k0, n0], [k1, n1]]) {
        pos.push(s * profile[k][0], profile[k][1], c * profile[k][0]);
        nor.push(s * n[0], n[1], c * n[0]);
        uv.push((i / segs) * uRep, V(k));
      }
    }
    for (let i = 0; i < segs; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  };
  const segN = (k) => { const dr = profile[k + 1][0] - profile[k][0], dy = profile[k + 1][1] - profile[k][1], l = Math.hypot(dr, dy) || 1; return [dy / l, -dr / l]; };
  for (let k = 0; k < profile.length - 1; k++) {
    let n0 = segN(k), n1 = n0;
    if (smoothed) {
      const avg = (a, b) => { const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
      if (k > 0) n0 = avg(segN(k - 1), n0);
      if (k < profile.length - 2) n1 = avg(n1, segN(k + 1));
    }
    band(k, k + 1, n0, n1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Make every triangle of an indexed geometry face the way `want(centre, out)` says, then
 * recompute the normals. Saves reasoning about winding for hand-built shapes.
 */
export function orient(geo, want) {
  const pos = geo.attributes.position, idx = geo.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(pos, idx[i]); b.fromBufferAttribute(pos, idx[i + 1]); c.fromBufferAttribute(pos, idx[i + 2]);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    a.add(b).add(c).multiplyScalar(1 / 3);
    want(a, w);
    if (n.dot(w) < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  geo.computeVertexNormals();
  return geo;
}

/** A lumpy, rounded stone (smooth shaded). */
export function rockGeo(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail), R = rng(seed);
  const bumps = [];
  for (let i = 0; i < 7; i++) bumps.push([new THREE.Vector3(R.range(-1, 1), R.range(-1, 1), R.range(-1, 1)).normalize(), R.range(-0.22, 0.2)]);
  const pos = g.attributes.position, v = new THREE.Vector3(), uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let k = 1;
    for (const [d, a] of bumps) { const t = Math.max(0, v.dot(d)); k += a * t * t; }
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
    uv.setXY(i, v.x * 0.5 + v.z * 0.3, v.y * 0.5 + v.z * 0.3);
  }
  // the icosahedron is not indexed: weld the normals by direction so the stone shades smoothly
  g.computeVertexNormals();
  const nor = g.attributes.normal, acc = new Map(), key = (i) => `${Math.round(pos.getX(i) * 400)},${Math.round(pos.getY(i) * 400)},${Math.round(pos.getZ(i) * 400)}`;
  for (let i = 0; i < pos.count; i++) { const k = key(i), a = acc.get(k) || [0, 0, 0]; a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); acc.set(k, a); }
  for (let i = 0; i < pos.count; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; nor.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
  return g;
}

// ------------------------------------------------------------------ foliage
/** What all foliage shares: the time (for the wind) and the sun (for light shining through). */
export const foliageUniforms = { uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) } };

/**
 * Leaves and blossom on cut-out cards: soft shading from the normals the geometry carries (not
 * flipped on the back), sunlight glowing through against the light, and a little wind.
 * `sway` is a GLSL expression for how far a vertex moves (metres); `through` how much light passes.
 */
export function foliageMaterial(map, { sway = '0.0', through = 0.5, alphaTest = 0.4, color = 0xffffff, roughness = 0.85, vertexColors = true, beyond = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest, side: THREE.DoubleSide, roughness, metalness: 0, color, vertexColors });
  m.customProgramCacheKey = () => `foliage|${sway}|${through}|${beyond}`;      // (the shader text differs per material, the function does not)
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, foliageUniforms);
    if (beyond) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', NO_LANTERNS);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 fo = instanceMatrix[3].xyz;
          #else
            vec3 fo = position;
          #endif
          float ph = fo.x * 0.61 + fo.z * 0.47 + fo.y * 0.23;
          float w = ${sway};
          transformed.x += (sin(uTime * 1.3 + ph) + 0.5 * sin(uTime * 2.9 + ph * 1.7)) * w;
          transformed.z += (cos(uTime * 1.1 + ph * 1.3) + 0.5 * sin(uTime * 2.3 + ph * 2.1)) * w * 0.8;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir; uniform vec3 uSunCol;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);')
      // a mass of leaves has no sheen: seen against a low sun, the flat cards would otherwise mirror it
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          vec3 Vd = normalize(vViewPosition);
          float back = pow(clamp(dot(-Vd, L), 0.0, 1.0), 3.0);            // looking towards the sun
          float wrap = clamp(dot(normal, L) * 0.5 + 0.5, 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (${through.toFixed(3)} * (0.10 * wrap + 0.55 * back));
        }`);
  };
  return m;
}

// The lanterns have no shadows, so their light would pass straight through the wall and paint the
// trees behind it. Whatever stands beyond the wall leaves the point lights out (cheaper, too).
const NO_LANTERNS = THREE.ShaderChunk.lights_fragment_begin.replace('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', '#if 0');
/** Make a standard material ignore the lanterns (for things beyond the wall). */
export function beyondWall(m) {
  m.customProgramCacheKey = () => 'beyond';
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', NO_LANTERNS); };
  return m;
}

/** The matching shadow material: the cut-out, not the whole card, throws the shadow. */
export function foliageDepth(map, alphaTest = 0.4) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest, side: THREE.DoubleSide });
}
