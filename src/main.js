import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as CANNON from 'cannon-es';

import { createWorld, FIXED_DT, pointVelocity, rand, clamp, dampFactor, RENDER, syncMesh } from './physics.js';
import { Samurai } from './samurai.js';
import { ZONE_NAMES } from './injury.js';
import { WEAPONS, WEAPON_ORDER, Weapon } from './weapons.js';
import { Arena, ARENA_R } from './arena.js';
import { Effects } from './effects.js';
import { AudioFX } from './audio.js';
import { Brain } from './ai.js';
import { Input, PlayerController } from './player.js';
import { SKINS, SKIN_ORDER, TYPES, TYPE_ORDER, ALLY_STYLE, pick, randomType } from './roster.js';
import { GUARD, POSTURE, DEFLECT_WINDOW } from './combat.js';

const MODES = {
  duel: { name: 'Duell', call: 'DUELL' },
  skirmish: { name: 'Gefecht', call: 'GEFECHT' },
  survival: { name: 'Überleben', call: 'ÜBERLEBEN', run: true },     // waves that keep getting harder; death ends the run
  chaos: { name: 'Chaos', call: 'CHAOS', run: true },                 // they just keep coming, more and more
};
const MODE_ORDER = ['duel', 'skirmish', 'survival', 'chaos'];
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const ALLY_TYPE = { ...TYPES.ronin, key: 'ally', name: 'Verbündeter', weapons: ['katana', 'yari', 'naginata'], styles: [ALLY_STYLE], posture: 1.2 };
const ZONE_KNOCK = { head: 1.25, torso: 1.0, armR: 0.5, armL: 0.5, legR: 0.6, legL: 0.6 };
const STANCE = { guard: 'Chūdan', swing: 'Hieb', charge: 'Aufgeladen', parry: 'Deckung', free: 'Freie Klinge' };
const up = (t) => t.toUpperCase();
const MAX_CORPSES = 10;
const MAX_KUNAI = 12;
const WALL_LIMIT = ARENA_R + 0.9;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UPV = new THREE.Vector3(0, 1, 0);
const _cv = new CANNON.Vec3();
const _cv2 = new CANNON.Vec3();

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 400);
    this.camera.position.set(0, 2, 8);

    // reflections for steel and lacquer: a dusk sky with a low sun
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x3a2c44);
    const envLight = (c, x, y, z, s) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 8), new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(x, y, z); envScene.add(m);
    };
    envLight(0xffb070, -3, 1.5, -7, 1.6); envLight(0xc8a0b8, 6, 3, 3, 2.2); envLight(0x8088b0, -6, 3, 4, 2);
    envLight(0x9aa0d0, 0, 10, 0, 5); envLight(0x141010, 0, -8, 0, 6);
    this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environmentIntensity = 0.7;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.cine = new ShaderPass(CINEMATIC);
    this.cine.uniforms.res.value.set(innerWidth, innerHeight);
    this.composer.addPass(this.cine);
    this.fx = { chroma: 0, fovKick: 0 };

    this.time = 0;
    this.world = createWorld();
    this.effects = new Effects(this.scene);
    this.effects.setPixelScale(innerHeight);
    this.audio = new AudioFX();
    this.input = new Input(this.canvas);
    this.arena = new Arena(this);

    this.pending = [];
    this.npcs = [];        // everyone but the player: opponents (team 1) and allies (team 0)
    this.corpses = [];
    this.limbs = [];
    this.kunais = [];
    this.mode = 'duel';
    this.enemyType = 'random';
    this.kills = 0;
    this.wave = 0;
    this.hordeT = 0;
    this.chaosT = 0;
    this.runT = 0;           // how long the current survival / chaos run has lasted
    this.runOver = false;
    this.runResult = '';
    this.waveCleared = false;
    this.hitStopT = 0;
    this.slowT = 0;
    this.slowmo = false;
    this.timeScale = 1;
    this.shake = 0;
    this.acc = 0;
    this.camTarget = new THREE.Vector3(0, 1.4, 4);
    this.playerDownT = 0;

    const skin = SKINS.ronin;
    this.skin = skin.key;
    this.player = new Samurai(this, {
      isPlayer: true, style: skin, position: new THREE.Vector3(0, 0, 4), yaw: 0, weapon: 'katana',
      armor: skin.prot, speedMul: skin.speed, posture: 1.25, name: 'Du',
    });
    this.ctl = new PlayerController(this, this.player, this.input);
    this.arena.showRack('katana');

    this.setupUI();
    this.spawnWave(true);
    addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  get fighters() { return [this.player, ...this.npcs]; }
  get livingEnemies() { return this.npcs.filter((e) => e.team === 1 && !e.counted); }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.cine.uniforms.res.value.set(innerWidth, innerHeight);
    this.effects.setPixelScale(innerHeight);
  }

  // ------------------------------------------------------------------ spawning
  spawnFighter(team, typeKey, pos) {
    const pp = this.player.getPos(new THREE.Vector3());
    if (!pos) {
      let best = null;
      for (let i = 0; i < 14; i++) {
        const ang = Math.random() * Math.PI * 2;
        const c = team === 0
          ? new THREE.Vector3(pp.x + Math.sin(ang) * rand(2, 3.5), 0, pp.z + Math.cos(ang) * rand(2, 3.5))
          : new THREE.Vector3(Math.sin(ang) * rand(6, 10.5), 0, Math.cos(ang) * rand(6, 10.5));
        if (Math.hypot(c.x, c.z) > 11.5) continue;
        const d = Math.hypot(c.x - pp.x, c.z - pp.z);
        const crowd = this.npcs.some((e) => e.state === 'active' && e.getPos(_b).distanceTo(c) < 2);
        if ((team === 0 || d > 4.5) && !crowd) { best = c; break; }
        if (!best) best = c;
      }
      pos = best || new THREE.Vector3(0, 0, -3);
    }
    const type = team === 0 ? ALLY_TYPE : TYPES[typeKey] || TYPES.ronin;
    const style = pick(type.styles);
    const yaw = Math.atan2(-(pp.x - pos.x), -(pp.z - pos.z));
    const k = new Samurai(this, {
      team, kind: type, name: type.name, style, position: pos, yaw: team === 0 ? yaw + Math.PI : yaw,
      weapon: pick(type.weapons), armor: style.prot, posture: type.posture,
    });
    k.brain = new Brain(this, k, type);
    if (team === 1 && this.mode === 'survival') {
      // every wave they are a little quicker to strike, better at guarding and harder to shake
      const w = this.wave;
      k.brain.aggr *= 1 + 0.035 * w;
      k.brain.blockSkill = Math.min(0.9, k.brain.blockSkill + 0.02 * w);
      k.postureMax *= 1 + 0.05 * w;
    } else if (team === 1 && this.mode === 'chaos') {
      k.brain.aggr *= 1.2;
      k.brain.cooldown = rand(0.2, 0.9);
    }
    this.npcs.push(k);
    this.effects.dust(pos, 14);
    this.arena.stirPetals(pos.x, pos.z, 2);
    return k;
  }

  removeNpc(k) {
    k.disposed = true;
    k.labelEl?.remove();
    k.dispose();
    this.npcs = this.npcs.filter((e) => e !== k);
    this.corpses = this.corpses.filter((e) => e !== k);
    if (this.ctl.lock === k) this.ctl.lock = null;
  }

  rollType() {
    if (this.enemyType !== 'random') return this.enemyType;
    const diff = this.mode === 'survival' ? Math.min(1, this.wave * 0.1)
      : this.mode === 'chaos' ? Math.min(0.45, 0.05 + this.runT * 0.004)      // a mob: mostly foot soldiers and rōnin
        : Math.min(0.75, 0.15 + this.kills * 0.05);
    return randomType(diff);
  }

  spawnWave(first = false) {
    const alive = this.livingEnemies;
    if (this.mode === 'duel') {
      for (const e of alive) this.removeNpc(e);
      this.spawnFighter(1, this.rollType(), first ? new THREE.Vector3(0, 0, -3) : null);
    } else if (this.mode === 'skirmish') {
      const n = Math.min(3, 9 - alive.length);
      for (let i = 0; i < n; i++) this.spawnFighter(1, this.rollType());
    } else if (this.mode === 'survival') {
      this.wave++;
      const n = Math.min(2 + Math.floor(this.wave * 0.8), 8) - alive.length;
      for (let i = 0; i < n; i++) this.spawnFighter(1, i === 0 && this.wave % 5 === 0 ? 'daimyo' : this.rollType());
      this.hordeT = 0;
      this.waveCleared = false;
    } else {
      for (let i = 0; i < 3; i++) this.spawnFighter(1, this.rollType());
    }
    this.callout(this.mode === 'survival' ? `WELLE ${this.wave}` : MODES[this.mode].call, null, 'crit');
    this.audio.taiko(0.7);
  }

  resetArena() {
    for (const e of [...this.npcs]) this.removeNpc(e);
    this.corpses = [];
    this.effects.clear();
    for (const l of [...this.limbs]) this.removeLimb(l);
    for (const w of this.kunais) w.dispose();
    this.kunais = [];
    this.arena.resetProps();
    this.player.resetTo(new THREE.Vector3(0, 0, 4), 0);
    this.ctl.reset();
    this.ctl.yaw = 0; this.ctl.pitch = -0.2; this.ctl.faceYaw = 0;
    this.kills = 0;
    this.wave = 0;
    this.runT = 0;
    this.chaosT = 2;
    this.runOver = false;
    this.playerDownT = 0;
    this.spawnWave(true);
  }

  get isRun() { return !!MODES[this.mode].run; }

  /** The player fell in survival / chaos: the run is over, note the result and the best so far. */
  endRun() {
    this.runOver = true;
    const key = 'heavysteel.best.' + this.mode;
    const now = { wave: this.wave, kills: this.kills, time: Math.floor(this.runT) };
    let best = null;
    try { best = JSON.parse(localStorage.getItem(key)); } catch { /* no storage: just no record */ }
    const score = (r) => (this.mode === 'survival' ? r.wave * 1000 + r.kills : r.kills * 1000 + r.time);
    const record = !best || score(now) > score(best);
    if (record) { best = now; try { localStorage.setItem(key, JSON.stringify(now)); } catch { /* ignore */ } }
    const line = (r) => (this.mode === 'survival' ? `Welle ${r.wave} · ${r.kills} besiegt · ${fmtTime(r.time)}` : `${r.kills} besiegt · ${fmtTime(r.time)}`);
    this.runResult = line(now) + (record ? '  —  neuer Rekord!' : `  —  Rekord: ${line(best)}`);
    this.audio.taiko(1);
  }

  /** Survival: next wave once the yard is clear. Chaos: a steady, swelling stream. */
  updateRun(dt) {
    if (!this.isRun || this.runOver) return;
    this.runT += dt;
    const alive = this.livingEnemies.length;
    if (this.mode === 'survival') {
      if (alive) return;
      if (!this.waveCleared && this.wave > 0) {
        this.waveCleared = true;
        this.ctl.heals = Math.min(3, this.ctl.heals + 1);
        this.callout(`WELLE ${this.wave} ÜBERSTANDEN`, null, 'parry');
      }
      this.hordeT += dt;
      if (this.hordeT > 3) this.spawnWave();
    } else {
      this.chaosT -= dt;
      const cap = Math.min(14, 3 + Math.floor(this.runT / 10));
      if (this.chaosT <= 0 && alive < cap) {
        this.spawnFighter(1, this.rollType());
        this.chaosT = Math.max(0.5, 2.4 - this.runT * 0.02);
      }
    }
  }

  setPlayerWeapon(key) {
    if (!WEAPONS[key] || WEAPONS[key].thrown) return;
    if (this.player.state !== 'active') return;
    this.player.setWeapon(key);
    this.ctl.runner.cancel();
    this.arena.showRack(key);
    this.audio.clank(0.3, 1.2);
    document.querySelectorAll('#weapon-buttons button').forEach((b) => b.classList.toggle('active', b.dataset.weapon === key));
    this.callout(up(WEAPONS[key].name), null, 'small');
  }

  setPlayerSkin(key) {
    const skin = SKINS[key];
    if (!skin) return;
    this.skin = key;
    this.player.setStyle(skin, skin.prot);
    this.player.speedMul = skin.speed;
    this.ui.skin.value = key;
    this.callout(up(skin.name), null, 'small');
  }

  setMode(mode) {
    this.mode = mode;
    this.ui.mode.textContent = MODES[mode].name;
    this.resetArena();
  }

  attackTokens(team) {
    let n = 0;
    for (const e of this.npcs) if (e.team === team && e.brain.attacking) n++;
    return n;
  }
  /** How many of a side may be mid-attack at once. */
  maxTokens(team) {
    if (team === 0) return 2;
    if (this.mode === 'duel') return 1;
    if (this.mode === 'chaos') return Math.min(4, 2 + Math.floor(this.runT / 30));
    if (this.mode === 'survival') return Math.min(4, 2 + Math.floor(this.wave / 4));
    return 2;
  }

  // ------------------------------------------------------------------ combat: contacts
  queueContact(weapon, other, contact) {
    const bi = contact.bi;
    const point = new THREE.Vector3(bi.position.x + contact.ri.x, bi.position.y + contact.ri.y, bi.position.z + contact.ri.z);
    const vw = pointVelocity(weapon.body, point, new THREE.Vector3());
    const vo = other.type === CANNON.Body.STATIC ? new THREE.Vector3() : pointVelocity(other, point, new THREE.Vector3());
    const rel = vw.sub(vo);
    const otherIsI = contact.bi === other;
    this.pending.push({
      weapon, other, shape: otherIsI ? contact.si : contact.sj, wshape: otherIsI ? contact.sj : contact.si,
      point, rel, speed: rel.length(),
    });
  }

  processContacts() {
    const list = this.pending;
    this.pending = [];
    for (const c of list) {
      const hs = c.other.hs || { type: 'static' };
      const w = c.weapon;
      if (w.dead) continue;
      // cooldown per weapon/target pair
      const key = c.other.id;
      const last = w.lastHit.get(key) ?? -1;
      if (this.time - last < 0.16) continue;
      if (hs.type === 'weapon') {
        if (hs.weapon.id < w.id) continue; // handled by the other weapon's listener
        w.lastHit.set(key, this.time);
        this.clash(w, hs.weapon, c);
      } else if (hs.type === 'limb') {
        if (c.speed < 3) continue;
        w.lastHit.set(key, this.time);
        _cv.set(c.rel.x, c.rel.y + 2, c.rel.z).scale(w.def.mass * 0.5, _cv);
        c.other.applyImpulse(_cv);
        this.effects.blood(c.point, c.rel.clone().normalize(), 6);
        this.audio.hit(0.3, false);
      } else if (hs.type === 'core' || hs.type === 'rag') {
        const k = hs.knight;
        if (k === w.owner && w.attached) continue;
        if (w.thrower && k.team === w.thrower.team) continue;
        if (!w.attached && c.speed < 6) continue;
        w.lastHit.set(key, this.time);
        this.bodyHit(w, hs, c);
      } else if (c.speed > 4) {
        w.lastHit.set(key, this.time);
        const dir = c.rel.clone().normalize();
        if (hs.breakable) this.arena.breakables.weaponHit(hs.breakable, w, c.point, dir, c.speed);
        if (hs.mat && w.attached && w.def.sever && c.wshape?.hsPart === 'blade' && c.speed > 6.5
            && this.arena.cutMat(hs.mat, c.point, dir, c.speed)) {
          this.audio.wood(0.8, true);
          this.effects.splinters(c.point, dir, 16, 0.72, 0.62, 0.36);
          if (w.owner?.isPlayer) this.callout('SAUBERER SCHNITT', c.point, 'small');
        } else if (hs.kind === 'wood') {
          this.audio.wood(c.speed / 12);
          this.effects.splinters(c.point, dir, 4);
        } else {
          this.audio.clank(c.speed / 22, 0.7);
          this.effects.sparksAt(c.point, c.speed * 0.8, 0.6);
        }
        if (w.def.thrown) w.dead = true;
      }
    }
  }

  /** Steel on steel. If one side is guarding against the other's cut, it is a block or a deflection. */
  clash(wa, wb, c) {
    const s = c.speed;
    if (s < 1.2) return;
    this.effects.sparksAt(c.point, 4 + s * 2.2, clamp(s / 8, 0.4, 1.4));
    this.audio.clank(s / 10, wa.def.type === 'club' || wb.def.type === 'club' ? 0.75 : 1.1);
    if (s > 5) this.addHitStop(0.03);
    for (const [def, att] of [[wa, wb], [wb, wa]]) {
      const D = def.owner, A = att.owner;
      if (!D || !A || D.team === A.team || !def.attached || !att.attached) continue;
      if (!D.guarding || s < 2) continue;
      this.guardHit(D, A, att, c.point, s);
      break;
    }
  }

  /**
   * D's guard caught A's cut. Raised just in time it is a deflection: A's blade is thrown wide and
   * A's posture suffers. Otherwise a plain block that wears down D's own posture.
   */
  guardHit(D, A, w, point, s) {
    if (this.time < w.blockedUntil) return;
    w.blockedUntil = this.time + 0.4;
    const impact = clamp(s / 11, 0.3, 1.3) * w.def.postureDmg * (A.swingHeavy ? 1.5 : 1);
    const deflect = D.isPlayer ? D.guardT < (D.deflectWindow ?? DEFLECT_WINDOW) : D.aiDeflect;
    const ap = A.getPos(_a), dp = D.getPos(_b);
    const away = _c.set(ap.x - dp.x, 0, ap.z - dp.z).normalize().clone();
    _cv.set(away.x, 0.5, away.z).scale(w.body.mass * (deflect ? 4 + s * 0.7 : 2 + s * 0.3), _cv);
    w.body.applyImpulse(_cv);
    const mine = D.isPlayer || A.isPlayer;
    if (deflect) {
      D.aiDeflect = false;
      D.posture = Math.min(D.postureMax * 0.95, D.posture + POSTURE.deflector * impact);
      const broke = A.addPosture(POSTURE.deflected * (0.6 + 0.4 * impact));
      A.stagger(_a.copy(away).multiplyScalar(0.7), A.getPos(_b).setY(1.4), 0.2, 0.6);
      if (A.brain) A.brain.onParried();
      else { this.ctl.runner.cancel(); this.ctl.buffer = 0; }
      this.effects.sparksAt(point, 36, 1.6);
      this.effects.impact(point, 1.3);
      this.audio.deflect();
      this.addHitStop(mine ? 0.085 : 0.03);
      if (mine) { this.shake = Math.max(this.shake, 0.4); this.fx.chroma = Math.max(this.fx.chroma, 0.5); }
      if (D.isPlayer) { this.callout('ABGEWEHRT!', point, 'parry'); this.ctl.counterT = 0.7; }
      else if (A.isPlayer) this.callout('ABGEWEHRT', point, 'small');
      if (broke) this.onGuardBroken(A, point);
    } else {
      const broke = D.addPosture(POSTURE.block * impact);
      A.posture = Math.min(A.postureMax * 0.95, A.posture + 0.04);
      D.stagger(_a.copy(away).multiplyScalar(-(0.3 + impact * 0.5)), point, 0.03 * impact, 0.15);
      this.effects.sparksAt(point, 10 + s, 0.9);
      this.audio.clank(0.5 + s / 14, 0.9);
      this.addHitStop(0.03);
      if (D.isPlayer) this.shake = Math.max(this.shake, 0.25);
      if (A.isPlayer && s > 4) this.callout('GEBLOCKT', point, 'small');
      if (broke) this.onGuardBroken(D, point);
    }
  }

  onGuardBroken(k, point) {
    this.callout('HALTUNG GEBROCHEN!', point || k.getHeadPos(_c), 'crit');
    this.audio.thud(0.8);
    this.effects.impact(point || k.getHeadPos(_c), 1.6);
    this.addHitStop(0.06);
    if (k.isPlayer) { this.ctl.runner.cancel(); this.shake = Math.max(this.shake, 0.6); }
    const w = k.weapon;
    if (w?.attached) { _cv.set(rand(-1, 1), -1.5, rand(-1, 1)).scale(w.body.mass * 4, _cv); w.body.applyImpulse(_cv); }
  }

  bodyHit(w, hs, c) {
    const k = hs.knight;
    const def = w.def;
    const s = Math.min(c.speed, 20);
    if (s < 2.6) return;
    if (w.attached && this.time < w.blockedUntil) return;      // this swing was already stopped
    const attacker = w.owner;
    const byPlayer = !!attacker?.isPlayer || (w.thrower?.isPlayer ?? false);
    const dir = c.rel.clone().normalize();

    if (k.state === 'active') {
      // slipped out of the way
      if (k.iframeT > 0) {
        if (k.isPlayer && s > 5) this.callout('AUSGEWICHEN', c.point, 'small');
        return;
      }
      // guard: anything coming from the front is caught on the blade
      if (k.guarding) {
        const src = attacker || w.thrower;
        const sp = src ? src.getPos(_a) : _a.copy(c.point).addScaledVector(dir, -1);
        const kp = k.getPos(_b);
        const toA = _c.set(sp.x - kp.x, 0, sp.z - kp.z).normalize();
        if (k.forward(_b).dot(toA) > 0.2) {
          if (attacker && w.attached && attacker.team !== k.team) { this.guardHit(k, attacker, w, c.point, s); return; }
          if (def.thrown) {
            this.effects.sparksAt(c.point, 14, 0.9);
            this.audio.clank(0.6, 1.4);
            w.dead = true;
            return;
          }
        }
      }
    }

    const { zone, part } = k.zoneFromContact(c.other, c.shape, c.point);

    // ---- wound type: blunt (club, shaft, pommel), thrust (point first) or cut (edge)
    let kind = 'cut';
    let raw = Math.pow((s - 2.6) / 11, 1.15) * def.damage;
    const tag = c.wshape?.hsPart;
    if (def.type === 'club') kind = 'blunt';
    else if (tag === 'shaft' || tag === 'grip') { kind = 'blunt'; raw *= 0.4; }
    else {
      const axis = _cv.set(0, 1, 0);
      w.body.quaternion.vmult(axis, axis);
      const along = axis.x * dir.x + axis.y * dir.y + axis.z * dir.z;
      if (along > 0.7 || attacker?.intent.mode === 'thrust') kind = 'thrust';
      else if (along < -0.75) kind = 'blunt';
    }

    // ---- raw severity from impact speed & weapon, then armour decides what gets through
    if (attacker && attacker.team === 1 && k.isPlayer) raw *= this.mode === 'chaos' ? 0.5 : 0.7;
    if (attacker && w.attached && attacker.liveT <= 0) raw *= 0.25;   // the blade only bites in a committed cut
    if (attacker?.swingHeavy) raw *= 1.25;
    if (!w.attached) raw *= 0.5;
    const wasDead = k.dead;
    const { sev, ev } = k.inj.wound(zone, raw, kind, def.armorMul ?? 1);
    const deflected = ev.includes('deflect');
    if (def.thrown) w.dead = true;

    // ---- dismemberment: a clean, hard cut through a limb or the neck
    let severed = null;
    if (kind === 'cut' && def.sever && !def.thrown && zone !== 'torso' && !deflected) {
      const need = (zone.startsWith('leg') ? 0.58 : 0.48) * def.sever;
      if (sev >= need || (k.inj.parts[zone] >= 1 && sev > 0.15)) {
        const cut = zone === 'head' ? 'head' : part;
        if (k.sever(cut, dir, s)) {
          severed = cut;
          k.inj.amputate(zone);
          if (k.inj.cause && !ev.includes('dead')) ev.push('dead');
        }
      }
    }

    // ---- feedback
    if (deflected) {
      // the edge skids off the lacquered plates: sparks, no wound
      this.effects.sparksAt(c.point, 6 + s, 0.8);
      this.audio.clank(s / 14, 0.85);
      if (byPlayer && s > 6) this.callout('ABGEGLITTEN', c.point, 'small');
    } else {
      k.hitFlash = Math.min(1, sev * 2);
      const bleedy = kind === 'blunt' ? 0.3 : 1;
      this.effects.blood(c.point, dir, 3 + sev * 70 * bleedy, 1 + sev);
      if (kind !== 'blunt' || sev > 0.35) k.addWound(part, c.point, dir, sev, kind);
      if (kind !== 'blunt') w.bloodUp(0.15 + sev * 0.9);
      this.audio.hit(0.3 + sev * 1.4, kind === 'blunt');
      if (kind === 'cut' && sev > 0.2) this.audio.slash();
      if (sev > 0.12) {
        this.fx.chroma = Math.max(this.fx.chroma, Math.min(1, sev * 1.5));
        if (sev > 0.3) this.effects.impact(c.point, sev * 2);
        this.addHitStop(0.03 + Math.min(0.09, sev * 0.12));
        this.shake = Math.max(this.shake, clamp(sev * 1.4, 0.15, 1) * (byPlayer || k.isPlayer ? 1 : 0.5));
      }
      if (k.isPlayer) this.hurtFlash(sev * 70);
      if (!ev.includes('dead') && k.addPosture(POSTURE.wound * sev + 0.06)) this.onGuardBroken(k, c.point);
    }

    // ---- physical knock: momentum of the blow
    const dirH = new THREE.Vector3(dir.x, 0, dir.z);
    if (dirH.lengthSq() < 0.01 && attacker) dirH.copy(k.getPos(_b)).sub(attacker.getPos(_c)).setY(0);
    dirH.normalize();
    const knockMag = s * def.knock * ZONE_KNOCK[zone];
    const launch = (scale) => {
      const dv = new THREE.Vector3(dirH.x, 0, dirH.z).multiplyScalar(knockMag * 0.33 * scale);
      dv.y = s * def.launchUp * 0.45 * scale + 0.8;
      if (dv.length() > 13) dv.setLength(13);
      return dv;
    };
    const heavyBlow = def.knock >= 2 && s > 7 && (zone === 'head' || zone === 'torso') && !deflected;

    if (k.state === 'active') {
      if (severed === 'uArmR' || severed === 'fArmR') k.disarm(dirH.clone().multiplyScalar(1.5));
      if (ev.includes('dead')) k.goRagdoll(launch(1), part, true);
      else if (severed && (severed.startsWith('thigh') || severed.startsWith('shin'))) k.goRagdoll(launch(0.6), 'pelvis', false);
      else if (ev.includes('ko')) k.goRagdoll(launch(0.7), part, false);
      else if (heavyBlow) k.goRagdoll(launch(0.9), part, false);
      else {
        if (ev.includes('disarm') || (ev.includes('disarmL') && k.weapon?.def.twoHanded)) k.disarm(dirH.clone().multiplyScalar(2));
        const dv = dirH.clone().multiplyScalar(knockMag * 0.11);
        const balLoss = knockMag * 0.03 + sev * 0.5 + (zone === 'head' ? 0.2 : 0) + (zone.startsWith('leg') ? 0.25 : 0);
        k.stagger(dv, c.point, balLoss, 0.3 + knockMag * 0.02 + sev);
        k.brain?.onHit(sev);
        if (k.isPlayer && sev > 0.2 && this.ctl.runner.phase === 'wind') this.ctl.runner.cancel();
      }
    } else {
      const b = k.ragBodies[part] || k.ragBodies.torso;
      _cv.set(dir.x, dir.y + 0.3, dir.z).scale(Math.min(400, def.mass * s * def.knock * 0.6), _cv);
      _cv2.set(c.point.x - b.position.x, c.point.y - b.position.y, c.point.z - b.position.z);
      b.applyImpulse(_cv, _cv2);
      if (ev.includes('dead')) k.dead = true;
    }

    // ---- what happened, in words
    const Z = ZONE_NAMES[zone];
    if (severed) {
      this.addHitStop(0.13);
      this.shake = 1;
      this.fx.chroma = 1;
      this.effects.gore(c.point, dir, 22);
      this.effects.blood(c.point, dir, 110, 1.6);
      this.effects.impact(c.point, 1.5);
      this.audio.hit(1.4, false);
      this.audio.slash();
      w.bloodUp(1);
    }
    if (severed && byPlayer) this.slowT = Math.max(this.slowT, severed === 'head' ? 0.6 : 0.35);
    if (severed === 'head') { k.dead = true; if (!wasDead) { this.callout('ENTHAUPTET!', c.point, 'crit'); this.audio.taiko(0.8); } }
    else if (severed) this.callout(zone.startsWith('arm') ? 'ARM ABGETRENNT!' : 'BEIN ABGETRENNT!', c.point, 'crit');
    else if (ev.includes('dead') && !wasDead) this.onFighterDeath(k, c.point);
    else if (ev.includes('ko')) this.callout('BEWUSSTLOS!', c.point, 'crit');
    else if (ev.includes('disarm') && !k.weapon?.attached) this.callout('ENTWAFFNET!', c.point, 'crit');
    else if (ev.includes('broken')) this.callout(`${up(Z)} GEBROCHEN!`, c.point, 'crit');
    else if (ev.includes('crippled')) this.callout(`${up(Z)} UNBRAUCHBAR!`, c.point, 'crit');
    else if (heavyBlow) this.callout('NIEDERGESCHMETTERT!', c.point, 'crit');
    else if (ev.includes('hurt')) this.callout(`${Z} verletzt`, c.point, 'small');
    else if (ev.includes('headWound')) this.callout('Kopfwunde', c.point, 'small');
    else if (ev.includes('severe')) this.callout(kind === 'thrust' ? 'Tiefer Stich' : 'Schwere Wunde', c.point, 'small');
  }

  // ------------------------------------------------------------------ finishing blow
  /** An opponent whose guard is broken, close enough to be finished. */
  findFinisherTarget(k) {
    const me = k.getPos(_a);
    let best = null, bd = 3.4;
    for (const f of this.fighters) {
      if (f.team === k.team || f.state !== 'active' || f.dead || f.brokenT < 0.2) continue;
      const d = f.getPos(_b).distanceTo(me);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  onFinisherStart(k, victim) {
    this.audio.whooshBurst(0.8);
    this.fx.fovKick = 1;
    victim.brokenT = Math.max(victim.brokenT, 1.2);     // hold them there
  }

  executeFinisher(A, V) {
    if (!V || V.disposed || V.dead) return;
    const def = A.weapon.def;
    const ap = A.getPos(_a), vp = V.getPos(_b);
    const dir = new THREE.Vector3(vp.x - ap.x, 0, vp.z - ap.z).normalize();
    let point = V.parts.torso.position.clone().add(_c.set(0, 0.3, 0));
    let headOff = false;
    if (def.sever && V.state === 'active' && Math.random() < 0.55) headOff = !!V.sever('head', dir, 9);
    if (headOff) {
      V.inj.amputate('head');
      point = V.getHeadPos(new THREE.Vector3());
    } else {
      const kind = def.type === 'club' ? 'blunt' : def.sever ? 'cut' : 'thrust';
      V.inj.wound('torso', 4, kind, 0);
      V.addWound('torso', point.clone().addScaledVector(dir, -0.14), dir, 1, 'cut');
      const tp = new THREE.Vector3();
      this.effects.addSpurt(() => (V.disposed ? null : tp.copy(V.parts.torso.position).add(_c.set(0, 0.28, 0).applyQuaternion(V.parts.torso.quaternion))),
        () => _c.set(-dir.x * 0.5, 0.85, -dir.z * 0.5).normalize(), 4.5);
    }
    V.dead = true;
    if (V.state === 'active') V.goRagdoll(new THREE.Vector3(dir.x * 2.4, 1.4, dir.z * 2.4), 'torso', true);
    this.effects.blood(point, dir, 220, 1.8);
    this.effects.blood(point, _c.set(-dir.x, 0.4, -dir.z), 80, 1.2);
    this.effects.gore(point, dir, 16);
    this.effects.impact(point, 2);
    A.weapon.bloodUp(1);
    this.audio.slash();
    this.audio.hit(1.4, def.type === 'club');
    this.audio.taiko(1);
    this.addHitStop(0.12);
    this.slowT = 1.1;
    this.shake = 1;
    this.fx.chroma = 1;
    this.kanji(headOff ? '斬首' : '斬');
    this.callout(headOff ? 'ENTHAUPTET!' : 'TODESSTOSS!', point, 'crit');
  }

  // ------------------------------------------------------------------ tools
  throwKunai(k, lock, yaw, pitch) {
    if (k.state !== 'active') return;
    const from = k.parts.torso.position.clone().add(_a.set(0, 0.36, 0));
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch) + 0.1, -Math.cos(yaw) * Math.cos(pitch)).normalize();
    // aim assist: the locked target, else whoever is close to the line of sight
    let tgt = lock && lock.state === 'active' && !lock.dead ? lock : null;
    if (!tgt) {
      let best = 0.94;
      for (const f of this.fighters) {
        if (f.team === k.team || f.dead || f.disposed) continue;
        const to = _b.copy(f.parts.torso.position).sub(from);
        const d = to.length();
        if (d > 26 || d < 0.5) continue;
        const dot = to.divideScalar(d).dot(dir);
        if (dot > best) { best = dot; tgt = f; }
      }
    }
    if (tgt) {
      const to = _b.copy(tgt.parts.torso.position).add(_c.set(0, 0.3, 0)).sub(from);
      const d = to.length();
      dir.copy(to).divideScalar(d);
      dir.y += d * 0.007;          // a little arc for the drop
      dir.normalize();
    }
    from.addScaledVector(dir, 0.6);
    const w = new Weapon(this, 'kunai', null);
    w.thrower = k;
    w.teleport(from, _q.setFromUnitVectors(UPV, dir));
    w.body.velocity.set(dir.x * 27, dir.y * 27, dir.z * 27);
    w.body.angularDamping = 0.6;
    this.kunais.push(w);
    while (this.kunais.length > MAX_KUNAI) this.kunais.shift().dispose();
    this.audio.whooshBurst(0.45);
  }

  playerHeal() {
    const P = this.player, ctl = this.ctl;
    if (P.state !== 'active' || P.dead) return;
    if (!P.inj.status().length) return;
    if (ctl.heals <= 0) { this.callout('Keine Verbände mehr', null, 'small'); return; }
    ctl.heals--;
    P.inj.treat();
    P.clearWounds();
    this.callout('WUNDEN VERSORGT', null, 'parry');
  }

  // ------------------------------------------------------------------ fighter events
  onSwing(k, heavy = false) {
    k.swingHeavy = !!heavy;
    if (k.isPlayer) { if (heavy) { this.audio.whooshBurst(0.7); this.fx.fovKick = Math.max(this.fx.fovKick, 0.6); } }
    else if (k.getPos(_a).distanceTo(this.player.getPos(_b)) < 7) this.audio.whooshBurst(0.22);
  }

  /**
   * Rushing past at full speed the blade can slip by between two physics steps. If the cut was
   * aimed at someone in reach and the steel has not found him, it does now (guard, dodge and
   * armour still apply).
   */
  assistCut(k, target) {
    if (!target || target.state !== 'active' || target.dead || target.disposed) return;
    const w = k.weapon, tp = target.getPos(_a), kp = k.getPos(_b);
    if (Math.hypot(tp.x - kp.x, tp.z - kp.z) > w.def.reach + 0.5) return;
    if (this.time - (w.lastHit.get(target.core.id) ?? -9) < 0.35) return;
    w.lastHit.set(target.core.id, this.time);
    const f = k.forward(new THREE.Vector3());
    const rel = new THREE.Vector3(f.x * 0.4 - Math.cos(k.yawActual) * 0.8, -0.1, f.z * 0.4 + Math.sin(k.yawActual) * 0.8).normalize().multiplyScalar(13);
    const point = target.parts.torso.position.clone().add(_c.set(0, 0.25, 0));
    this.bodyHit(w, target.core.hs, { other: target.core, shape: target.core.shapes[1], wshape: { hsPart: 'blade' }, point, rel, speed: 13 });
  }

  /** The player turns a deflection into an instant counter-cut. */
  onCounter() {
    this.slowT = Math.max(this.slowT, 0.28);
    this.fx.fovKick = 1;
    this.audio.whooshBurst(0.9);
  }

  /** A front kick lands: whoever stands in front is sent flying (or has his guard driven in), loose things too. */
  onKick(k) {
    const me = k.getPos(new THREE.Vector3()), fwd = k.forward(new THREE.Vector3());
    const foot = me.clone().addScaledVector(fwd, 0.95).setY(0.8);
    const pw = k.kickPower || 1;
    let hit = false;
    for (const f of this.fighters) {
      if (f === k || f.team === k.team || f.disposed) continue;
      if (f.state === 'active') {
        const p = f.getPos(_b), dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz) || 1e-3;
        if (d > 1.85 || (dx * fwd.x + dz * fwd.z) / d < 0.4 || f.iframeT > 0) continue;
        hit = true;
        const push = new THREE.Vector3(dx / d + fwd.x, 0, dz / d + fwd.z).normalize();
        f.inj.shock = Math.min(1, f.inj.shock + 0.25);
        f.brain?.onHit(0.3);
        if (f.guarding && f.forward(_c).dot(push) < -0.2) {
          // caught on the guard: no fall, but it drives the guard in
          const broke = f.addPosture(0.4 * f.postureMax * pw);
          f.stagger(push.clone().multiplyScalar(2.4 * pw), foot, 0.25, 0.6);
          if (broke) this.onGuardBroken(f, foot);
        } else {
          f.posture = Math.min(f.postureMax * 0.9, f.posture + 0.2 * f.postureMax);
          f.goRagdoll(new THREE.Vector3(push.x * 3.6 * pw, 1.8, push.z * 3.6 * pw), 'torso', false);
          f.getUpAt = rand(1.3, 2.0) + (1 - f.inj.vitality) * 2;
          if (f.isPlayer) this.ctl.runner.cancel();
        }
      } else if (f.ragBodies) {
        for (const n in f.ragBodies) {
          const b = f.ragBodies[n];
          if (Math.hypot(b.position.x - foot.x, b.position.z - foot.z) > 0.9) continue;
          b.velocity.x += fwd.x * 4 * pw; b.velocity.y += 2; b.velocity.z += fwd.z * 4 * pw;
          hit = true;
        }
      }
    }
    const shove = (b, s) => {
      if (Math.hypot(b.position.x - foot.x, b.position.z - foot.z) > 1.0 || b.position.y > 1.6) return false;
      b.velocity.x += fwd.x * s; b.velocity.y += 1.5; b.velocity.z += fwd.z * s;
      return true;
    };
    for (const it of this.arena.breakables.items) {
      if (it.broken || !it.K.dynamic || !shove(it.body, 5.5 * pw)) continue;
      hit = true;
      this.arena.breakables.damage(it, 7 * pw, foot, fwd);
    }
    for (const d of this.arena.debris) shove(d.body, 5 * pw);
    for (const l of this.limbs) for (const n in l.bodies) shove(l.bodies[n], 6 * pw);
    if (hit) {
      this.effects.impact(foot, 1.2);
      this.effects.dust(foot.clone().setY(0), 8);
      this.audio.thud(0.9);
      this.audio.hit(0.5, true);
      if (k.isPlayer) { this.addHitStop(0.05); this.shake = Math.max(this.shake, 0.35); }
    } else if (k.isPlayer) this.audio.whooshBurst(0.4);
  }

  onJump(k) {
    this.effects.dust(k.getPos(_a), 6, 1.2);
  }

  onFighterDeath(k, point) {
    k.dead = true;
    const where = point || k.getHeadPos(_c);
    this.callout(up(k.inj.cause || 'Gefallen'), where, 'crit');
  }

  /** An opponent counts as defeated once dead or unable to get up. */
  checkDefeated() {
    for (const e of this.npcs) {
      if (e.counted) {
        // knocked out or downed, but back on their feet: they are in the fight again
        if (!e.dead && e.state === 'active' && !e.armless && e.inj.canStand) {
          e.counted = false;
          this.corpses = this.corpses.filter((c) => c !== e);
          if (e.team === 1) this.kills = Math.max(0, this.kills - 1);
        }
        continue;
      }
      if (e.dead || e.armless || (e.state === 'ragdoll' && !e.inj.canStand && e.ragTime > 2.5)) {
        e.counted = true;
        e.labelEl?.remove();
        e.labelEl = null;
        if (e.team === 1) {
          this.kills++;
          if (!this.livingEnemies.length) this.slowT = Math.max(this.slowT, 0.7);      // the last one falls: a breath of slow motion
          if (!e.dead) this.callout('KAMPFUNFÄHIG', e.getHeadPos(_c), 'small');
        }
        if (this.ctl.lock === e) this.ctl.lock = null;
        this.corpses.push(e);
        while (this.corpses.length > (this.mode === 'chaos' ? 6 : MAX_CORPSES)) this.removeNpc(this.corpses[0]);
      }
    }
  }

  /** The fallen keep bleeding into the gravel. */
  bleedOut(dt) {
    for (const k of [...this.corpses, this.player]) {
      if (k.state !== 'ragdoll' || !k.dead || (k.poolN || 0) >= 16 || k.ragTime < 0.8) continue;
      k.poolT = (k.poolT || 0) - dt;
      if (k.poolT > 0) continue;
      k.poolT = 0.3;
      k.poolN = (k.poolN || 0) + 1;
      const p = k.ragBodies.torso?.position || k.ragBodies.pelvis.position;
      const r = 0.12 + k.poolN * 0.03;
      this.effects.decal(p.x + rand(-r, r), p.z + rand(-r, r), 0.35 + k.poolN * 0.06);
    }
  }

  onFighterDown(k) {
    this.audio.thud(0.9);
    const p = k.getPos(_a);
    this.effects.dust(p, 18);
    this.arena.stirPetals(p.x, p.z, 2.2);
    if (k.isPlayer) { this.ctl.runner.cancel(); this.ctl.runner.hand.copy(GUARD); this.ctl.finisher = null; }
  }

  onFighterUp(k) {
    this.effects.dust(k.getPos(_a), 10);
    if (k.isPlayer) this.ctl.faceYaw = k.intent.yaw;
  }

  /** A severed limb flies off; both the stump and the limb bleed. */
  addLimb(limb, fighter, part, stumpParent) {
    this.limbs.push(limb);
    const pos = new THREE.Vector3(), d = new THREE.Vector3();
    this.effects.addSpurt(
      () => (fighter.disposed ? null : fighter.jointWorld(part, pos)),
      () => {
        const t = fighter.parts[stumpParent] || fighter.parts.torso;
        d.copy(pos).sub(t.position).normalize();
        if (part === 'head') d.set(0, 1, 0).applyQuaternion(fighter.parts.torso.quaternion);
        return d.multiplyScalar(0.8).add(_a.set(0, 0.5, 0)).normalize();
      },
      part === 'head' ? 8 : 6,
    );
    const root = limb.bodies[part];
    if (root) {
      const lp = new THREE.Vector3(), ld = new THREE.Vector3();
      const co = { head: [0, -0.15, 0] }[part] || [0, 0.15, 0];
      this.effects.addSpurt(
        () => (limb.removed ? null : lp.set(...co).applyQuaternion(limb.meshes[part].quaternion).add(limb.meshes[part].position)),
        () => ld.set(...co).normalize().applyQuaternion(limb.meshes[part].quaternion),
        2.5,
      );
    }
    while (this.limbs.length > 18) this.removeLimb(this.limbs[0]);
  }

  removeLimb(limb) {
    limb.removed = true;
    for (const c of limb.constraints) this.world.removeConstraint(c);
    for (const n in limb.bodies) this.world.removeBody(limb.bodies[n]);
    for (const n in limb.meshes) this.scene.remove(limb.meshes[n]);
    this.limbs = this.limbs.filter((l) => l !== limb);
  }

  onFighterDash(k) {
    const p = k.getPos(_a);
    this.effects.dust(p, 6, 1.4);
    this.arena.stirPetals(p.x, p.z, 1.4);
    if (k.isPlayer) { this.audio.whooshBurst(0.6); this.fx.fovKick = 1; }
  }

  onFighterLand(k, vy) {
    if (vy > 2) {
      const p = k.getPos(_a);
      this.effects.dust(p, 10, 1.8);
      this.arena.stirPetals(p.x, p.z, 1.6);
      this.audio.thud(vy / 8);
    }
    if (k.isPlayer && vy > 3) this.shake = Math.max(this.shake, 0.25);
  }

  addHitStop(t) { this.hitStopT = Math.max(this.hitStopT, t); }

  hurtFlash(dmg) {
    const f = this.ui.flash;
    f.style.transition = 'none';
    f.style.opacity = String(clamp(dmg / 50, 0.2, 0.6));
    requestAnimationFrame(() => { f.style.transition = 'opacity 0.5s'; f.style.opacity = '0'; });
  }

  // ------------------------------------------------------------------ UI
  setupUI() {
    const $ = (id) => document.getElementById(id);
    this.ui = {
      doll: Object.fromEntries(['head', 'torso', 'armR', 'armL', 'legR', 'legL'].map((z) => [z, $('d-' + z)])),
      status: $('status'), deathCause: $('death-cause'), deathSub: $('death-sub'), stance: $('stance-label'),
      weapon: $('weapon-label'), kills: $('kills'), wave: $('wave'), prompt: $('prompt'), help: $('help'), death: $('death'),
      posture: $('posture-fill'), postureBox: $('posture'), tools: $('tools'), mode: $('mode-label'), skin: $('skin-select'),
      type: $('enemy-type'), labels: $('labels'), reticle: $('reticle'), kanji: $('kanji'), flash: $('flash'),
      slow: $('btn-slow'), callouts: $('callouts'),
    };
    const start = () => { this.audio.init(); this.input.lock(); };
    $('btn-start').addEventListener('click', start);
    this.canvas.addEventListener('click', start);
    document.addEventListener('pointerlockchange', () => {
      $('overlay').classList.toggle('hidden', this.input.locked || this.started);
      if (this.input.locked) this.started = true;
    });
    const btn = (id, fn) => $(id).addEventListener('click', (e) => { this.audio.init(); fn(); e.currentTarget.blur(); });
    btn('btn-spawn', () => this.spawnWave());
    btn('btn-ally', () => this.spawnFighter(0));
    btn('btn-mode', () => this.setMode(MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length]));
    btn('btn-reset', () => this.resetArena());
    btn('btn-slow', () => this.toggleSlowmo());

    const wb = $('weapon-buttons');
    WEAPON_ORDER.forEach((key, i) => {
      const b = document.createElement('button');
      b.dataset.weapon = key;
      b.title = WEAPONS[key].desc;
      b.innerHTML = `${WEAPONS[key].name} <kbd>${i + 1}</kbd>`;
      if (key === 'katana') b.classList.add('active');
      b.addEventListener('click', () => { this.audio.init(); this.setPlayerWeapon(key); b.blur(); });
      wb.appendChild(b);
    });
    for (const key of SKIN_ORDER) this.ui.skin.add(new Option(SKINS[key].name, key));
    this.ui.skin.addEventListener('change', () => { this.setPlayerSkin(this.ui.skin.value); this.ui.skin.blur(); });
    this.ui.type.add(new Option('Zufall', 'random'));
    for (const key of TYPE_ORDER) this.ui.type.add(new Option(TYPES[key].name, key));
    this.ui.type.addEventListener('change', () => { this.enemyType = this.ui.type.value; this.ui.type.blur(); });
  }

  toggleSlowmo() {
    this.slowmo = !this.slowmo;
    this.ui.slow.classList.toggle('active', this.slowmo);
    this.callout(this.slowmo ? 'ZEITLUPE' : 'ECHTZEIT', null, 'small');
  }

  callout(text, worldPos, cls = '') {
    if (cls === 'small' && worldPos) return;      // no running commentary on every scratch
    const el = document.createElement('div');
    el.className = 'callout ' + cls;
    el.textContent = text;
    let x = innerWidth / 2, y = innerHeight * 0.3;
    if (worldPos) {
      const p = _c.copy(worldPos).project(this.camera);
      if (p.z < 1) { x = (p.x * 0.5 + 0.5) * innerWidth; y = (-p.y * 0.5 + 0.5) * innerHeight - 30; }
    }
    el.style.left = clamp(x, 80, innerWidth - 80) + 'px';
    el.style.top = clamp(y, 90, innerHeight - 60) + 'px';
    this.ui.callouts.appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }

  /** Big brush-stroke character for a finishing blow. */
  kanji(text) {
    const el = this.ui.kanji;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  handleKeys(frame) {
    const p = frame.pressed;
    if (!p.size) return;
    if (p.has('KeyR')) this.spawnWave();
    if (p.has('KeyT')) this.spawnFighter(0);
    if (p.has('KeyM')) this.setMode(MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length]);
    if (p.has('Backspace') || p.has('Delete')) this.resetArena();
    WEAPON_ORDER.forEach((key, i) => { if (p.has('Digit' + (i + 1))) this.setPlayerWeapon(key); });
    if (p.has('KeyK')) this.setPlayerSkin(SKIN_ORDER[(SKIN_ORDER.indexOf(this.skin) + 1) % SKIN_ORDER.length]);
    if (p.has('KeyZ')) this.toggleSlowmo();
    if (p.has('KeyN')) { this.audio.music = !this.audio.music; this.callout(this.audio.music ? 'MUSIK AN' : 'MUSIK AUS', null, 'small'); }
    if (p.has('KeyH')) this.ui.help.classList.toggle('hidden');
    if (p.has('KeyE')) {
      if (this.player.weapon && !this.player.weapon.attached) {
        if (this.player.tryRegrab(1.6)) this.callout('Waffe aufgehoben', null, 'small');
      } else if (this.rackSlot) this.setPlayerWeapon(this.rackSlot.key);
    }
  }

  updateLabels() {
    const cam = this.camera, pp = this.player.getPos(_a);
    for (const k of this.npcs) {
      if (k.counted) continue;
      const show = k.state === 'active';
      let el = k.labelEl;
      if (!el) {
        el = k.labelEl = document.createElement('div');
        el.className = 'tag ' + (k.team === 0 ? 'ally' : 'enemy');
        el.innerHTML = `<div class="nm">${k.name}</div><div class="bar"><i></i></div><div class="dot">斬</div>`;
        el._bar = el.querySelector('i');
        this.ui.labels.appendChild(el);
      }
      const head = k.getHeadPos(_b);
      const dist = head.distanceTo(pp);
      const p = _c.copy(head).setY(head.y + 0.32).project(cam);
      if (!show || p.z > 1 || dist > 28) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${(p.x * 0.5 + 0.5) * innerWidth}px, ${(-p.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
      el._bar.style.width = (clamp(k.posture / k.postureMax, 0, 1) * 100).toFixed(0) + '%';
      el.classList.toggle('broken', k.brokenT > 0);
      el.classList.toggle('near', dist < 9 || this.ctl.lock === k);
      el.classList.toggle('locked', this.ctl.lock === k);
      el.classList.toggle('pressed', k.posture > 0.02 || k.brokenT > 0);
    }
    const lock = this.ctl.lock, r = this.ui.reticle;
    if (lock && lock.state === 'active') {
      const p = _c.copy(lock.parts.torso.position).add(_b.set(0, 0.3, 0)).project(cam);
      r.style.display = p.z < 1 ? 'block' : 'none';
      r.style.transform = `translate(${(p.x * 0.5 + 0.5) * innerWidth}px, ${(-p.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -50%)`;
    } else r.style.display = 'none';
  }

  updateUI() {
    const P = this.player;
    const inj = P.inj;
    const ui = this.ui;
    // paper doll: colour per body part, no numbers
    for (const [z, el] of Object.entries(ui.doll)) el.style.fill = injuryColor(inj.parts[z]);
    ui.doll.torso.style.fill = injuryColor(Math.max(inj.parts.torso, (1 - inj.blood) * 0.9));
    const st = P.brokenT > 0 ? 'Haltung gebrochen' : P.sprinting ? 'Sprint' : STANCE[this.ctl.mode] || 'Chūdan';
    if (st !== this.lastStance) { ui.stance.textContent = st; this.lastStance = st; }
    const wn = P.weapon.attached ? P.weapon.def.name : 'entwaffnet';
    if (wn !== this.lastWeapon) { ui.weapon.textContent = wn; this.lastWeapon = wn; }
    const sc = `${this.kills}`;
    if (sc !== this.lastKills) { ui.kills.textContent = sc; this.lastKills = sc; }
    const wv = this.mode === 'survival' ? ` · Welle ${this.wave} · ${fmtTime(this.runT)}`
      : this.mode === 'chaos' ? ` · ${fmtTime(this.runT)} · ${this.livingEnemies.length} im Hof` : '';
    if (wv !== this.lastWave) { ui.wave.textContent = wv; this.lastWave = wv; }
    const tools = `Verbände ${this.ctl.heals}${this.ctl.free ? ' · Freie Klinge' : ''}${this.ctl.lock ? ' · Ziel erfasst' : ''}`;
    if (tools !== this.lastTools) { ui.tools.textContent = tools; this.lastTools = tools; }
    ui.posture.style.width = (clamp(P.posture / P.postureMax, 0, 1) * 100).toFixed(1) + '%';
    ui.postureBox.classList.toggle('broken', P.brokenT > 0);
    const lines = inj.status();
    const html = lines.length ? lines.map((l) => `<div>${l}</div>`).join('') : '<div class="ok">Unverletzt</div>';
    if (html !== this.lastStatus) { ui.status.innerHTML = html; this.lastStatus = html; }
    const down = P.dead || (P.state === 'ragdoll' && !inj.canStand);
    ui.death.classList.toggle('show', down && this.playerDownT > 1);
    if (down) {
      ui.deathCause.textContent = P.dead ? up(inj.cause || 'Gefallen') : inj.consciousness <= 0.05 ? 'BEWUSSTLOS' : 'KAMPFUNFÄHIG';
      const wait = Math.max(0, Math.ceil(6 - this.playerDownT));
      ui.deathSub.textContent = this.runOver ? `${this.runResult}  ·  Neustart in ${wait} s` : `Neuer Versuch in ${wait} s …`;
    }

    // prompts: finishing blow / pick up dropped weapon / weapon rack
    this.rackSlot = null;
    let prompt = '';
    if (P.state === 'active') {
      const pp = P.getPos(_a);
      if (!P.weapon.attached) {
        const q = P.weapon.body.position;
        const d = Math.hypot(q.x - pp.x, q.z - pp.z);
        prompt = d < 1.6 ? '<kbd>E</kbd> Waffe aufheben' : 'Entwaffnet – geh zu deiner Waffe';
      } else if (this.findFinisherTarget(P)) {
        prompt = '<kbd>LMB</kbd> <b class="kill">Todesstoß</b>';
      } else {
        let best = null, bd = 1.6;
        for (const s of this.arena.rack.slots) {
          const d = Math.hypot(s.world.x - pp.x, s.world.z - pp.z);
          if (d < bd && s.key !== P.weapon.def.key) { bd = d; best = s; }
        }
        this.rackSlot = best;
        if (best) {
          const def = WEAPONS[best.key];
          prompt = `<kbd>E</kbd> ${def.name} nehmen <span class="muted">— ${def.desc}</span>`;
        }
      }
    }
    ui.prompt.style.display = prompt ? 'block' : 'none';
    if (prompt && prompt !== this.lastPrompt) ui.prompt.innerHTML = prompt;
    this.lastPrompt = prompt;

    // body condition → vision: blood loss drains colour & light, dazed blurs
    const bf = inj.bloodFactor, dz = inj.dizzy;
    const u = this.cine.uniforms;
    u.sat.value = 0.25 + 0.75 * bf;
    u.bright.value = 0.55 + 0.45 * Math.min(1, bf + 0.2);
    u.blurAmt.value = dz * 3 + inj.shock * 1.2;
    u.vig.value = 1.1 + (1 - bf) * 1.1 + dz * 0.6 + (this.slowT > 0 ? 0.35 : 0);
    this.updateLabels();
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt) {
    const P = this.player;
    const tgt = P.state === 'active'
      ? _a.copy(P.parts.torso.position).add(_b.set(0, 0.42, 0))
      : _a.copy(P.parts.pelvis.position).add(_b.set(0, 0.6, 0));
    this.camTarget.lerp(tgt, dampFactor(P.state === 'active' ? 14 : 5, dt));
    const yaw = this.ctl.yaw, pitch = this.ctl.pitch;
    const dir = _b.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = _c.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const cam = this.camera;
    const pos = cam.position.copy(this.camTarget).addScaledVector(dir, -3.9).addScaledVector(right, 0.55);
    pos.y = Math.max(0.3, pos.y + 0.4);
    const r = Math.hypot(pos.x, pos.z);
    if (r > WALL_LIMIT) { pos.x *= WALL_LIMIT / r; pos.z *= WALL_LIMIT / r; }
    for (const [ox, oz, or] of this.arena.obstacles) {       // don't sit inside a tree trunk or lantern
      const dx = pos.x - ox, dz = pos.z - oz, d = Math.hypot(dx, dz);
      if (d < or && d > 1e-4 && pos.y < 3.2) { pos.x = ox + dx / d * or; pos.z = oz + dz / d * or; }
    }
    const look = this.camTarget.clone().addScaledVector(dir, 6).addScaledVector(right, 0.3);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.12;
      pos.x += rand(-s, s); pos.y += rand(-s, s); pos.z += rand(-s, s);
      this.shake = Math.max(0, this.shake - dt * 2.8);
    }
    cam.lookAt(look);
    const dz = P.inj.dizzy;
    if (dz > 0.02) cam.rotateZ(Math.sin(this.time * 1.3) * 0.06 * dz + Math.sin(this.time * 0.7) * 0.04 * dz);
  }

  // ------------------------------------------------------------------ main loop
  frame() {
    const realDt = Math.min(this.clock.getDelta(), 1 / 20);
    const frame = this.input.consume();
    this.handleKeys(frame);

    let target = this.slowmo ? 0.3 : 1;
    if (this.slowT > 0) { this.slowT -= realDt; target = Math.min(target, 0.2); }
    if (this.hitStopT > 0) { this.hitStopT -= realDt; this.timeScale = 0.05; }
    else this.timeScale += (target - this.timeScale) * Math.min(1, realDt * 12);
    const dt = realDt * this.timeScale;
    const frozen = this.timeScale < 0.1;
    const P = this.player;

    if (!frozen) {
      if (P.state === 'active') this.ctl.update(dt, frame);
      else this.ctl.lookOnly(frame);
      for (const e of this.npcs) e.brain.update(dt);
      for (const k of this.fighters) k.update(dt);
    } else if (frame.lmbPressed && !this.ctl.free) this.ctl.buffer = 0.3;   // don't swallow a click during hit-stop

    // fixed-step physics
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 8) {
      for (const k of this.fighters) k.physicsStep(FIXED_DT);
      this.world.step(FIXED_DT);
      this.time += FIXED_DT;
      this.processContacts();
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === 8) this.acc = 0;
    RENDER.alpha = clamp(this.acc / FIXED_DT, 0, 1);
    for (const l of this.limbs) for (const n in l.bodies) syncMesh(l.meshes[n], l.bodies[n]);
    for (let i = this.kunais.length - 1; i >= 0; i--) {
      const w = this.kunais[i];
      if (w.dead || this.time - w.born > 9) { w.dispose(); this.kunais.splice(i, 1); } else w.sync(dt);
    }

    for (const k of this.fighters) k.syncVisuals(dt);
    // sandbox: after going down the player is patched up and rises again
    const down = P.dead || (P.state === 'ragdoll' && !P.inj.canStand);
    this.playerDownT = down ? this.playerDownT + realDt : 0;
    if (down && this.isRun && !this.runOver) this.endRun();
    if (down && this.playerDownT > 6 && this.isRun) this.resetArena();
    else if (down && this.playerDownT > 6) {
      const at = P.getPos(new THREE.Vector3());
      const r = Math.hypot(at.x, at.z);
      if (r > 11.5) at.multiplyScalar(11.5 / r);
      P.resetTo(at.setY(0), this.ctl.faceYaw);
      P.poolN = 0;
      P.iframeT = 2;          // a breath before the blades reach you again
      this.ctl.reset();
      this.playerDownT = 0;
    }
    this.checkDefeated();
    this.bleedOut(dt);
    this.updateRun(dt);

    this.effects.update(dt);
    this.arena.update(realDt);
    this.updateCamera(realDt);
    this.fx.chroma = Math.max(0, this.fx.chroma - realDt * 3);
    this.fx.fovKick = Math.max(0, this.fx.fovKick - realDt * 3.5);
    const v = P.state === 'active' ? Math.hypot(P.core.velocity.x, P.core.velocity.z) : 0;
    const fov = 62 + this.fx.fovKick * 7 + Math.min(9, v * 0.75) - (this.slowT > 0 ? 6 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * dampFactor(8, realDt); this.camera.updateProjectionMatrix(); }
    this.cine.uniforms.time.value = this.time;
    this.cine.uniforms.chroma.value = 0.0004 + this.fx.chroma * 0.006;
    const w = P.weapon;
    this.audio.setWhoosh(w && w.attached ? w.tipSpeed : 0, w && w.def.mass > 3);
    this.updateUI();
    this.composer.render();
  }
}

// Final grade: colour grading, chromatic aberration (kicks on hits), blur when dazed, vignette, film grain.
const CINEMATIC = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, chroma: { value: 0.0012 }, grain: { value: 0.04 },
    sat: { value: 1 }, bright: { value: 1 }, blurAmt: { value: 0 }, vig: { value: 1.1 },
    res: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, chroma, grain, sat, bright, blurAmt, vig; uniform vec2 res;
    varying vec2 vUv;
    vec3 ca(vec2 uv) {
      vec2 d = (uv - 0.5) * chroma * (1.0 + length(uv - 0.5) * 2.0);
      return vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
    }
    void main() {
      vec3 c = ca(vUv);
      if (blurAmt > 0.05) {
        vec3 acc = c; float tot = 1.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7854 + time * 0.7;
          vec2 o = vec2(cos(a), sin(a)) * blurAmt * 2.5 / res;
          acc += texture2D(tDiffuse, vUv + o).rgb + texture2D(tDiffuse, vUv + o * 2.2).rgb;
          tot += 2.0;
        }
        c = acc / tot;
      }
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, sat * 1.1);
      // cool shadows, warm highlights
      c = mix(c * vec3(0.92, 0.96, 1.08), c * vec3(1.06, 1.0, 0.92), smoothstep(0.05, 0.7, l));
      c = (c - 0.5) * 1.07 + 0.5;
      c *= bright;
      float v = smoothstep(0.95, 0.2, length((vUv - 0.5) * vec2(1.0, 0.85)) * vig);
      c *= mix(0.3, 1.0, v);
      float n = fract(sin(dot(vUv * res + fract(time) * 917.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * grain;
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

/** Paper → amber → red → black, by injury 0..1. */
function injuryColor(v) {
  const stops = [[0, [222, 214, 196]], [0.3, [214, 166, 86]], [0.65, [190, 40, 35]], [1, [60, 8, 8]]];
  v = clamp(v, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i], [t0, c0] = stops[i - 1];
    if (v <= t1) {
      const f = (v - t0) / (t1 - t0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * f)).join(',')})`;
    }
  }
  return 'rgb(60,8,8)';
}

window.game = new Game();
