// @storage {"vibesamurai.settings": {"lang": "en", "diff": "hard", "help": false}, "vibesamurai.best.survival": {"wave": 9, "kills": 31, "time": 200}, "vibesamurai.tutorial": {"done": true}}
// What was saved on an earlier visit is there again when the page loads.
await new Promise((r) => setTimeout(r, 50));
const ov = $('overlay');
check('Gespeicherte Sprache: die Seite kommt gleich auf Englisch', g.i18n.lang === 'en' && document.documentElement.lang === 'en' && ov.textContent.includes('Survival') && !ov.textContent.includes('Überleben'), ov.textContent.slice(0, 200));
check('Gespeicherte Schwierigkeit ist eingestellt', g.settings.diff === 'hard' && $('diff-row').querySelector('[data-diff="hard"]').classList.contains('active'));
check('Gespeicherter Rekord steht auf der Karte', document.querySelector('#mode-cards [data-mode="survival"] .rec').textContent.includes('Wave 9 · 31 defeated · 3:20'), document.querySelector('#mode-cards [data-mode="survival"] .rec').textContent);
check('Wer die Einführung kennt, wird nicht mehr darauf hingewiesen', !document.querySelector('#mode-cards [data-mode="tutorial"]').classList.contains('hot'));
check('Der Seitentitel ist englisch', document.title.includes('sandbox'));
check('Eine weggeklickte Steuerungstafel bleibt beim nächsten Besuch zu', !visible($('help')) && visible($('help-open')) && $('help-open').title.startsWith('Show the controls'), $('help-open').title);
