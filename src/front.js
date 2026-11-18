// What sits in front of the fighting: the main menu (modes, records, difficulty, language), the pause
// panel, and the on-screen controls for touch devices.
import { DIFFS } from './goals.js';

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };

export class Front {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.overlay = $('overlay');
    this.pauseEl = $('pause');
    for (const b of document.querySelectorAll('#mode-cards .mode-card')) b.addEventListener('click', () => { if (!b.disabled) game.play(b.dataset.mode); });
    $('btn-main-settings').addEventListener('click', () => game.menu.toggle(true));
    for (const b of document.querySelectorAll('#diff-row [data-diff]')) b.addEventListener('click', () => { game.settings.set('diff', b.dataset.diff); this.refresh(); });
    for (const b of document.querySelectorAll('#lang-row [data-lang]')) b.addEventListener('click', () => { game.i18n.set(b.dataset.lang); this.refresh(); });
    $('pause-resume').addEventListener('click', () => game.resume());
    $('pause-restart').addEventListener('click', () => { game.resetArena(); game.resume(); });
    $('pause-main').addEventListener('click', () => game.openMainMenu());
    // perks can also be taken by clicking / tapping the card
    $('perks')?.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card) game.perks.pick([...card.parentNode.querySelectorAll('.card')].indexOf(card));
    });
    this.refresh();
  }

  /** Records, difficulty and language as they are right now. */
  refresh() {
    const g = this.game;
    const line = (r) => (r ? `Rekord: Welle ${r.wave} · ${r.kills} besiegt · ${fmtTime(r.time || 0)}` : 'Noch kein Rekord');
    const chaos = read('vibesamurai.best.chaos');
    const text = {
      survival: line(read('vibesamurai.best.survival')),
      defense: line(read('vibesamurai.best.defense')),
      daily: `${g.daily.label}<br>${g.daily.record ? 'Heute: Welle ' + g.daily.record.wave + ' · ' + g.daily.record.kills + ' besiegt' : 'Heute noch nicht gespielt'}`,
      duel: chaos ? `Chaos-Rekord: ${chaos.kills} besiegt · ${fmtTime(chaos.time || 0)}` : '',
      tutorial: g.tutorial.seen ? '✓ Abgeschlossen' : 'Neu hier? Fang hier an',
    };
    for (const b of document.querySelectorAll('#mode-cards .mode-card')) {
      const rec = b.querySelector('.rec');
      if (rec) rec.innerHTML = text[b.dataset.mode] || '';
      if (b.dataset.mode === 'tutorial') b.classList.toggle('hot', !g.tutorial.seen);
    }
    for (const b of document.querySelectorAll('#diff-row [data-diff]')) b.classList.toggle('active', b.dataset.diff === g.settings.diff);
    for (const b of document.querySelectorAll('#lang-row [data-lang]')) b.classList.toggle('active', b.dataset.lang === g.settings.lang);
    const d = DIFFS[g.settings.diff] || DIFFS.normal;
    document.getElementById('diff-note').textContent = d.key === 'easy' ? 'Gegner treffen schwächer und greifen einzeln an · weniger Ehre'
      : d.key === 'hard' ? 'Gegner treffen härter und greifen zu mehreren an · mehr Ehre' : 'So ist das Spiel gedacht';
  }

  /** Every frame: the pause panel is up exactly while a started game has let go of the mouse. */
  update() {
    const g = this.game;
    const show = g.paused && !g.menu.open;
    if (show !== this.pauseShown) { this.pauseShown = show; this.pauseEl.classList.toggle('show', show); }
  }
}

// ------------------------------------------------------------------ touch
const BUTTONS = [
  ['lmb', 'Hieb', 'big'], ['rmb', 'Deckung', ''], ['ShiftLeft', 'Schritt', ''], ['Space', 'Sprung', ''],
  ['KeyF', 'Tritt', ''], ['Tab', 'Ziel', ''], ['KeyC', 'Verband', ''], ['KeyQ', 'Kunai', ''],
];
const LOOK_SENS = 2.4;

/** Sticks and buttons for phones and tablets. They feed the same Input the keyboard and mouse do. */
export class Touch {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.stickId = null; this.lookId = null;
    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = '<div class="look"></div><div class="stick"><i></i></div><div class="btns">'
      + BUTTONS.map(([k, name, cls]) => `<button data-k="${k}" class="${cls}">${name}</button>`).join('') + '</div><button class="pause" aria-label="Pause">II</button>';
    document.body.appendChild(el);
    this.stick = el.querySelector('.stick'); this.knob = this.stick.querySelector('i'); this.look = el.querySelector('.look');
    const inp = game.input;

    this.stick.addEventListener('pointerdown', (e) => { this.stickId = e.pointerId; this.capture(this.stick, e); this.moveStick(e); e.preventDefault(); });
    this.stick.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.moveStick(e); });
    const endStick = (e) => { if (e.pointerId !== this.stickId) return; this.stickId = null; this.setStick(0, 0); };
    this.stick.addEventListener('pointerup', endStick); this.stick.addEventListener('pointercancel', endStick);

    this.look.addEventListener('pointerdown', (e) => { this.lookId = e.pointerId; this.lx = e.clientX; this.ly = e.clientY; this.capture(this.look, e); e.preventDefault(); });
    this.look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId || !inp.locked) return;
      inp.dx += (e.clientX - this.lx) * LOOK_SENS; inp.dy += (e.clientY - this.ly) * LOOK_SENS;
      this.lx = e.clientX; this.ly = e.clientY;
    });
    const endLook = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    this.look.addEventListener('pointerup', endLook); this.look.addEventListener('pointercancel', endLook);

    for (const b of el.querySelectorAll('.btns button')) {
      const k = b.dataset.k;
      const down = (e) => {
        e.preventDefault();
        if (!inp.locked) return;
        b.classList.add('on');
        if (k === 'lmb') { inp.lmb = true; inp.lmbPressed = true; }
        else if (k === 'rmb') { inp.rmb = true; inp.rmbPressed = true; }
        else { if (!inp.keys.has(k)) inp.pressed.add(k); inp.keys.add(k); }
      };
      const up = () => {
        b.classList.remove('on');
        if (k === 'lmb') inp.lmb = false; else if (k === 'rmb') inp.rmb = false; else inp.keys.delete(k);
      };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
    el.querySelector('.pause').addEventListener('click', () => { if (game.started) { this.release(); inp.locked = false; } });

    const want = new URLSearchParams(location.search).has('touch') || (matchMedia?.('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
    if (want) this.enable();
    else addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.enable(); }, { capture: true });
  }

  /** Keep getting this finger's moves even when it slides off the element. */
  capture(el, e) { try { el.setPointerCapture?.(e.pointerId); } catch { /* that pointer is already gone */ } }

  enable() {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('touch');
  }

  moveStick(e) {
    const r = this.stick.getBoundingClientRect();
    const half = r.width / 2 || 60;
    this.setStick((e.clientX - (r.left + half)) / half, (e.clientY - (r.top + half)) / half);
  }

  /** Stick position (-1..1 each way) as the four movement keys; pushed all the way it is a sprint. */
  setStick(x, y) {
    const keys = this.game.input.keys, len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.knob.style.transform = `translate(${(x * 38).toFixed(1)}px, ${(y * 38).toFixed(1)}px)`;
    const set = (code, on) => { if (on) keys.add(code); else keys.delete(code); };
    const live = this.game.input.locked;
    set('KeyW', live && y < -0.35); set('KeyS', live && y > 0.35); set('KeyA', live && x < -0.35); set('KeyD', live && x > 0.35);
    set('ShiftRight', live && len > 0.97);
  }

  /** Let go of everything (pause, menu). */
  release() {
    const inp = this.game.input;
    this.stickId = null; this.lookId = null;
    this.setStick(0, 0);
    inp.lmb = inp.rmb = false;
    for (const [k] of BUTTONS) inp.keys.delete(k);
  }
}
