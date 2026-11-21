// Runs the game in headless Chrome and checks that it starts and that everything in it works.
//   node tests/run.mjs               all suites; exit 1 on any failure or console error
//   node tests/run.mjs defense fuzz  only the suites whose file name contains one of these words
//   node tests/run.mjs --changed     only the suites that cover the files changed since the last commit (all, if unsure)
//   node tests/run.mjs --list        which suites there are
//   JOBS=1 node tests/run.mjs        how many browsers work side by side (default: half the cores, at most 4)
//   SEED=7 node tests/run.mjs fuzz   the random-input suite with another seed (a failure names its seed)
//   CHROME=/path/to/chrome ...       use a specific browser binary
// Each suite (tests/suites/*.js) runs on a freshly loaded page with empty storage, so suites do not
// depend on each other, and each browser has a profile of its own, so they do not share storage either.
// No dependencies: talks to Chrome over the DevTools protocol (Node 22+).
// First lines a suite may carry:
//   // @storage {json}          values put into localStorage before the game loads
//   // @body other.js           run that suite's checks here too (the same checks on a page loaded differently)
//   // @viewport 1024x600 [touch]   the size of the page (and the touch controls switched on)
import { spawn, execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const all = readdirSync(join(ROOT, 'tests/suites')).filter((f) => f.endsWith('.js')).sort();
if (args.includes('--list')) { for (const f of all) console.log(f.replace(/\.js$/, '')); process.exit(0); }

// Which suites look at which source files. A changed file that is not listed here means: run everything.
const COVERS = {
  'defense.js': ['defense', 'fuzz', 'layout'], 'goals.js': ['goals', 'rules', 'menu'], 'meta.js': ['menu', 'goals', 'rules', 'core'],
  'front.js': ['menu', 'language', 'layout'], 'i18n.js': ['language', 'english'], 'lang-en.js': ['language', 'english'],
  'cliff.js': ['cliff'], 'cliffscape.js': ['cliff'], 'maps.js': ['cliff', 'menu'], 'extras.js': ['core', 'menu', 'rules', 'fuzz'],
  'breakables.js': ['core', 'leaks', 'fuzz'], 'mount.js': ['core', 'fuzz'], 'world.js': ['core', 'rules', 'human', 'fuzz'], 'effects.js': ['core', 'rules', 'leaks'], 'audio.js': ['core', 'human'], 'perf.js': ['core', 'leaks'],
};
const STYLE = ['layout', 'language', 'menu'];
function changedWords() {
  let files;
  try { files = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).split('\n').map((l) => l.slice(3).trim()).filter(Boolean); } catch { return null; }
  const words = new Set();
  for (const f of files) {
    if (f.startsWith('tests/suites/')) { words.add(f.slice(13).replace(/\.js$/, '')); continue; }
    if (f === 'style.css' || f === 'index.html') { for (const w of STYLE) words.add(w); continue; }
    if (/^(README|LICENSE|\.git|tools\/(look|index)\.mjs)/.test(f)) continue;
    const m = f.match(/^src\/(.+)$/);
    if (!m || !COVERS[m[1]]) return null;                // the core of the game, the runner itself ...: everything
    for (const w of COVERS[m[1]]) words.add(w);
  }
  return [...words];
}

let words = args.filter((a) => !a.startsWith('--'));
if (args.includes('--changed')) {
  const w = changedWords();
  if (w && !w.length) { console.log('Nichts geändert, was eine Suite betrifft.'); process.exit(0); }
  if (w) words = w;
  console.log(w ? `Geänderte Dateien betreffen: ${w.join(', ')}` : 'Änderungen am Kern: alle Suiten.');
}
const suites = words.length ? all.filter((f) => words.some((w) => f.includes(w))) : all;
if (!suites.length) { console.error(`Keine Suite passt auf: ${words.join(', ')}. Vorhanden: ${all.join(', ')}`); process.exit(2); }

const CHROME = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => p && existsSync(p));
if (!CHROME) { console.error('Chrome nicht gefunden. Setze CHROME=/pfad/zu/chrome.'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JOBS = Math.max(1, Math.min(suites.length, Number(process.env.JOBS) || Math.min(4, Math.floor(cpus().length / 2)) || 1));
const port = 8900 + Math.floor(Math.random() * 400), dbg0 = 9400 + Math.floor(Math.random() * 380);
const server = spawn(process.execPath, [join(ROOT, 'tools/serve.mjs'), String(port)], { stdio: 'ignore' });
const browsers = [];
const finish = (code) => {
  for (const b of browsers) { b.chrome.kill(); try { rmSync(b.profile, { recursive: true, force: true }); } catch { /* still in use */ } }
  server.kill();
  process.exit(code);
};
setTimeout(() => { console.error('Zeitüberschreitung nach 20 Minuten.'); finish(3); }, 1200000).unref();

const prelude = readFileSync(join(ROOT, 'tests/prelude.js'), 'utf8');
const BASE = `http://127.0.0.1:${port}/index.html`;

/** One browser of its own (own profile, so own storage), and what is needed to talk to it. */
async function browser(n) {
  const dbg = dbg0 + n, profile = mkdtempSync(join(tmpdir(), 'vibe-samurai-test-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, '--window-size=1280,720',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio', '--no-first-run', '--no-sandbox', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  const b = { chrome, profile, errors: [] };
  browsers.push(b);
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
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') b.errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') b.errors.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') b.errors.push(d.params.entry.text + ' ' + (d.params.entry.url || ''));
  });
  b.send = (method, params = {}) => new Promise((r) => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  b.evaluate = async (expression) => (await b.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result;
  await b.send('Runtime.enable'); await b.send('Log.enable'); await b.send('Page.enable');
  return b;
}

/** One suite on one browser: the lines to print and how it went. */
async function runSuite(b, file) {
  const name = file.replace(/\.js$/, ''), ts = Date.now(), lines = [];
  let failed = 0, total = 0;
  const report = (ok, what, detail = '') => { total++; if (!ok) failed++; lines.push(`${ok ? '  ok  ' : ' FAIL '} ${what}${!ok && detail ? '  →  ' + detail : ''}`); };
  b.errors.length = 0;
  let body = readFileSync(join(ROOT, 'tests/suites', file), 'utf8');
  const inc = body.match(/^\/\/ @body (.*)$/m);
  if (inc) body += '\n' + readFileSync(join(ROOT, 'tests/suites', inc[1].trim()), 'utf8');
  const pre = body.match(/^\/\/ @storage (.*)$/m);
  const vp = body.match(/^\/\/ @viewport (\d+)x(\d+)( touch)?\s*$/m);
  if (vp) await b.send('Emulation.setDeviceMetricsOverride', { width: +vp[1], height: +vp[2], deviceScaleFactor: 1, mobile: false });
  else await b.send('Emulation.clearDeviceMetricsOverride');
  const query = [process.env.SEED ? 'seed=' + process.env.SEED : '', vp?.[3] ? 'touch' : ''].filter(Boolean).join('&');
  const url = BASE + (query ? '?' + query : '');
  const ready = async () => {
    for (let i = 0; i < 120; i++) { await sleep(200); if ((await b.evaluate('!!(window.game && window.game.player && window.game.front)')).result?.value === true) return true; }
    return false;
  };
  // a freshly loaded game with nothing in storage but what the suite asks for
  let up = false;
  await b.send('Page.navigate', { url });
  if (await ready()) {
    await b.evaluate('localStorage.clear()');
    for (const [k, v] of Object.entries(pre ? JSON.parse(pre[1]) : {})) await b.evaluate(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))})`);
    await b.send('Page.navigate', { url: 'about:blank' });
    b.errors.length = 0;
    await b.send('Page.navigate', { url });
    up = await ready();
  }
  report(up, 'Spiel startet', b.errors[0] || 'kein Spielobjekt nach 24 s');
  if (up) {
    const res = await b.evaluate(`(async () => { ${prelude}\n${body}\nreturn checks; })()`);
    let list = res.result?.value;
    if (!Array.isArray(list)) list = (await b.evaluate('window.__checks || []')).result?.value;
    if (!Array.isArray(list)) list = [];
    for (const [n, ok, detail] of list) report(ok, n, detail);
    if (res.exceptionDetails) report(false, 'Suite läuft bis zum Ende durch', res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  const uniq = [...new Set(b.errors)];
  report(uniq.length === 0, 'Keine Fehler in der Browser-Konsole', uniq.slice(0, 5).join(' | ').slice(0, 900));
  lines.push(`   ${((Date.now() - ts) / 1000).toFixed(1)} s`);
  return { name, lines, failed, total };
}

// the long suites first, so the browsers finish at about the same time; printed in the usual order
const LONG = ['fuzz', 'core', 'defense', 'cliff'];
const weight = (f) => { const i = LONG.findIndex((w) => f.includes(w)); return i < 0 ? LONG.length : i; };
const queue = [...suites].sort((a, b) => weight(a) - weight(b));
const results = new Map();
let printed = 0;
const flush = () => {
  while (printed < suites.length && results.has(suites[printed])) {
    const r = results.get(suites[printed++]);
    console.log(`\n── ${r.name}`);
    for (const l of r.lines) console.log(l);
  }
};
const t0 = Date.now();
await Promise.all(Array.from({ length: JOBS }, async (_, n) => {
  const b = await browser(n);
  for (let file = queue.shift(); file; file = queue.shift()) { results.set(file, await runSuite(b, file)); flush(); }
}));
let failed = 0, total = 0;
for (const r of results.values()) { failed += r.failed; total += r.total; }
console.log(failed ? `\n${failed} von ${total} Prüfungen fehlgeschlagen.` : `\nAlles grün: ${total} Prüfungen in ${suites.length} Suiten, ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
finish(failed ? 1 : 0);
