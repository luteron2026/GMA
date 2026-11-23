import * as THREE from 'three';
import { World } from './world.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { Player } from './player.js';
import { Vehicle, vehicleContacts } from './vehicles.js';
import { NPC } from './npcs.js';
import { Imp, Projectile } from './enemies.js';
import { Missions } from './missions.js';
import { loadSave, writeSave, clearSave, hasProgress } from './save.js';
import { VEHICLE_TYPES } from './models.js';
import { clamp, lerp, mulberry32 } from './physics.js';
import { groundY } from './terrain.js';

const BORROW_LINES = [
  'You shared Romans 12:13 ("practice hospitality"). The driver insists you borrow the car.',
  'The driver hands you the keys: "Bring it back with a full tank. And a full heart."',
  '"Take it," says the driver. "I was going to walk to chapel anyway. For my sanctification."',
  'You asked nicely. The driver said yes. That is the whole heist.',
  '"Borrow it, brother. Just don\'t touch my worship playlist."',
];
const PARKED_LINES = [
  'The keys were in the cupholder with a note: "Love your neighbor. Borrow me."',
  'Unlocked, keys in the visor. Classic Placerita Canyon trust.',
  'A sticky note on the dash says: "Return by curfew."',
];
const NEAR_MISS = [
  'Love thy neighbor. Brake for pedestrians!',
  'That was close. Your RA felt it spiritually.',
  'Students are not speed bumps!',
  'Whoa! Watch the crosswalk, Mario Andretti.',
];
const FAINT_LINES = [
  'You fainted. You woke up at the Health Center with a juice box.',
  'Overwhelmed. A kind nursing student revived you with granola.',
  'You collapsed. Somebody prayed over you until you got up. It worked.',
];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.input = new Input();
    this.lowSpec = this.input.isTouch || (navigator.hardwareConcurrency || 8) <= 4;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowSpec, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowSpec ? 1.25 : 2));
    this.renderer.shadowMap.enabled = !this.lowSpec;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    const sky = 0xbfdcf2;
    this.scene.background = new THREE.Color(sky);
    // Far enough to see the real San Gabriel foothills around the canyon
    this.scene.fog = this.lowSpec ? new THREE.Fog(sky, 300, 1400) : new THREE.Fog(sky, 380, 2300);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 3600);

    const hemi = new THREE.HemisphereLight(0xdcecff, 0x8a7a50, 2.2);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sun.position.set(80, 140, 60);
    this.sun.castShadow = !this.lowSpec;
    if (this.sun.castShadow) {
      const s = this.sun.shadow;
      s.mapSize.set(2048, 2048);
      s.camera.left = s.camera.bottom = -90;
      s.camera.right = s.camera.top = 90;
      s.camera.near = 10; s.camera.far = 400;
      s.bias = -0.0005;
      s.normalBias = 0.05;
    }
    this.scene.add(this.sun, this.sun.target);

    this.world = new World(this.scene, { lowSpec: this.lowSpec });
    this.audio = new Audio();
    this.save = loadSave();
    this.vehicles = [];
    this.npcs = [];
    this.imps = [];
    this.projectiles = [];
    this.boss = null;
    this.heat = 0;
    this.time = 8 * 3600;
    this.clockOverride = null;
    this.state = 'title';
    this.shakeAmt = 0;
    this.camFar = false;
    this.spawnCd = 0;
    this.needCd = 2;
    this.nearMissCd = 0;
    this.ride = null;

    const sp = this.world.places.spawn;
    this.player = new Player(this, sp[0], sp[1]);
    this.hud = new HUD(this);
    this.missions = new Missions(this);
    this.missions.init();
    this.populate();
    this.started = false;
    this.autosaveT = 0;
    this.restoreState();

    const pp = this.player;
    const py0 = groundY(pp.x, pp.z);
    this.camPos = new THREE.Vector3(pp.x - Math.sin(pp.heading) * 8, py0 + 30, pp.z - Math.cos(pp.heading) * 8);
    this.camLook = new THREE.Vector3(pp.x, py0, pp.z);
    this.camera.position.copy(this.camPos);

    this.input.bindCanvas(canvas);
    addEventListener('resize', () => this.resize());
    // Save whenever the player leaves: closing the tab, switching apps, or navigating away
    addEventListener('pagehide', () => this.persist());
    addEventListener('beforeunload', () => this.persist());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.persist(); });
    this.resize();
    this.clock = new THREE.Clock();
    this.t = 0;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- setup ----------

  populate() {
    const w = this.world;
    const rng = mulberry32(2024);
    // Parked cars in real parking stalls (nose-in)
    const stalls = w.data.stalls;
    const nParked = Math.min(stalls.length, this.lowSpec ? 22 : 36);
    const used = new Set();
    while (used.size < nParked) {
      const k = Math.floor(rng() * stalls.length);
      if (used.has(k)) continue;
      used.add(k);
      const [x, y, a] = stalls[k];
      const r = rng();
      if (Math.hypot(x - w.places.helipad[0], -y - w.places.helipad[1]) < 11) continue; // keep the pad clear
      const type = r < 0.62 ? 'sedan' : r < 0.78 ? 'van' : r < 0.92 ? 'truck' : 'cart';
      this.spawnVehicle(type, x, -y, Math.atan2(-Math.cos(a), Math.sin(a)));
    }
    // Golf carts by the buildings, and the dean's golden cart outside Vider
    for (const key of ['cartHotchkiss', 'cartDunkin', 'cartDorms', 'cartNorth']) {
      const [x, z] = w.places[key];
      this.spawnVehicle('cart', x, z, rng() * Math.PI * 2);
    }
    const [dx, dz] = w.places.deanCart;
    this.spawnVehicle('deanCart', dx, dz, Math.PI / 2);
    // The ROTC-surplus tank on the North Campus lawn, and the chopper on its pad in the
    // Reese Center lot
    const tk = w.places.tankSpot;
    this.spawnVehicle('tank', tk[0], tk[1], tk[2]);
    const hp = w.places.helipad;
    this.spawnVehicle('heli', hp[0], hp[1], hp[2]);
    // Traffic on the real streets, carts on the campus service roads
    const carLanes = w.lanes.filter((l) => l.kind === 'car' && l.length > 150);
    for (const lane of carLanes) {
      const n = lane.length > 450 && !this.lowSpec ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const v = this.spawnVehicle(['sedan', 'truck', 'sedan', 'van'][Math.floor(rng() * 4)], 0, 0, 0);
        v.setAI(lane, Math.floor((i / n) * (lane.pts.length - 1)));
        v.homeLane = { lane, idx: Math.floor((i / n) * (lane.pts.length - 1)) };
      }
    }
    const cartLanes = w.lanes.filter((l) => l.kind === 'cart').sort((a, b) => b.length - a.length);
    for (const lane of cartLanes.slice(0, this.lowSpec ? 3 : 6)) {
      const v = this.spawnVehicle('cart', 0, 0, 0);
      v.setAI(lane, 0);
      v.homeLane = { lane, idx: 0 };
    }
    // Pedestrians around campus hot spots
    const spots = ['grill', 'library', 'reece', 'chapelDoor', 'waldock', 'smith', 'hotchkiss', 'dixon', 'slight', 'sweazy', 'quad', 'stadium',
      'gym', 'king', 'biblical', 'music', 'education', 'herwaldtLawn', 'northLawn', 'placeritos', 'westLot', 'eastLot'];
    const count = this.lowSpec ? 30 : 50;
    for (let i = 0; i < count; i++) {
      const spot = w.places[spots[i % spots.length]];
      const [x, z] = w.randomOpenSpot(Math.random, spot, 25, true);
      const npc = new NPC(this, x, z);
      this.npcs.push(npc);
    }
  }

  spawnVehicle(type, x, z, heading) {
    const v = new Vehicle(this, type, x, z, heading);
    v.home = { x, z, heading }; // where the reset button puts it back
    this.vehicles.push(v);
    return v;
  }

  // Put every vehicle back where it started: parked ones in their spots, traffic back on
  // its roads with drivers, the tank, chopper and forklift on their pads
  resetVehicles() {
    if (this.state !== 'play' && this.state !== 'pause') return;
    if (this.player.vehicle) {
      const v = this.player.vehicle;
      const up = v.spec.air && v.y - groundY(v.x, v.z) > 0.3;
      if (this.ride) this.endRide(false);
      this.player.exit();
      if (up) {
        // Step out of a hovering or roof-parked chopper onto open ground below
        let r = { x: this.player.x, z: this.player.z };
        for (let i = 0; i < 4; i++) r = this.world.colliders.resolve(r.x, r.z, 0.7);
        this.player.teleport(r.x, r.z, this.player.heading);
      }
    }
    // Vehicles brought back from a save (not part of the starting lineup) go away
    for (const v of this.vehicles.filter((q) => q.fromSave)) { v.dispose(); this.vehicles.splice(this.vehicles.indexOf(v), 1); }
    for (const v of this.vehicles) {
      v.speed = 0; v.steer = 0; v.climb = 0; v.alt = 0; v.y = undefined; v.fireT = 0;
      if (v.homeLane) v.setAI(v.homeLane.lane, v.homeLane.idx);
      else { v.x = v.home.x; v.z = v.home.z; v.heading = v.home.heading; }
      v.sync(0);
    }
    // Drivers who handed over their cars were left standing around; they're back behind the wheel
    for (const n of this.npcs.filter((q) => q.fromCar && !q.need)) this.removeNPC(n);
    this.toast('🔄 All vehicles are back where they started.');
  }

  spawnMissionNPC(x, z) {
    const npc = new NPC(this, x, z);
    npc.missionOwned = true;
    this.npcs.push(npc);
    return npc;
  }

  removeNPC(npc) {
    npc.dispose();
    this.npcs = this.npcs.filter((n) => n !== npc);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 75 : 62;
    this.camera.updateProjectionMatrix();
  }

  // ---------- state ----------

  get stars() { return Math.min(5, Math.floor(this.heat)); }

  addHeat(n) {
    const before = this.stars;
    this.heat = clamp(this.heat + n, 0, 5.99);
    if (this.stars > before && this.stars >= 3 && before < 3) this.toast('😈 Your good works are drawing <b>spiritual opposition</b>...');
  }

  addCredits(n) {
    this.save.credits = Math.max(0, this.save.credits + n);
    this.persist();
  }

  // Put the player back where they left off last visit
  restoreState() {
    const s = this.save;
    this.time = s.time;
    this.heat = s.heat;
    this.player.joy = s.joy;
    if (!s.pos) return;
    const [x, z] = s.pos;
    if (!this.world.inBounds(x, z, 3)) return;
    if (s.vehicle && VEHICLE_TYPES[s.vehicle.type]) {
      // There's only one tank and one chopper: take the parked one along
      const one = VEHICLE_TYPES[s.vehicle.type].unique && this.vehicles.find((q) => q.type === s.vehicle.type);
      const v = one || this.spawnVehicle(s.vehicle.type, x, z, s.heading);
      if (!one) v.fromSave = true;
      if (one) { v.x = x; v.z = z; v.heading = s.heading; v.alt = 0; v.y = undefined; v.climb = 0; }
      v.collideWorld();
      v.everBorrowed = true;
      this.player.teleport(v.x, v.z, s.heading);
      this.player.enter(v);
    } else {
      const r = this.world.colliders.resolve(x, z, 0.6);
      this.player.teleport(r.x, r.z, s.heading);
    }
  }

  // Copy the live world state into the save object
  snapshot() {
    if (!this.started || this.state === 'faint') return;
    const p = this.player, s = this.save;
    s.pos = [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10];
    s.heading = Math.round(p.heading * 1000) / 1000;
    s.vehicle = p.vehicle ? { type: p.vehicle.type } : null;
    s.time = Math.floor(this.time);
    s.heat = Math.round(this.heat * 100) / 100;
    s.joy = Math.max(10, Math.round(p.joy));
  }

  persist() {
    this.snapshot();
    writeSave(this.save);
  }

  resetProgress() {
    clearSave();
    this.save = loadSave();
    if (this.missions.active) this.missions.active.fail('Starting over.');
    if (this.ride) this.endRide(false);
    const sp = this.world.places.spawn;
    this.player.teleport(sp[0], sp[1], Math.PI);
    this.player.resetOutfit();
    this.player.joy = 100;
    this.time = 8 * 3600;
    this.heat = 0;
    this.clearImps(true);
    this.missions.refreshMarkers();
    this.hud.lastCredits = -1;
  }

  toast(t) { this.hud.toast(t); }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  clockText() {
    const t = this.clockOverride ?? this.time;
    const h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60;
    const s = Math.floor(t) % 60;
    const h12 = ((h + 11) % 12) + 1;
    return this.clockOverride != null
      ? `${h12}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
      : `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  allEnemies() {
    return this.boss && !this.boss.dead ? [...this.imps, this.boss] : this.imps;
  }

  start() {
    this.audio.unlock();
    this.state = 'play';
    this.started = true;
    this.clock.getDelta();
    document.body.classList.add('playing');
    if (hasProgress(this.save)) {
      const n = this.missions.completedCount() + (this.save.completed.includes('boss') ? 1 : 0);
      setTimeout(() => this.toast(`Welcome back! <b>${this.save.credits.toLocaleString()}</b> Chapel Credits · ${n}/${this.missions.defs.length} missions done.`), 600);
    } else {
      setTimeout(() => this.toast('Welcome to Placerita Canyon! Help students (<b>!</b>) to earn <b>Divine Approval</b>.'), 800);
      setTimeout(() => this.toast('Yellow markers on the map are missions. Good deeds attract... opposition.'), 4500);
    }
  }

  pause(on) {
    if (this.state === 'title' || this.state === 'ending') return;
    this.state = on ? 'pause' : 'play';
    document.getElementById('pause').classList.toggle('show', on);
    document.getElementById('abandon').style.display = this.missions.active ? '' : 'none';
    this.clock.getDelta();
  }

  faint() {
    if (this.state !== 'play') return;
    this.state = 'faint';
    const lost = Math.floor(this.save.credits * 0.1);
    this.addCredits(-lost);
    if (this.missions.active) this.missions.active.fail('You fainted mid-mission.');
    if (this.ride) this.endRide(false);
    document.getElementById('faint').classList.add('show');
    document.getElementById('faint-text').textContent = FAINT_LINES[Math.floor(Math.random() * FAINT_LINES.length)];
    document.getElementById('faint-sub').textContent = lost ? `Lost ${lost} Chapel Credits` : '';
    setTimeout(() => {
      document.getElementById('faint').classList.remove('show');
      const r = this.world.places.respawn;
      this.player.teleport(r[0], r[1], 0);
      this.player.joy = 100;
      this.heat = 0;
      this.clearImps(true);
      this.state = 'play';
      this.clock.getDelta();
    }, 2600);
  }

  showEnding() {
    setTimeout(() => {
      this.state = 'ending';
      const el = document.getElementById('ending');
      document.getElementById('end-stats').innerHTML =
        `Chapel Credits: <b>${this.save.credits.toLocaleString()}</b><br>Good deeds: <b>${this.save.deeds}</b><br>Imps banished: <b>${this.save.banished}</b>`;
      el.classList.add('show');
    }, 4500);
  }

  // ---------- spawning ----------

  spawnBible(x, z, dir) { this.projectiles.push(new Projectile(this, 'bible', x, z, dir)); }
  spawnFireball(x, z, dir) { this.projectiles.push(new Projectile(this, 'fire', x, z, dir)); }

  spawnImpsAround(cx, cz, n, radius, tag = null) {
    for (let i = 0; i < n; i++) {
      const [x, z] = this.world.randomOpenSpot(Math.random, [cx, cz], radius);
      this.imps.push(new Imp(this, x, z, { tag, speed: 4.8 + this.stars * 0.25 }));
    }
  }

  clearImps(instant = false) {
    for (const imp of this.imps) {
      if (instant) imp.dispose();
      else imp.flee();
    }
    if (instant) this.imps = [];
  }

  onImpBanished(imp) {
    this.save.banished++;
    this.addCredits(10);
    this.missions.onImpBanished(imp);
  }

  hornWave(x, z) {
    for (const e of this.allEnemies()) {
      if (e.dead) continue;
      if (Math.hypot(e.x - x, e.z - z) < 13) e.stun(3);
    }
    this.toast('🎺 <b>Hallelujah Horn!</b>');
  }

  ambientImps(dt) {
    if (this.missions.noAmbient) return;
    const want = [0, 1, 3, 5, 7, 9][this.stars];
    const ambient = this.imps.filter((i) => !i.dead && !i.tag && i.state !== 'flee');
    this.spawnCd -= dt;
    if (ambient.length < want && this.spawnCd <= 0) {
      this.spawnCd = 2.2 - this.stars * 0.25;
      const p = this.player;
      for (let k = 0; k < 10; k++) {
        const a = Math.random() * Math.PI * 2, r = 32 + Math.random() * 18;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        if (!this.world.inBounds(x, z, 3) || this.world.colliders.pointBlocked(x, z, 1)) continue;
        this.imps.push(new Imp(this, x, z, { speed: 4.6 + this.stars * 0.3 }));
        break;
      }
    } else if (ambient.length > want) {
      ambient[0].flee();
    }
  }

  // ---------- interactions ----------

  findInteraction() {
    const p = this.player;
    // Kick the stunned boss or imps
    if (!p.vehicle) {
      if (this.boss && this.boss.stunned && Math.hypot(this.boss.x - p.x, this.boss.z - p.z) < 6) {
        return { text: '<b>KICK</b> The Tempter!', fn: () => this.boss.kick() };
      }
      for (const imp of this.imps) {
        if (!imp.dead && imp.state === 'stunned' && Math.hypot(imp.x - p.x, imp.z - p.z) < 2.8) {
          return { text: 'Kick the imp!', fn: () => { p.throwAnim = 0.2; imp.banish(); } };
        }
      }
    }
    const mi = this.missions.interaction();
    if (mi) return mi;
    // Offer rides from a vehicle
    if (p.vehicle && !this.ride && Math.abs(p.vehicle.speed) < 3) {
      const npc = this.nearestNPC(7, (n) => n.need && n.need.type === 'ride');
      if (npc) return { text: `Offer a ride to <b>${npc.need.destName}</b>`, fn: () => this.startRide(npc) };
    }
    if (p.vehicle) {
      if (p.vehicle.alt > 0.3) return { text: 'Land to get out (hold <b>Shift</b> / ⚡)', fn: () => this.toast('Hold Shift (⚡) to set the chopper down first.') };
      if (Math.abs(p.vehicle.speed) < 4) return { text: 'Get out', fn: () => this.exitVehicle() };
      return null;
    }
    const npc = this.nearestNPC(3, (n) => n.need && n.need.type === 'help');
    if (npc) return { text: `Help: "${npc.need.ask}"`, fn: () => this.helpNPC(npc) };
    const rider = this.nearestNPC(3, (n) => n.need && n.need.type === 'ride');
    if (rider) return { text: `"${rider.need.ask}" (get a car first)`, fn: () => this.toast('Find a vehicle, then come back to offer a ride.') };
    let best = null, bd = 4;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.x - p.x, v.z - p.z) - v.spec.length / 3;
      if (d < bd && Math.abs(v.speed) < 6) { bd = d; best = v; }
    }
    if (best) return { text: best.driver ? `Borrow the <b>${best.name}</b> (ask nicely)` : `Drive the <b>${best.name}</b>`, fn: () => this.enterVehicle(best) };
    return null;
  }

  nearestNPC(r, pred) {
    const p = this.player;
    let best = null, bd = r;
    for (const n of this.npcs) {
      if (!n.visible || !pred(n)) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  enterVehicle(v) {
    const p = this.player;
    if (v.driver) {
      const look = v.removeDriver();
      const side = [-v.fz, v.fx];
      const npc = new NPC(this, v.x + side[0] * 2.2, v.z + side[1] * 2.2, look);
      this.npcs.push(npc);
      npc.fromCar = true;
      this.toast(BORROW_LINES[Math.floor(Math.random() * BORROW_LINES.length)]);
      this.addHeat(0.25);
    } else if (!v.everBorrowed) {
      this.toast(PARKED_LINES[Math.floor(Math.random() * PARKED_LINES.length)]);
    }
    v.everBorrowed = true;
    v.speed = 0;
    p.enter(v);
    if (v.spec.air) this.toast(this.input.isTouch ? '🚁 Hold <b>📖</b> to climb, <b>⚡</b> to descend. Stick flies and turns.' : '🚁 Hold <b>Space</b> to climb, <b>Shift</b> to descend. <b>W/S</b> fly, <b>A/D</b> turn.');
    else if (v.spec.tracks) this.toast(this.input.isTouch ? '🪖 Tracks turn in place. <b>📖</b> fires a Hallelujah Shell.' : '🪖 Tracks turn in place. <b>Space</b> fires a Hallelujah Shell.');
  }

  exitVehicle() {
    if (this.ride) this.endRide(false);
    const v = this.player.vehicle;
    const onRoof = v && v.spec.air && v.y - groundY(v.x, v.z) > 1.5;
    this.player.exit();
    if (onRoof) {
      // Down the roof ladder to the ground beside the building
      const p = this.player;
      let r = { x: p.x, z: p.z };
      for (let i = 0; i < 4; i++) r = this.world.colliders.resolve(r.x, r.z, 0.7);
      p.teleport(r.x, r.z, p.heading);
      this.toast('🪜 You climb down the roof ladder. The chopper stays parked up top.');
    }
  }

  helpNPC(npc) {
    this.toast(`💛 ${npc.need.thanks}`);
    npc.clearNeed();
    this.goodDeed(20);
  }

  goodDeed(credits) {
    this.save.deeds++;
    this.addCredits(credits);
    this.addHeat(0.7);
    this.audio.deed();
  }

  startRide(npc) {
    const need = npc.need;
    npc.clearNeed();
    npc.setVisible(false);
    this.ride = { npc, dest: need.dest, destName: need.destName, t: 0 };
    this.player.vehicle.passengers++;
    this.toast(`🚗 Drive your passenger to <b>${need.destName}</b> (blue marker).`);
  }

  endRide(success) {
    const r = this.ride;
    if (!r) return;
    this.ride = null;
    const v = this.player.vehicle;
    if (v) v.passengers = Math.max(0, v.passengers - 1);
    const npc = r.npc;
    const p = this.player;
    npc.x = p.x + 2; npc.z = p.z + 2;
    npc.home = success ? [...r.dest] : [npc.x, npc.z];
    npc.setVisible(true);
    npc.target = null;
    if (success) {
      this.toast(`💛 "Thanks for the ride to ${r.destName}! You're a real Good Samaritan."`);
      this.goodDeed(40);
    } else {
      this.toast('Your passenger decided to walk. (They said it was fine.)');
    }
  }

  // ---------- main loop ----------

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.t += dt;
    const inp = this.input;
    if (inp.wasPressed('mute')) {
      const m = this.audio.toggleMute();
      this.toast(m ? '🔇 Sound off' : '🔊 Sound on');
      document.getElementById('btn-mute').textContent = m ? '🔇' : '🔊';
    }
    if (inp.wasPressed('pause') && (this.state === 'play' || this.state === 'pause')) this.pause(this.state === 'play');

    if (this.state === 'play') this.update(dt);
    else if (this.state === 'title') this.titleCam(dt);
    else if (this.state === 'faint' || this.state === 'ending') { this.updateWorldOnly(dt); this.updateCamera(dt); }

    this.renderer.render(this.scene, this.camera);
    inp.endFrame();
  }

  titleCam(dt) {
    // Slow orbit over the real campus
    const a = this.t * 0.04;
    const gy = groundY(-20, 40);
    this.camera.position.set(-20 + Math.sin(a) * 240, gy + 95, 40 + Math.cos(a) * 240);
    this.camera.lookAt(-20, gy, 40);
    this.updateWorldOnly(dt);
  }

  updateWorldOnly(dt) {
    for (const v of this.vehicles) if (!v.drivenByPlayer) v.update(dt);
    for (const n of this.npcs) n.update(dt);
    this.world.update(dt, this.t);
  }

  update(dt) {
    const p = this.player, inp = this.input;
    this.time += dt * 6;
    this.save.playTime += dt;
    this.autosaveT += dt;
    if (this.autosaveT > 5) { this.autosaveT = 0; this.persist(); }
    if (!this.missions.active || !this.missions.active.def.noAmbient) this.heat = Math.max(0, this.heat - dt / 40);

    // Interaction
    const it = this.findInteraction();
    this.hud.setPrompt(it ? it.text : null);
    if (it && inp.wasPressed('action')) it.fn();
    else if (!it && inp.wasPressed('action') && p.vehicle) this.toast('Slow down to get out!');
    if (inp.wasPressed('camera')) this.camFar = !this.camFar;

    p.update(dt);
    for (const v of this.vehicles) v.update(dt);
    vehicleContacts(this);
    if (p.vehicle) { p.x = p.vehicle.x; p.z = p.vehicle.z; p.heading = p.vehicle.heading; }
    this.pedestrianSafety(dt);
    for (const n of this.npcs) n.update(dt);
    this.updateNeeds(dt);

    this.imps = this.imps.filter((imp) => { const keep = imp.update(dt); if (!keep) imp.dispose(); return keep; });
    if (this.boss && !this.boss.dead) this.boss.update(dt);
    this.projectiles = this.projectiles.filter((pr) => { const keep = pr.update(dt); if (!keep) pr.dispose(); return keep; });
    this.ambientImps(dt);

    if (this.ride) {
      const r = this.ride;
      if (Math.hypot(p.x - r.dest[0], p.z - r.dest[1]) < 9 && p.vehicle && Math.abs(p.vehicle.speed) < 6) this.endRide(true);
    }

    this.missions.update(dt);
    this.world.update(dt, this.t);
    this.audio.setEngine(p.vehicle ? Math.abs(p.vehicle.speed) / p.vehicle.spec.maxSpeed : 0, !!p.vehicle);
    this.updateCamera(dt);
    this.fadeLabels();
    this.updateSun();
    this.hud.update();
  }

  updateNeeds(dt) {
    this.needCd -= dt;
    if (this.needCd > 0) return;
    this.needCd = 3;
    const withNeed = this.npcs.filter((n) => n.need && !n.missionOwned).length;
    const max = this.lowSpec ? 6 : 9;
    if (withNeed >= max) return;
    const cands = this.npcs.filter((n) => !n.need && n.visible && !n.missionOwned && !n.fromCar);
    if (!cands.length) return;
    const npc = cands[Math.floor(Math.random() * cands.length)];
    // Don't pop a request right in front of the player
    if (Math.hypot(npc.x - this.player.x, npc.z - this.player.z) < 15) return;
    npc.randomizeNeed();
  }

  pedestrianSafety(dt) {
    this.nearMissCd -= dt;
    for (const v of this.vehicles) {
      const sp = Math.abs(v.speed);
      if (sp < 3 || v.airborne) continue;
      for (const n of this.npcs) {
        if (!n.visible || n.state === 'dive') continue;
        if (Math.abs(n.x - v.x) > 8 || Math.abs(n.z - v.z) > 8) continue;
        const dx = n.x - v.x, dz = n.z - v.z;
        const along = dx * v.fx + dz * v.fz;
        const side = Math.abs(dx * v.fz - dz * v.fx);
        const ahead = along * Math.sign(v.speed);
        if (side < v.spec.width / 2 + 0.7 && ahead > -v.spec.length / 2 && ahead < v.spec.length / 2 + sp * 0.35) {
          n.dive(v.x, v.z, v.fx, v.fz);
          if (v.drivenByPlayer && this.nearMissCd <= 0) {
            this.nearMissCd = 3;
            this.toast(NEAR_MISS[Math.floor(Math.random() * NEAR_MISS.length)]);
            this.addCredits(-5);
            this.heat = Math.max(0, this.heat - 0.3);
          }
        }
      }
    }
  }

  updateCamera(dt) {
    const p = this.player;
    const v = p.vehicle;
    const speed = v ? Math.abs(v.speed) : Math.abs(p.speed);
    const far = this.camFar ? 1.6 : 1;
    const dist = (v ? 9 + speed * 0.18 + v.spec.length * 0.4 : 6.5) * far;
    const height = (v ? 4.2 + speed * 0.05 : 3.2) * far;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    const tx = p.x - fx * dist, tz = p.z - fz * dist;
    const k = 1 - Math.exp(-dt * (v ? 4 : 6));
    this.camPos.x = lerp(this.camPos.x, tx, k);
    this.camPos.z = lerp(this.camPos.z, tz, k);
    const py = v ? v.mesh.position.y : groundY(p.x, p.z);
    this.camPos.y = lerp(this.camPos.y, py + height, k);
    // Keep the camera out of buildings
    // (only things taller than the camera: up in the chopper it isn't shoved around by roofs)
    const r = this.world.colliders.resolve(this.camPos.x, this.camPos.z, 0.6, this.camPos.y);
    const lookX = p.x + fx * 3, lookZ = p.z + fz * 3;
    this.camLook.set(lookX, py + 1.4, lookZ);
    // Never sink into a hillside behind the player
    this.camPos.y = Math.max(this.camPos.y, this.world.surfaceAt(r.x, r.z) + 1.3); // or a roof
    this.camera.position.set(r.x, this.camPos.y, r.z);
    if (this.shakeAmt > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2);
    }
    this.camera.lookAt(this.camLook);
  }

  // Building name tags hide when the camera is right next to one (e.g. on a rooftop)
  fadeLabels() {
    const c = this.camera.position;
    for (const l of this.world.labels) l.visible = c.distanceToSquared(l.position) > 16 * 16;
  }

  updateSun() {
    if (!this.sun.castShadow) return;
    const p = this.player;
    const gy = groundY(p.x, p.z);
    this.sun.position.set(p.x + 60, gy + 140, p.z + 40);
    this.sun.target.position.set(p.x, gy, p.z);
  }
}
