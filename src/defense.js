// Defense mode: a shrine inside a palisade with three ways in. Waves come for the shrine; what they
// leave behind is money, and money buys soldiers, traps and repairs in the pause between waves.
import * as THREE from 'three';
import { rand, clamp } from './physics.js';
import { TYPES, ALLY_STYLE, randomType } from './roster.js';

export const FORT_R = 6.2;
const SEG = 24;
const WALL_H = 2.2;
/** The three ways in. Angles as everywhere in the yard: x = sin(a), z = cos(a). */
export const GATES = [
  { a: Math.PI, name: 'Tor' },
  { a: Math.PI / 4, name: 'Brücke' },
  { a: -Math.PI / 4, name: 'Mauerlücke' },
];
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const isGap = (a) => GATES.some((g) => Math.abs(angDiff(a, g.a)) < 0.27);

const soldier = (base, name, weapons, posture) => ({ ...base, key: 'ally', name, weapons, styles: [ALLY_STYLE], posture, rank: 1 });
const SOLDIERS = {
  spear: { type: soldier(TYPES.ashigaru, 'Speerträger', ['yari'], 1.1), leash: 5 },
  archer: { type: soldier(TYPES.archer, 'Bogenschütze', TYPES.archer.weapons, 1.0), leash: 15 },
  samurai: { type: soldier(TYPES.samurai, 'Samurai', ['katana', 'naginata'], 1.5), leash: 7 },
};

export const SHOP_ITEMS = [
  { key: 'spear', kind: 'soldier', name: 'Speerträger', desc: 'Hält seine Stellung mit dem Speer', cost: 40 },
  { key: 'archer', kind: 'soldier', name: 'Bogenschütze', desc: 'Schießt von seinem Platz aus auf alles, was kommt', cost: 60 },
  { key: 'samurai', kind: 'soldier', name: 'Samurai', desc: 'Der beste Mann am Platz', cost: 100 },
  { key: 'spikes', kind: 'trap', name: 'Stachelgrube', desc: 'Durchbohrt die Beine von vier Gegnern', cost: 25 },
  { key: 'wire', kind: 'trap', name: 'Stolperdraht', desc: 'Reißt zwei Gegner zu Boden', cost: 15 },
  { key: 'oil', kind: 'trap', name: 'Ölfass', desc: 'Geht in Flammen auf, sobald ein Gegner herankommt', cost: 35 },
  { key: 'barricade', kind: 'trap', name: 'Barrikade', desc: 'Versperrt den Weg, bis sie zerhackt ist', cost: 30 },
  { key: 'repair', kind: 'up', name: 'Schrein ausbessern', desc: 'Stellt 40 Schreinpunkte wieder her', cost: 30 },
  { key: 'walls', kind: 'up', name: 'Mauern verstärken', desc: 'Schrein und Barrikaden halten mehr aus (bis Stufe 3)', cost: 60 },
  { key: 'tower', kind: 'up', name: 'Wachturm', desc: 'Ein Schütze auf dem Turm deckt den Hof (höchstens 2)', cost: 120 },
];
const SHOP_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];

/** Every fifth wave is led by someone with a name and a way of fighting of his own. */
const BOSSES = [
  { key: 'breaker', name: 'Kuro der Brecher', base: 'oni', kanji: '砕', say: 'ER WILL DEN SCHREIN', posture: 2.2, raider: true, heavy: 0.8 },
  { key: 'blade', name: 'Hayate die Klinge', base: 'daimyo', kanji: '疾', say: 'ER WILL DEINEN KOPF', posture: 1.6, raider: false, aggr: 1.5 },
  { key: 'lord', name: 'Fürst Akuma', base: 'daimyo', kanji: '魔', say: 'ER RUFT VERSTÄRKUNG', posture: 2.6, raider: false, summon: 12 },
];

const MAX_SOLDIERS = 6, MAX_TRAPS = 14, MAX_TOWERS = 2, MAX_ALIVE = 7;
const TOWER_SPOTS = [[2.9, -3.3], [-2.9, -3.3]];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Something that is not a fighter but can be gone for: the shrine, a barricade. Looks enough like one for a Brain. */
function structure(x, z, h, extra) {
  const pos = new THREE.Vector3(x, 0, z);
  return {
    isStructure: true, team: 0, state: 'active', dead: false, disposed: false, groundY: 0, guardT: 0, mountH: 0, iframeT: 0,
    attackPhase: null, weapon: null, hp: 1, maxHp: 1,
    core: { velocity: { x: 0, y: 0, z: 0 }, position: pos },
    parts: { torso: { position: new THREE.Vector3(x, h, z) } },
    getPos(out = new THREE.Vector3()) { return out.copy(pos); },
    getHeadPos(out = new THREE.Vector3()) { return out.set(pos.x, h + 0.4, pos.z); },
    ...extra,
  };
}

export class Defense {
  constructor(game) {
    this.game = game;
    this.built = false;
    this.on = false;
    this.bodies = [];
    this.traps = [];
    this.towers = [];
    this.soldiers = [];
    this.queue = [];
    this.money = 0;
    this.phase = 'build';
    this.buildT = 0;
    this.fallen = false;
    this.follow = false;
    this.level = 0;
    this.stats = { trapHits: 0, hired: 0 };
    this.shrine = structure(0, 0, 1.0, { isShrine: true, name: 'Schrein' });
    this.towerOwner = { team: 0, isPlayer: false, isTower: true, getPos: (out = new THREE.Vector3()) => out.set(0, 3.4, 0) };

    const hud = this.hud = document.createElement('div');
    hud.id = 'def-hud';
    hud.innerHTML = '<div class="row"><span>Schrein</span><div class="track"><i></i></div><b></b></div><div class="info"></div>';
    document.body.appendChild(hud);
    this.hpFill = hud.querySelector('i'); this.hpText = hud.querySelector('b'); this.info = hud.querySelector('.info');
    const shop = this.shopEl = document.createElement('div');
    shop.id = 'def-shop';
    document.body.appendChild(shop);
    shop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-key]');
      if (b) this.buy(b.dataset.key);
      else if (e.target.closest('[data-go]')) this.startWave();
    });
  }

  get active() { return this.game.mode === 'defense'; }

  // ------------------------------------------------------------------ the place
  build() {
    this.built = true;
    const g = this.game, a = g.arena, M = a.M, sh = a.sh;
    const grp = this.group = new THREE.Group();
    // palisade: sharpened stakes between the gates
    const segs = [];
    for (let i = 0; i < SEG; i++) { const ang = ((i + 0.5) / SEG) * Math.PI * 2; if (!isGap(ang)) segs.push(ang); }
    const segLen = (2 * Math.PI * FORT_R) / SEG;
    const PER = 6;
    const stakes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.115, 0.135, WALL_H, 6), M.darkWood, segs.length * PER);
    const tips = new THREE.InstancedMesh(new THREE.ConeGeometry(0.115, 0.3, 6), M.wood, segs.length * PER);
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(segLen + 0.05, 0.12, 0.08), M.wood, segs.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    let n = 0, r = 0;
    for (const ang of segs) {
      q.setFromAxisAngle(UP, ang);
      for (let j = 0; j < PER; j++) {
        const a2 = ang + ((j + 0.5) / PER - 0.5) * (Math.PI * 2 / SEG);
        const h = WALL_H + Math.sin(n * 2.3) * 0.12;
        m4.compose(p.set(Math.sin(a2) * FORT_R, h / 2, Math.cos(a2) * FORT_R), q, s.set(1, h / WALL_H, 1)); stakes.setMatrixAt(n, m4);
        m4.compose(p.set(Math.sin(a2) * FORT_R, h + 0.15, Math.cos(a2) * FORT_R), q, s.set(1, 1, 1)); tips.setMatrixAt(n, m4);
        n++;
      }
      for (const [y, off] of [[0.7, -0.14], [1.6, -0.14]]) {
        m4.compose(p.set(Math.sin(ang) * (FORT_R + off), y, Math.cos(ang) * (FORT_R + off)), q, s.set(1, 1, 1)); rails.setMatrixAt(r++, m4);
      }
      this.bodies.push(a.staticBox(segLen + 0.1, WALL_H + 0.4, 0.34, Math.sin(ang) * FORT_R, (WALL_H + 0.4) / 2, Math.cos(ang) * FORT_R, ang, 'wood'));
    }
    for (const im of [stakes, tips, rails]) { im.castShadow = true; im.receiveShadow = true; grp.add(im); }

    // what marks each way in
    const gateEdge = Math.PI * 2 / SEG;
    const at = (ang, rad, y, mesh, rot = ang) => { mesh.position.set(Math.sin(ang) * rad, y, Math.cos(ang) * rad); mesh.rotation.y = rot; grp.add(sh(mesh)); return mesh; };
    const [tor, bridge, gap] = GATES;
    for (const sd of [-1, 1]) at(tor.a + sd * gateEdge, FORT_R, 1.6, new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), M.vermilion));
    at(tor.a, FORT_R, 3.1, new THREE.Mesh(new THREE.BoxGeometry(segLen * 2 + 0.9, 0.24, 0.36), M.vermilion));
    at(tor.a, FORT_R, 3.36, new THREE.Mesh(new THREE.BoxGeometry(segLen * 2 + 1.4, 0.14, 0.5), M.tile));
    const moat = at(bridge.a, FORT_R + 1.5, 0.012, new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.02, 1.7), new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.25, metalness: 0.4 })));
    moat.castShadow = false;
    at(bridge.a, FORT_R + 1.5, 0.07, new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 2.0), M.wood));
    for (const sd of [-1, 1]) at(bridge.a + sd * gateEdge * 0.78, FORT_R + 1.5, 0.3, new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 2.0), M.darkWood), bridge.a);
    for (let i = 0; i < 5; i++) {
      const st = at(gap.a + (i < 3 ? -1 : 1) * gateEdge * (0.82 + i * 0.05), FORT_R + rand(-0.2, 0.3), 0.35 + i * 0.1, new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.9 + i * 0.2, 6), M.darkWood));
      st.rotation.z = rand(-0.5, 0.5); st.rotation.x = rand(-0.4, 0.4);
    }

    // the shrine: stone steps, a little house with a heavy roof, a light inside
    const sg = this.shrineGroup = new THREE.Group();
    const add = (geo, mat, y) => { const m = sh(new THREE.Mesh(geo, mat)); m.position.y = y; sg.add(m); return m; };
    add(new THREE.BoxGeometry(1.7, 0.22, 1.7), M.stone, 0.11);
    add(new THREE.BoxGeometry(1.25, 0.22, 1.25), M.stone, 0.33);
    add(new THREE.BoxGeometry(0.86, 0.9, 0.86), M.darkWood, 0.89);
    add(new THREE.BoxGeometry(0.5, 0.5, 0.04), M.glow, 0.92).position.z = 0.44;
    const roof = add(new THREE.ConeGeometry(1.05, 0.55, 4), M.tile, 1.62); roof.rotation.y = Math.PI / 4;
    add(new THREE.BoxGeometry(0.16, 0.16, 0.16), M.vermilion, 1.96);
    for (const sx of [-1, 1]) { const post = add(new THREE.BoxGeometry(0.1, 1.0, 0.1), M.vermilion, 0.94); post.position.set(sx * 0.48, 0.94, 0.48); }
    grp.add(sg);
    this.shrineBody = a.staticBox(0.95, 1.9, 0.95, 0, 0.95, 0, 0, 'wood');
    this.bodies.push(this.shrineBody);

    grp.visible = false;
    g.scene.add(grp);
    for (const b of this.bodies) g.world.removeBody(b);
  }

  enter() {
    if (!this.built) this.build();
    if (this.on) return;
    this.on = true;
    this.group.visible = true;
    for (const b of this.bodies) this.game.world.addBody(b);
  }

  leave() {
    if (!this.on) return;
    this.on = false;
    this.clear();
    this.group.visible = false;
    for (const b of this.bodies) this.game.world.removeBody(b);
    this.hud.classList.remove('show');
    this.shopEl.classList.remove('show');
    document.body.classList.remove('shopping');
  }

  /** Everything bought is gone; soldiers are removed with the other fighters by the yard reset. */
  clear() {
    for (const t of this.traps) this.removeTrap(t, false);
    this.traps = [];
    for (const t of this.towers) { this.group.remove(t.mesh); this.game.world.removeBody(t.body); }
    this.towers = [];
    this.soldiers = [];
    this.queue = [];
  }

  /** A fresh run (called by the yard reset, whatever the mode). */
  reset() {
    if (!this.active) { this.leave(); return; }
    this.enter();
    this.clear();
    this.money = 80;
    this.level = 0;
    this.fallen = false;
    this.follow = false;
    this.shrine.maxHp = 100; this.shrine.hp = 100; this.shrine.dead = false; this.shrine.state = 'active';
    this.shrineGroup.rotation.set(0, 0, 0); this.shrineGroup.position.y = 0;
    this.sayT = 0; this.boss = null; this.summonT = 0; this.towerT = 0;
    this.phase = 'build';
    this.buildT = 20;
    this.stats = { trapHits: 0, hired: 0 };
    this.hud.classList.add('show');
    this.refreshShop();
    this.game.callout('VERTEIDIGE DEN SCHREIN', null, 'crit');
  }

  // ------------------------------------------------------------------ waves
  startWave() {
    const g = this.game;
    if (!this.active || this.phase !== 'build' || this.fallen || g.runOver) return false;
    this.phase = 'wave';
    g.wave++;
    const w = g.wave;
    this.queue = [];
    const n = Math.min(3 + w, 12);
    for (let i = 0; i < n; i++) {
      let t = randomType(Math.min(1, w * 0.08));
      if (t === 'rider') t = 'samurai';            // no room to ride between the stakes
      this.queue.push(t);
    }
    this.boss = null;
    if (w % 5 === 0) this.queue.unshift({ boss: BOSSES[(w / 5 - 1) % BOSSES.length] });
    this.spawnT = 0;
    this.refreshShop();
    g.callout(w % 5 === 0 ? `WELLE ${w} · ANFÜHRER` : `WELLE ${w}`, null, 'crit');
    g.audio.taiko(0.8);
    return true;
  }

  spawnNext() {
    const g = this.game, w = g.wave;
    const next = this.queue.shift();
    const gate = GATES[Math.floor(Math.random() * GATES.length)];
    const ang = gate.a + rand(-0.22, 0.22), rad = rand(10.2, 11.4);
    const pos = new THREE.Vector3(Math.sin(ang) * rad, 0, Math.cos(ang) * rad);
    let k;
    if (next.boss) {
      const B = next.boss, tier = Math.floor((w / 5 - 1) / BOSSES.length);
      const base = TYPES[B.base];
      k = g.spawnFighter(1, null, pos, { ...base, name: B.name, rank: 5, courage: 1, heavy: B.heavy ?? base.heavy });
      k.boss = B.key;
      k.postureMax *= B.posture * (1 + 0.4 * tier);
      if (B.aggr) k.brain.aggr *= B.aggr;
      k.brain.raider = B.raider;
      this.boss = k; this.summonT = B.summon || 0;
      g.kanji?.(B.kanji);
      g.callout(`${B.name.toUpperCase()} · ${B.say}`, null, 'crit');
    } else {
      k = g.spawnFighter(1, next, pos);
      k.brain.raider = Math.random() < 0.55;
    }
    k.brain.aggr *= 1 + 0.03 * w;
    k.brain.blockSkill = Math.min(0.9, k.brain.blockSkill + 0.015 * w);
    k.postureMax *= 1 + 0.04 * w;
    return k;
  }

  waveCleared() {
    const g = this.game, w = g.wave;
    g.audio.sting?.('wave');
    this.phase = 'build';
    this.buildT = 25;
    const pay = 30 + 10 * w;
    this.money += pay;
    g.ctl.heals = Math.min(g.ctl.maxHeals, g.ctl.heals + 1);
    for (const s of this.soldiers) if (s.state === 'active' && !s.dead) { s.inj.treat(); s.clearWounds?.(); }
    g.callout(`WELLE ${w} ABGEWEHRT · +${pay} MON`, null, 'parry');
    g.progress.earn(12 * w);
    g.ach?.best('defWave', w);
    this.refreshShop();
  }

  onKill(e) {
    if (!this.active || this.fallen) return;
    const pay = e.boss ? 100 : 6 + 4 * (e.kind?.rank ?? 1);
    this.money += pay;
    if (e.boss) { this.game.callout(`ANFÜHRER GEFALLEN · +${pay} MON`, null, 'parry'); this.game.ach?.add('boss'); if (this.boss === e) this.boss = null; }
    if (this.phase === 'build') this.refreshShop();
  }

  // ------------------------------------------------------------------ what enemies go for, and how they get there
  /** Team 1 in defense: raiders make for the shrine, the rest for whoever is closest; a barricade in the way comes first. */
  chooseTarget(brain, best, bestD, me) {
    if (this.fallen) return best;
    const shrine = this.shrine;
    let want = best;
    if (!best || (brain.raider && bestD > 2.4)) want = shrine;
    const wp = want.getPos(_w);
    const tx = wp.x - me.x, tz = wp.z - me.z, td = Math.hypot(tx, tz) || 1;
    for (const t of this.traps) {
      if (t.kind !== 'barricade' || t.target.dead) continue;
      const bx = t.x - me.x, bz = t.z - me.z, bd = Math.hypot(bx, bz);
      if (bd < 1.9 && bd < td && (bx * tx + bz * tz) / (bd * td || 1) > 0.25) return t.target;
    }
    return want;
  }

  /**
   * The palisade stands between a fighter and where he wants to go: send him through a gate (or round the
   * outside). Returns a unit direction in `out`, or null when the straight line is free.
   */
  route(me, goal, out) {
    const rm = Math.hypot(me.x, me.z), rg = Math.hypot(goal.x, goal.z);
    const inM = rm < FORT_R, inG = rg < FORT_R;
    if (inM && inG) return null;
    if (!inM && !inG) {
      // both outside: only a problem when the line cuts through the fort
      const dx = goal.x - me.x, dz = goal.z - me.z, len2 = dx * dx + dz * dz || 1;
      const t = clamp(-(me.x * dx + me.z * dz) / len2, 0, 1);
      if (Math.hypot(me.x + dx * t, me.z + dz * t) > FORT_R + 0.7) return null;
      const tx = -me.z / rm, tz = me.x / rm, sgn = tx * dx + tz * dz >= 0 ? 1 : -1;
      const push = rm < FORT_R + 1.3 ? 0.6 : 0;
      return out.set(tx * sgn + (me.x / rm) * push, 0, tz * sgn + (me.z / rm) * push).normalize();
    }
    const [outer, inner] = inM ? [goal, me] : [me, goal];
    let best = null, bd = Infinity;
    for (const g of GATES) {
      const sx = Math.sin(g.a), cz = Math.cos(g.a);
      const d = Math.hypot(outer.x - sx * (FORT_R + 1.3), outer.z - cz * (FORT_R + 1.3)) + Math.hypot(inner.x - sx * (FORT_R - 1.3), inner.z - cz * (FORT_R - 1.3));
      if (d < bd) { bd = d; best = g; }
    }
    const sx = Math.sin(best.a), cz = Math.cos(best.a);
    const lateral = Math.abs(me.x * cz - me.z * sx), along = me.x * sx + me.z * cz;
    const lined = lateral < 0.75 && along > 0;                     // in the gate's lane: straight through
    const rad = lined ? (inM ? FORT_R + 1.4 : FORT_R - 1.4) : (inM ? FORT_R - 1.4 : FORT_R + 1.4);
    out.set(sx * rad - me.x, 0, cz * rad - me.z);
    if (out.lengthSq() < 0.04) return null;
    return out.normalize();
  }

  /** A blow (or shot) landed on the shrine or a barricade. */
  hitStructure(s, k, heavy = false, mul = 1) {
    if (!this.active || s.dead) return;
    const g = this.game;
    const dmg = (k?.boss === 'breaker' ? 11 : 4) * (heavy ? 1.6 : 1) * mul;
    s.hp = Math.max(0, s.hp - dmg);
    const at = s.getHeadPos(_v); at.y -= 0.6;
    g.effects.splinters(at, UP, 10);
    g.audio.wood?.(0.7, true);
    if (s.isShrine) {
      if (this.sayT <= 0 && s.hp > 0) { g.callout('DER SCHREIN WIRD ANGEGRIFFEN!', null, 'crit'); this.sayT = 6; }
      this.shakeT = 0.25;
      if (s.hp <= 0) this.fall();
    } else if (s.hp <= 0) {
      s.dead = true; s.state = 'gone';
      const t = this.traps.find((x) => x.target === s);
      if (t) { g.effects.splinters(at, UP, 40); g.audio.wood?.(1, true); this.removeTrap(t); }
    }
  }

  fall() {
    const g = this.game, s = this.shrine;
    if (this.fallen) return;
    this.fallen = true;
    s.dead = true; s.state = 'gone';
    this.refreshShop();
    g.effects.splinters(_v.set(0, 1, 0), UP, 80);
    g.effects.dust(_v.set(0, 0.2, 0), 40, 2.5);
    g.audio.taiko(1);
    g.shake = Math.max(g.shake, 0.8);
    this.shrineGroup.rotation.z = 0.35; this.shrineGroup.position.y = -0.35;
    g.callout('DER SCHREIN IST GEFALLEN', null, 'crit');
  }

  // ------------------------------------------------------------------ the shop
  /** Where something bought is put down: a good step in front of the player. */
  spot(dist = 1.6) {
    const P = this.game.player;
    const p = P.getPos(new THREE.Vector3()), f = P.forward(_v);
    p.x += f.x * dist; p.z += f.z * dist; p.y = 0;
    return p;
  }

  /** Something of the fort stands here (palisade, shrine, tower, barricade, barrel). */
  blocksSpot(x, z, pad = 0.5) {
    if (!this.on) return false;
    const r = Math.hypot(x, z);
    if (r < 0.9 + pad) return true;
    if (Math.abs(r - FORT_R) < 0.3 + pad && !GATES.some((gt) => Math.abs(angDiff(Math.atan2(x, z), gt.a)) < 0.17)) return true;
    if (this.towers.some((t) => Math.abs(x - t.x) < 0.6 + pad && Math.abs(z - t.z) < 0.6 + pad)) return true;
    return this.traps.some((t) => t.body && Math.hypot(x - t.x, z - t.z) < (t.kind === 'barricade' ? 1.2 : 0.4) + pad);
  }

  /** Why this cannot be bought right now ('' when it can). */
  blocked(it) {
    const g = this.game, P = g.player;
    if (!this.active || this.fallen || g.runOver) return 'Jetzt nicht';
    if (this.phase !== 'build') return 'Nur in der Baupause';
    if (this.money < it.cost) return 'Zu wenig Geld';
    if (it.kind !== 'up' && (P.state !== 'active' || P.dead)) return 'Jetzt nicht';
    if (it.kind === 'soldier' && this.living.length >= MAX_SOLDIERS) return `Höchstens ${MAX_SOLDIERS} Soldaten`;
    if (it.kind === 'trap') {
      if (this.traps.length >= MAX_TRAPS) return `Höchstens ${MAX_TRAPS} Fallen`;
      const p = this.spot();
      if (Math.hypot(p.x, p.z) < 1.7) return 'Zu nah am Schrein';
      if (Math.hypot(p.x, p.z) > 12.2) return 'Zu nah an der Hofmauer';
      if (Math.abs(Math.hypot(p.x, p.z) - FORT_R) < 0.7 && !GATES.some((gt) => Math.abs(angDiff(Math.atan2(p.x, p.z), gt.a)) < 0.2)) return 'Hier steht die Palisade';
      if (g.groundAt(p.x, p.z, 10) > 0 || g.arena.obstacles.some(([ox, oz, r]) => Math.hypot(p.x - ox, p.z - oz) < r + 0.3)) return 'Hier ist kein Platz';
      if (this.towers.some((t) => Math.hypot(p.x - t.x, p.z - t.z) < 1.5)) return 'Hier steht ein Turm';
      if (this.traps.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 1.0)) return 'Hier liegt schon etwas';
    }
    if (it.key === 'repair' && this.shrine.hp >= this.shrine.maxHp) return 'Der Schrein ist heil';
    if (it.key === 'walls' && this.level >= 3) return 'Höchste Stufe';
    if (it.key === 'tower' && this.towers.length >= MAX_TOWERS) return 'Beide Türme stehen';
    return '';
  }

  get living() { return this.soldiers.filter((s) => !s.disposed && !s.dead && !s.counted); }

  buy(key) {
    const it = SHOP_ITEMS.find((s) => s.key === key);
    const g = this.game;
    if (!it) return false;
    const why = this.blocked(it);
    if (why) { g.callout(why.toUpperCase(), null, 'small'); return false; }
    this.money -= it.cost;
    if (it.kind === 'soldier') this.hire(key);
    else if (it.kind === 'trap') this.place(key);
    else if (key === 'repair') this.shrine.hp = Math.min(this.shrine.maxHp, this.shrine.hp + 40);
    else if (key === 'walls') {
      this.level++;
      this.shrine.maxHp += 40; this.shrine.hp += 40;
      for (const t of this.traps) if (t.kind === 'barricade') { t.target.maxHp += 20; t.target.hp += 20; }
    } else if (key === 'tower') this.raiseTower();
    g.callout(it.name.toUpperCase(), null, 'parry');
    g.audio.tick?.();
    this.refreshShop();
    return true;
  }

  hire(key) {
    const g = this.game, P = g.player, S = SOLDIERS[key];
    const p = P.getPos(new THREE.Vector3()), f = P.forward(_v);
    const side = this.soldiers.length % 2 ? -1 : 1, me = p.clone();
    // beside the player; if something stands there, the other side, behind, or right where the player is
    for (const [sx, sz] of [[side, 0], [-side, 0], [0, -1], [0.4 * side, 0]]) {
      p.set(me.x + (-f.z * sx + f.x * sz) * 1.3, 0, me.z + (f.x * sx + f.z * sz) * 1.3);
      const r = Math.hypot(p.x, p.z);
      if (r > 12) p.multiplyScalar(12 / r);
      if (g.spotFree(p.x, p.z)) break;
    }
    const k = g.spawnFighter(0, null, p, S.type);
    k.soldier = key;
    k.brain.post = p.clone();
    k.brain.leash = S.leash;
    k.brain.follow = this.follow;
    this.soldiers.push(k);
    this.stats.hired++;
    g.ach?.add('hired');
    return k;
  }

  toggleOrder() {
    if (!this.active) return;
    this.follow = !this.follow;
    for (const s of this.living) {
      s.brain.follow = this.follow;
      if (!this.follow) s.getPos(s.brain.post).setY(0);
    }
    this.game.callout(this.follow ? 'SOLDATEN: FOLGT MIR' : 'SOLDATEN: STELLUNG HALTEN', null, 'small');
  }

  place(kind) {
    const g = this.game, M = g.arena.M, sh = g.arena.sh;
    const p = this.spot();
    const f = g.player.forward(_v);
    const yaw = Math.atan2(f.x, f.z);                   // the thing lies across the way the player looks
    const mesh = new THREE.Group();
    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = yaw;
    const t = { kind, x: p.x, z: p.z, yaw, mesh, uses: 1 };
    if (kind === 'spikes') {
      t.uses = 4;
      const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.03, 14), new THREE.MeshStandardMaterial({ color: 0x120d0a, roughness: 1 }));
      pit.position.y = 0.016; pit.receiveShadow = true; mesh.add(pit);
      for (let i = 0; i < 12; i++) {
        const sp = sh(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.42, 5), M.wood));
        const a = i * 2.4, r = 0.2 + (i % 4) * 0.19;
        sp.position.set(Math.sin(a) * r, 0.2, Math.cos(a) * r); mesh.add(sp);
      }
    } else if (kind === 'wire') {
      t.uses = 2;
      for (const sx of [-1, 1]) { const peg = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.34, 6), M.darkWood)); peg.position.set(sx * 1.2, 0.17, 0); mesh.add(peg); }
      const wire = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: 0xbdb6a6 }));
      wire.position.y = 0.26; mesh.add(wire);
    } else if (kind === 'oil') {
      const barrel = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.72, 12), M.darkWood));
      barrel.position.y = 0.36; mesh.add(barrel);
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 12), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.15, metalness: 0.6 }));
      lid.position.y = 0.73; mesh.add(lid);
      for (const y of [0.16, 0.56]) { const band = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.04, 12), M.iron); band.position.y = y; mesh.add(band); }
      t.body = g.arena.staticBox(0.5, 0.72, 0.5, p.x, 0.36, p.z, yaw, 'wood');
    } else {
      for (const y of [0.25, 0.62, 0.99]) { const plank = sh(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.26, 0.1), M.wood)); plank.position.y = y; plank.rotation.z = (y - 0.6) * 0.06; mesh.add(plank); }
      for (const sx of [-0.9, 0, 0.9]) {
        const post = sh(new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 0.14), M.darkWood)); post.position.set(sx, 0.65, 0.1); mesh.add(post);
        const spike = sh(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.7, 5), M.darkWood)); spike.position.set(sx + 0.3, 0.75, -0.3); spike.rotation.x = -1.0; mesh.add(spike);
      }
      t.body = g.arena.staticBox(2.2, 1.2, 0.36, p.x, 0.6, p.z, yaw, 'wood');
      t.target = structure(p.x, p.z, 0.7, { isBarricade: true, name: 'Barrikade' });
      t.target.maxHp = t.target.hp = 40 + 20 * this.level;
    }
    this.group.add(mesh);
    this.traps.push(t);
    g.effects.dust(p, 10);
    return t;
  }

  removeTrap(t, splice = true) {
    this.group.remove(t.mesh);
    if (t.body) this.game.world.removeBody(t.body);
    if (t.target) { t.target.dead = true; t.target.state = 'gone'; }
    if (splice) this.traps = this.traps.filter((x) => x !== t);
  }

  raiseTower() {
    const g = this.game, M = g.arena.M, sh = g.arena.sh;
    const [x, z] = TOWER_SPOTS[this.towers.length];
    // whoever stands where the tower goes up is moved out of the way first
    for (const k of g.fighters) {
      const c = k.core?.position;
      if (k.state === 'active' && c && Math.abs(c.x - x) < 1.1 && Math.abs(c.z - z) < 1.1) { c.z = z + 1.4; c.x = x * 0.6; }
    }
    for (const t of [...this.traps]) if (Math.hypot(t.x - x, t.z - z) < 1.5) this.removeTrap(t);
    const mesh = new THREE.Group();
    mesh.position.set(x, 0, z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const post = sh(new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.9, 0.14), M.darkWood)); post.position.set(sx * 0.5, 1.45, sz * 0.5); mesh.add(post); }
    const deck = sh(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.4), M.wood)); deck.position.y = 2.9; mesh.add(deck);
    for (const y of [1.0, 2.0]) { const brace = sh(new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.08, 1.14), M.wood)); brace.position.y = y; mesh.add(brace); }
    const roof = sh(new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.5, 4), M.tile)); roof.position.y = 4.55; roof.rotation.y = Math.PI / 4; mesh.add(roof);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const post = sh(new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), M.darkWood)); post.position.set(sx * 0.6, 3.6, sz * 0.6); mesh.add(post); }
    const man = sh(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.75, 3, 8), new THREE.MeshStandardMaterial({ color: ALLY_STYLE.armor, roughness: 0.7 }))); man.position.y = 3.5; mesh.add(man);
    this.group.add(mesh);
    const body = g.arena.staticBox(1.1, 2.9, 1.1, x, 1.45, z, 0, 'wood');
    this.towers.push({ x, z, mesh, body, t: rand(0.5, 1.5) });
    g.effects.dust(_v.set(x, 0, z), 20, 1.5);
  }

  refreshShop() {
    const show = this.active && this.phase === 'build' && !this.fallen;
    this.shopEl.classList.toggle('show', show);
    document.body.classList.toggle('shopping', show);         // the controls panel makes room for the shop
    if (!show) return;
    const rows = SHOP_ITEMS.map((it, i) => {
      const why = this.blocked(it);
      return `<button class="it${why ? ' no' : ''}" data-key="${it.key}" title="${why}"><kbd>${(i + 1) % 10}</kbd><div><b>${it.name}</b><span>${it.desc}</span></div><em>${it.cost}</em></button>`;
    }).join('');
    this.shopEl.innerHTML = `<div class="head">Baupause · <b>${this.money} Mon</b></div>${rows}`
      + '<div class="foot">Gekauftes landet einen Schritt vor dir · <kbd>J</kbd> Soldaten folgen / halten</div>'
      + '<button class="go" data-go="1"><kbd>Enter</kbd> Welle starten</button>';
    this.shopSig = this.shopSignature();
  }
  shopSignature() { return SHOP_ITEMS.map((it) => (this.blocked(it) ? 0 : 1)).join('') + this.money; }

  keys(pressed) {
    if (!this.active || this.fallen) return false;
    if (pressed.has('KeyJ')) this.toggleOrder();
    if (this.phase !== 'build') return false;
    if (pressed.has('Enter') || pressed.has('KeyR')) { this.startWave(); return true; }
    let used = false;
    SHOP_KEYS.forEach((code, i) => { if (pressed.has(code)) { this.buy(SHOP_ITEMS[i].key); used = true; } });
    return used;
  }

  /** The camera must not end up on the other side of the palisade from the player, or inside the shrine. */
  keepCamera(target, pos) {
    if (!this.on) return;
    const rt = Math.hypot(target.x, target.z), rc = Math.hypot(pos.x, pos.z);
    const inside = rt < FORT_R, limit = inside ? FORT_R - 0.5 : FORT_R + 0.5;
    const lane = (x, z) => GATES.some((g) => Math.abs(x * Math.cos(g.a) - z * Math.sin(g.a)) < 1.0 && x * Math.sin(g.a) + z * Math.cos(g.a) > 0);
    if ((inside ? rc > limit : rc < limit) && !(lane(target.x, target.z) && lane(pos.x, pos.z))) {
      // walk back from the camera towards the player until it is on the player's side again
      let lo = 0, hi = 1;
      for (let i = 0; i < 9; i++) {
        const t = (lo + hi) / 2, r = Math.hypot(target.x + (pos.x - target.x) * t, target.z + (pos.z - target.z) * t);
        if (inside ? r > limit : r < limit) hi = t; else lo = t;
      }
      const t = Math.max(0.12, lo);
      pos.x = target.x + (pos.x - target.x) * t; pos.z = target.z + (pos.z - target.z) * t;
      pos.y += (1 - t) * 0.9;                    // closer in means higher up, over the shoulder
    }
    const d = Math.hypot(pos.x, pos.z);
    if (d < 1.15 && pos.y < 2.4 && !this.fallen) { const k = 1.15 / (d || 1); pos.x = (pos.x || 0.01) * k; pos.z = (pos.z || 0.01) * k; }
  }

  // ------------------------------------------------------------------ every frame
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this.sayT -= dt;
    if (this.shakeT > 0) { this.shakeT -= dt; this.shrineGroup.position.x = this.shakeT > 0 ? Math.sin(g.time * 90) * 0.02 : 0; }
    this.updateHud();
    if (this.fallen || g.runOver) return;
    this.soldiers = this.soldiers.filter((s) => !s.disposed);
    if (this.phase === 'build') {
      this.buildT -= dt;
      if (this.shopSignature() !== this.shopSig) this.refreshShop();       // what can be placed depends on where the player stands
      if (this.buildT <= 0) this.startWave();
      return;
    }
    const alive = g.livingEnemies.length;
    this.spawnT -= dt;
    if (this.queue.length && alive < MAX_ALIVE && this.spawnT <= 0) { this.spawnNext(); this.spawnT = rand(0.7, 1.5); }
    else if (!this.queue.length && !alive) { this.waveCleared(); return; }
    this.updateTraps();
    this.updateTowers(dt);
    const B = this.boss;
    if (B && B.boss === 'lord' && B.state === 'active' && !B.dead) {
      this.summonT -= dt;
      if (this.summonT <= 0 && alive < MAX_ALIVE + 2) {
        this.summonT = 12;
        this.queue.push('ashigaru', 'ashigaru');
        g.callout('VERSTÄRKUNG!', null, 'crit');
      }
    }
  }

  updateTraps() {
    const g = this.game;
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      if (t.kind === 'barricade') continue;
      const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw);
      for (const e of g.npcs) {
        if (e.team !== 1 || e.state !== 'active' || e.dead || e.mountH > 0 || (e.trapT || 0) > g.time) continue;
        const p = e.core.position;
        if (e.airborne && p.y > 1.5) continue;
        const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz);
        let hit = false;
        if (t.kind === 'spikes' && d < 0.95) {
          hit = true;
          e.inj.wound(Math.random() < 0.5 ? 'legR' : 'legL', 0.5, 'thrust', 0);
          e.stagger(_v.set(0, 0, 0), e.getPos(_w), 0.5, 0.9);
          e.brain?.onHit?.(0.5);
          g.effects.dust(_v.set(t.x, 0.1, t.z), 8);
          g.audio.thud?.(0.6);
        } else if (t.kind === 'wire') {
          // local frame: the wire runs along x, the fighter crosses it along z
          const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
          if (Math.abs(lx) < 1.25 && Math.abs(lz) < 0.35) {
            hit = true;
            const v = e.core.velocity, sp = Math.hypot(v.x, v.z) || 1;
            e.goRagdoll(new THREE.Vector3((v.x / sp) * 3.2, 0.6, (v.z / sp) * 3.2), 'pelvis', false);
            g.audio.thud?.(0.8);
          }
        } else if (t.kind === 'oil' && d < 1.6) {
          hit = true;
          g.fire.ignite(t.x, t.z, { r: 1.5, life: 9 });
          g.effects.splinters(_v.set(t.x, 0.5, t.z), UP, 30);
          g.effects.sparksAt(_v, 30, 1.4);
          g.audio.thud?.(1.2);
          for (const o of g.npcs) {
            if (o.team !== 1 || o.state !== 'active' || o.dead) continue;
            const q = o.core.position;
            if (Math.hypot(q.x - t.x, q.z - t.z) < 2.0) { o.inj.wound('torso', 0.3, 'blunt', 0); o.stagger(_v.set((q.x - t.x) * 2, 0, (q.z - t.z) * 2), o.getPos(_w), 0.5, 0.8); o.brain?.onHit?.(0.5); }
          }
        }
        if (!hit) continue;
        e.trapT = g.time + 1.5;
        this.stats.trapHits++;
        g.ach?.add('trapHits');
        if (--t.uses <= 0) { this.removeTrap(t); break; }
      }
    }
  }

  updateTowers(dt) {
    const g = this.game;
    for (const t of this.towers) {
      t.t -= dt;
      if (t.t > 0) continue;
      let best = null, bd = 14;
      for (const e of g.npcs) {
        if (e.team !== 1 || e.state !== 'active' || e.dead) continue;
        const p = e.core.position, d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d < bd && d > 1.5) { bd = d; best = e; }
      }
      if (!best) { t.t = 0.4; continue; }
      t.t = rand(2.2, 2.8);
      const aim = _w.copy(best.parts.torso.position);
      const v = best.core.velocity, lead = bd / 30;
      aim.x += v.x * lead; aim.z += v.z * lead; aim.y += 0.1;
      const from = new THREE.Vector3(t.x, 3.55, t.z);
      const dir = aim.clone().sub(from); dir.y = 0; dir.normalize();
      from.addScaledVector(dir, 0.85);
      const to = aim.clone().sub(from), d = to.length();
      to.divideScalar(d || 1); to.y += d * 0.0062; to.normalize();
      g.launch('arrow', this.towerOwner, from, to, 30);
      g.audio.whooshBurst?.(0.3);
    }
  }

  updateHud() {
    const g = this.game, s = this.shrine;
    const hp = `${Math.ceil(s.hp)} / ${s.maxHp}`;
    if (hp !== this.lastHp) { this.lastHp = hp; this.hpText.textContent = hp; this.hpFill.style.width = (clamp(s.hp / s.maxHp, 0, 1) * 100).toFixed(1) + '%'; this.hud.classList.toggle('low', s.hp / s.maxHp < 0.35); }
    const n = this.living.length;
    const info = `${this.money} Mon · Welle ${g.wave}${n ? ` · ${n} Soldaten${this.follow ? ' (folgen)' : ''}` : ''}`
      + (this.fallen ? '' : this.phase === 'build' ? ` · Baupause ${Math.max(0, Math.ceil(this.buildT))} s` : ` · noch ${g.livingEnemies.length + this.queue.length} Gegner`);
    if (info !== this.lastInfo) { this.lastInfo = info; this.info.textContent = info; }
  }
}
