// Put in front of every suite (all of it is the body of one async function running inside the page).
// Drives the game loop by hand at a fixed 60 Hz with rendering switched off, so thousands of frames
// take a few seconds and the result does not depend on how fast the machine is.
const g = window.game;
const checks = window.__checks = [];
const check = (name, ok, detail) => checks.push([name, !!ok, detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)]);
g.renderer.setAnimationLoop(null);
g.clock.getDelta = () => 1 / 60;
const realRender = g.composer.render.bind(g.composer);
g.composer.render = () => {};
const $ = (id) => document.getElementById(id);
const step = (n = 1) => { for (let i = 0; i < n; i++) g.frame(); };
const press = (c) => g.input.pressed.add(c);
/** Press a key and let the game see it. */
const tap = (c, frames = 1) => { press(c); step(frames); };
const P = g.player, ctl = g.ctl, K = g.input.keys;
const V = (x, y, z) => P.getPos().set(x, y, z);
const solo = (type, pos) => { for (const e of [...g.npcs]) g.removeNpc(e); return type ? g.spawnFighter(1, type, pos) : null; };
const dummy = (type, pos) => { const e = solo(type, pos); e.brain.update = () => {}; return e; };
// (time runs normally again too: slow motion left over from the last test would stretch everything that follows)
const fresh = (x = 0, z = 4, yaw = 0) => { K.clear(); g.input.lmb = g.input.rmb = false; g.slowT = 0; g.hitStopT = 0; g.timeScale = 1; g.keptInput = null; P.resetTo(V(x, 0, z), 0); ctl.reset(); ctl.setStance(1); ctl.yaw = yaw; ctl.faceYaw = yaw; g.perfectCd = 0; step(5); };
/** Past the main menu, as if a mode had been picked and the mouse caught; nothing saved from earlier. */
const begin = () => { try { localStorage.clear(); } catch { /* no storage */ } g.progress.wipe(); g.settings.set('diff', 'normal'); g.input.locked = true; g.started = true; };
/** Start a mode the way the main menu does, without needing a real mouse. */
const play = (mode) => { g.play(mode); g.input.locked = true; g.started = true; };
const visible = (el) => !!el && getComputedStyle(el).display !== 'none';
/** What must hold at any moment, whatever just happened: '' when all is well, else what is wrong. */
const sane = () => {
  for (const k of g.fighters) {
    const p = k.state === 'active' ? k.core.position : k.parts.torso.position;
    if (![p.x, p.y, p.z].every(Number.isFinite)) return `${k.name}: Position ist keine Zahl`;
    // on a map with an edge, whoever is out over it (or has fallen) may be anywhere below, down to where the fallen are left
    if (g.arena.abyss && (k.fell || !g.arena.solidAt(p.x, p.z))) { if (p.y < -41 || p.y > 14 || Math.hypot(p.x, p.z) > 60) return `${k.name}: im Abgrund verloren (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`; continue; }
    if (Math.hypot(p.x, p.z) > 16.5) return `${k.name}: außerhalb des Hofs (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
    if (p.y < -1.5 || p.y > 14) return `${k.name}: Höhe ${p.y.toFixed(1)}`;
    if (!Number.isFinite(k.posture)) return `${k.name}: Haltung ist keine Zahl`;
  }
  if (!Number.isFinite(g.time) || !Number.isFinite(g.timeScale)) return 'Spielzeit ist keine Zahl';
  if (![g.camera.position.x, g.camera.position.y, g.camera.position.z].every(Number.isFinite)) return 'Kamera-Position ist keine Zahl';
  return '';
};
