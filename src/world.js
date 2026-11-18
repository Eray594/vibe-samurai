// The yard around the fight: weather and time of day, fire that spreads, and the podium to climb.
import * as THREE from 'three';
import { rand, clamp } from './physics.js';

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();

// ------------------------------------------------------------------ weather & time of day
// hemi: [sky, ground, intensity]  sun: [colour, intensity]  fog: [colour, density]
// sky: [brightness, saturation, stars]  floor: [colour, roughness, emissive, emissiveIntensity]
const PRESETS = {
  dusk: { name: 'Abenddämmerung', hemi: [0x8c7fb0, 0x4a3628, 1.0], sun: [0xffa56a, 2.1], fog: [0x6a4250, 0.012], sky: [1, 1, 0], exposure: 1.1, env: 0.7, grip: 1, floor: [0xffffff, 0.96, 0x000000, 0], bloom: 0.32 },
  night: { name: 'Nacht', hemi: [0x34406c, 0x0c0c14, 0.32], sun: [0x8a9cff, 0.4], fog: [0x070914, 0.02], sky: [0.07, 0.6, 1], exposure: 1.0, env: 0.22, grip: 1, floor: [0xffffff, 0.96, 0x000000, 0], bloom: 0.55 },
  rain: { name: 'Regen', hemi: [0x6c768a, 0x2c2c2a, 0.8], sun: [0x9aa6bc, 0.55], fog: [0x353c46, 0.03], sky: [0.3, 0.25, 0], exposure: 1.0, env: 1.0, grip: 0.5, floor: [0x9a9aa0, 0.3, 0x000000, 0], bloom: 0.3 },
  snow: { name: 'Schnee', hemi: [0xc0cce6, 0x8c8c9c, 1.1], sun: [0xffd6b8, 1.1], fog: [0xa4acbc, 0.022], sky: [0.8, 0.35, 0], exposure: 1.02, env: 0.8, grip: 0.82, floor: [0xe4eaf4, 0.9, 0x8a94a6, 0.5], bloom: 0.3 },
};
export const WEATHER_ORDER = ['dusk', 'night', 'rain', 'snow'];
const RAIN_N = 1300, SNOW_N = 1100, BOX = 22, BOX_H = 13;

export class Weather {
  constructor(game) {
    this.game = game;
    this.key = 'dusk';
    const scene = game.scene;
    // rain: short streaks; snow: soft dots. Both live in a box that travels with the camera.
    this.rainPos = new Float32Array(RAIN_N * 6);
    this.rainBase = new Float32Array(RAIN_N * 3);
    for (let i = 0; i < RAIN_N * 3; i += 3) { this.rainBase[i] = rand(0, BOX); this.rainBase[i + 1] = rand(0, BOX_H); this.rainBase[i + 2] = rand(0, BOX); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab8cc, transparent: true, opacity: 0.38, depthWrite: false, fog: false }));
    this.snowPos = new Float32Array(SNOW_N * 3);
    this.snowBase = new Float32Array(SNOW_N * 4);
    for (let i = 0; i < SNOW_N; i++) { this.snowBase.set([rand(0, BOX), rand(0, BOX_H), rand(0, BOX), rand(0, 6.28)], i * 4); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.045, transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.visible = false; scene.add(o); }
    this.t = 0;
    this.trail = new Map();
  }

  get name() { return PRESETS[this.key].name; }
  get raining() { return this.key === 'rain'; }

  next() { this.set(WEATHER_ORDER[(WEATHER_ORDER.indexOf(this.key) + 1) % WEATHER_ORDER.length]); }

  set(key) {
    const P = PRESETS[key];
    if (!P) return;
    this.key = key;
    const g = this.game, a = g.arena;
    a.hemi.color.set(P.hemi[0]); a.hemi.groundColor.set(P.hemi[1]); a.hemi.intensity = P.hemi[2];
    a.sunLight.color.set(P.sun[0]); a.sunLight.intensity = P.sun[1];
    g.scene.fog.color.set(P.fog[0]); g.scene.fog.density = P.fog[1];
    const u = a.sky.material.uniforms;
    u.dim.value = P.sky[0]; u.sat.value = P.sky[1]; u.stars.value = P.sky[2];
    g.renderer.toneMappingExposure = P.exposure;
    g.scene.environmentIntensity = P.env;
    g.bloom.strength = P.bloom;
    g.grip = P.grip;
    const f = a.M.floor;
    f.color.set(P.floor[0]); f.roughness = P.floor[1]; f.emissive.set(P.floor[2]); f.emissiveIntensity = P.floor[3];
    this.rain.visible = key === 'rain';
    this.snow.visible = key === 'snow';
    g.audio.setRain?.(key === 'rain');
  }

  update(dt) {
    this.t += dt;
    const cam = this.game.camera.position;
    const ox = cam.x - BOX / 2, oz = cam.z - BOX / 2;
    const wrap = (v, o, s) => o + ((((v - o) % s) + s) % s);
    if (this.rain.visible) {
      const b = this.rainBase, p = this.rainPos;
      for (let i = 0, j = 0; i < RAIN_N * 3; i += 3, j += 6) {
        b[i] += 1.6 * dt; b[i + 1] -= 21 * dt;
        if (b[i + 1] < 0) b[i + 1] += BOX_H;
        const x = wrap(b[i], ox, BOX), z = wrap(b[i + 2], oz, BOX), y = b[i + 1];
        p[j] = x; p[j + 1] = y; p[j + 2] = z;
        p[j + 3] = x + 0.03; p[j + 4] = y + 0.42; p[j + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.snow.visible) {
      const b = this.snowBase, p = this.snowPos;
      for (let i = 0; i < SNOW_N; i++) {
        const j = i * 4;
        b[j + 1] -= 1.3 * dt;
        if (b[j + 1] < 0) b[j + 1] += BOX_H;
        const sway = Math.sin(this.t * 0.8 + b[j + 3]) * 0.4;
        p[i * 3] = wrap(b[j] + sway, ox, BOX); p[i * 3 + 1] = b[j + 1]; p[i * 3 + 2] = wrap(b[j + 2] + sway * 0.6, oz, BOX);
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
      // in the snow every wounded step shows
      for (const k of this.game.fighters) {
        if (k.state !== 'active' || k.inj.bleeding < 0.03) continue;
        const v = k.core.velocity;
        if (Math.hypot(v.x, v.z) < 0.6) continue;
        const t = (this.trail.get(k) || 0) - dt;
        if (t <= 0) {
          this.game.effects.decal(k.core.position.x + rand(-0.12, 0.12), k.core.position.z + rand(-0.12, 0.12), rand(0.1, 0.2));
          this.trail.set(k, 0.22);
        } else this.trail.set(k, t);
      }
    }
  }
}

// ------------------------------------------------------------------ fire
const FLAMMABLE = new Set(['screen', 'crate', 'barrel']);
const MAX_FIRES = 9;

export class Fire {
  constructor(game) {
    this.game = game;
    this.fires = [];
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff7a30, 0, 9, 2);
      game.scene.add(l);
      this.lights.push(l);
    }
    this.burnT = 0;
    this.sayT = 0;
  }

  burning(src) { return !!src && this.fires.some((f) => f.src === src); }

  /** Start a fire. `src` is what feeds it (a breakable item or a straw mat); it is destroyed when the fire is done. */
  ignite(x, z, { y = 0.1, r = 0.6, life = 7, src = null } = {}) {
    if (src && this.burning(src)) return;
    if (this.fires.length >= MAX_FIRES) return;
    this.fires.push({ x, y, z, r, life, t: 0, src, emit: 0, spreadT: rand(0.8, 1.6) });
    this.game.audio.whooshBurst?.(0.5);
  }

  clear() { this.fires = []; for (const l of this.lights) l.intensity = 0; }

  update(dt) {
    const g = this.game, fx = g.effects, rain = g.weather?.raining;
    this.sayT -= dt;
    this.burnT -= dt;
    const burnNow = this.burnT <= 0;
    if (burnNow) this.burnT = 0.4;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt * (rain ? 3 : 1);
      // the thing itself was smashed meanwhile: what is left burns out quickly
      if (f.src?.item?.broken) { f.src = null; f.life = Math.min(f.life, f.t + 1.5); }
      const k = clamp(Math.min(f.t / 0.6, (f.life - f.t) / 1.2), 0, 1);      // flare up, die down
      f.emit += dt * 22 * k;
      while (f.emit > 1) {
        f.emit -= 1;
        _p.set(f.x + rand(-f.r, f.r) * 0.7, f.y + rand(0, 0.25), f.z + rand(-f.r, f.r) * 0.7);
        fx.glow.emit(_p, _v.set(rand(-0.3, 0.3), rand(1.2, 2.8), rand(-0.3, 0.3)),
          { size: rand(0.25, 0.5) * (0.6 + f.r), grow: -0.25, life: rand(0.35, 0.75), alpha: 0.75, color: Math.random() < 0.5 ? 0xff7a1c : 0xffb23a, grav: -1.2, drag: 0.6 });
        if (Math.random() < 0.3) {
          fx.mist.emit(_p.setY(f.y + 0.8), _v.set(rand(-0.3, 0.3), rand(0.9, 1.6), rand(-0.3, 0.3)),
            { size: rand(0.35, 0.6), grow: 1.1, life: rand(1.4, 2.4), alpha: 0.3, color: 0x1e1c1c, grav: -0.5, drag: 0.7 });
        }
        if (Math.random() < 0.12) fx.sparksAt(_p, 2, 0.35);
      }
      // catches what stands next to it
      f.spreadT -= dt;
      if (f.spreadT <= 0 && !rain && k > 0.6) {
        f.spreadT = rand(0.7, 1.4);
        this.spread(f);
      }
      // and whoever stands in it
      if (burnNow && k > 0.3) {
        for (const s of g.fighters) {
          if (s.state !== 'active' || s.dead || s.mountH > 0 || s.iframeT > 0) continue;
          const p = s.core.position;
          if (Math.hypot(p.x - f.x, p.z - f.z) > f.r + 0.5 || Math.abs(s.groundY - (f.y - 0.1)) > 0.8) continue;
          s.inj.wound(Math.random() < 0.6 ? (Math.random() < 0.5 ? 'legR' : 'legL') : 'torso', 0.1, 'blunt', 0);
          s.hitFlash = 0.7;
          s.brain?.onHit?.(0.3);
          if (s.isPlayer) {
            g.hurtFlash(14);
            if (this.sayT <= 0) { g.callout('VERBRANNT!', null, 'crit'); this.sayT = 1.5; }
          }
        }
      }
      if (f.t >= f.life) {
        if (f.src?.item && !f.src.item.broken) g.arena.breakables.damage(f.src.item, 9999, new THREE.Vector3(f.x, f.y + 0.4, f.z), new THREE.Vector3(0, 1, 0));
        if (f.src?.mat) { const m = f.src.mat; m.top = m.base + 0.08; g.arena.fitMat(m); fx.splinters(new THREE.Vector3(f.x, 0.8, f.z), new THREE.Vector3(0, 1, 0), 20, 0.1, 0.09, 0.08); }
        this.fires.splice(i, 1);
      }
    }
    // the three biggest fires light the yard
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i], f = this.fires[i];
      if (!f) { l.intensity = 0; continue; }
      l.position.set(f.x, f.y + 0.7, f.z);
      l.intensity = 16 * clamp(f.t / 0.5, 0, 1) * (0.8 + Math.random() * 0.35);
    }
    if (this.fires.length && Math.random() < dt * 4) g.audio.wood?.(0.1);
  }

  spread(f) {
    const a = this.game.arena;
    for (const it of a.breakables.items) {
      if (it.broken || !it.body || !FLAMMABLE.has(it.kind)) continue;
      const p = it.body.position;
      if (Math.hypot(p.x - f.x, p.z - f.z) > 1.7) continue;
      if (Math.random() < 0.6) this.ignite(p.x, p.z, { y: Math.max(0.1, p.y - 0.3), r: it.kind === 'screen' ? 0.8 : 0.45, life: it.kind === 'screen' ? 5 : 8, src: { item: it } });
    }
    for (const m of a.mats) {
      if (m.material || m.top - m.base < 0.2) continue;          // green bamboo does not burn
      if (Math.hypot(m.x - f.x, m.z - f.z) > 1.7) continue;
      if (Math.random() < 0.6) this.ignite(m.x, m.z, { y: m.base + 0.2, r: 0.3, life: 6, src: { mat: m } });
    }
  }
}

// ------------------------------------------------------------------ the podium (something to climb)
/**
 * A stone-footed wooden podium with a lower step beside it. Returns the standable boxes
 * [{ x0, x1, z0, z1, top }] — fighters ask `groundAt` what is under their feet.
 */
export function buildPlatforms(game) {
  const a = game.arena, M = a.M, sh = a.sh, scene = game.scene;
  const list = [];
  const box = (cx, cz, w, d, top, mat) => {
    const m = sh(new THREE.Mesh(new THREE.BoxGeometry(w, top, d), mat));
    m.position.set(cx, top / 2, cz);
    scene.add(m);
    a.staticBox(w, top, d, cx, top / 2, cz, 0, 'wood');
    list.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, top });
    return m;
  };
  const cx = -8.1, cz = 1.4;
  box(cx, cz, 2.6, 2.6, 1.9, M.darkWood);
  box(cx + 1.85, cz, 1.1, 1.6, 0.95, M.wood);
  // deck planks, corner posts and a little roofed lantern post for looks
  const deck = sh(new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 2.9), M.wood));
  deck.position.set(cx, 1.9, cz);
  scene.add(deck);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = sh(new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.0, 0.16), M.vermilion));
    post.position.set(cx + sx * 1.3, 1.0, cz + sz * 1.3);
    scene.add(post);
  }
  for (const y of [0.5, 1.2]) {
    const band = sh(new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.1, 2.66), M.stone));
    band.position.set(cx, y, cz);
    scene.add(band);
  }
  a.obstacles.push([cx, cz, 1.95]);
  return list;
}
