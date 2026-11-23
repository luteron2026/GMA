import * as THREE from 'three';

// Low-poly models built from primitives (no external assets needed).

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, ...opts });
    matCache.set(key, m);
  }
  return m;
}

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cone4: new THREE.ConeGeometry(0.5, 1, 4),
  cone8: new THREE.ConeGeometry(0.5, 1, 8),
  sphere: new THREE.IcosahedronGeometry(0.5, 1),
  wheel: new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12).rotateZ(Math.PI / 2),
};
export const GEOM = G;

function part(geo, material, sx, sy, sz, x, y, z, parent, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  if (parent) parent.add(m);
  return m;
}

const SKIN = [0xf1c9a5, 0xe0ac84, 0xc68863, 0x8d5a3b, 0x5c3a24, 0xf5d7bd];
const HAIR = [0x2b1d12, 0x4a2f1b, 0x7b5230, 0xc9a25a, 0x111111, 0x8a3b1d];
const SHIRT = [0x1f3a6e, 0xc9a227, 0xffffff, 0x7a1f2b, 0x3f6e4a, 0x6d6d78, 0xe8b4b8, 0x2d6f8f, 0x8b5e3c];
const PANTS = [0x2b2f3a, 0x3d4f6e, 0x55524a, 0x1c1c1c, 0x6e5b44];

export function randomLook(rng = Math.random) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  return { skin: pick(SKIN), hair: pick(HAIR), shirt: pick(SHIRT), pants: pick(PANTS), longHair: rng() < 0.45 };
}

// A blocky person ~1.8m tall, facing +z.
export function makePerson(look = randomLook()) {
  const g = new THREE.Group();
  const skin = mat(look.skin), shirt = mat(look.shirt), pants = mat(look.pants), hair = mat(look.hair);
  const shoe = mat(0x2a2522);

  const hips = new THREE.Group(); hips.position.y = 0.92; g.add(hips);
  const legL = new THREE.Group(); legL.position.set(-0.13, 0, 0); hips.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.13, 0, 0); hips.add(legR);
  part(G.box, pants, 0.22, 0.84, 0.24, 0, -0.42, 0, legL);
  part(G.box, pants, 0.22, 0.84, 0.24, 0, -0.42, 0, legR);
  part(G.box, shoe, 0.24, 0.1, 0.34, 0, -0.86, 0.05, legL);
  part(G.box, shoe, 0.24, 0.1, 0.34, 0, -0.86, 0.05, legR);

  const torso = part(G.box, shirt, 0.52, 0.62, 0.3, 0, 1.24, 0, g);
  const armL = new THREE.Group(); armL.position.set(-0.34, 1.5, 0); g.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.34, 1.5, 0); g.add(armR);
  part(G.box, shirt, 0.16, 0.42, 0.18, 0, -0.18, 0, armL);
  part(G.box, shirt, 0.16, 0.42, 0.18, 0, -0.18, 0, armR);
  part(G.box, skin, 0.14, 0.2, 0.15, 0, -0.48, 0, armL);
  part(G.box, skin, 0.14, 0.2, 0.15, 0, -0.48, 0, armR);

  const head = new THREE.Group(); head.position.y = 1.72; g.add(head);
  part(G.box, skin, 0.34, 0.36, 0.32, 0, 0, 0, head);
  part(G.box, hair, 0.37, 0.12, 0.35, 0, 0.18, -0.01, head);
  if (look.longHair) part(G.box, hair, 0.37, 0.36, 0.1, 0, -0.04, -0.17, head);
  else part(G.box, hair, 0.36, 0.14, 0.08, 0, 0.08, -0.16, head);
  const eye = mat(0x1a1a1a);
  part(G.box, eye, 0.05, 0.05, 0.02, -0.08, 0.03, 0.165, head, false);
  part(G.box, eye, 0.05, 0.05, 0.02, 0.08, 0.03, 0.165, head, false);

  g.userData.parts = { legL, legR, armL, armR, torso, head };
  g.userData.look = look;
  return g;
}

export function setOutfit(person, { shirt, tie }) {
  const p = person.userData.parts;
  if (shirt !== undefined) {
    p.torso.material = mat(shirt);
    p.armL.children[0].material = mat(shirt);
    p.armR.children[0].material = mat(shirt);
  }
  if (tie && !p.tie) {
    p.tie = part(G.box, mat(0x8b1a1a), 0.08, 0.4, 0.02, 0, 1.3, 0.16, person);
  }
}

// phase: radians, amount: 0..1
export function animatePerson(g, phase, amount, opts = {}) {
  const p = g.userData.parts;
  const s = Math.sin(phase) * 0.7 * amount;
  p.legL.rotation.x = s;
  p.legR.rotation.x = -s;
  p.armL.rotation.x = -s * 0.9;
  p.armR.rotation.x = opts.throwing ? -2.4 : s * 0.9;
  p.armR.rotation.z = 0;
  if (opts.sitting) {
    p.legL.rotation.x = p.legR.rotation.x = -1.4;
  }
}

// ---------- Vehicles ----------

export const VEHICLE_TYPES = {
  cart: {
    label: 'Golf Cart', maxSpeed: 12, accel: 7, brake: 14, turn: 2.3, width: 1.4, length: 2.5,
    colors: [0xffffff, 0xe8e2d0, 0x1f3a6e],
  },
  deanCart: {
    label: "Dean Placerita's Golf Cart", maxSpeed: 16, accel: 9, brake: 16, turn: 2.4, width: 1.5, length: 2.6,
    colors: [0xc9a227],
  },
  sedan: {
    label: 'Commuter Sedan (312k miles)', maxSpeed: 26, accel: 10, brake: 18, turn: 1.9, width: 1.9, length: 4.3,
    colors: [0x8e2b2b, 0x2d4f7a, 0xb8b8b8, 0x2b2b2b, 0xe0d7c3, 0x4d6b48, 0x6a4f8c],
  },
  truck: {
    label: 'Facilities Truck', maxSpeed: 21, accel: 8, brake: 15, turn: 1.6, width: 2.1, length: 5.2,
    colors: [0xf2f2f2, 0x9aa39a],
  },
  van: {
    label: 'Outreach Team Van', maxSpeed: 20, accel: 7, brake: 14, turn: 1.6, width: 2.1, length: 5.0,
    colors: [0xf5f5f0, 0x1f3a6e],
  },
  // Tracked: turns in place, shrugs off other cars, and the horn button fires a (harmless)
  // Hallelujah shell
  tank: {
    label: 'Mustang Tank (ROTC surplus)', maxSpeed: 12, accel: 4.5, brake: 12, turn: 1.25, width: 3.4, length: 7.2,
    colors: [0x5b6340], tracks: true, heavy: true, unique: true,
  },
  // Steers with the back wheels; Space raises and lowers the forks
  forklift: {
    label: 'Trophy Coffee Forklift', maxSpeed: 6.5, accel: 3.5, brake: 10, turn: 2.4, width: 1.3, length: 2.6,
    colors: [0xf2b705], forklift: true, unique: true,
  },
  // Flies: Space climbs, Shift descends, W/S forward/back, A/D turn
  heli: {
    label: 'Prayer Chopper', maxSpeed: 32, accel: 9, brake: 10, turn: 1.4, width: 2.6, length: 8.5,
    colors: [0x1f3a6e], air: true, unique: true,
  },
};

export function makeVehicle(type, color) {
  const t = VEHICLE_TYPES[type];
  const g = new THREE.Group();
  const body = mat(color);
  const dark = mat(0x222428);
  const glass = mat(0x9ec3d6);
  const tire = mat(0x1b1b1b);
  const light = mat(0xfff6c8, { emissive: 0x665c2a });
  const red = mat(0xb01818, { emissive: 0x400000 });
  const W = t.width, L = t.length;
  const wheels = [];
  const wheelR = type === 'cart' || type === 'deanCart' ? 0.28 : 0.38;

  if (type === 'tank') return makeTank(g, body, dark, light);
  if (type === 'heli') return makeHeli(g, body, dark, glass, light, red);
  if (type === 'forklift') return makeForklift(g, body, dark, tire, light);

  if (type === 'cart' || type === 'deanCart') {
    part(G.box, body, W, 0.35, L, 0, 0.45, 0, g);
    part(G.box, mat(0x3a3a3a), W * 0.9, 0.12, L * 0.42, 0, 0.7, -0.2, g); // seat
    part(G.box, body, W * 0.9, 0.45, 0.12, 0, 0.95, -0.55, g); // backrest
    part(G.box, body, W, 0.1, L * 0.8, 0, 2.0, -0.1, g); // roof
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      part(G.box, dark, 0.06, 1.4, 0.06, sx * (W / 2 - 0.08), 1.3, sz * 0.9 - 0.1, g);
    part(G.box, glass, W * 0.9, 0.7, 0.04, 0, 1.55, 0.82, g);
    part(G.box, light, 0.2, 0.1, 0.05, -0.4, 0.55, L / 2, g);
    part(G.box, light, 0.2, 0.1, 0.05, 0.4, 0.55, L / 2, g);
  } else if (type === 'truck') {
    part(G.box, body, W, 0.8, L, 0, 0.85, 0, g);
    part(G.box, body, W * 0.96, 0.8, L * 0.38, 0, 1.6, L * 0.14, g);
    part(G.box, glass, W * 0.9, 0.5, 0.05, 0, 1.65, L * 0.33 + 0.02, g);
    part(G.box, glass, W * 0.98, 0.45, L * 0.3, 0, 1.65, L * 0.14, g);
    part(G.box, dark, W * 0.9, 0.3, L * 0.45, 0, 1.3, -L * 0.25, g); // bed
    part(G.box, mat(0xff8c1a, { emissive: 0x552200 }), 0.6, 0.15, 0.3, 0, 2.05, L * 0.14, g); // beacon
  } else if (type === 'van') {
    part(G.box, body, W, 1.7, L, 0, 1.35, 0, g);
    part(G.box, glass, W * 0.92, 0.55, 0.05, 0, 1.75, L / 2 + 0.01, g);
    part(G.box, glass, W + 0.02, 0.45, L * 0.7, 0, 1.75, -0.1, g);
    part(G.box, mat(0xc9a227), W + 0.03, 0.18, L * 0.9, 0, 1.15, 0, g); // stripe
  } else {
    part(G.box, body, W, 0.65, L, 0, 0.75, 0, g);
    part(G.box, body, W * 0.88, 0.55, L * 0.5, 0, 1.35, -0.15, g);
    part(G.box, glass, W * 0.9, 0.42, L * 0.46, 0, 1.36, -0.15, g);
    part(G.box, dark, W * 1.02, 0.18, 0.2, 0, 0.5, L / 2, g); // bumper
    part(G.box, dark, W * 1.02, 0.18, 0.2, 0, 0.5, -L / 2, g);
  }
  if (type !== 'cart' && type !== 'deanCart') {
    part(G.box, light, 0.35, 0.16, 0.05, -W / 2 + 0.3, 0.85, L / 2 + 0.01, g);
    part(G.box, light, 0.35, 0.16, 0.05, W / 2 - 0.3, 0.85, L / 2 + 0.01, g);
    part(G.box, red, 0.3, 0.16, 0.05, -W / 2 + 0.3, 0.85, -L / 2 - 0.01, g);
    part(G.box, red, 0.3, 0.16, 0.05, W / 2 - 0.3, 0.85, -L / 2 - 0.01, g);
  }
  const wz = L / 2 - wheelR - 0.25;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = part(G.wheel, tire, wheelR * 2, wheelR * 2, wheelR * 2, sx * (W / 2), wheelR, sz * wz, g);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  g.userData.wheelR = wheelR;
  return g;
}

function makeTank(g, body, dark, light) {
  const t = VEHICLE_TYPES.tank, W = t.width, L = t.length;
  const track = mat(0x2a2a26), wheelM = mat(0x3d4030), gold = mat(0xc9a227), navy = mat(0x1f3a6e);
  const wheels = [];
  for (const sx of [-1, 1]) {
    // Track run with the road wheels inside it
    part(G.box, track, 0.7, 1.0, L, sx * (W / 2 - 0.35), 0.55, 0, g);
    part(G.box, track, 0.72, 0.5, L * 0.12, sx * (W / 2 - 0.35), 0.55, L / 2 - 0.1, g).rotation.x = 0.7;
    part(G.box, track, 0.72, 0.5, L * 0.12, sx * (W / 2 - 0.35), 0.55, -L / 2 + 0.1, g).rotation.x = -0.7;
    for (let k = 0; k < 6; k++) {
      const w = part(G.wheel, wheelM, 0.74, 0.72, 0.72, sx * (W / 2 + 0.02), 0.45, -L / 2 + 0.9 + k * ((L - 1.8) / 5), g);
      wheels.push(w);
    }
    part(G.box, body, 0.9, 0.12, L * 0.98, sx * (W / 2 - 0.35), 1.1, 0, g); // fender
  }
  // Hull with a sloped front plate
  part(G.box, body, W - 1.3, 0.9, L * 0.92, 0, 1.0, -0.1, g);
  const glacis = part(G.box, body, W - 1.3, 0.12, 1.5, 0, 1.25, L / 2 - 0.75, g);
  glacis.rotation.x = 0.45;
  part(G.box, body, W - 0.2, 0.35, L * 0.75, 0, 1.55, -0.3, g); // deck
  // Turret, cannon and hatch (turret is a group so it can swing)
  const turret = new THREE.Group();
  turret.position.set(0, 1.72, -0.5);
  g.add(turret);
  part(G.box, body, 2.3, 0.75, 2.9, 0, 0.38, 0, turret);
  part(G.box, body, 1.7, 0.2, 2.2, 0, 0.85, -0.2, turret);
  part(G.cyl, dark, 0.75, 0.25, 0.75, -0.5, 0.95, -0.5, turret); // hatch
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.42, 1.45);
  turret.add(barrel);
  const tube = part(G.cyl, dark, 0.26, 3.6, 0.26, 0, 0, 1.8, barrel);
  tube.rotation.x = Math.PI / 2;
  const muzzle = part(G.cyl, dark, 0.36, 0.5, 0.36, 0, 0, 3.6, barrel);
  muzzle.rotation.x = Math.PI / 2;
  const flash = part(G.sphere, mat(0xfff0a0, { emissive: 0xffc040 }), 1.2, 1.2, 1.6, 0, 0, 4.4, barrel, false);
  flash.visible = false;
  // School colors: gold stripe and a navy star on each side
  part(G.box, gold, 2.32, 0.12, 2.92, 0, 0.55, 0, turret);
  for (const sx of [-1, 1]) part(G.box, navy, 0.04, 0.5, 0.5, sx * 1.17, 0.35, 0.3, turret).rotation.x = Math.PI / 4;
  // Little cross-shaped antenna flag
  part(G.box, dark, 0.04, 1.8, 0.04, 0.8, 1.6, -1.1, turret);
  part(G.box, gold, 0.03, 0.4, 0.6, 0.8, 2.3, -0.82, turret);
  part(G.box, light, 0.3, 0.15, 0.05, -0.7, 1.2, L / 2 - 0.05, g);
  part(G.box, light, 0.3, 0.15, 0.05, 0.7, 1.2, L / 2 - 0.05, g);
  g.userData.wheels = wheels;
  g.userData.wheelR = 0.36;
  g.userData.turret = turret;
  g.userData.barrel = barrel;
  g.userData.flash = flash;
  g.userData.noSteer = true;
  return g;
}

function makeForklift(g, body, dark, tire, light) {
  const t = VEHICLE_TYPES.forklift, W = t.width, L = t.length;
  const steel = mat(0x3d4044), wood = mat(0x9a7448), sack = mat(0x7a5a38), black = mat(0x1c1c1c);
  // Chassis, counterweight, seat and the overhead guard
  part(G.box, body, W, 0.75, L * 0.72, 0, 0.7, -0.25, g);
  part(G.box, body, W * 0.98, 0.65, 0.55, 0, 0.95, -L / 2 + 0.25, g);
  part(G.box, black, 0.5, 0.12, 0.5, 0, 1.15, -0.45, g);
  part(G.box, black, 0.5, 0.55, 0.1, 0, 1.45, -0.72, g);
  for (const sx of [-1, 1]) for (const z of [-0.85, 0.35]) part(G.box, steel, 0.07, 1.25, 0.07, sx * (W / 2 - 0.1), 1.65, z, g);
  part(G.box, steel, W * 0.9, 0.06, 1.35, 0, 2.28, -0.25, g);
  for (let k = -2; k <= 2; k++) part(G.box, steel, 0.04, 0.05, 1.3, k * 0.22, 2.32, -0.25, g);
  part(G.box, black, 0.35, 0.08, 0.35, 0.05, 1.6, 0.25, g).rotation.x = -0.6; // steering wheel
  // Mast with a carriage that slides up: backrest, two forks and a pallet of coffee sacks
  for (const sx of [-0.38, 0.38]) part(G.box, steel, 0.12, 2.3, 0.14, sx, 1.25, L / 2 - 0.05, g);
  part(G.box, steel, 0.9, 0.1, 0.14, 0, 2.35, L / 2 - 0.05, g);
  const carriage = new THREE.Group();
  carriage.position.set(0, 0, L / 2 + 0.05);
  g.add(carriage);
  part(G.box, steel, 0.95, 0.5, 0.06, 0, 0.45, 0, carriage);
  for (const sx of [-0.3, 0.3]) part(G.box, steel, 0.12, 0.05, 1.1, sx, 0.16, 0.55, carriage);
  part(G.box, wood, 1.0, 0.13, 1.0, 0, 0.26, 0.58, carriage);
  for (const [x, z, y] of [[-0.24, 0.35, 0.45], [0.24, 0.35, 0.45], [-0.24, 0.8, 0.45], [0.24, 0.8, 0.45], [0, 0.58, 0.7]]) part(G.box, sack, 0.45, 0.25, 0.4, x, y, z, carriage);
  part(G.box, light, 0.18, 0.12, 0.05, -0.45, 1.0, L / 2 - 0.35, g);
  part(G.box, mat(0xff8c1a, { emissive: 0x552200 }), 0.14, 0.1, 0.14, 0, 2.38, -0.85, g); // beacon
  // Big front wheels, small rear (steering) wheels
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const [z, r] of [[-L / 2 + 0.45, 0.26], [L / 2 - 0.5, 0.36]]) wheels.push(part(G.wheel, tire, r * 2, r * 2, r * 2, sx * (W / 2 - 0.05), r, z, g));
  }
  g.userData.wheels = wheels;
  g.userData.wheelR = 0.3;
  g.userData.rearSteer = true;
  g.userData.carriage = carriage;
  return g;
}

function makeHeli(g, body, dark, glass, light, red) {
  const white = mat(0xf2f2ee), gold = mat(0xc9a227);
  // Cabin, nose and engine housing
  part(G.sphere, body, 2.4, 2.2, 4.4, 0, 1.85, 0.4, g);
  part(G.box, body, 2.0, 1.3, 2.6, 0, 1.95, -0.6, g);
  part(G.sphere, glass, 2.1, 1.6, 2.4, 0, 2.15, 1.55, g);
  part(G.box, white, 1.5, 0.7, 2.4, 0, 3.05, -0.4, g);
  part(G.box, gold, 2.42, 0.2, 3.6, 0, 1.6, 0.2, g); // gold stripe
  // Tail boom, fins and tail rotor
  const boom = part(G.cyl, body, 0.5, 5.0, 0.5, 0, 2.35, -3.6, g);
  boom.rotation.x = Math.PI / 2 - 0.06;
  part(G.box, body, 0.12, 1.5, 0.9, 0, 2.9, -6.0, g);
  part(G.box, body, 1.6, 0.08, 0.6, 0, 2.4, -5.6, g);
  const tail = new THREE.Group();
  tail.position.set(0.22, 2.95, -6.1);
  g.add(tail);
  for (const a of [0, Math.PI / 2]) { const b = part(G.box, dark, 0.04, 1.4, 0.16, 0, 0, 0, tail); b.rotation.x = a; }
  // Skids
  for (const sx of [-1, 1]) {
    part(G.box, dark, 0.12, 0.12, 3.8, sx * 1.1, 0.1, 0.4, g);
    for (const z of [-0.6, 1.4]) part(G.box, dark, 0.08, 0.75, 0.08, sx * 0.95, 0.45, z, g).rotation.z = sx * 0.3;
  }
  // Main rotor
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.55, 0.1);
  g.add(rotor);
  part(G.cyl, dark, 0.3, 0.45, 0.3, 0, -0.1, 0, rotor);
  for (let k = 0; k < 4; k++) {
    const blade = part(G.box, dark, 0.32, 0.05, 5.6, 0, 0.1, 2.85, rotor);
    blade.position.set(Math.sin((k * Math.PI) / 2) * 2.85, 0.1, Math.cos((k * Math.PI) / 2) * 2.85);
    blade.rotation.y = (k * Math.PI) / 2;
  }
  part(G.box, light, 0.25, 0.12, 0.05, 0, 1.0, 2.55, g);
  part(G.box, red, 0.12, 0.12, 0.12, 0, 3.4, -6.4, g, false);
  g.userData.wheels = [];
  g.userData.wheelR = 1;
  g.userData.rotor = rotor;
  g.userData.tailRotor = tail;
  return g;
}

// ---------- Spiritual opposition ----------

export function makeImp() {
  const g = new THREE.Group();
  const red = mat(0xc4261d);
  const dark = mat(0x5c0f0b);
  const eye = mat(0xffe14d, { emissive: 0xffaa00 });
  const body = part(G.sphere, red, 0.8, 0.9, 0.7, 0, 0.75, 0, g);
  part(G.sphere, red, 0.62, 0.58, 0.58, 0, 1.38, 0.02, g);
  const hornL = part(G.cone8, dark, 0.12, 0.35, 0.12, -0.17, 1.72, 0, g); hornL.rotation.z = 0.4;
  const hornR = part(G.cone8, dark, 0.12, 0.35, 0.12, 0.17, 1.72, 0, g); hornR.rotation.z = -0.4;
  part(G.box, eye, 0.12, 0.08, 0.04, -0.12, 1.42, 0.29, g, false);
  part(G.box, eye, 0.12, 0.08, 0.04, 0.12, 1.42, 0.29, g, false);
  const wingL = part(G.cone4, dark, 0.5, 0.6, 0.06, -0.45, 1.05, -0.25, g); wingL.rotation.z = 1.2;
  const wingR = part(G.cone4, dark, 0.5, 0.6, 0.06, 0.45, 1.05, -0.25, g); wingR.rotation.z = -1.2;
  const tail = part(G.cone8, dark, 0.08, 0.6, 0.08, 0, 0.55, -0.45, g); tail.rotation.x = -1.1;
  const fork = part(G.cone4, dark, 0.2, 0.2, 0.05, 0, 0.35, -0.74, g); fork.rotation.x = -1.1;
  g.userData.parts = { body, wingL, wingR };
  return g;
}

export function makeBoss() {
  const g = makeImp();
  g.scale.setScalar(3.6);
  const crown = mat(0x2a0505);
  for (let i = 0; i < 5; i++) {
    const a = (i / 4 - 0.5) * 1.6;
    const h = part(G.cone8, crown, 0.1, 0.45, 0.1, Math.sin(a) * 0.25, 1.78, Math.cos(a) * 0.05 - 0.05, g);
    h.rotation.z = -a * 0.6;
  }
  return g;
}

export function makeBible() {
  const g = new THREE.Group();
  part(G.box, mat(0x2b1a12), 0.42, 0.12, 0.56, 0, 0, 0, g);
  part(G.box, mat(0xf3ead2), 0.38, 0.09, 0.52, 0.03, 0, 0, g);
  part(G.box, mat(0xd4af37, { emissive: 0x3a2a00 }), 0.04, 0.13, 0.24, -0.08, 0, 0, g);
  part(G.box, mat(0xd4af37, { emissive: 0x3a2a00 }), 0.16, 0.13, 0.04, -0.08, 0, 0.04, g);
  return g;
}

export function makeFireball() {
  const g = new THREE.Group();
  part(G.sphere, mat(0xff5a1a, { emissive: 0xff3300 }), 0.9, 0.9, 0.9, 0, 0, 0, g, false);
  part(G.sphere, mat(0xffd24a, { emissive: 0xffaa00 }), 0.5, 0.5, 0.5, 0, 0, 0, g, false);
  return g;
}

// Small pickup item meshes
export function makeItem(kind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'pie':
      part(G.cyl, mat(0xc98a3c), 0.9, 0.25, 0.9, 0, 0, 0, g);
      part(G.cyl, mat(0xe8b35a), 0.8, 0.06, 0.8, 0, 0.14, 0, g);
      break;
    case 'tie':
      part(G.box, mat(0x8b1a1a), 0.25, 0.9, 0.06, 0, 0, 0, g);
      part(G.box, mat(0x8b1a1a), 0.3, 0.2, 0.1, 0, 0.5, 0, g);
      break;
    case 'blazer':
      part(G.box, mat(0x1b2a4a), 0.9, 1.0, 0.35, 0, 0, 0, g);
      part(G.box, mat(0xffffff), 0.2, 0.7, 0.36, 0, 0.1, 0.01, g);
      break;
    case 'shoes':
      part(G.box, mat(0x2b1a12), 0.3, 0.2, 0.6, -0.2, 0, 0, g);
      part(G.box, mat(0x2b1a12), 0.3, 0.2, 0.6, 0.2, 0, 0, g);
      break;
    case 'tomato':
      part(G.sphere, mat(0xd8261b), 0.8, 0.7, 0.8, 0, 0, 0, g);
      part(G.cone8, mat(0x2f7a2f), 0.3, 0.2, 0.3, 0, 0.38, 0, g);
      break;
    case 'basil':
      for (let i = 0; i < 4; i++) {
        const l = part(G.sphere, mat(0x3b9a3b), 0.4, 0.12, 0.7, 0, i * 0.05, 0, g);
        l.rotation.y = i * 0.8;
      }
      break;
    case 'pasta':
      part(G.box, mat(0x2d5aa8), 0.6, 0.9, 0.25, 0, 0, 0, g);
      part(G.box, mat(0xf2d27a), 0.45, 0.3, 0.26, 0, 0.1, 0, g);
      break;
    case 'cheese':
      part(G.cone4, mat(0xf5d76e), 0.9, 0.5, 0.9, 0, 0, 0, g);
      break;
    case 'garlic':
      part(G.sphere, mat(0xf6f1e3), 0.7, 0.6, 0.7, 0, 0, 0, g);
      part(G.cone8, mat(0xe6dcc2), 0.2, 0.3, 0.2, 0, 0.4, 0, g);
      break;
    default:
      part(G.sphere, mat(0xffd700, { emissive: 0x664400 }), 0.6, 0.6, 0.6, 0, 0, 0, g);
  }
  return g;
}

// Glowing mission beacon
export function makeBeacon(color = 0xffd23f, radius = 2.2) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 6, 24, 1, true), m);
  cyl.position.y = 3;
  g.add(cyl);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.8, radius, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false })
  );
  ring.position.y = 0.06;
  g.add(ring);
  g.userData.radius = radius;
  return g;
}

// Billboard text label
export function makeLabel(text, sub, opts = {}) {
  const c = document.createElement('canvas');
  const scale = 2;
  c.width = 512 * scale; c.height = (sub ? 150 : 100) * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = opts.bg || 'rgba(20,32,60,0.82)';
  roundRect(ctx, 6, 6, 500, (sub ? 138 : 88), 18);
  ctx.fill();
  ctx.strokeStyle = opts.border || '#c9a227';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px "Trebuchet MS", Arial, sans-serif';
  ctx.fillText(text, 256, 52, 470);
  if (sub) {
    ctx.fillStyle = '#f3d56b';
    ctx.font = 'bold 32px "Trebuchet MS", Arial, sans-serif';
    ctx.fillText(sub, 256, 108, 470);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  const w = opts.width || 14;
  sprite.scale.set(w, w * (c.height / c.width), 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Speech bubble icon above NPCs
export function makeBubble(symbol = '!', color = '#ffd23f') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(64, 56, 46, 0, Math.PI * 2);
  ctx.moveTo(48, 92); ctx.lineTo(64, 124); ctx.lineTo(80, 92);
  ctx.fill();
  ctx.strokeStyle = '#1f2a44'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(64, 56, 46, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#1f2a44';
  ctx.font = 'bold 64px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(symbol, 64, 60);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(0.9, 0.9, 1);
  return s;
}
