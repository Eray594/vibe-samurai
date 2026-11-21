// What is on the screen fits on the screen and does not lie on top of something else.
// (71 and 72 run the same checks in a small window and on a phone.)
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const box = (el) => el.getBoundingClientRect();
const shown = (el) => { if (!el) return false; for (let e = el; e && e !== document.documentElement; e = e.parentElement) if (getComputedStyle(e).display === 'none') return false; const r = box(el); return r.width > 0 && r.height > 0; };
const hit = (a, b) => { if (!shown(a) || !shown(b)) return false; const r = box(a), s = box(b); return r.left < s.right - 1 && s.left < r.right - 1 && r.top < s.bottom - 1 && s.top < r.bottom - 1; };
const inside = (el) => { const r = box(el); return r.top >= -0.5 && r.left >= -0.5 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5; };
const rect = (el) => { const r = box(el); return [r.left, r.top, r.right, r.bottom].map(Math.round); };
const size = `${innerWidth}×${innerHeight}`, phone = document.body.classList.contains('touch');
begin(); play('duel'); g.standoff.cancel(); g.setHelp(true); step(10); await wait();
const help = $('help'), bar = $('topbar');

check(`${size}: die Leiste oben passt ins Bild`, inside(bar) || phone, rect(bar));
if (shown(help)) {
  check(`${size}: die Steuerungstafel passt ganz ins Bild`, inside(help), rect(help));
  check(`${size}: … liegt nicht auf der Leiste`, !hit(help, bar), [rect(help), rect(bar)]);
  check(`${size}: … nicht auf Haltung und Ausdauer`, !hit(help, $('posture')) && !hit(help, $('stamina')), [rect(help), rect($('posture'))]);
  check(`${size}: … und nicht auf der Zustandsanzeige`, !hit(help, $('player-panel')) && !hit(help, $('score')));
}
check(`${size}: Zustandsanzeige und Zähler passen ins Bild`, inside($('player-panel')) && inside($('score')), [rect($('player-panel')), rect($('score'))]);

// ---- choosing an upgrade
play('survival'); step(5);
for (const e of g.livingEnemies) e.inj.wound('torso', 9, 'cut', 0);
step(300); await wait();
const cards = [...document.querySelectorAll('#perks .card')];
check(`${size}: drei Verbesserungen stehen zur Wahl, alle ganz im Bild`, g.perks.choosing && cards.length === 3 && cards.every(inside), cards.map(rect));
check(`${size}: … nichts liegt darüber`, !cards.some((c) => hit(c, help) || hit(c, bar)), [cards.map(rect), rect(bar)]);
check(`${size}: … und keine verdeckt eine andere`, !hit(cards[0], cards[1]) && !hit(cards[1], cards[2]) && !hit(cards[0], cards[2]));
g.perks.pick(0); step(2); await wait();
if (innerWidth > 1000 && !phone) check(`${size}: nach der Wahl ist die Steuerungstafel wieder da`, shown(help));

// ---- the defense: its shop and its display
play('defense'); step(30); await wait();
const shop = $('def-shop'), hud = $('def-hud');
check(`${size}: der Shop der Verteidigung passt ins Bild`, shown(shop) && inside(shop), rect(shop));
check(`${size}: … und liegt nicht auf der Leiste`, !hit(shop, bar), [rect(shop), rect(bar)]);
check(`${size}: die Schrein-Anzeige liegt unter der Leiste, nicht darauf`, shown(hud) && !hit(hud, bar), [rect(hud), rect(bar)]);
shop.scrollTop = 9999;
const go = shop.querySelector('.go');
check(`${size}: „Welle starten“ ist erreichbar (notfalls nach Scrollen)`, !!go && box(go).bottom <= innerHeight + 0.5 && box(go).top >= 0, go && rect(go));

// ---- pause and the dōjō
play('duel'); g.standoff.cancel(); step(5);
if (phone) g.touch.release();
g.input.locked = false; step(3); await wait();
check(`${size}: die Pause-Tafel passt ins Bild`, shown($('pause')) && inside(document.querySelector('#pause .card')), rect(document.querySelector('#pause .card')));
g.menu.toggle(true); await wait();
const mc = document.querySelector('#menu .card');
check(`${size}: das Dōjō passt ins Bild (oder lässt sich scrollen)`, box(mc).top >= -0.5 && (box(mc).bottom <= innerHeight + 0.5 || mc.scrollHeight > mc.clientHeight || $('menu').scrollHeight > $('menu').clientHeight), rect(mc));
g.menu.toggle(false);
$('btn-main').click(); step(2); await wait();
const ov = document.querySelector('#overlay .card');
check(`${size}: das Hauptmenü passt ins Bild (oder lässt sich scrollen)`, box(ov).top >= -0.5 && (box(ov).bottom <= innerHeight + 0.5 || ov.scrollHeight > ov.clientHeight || $('overlay').scrollHeight > $('overlay').clientHeight), rect(ov));
