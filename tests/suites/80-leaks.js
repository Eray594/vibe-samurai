// Nothing piles up in the graphics card or the physics when the yard is reset again and again
// (each reset rebuilds the props, the opponents and their weapons).
begin(); play('duel'); g.standoff.cancel(); step(10);
const draw = () => { g.composer.render = realRender; step(1); g.composer.render = () => {}; };
const mem = () => ({ geo: g.renderer.info.memory.geometries, tex: g.renderer.info.memory.textures, bodies: g.world.bodies.length, scene: g.scene.children.length });
g.enemyType = 'ronin';
const again = (n) => { for (let i = 0; i < n; i++) { g.resetArena(); g.standoff.cancel(); step(2); draw(); } };
again(3);
const a = mem();
again(8);
const b = mem();
// (a rōnin comes in three outfits with three weapons: a little room for that, far less than a leak of a dozen per reset)
check('Acht Resets: keine Geometrien bleiben in der Grafikkarte zurück', b.geo <= a.geo + 30, [a.geo, b.geo]);
check('Acht Resets: keine Texturen bleiben zurück', b.tex <= a.tex + 12, [a.tex, b.tex]);
check('Acht Resets: Physik und Szene sind so groß wie vorher', b.bodies === a.bodies && b.scene <= a.scene + 2, [a, b]);
// smashing everything and resetting must not leave anything either
for (const it of [...g.arena.breakables.items]) g.arena.breakables.damage(it, 9999);
step(5); draw();
again(2);
const c = mem();
check('Alles zerschlagen und zurückgesetzt: nichts bleibt zurück', c.geo <= a.geo + 30 && c.bodies === a.bodies, [a, c]);
for (let r = 0; r < 2; r++) for (const mode of ['defense', 'survival', 'versus', 'training', 'duel']) { play(mode); g.standoff.cancel(); step(3); draw(); }
g.enemyType = 'ronin'; again(1);
const d = mem();
check('Zweimal durch die Modi: nichts bleibt zurück', d.geo <= a.geo + 40 && d.bodies === a.bodies, [a, d]);
// ---- every shader is built before the first fight, none in the middle of one
{
  play('skirmish'); step(5); draw();
  const before = g.renderer.info.programs.length;
  for (const e of [...g.npcs]) g.removeNpc(e);
  ['ashigaru', 'ronin', 'samurai', 'oni', 'daimyo', 'archer', 'gunner', 'rider'].forEach((t, i) => { const e = g.spawnFighter(1, t, V(-5 + i * 1.4, 0, 0)); e.brain.update = () => {}; });
  fresh(0, 6); step(5); draw();
  g.effects.blood(V(0, 1.2, 0), V(0, 0, 1), 120, 1.2); g.effects.gore(V(0, 1, 0), V(0, 0, 1), 20); g.effects.dust(V(0, 0.98, 3), 20, 2); g.effects.sparksAt(V(0, 1, 2), 30, 1); g.effects.splinters(V(1, 1, 2), V(0, 1, 0), 20); g.effects.impact(V(0, 1, 2), 2);
  g.throwKunai(P, null, 0, 0); g.throwSmoke(P); g.fire.ignite(2, 2);
  step(40); draw();
  const e = g.npcs[0]; e.inj.wound('torso', 9, 'cut', 0); e.sever('uArmL', V(1, 0, 0), 4); step(90); draw(); e.freeze(); draw();
  for (const w of ['night', 'rain', 'snow', 'dusk']) { g.weather.set(w); step(2); draw(); }
  g.input.lmb = true; g.input.lmbPressed = true; step(3); g.input.lmb = false; step(20); draw();
  play('defense'); step(5); g.defense.money = 900; for (const k of ['spear', 'archer', 'tower', 'spikes', 'wire', 'oil', 'barricade']) g.defense.buy(k); step(5); draw();
  play('duel'); g.standoff.cancel(); step(5); draw();
  const after = g.renderer.info.programs.length;
  check('Kein Shader wird erst im Spiel übersetzt', after === before, [before, after, g.renderer.info.programs.slice(before).map((p) => (p.name || p.cacheKey.slice(0, 30))).join(' | ').slice(0, 300)]);
  const t = []; for (let i = 0; i < 6; i++) { const a = performance.now(); g.spawnFighter(1, ['ronin', 'samurai', 'oni'][i % 3]); t.push(performance.now() - a); }
  check('Ein Gegner mehr ist kein Ruckler (seine Art ist schon modelliert)', Math.max(...t) < 4, t.map((v) => +v.toFixed(2)));
}
check('Am Ende ist alles an seinem Platz', sane() === '', sane());
