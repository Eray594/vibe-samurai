// Plays the game as a player's browser does: the real frame loop on the real clock, real key and mouse events,
// the real graphics card — and measures every frame. For what stepping the game by hand cannot show:
// hitches, things that only go wrong at speed, errors that stop the loop.
//   node tools/live.mjs                          the standard session: a crowded chaos run with running, dodging, jumping
//   node tools/live.mjs --mode survival --seconds 30 --map cliff
//   node tools/live.mjs --script "<js>"          a script of your own (see `plan` below): returns a list of [second, action]
//   SOFT=1 node tools/live.mjs                   on the software renderer (as on CI), not the graphics card
// Prints: frame rate, the slowest frames and what was happening in them, the player's top speed and height,
// how often he left the ground or the yard, every error. Exit code 1 if a frame took longer than --limit ms
// (default 50) after the first two seconds, or if there was an error.
// Actions: 'down:KeyW' 'up:KeyW' 'tap:Space' 'lmb' 'rmb:0.4' (held that long) 'eval:<js>'.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1]; };
const MODE = flag('--mode', 'chaos'), SECONDS = Number(flag('--seconds', 40)), MAP = flag('--map', ''), LIMIT = Number(flag('--limit', 50));
const CHROME = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!CHROME) { console.error('Chrome nicht gefunden. Setze CHROME=/pfad/zu/chrome.'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8900 + Math.floor(Math.random() * 400), dbg = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'vibe-samurai-live-'));
const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--window-size=1280,720',
  ...(process.env.SOFT ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']),
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--mute-audio', '--no-first-run', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
const finish = (code) => { chrome.kill(); server.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch { /* in use */ } process.exit(code); };
setTimeout(() => { console.error('Zeitüberschreitung.'); finish(3); }, (SECONDS + 90) * 1000).unref();
let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) { await sleep(250); try { wsUrl = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up */ } }
if (!wsUrl) { console.error('Chrome ist nicht gestartet.'); finish(2); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waits = new Map(), errors = [];
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result;
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html${MAP ? '?map=' + MAP : ''}` });
for (let i = 0; i < 150; i++) { await sleep(200); if ((await evaluate('!!(window.game && window.game.front)')).result?.value === true) break; }

// ---- in the page: start the mode as the menu does, keep the mouse "caught", and note every frame
await evaluate(`(() => {
  const g = window.game;
  g.play(${JSON.stringify(MODE)}); g.input.locked = true; g.started = true; g.standoff?.cancel();
  document.addEventListener('pointerlockchange', () => { g.input.locked = true; });
  const R = window.__rec = { frames: [], t0: performance.now(), top: 0, high: 0, air: 0, out: 0, falls: 0, cries: 0, last: performance.now(), prev: {}, late: [], progs: g.renderer.info.programs.length };
  const cry = g.audio.cry?.bind(g.audio); if (cry) g.audio.cry = (...a) => { const ok = cry(...a); if (ok) R.cries++; return ok; };
  const frame = g.frame.bind(g);
  g.frame = () => {
    const a = performance.now(), gap = a - R.last; R.last = a;
    frame();
    const b = performance.now(), P = g.player, act = P.state === 'active';
    const sp = act ? Math.hypot(P.core.velocity.x, P.core.velocity.z) : 0, y = act ? P.core.position.y : 0;
    if (sp > R.top) R.top = sp; if (y > R.high) R.high = y;
    const np = g.renderer.info.programs.length;
    if (np > R.progs) { R.late.push([+((a - R.t0) / 1000).toFixed(1), np - R.progs, g.renderer.info.programs.slice(R.progs).map((p) => p.name || p.cacheKey.slice(0, 40)).join(' | ').slice(0, 160)]); R.progs = np; }
    const now = { n: g.npcs.length, air: !!P.airborne, state: P.state, corpses: g.corpses.length, q: g.quality.level };
    if (now.air && !R.prev.air) R.air++;
    if (P.fell && !R.prev.fell) R.falls++;
    if (act && Math.hypot(P.core.position.x, P.core.position.z) > 14.4 && !g.arena.abyss) R.out++;
    R.frames.push([+(a - R.t0).toFixed(0), +gap.toFixed(1), +(b - a).toFixed(1), now.n - (R.prev.n ?? now.n), now.air !== R.prev.air ? (now.air ? 'jump' : 'land') : '', now.q !== (R.prev.q ?? now.q) ? 'quality ' + R.prev.q + '>' + now.q : '', +sp.toFixed(1)]);
    R.prev = { ...now, fell: P.fell };
  };
  g.renderer.setAnimationLoop(() => g.frame());
})()`);

// ---- the plan: what is pressed when
const custom = flag('--script', '');
let plan = [];
if (custom) plan = (await evaluate(`(() => { ${custom} })()`)).result?.value || [];
else {
  let seed = 9; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  plan.push([0.1, 'eval:game.runT = 150; game.player.iframeT = 0']);                     // late in a chaos run: they pour in
  plan.push([0.2, 'down:KeyW']);
  for (let t = 8; t < SECONDS; t += 7) plan.push([t, 'eval:game.weather.next(); if (game.defense.active && game.defense.phase === "build") { game.defense.money = 900; for (const k of ["spear", "archer", "tower", "spikes", "oil", "barricade"]) game.defense.buy(k); game.defense.startWave(); }']);
  for (let t = 1; t < SECONDS; t += 0.25) {
    const r = rnd();
    if (r < 0.2) plan.push([t, 'tap:ShiftLeft']);
    else if (r < 0.3) plan.push([t, 'down:ShiftLeft'], [t + 1.2, 'up:ShiftLeft']);
    else if (r < 0.42) plan.push([t, 'tap:Space']);
    else if (r < 0.6) plan.push([t, 'lmb']);
    else if (r < 0.66) plan.push([t, 'rmb:0.5']);
    else if (r < 0.74) plan.push([t, rnd() < 0.5 ? 'down:KeyA' : 'down:KeyD'], [t + 0.6, 'up:KeyA'], [t + 0.6, 'up:KeyD']);
    else if (r < 0.8) plan.push([t, 'tap:KeyQ']);
    else if (r < 0.85) plan.push([t, 'tap:KeyF']);
    else if (r < 0.88) plan.push([t, 'tap:KeyY']);
    else if (r < 0.9) plan.push([t, 'tap:KeyX']);
    if (Math.floor(t) % 4 === 0 && t % 1 === 0) plan.push([t, 'eval:game.player.iframeT = 2.5; game.ctl.yaw += 1.3; if (game.player.state !== "active") { game.player.resetTo(game.player.getPos().set(0,0,4)); game.ctl.reset(); }']);
  }
}
plan.sort((a, b) => a[0] - b[0]);
const VK = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, Space: 32, ShiftLeft: 16, KeyF: 70, KeyQ: 81, KeyX: 88, KeyG: 71, KeyB: 66, KeyC: 67, KeyY: 89 };
const key = (type, code) => send('Input.dispatchKeyEvent', { type, code, key: code === 'Space' ? ' ' : code.startsWith('Key') ? code.slice(3).toLowerCase() : code.replace(/Left|Right/, ''), windowsVirtualKeyCode: VK[code] || 0 });
const mouse = (type, button) => send('Input.dispatchMouseEvent', { type, x: 640, y: 420, button, clickCount: 1 });
const start = Date.now();
for (const [t, action] of plan) {
  const wait = t * 1000 - (Date.now() - start);
  if (wait > 0) await sleep(wait);
  const [what, arg] = [action.slice(0, action.indexOf(':') < 0 ? action.length : action.indexOf(':')), action.indexOf(':') < 0 ? '' : action.slice(action.indexOf(':') + 1)];
  if (what === 'down') key('rawKeyDown', arg);
  else if (what === 'up') key('keyUp', arg);
  else if (what === 'tap') { key('rawKeyDown', arg); setTimeout(() => key('keyUp', arg), 60); }
  else if (what === 'lmb') { mouse('mousePressed', 'left'); setTimeout(() => mouse('mouseReleased', 'left'), 70); }
  else if (what === 'rmb') { mouse('mousePressed', 'right'); setTimeout(() => mouse('mouseReleased', 'right'), (Number(arg) || 0.3) * 1000); }
  else if (what === 'eval') evaluate(arg);
}
const rest = SECONDS * 1000 - (Date.now() - start);
if (rest > 0) await sleep(rest);

const R = (await evaluate('JSON.stringify(window.__rec)')).result?.value;
if (!R) { console.error('Keine Aufzeichnung.'); finish(2); }
const rec = JSON.parse(R), fr = rec.frames.filter((f) => f[0] > 2000);
const gaps = fr.map((f) => f[1]).sort((a, b) => a - b), work = fr.map((f) => f[2]).sort((a, b) => a - b);
const pct = (list, p) => list[Math.min(list.length - 1, Math.floor(list.length * p))] ?? 0;
const slow = fr.filter((f) => f[1] > Math.max(LIMIT * 0.5, pct(gaps, 0.5) * 2.5)).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(`${MODE}${MAP ? ' auf ' + MAP : ''}, ${SECONDS} s, ${fr.length} Bilder: ${(1000 / (pct(gaps, 0.5) || 1)).toFixed(0)} Bilder/s im Mittel`);
console.log(`  Abstand zwischen Bildern: Mitte ${pct(gaps, 0.5)} ms · 99 % unter ${pct(gaps, 0.99)} ms · längster ${gaps[gaps.length - 1]} ms`);
console.log(`  Arbeit je Bild:           Mitte ${pct(work, 0.5)} ms · 99 % unter ${pct(work, 0.99)} ms · längste ${work[work.length - 1]} ms`);
console.log(`  Spieler: Höchsttempo ${rec.top.toFixed(1)} m/s · höchster Punkt ${rec.high.toFixed(1)} m · ${rec.air} Sprünge · ${rec.out} Bilder außerhalb des Hofs · ${rec.falls} Abstürze · ${rec.cries} Stimmen`);
if (rec.late.length) { console.log(`  Shader erst im Spiel übersetzt (${rec.late.reduce((n, l) => n + l[1], 0)}):`); for (const l of rec.late.slice(0, 10)) console.log(`    ${String(l[0]).padStart(5)} s  +${l[1]}  ${l[2]}`); }
if (slow.length) { console.log('  Langsamste Bilder (Sekunde, Abstand, Arbeit, was sich änderte):'); for (const f of slow) console.log(`    ${(f[0] / 1000).toFixed(1).padStart(5)} s  ${String(f[1]).padStart(6)} ms  ${String(f[2]).padStart(6)} ms  ${[f[3] ? (f[3] > 0 ? '+' : '') + f[3] + ' Kämpfer' : '', f[4], f[5]].filter(Boolean).join(', ')}`); }
const uniq = [...new Set(errors)];
if (uniq.length) { console.log(`  FEHLER (${errors.length}):`); for (const e of uniq.slice(0, 8)) console.log('    ' + String(e).split('\n').slice(0, 3).join(' | ').slice(0, 300)); }
const bad = uniq.length > 0 || gaps[gaps.length - 1] > LIMIT || rec.late.length > 0;
console.log(bad ? '  → nicht flüssig oder nicht fehlerfrei.' : '  → flüssig und fehlerfrei.');
finish(bad ? 1 : 0);
