// German is what the game is written in; English is laid over it. Every piece of text that reaches the
// page is looked up as it appears, so nothing else in the code has to know about languages.
import { EN, EN_PARTS } from './lang-en.js';

const NUM = /\d+(?:[.:,]\d+)*/g;
const SPLIT = /(\s+[·—]\s+|:\s+)/;
const cache = new Map();
// every entry also in capitals: callouts shout what the menus say quietly
const UP = new Map();
for (const [de, en] of Object.entries(EN)) { const k = de.toUpperCase(); if (EN[k] === undefined && !UP.has(k)) UP.set(k, en.toUpperCase()); }

/** One piece of text, as listed (or the same with other numbers in it); undefined when it is not listed. */
function lookup(core) {
  let en = EN[core] ?? UP.get(core);
  if (en !== undefined) return en;
  const nums = core.match(NUM);
  if (!nums) return undefined;
  const key = core.replace(NUM, '#');
  en = EN[key] ?? UP.get(key);
  if (en === undefined) return undefined;
  let i = 0;
  return en.replace(/#/g, () => nums[i++] ?? '');
}

/** German text → English, or the text unchanged when there is nothing to say about it. */
export function toEnglish(text) {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const lead = text.match(/^\s*/)[0], tail = text.match(/\s*$/)[0];
  const core = text.slice(lead.length, text.length - tail.length);
  let out = text;
  if (core) {
    let en = lookup(core);
    if (en === undefined) {
      // put together from pieces ("Welle 3 · 12 besiegt  —  neuer Rekord!"): piece by piece
      const parts = core.split(SPLIT);
      let changed = false;
      for (let i = 0; i < parts.length; i += 2) {
        const piece = parts[i].trim();
        if (!piece) continue;
        let t = lookup(piece);
        if (t === undefined) { let s = piece; for (const [de, e] of EN_PARTS) if (s.includes(de)) s = s.split(de).join(e); if (s !== piece) t = s; }
        if (t !== undefined) { parts[i] = parts[i].replace(piece, () => t); changed = true; }
      }
      if (changed) en = parts.join('');
    }
    if (en !== undefined) out = lead + en + tail;
  }
  if (cache.size > 4000) cache.clear();
  cache.set(text, out);
  return out;
}

export class I18n {
  constructor(game) {
    this.game = game;
    this.lang = 'de';
    this.orig = new WeakMap();        // text node → its German text
    this.titles = new WeakMap();      // element → its German title
    this.mine = new WeakMap();        // node / element → the English this class put there
    this.observer = new MutationObserver((list) => {
      if (this.lang !== 'en') return;
      for (const m of list) {
        if (m.type === 'characterData') this.node(m.target);
        else if (m.type === 'attributes') this.title(m.target);
        else for (const n of m.addedNodes) this.walk(n);
      }
    });
    this.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
    if (game.settings.lang === 'en') this.set('en', false);
  }

  node(n) {
    const src = n.nodeValue;
    if (!src || !src.trim() || this.mine.get(n) === src) return;      // empty, or what was just put there by this very function
    const en = toEnglish(src);
    if (en !== src) { this.orig.set(n, src); this.mine.set(n, en); n.nodeValue = en; }
    else { this.orig.delete(n); this.mine.delete(n); }
  }
  title(el) {
    const src = el.getAttribute?.('title');
    if (!src || this.mine.get(el) === src) return;
    const en = toEnglish(src);
    if (en !== src) { this.titles.set(el, src); this.mine.set(el, en); el.setAttribute('title', en); }
    else { this.titles.delete(el); this.mine.delete(el); }
  }
  walk(root) {
    if (root.nodeType === 3) { this.node(root); return; }
    if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    this.title(root);
    for (const el of root.querySelectorAll('[title]')) this.title(el);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) this.node(n);
  }
  /** Back to what the code wrote. */
  restore(root) {
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) { const de = this.orig.get(n); if (de !== undefined) { n.nodeValue = de; this.orig.delete(n); this.mine.delete(n); } }
    for (const el of root.querySelectorAll('[title]')) { const de = this.titles.get(el); if (de !== undefined) { el.setAttribute('title', de); this.titles.delete(el); this.mine.delete(el); } }
  }

  set(lang, store = true) {
    if (lang !== 'de' && lang !== 'en') return;
    if (store) this.game.settings.set('lang', lang);
    if (lang === this.lang) return;
    this.lang = lang;
    document.documentElement.lang = lang;
    if (lang === 'en') this.walk(document.body);
    else { this.observer.takeRecords(); this.restore(document.body); }
    document.title = lang === 'en' ? 'VIBE SAMURAI – samurai sandbox' : 'VIBE SAMURAI – Samurai-Sandbox';
  }
}
