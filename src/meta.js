// What frames the fighting: settings, lasting progress (honour) and the training drills.
import { SKINS, SKIN_ORDER } from './roster.js';
import { GOALS } from './goals.js';

const load = (key, def) => { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* no storage: lasts for this visit only */ } };

// ------------------------------------------------------------------ settings
export class Settings {
  constructor(game) {
    this.game = game;
    Object.assign(this, load('vibesamurai.settings', { sens: 1, volume: 1, blood: true, standoff: true, replay: true, aimCuts: true, sideGuard: true, diff: 'normal', lang: 'de', map: 'yard', help: true }));
  }
  set(key, value) {
    this[key] = value;
    save('vibesamurai.settings', { sens: this.sens, volume: this.volume, blood: this.blood, standoff: this.standoff, replay: this.replay, aimCuts: this.aimCuts, sideGuard: this.sideGuard, diff: this.diff, lang: this.lang, map: this.map, help: this.help });
    this.apply();
  }
  apply() {
    const g = this.game;
    g.audio.setVolume(this.volume);
    g.effects.noBlood = !this.blood;
    if (g.replay) g.replay.enabled = this.replay;
  }
}

// ------------------------------------------------------------------ honour & what it buys
// Two more outfits; everything that was in the yard before stays free.
Object.assign(SKINS, {
  geist: {
    key: 'geist', name: 'Weißer Geist', desc: 'Bleich und lautlos – sehr schnell, ungeschützt', locked: true,
    cloth: 0xdad8d2, hakama: 0xc8c6c0, lace: 0x8a8a8a, head: 'hood', prot: 0.08, speed: 1.15, kote: false,
  },
  shogun: {
    key: 'shogun', name: 'Goldener Daimyō', desc: 'Vergoldete Rüstung – hält am meisten aus', locked: true,
    cloth: 0x2a1030, hakama: 0x140a18, armor: 0xb08a2a, lace: 0x4a1060, trim: 0xe8c860,
    head: 'kabuto', crest: 'kuwagata', menpo: 0x101010, sode: true, suneate: true, prot: 0.78, speed: 0.92,
  },
});
SKIN_ORDER.push('geist', 'shogun');

export const SHOP = [
  { key: 'heal', name: 'Vierter Verband', desc: 'Du beginnst mit vier Verbänden', cost: 300 },
  { key: 'kunai', name: 'Zweites Kunai', desc: 'Jeder Wurf schickt ein Kunai mehr', cost: 350 },
  { key: 'stand', name: 'Eiserner Stand', desc: 'Deine Haltung hält 15 % mehr aus', cost: 400 },
  { key: 'iai', name: 'Meisterhand', desc: 'Iai lädt ein Drittel schneller', cost: 400 },
  { key: 'geist', name: 'Skin: Weißer Geist', desc: SKINS.geist.desc, cost: 450, skin: 'geist' },
  { key: 'calm', name: 'Ruhiger Atem', desc: 'Deine Haltung erholt sich 30 % schneller', cost: 500 },
  { key: 'shogun', name: 'Skin: Goldener Daimyō', desc: SKINS.shogun.desc, cost: 600, skin: 'shogun' },
];
const RANKS = [[0, 'Ashigaru'], [200, 'Rōnin'], [600, 'Samurai'], [1400, 'Hatamoto'], [3000, 'Daimyō'], [6000, 'Shōgun']];

export class Progress {
  constructor(game) {
    this.game = game;
    const s = load('vibesamurai.save', { honor: 0, total: 0, owned: [] });
    this.honor = s.honor; this.total = s.total; this.owned = new Set(s.owned);
  }
  get rank() { let r = RANKS[0][1]; for (const [need, name] of RANKS) if (this.total >= need) r = name; return r; }
  has(key) { return this.owned.has(key); }
  store() { save('vibesamurai.save', { honor: this.honor, total: this.total, owned: [...this.owned] }); }

  /** Honour for a deed. Nothing is earned in training or against a friend. */
  earn(n, exact = false) {
    const g = this.game;
    if (n <= 0 || g.mode === 'training' || g.mode === 'versus' || g.mode === 'tutorial') { if (!exact || n <= 0) return; }
    if (!exact) n = Math.max(1, Math.round(n * g.diff.honor));
    const before = this.rank;
    this.honor += n; this.total += n;
    this.store();
    if (this.rank !== before) { g.callout(`NEUER RANG: ${this.rank.toUpperCase()}`, null, 'parry'); g.audio.taiko?.(0.8); }
    g.menu?.refresh();
  }

  buy(key) {
    const it = SHOP.find((s) => s.key === key);
    if (!it || this.has(key) || this.honor < it.cost) return false;
    this.honor -= it.cost;
    this.owned.add(key);
    this.store();
    this.game.perks.rebase(key === 'heal');      // base values include what is owned; the run keeps its upgrades
    this.game.audio.taiko?.(0.6);
    return true;
  }

  wipe() {
    this.honor = 0; this.total = 0; this.owned.clear();
    this.store();
    this.game.ach?.wipe();
    if (SKINS[this.game.skin]?.locked) this.game.setPlayerSkin('ronin');
    this.game.perks.reset();
  }
}

// ------------------------------------------------------------------ the menu (settings + dōjō shop)
export class Menu {
  constructor(game) {
    this.game = game;
    const el = this.el = document.createElement('div');
    el.id = 'menu';
    el.innerHTML = `
      <div class="card">
        <h2>Einstellungen</h2>
        <label>Mausempfindlichkeit <input type="range" id="set-sens" min="0.3" max="2.5" step="0.05"><b id="set-sens-v"></b></label>
        <label>Lautstärke <input type="range" id="set-volume" min="0" max="1" step="0.05"><b id="set-volume-v"></b></label>
        <label class="chk"><input type="checkbox" id="set-blood"> Blut und Blutlachen</label>
        <label class="chk"><input type="checkbox" id="set-standoff"> Duell-Eröffnung (ziehen, wenn der Gegner zuckt)</label>
        <label class="chk"><input type="checkbox" id="set-replay"> Wiederholung des Todesstoßes</label>
        <label class="chk"><input type="checkbox" id="set-aimCuts"> Hiebrichtung per Mausbewegung (Maus kurz ziehen, dann klicken)</label>
        <label class="chk"><input type="checkbox" id="set-sideGuard"> Deckung mit Seite (Maus trägt die Klinge nach links oder rechts)</label>
        <h2>Dōjō <span id="shop-honor"></span></h2>
        <p class="hint">Ehre gibt es für jeden Besiegten und jede überstandene Welle. Was du hier nimmst, bleibt.</p>
        <div id="shop"></div>
        <h2>Erfolge <span id="goal-count"></span></h2>
        <div id="goals"></div>
        <div class="row"><button id="menu-wipe">Fortschritt löschen</button><button id="menu-close">Schließen</button></div>
      </div>`;
    document.body.appendChild(el);
    const $ = (id) => el.querySelector('#' + id);
    const S = game.settings;
    for (const key of ['sens', 'volume']) {
      const inp = $('set-' + key), out = $('set-' + key + '-v');
      inp.value = S[key];
      const show = () => { out.textContent = key === 'sens' ? (+inp.value).toFixed(2) + '×' : Math.round(inp.value * 100) + ' %'; };
      show();
      inp.addEventListener('input', () => { S.set(key, +inp.value); show(); });
    }
    for (const key of ['blood', 'standoff', 'replay', 'aimCuts', 'sideGuard']) {
      const inp = $('set-' + key);
      inp.checked = S[key];
      inp.addEventListener('change', () => S.set(key, inp.checked));
    }
    $('menu-close').addEventListener('click', () => this.toggle(false));
    $('menu-wipe').addEventListener('click', (e) => {
      // two clicks: this cannot be undone
      if (e.currentTarget.dataset.sure) { game.progress.wipe(); delete e.currentTarget.dataset.sure; e.currentTarget.textContent = 'Fortschritt löschen'; this.refresh(); }
      else { e.currentTarget.dataset.sure = '1'; e.currentTarget.textContent = 'Wirklich löschen?'; }
    });
    el.addEventListener('click', (e) => { if (e.target === el) this.toggle(false); });
    $('shop').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-key]');
      if (b && game.progress.buy(b.dataset.key)) { this.refresh(); game.refreshSkins(); }
    });
    this.refresh();
  }

  get open() { return this.el.classList.contains('show'); }
  toggle(on = !this.open) {
    this.el.classList.toggle('show', on);
    if (on) { document.exitPointerLock?.(); this.refresh(); }
  }

  refresh() {
    const P = this.game.progress, S = this.game.settings;
    for (const key of ['blood', 'standoff', 'replay', 'aimCuts', 'sideGuard']) { const inp = this.el.querySelector('#set-' + key); if (inp) inp.checked = !!S[key]; }      // (P switches the replay from the keyboard)
    this.el.querySelector('#shop-honor').textContent = `· ${P.honor} Ehre · Rang ${P.rank}`;
    const A = this.game.ach;
    if (A) {
      this.el.querySelector('#goal-count').textContent = `· ${A.done.size} / ${GOALS.length}`;
      this.el.querySelector('#goals').innerHTML = A.html();
    }
    this.el.querySelector('#shop').innerHTML = SHOP.map((it) => {
      const own = P.has(it.key);
      return `<div class="item${own ? ' own' : ''}"><div><b>${it.name}</b><span>${it.desc}</span></div>`
        + `<button data-key="${it.key}" ${own || P.honor < it.cost ? 'disabled' : ''}>${own ? 'Erworben' : it.cost + ' Ehre'}</button></div>`;
    }).join('');
  }
}

// ------------------------------------------------------------------ training
export const DRILLS = [
  { key: 'cut', name: 'Hiebe', type: 'ronin', weapon: 'katana', how: 'Deckung erst im letzten Moment heben (<kbd>RMB</kbd>) = Abwehr, dann <kbd>LMB</kbd> für den Konter' },
  { key: 'thrust', name: 'Stöße 突', type: 'ashigaru', weapon: 'yari', how: 'Mit <kbd>Shift</kbd> in den Stoß <b>hinein</b>weichen: der Fuß tritt die Waffe nieder' },
  { key: 'sweep', name: 'Feger 足', type: 'ronin', weapon: 'katana', how: 'Mit <kbd>Space</kbd> drüberspringen, in der Luft <kbd>F</kbd> für den Sprungtritt' },
  { key: 'heavy', name: 'Schwere Hiebe 危', type: 'oni', weapon: 'kanabo', how: 'Nicht blocken: im letzten Moment mit <kbd>Shift</kbd> ausweichen (Zeitlupe + freier Konter)' },
  { key: 'arrow', name: 'Pfeile 弓', type: 'archer', weapon: 'wakizashi', how: 'Blocken (<kbd>RMB</kbd>), ausweichen oder mit einem Hieb aus der Luft schlagen' },
  { key: 'passive', name: 'Stillstehender Gegner', type: 'samurai', weapon: 'katana', how: 'Übe Kombos, Haltungen (<kbd>L</kbd>), Iai (<kbd>B</kbd> halten), Packen (<kbd>G</kbd>), Tritt (<kbd>F</kbd>), Rutschen (<kbd>X</kbd> im Sprint)' },
  { key: 'free', name: 'Freier Kampf', type: 'samurai', weapon: 'katana', how: 'Alles zusammen – er macht, was er will. Du nimmst hier kaum Schaden.' },
];

export class Training {
  constructor(game) {
    this.game = game;
    this.i = 0;
    this.count = 0;
    this.respawnT = 0;
    const el = this.el = document.createElement('div');
    el.id = 'drill';
    document.body.appendChild(el);
  }
  get active() { return this.game.mode === 'training'; }
  get drill() { return this.active ? DRILLS[this.i].key : this.game.tutorial?.drill ?? null; }

  show() {
    const d = DRILLS[this.i];
    this.el.innerHTML = `<small>TRAINING · Übung ${this.i + 1} / ${DRILLS.length}</small><b>${d.name}</b><span>${d.how}</span>`
      + `<i>${d.key === 'passive' || d.key === 'free' ? '' : 'Gelungen: ' + this.count + ' · '}<kbd>O</kbd> nächste Übung</i>`;
    this.el.classList.toggle('show', this.active);
  }

  next(step = 1) {
    this.i = (this.i + step + DRILLS.length) % DRILLS.length;
    this.count = 0;
    this.game.spawnWave();
  }

  /** The right answer to this drill's attack was given. */
  ok(kind) {
    if (this.drill !== kind) return;
    this.count++;
    this.game.audio.tick?.();
    this.show();
  }

  /** Put the partner for the current drill into the yard. */
  spawn() {
    const g = this.game, d = DRILLS[this.i];
    for (const e of [...g.npcs]) g.removeNpc(e);
    const k = g.spawnFighter(1, d.type);
    if (k.weapon.def.key !== d.weapon) k.setWeapon(d.weapon);
    k.postureMax *= d.key === 'free' ? 1.5 : 4;
    k.name = 'Übungspartner';
    this.respawnT = 0;
    this.show();
  }

  update(dt) {
    if (!this.active) { if (this.el.classList.contains('show')) this.el.classList.remove('show'); return; }
    const g = this.game, P = g.player;
    // nobody stays hurt here
    if (P.state === 'active' && P.inj.status().length) { this.healT = (this.healT || 0) + dt; if (this.healT > 4) { P.inj.treat(); P.clearWounds(); this.healT = 0; } }
    if (!g.livingEnemies.length) { this.respawnT += dt; if (this.respawnT > 1.5) this.spawn(); }
  }
}
