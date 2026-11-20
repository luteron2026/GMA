import { makeBeacon, makeItem, makePerson, randomLook, makeBubble, setOutfit, animatePerson } from './models.js';
import { Boss } from './enemies.js';

// Campus places are [x, y-north]; convert to world [x, z]
const P = (x, y) => [x, -y];

const MISSIONS = [
  {
    id: 'nineTen',
    title: 'The 9:10 Sprint',
    letter: 'C',
    start: 'waldock',
    reward: 150,
    blurb: 'It is 9:08. Chapel starts at 9:10. Your chapel skips are... concerning.',
    begin(m) {
      m.timer = 80;
      m.clock = 9 * 3600 + 8 * 60 + 40;
      m.target = m.waypoint(m.place('chapelDoor'), 0xffd23f, 4);
      m.objective('Get to <b>MacArthur Chapel</b> before 9:10!');
    },
    update(m) {
      m.game.clockOverride = m.clock + m.elapsed;
      if (m.near(m.target, 5)) {
        const s = Math.min(59, Math.floor(40 + m.elapsed) % 60);
        m.game.audio.bell();
        m.win(`You slid into the back row at 9:${m.elapsed + 40 >= 60 ? '09' : '08'}:${String(s).padStart(2, '0')}. Nobody noticed. (Everybody noticed.)`);
      }
    },
    failText: "9:10. The doors are closed. That's a chapel skip. (Your RA has been notified.)",
  },
  {
    id: 'applePie',
    title: 'Apple Pie Night',
    letter: 'P',
    start: 'hotchkiss',
    reward: 50,
    blurb: 'Hotchkiss needs pies from the Mustang Grill for Apple Pie Night in the Hotchyard. Drive gently.',
    begin(m) {
      m.cart = m.spawnVehicle('cart', P(207, -62), 0);
      m.stage = 0;
      m.pies = 0;
      m.target = m.waypoint(m.place('grill'), 0xffd23f, 4);
      m.objective('Grab a <b>golf cart</b> and pick up the pies at the <b>Mustang Grill</b>.');
    },
    update(m) {
      if (m.stage === 0 && m.near(m.target, 7)) {
        if (!m.game.player.vehicle) {
          if (!m.warned) { m.warned = true; m.toast("You can't carry three pies on foot. Grab a vehicle!"); }
          return;
        }
        m.pies = 3;
        m.stage = 1;
        m.game.audio.pickup();
        m.clearWaypoints();
        m.target = m.waypoint(m.place('hotchyard'), 0xffd23f, 5);
        m.toast('3 apple pies loaded. Every bump costs a pie!');
      }
      if (m.stage === 1) {
        m.objective(`Deliver the pies to the <b>Hotchyard</b> behind Hotchkiss. Pies: <b>${'🥧'.repeat(m.pies)}</b>`);
        if (m.near(m.target, 8)) {
          m.bonus = m.pies * 60;
          m.win(`Apple Pie Night is saved! ${m.pies} pie${m.pies > 1 ? 's' : ''} delivered. The Hotchyard smells like cinnamon and community.`);
        }
      }
    },
    onImpact(m, strength) {
      if (m.stage !== 1 || strength < 5) return;
      m.pies--;
      m.toast(m.pies > 0 ? `SPLAT! A pie didn't make it. ${m.pies} left.` : 'SPLAT!');
      if (m.pies <= 0) m.fail('All the pies are gone. Hotchkiss is having Apple Crumb Night instead.');
    },
  },
  {
    id: 'classy',
    title: 'Classy Off Campus',
    letter: 'T',
    start: 'grill',
    reward: 200,
    blurb: 'It is Classy Off Campus day and you are wearing gym shorts. Find a tie, a blazer, and dress shoes, then get to class.',
    begin(m) {
      m.timer = 150;
      m.left = 3;
      m.pickup(P(-74, 42), 'tie', () => { setOutfit(m.game.player.mesh, { tie: true }); m.toast('Tie acquired. Windsor knot... ish.'); });
      m.pickup(P(-212, -10), 'blazer', () => { setOutfit(m.game.player.mesh, { shirt: 0x1b2a4a }); m.toast('Blazer acquired. Instantly 40% more theological.'); });
      m.pickup(P(278, 224), 'shoes', () => m.toast('Dress shoes! Found them at Canyon Homes. Do not ask.'));
      m.objective('Collect a <b>tie</b>, a <b>blazer</b>, and <b>dress shoes</b>.');
    },
    update(m) {
      if (m.stage !== 1 && m.pickupsLeft() === 0) {
        m.stage = 1;
        m.target = m.waypoint(m.place('reece'), 0xffd23f, 4);
        m.objective('Looking sharp. Get to class at the <b>Reece Center</b>!');
      }
      if (m.stage === 1 && m.near(m.target, 5)) m.win('Classy Off Campus achieved. You look like a youth pastor at a wedding.');
    },
    cleanup(m) { if (!m.won) m.game.player.resetOutfit(); },
    failText: 'Class started without you. At least you look classy.',
  },
  {
    id: 'carpool',
    title: 'Commuter Carpool',
    letter: 'R',
    start: 'eastLot',
    reward: 220,
    blurb: 'Three commuters are stranded and chapel is starting soon. Borrow a car and round them up.',
    begin(m) {
      m.timer = 200;
      m.spawnVehicle('sedan', P(95, -142), Math.PI);
      m.riders = 0;
      const spots = [P(-150, -134), P(268, 210), P(-232, 128)];
      for (const s of spots) m.rider(s);
      m.objective('Pick up <b>3 commuters</b> (must be in a vehicle). Riders: 0/3');
    },
    update(m) {
      for (const r of m.ridersList) {
        if (r.picked) continue;
        if (m.nearXZ(r.x, r.z, 6)) {
          if (!m.game.player.vehicle) {
            if (!r.warned) { r.warned = true; m.toast('Commuters need a car, not a piggyback ride.'); }
            continue;
          }
          r.picked = true;
          m.game.scene.remove(r.mesh);
          m.removeBlip(r.blip);
          m.riders++;
          m.game.audio.pickup();
          m.toast(['"Thanks! My car is held together by duct tape and prayer."', '"I live 40 minutes away. Chapel at 9:10 is my cardio."', '"Do you have an aux cord? I only listen to hymns from 1742."'][m.riders - 1]);
        }
      }
      if (m.riders < 3) m.objective(`Pick up <b>3 commuters</b> (must be in a vehicle). Riders: ${m.riders}/3`);
      else if (!m.target) {
        m.target = m.waypoint(m.place('chapelDoor'), 0xffd23f, 5);
        m.objective('Everyone is in! Drive to <b>MacArthur Chapel</b>.');
      }
      if (m.target && m.near(m.target, 8)) m.win('Everyone made it to chapel! Carpooling: good for the planet, great for your attendance record.');
      // Animate waiting riders
      for (const r of m.ridersList) if (!r.picked) {
        r.mesh.userData.parts.armR.rotation.x = -2.6 + Math.sin(m.elapsed * 6) * 0.4;
      }
    },
    failText: 'Chapel started. Your commuters are still waiting in the parking lot, sadly holding their coffee.',
  },
  {
    id: 'gratitouille',
    title: 'Gratitouille',
    letter: 'G',
    start: 'dixon',
    reward: 200,
    blurb: 'Dixon is hosting Gratitouille: like Thanksgiving, but Italian, and earlier. Gather ingredients before dinner.',
    begin(m) {
      m.timer = 240;
      m.pickup(P(150, 120), 'tomato');
      m.pickup(P(-158, 40), 'basil');
      m.pickup(P(-262, 60), 'pasta');
      m.pickup(P(40, 176), 'cheese');
      m.pickup(P(132, -140), 'garlic');
      m.objective('Gather <b>5 ingredients</b> around campus: 0/5');
    },
    update(m) {
      const got = 5 - m.pickupsLeft();
      if (m.stage !== 1) m.objective(`Gather <b>5 ingredients</b> around campus: ${got}/5`);
      if (m.stage !== 1 && got === 5) {
        m.stage = 1;
        m.target = m.waypoint(m.place('dixon'), 0xffd23f, 4);
        m.objective('Bring everything back to <b>Dixon Hall</b>!');
      }
      if (m.stage === 1 && m.near(m.target, 6)) m.win('Gratitouille is served! Your dorm family says grace for 11 minutes. Worth it.');
    },
    failText: 'Dinner started without the ingredients. It was just plain pasta. Everyone was very gracious about it.',
  },
  {
    id: 'stadium',
    title: 'Stadium Cleanse',
    letter: 'S',
    start: 'stadium',
    reward: 250,
    noAmbient: true,
    blurb: 'Imps are haunting Herwaldt Stadium before the big game. Throw Bibles to stun them, then hit them again or kick them.',
    begin(m) {
      m.game.clearImps(true);
      m.total = 12; m.spawned = 0; m.killed = 0;
      m.toast(m.game.input.isTouch ? 'Tap 📖 to throw. Tap ✋ to kick a stunned imp.' : 'Throw Bibles with <kbd>Space</kbd> or click. Press <kbd>E</kbd> to kick stunned imps.');
    },
    update(m) {
      const alive = m.game.imps.filter((i) => !i.dead && i.tag === 'stadium').length;
      if (m.spawned < m.total && alive < 4 && m.elapsed > 1) {
        const c = m.place('stadium');
        m.game.spawnImpsAround(c[0], c[1], 1, 22, 'stadium');
        m.spawned++;
      }
      m.objective(`Banish the imps at <b>Herwaldt Stadium</b>: ${m.killed}/${m.total}`);
      if (m.killed >= m.total) m.win('Herwaldt Stadium is cleansed. Go Mustangs!');
    },
    onImpBanished(m, imp) { if (imp.tag === 'stadium') m.killed++; },
    cleanup(m) { m.game.clearImps(true); },
  },
  {
    id: 'library',
    title: 'Quiet in the Library',
    letter: 'L',
    start: 'library',
    reward: 180,
    blurb: 'Five students are blasting worship music outside Powell Library during finals. Catch each one and kindly shush them.',
    begin(m) {
      m.timer = 120;
      m.loud = [];
      const c = P(0, 20);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const npc = m.game.spawnMissionNPC(c[0] + Math.cos(a) * 30, c[1] + Math.sin(a) * 30);
        npc.setNeed({ type: 'loud', ask: '' });
        npc.mesh.remove(npc.bubble);
        npc.bubble = makeBubble('♪', '#ff7ad9');
        npc.bubble.position.y = 2.4;
        npc.mesh.add(npc.bubble);
        npc.special = {
          update(n, dt) {
            const p = m.game.player;
            const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
            let tx, tz, sp;
            if (d < 12) { tx = n.x + dx; tz = n.z + dz; sp = 6.2; }
            else { n.wt = (n.wt || 0) - dt; if (!n.wp || n.wt <= 0) { n.wp = [c[0] + (Math.random() - 0.5) * 120, c[1] + (Math.random() - 0.5) * 100]; n.wt = 3; } tx = n.wp[0]; tz = n.wp[1]; sp = 2.5; }
            // Stay around the quad
            const cx = n.x - c[0], cz = n.z - c[1], cd = Math.hypot(cx, cz);
            if (cd > 70) { tx = c[0]; tz = c[1]; }
            n.moveToward(tx, tz, sp, dt);
            n.mesh.rotation.z = 0;
          },
        };
        m.loud.push(npc);
        m.blip(npc, 0xff7ad9);
      }
      m.objective('Shush the <b>5 loud students</b> (get close to them): 0/5');
      m.shushed = 0;
    },
    update(m) {
      for (const n of m.loud) {
        if (n.shushed) continue;
        if (m.nearXZ(n.x, n.z, 2.4)) {
          n.shushed = true;
          n.clearNeed();
          n.special = null;
          m.removeBlip(n);
          m.shushed++;
          m.game.audio.pickup();
          m.toast(['"Sorry! I thought Powell Library was soundproof."', '"My bad. This song has 14 bridges."', '"Shushed in love. I receive it."', '"Okay, okay. I will hum quietly."', '"Fine. But Hillsong deserves to be heard."'][m.shushed - 1]);
        }
      }
      m.objective(`Shush the <b>5 loud students</b> (get close to them): ${m.shushed}/5`);
      if (m.shushed >= 5) m.win('Peace and quiet restored. Powell Library thanks you. (Shhh.)');
    },
    cleanup(m) { for (const n of m.loud) m.game.removeNPC(n); },
    failText: 'Finals week continues at full volume. Somebody started a drum circle.',
  },
  {
    id: 'boss',
    title: 'Showdown on Prayer Hill',
    letter: '✝',
    start: 'hillBase',
    reward: 1000,
    requires: 5,
    noAmbient: true,
    blurb: 'Your good deeds have drawn the attention of The Tempter himself. Climb Prayer Hill and stand firm.',
    begin(m) {
      m.game.clearImps(true);
      m.target = m.waypoint(m.place('hill'), 0xff4d4d, 6);
      m.objective('Climb <b>Prayer Hill</b>.');
    },
    update(m) {
      const g = m.game;
      const hill = m.place('hill');
      if (!m.boss && m.nearXZ(hill[0], hill[1], 26)) {
        m.clearWaypoints();
        m.boss = new Boss(g, hill[0], hill[1] - 8);
        g.boss = m.boss;
        g.hud.big('THE TEMPTER', '"Surely you don\'t need to go to chapel today..."', 'red');
        m.toast(g.input.isTouch ? 'Hit him with Bibles (📖) until he is stunned, then kick (✋)!' : 'Hit him with Bibles until he is stunned, then press <kbd>E</kbd> to kick!');
      }
      if (m.boss) {
        const b = m.boss;
        if (b.dead) {
          g.boss = null;
          m.win('The Tempter has fled Placerita Canyon. Resist the devil and he will flee from you. (James 4:7)');
          g.showEnding();
          return;
        }
        if (b.state !== 'dying') {
          m.objective(`<b>The Tempter</b> · Phase ${Math.min(b.phase, b.maxPhase)}/${b.maxPhase} · ${b.stunned ? '<span class="hot">STUNNED: KICK HIM!</span>' : `Stagger ${b.stagger}/${b.staggerMax}`}`);
        }
        const p = g.player;
        if (Math.hypot(p.x - hill[0], p.z - hill[1]) > 70) m.fail('You fled Prayer Hill. The Tempter is gloating.');
      }
    },
    cleanup(m) {
      if (m.boss && !m.boss.dead) { m.boss.dispose(); }
      m.game.boss = null;
      m.game.clearImps(true);
    },
  },
];

export class Missions {
  constructor(game) {
    this.game = game;
    this.defs = MISSIONS;
    this.active = null;
    this.startMarkers = [];
    this.ctx = null;
  }

  init() {
    for (const def of this.defs) {
      const pos = this.game.world.places[def.start];
      const beacon = makeBeacon(def.id === 'boss' ? 0xff4d4d : 0xffd23f, 1.8);
      beacon.position.set(pos[0], 0, pos[1]);
      this.game.scene.add(beacon);
      this.startMarkers.push({ def, pos, beacon });
    }
    this.refreshMarkers();
  }

  completedCount() { return this.game.save.completed.filter((id) => id !== 'boss').length; }

  isUnlocked(def) { return !def.requires || this.completedCount() >= def.requires; }

  refreshMarkers() {
    for (const s of this.startMarkers) {
      s.beacon.visible = !this.active;
      const done = this.game.save.completed.includes(s.def.id);
      const color = !this.isUnlocked(s.def) ? 0x777777 : done ? 0x7ee081 : s.def.id === 'boss' ? 0xff4d4d : 0xffd23f;
      s.beacon.children.forEach((c) => c.material.color.setHex(color));
    }
  }

  blips() {
    const out = [];
    if (!this.active) {
      for (const s of this.startMarkers) {
        const done = this.game.save.completed.includes(s.def.id);
        const unlocked = this.isUnlocked(s.def);
        out.push({ x: s.pos[0], z: s.pos[1], color: !unlocked ? '#888' : done ? '#7ee081' : s.def.id === 'boss' ? '#ff4d4d' : '#ffd23f', letter: s.def.letter, kind: 'start' });
      }
    } else {
      for (const b of this.ctx.blipList) {
        const x = b.obj ? b.obj.x : b.x, z = b.obj ? b.obj.z : b.z;
        out.push({ x, z, color: b.color, kind: 'target' });
      }
    }
    const ride = this.game.ride;
    if (ride) out.push({ x: ride.dest[0], z: ride.dest[1], color: '#7fd0ff', kind: 'target' });
    return out;
  }

  // Returns an interaction {text, fn} if the player is at a mission start
  interaction() {
    if (this.active) return null;
    const p = this.game.player;
    for (const s of this.startMarkers) {
      if (Math.hypot(p.x - s.pos[0], p.z - s.pos[1]) < 3.2 + (p.vehicle ? 2 : 0)) {
        const def = s.def;
        if (!this.isUnlocked(def)) {
          return { text: `🔒 ${def.title}: complete ${def.requires - this.completedCount()} more mission(s) first`, fn: () => {} };
        }
        const done = this.game.save.completed.includes(def.id);
        return { text: `${done ? 'Replay' : 'Start'}: <b>${def.title}</b>`, fn: () => this.start(def) };
      }
    }
    return null;
  }

  start(def) {
    const g = this.game;
    const m = new MissionCtx(g, def, this);
    this.active = m;
    this.ctx = m;
    this.refreshMarkers();
    g.hud.big(def.title, def.blurb);
    g.audio.deed();
    def.begin(m);
    if (m.timer != null) g.hud.setTimer(m.timer);
  }

  update(dt) {
    const m = this.active;
    const cam = this.game.camera.position;
    const fade = (b) => {
      const d = Math.hypot(cam.x - b.position.x, cam.z - b.position.z) - b.userData.radius;
      b.children[0].material.opacity = Math.max(0, Math.min(0.3, (d - 1) * 0.05));
    };
    for (const s of this.startMarkers) { s.beacon.rotation.y += dt; fade(s.beacon); }
    if (m) { for (const w of m.waypoints) fade(w.mesh); for (const pk of m.pickups) if (!pk.got) fade(pk.ring); }
    if (!m) return;
    m.elapsed += dt;
    if (m.timer != null) {
      m.timer -= dt;
      this.game.hud.setTimer(Math.max(0, m.timer));
      if (m.timer <= 0) { m.fail(m.def.failText || 'Out of time!'); return; }
    }
    m.updatePickups(dt);
    m.def.update(m, dt);
    for (const w of m.waypoints) w.mesh.rotation.y += dt;
  }

  onVehicleImpact(v, strength) {
    const m = this.active;
    if (m && m.def.onImpact && v.drivenByPlayer) m.def.onImpact(m, strength);
  }

  onImpBanished(imp) {
    const m = this.active;
    if (m && m.def.onImpBanished) m.def.onImpBanished(m, imp);
  }

  get noAmbient() { return this.active && this.active.def.noAmbient; }

  end(m, won, text) {
    if (this.active !== m || m.ended) return;
    m.ended = true;
    m.won = won;
    const g = this.game;
    if (m.def.cleanup) m.def.cleanup(m);
    m.clearAll();
    this.active = null;
    g.clockOverride = null;
    g.hud.setTimer(null);
    g.hud.setObjective('');
    if (won) {
      const first = !g.save.completed.includes(m.def.id);
      const reward = Math.round((m.def.reward + (m.bonus || 0)) * (first ? 1 : 0.5));
      if (first) g.save.completed.push(m.def.id);
      g.addCredits(reward);
      g.addHeat(1.2);
      g.audio.win();
      g.hud.big('MISSION PASSED', `+${reward} Chapel Credits · Divine Approval ↑`, 'gold');
      g.toast(text);
      const left = this.defs.find((d) => d.id === 'boss');
      if (first && m.def.id !== 'boss' && this.completedCount() === left.requires) {
        setTimeout(() => g.toast('⚠️ Something stirs on <b>Prayer Hill</b>... (red marker unlocked)'), 4200);
      }
    } else {
      g.audio.fail();
      g.hud.big('MISSION FAILED', text, 'red');
    }
    g.persist();
    this.refreshMarkers();
  }

  abandon() {
    if (this.active) this.active.fail('Mission abandoned. No judgment. (Some judgment.)');
  }
}

class MissionCtx {
  constructor(game, def, manager) {
    this.game = game;
    this.def = def;
    this.manager = manager;
    this.elapsed = 0;
    this.timer = null;
    this.waypoints = [];
    this.pickups = [];
    this.blipList = [];
    this.vehicles = [];
    this.ridersList = [];
    this.stage = 0;
  }

  place(key) { return this.game.world.places[key]; }
  objective(t) { this.game.hud.setObjective(t); }
  toast(t) { this.game.toast(t); }
  win(text) { this.manager.end(this, true, text); }
  fail(text) { this.manager.end(this, false, text); }

  nearXZ(x, z, r) {
    const p = this.game.player;
    return Math.hypot(p.x - x, p.z - z) < r + (p.vehicle ? 1.5 : 0);
  }
  near(wp, r) { return wp && this.nearXZ(wp.x, wp.z, r); }

  waypoint(pos, color, radius = 3) {
    const mesh = makeBeacon(color, radius);
    mesh.position.set(pos[0], 0, pos[1]);
    this.game.scene.add(mesh);
    const wp = { x: pos[0], z: pos[1], mesh, color: '#' + color.toString(16).padStart(6, '0') };
    this.waypoints.push(wp);
    this.blipList.push(wp);
    return wp;
  }

  clearWaypoints() {
    for (const w of this.waypoints) { this.game.scene.remove(w.mesh); this.removeBlip(w); }
    this.waypoints = [];
    this.target = null;
  }

  blip(obj, color) {
    this.blipList.push({ obj, color: '#' + color.toString(16).padStart(6, '0'), ref: obj });
  }

  removeBlip(ref) {
    this.blipList = this.blipList.filter((b) => b !== ref && b.ref !== ref);
  }

  pickup(pos, kind, onGet) {
    const mesh = makeItem(kind);
    mesh.scale.setScalar(1.6);
    const ring = makeBeacon(0x7fd0ff, 1.4);
    ring.position.set(pos[0], 0, pos[1]);
    mesh.position.set(pos[0], 1.4, pos[1]);
    this.game.scene.add(mesh, ring);
    const pk = { x: pos[0], z: pos[1], mesh, ring, kind, onGet, got: false, color: '#7fd0ff' };
    this.pickups.push(pk);
    this.blipList.push(pk);
    return pk;
  }

  pickupsLeft() { return this.pickups.filter((p) => !p.got).length; }

  updatePickups(dt) {
    for (const pk of this.pickups) {
      if (pk.got) continue;
      pk.mesh.rotation.y += dt * 2;
      pk.mesh.position.y = 1.4 + Math.sin(this.elapsed * 3) * 0.2;
      if (this.nearXZ(pk.x, pk.z, 2.5)) {
        pk.got = true;
        this.game.scene.remove(pk.mesh, pk.ring);
        this.removeBlip(pk);
        this.game.audio.pickup();
        if (pk.onGet) pk.onGet();
        else this.toast(`Got the ${{ tomato: 'tomatoes', basil: 'fresh basil', pasta: 'pasta', cheese: 'parmesan', garlic: 'garlic (so much garlic)' }[pk.kind] || pk.kind}!`);
      }
    }
  }

  spawnVehicle(type, pos, heading) {
    const v = this.game.spawnVehicle(type, pos[0], pos[1], heading);
    this.vehicles.push(v);
    return v;
  }

  rider(pos) {
    const mesh = makePerson(randomLook());
    mesh.position.set(pos[0], 0, pos[1]);
    animatePerson(mesh, 0, 0);
    const bubble = makeBubble('☕', '#7fd0ff');
    bubble.position.y = 2.4;
    mesh.add(bubble);
    this.game.scene.add(mesh);
    const r = { x: pos[0], z: pos[1], mesh, picked: false };
    r.blip = { obj: r, color: '#7fd0ff', ref: r };
    this.blipList.push(r.blip);
    this.ridersList.push(r);
    return r;
  }

  clearAll() {
    for (const w of this.waypoints) this.game.scene.remove(w.mesh);
    for (const pk of this.pickups) this.game.scene.remove(pk.mesh, pk.ring);
    for (const r of this.ridersList) this.game.scene.remove(r.mesh);
    // Mission vehicles stay in the world unless the player is far away
    this.waypoints = []; this.pickups = []; this.blipList = [];
  }
}
