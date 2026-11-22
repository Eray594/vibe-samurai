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
import { WEAPONS, WEAPON_ORDER, Weapon, buildWeaponModel } from './weapons.js';
import { buildParts, faceTextures } from './figure.js';
import { Arena, ARENA_R } from './arena.js';
import { CliffArena } from './cliffscape.js';
import { chosenMap } from './maps.js';
import { Effects } from './effects.js';
import { AudioFX } from './audio.js';
import { Brain } from './ai.js';
import { Input, PlayerController } from './player.js';
import { SKINS, SKIN_ORDER, TYPES, TYPE_ORDER, ALLY_STYLE, pick, randomType } from './roster.js';
import { GUARD, POSTURE, DEFLECT_WINDOW, STANCES } from './combat.js';
import { Weather, Fire, buildPlatforms } from './world.js';
import { Horse } from './mount.js';
import { BladeBind, Standoff, Perks, Replay, Versus } from './extras.js';
import { Quality } from './perf.js';
import { Settings, Progress, Menu, Training } from './meta.js';
import { Defense } from './defense.js';
import { DIFFS, Achievements, Daily, Tutorial } from './goals.js';
import { Front, Touch } from './front.js';
import { I18n } from './i18n.js';

const MODES = {
  duel: { name: 'Duell', call: 'DUELL' },
  skirmish: { name: 'Gefecht', call: 'GEFECHT' },
  survival: { name: 'Überleben', call: 'ÜBERLEBEN', run: true },     // waves that keep getting harder; death ends the run
  chaos: { name: 'Chaos', call: 'CHAOS', run: true },                 // they just keep coming, more and more
  versus: { name: '2 Spieler', call: 'ZWEIKAMPF' },                   // player 2 on a gamepad or the arrow keys
  training: { name: 'Training', call: 'TRAINING' },                  // a partner who does one thing, over and over
  defense: { name: 'Verteidigung', call: 'VERTEIDIGUNG', run: true },  // hold the shrine: waves, money, soldiers, traps
  daily: { name: 'Tagesaufgabe', call: 'TAGESAUFGABE', run: true },    // survival, the same for everyone today
  tutorial: { name: 'Einführung', call: 'EINFÜHRUNG' },                // the first round, step by step
};
// what M cycles through: the sandbox. The other modes are picked in the main menu.
const MODE_ORDER = ['duel', 'skirmish', 'chaos', 'versus', 'training'];
const TELE = { thrust: ['突', 'thrust'], sweep: ['足', 'sweep'], heavy: ['危', 'heavy'], arrow: ['弓', 'arrow'], gun: ['危', 'heavy'] };
// what the fighter himself does (as opposed to keys that switch things, which act at once and only once)
const FIGHT_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'KeyF', 'KeyG', 'KeyQ', 'KeyC', 'KeyX', 'KeyY', 'Tab', 'KeyL', 'KeyV', 'KeyW', 'KeyS']);
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const ALLY_TYPE = { ...TYPES.ronin, key: 'ally', name: 'Verbündeter', weapons: ['katana', 'yari', 'naginata'], styles: [ALLY_STYLE], posture: 1.2 };
const ZONE_KNOCK = { head: 1.25, torso: 1.0, armR: 0.5, armL: 0.5, legR: 0.6, legL: 0.6 };
const STANCE = { guard: 'Chūdan', swing: 'Hieb', charge: 'Aufgeladen', parry: 'Deckung', free: 'Freie Klinge', iai: 'Iai – gespannt', bind: 'Klingenbindung', hold: 'Im Griff', hang: 'An der Kante' };
const up = (t) => t.toUpperCase();
const MAX_CORPSES = 10;
const CORPSE_REST = 4;          // seconds a dead body lies before it is frozen (no physics, one mesh per material)
const CORPSE_STAY = 26;         // ... and before it is taken away; sooner when the yard is filling up
const LIMB_STAY = 22;
const MAX_KUNAI = 12;
const WALL_LIMIT = ARENA_R + 0.9;
const WALL_FACE = 14.3;         // where the inside of the yard wall actually is

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
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(1);
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
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
    this.settings = new Settings(this);
    this.progress = new Progress(this);
    this.training = new Training(this);
    this.ach = new Achievements(this);
    this.tutorial = new Tutorial(this);
    this.map = chosenMap(this.settings);
    this.arena = this.map === 'cliff' ? new CliffArena(this) : new Arena(this);
    this.platforms = this.arena.buildPlatforms?.() ?? buildPlatforms(this);
    this.effects.solidAt = (x, z) => this.arena.solidAt(x, z);
    // dust, drops and stains come to rest on whatever is under them (the podium, the boulder), not on the floor below it
    this.effects.surfaceAt = (x, z, y) => {
      let top = 0;
      for (const p of this.platforms) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && y > p.top - 0.3 && p.top > top) top = p.top;
      return top;
    };
    this.smokes = [];
    this.grip = 1;                 // how well feet hold on the ground (rain makes it slick)
    this.perk = { dmg: 1, deflect: 1, kunai: 1, postureDmg: 1, lifesteal: false };
    this.timers = [];
    this.horses = [];
    this.perfectCd = 0;
    this.SamuraiClass = Samurai;
    this.weather = new Weather(this);
    if (this.arena.looks) this.weather.set('dusk');
    this.fire = new Fire(this);
    this.defense = new Defense(this);
    this.daily = new Daily(this);

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
    this.player.dodge = this.dodgeFor(skin);
    this.ctl = new PlayerController(this, this.player, this.input);
    this.arena.showRack('katana');
    this.bind = new BladeBind(this);
    this.standoff = new Standoff(this);
    this.perks = new Perks(this);
    this.replay = new Replay(this);
    this.versus = new Versus(this);
    this.settings.apply();

    this.setupUI();
    this.menu = new Menu(this);
    this.touch = new Touch(this);
    this.i18n = new I18n(this);
    this.front = new Front(this);
    this.refreshSkins();
    this.quality = new Quality(this);
    this.prewarm();
    this.spawnWave(true);
    addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
  }

  /** Everyone in the yard. (Asked for many times a frame: the list is only made anew when someone came or went.) */
  /**
   * Before the first fight: model every kind of fighter and weapon once, and have the graphics card build the shader
   * for everything that will ever appear (a new kind of opponent, the first splinters, the first blood on the floor,
   * rain, the fort). Done lazily, each of these is a freeze of its own in the middle of play — long ones on some systems.
   */
  prewarm() {
    const tmp = new THREE.Group(), undo = [];
    const styles = new Set([...Object.values(SKINS), ALLY_STYLE]);
    for (const key of TYPE_ORDER) for (const st of TYPES[key].styles) styles.add(st);
    for (const st of styles) { const { parts } = buildParts(st); for (const n in parts) tmp.add(parts[n]); }
    for (const key in WEAPONS) tmp.add(buildWeaponModel(WEAPONS[key]));
    if (!this.warmed) for (const t of faceTextures(styles)) this.renderer.initTexture(t);      // (and into the graphics card: an upload is a hitch too)
    this.warmed = true;
    // things made on the spot elsewhere (wounds, traps, a horse, a bow, a rope): one of each kind of plain material
    const box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    for (const mat of [new THREE.MeshStandardMaterial({ color: 0x808080 }), new THREE.MeshStandardMaterial({ color: 0x808080, side: THREE.DoubleSide }), new THREE.MeshBasicMaterial({ color: 0x808080 }), new THREE.MeshLambertMaterial({ color: 0x808080 })]) {
      const m = new THREE.Mesh(box, mat); m.castShadow = m.receiveShadow = true; tmp.add(m);
    }
    this.scene.add(tmp);
    undo.push(this.effects.prewarm());
    for (const o of [this.weather.rain, this.weather.snow]) { const v = o.visible; o.visible = true; undo.push(() => { o.visible = v; }); }
    if (!this.defense.built) this.defense.build();
    this.defense.group.visible = true; undo.push(() => { this.defense.group.visible = this.defense.on; });
    tmp.traverse((o) => { o.frustumCulled = false; });
    try {
      // (the game draws into the composer's buffer, not straight to the screen, and a shader is built for where it draws:
      // so the same target here; then one real picture, which also builds what throws the shadows)
      this.renderer.setRenderTarget(this.composer.readBuffer);
      this.renderer.compile(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      // (everything in it once for real: that also builds what throws the shadows, and puts every model into the graphics card)
      this.composer.render();
    } catch { this.renderer.setRenderTarget(null); /* a driver that refuses: it will compile as it goes, as before */ }
    for (const fn of undo) fn();
    this.scene.remove(tmp);
    box.dispose();
  }

  get fighters() {
    if (this._fnpcs !== this.npcs || this._flen !== this.npcs.length) { this._fnpcs = this.npcs; this._flen = this.npcs.length; this._fighters = [this.player, ...this.npcs]; }
    return this._fighters;
  }
  get livingEnemies() { return this.npcs.filter((e) => e.team === 1 && !e.counted); }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.cine.uniforms.res.value.set(innerWidth, innerHeight);
    this.effects.setPixelScale(innerHeight * this.renderer.getPixelRatio());
  }

  // ------------------------------------------------------------------ spawning
  spawnFighter(team, typeKey, pos, typeDef) {
    const pp = this.player.getPos(new THREE.Vector3());
    if (!pos) {
      let best = null;
      for (let i = 0; i < 14; i++) {
        const ang = Math.random() * Math.PI * 2;
        const c = team === 0
          ? new THREE.Vector3(pp.x + Math.sin(ang) * rand(2, 3.5), 0, pp.z + Math.cos(ang) * rand(2, 3.5))
          : new THREE.Vector3(Math.sin(ang) * rand(6, 10.5), 0, Math.cos(ang) * rand(6, 10.5));
        if (Math.hypot(c.x, c.z) > 11.5 || !this.spotFree(c.x, c.z)) continue;      // not inside the podium, a tree, the palisade
        const d = Math.hypot(c.x - pp.x, c.z - pp.z);
        const crowd = this.npcs.some((e) => e.state === 'active' && e.getPos(_b).distanceTo(c) < 2);
        if ((team === 0 || d > 4.5) && !crowd) { best = c; break; }
        if (!best) best = c;
      }
      pos = best || new THREE.Vector3(0, 0, -3);
    }
    const type = typeDef || (team === 0 ? ALLY_TYPE : TYPES[typeKey] || TYPES.ronin);
    const style = pick(type.styles);
    const yaw = Math.atan2(-(pp.x - pos.x), -(pp.z - pos.z));
    const k = new Samurai(this, {
      team, kind: type, name: type.name, style, position: pos, yaw: team === 0 ? yaw + Math.PI : yaw,
      weapon: pick(type.weapons), armor: style.prot, posture: type.posture,
    });
    k.brain = new Brain(this, k, type);
    if (type.mounted) this.horses.push(new Horse(this, k));
    if (type.ranged) k.parts.fArmL.add(rangedProp(type.ranged));
    if (team === 1 && this.waves) {
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

  /** Room to stand here: nothing solid in the way. */
  spotFree(x, z) {
    for (const [ox, oz, r] of this.arena.obstacles) if (Math.hypot(x - ox, z - oz) < r + 0.45) return false;
    return !this.defense.blocksSpot(x, z);
  }

  removeNpc(k) {
    k.disposed = true;
    k.labelEl?.remove();
    if (k.horse) { k.horse.dispose(); this.horses = this.horses.filter((h) => h !== k.horse); }
    if (this.player.holding === k) this.player.holding = null;
    k.dispose();
    this.npcs = this.npcs.filter((e) => e !== k);
    this.corpses = this.corpses.filter((e) => e !== k);
    if (this.ctl.lock === k) this.ctl.lock = null;
  }

  rollType() {
    if (this.enemyType !== 'random') return this.enemyType;
    const diff = this.waves ? Math.min(1, this.wave * 0.1)
      : this.mode === 'chaos' ? Math.min(0.45, 0.05 + this.runT * 0.004)      // a mob: mostly foot soldiers and rōnin
        : Math.min(0.75, 0.15 + this.kills * 0.05);
    return randomType(diff);
  }

  spawnWave(first = false) {
    const alive = this.livingEnemies;
    if (this.mode === 'versus') {
      for (const e of [...this.npcs]) this.removeNpc(e);
      this.versus.spawn();
    } else if (this.mode === 'training') {
      this.training.spawn();
    } else if (this.mode === 'duel') {
      for (const e of alive) this.removeNpc(e);
      this.spawnFighter(1, this.rollType(), first ? new THREE.Vector3(0, 0, -3) : null);
    } else if (this.mode === 'skirmish') {
      const n = Math.min(3, 9 - alive.length);
      for (let i = 0; i < n; i++) this.spawnFighter(1, this.rollType());
    } else if (this.mode === 'tutorial') {
      this.tutorial.begin();
    } else if (this.mode === 'defense') {
      if (!first) this.defense.startWave();
      return;                                   // the defense announces its own waves
    } else if (this.waves) {
      this.wave++;
      const daily = this.mode === 'daily';
      const n = Math.min(2 + Math.floor(this.wave * 0.8), 8) - alive.length;
      for (let i = 0; i < n; i++) this.spawnFighter(1, i === 0 && this.wave % 5 === 0 ? 'daimyo' : daily ? this.daily.typeFor(this.wave, i) : this.rollType());
      this.hordeT = 0;
      this.waveCleared = false;
      this.ach.best(daily ? 'daily' : 'wave', this.wave);
    } else {
      for (let i = 0; i < 3; i++) this.spawnFighter(1, this.rollType());
    }
    this.callout(this.waves ? `WELLE ${this.wave}` : MODES[this.mode].call, null, 'crit');
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
    this.smokes = [];
    this.fire.clear();
    if (this.bind.active) this.bind.end(null);
    this.standoff.cancel();
    this.replay.stop();
    this.replay.pendingT = 0;
    this.timers = [];
    this.perks.reset();
    this.player.resetTo(new THREE.Vector3(0, 0, 4), 0);
    this.ctl.reset();
    this.ctl.yaw = 0; this.ctl.pitch = -0.2; this.ctl.faceYaw = 0;
    this.kills = 0;
    this.wave = 0;
    this.runT = 0;
    this.chaosT = 2;
    this.runOver = false;
    this.playerDownT = 0;
    this.defense.reset();
    if (this.mode === 'daily') this.daily.begin();
    this.spawnWave(true);
    if (this.mode === 'duel' && this.started && this.input.locked && this.settings.standoff) this.standoff.start(this.livingEnemies[0]);
  }

  get isRun() { return !!MODES[this.mode].run; }
  /** Survival and its daily twin: wave after wave. */
  get waves() { return this.mode === 'survival' || this.mode === 'daily'; }
  /** How hard it is. The daily challenge is the same for everyone. */
  get diff() { return DIFFS[this.mode === 'daily' ? 'normal' : this.settings.diff] || DIFFS.normal; }
  /** A started game that has let go of the mouse stands still. */
  get paused() { return this.started && !this.input.locked; }

  /** The player fell in survival / chaos: the run is over, note the result and the best so far. */
  endRun() {
    this.runOver = true;
    const daily = this.mode === 'daily', byWave = this.waves || this.mode === 'defense';
    const key = daily ? 'vibesamurai.daily' : 'vibesamurai.best.' + this.mode;
    const now = { wave: this.wave, kills: this.kills, time: Math.floor(this.runT) };
    if (daily) now.date = this.daily.date;
    let best = null;
    try { best = JSON.parse(localStorage.getItem(key) ?? localStorage.getItem('heavysteel.best.' + this.mode)); } catch { /* no storage: just no record */ }
    if (daily && best?.date !== this.daily.date) best = null;       // yesterday's run does not count today
    const score = (r) => (byWave ? r.wave * 1000 + r.kills : r.kills * 1000 + r.time);
    const record = !best || score(now) > score(best);
    if (record) { best = now; try { localStorage.setItem(key, JSON.stringify(now)); } catch { /* ignore */ } }
    const line = (r) => (byWave ? `Welle ${r.wave} · ${r.kills} besiegt · ${fmtTime(r.time)}` : `${r.kills} besiegt · ${fmtTime(r.time)}`);
    this.runResult = line(now) + (record ? '  —  neuer Rekord!' : `  —  Rekord: ${line(best)}`);
    this.audio.taiko(1);
    this.front.refresh();
  }

  /** Survival: next wave once the yard is clear. Chaos: a steady, swelling stream. */
  updateRun(dt) {
    if (!this.isRun || this.runOver) return;
    this.runT += dt;
    const alive = this.livingEnemies.length;
    if (this.mode === 'defense') return;        // the defense keeps its own clock (see Defense.update)
    if (this.waves) {
      if (alive) return;
      if (!this.waveCleared && this.wave > 0) {
        this.waveCleared = true;
        this.audio.sting?.('wave');
        this.ctl.heals = Math.min(this.ctl.maxHeals, this.ctl.heals + 1);
        this.ctl.smokes = Math.min(2, this.ctl.smokes + 1);
        this.callout(`WELLE ${this.wave} ÜBERSTANDEN`, null, 'parry');
        this.progress.earn(15 * this.wave);
        this.perks.offer();
      }
      if (this.perks.choosing) return;          // the next wave waits for the choice
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
    if (this.fixedLoadout && key !== this.daily.weapon) { this.callout('DIE TAGESAUFGABE GIBT DIE WAFFE VOR', null, 'small'); return; }
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
    if (skin.locked && !this.progress.has(key)) { this.ui.skin.value = this.skin; this.callout('IM DŌJŌ FREISCHALTEN', null, 'small'); return; }
    this.skin = key;
    this.player.setStyle(skin, skin.prot);
    this.player.dodge = this.dodgeFor(skin);
    this.perks.rebase();              // speed and armour of the new outfit, with this run's upgrades back on top
    this.ui.skin.value = key;
    this.callout(up(skin.name), null, 'small');
  }

  /** The mode selection is up: nothing has been picked yet, or the player went back to it. */
  get mainMenu() { return !this.started && !this.input.locked; }

  /** Main menu: pick a mode and go. */
  play(mode) {
    if (!MODES[mode]) return;
    this.started = false;                  // so a duel opens with the draw once the mouse is caught
    this.setMode(mode);
    this.picked = true;
    document.getElementById('overlay').classList.add('hidden');
    this.resume();
  }

  /** Take the mouse (or, on a touch screen, the sticks) and carry on. */
  resume() {
    this.audio.init();
    if (this.touch.active) { this.input.locked = true; this.started = true; }
    else this.input.lock();
  }

  /** The daily challenge is the same for everyone: its weapon and its weather are not the player's to choose. */
  get fixedLoadout() { return this.mode === 'daily'; }

  /** The lost state of a defense: the shrine is gone. */
  get lost() { return this.defense.active && this.defense.fallen; }

  // sandbox conveniences: they would be cheating where a run is scored
  get sandbox() { return MODE_ORDER.includes(this.mode); }
  callWave() { if (this.sandbox) this.spawnWave(); }      // (in survival and the daily run it would count waves up without a fight)
  callAlly() { if (this.sandbox || this.mode === 'survival') this.spawnFighter(0); }
  cycleMode() { if (this.sandbox) this.setMode(MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length]); }

  /** Load the page again (another map was chosen). An address that names a map would win over the choice: drop it. */
  reload() {
    const u = new URL(location.href);
    u.searchParams.delete('map');
    if (u.href === location.href) location.reload(); else location.href = u.href;
  }

  /** Back to the mode selection. */
  openMainMenu() {
    this.started = false;
    this.picked = false;
    this.menu.toggle(false);
    this.touch.release();
    this.input.locked = !!document.pointerLockElement;
    this.front.refresh();
    document.getElementById('overlay').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setMode(mode) {
    if (this.mode === 'versus' && mode !== 'versus') this.versus.stop();
    this.mode = mode;
    this.ui.mode.textContent = MODES[mode].name;
    document.body.classList.toggle('sandbox', this.sandbox);
    document.body.dataset.playing = mode;
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
    const d = this.diff.tokens;
    if (this.waves || this.mode === 'defense') return Math.max(1, Math.min(4, 2 + Math.floor(this.wave / 4)) + d);
    return Math.max(1, 2 + d);
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
        w.contactT = hs.weapon.contactT = this.time;
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
        if (k === w.owner) continue;                 // nobody is cut by his own sword, in hand or dropped as he falls
        if (w.thrower && k.team === w.thrower.team) continue;
        if (!w.attached && c.speed < 6) continue;
        w.lastHit.set(key, this.time);
        w.contactT = this.time;
        this.bodyHit(w, hs, c);
      } else if (hs.horse) {
        if (c.speed < 4 || (w.thrower || w.owner)?.team === hs.horse.rider.team) continue;
        w.lastHit.set(key, this.time);
        hs.horse.onHit(c);
        if (w.def.thrown) w.dead = true;
      } else if (c.speed > 4) {
        w.lastHit.set(key, this.time);
        const dir = c.rel.clone().normalize();
        if (hs.breakable || hs.mat) w.contactT = this.time;
        if (hs.breakable) this.arena.breakables.weaponHit(hs.breakable, w, c.point, dir, c.speed);
        if (hs.bell) this.arena.ringBell(w.owner || w.thrower, c.speed, dir);
        if (hs.mat && w.attached && w.def.sever && c.wshape?.hsPart === 'blade' && c.speed > 6.5
            && this.arena.cutMat(hs.mat, c.point, dir, c.speed)) {
          this.audio.wood(0.8, true);
          this.effects.splinters(c.point, dir, 16, 0.72, 0.62, 0.36);
          if (w.owner?.isPlayer) this.callout('SAUBERER SCHNITT', c.point, 'small');
        } else if (hs.kind === 'wood') {
          this.audio.wood(c.speed / 12);
          this.effects.splinters(c.point, dir, 4);
          // a full-blooded cut into a post or a trunk: the edge bites and holds
          if (!hs.breakable && !hs.mat && w.attached && w.def.type !== 'club' && c.wshape?.hsPart === 'blade' && c.speed > 9.5 && w.owner?.liveT > 0) this.stickBlade(w.owner, 0.4);
        } else {
          this.audio.clank(c.speed / 22, 0.7);
          this.effects.sparksAt(c.point, c.speed * 0.8, 0.6);
          if (w.attached && c.speed > 8 && !hs.breakable) this.bounce(w.owner, 0.7);        // stone gives nothing: the blade springs back
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
    // an arrow or kunai met a moving blade: struck out of the air
    for (const [t, o] of [[wa, wb], [wb, wa]]) {
      if (!t.def.thrown || !o.attached || t.dead) continue;
      if (o.tipSpeed > 6 || o.owner?.guarding) {
        t.dead = true;
        if (o.owner?.isPlayer) { this.callout(t.def.arrow ? 'PFEIL ZERSCHLAGEN!' : 'ABGEWEHRT', c.point, 'parry'); if (t.def.arrow) this.training.ok('arrow'); }
      }
      return;
    }
    // two committed cuts meet edge on edge: the blades lock
    if (s > 3.5 && wa.attached && wb.attached && this.bind.tryStart(wa.owner, wb.owner, c.point)) return;
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
    // which side of the defender the cut comes in on (0: down the middle, as thrusts and overhead cuts do)
    const dctl = D.isPlayer ? this.ctl : null;
    let cutSide = 0;
    if (dctl) { const lp = _c.copy(point).sub(D.getPos(_a)).applyQuaternion(_q.copy(D.yawQuat()).invert()); cutSide = lp.x > 0.07 ? 1 : lp.x < -0.07 ? -1 : 0; }
    // the guard covers the side the blade is on; a cut on the other side can be stopped, but not deflected, and it costs
    const wrongSide = !!dctl && this.settings.sideGuard && cutSide !== 0 && (dctl.blockSide || 1) !== cutSide && !A.atk?.thrust;
    const deflect = (D.isPlayer || D.human ? D.guardT < (D.deflectWindow ?? DEFLECT_WINDOW) : D.aiDeflect) && !wrongSide;
    const crush = !!A.atk?.unblockable && !deflect;        // a blow with everything behind it goes through a plain block
    const impact = clamp(s / 11, 0.3, 1.3) * w.def.postureDmg * (A.swingHeavy ? 1.5 : 1) * (A.postureMul || 1) * (A.momentum || 1)
      * (A.isPlayer ? this.perk.postureDmg : 1) * (crush ? 2.6 : 1) * (wrongSide ? 1.7 : 1);
    const ap = A.getPos(_a), dp = D.getPos(_b);
    const away = _c.set(ap.x - dp.x, 0, ap.z - dp.z).normalize().clone();
    _cv.set(away.x, 0.5, away.z).scale(w.body.mass * (deflect ? 4 + s * 0.7 : 2 + s * 0.3), _cv);
    w.body.applyImpulse(_cv);
    const mine = D.isPlayer || A.isPlayer;
    if (deflect) {
      D.aiDeflect = false;
      D.posture = Math.min(D.postureMax * 0.95, D.posture + POSTURE.deflector * impact);
      // the blade swept towards the cut as it lands (a pull of the mouse to that side): it is beaten away, not just stopped
      const strong = D.isPlayer && Math.abs(this.ctl.flickX) > 24 && Math.sign(this.ctl.flickX) === (this.ctl.blockSide || 1);
      const broke = A.addPosture(POSTURE.deflected * (0.6 + 0.4 * impact) * (strong ? 1.75 : 1));
      A.stagger(_a.copy(away).multiplyScalar(strong ? 1.5 : 0.7), A.getPos(_b).setY(1.4), strong ? 0.35 : 0.2, strong ? 0.85 : 0.6);
      if (strong) { this.callout('STARKE ABWEHR!', point, 'parry'); this.ctl.flickX = 0; this.shake = Math.max(this.shake, 0.55); }
      if (A.brain) A.brain.onParried();
      else { this.ctl.runner.cancel(); this.ctl.buffer = 0; }
      D.guardRecoil(_a.copy(away).negate(), Math.min(1.3, impact), false);
      this.effects.sparksAt(point, 36, 1.6);
      this.effects.impact(point, 1.3);
      this.audio.deflect();
      this.addHitStop(mine ? 0.085 : 0.03);
      if (mine) { this.shake = Math.max(this.shake, 0.4); this.fx.chroma = Math.max(this.fx.chroma, 0.5); }
      if (D.isPlayer) { if (!strong) this.callout('ABGEWEHRT!', point, 'parry'); else this.ach.said('ABGEWEHRT!'); this.ctl.counterT = strong ? 0.9 : 0.7; this.tutorial.event('deflect'); this.tutorial.event('block'); }
      else if (A.isPlayer) this.callout('ABGEWEHRT', point, 'small');
      if (D.human && D.ctl) D.ctl.counterT = 0.7;
      if (D.isPlayer) this.training.ok(A.atk?.unblockable ? 'heavy' : 'cut');
      if (dctl) {
        // deflect after deflect: each one widens the next, the third leaves him open
        dctl.chain = dctl.chainT > 0 ? dctl.chain + 1 : 1; dctl.chainT = 2.6;
        if (dctl.chain >= 3 && !broke && A.brokenT <= 0) {
          dctl.chain = 0;
          A.posture = A.postureMax; A.brokenT = Math.max(A.brokenT, 2.2);
          this.callout('PARIER-KETTE!', point, 'crit');
          this.onGuardBroken(A, point);
        } else if (dctl.chain === 2) this.callout('KETTE ×2', null, 'small');
      }
      if (broke) this.onGuardBroken(A, point);
    } else if (dctl && !crush && this.slips(D, A)) {
      // stepping off the line as it lands: the cut is led past, and he stumbles after it
      const fwdA = A.forward(_a).clone();
      A.stagger(fwdA.multiplyScalar(3.2), A.getPos(_b).setY(1.3), 0.4, 0.9);
      if (A.brain) { A.brain.runner.cancel(); A.brain.recoilT = Math.max(A.brain.recoilT, 1.0); A.brain.comboLeft = 0; }
      A.addPosture(POSTURE.deflected * 0.5);
      this.effects.sparksAt(point, 16, 1);
      this.audio.clank(0.5, 1.3);
      this.callout('INS LEERE GELENKT!', point, 'parry');
      this.ctl.counterT = 0.8;
    } else {
      if (dctl) dctl.chain = 0;
      if (wrongSide && s > 3) this.callout('FALSCHE SEITE', point, 'small');
      const broke = D.addPosture(POSTURE.block * impact);
      A.posture = Math.min(A.postureMax * 0.95, A.posture + 0.04);
      D.stagger(_a.copy(away).multiplyScalar(-(0.4 + impact * 0.6)), point, 0.03 * impact, 0.15);
      D.guardRecoil(_a.copy(away).negate(), Math.min(1.3, impact * (crush ? 1.3 : 1)), true);
      // his own blade takes the blow too
      if (D.weapon?.attached) { _cv.set(-away.x, -0.35, -away.z).scale(D.weapon.body.mass * (1 + s * 0.22), _cv); D.weapon.body.applyImpulse(_cv); }
      this.effects.sparksAt(point, 10 + s, 0.9);
      if (this.audio.block) this.audio.block(0.5 + s / 14, w.def.mass > 2.5 || (D.weapon?.def.mass ?? 0) > 2.5); else this.audio.clank(0.5 + s / 14, 0.9);
      this.addHitStop(0.03);
      if (D.isPlayer) this.shake = Math.max(this.shake, crush ? 0.7 : 0.25);
      if (crush && D.isPlayer && !broke) this.callout('DURCHBROCHEN!', point, 'crit');
      if (D.isPlayer) this.tutorial.event('block');
      if (A.isPlayer && s > 4) this.callout('GEBLOCKT', point, 'small');
      if (s > 4) this.bounce(A, 0.6);
      (D.isPlayer ? this.ctl : D.ctl)?.spend(0.05 * impact);       // holding a blow costs breath
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
      if (w.attached && attacker) {
        // a sweep at the legs passes under a jump; a high cut passes over a slide
        if (attacker.atk?.low && k.airborne) {
          if (k.sweepJumpT <= 0 && (k.isPlayer || k.human)) { this.callout('ÜBERSPRUNGEN!', c.point, 'parry'); if (k.isPlayer) this.training.ok('sweep'); }
          k.sweepJumpT = 0.9;
          return;
        }
        if (k.slideT > 0 && !attacker.atk?.low && c.point.y > k.groundY + 0.7) {
          if (k.isPlayer && !k.slidSaid) { k.slidSaid = true; this.callout('UNTERTAUCHT!', c.point, 'parry'); }
          return;
        }
        // the man held by the collar takes what was meant for you
        const sh = k.holding;
        if (sh && sh.state === 'active' && attacker !== sh && k.forward(_b).dot(_c.copy(attacker.getPos(_a)).sub(k.getPos(_a)).setY(0).normalize()) > 0.2) {
          const { sev } = sh.inj.wound('torso', Math.pow(Math.max(0, s - 2.6) / 11, 1.15) * def.damage, def.type === 'club' ? 'blunt' : 'cut', def.armorMul ?? 1);
          this.effects.blood(c.point, dir, 20 + sev * 60, 1.2);
          sh.hitFlash = 1;
          this.audio.hit(0.5 + sev, def.type === 'club');
          if (k.isPlayer) this.callout('MENSCHLICHER SCHILD', c.point, 'parry');
          if (sh.inj.dead) { this.throwHeld(k, 0.3); }
          return;
        }
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
            if (k.isPlayer && def.arrow) this.training.ok('arrow');
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
    if (attacker && attacker.team === 1 && k.isPlayer && !attacker.human) raw *= this.mode === 'chaos' ? 0.5 : 0.7;
    if (k.isPlayer && (attacker || w.thrower)?.team === 1) raw *= this.diff.dmg;
    if (this.mode === 'tutorial') raw *= k.isPlayer ? 0.1 : 0.25;                                             // a lesson, not a fight
    if (byPlayer) raw *= this.perk.dmg;
    if (byPlayer && !k.isPlayer && !k.human && kind === 'cut') raw *= 0.85;      // (one cut should rarely settle it: the second one does)
    if (attacker && w.attached) raw *= attacker.momentum || 1;                  // a cut out of a run carries the run with it
    if (this.mode === 'training') raw *= k.isPlayer ? 0.12 : this.training.drill === 'free' ? 1 : 0.3;      // practice: nobody is cut down by accident
    if (attacker && w.attached && attacker.liveT <= 0) raw *= 0.25;   // the blade only bites in a committed cut
    if (attacker?.swingHeavy) raw *= 1.25;
    if (!w.attached) raw *= this.time - (w.thrownAt ?? -9) < 2.5 ? 1.5 : 0.5;      // a weapon thrown in earnest, or one just lying about
    const wasDead = k.dead;
    // a thrown knife has no weight behind it: on plates it rings and drops, in cloth and flesh it stays
    if (def.thrown && !def.arrow && k.inj.armorAt(zone) > 0.45) raw = 0;
    const { sev, ev } = k.inj.wound(zone, raw, kind, def.armorMul ?? 1);
    const deflected = ev.includes('deflect');
    if (def.thrown) {
      w.dead = true;
      if (!deflected && sev > 0.05) {
        k.stick(part, c.point, dir, def);       // it went in, and there it stays
        // and it is felt: the arm it stands in drops, the leg gives, the man loses his thread for a moment
        if (k.state === 'active' && !k.isPlayer) { if (zone.startsWith('leg')) k.kneelT = Math.max(k.kneelT, 0.5); if (k.brain) { k.brain.recoilT = Math.max(k.brain.recoilT, 0.5); k.brain.runner?.cancel?.(); } if (Math.random() < 0.6) this.cryOut(k, 'scream', 1); }
      }
    }
    // driven in deep, the blade does not come out again at once
    if (w.attached && attacker && !deflected && !attacker.atk?.pass && def.type !== 'club'
        && ((kind === 'thrust' && sev > 0.22) || (kind === 'cut' && zone === 'torso' && sev > 0.65))) this.stickBlade(attacker, 0.3 + Math.min(0.3, sev * 0.3));

    // ---- dismemberment: a clean, hard cut through a limb or the neck
    let severed = null;
    if (kind === 'cut' && def.sever && !def.thrown && zone !== 'torso' && !deflected) {
      // plates, splints and a helmet's neck guard are what a blade has to get through first: the more of them,
      // the harder a limb comes off (a limb already ruined comes off regardless)
      const need = (zone.startsWith('leg') ? 0.58 : 0.48) * def.sever * (1 + 1.5 * k.inj.armorAt(zone));
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
      if (attacker && w.attached && s > 6) this.bounce(attacker, 0.5);
    } else {
      k.hitFlash = Math.min(1, sev * 2);
      k.flinch(zone, dir, sev);
      if (k.isPlayer) this.ctl.chain = 0;                 // being hit ends a parry chain
      const bleedy = kind === 'blunt' ? 0.3 : 1;
      this.effects.blood(c.point, dir, 3 + sev * 70 * bleedy, 1 + sev);
      if (kind !== 'blunt' || sev > 0.35) k.addWound(part, c.point, dir, sev, kind);
      if (kind !== 'blunt') w.bloodUp(0.15 + sev * 0.9);
      this.audio.hit(0.3 + sev * 1.4, kind === 'blunt', k.inj.armor > 0.45 && zone !== 'head');
      if (kind === 'cut' && sev > 0.2) this.audio.slash();
      if (ev.includes('broken') || (kind === 'blunt' && sev > 0.5)) this.audio.bone?.(0.5 + sev);
      // a voice only when it is bad: a grunt now and then, a scream for a deep wound, the last sound for some of the dying
      if (!severed) {
        if (ev.includes('dead')) { if (zone !== 'head') this.cryOut(k, 'death', 1); }
        else if (sev > 0.35) this.cryOut(k, 'scream', 0.75);
        else if (sev > 0.2 && Math.random() < 0.3 && this.time - k.cryAt > 1.6) { this.audio.voice?.('pain', 0.5 + sev); k.cryAt = this.time; }
      }
      if (sev > 0.12) {
        this.fx.chroma = Math.max(this.fx.chroma, Math.min(1, sev * 1.5));
        if (sev > 0.3) this.effects.impact(c.point, sev * 2);
        this.addHitStop(0.03 + Math.min(0.09, sev * 0.12));
        this.shake = Math.max(this.shake, clamp(sev * 1.4, 0.15, 1) * (byPlayer || k.isPlayer ? 1 : 0.5));
      }
      if (k.isPlayer) this.hurtFlash(sev * 70);
      // caught unawares (dazed by the bell, lost in smoke): the first cut that lands takes his guard apart
      const caught = !k.isPlayer && !k.human && !!k.brain?.wasLost && k.brokenT <= 0 && !ev.includes('dead');
      if (caught) this.callout('ÜBERRASCHT!', c.point, 'parry');
      if (!ev.includes('dead') && k.addPosture(caught ? k.postureMax : POSTURE.wound * sev + 0.06)) this.onGuardBroken(k, c.point);
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
      else if (heavyBlow && this.braces(k)) {
        // feet planted: a lunge step catches it instead of going down
        k.stagger(dirH.clone().multiplyScalar(knockMag * 0.16), c.point, 0.5, 0.75);
        if (k.isPlayer) { this.callout('ABGEFANGEN', null, 'parry'); this.shake = Math.max(this.shake, 0.7); }
      } else if (heavyBlow) k.goRagdoll(launch(0.9), part, false);
      else {
        if (ev.includes('disarm') || (ev.includes('disarmL') && k.weapon?.def.twoHanded)) k.disarm(dirH.clone().multiplyScalar(2));
        // a hard blow on a leg: it gives way, and he is down on a knee for a moment
        if (zone.startsWith('leg') && sev > 0.2 && !deflected) { k.kneelT = Math.max(k.kneelT, 0.45 + sev * 0.8); if (k.brain) k.brain.recoilT = Math.max(k.brain.recoilT, 0.4 + sev); }
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
      this.audio.bone?.(1);
      w.bloodUp(1);
      if (severed !== 'head') { k.cryAt = -9; this.cryOut(k, 'scream'); }        // (this one always: nobody loses a limb in silence)
    }
    if (severed && byPlayer) this.slowT = Math.max(this.slowT, severed === 'head' ? 0.6 : 0.35);
    if (severed === 'head') { k.dead = true; if (!wasDead) { this.callout('ENTHAUPTET!', c.point, 'crit'); this.audio.taiko(0.8); if (k.team === 1) this.spreadFear(c.point, 9, 0.8); } }
    else if (severed) this.callout(zone.startsWith('arm') ? 'ARM ABGETRENNT!' : 'BEIN ABGETRENNT!', c.point, 'crit');
    else if (ev.includes('dead') && !wasDead) this.onFighterDeath(k, c.point);
    // the cut that ends the fight is shown once more (as the finishing blow is)
    if (byPlayer && k.team === 1 && !wasDead && k.dead && attacker && w.attached && this.mode !== 'versus' && this.mode !== 'tutorial'
        && !this.npcs.some((e) => e !== k && e.team === 1 && !e.counted && !e.dead)) this.replay.trigger(k, attacker);
    else if (ev.includes('ko')) this.callout('BEWUSSTLOS!', c.point, 'crit');
    else if (ev.includes('disarm') && !k.weapon?.attached) this.callout('ENTWAFFNET!', c.point, 'crit');
    else if (ev.includes('broken')) this.callout(`${up(Z)} GEBROCHEN!`, c.point, 'crit');
    else if (ev.includes('crippled')) this.callout(`${up(Z)} UNBRAUCHBAR!`, c.point, 'crit');
    else if (heavyBlow && k.state === 'ragdoll') this.callout('NIEDERGESCHMETTERT!', c.point, 'crit');
    else if (ev.includes('hurt')) this.callout(`${Z} verletzt`, c.point, 'small');
    else if (ev.includes('headWound')) this.callout('Kopfwunde', c.point, 'small');
    else if (ev.includes('severe')) this.callout(kind === 'thrust' ? 'Tiefer Stich' : 'Schwere Wunde', c.point, 'small');
  }

  // ------------------------------------------------------------------ voices
  /**
   * `k` cries out (see AudioFX.cry). Nobody cries twice in a breath, far-off voices are faint, and `chance`
   * decides whether this moment gets a voice at all: most hits pass with the sound of the blow alone.
   */
  cryOut(k, kind, chance = 1) {
    if (this.settings.voices === false) return false;
    if (!k || k.isStructure || this.time - (k.cryAt ?? -9) < (kind === 'moan' ? 4 : 1.6) || Math.random() > chance) return false;
    const at = k.parts.torso.position, cam = this.camera, e = cam.matrixWorld.elements;
    const dx = at.x - cam.position.x, dz = at.z - cam.position.z, d = Math.hypot(dx, dz);
    if (d > 26) return false;
    const level = (k.isPlayer ? 0.8 : 1) / (1 + d * d * 0.006);
    const delay = kind === 'death' ? 0.2 : kind === 'scream' ? 0.13 : 0;
    if (!this.audio.cry?.(kind, { pitch: k.voicePitch, level, delay, pan: clamp((dx * e[0] + dz * e[2]) / Math.max(d, 1.5) * 0.8, -0.8, 0.8) })) return false;
    k.cryAt = this.time;
    return true;
  }

  // ------------------------------------------------------------------ the fallen, and those who are down but not out
  /**
   * The dead come to rest, are frozen (see Samurai.freeze) and after a while taken away, sinking into the ground.
   * The living who cannot get up groan, and lash out at whoever stands over them.
   */
  updateFallen(dt) {
    const many = this.corpses.length > 6 || this.npcs.length > 12;
    let froze = false;          // (one body a frame: merging its meshes takes a moment)
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const k = this.corpses[i];
      if (!k.dead || k.state !== 'ragdoll' || k.human) continue;
      k.deadT += dt;
      const pel = k.ragBodies?.pelvis;
      if (!k.frozen && !froze && k.deadT > CORPSE_REST && pel && (k.fell || k.deadT > CORPSE_REST * 2.5 || Math.hypot(pel.velocity.x, pel.velocity.y, pel.velocity.z) < 0.25)) { froze = true; k.freeze(); k.setShadow(false); }
      const stay = k.fell ? 12 : many ? CORPSE_STAY * 0.45 : CORPSE_STAY;
      if (k.deadT > stay && k !== this.replay.focus) {
        // into the ground, then gone
        if (!k.frozen) { k.freeze(); k.setShadow(false); }
        const u = (k.deadT - stay) / 1.6;
        if (k.frozen) for (const m of k.frozen) m.position.y = -u * u * 0.75;
        if (k.weapon && !k.weapon.attached) k.weapon.mesh.visible = u < 0.5;
        if (u >= 1) this.removeNpc(k);
      }
    }
    for (let i = this.limbs.length - 1; i >= 0; i--) { const l = this.limbs[i]; l.t += dt; if (l.t > LIMB_STAY) this.removeLimb(l); }
    if (this.mode === 'tutorial') return;
    // down but alive
    this.moanT = (this.moanT ?? 2) - dt;
    let moaner = null, n = 0;
    for (const k of this.npcs) {
      if (k.state !== 'ragdoll' || k.dead || k.human || !k.ragBodies?.torso || k.inj.consciousness < 0.3) continue;
      if (k.ragTime > 2.5 && (!k.inj.canStand || k.inj.shock > 0.25) && Math.random() < 1 / ++n) moaner = k;
      this.groundStrike(k, dt);
    }
    if (this.moanT <= 0) { this.moanT = rand(2.5, 5); if (moaner) this.cryOut(moaner, 'moan'); }
  }

  /**
   * A man on the ground with an arm left and an enemy standing over him: the arm comes up, and a moment later
   * he cuts at the leg next to him. Step back (or kick him away) while the arm is up and it meets nothing.
   */
  groundStrike(k, dt) {
    if (k.armless || k.ragTime < 2 || k.inj.canStand || this.mode === 'training') { k.groundWind = 0; return; }
    const tp = k.ragBodies.torso.position;
    let tgt = null, bd = 1.3;
    for (const f of this.fighters) {
      if (f.team === k.team || f.state !== 'active' || f.dead || f.mountH > 0 || f.airborne) continue;
      const p = f.core.position, d = Math.hypot(p.x - tp.x, p.z - tp.z);
      if (d < bd && Math.abs(f.groundY - (tp.y - 0.15)) < 0.8) { bd = d; tgt = f; }
    }
    const arm = k.ragBodies[k.offHanded ? 'fArmL' : 'fArmR'] || k.ragBodies.fArmL || k.ragBodies.fArmR;
    if (k.groundWind > 0) {
      k.groundWind -= dt;
      if (arm) arm.velocity.y = Math.max(arm.velocity.y, 2.2);                 // the arm comes up: this is the warning
      if (k.groundWind > 0) return;
      k.groundCd = rand(3, 5);
      if (!tgt || tgt.iframeT > 0) return;
      const p = tgt.core.position, dx = p.x - tp.x, dz = p.z - tp.z, d = Math.hypot(dx, dz) || 1;
      if (arm) { arm.velocity.x += dx / d * 5; arm.velocity.z += dz / d * 5; arm.velocity.y = -1; }
      const zone = Math.random() < 0.5 ? 'legR' : 'legL', dir = new THREE.Vector3(dx / d, 0.1, dz / d);
      const at = new THREE.Vector3(p.x - dx / d * 0.2, tgt.groundY + 0.3, p.z - dz / d * 0.2);
      const raw = 0.3 * k.inj.vitality * (tgt.isPlayer ? this.diff.dmg * 0.8 : 1);
      const { sev, ev } = tgt.inj.wound(zone, raw, 'cut', 1);
      if (ev.includes('deflect')) { this.effects.sparksAt(at, 6, 0.6); this.audio.clank(0.3, 0.85); return; }
      tgt.addWound(zone === 'legR' ? 'shinR' : 'shinL', at, dir, sev, 'cut');
      tgt.flinch(zone, dir, sev); tgt.hitFlash = Math.min(1, sev * 2 + 0.3);
      tgt.stagger(dir.clone().multiplyScalar(0.8), at, 0.12 + sev * 0.5, 0.35);
      tgt.brain?.onHit?.(sev);
      this.effects.blood(at, dir, 8 + sev * 60, 1);
      this.audio.hit(0.3 + sev, false, tgt.inj.armor > 0.45);
      if (tgt.isPlayer) { this.hurtFlash(sev * 70 + 8); this.callout('VOM BODEN GETROFFEN!', at, 'crit'); this.ctl.chain = 0; }
      return;
    }
    k.groundCd -= dt;
    if (tgt && k.groundCd <= 0) { k.groundWind = 0.55; this.cryOut(k, 'kiai', 0.5); }
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
    if (!headOff) { V.cryAt = -9; this.cryOut(V, 'death'); }
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
    if (V.team === 1) this.spreadFear(point, 10, 0.9);
    // the blow that ends the fight is shown once more
    if (A.isPlayer && this.mode !== 'versus' && !this.npcs.some((e) => e !== V && e.team === 1 && !e.counted && !e.dead)) this.replay.trigger(V, A);
  }

  // ------------------------------------------------------------------ tools
  /** Where a throw goes: at the locked target, else at whoever is close to the line of sight, else straight ahead. */
  throwAim(k, lock, yaw, pitch) {
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
    return { from, dir };
  }

  /** A loose projectile (kunai, arrow) on its way. */
  launch(key, thrower, from, dir, speed) {
    const w = new Weapon(this, key, null);
    w.thrower = thrower;
    w.teleport(from, _q.setFromUnitVectors(UPV, dir));
    w.body.velocity.set(dir.x * speed, dir.y * speed, dir.z * speed);
    w.body.angularDamping = 0.6;
    this.kunais.push(w);
    while (this.kunais.length > MAX_KUNAI + 8) this.kunais.shift().dispose();
    return w;
  }

  throwKunai(k, lock, yaw, pitch) {
    if (k.state !== 'active') return;
    const { from, dir } = this.throwAim(k, lock, yaw, pitch);
    const n = k.isPlayer ? this.perk.kunai : 1;
    const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    for (let i = 0; i < n; i++) {
      // extra kunai fan out to either side
      const off = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1) * 0.11;
      const d = dir.clone().addScaledVector(right, off).normalize();
      this.launch('kunai', k, from.clone().addScaledVector(right, off * 1.5), d, 27);
    }
    this.audio.whooshBurst(0.45);
  }

  /** The weapon in hand, thrown: a spear flies straight, a sword turns over itself. Then it has to be fetched. */
  throwWeapon(k, lock, yaw, pitch) {
    const w = k.weapon;
    if (k.state !== 'active' || !w?.attached) return;
    const { from, dir } = this.throwAim(k, lock, yaw, pitch);
    from.addScaledVector(dir, 0.45);
    k.disarm(null);
    w.thrower = k;
    w.thrownAt = this.time;
    w.teleport(from, _q.setFromUnitVectors(UPV, dir));
    const sp = clamp(25 / Math.sqrt(w.def.mass + 0.4), 11, 21);
    w.body.velocity.set(dir.x * sp, dir.y * sp + 1.2, dir.z * sp);
    if (w.def.type !== 'polearm') {
      const right = _a.set(-dir.z, 0, dir.x).normalize();
      w.body.angularVelocity.set(right.x * -17, 0, right.z * -17);
    }
    w.lastHit.clear();
    if (k.isPlayer) { this.ctl.runner.cancel(); this.callout(w.def.type === 'polearm' ? 'SPEERWURF!' : 'KLINGE GEWORFEN!', null, 'small'); }
    this.audio.whooshBurst(0.9);
    this.fx.fovKick = Math.max(this.fx.fovKick, 0.5);
  }

  /** Take the weapon a dead opponent dropped. */
  looseWeaponNear(pp, range = 1.7) {
    let best = null, bd = range;
    for (const e of this.npcs) {
      const w = e.weapon;
      if (!e.dead || !w || w.attached || w.def.thrown || !WEAPON_ORDER.includes(w.def.key)) continue;
      const d = Math.hypot(w.body.position.x - pp.x, w.body.position.z - pp.z);
      if (d < bd && w.body.position.y < 2) { bd = d; best = e; }
    }
    return best;
  }

  takeWeapon(e) {
    const key = e.weapon.def.key;
    e.weapon.dispose();
    e.weapon = null;
    this.player.setWeapon(key);
    this.player.inj.disarmed = false;
    this.ctl.runner.cancel();
    this.arena.showRack(key);
    this.audio.clank(0.3, 1.2);
    document.querySelectorAll('#weapon-buttons button').forEach((b) => b.classList.toggle('active', b.dataset.weapon === key));
    this.callout(`${up(WEAPONS[key].name)} GENOMMEN`, null, 'small');
  }

  // ------------------------------------------------------------------ archers & gunners
  fireArrow(k, aim) {
    if (k.state !== 'active') return;
    const from = k.parts.torso.position.clone().add(_a.set(0, 0.4, 0)).addScaledVector(k.forward(_b), 0.6);
    const to = aim.clone().sub(from), d = to.length();
    const dir = to.divideScalar(d || 1);
    dir.y += d * 0.0062;
    dir.normalize();
    this.launch('arrow', k, from, dir, 30);
    this.audio.whooshBurst(0.55);
    if (this.audio.ctx) this.audio.pluck(140, this.audio.ctx.currentTime);
  }

  /** A matchlock: nothing to block. The shot goes where the muzzle pointed a moment before — so move. */
  fireGun(k, aim) {
    if (k.state !== 'active') return;
    const from = k.parts.torso.position.clone().add(_a.set(0, 0.4, 0)).addScaledVector(k.forward(_b), 0.9);
    const dir = aim.clone().sub(from).normalize();
    this.effects.sparksAt(from, 40, 1.6);
    this.effects.impact(from, 2.2);
    for (let i = 0; i < 9; i++) {
      this.effects.mist.emit(from, _a.set(dir.x * rand(0.5, 3) + rand(-0.4, 0.4), rand(0.1, 0.8), dir.z * rand(0.5, 3) + rand(-0.4, 0.4)),
        { size: rand(0.3, 0.5), grow: 1.4, life: rand(1.2, 2.2), alpha: 0.4, color: 0xbab4a8, grav: -0.15, drag: 1.8 });
    }
    this.audio.thud(1.5); this.audio.clank(0.9, 0.3);
    this.shake = Math.max(this.shake, 0.35);
    // first body on the line of fire
    let hit = null, hd = 40;
    for (const f of this.fighters) {
      if (f === k || f.team === k.team || f.state !== 'active' || f.dead) continue;
      const rel = _a.copy(f.parts.torso.position).add(_b.set(0, 0.2, 0)).sub(from);
      const along = rel.dot(dir);
      if (along < 0.3 || along > hd) continue;
      if (rel.addScaledVector(dir, -along).length() > 0.36) continue;
      hd = along; hit = f;
    }
    if (!hit) return;
    if (hit.iframeT > 0) { if (hit.isPlayer) this.callout('AUSGEWICHEN!', null, 'parry'); return; }
    const point = from.clone().addScaledVector(dir, hd);
    const { sev, ev } = hit.inj.wound('torso', hit.isPlayer ? 0.6 : 0.85, 'thrust', 1.4);
    hit.hitFlash = 1;
    hit.addWound('torso', point, dir, sev, 'thrust');
    this.effects.blood(point, dir, 40 + sev * 80, 1.4);
    this.audio.hit(0.8 + sev, false);
    hit.brain?.onHit?.(sev);
    if (hit.isPlayer) { this.hurtFlash(45); this.shake = 0.9; this.callout('GETROFFEN!', point, 'crit'); }
    if (ev.includes('dead')) { hit.goRagdoll(dir.clone().multiplyScalar(3).setY(1.2), 'torso', true); this.onFighterDeath(hit, point); }
    else { hit.stagger(dir.clone().multiplyScalar(2.2), point, 0.35, 0.6); if (hit.addPosture(0.35 * hit.postureMax)) this.onGuardBroken(hit, point); }
  }

  /** An opponent's wind-up announces what is coming. */
  onTelegraph(k, tele) {
    if (tele === 'cut' || k.brain?.target !== this.player) return;
    const w = k.weapon;
    if (w) this.effects.impact(w.worldPoint(w.tipLocal, _a), tele === 'heavy' || tele === 'gun' ? 1.3 : 0.7);
    if (tele === 'heavy' || tele === 'gun') this.audio.tick?.();
  }

  // ------------------------------------------------------------------ morale
  /** Something terrible happened here: the faint-hearted nearby lose their nerve for a while. */
  spreadFear(pos, radius, power) {
    let n = 0;
    for (const e of this.npcs) {
      if (e.team !== 1 || e.state !== 'active' || e.dead || e.human || e.mountH > 0 || !e.brain) continue;
      if (e.getPos(_a).distanceTo(pos) > radius) continue;
      if (Math.random() < power * (1 - (e.kind?.courage ?? 0.7))) { e.brain.fearT = rand(4, 8); e.brain.runner.cancel(); n++; }
    }
    if (n) this.callout(n > 1 ? 'SIE WEICHEN ZURÜCK!' : 'ER WEICHT ZURÜCK!', null, 'small');
    return n;
  }

  // ------------------------------------------------------------------ movement: ground, walls, dodges
  /** Height of whatever is under a point (the podium), given how high the feet are. */
  groundAt(x, z, feetY) {
    let g = this.arena.solidAt(x, z) ? 0 : -60;      // beyond the edge of a map that has one: nothing
    for (const p of this.platforms) {
      // a foot on the edge counts: the body is wider than the point it is steered by
      if (x > p.x0 - 0.3 && x < p.x1 + 0.3 && z > p.z0 - 0.3 && z < p.z1 + 0.3 && feetY > p.top - 0.45 && p.top > g) g = p.top;
    }
    return g;
  }

  /** Outward normal of a wall close enough to push off from (the yard wall or a side of the podium), or null. */
  wallNear(k, reach = 0.9) {
    const p = k.core.position;
    const r = Math.hypot(p.x, p.z);
    if (r > WALL_FACE - reach && !this.arena.openAt(p.x, p.z)) return { x: -p.x / r, z: -p.z / r };
    const feet = p.y - 0.98;
    for (const b of this.platforms) {
      if (feet > b.top - 0.1) continue;
      const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < reach - 0.1) return { x: dx / d, z: dz / d, top: b.top };
    }
    return null;
  }

  tryWallJump(k) {
    const n = this.wallNear(k);
    if (!n || !k.wallJump(n.x, n.z)) return false;
    const p = k.getPos(_a);
    this.effects.dust(p, 8, 1.4);
    this.effects.impact(_b.set(p.x - n.x * 0.5, p.y, p.z - n.z * 0.5), 0.8);
    this.audio.thud(0.5);
    if (k.isPlayer) this.fx.fovKick = 1;
    return true;
  }

  /** Sprinting at a wall and jumping carries you up it. */
  wallRunBoost(k) {
    if (!k.sprinting) return 1;
    const n = this.wallNear(k, 1.7);
    if (!n) return 1;
    const v = k.core.velocity;
    return v.x * n.x + v.z * n.z < -2 ? 1.32 : 1;
  }

  /** Jumping against the podium: pull yourself up over the edge. */
  mantle(k) {
    if (k.state !== 'active' || !k.airborne || k.hang) return;
    const p = k.core.position, feet = p.y - 0.98, mv = k.intent.move;
    const ai = !(k.isPlayer || k.human);
    for (const b of this.platforms) {
      if (feet > b.top - 0.02 || feet < b.top - 1.8) continue;
      const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
      const dx = cx - p.x, dz = cz - p.z, d = Math.hypot(dx, dz);
      if (d > 0.7 || d < 0.001 || mv.x * dx + mv.z * dz <= 0) continue;
      if (!ai && feet < b.top - 0.6 && b.top - 1.6 > k.groundY + 0.15) {      // only where there is room to hang
        // the edge is above the chest: catch it with the hands and hang
        if (k.core.velocity.y < 1.5) {
          k.hang = { x: cx, z: cz, nx: -dx / d, nz: -dz / d, y: b.top - 0.62, top: b.top, t: 0 };
          this.audio.thud(0.4);
          this.effects.dust(_a.set(cx, b.top, cz), 5);
        }
        return;
      }
      const need = Math.sqrt(2 * 9.82 * (b.top + 0.14 - feet));
      if (k.core.velocity.y < need) k.core.velocity.y = need;
      if (feet > b.top - 0.35) { k.core.velocity.x = dx / d * 3; k.core.velocity.z = dz / d * 3; }     // over the edge
      if (!k.mantleSaid) { k.mantleSaid = true; this.effects.dust(_a.set(cx, b.top, cz), 6); this.audio.thud(0.35); }
      return;
    }
  }

  /** Light fighters slip far and are hard to catch; armour makes the step short but quick to repeat. */
  dodgeFor(skin) {
    if (skin.prot < 0.3) return { speed: 1.18, time: 0.21, iframe: 0.34, cd: 0.44 };
    if (skin.prot > 0.6) return { speed: 0.86, time: 0.16, iframe: 0.24, cd: 0.36 };
    return { speed: 1, time: 0.19, iframe: 0.28, cd: 0.42 };
  }

  /**
   * A step taken at the very last moment. Into a thrust: the foot comes down on the weapon.
   * Otherwise: time slows and the next cut is a free counter.
   */
  onDodge(k, dir, ctl) {
    if (this.time < this.perfectCd) return;
    const me = k.getPos(new THREE.Vector3());
    for (const f of this.fighters) {
      const a = f.atk;
      if (f.team === k.team || f.state !== 'active' || !a || !f.weapon?.attached) continue;
      const fp = f.getPos(_b), dx = fp.x - me.x, dz = fp.z - me.z, d = Math.hypot(dx, dz) || 1e-3;
      if (d > f.weapon.def.reach + 1.4) continue;
      if (f.brain?.target && f.brain.target !== k) continue;
      const imminent = a.phase === 'strike' || (a.phase === 'wind' && a.windDur - a.t < 0.17);
      if (!imminent) continue;
      this.perfectCd = this.time + 0.7;
      const point = f.weapon.worldPoint(f.weapon.ctrlLocal, new THREE.Vector3());
      if (a.thrust && (dir.x * dx + dir.z * dz) / d > 0.5) {
        // step on it
        f.brain?.onParried();
        if (f.ctl) { f.ctl.runner.cancel(); f.ctl.buffer = 0; }
        const broke = f.addPosture(0.55 * f.postureMax);
        f.stagger(_c.set(dx / d, 0, dz / d).multiplyScalar(0.8), point, 0.25, 0.9);
        const wb = f.weapon.body;
        wb.velocity.set(0, -6, 0);
        k.core.velocity.x *= 0.25; k.core.velocity.z *= 0.25;
        k.dashT = 0.08; k.dashSp = 0;
        k.iframeT = Math.max(k.iframeT, 0.5);
        ctl.counterT = 0.95;
        this.effects.sparksAt(point, 26, 1.2); this.effects.impact(point, 1.6); this.effects.dust(point.clone().setY(0), 10);
        this.audio.thud(1); this.audio.deflect();
        this.addHitStop(0.09); this.slowT = Math.max(this.slowT, 0.3); this.shake = Math.max(this.shake, 0.5);
        if (k.isPlayer || k.human) this.callout('KLINGE NIEDERGETRETEN!', point, 'parry');
        if (k.isPlayer) this.training.ok('thrust');
        if (broke) this.onGuardBroken(f, point);
      } else {
        k.iframeT = Math.max(k.iframeT, 0.42);
        ctl.counterT = 0.95;
        f.posture = Math.min(f.postureMax * 0.95, f.posture + 0.12 * f.postureMax);
        this.slowT = Math.max(this.slowT, 0.45);
        this.fx.chroma = Math.max(this.fx.chroma, 0.6);
        this.audio.tick?.();
        if (k.isPlayer || k.human) this.callout('PERFEKT AUSGEWICHEN!', me.clone().setY(1.6), 'parry');
        if (k.isPlayer) this.training.ok(a.unblockable ? 'heavy' : 'cut');
      }
      return;
    }
  }

  onSkid(k) {
    this.effects.dust(k.getPos(_a), 9, 1.5);
    this.audio.whooshBurst(0.3);
  }

  onClimb(k) {
    this.effects.dust(_a.set(k.core.position.x, k.core.position.y + 0.6, k.core.position.z), 5);
    this.audio.thud(0.35);
  }

  /** Knocked down but awake: a press at the right moment rolls straight back to the feet. One try per fall. */
  tryTech(k, ctl) {
    if (k.state !== 'ragdoll' || k.dead || k.techTried || !k.ragBodies) return false;
    k.techTried = true;
    const pel = k.ragBodies.pelvis;
    if (k.ragTime < 0.15 || k.ragTime > 1.1 || pel.position.y > 1.4 || !k.inj.canStand || k.inj.consciousness < 0.3 || ctl.exhausted) return false;
    const vx = pel.velocity.x, vz = pel.velocity.z, sp = Math.hypot(vx, vz);
    k.getUp();
    k.blendDur = 0.26; k.balance = 0.85; k.staggerT = 0.1;
    k.iframeT = Math.max(k.iframeT, 0.5);
    if (sp > 0.8) {
      // keep the momentum: roll off in the direction of the fall
      k.core.velocity.x = vx / sp * Math.min(sp, 6); k.core.velocity.z = vz / sp * Math.min(sp, 6);
      k.rollAxis.set(vz / sp, 0, -vx / sp);
    } else { const f = k.forward(_b); k.rollAxis.set(-f.z, 0, f.x); }
    k.rollT = k.rollDur;
    ctl.spend(0.2);
    this.effects.dust(k.getPos(_a), 12, 1.4);
    this.audio.whooshBurst(0.6);
    if (k.isPlayer || k.human) this.callout('ABGEROLLT!', null, 'parry');
    return true;
  }

  /** In the air, well above an opponent: whom a cut started now should fall on. */
  plungeTarget(k, ctl) {
    if (!k.airborne || !k.weapon?.attached) return null;
    const me = k.getPos(_a).clone();
    const fx = -Math.sin(ctl.yaw), fz = -Math.cos(ctl.yaw);
    let best = null, bd = 6.5;
    for (const f of this.fighters) {
      if (f.team === k.team || f.state !== 'active' || f.dead || f.mountH > 0) continue;
      const p = f.getPos(_b), dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz);
      if (me.y - p.y < 1.0 || d > bd) continue;
      if (f !== ctl.lock && d > 2 && (dx * fx + dz * fz) / d < 0.3) continue;
      bd = d; best = f;
      if (f === ctl.lock) break;
    }
    return best;
  }

  /** Aim the fall at `tgt`. Returns the time until impact. */
  startPlunge(k, tgt) {
    const me = k.core.position, tp = tgt.core.position;
    const h = Math.max(0.3, me.y - tp.y - 0.9), v0 = 3;
    const t = (-v0 + Math.sqrt(v0 * v0 + 2 * 9.82 * h)) / 9.82;
    const dx = tp.x - me.x, dz = tp.z - me.z;
    const v = k.core.velocity;
    v.y = -v0;
    v.x = clamp(dx / t, -15, 15); v.z = clamp(dz / t, -15, 15);
    k.iframeT = Math.max(k.iframeT, 0.2);
    this.audio.whooshBurst(1);
    if (k.isPlayer) this.fx.fovKick = 1;
    return t;
  }

  plungeHit(k, tgt, ctl) {
    const w = k.weapon;
    if (!w?.attached || tgt.state !== 'active') return;
    const point = tgt.getHeadPos(new THREE.Vector3());
    if (tgt.iframeT > 0) { if (k.isPlayer) this.callout('VERFEHLT', point, 'small'); return; }
    const f = k.forward(new THREE.Vector3());
    w.lastHit.set(tgt.core.id, this.time);
    w.contactT = this.time;
    k.liveT = 0.3; k.swingHeavy = true;
    const broke = tgt.addPosture(0.5 * tgt.postureMax);
    this.bodyHit(w, tgt.core.hs, { other: tgt.core, shape: tgt.core.shapes[2], wshape: { hsPart: 'blade' }, point, rel: new THREE.Vector3(f.x * 4, -14, f.z * 4), speed: 15 });
    if (tgt.state === 'active') {
      tgt.goRagdoll(new THREE.Vector3(f.x * 2.5, -1, f.z * 2.5), 'torso', tgt.dead);
      tgt.getUpAt = rand(1.8, 2.6) + (1 - tgt.inj.vitality) * 2;
    }
    k.core.velocity.x *= 0.2; k.core.velocity.z *= 0.2;
    this.effects.impact(point, 2); this.effects.dust(point.clone().setY(0), 20, 2);
    this.audio.thud(1.3);
    this.addHitStop(0.1); this.slowT = Math.max(this.slowT, 0.35); this.shake = Math.max(this.shake, 0.8);
    if (k.isPlayer || k.human) this.callout('STURZANGRIFF!', point, 'crit');
    if (broke && tgt.state === 'active') this.onGuardBroken(tgt, point);
  }

  /**
   * A heavy cut that met nothing: its weight carries the body round and it takes a moment to
   * recover. Returns true if it was a miss.
   */
  checkWhiff(k, a, ctl) {
    const w = k.weapon;
    if (!a || !w?.attached || k.state !== 'active' || a.pass || a.spin || !(a.heavy || w.def.mass > 3)) return false;
    if (this.time - (w.contactT ?? -9) < a.strikeDur + 0.1) return false;
    const sign = Math.sign(a.end.x - a.wind.x) || (Math.random() < 0.5 ? 1 : -1);
    const m = Math.min(1.6, 0.6 + w.def.mass * 0.25);
    k.core.angularVelocity.y -= sign * 4.2 * m;
    if (ctl) ctl.faceYaw -= sign * 0.45 * m;
    else k.intent.yaw -= sign * 0.45 * m;
    a.recoverDur += 0.22 * m;
    k.balance = Math.max(0.25, k.balance - 0.14 * m);
    k.staggerT = Math.max(k.staggerT, 0.2);
    if (k.isPlayer) this.audio.whooshBurst(0.5);
    return true;
  }

  /** The blade is caught (in a body, in wood) and has to be wrenched free. */
  stickBlade(k, t) {
    if (!k || k.stuckT > 0 || k.state !== 'active') return;
    k.stuckT = t;
    this.audio.thud(0.35);
    if (k.isPlayer) this.callout('KLINGE STECKT', null, 'small');
  }

  onSlide(k) {
    k.slidSaid = false;
    this.effects.dust(k.getPos(_a), 12, 1.6);
    this.audio.whooshBurst(0.7);
    if (k.isPlayer) this.fx.fovKick = 0.8;
  }

  onIaiReady(k) {
    const w = k.weapon;
    this.effects.impact(w.worldPoint(w.handR, _a), 0.9);
    this.audio.tick?.();
  }

  onIai(k, c) {
    this.audio.whooshBurst(1);
    this.audio.slash?.();
    this.fx.fovKick = 1;
    if (k.isPlayer && c >= 1) this.slowT = Math.max(this.slowT, 0.18);
  }

  // ------------------------------------------------------------------ grab & throw
  tryGrab(k) {
    if (k.state !== 'active' || k.holding || k.kickCd > 0) return;
    const me = k.getPos(_a).clone(), fwd = k.forward(new THREE.Vector3());
    let best = null, bd = 1.7;
    for (const f of this.fighters) {
      if (f.team === k.team || f.state !== 'active' || f.dead || f.heldBy || f.mountH > 0) continue;
      const p = f.getPos(_b), dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz) || 1e-3;
      if (d < bd && ((dx * fwd.x + dz * fwd.z) / d > 0.45 || d < 1.25)) { bd = d; best = f; }     // in front, or simply within arm's reach
    }
    k.kickCd = 0.7;
    if (!best) { if (k.isPlayer) this.audio.whooshBurst(0.3); return; }
    const say = (t, c) => { if (k.isPlayer || k.human) this.callout(t, best.getHeadPos(_c), c); };
    if (best.attackPhase === 'strike' || best.iframeT > 0) { say('INS LEERE GEGRIFFEN', 'small'); return; }
    if (best.brokenT <= 0 && (best.kind?.rank >= 5 || best.kind?.key === 'oni' || best.human && best.guarding)) {
      // too solid on his feet: he shrugs it off
      say('ZU STANDHAFT!', 'crit');
      k.stagger(fwd.clone().multiplyScalar(-1.5), k.getHeadPos(_c), 0.15, 0.4);
      return;
    }
    best.heldBy = k; k.holding = best;
    const kc = k.isPlayer ? this.ctl : k.ctl;
    if (kc) { const bp = best.getPos(_b); kc.faceYaw = Math.atan2(-(bp.x - me.x), -(bp.z - me.z)); }
    k.heldT = 2.2;
    best.brokenT = Math.max(best.brokenT, 2.4);
    best.staggerT = Math.max(best.staggerT, 2.4);
    best.brain?.runner?.cancel();
    this.audio.thud(0.7);
    this.addHitStop(0.04);
    say('GEPACKT!', 'parry');
  }

  /** Let go of the man in hand — with force. He flies, and takes with him what he hits. */
  throwHeld(k, power = 1) {
    const f = k.holding;
    k.holding = null;
    if (!f) return;
    f.heldBy = null;
    if (f.state !== 'active' || f.disposed) return;
    const d = k.forward(new THREE.Vector3());
    f.goRagdoll(new THREE.Vector3(d.x * 9.5 * power, 3.4 * power, d.z * 9.5 * power), 'torso', f.dead);
    f.getUpAt = rand(1.8, 2.6) + (1 - f.inj.vitality) * 2;
    f.thrownT = 1.3;
    f.inj.shock = Math.min(1, f.inj.shock + 0.2);
    if (power >= 1) {
      this.audio.whooshBurst(0.9);
      this.shake = Math.max(this.shake, 0.3);
      if (k.isPlayer || k.human) this.callout('GEWORFEN!', null, 'small');
    }
  }

  /** On a map with an edge: whoever has gone over it is lost. */
  updateFalls(dt = 1 / 60) {
    if (!this.arena.abyss) return;
    for (const k of this.fighters) {
      if (k.fell || k.disposed) continue;
      const p = k.state === 'active' ? k.core.position : k.ragBodies?.pelvis?.position;
      if (!p || p.y > -2.2 || this.arena.solidAt(p.x, p.z)) continue;
      k.fell = true;
      const wasDead = k.dead;
      const at = _a.set(p.x, 0.4, p.z);
      if (k.state === 'active') k.goRagdoll(new THREE.Vector3(k.core.velocity.x * 0.3, 0, k.core.velocity.z * 0.3), 'torso', true);
      k.getUpAt = 0;
      if (!wasDead) {
        k.inj.cause = k.inj.cause || 'In den Abgrund gestürzt';
        this.onFighterDeath(k, at);
        k.cryAt = -9; this.cryOut(k, 'fall');
        if (k.team === 1) {
          this.callout('IN DEN ABGRUND!', at, 'crit');
          this.slowT = Math.max(this.slowT, 0.35);
          if (!k.human) { this.progress.earn(5 * (k.kind?.rank ?? 1)); this.ach.add('falls'); }
        }
      }
      k.dead = true;
      if (k.isPlayer) { this.hurtFlash(30); this.shake = Math.max(this.shake, 0.5); }
    }
    // a word of warning when the player's heels are near an open edge
    const P = this.player;
    this.edgeSayT = Math.max(0, (this.edgeSayT || 0) - dt);
    if (this.edgeSayT <= 0 && P.state === 'active' && !P.airborne && this.arena.nearEdge(P.core.position.x, P.core.position.z, 1.4)) {
      this.callout('VORSICHT, KANTE!', null, 'small');
      this.edgeSayT = 6;
    }
  }

  // ------------------------------------------------------------------ smoke
  /** Is this point inside a cloud of smoke? */
  inSmoke(x, z) {
    for (const s of this.smokes) if (s.t > 0.25 && Math.hypot(x - s.x, z - s.z) < s.r) return true;
    return false;
  }

  /** Can `k` not make out `tgt` for the smoke? Close enough, a shape in the smoke is still a shape. */
  smokeHides(k, tgt) {
    if (!this.smokes.length) return false;
    const a = k.getPos(_a), b = tgt.getPos(_b);
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1.5) return false;
    return this.inSmoke(a.x, a.z) || this.inSmoke(b.x, b.z);
  }

  /** A smoke bomb at the feet: for a few seconds nobody in or beyond the cloud sees anything. */
  throwSmoke(k) {
    const ctl = k.isPlayer ? this.ctl : null;
    if (ctl) {
      if (ctl.smokes <= 0) { this.callout('Keine Rauchbomben mehr', null, 'small'); return false; }
      ctl.smokes--;
    }
    const p = k.getPos(_a);
    this.smokes.push({ x: p.x, z: p.z, r: 3.6, t: 0, life: 6.5, emit: 0, by: k });
    this.effects.dust(_b.set(p.x, 0.1, p.z), 30, 3);
    this.audio.whooshBurst?.(0.8); this.audio.thud?.(0.5);
    k.iframeT = Math.max(k.iframeT, 0.3);
    // whoever was about to strike into the cloud loses the thread
    for (const e of this.fighters) {
      if (e.team === k.team || e.state !== 'active' || !e.brain) continue;
      const q = e.core.position;
      if (Math.hypot(q.x - p.x, q.z - p.z) < 6) e.brain.dazed?.(0.5);
    }
    if (k.isPlayer) { this.callout('RAUCH!', null, 'small'); this.ach.add('smokes'); }
    return true;
  }

  updateSmoke(dt) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      const k = clamp(Math.min(s.t / 0.3, (s.life - s.t) / 1.5), 0, 1);
      s.emit += dt * 80 * k;
      while (s.emit > 1) {
        s.emit -= 1;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.r * 0.85;
        _a.set(s.x + Math.sin(a) * r, rand(0.2, 1.9), s.z + Math.cos(a) * r);
        this.effects.mist.emit(_a, _b.set(Math.sin(a) * 0.25, rand(0.05, 0.3), Math.cos(a) * 0.25),
          { size: rand(1.5, 2.5), grow: 0.6, life: rand(1.6, 2.6), alpha: 0.85, color: Math.random() < 0.5 ? 0xd8d8dc : 0xb4b4bc, grav: -0.08, drag: 0.8 });
      }
      if (s.t >= s.life) this.smokes.splice(i, 1);
    }
  }

  /** Bodies in flight knock over comrades, smash what they land in and hurt themselves on the wall. */
  updateThrown(dt) {
    for (const f of this.fighters) {
      if (f.thrownT <= 0) continue;
      f.thrownT -= dt;
      const b = f.ragBodies?.pelvis;
      if (!b || f.state !== 'ragdoll') { f.thrownT = 0; continue; }
      const sp = Math.hypot(b.velocity.x, b.velocity.z);
      if (sp < 3) continue;
      const pos = _a.set(b.position.x, b.position.y, b.position.z);
      const dir = _b.set(b.velocity.x / sp, 0, b.velocity.z / sp);
      let hit = false;
      for (const o of this.fighters) {
        if (o === f || o.team !== f.team || o.state !== 'active' || o.mountH > 0) continue;
        if (o.getPos(_c).distanceTo(pos) > 1.05) continue;
        o.goRagdoll(new THREE.Vector3(dir.x * sp * 0.55, 1.6, dir.z * sp * 0.55), 'torso', false);
        o.getUpAt = rand(1.2, 1.9);
        o.inj.shock = Math.min(1, o.inj.shock + 0.2);
        this.callout('UMGERISSEN!', pos, 'crit');
        hit = true;
      }
      for (const it of this.arena.breakables.items) {
        if (it.broken || !it.body) continue;
        const q = it.body.position;
        if (Math.hypot(q.x - pos.x, q.z - pos.z) > 0.95 || Math.abs(q.y - pos.y) > 1.3) continue;
        this.arena.breakables.damage(it, 45, pos.clone(), dir.clone());
        hit = true;
      }
      if (Math.hypot(pos.x, pos.z) > WALL_FACE - 0.6 && !this.arena.openAt(pos.x, pos.z)) { hit = true; this.callout('GEGEN DIE WAND!', pos, 'crit'); }
      if (hit) {
        f.thrownT = 0;
        f.inj.wound('torso', 0.22, 'blunt', 1);
        this.effects.impact(pos, 1.5);
        this.audio.thud(1.1); this.audio.hit(0.6, true);
        this.shake = Math.max(this.shake, 0.4);
        if (f.inj.dead) f.dead = true;
      }
    }
  }

  /**
   * Who throws a shadow. Every figure with one is drawn twice, so only those nearest the camera get it;
   * how many depends on the graphics quality.
   */
  updateShadows(dt) {
    this.shadowT = (this.shadowT || 0) - dt;
    if (this.shadowT > 0) return;
    this.shadowT = 0.35;
    const cam = this.camera.position, budget = this.shadowBudget ?? 6, list = [];
    for (const k of this.npcs) {
      if (k.frozen) continue;
      const p = k.parts.torso.position;
      list.push([(p.x - cam.x) ** 2 + (p.z - cam.z) ** 2, k]);
    }
    list.sort((a, b) => a[0] - b[0]);
    list.forEach(([, k], i) => k.setShadow(i < budget));
    this.player.setShadow(true);
  }

  /** Run `fn` after `t` seconds of game time. */
  after(t, fn) { this.timers.push({ t, fn }); }


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
    // what the body is doing goes into the blade: forwards adds, giving ground takes away
    if (k.isPlayer || k.human) {
      const v = k.core.velocity, f = k.forward(_a), fwd = k.state === 'active' ? v.x * f.x + v.z * f.z : 0;
      k.momentum = fwd >= 0 ? 1 + Math.min(0.3, fwd * 0.05) : Math.max(0.8, 1 + fwd * 0.08);
    }
    if (k.isPlayer) this.tutorial.event('cut');
    if (k.isPlayer) { if (heavy) this.audio.voice?.('effort', 1); }
    else if (heavy || Math.random() < 0.1) this.cryOut(k, 'kiai');
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
    w.contactT = this.time;
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
        if (k.sweepJumpT > 0) {
          // over the sweep and straight into his chest
          k.sweepJumpT = 0;
          const broke = f.addPosture(0.6 * f.postureMax);
          if (k.isPlayer || k.human) this.callout('SPRUNGTRITT!', foot, 'parry');
          this.slowT = Math.max(this.slowT, 0.3);
          if (broke) this.onGuardBroken(f, foot);
        }
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

  /**
   * A cut shown and taken back. Whoever had already answered it (guard up) is left with nothing to
   * answer: the guard drops, and for a moment he has no reply to the cut that really comes.
   */
  onFeint(k) {
    if (this.time < (k.feintUntil || 0)) return 0;
    const me = k.getPos(_a);
    let n = 0;
    for (const e of this.npcs) {
      const b = e.brain;
      if (e.team === k.team || e.state !== 'active' || e.dead || !b || b.target !== k || b.blockT <= 0) continue;
      if (e.getPos(_b).distanceTo(me) > 4.2) continue;
      b.blockT = 0; b.fooledT = 0.9; b.cooldown = Math.max(b.cooldown, 0.6);
      e.addPosture(0.08 * e.postureMax);
      n++;
    }
    if (!n) return 0;
    k.feintUntil = this.time + 1.2;              // it does not work twice in a breath
    if (k.isPlayer || k.human) this.callout('FINTE!', null, 'parry');
    this.audio.tick?.();
    return n;
  }

  /** The blade met something that would not give (stone, a plate, a firm guard): it springs back and the cut is over. */
  bounce(k, strength = 0.6) {
    if (!k || k.state !== 'active') return false;
    const ctl = k.isPlayer ? this.ctl : k.ctl;
    const runner = ctl ? ctl.runner : k.brain?.runner;
    const a = runner?.a;
    if (!a || a.phase !== 'strike' || a.bounced) return false;
    a.bounced = true;
    // from where the hand is now, thrown a little back along the way it came; then the usual way home, a bit later
    a.end = runner.hand.clone().lerp(a.wind, 0.28 * strength);
    a.endDir = runner.bdir.clone().lerp(a.windDir, 0.3 * strength).normalize();
    a.phase = 'recover'; a.t = 0;
    a.recoverDur += 0.16 * strength;
    if (k.brain) { k.brain.comboLeft = 0; k.brain.recoilT = Math.max(k.brain.recoilT, 0.25 * strength); }
    else if (ctl) { ctl.buffer = 0; ctl.comboI = 0; }
    if (k.isPlayer) { this.shake = Math.max(this.shake, 0.3 * strength); this.fx.chroma = Math.max(this.fx.chroma, 0.3); }
    return true;
  }

  /** Feet planted (hardly moving, on the ground, not mid-cut on the move): a heavy blow can be caught with a step. */
  braces(k) {
    if (!(k.isPlayer || k.human) || k.airborne || k.staggerT > 0 || k.brokenT > 0 || k.inj.legStrength < 0.6) return false;
    return Math.hypot(k.core.velocity.x, k.core.velocity.z) < 1.6;
  }

  /** In the guard and moving sideways across the attacker's line as the blow lands. */
  slips(D, A) {
    if (!D.guarding) return false;
    const v = D.core.velocity, dp = D.getPos(_a), ap = A.getPos(_b);
    const tx = ap.x - dp.x, tz = ap.z - dp.z, d = Math.hypot(tx, tz) || 1;
    const lateral = Math.abs(v.x * (-tz / d) + v.z * (tx / d));
    return lateral > 2.0;
  }

  onJump(k) {
    this.effects.dust(k.getPos(_a), 6, 1.2);
  }

  onFighterDeath(k, point) {
    if (!point) this.cryOut(k, 'death', 0.6);      // (bled out or burnt, not cut down: the blow has its own voice)
    k.dead = true;
    const where = point || k.getHeadPos(_c);
    this.callout(up(k.inj.cause || 'Gefallen'), where, 'crit');
    if (k.team === 1 && !k.human) {
      // the leader is whoever outranks the rest; when he falls, the rest waver
      const rest = this.npcs.filter((e) => e !== k && e.team === 1 && !e.dead && !e.counted);
      const rank = k.kind?.rank ?? 1;
      if (rest.length && rank >= 3 && rest.every((e) => (e.kind?.rank ?? 1) < rank)) {
        if (this.spreadFear(where, 30, 1.3)) this.callout('DER ANFÜHRER IST GEFALLEN!', null, 'parry');
      } else this.spreadFear(where, 6, 0.3);
    }
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
          this.audio.sting?.('kill');
          if (!e.human) { this.progress.earn(10 * (e.kind?.rank ?? 1)); this.ach.add('kills'); }
          this.defense.onKill(e);
          if (this.perk.lifesteal && this.player.state === 'active') {
            const inj = this.player.inj;
            this.player.posture = 0;
            inj.bleeding *= 0.5; inj.shock *= 0.5; inj.blood = Math.min(1, inj.blood + 0.05);
          }
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
      this.effects.decal(p.x + rand(-r, r), p.z + rand(-r, r), 0.35 + k.poolN * 0.06, p.y + 0.4);
    }
  }

  onFighterDown(k) {
    this.audio.thud(0.9);
    if (k.weapon && !k.weapon.attached && !k.weapon.def.thrown) this.audio.clatter?.(0.7, k.weapon.def.mass > 2.5);
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
    f.style.opacity = String(clamp(dmg / 50, 0.2, 0.6) * 0.55);
    requestAnimationFrame(() => { f.style.transition = 'opacity 0.5s'; f.style.opacity = '0'; });
  }

  // ------------------------------------------------------------------ UI
  setupUI() {
    const $ = (id) => document.getElementById(id);
    this.ui = {
      doll: Object.fromEntries(['head', 'torso', 'armR', 'armL', 'legR', 'legL'].map((z) => [z, $('d-' + z)])),
      status: $('status'), deathCause: $('death-cause'), deathSub: $('death-sub'), stance: $('stance-label'),
      weapon: $('weapon-label'), kills: $('kills'), wave: $('wave'), prompt: $('prompt'), help: $('help'), helpOpen: $('help-open'), death: $('death'),
      posture: $('posture-fill'), postureBox: $('posture'), tools: $('tools'), mode: $('mode-label'), skin: $('skin-select'),
      type: $('enemy-type'), labels: $('labels'), reticle: $('reticle'), kanji: $('kanji'), flash: $('flash'),
      slow: $('btn-slow'), callouts: $('callouts'), weather: $('weather-label'), quality: $('quality-label'), rank: $('rank-label'), stamina: $('stamina-fill'), staminaBox: $('stamina'),
    };
    const start = () => { if (this.started || this.picked) this.resume(); };      // also when the browser refused the mouse at first
    this.canvas.addEventListener('click', start);
    document.addEventListener('pointerlockchange', () => {
      $('overlay').classList.toggle('hidden', this.input.locked || this.started);
      // the very first duel opens with the draw
      if (this.input.locked && !this.started && this.mode === 'duel' && this.kills === 0 && this.settings.standoff) this.standoff.start(this.livingEnemies[0]);
      if (this.input.locked) this.started = true;
    });
    const btn = (id, fn) => $(id).addEventListener('click', (e) => { this.audio.init(); fn(); e.currentTarget.blur(); });
    btn('btn-spawn', () => this.callWave());
    btn('btn-ally', () => this.callAlly());
    btn('btn-mode', () => this.cycleMode());
    btn('btn-reset', () => this.resetArena());
    btn('btn-slow', () => this.toggleSlowmo());
    btn('btn-weather', () => this.nextWeather());
    btn('btn-menu', () => this.menu.toggle());
    btn('btn-main', () => this.openMainMenu());
    btn('btn-quality', () => this.callout('GRAFIK: ' + up(this.quality.cycle()), null, 'small'));
    btn('help-close', () => this.setHelp(false));
    btn('help-open', () => this.setHelp(true));
    this.setHelp(this.settings.help !== false);
    // how much room the bar at the top takes (it wraps on narrow screens): panels below it keep clear of it
    const bar = $('topbar'), room = () => { this.barH = Math.ceil(bar.getBoundingClientRect().bottom); document.documentElement.style.setProperty('--bar', this.barH + 'px'); };
    room();
    if (window.ResizeObserver) new ResizeObserver(room).observe(bar);
    addEventListener('resize', room);

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
    this.ui.skin.addEventListener('change', () => { this.setPlayerSkin(this.ui.skin.value); this.ui.skin.blur(); });
    this.ui.type.add(new Option('Zufall', 'random'));
    for (const key of TYPE_ORDER) this.ui.type.add(new Option(TYPES[key].name, key));
    this.ui.type.addEventListener('change', () => { this.enemyType = this.ui.type.value; this.ui.type.blur(); });
  }

  /** Outfit list: what is not earned yet is shown, but greyed out. */
  refreshSkins() {
    const sel = this.ui.skin;
    sel.length = 0;
    for (const key of SKIN_ORDER) {
      const s = SKINS[key], locked = s.locked && !this.progress.has(key);
      const o = new Option(locked ? `${s.name} (Dōjō)` : s.name, key);
      o.disabled = locked;
      sel.add(o);
    }
    sel.value = this.skin;
  }

  /** The panel that lists the controls: shown, or put away behind a small chip. The choice is kept. */
  setHelp(show) {
    this.ui.help.classList.toggle('hidden', !show);
    this.ui.helpOpen.classList.toggle('hidden', show);
    if (this.settings.help !== show) this.settings.set('help', show);
  }
  toggleHelp() { this.setHelp(this.ui.help.classList.contains('hidden')); }

  nextWeather() {
    if (this.fixedLoadout) { this.callout('DIE TAGESAUFGABE GIBT DAS WETTER VOR', null, 'small'); return; }
    this.weather.next();
    this.ui.weather.textContent = this.weather.name;
    this.callout(up(this.weather.name), null, 'small');
  }

  toggleSlowmo() {
    this.slowmo = !this.slowmo;
    this.ui.slow.classList.toggle('active', this.slowmo);
    this.callout(this.slowmo ? 'ZEITLUPE' : 'ECHTZEIT', null, 'small');
  }

  callout(text, worldPos, cls = '') {
    this.ach.said(text);
    if (text === 'TODESSTOSS!') this.tutorial.event('finish');
    if (cls === 'small' && worldPos) return;      // no running commentary on every scratch
    const el = document.createElement('div');
    el.className = 'callout ' + cls;
    el.textContent = text;
    // (while upgrades are on offer the middle of the screen is theirs: what is called out goes above them)
    let x = innerWidth / 2, y = this.perks?.choosing ? (this.barH || 100) + 22 : innerHeight * 0.3;
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
    const shop = this.defense.keys(p);            // in the build pause the digits buy, Enter / R start the wave
    if (p.has('KeyR') && !shop) this.callWave();
    if (p.has('KeyT')) this.callAlly();
    if (p.has('KeyM')) this.cycleMode();
    if (p.has('Backspace') || p.has('Delete')) this.resetArena();
    if (this.perks.choosing) { for (let i = 0; i < 3; i++) if (p.has('Digit' + (i + 1))) this.perks.pick(i); }
    else if (shop || (this.defense.active && this.defense.phase === 'build')) { /* digits belong to the shop */ }
    else WEAPON_ORDER.forEach((key, i) => { if (p.has('Digit' + (i + 1))) this.setPlayerWeapon(key); });
    if (p.has('KeyU')) this.nextWeather();
    if (p.has('KeyP')) { this.settings.set('replay', !this.settings.replay); this.callout(this.settings.replay ? 'WIEDERHOLUNG AN' : 'WIEDERHOLUNG AUS', null, 'small'); }
    if (p.has('KeyO') && this.mode === 'training') this.training.next();
    if (p.has('KeyI')) this.menu.toggle();
    if (p.has('KeyK')) {
      // next outfit that is yours to wear
      let i = SKIN_ORDER.indexOf(this.skin);
      do i = (i + 1) % SKIN_ORDER.length; while (SKINS[SKIN_ORDER[i]].locked && !this.progress.has(SKIN_ORDER[i]));
      this.setPlayerSkin(SKIN_ORDER[i]);
    }
    if (p.has('KeyZ')) this.toggleSlowmo();
    if (p.has('KeyN')) { this.settings.set('music', !this.audio.music); this.callout(this.audio.music ? 'MUSIK AN' : 'MUSIK AUS', null, 'small'); }
    if (p.has('KeyH')) this.toggleHelp();
    if (p.has('KeyE')) {
      if (this.player.weapon && !this.player.weapon.attached) {
        const loose = this.player.state === 'active' ? this.looseWeaponNear(this.player.getPos(_a)) : null;
        if (this.player.tryRegrab(1.6)) this.callout('Waffe aufgehoben', null, 'small');
        else if (loose) this.takeWeapon(loose);
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
        el.innerHTML = `<div class="warn"></div><div class="nm">${k.name}</div><div class="bar"><i></i></div><div class="dot">斬</div>`;
        el._bar = el.querySelector('i');
        el._warn = el.querySelector('.warn');
        this.ui.labels.appendChild(el);
      }
      const head = k.getHeadPos(_b);
      const dist = head.distanceTo(pp);
      const p = _c.copy(head).setY(head.y + 0.32).project(cam);
      if (!show || p.z > 1 || dist > 34) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${(p.x * 0.5 + 0.5) * innerWidth}px, ${(-p.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
      el._bar.style.width = (clamp(k.posture / k.postureMax, 0, 1) * 100).toFixed(0) + '%';
      el.classList.toggle('broken', k.brokenT > 0);
      el.classList.toggle('near', dist < 9 || this.ctl.lock === k);
      el.classList.toggle('locked', this.ctl.lock === k);
      el.classList.toggle('pressed', k.posture > 0.02 || k.brokenT > 0);
      // what the wind-up announces: thrust (step in), sweep (jump), heavy / shot (get out of the way)
      const tl = k.brain?.tele && k.brain.tele !== 'cut' && k.brain.target === this.player ? k.brain.tele : null;
      if (tl !== el._tele) {
        el._tele = tl;
        el._warn.textContent = tl ? TELE[tl][0] : '';
        el._warn.className = 'warn' + (tl ? ' on ' + TELE[tl][1] : '');
      }
      if (k.brain?.fearT > 0 !== el._fear) { el._fear = k.brain?.fearT > 0; el.classList.toggle('afraid', !!el._fear); }
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
    const st = P.brokenT > 0 ? 'Haltung gebrochen' : P.slideT > 0 ? 'Rutschen' : P.sprinting ? 'Sprint' : this.ctl.sheathed ? 'Schwert in der Scheide'
      : this.ctl.mode === 'guard' ? STANCES[this.ctl.stance].name
        : this.ctl.mode === 'parry' && this.settings.sideGuard ? (this.ctl.blockSide < 0 ? 'Deckung links' : 'Deckung rechts') + (this.ctl.chain > 0 ? ` · Kette ${this.ctl.chain}` : '')
          : STANCE[this.ctl.mode] || 'Chūdan';
    if (st !== this.lastStance) { ui.stance.textContent = st; this.lastStance = st; }
    const wn = P.weapon.attached ? P.weapon.def.name : 'entwaffnet';
    if (wn !== this.lastWeapon) { ui.weapon.textContent = wn; this.lastWeapon = wn; }
    const rk = `${up(this.progress.rank)} · ${this.progress.honor} EHRE`;
    if (rk !== this.lastRank) { ui.rank.textContent = rk; this.lastRank = rk; }
    const sc = `${this.kills}`;
    if (sc !== this.lastKills) { ui.kills.textContent = sc; this.lastKills = sc; }
    const wv = this.waves ? ` · Welle ${this.wave} · ${fmtTime(this.runT)}${this.perks.taken.length ? ' · ' + this.perks.taken.length + ' Verbesserungen' : ''}`
      : this.mode === 'versus' ? ` · Spieler 1  ${this.versus.score[0]} : ${this.versus.score[1]}  Spieler 2${this.versus.pad.connected ? '' : ' (Pfeiltasten , . - · oder Gamepad anschließen)'}`
      : this.mode === 'chaos' ? ` · ${fmtTime(this.runT)} · ${this.livingEnemies.length} im Hof` : '';
    if (wv !== this.lastWave) { ui.wave.textContent = wv; this.lastWave = wv; }
    const tools = `Verbände ${this.ctl.heals} · Rauch ${this.ctl.smokes}${this.ctl.free ? ' · Freie Klinge' : ''}${this.ctl.lock ? ' · Ziel erfasst' : ''}`;
    if (tools !== this.lastTools) { ui.tools.textContent = tools; this.lastTools = tools; }
    ui.posture.style.width = (clamp(P.posture / P.postureMax, 0, 1) * 100).toFixed(1) + '%';
    ui.stamina.style.width = (this.ctl.stamina * 100).toFixed(1) + '%';
    ui.staminaBox.classList.toggle('out', this.ctl.exhausted);
    ui.postureBox.classList.toggle('broken', P.brokenT > 0);
    const lines = inj.status();
    const html = lines.length ? lines.map((l) => `<div>${l}</div>`).join('') : '<div class="ok">Unverletzt</div>';
    if (html !== this.lastStatus) { ui.status.innerHTML = html; this.lastStatus = html; }
    const down = P.dead || (P.state === 'ragdoll' && !inj.canStand) || this.lost;
    ui.death.classList.toggle('show', down && this.playerDownT > 1);
    if (down) {
      ui.deathCause.textContent = this.lost ? 'DER SCHREIN IST GEFALLEN' : P.dead ? up(inj.cause || 'Gefallen') : inj.consciousness <= 0.05 ? 'BEWUSSTLOS' : 'KAMPFUNFÄHIG';
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
        const loose = this.looseWeaponNear(pp);
        prompt = d < 1.6 ? '<kbd>E</kbd> Waffe aufheben' : loose ? `<kbd>E</kbd> ${loose.weapon.def.name} nehmen` : 'Entwaffnet – hol deine Waffe oder nimm eine andere';
      } else if (P.holding) {
        prompt = '<kbd>LMB</kbd> / <kbd>G</kbd> <b class="kill">Werfen</b>';
      } else if (P.hang) {
        prompt = '<kbd>Space</kbd> hochziehen · <kbd>S</kbd> loslassen';
      } else if (this.findFinisherTarget(P)) {
        prompt = '<kbd>LMB</kbd> <b class="kill">Todesstoß</b>';
      } else if (!this.fixedLoadout) {
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
    if (this.versus.active) { this.versus.camera(dt); return; }
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
    this.defense.keepCamera(this.camTarget, pos);
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
    const rawDt = this.clock.getDelta();
    this.quality.update(rawDt);
    const realDt = Math.min(rawDt, 1 / 20);
    const frame = this.input.consume();
    const halted = this.mainMenu || this.paused;
    if (!halted) this.handleKeys(frame);
    else if (this.started) {
      if (frame.pressed.has('KeyI')) this.menu.toggle();      // the dōjō can still be closed again
      if (frame.pressed.has('KeyH')) this.toggleHelp();       // and the controls panel put away or fetched back
    }
    this.front.update();

    let target = this.slowmo ? 0.3 : 1;
    if (this.slowT > 0) { this.slowT -= realDt; target = Math.min(target, 0.2); }
    if (this.hitStopT > 0) { this.hitStopT -= realDt; this.timeScale = 0.05; }
    else this.timeScale += (target - this.timeScale) * Math.min(1, realDt * 12);
    if (halted) this.timeScale = 0;             // the yard holds its breath behind the mode selection and while paused
    const dt = realDt * this.timeScale;
    const frozen = this.timeScale < 0.1;
    const P = this.player;
    // A key or button pressed while a hit freezes the picture must not be lost: it is handed to the
    // fighter as soon as time moves again (otherwise a guard raised into a clash simply vanishes).
    const kept = this.keptInput;
    if (kept && !frozen) {
      for (const c of kept.pressed) frame.pressed.add(c);
      frame.lmbPressed ||= kept.lmb; frame.rmbPressed ||= kept.rmb; frame.mmbPressed ||= kept.mmb;
      this.keptInput = null;
    } else if (frozen && !halted && !this.replay.active && (frame.pressed.size || frame.lmbPressed || frame.rmbPressed || frame.mmbPressed)) {
      const k = this.keptInput || (this.keptInput = { pressed: new Set(), lmb: false, rmb: false, mmb: false });
      for (const c of frame.pressed) if (FIGHT_KEYS.has(c)) k.pressed.add(c);
      k.lmb ||= frame.lmbPressed; k.rmb ||= frame.rmbPressed; k.mmb ||= frame.mmbPressed;
    } else if (halted) this.keptInput = null;

    // the finishing blow once more, slowly: nothing else moves meanwhile
    if (this.replay.active) {
      this.replay.update(realDt, frame);
      if (this.replay.active) { this.cine.uniforms.time.value += realDt; this.composer.render(); return; }
    }

    if (!frozen) {
      if (this.timers.length) {
        const due = [];
        this.timers = this.timers.filter((t) => { t.t -= dt; if (t.t <= 0) { due.push(t); return false; } return true; });
        for (const t of due) t.fn();
      }
      if (this.standoff.active) this.standoff.update(dt, frame);
      else {
        if (P.state === 'active') this.ctl.update(dt, frame);
        else this.ctl.lookOnly(frame);
        for (const e of this.npcs) e.brain.update(dt);
      }
      this.bind.update(dt);
      // the man in hand does not stay there for ever
      if (P.holding) { P.heldT -= dt; if (P.heldT <= 0 || P.holding.state !== 'active') this.throwHeld(P, 0.35); }
      for (const k of this.fighters) {
        if (k.isPlayer || k.human || k.brain?.climbing) { this.mantle(k); if (!k.airborne) k.mantleSaid = false; }
        k.update(dt);
      }
      for (const h of this.horses) h.update(dt);
      this.updateThrown(dt);
      this.updateFalls(dt);
      this.updateSmoke(dt);
      this.updateFallen(dt);
      this.fire.update(dt);
    } else if (frame.lmbPressed && !this.ctl.free) {
      this.ctl.buffer = 0.3;   // don't swallow a click during hit-stop
      if (P.bound) this.bind.push(P);
    }

    // fixed-step physics
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 8) {
      for (const k of this.fighters) k.physicsStep(FIXED_DT);
      this.arena.step();
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
    this.replay.record(realDt);
    const liveDt = halted ? 0 : realDt;         // real time, but not while the game stands still
    this.versus.update(liveDt);
    this.perks.update(liveDt);
    this.training.update(liveDt);
    this.tutorial.update(liveDt);
    this.defense.update(dt);
    this.weather.update(realDt);
    // sandbox: after going down the player is patched up and rises again
    const down = P.dead || (P.state === 'ragdoll' && !P.inj.canStand) || this.lost;
    this.playerDownT = down ? this.playerDownT + liveDt : 0;
    if (down && this.isRun && !this.runOver) this.endRun();
    if (!down && this.lost) this.playerDownT = 0;
    if (down && this.playerDownT > 6 && this.isRun) this.resetArena();
    else if (down && this.playerDownT > 6 && this.mode !== 'versus') {
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

    this.updateShadows(realDt);
    this.effects.update(dt);
    this.audio.update(dt, this);
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

/** What an archer or gunner carries in the left hand (the forearm runs along -y, the hand is at its end). */
function rangedProp(kind) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.8 });
  if (kind === 'bow') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.013, 6, 18, Math.PI * 0.86), wood);
    bow.rotation.z = Math.PI + 0.22;
    bow.position.y = 0.1;
    g.add(bow);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.88, 4), new THREE.MeshBasicMaterial({ color: 0xd8d0c0 }));
    string.rotation.z = Math.PI / 2;
    string.position.y = 0.0;
    g.add(string);
  } else {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 1.05, 8), new THREE.MeshStandardMaterial({ color: 0x1c1c20, metalness: 0.8, roughness: 0.4 }));
    barrel.position.y = -0.3;
    g.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.6, 0.07), wood);
    stock.position.set(0, 0.12, 0.02);
    g.add(stock);
  }
  g.position.y = -0.3;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

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
