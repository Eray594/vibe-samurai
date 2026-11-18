// Who walks the courtyard: player skins and the kinds of opponents.

/** Player skins. `prot` is the armour value (0 = cloth, 1 = impenetrable). */
export const SKINS = {
  ronin: {
    key: 'ronin', name: 'Rōnin', desc: 'Strohhut, kaum Rüstung – leicht und schnell',
    cloth: 0x24324f, hakama: 0x17181f, lace: 0x8a8068, head: 'kasa', prot: 0.2, speed: 1.06, beard: 1, pattern: 'kasuri',
  },
  samurai: {
    key: 'samurai', name: 'Samurai', desc: 'Rote Lamellenrüstung, Kabuto mit Kuwagata',
    cloth: 0x2a1c1a, hakama: 0x1a1a20, armor: 0x7a1216, lace: 0xd9b25a, trim: 0xd6a94f,
    head: 'kabuto', crest: 'kuwagata', sode: true, suneate: true, prot: 0.62, speed: 0.97,
  },
  kranich: {
    key: 'kranich', name: 'Weißer Kranich', desc: 'Weißes Gewand, Stirnband, leichte Rüstung',
    cloth: 0xe6e1d6, hakama: 0x7a1418, armor: 0xd9d2c2, lace: 0x8a1418, trim: 0xc9a14f,
    head: 'band', sode: true, prot: 0.42, speed: 1.0,
  },
  schatten: {
    key: 'schatten', name: 'Schatten', desc: 'Schwarz vermummt – am schnellsten, ungeschützt',
    cloth: 0x15161b, hakama: 0x0f1014, lace: 0x2a0c0e, head: 'hood', prot: 0.1, speed: 1.12, kote: false,
  },
  oni: {
    key: 'oni', name: 'Oni', desc: 'Schwarze Rüstung, rote Dämonenmaske',
    cloth: 0x181214, hakama: 0x121014, armor: 0x131316, lace: 0xa01c1c, trim: 0x8a8a90,
    head: 'kabuto', crest: 'horns', menpo: 0x8a1414, sode: true, suneate: true, prot: 0.72, speed: 0.93,
  },
};
export const SKIN_ORDER = ['ronin', 'samurai', 'kranich', 'schatten', 'oni'];

/**
 * Opponent kinds. Ranges are [min, max], rolled per fighter.
 *  block   – chance to raise the guard against a seen attack
 *  deflect – chance that such a guard is a perfect deflection
 *  posture – how much pressure the guard takes before it breaks
 *  combo   – longest chain of attacks
 */
export const TYPES = {
  ashigaru: {
    key: 'ashigaru', name: 'Ashigaru', weapons: ['yari', 'yari', 'katana'],
    aggr: [0.8, 1.0], block: [0.15, 0.35], deflect: 0.04, posture: 0.8, combo: 1, windMul: 1.25,
    styles: [
      { cloth: 0x3a3226, hakama: 0x25221c, armor: 0x2a2a2e, lace: 0x6a1a1a, head: 'jingasa', prot: 0.38, sashimono: 0x8a1418, saya: false },
      { cloth: 0x2c3540, hakama: 0x1f2024, armor: 0x34302a, lace: 0x8a7a50, head: 'jingasa', prot: 0.34, saya: false },
      { cloth: 0x4a3a2a, hakama: 0x2a2620, lace: 0x8a7a50, head: 'band', prot: 0.15, beard: 1, pattern: 'stripe' },
    ],
  },
  ronin: {
    key: 'ronin', name: 'Rōnin', weapons: ['katana', 'katana', 'wakizashi', 'nodachi'],
    aggr: [1.0, 1.25], block: [0.3, 0.5], deflect: 0.14, posture: 1.0, combo: 2, windMul: 1.0,
    styles: [
      { cloth: 0x3c2a22, hakama: 0x1c1a1a, lace: 0x5a5040, head: 'kasa', prot: 0.18, beard: 2 },
      { cloth: 0x2a3a30, hakama: 0x20201c, lace: 0x7a6a48, head: 'bare', prot: 0.15, beard: 1, scar: true, pattern: 'kasuri' },
      { cloth: 0x4a1c1c, hakama: 0x161416, lace: 0x2a2a2a, head: 'band', prot: 0.2, stern: true, pattern: 'stripe' },
    ],
  },
  samurai: {
    key: 'samurai', name: 'Samurai', weapons: ['katana', 'katana', 'naginata', 'nodachi'],
    aggr: [0.95, 1.2], block: [0.45, 0.65], deflect: 0.28, posture: 1.35, combo: 3, windMul: 0.95,
    styles: [
      { cloth: 0x1c2233, hakama: 0x15161c, armor: 0x1c2c4a, lace: 0xc9b25a, head: 'kabuto', crest: 'moon', sode: true, suneate: true, prot: 0.6 },
      { cloth: 0x2a2018, hakama: 0x1a1612, armor: 0x3a2a14, lace: 0xb0502a, head: 'kabuto', crest: 'kuwagata', sode: true, suneate: true, prot: 0.6, sashimono: 0x1c2c4a },
      { cloth: 0x202a20, hakama: 0x141a14, armor: 0x1e3a22, lace: 0xd9d2c2, head: 'kabuto', crest: 'kuwagata', menpo: 0x1a1a1a, sode: true, suneate: true, prot: 0.64 },
    ],
  },
  oni: {
    key: 'oni', name: 'Oni-Krieger', weapons: ['kanabo', 'kanabo', 'nodachi'],
    aggr: [0.9, 1.1], block: [0.08, 0.2], deflect: 0, posture: 1.9, combo: 2, windMul: 1.15,
    styles: [
      { cloth: 0x1a1214, hakama: 0x120e10, armor: 0x141214, lace: 0x9a1a1a, trim: 0x77777c, head: 'kabuto', crest: 'horns', menpo: 0x8a1414, sode: true, suneate: true, prot: 0.74 },
    ],
  },
  daimyo: {
    key: 'daimyo', name: 'Daimyō', weapons: ['katana', 'nodachi'],
    aggr: [1.2, 1.3], block: [0.7, 0.85], deflect: 0.5, posture: 2.4, combo: 3, windMul: 0.85,
    styles: [
      { cloth: 0x2a1030, hakama: 0x140a18, armor: 0xb08a2a, lace: 0x4a1060, trim: 0xe8c860, head: 'kabuto', crest: 'kuwagata', menpo: 0x101010, sode: true, suneate: true, prot: 0.72, sashimono: 0x4a1060 },
    ],
  },
};
// rank: who leads (the highest rank alive is the leader). courage: 0 = runs at the first head that rolls.
// heavy: chance that an attack is a slow, guard-crushing blow that should be dodged, not blocked.
Object.assign(TYPES.ashigaru, { rank: 1, courage: 0.3, heavy: 0 });
Object.assign(TYPES.ronin, { rank: 2, courage: 0.6, heavy: 0.08 });
Object.assign(TYPES.samurai, { rank: 3, courage: 0.9, heavy: 0.14 });
Object.assign(TYPES.oni, { rank: 3, courage: 1, heavy: 0.4 });
Object.assign(TYPES.daimyo, { rank: 5, courage: 1, heavy: 0.25 });
Object.assign(TYPES, {
  archer: {
    key: 'archer', name: 'Bogenschütze', weapons: ['wakizashi'], ranged: 'bow', rank: 1, courage: 0.2, heavy: 0,
    aggr: [0.8, 1.0], block: [0.1, 0.25], deflect: 0, posture: 0.7, combo: 1, windMul: 1.25,
    styles: [
      { cloth: 0x3c4630, hakama: 0x22241c, lace: 0x8a7a50, head: 'jingasa', prot: 0.2, saya: false },
      { cloth: 0x4a3a2a, hakama: 0x2a2620, lace: 0x8a7a50, head: 'band', prot: 0.15, pattern: 'stripe' },
    ],
  },
  gunner: {
    key: 'gunner', name: 'Teppō-Schütze', weapons: ['wakizashi'], ranged: 'gun', rank: 1, courage: 0.25, heavy: 0,
    aggr: [0.8, 0.95], block: [0.1, 0.2], deflect: 0, posture: 0.8, combo: 1, windMul: 1.3,
    styles: [
      { cloth: 0x2a2c34, hakama: 0x1c1c20, armor: 0x26262a, lace: 0x6a1a1a, head: 'jingasa', prot: 0.36, saya: false },
    ],
  },
  rider: {
    key: 'rider', name: 'Reiter', weapons: ['naginata', 'yari'], mounted: true, rank: 3, courage: 0.95, heavy: 0,
    aggr: [1.1, 1.2], block: [0.15, 0.3], deflect: 0.05, posture: 1.3, combo: 1, windMul: 0.8,
    styles: [
      { cloth: 0x2a2018, hakama: 0x1a1612, armor: 0x3a2a14, lace: 0xb0502a, head: 'kabuto', crest: 'kuwagata', sode: true, suneate: true, prot: 0.6, sashimono: 0x8a1418 },
    ],
  },
});
export const TYPE_ORDER = ['ashigaru', 'ronin', 'samurai', 'oni', 'daimyo', 'archer', 'gunner', 'rider'];

/** Allies who fight at the player's side wear blue. */
export const ALLY_STYLE = {
  cloth: 0x1c2a44, hakama: 0x14161c, armor: 0x20406a, lace: 0xe6e1d6, head: 'jingasa', sode: true, prot: 0.5, sashimono: 0x20406a,
};

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Weighted random opponent kind; tougher kinds show up as `difficulty` (0..1) rises. */
export function randomType(difficulty = 0.3) {
  const w = {
    ashigaru: 1.0,
    ronin: 0.7 + difficulty * 0.4,
    samurai: 0.25 + difficulty * 0.9,
    oni: 0.05 + difficulty * 0.45,
    daimyo: difficulty > 0.6 ? (difficulty - 0.6) * 0.5 : 0,
    archer: 0.22 + difficulty * 0.2,
    gunner: difficulty > 0.2 ? 0.08 + difficulty * 0.2 : 0,
    rider: difficulty > 0.3 ? (difficulty - 0.3) * 0.35 : 0,
  };
  let total = 0;
  for (const k in w) total += w[k];
  let r = Math.random() * total;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return 'ashigaru';
}
