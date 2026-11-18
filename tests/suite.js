// Runs inside the page (body of an async function). Drives the game loop by hand at a fixed
// 60 Hz with rendering switched off, so thousands of frames take a few seconds and the result
// does not depend on how fast the machine is. Returns [[name, ok, detail], ...].
const g = window.game;
const checks = window.__checks = [];
const check = (name, ok, detail) => checks.push([name, !!ok, detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)]);
g.renderer.setAnimationLoop(null);
g.clock.getDelta = () => 1 / 60;
const realRender = g.composer.render.bind(g.composer);
g.composer.render = () => {};
g.input.locked = true; g.started = true;
try { localStorage.clear(); } catch { /* no storage */ }
g.progress.wipe();
const step = (n = 1) => { for (let i = 0; i < n; i++) g.frame(); };
const press = (c) => g.input.pressed.add(c);
const P = g.player, ctl = g.ctl, K = g.input.keys;
const V = (x, y, z) => P.getPos().set(x, y, z);
const solo = (type, pos) => { for (const e of [...g.npcs]) g.removeNpc(e); return type ? g.spawnFighter(1, type, pos) : null; };
const dummy = (type, pos) => { const e = solo(type, pos); e.brain.update = () => {}; return e; };
const fresh = (x = 0, z = 4, yaw = 0) => { K.clear(); g.input.lmb = g.input.rmb = false; P.resetTo(V(x, 0, z), 0); ctl.reset(); ctl.setStance(1); ctl.yaw = yaw; ctl.faceYaw = yaw; g.perfectCd = 0; step(5); };
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
check('Leichter Skin rollt', P.rollT > 0);
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
e = dummy('ashigaru', V(0, 0, 2.9)); fresh(); press('KeyG'); step(3);
check('Packen (G)', P.holding === e && e.heldBy === P); step(20);
g.input.lmbPressed = true; step(3); check('Werfen', e.state === 'ragdoll' && !P.holding, e.state); step(60);
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
  for (let f = 0; f < 300; f++) { g.frame(); const a = g.livingEnemies[0]?.brain.runner.a; if (a) names.add(a.name); }
  drills.push(d + ':' + [...names].join('+')); press('KeyO'); step(3);
}
check('Training: Stoß-Übung macht nur Stöße', drills.includes('thrust:tsuki'), drills.join(' '));
check('Training: Feger-Übung macht nur Feger', drills.includes('sweep:ashi'), drills.join(' '));
check('Training: stillstehender Partner greift nicht an', drills.includes('passive:'), drills.join(' '));
check('Training: Spieler überlebt alle Übungen', P.state === 'active' && !P.dead, P.state);

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
return checks;
