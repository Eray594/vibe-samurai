// English laid over the German game, and the on-screen controls for touch devices.
const tick = () => new Promise((r) => setTimeout(r, 0));       // lets the page react to what was just written into it
const ov = $('overlay');
const GERMAN = /[äöüÄÖÜß]|\b(und|der|die|das|den|dem|nicht|mit|für|eine?|ist|im|zum|zur|auf|oder|wenn|dann|noch|hier|sich)\b/;
/** Every piece of visible text on the page that still looks German. */
const leaks = () => {
  const out = [];
  const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    const t = n.nodeValue.trim(), el = n.parentElement;
    if (!t || !el || el.closest('script, style') || !GERMAN.test(t)) continue;
    out.push(t.slice(0, 60));
  }
  for (const el of document.querySelectorAll('[title]')) if (GERMAN.test(el.title)) out.push('title: ' + el.title.slice(0, 60));
  return [...new Set(out)];
};

// ---- English
check('Sprache: anfangs Deutsch', g.settings.lang === 'de' && g.i18n.lang === 'de' && ov.textContent.includes('Überleben'));
$('lang-row').querySelector('[data-lang="en"]').click(); await tick();
check('Sprache: Klick auf English stellt um und wird gespeichert', g.i18n.lang === 'en' && JSON.parse(localStorage.getItem('vibesamurai.settings')).lang === 'en' && document.documentElement.lang === 'en');
check('Englisch: das Hauptmenü ist übersetzt', ['Survival', 'Defense', 'Daily challenge', 'Free play', 'Tutorial', 'Difficulty', 'No record yet'].every((w) => ov.textContent.includes(w)), ov.textContent.slice(0, 300));
check('Englisch: die Steuerungstafel ist übersetzt', $('help').textContent.includes('slow motion + counter') && $('help').textContent.includes('finishing blow'.replace('f', 'F')), $('help').textContent.slice(0, 200));
check('Englisch: Tooltips sind übersetzt', $('btn-reset').title.startsWith('Reset the yard'), $('btn-reset').title);
begin(); g.settings.set('lang', 'en');
play('survival'); step(30); await tick();
check('Englisch: laufende Anzeigen sind übersetzt', $('wave').textContent.includes('Wave 1') && $('status').textContent === 'Unhurt' && $('tools').textContent.startsWith('Bandages'), [$('wave').textContent, $('status').textContent, $('tools').textContent]);
g.callout('ABGEWEHRT!', null, 'parry'); await tick();
check('Englisch: Meldungen sind übersetzt, zählen aber weiter für die Erfolge', $('callouts').lastChild.textContent === 'DEFLECTED!' && g.ach.stats.deflects === 1, $('callouts').lastChild.textContent);
g.wave = 6; g.kills = 14; g.runT = 75; P.inj.wound('torso', 9, 'cut', 0); step(120); await tick();
check('Englisch: zusammengesetzte Zeilen werden Stück für Stück übersetzt', /^Wave 6 · 14 defeated · 1:15\s+—\s+new record!\s+·\s+restart in \d s$/.test($('death-sub').textContent), $('death-sub').textContent);
step(420);
play('defense'); step(30); await tick();
check('Englisch: der Shop der Verteidigung ist übersetzt', ['Spearman', 'Spike pit', 'Watchtower', 'Start the wave'].every((w) => $('def-shop').textContent.includes(w)) && $('def-hud').textContent.includes('Shrine'), $('def-shop').textContent.slice(0, 200));
g.defense.money = 0; g.defense.buy('tower'); await tick();
check('Englisch: auch Absagen des Shops', $('callouts').lastChild.textContent === 'NOT ENOUGH MONEY', $('callouts').lastChild.textContent);
play('tutorial'); step(30); await tick();
check('Englisch: die Einführung ist übersetzt', $('tutor').textContent.includes('Tutorial · step 1 / 6'.toUpperCase().replace('STEP', 'step')) || $('tutor').textContent.includes('step 1 / 6'), $('tutor').textContent);
play('training'); step(30); g.training.next(); await tick();
g.input.locked = false; step(2); g.menu.toggle(true); await tick();
check('Englisch: Einstellungen, Dōjō und Erfolge sind übersetzt', ['Settings', 'Mouse sensitivity', 'Achievements', 'First blood', 'Fourth bandage'].every((w) => $('menu').textContent.includes(w)));
const left = leaks();
check('Englisch: nirgends auf der Seite steht noch deutscher Text', left.length === 0, left.slice(0, 12));
g.menu.toggle(false); g.input.locked = true;

// ---- and back
g.i18n.set('de'); await tick();
check('Zurück auf Deutsch: alles steht wieder da wie geschrieben', g.settings.lang === 'de' && ov.textContent.includes('Überleben') && ov.textContent.includes('Schwierigkeit') && $('help').textContent.includes('Ausweichschritt') && $('btn-reset').title.startsWith('Hof zurücksetzen'), ov.textContent.slice(0, 200));
play('survival'); step(30); await tick();
check('Zurück auf Deutsch: neue Texte bleiben deutsch', $('wave').textContent.includes('Welle 1') && $('status').textContent === 'Unverletzt');
g.i18n.set('en'); g.i18n.set('en'); g.i18n.set('de'); g.i18n.set('xx'); await tick();
check('Sprache: mehrfaches und falsches Umschalten schadet nicht', g.i18n.lang === 'de' && g.settings.lang === 'de' && $('status').textContent === 'Unverletzt');

// ---- touch
const T = g.touch, pad = $('touch');
const fire = (el, type, x = 0, y = 0, id = 1) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
check('Touch: am Rechner sind die Bildschirm-Knöpfe aus', !T.active && !visible(pad));
$('btn-main').click(); g.input.locked = false; step(2);
fire(document.body, 'pointerdown');
check('Touch: die erste Berührung schaltet sie ein', T.active && visible(pad) && document.body.classList.contains('touch'));
const btn = (k) => pad.querySelector(`[data-k="${k}"]`);
fire(btn('lmb'), 'pointerdown'); fire(btn('Space'), 'pointerdown');
check('Touch: im Hauptmenü tun die Knöpfe nichts', !g.input.lmb && !g.input.pressed.has('Space'));
fire(btn('lmb'), 'pointerup'); fire(btn('Space'), 'pointerup');
document.querySelector('#mode-cards [data-mode="survival"]').click(); step(5);
check('Touch: ein Modus startet ohne Mausfang', g.started && g.input.locked && !g.paused && !g.mainMenu && g.mode === 'survival');
const r = T.stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
const z0 = P.core.position.z;
fire(T.stick, 'pointerdown', cx, cy - 40);
check('Touch: Stick nach oben = vorwärts', K.has('KeyW') && !K.has('KeyS') && !K.has('KeyA') && !K.has('KeyD') && !K.has('ShiftRight'), [...K]);
step(60);
check('Touch: der Spieler läuft wirklich los', Math.abs(P.core.position.z - z0) > 0.8, P.core.position.z - z0);
fire(T.stick, 'pointermove', cx + 45, cy + 45);
check('Touch: Stick schräg = zwei Richtungen', K.has('KeyS') && K.has('KeyD') && !K.has('KeyW'), [...K]);
fire(T.stick, 'pointermove', cx, cy - 200);
check('Touch: Stick am Anschlag = Sprint', K.has('KeyW') && K.has('ShiftRight'));
fire(T.stick, 'pointermove', cx + 500, cy, 2);
check('Touch: ein anderer Finger bewegt den Stick nicht', K.has('KeyW') && !K.has('KeyD'));
fire(T.stick, 'pointerup', cx, cy);
check('Touch: Stick loslassen = stehen bleiben', !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftRight'].some((k) => K.has(k)), [...K]);
fire(btn('lmb'), 'pointerdown');
check('Touch: Hieb-Knopf drückt die Angriffstaste', g.input.lmb && g.input.lmbPressed);
fire(btn('lmb'), 'pointerup');
check('Touch: … und lässt sie wieder los', !g.input.lmb);
fire(btn('rmb'), 'pointerdown'); const held = g.input.rmb; fire(btn('rmb'), 'pointercancel');
check('Touch: Deckung halten und loslassen', held && !g.input.rmb);
g.input.pressed.clear(); fire(btn('Space'), 'pointerdown');
check('Touch: Sprung-Knopf', g.input.pressed.has('Space') && K.has('Space'));
fire(btn('Space'), 'pointerup');
const dx0 = g.input.dx;
fire(T.look, 'pointerdown', 900, 300, 5); fire(T.look, 'pointermove', 940, 310, 5); fire(T.look, 'pointerup', 940, 310, 5);
check('Touch: rechts wischen dreht den Blick', g.input.dx > dx0 + 50, g.input.dx - dx0);
step(5);
fire(T.stick, 'pointerdown', cx, cy - 40); fire(btn('rmb'), 'pointerdown');
pad.querySelector('.pause').click(); step(3);
check('Touch: Pause-Knopf hält das Spiel an und lässt alle Tasten los', g.paused && visible($('pause')) && !K.has('KeyW') && !g.input.rmb);
$('pause-resume').click(); step(3);
check('Touch: Weiter setzt ohne Mausfang fort', !g.paused && g.input.locked);
$('pause-main').click(); step(3);
check('Touch: zurück im Hauptmenü', g.mainMenu && visible($('overlay')));
check('Am Ende ist alles an seinem Platz', sane() === '', sane());
