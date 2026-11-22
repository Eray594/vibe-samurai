// A map of the code, made from the code itself (so it is never out of date): what is in every file and where.
//   node tools/index.mjs              the whole map
//   node tools/index.mjs samurai ai   only these files, with every method
//   node tools/index.mjs --find dash  where a word is defined or used (file:line, one line each)
//   node tools/index.mjs --stamp      the short code the main menu shows for exactly these source files
// For each file: size, what it imports from the game's own files, its classes with their methods and the
// line each begins on, its top-level functions and constants. At the end: storage keys, keys read from the
// keyboard, the texts called out on screen, and what the page's fixed elements are.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const args = process.argv.slice(2);
const files = readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
const text = Object.fromEntries(files.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));

// the same short code the page shows in its main menu: which state of the source files this is
if (args.includes('--stamp')) {
  const seen = new Map();
  const walk = (f) => { if (seen.has(f)) return; seen.set(f, text[f] ?? ''); for (const m of (text[f] ?? '').matchAll(/from '\.\/([\w.-]+\.js)'/g)) walk(m[1]); };
  walk('main.js');
  let h = 0x811c9dc5;
  for (const [name, t] of [...seen].sort((a, b) => (a[0] < b[0] ? -1 : 1))) { const s = name + '\n' + t; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; }
  console.log('v ' + h.toString(16).padStart(8, '0'));
  process.exit(0);
}

const fi = args.indexOf('--find');
if (fi >= 0) {
  const word = args[fi + 1];
  if (!word) { console.error('node tools/index.mjs --find <wort>'); process.exit(2); }
  const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const all = { ...text, 'index.html': readFileSync(join(ROOT, 'index.html'), 'utf8') };
  for (const [f, t] of Object.entries(all)) t.split('\n').forEach((l, i) => { if (re.test(l)) console.log(`${f === 'index.html' ? f : 'src/' + f}:${i + 1}  ${l.trim().slice(0, 150)}`); });
  process.exit(0);
}

const only = args.filter((a) => !a.startsWith('--'));
const full = only.length > 0;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'else', 'do', 'new', 'typeof', 'await']);
const out = [];
for (const f of files) {
  if (full && !only.some((w) => f.includes(w))) continue;
  const lines = text[f].split('\n');
  const imports = [...text[f].matchAll(/from '\.\/([\w-]+)\.js'/g)].map((m) => m[1]);
  out.push(`\n## src/${f}  (${lines.length} Zeilen, ${(text[f].length / 1024).toFixed(0)} KB)${imports.length ? '  ← ' + [...new Set(imports)].join(', ') : ''}`);
  const head = lines.slice(0, 6).filter((l) => l.startsWith('//')).map((l) => l.slice(2).trim()).join(' ');
  if (head) out.push(`  ${head.slice(0, 260)}`);
  let cls = null, methods = [];
  const flushClass = () => {
    if (!cls) return;
    out.push(`  class ${cls.name}${cls.ext ? ' extends ' + cls.ext : ''}  :${cls.line}`);
    if (methods.length) {
      if (full) for (const [n, l] of methods) out.push(`      ${n}  :${l}`);
      else out.push('      ' + methods.map(([n, l]) => `${n}:${l}`).join('  '));
    }
    cls = null; methods = [];
  };
  const tops = [];
  lines.forEach((l, i) => {
    let m;
    if ((m = l.match(/^(?:export )?class (\w+)(?: extends (\w+))?/))) { flushClass(); cls = { name: m[1], ext: m[2], line: i + 1 }; return; }
    if (cls && (m = l.match(/^  (?:async )?(?:(get|set) )?(\w+)\s*\([^)]*\)\s*\{/)) && !KEYWORDS.has(m[2])) { methods.push([(m[1] ? m[1] + ' ' : '') + m[2], i + 1]); return; }
    if (l.startsWith('}')) { flushClass(); return; }
    if (!cls && (m = l.match(/^(export )?(?:async )?function\*? (\w+)/))) tops.push(`${m[1] ? '⇧' : ''}${m[2]}():${i + 1}`);
    else if (!cls && (m = l.match(/^(export )?const (\w+)\s*=/)) && (m[1] || /^[A-Z_0-9]+$/.test(m[2]))) tops.push(`${m[1] ? '⇧' : ''}${m[2]}:${i + 1}`);
  });
  flushClass();
  if (tops.length) out.push('  ' + tops.join('  '));
}

if (!full) {
  const allText = Object.values(text).join('\n');
  const uniq = (re, g = 1) => [...new Set([...allText.matchAll(re)].map((m) => m[g]))].sort();
  out.push('\n## Quer durch alle Dateien');
  out.push('  Speicher-Schlüssel: ' + uniq(/'((?:vibesamurai|heavysteel)\.[\w.]+)'/g).join(', '));
  out.push('  Tasten: ' + uniq(/(?:has|down)\('((?:Key|Digit|Arrow|Numpad)?\w+)'\)/g).join(' '));
  out.push('  Meldungen (callout): ' + uniq(/callout\((?:[^'`(]*\? )?'([^']+)'/g).join(' | '));
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  out.push('  Feste Elemente (index.html): ' + [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]).join(' '));
  out.push('  In JS gebaute Elemente: ' + uniq(/\.id = '([\w-]+)'/g).concat(uniq(/el\('([\w-]+)'/g)).join(' '));
  out.push('  ⇧ = exportiert. Zahl nach dem Doppelpunkt = Zeile.');
}
console.log(out.join('\n').trim());
