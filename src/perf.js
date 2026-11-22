// Keeping it fluid on any machine: fewer draw calls (static things merged into one mesh per
// material) and a quality ladder that the game climbs or descends by itself to hold the frame rate.
import * as THREE from 'three';

const _m = new THREE.Matrix4();

/**
 * Merge every plain mesh under `root` into one mesh per material (and shadow flags). Only for
 * things that never move relative to `root`. Subtrees marked `userData.keep` are left alone.
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const walk = (o) => {
    if (o.userData.keep || !o.visible) return;
    if (o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && o.geometry.attributes.position && !o.geometry.morphAttributes.position) {
      const key = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    let n = 0;
    const geos = list.map((o) => {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld));
      if (!g.attributes.normal) g.computeVertexNormals();
      n += g.attributes.position.count;
      return g;
    });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let i = 0;
    for (const g of geos) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array.subarray(0, c * 3), i * 3);
      nor.set(g.attributes.normal.array.subarray(0, c * 3), i * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), i * 2);
      i += c;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
    for (const o of list) o.parent.remove(o);
    root.add(mesh);
  }
  return root;
}

// pixelRatio is relative to CSS pixels and never above the display's own
const LEVELS = [
  { name: 'Minimal', pr: 0.5, shadow: 0, bloom: false, lights: 3 },
  { name: 'Niedrig', pr: 0.67, shadow: 0, bloom: false, lights: 3 },
  { name: 'Mittel', pr: 0.85, shadow: 1024, bloom: true, lights: 3 },
  { name: 'Hoch', pr: 1.0, shadow: 2048, bloom: true, lights: 6 },
  { name: 'Sehr hoch', pr: 1.5, shadow: 2048, bloom: true, lights: 6 },
  { name: 'Ultra', pr: 2.0, shadow: 2048, bloom: true, lights: 6 },
];
const MODES = ['auto', 'low', 'mid', 'high'];
const MODE_NAME = { auto: 'Auto', low: 'Niedrig', mid: 'Mittel', high: 'Hoch' };
const FIXED = { low: 1, mid: 2, high: 4 };

export class Quality {
  constructor(game) {
    this.game = game;
    this.mode = 'auto';
    try { const m = localStorage.getItem('vibesamurai.quality'); if (MODES.includes(m)) this.mode = m; } catch { /* no storage */ }
    this.level = -1;
    this.ceiling = LEVELS.length - 1;     // auto: a level that proved too much is not tried again for a while
    this.ceilT = 0;
    this.acc = 0; this.frames = 0;
    this.fps = 60;
    this.refresh = 60;                    // best frame rate seen: what the display can show
    this.goodT = 0; this.badT = 0; this.settleT = 1.5;
    this.apply(this.mode === 'auto' ? 3 : FIXED[this.mode]);
  }

  get label() { return `${MODE_NAME[this.mode]} · ${Math.round(this.fps)} fps`; }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    try { localStorage.setItem('vibesamurai.quality', this.mode); } catch { /* ignore */ }
    this.ceiling = LEVELS.length - 1;
    this.apply(this.mode === 'auto' ? 3 : FIXED[this.mode]);
    return MODE_NAME[this.mode];
  }

  apply(level) {
    level = Math.max(0, Math.min(LEVELS.length - 1, level));
    const g = this.game, L = LEVELS[level], old = this.level >= 0 ? LEVELS[this.level] : null;
    this.level = level;
    this.pixelRatio = Math.min(L.pr, Math.max(1, devicePixelRatio));
    g.renderer.setPixelRatio(this.pixelRatio);
    g.composer.setPixelRatio(this.pixelRatio);
    g.resize();
    g.bloom.enabled = L.bloom;
    const sun = g.arena.sunLight;
    if (!old || old.shadow !== L.shadow) {
      sun.castShadow = L.shadow > 0;
      if (L.shadow > 0 && sun.shadow.mapSize.x !== L.shadow) {
        sun.shadow.mapSize.set(L.shadow, L.shadow);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
    }
    g.lanternLights = L.lights;
    g.shadowBudget = [0, 0, 3, 5, 7, 8][level];      // how many opponents throw a shadow (the nearest ones)
    g.arena.breakables.setLightBudget?.(L.lights);
    this.settleT = 1.5;
    this.goodT = this.badT = 0;
  }

  /** Call once per frame with the real frame time. */
  update(dt) {
    this.acc += dt; this.frames++;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc;
    const span = this.acc;
    this.acc = 0; this.frames = 0;
    this.game.ui.quality.textContent = this.label;
    if (document.hidden) return;
    if (this.settleT > 0) { this.settleT -= span; return; }      // shaders compile after a change: don't judge that
    if (this.fps > this.refresh) this.refresh = Math.min(this.fps, 360);
    if (this.mode !== 'auto') return;
    this.ceilT -= span;
    if (this.ceilT <= 0) this.ceiling = LEVELS.length - 1;
    const target = Math.min(this.refresh, 240);
    if (this.fps < target * 0.86 && this.fps < 118) {
      // not holding the display's rate: step down (quickly when it is really bad)
      this.badT += span; this.goodT = 0;
      if (this.badT >= (this.fps < target * 0.6 ? 1.5 : 3.5) && this.level > 0) {      // (a hitch is not a reason: only a rate that stays low)
        // remember that this level was too much, for longer each time it fails again
        this.ceiling = this.level - 1; this.ceilHold = Math.min(600, (this.ceilHold || 60) * 2); this.ceilT = this.ceilHold;
        this.apply(this.level - 1);
      }
    } else if (this.fps > target * 0.95) {
      // holding it comfortably for a while: try the next level up
      this.goodT += span; this.badT = 0;
      if (this.goodT >= 4 && this.level < this.ceiling && LEVELS[this.level + 1].pr <= Math.max(1, devicePixelRatio) + 0.01) this.apply(this.level + 1);
    } else { this.goodT = 0; this.badT = 0; }
  }
}
