// @storage {"vibesamurai.settings": {"map": "cliff"}}
// @body 90-fuzz.js
// The same hammering on the second map, where there is an edge to fall off.
check('Die Zufallseingaben laufen auf dem Wolkengipfel', g.map === 'cliff' && g.arena.abyss === true, g.map);
