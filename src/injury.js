// Realistic injury model: no hit points. Every hit wounds a specific body
// part; wounds bleed, cripple limbs, daze, and eventually kill.
import { clamp } from './physics.js';

export const ZONES = ['head', 'torso', 'armR', 'armL', 'legR', 'legL'];
export const ZONE_NAMES = {
  head: 'Kopf', torso: 'Rumpf', armR: 'rechter Arm', armL: 'linker Arm', legR: 'rechtes Bein', legL: 'linkes Bein',
};

// How much of each wound type lamellar armour stops (armour 0..1):
// cuts skid off the lacquered plates, thrusts find the gaps, blunt force goes through.
const ARMOR_PASS = { cut: 0.85, thrust: 0.45, blunt: 0.3 };
const BLEED_KIND = { cut: 1.0, thrust: 1.45, blunt: 0.22 };
const BLEED_ZONE = { head: 0.75, torso: 1.15, armR: 0.6, armL: 0.6, legR: 0.75, legL: 0.75 };

export class Injuries {
  constructor(armor = 0.8) {
    this.armor = armor;
    this.reset();
  }

  reset() {
    this.parts = { head: 0, torso: 0, armR: 0, armL: 0, legR: 0, legL: 0 };
    this.blood = 1;          // fraction of blood volume left
    this.bleeding = 0;       // current bleed rate (arbitrary units)
    this.consciousness = 1;  // 0 = knocked out
    this.shock = 0;          // short-term pain shock, decays
    this.cause = null;       // cause of death text
    this.disarmed = false;
    this.severedHead = false;
    this.legLost = false;
  }

  /** A limb was cut off: massive bleeding, the limb is gone. */
  amputate(zone) {
    if (zone === 'head') { this.severedHead = true; this.checkDeath(); return; }
    this.parts[zone] = 1.3;
    if (zone.startsWith('leg')) this.legLost = true;
    this.bleeding += zone.startsWith('leg') ? 2.4 : 1.7;
    this.shock = 1;
    this.consciousness -= 0.25;
  }

  /** How strongly armour reduces a hit of this kind on this zone. */
  armorFactor(kind, zone, armorMul = 1) {
    let a = zone === 'head' ? Math.min(1, this.armor + 0.08) : zone.startsWith('arm') ? this.armor * 0.85 : this.armor;
    a = Math.min(1, a * armorMul);
    return 1 - a * ARMOR_PASS[kind];
  }

  /**
   * Apply a wound. `sev` is the raw severity before armour (~0..1.5).
   * Returns a list of notable events for feedback.
   */
  wound(zone, rawSev, kind, armorMul = 1) {
    const sev = rawSev * this.armorFactor(kind, zone, armorMul);
    const ev = [];
    if (sev < 0.035) { ev.push('deflect'); return { sev, ev }; }
    const P = this.parts;
    const before = P[zone];
    const limb = zone !== 'head' && zone !== 'torso';
    P[zone] = Math.min(1.3, P[zone] + sev * (kind === 'blunt' && limb ? 1.25 : 1));
    this.bleeding += sev * BLEED_KIND[kind] * BLEED_ZONE[zone];
    if (zone === 'head') this.consciousness -= sev * (kind === 'blunt' ? 1.9 : 0.85);
    else this.consciousness -= sev * (kind === 'blunt' ? 0.22 : 0.08);
    this.shock = Math.min(1, this.shock + sev * 0.9);

    const crossed = (t) => before < t && P[zone] >= t;
    if (limb && crossed(0.4)) ev.push('hurt');
    if (limb && crossed(0.8)) ev.push(kind === 'blunt' ? 'broken' : 'crippled');
    if (zone === 'armR' && P.armR >= 0.75 && sev > 0.12) ev.push('disarm');
    if (zone === 'armL' && P.armL >= 0.9 && sev > 0.12) ev.push('disarmL');
    if (zone === 'head' && kind !== 'blunt' && sev > 0.3) ev.push('headWound');
    if (sev > 0.45) ev.push('severe');
    this.checkDeath(kind);
    if (this.cause) ev.push('dead');
    else if (this.consciousness <= 0) ev.push('ko');
    return { sev, ev };
  }

  checkDeath(kind) {
    if (this.cause) return;
    if (this.severedHead) this.cause = 'Enthauptet';
    else if (this.parts.head >= 1) this.cause = kind === 'blunt' ? 'Schädel zertrümmert' : 'Schädel gespalten';
    else if (this.parts.torso >= 1.25) this.cause = kind === 'thrust' ? 'Durchbohrt' : kind === 'blunt' ? 'Zerschmettert' : 'Niedergestreckt';
    else if (this.blood <= 0.15) this.cause = 'Verblutet';
  }

  /** Per-frame: bleeding, recovery. Returns true if the knight just died. */
  update(dt) {
    if (this.cause) return false;
    this.blood = Math.max(0, this.blood - this.bleeding * 0.013 * dt);
    this.bleeding = Math.max(0, this.bleeding - dt * 0.005);   // slow clotting
    this.shock = Math.max(0, this.shock - dt * 0.35);
    const cap = this.consciousnessCap;
    if (this.consciousness < cap) this.consciousness = Math.min(cap, this.consciousness + dt * 0.07);
    else this.consciousness = Math.max(cap, this.consciousness - dt * 0.05);
    this.checkDeath();
    return !!this.cause;
  }

  get dead() { return !!this.cause; }
  /** Blood loss makes you faint. */
  get consciousnessCap() { return clamp((this.blood - 0.22) / 0.4, 0, 1); }
  get bloodFactor() { return clamp((this.blood - 0.25) / 0.55, 0, 1); }
  /** General strength: blood, torso wounds and pain shock. */
  get vitality() {
    return Math.pow(this.bloodFactor, 0.7) * (1 - 0.35 * Math.min(1, this.parts.torso)) * (1 - 0.45 * this.shock);
  }
  /** How well the weapon is held. `offHand`: the sword arm is gone, the left hand does the work alone. */
  armStrength(twoHanded, offHand = false) {
    const r = Math.min(1, this.parts.armR), l = Math.min(1, this.parts.armL);
    if (offHand) return this.vitality * (1 - 0.8 * l) * (twoHanded ? 0.55 : 0.75);
    return this.vitality * (1 - 0.8 * r) * (twoHanded ? 0.55 + 0.45 * (1 - l) : 1);
  }
  get legStrength() {
    const r = Math.min(1, this.parts.legR), l = Math.min(1, this.parts.legL);
    return this.vitality * (1 - 0.65 * Math.max(r, l)) * (1 - 0.4 * Math.min(r, l));
  }
  get canStand() {
    return !this.cause && !this.legLost && this.consciousness > 0.05 && this.legStrength > 0.16
      && !(this.parts.legR >= 1 && this.parts.legL >= 1);
  }
  get dizzy() { return clamp(1 - this.consciousness / 0.7, 0, 1); }

  /** Field dressing: stops most bleeding, eases the wounds. Lost limbs stay lost. */
  treat() {
    if (this.cause) return;
    this.bleeding *= 0.15;
    this.blood = Math.min(1, this.blood + 0.35);
    this.consciousness = Math.min(1, this.consciousness + 0.5);
    this.shock = 0;
    for (const z of ZONES) if (this.parts[z] < 1.3) this.parts[z] = Math.max(0, this.parts[z] - 0.5);
  }

  /** Short human-readable status lines (for the player HUD). */
  status() {
    const out = [];
    if (this.cause) return [this.cause];
    if (this.consciousness < 0.35) out.push('Kaum bei Bewusstsein');
    else if (this.consciousness < 0.7) out.push('Benommen');
    const b = this.bleeding;
    if (b > 1.2) out.push('Blutet sehr stark');
    else if (b > 0.5) out.push('Blutet stark');
    else if (b > 0.12) out.push('Blutet');
    if (this.blood < 0.55) out.push('Schwach vom Blutverlust');
    for (const z of ['armR', 'armL', 'legR', 'legL']) {
      const v = this.parts[z];
      if (v >= 0.8) out.push(`${cap(ZONE_NAMES[z])} unbrauchbar`);
      else if (v >= 0.4) out.push(`${cap(ZONE_NAMES[z])} verletzt`);
    }
    if (this.parts.torso >= 0.6) out.push('Schwere Rumpfwunde');
    return out;
  }
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
