import { makeImp, makeBoss, makeBible, makeFireball } from './models.js';
import { angleDiff } from './physics.js';

export class Imp {
  constructor(game, x, z, opts = {}) {
    this.game = game;
    this.mesh = makeImp();
    game.scene.add(this.mesh);
    this.x = x; this.z = z;
    this.heading = 0;
    this.radius = 0.6;
    this.state = 'chase';
    this.stunT = 0;
    this.attackCd = 0;
    this.dead = false;
    this.t = Math.random() * 10;
    this.speed = opts.speed ?? 5.2;
    this.tag = opts.tag || null;
    this.fadeT = 0;
    this.spawnT = 0.6;
  }

  stun(t = 4) {
    if (this.dead) return;
    if (this.state === 'stunned') { this.banish(); return; }
    this.state = 'stunned';
    this.stunT = t;
    this.game.audio.hit();
  }

  banish(silent = false) {
    if (this.dead) return;
    this.dead = true;
    this.fadeT = 0.5;
    if (!silent) {
      this.game.audio.banish();
      this.game.onImpBanished(this);
    }
  }

  flee() { if (!this.dead) this.state = 'flee'; }

  update(dt) {
    const g = this.game;
    this.t += dt;
    if (this.dead) {
      this.fadeT -= dt;
      this.mesh.scale.setScalar(Math.max(0.01, this.fadeT * 2));
      this.mesh.position.y += dt * 4;
      this.mesh.rotation.y += dt * 12;
      return this.fadeT > 0;
    }
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      this.mesh.scale.setScalar(1 - Math.max(0, this.spawnT) / 0.6);
    }
    const p = g.player;
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    this.attackCd = Math.max(0, this.attackCd - dt);

    if (this.state === 'stunned') {
      this.stunT -= dt;
      this.mesh.rotation.z = Math.sin(this.t * 10) * 0.25;
      this.mesh.position.set(this.x, 0, this.z);
      if (this.stunT <= 0) { this.state = 'chase'; this.mesh.rotation.z = 0; }
      return true;
    }

    let speed = this.speed, want;
    if (this.state === 'flee') {
      want = Math.atan2(-dx, -dz);
      speed = 7;
      if (d > 70) { this.banish(true); }
    } else {
      want = Math.atan2(dx, dz);
    }
    this.heading += angleDiff(this.heading, want) * Math.min(1, dt * 6);
    if (this.state !== 'flee' && d < 1.3) speed = 0;
    this.x += Math.sin(this.heading) * speed * dt;
    this.z += Math.cos(this.heading) * speed * dt;
    const r = g.world.colliders.resolve(this.x, this.z, this.radius);
    this.x = r.x; this.z = r.z;

    // Contact with the player
    if (this.state === 'chase') {
      const v = p.vehicle;
      const reach = v ? v.spec.width / 2 + 1.1 : 1.5;
      if (v && Math.abs(v.speed) > 5 && this.hitsVehicle(v)) {
        this.banish();
        g.shake(0.2);
      } else if (d < reach && this.attackCd <= 0) {
        this.attackCd = 1.1;
        p.hurt(v ? 5 : 9, null);
        g.audio.imp();
      }
    }
    // Hop + flap
    const hop = Math.abs(Math.sin(this.t * 9)) * 0.35;
    this.mesh.position.set(this.x, hop, this.z);
    this.mesh.rotation.y = this.heading;
    const parts = this.mesh.userData.parts;
    parts.wingL.rotation.y = Math.sin(this.t * 20) * 0.6;
    parts.wingR.rotation.y = -Math.sin(this.t * 20) * 0.6;
    return true;
  }

  hitsVehicle(v) {
    for (const [cx, cz] of v.circles()) {
      if (Math.hypot(this.x - cx, this.z - cz) < v.circleR + this.radius) return true;
    }
    return false;
  }

  dispose() { this.game.scene.remove(this.mesh); }
}

export class Boss {
  constructor(game, x, z) {
    this.game = game;
    this.mesh = makeBoss();
    game.scene.add(this.mesh);
    this.x = x; this.z = z;
    this.homeX = x; this.homeZ = z;
    this.heading = 0;
    this.radius = 2.4;
    this.phase = 1;
    this.maxPhase = 3;
    this.stagger = 0;
    this.staggerMax = 5;
    this.state = 'fight';
    this.stunT = 0;
    this.t = 0;
    this.fireCd = 2;
    this.summonCd = 6;
    this.dashT = 0;
    this.dead = false;
    this.name = 'The Tempter';
  }

  stun() {
    if (this.state !== 'fight') return;
    this.stagger++;
    this.game.audio.hit();
    this.mesh.scale.setScalar(3.6 * 0.92);
    setTimeout(() => this.mesh && !this.dead && this.mesh.scale.setScalar(3.6), 100);
    if (this.stagger >= this.staggerMax) {
      this.state = 'stunned';
      this.stunT = 6;
      this.game.toast('The Tempter is stunned. Get close and KICK! [E]');
    }
  }

  kick() {
    if (this.state !== 'stunned') return false;
    this.phase++;
    this.stagger = 0;
    this.game.audio.banish();
    this.game.shake(0.8);
    if (this.phase > this.maxPhase) {
      this.state = 'dying';
      this.dieT = 2.5;
      return true;
    }
    this.state = 'fight';
    this.staggerMax += 1;
    this.game.toast(['', '', 'He staggers! Phase 2: "Did God really say chapel is mandatory?"', 'Final phase! He is out of arguments.'][this.phase]);
    // Knock the player back a bit
    const p = this.game.player;
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz) || 1;
    p.x += (dx / d) * 4; p.z += (dz / d) * 4;
    return true;
  }

  get stunned() { return this.state === 'stunned'; }

  update(dt) {
    const g = this.game;
    this.t += dt;
    if (this.state === 'dying') {
      this.dieT -= dt;
      this.mesh.rotation.y += dt * 8;
      this.mesh.position.y = (2.5 - this.dieT) * 3;
      this.mesh.scale.setScalar(Math.max(0.01, 3.6 * (this.dieT / 2.5)));
      if (this.dieT <= 0) { this.dead = true; return false; }
      return true;
    }
    const p = g.player;
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (this.state === 'stunned') {
      this.stunT -= dt;
      this.mesh.rotation.z = Math.sin(this.t * 6) * 0.2;
      if (this.stunT <= 0) { this.state = 'fight'; this.stagger = 0; this.mesh.rotation.z = 0; }
      this.mesh.position.set(this.x, 0, this.z);
      return true;
    }
    const want = Math.atan2(dx, dz);
    this.heading += angleDiff(this.heading, want) * Math.min(1, dt * 3);
    // Circle-strafe around the arena, occasionally dash at the player
    this.dashT -= dt;
    let speed = 2.5 + this.phase;
    if (this.dashT > 0) speed = 11 + this.phase * 2;
    else if (Math.random() < dt * 0.15 * this.phase) this.dashT = 0.9;
    const moveDir = this.dashT > 0 ? want : want + Math.PI / 2 * Math.sin(this.t * 0.4);
    if (d > 3 || this.dashT <= 0) {
      this.x += Math.sin(moveDir) * speed * dt;
      this.z += Math.cos(moveDir) * speed * dt;
    }
    // Stay near the arena
    const ax = this.x - this.homeX, az = this.z - this.homeZ, ad = Math.hypot(ax, az);
    if (ad > 26) { this.x = this.homeX + (ax / ad) * 26; this.z = this.homeZ + (az / ad) * 26; }
    const r = g.world.colliders.resolve(this.x, this.z, this.radius);
    this.x = r.x; this.z = r.z;

    if (d < 3.4) p.hurt(14, null);

    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      this.fireCd = 2.6 - this.phase * 0.45;
      const n = this.phase + 1;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.22;
        g.spawnFireball(this.x, this.z, want + spread);
      }
    }
    this.summonCd -= dt;
    if (this.summonCd <= 0) {
      this.summonCd = 11 - this.phase * 2;
      g.spawnImpsAround(this.x, this.z, this.phase + 1, 6);
    }
    const bob = Math.sin(this.t * 3) * 0.3;
    this.mesh.position.set(this.x, bob + 0.3, this.z);
    this.mesh.rotation.y = this.heading;
    const parts = this.mesh.userData.parts;
    parts.wingL.rotation.y = Math.sin(this.t * 8) * 0.5;
    parts.wingR.rotation.y = -Math.sin(this.t * 8) * 0.5;
    return true;
  }

  dispose() { this.game.scene.remove(this.mesh); }
}

export class Projectile {
  constructor(game, kind, x, z, dir) {
    this.game = game;
    this.kind = kind;
    this.mesh = kind === 'bible' ? makeBible() : makeFireball();
    game.scene.add(this.mesh);
    this.x = x; this.z = z;
    this.y = kind === 'bible' ? 1.4 : 2;
    const sp = kind === 'bible' ? 24 : 13;
    this.vx = Math.sin(dir) * sp; this.vz = Math.cos(dir) * sp;
    this.vy = kind === 'bible' ? 2.5 : 0;
    this.life = kind === 'bible' ? 1.1 : 3;
    this.spin = 0;
  }

  update(dt) {
    const g = this.game;
    this.life -= dt;
    this.x += this.vx * dt; this.z += this.vz * dt;
    if (this.kind === 'bible') { this.vy -= 9 * dt; this.y = Math.max(0.2, this.y + this.vy * dt); }
    this.spin += dt * 14;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(this.kind === 'bible' ? this.spin : 0, this.spin * 0.5, 0);
    if (g.world.colliders.pointBlocked(this.x, this.z, 0.1)) return false;
    if (this.kind === 'bible') {
      for (const e of g.allEnemies()) {
        if (e.dead) continue;
        if (Math.hypot(e.x - this.x, e.z - this.z) < e.radius + 0.5) { e.stun(); return false; }
      }
    } else {
      const p = g.player;
      if (Math.hypot(p.x - this.x, p.z - this.z) < (p.vehicle ? 2 : 1)) { p.hurt(16, null); return false; }
    }
    return this.life > 0;
  }

  dispose() { this.game.scene.remove(this.mesh); }
}
