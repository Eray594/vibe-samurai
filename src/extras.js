// Things around the fight itself: locked blades, the duel opening, perks between waves,
// the replay of a finishing blow and the two-player duel.
import * as THREE from 'three';
import { rand, clamp, dampFactor } from './physics.js';
import { POSES } from './combat.js';
import { PlayerController, PadInput } from './player.js';
import { SKINS } from './roster.js';
import { WEAPON_ORDER } from './weapons.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const el = (id, cls, parent = document.body) => {
  const e = document.createElement('div');
  if (id) e.id = id;
  if (cls) e.className = cls;
  parent.appendChild(e);
  return e;
};

// ------------------------------------------------------------------ blade bind
/** Two cuts meet edge on edge: the blades lock and both push. Hammer LMB to win it. */
export class BladeBind {
  constructor(game) {
    this.game = game;
    this.a = null; this.b = null;        // a is the human (or player 1), b the opponent
    this.meter = 0.5;
    this.t = 0;
    this.cdUntil = 0;
    this.sparkT = 0;
    this.ui = el('bind');
    this.ui.innerHTML = '<span>KLINGENBINDUNG</span><div class="track"><i></i></div><small><kbd>LMB</kbd> hämmern</small>';
    this.fill = this.ui.querySelector('i');
  }

  get active() { return !!this.a; }
  other(k) { return k === this.a ? this.b : k === this.b ? this.a : null; }

  tryStart(A, B, point) {
    const g = this.game;
    if (this.active || g.time < this.cdUntil || g.standoff.active) return false;
    if (!A || !B || A.team === B.team || A.state !== 'active' || B.state !== 'active') return false;
    if (A.attackPhase !== 'strike' || B.attackPhase !== 'strike') return false;
    const humanA = A.isPlayer || A.human, humanB = B.isPlayer || B.human;
    if (!humanA && !humanB) return false;
    if (A.mountH > 0 || B.mountH > 0 || A.airborne || B.airborne) return false;
    if (!humanA) [A, B] = [B, A];
    this.a = A; this.b = B;
    this.meter = 0.5; this.t = 0;
    A.bound = B.bound = true;
    if (B.brain) B.brain.target = A;
    g.callout('KLINGENBINDUNG!', point, 'parry');
    g.audio.deflect();
    g.addHitStop(0.06);
    g.effects.sparksAt(point, 30, 1.4);
    this.ui.classList.add('show');
    return true;
  }

  /** A human pushes (one click). */
  push(k) {
    if (k === this.a) this.meter += 0.085;
    else if (k === this.b) this.meter -= 0.085;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game, A = this.a, B = this.b;
    if (A.state !== 'active' || B.state !== 'active' || A.dead || B.dead || A.disposed || B.disposed || A.brokenT > 0 || B.brokenT > 0) { this.end(null); return; }
    this.t += dt;
    // the machine pushes steadily, harder the better the fighter and the healthier
    if (!(B.isPlayer || B.human)) this.meter -= dt * (0.2 + 0.07 * (B.kind?.rank ?? 2)) * (0.5 + 0.5 * B.inj.vitality);
    this.sparkT -= dt;
    const pa = A.getPos(_a), pb = B.getPos(_b);
    const mid = _a.lerp(pb, 0.5).setY(1.45);
    if (this.sparkT <= 0) { this.sparkT = 0.12; g.effects.sparksAt(mid, 5, 0.7); g.shake = Math.max(g.shake, 0.18); }
    this.fill.style.width = (clamp(this.meter, 0, 1) * 100).toFixed(0) + '%';
    if (this.meter >= 1) this.end(A);
    else if (this.meter <= 0) this.end(B);
    else if (this.t > 3) this.end(this.meter >= 0.5 ? A : B);
  }

  end(winner) {
    const g = this.game, A = this.a, B = this.b;
    this.a = this.b = null;
    this.ui.classList.remove('show');
    this.cdUntil = g.time + 2.5;
    for (const k of [A, B]) if (k) k.bound = false;
    if (!winner) return;
    const loser = winner === A ? B : A;
    const wp = winner.getPos(new THREE.Vector3()), lp = loser.getPos(new THREE.Vector3());
    const away = lp.clone().sub(wp).setY(0).normalize();
    const point = lp.clone().setY(1.4);
    const broke = loser.addPosture(0.5 * loser.postureMax);
    loser.stagger(away.clone().multiplyScalar(2.6), point, 0.3, 0.8);
    if (loser.brain) loser.brain.onParried(); else g.ctl.runner.cancel();
    const w = loser.weapon;
    if (w?.attached) w.body.velocity.set(away.x * 5, 3, away.z * 5);
    const wc = winner.isPlayer ? g.ctl : winner.ctl;
    if (wc) wc.counterT = 0.9;
    g.effects.sparksAt(point, 40, 1.6);
    g.audio.deflect();
    g.addHitStop(0.08);
    g.callout(winner.isPlayer ? 'BINDUNG GEWONNEN!' : loser.isPlayer ? 'BINDUNG VERLOREN!' : 'BINDUNG ENTSCHIEDEN', point, winner.isPlayer ? 'parry' : 'crit');
    if (broke) g.onGuardBroken(loser, point);
  }
}

// ------------------------------------------------------------------ duel opening
/** Both stand with the hand on the hilt. Draw the moment he twitches: too early or too late costs. */
export class Standoff {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.ui = el('standoff');
    this.ui.innerHTML = '<div class="bar top"></div><div class="bar bottom"></div><div class="txt"><b>一騎打ち</b><span>Warte, bis er zuckt – dann <kbd>LMB</kbd></span><small><kbd>RMB</kbd> überspringt</small></div><div class="cue">今</div>';
  }

  start(enemy) {
    const g = this.game, P = g.player;
    if (!enemy || enemy.state !== 'active' || P.state !== 'active' || !P.weapon.attached || enemy.mountH > 0 || enemy.kind?.ranged) return;
    this.active = true;
    this.enemy = enemy;
    this.phase = 'wait';
    this.t = 0;
    this.cueAt = rand(1.8, 4.2);
    this.window = clamp(0.52 - 0.05 * (enemy.kind?.rank ?? 2), 0.27, 0.5);
    g.ctl.lock = enemy;
    this.ui.className = 'show';
  }

  cancel() { if (this.active) this.end(); }

  end() {
    this.active = false;
    this.ui.className = '';
  }

  update(dt, frame) {
    const g = this.game, P = g.player, E = this.enemy, ctl = g.ctl;
    if (!E || E.disposed || E.state !== 'active' || P.state !== 'active') { this.end(); return; }
    this.t += dt;
    // both hold the draw stance, facing each other; only the camera moves
    const pp = P.getPos(_a), ep = E.getPos(_b);
    const yawP = Math.atan2(-(ep.x - pp.x), -(ep.z - pp.z));
    ctl.yaw -= frame.dx * 0.0022 * g.settings.sens;
    ctl.pitch = clamp(ctl.pitch - frame.dy * 0.0022 * g.settings.sens, -0.9, 0.55);
    ctl.faceYaw = yawP;
    for (const [k, runner, yaw] of [[P, ctl.runner, yawP], [E, E.brain.runner, yawP + Math.PI]]) {
      const it = k.intent;
      runner.cancel();
      it.move.set(0, 0, 0); it.yaw = yaw; it.mode = 'guard'; it.power = 1;
      runner.rest(dt, it, POSES.iai, 8);
      k.attackPhase = null; k.atk = null; k.sprinting = false;
    }
    if (frame.rmbPressed) { this.end(); g.callout('KAMPF!', null, 'small'); return; }
    if (this.phase === 'wait') {
      if (frame.lmbPressed) {
        // flinched first: off balance, and he comes straight in
        this.end();
        g.callout('ZU FRÜH!', null, 'crit');
        P.addPosture(0.5 * P.postureMax);
        P.stagger(_a.set(0, 0, 0), P.getHeadPos(_b), 0.2, 0.5);
        E.brain.cooldown = 0;
        return;
      }
      if (this.t >= this.cueAt) {
        this.phase = 'cue';
        this.t = 0;
        this.ui.className = 'show cue';
        g.audio.tick?.();
        g.audio.taiko?.(0.5);
        g.effects.impact(E.weapon.worldPoint(E.weapon.tipLocal, new THREE.Vector3()), 1.2);
      }
    } else if (frame.lmbPressed && this.t <= this.window) {
      // the faster draw: through him in one cut
      this.end();
      ctl.aim = E;
      ctl.startIai(1, 0, 0, false);
      P.iframeT = 0.7;
      g.callout('SCHNELLER GEZOGEN!', null, 'parry');
      g.after(0.13, () => { if (!E.disposed && !E.dead) g.executeFinisher(P, E); });
    } else if (this.t > this.window) {
      // too slow: he draws through you. It does not kill, but it is a bad start.
      this.end();
      const dir = pp.clone().sub(ep).setY(0).normalize();
      E.brain.runner.start('iai', E.weapon.def, { wind: 0.05, power: 1.3 });
      E.core.velocity.x = dir.x * 13; E.core.velocity.z = dir.z * 13;
      E.dashT = 0.3;
      g.after(0.2, () => {
        if (P.state !== 'active' || P.iframeT > 0) return;
        const pt = P.parts.torso.position.clone().add(new THREE.Vector3(0, 0.25, 0));
        const { sev } = P.inj.wound('torso', 0.6, 'cut', 1);
        P.addWound('torso', pt, dir, sev, 'cut');
        P.stagger(dir.clone().multiplyScalar(2), pt, 0.3, 0.7);
        P.addPosture(0.3 * P.postureMax);
        g.effects.blood(pt, dir, 60, 1.3);
        g.audio.slash(); g.audio.hit(0.9, false);
        g.hurtFlash(40); g.shake = 0.8; g.addHitStop(0.08);
      });
      g.callout('ZU LANGSAM!', null, 'crit');
    }
  }
}

// ------------------------------------------------------------------ perks between waves
const PERKS = [
  { name: 'Scharfe Klinge', desc: 'Deine Hiebe schneiden 20 % tiefer', apply: (g) => { g.perk.dmg *= 1.2; } },
  { name: 'Eiserne Haltung', desc: 'Deine Haltung hält 25 % mehr aus', apply: (g) => { g.player.postureMax *= 1.25; } },
  { name: 'Leichtfuß', desc: 'Du bewegst dich 7 % schneller', apply: (g) => { g.player.speedMul *= 1.07; } },
  { name: 'Feldscher', desc: 'Zwei Verbände mehr, und Platz dafür', apply: (g) => { g.ctl.maxHeals += 2; g.ctl.heals = Math.min(g.ctl.maxHeals, g.ctl.heals + 2); } },
  { name: 'Ruhige Hand', desc: 'Das Zeitfenster für die Abwehr ist 30 % länger', apply: (g) => { g.perk.deflect *= 1.3; } },
  { name: 'Kunai-Fächer', desc: 'Jeder Wurf schickt zwei Kunai mehr', apply: (g) => { g.perk.kunai += 2; } },
  { name: 'Wucht', desc: 'Du brichst Haltungen 25 % schneller', apply: (g) => { g.perk.postureDmg *= 1.25; } },
  { name: 'Blutrausch', desc: 'Jeder Besiegte stellt deine Haltung her und stillt die Blutung etwas', apply: (g) => { g.perk.lifesteal = true; } },
  { name: 'Lackrüstung', desc: 'Deine Rüstung lässt weniger durch', apply: (g) => { g.player.inj.armor = Math.min(0.9, g.player.inj.armor + 0.1); } },
];

export class Perks {
  constructor(game) {
    this.game = game;
    this.choosing = false;
    this.offerT = 0;
    this.taken = [];
    this.ui = el('perks');
    this.reset();
  }

  /** Back to a fresh run: nothing taken, the player as his skin made him. */
  reset() {
    const g = this.game;
    const own = (key) => !!g.progress?.has(key);       // bought in the dōjō: part of the base values
    g.perk = { dmg: 1, deflect: 1, kunai: own('kunai') ? 2 : 1, postureDmg: 1, lifesteal: false, iai: own('iai') ? 0.66 : 1 };
    this.taken = [];
    this.picked = [];
    this.close();
    if (g.player) {
      const skin = SKINS[g.skin];
      g.player.postureMax = 1.25 * (own('stand') ? 1.15 : 1);
      g.player.regenMul = own('calm') ? 1.3 : 1;
      g.player.speedMul = skin.speed;
      g.player.inj.armor = skin.prot;
    }
    if (g.ctl) { g.ctl.maxHeals = own('heal') ? 4 : 3; g.ctl.heals = Math.max(g.ctl.heals, Math.min(g.ctl.heals + 1, g.ctl.maxHeals)); }
  }

  offer() {
    const pool = [...PERKS];
    this.options = [];
    const g = this.game, rnd = g.mode === 'daily' ? g.daily.rng(1000 + g.wave) : Math.random;      // the daily offers are the same for everyone
    for (let i = 0; i < 3 && pool.length; i++) this.options.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    this.ui.innerHTML = '<div class="head">Wähle eine Verbesserung <small class="clock"></small></div>' + this.options.map((p, i) =>
      `<div class="card"><kbd>${i + 1}</kbd><b>${p.name}</b><span>${p.desc}</span></div>`).join('');
    this.ui.classList.add('show');
    document.body.classList.add('choosing');          // the controls panel makes room for the cards
    this.choosing = true;
    this.offerT = 14;
    this.tick();
  }

  /** How long there is left to choose, on the offer itself. */
  tick() {
    const el = this.ui.querySelector('.clock'), left = String(Math.max(0, Math.ceil(this.offerT)));
    if (el && el.textContent !== left) { el.textContent = left; el.classList.toggle('low', this.offerT <= 5); }
  }

  pick(i) {
    const p = this.options?.[i];
    if (!this.choosing || !p) return;
    p.apply(this.game);
    this.picked.push(p);
    this.taken.push(p.name);
    this.game.callout(p.name.toUpperCase(), null, 'parry');
    this.game.audio.taiko?.(0.5);
    this.close();
  }

  close() { this.choosing = false; this.ui.classList.remove('show'); document.body.classList.remove('choosing'); }

  /**
   * The base values changed in the middle of a run (something bought in the dōjō, another outfit): work them
   * out again and put this run's upgrades back on top. An offer that is open stays open.
   */
  rebase(gainHeal = false) {
    const g = this.game, picked = this.picked, open = this.choosing, heals = g.ctl?.heals ?? 0;
    this.reset();
    for (const p of picked) p.apply(g);
    this.picked = picked;
    this.taken = picked.map((p) => p.name);
    if (g.ctl) g.ctl.heals = Math.min(g.ctl.maxHeals, heals + (gainHeal ? 1 : 0));      // bandages used stay used
    if (open) { this.choosing = true; this.ui.classList.add('show'); document.body.classList.add('choosing'); }
  }

  update(dt) {
    if (!this.choosing) return;
    this.offerT -= dt;
    this.tick();
    if (this.offerT <= 0) this.pick(0);          // undecided: the first one, rather than none at all
  }
}

// ------------------------------------------------------------------ the last blow once more, as a film would show it
const REPLAY_KEEP = 3.4;
const _ca = new THREE.Vector3(), _cb = new THREE.Vector3(), _cl = new THREE.Vector3();
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Keeps the last seconds of every visible transform. After the blow that ends a fight the simulation stands
 * still and those seconds are shown again: played back smoothly between the recorded frames (so slow motion does
 * not stutter), slowing right down into the blow and easing out of it, from two camera set-ups with a cut on the
 * blow itself — a profile shot that travels in with the attacker, then low and close on the one who falls.
 */
export class Replay {
  constructor(game) {
    this.game = game;
    this.frames = [];
    this.active = false;
    this.enabled = true;
    this.pendingT = 0;
    this.focus = null;
    this.clockT = 0;
    this.lastAt = -99;
    this.ui = el('replay');
    this.ui.innerHTML = 'WIEDERHOLUNG <small>Klick überspringt</small>';
    this.look = new THREE.Vector3();
  }

  objects() {
    const g = this.game, list = [];
    for (const k of g.fighters) {
      for (const n in k.parts) list.push(k.parts[n]);
      if (k.weapon) list.push(k.weapon.mesh);
      if (k.horse) list.push(k.horse.mesh);
      if (k.frozen) for (const m of k.frozen) list.push(m);
    }
    for (const l of g.limbs) for (const n in l.meshes) list.push(l.meshes[n]);
    for (const w of g.kunais) list.push(w.mesh);
    return list;
  }

  record(dt) {
    if (!this.enabled) { if (this.frames.length) this.frames = []; this.pendingT = 0; return; }      // switched off: nothing to keep
    this.clockT += dt;
    const objs = this.objects();
    const data = new Float32Array(objs.length * 8);
    for (let i = 0, j = 0; i < objs.length; i++, j += 8) {
      const o = objs[i], p = o.position, q = o.quaternion;
      data[j] = p.x; data[j + 1] = p.y; data[j + 2] = p.z; data[j + 3] = q.x; data[j + 4] = q.y; data[j + 5] = q.z; data[j + 6] = q.w; data[j + 7] = o.visible ? 1 : 0;
    }
    this.frames.push({ t: this.clockT, objs, data });
    while (this.frames.length && this.clockT - this.frames[0].t > REPLAY_KEEP) this.frames.shift();
    if (this.pendingT > 0) {
      this.pendingT -= dt;
      if (this.pendingT <= 0) this.begin();
    }
  }

  /** Ask for the blow that just felled `fighter` (struck by `attacker`) to be shown again, once its aftermath is on record too. */
  trigger(fighter, attacker = this.game.player) {
    if (!this.enabled || this.active || this.pendingT > 0 || this.game.mode === 'training' || this.clockT - this.lastAt < 6) return;
    this.focus = fighter;
    this.hit = { t: this.clockT, v: fighter.parts.torso.position.clone(), a: (attacker || this.game.player).parts.torso.position.clone() };
    this.pendingT = 1.15;
  }

  begin() {
    const g = this.game, F = this.frames, H = this.hit;
    if (F.length < 20 || !this.focus || this.focus.disposed || !H) return;
    this.active = true;
    this.lastAt = this.clockT;
    this.t0 = Math.max(F[0].t, H.t - 1.0);
    this.t1 = Math.min(F[F.length - 1].t, H.t + 1.25);
    this.playT = this.t0;
    this.cursor = 0;
    this.struck = false;
    this.all = new Map();
    for (const f of F) for (const o of f.objs) if (!this.all.has(o)) this.all.set(o, o.visible);
    // ---- the two set-ups, from where attacker and victim stood at the blow
    const dir = _ca.copy(H.v).sub(H.a).setY(0);
    if (dir.lengthSq() < 0.04) dir.set(0, 0, -1);
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x), mid = H.a.clone().lerp(H.v, 0.5);
    if (side.dot(_cb.copy(g.camera.position).sub(mid)) < 0) side.negate();       // (on the side the player was watching from)
    const at = (base, f, s, y) => this.inYard(new THREE.Vector3(base.x + dir.x * f + side.x * s, y, base.z + dir.z * f + side.z * s));
    this.shots = [
      { from: at(mid, -1.2, 6.2, 1.2), to: at(mid, 0.4, 5.0, 1.0), lookFrom: H.a.clone().lerp(H.v, 0.35).setY(0.95), lookTo: H.v.clone().setY(0.9), fov: [40, 36], roll: 0 },
      { from: at(H.v, 3.6, 1.9, 0.45), to: at(H.v, 2.9, 3.0, 0.8), lookFrom: H.v.clone().setY(0.85), lookTo: null, fov: [38, 42], roll: (Math.random() < 0.5 ? -1 : 1) * 0.045 },
    ];
    this.look.copy(this.shots[0].lookFrom);
    this.fov0 = g.camera.fov;
    this.ui.classList.add('show');
    document.body.classList.add('cine');
    g.ui.death.classList.remove('show');
    g.audio.whooshBurst?.(0.5);
  }

  /** A camera position kept inside the yard (and off the ground). */
  inYard(p) {
    const r = Math.hypot(p.x, p.z), max = 13.3;
    if (r > max) { p.x *= max / r; p.z *= max / r; }
    for (const [ox, oz, or] of this.game.arena.obstacles) { const dx = p.x - ox, dz = p.z - oz, d = Math.hypot(dx, dz); if (d < or + 0.3 && d > 1e-4 && p.y < 3) { p.x = ox + dx / d * (or + 0.3); p.z = oz + dz / d * (or + 0.3); } }
    p.y = Math.max(0.35, p.y);
    return p;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    for (const [o, vis] of this.all) o.visible = vis;
    this.all = null;
    this.frames = [];
    this.ui.classList.remove('show');
    document.body.classList.remove('cine');
    const cam = this.game.camera;
    cam.fov = this.fov0 || 62; cam.updateProjectionMatrix();
  }

  /** How fast the film runs, by how far it is from the blow (seconds of recorded time; negative: before it). */
  speedAt(d) {
    if (d < -0.32) return 0.9;
    if (d < 0) return 0.9 + (0.13 - 0.9) * ease((d + 0.32) / 0.32);
    if (d < 0.2) return 0.13;
    return 0.13 + (0.6 - 0.13) * ease((d - 0.2) / 0.5);
  }

  update(dt, frame) {
    const g = this.game, F = this.frames, H = this.hit;
    const sp = this.speedAt(this.playT - H.t);
    this.playT += dt * sp;
    if (this.playT >= this.t1 || frame.lmbPressed || frame.rmbPressed || frame.pressed.has('Space') || frame.pressed.has('Escape')) { this.stop(); return; }
    // ---- the picture: between the two recorded frames around this moment
    while (this.cursor < F.length - 2 && F[this.cursor + 1].t <= this.playT) this.cursor++;
    const f0 = F[this.cursor], f1 = F[Math.min(F.length - 1, this.cursor + 1)];
    const same = f1.objs.length === f0.objs.length && f1.objs[0] === f0.objs[0] && f1.objs[f1.objs.length - 1] === f0.objs[f0.objs.length - 1];
    const a = same && f1.t > f0.t ? Math.min(1, Math.max(0, (this.playT - f0.t) / (f1.t - f0.t))) : 0;
    const seen = new Set(f0.objs);
    for (const o of this.all.keys()) if (!seen.has(o)) o.visible = false;
    const d0 = f0.data, d1 = f1.data;
    for (let i = 0, j = 0; i < f0.objs.length; i++, j += 8) {
      const o = f0.objs[i];
      o.visible = d0[j + 7] > 0.5;
      if (a > 0) {
        o.position.set(d0[j] + (d1[j] - d0[j]) * a, d0[j + 1] + (d1[j + 1] - d0[j + 1]) * a, d0[j + 2] + (d1[j + 2] - d0[j + 2]) * a);
        // (the short way round, then back to unit length: plenty between two frames a sixtieth apart)
        const s = d0[j + 3] * d1[j + 3] + d0[j + 4] * d1[j + 4] + d0[j + 5] * d1[j + 5] + d0[j + 6] * d1[j + 6] < 0 ? -a : a, k = 1 - a;
        o.quaternion.set(d0[j + 3] * k + d1[j + 3] * s, d0[j + 4] * k + d1[j + 4] * s, d0[j + 5] * k + d1[j + 5] * s, d0[j + 6] * k + d1[j + 6] * s).normalize();
      } else { o.position.set(d0[j], d0[j + 1], d0[j + 2]); o.quaternion.set(d0[j + 3], d0[j + 4], d0[j + 5], d0[j + 6]); }
    }
    // ---- the blow itself: it bleeds again, and it is heard again
    if (!this.struck && this.playT >= H.t) {
      this.struck = true;
      const dir = _ca.copy(H.v).sub(H.a).setY(0.2).normalize();
      g.effects.blood(_cb.copy(H.v).setY(H.v.y + 0.2), dir, 110, 1.5);
      g.effects.impact(_cb, 1.4);
      g.audio.hit?.(1.2, false); g.audio.slash?.(); g.audio.taiko?.(0.7);
    }
    // ---- the camera: the profile shot until the blow, then the cut to low and close
    const second = this.playT >= H.t + 0.05, S = this.shots[second ? 1 : 0];
    const u = second ? ease((this.playT - H.t - 0.05) / Math.max(0.2, this.t1 - H.t - 0.05)) : ease((this.playT - this.t0) / Math.max(0.2, H.t + 0.05 - this.t0));
    const cam = g.camera, w = this.clockT + this.playT;
    cam.position.lerpVectors(S.from, S.to, u);
    cam.position.x += Math.sin(w * 1.7) * 0.012; cam.position.y += Math.sin(w * 2.3 + 1) * 0.01;      // (held by a hand, not bolted down)
    const want = S.lookTo ? _cl.lerpVectors(S.lookFrom, S.lookTo, u) : _cl.copy(this.focus.parts.torso.position).setY(Math.max(0.45, this.focus.parts.torso.position.y - 0.2));
    if (second !== this.wasSecond) { this.wasSecond = second; this.look.copy(S.lookTo ? want : S.lookFrom); }      // a cut is a cut: no swing from one to the other
    this.look.lerp(want, 1 - Math.exp(-dt * 5));
    cam.lookAt(this.look);
    if (S.roll) cam.rotateZ(S.roll * (1 - u * 0.5));
    cam.fov = S.fov[0] + (S.fov[1] - S.fov[0]) * u; cam.updateProjectionMatrix();
    g.effects.update(dt * Math.max(sp, 0.2));
  }
}

// ------------------------------------------------------------------ two players, one screen
/** Player 2 on a gamepad (or the arrow keys) against player 1, seen from the side. */
export class Versus {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.pad = new PadInput(game.input);
    this.p2 = null;
    this.ctl2 = null;
    this.score = [0, 0];
    this.overT = 0;
    this.side = 1;
    this.camPos = new THREE.Vector3(0, 2.4, 9);
    this.camLook = new THREE.Vector3(0, 1.1, 0);
  }

  /** Called when the yard is (re)set while the mode is on: put player 2 in. */
  spawn() {
    const g = this.game;
    this.active = true;
    this.overT = 0;
    const skin = SKINS.samurai;
    const k = new g.SamuraiClass(g, {
      team: 1, human: true, name: 'Spieler 2', style: skin, position: new THREE.Vector3(0, 0, -3), yaw: Math.PI,
      weapon: this.weapon2 || 'katana', armor: skin.prot, speedMul: skin.speed, posture: 1.25,
    });
    k.dodge = g.dodgeFor(skin);
    const ctl = this.ctl2 = new PlayerController(g, k, this.pad);
    ctl.fixedYaw = true;
    ctl.faceYaw = Math.PI;
    k.ctl = ctl;
    // what the rest of the game expects of an opponent's mind
    k.brain = {
      runner: ctl.runner, tele: null, target: g.player, aggr: 1, blockSkill: 0, cooldown: 0, fearT: 0,
      get attacking() { return ctl.runner.threatening; },
      update: (dt) => {
        const frame = this.pad.consume();
        if (k.state !== 'active') { ctl.lookOnly(frame); k.atk = null; return; }
        for (const [code, step] of [['WeaponPrev', -1], ['WeaponNext', 1]]) {
          if (!frame.pressed.has(code)) continue;
          const i = (WEAPON_ORDER.indexOf(k.weapon.def.key) + step + WEAPON_ORDER.length) % WEAPON_ORDER.length;
          this.weapon2 = WEAPON_ORDER[i];
          k.setWeapon(this.weapon2);
          ctl.runner.cancel();
        }
        ctl.lock = g.player.state === 'active' ? g.player : null;
        ctl.update(dt, frame);
      },
      onParried: () => { ctl.runner.cancel(); ctl.buffer = 0; },
      onHit: (sev) => { if (sev > 0.2 && ctl.runner.phase === 'wind') ctl.runner.cancel(); },
    };
    g.npcs.push(k);
    this.p2 = k;
    g.ctl.fixedYaw = true;
    g.ctl.lock = k;
    return k;
  }

  stop() {
    this.active = false;
    this.p2 = null; this.ctl2 = null;
    this.game.ctl.fixedYaw = false;
    this.score = [0, 0];
  }

  update(realDt) {
    const g = this.game, P = g.player, Q = this.p2;
    if (!this.active || !Q) return;
    if (P.state === 'active' && Q.state === 'active' && !Q.disposed) g.ctl.lock = Q;
    const down1 = P.dead || (P.state === 'ragdoll' && !P.inj.canStand);
    const down2 = Q.dead || Q.counted;
    if ((down1 || down2) && this.overT <= 0) {
      this.overT = 4;
      if (down1 && !down2) this.score[1]++; else if (down2 && !down1) this.score[0]++;
      g.callout(down1 && down2 ? 'UNENTSCHIEDEN' : down1 ? 'SPIELER 2 SIEGT' : 'SPIELER 1 SIEGT', null, 'crit');
      g.audio.taiko?.(1);
    } else if (this.overT > 0) {
      this.overT -= realDt;
      if (this.overT <= 0) { const s = this.score; g.resetArena(); this.score = s; }
    }
  }

  /** Side-on camera that keeps both in frame; both players steer relative to it. */
  camera(dt) {
    const g = this.game, P = g.player, Q = this.p2;
    const a = P.getPos(_a).clone(), b = Q && !Q.disposed ? Q.getPos(_b).clone() : a.clone();
    const mid = a.clone().lerp(b, 0.5);
    const sep = Math.hypot(b.x - a.x, b.z - a.z);
    let ax = b.x - a.x, az = b.z - a.z;
    const l = Math.hypot(ax, az);
    if (l > 0.5) { ax /= l; az /= l; } else { ax = 0; az = -1; }
    let px = -az * this.side, pz = ax * this.side;
    // stay on the side the camera is already on
    const cx = this.camPos.x - mid.x, cz = this.camPos.z - mid.z;
    if (px * cx + pz * cz < 0) { this.side *= -1; px = -px; pz = -pz; }
    const dist = 4.6 + sep * 0.78;
    const want = _a.set(mid.x + px * dist, 2.3 + sep * 0.12, mid.z + pz * dist);
    const r = Math.hypot(want.x, want.z);
    if (r > 14) { want.x *= 14 / r; want.z *= 14 / r; }
    this.camPos.lerp(want, dampFactor(3.5, dt));
    this.camLook.lerp(_b.set(mid.x, 1.15, mid.z), dampFactor(6, dt));
    g.camera.position.copy(this.camPos);
    if (g.shake > 0) {
      const s = g.shake * g.shake * 0.12;
      g.camera.position.x += rand(-s, s); g.camera.position.y += rand(-s, s);
      g.shake = Math.max(0, g.shake - dt * 2.8);
    }
    g.camera.lookAt(this.camLook);
    const fx = this.camLook.x - this.camPos.x, fz = this.camLook.z - this.camPos.z;
    const yaw = Math.atan2(-fx, -fz);
    g.ctl.yaw = yaw;
    if (this.ctl2) this.ctl2.yaw = yaw;
  }
}
