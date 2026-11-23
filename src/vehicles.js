import * as THREE from 'three';
import { makeVehicle, makePerson, randomLook, VEHICLE_TYPES, animatePerson } from './models.js';
import { clamp, angleDiff } from './physics.js';
import { groundY } from './terrain.js';

export class Vehicle {
  constructor(game, type, x, z, heading = 0, color) {
    this.game = game;
    this.type = type;
    this.spec = VEHICLE_TYPES[type];
    color = color ?? this.spec.colors[Math.floor(Math.random() * this.spec.colors.length)];
    this.mesh = makeVehicle(type, color);
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.ai = null;
    this.driver = null; // mesh of AI driver
    this.drivenByPlayer = false;
    this.passengers = 0;
    this.hornCd = 0;
    this.honkCd = 0;
    this.wheelSpin = 0;
    this.alt = 0; // helicopter height above the ground
    this.climb = 0;
    this.rotorSpin = 0;
    this.circleR = this.spec.width * 0.55;
    this.circleOff = Math.max(0, this.spec.length / 2 - this.spec.width * 0.5);
    game.scene.add(this.mesh);
    this.sync();
  }

  get fx() { return Math.sin(this.heading); }
  get fz() { return Math.cos(this.heading); }
  get name() { return this.spec.label; }

  addDriver() {
    if (this.driver) return;
    const p = makePerson(randomLook());
    p.scale.setScalar(0.95);
    const seatZ = this.type === 'cart' || this.type === 'deanCart' ? -0.25 : (this.type === 'truck' ? this.spec.length * 0.12 : 0);
    p.position.set(this.type === 'cart' || this.type === 'deanCart' ? -0.3 : -0.4, this.type === 'cart' || this.type === 'deanCart' ? -0.15 : -0.05, seatZ);
    animatePerson(p, 0, 0, { sitting: true });
    this.mesh.add(p);
    this.driver = p;
  }

  removeDriver() {
    if (!this.driver) return null;
    const look = this.driver.userData.look;
    this.mesh.remove(this.driver);
    this.driver = null;
    return look;
  }

  setAI(lane, startIndex = 0) {
    this.ai = { lane, idx: startIndex, cruise: lane.loop ? 9 + Math.random() * 2 : 13 + Math.random() * 3, wait: 0 };
    this.addDriver();
    const p = lane.pts[startIndex];
    const q = lane.pts[(startIndex + 1) % lane.pts.length];
    this.x = p[0]; this.z = p[1];
    this.heading = Math.atan2(q[0] - p[0], q[1] - p[1]);
  }

  get airborne() { return this.alt > 1.5; }

  update(dt) {
    let throttle = 0, steer = 0, handbrake = false;
    const inp = this.game.input;
    if (this.spec.air) {
      this.flight(dt);
      this.hornCd = Math.max(0, this.hornCd - dt);
      this.sync(dt);
      return;
    }
    if (this.drivenByPlayer) {
      throttle = inp.forward;
      steer = inp.turn;
      handbrake = inp.isDown('sprint');
    } else if (this.ai) {
      [throttle, steer] = this.aiControl(dt);
    }
    this.physics(dt, throttle, steer, handbrake);
    this.hornCd = Math.max(0, this.hornCd - dt);
    this.honkCd = Math.max(0, this.honkCd - dt);
    this.sync(dt);
  }

  physics(dt, throttle, steer, handbrake) {
    const s = this.spec;
    if (throttle > 0) {
      if (this.speed < 0) this.speed += s.brake * dt;
      else this.speed += s.accel * throttle * (1 - this.speed / s.maxSpeed) * dt * 1.4;
    } else if (throttle < 0) {
      if (this.speed > 0.5) this.speed -= s.brake * dt;
      else this.speed = Math.max(-s.maxSpeed * 0.35, this.speed - s.accel * 0.6 * dt);
    } else {
      const roll = 2.5 * dt;
      this.speed = Math.abs(this.speed) < roll ? 0 : this.speed - Math.sign(this.speed) * roll;
    }
    // Hills: gravity pulls along the slope while the car is moving or the driver is on the pedals
    if (this.drivenByPlayer || this.ai) {
      const L = this.spec.length * 0.45;
      const grade = (groundY(this.x + this.fx * L, this.z + this.fz * L) - groundY(this.x - this.fx * L, this.z - this.fz * L)) / (2 * L);
      if (throttle !== 0 || Math.abs(this.speed) > 0.6) this.speed -= 9.8 * 0.75 * (grade / Math.sqrt(1 + grade * grade)) * dt;
    }
    if (handbrake) this.speed *= Math.max(0, 1 - 2.8 * dt);
    this.speed = clamp(this.speed, -s.maxSpeed * 0.35, s.maxSpeed);

    this.steer += (steer - this.steer) * Math.min(1, dt * 8);
    // Tracks turn in place; wheels need to be rolling to steer
    const grip = s.tracks ? 1 : clamp(Math.abs(this.speed) / 5, 0, 1) * (handbrake ? 1.5 : 1);
    const dir = s.tracks || this.speed >= 0 ? 1 : -1;
    this.heading -= this.steer * s.turn * grip * dir * dt;

    this.x += this.fx * this.speed * dt;
    this.z += this.fz * this.speed * dt;
    this.collideWorld();
  }

  // Helicopter: Space (📖) climbs, Shift (⚡) descends, forward/back fly, left/right turn.
  // It needs to be off the ground to move, and lands wherever it's let down.
  flight(dt) {
    const s = this.spec, inp = this.game.input;
    const flying = this.drivenByPlayer;
    let fwd = 0, turn = 0, up = 0;
    if (flying) {
      fwd = inp.forward; turn = inp.turn;
      up = (inp.isDown('throw') ? 1 : 0) - (inp.isDown('sprint') ? 1 : 0);
    } else if (this.alt > 0) up = -1; // nobody at the controls: settle down
    const target = this.alt > 1 ? fwd * (fwd < 0 ? s.maxSpeed * 0.35 : s.maxSpeed) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * (fwd ? 0.9 : 0.6));
    this.climb += (up * 7 - this.climb) * Math.min(1, dt * 3);
    this.alt = clamp(this.alt + this.climb * dt, 0, 120);
    if (this.alt <= 0) { this.climb = Math.max(0, this.climb); if (this.alt <= 0) this.speed *= Math.max(0, 1 - dt * 4); }
    this.steer += (turn - this.steer) * Math.min(1, dt * 4);
    if (this.alt > 0.5) this.heading -= this.steer * s.turn * dt;
    this.x += this.fx * this.speed * dt;
    this.z += this.fz * this.speed * dt;
    // Stay over the map
    const w = this.game.world, b = w.bounds;
    this.x = clamp(this.x, b.minX + 6, b.maxX - 6);
    this.z = clamp(this.z, b.minZ + 6, b.maxZ - 6);
    // Low down it bumps into things like any vehicle; up high it clears the rooftops
    if (this.alt < 14) this.collideWorld();
    const spinUp = flying ? 1 : (this.alt > 0 ? 0.6 : 0);
    this.rotorRate = (this.rotorRate || 0) + (spinUp * 28 - (this.rotorRate || 0)) * Math.min(1, dt * 0.8);
  }

  circles() {
    const o = this.circleOff;
    return [[this.x + this.fx * o, this.z + this.fz * o], [this.x - this.fx * o, this.z - this.fz * o]];
  }

  collideWorld() {
    let hit = false, nx = 0, nz = 0;
    for (const [cx, cz] of this.circles()) {
      const r = this.game.world.colliders.resolve(cx, cz, this.circleR);
      if (r.hit) {
        this.x += r.x - cx; this.z += r.z - cz;
        hit = true; nx = r.nx; nz = r.nz;
      }
    }
    if (hit) this.impact(Math.abs(this.speed * (this.fx * nx + this.fz * nz)), 0.35);
  }

  impact(strength, keep = 0.5) {
    if (strength > 2) {
      this.speed *= keep;
      if (this.drivenByPlayer) {
        if (strength > 4) this.game.audio.bump();
        this.game.shake(Math.min(0.6, strength * 0.05));
        this.game.missions.onVehicleImpact(this, strength);
      }
    }
  }

  aiControl(dt) {
    const ai = this.ai;
    const pts = ai.lane.pts;
    const n = pts.length;
    let tgt = pts[ai.idx];
    if (Math.hypot(tgt[0] - this.x, tgt[1] - this.z) < 7) {
      ai.idx++;
      if (ai.idx >= n) {
        if (ai.lane.loop) ai.idx = 0;
        else {
          // Reached the end of an open road: reappear at the start if nobody is watching
          const st = pts[0];
          const p = this.game.player;
          if (Math.hypot(p.x - st[0], p.z - st[1]) > 80 && Math.hypot(p.x - this.x, p.z - this.z) > 60) {
            this.x = st[0]; this.z = st[1]; ai.idx = 1;
            this.heading = Math.atan2(pts[1][0] - st[0], pts[1][1] - st[1]);
            this.speed = 0;
          } else { ai.idx = n - 1; return [-1, 0]; }
        }
      }
      tgt = pts[ai.idx % n];
    }
    const want = Math.atan2(tgt[0] - this.x, tgt[1] - this.z);
    const d = angleDiff(this.heading, want);
    const steer = clamp(-d * 2.2, -1, 1);
    // Slow for corners and obstacles
    let cruise = ai.cruise * (1 - Math.min(0.6, Math.abs(d)));
    const blocked = this.obstacleAhead();
    if (blocked) {
      cruise = 0;
      if (blocked === 'player' && this.honkCd <= 0 && Math.hypot(this.game.player.x - this.x, this.game.player.z - this.z) < 9) {
        this.honkCd = 6;
        this.game.audio.beep();
      }
    }
    const throttle = this.speed < cruise - 0.5 ? 1 : this.speed > cruise + 1 ? -1 : 0;
    return [throttle, steer];
  }

  obstacleAhead() {
    const g = this.game;
    const look = 4 + Math.max(0, this.speed) * 0.9;
    const check = (x, z, r) => {
      const dx = x - this.x, dz = z - this.z;
      const along = dx * this.fx + dz * this.fz;
      if (along < 0 || along > look + this.spec.length / 2) return false;
      const side = Math.abs(dx * this.fz - dz * this.fx);
      return side < this.spec.width / 2 + r + 0.4;
    };
    const p = g.player;
    if (!p.vehicle && check(p.x, p.z, 0.5)) return 'player';
    for (const v of g.vehicles) if (v !== this && !v.airborne && check(v.x, v.z, v.spec.width / 2)) return v.drivenByPlayer ? 'player' : 'car';
    for (const npc of g.npcs) if (npc.visible && check(npc.x, npc.z, 0.4)) return 'npc';
    return null;
  }

  sync(dt = 0) {
    if (this.spec.air) {
      // Body follows the ground when landed; in the air it noses down to fly forward and
      // banks into turns
      const L = this.spec.length * 0.3;
      const hf = groundY(this.x + this.fx * L, this.z + this.fz * L), hb = groundY(this.x - this.fx * L, this.z - this.fz * L);
      const g = Math.max(hf, hb);
      const air = clamp(this.alt / 2, 0, 1);
      this.mesh.position.set(this.x, (hf + hb) / 2 * (1 - air) + g * air + this.alt, this.z);
      this.mesh.rotation.order = 'YXZ';
      this.mesh.rotation.y = this.heading;
      const groundPitch = -Math.atan2(hf - hb, 2 * L);
      this.mesh.rotation.x = groundPitch * (1 - air) + air * clamp(this.speed / this.spec.maxSpeed, -0.5, 1) * 0.22;
      this.mesh.rotation.z = -this.steer * 0.25 * air;
      this.rotorSpin += (this.rotorRate || 0) * dt;
      const ud = this.mesh.userData;
      ud.rotor.rotation.y = this.rotorSpin;
      ud.tailRotor.rotation.x = this.rotorSpin * 1.7;
      return;
    }
    // Sit on the ground: pitch and roll from the ground under the wheels
    const L = this.spec.length * 0.42, Wd = this.spec.width * 0.42;
    const hf = groundY(this.x + this.fx * L, this.z + this.fz * L), hb = groundY(this.x - this.fx * L, this.z - this.fz * L);
    // local +x of the body is world (fz, -fx)
    const hr = groundY(this.x + this.fz * Wd, this.z - this.fx * Wd), hl = groundY(this.x - this.fz * Wd, this.z + this.fx * Wd);
    // Speed bumps: a bounce, and a jolt if the player takes one too fast
    const bump = this.game.world.bumpHeight(this.x + this.fx * L, this.z + this.fz * L) + this.game.world.bumpHeight(this.x - this.fx * L, this.z - this.fz * L);
    if (bump > 0.05 && !this.onBump && this.drivenByPlayer && Math.abs(this.speed) > 9) {
      this.game.shake(0.3);
      this.game.audio.bump();
      this.speed *= 0.85;
    }
    this.onBump = bump > 0.05;
    this.mesh.position.set(this.x, (hf + hb + hl + hr) / 4 + bump * 1.5, this.z);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.x = -Math.atan2(hf - hb, 2 * L);
    const tilt = Math.atan2(hr - hl, 2 * Wd);
    this.wheelSpin += (this.speed * dt) / this.mesh.userData.wheelR;
    const ws = this.mesh.userData.wheels;
    for (let i = 0; i < ws.length; i++) {
      ws[i].rotation.x = this.wheelSpin;
      // front wheels are the ones at +z (index 1 and 3)
      ws[i].rotation.y = i % 2 === 1 && !this.mesh.userData.noSteer ? -this.steer * 0.45 : 0;
    }
    // Slight body lean in turns
    this.mesh.rotation.z = tilt - (this.spec.tracks ? 0 : this.steer * clamp(this.speed / 25, -1, 1) * 0.05);
    const ud = this.mesh.userData;
    if (ud.turret) {
      // The barrel recoils after a shot and the flash fades
      this.fireT = Math.max(0, (this.fireT || 0) - dt);
      ud.barrel.position.z = 1.45 - this.fireT * 1.2;
      ud.flash.visible = this.fireT > 0.25;
    }
  }

  dispose() {
    this.game.scene.remove(this.mesh);
  }
}

// Resolve overlaps between vehicles, and between vehicles and pedestrians/imps
export function vehicleContacts(game) {
  const vs = game.vehicles;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const ca = a.circles();
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j];
      if (Math.abs(a.x - b.x) > 8 || Math.abs(a.z - b.z) > 8) continue;
      if (a.airborne || b.airborne) continue;
      const cb = b.circles();
      for (const p of ca) for (const q of cb) {
        const dx = p[0] - q[0], dz = p[1] - q[1];
        const d = Math.hypot(dx, dz), min = a.circleR + b.circleR;
        if (d < min && d > 1e-4) {
          const nx = dx / d, nz = dz / d;
          // The tank doesn't get shoved around; whatever it hits does
          const wa = a.spec.heavy ? 0 : b.spec.heavy ? 1 : 0.5, wb = 1 - wa;
          a.x += nx * (min - d) * wa; a.z += nz * (min - d) * wa;
          b.x -= nx * (min - d) * wb; b.z -= nz * (min - d) * wb;
          const rel = Math.abs(a.speed - b.speed);
          if (rel > 2) {
            a.impact(rel, 0.5); b.impact(rel, 0.5);
            if (!b.drivenByPlayer && !b.ai) b.speed += a.speed * 0.3;
            if (!a.drivenByPlayer && !a.ai) a.speed += b.speed * 0.3;
          }
        }
      }
    }
  }
}

export const tmpV = new THREE.Vector3();
