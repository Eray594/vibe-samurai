// What the player sees first and between fights: main menu, records, difficulty, pause.
const ov = $('overlay'), cards = [...document.querySelectorAll('#mode-cards .mode-card')];
const card = (m) => cards.find((c) => c.dataset.mode === m);
const rec = (m) => card(m).querySelector('.rec').textContent;

// ---- main menu, as loaded
check('Hauptmenü ist beim Laden sichtbar', visible(ov) && g.mainMenu && !g.paused);
check('Hauptmenü bietet fünf Modi, keiner gesperrt', ['survival', 'defense', 'daily', 'duel', 'tutorial'].every((m) => card(m) && !card(m).disabled), cards.map((c) => c.dataset.mode));
check('Neue Spieler werden auf die Einführung hingewiesen', card('tutorial').classList.contains('hot') && rec('tutorial').includes('Neu hier'));
check('Ohne Rekord steht das auch da', rec('survival') === 'Noch kein Rekord' && rec('defense') === 'Noch kein Rekord', rec('survival'));
check('Tagesaufgabe nennt Datum, Waffe und Wetter', /\d\d\.\d\d\./.test(rec('daily')) && rec('daily').includes('Heute noch nicht gespielt'), rec('daily'));
const t0 = g.time; step(30);
check('Hinter dem Hauptmenü steht der Hof still', g.time === t0, [t0, g.time]);
press('KeyR'); press('KeyT'); step(2);
check('Tasten wirken nicht durch das Hauptmenü hindurch', g.npcs.length === 1, g.npcs.length);
check('Pause-Tafel ist im Hauptmenü nicht zu sehen', !visible($('pause')));

// ---- difficulty
check('Schwierigkeit steht anfangs auf Normal', g.settings.diff === 'normal' && $('diff-row').querySelector('[data-diff="normal"]').classList.contains('active'));
$('diff-row').querySelector('[data-diff="hard"]').click();
check('Klick auf Schwer stellt um und wird gespeichert', g.settings.diff === 'hard' && g.diff.dmg === 1.5 && JSON.parse(localStorage.getItem('vibesamurai.settings')).diff === 'hard' && $('diff-note').textContent.includes('härter'));
g.mode = 'skirmish'; const tokHard = g.maxTokens(1);
const h0 = g.progress.honor; g.progress.earn(10);
check('Schwer: mehr Ehre, mehr gleichzeitige Angreifer', g.progress.honor === h0 + 15 && tokHard === 3, [g.progress.honor - h0, tokHard]);
$('diff-row').querySelector('[data-diff="easy"]').click();
const h1 = g.progress.honor; g.progress.earn(10);
check('Leicht: weniger Ehre, nur ein Angreifer zugleich', g.progress.honor === h1 + 7 && g.maxTokens(1) === 1 && g.diff.dmg === 0.6, [g.progress.honor - h1, g.maxTokens(1)]);
g.mode = 'daily';
check('Die Tagesaufgabe ist für alle gleich schwer', g.diff.key === 'normal');
g.mode = 'duel';
g.settings.set('diff', 'kaputt');
check('Ein unbekannter Schwierigkeitsgrad fällt auf Normal zurück', g.diff.key === 'normal');
$('diff-row').querySelector('[data-diff="normal"]').click();

// ---- picking a mode
card('survival').click();
check('Klick auf Überleben startet Welle 1', g.mode === 'survival' && !visible(ov) && g.wave === 1, [g.mode, g.wave]);
g.input.locked = true; g.started = true; step(30);
check('Nach der Wahl läuft das Spiel', g.time > t0 && !g.paused && !g.mainMenu, g.time);
check('Im Überleben sind die Sandkasten-Knöpfe ausgeblendet', !visible($('btn-spawn')) && !visible($('btn-mode')) && !visible($('enemy-type')));
tap('KeyM', 2);
check('Taste M wechselt im Überleben nicht den Modus', g.mode === 'survival');
{ const w = g.wave, n = g.npcs.length; tap('KeyR', 2); tap('KeyR', 2);
  check('Taste R zählt im Überleben keine Wellen hoch', g.wave === w && g.npcs.length === n, [g.wave, g.npcs.length]); }

// ---- the controls panel can be put away and fetched back, and stays that way
{
  const help = $('help'), chip = $('help-open'), saved = () => JSON.parse(localStorage.getItem('vibesamurai.settings') || '{}').help;
  check('Steuerungstafel: anfangs offen, mit Knopf zum Schließen', visible(help) && !visible(chip) && !!$('help-close'));
  tap('KeyH', 2);
  check('Steuerungstafel: Taste H blendet sie aus, ein kleiner Knopf bleibt', !visible(help) && visible(chip) && saved() === false, saved());
  chip.click();
  check('Steuerungstafel: ein Klick auf den Knopf holt sie zurück', visible(help) && !visible(chip) && saved() === true);
  $('help-close').click();
  check('Steuerungstafel: ein Klick auf ✕ schließt sie', !visible(help) && visible(chip) && saved() === false);
  g.input.locked = false; step(2); tap('KeyH', 1);
  check('Steuerungstafel: Taste H wirkt auch in der Pause', g.paused && visible(help) && saved() === true);
  g.input.locked = true; step(2);
}

// ---- the browser refused the mouse at first: a click into the picture still gets the game going
{
  $('btn-main').click(); g.input.locked = false; step(2);
  card('survival').click();                       // headless Chrome gives no pointer lock: exactly that case
  let asked = 0; const lock = g.input.lock.bind(g.input); g.input.lock = () => { asked++; lock(); };
  $('game').click();
  check('Klick ins Bild holt die Maus nach, wenn der Browser sie zuerst nicht gab', !g.started && asked === 1 && !visible(ov), [g.started, asked]);
  $('btn-main').click(); step(2); asked = 0; $('game').dispatchEvent(new MouseEvent('click'));
  check('… aber nicht, solange das Hauptmenü offen ist', asked === 0 && g.mainMenu);
  g.input.lock = lock;
  card('survival').click(); g.input.locked = true; g.started = true; step(5);
}

// ---- pause
g.input.locked = false; step(1);
const tp = g.time, wave = g.wave; step(60);
check('Maus frei = Pause: die Zeit steht', g.paused && g.time === tp && visible($('pause')), [tp, g.time]);
press('KeyR'); step(2);
check('In der Pause wirken Spieltasten nicht', g.wave === wave, g.wave);
tap('KeyI', 1);
check('Taste I öffnet in der Pause das Dōjō, die Pause-Tafel weicht', g.menu.open && !visible($('pause')));
check('Hauptmenü: als Karte ist der Hof markiert', g.map === 'yard' && !g.arena.abyss && document.querySelector('#map-row [data-map="yard"]').classList.contains('active') && !document.querySelector('#map-row [data-map="cliff"]').classList.contains('active'), g.map);
check('Das Dōjō listet 24 Erfolge', document.querySelectorAll('#goals .goal').length === 24 && $('goal-count').textContent.includes('0 / 24'), $('goal-count').textContent);
tap('KeyI', 1);
check('… und schließt es wieder', !g.menu.open && visible($('pause')));
let resumed = 0; const realResume = g.resume.bind(g); g.resume = () => { resumed++; realResume(); };
$('pause-resume').click(); g.input.locked = true; step(30);
check('Weiter setzt das Spiel fort', resumed === 1 && !g.paused && g.time > tp && !visible($('pause')));
for (const e of g.livingEnemies) e.inj.wound('torso', 9, 'cut', 0);
step(300);
const offered = g.perks.choosing, left = g.perks.offerT;
g.input.locked = false; step(120);
check('In der Pause läuft die Bedenkzeit für Verbesserungen nicht ab', offered && g.perks.choosing && g.perks.offerT === left, [offered, left, g.perks.offerT]);
document.querySelector('#perks .card').click();
check('Eine Verbesserung lässt sich auch anklicken', !g.perks.choosing && g.perks.taken.length === 1);
$('pause-restart').click(); g.input.locked = true; step(5);
check('Neustart beginnt den Lauf von vorn', g.wave === 1 && g.kills === 0 && g.perks.taken.length === 0 && resumed === 2, [g.wave, g.kills]);
g.input.locked = false; step(2);
$('pause-main').click(); step(2);
check('Hauptmenü aus der Pause: zurück zur Modus-Wahl', visible(ov) && g.mainMenu && !g.paused && !visible($('pause')));

// ---- records
P.iframeT = 0;
card('survival').click(); g.input.locked = true; g.started = true; step(5);
g.wave = 7; g.kills = 23; g.runT = 95;
P.inj.wound('torso', 9, 'cut', 0); step(90);
check('Ein beendeter Lauf wird als Rekord gespeichert', g.runOver && JSON.parse(localStorage.getItem('vibesamurai.best.survival')).wave === 7, localStorage.getItem('vibesamurai.best.survival'));
check('… und steht danach auf der Karte im Hauptmenü', rec('survival').includes('Welle 7') && rec('survival').includes('23 besiegt') && rec('survival').includes('1:35'), rec('survival'));
step(420);
g.wave = 3; g.kills = 5; P.inj.wound('torso', 9, 'cut', 0); step(90);
check('Ein schlechterer Lauf überschreibt den Rekord nicht', JSON.parse(localStorage.getItem('vibesamurai.best.survival')).wave === 7 && $('death-sub').textContent.includes('Rekord: Welle 7'), $('death-sub').textContent);
step(420);
localStorage.setItem('vibesamurai.best.survival', '{kaputt');
g.front.refresh();
check('Ein kaputter Speicherstand bringt das Menü nicht zu Fall', rec('survival') === 'Noch kein Rekord');

// ---- the toolbar button, free play
$('btn-main').click(); g.input.locked = false; step(2);
check('Hauptmenü-Knopf in der Leiste führt zurück zur Modus-Wahl', visible(ov) && g.mainMenu);
card('duel').click(); g.input.locked = true; g.started = true; step(5);
check('Freies Spiel startet im Duell, Sandkasten-Knöpfe sind da', g.mode === 'duel' && !visible(ov) && visible($('btn-spawn')) && visible($('btn-mode')));
tap('KeyM', 2);
check('Taste M wechselt im freien Spiel den Modus', g.mode === 'skirmish', g.mode);
for (let i = 0; i < 4; i++) tap('KeyM', 2);
check('… und kommt reihum wieder beim Duell an, ohne Überleben oder Verteidigung', g.mode === 'duel', g.mode);
const n0 = g.npcs.length; tap('KeyT', 2);
check('Taste T ruft im freien Spiel einen Verbündeten', g.npcs.length === n0 + 1);
play('daily'); step(3); const n1 = g.npcs.length; tap('KeyT', 2);
check('… in der Tagesaufgabe nicht', g.npcs.length === n1);
check('Am Ende ist alles an seinem Platz', sane() === '', sane());
