// Fighters as people: who cries out and when, fighting on with a limb gone, lashing out from the ground,
// what becomes of the dead, the dodge, and what keeps a crowded yard fluid.
begin(); play('skirmish'); step(10);
const cries = [];
g.audio.cry = (kind) => { cries.push(kind); return true; };
const cut = (e, shape, speed, zoneY = 1.2) => {
  P.liveT = 1; P.weapon.lastHit.clear(); P.weapon.blockedUntil = 0;
  const p = e.getPos(); p.y = zoneY;
  g.bodyHit(P.weapon, e.core.hs, { other: e.core, shape: e.core.shapes[shape], wshape: { hsPart: 'blade' }, point: p, rel: V(9, -2, 0).clone().setLength(speed), speed });
};
const far = () => { fresh(0, 11); P.iframeT = 99; };

// ---- voices: not at every scratch, always when a limb goes
{
  far(); const e = dummy('oni', V(0, 0, -3)); step(10);
  cries.length = 0;
  for (let i = 0; i < 14; i++) { cut(e, 1, 4.2); step(12); }
  check('Stimmen: Kratzer bleiben ohne Schrei', cries.filter((c) => c === 'scream' || c === 'death').length === 0 && !e.dead, cries);
  const d = dummy('ronin', V(0, 0, -3)); d.inj.armor = 0; step(10);
  cries.length = 0;
  cut(d, 4, 17, 1.3);
  check('Stimmen: wer einen Arm verliert, schreit', d.severed.has('uArmR') && cries.includes('scream'), [[...d.severed], cries]);
  const n = cries.length;
  check('Stimmen: niemand schreit zweimal in einem Atemzug', g.cryOut(d, 'scream') === false && cries.length === n);
  g.time += 5;
  check('Stimmen: … später wieder', g.cryOut(d, 'scream') === true);
  const real = new g.audio.constructor();
  check('Stimmen: ohne Ton passiert nichts (und nichts bricht)', real.cry('scream') === false && real.cry('nichts') === false && real.bone() === undefined);
}

// ---- an arm gone is not the end of the fight
{
  far(); const e = solo('samurai', V(0, 0, -3)); e.inj.armor = 0; step(10);
  cut(e, 4, 17, 1.3);
  const lost = e.severed.has('uArmR') && !e.weapon.attached && !e.dead;
  let back = -1;
  for (let f = 0; f < 1500 && back < 0 && !e.dead; f++) { P.iframeT = 99; step(1); if (e.state === 'active' && e.weapon.attached) back = f; }
  check('Ein abgetrennter Schwertarm: er hebt die Waffe mit links auf und kämpft weiter', lost && back > 0 && e.offHanded && !e.armless, [lost, back, e.dead, e.state]);
}

// ---- down, alive, and still dangerous to whoever stands over him
{
  fresh(0, 4); const e = dummy('ronin', V(0, 0, 3)); step(5);
  e.sever('shinR', V(1, 0, 0), 4); e.inj.amputate('legR'); e.inj.bleeding = 0.2;
  step(200);
  check('Ein Bein verloren: am Boden, am Leben, besiegt gezählt', e.state === 'ragdoll' && !e.dead && e.counted && !e.inj.canStand, [e.state, e.dead, e.counted]);
  const said = []; const co = g.callout.bind(g); g.callout = (t, ...a) => { said.push(t); co(t, ...a); };
  let hitAt = -1, wound = 0;
  for (let f = 0; f < 900 && hitAt < 0; f++) {
    const tp = e.ragBodies.torso.position; P.core.position.x = tp.x + 0.7; P.core.position.z = tp.z; P.core.velocity.x = P.core.velocity.z = 0; P.iframeT = 0;
    step(1);
    wound = P.inj.parts.legR + P.inj.parts.legL;
    if (wound > 0) hitAt = f;
  }
  g.callout = co;
  check('Wer über einem Verwundeten stehen bleibt, bekommt die Klinge ins Bein', hitAt > 0 && said.includes('VOM BODEN GETROFFEN!') && P.state === 'active', [hitAt, wound, said.slice(-3)]);
  const w1 = P.inj.parts.legR + P.inj.parts.legL;
  fresh(0, -9); step(600);
  check('… wer Abstand hält, nicht', P.inj.parts.legR + P.inj.parts.legL === 0 && w1 > 0);
  e.inj.wound('armR', 9, 'blunt', 0); e.inj.wound('armL', 9, 'blunt', 0);
  check('… und wer keinen Arm mehr hat, auch nicht', e.armless);
  e.inj.consciousness = 1; cries.length = 0; g.moanT = 0; step(400);
  check('Verwundete am Boden stöhnen ab und zu', e.dead || cries.includes('moan'), cries);
}

// ---- the dead: frozen once at rest, then taken away
{
  far(); const base = g.world.bodies.length - (g.npcs[0] ? 2 : 0);
  const e = dummy('samurai', V(0, 0, -3)); step(5);
  const scene0 = g.scene.children.length;
  e.inj.wound('torso', 9, 'cut', 0); e.sever('fArmL', V(1, 0, 0), 5);
  step(120);
  const ragBodies = g.world.bodies.length, limbs0 = g.limbs.length;
  step(60 * 6);
  const meshes = (k) => { let n = 0; for (const p in k.parts) if (k.parts[p].visible) k.parts[p].traverse((o) => { if (o.isMesh) n++; }); return n + (k.frozen?.length || 0); };
  check('Tote kommen zur Ruhe: raus aus der Physik', !!e.frozen && g.world.bodies.length <= ragBodies - 9 && g.npcs.includes(e), [ragBodies, g.world.bodies.length]);
  check('… und nur noch eine Handvoll Zeichenaufrufe, ohne Schatten', meshes(e) <= 9 && e.frozen.every((m) => !m.castShadow), meshes(e));
  check('… die Leiche liegt, wo sie fiel', sane() === '' && Math.abs(e.getPos().y) < 1.2, e.getPos());
  step(60 * 24);
  check('Nach einer Weile sind Tote und abgetrennte Glieder fort', !g.npcs.includes(e) && g.limbs.length === 0 && limbs0 === 1 && g.scene.children.length < scene0, [g.npcs.includes(e), g.limbs.length, g.scene.children.length, scene0]);
  // the living who are merely down are not taken away
  const d = dummy('ronin', V(0, 0, -3)); step(5);
  d.inj.wound('legR', 1.2, 'blunt', 0); d.inj.wound('legL', 1.2, 'blunt', 0); d.inj.bleeding = 0;
  step(60 * 40);
  check('Wer nur am Boden liegt und lebt, bleibt', g.npcs.includes(d) && !d.dead && !d.frozen, [d.dead, d.state]);
}

// ---- a crowded yard: shadows only for the nearest, one list of fighters
{
  for (const e of [...g.npcs]) g.removeNpc(e);
  far();
  for (let i = 0; i < 9; i++) { const e = g.spawnFighter(1, 'ashigaru', V(-6 + i * 1.5, 0, -6)); e.brain.update = () => {}; }
  g.shadowBudget = 3; g.shadowT = 0; step(3);
  const lit = g.npcs.filter((e) => e.shadowOn).length;
  const casts = (k) => { let n = 0; for (const p in k.parts) k.parts[p].traverse((o) => { if (o.isMesh && o.castShadow) n++; }); return n; };
  check('Gedränge: nur die Nächsten werfen Schatten', lit === 3 && P.shadowOn === true && g.npcs.filter((e) => casts(e) > 0).length === 3, [lit, g.npcs.map(casts)]);
  g.shadowBudget = 9; g.shadowT = 0; step(3);
  check('… bei mehr Spielraum wieder alle', g.npcs.every((e) => casts(e) > 0));
  const a = g.fighters, b = g.fighters;
  check('Die Liste der Kämpfer wird nicht bei jeder Frage neu gebaut', a === b && a.length === 10);
  g.removeNpc(g.npcs[0]);
  check('… stimmt aber, sobald jemand geht oder kommt', g.fighters.length === 9 && g.fighters !== a && g.fighters[0] === P);
  for (const e of [...g.npcs]) g.removeNpc(e);
}

// ---- the dodge
{
  fresh(0, 4); K.add('KeyA');
  const x0 = P.core.position.x; tap('ShiftLeft', 1);
  const sp = [];
  for (let f = 0; f < 12 && P.dashT > 0; f++) { sp.push(Math.hypot(P.core.velocity.x, P.core.velocity.z)); step(1); }
  check('Ausweichen: ein Stoß, der ausläuft, kein Gleiten mit gleichbleibendem Tempo', sp.length >= 6 && sp[1] > sp[sp.length - 1] * 1.25 && sp[1] > 9 && Math.max(...sp) < 13.2, sp.map((v) => +v.toFixed(1)));
  step(20);
  check('Ausweichen: der Schritt trägt weit genug', Math.abs(P.core.position.x - x0) > 1.7, P.core.position.x - x0);
  // a second press while the feet are not free yet (too late for a roll, too early for a step) is taken when they are
  fresh(0, 4); K.add('KeyA'); tap('ShiftLeft', 1); const first = ctl.lastDodgeAt;
  while (g.time - first < 0.38) step(1);
  const blocked = P.dashCd > 0 && P.dashT <= 0;
  press('ShiftLeft'); step(1);
  const notYet = ctl.lastDodgeAt === first;
  step(10);
  check('Ausweichen: ein zu früher Druck geht nicht verloren', blocked && notYet && ctl.lastDodgeAt > first && P.dodgeKind === 'step', [blocked, notYet, ctl.lastDodgeAt - first, P.dodgeKind]);
  fresh(0, 4); K.add('KeyA'); tap('ShiftLeft', 1); step(40); const once = ctl.lastDodgeAt; step(60);
  check('… aber ein einzelner Druck ergibt nur einen Schritt', ctl.lastDodgeAt === once);
  K.clear();
}

// ---- armour: the same cut takes a rōnin's arm off and stops in a samurai's plates
{
  far(); const r = dummy('ronin', V(0, 0, -3)); step(10);
  cut(r, 4, 15, 1.3);
  far(); const m = dummy('samurai', V(0, 0, -3)); step(10);
  cut(m, 4, 15, 1.3);
  check('Rüstung: derselbe Hieb trennt dem Rōnin den Arm ab, dem Samurai nicht', r.severed.has('uArmR') && !m.severed.has('uArmR') && m.inj.parts.armR > 0.3, [[...r.severed], [...m.severed], m.inj.parts.armR]);
  cut(m, 4, 15, 1.3);
  check('… ein zweiter Hieb auf den schon zerschlagenen Arm trennt auch ihn ab', m.severed.has('uArmR'), [[...m.severed], m.inj.parts.armR]);
  far(); const t = dummy('ronin', V(0, 0, -3)); step(10);
  cut(t, 1, 14, 1.3);
  check('Ein voller Hieb in den Rumpf verwundet schwer, tötet aber nicht sofort', !t.dead && t.inj.parts.torso > 0.5, [t.dead, t.inj.parts.torso]);
  far(); const o = dummy('oni', V(0, 0, -3)); step(10);
  cut(o, 1, 14, 1.3); cut(o, 1, 14, 1.3);
  check('Ein Gepanzerter hält mehrere davon aus', !o.dead && o.state === 'active', [o.dead, o.inj.parts.torso]);
}

// ---- an arrow that goes in stays in
{
  fresh(0, 4); const e = dummy('archer', V(0, 0, -6)); step(5);
  const shoot = (shape, y) => { const w = g.launch('arrow', e, V(0, 1.3, -1).clone(), V(0, 0, 1).clone(), 30); P.iframeT = 0; g.bodyHit(w, P.core.hs, { other: P.core, shape: P.core.shapes[shape], wshape: { hsPart: 'blade' }, point: V(0, y, 3.85).clone(), rel: V(0, 0, 30).clone(), speed: 30 }); return w; };
  const w = shoot(1, 1.3);
  check('Ein Pfeil, der trifft, bleibt stecken', P.stuck.length === 1 && P.stuck[0].parent === P.parts.torso && w.dead && P.inj.parts.torso > 0, [P.stuck.length, P.inj.parts.torso]);
  const tip = P.stuck[0].getWorldPosition(V(0, 0, 0).clone());
  K.add('KeyW'); step(40); K.clear();
  check('… und geht mit dem Körper mit', P.stuck[0].getWorldPosition(V(0, 0, 0).clone()).distanceTo(tip) > 1 && P.stuck[0].getWorldPosition(V(0, 0, 0).clone()).distanceTo(P.parts.torso.position) < 0.6);
  for (let i = 0; i < 12; i++) shoot(1, 1.2);
  check('… aber niemand wird zum Nadelkissen', P.stuck.length <= 8, P.stuck.length);
  P.inj.treat(); P.clearWounds();
  check('Wunden versorgen zieht die Pfeile heraus', P.stuck.length === 0 && !P.parts.torso.children.some((c) => c.isGroup));
}

// ---- the sword goes home when there is nobody to fight
{
  for (const e of [...g.npcs]) g.removeNpc(e);
  fresh(0, 4); if (P.weapon.def.key !== 'katana') P.setWeapon('katana');
  step(60);
  const early = ctl.sheathed;
  step(60 * 3);
  check('Kein Gegner in der Nähe: das Schwert geht von selbst in die Scheide', !early && ctl.sheathed && P.intent.hand.x < -0.1 && P.intent.hand.y < 0.25, [early, ctl.sheathed, P.intent.hand.toArray().map((v) => +v.toFixed(2))]);
  const tipLow = P.weapon.worldPoint(P.weapon.tipLocal).y < P.weapon.worldPoint(P.weapon.handR).y;
  check('… die Klinge zeigt an der linken Hüfte nach hinten unten', tipLow && P.weapon.worldPoint(P.weapon.tipLocal).z > P.core.position.z, P.weapon.worldPoint(P.weapon.tipLocal).toArray().map((v) => +v.toFixed(2)));
  K.add('KeyW'); step(60); K.clear();
  check('… und bleibt dort beim Gehen', ctl.sheathed);
  const e = g.spawnFighter(1, 'ronin', V(P.core.position.x, 0, P.core.position.z - 5)); e.brain.update = () => {};
  step(3);
  const out = !ctl.sheathed; step(30);
  check('Kommt ein Gegner näher, ist es wieder draußen', out && P.intent.hand.x > -0.1, [out, P.intent.hand.x]);
  g.removeNpc(e); step(60 * 3 + 20);
  g.input.lmb = true; g.input.lmbPressed = true; step(2); g.input.lmb = false;
  check('Ein Hieb aus der Scheide heraus geht auch', !ctl.sheathed && ctl.runner.busy);
  step(90); P.setWeapon('yari'); step(60 * 4);
  check('Ein Speer hat keine Scheide', !ctl.sheathed);
  P.setWeapon('katana');
}

// ---- Shift: a tap is the dodge, holding it is the run (and the run does not begin with a lunge)
{
  fresh(0, 4); K.add('KeyW'); K.add('ShiftLeft'); press('ShiftLeft');
  const d0 = ctl.lastDodgeAt; let top = 0, ran = false;
  for (let i = 0; i < 90; i++) { step(1); top = Math.max(top, Math.hypot(P.core.velocity.x, P.core.velocity.z)); ran = ran || P.sprinting; }
  check('Shift halten: Sprint, ohne Ausweichschritt davor', ctl.lastDodgeAt === d0 && ran && top < 10 && top > 7, [ctl.lastDodgeAt - d0, ran, top]);
  K.delete('ShiftLeft'); step(3);
  check('… und Loslassen nach langem Halten ist auch kein Ausweichen', ctl.lastDodgeAt === d0);
  K.clear();
  fresh(0, 4); K.add('KeyA'); K.add('ShiftLeft'); press('ShiftLeft'); step(5);
  const held = ctl.lastDodgeAt; K.delete('ShiftLeft'); step(2);
  check('Shift antippen: der Ausweichschritt kommt beim Loslassen', held < 0 && ctl.lastDodgeAt > held && P.dashT > 0, [held, ctl.lastDodgeAt]);
  K.clear();
}

// ---- a jump out of a dodge is a jump, not a flight
{
  const leap = (pre) => { fresh(0, 10); K.add('KeyW'); pre(); press('Space'); const z0 = P.core.position.z; let n = 0; do { step(1); n++; } while (P.airborne && n < 200); K.clear(); return z0 - P.core.position.z; };
  const run = leap(() => { K.add('ShiftLeft'); step(40); });
  const dodge = [1, 4, 8].map((d) => leap(() => { press('ShiftLeft'); step(d); }));
  check('Sprung aus dem Ausweichschritt: nicht weiter als aus dem Sprint', Math.max(...dodge) < run + 0.8 && run < 7, [run, ...dodge].map((v) => +v.toFixed(1)));
}

// ---- nothing can hold a dodge at its top speed
{
  fresh(0, 4); K.add('KeyA'); tap('ShiftLeft', 1);
  const sp = [];
  while (P.dashT > 0 && sp.length < 40) { sp.push(Math.hypot(P.core.velocity.x, P.core.velocity.z)); step(1); }
  check('Ausweichen: das Tempo nimmt nur ab', sp.every((v, i) => i === 0 || v <= sp[i - 1] + 0.05), sp.map((v) => +v.toFixed(1)));
  fresh(0, 4); K.add('KeyA'); tap('ShiftLeft', 1); P.dashT = 3;        // (as if something had stretched the step: older code elsewhere, a slow frame)
  let top = 0, x0 = P.core.position.x;
  for (let i = 0; i < 120; i++) { step(1); if (i > 20) top = Math.max(top, Math.hypot(P.core.velocity.x, P.core.velocity.z)); }
  check('… auch ein verlängerter Schritt wird kein Dauerlauf mit Höchsttempo', top < 13 && Math.abs(P.core.position.x - x0) < 16, [top, P.core.position.x - x0]);
  K.clear();
}

// ---- the new sounds can be rendered, are audible and do not clip
{
  const A = new g.audio.constructor(), ctx = new OfflineAudioContext(2, 44100 * 4, 44100);
  A.attach(ctx, true); A.music = false;
  let n = 0;
  for (const kind of ['scream', 'fall', 'death', 'moan', 'kiai']) { A.lead = 0.1 + n * 0.5; n += A.cry(kind, { pitch: 0.8 + n * 0.1, pan: n % 2 ? 0.5 : -0.5 }) ? 1 : 0; }
  A.lead = 2.6; A.block(1); A.lead = 2.7; A.scabbard(true); A.lead = 2.8; A.bone(1); A.lead = 3.0; A.clatter(1, true); A.lead = 3.3; A.hit(1, false, true); A.lead = 3.5; A.hit(1, false, false);
  const buf = await ctx.startRendering(), d = buf.getChannelData(0);
  let peak = 0, bad = 0, loud = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (!(v >= 0)) bad++; if (v > peak) peak = v; if (v > 0.02) loud++; }
  // a voice has to be heard over what happens at the same moment: louder than what is left of the blow when it starts
  const one = async (fn) => { const B = new g.audio.constructor(), c = new OfflineAudioContext(2, 44100 * 2, 44100); B.attach(c, true); B.music = false; B.amb.gain.value = 0; B.lead = 0.2; fn(B); return (await c.startRendering()).getChannelData(0); };
  const rms = (x, a, b) => { let s = 0; for (let i = Math.floor(a * 44100); i < Math.floor(b * 44100); i++) s += x[i] * x[i]; return Math.sqrt(s / ((b - a) * 44100)); };
  const tail = rms(await one((B) => { B.hit(1.2, false); B.slash(); B.thud(0.9); }), 0.33, 0.7);
  const scream = rms(await one((B) => B.cry('scream', { level: 0.6, delay: 0.13 })), 0.33, 0.7), death = rms(await one((B) => B.cry('death', { level: 0.6, delay: 0.2 })), 0.4, 0.8);
  check('Stimmen: deutlich lauter als der Ausklang des Treffers, über dem sie liegen', scream > tail * 3 && death > tail * 2 && scream > 0.05, [tail, scream, death].map((v) => +v.toFixed(4)));
  check('Die neuen Stimmen und Geräusche: hörbar, endlich, ohne Übersteuern', n === 5 && bad === 0 && peak > 0.05 && peak <= 0.91 && loud > 4000, [n, bad, +peak.toFixed(3), loud]);
}
check('Am Ende ist alles an seinem Platz', sane() === '', sane());
