// Defense mode: the fort, the shop, soldiers, traps, towers, waves, bosses, losing, leaving.
begin();
step(20);
const D = g.defense;
const duelBodies = g.world.bodies.length;
const killAll = () => { for (const e of g.livingEnemies) e.inj.wound('torso', 9, 'cut', 0); };
const at = (x, z, yaw = 0) => fresh(x, z, yaw);
const item = (key) => D.shopEl.querySelector(`[data-key="${key}"]`);

play('defense'); step(5);
check('Verteidigung: Palisade und Schrein stehen', D.on && D.group.visible && g.world.bodies.length > duelBodies + 15, g.world.bodies.length - duelBodies);
check('Verteidigung: Schrein ist heil, 80 Mon Startgeld', D.shrine.hp === 100 && D.money === 80, [D.shrine.hp, D.money]);
check('Verteidigung: beginnt mit Baupause, Shop und Anzeige sichtbar', D.phase === 'build' && visible(D.shopEl) && visible(D.hud) && g.livingEnemies.length === 0);
check('Verteidigung: Shop zeigt zehn Angebote', D.shopEl.querySelectorAll('.it').length === 10);
check('Verteidigung: Sandkasten-Knöpfe sind ausgeblendet', !visible($('btn-spawn')) && !visible($('btn-mode')));

// ---- buying
at(2.5, 3);
const w0 = P.weapon.def.key;
tap('Digit1', 2);
check('Shop: Taste 1 heuert einen Speerträger an', D.living.length === 1 && D.money === 40 && D.living[0].team === 0 && D.living[0].weapon.def.key === 'yari', [D.living.length, D.money]);
check('Shop: Zifferntasten wechseln in der Baupause nicht die Waffe', P.weapon.def.key === w0, P.weapon.def.key);
D.money = 10;
check('Shop: ohne Geld kein Kauf', D.buy('samurai') === false && D.money === 10 && D.living.length === 1);
check('Shop: zu teure Angebote sind ausgegraut', item('samurai').classList.contains('no'));
D.money = 5000;
at(0, 3);
check('Shop: keine Falle direkt am Schrein', D.buy('spikes') === false && D.traps.length === 0, D.blocked({ kind: 'trap', cost: 0 }));
at(4, 0);
const spot = D.spot();
check('Shop: Stachelgrube landet einen Schritt vor dem Spieler', D.buy('spikes') && D.traps.length === 1 && Math.hypot(D.traps[0].x - spot.x, D.traps[0].z - spot.z) < 0.01, [spot.x, spot.z]);
check('Shop: an derselben Stelle keine zweite Falle', D.buy('wire') === false && D.traps.length === 1);
at(0, 9.5);
check('Shop: keine Falle in der Palisade', (() => { fresh(0, FORT_EDGE(), 0); return D.buy('oil') === false; })());
function FORT_EDGE() { return 6.2 + 1.6; }
at(-3, 4, 0);
const b0 = g.world.bodies.length;
check('Shop: Barrikade steht als Hindernis', D.buy('barricade') && g.world.bodies.length === b0 + 1 && D.traps.at(-1).target.hp === 40);
check('Shop: Schrein ausbessern geht nur, wenn er beschädigt ist', D.buy('repair') === false);
D.shrine.hp = 50;
check('Shop: Ausbessern stellt 40 Punkte her', D.buy('repair') && D.shrine.hp === 90, D.shrine.hp);
check('Shop: Mauern verstärken hebt Schrein und Barrikaden an', D.buy('walls') && D.shrine.maxHp === 140 && D.traps.at(-1).target.maxHp === 60, [D.shrine.maxHp, D.traps.at(-1).target.maxHp]);
D.buy('walls'); D.buy('walls');
check('Shop: Mauern höchstens Stufe 3', D.level === 3 && D.buy('walls') === false);
check('Shop: Wachturm wird gebaut, höchstens zwei', D.buy('tower') && D.buy('tower') && D.towers.length === 2 && D.buy('tower') === false);
at(3, 3);
for (let i = 0; i < 8; i++) D.buy('archer');
check('Shop: höchstens sechs Soldaten', D.living.length === 6, D.living.length);
item('spear').click();
check('Shop: Klick auf ein gesperrtes Angebot kauft nichts', D.living.length === 6);

// ---- soldiers
step(240);
const far = D.living.map((s) => Math.hypot(s.core.position.x - s.brain.post.x, s.core.position.z - s.brain.post.z));
check('Soldaten halten ohne Gegner ihre Stellung', Math.max(...far) < 1.6, far.map((d) => +d.toFixed(1)));
tap('KeyJ', 2);
check('Taste J: Soldaten folgen', D.follow && D.living.every((s) => s.brain.follow));
P.resetTo(V(0, 0, 10.5), 0); ctl.reset(); step(900);
const gap = D.living.map((s) => Math.hypot(s.core.position.x - P.core.position.x, s.core.position.z - P.core.position.z));
check('Folgende Soldaten finden durch ein Tor nach draußen zum Spieler', gap.filter((d) => d < 5).length >= 4, gap.map((d) => +d.toFixed(1)));
tap('KeyJ', 2);
check('Taste J: Soldaten halten wieder (neue Stellung = wo sie stehen)', !D.follow && D.living.every((s) => !s.brain.follow));
check('Nach den Soldaten-Manövern ist alles an seinem Platz', sane() === '', sane());

// ---- a wave: enemies come through the gates and go for the shrine
for (const s of [...D.soldiers]) g.removeNpc(s);
for (const t of [...D.traps]) D.removeTrap(t);
step(2);
P.resetTo(V(11, 0, 0), 0); ctl.reset(); P.iframeT = 1e9;
tap('Enter', 2);
check('Enter startet die Welle', D.phase === 'wave' && g.wave === 1 && !visible(D.shopEl), [D.phase, g.wave]);
check('In der Welle wird nichts verkauft', D.buy('repair') === false);
let reached = 0, bad = '';
const hp0 = D.shrine.hp;
for (let i = 0; i < 3600 && D.shrine.hp >= hp0; i++) {
  step(1);
  for (const e of g.livingEnemies) e.brain.raider = true;
  if (i % 30 === 0) { bad = bad || sane(); reached = Math.max(reached, g.livingEnemies.filter((e) => Math.hypot(e.core.position.x, e.core.position.z) < 6).length); }
}
check('Gegner finden durch die Tore in die Festung', reached > 0, reached);
check('Gegner beschädigen den Schrein', D.shrine.hp < hp0, D.shrine.hp);
check('Während der Welle bleibt alles im Hof', bad === '', bad);
check('Wachtürme schießen Pfeile', g.kunais.some((k) => k.thrower === D.towerOwner) || D.towers.every((t) => t.t > 0), g.kunais.length);

// ---- traps (each tried with a fresh opponent standing on it)
for (const tw of D.towers) tw.t = 1e9;          // the towers would shoot the test subjects
const trapTest = (kind, x, z) => {
  for (const e of [...g.npcs]) g.removeNpc(e);
  D.queue = [];
  at(x, z + 1.6);
  D.phase = 'build'; D.money = 999;
  const why = D.blocked({ kind: 'trap', cost: 0 });
  const ok = D.buy(kind);
  D.phase = 'wave';
  const t = D.traps.at(-1);
  if (!ok) throw new Error(`Falle ${kind} ließ sich nicht setzen: ${why} (Spieler ${P.state}, ${P.core.position.x.toFixed(1)}/${P.core.position.z.toFixed(1)})`);
  const e = g.spawnFighter(1, 'ashigaru', V(t.x, 0, t.z));
  e.brain.update = () => {};
  D.queue = ['ashigaru'];          // so that the wave is not over while we look
  D.spawnT = 1e9;
  return { ok, t, e };
};
P.iframeT = 1e9;
{
  const { ok, t, e } = trapTest('spikes', 8, 0);
  const hits0 = D.stats.trapHits; step(10);
  check('Stachelgrube verletzt, wer hineintritt', ok && D.stats.trapHits === hits0 + 1 && t.uses === 3 && e.inj.parts.legR + e.inj.parts.legL > 0, [t.uses, e.inj.parts.legR, e.inj.parts.legL]);
  step(200);
  check('Stachelgrube sticht nicht jede Sekunde neu zu', t.uses >= 1, t.uses);
}
{
  const { ok, e } = trapTest('wire', 8, 3);
  step(10);
  check('Stolperdraht reißt den Gegner zu Boden', ok && e.state === 'ragdoll', e.state);
}
{
  const { ok, t } = trapTest('oil', 8, -3);
  step(10);
  check('Ölfass geht in Flammen auf und ist verbraucht', ok && g.fire.fires.length > 0 && !D.traps.includes(t), g.fire.fires.length);
}
{
  const { ok, t, e } = trapTest('barricade', -8, -3);
  const n0 = g.world.bodies.length;
  D.hitStructure(t.target, e);
  check('Barrikade nimmt Schaden', ok && t.target.hp < t.target.maxHp, t.target.hp);
  for (let i = 0; i < 40 && D.traps.includes(t); i++) D.hitStructure(t.target, e);
  check('Zerhackte Barrikade verschwindet samt Hindernis', !D.traps.includes(t) && t.target.dead && g.world.bodies.length === n0 - 1);
  D.hitStructure(t.target, e);
  check('Schlag auf eine schon zerstörte Barrikade tut nichts', sane() === '');
}
{
  // a barricade in the way is attacked before the shrine behind it
  for (const e of [...g.npcs]) g.removeNpc(e);
  at(0, 4.2);                                      // looking at the shrine from the south: the barricade lands between
  D.phase = 'build'; D.money = 999; const ok = D.buy('barricade'); D.phase = 'wave'; D.queue = ['ashigaru']; D.spawnT = 1e9;
  const t = D.traps.at(-1);
  const e = g.spawnFighter(1, 'ronin', V(0, 0, 4.4)); e.brain.raider = true;
  P.resetTo(V(11, 0, 0), 0); ctl.reset(); P.iframeT = 1e9;
  let went = false;
  for (let i = 0; i < 900 && !went; i++) { step(1); went = e.brain.target === t.target; }
  check('Gegner hackt auf die Barrikade ein, die im Weg steht', ok && went, e.brain.target?.name);
  const h = t.target.hp;
  for (let i = 0; i < 1500 && t.target.hp >= h && D.traps.includes(t); i++) step(1);
  check('… und beschädigt sie mit echten Hieben', t.target.hp < h || !D.traps.includes(t), t.target.hp);
}

// ---- money for kills, the end of a wave
for (const e of [...g.npcs]) g.removeNpc(e);
D.queue = []; D.spawnT = 0;
const e1 = g.spawnFighter(1, 'ashigaru', V(9, 0, 3)); e1.brain.update = () => {};
const m0 = D.money; step(3);
e1.inj.wound('torso', 9, 'cut', 0);
for (let i = 0; i < 400 && D.money === m0; i++) step(1);
check('Besiegte Gegner bringen Geld', D.money > m0, D.money - m0);
const m1 = D.money, wv = g.wave;
for (let i = 0; i < 600 && D.phase === 'wave'; i++) step(1);
check('Ist die Welle besiegt, folgt die Baupause mit Sold', D.phase === 'build' && D.money === m1 + 30 + 10 * wv && visible(D.shopEl), [D.phase, D.money - m1]);
check('Abgewehrte Wellen zählen für die Erfolge', g.ach.stats.defWave === wv, g.ach.stats.defWave);
const bt = D.buildT; step(180);
check('Die Baupause läuft ab', D.buildT < bt - 0.9 && $('def-hud').textContent.includes('Baupause'), D.buildT);
D.buildT = 0.05; step(10);
check('Nach der Baupause kommt die nächste Welle von selbst', D.phase === 'wave' && g.wave === wv + 1, [D.phase, g.wave]);

// ---- boss wave
for (let i = 0; i < 2000 && D.phase === 'wave'; i++) { if (i % 20 === 0) killAll(); step(1); }
g.wave = 4; D.phase = 'build';
D.startWave();
check('Jede fünfte Welle führt ein Anführer an', g.wave === 5 && !!D.queue[0]?.boss, D.queue[0]);
for (let i = 0; i < 300 && !D.boss; i++) step(1);
const boss = D.boss;
check('Der Anführer von Welle 5 ist Kuro der Brecher und will den Schrein', boss?.name === 'Kuro der Brecher' && boss.boss === 'breaker' && boss.brain.raider === true, boss?.name);
const hpB = D.shrine.hp; D.hitStructure(D.shrine, boss);
const hpN = D.shrine.hp; D.hitStructure(D.shrine, g.livingEnemies.find((e) => !e.boss) || { boss: null });
check('Der Brecher trifft den Schrein härter als andere', hpB - hpN > hpN - D.shrine.hp, [hpB - hpN, hpN - D.shrine.hp]);
const m2 = D.money; boss.inj.wound('torso', 9, 'cut', 0);
for (let i = 0; i < 400 && D.money < m2 + 100; i++) step(1);
check('Ein gefallener Anführer bringt 100 Mon und einen Erfolg', D.money >= m2 + 100 && g.ach.done.has('boss'), D.money - m2);
// the lord calls for help
for (let i = 0; i < 2000 && D.phase === 'wave'; i++) { if (i % 20 === 0) killAll(); step(1); }
g.wave = 14; D.phase = 'build'; D.startWave();
for (let i = 0; i < 300 && !D.boss; i++) step(1);
const q0 = D.queue.length; D.summonT = 0.01; step(5);
check('Fürst Akuma ruft Verstärkung', D.boss?.boss === 'lord' && D.queue.length + g.livingEnemies.length >= q0 + 1, [D.boss?.name, q0, D.queue.length]);

// ---- losing
D.shrine.hp = 1;
D.hitStructure(D.shrine, g.livingEnemies[0]);
step(90);
check('Fällt der Schrein, ist der Lauf vorbei', D.fallen && g.lost && g.runOver && D.shrine.hp === 0);
check('… und der Bildschirm sagt es', $('death').classList.contains('show') && $('death-cause').textContent.includes('SCHREIN'), $('death-cause').textContent);
check('Ein gefallener Schrein verkauft nichts mehr', D.buy('repair') === false && !visible(D.shopEl));
check('Der Rekord der Verteidigung ist gespeichert', JSON.parse(localStorage.getItem('vibesamurai.best.defense'))?.wave === 15, localStorage.getItem('vibesamurai.best.defense'));
step(420);
check('Danach beginnt ein frischer Lauf', !D.fallen && !g.runOver && D.shrine.hp === 100 && D.shrine.maxHp === 100 && g.wave === 0 && D.money === 80 && D.traps.length === 0 && D.towers.length === 0 && D.phase === 'build', [D.shrine.hp, g.wave, D.money]);

// ---- the player falling ends it too
P.iframeT = 0;
P.inj.wound('torso', 9, 'cut', 0); step(120);
check('Fällt der Spieler, ist der Lauf ebenfalls vorbei', g.runOver);
step(420);
check('… und beginnt neu', !g.runOver && P.state === 'active');

// ---- leaving: nothing of the fort stays behind
D.money = 999; at(3, 3); D.buy('spear'); D.buy('barricade'); D.buy('tower');
play('duel'); step(20);
check('Zurück im Duell ist die Festung weg', !D.on && !D.group.visible && !visible(D.hud) && !visible(D.shopEl) && D.traps.length === 0 && D.towers.length === 0);
check('… und kein Hindernis bleibt in der Physik zurück', g.world.bodies.length === duelBodies, [g.world.bodies.length, duelBodies]);
check('Im Duell kauft der Shop nichts', D.buy('spear') === false && g.npcs.every((e) => e.team === 1));
play('defense'); step(5); play('defense'); step(5); play('survival'); step(5); play('defense'); step(5);
check('Mehrfach hinein und hinaus: die Festung steht genau einmal', D.on && g.world.bodies.filter((b) => D.bodies.includes(b)).length === D.bodies.length && new Set(g.world.bodies).size === g.world.bodies.length);
