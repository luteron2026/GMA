// Trophy Coffee, on the south end of the MacArthur Center, from the photos on the
// university's campus map: a deep navy stucco front with TROPHY in big white letters under a
// little gold star and COFFEE below, black steel doors and windows looking into the white cafe
// (teal cabinets, white brick, the flag over the bar), a navy-and-white striped awning, and a
// patio of navy market umbrellas, white marble bistro tables with blue-and-white rattan
// chairs, picnic tables, and stacked-stone piers carrying a timber pergola along the front.
// Walk in through the doors: the inside is in interiors.js.
import * as THREE from 'three';
import { heightAtCampus } from './terrain.js';
import { mat, GEOM } from './models.js';
import { toCampus } from './geo.js';
import { distToPolyline, pointInPoly } from './physics.js';

const BLACK = 0x1b1b1b, WOOD = 0x8a7a68, NAVY = 0x1f2c48, RATTAN = 0x2d4f8a, MARBLE = 0xeeeeea;

function canvasTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

// One meter of deep navy stucco
function sidingTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#22304e'; ctx.fillRect(0, 0, 128, 128);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) { ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)'; ctx.fillRect(rnd() * 128, rnd() * 128, 2, 2); }
  return canvasTex(c, [w, h]);
}

// Navy-and-white awning stripes, 0.3 m each
function stripeTexture(w) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f0ea'; ctx.fillRect(0, 0, 64, 16);
  ctx.fillStyle = '#1f2c48'; ctx.fillRect(0, 0, 32, 16);
  return canvasTex(c, [w / 0.6, 1]);
}

// The lit cafe seen through the windows: spans 8.8 m x 3.0 m of storefront
function interiorTexture() {
  const W = 1024, H = 350, m = W / 8.8;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const Y = (h) => H - h * m; // meters above the ground -> canvas y
  // Back wall: white, with white-painted brick behind the bar and its black barn sconces
  ctx.fillStyle = '#f2f1ed'; ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < Y(1.0); y += 12) for (let x = (y / 12) % 2 ? 0 : 24; x < 690; x += 48) {
    ctx.fillStyle = `rgba(150,145,135,${0.10 + ((x * 7 + y) % 5) * 0.02})`; ctx.fillRect(330 + (x % 360), y, 46, 1.5);
  }
  for (let y = 0; y < Y(1.0); y += 12) { ctx.fillStyle = 'rgba(150,145,135,0.18)'; ctx.fillRect(330, y, 360, 1.5); }
  for (const x of [390, 450, 510]) { ctx.fillStyle = '#151515'; ctx.fillRect(x - 3, 70, 6, 14); ctx.beginPath(); ctx.moveTo(x - 14, 98); ctx.lineTo(x, 80); ctx.lineTo(x + 14, 98); ctx.fill(); ctx.fillStyle = 'rgba(255,225,160,0.9)'; ctx.fillRect(x - 5, 98, 10, 5); }
  // The flag over the bar, and black metal shelving with plants and bags of beans at the sides
  for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : '#b22234'; ctx.fillRect(600, 30 + i * 9, 60, 9); }
  ctx.fillStyle = '#3c3b6e'; ctx.fillRect(600, 30, 26, 32);
  for (const sx of [40, 800]) {
    ctx.fillStyle = '#151515'; ctx.fillRect(sx, 20, 4, Y(0.25) - 20); ctx.fillRect(sx + 156, 20, 4, Y(0.25) - 20);
    for (let k = 0; k < 3; k++) {
      const y = 70 + k * 55;
      ctx.fillStyle = '#151515'; ctx.fillRect(sx, y, 160, 4);
      for (let b = 0; b < 5; b++) {
        ctx.fillStyle = ['#2b2b2b', '#c9a227', '#f1ece0', '#1f2c48', '#f1ece0'][(b + k) % 5];
        ctx.fillRect(sx + 10 + b * 28, y - 28, 18, 28);
      }
    }
    ctx.fillStyle = '#4f7a3a'; ctx.beginPath(); ctx.arc(sx + 80, 30, 26, 0, Math.PI * 2); ctx.fill();
  }
  // Pendant lights: black cords and dome shades with glowing bulbs
  for (let k = 0; k < 6; k++) {
    const x = 150 + k * 145;
    ctx.fillStyle = '#111'; ctx.fillRect(x - 1, 0, 2, 28);
    const g = ctx.createRadialGradient(x, 40, 0, x, 40, 60);
    g.addColorStop(0, 'rgba(255,220,150,0.9)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 60, 0, 120, 110);
    ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.moveTo(x - 18, 40); ctx.quadraticCurveTo(x, 18, x + 18, 40); ctx.fill();
    ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.arc(x, 42, 5, 0, Math.PI * 2); ctx.fill();
  }
  // Barista behind the counter, a customer in front of it
  const person = (x, top, shirt, apron) => {
    ctx.fillStyle = '#c99a7a'; ctx.beginPath(); ctx.arc(x, top + 14, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a2a1e'; ctx.beginPath(); ctx.arc(x, top + 9, 13, Math.PI, 0); ctx.fill();
    ctx.fillStyle = shirt; ctx.fillRect(x - 20, top + 28, 40, 90);
    if (apron) { ctx.fillStyle = apron; ctx.fillRect(x - 15, top + 45, 30, 73); }
  };
  person(520, Y(1.95), '#1f2c48', '#222');
  // Counter: white top on deep-teal cabinets, with the espresso machine and pastry case
  ctx.fillStyle = '#2e5a60'; ctx.fillRect(170, Y(1.05), 680, Y(0.25) - Y(1.05));
  for (let x = 170; x < 850; x += 68) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, Y(1.05), 3, Y(0.25) - Y(1.05)); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2; ctx.strokeRect(x + 10, Y(0.95), 48, Y(0.35) - Y(0.95)); }
  ctx.fillStyle = '#f6f4ee'; ctx.fillRect(160, Y(1.12), 700, 9);
  ctx.fillStyle = '#c8ccd0'; ctx.fillRect(250, Y(1.6), 120, Y(1.12) - Y(1.6)); // espresso machine
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(250, Y(1.6), 120, 10); ctx.fillRect(262, Y(1.3), 96, 8);
  ctx.fillStyle = '#e2e6ea'; for (const x of [275, 305, 335]) ctx.fillRect(x, Y(1.3) + 8, 8, 14);
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(400, Y(1.55), 26, Y(1.12) - Y(1.55)); // grinder
  ctx.fillStyle = 'rgba(210,235,245,0.55)'; ctx.fillRect(610, Y(1.5), 150, Y(1.12) - Y(1.5)); // pastry case
  for (let k = 0; k < 6; k++) { ctx.fillStyle = ['#d49a4a', '#b5652f', '#e8c27a'][k % 3]; ctx.beginPath(); ctx.ellipse(630 + k * 22, Y(1.25), 9, 6, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(790, Y(1.38), 34, Y(1.12) - Y(1.38)); // register
  person(880, Y(1.8), '#2f5d8a');
  // Polished concrete floor
  ctx.fillStyle = '#bdbcb6'; ctx.fillRect(0, Y(0.25), W, H);
  // Glass: a cool sky reflection at the top and a couple of diagonal glints
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, 'rgba(170,200,225,0.35)'); sky.addColorStop(0.5, 'rgba(170,200,225,0.08)'); sky.addColorStop(1, 'rgba(170,200,225,0.0)');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (const x of [120, 470, 760]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 70, 0); ctx.lineTo(x - 60, H); ctx.lineTo(x - 130, H); ctx.fill(); }
  // Knee wall under the side windows (the door goes to the ground)
  ctx.fillStyle = '#26292b'; ctx.fillRect(0, Y(0.45), 395, H); ctx.fillRect(629, Y(0.45), W, H);
  // Hours and logo decals on the door glass
  ctx.fillStyle = 'rgba(245,240,230,0.9)'; ctx.font = 'bold 15px Georgia, serif'; ctx.textAlign = 'center';
  ctx.fillText('TROPHY COFFEE', 512, Y(1.55));
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('MON–SAT 7AM–10PM · SUN 3–10PM', 512, Y(1.4));
  return canvasTex(c);
}

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 220;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1024, 220);
  // Painted white letters: a little star, TROPHY in tall heavy capitals, COFFEE spaced out below
  ctx.fillStyle = '#c9a227'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 34px serif'; ctx.fillText('★', 512, 20);
  ctx.fillStyle = '#f4f2ec';
  ctx.font = 'bold 120px "Arial Black", Impact, "Helvetica Neue", sans-serif';
  ctx.fillText('TROPHY', 512, 100, 600);
  ctx.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('C  O  F  F  E  E', 512, 185);
  return canvasTex(c);
}

export function buildTrophyCoffee(world, boxes) {
  const t = world.trophy;
  if (!t) return;
  const { P, tx, ty, nx, ny } = t;
  const scene = world.scene, colliders = world.colliders, shadows = !world.lowSpec;
  const wallA = Math.atan2(ty, tx), face = Math.atan2(nx, -ny);
  const g = heightAtCampus(...P(0, 1));
  // Local z of a box turned to wallA points out of the wall (+1) or into it (-1)
  const zOut = Math.sign(Math.sin(wallA) * nx - Math.cos(wallA) * ny) || 1;
  // Tilt (about the wall axis) that makes a box's local z run outward and drop by `drop`
  const tilt = (out, drop) => Math.atan2(drop, out * zOut);
  const plane = (w, h, material, a, o, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    const [x, yy] = P(a, o);
    m.position.set(x, g + y, -yy); m.rotation.y = face;
    scene.add(m);
    return m;
  };

  // ---- the shop front ----
  const SW = 11, SH = 5.2;
  plane(SW, SH, new THREE.MeshLambertMaterial({ map: sidingTexture(SW, SH) }), 0, 0.05, SH / 2 - 0.05).receiveShadow = true;
  { const [x, y] = P(0, 0.14); boxes.add(BLACK, x, g + SH - 0.05, -y, SW + 0.2, 0.2, 0.24, wallA); boxes.add(0x2a2c2e, x, g + 0.12, -y, SW, 0.24, 0.2, wallA); }
  // Windows and door, glowing a little so the cafe looks lit from inside
  const itex = interiorTexture();
  const glass = new THREE.MeshLambertMaterial({ map: itex, emissive: 0xffffff, emissiveMap: itex, emissiveIntensity: 0.35 });
  plane(8.8, 3.0, glass, 0, 0.08, 1.5);
  // Black steel frames: posts, sill, transom and head
  for (const a of [-4.4, -2.7, -1.0, 1.0, 2.7, 4.4]) { const [x, y] = P(a, 0.12); boxes.add(BLACK, x, g + 1.5, -y, 0.1, 3.0, 0.1, wallA); }
  for (const [h, a0, a1] of [[3.0, -4.45, 4.45], [2.45, -4.4, 4.4], [0.45, -4.4, -1.0], [0.45, 1.0, 4.4]]) {
    const [x, y] = P((a0 + a1) / 2, 0.12); boxes.add(BLACK, x, g + h, -y, a1 - a0, 0.09, 0.1, wallA);
  }
  for (const a of [-3.55, 3.55]) { const [x, y] = P(a, 0.12); boxes.add(BLACK, x, g + 1.45, -y, 0.04, 2.0, 0.06, wallA); } // thin muntins
  // Glass double door: frames and long brass pulls
  for (const a of [-0.92, 0, 0.92]) { const [x, y] = P(a, 0.13); boxes.add(BLACK, x, g + 1.22, -y, 0.08, 2.45, 0.08, wallA); }
  { const [x, y] = P(0, 0.13); boxes.add(BLACK, x, g + 0.08, -y, 1.9, 0.16, 0.1, wallA); }
  for (const a of [-0.18, 0.18]) { const [x, y] = P(a, 0.22); boxes.add(0xc9a227, x, g + 1.15, -y, 0.04, 0.9, 0.04, wallA); }
  // Navy-and-white striped fabric awning over the windows, on a black frame, with a valance
  {
    const stripes = new THREE.MeshLambertMaterial({ map: stripeTexture(9.4), side: THREE.DoubleSide });
    const drop = 0.55, out = 1.3, len = Math.hypot(drop, out);
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(9.4, len), stripes);
    const [x, y] = P(0, out / 2 + 0.05);
    aw.position.set(x, g + 3.3 - drop / 2, -y);
    aw.rotation.order = 'YXZ'; aw.rotation.y = face; aw.rotation.x = -Math.atan2(out, drop);
    aw.castShadow = shadows; scene.add(aw);
    const val = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 0.25), stripes);
    const [vx, vy] = P(0, out + 0.06);
    val.position.set(vx, g + 3.3 - drop - 0.12, -vy); val.rotation.y = face; scene.add(val);
    for (const a of [-4.7, 4.7]) { const [rx, ry] = P(a, out / 2 + 0.05); boxes.add(BLACK, rx, g + 3.3 - drop / 2, -ry, 0.04, 0.04, len, wallA, 0, tilt(out, drop)); }
  }
  // The sign: white painted letters on the navy wall, lit by three gooseneck barn lamps
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.95), new THREE.MeshLambertMaterial({ map: signTexture(), transparent: true }));
  { const [x, y] = P(0, 0.1); sign.position.set(x, g + 4.3, -y); sign.rotation.y = face; scene.add(sign); }
  const bulb = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
  for (const a of [-1.9, 0, 1.9]) {
    const [bx, by] = P(a, 0.1); boxes.add(BLACK, bx, g + 4.95, -by, 0.14, 0.2, 0.06, wallA); // wall plate
    const [ax, ay] = P(a, 0.35); boxes.add(BLACK, ax, g + 5.05, -ay, 0.04, 0.04, 0.55, wallA, 0, tilt(0.5, -0.15));
    const [sx, sy] = P(a, 0.66);
    const shade = new THREE.Mesh(GEOM.cone8, mat(BLACK)); shade.scale.set(0.42, 0.22, 0.42); shade.position.set(sx, g + 5.06, -sy); scene.add(shade);
    const b = new THREE.Mesh(GEOM.sphere, bulb); b.scale.set(0.12, 0.06, 0.12); b.position.set(sx, g + 4.94, -sy); scene.add(b);
  }

  // ---- the patio ----
  // Benches under the windows
  for (const a of [-2.7, 2.7]) {
    const [x, y] = P(a, 0.5), gb = heightAtCampus(x, y);
    boxes.add(WOOD, x, gb + 0.45, -y, 2.6, 0.08, 0.4, wallA);
    for (const s of [-1.1, 1.1]) { const [lx, ly] = P(a + s, 0.5); boxes.add(BLACK, lx, gb + 0.22, -ly, 0.06, 0.44, 0.36, wallA); }
    colliders.addCircle(x, -y, 0.35, 'bench', gb + 0.5);
  }
  // Two picnic tables, each under a navy market umbrella
  const ALONG_O = wallA + Math.PI / 2;
  for (const a of [-3.5, 3.5]) {
    const [x, y] = P(a, 3.3), gt = heightAtCampus(x, y);
    boxes.add(WOOD, x, gt + 0.76, -y, 0.9, 0.06, 2.4, wallA);
    for (const o of [2.3, 4.3]) for (const s of [-0.35, 0.35]) { const [lx, ly] = P(a + s, o); boxes.add(BLACK, lx, gt + 0.37, -ly, 0.06, 0.74, 0.06, wallA); }
    for (const s of [-0.78, 0.78]) {
      const [bx, by] = P(a + s, 3.3);
      boxes.add(WOOD, bx, gt + 0.45, -by, 0.32, 0.06, 2.2, wallA);
      for (const o of [2.4, 4.2]) { const [lx, ly] = P(a + s, o); boxes.add(BLACK, lx, gt + 0.22, -ly, 0.06, 0.44, 0.06, wallA); }
    }
    boxes.add(0xd8d2c4, x, gt + 1.5, -y, 0.06, 1.5, 0.06, 0); // umbrella pole
    const um = new THREE.Mesh(GEOM.cone8, mat(NAVY)); um.scale.set(3.4, 0.55, 3.4); um.position.set(x, gt + 2.45, -y); um.rotation.y = ALONG_O + Math.PI / 8; um.castShadow = shadows; scene.add(um);
    const fin = new THREE.Mesh(GEOM.sphere, mat(0xb8ae98)); fin.scale.setScalar(0.12); fin.position.set(x, gt + 2.75, -y); scene.add(fin);
    for (const o of [2.6, 4.0]) { const [cx, cy] = P(a, o); colliders.addCircle(cx, -cy, 0.95, 'table', gt + 0.8); }
  }
  // Little round marble bistro tables with blue-and-white rattan chairs near the front edge
  for (const a of [-1.7, 1.7]) {
    const [x, y] = P(a, 5.1), gt = heightAtCampus(x, y);
    const top = new THREE.Mesh(GEOM.cyl, mat(MARBLE)); top.scale.set(0.7, 0.04, 0.7); top.position.set(x, gt + 0.74, -y); scene.add(top);
    boxes.add(BLACK, x, gt + 0.37, -y, 0.06, 0.74, 0.06, 0);
    boxes.add(BLACK, x, gt + 0.02, -y, 0.45, 0.04, 0.45, wallA);
    for (const s of [-0.55, 0.55]) {
      const [cx, cy] = P(a + s, 5.1), an = wallA + (s < 0 ? 0 : Math.PI);
      boxes.add(RATTAN, cx, gt + 0.46, -cy, 0.42, 0.05, 0.42, an);
      const [kx, ky] = P(a + s * 1.36, 5.1); boxes.add(RATTAN, kx, gt + 0.72, -ky, 0.05, 0.5, 0.4, an);
      boxes.add(0xf2f0ea, kx, gt + 0.86, -ky, 0.06, 0.08, 0.42, an); // the white weave band
      for (const d of [-0.16, 0.16]) for (const e of [-0.16, 0.16]) { const [lx, ly] = P(a + s + d, 5.1 + e); boxes.add(0xc9b48a, lx, gt + 0.23, -ly, 0.03, 0.46, 0.03, 0); }
    }
    colliders.addCircle(x, -y, 0.5, 'table', gt + 0.8);
  }
  // Stacked-stone piers along the front of the patio, carrying a dark timber pergola
  const STONES = [0x8a7f72, 0x6f6457, 0x9a8a72, 0x5e544a];
  for (const a of [-5.6, 0, 5.6]) {
    const [x, y] = P(a, 6.2), gp = heightAtCampus(x, y);
    for (let k = 0; k < 7; k++) boxes.add(STONES[(k + Math.round(a)) & 3], x, gp + 0.22 + k * 0.42, -y, 0.7 - (k % 2) * 0.03, 0.42, 0.7 - ((k + 1) % 2) * 0.03, wallA);
    boxes.add(0xb9b5ad, x, gp + 3.05, -y, 0.82, 0.12, 0.82, wallA); // cap
    colliders.addCircle(x, -y, 0.5, 'pier', gp + 3.1);
  }
  { const [x, y] = P(0, 6.2); boxes.add(0x3a2a20, x, g + 3.25, -y, 12.4, 0.3, 0.25, wallA); }
  for (let a = -5.6; a <= 5.6; a += 0.8) { const [x, y] = P(a, 3.2); boxes.add(0x3a2a20, x, g + 3.42, -y, 0.12, 0.2, 6.6, wallA); }
  // Chalkboard A-frame by the door, and trash and recycling cans by the wall
  { const [mx, my] = P(1.5, 1.3), gm = heightAtCampus(mx, my); boxes.add(0x1f2a24, mx, gm + 0.5, -my, 0.6, 0.95, 0.06, wallA, 0, 0.18); boxes.add(0x6b4f33, mx, gm + 0.5, -my, 0.66, 1.0, 0.03, wallA, 0, 0.18); }
  for (const [a, color] of [[5.0, 0x3a3a3a], [5.6, 0x2f5d8a]]) {
    const [cx, cy] = P(a, 0.55), gc = heightAtCampus(cx, cy);
    boxes.add(color, cx, gc + 0.5, -cy, 0.5, 1.0, 0.5, wallA);
    boxes.add(0x222222, cx, gc + 1.02, -cy, 0.54, 0.06, 0.54, wallA);
  }
}

// Trophy North, the walk-up window on North Campus (the campus map's marker and photo): it
// is set into the Stead Center's short south wall under the big oak, facing the plaza. A navy
// stucco face with two service windows (ORDER HERE, PICK UP HERE) over a white counter ledge
// on black brackets, a menu board, a little lantern, a timber shed canopy on braced posts, a
// black railing at the side, and a stone pillar with a lantern like North Oaks Plaza's
const TROPHY_NORTH = [34.38506, -118.516546];
export function buildTrophyNorth(world, boxes) {
  const b = world.buildings.find((q) => q.id === 'humanities');
  if (!b) return;
  const [mx, my] = toCampus(TROPHY_NORTH);
  // the wall the marker sits on
  let e = null, bd = Infinity;
  for (let i = 0; i < b.poly.length; i++) {
    const [ax, ay] = b.poly[i], [bx, by] = b.poly[(i + 1) % b.poly.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 3.5) continue;
    const d = distToPolyline(mx, my, [[ax, ay], [bx, by]]);
    if (d < bd) { bd = d; e = { ax, ay, bx, by, len }; }
  }
  if (!e || bd > 6) return;
  let tx = (e.bx - e.ax) / e.len, ty = (e.by - e.ay) / e.len, nx = ty, ny = -tx;
  const cx0 = (e.ax + e.bx) / 2, cy0 = (e.ay + e.by) / 2;
  if (pointInPoly(cx0 + nx * 0.5, cy0 + ny * 0.5, b.poly)) { nx = -nx; ny = -ny; }
  if (tx * ny - ty * nx < 0) { tx = -tx; ty = -ty; } // a runs left to right, seen from outside
  const P = (a, o) => [cx0 + tx * a + nx * o, cy0 + ty * a + ny * o];
  const A = Math.atan2(ty, tx), face = Math.atan2(nx, -ny);
  const scene = world.scene, shadows = !world.lowSpec;
  const g = heightAtCampus(...P(0, 1));
  const W = Math.min(4.6, e.len - 0.3);
  const plane = (w, h, material, a, o, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    const [x, yy] = P(a, o); m.position.set(x, g + y, -yy); m.rotation.y = face; scene.add(m); return m;
  };
  // navy stucco face
  plane(W, 3.1, new THREE.MeshLambertMaterial({ map: sidingTexture(W, 3.1) }), 0, 0.06, 1.55);
  // service windows (green-gray glass, black frames), signs over them, the ledge below
  const glass = new THREE.MeshLambertMaterial({ color: 0x5f7a74, emissive: 0x1a2a26 });
  const sign = (text) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#f4f2ec'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 30px "Helvetica Neue", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 34, 240);
    return new THREE.MeshLambertMaterial({ map: canvasTex(c) });
  };
  for (const [a, text] of [[-0.2, 'ORDER HERE!'], [1.2, 'PICK UP HERE!']]) {
    plane(0.95, 0.95, glass, a, 0.09, 1.65);
    const [fx, fy] = P(a, 0.1);
    for (const dy of [1.15, 2.15]) boxes.add(BLACK, fx, g + dy, -fy, 1.05, 0.07, 0.06, A);
    for (const da of [-0.5, 0.5]) { const [sx, sy] = P(a + da, 0.1); boxes.add(BLACK, sx, g + 1.65, -sy, 0.07, 1.05, 0.06, A); }
    plane(0.75, 0.18, sign(text), a, 0.1, 2.38);
  }
  { const [lx, ly] = P(0.5, 0.25); boxes.add(0xf2f0ea, lx, g + 1.1, -ly, W - 0.4, 0.06, 0.45, A); }
  for (const a of [-1.4, 0.5, 1.9]) { const [kx, ky] = P(a, 0.2); boxes.add(BLACK, kx, g + 0.98, -ky, 0.04, 0.2, 0.3, A); }
  // the menu board at the left: rows of drinks on a pale board in a wood frame
  {
    const c = document.createElement('canvas'); c.width = 160; c.height = 200;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#7a5a3a'; ctx.fillRect(0, 0, 160, 200);
    ctx.fillStyle = '#efece4'; ctx.fillRect(8, 8, 144, 184);
    ctx.fillStyle = '#2a2a2a';
    for (let k = 0; k < 14; k++) ctx.fillRect(16, 18 + k * 12.5, 70 + ((k * 37) % 40), 4);
    for (let k = 0; k < 14; k++) ctx.fillRect(128, 18 + k * 12.5, 16, 4);
    plane(0.85, 1.05, new THREE.MeshLambertMaterial({ map: canvasTex(c) }), -1.65, 0.1, 1.75);
  }
  // a little lantern over the windows
  { const [lx, ly] = P(0.5, 0.18); boxes.add(0x6b4f33, lx, g + 2.72, -ly, 0.16, 0.24, 0.16, A); const bulb = new THREE.Mesh(GEOM.sphere, new THREE.MeshBasicMaterial({ color: 0xffe2a8 })); bulb.scale.setScalar(0.1); bulb.position.set(lx, g + 2.66, -ly); scene.add(bulb); }
  // the timber shed canopy: two posts with knee braces, a beam, rafters and a sloped roof
  const T = 0x7a5a3e, OUT = 2.3, top = 3.1;
  for (const a of [-W / 2 + 0.25, W / 2 - 0.25]) {
    const [px, py] = P(a, OUT); const gp = heightAtCampus(px, py);
    boxes.add(T, px, (gp + g + top) / 2, -py, 0.18, g + top - gp, 0.18, A);
    world.colliders.addCircle(px, -py, 0.18, 'post', g + top);
    const [bx, by] = P(a, OUT - 0.4); boxes.add(T, bx, g + top - 0.45, -by, 0.1, 0.1, 0.9, A, 0, Math.PI / 4);
  }
  { const [bx, by] = P(0, OUT); boxes.add(T, bx, g + top + 0.05, -by, W + 0.4, 0.22, 0.16, A); }
  for (let a = -W / 2; a <= W / 2 + 0.01; a += W / 4) { const [rx, ry] = P(a, OUT / 2); boxes.add(T, rx, g + top + 0.3, -ry, 0.1, 0.16, OUT + 0.6, A, 0, -0.12); }
  {
    const [rx, ry] = P(0, OUT / 2 + 0.05);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.06, OUT + 0.7), mat(0x5a4636));
    roof.position.set(rx, g + top + 0.42, -ry); roof.rotation.order = 'YXZ'; roof.rotation.y = A; roof.rotation.x = 0.12 * Math.sign(Math.cos(A) * ny - Math.sin(A) * nx || 1);
    roof.castShadow = shadows; scene.add(roof);
  }
  // black railing at the right side, and the stone pillar with its lantern beyond it
  for (let o = 0.4; o <= 2.2; o += 0.12) { const [rx, ry] = P(W / 2 + 0.3, o); boxes.add(0x1b1b1b, rx, g + 0.5, -ry, 0.025, 1.0, 0.025, A); }
  for (const h of [0.08, 1.0]) { const [rx, ry] = P(W / 2 + 0.3, 1.3); boxes.add(0x1b1b1b, rx, g + h, -ry, 0.04, 0.05, 1.9, A); }
  {
    const [sx, sy] = P(W / 2 + 0.9, OUT + 0.4), gs = heightAtCampus(sx, sy);
    const STONES = [0x8a7f72, 0x6f6457, 0x9a8a72, 0x5e544a];
    for (let k = 0; k < 3; k++) boxes.add(STONES[k], sx, gs + 0.2 + k * 0.4, -sy, 0.6, 0.4, 0.6, A);
    boxes.add(0xcfc7b6, sx, gs + 1.25, -sy, 0.7, 0.1, 0.7, A);
    boxes.add(0x6b4f33, sx, gs + 1.5, -sy, 0.34, 0.4, 0.34, A);
    boxes.add(0xffe2a8, sx, gs + 1.5, -sy, 0.26, 0.3, 0.26, A);
    const capm = new THREE.Mesh(GEOM.cone4, mat(0x6b4f33)); capm.scale.set(0.6, 0.25, 0.6); capm.position.set(sx, gs + 1.82, -sy); capm.rotation.y = A + Math.PI / 4; scene.add(capm);
    world.colliders.addCircle(sx, -sy, 0.4, 'pillar', gs + 1.9);
  }
  world.places.trophyNorth = [P(-0.2, 1.3)[0], -P(-0.2, 1.3)[1]];
}
