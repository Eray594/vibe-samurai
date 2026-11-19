// @storage {"vibesamurai.settings": {"map": "cliff"}}
// The second map: a rock plateau with open edges, a bell to ring, and the main menu's way there.
begin(); play('duel'); g.standoff?.cancel(); step(20);
const A = g.arena;
const at = (a, r) => V(Math.sin(a) * r, 0, Math.cos(a) * r);
const GAP = 1.0472, RAIL = 5.4;       // the middle of an opening / of a fenced stretch
const rOf = (k) => { const p = k.state === 'active' ? k.core.position : k.ragBodies.pelvis.position; return Math.hypot(p.x, p.z); };

check('Die gespeicherte Karte wird geladen', g.map === 'cliff' && A.abyss === true && A.key === 'cliff', g.map);
check('Boden gibt es bis zur Kante, dahinter nicht', A.solidAt(0, 0) && A.solidAt(14.5, 0) && !A.solidAt(15.3, 0) && g.groundAt(0, 0, 0) === 0 && g.groundAt(16, 0, 0) < -10);
check('Drei Stellen am Rand sind offen, der Rest hat einen Zaun', A.openAt(Math.sin(GAP) * 14, Math.cos(GAP) * 14) && A.openAt(0, 14) && A.openAt(Math.sin(4.189) * 14, Math.cos(4.189) * 14)
  && !A.openAt(14, 0) && !A.openAt(0, -14) && !A.openAt(Math.sin(RAIL) * 14, Math.cos(RAIL) * 14) && A.rail.length === 27, A.rail.length);
check('Das Licht ist das dieser Karte, das Wetter lässt sich weiter wechseln', g.weather.name === 'Morgen über den Wolken' && g.scene.fog.density < 0.011, [g.weather.name, g.scene.fog.density]);

// ---- the fence holds, the opening does not
{
  fresh(Math.sin(RAIL) * 12, Math.cos(RAIL) * 12, Math.atan2(-Math.sin(RAIL), -Math.cos(RAIL)));      // facing outwards
  K.add('KeyW'); step(200); K.delete('KeyW');
  check('Gegen den Zaun gelaufen: er hält', P.state === 'active' && rOf(P) < 14.5 && rOf(P) > 13.4 && Math.abs(P.core.position.y - 0.98) < 0.2 && !P.fell, [rOf(P), P.core.position.y]);
  check('Am Zaun gibt es eine Wand zum Abstoßen, an der offenen Kante nicht', !!g.wallNear(P) && (fresh(Math.sin(GAP) * 14.2, Math.cos(GAP) * 14.2), g.wallNear(P) === null));
  fresh(Math.sin(GAP) * 12, Math.cos(GAP) * 12, Math.PI - GAP);
  const yaw = Math.atan2(-Math.sin(GAP), -Math.cos(GAP)); ctl.yaw = ctl.faceYaw = yaw;
  K.add('KeyW'); let fell = -1;
  for (let f = 0; f < 400 && fell < 0; f++) { step(1); if (P.fell) fell = f; }
  K.delete('KeyW');
  check('Durch die Lücke gelaufen: der Spieler stürzt ab', fell > 0 && P.dead && P.inj.cause === 'In den Abgrund gestürzt' && sane() === '', [fell, rOf(P), P.inj.cause, sane()]);
  step(60 * 7);
  check('… und steht im freien Spiel nach ein paar Sekunden wieder auf dem Fels', P.state === 'active' && !P.dead && !P.fell && P.weapon.attached && rOf(P) < 12 && Math.abs(P.core.position.y - 0.98) < 0.25 && sane() === '', [P.state, rOf(P), P.core.position.y]);
}

// ---- an opponent knocked over the edge is gone, and counts
{
  fresh(0, 2); const e = dummy('ronin', at(GAP, 13.6)); step(10);
  const kills = g.kills, said = [];
  const co = g.callout.bind(g); g.callout = (t, ...r) => { said.push(t); return co(t, ...r); };
  e.goRagdoll(V(Math.sin(GAP) * 7, 2, Math.cos(GAP) * 7).clone(), 'torso', false);
  let fell = -1;
  for (let f = 0; f < 300 && fell < 0; f++) { step(1); if (e.fell) fell = f; }
  step(30);
  g.callout = co;
  check('Ein Gegner, der über die Kante geht, stürzt ab und zählt als besiegt', fell > 0 && e.dead && g.kills === kills + 1 && said.includes('IN DEN ABGRUND!') && (g.ach.stats.falls || 0) >= 1 && sane() === '', [fell, e.dead, g.kills, said]);
  step(60 * 9);
  const y = e.ragBodies?.pelvis?.position.y ?? 0;
  check('… und bleibt unten liegen, statt endlos zu fallen', y >= -40.01 && y < -20 && sane() === '', y);
  // the same push against the fence: he stays on the rock
  const e2 = dummy('ronin', at(RAIL, 13.4)); step(10);
  e2.goRagdoll(V(Math.sin(RAIL) * 5, 0.6, Math.cos(RAIL) * 5).clone(), 'torso', false); step(240);
  check('Derselbe Stoß gegen den Zaun: er bleibt oben', !e2.fell && rOf(e2) < 15 && sane() === '', [rOf(e2), e2.fell]);
  solo(null);
}

// ---- nobody but the player walks over an open edge on his own
{
  fresh(Math.sin(GAP) * 14.7, Math.cos(GAP) * 14.7); const e = solo('ronin', at(GAP, 9)); let far = 0, hurt = false;
  for (let f = 0; f < 720; f++) { P.iframeT = 1; if (P.state !== 'active') { hurt = true; break; } step(1); if (e.state === 'active') far = Math.max(far, rOf(e)); }
  check('Gegner folgen nicht über die offene Kante', !e.fell && far < 14.3 && far > 11 && sane() === '', [far, e.fell, hurt]);
  solo(null);
}

check('Die Karte weiß, wo eine offene Kante nah ist', A.nearEdge(Math.sin(GAP) * 13.5, Math.cos(GAP) * 13.5) && !A.nearEdge(Math.sin(GAP) * 11, Math.cos(GAP) * 11) && !A.nearEdge(Math.sin(RAIL) * 14, Math.cos(RAIL) * 14));
{
  // the player is told when his heels are near it
  const said = []; const co = g.callout.bind(g); g.callout = (t, ...r) => { said.push(t); return co(t, ...r); };
  g.edgeSayT = 0; fresh(0, 4); step(30); const none = !said.includes('VORSICHT, KANTE!');
  fresh(Math.sin(GAP) * 14.1, Math.cos(GAP) * 14.1); step(20);
  g.callout = co;
  check('Nah an der offenen Kante kommt eine Warnung', none && said.includes('VORSICHT, KANTE!'), said);
  fresh(0, 4);
}

// ---- a weapon that went over the edge is not fetched
{
  fresh(0, 2); const e = solo('ronin', at(GAP, 10)); step(20);
  e.disarm(V(0, 1, 0).clone()); const wb = e.weapon.body;
  let ok = !e.weapon.attached;
  if (ok) { wb.position.set(Math.sin(GAP) * 16.5, 0.5, Math.cos(GAP) * 16.5); wb.velocity.set(0, 0, 0); let far = 0; for (let f = 0; f < 600; f++) { P.iframeT = 1; step(1); if (e.state === 'active') far = Math.max(far, rOf(e)); } ok = !e.fell && far < 14.3 && e.brain.flee === true && wb.position.y < -3; }
  check('Einer Waffe, die in den Abgrund fiel, läuft niemand nach', ok && sane() === '', [e.weapon.attached, e.fell, e.brain.flee, wb.position.y]);
  solo(null);
}

// ---- loose things go over the edge too, and blood does not hang in the air
{
  fresh(0, 2);
  const it = A.breakables.items.find((i) => i.kind === 'pot' && !i.broken);
  it.body.position.set(16.2, 0.5, 0); it.body.velocity.set(0, 0, 0); step(90);
  check('Was lose über der Kante liegt, fällt', it.body.position.y < -3, it.body.position.y);
  const n = g.effects.decalNext; g.effects.stain(16.5, 0, 0.3);
  const n2 = g.effects.decalNext; g.effects.stain(3, 3, 0.3);
  check('Blutflecken gibt es nur auf dem Fels', n2 === n && g.effects.decalNext !== n2 || g.effects.noBlood, [n, n2, g.effects.decalNext]);
  g.resetArena(); step(10);
}

// ---- the bell
{
  const B = A.bell;
  fresh(B.x - 3, B.z + 3); const e = dummy('ronin', V(B.x + 2.2, 0, B.z + 2.2)); const far = g.spawnFighter(1, 'ronin', V(-6, 0, 6)); far.brain.update = () => {}; step(10);
  const quiet = A.ringBell(P, 3, V(1, 0, 0));
  const rang = A.ringBell(P, 9, V(1, 0, 0));
  check('Die Glocke: ein leichter Schlag läutet nicht, ein harter schon', quiet === false && rang === true && B.cd > 9, [quiet, rang, B.cd]);
  check('… wer nah steht, taumelt und verliert Haltung, wer fern steht nicht', e.staggerT > 0.3 && (e.posture > 0 || e.brokenT > 0) && far.staggerT === 0 && far.posture === 0 && P.staggerT === 0, [e.staggerT, e.posture, far.staggerT]);
  check('… und sie braucht eine Weile, bis sie wieder wirkt', A.ringBell(P, 9, V(1, 0, 0)) === false);
  step(60 * 11);
  check('… danach ist sie wieder bereit und hängt still', B.cd === 0 && Math.abs(B.swing) < 0.05 && sane() === '', [B.cd, B.swing]);
  // struck for real, with the sword
  solo(null); fresh(B.x, B.z + 1.55, 0); step(10);
  let hit = false;
  for (let n = 0; n < 4 && !hit; n++) { g.input.lmbPressed = true; g.input.lmb = true; step(2); g.input.lmb = false; for (let f = 0; f < 70 && !hit; f++) { step(1); hit = B.cd > 0; } }
  check('Ein Schwerthieb bringt die Glocke zum Läuten', hit && sane() === '', B.cd);
  fresh(0, 4);
}

// ---- the boulder is there to climb
{
  const top = g.platforms[0];
  check('Der Fels zum Klettern trägt', g.platforms.length === 2 && top.top === 2.6 && g.groundAt((top.x0 + top.x1) / 2, (top.z0 + top.z1) / 2, 3) === 2.6);
  fresh(0, 4); P.core.position.set((top.x0 + top.x1) / 2, 2.6 + 0.98, (top.z0 + top.z1) / 2); P.core.velocity.set(0, 0, 0); step(90);
  check('… oben stehen geht', P.state === 'active' && Math.abs(P.core.position.y - (2.6 + 0.98)) < 0.2 && P.groundY === 2.6, [P.core.position.y, P.groundY]);
  fresh(0, 4);
}

// ---- every mode runs here
for (const mode of ['survival', 'defense', 'chaos', 'versus', 'training', 'daily', 'tutorial', 'skirmish']) {
  let bad = '';
  try { play(mode); g.standoff?.cancel(); for (let f = 0; f < 240 && !bad; f++) { P.iframeT = 1; step(1); if (f % 30 === 0) bad = sane(); } } catch (err) { bad = String(err.stack || err); }
  check(`Der Modus „${mode}“ läuft auf dieser Karte`, bad === '' && g.mode === mode, bad);
}
play('duel'); step(10);
for (const w of ['night', 'rain', 'snow', 'dusk']) { g.weather.set(w); step(20); }
check('Jedes Wetter lässt sich einstellen', g.weather.key === 'dusk' && sane() === '');

// ---- the way here and back: the main menu
{
  g.openMainMenu(); step(2);
  const btn = (k) => document.querySelector(`#map-row [data-map="${k}"]`);
  let reloads = 0; g.reload = () => { reloads++; };
  check('Hauptmenü: die Karte steht zur Wahl, die geladene ist markiert', visible($('map-row')) && btn('cliff').classList.contains('active') && !btn('yard').classList.contains('active') && $('map-note').textContent.length > 10, $('map-note').textContent);
  btn('cliff').click();
  check('… ein Klick auf die geladene Karte tut nichts', reloads === 0);
  btn('yard').click();
  const saved = JSON.parse(localStorage.getItem('vibesamurai.settings') || '{}');
  check('… ein Klick auf die andere speichert die Wahl und lädt neu', reloads === 1 && saved.map === 'yard' && g.settings.map === 'yard', [reloads, saved.map]);
  g.settings.set('map', 'cliff');
}
g.composer.render = realRender; play('duel'); step(3);
check('Am Ende wird noch gezeichnet', sane() === '');
