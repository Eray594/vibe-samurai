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
  check('Ausweichen: ein Stoß, der ausläuft, kein Gleiten mit gleichbleibendem Tempo', sp.length >= 6 && sp[1] > sp[sp.length - 1] * 1.25 && sp[1] > 9, sp.map((v) => +v.toFixed(1)));
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

// ---- the new sounds can be rendered, are audible and do not clip
{
  const A = new g.audio.constructor(), ctx = new OfflineAudioContext(2, 44100 * 4, 44100);
  A.attach(ctx, true); A.music = false;
  let n = 0;
  for (const kind of ['scream', 'fall', 'death', 'moan', 'kiai']) { A.lead = 0.1 + n * 0.5; n += A.cry(kind, { pitch: 0.8 + n * 0.1, pan: n % 2 ? 0.5 : -0.5 }) ? 1 : 0; }
  A.lead = 2.8; A.bone(1); A.lead = 3.0; A.clatter(1, true); A.lead = 3.3; A.hit(1, false, true); A.lead = 3.5; A.hit(1, false, false);
  const buf = await ctx.startRendering(), d = buf.getChannelData(0);
  let peak = 0, bad = 0, loud = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (!(v >= 0)) bad++; if (v > peak) peak = v; if (v > 0.02) loud++; }
  check('Die neuen Stimmen und Geräusche: hörbar, endlich, ohne Übersteuern', n === 5 && bad === 0 && peak > 0.05 && peak <= 0.91 && loud > 4000, [n, bad, +peak.toFixed(3), loud]);
}
check('Am Ende ist alles an seinem Platz', sane() === '', sane());
