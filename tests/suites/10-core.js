// The fighting itself: movement, counters, opponents, weather, fire, the sandbox modes.
begin();
const feet = () => +(P.core.position.y - 0.98).toFixed(2);

// ---------------------------------------------------------------- basics
step(30);
check('Spielschleife läuft', g.time > 0.2, g.time);
check('Duell beginnt mit einem Gegner', g.livingEnemies.length === 1, g.livingEnemies.length);
g.setMode('skirmish'); solo(null); step(5);

fresh(); const z0 = P.core.position.z; K.add('KeyW'); step(60);
check('Laufen (W)', P.core.position.z < z0 - 2, P.core.position.z - z0);
K.add('ShiftLeft'); step(30); check('Sprint', P.sprinting);
press('KeyX'); step(3); check('Rutschen aus dem Sprint (X)', P.slideT > 0); step(60);
fresh(); press('Space'); step(8); check('Sprung', P.airborne && feet() > 0.3, feet()); step(80);
check('Landung', !P.airborne && Math.abs(feet()) < 0.2, feet());
fresh(); g.input.lmbPressed = true; step(3); check('Hieb (LMB)', !!ctl.runner.a); step(60);
fresh(); g.input.rmb = true; step(10); check('Deckung (RMB)', P.guarding); g.input.rmb = false;

// ---------------------------------------------------------------- aimed cuts, stances, iai
const cut = (dx, dy) => { fresh(); ctl.comboT = 9; g.input.dx = dx; g.input.dy = dy; g.frame(); g.input.lmbPressed = true; g.frame(); const n = ctl.runner.a?.name; step(50); return n; };
const aim = [cut(-60, 0), cut(60, 0), cut(0, 60), cut(0, -60), cut(0, 0)];
check('Hiebrichtung per Maus', aim.join() === 'yokoR,yokoL,shomen,age,kesaR', aim.join());
fresh(); press('KeyL'); step(2); check('Haltung wechseln (L)', ctl.stance === 2, ctl.stance); ctl.setStance(1);
fresh(); K.add('KeyB'); step(60); const iaiMode = ctl.mode; K.delete('KeyB'); step(3);
check('Iai (B halten, loslassen)', iaiMode === 'iai' && ctl.runner.a?.name === 'iai', [iaiMode, ctl.runner.a?.name]); step(60);

// ---------------------------------------------------------------- stamina, whiff, roll, skid, tech
fresh(); press('ShiftLeft'); step(2); const afterDash = ctl.stamina;
check('Ausweichen kostet Ausdauer', afterDash < 0.9 && afterDash > 0.7, afterDash);
check('Ein Tippen auf Shift ist ein Schritt, keine Rolle', P.rollT === 0 && P.dodgeKind === 'step', [P.rollT, P.dodgeKind]);
step(6); press('ShiftLeft'); step(2);
check('Zweimal Shift kurz hintereinander ist eine Rolle', P.rollT > 0 && P.dodgeKind === 'roll', [P.rollT, P.dodgeKind]);
let minHead = 9; for (let i = 0; i < 24; i++) { g.frame(); minHead = Math.min(minHead, P.parts.head.position.y); }
check('Rolle bleibt über dem Boden', minHead > 0.15, minHead);
K.add('KeyW'); K.add('ShiftLeft'); let winded = false; for (let i = 0; i < 760; i++) { g.frame(); if (ctl.exhausted && !P.sprinting) winded = true; }
check('Dauersprint erschöpft', winded, ctl.stamina);
K.clear(); step(300); check('Ausdauer erholt sich', ctl.stamina > 0.95, ctl.stamina);
fresh(); ctl.setStance(2); g.input.lmbPressed = true; let rec = 0;
for (let i = 0; i < 70; i++) { g.frame(); if (ctl.runner.a?.phase === 'recover') rec = Math.max(rec, ctl.runner.a.recoverDur); }
check('Schwerer Hieb ins Leere braucht länger', rec > P.weapon.def.swing.recover + 0.1, rec); ctl.setStance(1);
fresh(); K.add('KeyW'); K.add('ShiftLeft'); step(60); K.delete('KeyW'); K.add('KeyS'); let skid = false;
for (let i = 0; i < 20; i++) { g.frame(); if (P.skidT > 0) skid = true; }
check('Abbremsen beim scharfen Wenden', skid);
fresh(); P.goRagdoll(V(0, 2, 3), 'torso', false); step(25); press('Space'); step(2);
check('Abrollen nach Niederschlag', P.state === 'active', [P.state, P.ragTime, P.techTried, ctl.exhausted, P.inj.canStand, P.inj.consciousness, P.ragBodies?.pelvis.position.y]); step(60);
fresh(); P.goRagdoll(V(0, 2, 3), 'torso', false); step(3); press('Space'); step(2);
check('Abrollen zu früh gedrückt scheitert', P.state === 'ragdoll', P.state); step(220);
check('Spieler steht von selbst wieder auf', P.state === 'active', P.state);

// ---------------------------------------------------------------- walls, podium, ledge, plunge
fresh(0, 13.7, Math.PI); press('Space'); step(8); press('Space'); step(2);
check('Wandsprung', P.wallJumps === 1, P.wallJumps); step(90);
fresh(-5.2, 1.4, Math.PI / 2); K.add('KeyW'); step(12); press('Space'); step(55); K.clear(); step(40);
check('Über die Stufe aufs Podest', P.state === 'active' && P.groundY > 0.9 && !P.airborne, [P.groundY, feet()]);
fresh(-8.1, 4.6, 0); K.add('KeyW'); step(8); press('Space'); step(60); K.clear(); step(20);
check('Kantengriff am Deck', !!P.hang && ctl.mode === 'hang', [!!P.hang, feet()]);
press('Space'); step(70);
check('Hochziehen aufs Deck', P.groundY > 2.5 && !P.airborne, [P.groundY, feet()]);
let e = dummy('ronin', V(-8.1, 0, 6.3)); step(5);
ctl.yaw = Math.PI; K.add('KeyW'); step(14); press('Space'); step(10); K.clear();
check('Sturzangriff hat ein Ziel', !!g.plungeTarget(P, ctl));
g.input.lmbPressed = true; step(72);
check('Sturzangriff trifft', e.state === 'ragdoll' && (e.inj.parts.head > 0.2 || e.inj.parts.torso > 0.2), [e.state, e.inj.parts.head, e.inj.parts.torso]);
const runs = [];
for (const [x, z, yaw] of [[-4.5, 1.4, Math.PI / 2], [0, 12.5, Math.PI], [-8.1, 5, 0]]) { fresh(x, z, yaw); K.add('KeyW'); K.add('ShiftLeft'); step(150); K.clear(); step(30); runs.push(P.state + ':' + P.getPos().y.toFixed(1)); }
check('Gegen Hindernisse rennen wirft nicht um', runs.every((r) => r === 'active:0.9'), runs.join());

// ---------------------------------------------------------------- counters
e = dummy('ashigaru', V(0, 0, 1.6)); e.setWeapon('yari'); fresh();
e.brain.target = P; e.brain.runner.start('tsuki', e.weapon.def, { wind: 0.3 }); e.brain.runner.a.t = 0.2; e.atk = e.brain.runner.a;
K.add('KeyW'); press('ShiftLeft'); g.frame();
check('Klinge niedertreten (in den Stoß weichen)', ctl.counterT > 0.5 && e.posture > 0.2, [ctl.counterT, e.posture]); K.clear(); step(60);
e = dummy('ronin', V(0, 0, 2.6)); fresh();
e.brain.target = P; e.brain.runner.start('kesaR', e.weapon.def, { wind: 0.3 }); e.brain.runner.a.t = 0.2; e.atk = e.brain.runner.a;
K.add('KeyS'); press('ShiftLeft'); g.frame();
check('Perfektes Ausweichen', ctl.counterT > 0.5 && g.slowT > 0, [ctl.counterT, g.slowT, P.dashT, P.dashCd, ctl.exhausted, P.airborne, e.state, !!e.atk, e.getPos().distanceTo(P.getPos()), g.time, g.perfectCd]); K.clear(); step(60);
e = dummy('ronin', V(0, 0, 2.6)); fresh();
P.attackPhase = 'strike'; e.attackPhase = 'strike'; g.bind.cdUntil = 0;
check('Klingenbindung beginnt', g.bind.tryStart(P, e, P.getHeadPos()) && P.bound);
for (let i = 0; i < 14; i++) { g.input.lmbPressed = true; step(2); }
check('Klingenbindung durch Hämmern gewonnen', !g.bind.active && !P.bound && e.posture > 0.3, e.posture); step(40);
e = dummy('ashigaru', V(0, 0, 2.9)); fresh();
// (a clash of blades may freeze the picture for a moment just now: the press is kept and acted on right after)
press('KeyG'); for (let f = 0; f < 30 && !P.holding; f++) step(1);
check('Packen (G)', P.holding === e && e.heldBy === P, [P.holding?.name, e.state, g.timeScale]); step(20);
g.slowT = 0; g.hitStopT = 0; g.timeScale = 1;
g.input.lmbPressed = true; step(4); check('Werfen', e.state === 'ragdoll' && !P.holding, e.state); step(60);
solo(null); fresh(); g.input.rmb = true; step(10); press('KeyQ'); step(3); g.input.rmb = false;
check('Waffe werfen (RMB+Q)', !P.weapon.attached); step(120);
const wp = P.weapon.body.position; P.resetTo(V(wp.x, 0, wp.z), 0); P.weapon.drop(); step(5); press('KeyE'); step(3);
check('Waffe aufheben (E)', P.weapon.attached);
fresh(); dummy('ashigaru', V(0, 0, 2.6)); g.stickBlade(P, 0.4); g.input.lmbPressed = true; step(3);
check('Steckende Klinge blockiert den nächsten Hieb', P.stuckT > 0 && !ctl.runner.a); step(40);

// ---------------------------------------------------------------- opponents
e = solo('archer', V(0, 0, -6)); fresh(); e.brain.shotCd = 0; let arrows = 0, tele = null;
for (let i = 0; i < 200; i++) { g.frame(); tele = e.brain.tele || tele; arrows = Math.max(arrows, g.kunais.length); }
check('Bogenschütze kündigt an und schießt', tele === 'arrow' && arrows > 0, [tele, arrows]);
e = solo('gunner', V(0, 0, -6)); fresh(); e.brain.shotCd = 0; tele = null; const blood0 = P.inj.blood, torso0 = P.inj.parts.torso;
for (let i = 0; i < 260; i++) { g.frame(); tele = e.brain.tele || tele; }
check('Teppō-Schütze trifft einen stehenden Spieler', tele === 'gun' && (P.inj.parts.torso > torso0 || P.inj.blood < blood0), tele);
fresh(); e = solo('rider', V(0, 0, -8)); step(5);
check('Reiter sitzt auf', e.mountH > 0 && e.core.position.y > 1.8 && g.horses.length === 1, e.core.position.y);
for (let i = 0; i < 300; i++) { P.iframeT = 9; g.frame(); }
check('Reiter bleibt im Hof', Math.hypot(e.getPos().x, e.getPos().z) < 14.5, Math.hypot(e.getPos().x, e.getPos().z));
solo(null); fresh();
// losing heart is a roll of the dice per fighter, so take a handful and expect most of them to waver
const weak = [[2, 0], [-2, 0], [3, -2], [-3, -2], [0, -4], [4, 1]].map(([x, z], i) => g.spawnFighter(1, i % 2 ? 'archer' : 'ashigaru', V(x, 0, z)));
const boss = g.spawnFighter(1, 'daimyo', V(0, 0, -2));
step(5); boss.inj.wound('torso', 9, 'cut', 0); step(30);
const afraid = weak.filter((w) => w.brain.fearT > 0).length;
check('Moral: fällt der Anführer, weichen die anderen', boss.dead && afraid >= 3, [boss.dead, afraid]);
solo(null); P.resetTo(V(-8.1, 0, 1.4), 0); P.core.position.y = 2.6 + 0.98; ctl.reset(); step(20);
e = g.spawnFighter(1, 'ronin', V(-4, 0, 1.4)); let top = 0;
for (let i = 0; i < 700; i++) { P.iframeT = 9; g.frame(); if (e.state === 'active') top = Math.max(top, e.groundY); }
check('Gegner klettert aufs Podest nach', top > 2.5, top);

// ---------------------------------------------------------------- world
solo(null); fresh();
for (const w of ['night', 'rain']) { g.weather.set(w); step(10); }
check('Regen macht den Boden rutschig', g.grip < 0.8, g.grip);
g.weather.set('snow'); step(10); g.weather.set('dusk'); step(5);
check('Wetter zurück auf Abenddämmerung', g.grip === 1 && g.weather.key === 'dusk');
g.fire.ignite(0, 0, { r: 0.6, life: 2 }); step(60); const burning = g.fire.fires.length; step(200);
check('Feuer brennt und geht aus', burning === 1 && g.fire.fires.length === 0, [burning, g.fire.fires.length]);

// ---------------------------------------------------------------- modes
g.setMode('survival'); step(10); for (const x of g.livingEnemies) x.inj.wound('torso', 9, 'cut', 0); step(240);
check('Überleben: Verbesserung zur Wahl nach der Welle', g.perks.choosing && g.wave === 1, [g.perks.choosing, g.wave]);
press('Digit2'); step(3); check('Verbesserung gewählt', g.perks.taken.length === 1 && !g.perks.choosing); step(260);
check('Nächste Welle beginnt', g.wave === 2 && g.livingEnemies.length > 0, g.wave);
check('Ehre für Besiegte', g.progress.honor > 0, g.progress.honor);
g.progress.earn(2000);
check('Dōjō-Kauf', g.progress.buy('heal') && g.progress.has('heal') && ctl.maxHeals === 4, ctl.maxHeals);
g.refreshSkins(); g.setPlayerSkin('shogun'); check('Gesperrter Skin bleibt gesperrt', g.skin !== 'shogun', g.skin);
g.settings.set('blood', false); check('Einstellung: Blut aus', g.effects.noBlood === true); g.settings.set('blood', true);
g.menu.toggle(true); check('Menü öffnet mit Dōjō-Angeboten', g.menu.open && document.querySelectorAll('#shop .item').length === 7); g.menu.toggle(false);

g.setMode('training'); step(10); const drills = [];
for (let i = 0; i < 7; i++) {
  const d = g.training.drill, names = new Set(); P.iframeT = 0;
  if (P.state !== 'active') fresh();          // knocked over in the last drill: back on the feet, or the partner has nobody to attack
  for (let f = 0; f < 600 || (f < 1500 && !names.size && d !== 'passive' && d !== 'arrow'); f++) {
    // the partner is kept eager, so that whether he attacks within the time does not hang on his mood
    const en = g.livingEnemies[0];
    if (en && d !== 'passive') en.brain.cooldown = Math.min(en.brain.cooldown, 0.2);
    g.frame();
    const a = g.livingEnemies[0]?.brain.runner.a;
    if (a) names.add(a.name);
  }
  drills.push(d + ':' + [...names].join('+')); press('KeyO'); step(3);
}
check('Training: Stoß-Übung macht nur Stöße', drills.includes('thrust:tsuki'), drills.join(' '));
check('Training: Feger-Übung macht nur Feger', drills.includes('sweep:ashi'), drills.join(' '));
check('Training: stillstehender Partner greift nicht an', drills.includes('passive:'), drills.join(' '));
// he may just have been knocked over (that is part of it) – but he is not dead and gets up again
for (let f = 0; f < 900 && P.state !== 'active' && !P.dead; f++) g.frame();
check('Training: Spieler überlebt alle Übungen', P.state === 'active' && !P.dead, [P.state, P.dead, P.inj.cause]);

g.setMode('versus'); step(20); const Q = g.versus.p2;
check('2 Spieler: Spieler 2 ist da', !!Q && g.npcs.length === 1);
const qz = Q.core.position.z; K.add('ArrowUp'); step(40); K.clear(); K.add('Comma'); step(8);
check('2 Spieler: Pfeiltasten und Hieb steuern Spieler 2', Math.abs(Q.core.position.z - qz) + Math.abs(Q.core.position.x) > 0.1 && !!Q.ctl.runner.a, Q.core.position.z - qz); K.clear(); step(40);
Q.inj.wound('torso', 9, 'cut', 0); step(120);
check('2 Spieler: Punkt für Spieler 1', g.versus.score.join(':') === '1:0', g.versus.score.join(':')); step(260);
check('2 Spieler: neue Runde', !!g.versus.p2 && g.versus.p2 !== Q);

g.enemyType = 'ronin';      // the opening is for swordsmen on foot, not for archers or riders
g.setMode('duel'); step(5);
check('Duell-Eröffnung startet', g.standoff.active);
g.standoff.cueAt = 0; step(3); g.input.lmbPressed = true; step(40);
check('Schneller gezogen: Gegner fällt', g.npcs[0]?.dead === true && g.kills === 1, g.kills); step(60);
check('Wiederholung des Todesstoßes läuft', g.replay.active); step(600);
check('Wiederholung endet', !g.replay.active);

// ---------------------------------------------------------------- everything at once, then draw real frames
g.enemyType = 'random';
g.setMode('chaos'); for (const t of ['archer', 'gunner', 'rider', 'oni', 'samurai']) g.spawnFighter(1, t); g.weather.set('rain'); step(1200);
check('Chaos mit allem läuft 20 Sekunden durch', g.time > 60, g.time);
g.setMode('duel'); g.weather.set('dusk'); g.standoff.cancel();
g.composer.render = realRender; step(5);
g.renderer.info.autoReset = false; g.renderer.info.reset(); g.frame();
const info = { ...g.renderer.info.render }; g.renderer.info.autoReset = true;
check('Echte Bilder werden gezeichnet', info.calls > 0 && info.triangles > 1000, [info.calls, info.triangles]);

// ---- every weapon has a cut for every situation (a missing one used to crash the game mid-fight)
{
  const { MOVESETS, ATTACKS } = await import('/src/combat.js');
  const { WEAPON_ORDER } = await import('/src/weapons.js');
  const missing = [];
  for (const w of WEAPON_ORDER) {
    const ms = MOVESETS[w];
    for (const name of [...(ms?.combo || [undefined]), ms?.sprint, ms?.air, ms?.counter, ...(ms?.ai || [undefined])]) if (!ATTACKS[name]) missing.push(`${w}: ${name}`);
  }
  check('Jede Waffe hat für jede Lage einen Hieb (Kombo, Sprint, Luft, Konter, KI)', missing.length === 0, missing);
  g.composer.render = () => {};                 // real pictures were switched back on above; not needed here, and slow
  g.setMode('duel'); g.standoff.cancel();
  let bad = '';
  for (const w of WEAPON_ORDER) {
    const e = dummy('ronin', V(0, 0, -1.6)); fresh(0, 0); g.setPlayerWeapon(w); ctl.lock = e;
    try { ctl.counterT = 0.7; g.input.lmb = true; g.input.lmbPressed = true; step(3); g.input.lmb = false; step(90); } catch (err) { bad = bad || `${w}: ${err.message}`; }
  }
  g.composer.render = realRender;
  g.setPlayerWeapon('katana');
  check('Konter direkt nach einer Abwehr geht mit jeder Waffe', bad === '', bad);
}

// ---- sword work that flows, a guard that goes to meet the cut, and fighters that are cheap to draw
{
  g.composer.render = () => {};
  g.setMode('duel'); g.standoff.cancel();
  solo(null); fresh(0, 4);                       // cutting air: nothing to get stuck in, nobody to finish off
  let strikes = 0; const sw = g.onSwing.bind(g); g.onSwing = (k, h) => { if (k === P) strikes++; sw(k, h); };
  for (let f = 0; f < 84; f++) { if (f % 8 === 0) { g.input.lmbPressed = true; } step(1); }
  g.onSwing = sw;
  check('Kombo fließt: drei Hiebe in unter anderthalb Sekunden', strikes >= 3, strikes);
  step(90);
  const e = dummy('ronin', V(0, 0, 2.6)); fresh(0, 4);
  const me = P.getPos();
  const { POSES } = await import('/src/combat.js');
  g.settings.sideGuard = false;
  check('Deckung ohne Bedrohung: die gewohnte Stellung', ctl.blockPose(me) === POSES.block);
  e.attackPhase = 'wind'; e.atk = { name: 'kesaR' };
  const wp = e.weapon.worldPoint.bind(e.weapon);
  e.weapon.worldPoint = (l, out) => out.set(me.x + 0.8, 1.3, me.z - 1);
  const right = ctl.blockPose(me).hand.x;
  e.weapon.worldPoint = (l, out) => out.set(me.x - 0.8, 1.3, me.z - 1);
  const left = ctl.blockPose(me).hand.x, mid = ctl.blockPose(me).hand.y;
  e.atk = { name: 'shomen' };
  const high = ctl.blockPose(me).hand.y;
  check('Deckung ohne Seite (Einstellung aus) geht dem Hieb entgegen: links, rechts, über Kopf', right > 0 && left < 0 && high > mid + 0.1, [right, left, mid, high]);
  // with a side: the blade meets the first cut by itself, then it stays until the mouse carries it across
  g.settings.sideGuard = true; ctl.sideSet = false; e.atk = { name: 'kesaR' };
  e.weapon.worldPoint = (l, out) => out.set(me.x + 0.8, 1.3, me.z - 1);
  const first = ctl.blockPose(me).hand.x;
  e.weapon.worldPoint = (l, out) => out.set(me.x - 0.8, 1.3, me.z - 1);
  const stays = ctl.blockPose(me).hand.x;
  e.weapon.worldPoint = wp; e.attackPhase = null; e.atk = null;
  check('Deckung mit Seite: geht dem ersten Hieb entgegen und bleibt dann dort', first > 0 && stays > 0, [first, stays]);
  g.input.rmb = true; g.input.rmbPressed = true; step(3); ctl.blockSide = 1; ctl.sideSet = true;
  g.input.dx = -260; step(2);
  const pulled = ctl.blockSide; const label = $('stance-label').textContent;
  g.input.dx = 260; step(2);
  check('Deckung mit Seite: Maus ziehen trägt die Klinge hinüber und zurück', pulled === -1 && ctl.blockSide === 1 && label === 'Deckung links', [pulled, ctl.blockSide, label]);
  g.input.rmb = false; step(5);
  const k = g.spawnFighter(1, 'daimyo', V(5, 0, 0)); let meshes = 0, cast = 0;
  for (const n in k.parts) k.parts[n].traverse?.((o) => { if (o.isMesh) { meshes++; if (o.castShadow) cast++; } });
  check('Eine Figur kostet höchstens 45 Zeichenaufrufe (mit Schatten)', meshes > 10 && meshes + cast <= 45, [meshes, cast]);
  g.removeNpc(k);
  g.composer.render = realRender;
}

// ---- a press made while a hit freezes the picture is not lost
{
  g.composer.render = () => {};
  g.setMode('duel'); g.standoff.cancel();
  const e = dummy('ashigaru', V(0, 0, 2.9)); fresh();
  g.hitStopT = 0.2; g.timeScale = 0.05;
  const help0 = $('help').classList.contains('hidden');
  press('KeyG'); press('KeyH'); step(2);
  const during = !!P.holding;
  step(40);
  check('Im Treffer-Standbild gedrückt: der Griff kommt, sobald die Zeit weiterläuft', !during && P.holding === e, [during, !!P.holding]);
  check('… Schalt-Tasten werden dabei nicht doppelt ausgeführt', $('help').classList.contains('hidden') === !help0);
  if (!help0) $('help').classList.remove('hidden'); else $('help').classList.add('hidden');
  g.throwHeld(P, 1); step(30);
  g.composer.render = realRender;
}

// ---- feint, strong deflect, momentum
{
  g.composer.render = () => {};
  g.setMode('duel'); g.standoff.cancel();
  let e = dummy('samurai', V(0, 0, 2.2)); fresh(0, 4); ctl.lock = e;
  e.brain.target = P;
  g.input.lmbPressed = true; step(2);
  const winding = ctl.runner.phase === 'wind';
  e.brain.blockT = 0.8;                                       // he has seen the cut coming and raised his guard
  const post0 = e.posture;
  g.input.rmb = true; g.input.rmbPressed = true; step(1);
  check('Finte: RMB im Ausholen nimmt den Hieb zurück und lässt die Deckung des Gegners fallen', winding && !ctl.runner.busy && e.brain.blockT === 0 && e.brain.fooledT > 0.5 && e.posture > post0, [winding, ctl.runner.phase, e.brain.blockT, e.brain.fooledT]);
  e.brain.blockT = 0.8;
  check('Finte: gleich noch einmal wirkt sie nicht', g.onFeint(P) === 0 && e.brain.blockT === 0.8);
  g.input.rmb = false; step(5);
  const far = dummy('samurai', V(0, 0, -8)); far.brain.target = P; far.brain.blockT = 0.8; P.feintUntil = 0;
  check('Finte: wer weit weg steht oder nicht reagiert hat, fällt nicht darauf herein', g.onFeint(P) === 0 && far.brain.blockT === 0.8);

  const deflectWith = (flick) => {
    e = dummy('ronin', V(0, 0, 2.6)); if (e.weapon.def.key !== 'katana') e.setWeapon('katana');      // the same blade each time
    fresh(0, 4);
    P.guardT = 0.05; P.deflectWindow = 0.3; ctl.blockSide = 1; ctl.flickX = flick; e.weapon.blockedUntil = 0;
    g.guardHit(P, e, e.weapon, P.getHeadPos(), 8);
    return e.posture;
  };
  const plain = deflectWith(0), strong = deflectWith(60), wrong = deflectWith(-60);
  check('Starke Abwehr: Maus zum Hieb hin bricht deutlich mehr Haltung', strong > plain * 1.5 && Math.abs(wrong - plain) < 0.01 && plain > 0, [plain, strong, wrong]);

  const mom = (vz) => { fresh(0, 4); P.core.velocity.set(0, 0, vz); g.onSwing(P); return P.momentum; };
  const stand = mom(0), run = mom(-7), back = mom(3);
  check('Schwung: aus dem Lauf härter, im Zurückweichen schwächer, im Stand unverändert', stand === 1 && run > 1.25 && run <= 1.3 && back < 0.85 && back >= 0.8, [stand, run, back]);
  e = dummy('ronin', V(0, 0, 2.6)); g.onSwing(e);
  check('Schwung: Gegner bekommen keinen Bonus', e.momentum === undefined);
  g.composer.render = realRender;
}

// ---- guard with a side, parry chain, leading a cut past, thrust out of the guard
{
  g.composer.render = () => {};
  g.setMode('duel'); g.standoff.cancel(); g.settings.sideGuard = true;
  const foe = () => { const e = dummy('ronin', V(0, 0, 2.6)); if (e.weapon.def.key !== 'katana') e.setWeapon('katana'); fresh(0, 4); return e; };
  const hit = (e, side, guardT) => {
    P.guardT = guardT; P.deflectWindow = 0.3; ctl.blockSide = 1; ctl.flickX = 0; e.weapon.blockedUntil = 0; P.posture = 0; P.core.velocity.set(0, 0, 0);
    const at = P.getHeadPos(); at.x += side * 0.3;          // yaw 0: the player's right is +x
    g.guardHit(P, e, e.weapon, at, 8);
    g.hitStopT = 0; g.slowT = 0; g.timeScale = 1;          // the freeze of the clash is not what is being looked at
    return [P.posture, e.posture];
  };
  let e = foe(); const [okP, okE] = hit(e, 1, 0.05);
  e = foe(); const [wrongP, wrongE] = hit(e, -1, 0.05);
  e = foe(); const [plainP] = hit(e, 1, 1);
  check('Deckung mit Seite: auf der richtigen Seite wird abgewehrt', okE > 0.1 && okP < 0.1, [okP, okE]);
  check('Deckung mit Seite: auf der falschen Seite nur geblockt, und teurer', wrongE < okE * 0.5 && wrongP > plainP * 1.4, [wrongP, plainP, wrongE]);
  g.settings.sideGuard = false; e = foe(); const [, offE] = hit(e, -1, 0.05); g.settings.sideGuard = true;
  check('Deckung mit Seite lässt sich abschalten', Math.abs(offE - okE) < 0.02, [offE, okE]);

  e = foe(); e.postureMax = 50;
  hit(e, 1, 0.05); const c1 = ctl.chain;
  ctl.guardPressT = 1; g.input.rmb = true; g.input.rmbPressed = true; step(1); const widened = P.deflectWindow; g.input.rmb = false; step(1);
  hit(e, 1, 0.05); const c2 = ctl.chain; const brokenBefore = e.brokenT;
  hit(e, 1, 0.05);
  check('Parier-Kette: jede Abwehr in Folge zählt und weitet das nächste Fenster', c1 === 1 && c2 === 2 && widened > 0.3 * 1.15, [c1, c2, widened]);
  check('Parier-Kette: die dritte Abwehr öffnet den Gegner', brokenBefore <= 0 && e.brokenT > 1.5 && ctl.chain === 0, [brokenBefore, e.brokenT, ctl.chain]);
  e = foe(); hit(e, 1, 0.05); hit(e, 1, 1);
  check('Parier-Kette: ein bloßer Block beendet sie', ctl.chain === 0);
  e = foe(); hit(e, 1, 0.05); ctl.chainT = 0.01; step(3);
  check('Parier-Kette: sie verfällt, wenn nichts mehr kommt', ctl.chain === 0);

  e = foe(); g.input.rmb = true; g.input.rmbPressed = true; step(4);
  P.guardT = 1; e.weapon.blockedUntil = 0; P.posture = 0; P.core.velocity.set(3, 0, 0);
  g.guardHit(P, e, e.weapon, P.getHeadPos(), 8);
  check('Seitlich aus der Linie gehen lenkt den Hieb ins Leere', P.posture === 0 && e.brain.recoilT >= 1 && ctl.counterT > 0.5, [P.posture, e.brain.recoilT, ctl.counterT]);
  P.core.velocity.set(0, 0, 3); e.weapon.blockedUntil = 0; e.brain.recoilT = 0;
  g.guardHit(P, e, e.weapon, P.getHeadPos(), 8);
  check('… gerade zurückweichen nicht', P.posture > 0 && e.brain.recoilT === 0, [P.posture, e.brain.recoilT]);

  e = foe(); g.input.rmb = true; g.input.rmbPressed = true; step(6);
  // (the click may fall into the hit-stop left by the blows above: it is kept and played right after)
  g.input.lmbPressed = true; step(1);
  for (let f = 0; f < 12 && !ctl.runner.busy; f++) step(1);
  const a = ctl.runner.a; step(3);
  check('LMB in der Deckung: schneller Stoß, den die Deckung nicht abbricht', a?.name === 'tsuki' && a.fromGuard && ctl.runner.busy, [a?.name, a?.fromGuard, ctl.runner.phase]);
  step(60);
  check('… danach steht die Deckung wieder', ctl.mode === 'parry' && !ctl.runner.busy, ctl.mode);
  g.input.rmb = false; step(5);
  g.composer.render = realRender;
}

// ---- the blade springs back, a planted stance, the mouse guiding a cut, the three dodges
{
  g.composer.render = () => {};
  g.setMode('duel'); g.standoff.cancel();
  solo(null); fresh(0, 4);
  g.input.lmbPressed = true; for (let f = 0; f < 60 && ctl.runner.phase !== 'strike'; f++) step(1);
  const inStrike = ctl.runner.phase === 'strike', rec0 = ctl.runner.a.recoverDur;
  const did = g.bounce(P, 0.7);
  check('Klinge prallt ab: der Hieb endet sofort und braucht länger zurück', inStrike && did && ctl.runner.phase === 'recover' && ctl.runner.a.recoverDur > rec0 + 0.1 && !g.bounce(P, 0.7), [inStrike, did, ctl.runner.phase]);
  step(80);
  check('… und wer nicht zuschlägt, prallt nirgends ab', !g.bounce(P, 0.7) && !g.bounce(null));
  let e = dummy('ronin', V(0, 0, 2.6)); e.brain.runner.start('kesaR', e.weapon.def, {}); e.brain.runner.a.phase = 'strike';
  check('Auch Gegnerklingen prallen ab', g.bounce(e, 0.6) && e.brain.runner.phase === 'recover' && e.brain.recoilT > 0);

  fresh(0, 4);
  const planted = g.braces(P); P.core.velocity.set(3, 0, 0); const moving = g.braces(P); P.core.velocity.set(0, 0, 0); P.airborne = true; const air = g.braces(P); P.airborne = false;
  check('Fester Stand fängt schwere Treffer ab, in Bewegung oder in der Luft nicht', planted && !moving && !air && !g.braces(e), [planted, moving, air]);

  solo(null); fresh(0, 4); g.settings.aimCuts = true;
  g.input.lmbPressed = true; step(2); g.input.dx = 120; step(1);
  const bend1 = ctl.runner.a?.bend?.x; g.input.dx = 5000; step(1); const bend2 = ctl.runner.a?.bend?.x;
  check('Maus im Hieb lenkt die Klinge, aber nur ein Stück weit', bend1 > 0.05 && bend2 <= 0.22 + 1e-9 && bend2 > bend1, [bend1, bend2]);
  step(80);

  e = dummy('ronin', V(0, 0, 1.5)); fresh(0, 4); ctl.lock = e;
  const ang = () => Math.atan2(P.core.position.x - e.core.position.x, P.core.position.z - e.core.position.z), dist = () => Math.hypot(P.core.position.x - e.core.position.x, P.core.position.z - e.core.position.z);
  const a0 = ang(), d0 = dist();
  K.add('KeyD'); step(2); press('ShiftLeft'); step(1);
  const kind = P.dodgeKind, piv = !!P.pivot; step(16); K.clear();
  check('Seitlich mit erfasstem Ziel: der Schritt umkreist den Gegner', kind === 'pivot' && piv && Math.abs(ang() - a0) > 0.5 && Math.abs(dist() - d0) < 1.0, [kind, ang() - a0, dist() - d0]);
  step(60); ctl.lock = null; fresh(0, 4);
  K.add('KeyD'); step(2); press('ShiftLeft'); step(1); K.clear();
  check('… ohne erfasstes Ziel ist es ein gerader Schritt', P.dodgeKind === 'step' && !P.pivot, P.dodgeKind);
  step(60);
  g.composer.render = realRender;
}

// ---- a body that moves like one: planted feet, hips, leaning, flinching
{
  g.composer.render = () => {};
  g.setMode('duel'); g.standoff.cancel(); solo(null); fresh(0, 8);
  K.add('KeyW'); step(50);
  let planted = 0, frames = 0, lean = 0, last = null, lastBody = P.core.position.z;
  for (let f = 0; f < 120; f++) {
    step(1);
    // the foot end of the right shin: where the sole is
    const sole = P.parts.shinR.localToWorld(P.parts.shinR.worldToLocal(P.parts.shinR.position.clone()).set(0, -0.25, 0));
    const body = P.core.position.z, moved = Math.abs(body - lastBody);
    if (last !== null && moved > 0.02) { frames++; if (Math.abs(sole.z - last) < moved * 0.4) planted++; }
    last = sole.z; lastBody = body; lean = Math.max(lean, Math.abs(P.accLean.y));
  }
  K.clear();
  check('Füße stehen beim Gehen am Boden, statt zu rutschen', frames > 60 && planted / frames > 0.25, [planted, frames]);
  step(60); fresh(0, 8);
  K.add('KeyW'); let leanStart = 0; for (let f = 0; f < 20; f++) { step(1); leanStart = Math.max(leanStart, P.accLean.y); }
  K.clear(); let leanStop = 0; for (let f = 0; f < 20; f++) { step(1); leanStop = Math.min(leanStop, P.accLean.y); }
  check('Der Körper lehnt sich ins Anlaufen und beim Abbremsen zurück', leanStart > 0.02 && leanStop < -0.01, [leanStart, leanStop]);
  step(40); fresh(0, 8); const e = dummy('ronin', V(0, 0, 2)); ctl.lock = e;
  K.add('KeyD'); K.add('KeyW'); step(50); const hipDiag = P.hipYaw; K.clear(); step(80); const hipRest = P.hipYaw;
  check('Die Hüfte dreht in die Laufrichtung, der Oberkörper bleibt am Gegner', Math.abs(hipDiag) > 0.08 && Math.abs(hipRest) < 0.03, [hipDiag, hipRest]);
  const d = P.forward().clone().negate();
  P.flinch('armR', d, 0.3); const fl = [P.flinchT, P.flinchP, P.armSag];
  step(2); const sagging = P.armSag > 0; step(60);
  check('Treffer zeigen sich am Körper und klingen wieder ab', fl[0] > 0.3 && Math.abs(fl[1]) > 0.1 && fl[2] > 0.4 && sagging && P.flinchT === 0 && P.armSag === 0 && sane() === '', fl);
  ctl.lock = null;
  g.composer.render = realRender;
}

// ---- a figure that is alive: breath, eyes, weight, the catch of a landing, feet that step round, a somersault
{
  g.composer.render = () => {};
  g.setMode('duel'); g.standoff.cancel(); solo(null); fresh(0, 8);
  const L = P.life;
  // breathing: the chest opens and closes; out of breath it goes faster and deeper
  let lo = 9, hi = 0; const b0 = L.breath;
  for (let f = 0; f < 300; f++) { step(1); const z = P.parts.torso.scale.z; lo = Math.min(lo, z); hi = Math.max(hi, z); }
  const calmRate = (L.breath - b0) / 300;
  ctl.stamina = 0.02; let eff = 0; const b1 = L.breath;
  for (let f = 0; f < 90; f++) { ctl.stamina = 0.02; step(1); eff = Math.max(eff, L.effort); }
  const hardRate = (L.breath - b1) / 90;
  check('Die Figur atmet, außer Atem schneller', hi - lo > 0.008 && lo >= 1 && hi < 1.08 && eff > 0.4 && hardRate > calmRate * 1.5, [lo, hi, eff, calmRate, hardRate]);
  ctl.stamina = 1; step(30);

  // the head: on the opponent standing to the side, straight again when he is gone
  fresh(0, 8); const e = dummy('ronin', V(3, 0, 7));
  step(80);
  const hp = P.parts.head, look = V(0, 0, -1).applyQuaternion(hp.quaternion), body = P.forward().clone();
  const to = e.parts.head.position.clone().sub(hp.position).setY(0).normalize();
  const seen = [L.headYaw, look.setY(0).normalize().dot(to), body.dot(to)];
  solo(null); step(120);
  check('Der Kopf folgt dem Gegner und kehrt zurück', Math.abs(seen[0]) > 0.4 && seen[1] > seen[2] + 0.25 && Math.abs(L.headYaw) < 0.05, seen.concat(L.headYaw));

  // walking: the body rises and sinks with the steps, the hips work
  fresh(0, 8); K.add('KeyW'); step(40);
  let bLo = 9, bHi = -9, yLo = 9, yHi = -9;
  for (let f = 0; f < 90; f++) {
    step(1);
    const d = P.parts.pelvis.position.y - P.core.position.y; bLo = Math.min(bLo, d); bHi = Math.max(bHi, d);
    const fw = V(1, 0, 0).applyQuaternion(P.parts.pelvis.quaternion), yw = Math.atan2(-fw.z, fw.x) - P.yawActual - P.hipYaw; yLo = Math.min(yLo, yw); yHi = Math.max(yHi, yw);
  }
  K.clear();
  check('Beim Gehen hebt und senkt sich der Körper, die Hüfte arbeitet mit', bHi - bLo > 0.015 && bHi - bLo < 0.12 && yHi - yLo > 0.06 && yHi - yLo < 0.5, [bLo, bHi, yLo, yHi]);

  // a landing is caught in the knees and comes up again
  step(60); fresh(0, 8); press('Space'); let dip = 0, air = false;
  for (let f = 0; f < 110; f++) { step(1); air = air || P.airborne; dip = Math.max(dip, L.land); }
  step(60);
  check('Die Landung federt in den Knien ab', air && !P.airborne && dip > 0.04 && dip < 0.3 && Math.abs(L.land) < 0.01, [dip, L.land]);

  // turning on the spot: the feet are lifted and set down again, never both at once
  fresh(0, 8); step(30);
  const sole = () => P.parts.shinR.localToWorld(V(0, -0.25, 0));
  const s0 = sole(); step(30); const rest = sole().distanceTo(s0);
  let steps = 0, both = false, was = false;
  for (let f = 0; f < 120; f++) {
    ctl.yaw = ctl.faceYaw = Math.min(2.2, f * 0.04); step(1);
    const up = P.feet.R.t < 1 || P.feet.L.t < 1; if (up && !was) steps++; was = up;
    if (P.feet.R.t < 1 && P.feet.L.t < 1) both = true;
  }
  step(40);
  const home = V(0, 0, 0).copy(P.core.position).setY(0), far = Math.hypot(P.feet.R.x - home.x, P.feet.R.z - home.z);
  check('Beim Drehen auf der Stelle setzen die Füße um', rest < 0.01 && steps >= 2 && !both && far < 0.45 && P.feet.R.t === 1 && P.feet.L.t === 1, [rest, steps, both, far]);

  // the somersault: only in the air, once per jump, and over by the landing
  fresh(0, 8); const ground = P.flip(P.forward());
  press('Space'); step(10); const h0 = P.core.position.y; press('ShiftLeft'); step(2);
  const turning = P.rollT > 0 && P.flipped && P.airborne;
  step(40); const again = P.flip(P.forward());
  step(120);
  check('Salto in der Luft: einmal pro Sprung, am Boden nicht', !ground && turning && !again && !P.airborne && P.rollT === 0 && !P.flipped && P.state === 'active' && sane() === '', [ground, turning, again, h0]);
  K.add('KeyW'); press('Space'); step(10); press('ShiftLeft'); step(120); K.clear();
  check('Salto im Lauf: landet auf den Füßen', P.state === 'active' && !P.airborne && P.rollT === 0, [P.state, P.airborne]);

  // a blow on the guard: the hands give, the knees take it, and it all comes back
  {
    fresh(0, 8); const e = dummy('ronin', V(0, 0, 6.4)); step(10);
    e.intent.mode = 'parry'; const before = e.posture;
    g.guardHit(e, P, P.weapon, e.getHeadPos(), 9);
    let kick = 0, dip = 0, shake = e.life.shake;
    for (let f = 0; f < 30; f++) { step(1); kick = Math.max(kick, e.guardKick.length()); dip = Math.max(dip, e.life.land); }
    step(90);
    check('Die Deckung gibt unter dem Schlag nach und federt zurück', e.posture > before && kick > 0.03 && kick <= 0.3 && dip > 0.005 && shake > 0.3 && e.guardKick.length() < 0.005 && e.life.shake === 0 && sane() === '', [kick, dip, shake, e.guardKick.length()]);
    P.goRagdoll(null, null, false); P.guardRecoil(V(0, 0, 1), 1, true);
    check('… am Boden gibt es nichts zu federn', P.guardKickV.length() === 0);
    fresh(0, 8);
  }
  // an opponent's guard goes where the cut comes from
  {
    fresh(0, 8); const e = solo('ronin', V(0, 0, 6.3)); const upd = ctl.update; ctl.update = () => {};
    const hold = (atk, n) => { let y = 0; for (let f = 0; f < n; f++) { P.attackPhase = 'wind'; P.atk = atk; e.brain.blockT = 1; e.brain.recoilT = 0; e.staggerT = 0; step(1); y = e.intent.hand.y; } return y; };
    step(20);
    const mid = hold({ thrust: true }, 50), low = hold({ low: true }, 50), mode = e.intent.mode;
    ctl.update = upd; P.attackPhase = null; P.atk = null;
    check('Gegner führen die Deckung dem Hieb entgegen: tief gegen die Beine', mode === 'parry' && low < mid - 0.15 && mid > 0.3 && sane() === '', [mid, low, mode]);
    solo(null); fresh(0, 8);
  }

  // knocked down, the chest is its own size again; back up, everything still holds
  P.goRagdoll(null, null, false); const flat = P.parts.torso.scale.x;
  step(30); fresh(0, 8); step(30);
  check('Am Boden und nach dem Aufstehen bleibt die Figur heil', flat === 1 && P.state === 'active' && sane() === '' && Object.values(P.parts).every((o) => [o.position.x, o.position.y, o.position.z, o.quaternion.w].every(Number.isFinite)), flat);
  g.composer.render = realRender;
}
