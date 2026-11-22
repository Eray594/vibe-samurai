// Looks at the game: renders a fixed set of scenes (both maps, every weather, the modes, menus, the phone
// layout, a small window) as pictures of the whole page, HUD included, and compares two such sets.
//   node tools/look.mjs                      all scenes into .look/now/
//   node tools/look.mjs before               ... into .look/before/
//   node tools/look.mjs now perks phone      only the scenes whose name contains one of these words
//   node tools/look.mjs --diff before now    which scenes differ, and by how much (a changed pixel: any channel off by > 24)
//   node tools/look.mjs --film fall --js "<js>" [--frames 6] [--every 8] [--size 640x360]
//                                            a film strip into .look/film/: the snippet starts something, then a picture every few frames
//   node tools/look.mjs --list               the scenes there are
//   GPU=1 node tools/look.mjs ...            on the real graphics card instead of the software renderer (to measure frame times)
//   node tools/look.mjs --eval "<js>" [--map cliff] [--size 844x390] [--touch] [--png out.png]
//                                            run a snippet in the game (test prelude available) and print what it returns
// Chance is seeded anew for every scene, so the same code draws the same picture and a difference means a change.
// The usual way to work: `look.mjs before` → change the code → `look.mjs now` → `look.mjs --diff before now`,
// then open the pictures that differ. Snippets have the test prelude (g, P, ctl, step, fresh, dummy, play ...),
// `view(x,y,z, tx,ty,tz)` to fix the camera and `free()` to give it back.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.look');
const KILL = "for (const e of g.livingEnemies) e.inj.wound('torso', 9, 'cut', 0); step(300);";
const DUEL = "begin(); play('duel'); g.standoff.cancel(); step(40);";
// [name, snippet]; a group is one page load: { map, size, touch }
const GROUPS = [
  { key: 'yard', scenes: [
    ['menu', ''],
    ['duel-hud', DUEL + 'g.setHelp(true); step(2);'],
    ['duel-nohelp', DUEL],
    ['yard-overview', DUEL + 'view(0,7,13, 0,1,0); step(2);'],
    ['fighters', DUEL + "fresh(0,1.6); dummy('samurai', V(0,0,-0.6)); step(30); view(2.2,1.5,2.6, 0,1.1,0.4); step(2);"],
    ['types', DUEL + "for (const e of [...g.npcs]) g.removeNpc(e); ['ashigaru','ronin','samurai','oni','daimyo','archer','gunner'].forEach((t, i) => { const e = g.spawnFighter(1, t, V(-4.5 + i * 1.5, 0, 0)); e.brain.update = () => {}; e.intent.yaw = Math.PI; }); fresh(0, 9); step(40); view(0,1.7,5.2, 0,1.1,0); step(2);"],
    ['podium', DUEL + 'P.core.velocity.set(0,0,0); P.core.position.set(-8.1,3.58,1.4); step(30); g.effects.dust(P.getPos(), 18, 1.8); step(8); view(-3.5,3.6,6, -8.1,2.4,1.4); step(1);'],
    ['night', DUEL + "g.weather.set('night'); view(0,3,10, 0,1.2,0); step(3);"],
    ['rain', DUEL + "g.weather.set('rain'); view(0,3,10, 0,1.2,0); step(3);"],
    ['snow', DUEL + "g.weather.set('snow'); view(0,3,10, 0,1.2,0); step(3);"],
    ['blood', DUEL + "fresh(0,1.6); const e = dummy('ronin', V(0,0,-0.4)); step(10); e.inj.wound('torso', 9, 'cut', 0); g.effects.blood(V(0,1.2,-0.4), V(0.3,0.2,1), 160, 1.4); step(70); view(2.5,2,3, 0,0.4,0); step(1);"],
    ['sheathed', DUEL + "for (const e of [...g.npcs]) g.removeNpc(e); fresh(0,2); step(240); view(-1.6,1.3,0.2, 0,0.95,2); step(1);"],
    ['sheathed-back', DUEL + "for (const e of [...g.npcs]) g.removeNpc(e); fresh(0,2); step(240); view(-0.9,1.5,4.6, 0,0.9,2); step(1);"],
    ['arrows', DUEL + "fresh(0,2); const e = dummy('archer', V(0,0,-8)); step(5); for (const [x, y] of [[0.05,1.35],[-0.08,1.15],[0.1,0.75]]) { const w = g.launch('arrow', e, V(x,y,-2).clone(), V(0,0,1).clone(), 30); P.iframeT = 0; g.bodyHit(w, P.core.hs, { other: P.core, shape: P.core.shapes[y < 0.9 ? 3 : 1], wshape: { hsPart: 'blade' }, point: V(x,y,1.86).clone(), rel: V(0,0,30).clone(), speed: 30 }); } P.inj.reset(); P.posture = 0; P.brokenT = 0; P.staggerT = 0; step(40); view(1.3,1.4,0.2, 0,1,2); step(1);"],
    ['dodge', DUEL + "for (const e of [...g.npcs]) g.removeNpc(e); fresh(0,2); K.add('KeyD'); tap('ShiftLeft', 1); step(5); K.clear(); view(0.6,1.5,6.2, 0.8,1,2); step(1);"],
    ['roll', DUEL + "for (const e of [...g.npcs]) g.removeNpc(e); fresh(0,2); K.add('KeyD'); tap('ShiftLeft', 1); step(3); tap('ShiftLeft', 1); step(8); K.clear(); view(1.5,1.5,6.2, 1.8,0.9,2); step(1);"],
    ['corpse-fresh', DUEL + "fresh(0,6); const e = dummy('samurai', V(0,0,0)); step(10); e.inj.wound('torso', 9, 'cut', 0); e.sever('fArmL', V(1,0,0), 4); step(200); view(2.6,1.7,2.6, 0,0.2,0); step(1);"],
    ['corpse-frozen', DUEL + "fresh(0,6); const e = dummy('samurai', V(0,0,0)); step(10); e.inj.wound('torso', 9, 'cut', 0); e.sever('fArmL', V(1,0,0), 4); step(200); e.freeze(); e.setShadow(false); view(2.6,1.7,2.6, 0,0.2,0); step(1);"],
    ['downed', DUEL + "fresh(0.8,0.2); const e = dummy('ronin', V(0,0,0)); step(10); e.sever('shinR', V(1,0,0), 4); e.inj.amputate('legR'); e.inj.bleeding = 0.3; step(260); P.core.position.set(e.ragBodies.torso.position.x + 0.7, 0.98, e.ragBodies.torso.position.z); e.groundCd = 0; step(22); view(2.8,1.6,2.8, 0.3,0.4,0); step(1);"],
    ['crowd', "begin(); play('skirmish'); step(5); for (let i = 0; i < 9; i++) g.spawnFighter(1, ['ronin','samurai','ashigaru'][i % 3]); P.iframeT = 99; step(60); view(0,6,13, 0,1,0); step(2);"],
    ['survival-perks', "begin(); play('survival'); step(5);" + KILL],
    ['defense-build', "begin(); play('defense'); step(40);"],
    ['defense-wave', "begin(); play('defense'); step(10); g.defense.money = 900; for (const k of ['spear','archer','tower','spikes']) g.defense.buy(k); g.defense.startWave(); step(240);"],
    ['daily', "begin(); play('daily'); step(40);"],
    ['training', "begin(); play('training'); step(40);"],
    ['tutorial', "begin(); play('tutorial'); step(40);"],
    ['versus', "begin(); play('versus'); step(60);"],
    ['pause', DUEL + 'g.input.locked = false; step(3);'],
    ['dojo', DUEL + 'g.input.locked = false; step(2); g.menu.toggle(true);'],
    ['death', "begin(); play('survival'); step(5); P.inj.wound('torso', 9, 'cut', 0); step(150);"],
    ['english-hud', DUEL + "g.i18n.set('en'); step(2); await new Promise((r) => setTimeout(r, 30));"],
  ] },
  { key: 'small', size: [1024, 600], scenes: [
    ['duel-hud', DUEL + 'g.setHelp(true); step(2);'],
    ['survival-perks', "begin(); play('survival'); step(5);" + KILL],
    ['defense-build', "begin(); play('defense'); step(40);"],
  ] },
  { key: 'phone', size: [844, 390], touch: true, scenes: [
    ['menu', ''],
    ['play', "begin(); play('survival'); step(40);"],
    ['perks', "begin(); play('survival'); step(5);" + KILL],
    ['defense-build', "begin(); play('defense'); step(40);"],
    ['pause', "begin(); play('survival'); step(20); g.touch.release(); g.input.locked = false; step(3);"],
  ] },
  { key: 'cliff', map: 'cliff', scenes: [
    ['duel-hud', DUEL],
    ['overview', DUEL + 'view(0,9,17, 0,1,-2); step(2);'],
    ['gap', DUEL + 'fresh(9,-9); view(6,3,-4, 12.5,0.5,-12.5); step(3);'],
    ['bell', DUEL + 'fresh(0,4); view(-1,3.2,9, 2,1.5,-3); step(3);'],
    ['boulder', DUEL + 'P.core.velocity.set(0,0,0); P.core.position.set(-7.1,3.58,4.7); step(30); g.effects.dust(P.getPos(), 18, 1.8); step(8); view(-2.5,3.6,9.5, -7.1,2.2,4.7); step(1);'],
    ['defense', "begin(); play('defense'); step(40); view(0,14,16, 0,0,0); step(2);"],
    ['snow', DUEL + "g.weather.set('snow'); view(0,5,15, 0,1.5,-3); step(3);"],
    ['night', DUEL + "g.weather.set('night'); view(0,5,15, 0,1.5,-3); step(3);"],
  ] },
];

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
if (has('--list')) { for (const g of GROUPS) for (const [n] of g.scenes) console.log(`${g.key}-${n}`); process.exit(0); }

const CHROME = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!CHROME) { console.error('Chrome nicht gefunden. Setze CHROME=/pfad/zu/chrome.'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8900 + Math.floor(Math.random() * 400), dbg = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'vibe-samurai-look-'));
const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--window-size=1280,720',
  ...(process.env.GPU ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']), '--mute-audio', '--no-first-run', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
const finish = (code) => { chrome.kill(); server.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch { /* in use */ } process.exit(code); };
setTimeout(() => { console.error('Zeitüberschreitung.'); finish(3); }, 600000).unref();
let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) { await sleep(250); try { wsUrl = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up */ } }
if (!wsUrl) { console.error('Chrome ist nicht gestartet.'); finish(2); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waits = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') console.error('Fehler in der Seite:', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.error('console.error:', d.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result;
await send('Runtime.enable'); await send('Page.enable');

// ---- comparing two sets of pictures (the browser decodes them)
if (has('--diff')) {
  const [a, b] = args.map((d) => (existsSync(d) ? d : join(OUT, d)));
  if (!a || !b || !existsSync(a) || !existsSync(b)) { console.error('node tools/look.mjs --diff <ordner> <ordner>'); finish(2); }
  const names = [...new Set([...readdirSync(a), ...readdirSync(b)])].filter((f) => f.endsWith('.png')).sort();
  let changed = 0;
  for (const f of names) {
    if (!existsSync(join(a, f)) || !existsSync(join(b, f))) { console.log(`  nur in ${existsSync(join(a, f)) ? a : b}:  ${f}`); changed++; continue; }
    const A = readFileSync(join(a, f)).toString('base64'), B = readFileSync(join(b, f)).toString('base64');
    const res = await evaluate(`(async () => {
      const load = async (s) => createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob());
      const [x, y] = await Promise.all([load(${JSON.stringify(A)}), load(${JSON.stringify(B)})]);
      if (x.width !== y.width || x.height !== y.height) return { size: [x.width, x.height, y.width, y.height] };
      const px = (im) => { const c = new OffscreenCanvas(im.width, im.height), g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
      const p = px(x), q = px(y);
      let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < p.length; i += 4) {
        if (Math.abs(p[i] - q[i]) > 24 || Math.abs(p[i + 1] - q[i + 1]) > 24 || Math.abs(p[i + 2] - q[i + 2]) > 24) {
          n++; const k = i / 4, cx = k % x.width, cy = (k / x.width) | 0;
          if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
        }
      }
      return { share: n / (p.length / 4), box: n ? [x0, y0, x1, y1] : null };
    })()`);
    const v = res.result?.value;
    if (!v) { console.log(`  ?  ${f}`); continue; }
    if (v.size) { console.log(`  andere Größe  ${f}  ${v.size[0]}×${v.size[1]} → ${v.size[2]}×${v.size[3]}`); changed++; continue; }
    if (v.share > 0.004) { changed++; console.log(`  ${(v.share * 100).toFixed(1).padStart(5)} %  ${f}   (Bereich ${v.box[0]},${v.box[1]} – ${v.box[2]},${v.box[3]})`); }
  }
  console.log(changed ? `${changed} von ${names.length} Bildern anders.` : `Alle ${names.length} Bilder gleich.`);
  finish(0);
}

// chance that repeats: every scene starts the same stream again
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let a = 1; window.__seed = (n) => { a = n >>> 0; };
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();` });
const prelude = readFileSync(join(ROOT, 'tests/prelude.js'), 'utf8').replace('const checks = window.__checks = [];', 'const checks = [];')
  .replace('const realRender = g.composer.render.bind(g.composer);', 'const realRender = window.__realRender || (window.__realRender = g.composer.render.bind(g.composer));');
const extra = `
  if (!window.__cam) window.__cam = g.updateCamera;
  const view = (x, y, z, tx, ty, tz) => { g.updateCamera = () => { g.camera.position.set(x, y, z); g.camera.lookAt(tx, ty, tz); }; };
  const free = () => { g.updateCamera = window.__cam; };
  const draw = () => { g.composer.render = realRender; step(1); g.composer.render = () => {}; };
`;
const open = async ({ map, size = [1280, 720], touch }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
  const q = [map ? 'map=' + map : '', touch ? 'touch' : ''].filter(Boolean).join('&');
  // (nothing kept from the page before: not its language, not its settings)
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/serve.mjs` });
  await evaluate('try { localStorage.clear(); } catch {}');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html${q ? '?' + q : ''}` });
  for (let i = 0; i < 300; i++) { await sleep(200); if ((await evaluate('!!(window.game && window.game.player && window.game.front)')).result?.value === true) return; }
  console.error('Das Spiel ist nicht gestartet.'); finish(2);
};
const run = async (js) => {
  const res = await evaluate(`(async () => { ${prelude}\n${extra}\nfree(); window.__seed(7); try { localStorage.clear(); } catch {}\n g.menu.toggle(false); if (g.i18n.lang !== 'de') g.i18n.set('de'); g.setHelp(false); if (g.slowmo) g.toggleSlowmo(); if (g.weather.key !== 'dusk' && g.mode !== 'daily') g.weather.set('dusk');\n const __r = await (async () => { ${js} })(); draw(); return __r === undefined ? null : __r; })()`);
  if (res.exceptionDetails) console.error('Fehler im Schnipsel:', res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result?.value;
};
const shoot = async (file) => {
  await sleep(120);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (!shot.result?.data) { console.error('Kein Bild für', file); return; }
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
};

const js = flag('--eval');
if (js !== null) {
  const size = (flag('--size') || '1280x720').split('x').map(Number), map = flag('--map'), png = flag('--png');
  await open({ map, size, touch: has('--touch') });
  const v = await run(js);
  if (v !== null && v !== undefined) console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  if (png) { await shoot(resolve(png)); console.log('→', png); }
  finish(0);
}

// a film strip: the snippet sets something going (and the camera), then a picture every few frames
const film = flag('--film');
if (film !== null) {
  const frames = Number(flag('--frames') || 6), every = Number(flag('--every') || 8), size = (flag('--size') || '640x360').split('x').map(Number), setup = flag('--js') || '';
  await open({ map: flag('--map'), size, touch: false });
  const fdir = join(OUT, 'film'); mkdirSync(fdir, { recursive: true });
  await run(setup);
  for (let i = 0; i < frames; i++) {
    await shoot(join(fdir, `${film}-${String(i).padStart(2, '0')}.png`));
    await evaluate(`(async () => { ${prelude}\n const draw = () => { g.composer.render = realRender; step(1); g.composer.render = () => {}; }; step(${every - 1}); draw(); })()`);
  }
  console.log(`${frames} Bilder in ${fdir} (${film}-00 …)`);
  finish(0);
}

const dir = join(OUT, args[0] && !args[0].startsWith('-') ? args[0] : 'now'), words = args.slice(1);
mkdirSync(dir, { recursive: true });
let n = 0;
for (const grp of GROUPS) {
  const scenes = grp.scenes.filter(([name]) => !words.length || words.some((w) => `${grp.key}-${name}`.includes(w)));
  if (!scenes.length) continue;
  await open(grp);
  for (const [name, snippet] of scenes) { await run(snippet); await shoot(join(dir, `${grp.key}-${name}.png`)); n++; }
}
console.log(`${n} Bilder in ${dir}`);
finish(0);
