// Runs the game in headless Chrome and checks that it starts and that its mechanics work.
//   node tests/run.mjs            run the suite, exit 1 on any failure or console error
//   CHROME=/path/to/chrome ...    use a specific browser binary
// No dependencies: talks to Chrome over the DevTools protocol (needs Node 22+ for WebSocket).
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
setTimeout(() => { console.error('Zeitüberschreitung nach 4 Minuten.'); finish(3); }, 240000).unref();

let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i++) {
  await sleep(250);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
}
if (!wsUrl) { console.error('Chrome ist nicht gestartet.'); finish(2); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waits = new Map(), errors = [];
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
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
let started = false;
for (let i = 0; i < 120 && !started; i++) { await sleep(250); started = (await evaluate('!!(window.game && window.game.player)')).result?.value === true; }

let failed = 0;
const report = (ok, name, detail = '') => { if (!ok) failed++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${!ok && detail ? '  →  ' + detail : ''}`); };
report(started, 'Spiel startet (window.game vorhanden)', errors[0] || 'kein Spielobjekt nach 30 s');
if (started) {
  const body = readFileSync(join(ROOT, 'tests/suite.js'), 'utf8');
  const res = await evaluate(`(async () => { ${body} })()`);
  if (res.exceptionDetails) report(false, 'Testsuite läuft durch', res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  const partial = res.result?.value || (await evaluate('window.__checks || []')).result?.value || [];
  for (const [name, ok, detail] of partial) report(ok, name, detail);
}
const uniq = [...new Set(errors)];
report(uniq.length === 0, 'Keine Fehler in der Browser-Konsole', uniq.slice(0, 5).join(' | ').slice(0, 900));
console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : '\nAlles grün.');
finish(failed ? 1 : 0);
