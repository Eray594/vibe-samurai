// Runs the game in headless Chrome and checks that it starts and that everything in it works.
//   node tests/run.mjs               all suites; exit 1 on any failure or console error
//   node tests/run.mjs defense fuzz  only the suites whose file name contains one of these words
//   node tests/run.mjs --list        which suites there are
//   SEED=7 node tests/run.mjs fuzz   the random-input suite with another seed (a failure names its seed)
//   CHROME=/path/to/chrome ...       use a specific browser binary
// Each suite (tests/suites/*.js) runs on a freshly loaded page with empty storage, so suites do not
// depend on each other. No dependencies: talks to Chrome over the DevTools protocol (Node 22+).
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const all = readdirSync(join(ROOT, 'tests/suites')).filter((f) => f.endsWith('.js')).sort();
if (args.includes('--list')) { for (const f of all) console.log(f.replace(/\.js$/, '')); process.exit(0); }
const words = args.filter((a) => !a.startsWith('--'));
const suites = words.length ? all.filter((f) => words.some((w) => f.includes(w))) : all;
if (!suites.length) { console.error(`Keine Suite passt auf: ${words.join(', ')}. Vorhanden: ${all.join(', ')}`); process.exit(2); }

const CHROME = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => p && existsSync(p));
if (!CHROME) { console.error('Chrome nicht gefunden. Setze CHROME=/pfad/zu/chrome.'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8900 + Math.floor(Math.random() * 400), dbg = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'vibe-samurai-test-'));
const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--window-size=1280,720',
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio', '--no-first-run', '--no-sandbox', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
const finish = (code) => { chrome.kill(); server.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch { /* still in use */ } process.exit(code); };
setTimeout(() => { console.error('Zeitüberschreitung nach 8 Minuten.'); finish(3); }, 480000).unref();

let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) {
  await sleep(250);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
}
if (!wsUrl) { console.error('Chrome ist nicht gestartet.'); finish(2); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waits = new Map();
let errors = [];
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push(d.params.entry.text + ' ' + (d.params.entry.url || ''));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result;
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

const url = `http://127.0.0.1:${port}/index.html${process.env.SEED ? '?seed=' + process.env.SEED : ''}`;
const ready = async () => {
  for (let i = 0; i < 120; i++) { await sleep(200); if ((await evaluate('!!(window.game && window.game.player && window.game.front)')).result?.value === true) return true; }
  return false;
};
/** A freshly loaded game with nothing in storage. */
const load = async (storage) => {
  await send('Page.navigate', { url });
  if (!(await ready())) return false;
  await evaluate('localStorage.clear()');
  for (const [k, v] of Object.entries(storage || {})) await evaluate(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))})`);
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url });
  return ready();
};

let failed = 0, total = 0;
const report = (ok, name, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${!ok && detail ? '  →  ' + detail : ''}`); };
const prelude = readFileSync(join(ROOT, 'tests/prelude.js'), 'utf8');
const t0 = Date.now();
for (const file of suites) {
  const name = file.replace(/\.js$/, ''), ts = Date.now();
  console.log(`\n── ${name}`);
  errors = [];
  const body = readFileSync(join(ROOT, 'tests/suites', file), 'utf8');
  // a first line "// @storage {...}" puts these values into localStorage before the game loads
  const pre = body.match(/^\/\/ @storage (.*)$/m);
  const up = await load(pre ? JSON.parse(pre[1]) : null);
  report(up, 'Spiel startet', errors[0] || 'kein Spielobjekt nach 24 s');
  if (up) {
    const res = await evaluate(`(async () => { ${prelude}\n${body}\nreturn checks; })()`);
    let list = res.result?.value;
    if (!Array.isArray(list)) list = (await evaluate('window.__checks || []')).result?.value;
    if (!Array.isArray(list)) list = [];
    for (const [n, ok, detail] of list) report(ok, n, detail);
    if (res.exceptionDetails) report(false, 'Suite läuft bis zum Ende durch', res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  const uniq = [...new Set(errors)];
  report(uniq.length === 0, 'Keine Fehler in der Browser-Konsole', uniq.slice(0, 5).join(' | ').slice(0, 900));
  console.log(`   ${((Date.now() - ts) / 1000).toFixed(1)} s`);
}
console.log(failed ? `\n${failed} von ${total} Prüfungen fehlgeschlagen.` : `\nAlles grün: ${total} Prüfungen in ${suites.length} Suiten, ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
finish(failed ? 1 : 0);
