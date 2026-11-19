// Takes pictures of the running game in headless Chrome, to look at models, poses and effects (the 3D view only, no HUD).
//   node tools/shot.mjs out.png "<js run in the page before the picture>"  [more out.png "<js>" pairs]
// The snippet has the test prelude (g, P, ctl, step, fresh, dummy, solo, V, K, press ...) and `view(x,y,z, tx,ty,tz)`,
// which puts the camera somewhere and keeps it there. The game loop is stepped by hand, as in the tests.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jobs = process.argv.slice(2);
if (jobs.length < 2 || jobs.length % 2) { console.error('node tools/shot.mjs out.png "<js>" ...'); process.exit(2); }
const CHROME = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8900 + Math.floor(Math.random() * 400), dbg = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'vibe-samurai-shot-'));
const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, `--window-size=${process.env.SIZE || '1280,720'}`,
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio', '--no-first-run', '--no-sandbox', 'about:blank'], { stdio: 'ignore' });
const finish = (code) => { chrome.kill(); server.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch { /* in use */ } process.exit(code); };
let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) { await sleep(250); try { wsUrl = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up */ } }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waits = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') console.error('Fehler in der Seite:', d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }));
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
for (let i = 0; i < 120; i++) { await sleep(200); if ((await evaluate('!!(window.game && window.game.player && window.game.front)')).result?.result?.value === true) break; }
const prelude = readFileSync(join(ROOT, 'tests/prelude.js'), 'utf8').replace('const checks = window.__checks = [];', 'const checks = [];')
  // (every picture runs the prelude again: keep hold of the one real render function)
  .replace('const realRender = g.composer.render.bind(g.composer);', 'const realRender = window.__realRender || (window.__realRender = g.composer.render.bind(g.composer));');
const extra = `
  const view = (x, y, z, tx, ty, tz) => { g.updateCamera = () => { g.camera.position.set(x, y, z); g.camera.lookAt(tx, ty, tz); }; };
  // the picture is read straight off the canvas in the same task that drew it (so: the 3D view, without the HUD)
  const show = () => { g.composer.render = realRender; step(1); g.composer.render = () => {}; return g.renderer.domElement.toDataURL('image/png'); };
  if (!window.__begun) { window.__begun = true; begin(); play('duel'); g.standoff?.cancel(); document.getElementById('help')?.remove(); }
`;
for (let i = 0; i < jobs.length; i += 2) {
  const res = await evaluate(`(async () => { ${prelude}\n${extra}\n${jobs[i + 1]}\n return show(); })()`);
  if (res.result?.exceptionDetails) console.error(res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text);
  const data = res.result?.result?.value;
  if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) { console.error('Kein Bild für', jobs[i]); continue; }
  writeFileSync(jobs[i], Buffer.from(data.slice(22), 'base64'));
  console.log('→', jobs[i]);
}
finish(0);
