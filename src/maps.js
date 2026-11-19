// The places to fight in. Which one is built is decided once, when the page loads (the main menu
// stores the choice and loads the page again).
export const MAPS = {
  yard: { key: 'yard', name: 'Dōjō-Hof', desc: 'Ummauerter Hof in der Abenddämmerung' },
  cliff: { key: 'cliff', name: 'Wolkengipfel', desc: 'Schrein auf dem Fels über den Wolken · wer über die Kante geht, fällt' },
};
export const MAP_ORDER = ['yard', 'cliff'];

/** `?map=` in the address wins (for tools and tests), then the stored choice. */
export function chosenMap(settings) {
  let q = null;
  try { q = new URLSearchParams(location.search).get('map'); } catch { /* no address to read */ }
  return MAPS[q] ? q : MAPS[settings?.map] ? settings.map : 'yard';
}
