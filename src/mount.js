// A horse for mounted opponents. The rider is an ordinary fighter whose body is carried a metre
// above the ground; the horse follows under him, tramples whoever is in the way and throws the
// rider when it is hit hard.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G, materials, rand, clamp, dampFactor, angleLerp, snapPrev } from './physics.js';

export const MOUNT_H = 1.02;
const _v = new THREE.Vector3();

export class Horse {
  constructor(game, rider) {
    this.game = game;
    this.rider = rider;
    rider.horse = this;
    rider.mountH = MOUNT_H;
    rider.core.position.y += MOUNT_H;
    snapPrev(rider.core);
    this.x = rider.core.position.x; this.z = rider.core.position.z;
    this.yaw = rider.intent.yaw;
    this.speed = 0;
    this.phase = 0;
    this.trampleCd = 0;
    this.free = false;          // rider gone: trots off and stands
    this.rearT = 0;
    this.disposed = false;

    const coat = new THREE.MeshStandardMaterial({ color: [0x3a2a1e, 0x1c1a1a, 0x6a5038][Math.floor(Math.random() * 3)], roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x141212, roughness: 0.9 });
    const red = new THREE.MeshStandardMaterial({ color: 0x8a1418, roughness: 0.7 });
    const g = this.mesh = new THREE.Group();
    const part = (w, h, d, x, y, z, mat = coat, parent = g) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    // forward is -z, like the fighters
    part(0.5, 0.56, 1.5, 0, 1.12, 0);                       // barrel
    part(0.54, 0.1, 0.6, 0, 1.43, 0.05, red);                // saddle cloth
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.3, -0.68);
    g.add(this.neck);
    part(0.26, 0.74, 0.34, 0, 0.3, -0.12, coat, this.neck).rotation.x = 0.5;
    part(0.22, 0.26, 0.56, 0, 0.66, -0.42, coat, this.neck);  // head
    part(0.06, 0.5, 0.3, 0, 0.44, 0.02, dark, this.neck).rotation.x = 0.5;   // mane
    part(0.1, 0.5, 0.12, 0, 0.95, 0.84, dark).rotation.x = -0.5;              // tail
    this.legs = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.17, 0.88, sz * 0.56);
      g.add(hip);
      part(0.13, 0.9, 0.15, 0, -0.44, 0, coat, hip);
      part(0.14, 0.1, 0.16, 0, -0.86, 0, dark, hip);
      this.legs.push(hip);
    }
    game.scene.add(g);

    // moved by hand every step; pushes the player's side, lets its own side through
    const b = this.body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: materials.body });
    b.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.45, 0.85)), new CANNON.Vec3(0, 0.95, 0));
    b.collisionFilterGroup = G.PROP;
    b.collisionFilterMask = G.PCORE | G.PWEAP | G.RAG | G.PROP;
    b.hs = { type: 'static', kind: 'wood', horse: this };
    game.world.addBody(b);
    this.place();
  }

  get mounted() { return !this.free && this.rider && !this.rider.disposed && this.rider.state === 'active' && this.rider.mountH > 0; }

  place() {
    const b = this.body;
    b.position.set(this.x, 0, this.z);
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), this.yaw);
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.set(-this.rearT * 0.9, this.yaw, 0);
  }

  onRiderDown() {
    this.free = true;
    this.rearT = 0.5;
  }

  /** A blade or a thrown thing struck the horse. Hard enough and it rears and throws its rider. */
  onHit(c) {
    const g = this.game;
    g.effects.blood(c.point, c.rel.clone().normalize(), 14, 1);
    g.audio.hit(0.6, false);
    if (c.speed > 7 && this.mounted) {
      this.rearT = 0.7;
      const r = this.rider, f = r.forward(_v);
      r.goRagdoll(new THREE.Vector3(-f.x * 2.5, 2.6, -f.z * 2.5), 'torso', false);
      r.getUpAt = rand(1.6, 2.4);
      g.callout('VOM PFERD GEHOLT!', c.point, 'crit');
    }
  }

  update(dt) {
    if (this.disposed) return;
    const g = this.game;
    this.trampleCd -= dt;
    this.rearT = Math.max(0, this.rearT - dt);
    const px = this.x, pz = this.z;
    if (this.mounted) {
      const p = this.rider.core.position;
      this.x = p.x; this.z = p.z;
      this.yaw = this.rider.yawActual;
    } else {
      // riderless: slow to a walk, wander off towards the wall and stand there
      this.free = true;
      const r = Math.hypot(this.x, this.z);
      const want = r < 9.5 ? 2.2 : 0;
      this.speed += (want - this.speed) * dampFactor(1.5, dt);
      if (r < 9.5 && r > 0.5) this.yaw = angleLerp(this.yaw, Math.atan2(-this.x, -this.z), dampFactor(1.2, dt));
      this.x += -Math.sin(this.yaw) * this.speed * dt;
      this.z += -Math.cos(this.yaw) * this.speed * dt;
    }
    const vx = dt > 0 ? (this.x - px) / dt : 0, vz = dt > 0 ? (this.z - pz) / dt : 0;
    const sp = Math.hypot(vx, vz);
    this.body.velocity.set(clamp(vx, -14, 14), 0, clamp(vz, -14, 14));
    this.place();
    // gallop: diagonal pairs swing together
    this.phase += dt * (2 + sp * 1.5);
    const amp = clamp(sp / 8, 0, 1) * 0.75;
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * amp; });
    this.mesh.position.y = Math.abs(Math.sin(this.phase)) * 0.07 * amp;
    this.neck.rotation.x = Math.sin(this.phase * 2) * 0.06 * amp - this.rearT * 0.4;
    if (sp > 4 && Math.random() < dt * 9) g.effects.dust(_v.set(this.x, 0, this.z), 2, 1.2);

    // trample whoever is in front and not on its own side
    if (sp > 5 && this.trampleCd <= 0 && this.mounted) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      for (const k of g.fighters) {
        if (k === this.rider || k.team === this.rider.team || k.state !== 'active' || k.iframeT > 0 || k.mountH > 0 || k.groundY > 0.5) continue;
        const q = k.core.position;
        const dx = q.x - (this.x + fx * 0.9), dz = q.z - (this.z + fz * 0.9);
        if (Math.hypot(dx, dz) > 0.85) continue;
        this.trampleCd = 1.5;
        k.inj.wound('torso', 0.22, 'blunt', 1);
        k.goRagdoll(new THREE.Vector3(fx * sp * 0.55 + dx, 2.2, fz * sp * 0.55 + dz), 'torso', false);
        k.getUpAt = rand(1.4, 2.0);
        g.effects.impact(_v.set(q.x, 1, q.z), 1.4);
        g.audio.thud(1.2);
        if (k.isPlayer) { g.callout('NIEDERGERITTEN!', null, 'crit'); g.shake = 1; g.hurtFlash(30); }
        break;
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.game.world.removeBody(this.body);
    this.game.scene.remove(this.mesh);
    this.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
