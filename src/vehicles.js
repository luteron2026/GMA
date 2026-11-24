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
    const s = this.spec, inp = this.game.input, w = this.game.world;
    const flying = this.drivenByPlayer;
    // Height is kept as an absolute value (this.y), so the chopper holds its altitude over
    // hills and ravines instead of riding up and down with the ground under it
    if (this.y === undefined) this.y = this.floorUnder();
    let fwd = 0, turn = 0, up = 0;
    if (flying) {
      fwd = inp.forward; turn = inp.turn;
      up = (inp.isDown('throw') ? 1 : 0) - (inp.isDown('sprint') ? 1 : 0);
    } else if (this.alt > 0.02) up = -1; // nobody at the controls: settle down
    const target = this.alt > 1 ? fwd * (fwd < 0 ? s.maxSpeed * 0.35 : s.maxSpeed) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * (fwd ? 0.9 : 0.6));
    this.climb += (up * 7 - this.climb) * Math.min(1, dt * 3);
    this.y = Math.min(this.y + this.climb * dt, w.groundY(this.x, this.z) + 140);
    this.steer += (turn - this.steer) * Math.min(1, dt * 4);
    if (this.alt > 0.5) this.heading -= this.steer * s.turn * dt;
    this.x += this.fx * this.speed * dt;
    this.z += this.fz * this.speed * dt;
    // Stay over the map
    const b = w.bounds;
    this.x = clamp(this.x, b.minX + 6, b.maxX - 6);
    this.z = clamp(this.z, b.minZ + 6, b.maxZ - 6);
    // Bump into whatever stands taller than the skids: walls, trees, poles. Anything below
    // (a roof it's flying over, a fence) doesn't push it around
    this.collideWorld(this.y + 0.4);
    // Rest on the highest thing under the skids: the ground or a rooftop
    const floor = this.floorUnder();
    if (this.y <= floor) {
      this.y = floor;
      this.climb = Math.max(0, this.climb);
    }
    this.alt = this.y - floor;
    if (this.alt < 0.05) this.speed *= Math.max(0, 1 - dt * 4);
    const spinUp = flying ? 1 : (this.alt > 0.05 ? 0.6 : 0);
    this.rotorRate = (this.rotorRate || 0) + (spinUp * 28 - (this.rotorRate || 0)) * Math.min(1, dt * 0.8);
  }

  // Skid contact points (front/back on both sides) in world space
  skids() {
    const sx = this.fz, sz = -this.fx; // local +x
    const out = [];
    for (const side of [-1.1, 1.1]) for (const along of [-0.9, 1.7]) out.push([this.x + sx * side + this.fx * along, this.z + sz * side + this.fz * along]);
    return out;
  }

  floorUnder() {
    const w = this.game.world;
    let f = w.surfaceAt(this.x, this.z);
    for (const [x, z] of this.skids()) f = Math.max(f, w.surfaceAt(x, z));
    return f;
  }

  // Height of the bottom of the body (for telling apart things above and below each other)
  get bodyY() { return this.mesh.position.y; }

  circles() {
    const o = this.circleOff;
    return [[this.x + this.fx * o, this.z + this.fz * o], [this.x - this.fx * o, this.z - this.fz * o]];
  }

  collideWorld(above = -Infinity) {
    let hit = false, nx = 0, nz = 0;
    for (const [cx, cz] of this.circles()) {
      const r = this.game.world.colliders.resolve(cx, cz, this.circleR, above);
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
    // Stuck behind something that isn't moving (a car the player left in the road, say):
    // once nobody is looking, start over somewhere else
    ai.stuckT = Math.abs(this.speed) < 0.5 ? (ai.stuckT || 0) + dt : 0;
    if (ai.stuckT > 10 && this.respawnOutOfSight()) return [0, 0];
    if (Math.hypot(tgt[0] - this.x, tgt[1] - this.z) < 7) {
      ai.idx++;
      if (ai.idx >= n) {
        if (ai.lane.loop) ai.idx = 0;
        else {
          // Reached the end of an open road: reappear at a start if nobody is watching,
          // otherwise U-turn onto the other side of the road, or else pull up and wait
          // (never shuffle back and forth on the spot)
          if (this.respawnOutOfSight()) return [0, 0];
          const back = this.game.world.reverseLane(ai.lane, this.x, this.z, this.fx, this.fz);
          if (back) { ai.lane = back; ai.idx = Math.min(1, back.pts.length - 1); return this.aiControl(dt); }
          ai.idx = n - 1;
          return [this.speed > 0.5 ? -1 : 0, 0];
        }
      }
      tgt = pts[ai.idx % n];
    }
    const want = Math.atan2(tgt[0] - this.x, tgt[1] - this.z);
    const d = angleDiff(this.heading, want);
    const steer = clamp(-d * 2.2, -1, 1);
    // Slow for corners and obstacles
    let cruise = ai.cruise * (1 - Math.min(0.6, Math.abs(d)));
    // Two AI vehicles waiting on each other (at a tight corner where the lanes cross) would
    // wait forever: after a few seconds, ease forward past other traffic for a moment
    ai.creep = Math.max(0, (ai.creep || 0) - dt);
    let blocked = this.obstacleAhead();
    ai.trafficT = blocked === 'traffic' ? (ai.trafficT || 0) + dt : 0;
    if (ai.trafficT > 4) { ai.creep = 2.5; ai.trafficT = 0; }
    if (blocked === 'traffic' && ai.creep > 0) { blocked = null; cruise = Math.min(cruise, 3); }
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

  // Move an AI vehicle to the start of a lane like its own, where the player can't see it
  // pop in and no other vehicle is parked. Only when the player isn't near it either.
  respawnOutOfSight() {
    const g = this.game, p = g.player, ai = this.ai;
    if (Math.hypot(p.x - this.x, p.z - this.z) < 60) return false;
    const own = this.homeLane ? this.homeLane.lane : ai.lane;
    const cands = [own, ...g.world.lanes.filter((l) => l !== own && l.kind === own.kind && !l.loop)];
    for (const lane of cands) {
      const [sx, sz] = lane.pts[0];
      if (Math.hypot(p.x - sx, p.z - sz) < 80) continue;
      if (g.vehicles.some((v) => v !== this && Math.hypot(v.x - sx, v.z - sz) < 10)) continue;
      ai.lane = lane; ai.idx = 1; ai.stuckT = 0;
      this.x = sx; this.z = sz;
      this.heading = Math.atan2(lane.pts[1][0] - sx, lane.pts[1][1] - sz);
      this.speed = 0;
      return true;
    }
    return false;
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
    for (const v of g.vehicles) {
      if (v === this || v.airborne || !check(v.x, v.z, v.spec.width / 2)) continue;
      if (v.drivenByPlayer) return 'player';
      if (!v.ai) return 'car';
      // Oncoming traffic is in the other lane: don't stop for it
      if (v.fx * this.fx + v.fz * this.fz < -0.5) continue;
      return 'traffic';
    }
    for (const npc of g.npcs) if (npc.visible && check(npc.x, npc.z, 0.4)) return 'npc';
    return null;
  }

  sync(dt = 0) {
    if (this.spec.air) {
      // Landed: sit level on the skids (ground or roof). Flying: nose down to go forward and
      // bank into turns
      if (this.y === undefined) this.y = this.floorUnder();
      const w = this.game.world;
      const air = clamp(this.alt / 1.5, 0, 1);
      let pitch = 0, roll = 0;
      if (air < 1) {
        const [bl, fl, br, fr] = this.skids().map(([x, z]) => w.surfaceAt(x, z)); // order from skids()
        pitch = -Math.atan2((fl + fr) / 2 - (bl + br) / 2, 2.6);
        roll = Math.atan2((fr + br) / 2 - (fl + bl) / 2, 2.2);
        // Don't tip over at a roof edge: only follow gentle slopes
        if (Math.abs(pitch) > 0.25 || Math.abs(roll) > 0.25) pitch = roll = 0;
      }
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.rotation.order = 'YXZ';
      this.mesh.rotation.y = this.heading;
      this.mesh.rotation.x = pitch * (1 - air) + air * clamp(this.speed / this.spec.maxSpeed, -0.5, 1) * 0.22;
      this.mesh.rotation.z = roll * (1 - air) - this.steer * 0.25 * air;
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
      const ud0 = this.mesh.userData;
      if (ud0.rearSteer) ws[i].rotation.y = i % 2 === 0 ? this.steer * 0.7 : 0; // forklift: back wheels steer
      else ws[i].rotation.y = i % 2 === 1 && !ud0.noSteer ? -this.steer * 0.45 : 0;
    }
    // Slight body lean in turns
    this.mesh.rotation.z = tilt - (this.spec.tracks ? 0 : this.steer * clamp(this.speed / 25, -1, 1) * 0.05);
    const ud = this.mesh.userData;
    if (ud.carriage) {
      // Forks glide toward their set height
      this.forkH = this.forkH || 0;
      const want = this.forksUp ? 1.9 : 0;
      this.forkH += clamp(want - this.forkH, -0.9 * dt, 0.9 * dt);
      ud.carriage.position.y = this.forkH;
    }
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
      if (a.airborne || b.airborne || Math.abs(a.bodyY - b.bodyY) > 2) continue; // one is up on a roof
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
