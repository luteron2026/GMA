import { makePerson, animatePerson, setOutfit } from './models.js';
import { clamp } from './physics.js';
import { groundY } from './terrain.js';

const LOOK = { skin: 0xe8b98f, hair: 0x3b2a1a, shirt: 0x1f3a6e, pants: 0x2b2f3a, longHair: false };

export class Player {
  constructor(game, x, z) {
    this.game = game;
    this.mesh = makePerson(LOOK);
    game.scene.add(this.mesh);
    this.x = x; this.z = z;
    this.heading = Math.PI; // facing north
    this.speed = 0;
    this.joy = 100;
    this.vehicle = null;
    this.throwCd = 0;
    this.throwAnim = 0;
    this.phase = 0;
    this.hurtCd = 0;
    this.sinceHurt = 10;
    this.radius = 0.45;
  }

  get fx() { return Math.sin(this.heading); }
  get fz() { return Math.cos(this.heading); }

  resetOutfit() {
    setOutfit(this.mesh, { shirt: LOOK.shirt });
    const p = this.mesh.userData.parts;
    if (p.tie) { this.mesh.remove(p.tie); p.tie = null; }
  }

  update(dt) {
    const g = this.game, inp = g.input;
    this.throwCd = Math.max(0, this.throwCd - dt);
    this.throwAnim = Math.max(0, this.throwAnim - dt);
    this.hurtCd = Math.max(0, this.hurtCd - dt);
    this.sinceHurt += dt;
    if (this.sinceHurt > 5 && this.joy < 100) this.joy = Math.min(100, this.joy + 4 * dt);

    if (this.vehicle) {
      const v = this.vehicle;
      this.x = v.x; this.z = v.z; this.heading = v.heading;
      this.mesh.visible = false;
      if (inp.wasPressed('throw')) this.horn();
      return;
    }
    this.mesh.visible = true;

    const sprint = inp.isDown('sprint');
    const fwd = inp.forward, turn = inp.turn;
    const maxSpeed = sprint ? 8.5 : 5;
    // Tank-style turning (works the same with keys and the touch stick)
    this.heading -= turn * 3.2 * dt * (sprint ? 0.85 : 1);
    const target = fwd * (fwd < 0 ? 2.5 : maxSpeed);
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    // Climbing is slower than walking on the flat
    const here = groundY(this.x, this.z);
    const grade = (groundY(this.x + this.fx * Math.sign(this.speed), this.z + this.fz * Math.sign(this.speed)) - here);
    const climb = clamp(1 - Math.max(0, grade) * 0.9, 0.4, 1);
    this.x += this.fx * this.speed * climb * dt;
    this.z += this.fz * this.speed * climb * dt;

    const r = g.world.colliders.resolve(this.x, this.z, this.radius);
    this.x = r.x; this.z = r.z;
    // Don't walk through vehicles
    for (const v of g.vehicles) {
      if (Math.abs(v.x - this.x) > 6 || Math.abs(v.z - this.z) > 6) continue;
      for (const [cx, cz] of v.circles()) {
        const dx = this.x - cx, dz = this.z - cz;
        const d = Math.hypot(dx, dz), min = v.circleR + this.radius;
        if (d < min && d > 1e-4) {
          this.x = cx + (dx / d) * min; this.z = cz + (dz / d) * min;
          if (Math.abs(v.speed) > 6 && !v.drivenByPlayer) this.hurt(6, 'Watch for traffic! (Even golf carts.)');
        }
      }
    }

    this.phase += Math.abs(this.speed) * dt * 2.2;
    animatePerson(this.mesh, this.phase, clamp(Math.abs(this.speed) / 5, 0, 1.2), { throwing: this.throwAnim > 0 });
    this.mesh.position.set(this.x, groundY(this.x, this.z), this.z);
    this.mesh.rotation.y = this.heading;

    if (inp.wasPressed('throw') && this.throwCd <= 0) this.throwBible();
  }

  throwBible() {
    const g = this.game;
    this.throwCd = 0.32;
    this.throwAnim = 0.2;
    // Gentle auto-aim toward the closest imp in front
    let dir = this.heading;
    let best = 0.6, bestD = 30;
    for (const imp of g.allEnemies()) {
      if (imp.dead) continue;
      const dx = imp.x - this.x, dz = imp.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const a = Math.atan2(dx, dz);
      let diff = a - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < best) { best = Math.abs(diff); dir = a; bestD = d; }
    }
    g.spawnBible(this.x + Math.sin(dir) * 0.6, this.z + Math.cos(dir) * 0.6, dir);
    g.audio.throw();
  }

  horn() {
    const g = this.game, v = this.vehicle;
    if (v.hornCd > 0) return;
    v.hornCd = 4;
    g.audio.horn();
    g.hornWave(v.x, v.z);
  }

  hurt(amount, msg) {
    if (this.hurtCd > 0 || this.game.state !== 'play') return;
    this.hurtCd = 0.8;
    this.sinceHurt = 0;
    this.joy = Math.max(0, this.joy - amount);
    this.game.audio.hurt();
    this.game.hud.flashHurt();
    if (msg) this.game.toast(msg);
    if (this.joy <= 0) this.game.faint();
  }

  enter(v) {
    this.vehicle = v;
    v.drivenByPlayer = true;
    v.ai = null;
    this.mesh.visible = false;
    this.speed = 0;
  }

  exit() {
    const v = this.vehicle;
    if (!v) return;
    v.drivenByPlayer = false;
    this.vehicle = null;
    // Step out on the left side (or right if blocked)
    const side = [-v.fz, v.fx];
    for (const s of [1, -1]) {
      const x = v.x + side[0] * s * (v.spec.width / 2 + 1), z = v.z + side[1] * s * (v.spec.width / 2 + 1);
      if (!this.game.world.colliders.pointBlocked(x, z, 0.5)) { this.x = x; this.z = z; break; }
      this.x = v.x - v.fx * (v.spec.length / 2 + 1); this.z = v.z - v.fz * (v.spec.length / 2 + 1);
    }
    this.mesh.visible = true;
    this.mesh.position.set(this.x, groundY(this.x, this.z), this.z);
  }

  teleport(x, z, heading = Math.PI) {
    if (this.vehicle) this.exit();
    this.x = x; this.z = z; this.heading = heading; this.speed = 0;
    this.mesh.position.set(x, groundY(x, z), z);
  }
}
