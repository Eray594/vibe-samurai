// Rules that must hold whatever else changes: what a mode forbids, what is saved and what is wiped,
// and that effects appear where the thing that caused them is.
begin(); step(10);
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const order = [...document.querySelectorAll('#weapon-buttons button')].map((b) => b.dataset.weapon);

// ---- the daily challenge is the same for everyone: its weapon and weather are not the player's to change
play('daily'); step(5);
{
  const dw = g.daily.weapon, dwe = g.daily.weather, other = order.find((k) => k !== dw);
  tap('Digit' + (order.indexOf(other) + 1), 2);
  check('Tagesaufgabe: die Zifferntasten wechseln die Waffe nicht', P.weapon.def.key === dw, P.weapon.def.key);
  document.querySelector(`#weapon-buttons [data-weapon="${other}"]`).click(); step(2);
  check('Tagesaufgabe: die Knöpfe der Leiste auch nicht', P.weapon.def.key === dw, P.weapon.def.key);
  tap('KeyU', 2);
  check('Tagesaufgabe: das Wetter steht fest', g.weather.key === dwe, g.weather.key);
  const slot = g.arena.rack.slots.find((s) => s.key === other);
  for (const e of [...g.npcs]) g.removeNpc(e);
  fresh(slot.world.x, slot.world.z + 0.2); step(3);
  check('Tagesaufgabe: der Waffenständer bietet nichts an', !g.rackSlot && !visible($('prompt')), g.rackSlot?.key);
  tap('KeyE', 2);
  check('Tagesaufgabe: … und E nimmt dort nichts', P.weapon.def.key === dw, P.weapon.def.key);
  check('Tagesaufgabe: Waffen- und Wetterknöpfe sind ausgeblendet', !visible($('weapon-buttons')) && !visible($('btn-weather')));
  play('survival'); step(5);
  const w0 = P.weapon.def.key, o2 = order.find((k) => k !== w0);
  tap('Digit' + (order.indexOf(o2) + 1), 2);
  check('Im Überleben lässt sich die Waffe weiter wechseln', P.weapon.def.key === o2 && visible($('weapon-buttons')) && visible($('btn-weather')), P.weapon.def.key);
}

// ---- a day ends: the challenge of the day that has begun, not of the day the page was opened
{
  g.daily.setDate('2020-01-01', false); g.front.refresh();
  check('Tagesaufgabe: das Hauptmenü zeigt den heutigen Tag, auch wenn die Seite seit gestern offen ist', g.daily.date === today, g.daily.date);
  g.daily.setDate('2020-01-01', false);
  play('daily'); step(3);
  check('Tagesaufgabe: ein Lauf beginnt mit dem heutigen Tag', g.daily.date === today && P.weapon.def.key === g.daily.weapon, g.daily.date);
}

// ---- an upgrade that is not chosen in time is not lost
play('survival'); step(5);
for (const e of g.livingEnemies) e.inj.wound('torso', 9, 'cut', 0);
step(300);
{
  const first = g.perks.options?.[0]?.name, clock = document.querySelector('#perks .clock');
  check('Verbesserungen: die Bedenkzeit ist zu sehen', g.perks.choosing && !!clock && /\d/.test(clock.textContent), clock?.textContent);
  const t0 = clock?.textContent;
  step(240);
  check('Verbesserungen: … und läuft sichtbar ab', clock?.textContent !== t0, [t0, clock?.textContent]);
  step(60 * 14);
  check('Verbesserungen: läuft die Bedenkzeit ab, wird die erste genommen statt keiner', !g.perks.choosing && g.perks.taken.length === 1 && g.perks.taken[0] === first, [g.perks.taken, first]);
}

// ---- what is saved, and what "wipe" wipes
play('duel'); step(5);
{
  tap('KeyN', 2);
  check('Musik aus wird gespeichert', g.audio.music === false && JSON.parse(localStorage.getItem('vibesamurai.settings')).music === false);
  tap('KeyN', 2);
  check('… und wieder an auch', g.audio.music === true && JSON.parse(localStorage.getItem('vibesamurai.settings')).music === true);
  localStorage.setItem('vibesamurai.best.survival', JSON.stringify({ wave: 9, kills: 30, time: 100 }));
  localStorage.setItem('vibesamurai.best.chaos', JSON.stringify({ wave: 0, kills: 30, time: 100 }));
  localStorage.setItem('vibesamurai.best.defense', JSON.stringify({ wave: 4, kills: 30, time: 100 }));
  localStorage.setItem('vibesamurai.daily', JSON.stringify({ wave: 4, kills: 9, time: 60, date: today }));
  localStorage.setItem('vibesamurai.tutorial', JSON.stringify({ done: true }));
  const settings = localStorage.getItem('vibesamurai.settings');
  g.progress.wipe();
  const gone = ['vibesamurai.best.survival', 'vibesamurai.best.chaos', 'vibesamurai.best.defense', 'vibesamurai.daily', 'vibesamurai.tutorial'].filter((k) => localStorage.getItem(k) !== null);
  check('Fortschritt löschen: Rekorde, Tagesergebnis und Einführung sind auch weg', gone.length === 0, gone);
  check('Fortschritt löschen: das Hauptmenü zeigt es sofort', document.querySelector('#mode-cards [data-mode="survival"] .rec').textContent === 'Noch kein Rekord' && document.querySelector('#mode-cards [data-mode="tutorial"]').classList.contains('hot'));
  check('Fortschritt löschen: die Einstellungen bleiben', localStorage.getItem('vibesamurai.settings') === settings);
}

// ---- the replay does not record while it is switched off
{
  g.settings.set('replay', false); step(60);
  check('Wiederholung aus: es wird nichts aufgezeichnet', g.replay.frames.length === 0, g.replay.frames.length);
  g.settings.set('replay', true); step(30);
  check('Wiederholung an: es wird wieder aufgezeichnet', g.replay.frames.length >= 20, g.replay.frames.length);
}

// ---- dust and blood land on what is under them, not on the floor below
{
  const p = g.platforms.reduce((a, b) => (b.top > a.top ? b : a)), cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
  const ys = () => { const S = g.effects.sprites.S, out = []; for (let i = 0; i < g.effects.sprites.count; i++) out.push(S[i * 24 + 1]); return out; };
  g.effects.clear();
  g.effects.dust(V(cx, p.top + 0.98, cz), 14);
  const up = ys();
  check('Staub: wer oben auf dem Podest landet, wirbelt ihn dort oben auf', up.length > 5 && Math.min(...up) >= p.top, [Math.min(...up), p.top]);
  g.effects.clear();
  g.effects.dust(V(0, 0.98, 4), 14);
  const low = ys();
  check('Staub: auf dem Hof bleibt er am Boden', low.length > 5 && Math.max(...low) < 0.3, Math.max(...low));
  g.effects.clear();
  g.effects.dust(V(p.x1 + 1.5, 0.98, cz), 14);
  check('Staub: neben dem Podest ebenfalls', Math.max(...ys()) < 0.3, Math.max(...ys()));
  g.effects.clear(); g.effects.noBlood = false;
  for (const e of [...g.npcs]) g.removeNpc(e);
  fresh(0, 9);
  g.effects.blood(V(cx, p.top + 0.6, cz), V(0, -1, 0), 40, 0.2);
  step(150);
  const M = g.effects.decalMesh, hs = [];
  for (let i = 0; i < M.count; i++) hs.push(M.instanceMatrix.array[i * 16 + 13]);
  check('Blut: auf dem Podest bleiben Flecken oben liegen', hs.some((y) => Math.abs(y - p.top) < 0.05), [hs.length, hs.slice(0, 4), p.top]);
  check('Blut: was daneben fällt, liegt am Boden', hs.every((y) => Math.abs(y - p.top) < 0.05 || y < 0.05), hs.filter((y) => y > 0.05 && Math.abs(y - p.top) > 0.05).slice(0, 4));
}
// ---- the automatic quality: only steps down for a rate that is really low, and takes the step back if it bought nothing
{
  const Q = g.quality, warm = g.prewarm; g.prewarm = () => {};          // (rebuilding every shader takes seconds in this test browser)
  const run = (fps, seconds) => { for (let i = 0; i < fps * seconds; i++) Q.update(1 / fps); };
  const start = () => { Q.mode = 'auto'; Q.ceiling = 5; Q.ceilT = 0; Q.lockT = 0; Q.trial = null; Q.refresh = 60; Q.apply(3); };
  start(); run(144, 5); run(105, 20);
  check('Auto-Grafik: 105 Bilder/s auf einem 144-Hz-Schirm sind kein Grund herunterzuregeln', Q.level === 3 && Q.refresh > 130, [Q.level, Q.refresh]);
  start(); run(60, 4); run(40, 7);
  const down = Q.level;
  run(40, 6);
  check('Auto-Grafik: bleibt die Bildrate niedrig, geht es eine Stufe herunter – und wieder zurück, wenn das nichts bringt', down === 2 && Q.level === 3, [down, Q.level]);
  run(40, 30);
  check('Auto-Grafik: … und danach lässt sie es bleiben (keine Spirale nach unten)', Q.level === 3, Q.level);
  start(); run(60, 4); run(40, 7); run(58, 8);
  check('Auto-Grafik: hilft die niedrigere Stufe, bleibt sie', Q.level === 2, Q.level);
  start(); g.prewarm = warm;
}
check('Am Ende ist alles an seinem Platz', sane() === '', sane());
