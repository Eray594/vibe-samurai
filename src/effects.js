import * as THREE from 'three';
import { rand } from './physics.js';

const KIND = { BLOOD: 0, SPLINTER: 1, DUST: 2, GORE: 3 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

class Pool {
  constructor(n) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.size = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.next = 0;
  }
  alloc() { const i = this.next; this.next = (this.next + 1) % this.n; return i; }
}

// ------------------------------------------------------------------ soft round particles (mist, dust, glow)
const SOFT_VS = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
varying float vAlpha;
varying vec3 vTint;
uniform float scale;
void main() {
  vAlpha = alpha; vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const SOFT_FS = `
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  a *= a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vTint, a);
}`;

class SoftParticles {
  constructor(scene, n, additive) {
    this.n = n;
    this.next = 0;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.tint = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.a0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SOFT_VS, fragmentShader: SOFT_FS,
      uniforms: { scale: { value: 600 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  emit(p, v, { size = 0.2, grow = 0.5, life = 1, alpha = 0.6, color = 0xffffff, grav = 0, drag = 1 }) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    _c.set(color);
    this.tint.set([_c.r, _c.g, _c.b], i * 3);
    this.size[i] = size; this.grow[i] = grow;
    this.life[i] = this.max[i] = life;
    this.a0[i] = alpha; this.alpha[i] = alpha;
    this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const j = i * 3, f = Math.max(0, this.life[i] / this.max[i]);
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[j] *= dr; this.vel[j + 1] = this.vel[j + 1] * dr - this.grav[i] * dt; this.vel[j + 2] *= dr;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * f * Math.min(1, (1 - f) * 8 + 0.2);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = a.tint.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.alpha.fill(0); }
}

// ------------------------------------------------------------------ weapon trails
class Trail {
  constructor(scene, color, n = 18, sub = 3) {
    this.n = n; this.sub = sub;
    this.base = []; this.tip = []; this.int = [];
    const verts = (n - 1) * sub + 1;
    this.verts = verts;
    this.pos = new Float32Array(verts * 2 * 3);
    this.col = new Float32Array(verts * 2 * 3);
    const idx = [];
    for (let i = 0; i < verts - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.color = new THREE.Color(color);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.scene = scene;
    scene.add(this.mesh);
  }
  push(base, tip, intensity) {
    this.base.unshift(base.clone()); this.tip.unshift(tip.clone()); this.int.unshift(intensity);
    if (this.base.length > this.n) { this.base.pop(); this.tip.pop(); this.int.pop(); }
    this.rebuild();
  }
  rebuild() {
    const L = this.base.length;
    let v = 0;
    const cr = (p0, p1, p2, p3, t, out) => {
      const t2 = t * t, t3 = t2 * t;
      return out.set(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      );
    };
    for (let i = 0; i < this.n - 1; i++) {
      for (let s = 0; s < this.sub; s++) {
        if (i === this.n - 2 && s > 0) break;
        const t = s / this.sub;
        if (i + 1 >= L) { this.col.fill(0, v * 6); v++; continue; }
        const i0 = Math.max(0, i - 1), i2 = Math.min(L - 1, i + 1), i3 = Math.min(L - 1, i + 2);
        cr(this.base[i0], this.base[i], this.base[i2], this.base[i3], t, _p);
        this.pos.set([_p.x, _p.y, _p.z], v * 6);
        cr(this.tip[i0], this.tip[i], this.tip[i2], this.tip[i3], t, _p);
        this.pos.set([_p.x, _p.y, _p.z], v * 6 + 3);
        const age = (i + t) / (this.n - 1);
        const inten = this.int[i] * (1 - t) + this.int[i2] * t;
        const k = inten * Math.pow(1 - age, 1.6) * 0.75;
        this.col.set([this.color.r * k * 0.15, this.color.g * k * 0.15, this.color.b * k * 0.15], v * 6);
        this.col.set([this.color.r * k, this.color.g * k, this.color.b * k], v * 6 + 3);
        v++;
      }
    }
    for (; v < this.verts; v++) this.col.fill(0, v * 6, v * 6 + 6);
    const a = this.mesh.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // chunky particles: blood droplets (stretched), splinters, gore
    this.chunks = new Pool(2600);
    this.chunkMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 6, 4),
      new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1 }),
      this.chunks.n,
    );
    this.chunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunkMesh.frustumCulled = false;
    for (let i = 0; i < this.chunks.n; i++) { this.chunkMesh.setMatrixAt(i, HIDE); this.chunkMesh.setColorAt(i, _c.set(0x880000)); }
    scene.add(this.chunkMesh);

    // sparks: additive streaks
    this.sparks = new Pool(900);
    this.sparkMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd28a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }),
      this.sparks.n,
    );
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    for (let i = 0; i < this.sparks.n; i++) { this.sparkMesh.setMatrixAt(i, HIDE); this.sparkMesh.setColorAt(i, _c.setRGB(5, 2.8, 1)); }
    scene.add(this.sparkMesh);

    this.mist = new SoftParticles(scene, 700, false);
    this.glow = new SoftParticles(scene, 400, true);

    // blood decals on the floor
    this.decalN = 700;
    this.decalNext = 0;
    const decalTex = makeSplatTexture();
    this.decalMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: decalTex, transparent: true, depthWrite: false, roughness: 0.15, metalness: 0.2,
        color: 0x5a0606, polygonOffset: true, polygonOffsetFactor: -2,
      }),
      this.decalN,
    );
    this.decalMesh.receiveShadow = true;
    this.decalMesh.frustumCulled = false;
    for (let i = 0; i < this.decalN; i++) this.decalMesh.setMatrixAt(i, HIDE);
    scene.add(this.decalMesh);

    this.flash = new THREE.PointLight(0xffb060, 0, 8, 2);
    scene.add(this.flash);
    this.flashI = 0;
    this.spurts = [];
    this.trails = new Set();
    this.time = 0;
  }

  createTrail(color) {
    const t = new Trail(this.scene, color);
    return t;
  }

  /** Droplets that streak along their velocity + a puff of mist. */
  blood(point, dir, count, force = 1) {
    if (this.noBlood) return;
    const P = this.chunks;
    count = Math.min(220, Math.round(count));
    for (let k = 0; k < count; k++) {
      const i = P.alloc();
      P.pos.set([point.x + rand(-0.02, 0.02), point.y + rand(-0.02, 0.02), point.z + rand(-0.02, 0.02)], i * 3);
      const sp = rand(1, 5.5) * force;
      P.vel[i * 3] = dir.x * sp * 0.7 + rand(-1.8, 1.8);
      P.vel[i * 3 + 1] = dir.y * sp * 0.4 + rand(0.3, 3.4);
      P.vel[i * 3 + 2] = dir.z * sp * 0.7 + rand(-1.8, 1.8);
      P.life[i] = P.max[i] = rand(0.7, 1.6);
      P.size[i] = rand(0.007, 0.022);
      P.kind[i] = KIND.BLOOD;
      this.chunkMesh.setColorAt(i, _c.setRGB(rand(0.3, 0.5), 0.0, 0.005));
    }
    this.chunkMesh.instanceColor.needsUpdate = true;
    const mists = Math.min(10, 1 + count / 10);
    for (let k = 0; k < mists; k++) {
      this.mist.emit(point, _v.set(dir.x * rand(0.3, 1.2) + rand(-0.4, 0.4), rand(0, 0.6), dir.z * rand(0.3, 1.2) + rand(-0.4, 0.4)),
        { size: rand(0.08, 0.18), grow: rand(0.3, 0.6), life: rand(0.5, 1.0), alpha: 0.55, color: 0x6a0408, grav: 0.3, drag: 2.5 });
    }
  }

  /** Chunks of flesh/armour flying off a severed limb. */
  gore(point, dir, count) {
    if (this.noBlood) return;
    const P = this.chunks;
    for (let k = 0; k < count; k++) {
      const i = P.alloc();
      P.pos.set([point.x, point.y, point.z], i * 3);
      P.vel[i * 3] = dir.x * rand(1, 4) + rand(-2, 2);
      P.vel[i * 3 + 1] = rand(1, 4.5);
      P.vel[i * 3 + 2] = dir.z * rand(1, 4) + rand(-2, 2);
      P.life[i] = P.max[i] = rand(1.2, 2.2);
      P.size[i] = rand(0.018, 0.04);
      P.kind[i] = KIND.GORE;
      this.chunkMesh.setColorAt(i, _c.setRGB(rand(0.22, 0.4), 0.01, 0.02));
    }
    this.chunkMesh.instanceColor.needsUpdate = true;
  }

  /** Arterial spray from a stump: pulsing jet for a few seconds. */
  addSpurt(getPos, getDir, duration = 5) {
    if (this.noBlood) return;
    this.spurts.push({ getPos, getDir, t: 0, duration, acc: 0 });
    if (this.spurts.length > 12) this.spurts.shift();
  }

  splinters(point, dir, count, r = 0.32, g = 0.2, b = 0.1) {
    const P = this.chunks;
    for (let k = 0; k < count; k++) {
      const i = P.alloc();
      P.pos.set([point.x, point.y, point.z], i * 3);
      P.vel[i * 3] = dir.x * 2 + rand(-2.5, 2.5);
      P.vel[i * 3 + 1] = rand(0.5, 3.5);
      P.vel[i * 3 + 2] = dir.z * 2 + rand(-2.5, 2.5);
      P.life[i] = P.max[i] = rand(0.8, 1.6);
      P.size[i] = rand(0.012, 0.03);
      P.kind[i] = KIND.SPLINTER;
      this.chunkMesh.setColorAt(i, _c.setRGB(r, g, b));
    }
    this.chunkMesh.instanceColor.needsUpdate = true;
  }

  dust(point, count, spread = 1) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, sp = rand(0.4, 1.6) * spread;
      this.mist.emit(_p.set(point.x + rand(-0.15, 0.15), 0.06, point.z + rand(-0.15, 0.15)),
        _v.set(Math.cos(a) * sp, rand(0.1, 0.5), Math.sin(a) * sp),
        { size: rand(0.25, 0.5), grow: rand(0.6, 1.2), life: rand(0.6, 1.3), alpha: 0.28, color: 0x9a8a78, grav: -0.05, drag: 2.2 });
    }
  }

  sparksAt(point, count, strength = 1) {
    const P = this.sparks;
    count = Math.min(90, Math.round(count));
    for (let k = 0; k < count; k++) {
      const i = P.alloc();
      P.pos.set([point.x, point.y, point.z], i * 3);
      _v.set(rand(-1, 1), rand(-0.3, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(2, 8.5) * strength);
      P.vel.set([_v.x, _v.y, _v.z], i * 3);
      P.life[i] = P.max[i] = rand(0.15, 0.55);
      P.size[i] = rand(0.005, 0.012);
    }
    this.glow.emit(point, _v.set(0, 0, 0), { size: 0.5 * strength, grow: 1.5, life: 0.12, alpha: 0.9, color: 0xffc070 });
    this.glow.emit(point, _v.set(0, 0.2, 0), { size: 0.25, grow: 0.4, life: 0.35, alpha: 0.5, color: 0xff7020 });
    this.flash.position.copy(point);
    this.flashI = Math.min(40, this.flashI + 12 * strength);
  }

  /** Bright white-hot flash at a heavy impact point. */
  impact(point, strength = 1) {
    this.glow.emit(point, _v.set(0, 0, 0), { size: 0.4 * strength, grow: 3 * strength, life: 0.1, alpha: 0.7, color: 0xffe8d0 });
  }

  decal(x, z, size) {
    if (this.noBlood) return;
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % this.decalN;
    _q.setFromAxisAngle(Y, Math.random() * Math.PI * 2);
    _m.compose(_p.set(x, 0.004 + i * 0.00001, z), _q, _s.set(size, 1, size * rand(0.6, 1.3)));
    this.decalMesh.setMatrixAt(i, _m);
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    this.time += dt;
    // stump spurts
    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const s = this.spurts[i];
      s.t += dt;
      if (s.t > s.duration) { this.spurts.splice(i, 1); continue; }
      const pulse = 0.5 + 0.5 * Math.sin(s.t * 9);
      const fade = 1 - s.t / s.duration;
      s.acc += dt * 70 * pulse * fade;
      if (s.acc < 1) continue;
      const n = Math.floor(s.acc); s.acc -= n;
      const p = s.getPos(), d = s.getDir();
      if (!p) continue;
      const P = this.chunks;
      for (let k = 0; k < n; k++) {
        const j = P.alloc();
        P.pos.set([p.x, p.y, p.z], j * 3);
        const sp = rand(2, 4.5) * (0.4 + 0.6 * fade) * (0.5 + pulse);
        P.vel[j * 3] = d.x * sp + rand(-0.4, 0.4);
        P.vel[j * 3 + 1] = d.y * sp + rand(0, 0.8);
        P.vel[j * 3 + 2] = d.z * sp + rand(-0.4, 0.4);
        P.life[j] = P.max[j] = rand(0.6, 1.2);
        P.size[j] = rand(0.008, 0.016);
        P.kind[j] = KIND.BLOOD;
        this.chunkMesh.setColorAt(j, _c.setRGB(rand(0.35, 0.5), 0, 0.005));
      }
      this.chunkMesh.instanceColor.needsUpdate = true;
    }

    const P = this.chunks;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt;
      const j = i * 3;
      const k = P.kind[i];
      P.vel[j + 1] -= 9.8 * dt;
      P.pos[j] += P.vel[j] * dt; P.pos[j + 1] += P.vel[j + 1] * dt; P.pos[j + 2] += P.vel[j + 2] * dt;
      if (P.pos[j + 1] < 0.01) {
        if (k === KIND.BLOOD) {
          if (Math.random() < 0.35) this.decal(P.pos[j], P.pos[j + 2], rand(0.05, 0.3));
          P.life[i] = 0;
        } else {
          if (k === KIND.GORE && P.vel[j + 1] < -1.5) this.decal(P.pos[j], P.pos[j + 2], rand(0.1, 0.25));
          P.pos[j + 1] = 0.01; P.vel[j] *= 0.4; P.vel[j + 1] *= -0.25; P.vel[j + 2] *= 0.4;
        }
      }
      if (P.life[i] <= 0) { this.chunkMesh.setMatrixAt(i, HIDE); continue; }
      const s = P.size[i];
      _p.set(P.pos[j], P.pos[j + 1], P.pos[j + 2]);
      if (k === KIND.BLOOD) {
        // stretch droplets along their motion
        _v.set(P.vel[j], P.vel[j + 1], P.vel[j + 2]);
        const sp = _v.length();
        _q.setFromUnitVectors(Y, _v.divideScalar(sp || 1));
        _m.compose(_p, _q, _s.set(s, s * (1 + sp * 0.9), s));
      } else {
        _q.set(0, 0, 0, 1);
        _m.compose(_p, _q, _s.set(s, k === KIND.SPLINTER ? s * 3 : s, s));
      }
      this.chunkMesh.setMatrixAt(i, _m);
    }
    this.chunkMesh.instanceMatrix.needsUpdate = true;

    const S = this.sparks;
    for (let i = 0; i < S.n; i++) {
      if (S.life[i] <= 0) continue;
      S.life[i] -= dt;
      const j = i * 3;
      S.vel[j + 1] -= 6 * dt;
      S.pos[j] += S.vel[j] * dt; S.pos[j + 1] += S.vel[j + 1] * dt; S.pos[j + 2] += S.vel[j + 2] * dt;
      if (S.pos[j + 1] < 0.01) { S.pos[j + 1] = 0.01; S.vel[j + 1] *= -0.45; S.vel[j] *= 0.6; S.vel[j + 2] *= 0.6; }
      if (S.life[i] <= 0) { this.sparkMesh.setMatrixAt(i, HIDE); continue; }
      _v.set(S.vel[j], S.vel[j + 1], S.vel[j + 2]);
      const sp = _v.length();
      _q.setFromUnitVectors(Y, _v.divideScalar(sp || 1));
      const f = S.life[i] / S.max[i];
      _m.compose(_p.set(S.pos[j], S.pos[j + 1], S.pos[j + 2]), _q, _s.set(S.size[i] * f, Math.max(0.02, sp * 0.022), S.size[i] * f));
      this.sparkMesh.setMatrixAt(i, _m);
    }
    this.sparkMesh.instanceMatrix.needsUpdate = true;

    this.mist.update(dt);
    this.glow.update(dt);
    this.flashI = Math.max(0, this.flashI - dt * 160);
    this.flash.intensity = this.flashI;
  }

  setPixelScale(h) {
    this.mist.mat.uniforms.scale.value = h * 0.9;
    this.glow.mat.uniforms.scale.value = h * 0.9;
  }

  clear() {
    for (const P of [this.chunks, this.sparks]) P.life.fill(0);
    for (let i = 0; i < this.chunks.n; i++) this.chunkMesh.setMatrixAt(i, HIDE);
    for (let i = 0; i < this.sparks.n; i++) this.sparkMesh.setMatrixAt(i, HIDE);
    for (let i = 0; i < this.decalN; i++) this.decalMesh.setMatrixAt(i, HIDE);
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    this.decalMesh.instanceMatrix.needsUpdate = true;
    this.mist.clear(); this.glow.clear();
    this.spurts = [];
  }
}

function makeSplatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  blob(64, 64, 30);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, d = rand(20, 50);
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, rand(3, 11));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
