import { makePerson, randomLook, animatePerson, makeBubble } from './models.js';
import { angleDiff } from './physics.js';
import { groundY } from './terrain.js';

// Friendly campus requests. Helping is a "good deed" and raises Divine Approval.
export const NEEDS = [
  { ask: 'I dropped my textbooks!', thanks: 'Thanks! My Greek lexicon weighs more than my car.' },
  { ask: 'Pray for my finals?', thanks: 'Amen! Now I just have to actually study.' },
  { ask: 'I lost my lanyard...', thanks: 'My lanyard! Now I can get back into my dorm.' },
  { ask: 'Hold the Grill door?', thanks: 'Thanks for holding the door at the Mustang Grill!' },
  { ask: 'Help with my laundry?', thanks: 'Three flights of stairs. Truly servant leadership.' },
  { ask: 'Got notes on Hebrews?', thanks: 'Iron sharpens iron! (So do your highlighters.)' },
  { ask: 'Where do I sit in chapel?', thanks: 'Found my seat in Bross Court! Right behind the guy who claps off-beat.' },
  { ask: 'Locked out of my dorm!', thanks: 'You called the RA for me. Blessed are the key-holders.' },
  { ask: 'Hear my ring-by-spring plan?', thanks: 'You listened to all 14 steps. That is real love.' },
  { ask: 'Share a Grill swipe?', thanks: 'Free tater tots! Generosity is a spiritual gift.' },
  { ask: 'Encourage me before my recital?', thanks: 'Thanks! I feel ready to play Bach... mostly.' },
  { ask: 'Help me find parking?', thanks: 'A parking spot by the chapel. That is a genuine miracle.' },
  { ask: 'Proofread my theology paper?', thanks: 'Thanks! I did spell "supralapsarian" wrong. Twice.' },
  { ask: 'Carry my hiking gear?', thanks: 'Placerita Canyon trail, here I come!' },
];

const RIDE_DESTS = [
  ['library', 'Powell Library'], ['chapelDoor', 'the MacArthur Center'], ['grill', 'the Mustang Grill'],
  ['reece', 'the Reese Center'], ['stadium', 'Lou Herwaldt Stadium'], ['placeritos', 'Placeritos Blvd'],
  ['waldock', 'Waldock Hall'], ['hotchkiss', 'Hotchkiss Hall'], ['gym', 'the Kinesiology Center'], ['westLot', 'the West Lot'],
  ['biblical', 'the Biblical Studies Center'], ['music', 'the School of Music'], ['smith', 'C.W. Smith Hall'], ['church', 'Placerita Bible Church'],
];

export class NPC {
  constructor(game, x, z, look = randomLook()) {
    this.game = game;
    this.mesh = makePerson(look);
    this.look = look;
    game.scene.add(this.mesh);
    this.x = x; this.z = z;
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 1.2 + Math.random() * 0.6;
    this.target = null;
    this.idle = Math.random() * 3;
    this.phase = Math.random() * 10;
    this.state = 'walk';
    this.need = null;
    this.bubble = null;
    this.diveT = 0;
    this.diveDir = [0, 0];
    this.visible = true;
    this.stuck = 0;
    this.home = [x, z];
    this.special = null; // used by missions
  }

  setNeed(need) {
    this.clearNeed();
    this.need = need;
    const color = need.type === 'ride' ? '#7fd0ff' : '#ffd23f';
    this.bubble = makeBubble(need.type === 'ride' ? '🚗' : '!', color);
    this.bubble.position.y = 2.4;
    this.mesh.add(this.bubble);
  }

  clearNeed() {
    if (this.bubble) this.mesh.remove(this.bubble);
    this.bubble = null;
    this.need = null;
  }

  randomizeNeed() {
    if (Math.random() < 0.3) {
      const [key, name] = RIDE_DESTS[Math.floor(Math.random() * RIDE_DESTS.length)];
      const dest = this.game.world.places[key];
      if (Math.hypot(dest[0] - this.x, dest[1] - this.z) < 80) return this.randomizeNeed();
      this.setNeed({ type: 'ride', dest, destName: name, ask: `Ride to ${name}?` });
    } else {
      const n = NEEDS[Math.floor(Math.random() * NEEDS.length)];
      this.setNeed({ type: 'help', ask: n.ask, thanks: n.thanks });
    }
  }

  pickTarget() {
    const w = this.game.world;
    this.target = w.randomOpenSpot(Math.random, this.home, 45);
  }

  dive(fromX, fromZ, vfx, vfz) {
    if (this.state === 'dive') return;
    this.state = 'dive';
    this.diveT = 0.6;
    // Jump perpendicular to the vehicle's travel direction, away from it
    const px = -vfz, pz = vfx;
    const side = (this.x - fromX) * px + (this.z - fromZ) * pz >= 0 ? 1 : -1;
    this.diveDir = [px * side, pz * side];
  }

  update(dt) {
    if (!this.visible) return;
    const g = this.game;
    if (this.state === 'dive') {
      this.diveT -= dt;
      this.x += this.diveDir[0] * 9 * dt;
      this.z += this.diveDir[1] * 9 * dt;
      const r = g.world.colliders.resolve(this.x, this.z, 0.4);
      this.x = r.x; this.z = r.z;
      this.mesh.rotation.z = Math.min(1.2, (0.6 - this.diveT) * 4) * (this.diveDir[0] > 0 ? 1 : -1);
      if (this.diveT <= 0) { this.state = 'walk'; this.mesh.rotation.z = 0; }
      this.sync();
      return;
    }

    if (this.special && this.special.update) {
      this.special.update(this, dt);
      this.sync();
      return;
    }

    // Face the player when they have a request and the player is near
    const p = g.player;
    const dp = Math.hypot(p.x - this.x, p.z - this.z);
    if (this.need && dp < 6) {
      const want = Math.atan2(p.x - this.x, p.z - this.z);
      this.heading += angleDiff(this.heading, want) * Math.min(1, dt * 5);
      animatePerson(this.mesh, 0, 0);
      this.sync();
      return;
    }

    if (this.idle > 0) {
      this.idle -= dt;
      animatePerson(this.mesh, 0, 0);
      this.sync();
      return;
    }
    if (!this.target) this.pickTarget();
    const dx = this.target[0] - this.x, dz = this.target[1] - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) {
      this.target = null;
      this.idle = 1 + Math.random() * 5;
      return;
    }
    const want = Math.atan2(dx, dz);
    this.heading += angleDiff(this.heading, want) * Math.min(1, dt * 4);
    const ox = this.x, oz = this.z;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;
    const r = g.world.colliders.resolve(this.x, this.z, 0.4);
    this.x = r.x; this.z = r.z;
    const moved = Math.hypot(this.x - ox, this.z - oz);
    if (moved < this.speed * dt * 0.3) {
      this.stuck += dt;
      if (this.stuck > 1.5) { this.target = null; this.stuck = 0; }
    } else this.stuck = 0;
    this.phase += this.speed * dt * 2.4;
    animatePerson(this.mesh, this.phase, 0.8);
    this.sync();
  }

  // Move toward a point at a given speed (used by missions)
  moveToward(tx, tz, speed, dt) {
    const want = Math.atan2(tx - this.x, tz - this.z);
    this.heading += angleDiff(this.heading, want) * Math.min(1, dt * 6);
    this.x += Math.sin(this.heading) * speed * dt;
    this.z += Math.cos(this.heading) * speed * dt;
    const r = this.game.world.colliders.resolve(this.x, this.z, 0.4);
    this.x = r.x; this.z = r.z;
    this.phase += speed * dt * 2.4;
    animatePerson(this.mesh, this.phase, Math.min(1.2, speed / 4));
  }

  sync() {
    this.mesh.position.set(this.x, groundY(this.x, this.z), this.z);
    this.mesh.rotation.y = this.heading;
    if (this.bubble) this.bubble.position.y = 2.4 + Math.sin(performance.now() / 250) * 0.08;
  }

  setVisible(v) {
    this.visible = v;
    this.mesh.visible = v;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
  }
}
