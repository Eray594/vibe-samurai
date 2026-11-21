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
check('Am Ende ist alles an seinem Platz', sane() === '', sane());
