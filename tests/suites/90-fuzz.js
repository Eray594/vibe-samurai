// Not about one feature: hammer every mode with random input and check that nothing breaks, nobody
// leaves the yard, no number turns into NaN and nothing is left behind when a mode is left.
begin(); step(20);
const seed0 = Number(new URLSearchParams(location.search).get('seed')) || 12345;
let seed = seed0;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const HOLD = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'KeyB'];
const TAP = ['Space', 'KeyF', 'KeyG', 'KeyQ', 'KeyC', 'KeyX', 'KeyY', 'KeyL', 'KeyV', 'Tab', 'KeyE', 'ShiftLeft', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7',
  'Digit8', 'Digit9', 'Digit0', 'KeyR', 'KeyT', 'KeyJ', 'Enter', 'KeyK', 'KeyU', 'KeyO', 'KeyH', 'KeyZ', 'KeyP', 'KeyN'];
const baseBodies = (() => { play('duel'); step(10); return g.world.bodies.length; })();
const baseScene = g.scene.children.length;

const hammer = (mode, frames) => {
  play(mode); step(5);
  if (g.defense.active) g.defense.money = 2000;
  let bad = '';
  for (let i = 0; i < frames && !bad; i++) {
    if (i % 5 === 0) {
      for (const k of HOLD) { if (rnd() < 0.3) K.add(k); else K.delete(k); }
      if (rnd() < 0.5) press(TAP[Math.floor(rnd() * TAP.length)]);
      g.input.lmb = rnd() < 0.35; if (g.input.lmb && rnd() < 0.7) g.input.lmbPressed = true;
      g.input.rmb = rnd() < 0.25; if (g.input.rmb && rnd() < 0.7) g.input.rmbPressed = true;
      g.input.dx += (rnd() - 0.5) * 300; g.input.dy += (rnd() - 0.5) * 120;
      if (rnd() < 0.05) g.input.wheel += rnd() < 0.5 ? 100 : -100;
      if (rnd() < 0.01) press('Backspace');
    }
    if (i % 211 === 0 && i) { g.input.locked = false; step(3); g.input.locked = true; }      // a pause in the middle of things
    try { step(1); } catch (err) { bad = `Ausnahme in Bild ${i}: ${err.stack || err}`; }
    if (!bad && i % 20 === 0) { bad = sane(); if (bad) bad += ` (Bild ${i})`; }
  }
  K.clear(); g.input.lmb = g.input.rmb = false;
  if (g.slowmo) g.toggleSlowmo();
  check(`Zufallseingaben im Modus „${mode}“: nichts bricht`, bad === '', `${bad} · SEED=${seed0}`);
  check(`… und der Modus ist noch derselbe`, g.mode === mode, g.mode);
};
for (const mode of ['duel', 'skirmish', 'survival', 'chaos', 'versus', 'training', 'defense', 'daily', 'tutorial']) hammer(mode, mode === 'chaos' ? 700 : 1000);

// ---- leaving modes leaves nothing behind
if (g.mainMenu || !g.started) { g.started = true; g.input.locked = true; }
g.weather.set('dusk');
play('duel'); step(30);
check('Nach allen Modi: zurück im Duell stehen wieder genau so viele Körper in der Physik wie am Anfang', g.world.bodies.length === baseBodies, [g.world.bodies.length, baseBodies]);
check('Nach allen Modi: die Szene ist nicht gewachsen', g.scene.children.length <= baseScene + 2, [g.scene.children.length, baseScene]);
await new Promise((r) => setTimeout(r, 1400));          // callouts take themselves away after a good second of real time
check('Nach allen Modi: keine verwaisten Namensschilder oder Meldungen', $('labels').children.length <= g.npcs.length && $('callouts').children.length === 0, [$('labels').children.length, $('callouts').children.length]);
check('Nach allen Modi: Tafeln der anderen Modi sind zu', !visible($('def-hud')) && !visible($('def-shop')) && !visible($('tutor')) && !visible($('drill')));
for (let r = 0; r < 3; r++) for (const mode of ['defense', 'survival', 'tutorial', 'daily', 'versus', 'training', 'chaos', 'duel']) { play(mode); step(3); }
step(30);
check('Dreimal reihum durch alle Modi: weiterhin nichts zurückgeblieben', g.world.bodies.length === baseBodies && sane() === '', [g.world.bodies.length, baseBodies, sane()]);
g.composer.render = realRender; step(3);
check('Am Ende wird noch gezeichnet', sane() === '');
