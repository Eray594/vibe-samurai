// Things to play for beyond the next fight: achievements, the daily challenge and the guided first round.
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { WEATHER_ORDER } from './world.js';
import { randomType } from './roster.js';

const load = (key, def) => { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* no storage: lasts for this visit only */ } };

// ------------------------------------------------------------------ difficulty
export const DIFFS = {
  easy: { key: 'easy', name: 'Leicht', dmg: 0.6, tokens: -1, honor: 0.7 },
  normal: { key: 'normal', name: 'Normal', dmg: 1, tokens: 0, honor: 1 },
  hard: { key: 'hard', name: 'Schwer', dmg: 1.5, tokens: 1, honor: 1.5 },
};

// ------------------------------------------------------------------ achievements
/** `stat` counts up (add) or keeps the best value (best); reaching `need` earns the honour once. */
export const GOALS = [
  { key: 'kill1', name: 'Erstes Blut', desc: 'Besiege einen Gegner', stat: 'kills', need: 1, honor: 20 },
  { key: 'kill100', name: 'Hundert Klingen', desc: 'Besiege 100 Gegner', stat: 'kills', need: 100, honor: 150 },
  { key: 'deflect1', name: 'Abwehr', desc: 'Wehre einen Hieb im letzten Moment ab', stat: 'deflects', need: 1, honor: 20 },
  { key: 'deflect25', name: 'Mauer aus Stahl', desc: 'Wehre 25 Hiebe ab', stat: 'deflects', need: 25, honor: 80 },
  { key: 'death1', name: 'Todesstoß', desc: 'Setze einen Todesstoß', stat: 'deathblows', need: 1, honor: 20 },
  { key: 'death25', name: 'Henker', desc: 'Setze 25 Todesstöße', stat: 'deathblows', need: 25, honor: 120 },
  { key: 'perfect', name: 'Wie Wasser', desc: 'Weiche im letzten Moment aus', stat: 'perfects', need: 1, honor: 30 },
  { key: 'stomp', name: 'Fußarbeit', desc: 'Tritt eine Klinge nieder', stat: 'stomps', need: 1, honor: 40 },
  { key: 'plunge', name: 'Fallender Stern', desc: 'Triff mit einem Sturzangriff', stat: 'plunges', need: 1, honor: 40 },
  { key: 'tech', name: 'Stehaufmann', desc: 'Rolle dich nach einem Sturz ab', stat: 'techs', need: 1, honor: 30 },
  { key: 'arrow', name: 'Pfeilfänger', desc: 'Schlage einen Pfeil aus der Luft', stat: 'arrows', need: 1, honor: 50 },
  { key: 'sweep', name: 'Über den Besen', desc: 'Springe über einen Feger', stat: 'sweeps', need: 1, honor: 30 },
  { key: 'wave5', name: 'Standhaft', desc: 'Erreiche Welle 5 im Überleben', stat: 'wave', need: 5, honor: 60 },
  { key: 'wave10', name: 'Unbeugsam', desc: 'Erreiche Welle 10 im Überleben', stat: 'wave', need: 10, honor: 150 },
  { key: 'def5', name: 'Hüter', desc: 'Wehre 5 Wellen in der Verteidigung ab', stat: 'defWave', need: 5, honor: 80 },
  { key: 'def10', name: 'Unbezwingbar', desc: 'Wehre 10 Wellen in der Verteidigung ab', stat: 'defWave', need: 10, honor: 200 },
  { key: 'hire5', name: 'Feldherr', desc: 'Heuere 5 Soldaten an', stat: 'hired', need: 5, honor: 40 },
  { key: 'trap10', name: 'Fallensteller', desc: 'Erwische 10 Gegner mit Fallen', stat: 'trapHits', need: 10, honor: 50 },
  { key: 'boss', name: 'Anführer gefällt', desc: 'Besiege einen Anführer', stat: 'boss', need: 1, honor: 100 },
  { key: 'daily', name: 'Tagwerk', desc: 'Erreiche Welle 3 in der Tagesaufgabe', stat: 'daily', need: 3, honor: 60 },
  { key: 'fall', name: 'Tiefer Fall', desc: 'Stoße einen Gegner in den Abgrund', stat: 'falls', need: 1, honor: 50 },
  { key: 'bell', name: 'Glockenschlag', desc: 'Bringe Gegner mit der Tempelglocke ins Wanken', stat: 'bell', need: 1, honor: 40 },
  { key: 'smoke', name: 'Im Rauch verschwunden', desc: 'Zünde eine Rauchbombe', stat: 'smokes', need: 1, honor: 20 },
  { key: 'tutor', name: 'Schüler', desc: 'Schließe die Einführung ab', stat: 'tutorial', need: 1, honor: 30 },
];
/** What the player is told on screen says what he just did. */
const CALLOUT_STAT = {
  'ABGEWEHRT!': 'deflects', 'TODESSTOSS!': 'deathblows', 'PERFEKT AUSGEWICHEN!': 'perfects', 'KLINGE NIEDERGETRETEN!': 'stomps',
  'STURZANGRIFF!': 'plunges', 'ABGEROLLT!': 'techs', 'PFEIL ZERSCHLAGEN!': 'arrows', 'ÜBERSPRUNGEN!': 'sweeps',
};

export class Achievements {
  constructor(game) {
    this.game = game;
    const s = load('vibesamurai.goals', { done: [], stats: {} });
    this.done = new Set(s.done); this.stats = { ...s.stats };
  }
  get counts() { return !['training', 'versus'].includes(this.game.mode); }
  store() { save('vibesamurai.goals', { done: [...this.done], stats: this.stats }); }
  add(stat, n = 1) { if (!this.counts) return; this.stats[stat] = (this.stats[stat] || 0) + n; this.check(stat); }
  best(stat, v) { if (!this.counts || v <= (this.stats[stat] || 0)) return; this.stats[stat] = v; this.check(stat); }
  said(text) { const s = CALLOUT_STAT[text]; if (s) this.add(s); }
  check(stat) {
    const g = this.game;
    for (const goal of GOALS) {
      if (goal.stat !== stat || this.done.has(goal.key) || (this.stats[stat] || 0) < goal.need) continue;
      this.done.add(goal.key);
      g.after?.(0.9, () => { g.callout(`ERFOLG: ${goal.name.toUpperCase()} · +${goal.honor} EHRE`, null, 'parry'); g.audio.tick?.(); });
      g.progress.earn(goal.honor, true);
    }
    this.store();
  }
  wipe() { this.done.clear(); this.stats = {}; this.store(); }
  html() {
    return GOALS.map((goal) => {
      const have = Math.min(goal.need, this.stats[goal.stat] || 0), ok = this.done.has(goal.key);
      return `<div class="goal${ok ? ' done' : ''}"><b>${goal.name}</b><span>${goal.desc}</span><em>${ok ? '✓' : goal.need > 1 ? `${have} / ${goal.need}` : ''} · ${goal.honor} Ehre</em></div>`;
    }).join('');
  }
}

// ------------------------------------------------------------------ the daily challenge
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** One fixed survival run per calendar day: the same weapon, weather, waves and perk offers for everyone. */
export class Daily {
  constructor(game, date = dateKey()) {
    this.game = game;
    this.setDate(date, false);
  }
  /** `fixed`: this day and no other (tests); otherwise the day follows the calendar, see `today`. */
  setDate(date, fixed = true) {
    this.fixed = fixed;
    this.date = date;
    this.seed = Number(date.replaceAll('-', ''));
    const r = this.rng(0);
    this.weapon = WEAPON_ORDER[Math.floor(r() * WEAPON_ORDER.length)];
    this.weather = WEATHER_ORDER[Math.floor(r() * WEATHER_ORDER.length)];
  }
  /** A page left open over midnight: the challenge is the one of the day that has begun. */
  today() { if (!this.fixed && dateKey() !== this.date) this.setDate(dateKey(), false); }
  /** A fresh, repeatable stream for one purpose (a wave, a perk offer). */
  rng(salt) { return mulberry32(this.seed * 131 + salt * 7919 + 17); }
  /** The i-th opponent of a wave. */
  typeFor(wave, i) {
    const r = this.rng(wave);
    let t = 'ashigaru';
    for (let j = 0; j <= i; j++) t = randomType(Math.min(1, wave * 0.1), r);
    return t;
  }
  get label() { const [, m, d] = this.date.split('-'); return `${d}.${m}. · ${WEAPONS[this.weapon].name} · ${this.game.weather.nameOf(this.weather)}`; }
  get record() { const r = load('vibesamurai.daily', {}); return r.date === this.date ? r : null; }
  /** Called by the yard reset when the daily run starts. */
  begin() {
    const g = this.game;
    this.today();
    if (g.weather.key !== this.weather) g.weather.set(this.weather);
    if (g.ui?.weather) g.ui.weather.textContent = g.weather.name;
    if (g.player.weapon.def.key !== this.weapon || !g.player.weapon.attached) { g.player.setWeapon(this.weapon); g.arena.showRack(this.weapon); }
    document.querySelectorAll('#weapon-buttons button').forEach((b) => b.classList.toggle('active', b.dataset.weapon === this.weapon));
  }
}

// ------------------------------------------------------------------ the guided first round
const STEPS = [
  { key: 'move', drill: 'passive', name: 'Bewegen', how: 'Laufe mit <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> ein paar Schritte, die <kbd>Maus</kbd> dreht den Blick', touch: 'Laufe mit dem linken Stick ein paar Schritte, rechts wischen dreht den Blick', need: 5 },
  { key: 'lock', drill: 'passive', name: 'Ziel erfassen', how: 'Erfasse den Übungspartner mit <kbd>Tab</kbd> – der Blick bleibt dann auf ihm', touch: 'Erfasse den Übungspartner mit dem Knopf <b>Ziel</b>', need: 1 },
  { key: 'cut', drill: 'passive', name: 'Zuschlagen', how: 'Schlage dreimal zu: <kbd>LMB</kbd> – mehrfach klicken ergibt eine Kombo', touch: 'Schlage dreimal zu: Knopf <b>Hieb</b>', need: 3 },
  { key: 'block', drill: 'cut', name: 'Blocken', how: 'Jetzt greift er an. Halte <kbd>RMB</kbd> und fange zwei Hiebe mit der Deckung ab', touch: 'Jetzt greift er an. Halte den Knopf <b>Deckung</b> und fange zwei Hiebe ab', need: 2 },
  { key: 'deflect', drill: 'cut', name: 'Abwehr', how: 'Hebe die Deckung erst <b>im letzten Moment</b> (<kbd>RMB</kbd>): das ist eine Abwehr und bricht seine Haltung', touch: 'Drücke <b>Deckung</b> erst im letzten Moment: das ist eine Abwehr und bricht seine Haltung', need: 1 },
  { key: 'finish', drill: 'passive', name: 'Todesstoß', how: 'Schlage auf ihn ein, bis seine Haltung bricht – dann <kbd>LMB</kbd> für den Todesstoß', touch: 'Schlage auf ihn ein, bis seine Haltung bricht – dann <b>Hieb</b> für den Todesstoß', need: 1 },
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.i = 0; this.count = 0; this.doneT = 0; this.finished = false;
    const el = this.el = document.createElement('div');
    el.id = 'tutor';
    el.className = 'drillbox';
    document.body.appendChild(el);
  }
  get active() { return this.game.mode === 'tutorial'; }
  get step() { return STEPS[this.i]; }
  /** What the partner does (read by the opponent's Brain like a training drill). */
  get drill() { return this.active && !this.finished ? this.step.drill : null; }
  get seen() { return load('vibesamurai.tutorial', { done: false }).done; }

  show() {
    const s = this.step, touch = this.game.touch?.active;
    this.el.innerHTML = this.finished
      ? '<small>EINFÜHRUNG</small><b>Geschafft!</b><span>Du kennst jetzt das Wichtigste. Gleich geht es zurück ins Hauptmenü.</span>'
      : `<small>EINFÜHRUNG · Schritt ${this.i + 1} / ${STEPS.length}</small><b>${s.name}</b><span>${touch ? s.touch : s.how}</span>`
        + (s.need > 1 ? `<i>${Math.min(s.need, Math.floor(this.count))} / ${s.need}</i>` : '');
    this.el.classList.toggle('show', this.active);
  }

  /** Start over (called by the yard reset). */
  begin() {
    this.i = 0; this.count = 0; this.doneT = 0; this.finished = false; this.last = null;
    this.spawn();
  }

  spawn() {
    const g = this.game;
    for (const e of [...g.npcs]) g.removeNpc(e);
    const k = g.spawnFighter(1, 'ronin', g.player.getPos().clone().set(0, 0, -1.5));
    if (k.weapon.def.key !== 'katana') k.setWeapon('katana');
    k.name = 'Übungspartner';
    this.partner = k;
    this.tune();
    this.show();
  }
  /** The partner is hard to shake while you learn to hit, and gives way quickly once it is about the finishing blow. */
  tune() {
    const k = this.partner;
    if (!k) return;
    k.postureMax = this.step.key === 'finish' ? 0.5 : 6;
    k.posture = 0;
  }

  /** Something the lesson is waiting for happened. */
  event(kind, n = 1) {
    if (!this.active || this.finished || this.step.key !== kind) return;
    const before = Math.floor(this.count);
    this.count += n;
    if (this.count >= this.step.need) this.advance(); else if (Math.floor(this.count) !== before) this.show();
  }

  advance() {
    const g = this.game;
    g.audio.tick?.();
    this.count = 0;
    if (this.i < STEPS.length - 1) {
      this.i++;
      g.callout(this.step.name.toUpperCase(), null, 'parry');
      if (!this.partner || this.partner.dead || this.partner.counted || this.partner.disposed) this.spawn(); else this.tune();
      this.show();
      return;
    }
    this.finished = true;
    this.doneT = 4;
    save('vibesamurai.tutorial', { done: true });
    g.callout('EINFÜHRUNG GESCHAFFT', null, 'parry');
    g.ach.add('tutorial');
    g.front?.refresh();
    this.show();
  }

  update(dt) {
    if (!this.active) { if (this.el.classList.contains('show')) this.el.classList.remove('show'); return; }
    const g = this.game, P = g.player;
    if (this.finished) {
      this.doneT -= dt;
      if (this.doneT <= 0 && !g.mainMenu) g.openMainMenu();
      return;
    }
    // nobody stays hurt here, and there is always a partner
    if (P.state === 'active' && P.inj.status().length) { this.healT = (this.healT || 0) + dt; if (this.healT > 3) { P.inj.treat(); P.clearWounds(); this.healT = 0; } }
    if (!g.livingEnemies.length) { this.respawnT = (this.respawnT || 0) + dt; if (this.respawnT > 1.2) { this.respawnT = 0; this.spawn(); } }
    const s = this.step.key;
    if (s === 'move' && P.state === 'active') {
      const p = P.getPos();
      if (this.last) this.event('move', Math.min(0.5, Math.hypot(p.x - this.last.x, p.z - this.last.z)));
      this.last = p;
    } else if (s === 'lock' && g.ctl.lock) this.event('lock');
  }
}
